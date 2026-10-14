# id: composition-assembly
# title: Compose multi-part assets from primitives
# tags: composition, assembly, layout, multi-part, building
# description: Reference technique — build parts with primitives/booleans, position with transforms, join into a composite asset. Learn the pattern, adapt to your specific composition.

import bpy


def run():
    # Compose a simple table-like asset: top slab + 4 legs
    parts = []

    # Top slab
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.75))
    top = bpy.context.active_object
    top.name = "table_top"
    top.scale = (1.2, 0.7, 0.04)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    parts.append(top)

    # Legs at corners
    positions = [(-0.55, -0.3), (0.55, -0.3), (-0.55, 0.3), (0.55, 0.3)]
    for i, (x, y) in enumerate(positions):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x, y, 0.36))
        leg = bpy.context.active_object
        leg.name = f"leg_{i}"
        leg.scale = (0.05, 0.05, 0.36)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        parts.append(leg)

    # Join all parts into one object
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = "table"

    verts = len(joined.data.vertices)
    bpy.data.objects.remove(joined, do_unlink=True)
    return {"parts": 5, "verts": verts}
