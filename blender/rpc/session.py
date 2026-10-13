"""Session commands: snapshot, restore, reset, exec, query."""

import io
import os
import re
import sys
import time
import traceback

import bpy

from rpc.base import (
    SNAP_DIR,
    SNAP_KEEP,
    STATE,
    ExecScriptError,
    WorkerError,
    call_op,
    require_live,
    scene_diff,
    scene_summary,
    write_port_file,
)


def cmd_snapshot(params):
    STATE["seq"] += 1
    label = re.sub(r"[^a-z0-9_-]", "_", str(params.get("label", "manual")).lower())[:32]
    snap_id = f"snap{STATE['seq']:04d}_{label}"
    path = os.path.join(SNAP_DIR, snap_id + ".blend")
    os.makedirs(SNAP_DIR, exist_ok=True)
    call_op(bpy.ops.wm.save_as_mainfile, filepath=path, copy=True)
    if not os.path.exists(path):
        raise WorkerError("SnapshotFailed", f"snapshot file not written: {path}")
    STATE["last_snapshot"] = snap_id
    write_port_file()
    # Prune by mtime, not name: seq numbers reset when the worker restarts, so
    # name order would evict a fresh worker's checkpoints in favor of stale files.
    prune = [f for f in os.listdir(SNAP_DIR) if f.endswith(".blend")]
    prune.sort(key=lambda f: (os.path.getmtime(os.path.join(SNAP_DIR, f)), f))
    for old in prune[: max(0, len(prune) - SNAP_KEEP)]:
        os.remove(os.path.join(SNAP_DIR, old))
    return {"id": snap_id, "path": path}


def cmd_restore(params):
    snap_id = params.get("id")
    if not snap_id:
        raise WorkerError("BadRequest", "restore requires params.id")
    path = os.path.join(SNAP_DIR, snap_id + ".blend")
    if not os.path.exists(path):
        raise WorkerError("NotFound", f"no snapshot {snap_id}")
    result = call_op(bpy.ops.wm.open_mainfile, filepath=path)
    if "FINISHED" not in result:
        raise WorkerError("RestoreFailed", f"open_mainfile returned {result}")
    STATE["poisoned"] = False
    STATE["last_snapshot"] = snap_id
    write_port_file()
    return {"restored": snap_id}


def cmd_reset(params):
    call_op(bpy.ops.wm.read_factory_settings, use_empty=True)
    STATE["poisoned"] = False
    write_port_file()
    return {"reset": True}


def cmd_exec(params):
    require_live("exec")
    code = params.get("code")
    if not isinstance(code, str) or not code.strip():
        raise WorkerError("BadRequest", "exec requires params.code (non-empty string)")

    if params.get("snapshot", True):
        cmd_snapshot({"label": "auto-exec"})

    before = scene_summary()
    out, err = io.StringIO(), io.StringIO()
    error = None
    import ops
    namespace = {
        "bpy": bpy,
        "ops": ops,
        "__builtins__": __builtins__,
        "__name__": "__axiom3d_exec__",
    }

    timeout_s = min(max(float(params.get("timeout", 30)), 1), 600)

    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = out, err
    started = time.monotonic()

    # Soft wall-clock timeout for pure-Python hangs (while True: pass). Interrupts
    # Python bytecode on the main thread; cannot interrupt a stuck C/bpy call —
    # that still relies on the transport poison + auto-unpoison path.
    def _soft_timeout(signum, frame):
        raise TimeoutError(f"exec exceeded soft timeout of {timeout_s:.0f}s")

    timer_armed = False
    old_handler = None
    try:
        import signal

        old_handler = signal.signal(signal.SIGALRM, _soft_timeout)
        signal.setitimer(signal.ITIMER_REAL, timeout_s)
        timer_armed = True
    except (ValueError, OSError):
        # Not on main thread or signals unavailable — fall back to hard timeout only.
        old_handler = None

    try:
        exec(compile(code, "<axiom3d>", "exec"), namespace)
    except SystemExit:
        error = None
    except TimeoutError as exc:
        error = {
            "type": "ExecTimeout",
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }
    except BaseException as exc:  # noqa: BLE001 - report any script failure verbatim
        error = {
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }
    finally:
        if timer_armed:
            signal.setitimer(signal.ITIMER_REAL, 0)
            if old_handler is not None:
                signal.signal(signal.SIGALRM, old_handler)
        sys.stdout, sys.stderr = old_out, old_err
    duration_ms = int((time.monotonic() - started) * 1000)

    after = scene_summary()
    result = {
        "stdout": out.getvalue(),
        "stderr": err.getvalue(),
        "error": error,
        "duration_ms": duration_ms,
        "snapshot": STATE["last_snapshot"],
        "scene_diff": scene_diff(before, after),
    }
    if error:
        raise ExecScriptError(result)
    return result


def cmd_query(params):
    kind = params.get("kind", "summary")
    if kind == "summary":
        counts = {}
        for obj in bpy.data.objects:
            counts[obj.type] = counts.get(obj.type, 0) + 1
        return {
            "version": bpy.app.version_string,
            "file": bpy.data.filepath,
            "objects": counts,
            "materials": len(bpy.data.materials),
            "node_groups": len(bpy.data.node_groups),
            "unit": {
                "system": bpy.context.scene.unit_settings.system,
                "scale_length": bpy.context.scene.unit_settings.scale_length,
            },
            "engine": bpy.context.scene.render.engine,
            "poisoned": STATE["poisoned"],
            "last_snapshot": STATE["last_snapshot"],
        }
    if kind == "objects":
        objects = []
        for obj in bpy.data.objects:
            entry = {
                "name": obj.name,
                "type": obj.type,
                "location": [round(v, 6) for v in obj.location],
                "rotation_euler": [round(v, 6) for v in obj.rotation_euler],
                "scale": [round(v, 6) for v in obj.scale],
                "dimensions": [round(v, 6) for v in obj.dimensions],
                "parent": obj.parent.name if obj.parent else None,
                "visible": not obj.hide_render and not obj.hide_viewport,
                "materials": [m.name for m in obj.data.materials] if obj.type == "MESH" else [],
                "modifiers": [{"name": m.name, "type": m.type} for m in obj.modifiers],
            }
            if obj.type == "MESH":
                entry["vertices"] = len(obj.data.vertices)
                entry["polygons"] = len(obj.data.polygons)
                entry["uv_layers"] = [uv.name for uv in obj.data.uv_layers]
            objects.append(entry)
        return {"objects": objects}
    if kind == "materials":
        return {
            "materials": [
                {
                    "name": mat.name,
                    "users": mat.users,
                    "has_nodes": mat.use_nodes,
                    "nodes": len(mat.node_tree.nodes) if mat.use_nodes and mat.node_tree else 0,
                }
                for mat in bpy.data.materials
            ]
        }
    if kind == "node_groups":
        groups = []
        for group in bpy.data.node_groups:
            groups.append(
                {
                    "name": group.name,
                    "type": group.type,
                    "inputs": [
                        {"name": item.name, "type": item.socket_type}
                        for item in group.interface.items_tree
                        if getattr(item, "item_type", "") == "SOCKET" and item.in_out == "INPUT"
                    ],
                }
            )
        return {"node_groups": groups}
    raise WorkerError("BadRequest", f"unknown query kind: {kind}")