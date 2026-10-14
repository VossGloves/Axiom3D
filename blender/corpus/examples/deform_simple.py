# id: deform-simple
# title: Bend / twist / taper with SimpleDeform
# tags: deform, bend, twist, taper, modifier, organic
# description: Add a SimpleDeform modifier to bend/twist/taper geometry. Reference technique — adapt angle/factor and axis to your asset; apply before gate/export.

import bpy


def run():
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.active_object
    obj.name = "deform_test"

    mod = obj.modifiers.new("Deform", "SIMPLE_DEFORM")
    mod.deform_method = "BEND"
    mod.deform_axis = "Z"
    mod.angle = 1.0  # radians

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
