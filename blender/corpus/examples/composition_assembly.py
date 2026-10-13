# id: composition-assembly
# title: Compose multi-part assets from templates
# tags: composition, assembly, layout, multi-part, station, building
# description: Reference technique — instantiate templates, position with transforms, join into composite asset. Learn the pattern, adapt to your specific composition.

import bpy
from templates import instantiate


def run():
    # Compose a simple platform segment: platform slab + columns + canopy
    parts = []

    # Platform
    platform = instantiate("platform_outline", {"Width": 8.0, "Depth": 3.0, "Height": 0.9},
                           name="platform", material="concrete")
    parts.append(platform)

    # Columns at corners
    positions = [(-3.5, -1.0), (3.5, -1.0), (-3.5, 1.0), (3.5, 1.0)]
    for i, (x, y) in enumerate(positions):
        col = instantiate("column_grid", {"Height": 3.5, "Size": 0.2, "Count X": 1, "Count Y": 1},
                          name=f"col_{i}")
        col.location = (x, y, 0.9)  # on top of platform
        parts.append(col)

    # Canopy truss spanning columns
    canopy = instantiate("canopy_truss", {"Span": 7.0, "Depth": 0.8, "Bay": 1.5, "Member": 0.1},
                         name="canopy", material="steel")
    canopy.location = (0, 0, 4.4)  # above columns
    parts.append(canopy)

    # Join all parts into one object
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = "platform_segment"

    verts = len(joined.data.vertices)
    bpy.data.objects.remove(joined, do_unlink=True)
    return {"parts": 4, "verts": verts}
