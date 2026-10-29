"""SDF build command: JSON spec -> libfive implicit field -> mesh object.

Organic modeling kit for the worker: smooth CSG (blend union/difference/
intersection), shell, and warps (twirl/taper/attract/repel/symmetry), meshed by
libfive marching cubes instead of mesh booleans. libfive is vendored under
MPL-2.0 via ./blender/install-libfive.sh (see blender/vendor/libfive NOTICE);
FieldForge's GPL-3.0 addon code is never imported or copied.

Spec is a recursive node dict:

  {"kind":"primitive","shape":"sphere|box|rounded_box|cylinder|cone|torus",
   "params":{...},"location":[x,y,z],"rotation_deg":[x,y,z],"scale":[x,y,z]}
  {"kind":"csg","op":"union|difference|intersection","blend":0.0,"children":[...]}
  {"kind":"shell","offset":0.05,"child":{...}}
  {"kind":"twirl","axis":"x|y|z","amount_deg":90,"radius":1,"center":[0,0,0],"child":{...}}
  {"kind":"taper","base":[0,0,0],"height":1,"scale":0.5,"base_scale":1,"child":{...}}
  {"kind":"attract"|"repel","locus":[0,0,0],"radius":0.5,"exaggerate":1,
   "axes":"xyz|x|y|z|xy|xz|yz","child":{...}}
  {"kind":"symmetry","axis":"x|y|z","blend":0.0,"child":{...}}

`blend`/`offset`/`radius` are meters; node transforms apply after the node's own
content while children keep their own. Bounds auto-derive from the spec AABB
(blend + pad) unless bounds_min/bounds_min are given explicitly.

Organic composition rules (all future organic assets):
- Canopy/clump masses: smooth-union 8-12 varied spheres, blend 0.05-0.10m max;
  blend > 0.15 collapses clumps into one ball.
- Limbs/trunk/stems: cone primitive + taper node (base_scale 2-3x), min radius
  0.02m so marching cubes samples them at the resolution floor.
- Post-pass after build: blender-damage surface_noise + blender-modify displace
  for surface breakup; blender-material for color/roughness.
- Span > 4m: build in 2-3 chunks (base, body, detail) so per-chunk resolution
  stays high; single-shot large spans hit the cell cap and lose thin features.
"""

import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

from geom.checks import DEFAULT_POLY_BUDGET
from rpc.base import WorkerError
from rpc.primitives import _finish

_VENDOR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vendor")
_SDF_SRC = os.path.join(_VENDOR, "libfive", "src")
_INSTALL_HINT = "./blender/install-libfive.sh"
_BLEND_EPS = 1e-6
_MIN_DIM = 0.05
_MAX_CELLS = 1024
_MIN_RES = 16
_THIN_SPAN = 0.1
_CLIP_TOL = 1e-4
_KINDS = "primitive, csg, shell, twirl, taper, attract, repel, symmetry"

lf = None
_import_error = None
if not os.path.isdir(_SDF_SRC):
    _import_error = f"libfive not installed (missing {_SDF_SRC}); run {_INSTALL_HINT}"
else:
    if _VENDOR not in sys.path:
        sys.path.insert(0, _VENDOR)
    # libfive.ffi resolves the .so files through this env var at first import,
    # so it must be set before `import libfive.stdlib` executes.
    os.environ.setdefault("LIBFIVE_FRAMEWORK_DIR", _SDF_SRC)
    try:
        import libfive.stdlib as lf
    except Exception as exc:
        _import_error = f"libfive import failed: {exc}; reinstall via {_INSTALL_HINT}"


def cmd_sdf_status(params):
    return {"available": lf is not None, "error": _import_error, "install": _INSTALL_HINT}


