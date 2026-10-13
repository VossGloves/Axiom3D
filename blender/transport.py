"""Axiom3D transport layer: socket server, job queue, main-thread pump.

Shared between headless worker.py and GUI addon.py. Handlers live in rpc/;
this module owns only the TCP transport and main-thread pump.

Two pump modes:
  - background: blocking while True loop (Blender --background owns main thread)
  - gui: bpy.app.timers.register (main thread is UI event loop)

GUI self-healing: an exec timeout marks the session poisoned so tools stop
queuing work, but when the main thread becomes free again the pump clears
poison automatically. The GUI timer also restarts a TCP server that died
unexpectedly so Blender does not need a manual restart + Start Server click.
"""

import json
import os
import queue
import socketserver
import threading
import time
import traceback

import bpy

from rpc import dispatch
from rpc.base import AXIOM_DIR, STATE, log_error, ping_result, write_port_file

# bpy is main-thread-only: handler threads enqueue jobs, the main thread pumps them.
JOBS: queue.Queue = queue.Queue()

# Set by transport.run(); None until server starts.
_server = None

# How long the main thread must stay free after a poison before auto-clearing.
# Long enough that a still-stuck exec would keep the pump blocked; short enough
# that a recovered session is usable again within a normal tool timeout window.
UNPOISON_IDLE_S = 2.0


def handler_wait(cmd, params):
    """How long a handler thread waits for the main-thread pump before answering with a
    timeout error. Must stay under the client's rpc timeout so the answer wins the race."""
    if cmd == "exec":
        return min(max(float(params.get("timeout", 30)), 1), 600) + 2
    if cmd == "gate":
        return min(max(float(params.get("timeout", 300)), 30), 1200) + 60
    if cmd == "render":
        return 300.0
    return 120.0


class Handler(socketserver.StreamRequestHandler):
    """Runs on a server thread. Never touches bpy: ping answers from cached STATE,
    everything else is queued for the main thread and awaited."""

    def handle(self):
        for raw in self.rfile:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            request_id = None
            try:
                request = json.loads(line)
                request_id = request.get("id")
                response = self.process(request)
            except Exception as exc:  # noqa: BLE001 - one bad request must not kill the loop
                log_error()
                response = {
                    "id": request_id,
                    "ok": False,
                    "error": {"type": type(exc).__name__, "message": str(exc)},
                }
            self.wfile.write((json.dumps(response) + "\n").encode("utf-8"))
            self.wfile.flush()

    def process(self, request):
        cmd = request.get("cmd")
        params = request.get("params") or {}
        if cmd == "ping":
            return {"id": request.get("id"), "ok": True, "result": ping_result()}
        done = threading.Event()
        box: dict = {}
        JOBS.put({"request": request, "done": done, "box": box})
        wait = handler_wait(cmd, params)
        if done.wait(wait):
            return box["response"]
        if cmd in ("exec", "gate"):
            # The pump is stuck inside this job (gate embeds an exec); nothing else
            # can run until it dies, so report poisoned exactly like a plain exec timeout.
            # The pump clears poison again once the main thread is free for
            # UNPOISON_IDLE_S — no Blender restart required.
            STATE["poisoned"] = True
            STATE["poisoned_at"] = time.monotonic()
            write_port_file()
            return {
                "id": request.get("id"),
                "ok": False,
                "error": {
                    "type": "ExecTimeout",
                    "message": f"{cmd} exceeded {wait:.0f}s and is still running on "
                    "the main thread. Session marked poisoned until the main thread "
                    "is free again (auto-recovers; no Blender restart needed).",
                },
            }
        return {
            "id": request.get("id"),
            "ok": False,
            "error": {"type": "ServerTimeout", "message": f"{cmd} did not finish in time; worker busy?"},
        }


