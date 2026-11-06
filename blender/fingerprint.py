"""Scene fingerprint: stable digest of every object's identity, transform, and
(For MESH) geometry. Used to detect manual edits made in the Blender GUI between
Axiom sessions — the stored fingerprint from the last passing gate is compared
against the live scene before any refine, so a diverged scene forces the
scene-as-truth (patch-only) workflow instead of a build.py re-run.

Diff is conservative: any field mismatch counts as a change. False positives
only force the safer patch-only path, never a wipe.
"""

import hashlib

import bpy
import numpy as np
from mathutils import Vector

# decimals for transform/bounds rounding — below this is float noise, above it
# is a real edit
ROUND = 4


def _mesh_fields(obj):
    me = obj.data
    digest = hashlib.md5()
    count = len(me.vertices)
    if count:
        coords = np.empty(count * 3, dtype=np.float32)
        me.vertices.foreach_get("co", coords)
        digest.update(np.round(coords, ROUND).tobytes())
    digest.update(",".join(sorted(slot.material.name for slot in me.materials if slot.material)).encode())
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    arr = np.array(corners)
    return {
        "verts": count,
        "polys": len(me.polygons),
        "bounds": [
            [round(float(v), ROUND) for v in arr.min(axis=0)],
            [round(float(v), ROUND) for v in arr.max(axis=0)],
        ],
        "mesh_md5": digest.hexdigest(),
    }


def compute():
    # Direct property writes (location.x = n) do not refresh matrix_world until
    # the view layer updates — otherwise a move reads back as unchanged.
    bpy.context.view_layer.update()
    objects = {}
    for obj in bpy.data.objects:
        fields = {
            "type": obj.type,
            "loc": [round(v, ROUND) for v in obj.matrix_world.translation],
            "rot": [round(v, ROUND) for v in obj.matrix_world.to_euler()],
            "scale": [round(v, ROUND) for v in obj.matrix_world.to_scale()],
        }
        if obj.type == "MESH" and obj.data:
            fields.update(_mesh_fields(obj))
        objects[obj.name] = fields
    return {"blender": bpy.app.version_string, "objects": objects}


def diff(stored, live):
    a = (stored or {}).get("objects", {})
    b = live.get("objects", {})
    added = sorted(set(b) - set(a))
    removed = sorted(set(a) - set(b))
    changed = []
    for name in sorted(set(a) & set(b)):
        fields = sorted(k for k in set(a[name]) | set(b[name]) if a[name].get(k) != b[name].get(k))
        if fields:
            changed.append({"name": name, "fields": fields})
    diverged = bool(added or removed or changed)
    return {"diverged": diverged, "added": added, "removed": removed, "changed": changed}
