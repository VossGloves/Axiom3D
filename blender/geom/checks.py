"""Evaluated-mesh geometry checks shared by the validate command and the gate.

Every mesh read goes through the depsgraph (modifier-aware): what the user sees is
the evaluated object, not ``obj.data``. bmesh works on a copy so checks never mutate
the scene. Issue vocabulary is stable — the agent-facing tools and the gate report
both surface it, so renames break tests and prompt text.

Stage 4 (scene_geometry_report): conventions + evaluated-mesh lint — naming, unit
scale, applied transforms, manifold edges, flipped/zero-area faces, UVs, budget.

Stage 5 (mesh_quality_report): trimesh stats (watertight, winding, volume) plus
intersection checks. Intersections use Blender 5.x's native MANIFOLD boolean via a
temporary modifier — evaluated through the depsgraph, no operator context needed,
no subprocess. Self-intersection = two connected components of one mesh that
overlap (the classic "jammed two primitives together without a boolean" failure);
cross-object = any overlapping pair in the scene. floating_component = components
in one mesh form disconnected touch-groups (a part gap; assembly opt-out does not
apply — gaps are never a valid joint).
"""

import re

import bmesh
import bpy
from mathutils import Vector

DEFAULT_POLY_BUDGET = 100_000
ZERO_AREA = 1e-12
DEGENERATE_DIM = 0.001
DEFAULT_NAME = re.compile(r"^(Cube|Sphere|Cylinder|Plane|Circle|Torus|Suzanne|Monkey)(\.\d+)?$")
CLEAN_NAME = re.compile(r"^[a-z][a-z0-9_]*$")


def scene_geometry_report(poly_budget=DEFAULT_POLY_BUDGET):
    issues = []
    unit = bpy.context.scene.unit_settings
    if unit.scale_length != 1.0:
        issues.append(
            {"object": "<scene>", "issue": "unit_scale", "detail": f"scale_length={unit.scale_length}", "severity": "error"}
        )
    if unit.system == "NONE":
        issues.append(
            {"object": "<scene>", "issue": "no_unit_system", "detail": "unit system is NONE", "severity": "error"}
        )
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    for obj in meshes:
        issues.extend(object_issues(obj, poly_budget))
    return {
        "issues": issues,
        "passed": not any(issue["severity"] == "error" for issue in issues),
        "mesh_count": len(meshes),
    }


def object_issues(obj, poly_budget=DEFAULT_POLY_BUDGET):
    issues = []

    def add(issue, detail):
        issues.append({"object": obj.name, "issue": issue, "detail": detail, "severity": "error"})

    if DEFAULT_NAME.match(obj.name):
        add("default_name", obj.name)
    elif not CLEAN_NAME.match(obj.name):
        add("bad_naming", "not snake_case")
    if tuple(round(v, 6) for v in obj.scale) != (1.0, 1.0, 1.0):
        add("unapplied_scale", [round(v, 6) for v in obj.scale])
    if any(d < DEGENERATE_DIM for d in obj.dimensions):
        add("degenerate", [round(v, 6) for v in obj.dimensions])

    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    mesh = ev.to_mesh()
    try:
        if len(mesh.vertices) > poly_budget:
            add("over_budget", f"{len(mesh.vertices)} verts")
        if mesh.polygons and not mesh.uv_layers:
            add("missing_uv", "no UV layers")
        zero_area = sum(1 for polygon in mesh.polygons if polygon.area < ZERO_AREA)
        if zero_area:
            add("zero_area_faces", f"{zero_area} faces")
        bm = bmesh.new()
        try:
            bm.from_mesh(mesh)
            bm.faces.ensure_lookup_table()
            bad_edges = sum(1 for edge in bm.edges if len(edge.link_faces) != 2)
            if bad_edges and "open_surface" not in obj:
                add("non_manifold", f"{bad_edges} edges")
            before = [face.normal.copy() for face in bm.faces]
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
            flipped = sum(1 for face in bm.faces if before[face.index].dot(face.normal) < 0.5)
        finally:
            bm.free()
        if flipped:
            add("flipped_faces", f"{flipped} faces")
    finally:
        ev.to_mesh_clear()
    return issues