def maybe_unpoison():
    """Clear poison once the main thread has been free long enough to prove the
    stuck exec finished. Called only from the main-thread pump/timer, so a still-
    running infinite loop never reaches this."""
    if not STATE.get("poisoned"):
        return
    if STATE.get("manual_stop"):
        return
    poisoned_at = STATE.get("poisoned_at")
    if poisoned_at is None:
        # Poisoned without a timestamp (legacy state) — clear on next idle pump.
        STATE["poisoned"] = False
        write_port_file()
        return
    if JOBS.empty() and time.monotonic() - poisoned_at >= UNPOISON_IDLE_S:
        STATE["poisoned"] = False
        STATE["poisoned_at"] = None
        write_port_file()


def pump_one():
    """Process one job from the queue. Returns True if a job was processed."""
    try:
        job = JOBS.get_nowait()
    except queue.Empty:
        maybe_unpoison()
        return False
    request = job["request"]
    try:
        job["box"]["response"] = {"id": request.get("id"), **dispatch(request)}
    except Exception:  # noqa: BLE001 - report, never kill the pump
        log_error()
        job["box"]["response"] = {
            "id": request.get("id"),
            "ok": False,
            "error": {"type": "Internal", "message": traceback.format_exc().splitlines()[-1]},
        }
    finally:
        job["done"].set()
    return True


def _gui_timer():
    """bpy.app.timers callback: self-heal server if needed, pump all pending jobs,
    return 0.05 to stay registered."""
    try:
        # Self-heal: a crashed/closed TCP server left Blender alive but unreachable.
        # Restart it instead of requiring the user to click Start Server.
        if STATE.get("mode") == "gui" and not STATE.get("manual_stop") and _server is None:
            start_server(mode="gui")
        while pump_one():
            pass
    except Exception:
        log_error()
    return 0.05  # stay registered even on error


class _ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_server(mode="headless"):
    """Start TCP server on ephemeral port, write port file, return server.

    Does NOT start the pump — caller owns main thread and must call pump loops.
    Safe to call again after a crash: replaces any previous server object.
    """
    global _server
    os.makedirs(AXIOM_DIR, exist_ok=True)
    STATE["version"] = bpy.app.version_string
    STATE["mode"] = mode
    STATE["manual_stop"] = False
    if _server is not None:
        try:
            _server.shutdown()
            _server.server_close()
        except Exception:
            log_error()
        _server = None
    server = _ReusableTCPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    write_port_file.port = server.server_address[1]
    write_port_file()
    threading.Thread(target=server.serve_forever, name="axiom3d-accept", daemon=True).start()
    _server = server
    print(f"AXIOM3D_WORKER_READY port={write_port_file.port} pid={os.getpid()} mode={mode}", flush=True)
    return server


def stop_server():
    """Stop the TCP server. Safe to call multiple times. Marks intentional stop so
    the GUI timer does not auto-restart until Start Server is clicked again."""
    global _server
    STATE["manual_stop"] = True
    if _server:
        _server.shutdown()
        _server.server_close()
        _server = None


def run_background():
    """Headless mode: blocking pump loop. Never returns; keeps Blender alive."""
    start_server(mode="headless")
    while True:
        try:
            job = JOBS.get(timeout=0.05)
        except queue.Empty:
            maybe_unpoison()
            continue
        request = job["request"]
        try:
            job["box"]["response"] = {"id": request.get("id"), **dispatch(request)}
        except Exception:  # noqa: BLE001 - report, never kill the pump
            log_error()
            job["box"]["response"] = {
                "id": request.get("id"),
                "ok": False,
                "error": {"type": "Internal", "message": traceback.format_exc().splitlines()[-1]},
            }
        finally:
            job["done"].set()


def run_gui():
    """GUI mode: start server + register timer pump. Returns immediately.

    Main thread is Blender's UI event loop; we borrow it via repeating timer.
    """
    if bpy.app.background:
        raise RuntimeError("GUI mode requires Blender with a window; use worker.py for headless")
    start_server(mode="gui")
    bpy.app.timers.register(_gui_timer, first_interval=0.05, persistent=True)