def cmd_sdf_build(params):
    lib = _require_libfive()
    spec = params.get("spec")
    if isinstance(spec, str):
        try:
            spec = json.loads(spec)
        except json.JSONDecodeError as exc:
            raise WorkerError("BadRequest", f"spec is not valid JSON: {exc}") from exc
    if not isinstance(spec, dict):
        raise WorkerError("BadRequest", "params.spec must be a spec node dict, or a JSON string of one")

    if ("bounds_min" in params) != ("bounds_max" in params):
        raise WorkerError("BadRequest", "bounds_min and bounds_max must be given together (or both omitted)")
    name = str(params.get("name", "sdf_shape"))
    material = params.get("material")
    resolution = max(4, min(int(params.get("resolution", 32)), 512))

    state = {"blend": 0.0}
    shape, box = _build(lib, spec, state)
    if params.get("bounds_min") is not None:
        bounds_min = [max(v, -1e6) for v in _vec3(params.get("bounds_min"))]
        bounds_max = [min(v, 1e6) for v in _vec3(params.get("bounds_max"))]
        if any(bounds_max[i] <= bounds_min[i] for i in range(3)):
            raise WorkerError("BadRequest", f"bounds_max must exceed bounds_min per axis, got {bounds_min} -> {bounds_max}")
    else:
        # smooth blends bulge up to ~1.5x the blend distance past the plain union
        pad = 0.05 + 1.5 * state["blend"]
        bounds_min = [box[0][i] - pad for i in range(3)]
        bounds_max = [box[1][i] + pad for i in range(3)]
    for axis in range(3):
        span = bounds_max[axis] - bounds_min[axis]
        if span < _MIN_DIM:
            mid = (bounds_max[axis] + bounds_min[axis]) / 2
            bounds_min[axis] = mid - _MIN_DIM / 2
            bounds_max[axis] = mid + _MIN_DIM / 2

    max_span = max(bounds_max[i] - bounds_min[i] for i in range(3))
    min_span = min(bounds_max[i] - bounds_min[i] for i in range(3))
    used_res = float(resolution)
    # Per-axis cell cap: a tall/thin asset (tree, limb, stem) must not spend its
    # whole budget on the long axis; the thin axis drives detail survival.
    if max_span * used_res > _MAX_CELLS:
        used_res = _MAX_CELLS / max_span
    # Thin features (veins, twigs, bark ridges) vanish below the floor even at
    # small spans; bump resolution so a 0.02m branch survives marching cubes.
    # Use <= to include the _MIN_DIM-clamped case (span exactly _MIN_DIM).
    if min_span <= _THIN_SPAN:
        used_res = min(max(used_res, _MAX_CELLS / max(min_span, 1e-3)), 512.0)
    if used_res < 4:
        raise WorkerError(
            "BadRequest",
            f"bounds span {max_span:.3f}m needs more than {_MAX_CELLS} cells even at the 4 cells/m floor; "
            "shrink bounds_min/bounds_max, model at smaller scale, or build in smaller chunks",
        )

    verts, tris, used_res, flags, bounds_used = _mesh(lib, shape, bounds_min, bounds_max, used_res, DEFAULT_POLY_BUDGET)
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(verts))
    mesh.loops.add(len(tris) * 3)
    mesh.polygons.add(len(tris))
    mesh.vertices.foreach_set("co", [coord for vert in verts for coord in vert])
    mesh.loops.foreach_set("vertex_index", [idx for tri in tris for idx in tri])
    mesh.polygons.foreach_set("loop_start", range(0, len(tris) * 3, 3))
    mesh.polygons.foreach_set("loop_total", [3] * len(tris))
    mesh.polygons.foreach_set("use_smooth", [True] * len(tris))
    mesh.update()
    # marching cubes can emit inconsistent winding on some fields; normalize
    _recalc_normals(mesh)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    result = _finish(obj, name, material)
    result["resolution"] = round(used_res, 3)
    result["bounds_min"] = [round(v, 6) for v in bounds_used[0]]
    result["bounds_max"] = [round(v, 6) for v in bounds_used[1]]
    result.update(flags)
    return result


def _require_libfive():
    if lf is None:
        raise WorkerError("SdfUnavailable", _import_error or "libfive unavailable")
    return lf


