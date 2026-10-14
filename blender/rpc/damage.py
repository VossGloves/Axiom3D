"""Damage/weathering commands: edge chips, cracks, wear, surface noise.

apply_damage runs a non-destructive damage pass on a target mesh. Strategies:
- edge_wear: randomize edge bevel widths for worn look
- chips: boolean-subtract random small cubes from edges/faces
- cracks: boolean-subtract thin elongated boxes
- surface_noise: displacement modifier with clouds texture
- dents: boolean-subtract spheres from surfaces

All strategies preserve manifold where possible; gate re-checks after.
"""

import random

import bmesh
import bpy

from materials import get_material
from rpc.base import WorkerError, call_op


def _get_target(name):
    obj = bpy.data.objects.get(name)
    if not obj or obj.type != "MESH":
        raise WorkerError("NotFound", f"target mesh not found: {name!r}")
    return obj


def cmd_edge_wear(params):
    """Randomize bevel widths on hard edges for a worn look."""
    name = params.get("name")
    intensity = params.get("intensity", 0.5)  # 0-1, scales width variation
    base_width = params.get("base_width", 0.005)
    seed = int(params.get("seed", 42))

    obj = _get_target(name)
    random.seed(seed)

    # Add bevel modifier with angle limit; randomize width slightly per object
    # (single object: one width; for multi-object wear, call per object)
    existing = next((m for m in obj.modifiers if m.type == "BEVEL"), None)
    if existing:
        mod = existing
    else:
        mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = base_width * (1.0 + random.uniform(-0.3, 0.3) * intensity)
    mod.segments = int(params.get("segments", 2))
    mod.limit_method = "ANGLE"
    mod.angle_limit = float(params.get("angle_limit", 0.7854))

    return {
        "name": obj.name,
        "strategy": "edge_wear",
        "width": round(mod.width, 6),
        "segments": mod.segments,
        "intensity": intensity,
    }


