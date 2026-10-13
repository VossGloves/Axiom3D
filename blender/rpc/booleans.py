"""Boolean commands: apply boolean modifiers (difference/union/intersect).

run_boolean adds a boolean modifier between target and cutter, optionally
applies it. Solver EXACT is default (stable headless; MANIFOLD crashes on
multi-shell). Returns modifier stats; caller runs gate to verify.
"""

import bpy

from rpc.base import WorkerError, call_op


def cmd_run_boolean(params):
    target_name = params.get("target")
    cutter_name = params.get("cutter")
    operation = params.get("operation", "DIFFERENCE")  # DIFFERENCE | UNION | INTERSECT
    solver = params.get("solver", "EXACT")  # EXACT | MANIFOLD
    apply = params.get("apply", True)

    if not target_name or not cutter_name:
        raise WorkerError("BadRequest", "run_boolean requires params.target and params.cutter (object names)")
    target = bpy.data.objects.get(target_name)
    cutter = bpy.data.objects.get(cutter_name)
    if not target or target.type != "MESH":
        raise WorkerError("NotFound", f"target mesh not found: {target_name!r}")
    if not cutter or cutter.type != "MESH":
        raise WorkerError("NotFound", f"cutter mesh not found: {cutter_name!r}")
    if operation not in ("DIFFERENCE", "UNION", "INTERSECT"):
        raise WorkerError("BadRequest", f"unknown operation: {operation!r}; use DIFFERENCE | UNION | INTERSECT")

    mod = target.modifiers.new("Boolean", "BOOLEAN")
    mod.operation = operation
    mod.solver = solver
    mod.object = cutter

    verts_before = len(target.data.vertices)
    polys_before = len(target.data.polygons)
    cutter_name_str = cutter.name

    if apply:
        bpy.ops.object.select_all(action="DESELECT")
        target.select_set(True)
        bpy.context.view_layer.objects.active = target
        call_op(bpy.ops.object.modifier_apply, modifier=mod.name)
        # Remove cutter after successful apply (consumed)
        bpy.data.objects.remove(cutter, do_unlink=True)
        cutter_removed = True
    else:
        cutter_removed = False

    return {
        "target": target.name,
        "cutter": cutter_name_str,
        "operation": operation,
        "solver": solver,
        "applied": apply,
        "cutter_removed": cutter_removed,
        "verts_before": verts_before,
        "verts_after": len(target.data.vertices),
        "polys_before": polys_before,
        "polys_after": len(target.data.polygons),
        "dimensions": [round(v, 6) for v in target.dimensions],
    }


def cmd_batch_boolean(params):
    """Apply multiple boolean operations in sequence on one target."""
    target_name = params.get("target")
    operations = params.get("operations")  # list of {cutter, operation, apply}
    solver = params.get("solver", "EXACT")

    if not target_name:
        raise WorkerError("BadRequest", "batch_boolean requires params.target")
    if not operations or not isinstance(operations, list):
        raise WorkerError("BadRequest", "batch_boolean requires params.operations (list)")

    target = bpy.data.objects.get(target_name)
    if not target or target.type != "MESH":
        raise WorkerError("NotFound", f"target mesh not found: {target_name!r}")

    results = []
    for i, op_def in enumerate(operations):
        cutter_name = op_def.get("cutter")
        operation = op_def.get("operation", "DIFFERENCE")
        apply = op_def.get("apply", True)
        cutter = bpy.data.objects.get(cutter_name)
        if not cutter:
            results.append({"index": i, "error": f"cutter not found: {cutter_name!r}"})
            continue

        mod = target.modifiers.new(f"Boolean_{i}", "BOOLEAN")
        mod.operation = operation
        mod.solver = solver
        mod.object = cutter

        if apply:
            bpy.ops.object.select_all(action="DESELECT")
            target.select_set(True)
            bpy.context.view_layer.objects.active = target
            call_op(bpy.ops.object.modifier_apply, modifier=mod.name)
            bpy.data.objects.remove(cutter, do_unlink=True)

        results.append({
            "index": i,
            "cutter": cutter_name,
            "operation": operation,
            "applied": apply,
        })

    return {
        "target": target.name,
        "operations": results,
        "verts": len(target.data.vertices),
        "polys": len(target.data.polygons),
    }
