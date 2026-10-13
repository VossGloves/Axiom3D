# id: radial-array
# title: Radial/polar array for circular arrangements
# tags: radial, array, polar, circular, rotation, symmetry
# description: Arrange objects in a circle using rotation math. Reference technique — works for seating, columns, spiral stairs, radial structures.

import math

import bpy
from mathutils import Matrix


def run():
    # Create one seat (small box)
    bpy.ops.mesh.primitive_cube_add(size=0.5)
    seat = bpy.context.active_object
    seat.name = "seat_000"

    # Radial array: 8 copies around center
    count = 8
    radius = 3.0
    seats = [seat]
    for i in range(1, count):
        angle = (2 * math.pi * i) / count
        new = seat.copy()
        new.data = seat.data.copy()
        new.name = f"seat_{i:03d}"
        # Position on circle, rotate to face center
        new.location = (radius * math.cos(angle), radius * math.sin(angle), 0)
        new.rotation_euler = (0, 0, angle + math.pi / 2)
        bpy.context.scene.collection.objects.link(new)
        seats.append(new)

    total_verts = sum(len(s.data.vertices) for s in seats)
    for s in seats:
        bpy.data.objects.remove(s, do_unlink=True)
    return {"count": count, "total_verts": total_verts}
