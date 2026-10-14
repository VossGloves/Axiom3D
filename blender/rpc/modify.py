"""Modify commands: bevel, array, solidify, mirror, subsurf, remesh, deform,
displace, linked-instance, apply-all, list modifiers.

Dispatches to the ops helpers. Returns modifier/object stats; caller runs gate
to verify. Instance creates linked duplicates (shared mesh datablock) — option
A from the design: no collection instances, gate-safe.
"""

import bpy

from ops.deform import add_deform, add_displace, add_remesh, instance_object
from ops.modifiers import (
    add_array,
    add_bevel,
    add_mirror,
    add_solidify,
    add_subsurf,
    apply_all_modifiers,
)
from rpc.base import WorkerError


def _get_mesh(name):
    obj = bpy.data.objects.get(name)
    if not obj or obj.type != "MESH":
        raise WorkerError("NotFound", f"mesh object not found: {name!r}")
    return obj


def _modifier_stats(obj, mod):
    return {
        "object": obj.name,
        "modifier": mod.name,
        "type": mod.type,
        "vertices": len(obj.data.vertices),
        "polys": len(obj.data.polygons),
    }


def cmd_modify(params):
    action = params.get("action")
    if not action:
        raise WorkerError("BadRequest", "modify requires params.action")

    if action == "list":
        out = {}
        for obj in bpy.data.objects:
            if obj.type != "MESH":
                continue
            mods = [{"name": m.name, "type": m.type} for m in obj.modifiers]
            if mods:
                out[obj.name] = mods
        return {"objects_with_modifiers": out}

    if action == "instance":
        source_name = params.get("source") or params.get("name")
        if not source_name:
            raise WorkerError("BadRequest", "modify instance requires params.source")
        source = _get_mesh(source_name)
        count = int(params.get("count", 2))
        offset = params.get("offset", (1.0, 0.0, 0.0))
        if isinstance(offset, list):
            offset = tuple(offset)
        created = instance_object(source, count=count, offset=offset)
        return {
            "action": "instance",
            "source": source.name,
            "created": [o.name for o in created],
            "count": len(created),
            "shared_mesh": source.data.name,
        }

    if action == "apply":
        obj = _get_mesh(params.get("name"))
        before = [(m.name, m.type) for m in obj.modifiers]
        apply_all_modifiers(obj)
        return {
            "action": "apply",
            "object": obj.name,
            "applied": before,
            "vertices": len(obj.data.vertices),
            "polys": len(obj.data.polygons),
        }

    name = params.get("name") or params.get("target")
    if not name:
        raise WorkerError("BadRequest", f"modify {action} requires params.name")
    obj = _get_mesh(name)

    if action == "bevel":
        mod = add_bevel(
            obj,
            width=params.get("width", 0.005),
            segments=int(params.get("segments", 2)),
            angle_limit=params.get("angle_limit", 0.7854),
        )
    elif action == "array":
        mod = add_array(
            obj,
            count=int(params.get("count", 2)),
            offset=params.get("offset", (1.0, 0.0, 0.0)),
            use_relative=params.get("use_relative", True),
            relative_offset=params.get("relative_offset", (1.0, 0.0, 0.0)),
        )
    elif action == "solidify":
        mod = add_solidify(obj, thickness=params.get("thickness", 0.01))
    elif action == "mirror":
        axis = params.get("axis", (True, False, False))
        if isinstance(axis, list):
            axis = tuple(axis)
        mod = add_mirror(obj, axis=axis)
    elif action == "subsurf":
        mod = add_subsurf(
            obj,
            levels=int(params.get("levels", 1)),
            render_levels=int(params.get("render_levels", 2)),
        )
    elif action == "remesh":
        mod = add_remesh(
            obj,
            mode=params.get("mode", "VOXEL"),
            voxel_size=params.get("voxel_size", 0.1),
            adaptivity=params.get("adaptivity", 0.0),
        )
    elif action == "deform":
        mod = add_deform(
            obj,
            mode=params.get("mode", "BEND"),
            angle=params.get("angle", 1.5708),
            axis=params.get("axis", "Z"),
            factor=params.get("factor"),
        )
    elif action == "displace":
        mod = add_displace(
            obj,
            strength=params.get("strength", 0.01),
            scale=params.get("scale", 0.2),
        )
    else:
        raise WorkerError(
            "BadRequest",
            f"unknown modify action: {action!r}; available: bevel array solidify mirror subsurf remesh deform displace instance apply list",
        )

    stats = _modifier_stats(obj, mod)
    stats["action"] = action
    return stats
