"""RPC command registry. Handlers never touch sockets; worker.py owns the transport
(TCP, main-thread jobs pump, watchdog). Commands: ping (answered from STATE without
the pump), exec, snapshot, restore, reset, query, render, export, validate, gate,
docs, repair, materials, primitives, curves, booleans, assemblies, damage, modify."""

from rpc.base import ExecScriptError, WorkerError, require_live
from rpc import (
    assemblies,
    booleans,
    curves,
    damage,
    docs,
    export,
    gate,
    materials,
    modify,
    primitives,
    render,
    repair,
    session,
    validate,
)

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
    "docs": docs.cmd_docs,
    "repair": repair.cmd_repair,
    "list_materials": materials.cmd_list_materials,
    "apply_material": materials.cmd_apply_material,
    "create_primitive": primitives.cmd_create_primitive,
    "create_curve": curves.cmd_create_curve,
    "convert_curve_to_mesh": curves.cmd_convert_curve_to_mesh,
    "sweep_curve": curves.cmd_sweep_curve,
    "run_boolean": booleans.cmd_run_boolean,
    "batch_boolean": booleans.cmd_batch_boolean,
    "create_assembly": assemblies.cmd_create_assembly,
    "list_assemblies": assemblies.cmd_list_assemblies,
    "dissolve_assembly": assemblies.cmd_dissolve_assembly,
    "mark_assembly": assemblies.cmd_mark_assembly,
    "apply_damage": damage.cmd_apply_damage,
    "edge_wear": damage.cmd_edge_wear,
    "chips": damage.cmd_chips,
    "cracks": damage.cmd_cracks,
    "surface_noise": damage.cmd_surface_noise,
    "dents": damage.cmd_dents,
    "modify": modify.cmd_modify,
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