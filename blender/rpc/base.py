"""Shared worker state and safety primitives. Leaf module: imports only stdlib and
bpy, so every handler module can depend on it without cycles. worker.py owns the
transport (TCP, jobs pump) and mutates STATE through this module's dict."""

import json
import os
import re
import threading
import time
import traceback

import bpy

ROOT = os.environ.get("AXIOM3D_ROOT") or os.getcwd()
AXIOM_DIR = os.path.join(ROOT, ".axiom3d")
PORT_FILE = os.path.join(AXIOM_DIR, "blender.port")
SNAP_DIR = os.path.join(AXIOM_DIR, "snapshots")
LOG_FILE = os.path.join(AXIOM_DIR, "worker.log")
SNAP_KEEP = 10

# bpy is main-thread-only: handler threads enqueue jobs, the main thread pumps them.
# poisoned_at: monotonic time the session was marked poisoned (auto-clears once the
# main thread is free for UNPOISON_IDLE_S). manual_stop: intentional Stop Server —
# the GUI timer must not auto-restart until Start Server is clicked again.
STATE = {
    "started": time.monotonic(),
    "poisoned": False,
    "poisoned_at": None,
    "manual_stop": False,
    "last_snapshot": None,
    "seq": 0,
    "version": "",
}
PORT_LOCK = threading.Lock()


class WorkerError(Exception):
    def __init__(self, type_, message):
        super().__init__(message)
        self.type = type_
        self.message = message


class ExecScriptError(WorkerError):
    def __init__(self, result):
        super().__init__(result["error"]["type"], result["error"]["message"])
        self.result = result


def log_error():
    with open(LOG_FILE, "a", encoding="utf-8") as handle:
        handle.write(f"--- {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
        handle.write(traceback.format_exc())
        handle.write("\n")


def write_port_file():
    payload = {
        "port": write_port_file.port,
        "pid": os.getpid(),
        "version": STATE["version"],
        "mode": STATE.get("mode", "headless"),
        "last_snapshot": STATE["last_snapshot"],
        "poisoned": STATE["poisoned"],
    }
    tmp = PORT_FILE + ".tmp"
    with PORT_LOCK:
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
    os.replace(tmp, PORT_FILE)


def call_op(op, **kwargs):
    """Call a bpy operator, dropping kwargs its RNA signature does not know."""
    known = {p.identifier for p in op.get_rna_type().properties if p.identifier != "rna_type"}
    filtered = {k: v for k, v in kwargs.items() if k in known}
    return op(**filtered)


def require_live(operation):
    if STATE["poisoned"] and operation != "ping":
        raise WorkerError(
            "WorkerPoisoned",
            "session poisoned by timed-out exec; waits for main thread to free "
            "(auto-recovers). Retry shortly — no Blender restart needed.",
        )


def scene_summary():
    summary = {}
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            summary[obj.name] = (obj.type, len(obj.data.vertices), len(obj.data.materials))
        else:
            summary[obj.name] = (obj.type, -1, 0)
    return summary


def scene_diff(before, after):
    added = [name for name in after if name not in before]
    removed = [name for name in before if name not in after]
    modified = [name for name in after if name in before and after[name] != before[name]]
    return {"added": added, "removed": removed, "modified": modified}


def ping_result():
    return {
        "version": STATE["version"],
        "pid": os.getpid(),
        "uptime_s": round(time.monotonic() - STATE["started"], 1),
        "poisoned": STATE["poisoned"],
        "last_snapshot": STATE["last_snapshot"],
    }