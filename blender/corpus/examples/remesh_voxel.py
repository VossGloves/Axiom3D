# id: remesh-voxel
# title: Rebuild topology with voxel remesh
# tags: remesh, voxel, topology, rebuild, modifier
# description: Add a Remesh modifier in VOXEL mode to rebuild mesh topology at a uniform density. Reference technique — adapt voxel_size to desired detail level; higher resolution = heavier mesh.

import bpy


def run():
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.active_object
    obj.name = "remesh_test"

    mod = obj.modifiers.new("Remesh", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = 0.1

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    baked = bpy.data.meshes.new_from_object(ev)
    obj.modifiers.clear()
    old = obj.data
    obj.data = baked
    if old.users == 0:
        bpy.data.meshes.remove(old)

    verts = len(obj.data.vertices)
    bpy.data.objects.remove(obj, do_unlink=True)
    return {"verts_after": verts}
