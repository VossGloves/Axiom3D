"""Deform / remesh / displace / linked-instance helpers.

Thin bpy wrappers returning the modifier or created objects. Callers bake via
ops.apply_all_modifiers(obj) when they want real geometry for gate/export.
"""

import bpy

from rpc.base import call_op


def add_remesh(obj, mode="VOXEL", voxel_size=0.1, adaptivity=0.0):
    """Remesh modifier — rebuilds topology. mode: VOXEL | SHARP | SMOOTH | BLOCKS."""
    mod = obj.modifiers.new("Remesh", "REMESH")
    mod.mode = mode
    if mode == "VOXEL":
        mod.voxel_size = voxel_size
        mod.use_smooth_shade = True
    mod.adaptivity = adaptivity
    return mod


def add_deform(obj, mode="BEND", angle=1.5708, axis="Z", factor=None):
    """SimpleDeform modifier — bend/taper/twist along an axis.

    mode: BEND | TAPER | TWIST. angle in radians for BEND/TWIST; factor for
    TAPER overrides angle when set. axis: 'X' | 'Y' | 'Z'.
    """
    mod = obj.modifiers.new("Deform", "SIMPLE_DEFORM")
    mod.deform_method = mode
    mod.deform_axis = axis
    if mode == "TAPER" and factor is not None:
        mod.factor = factor
    else:
        mod.angle = angle
    return mod


def add_displace(obj, strength=0.01, scale=0.2, mid_level=0.5):
    """Displace modifier with a clouds texture — surface roughness / warping."""
    tex_name = f"displace_{obj.name}"
    tex = bpy.data.textures.get(tex_name)
    if tex is None:
        tex = bpy.data.textures.new(tex_name, type="CLOUDS")
    tex.noise_scale = scale
    mod = obj.modifiers.new("Displace", "DISPLACE")
    mod.texture = tex
    mod.strength = strength
    mod.mid_level = mid_level
    mod.texture_coords = "LOCAL"
    return mod


def instance_object(source, count=2, offset=(1.0, 0.0, 0.0), name_prefix=None):
    """Linked-duplicate source count times along offset (shared mesh datablock).

    Creates count new objects sharing source.data. Offset is constant world
    meters applied cumulatively. Returns list of created objects (including
    source as index 0 when count includes it — here only new copies).
    """
    if source.type != "MESH":
        raise ValueError(f"instance_object requires a MESH source, got {source.type}")
    prefix = name_prefix or f"{source.name}_inst"
    created = []
    for i in range(count):
        inst = bpy.data.objects.new(f"{prefix}_{i:03d}", source.data)
        inst.location = (
            source.location.x + offset[0] * (i + 1),
            source.location.y + offset[1] * (i + 1),
            source.location.z + offset[2] * (i + 1),
        )
        bpy.context.scene.collection.objects.link(inst)
        created.append(inst)
    return created