def cmd_chips(params):
    """Boolean-subtract small random cubes from edges/faces for chipped look."""
    name = params.get("name")
    count = int(params.get("count", 8))
    size_range = params.get("size_range", (0.01, 0.05))
    seed = int(params.get("seed", 42))
    apply = params.get("apply", True)

    obj = _get_target(name)
    random.seed(seed)

    # Find boundary edges + face centers for chip placement
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    boundary_verts = set()
    for e in bm.edges:
        if e.is_boundary:
            boundary_verts.add(e.verts[0].index)
            boundary_verts.add(e.verts[1].index)

    positions = []
    # Edge midpoints
    for e in bm.edges:
        if e.is_boundary or random.random() < 0.3:
            mid = (e.verts[0].co + e.verts[1].co) / 2
            positions.append(mid.copy())
    # Random face centers
    for f in bm.faces:
        if random.random() < 0.4:
            positions.append(f.calc_center_median().copy())
    bm.free()

    random.shuffle(positions)
    positions = positions[:count]

    cutters = []
    for i, pos in enumerate(positions):
        size = random.uniform(*size_range)
        bpy.ops.mesh.primitive_cube_add(size=size, location=pos)
        cutter = bpy.context.active_object
        cutter.name = f"chip_cutter_{i:03d}"
        cutter.rotation_euler = (
            random.uniform(0, 3.14),
            random.uniform(0, 3.14),
            random.uniform(0, 3.14),
        )
        cutters.append(cutter)

    # Boolean subtract each cutter
    applied = 0
    for cutter in cutters:
        mod = obj.modifiers.new("ChipBool", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.object = cutter
        if apply:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            try:
                call_op(bpy.ops.object.modifier_apply, modifier=mod.name)
                bpy.data.objects.remove(cutter, do_unlink=True)
                applied += 1
            except Exception:
                # Skip failed cutter, leave modifier for inspection
                pass

    return {
        "name": obj.name,
        "strategy": "chips",
        "cutters_created": len(cutters),
        "cutters_applied": applied,
        "verts_after": len(obj.data.vertices),
        "polys_after": len(obj.data.polygons),
    }


def cmd_cracks(params):
    """Boolean-subtract thin elongated boxes for crack lines."""
    name = params.get("name")
    count = int(params.get("count", 3))
    length_range = params.get("length_range", (0.1, 0.5))
    width = params.get("width", 0.003)
    depth = params.get("depth", 0.02)
    seed = int(params.get("seed", 42))
    apply = params.get("apply", True)

    obj = _get_target(name)
    random.seed(seed)

    # Place cracks on large faces
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    large_faces = [f for f in bm.faces if f.calc_area() > 0.01]
    random.shuffle(large_faces)
    targets = large_faces[:count]
    positions = [(f.calc_center_median().copy(), f.normal.copy()) for f in targets]
    bm.free()

    applied = 0
    for i, (pos, normal) in enumerate(positions):
        length = random.uniform(*length_range)
        bpy.ops.mesh.primitive_cube_add(size=1, location=pos - normal * (depth * 0.4))
        cutter = bpy.context.active_object
        cutter.name = f"crack_cutter_{i:03d}"
        cutter.scale = (length / 2, width / 2, depth / 2)
        # Align Z to face normal, random Y rotation for crack direction
        cutter.rotation_euler = normal.to_track_quat("Z", "Y").to_euler()
        cutter.rotation_euler.z += random.uniform(0, 3.14)

        mod = obj.modifiers.new("CrackBool", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.object = cutter
        if apply:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            try:
                call_op(bpy.ops.object.modifier_apply, modifier=mod.name)
                bpy.data.objects.remove(cutter, do_unlink=True)
                applied += 1
            except Exception:
                pass

    return {
        "name": obj.name,
        "strategy": "cracks",
        "cracks_attempted": len(positions),
        "cracks_applied": applied,
        "verts_after": len(obj.data.vertices),
    }


def cmd_surface_noise(params):
    """Displacement modifier with clouds texture for rough/weathered surface."""
    name = params.get("name")
    strength = params.get("strength", 0.005)
    scale = params.get("scale", 0.1)
    noise_depth = int(params.get("noise_depth", 2))
    seed = int(params.get("seed", 42))

    obj = _get_target(name)

    # Create clouds texture
    tex_name = f"damage_noise_{name}"
    tex = bpy.data.textures.get(tex_name)
    if not tex:
        tex = bpy.data.textures.new(tex_name, type="CLOUDS")
    tex.noise_scale = scale
    tex.noise_depth = noise_depth

    # Add or update displace modifier
    existing = next((m for m in obj.modifiers if m.type == "DISPLACE" and m.texture == tex), None)
    if existing:
        mod = existing
    else:
        mod = obj.modifiers.new("DamageDisplace", "DISPLACE")
    mod.texture = tex
    mod.strength = strength
    mod.mid_level = 0.5
    mod.texture_coords = "LOCAL"

    return {
        "name": obj.name,
        "strategy": "surface_noise",
        "strength": strength,
        "scale": scale,
        "texture": tex_name,
    }


def cmd_dents(params):
    """Boolean-subtract random spheres from surface for dent damage."""
    name = params.get("name")
    count = int(params.get("count", 5))
    radius_range = params.get("radius_range", (0.02, 0.08))
    seed = int(params.get("seed", 42))
    apply = params.get("apply", True)

    obj = _get_target(name)
    random.seed(seed)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    faces = list(bm.faces)
    random.shuffle(faces)
    targets = faces[:count]
    positions = [f.calc_center_median().copy() for f in targets]
    bm.free()

    applied = 0
    for i, pos in enumerate(positions):
        radius = random.uniform(*radius_range)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=12, ring_count=8, location=pos)
        cutter = bpy.context.active_object
        cutter.name = f"dent_cutter_{i:03d}"

        mod = obj.modifiers.new("DentBool", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.object = cutter
        if apply:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            try:
                call_op(bpy.ops.object.modifier_apply, modifier=mod.name)
                bpy.data.objects.remove(cutter, do_unlink=True)
                applied += 1
            except Exception:
                pass

    return {
        "name": obj.name,
        "strategy": "dents",
        "dents_attempted": len(positions),
        "dents_applied": applied,
        "verts_after": len(obj.data.vertices),
    }


STRATEGIES = {
    "edge_wear": cmd_edge_wear,
    "chips": cmd_chips,
    "cracks": cmd_cracks,
    "surface_noise": cmd_surface_noise,
    "dents": cmd_dents,
}


def cmd_apply_damage(params):
    """Dispatch to a named damage strategy."""
    strategy = params.get("strategy")
    if not strategy:
        raise WorkerError(
            "BadRequest",
            f"apply_damage requires params.strategy; available: {sorted(STRATEGIES)}",
        )
    handler = STRATEGIES.get(strategy)
    if not handler:
        raise WorkerError("BadRequest", f"unknown strategy: {strategy!r}; available: {sorted(STRATEGIES)}")
    return handler(params)
