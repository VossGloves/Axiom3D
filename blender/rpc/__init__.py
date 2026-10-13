"""RPC command registry. Handlers never touch sockets; worker.py owns the transport
(TCP, main-thread jobs pump, watchdog). Commands: ping (answered from STATE without
the pump), exec, snapshot, restore, reset, query, render, export, validate, gate,
list_templates, instantiate, docs, repair."""

from rpc.base import ExecScriptError, WorkerError, require_live
from rpc import docs, export, gate, render, repair, session, templates, validate

COMMANDS = {
    "exec": session.cmd_exec,
    "snapshot": session.cmd_snapshot,
    "restore": session.cmd_restore,
    "reset": session.cmd_reset,
    "query": session.cmd_query,
    "render": render.cmd_render,
    "export": export.cmd_export,
    "validate": validate.cmd_validate,
    "gate": gate.cmd_gate,
    "list_templates": templates.cmd_list_templates,
    "instantiate": templates.cmd_instantiate,
    "docs": docs.cmd_docs,
    "repair": repair.cmd_repair,
}


def dispatch(request):
    cmd = request.get("cmd")
    params = request.get("params") or {}
    handler = COMMANDS.get(cmd)
    if not handler:
        raise WorkerError("UnknownCommand", f"unknown command: {cmd}")
    require_live(cmd)
    try:
        return {"ok": True, "result": handler(params)}
    except ExecScriptError as exc:
        return {"ok": False, "error": {"type": exc.type, "message": exc.message, "result": exc.result}}
    except WorkerError as exc:
        return {"ok": False, "error": {"type": exc.type, "message": str(exc)}}