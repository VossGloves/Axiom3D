# id: bevel-modifier
# title: Bevel hard edges for visual quality
# tags: bevel, modifier, edges, quality, hard-surface
# description: Add a Bevel modifier to soften hard edges. Reference technique — adapt width to asset scale, use angle limit to bevel only hard corners.

import bpy


def run():
    # Create a test cube
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.active_object
    obj.name = "bevel_test"

    # Add bevel: small width, angle-limited to hard edges only
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = 0.005  # 5mm — scale to your asset
    mod.segments = 2   # 2-3 segments looks good; more = smoother but heavier
    mod.limit_method = "ANGLE"
    mod.angle_limit = 0.7854  # 45° — only bevel sharp corners

    # Apply before gate/export
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
    return {"verts_before": 8, "verts_after": verts}
