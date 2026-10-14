"""Material commands: list library materials, apply one to an object."""

from materials import apply_material, list_materials
from rpc.base import WorkerError
import bpy


def cmd_list_materials(params):
    return {"materials": list_materials()}


def cmd_apply_material(params):
    name = params.get("name")
    key = params.get("material")
    if not name or not key:
        raise WorkerError("BadRequest", "apply_material requires params.name and params.material")
    obj = bpy.data.objects.get(name)
    if not obj or obj.type != "MESH":
        raise WorkerError("NotFound", f"mesh object not found: {name!r}")
    try:
        mat_name = apply_material(obj, key)
    except KeyError as exc:
        raise WorkerError("BadRequest", str(exc))
    return {
        "name": obj.name,
        "material": mat_name,
        "slots": len(obj.data.materials),
    }
