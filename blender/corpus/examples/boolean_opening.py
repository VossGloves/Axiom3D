# id: boolean-opening
# title: Boolean difference for doors, windows, openings
# tags: boolean, opening, door, window, wall, cutout
# description: Cut openings in walls using Boolean DIFFERENCE. Reference technique — position cutter, apply modifier, delete cutter. EXACT solver for stability.

import bpy


def run():
    # Create a wall
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    wall = bpy.context.active_object
    wall.name = "wall"
    wall.scale = (4.0, 0.2, 2.5)  # 4m wide, 20cm thick, 2.5m tall
    bpy.ops.object.transform_apply(scale=True)

    # Create a door cutter (smaller box that punches through)
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    cutter = bpy.context.active_object
    cutter.name = "door_cutter"
    cutter.scale = (0.9, 0.3, 2.1)  # 90cm wide, 2.1m tall, over-thick
    cutter.location = (0, 0, 1.05)  # centered on wall, raised
    bpy.ops.object.transform_apply(scale=True, location=True)

    # Boolean cut: EXACT solver, DIFFERENCE operation
    mod = wall.modifiers.new("Boolean", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter

    # Apply
    deps = bpy.context.evaluated_depsgraph_get()
    ev = wall.evaluated_get(deps)
    baked = bpy.data.meshes.new_from_object(ev)
    wall.modifiers.clear()
    old = wall.data
    wall.data = baked
    if old.users == 0:
        bpy.data.meshes.remove(old)

    # Delete cutter
    bpy.data.objects.remove(cutter, do_unlink=True)

    verts = len(wall.data.vertices)
    bpy.data.objects.remove(wall, do_unlink=True)
    return {"verts": verts}
