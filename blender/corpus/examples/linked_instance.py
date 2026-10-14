# id: linked-instance
# title: Linked-duplicate instances sharing one mesh
# tags: instance, linked, duplicate, array, shared-mesh
# description: Create linked-duplicate objects that share a mesh datablock for efficient repetition. Reference technique — instances stay independent objects (gate-safe); edit the source mesh once and all copies update.

import bpy


def run():
    bpy.ops.mesh.primitive_cube_add(size=0.3)
    source = bpy.context.active_object
    source.name = "inst_src"

    created = []
    for i in range(3):
        inst = bpy.data.objects.new(f"inst_copy_{i}", source.data)
        inst.location = (source.location.x + 0.5 * (i + 1), source.location.y, source.location.z)
        bpy.context.scene.collection.objects.link(inst)
        created.append(inst)

    names = [o.name for o in created]
    for o in created:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.objects.remove(source, do_unlink=True)
    return {"created": names}