def _mesh(lib, shape, bounds_min, bounds_max, resolution, budget):
    """Mesh at `resolution`, expanding once when the surface touches the bounds
    face (geometry clipped) and halving resolution until under the vertex budget.
    Returns (verts, tris, resolution_used, flags, bounds_used)."""
    flags = {}
    box = (list(bounds_min), list(bounds_max))
    data = shape.get_mesh(xyz_min=tuple(box[0]), xyz_max=tuple(box[1]), resolution=resolution)
    if not _real(data):
        raise WorkerError(
            "EmptyMesh",
            f"SDF field produced no surface inside bounds {bounds_min} -> {bounds_max} at "
            f"{resolution:.0f} cells/m; spec may be empty, fully subtracted, or far from the bounds",
        )
    if _clipped(data[0], box):
        span = [box[1][i] - box[0][i] for i in range(3)]
        wide = (
            [box[0][i] - max(0.25 * span[i], _MIN_DIM) for i in range(3)],
            [box[1][i] + max(0.25 * span[i], _MIN_DIM) for i in range(3)],
        )
        retry = shape.get_mesh(xyz_min=tuple(wide[0]), xyz_max=tuple(wide[1]), resolution=resolution)
        if _real(retry):
            data, box = retry, wide
            flags["bounds_expanded"] = True
        if _clipped(data[0], box):
            # explicit user bounds may intentionally cut the field — warn, don't fail
            flags["bounds_clipped"] = True
    while len(data[0]) > budget and resolution > _MIN_RES:
        resolution /= 2
        data = shape.get_mesh(xyz_min=tuple(box[0]), xyz_max=tuple(box[1]), resolution=resolution)
        flags["resolution_reduced"] = True
        if not _real(data):
            raise WorkerError("EmptyMesh", "SDF field produced no surface while lowering resolution")
    if len(data[0]) > budget:
        raise WorkerError(
            "OverBudget",
            f"{len(data[0])} verts at {resolution:.0f} cells/m still exceeds the {budget} vertex budget; "
            "simplify the spec, build in smaller chunks, or lower params.resolution",
        )
    return data[0], data[1], resolution, flags, (box[0], box[1])


def _real(data):
    # empty fields come back as degenerate 1-vert junk, not an empty list
    return bool(data) and len(data[0]) >= 4 and len(data[1]) >= 4


def _recalc_normals(mesh):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def _clipped(verts, box):
    for vert in verts:
        for axis in range(3):
            if vert[axis] <= box[0][axis] + _CLIP_TOL or vert[axis] >= box[1][axis] - _CLIP_TOL:
                return True
    return False


def _build(lib, node, state, depth=0):
    if depth > 32:
        raise WorkerError("BadRequest", "spec nesting deeper than 32 levels")
    if not isinstance(node, dict):
        raise WorkerError("BadRequest", f"spec nodes must be dicts, got {type(node).__name__}")

    kind = node.get("kind")
    if kind == "primitive":
        return _finish_node(node, *_primitive(lib, node))
    if kind == "csg":
        return _finish_node(node, *_csg(lib, node, state, depth))
    if kind in ("shell", "twirl", "taper", "attract", "repel", "symmetry"):
        child_node = node.get("child")
        if not isinstance(child_node, dict):
            raise WorkerError("BadRequest", f"{kind} requires params.child (a spec node)")
        child, child_box = _build(lib, child_node, state, depth + 1)
        return _finish_node(node, *_modify(lib, node, kind, child, child_box, state))
    raise WorkerError("BadRequest", f"unknown spec kind {kind!r}; available: {_KINDS}")


def _csg(lib, node, state, depth):
    children = node.get("children")
    if not isinstance(children, list) or len(children) < 2:
        raise WorkerError("BadRequest", "csg requires params.children with at least 2 nodes")
    op = str(node.get("op", "union")).lower()
    if op not in ("union", "difference", "intersection", "intersect"):
        raise WorkerError("BadRequest", f"csg op must be union|difference|intersection, got {op!r}")
    blend = max(0.0, float(node.get("blend", 0.0)))
    if blend > _BLEND_EPS:
        state["blend"] = max(state["blend"], blend)

    shape, box = _build(lib, children[0], state, depth + 1)
    for child_node in children[1:]:
        other, other_box = _build(lib, child_node, state, depth + 1)
        if op == "difference":
            shape = lib.blend_difference(shape, other, blend) if blend > _BLEND_EPS else lib.difference(shape, other)
        elif op in ("intersection", "intersect"):
            # smooth intersection = complement of the smooth union of complements
            shape = (
                lib.inverse(lib.blend_expt_unit(lib.inverse(shape), lib.inverse(other), blend))
                if blend > _BLEND_EPS
                else lib.intersection(shape, other)
            )
        else:
            shape = lib.blend_expt_unit(shape, other, blend) if blend > _BLEND_EPS else lib.union(shape, other)
        box = _union_box(box, other_box)
    return shape, box