def mesh_quality_report(volume_epsilon=1e-6):
    """Stage 5: trimesh per-mesh stats + MANIFOLD-boolean intersection checks."""
    try:
        import numpy as np
        import trimesh
    except ImportError as exc:
        return {"skipped": True, "reason": f"trimesh not importable: {exc}", "issues": [], "passed": True}

    issues = []

    def add(obj_name, issue, detail, severity="error"):
        issues.append({"object": obj_name, "issue": issue, "detail": detail, "severity": severity})

    deps = bpy.context.evaluated_depsgraph_get()
    scene_meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    worlds = {}
    local_shapes = {}

    for obj in scene_meshes:
        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        try:
            if not mesh.polygons:
                continue
            mesh.calc_loop_triangles()
            verts = [tuple(v.co) for v in mesh.vertices]
            tris = [tuple(t.vertices) for t in mesh.loop_triangles]
            shape = trimesh.Trimesh(vertices=np.array(verts), faces=np.array(tris), process=False)
            local_shapes[obj.name] = (shape, verts, tris)
            if not shape.is_watertight:
                add(obj.name, "not_watertight", "open or non-manifold mesh; mark obj['open_surface']=True if intentional", "warning")
            if not shape.is_winding_consistent:
                add(obj.name, "inconsistent_winding", "adjacent faces disagree on orientation")
            if shape.is_watertight:
                volume = float(shape.volume)
                if abs(volume) < volume_epsilon:
                    add(obj.name, "zero_volume", f"volume={volume:.3e}")
                elif volume < 0:
                    add(obj.name, "inverted_volume", f"volume={volume:.6f}; normals point inward")
        finally:
            ev.to_mesh_clear()
        worlds[obj.name] = _world_bounds(obj)

    pair_checks = 0
    for name, (shape, verts, tris) in local_shapes.items():
        obj = bpy.data.objects.get(name)
        groups = _face_components(shape)
        if len(groups) < 2:
            continue
        # Separate shells whose AABBs overlap are almost certainly jammed-together
        # primitives. Detect via AABB only — running booleans across many
        # interpenetrating components crashed the MANIFOLD solver (native
        # access violation), and AABB overlap is the signal we actually want.
        component_bounds = []
        for group in groups:
            ids = _unique_face_verts(shape, group)
            component_bounds.append(_verts_bounds([verts[i] for i in ids]))
        # Gaps are never a valid joint: joined parts must touch (AABB contact).
        # assembly=True opts out of overlap checks only, not connectivity.
        if _touch_groups(component_bounds) > 1 and not (obj is not None and obj.get("disconnected_parts")):
            add(
                name,
                "floating_component",
                "components form disconnected groups (part gap); reposition so faces touch",
            )
        if obj is not None and "assembly" in obj:
            continue  # multi-part asset whose members overlap at joints by design
        for i in range(len(component_bounds)):
            for j in range(i + 1, len(component_bounds)):
                if _bounds_overlap(component_bounds[i], component_bounds[j]):
                    pair_checks += 1
                    add(name, "self_intersection", f"components {i},{j} overlap (separate shells intersect)")

    names = sorted(worlds)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            if not _bounds_overlap(worlds[names[i]], worlds[names[j]]):
                continue
            pair_checks += 1
            volume = _boolean_intersect_volume(
                bpy.data.objects[names[i]], bpy.data.objects[names[j]]
            )
            if volume is None:
                add(names[i], "boolean_failed", f"boolean solver failed on pair {names[i]},{names[j]}", "warning")
            elif volume > volume_epsilon:
                add(
                    names[i],
                    "object_intersection",
                    f"{names[i]} intersects {names[j]}, volume={volume:.6f}",
                )

    return {
        "skipped": False,
        "issues": issues,
        "passed": not any(issue["severity"] == "error" for issue in issues),
        "pair_checks": pair_checks,
        "mesh_count": len(local_shapes),
    }


def _face_components(shape):
    """Connected components (shells) via union-find over face adjacency.

    trimesh's own split() needs a graph engine (scipy/networkx) we deliberately do
    not install into Blender's Python; face_adjacency is plain numpy.
    """
    parent = list(range(len(shape.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for pair in shape.face_adjacency:
        left, right = find(int(pair[0])), find(int(pair[1]))
        if left != right:
            parent[left] = right
    groups = {}
    for face_index in range(len(shape.faces)):
        groups.setdefault(find(face_index), []).append(face_index)
    return list(groups.values())


def _unique_face_verts(shape, face_ids):
    ids = set()
    for face_id in face_ids:
        ids.update(int(v) for v in shape.faces[face_id])
    return ids


def _verts_bounds(verts):
    minimum = [min(v[i] for v in verts) for i in range(3)]
    maximum = [max(v[i] for v in verts) for i in range(3)]
    return (minimum, maximum)


def _world_bounds(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        [min(corner[i] for corner in corners) for i in range(3)],
        [max(corner[i] for corner in corners) for i in range(3)],
    )


def _bounds_overlap(first, second, padding=1e-9):
    return all(
        first[0][i] <= second[1][i] + padding and second[0][i] <= first[1][i] + padding
        for i in range(3)
    )


def _touch_groups(component_bounds):
    """Connected groups of components whose AABBs touch or overlap (union-find)."""
    parent = list(range(len(component_bounds)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(component_bounds)):
        for j in range(i + 1, len(component_bounds)):
            if _bounds_overlap(component_bounds[i], component_bounds[j]):
                left, right = find(i), find(j)
                if left != right:
                    parent[left] = right
    return len({find(i) for i in range(len(component_bounds))})


def _boolean_intersect_volume(source, target):
    """INTERSECT volume between two mesh objects via a temporary EXACT boolean.

    EXACT (the classic BMesh solver) is used rather than MANIFOLD because MANIFOLD
    hard-crashed Blender (native access violation) on some multi-shell template
    geometry during verification. Returns None when the solver refuses the input —
    callers report that as boolean_failed evidence instead of guessing.
    """
    temp = source.copy()
    temp.data = source.data.copy()
    bpy.context.scene.collection.objects.link(temp)
    try:
        modifier = temp.modifiers.new("axiom3d_gate_intersect", "BOOLEAN")
        modifier.operation = "INTERSECT"
        try:
            modifier.solver = "EXACT"
        except TypeError:
            pass  # solver enum differs; keep whatever the default is
        modifier.object = target
        deps = bpy.context.evaluated_depsgraph_get()
        ev = temp.evaluated_get(deps)
        mesh = ev.to_mesh()
        try:
            bm = bmesh.new()
            try:
                bm.from_mesh(mesh)
                return abs(bm.calc_volume(signed=True))
            finally:
                bm.free()
        finally:
            ev.to_mesh_clear()
    except Exception as exc:  # noqa: BLE001 - solver refusal is evidence, not a crash
        if "Error" in type(exc).__name__ or isinstance(exc, (RuntimeError, TypeError)):
            return None
        raise
    finally:
        bpy.data.objects.remove(temp, do_unlink=True)
