# id: detail-scatter
# title: Scatter small details on surfaces (bolts, brackets, seams)
# tags: detail, scatter, bolts, density, surface, props
# description: Reference technique — place small geometry at surface points to add visual density. Adapt detail types to asset domain (bolts for industrial, books for library).

import random

import bpy
from mathutils import Vector


def run():
    # Create a surface to scatter on
    bpy.ops.mesh.primitive_cube_add(size=2.0)
    surface = bpy.context.active_object
    surface.name = "panel"

    deps = bpy.context.evaluated_depsgraph_get()
    ev = surface.evaluated_get(deps)
    mesh = ev.to_mesh()

    random.seed(42)
    details = []
    faces = list(mesh.polygons)
    areas = [f.area for f in faces]
    total_area = sum(areas)

    for i in range(15):
        # Pick face weighted by area
        r = random.uniform(0, total_area)
        cumulative = 0.0
        face = faces[-1]
        for f, a in zip(faces, areas):
            cumulative += a
            if cumulative >= r:
                face = f
                break

        # Random point on face
        loops = list(face.loop_indices)
        center = Vector((0, 0, 0))
        for li in loops:
            center += mesh.vertices[mesh.loops[li].vertex_index].co
        center /= len(loops)
        target = mesh.vertices[mesh.loops[random.choice(loops)].vertex_index].co
        pos = center.lerp(target, random.uniform(0.1, 0.4))
        pos += face.normal * 0.003  # offset outward

        # Small bolt (cylinder)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=0.012, vertices=6)
        bolt = bpy.context.active_object
        bolt.name = f"bolt_{i:03d}"
        bolt.location = pos
        bpy.context.scene.collection.objects.link(bolt)
        details.append(bolt)

    ev.to_mesh_clear()
    count = len(details)
    for d in details:
        bpy.data.objects.remove(d, do_unlink=True)
    bpy.data.objects.remove(surface, do_unlink=True)
    return {"details_placed": count}