def _modify(lib, node, kind, child, child_box, state):
    if kind == "shell":
        offset = float(node.get("offset", 0.05))
        pad = abs(offset)
        return lib.shell(child, offset), (
            (child_box[0][0] - pad, child_box[0][1] - pad, child_box[0][2] - pad),
            (child_box[1][0] + pad, child_box[1][1] + pad, child_box[1][2] + pad),
        )
    if kind == "twirl":
        axis = str(node.get("axis", "z")).lower()
        if axis not in ("x", "y", "z"):
            raise WorkerError("BadRequest", f"twirl axis must be x|y|z, got {axis!r}")
        amount = math.radians(float(node.get("amount_deg", 90.0)))
        radius = max(1e-4, float(node.get("radius", 1.0)))
        center = _vec3(node.get("center"))
        # twirl only rotates around the axis: radial extent is preserved
        return getattr(lib, f"twirl_axis_{axis}")(child, amount, radius, center), child_box
    if kind == "taper":
        base = _vec3(node.get("base"))
        height = max(1e-4, float(node.get("height", 1.0)))
        scale = float(node.get("scale", 0.5))
        base_scale = float(node.get("base_scale", 1.0))
        growth = max(1.0, abs(scale), abs(base_scale))
        (mn, mx) = child_box
        return lib.taper_xy_z(child, base, height, scale, base_scale), (
            (base[0] + (mn[0] - base[0]) * growth, base[1] + (mn[1] - base[1]) * growth, mn[2]),
            (base[0] + (mx[0] - base[0]) * growth, base[1] + (mx[1] - base[1]) * growth, mx[2]),
        )
    if kind in ("attract", "repel"):
        axes = str(node.get("axes", "xyz")).lower()
        if axes not in ("xyz", "x", "y", "z", "xy", "xz", "yz"):
            raise WorkerError("BadRequest", f"{kind} axes must be xyz|x|y|z|xy|xz|yz, got {axes!r}")
        locus = _vec3(node.get("locus"))
        radius = max(1e-4, float(node.get("radius", 0.5)))
        exaggerate = max(0.0, float(node.get("exaggerate", 1.0)))
        fn = getattr(lib, kind if axes == "xyz" else f"{kind}_{axes}")
        # warp displaces points only inside `radius`; pad worst-case, the clip
        # check in _mesh is the ground truth for residual underestimates
        pad = radius * (1.0 + min(exaggerate, 3.0))
        (mn, mx) = child_box
        return fn(child, locus, radius, exaggerate), (
            (mn[0] - pad, mn[1] - pad, mn[2] - pad),
            (mx[0] + pad, mx[1] + pad, mx[2] + pad),
        )
    axis = str(node.get("axis", "z")).lower()
    if axis not in ("x", "y", "z"):
        raise WorkerError("BadRequest", f"symmetry axis must be x|y|z, got {axis!r}")
    blend = max(0.0, float(node.get("blend", 0.0)))
    if blend > _BLEND_EPS:
        state["blend"] = max(state["blend"], blend)
        shape = lib.blend_expt_unit(child, getattr(lib, f"reflect_{axis}")(child), blend)
    else:
        shape = getattr(lib, f"symmetric_{axis}")(child)
    mirrored = list(child_box[0]), list(child_box[1])
    i = "xyz".index(axis)
    lo, hi = child_box[0][i], child_box[1][i]
    mirrored[0][i], mirrored[1][i] = -hi, -lo
    return shape, _union_box(child_box, mirrored)


