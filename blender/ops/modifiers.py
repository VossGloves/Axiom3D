"""Modifier helpers — thin bpy wrappers for common geometry operations.

Each helper adds and configures a modifier, returns it. The agent calls
apply_all_modifiers(obj) when it wants real geometry for the gate/export.
Bevel defaults are tuned for architectural assets: small width, angle-limited
so only hard edges are rounded.
"""

import bpy


def add_bevel(obj, width=0.005, segments=2, angle_limit=0.7854, affect="EDGES"):
    """Bevel modifier — softens hard edges. Angle limit (radians) filters which
    edges get beveled; 0.7854 rad (45°) bevels only hard corners, not smooth curves.

    affect: 'EDGES' or 'VERTICES'. Width in meters — keep proportional to asset
    size (0.005 for furniture-scale, 0.02 for building-scale).
    """
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = angle_limit
    mod.affect = affect
    return mod


def add_array(obj, count=2, offset=(1.0, 0.0, 0.0), use_relative=True, relative_offset=(1.0, 0.0, 0.0)):
    """Array modifier — duplicates along offset. use_relative: offset is relative
    to object dimensions; else use offset as absolute meters."""
    mod = obj.modifiers.new("Array", "ARRAY")
    mod.count = count
    if use_relative:
        mod.use_relative_offset = True
        mod.relative_offset_displace = relative_offset
    else:
        mod.use_relative_offset = False
        mod.use_constant_offset = True
        mod.constant_offset_displace = offset
    return mod


def add_boolean(obj, cutter, operation="DIFFERENCE", solver="EXACT"):
    """Boolean modifier — cutter is the operand object. operation: DIFFERENCE,
    UNION, INTERSECT. Solver EXACT is stable headless; MANIFOLD can crash on
    multi-shell input."""
    mod = obj.modifiers.new("Boolean", "BOOLEAN")
    mod.operation = operation
    mod.solver = solver
    mod.object = cutter
    return mod


def add_solidify(obj, thickness=0.01):
    """Solidify modifier — gives thickness to an open surface (walls, shells)."""
    mod = obj.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = thickness
    return mod


def add_mirror(obj, axis=(True, False, False)):
    """Mirror modifier — mirrors across object origin. Set origin at the mirror
    plane before calling."""
    mod = obj.modifiers.new("Mirror", "MIRROR")
    mod.use_axis = axis
    return mod


def add_subsurf(obj, levels=1, render_levels=2):
    """Subdivision Surface modifier — smooths organic/rounded shapes. Keep levels
    low; gate has a poly budget."""
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = render_levels
    return mod


def apply_all_modifiers(obj):
    """Apply every modifier on obj, baking results into the mesh. Required before
    gate/export — the gate checks the evaluated mesh, but export bakes the base
    mesh unless modifiers are applied."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    baked = bpy.data.meshes.new_from_object(ev)
    obj.modifiers.clear()
    old = obj.data
    obj.data = baked
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return obj


def bevel_all_boxes(width=0.005, segments=2, only_boxes=True):
    """Add a bevel modifier to every mesh in the scene. only_boxes: skip objects
    with > 100 verts (likely already curved/detailed). Returns list of beveled names."""
    beveled = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if only_boxes and len(obj.data.vertices) > 100:
            continue
        if any(m.type == "BEVEL" for m in obj.modifiers):
            continue
        add_bevel(obj, width=width, segments=segments)
        beveled.append(obj.name)
    return beveled
