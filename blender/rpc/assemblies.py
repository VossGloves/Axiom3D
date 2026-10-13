"""Assembly commands: group multi-part assets under an empty, mark members.

create_assembly parents named objects under a new empty and tags members with
obj["assembly"] = True (the gate's self-intersection opt-out for intentional
overlaps at joints). list_assemblies reports current groups. ungroup dissolves
the empty while keeping members in place.
"""

import bpy

from rpc.base import WorkerError


def cmd_create_assembly(params):
    members = params.get("members")  # list of object names
    name = params.get("name", "assembly")
    location = params.get("location", (0, 0, 0))

    if not members or not isinstance(members, list):
        raise WorkerError("BadRequest", "create_assembly requires params.members (list of object names)")

    objs = []
    for member_name in members:
        obj = bpy.data.objects.get(member_name)
        if not obj:
            raise WorkerError("NotFound", f"member not found: {member_name!r}")
        objs.append(obj)

    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    empty.empty_display_size = 0.5
    empty.location = location
    bpy.context.scene.collection.objects.link(empty)

    for obj in objs:
        obj.parent = empty
        obj.matrix_parent_inverse = empty.matrix_world.inverted()
        obj["assembly"] = True

    empty["assembly_root"] = True
    empty["assembly_members"] = len(objs)

    return {
        "assembly": empty.name,
        "members": [o.name for o in objs],
        "member_count": len(objs),
        "location": [round(v, 6) for v in empty.location],
    }


def cmd_list_assemblies(params):
    assemblies = []
    for obj in bpy.data.objects:
        if obj.get("assembly_root"):
            children = [c.name for c in obj.children]
            assemblies.append({
                "name": obj.name,
                "members": children,
                "member_count": len(children),
                "location": [round(v, 6) for v in obj.location],
            })
    # Also report loose assembly-tagged objects (not under a root)
    loose = [o.name for o in bpy.data.objects if o.get("assembly") and not o.parent]
    return {"assemblies": assemblies, "loose_assembly_members": loose}


def cmd_dissolve_assembly(params):
    name = params.get("name")
    if not name:
        raise WorkerError("BadRequest", "dissolve_assembly requires params.name")
    empty = bpy.data.objects.get(name)
    if not empty or empty.type != "EMPTY":
        raise WorkerError("NotFound", f"assembly empty not found: {name!r}")

    children = list(empty.children)
    for child in children:
        # Keep world transform: parent inverse already stored; clear parent keeps matrix
        world = child.matrix_world.copy()
        child.parent = None
        child.matrix_world = world
        # Keep assembly tag? Dissolve means no longer assembly-managed
        if "assembly" in child:
            del child["assembly"]

    bpy.data.objects.remove(empty, do_unlink=True)
    return {
        "dissolved": name,
        "released": [c.name for c in children],
        "released_count": len(children),
    }


def cmd_mark_assembly(params):
    """Tag existing objects as assembly members without creating an empty."""
    members = params.get("members")
    if not members or not isinstance(members, list):
        raise WorkerError("BadRequest", "mark_assembly requires params.members (list)")
    tagged = []
    for member_name in members:
        obj = bpy.data.objects.get(member_name)
        if not obj:
            raise WorkerError("NotFound", f"object not found: {member_name!r}")
        obj["assembly"] = True
        tagged.append(obj.name)
    return {"tagged": tagged, "tagged_count": len(tagged)}