def _primitive(lib, node):
    p = node.get("params") or {}
    shape = node.get("shape")
    if shape == "sphere":
        r = float(p.get("radius", 0.5))
        if r <= 0:
            raise WorkerError("BadRequest", "sphere radius must be > 0")
        return lib.sphere(r), ((-r, -r, -r), (r, r, r))
    if shape == "box":
        size = _vec3(p.get("size"), (1.0, 1.0, 1.0))
        if any(s <= 0 for s in size):
            raise WorkerError("BadRequest", f"box size components must be > 0, got {size}")
        half = [s / 2 for s in size]
        return lib.box_exact_centered(size), (
            (-half[0], -half[1], -half[2]),
            (half[0], half[1], half[2]),
        )
    if shape == "rounded_box":
        size = _vec3(p.get("size"), (1.0, 1.0, 1.0))
        if any(s <= 0 for s in size):
            raise WorkerError("BadRequest", f"rounded_box size components must be > 0, got {size}")
        half = [s / 2 for s in size]
        box = ((-half[0], -half[1], -half[2]), (half[0], half[1], half[2]))
        r = min(max(float(p.get("radius", 0.05)), 0.0), min(half))
        if r <= 1e-5:
            return lib.box_exact_centered(size), box
        return lib.rounded_box(box[0], box[1], r), box
    if shape == "cylinder":
        r = float(p.get("radius", 0.5))
        h = float(p.get("depth", 1.0))
        if r <= 0 or h <= 0:
            raise WorkerError("BadRequest", "cylinder radius and depth must be > 0")
        half_h = h / 2
        return lib.cylinder_z(r, h, base=(0, 0, -half_h)), ((-r, -r, -half_h), (r, r, half_h))
    if shape == "cone":
        r = float(p.get("radius1", 0.5))
        tip = float(p.get("radius2", 0.0))
        h = float(p.get("depth", 1.0))
        if tip > 1e-6:
            raise WorkerError("BadRequest", "cone radius2 > 0 (truncated cone) unsupported; cut a cone with a csg half-space instead")
        if r <= 0 or h <= 0:
            raise WorkerError("BadRequest", "cone radius1 and depth must be > 0")
        half_h = h / 2
        return lib.cone_z(r, h, base=(0, 0, -half_h)), ((-r, -r, -half_h), (r, r, half_h))
    if shape == "torus":
        major = float(p.get("major_radius", 1.0))
        minor = float(p.get("minor_radius", 0.25))
        if major <= minor:
            raise WorkerError("BadRequest", f"torus major_radius ({major}) must exceed minor_radius ({minor})")
        outer, inner = major + minor, major - minor
        return lib.torus_z(outer, inner), ((-outer, -outer, -minor), (outer, outer, minor))
    raise WorkerError(
        "BadRequest",
        f"unknown primitive shape {shape!r}; available: sphere, box, rounded_box, cylinder, cone, torus",
    )


def _finish_node(node, shape, box):
    loc = node.get("location")
    rot = node.get("rotation_deg")
    scl = node.get("scale")
    if loc is None and rot is None and scl is None:
        return shape, box
    matrix = _node_matrix(node)
    if matrix == Matrix.Identity(4):
        return shape, box
    return _to_world(shape, matrix), _move_box(box, matrix)


def _node_matrix(node):
    loc = _vec3(node.get("location"))
    rot = _vec3(node.get("rotation_deg"))
    scale = _vec3(node.get("scale"), (1.0, 1.0, 1.0))
    if any(abs(s) < 1e-9 for s in scale):
        raise WorkerError("BadRequest", f"scale components must be non-zero, got {scale}")
    euler = Euler([math.radians(a) for a in rot], "XYZ")
    return Matrix.Translation(loc) @ euler.to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1.0))


def _to_world(shape, matrix):
    # A libfive shape is a function of the sample point, so sampling at the
    # inverse-transformed point is what moves the solid along `matrix`.
    inv = matrix.inverted()
    X, Y, Z = lf.Shape.X(), lf.Shape.Y(), lf.Shape.Z()
    return shape.remap(
        inv[0][0] * X + inv[0][1] * Y + inv[0][2] * Z + inv[0][3],
        inv[1][0] * X + inv[1][1] * Y + inv[1][2] * Z + inv[1][3],
        inv[2][0] * X + inv[2][1] * Y + inv[2][2] * Z + inv[2][3],
    )


def _move_box(box, matrix):
    corners = [
        matrix @ Vector((x, y, z))
        for x in (box[0][0], box[1][0])
        for y in (box[0][1], box[1][1])
        for z in (box[0][2], box[1][2])
    ]
    return (
        (min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)),
        (max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)),
    )


def _union_box(a, b):
    return (
        (min(a[0][0], b[0][0]), min(a[0][1], b[0][1]), min(a[0][2], b[0][2])),
        (max(a[1][0], b[1][0]), max(a[1][1], b[1][1]), max(a[1][2], b[1][2])),
    )


def _vec3(value, default=(0.0, 0.0, 0.0)):
    if value is None:
        return tuple(default)
    try:
        numbers = tuple(float(v) for v in value)
    except (TypeError, ValueError) as exc:
        raise WorkerError("BadRequest", f"expected 3 numbers, got {value!r}") from exc
    if len(numbers) != 3:
        raise WorkerError("BadRequest", f"expected 3 numbers, got {value!r}")
    return numbers
