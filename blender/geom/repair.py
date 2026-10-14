"""Conservative auto-repair: deterministic fixes for the stable issue vocabulary.

Fixers mutate ``obj.data`` (the base mesh), not the evaluated mesh — assets that
pass the gate bake to real geometry with no live modifiers, so base == evaluated
for assets this module targets. Scripts that leave live modifiers must bake first
(gate exec already did the work; repair runs after).

Respects the declared-intent opt-outs: objects with ``open_surface`` keep their
open boundaries, ``assembly`` members are never separated or booleaned. Design-level
issues (degenerate, over_budget, self/object intersections) are never auto-fixed —
they change design intent and are reported as skipped for the agent to resolve.

Issue codes here mirror geom/checks.py exactly; renames break the gate report
contract and the memory fix store.
"""

import re

import bmesh
import bpy
from mathutils import Matrix

from geom.checks import CLEAN_NAME, DEFAULT_NAME, ZERO_AREA

# remove_doubles distance for manifold/winding fixes. Meter-scale assets: 0.1mm.
MERGE_DIST = 1e-4


def repair_scene(issues_filter=None):
    """Fix every detectable issue in the scene. Returns (fixed, skipped) logs.

    ``issues_filter`` (optional list of issue codes) restricts which fixers run;
    None runs all. Mutates the scene — the caller (rpc.repair) snapshots first.
    """
    wanted = set(issues_filter) if issues_filter else None
    fixed, skipped = [], []
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        _repair_object(obj, wanted, fixed, skipped)
    _repair_scene_settings(wanted, fixed, skipped)
    return fixed, skipped


def _repair_object(obj, wanted, fixed, skipped):
    def wants(code):
        return wanted is None or code in wanted

    def log_fixed(code, action):
        fixed.append({"object": obj.name, "issue": code, "action": action})

    def log_skipped(code, reason):
        skipped.append({"object": obj.name, "issue": code, "reason": reason})

    if wants("default_name") and DEFAULT_NAME.match(obj.name):
        old = obj.name
        obj.name = _clean_unique(f"mesh_asset_{_scene_mesh_index(obj):02d}")
        log_fixed("default_name", f'renamed "{old}" to "{obj.name}"')
    if wants("bad_naming") and not DEFAULT_NAME.match(obj.name) and not CLEAN_NAME.match(obj.name):
        old = obj.name
        obj.name = _clean_unique(_normalize_name(old))
        log_fixed("bad_naming", f'renamed "{old}" to "{obj.name}"')

    if wants("unapplied_scale") and tuple(round(v, 6) for v in obj.scale) != (1.0, 1.0, 1.0):
        scale = obj.scale
        transform = Matrix.Identity(4)
        transform[0][0], transform[1][1], transform[2][2] = scale
        obj.data.transform(transform)
        obj.scale = (1.0, 1.0, 1.0)
        obj.data.update()
        log_fixed("unapplied_scale", f"applied scale {[round(v, 6) for v in scale]} to mesh data")

    if wants("missing_uv") and obj.data.polygons and not obj.data.uv_layers:
        from geom.uvs import ensure_box_uvs

        ensure_box_uvs(obj.data)
        log_fixed("missing_uv", "added box-projection UV layer")

    zero_area = wants("zero_area_faces") and any(p.area < ZERO_AREA for p in obj.data.polygons)
    # Winding/inverted/flipped share one recalc pass; non_manifold/not_watertight
    # merge duplicate verts first, then recalc.
    needs_recalc = wants("flipped_faces") or wants("inconsistent_winding") or wants("inverted_volume")
    merge_first = False
    if wants("non_manifold") and "open_surface" not in obj and _has_bad_edges(obj):
        merge_first = True
        needs_recalc = needs_recalc or wants("not_watertight")
    if wants("not_watertight") and "open_surface" not in obj:
        merge_first = True
        needs_recalc = True

    if zero_area or needs_recalc or merge_first:
        bm = bmesh.new()
        try:
            bm.from_mesh(obj.data)
            bm.faces.ensure_lookup_table()
            if zero_area:
                doomed = [f for f in bm.faces if f.calc_area() < ZERO_AREA]
                bmesh.ops.delete(bm, geom=doomed, context="FACES")
                log_fixed("zero_area_faces", f"deleted {len(doomed)} zero-area faces")
            if merge_first:
                # remove_doubles returns None in Blender 5.2; count via vert totals.
                before = len(bm.verts)
                bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=MERGE_DIST)
                log_fixed("non_manifold", f"merged {before - len(bm.verts)} duplicate verts (dist={MERGE_DIST:g})")
            if needs_recalc:
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
                codes = [c for c in ("flipped_faces", "inconsistent_winding", "inverted_volume") if wants(c)]
                log_fixed(codes[0] if codes else "flipped_faces", "recalculated face normals outward")
            bm.to_mesh(obj.data)
        finally:
            bm.free()
        obj.data.update()

    for code in ("degenerate", "over_budget"):
        if wants(code) and _detect_skipped(obj, code):
            log_skipped(code, "design-level issue; fix by editing the source script, not the mesh")
    if wanted is not None:
        for code in ("self_intersection", "object_intersection"):
            if code in wanted:
                log_skipped(code, "design-level issue; reposition or boolean the source geometry")


def _repair_scene_settings(wanted, fixed, skipped):
    def wants(code):
        return wanted is None or code in wanted

    unit = bpy.context.scene.unit_settings
    if wants("unit_scale") and unit.scale_length != 1.0:
        old = unit.scale_length
        unit.scale_length = 1.0
        fixed.append({"object": "<scene>", "issue": "unit_scale", "action": f"scale_length {old} -> 1.0"})
    if wants("no_unit_system") and unit.system == "NONE":
        unit.system = "METRIC"
        fixed.append({"object": "<scene>", "issue": "no_unit_system", "action": "unit system NONE -> METRIC"})


def _detect_skipped(obj, code):
    if code == "degenerate":
        return any(d < 0.001 for d in obj.dimensions)
    return len(obj.data.vertices) > 100_000


def _has_bad_edges(obj):
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        return any(len(edge.link_faces) != 2 for edge in bm.edges)
    finally:
        bm.free()


def _normalize_name(raw):
    token = re.sub(r"[^a-z0-9]+", "_", raw.lower()).strip("_")
    token = re.sub(r"_+", "_", token)
    if not token or not token[0].isalpha():
        token = "mesh_" + token
    return token


def _clean_unique(base):
    if base not in bpy.data.objects:
        return base
    n = 2
    while f"{base}_{n:02d}" in bpy.data.objects:
        n += 1
    return f"{base}_{n:02d}"


def _scene_mesh_index(obj):
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    return meshes.index(obj) + 1 if obj in meshes else 1
