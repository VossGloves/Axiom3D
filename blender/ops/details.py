"""Detail-injection helpers — scatter small geometry on surfaces to add visual
density. These are reference techniques, not templates: adapt parameters and
detail types to the specific asset, don't blindly call with defaults.

Philosophy: real assets have small details (bolts, brackets, seams, handles).
These helpers place simple detail meshes at surface points so the agent can add
a detail pass without authoring each piece by hand.
"""

import math
import random

import bpy
from mathutils import Vector


def scatter_details(surface_obj, detail_type="cube", count=20, size_range=(0.01, 0.04),
                    name_prefix="detail", seed=42):
    """Scatter small detail meshes on surface_obj's faces.

    detail_type: 'cube' | 'cylinder' | 'sphere'. size_range: (min, max) edge length
    in meters. Returns list of detail objects. Surfaces with existing detail objects
    (name starts with name_prefix) are skipped to avoid double-scattering.
    """
    random.seed(seed)
    existing = [o for o in bpy.data.objects if o.name.startswith(name_prefix)]
    if existing:
        return existing

    deps = bpy.context.evaluated_depsgraph_get()
    ev = surface_obj.evaluated_get(deps)
    mesh = ev.to_mesh()
    details = []

    # Weight face selection by area so large faces get more details
    faces = list(mesh.polygons)
    if not faces:
        ev.to_mesh_clear()
        return details
    areas = [f.area for f in faces]
    total_area = sum(areas)

    for i in range(count):
        # Pick a face weighted by area
        r = random.uniform(0, total_area)
        cumulative = 0.0
        face = faces[-1]
        for f, a in zip(faces, areas):
            cumulative += a
            if cumulative >= r:
                face = f
                break

        # Random point on face (barycentric-ish via loop interpolation)
        loops = list(face.loop_indices)
        if len(loops) < 3:
            continue
        # Simple approach: average of loop verts + small jitter toward a random vert
        center = Vector((0, 0, 0))
        for li in loops:
            center += mesh.vertices[mesh.loops[li].vertex_index].co
        center /= len(loops)
        # Jitter toward a random corner
        target = mesh.vertices[mesh.loops[random.choice(loops)].vertex_index].co
        t = random.uniform(0.1, 0.4)
        pos = center.lerp(target, t)
        # Offset slightly along face normal
        pos += face.normal * random.uniform(0.001, 0.005)

        size = random.uniform(*size_range)
        detail = _make_detail(detail_type, size, name_prefix, i)
        detail.location = pos
        bpy.context.scene.collection.objects.link(detail)
        details.append(detail)

    ev.to_mesh_clear()
    return details


def _make_detail(detail_type, size, prefix, index):
    name = f"{prefix}_{index:03d}"
    if detail_type == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(radius=size / 2, depth=size, vertices=8)
        obj = bpy.context.active_object
    elif detail_type == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=size / 2, segments=8, ring_count=4)
        obj = bpy.context.active_object
    else:  # cube
        bpy.ops.mesh.primitive_cube_add(size=size)
        obj = bpy.context.active_object
    obj.name = name
    return obj


def scatter_edge_bolts(obj, spacing=0.15, radius=0.008, depth=0.012, name_prefix="bolt"):
    """Place small cylinders along obj's hard edges (edges where dihedral angle
    > 30°). Reference technique for industrial/mechanical assets: bolts, rivets,
    fasteners along structural edges."""
    existing = [o for o in bpy.data.objects if o.name.startswith(name_prefix)]
    if existing:
        return existing

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    mesh = ev.to_mesh()
    bolts = []
    bolt_index = 0

    # Find hard edges (angle between adjacent faces > 30°)
    mesh.calc_loop_triangles()
    edge_faces = {}
    for poly in mesh.polygons:
        for ei in poly.edge_keys:
            key = tuple(sorted(ei))
            edge_faces.setdefault(key, []).append(poly.index)

    hard_edges = []
    for (v0, v1), face_ids in edge_faces.items():
        if len(face_ids) != 2:
            continue
        n0 = mesh.polygons[face_ids[0]].normal
        n1 = mesh.polygons[face_ids[1]].normal
        if n0.angle(n1) > 0.5236:  # 30°
            hard_edges.append((v0, v1))

    for v0, v1 in hard_edges:
        p0 = mesh.vertices[v0].co
        p1 = mesh.vertices[v1].co
        length = (p1 - p0).length
        if length < spacing:
            continue
        num = int(length / spacing)
        for j in range(num):
            t = (j + 0.5) / num
            pos = p0.lerp(p1, t)
            bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=6)
            bolt = bpy.context.active_object
            bolt.name = f"{name_prefix}_{bolt_index:03d}"
            bolt.location = pos
            # Align to edge direction
            direction = (p1 - p0).normalized()
            bolt.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
            bpy.context.scene.collection.objects.link(bolt)
            bolts.append(bolt)
            bolt_index += 1

    ev.to_mesh_clear()
    return bolts


def add_panel_lines(obj, inset=0.02, depth=0.002, name_prefix="seam"):
    """Create thin recessed lines (seams) on obj's flat faces to suggest panel
    construction. Reference technique for vehicles, walls, metal cladding."""
    existing = [o for o in bpy.data.objects if o.name.startswith(name_prefix)]
    if existing:
        return existing

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    mesh = ev.to_mesh()
    seams = []

    # Find large flat faces (area > 0.05 m²)
    for poly in mesh.polygons:
        if poly.area < 0.05:
            continue
        center = poly.center
        normal = poly.normal
        # Create a thin box at the face center, oriented to the face
        bpy.ops.mesh.primitive_cube_add(size=1)
        seam = bpy.context.active_object
        seam.name = f"{name_prefix}_{len(seams):03d}"
        seam.scale = (inset * 2, inset * 2, depth)
        seam.location = center - normal * (depth * 0.5)
        seam.rotation_euler = normal.to_track_quat("Z", "Y").to_euler()
        bpy.context.scene.collection.objects.link(seam)
        seams.append(seam)

    ev.to_mesh_clear()
    return seams
