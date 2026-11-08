"""Procedural PBR material builders for the Axiom3D asset library.

Each returns a bpy.data.material with a Principled BSDF driven by a Noise->
ColorRamp for subtle surface variation. Materials are assigned by name via
the materials RPC / tool layer; agents pick from a known list rather than
authoring shader graphs from scratch. Ad-hoc materials remain available via
raw bpy when no library entry fits.
"""

import bpy

MATERIAL_PREFIX = "axiom3d_"


def _noise_ramp_material(name, c0, c1, roughness, metallic=0.0, noise_scale=12.0):
    mat = bpy.data.materials.new(MATERIAL_PREFIX + name)
    mat.use_nodes = True
    # Solid-mode viewport color reads diffuse_color, not the node graph.
    mat.diffuse_color = (*c1, 1.0)
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = noise_scale
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*c0, 1.0)
    ramp.color_ramp.elements[1].color = (*c1, 1.0)
    nt.links.new(noise.outputs["Factor"], ramp.inputs["Factor"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def build_concrete():
    return _noise_ramp_material("concrete", (0.52, 0.52, 0.52), (0.68, 0.68, 0.68), 0.9, 0.0, 12.0)


def build_steel():
    return _noise_ramp_material("steel", (0.35, 0.36, 0.38), (0.55, 0.56, 0.58), 0.45, 1.0, 30.0)


def build_metal():
    return _noise_ramp_material("metal", (0.62, 0.63, 0.65), (0.78, 0.79, 0.8), 0.35, 1.0, 40.0)


def build_plastic():
    return _noise_ramp_material("plastic", (0.75, 0.75, 0.75), (0.85, 0.85, 0.85), 0.35, 0.0, 20.0)


def build_wood():
    return _noise_ramp_material("wood", (0.4, 0.26, 0.13), (0.55, 0.38, 0.2), 0.7, 0.0, 8.0)


def build_glass():
    mat = bpy.data.materials.new(MATERIAL_PREFIX + "glass")
    mat.use_nodes = True
    mat.diffuse_color = (0.85, 0.92, 0.95, 1.0)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.85, 0.92, 0.95, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.05
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["IOR"].default_value = 1.45
    return mat


def build_rubber():
    return _noise_ramp_material("rubber", (0.05, 0.05, 0.05), (0.12, 0.12, 0.12), 0.95, 0.0, 25.0)


def build_fabric():
    return _noise_ramp_material("fabric", (0.55, 0.5, 0.45), (0.7, 0.65, 0.6), 0.95, 0.0, 50.0)


def build_stone():
    return _noise_ramp_material("stone", (0.45, 0.44, 0.42), (0.6, 0.58, 0.55), 0.85, 0.0, 10.0)


def build_painted():
    return _noise_ramp_material("painted", (0.6, 0.25, 0.2), (0.72, 0.35, 0.3), 0.4, 0.0, 15.0)


MATERIALS = {
    "concrete": ("Poured concrete: matte gray with noise-driven tone variation.", build_concrete),
    "steel": ("Structural steel: metallic, mid roughness, subtle grain.", build_steel),
    "metal": ("Brushed metal: brighter aluminum-like finish, low roughness.", build_metal),
    "plastic": ("Generic plastic: mid-light tone, moderate roughness.", build_plastic),
    "wood": ("Natural wood: warm brown grain variation, high roughness.", build_wood),
    "glass": ("Clear glass: transmissive, low roughness, IOR 1.45.", build_glass),
    "rubber": ("Dark rubber: near-black, very high roughness.", build_rubber),
    "fabric": ("Woven fabric: warm neutral, high roughness, fine noise.", build_fabric),
    "stone": ("Natural stone: gray-tan variation, high roughness.", build_stone),
    "painted": ("Painted surface: saturated tone, moderate roughness.", build_painted),
}


def list_materials():
    return {name: description for name, (description, _) in MATERIALS.items()}


def get_material(key):
    mat = bpy.data.materials.get(MATERIAL_PREFIX + key)
    if mat is None and key in MATERIALS:
        mat = MATERIALS[key][1]()
    return mat


def get_tinted_material(key, color):
    """Library material variant with base color overridden; keeps roughness/metallic.

    color: "#rrggbb" (3-digit shorthand ok) or [r, g, b] floats 0-1.
    Variant is cached as axiom3d_<key>_<hex>, so repeated tints reuse one material.
    """
    rgb = _rgb_from(color)
    variant = f"{key}_{_hex_of(rgb)}"
    mat = bpy.data.materials.get(MATERIAL_PREFIX + variant)
    if mat is not None:
        return mat
    base = get_material(key)
    if base is None:
        raise KeyError(f"unknown material {key!r}; available: {sorted(MATERIALS)}")
    mat = base.copy()
    mat.name = MATERIAL_PREFIX + variant
    _retint(mat, rgb)
    return mat


def apply_material(obj, key, color=None):
    mat = get_tinted_material(key, color) if color is not None else get_material(key)
    if mat is None:
        raise KeyError(f"unknown material {key!r}; available: {sorted(MATERIALS)}")
    if obj.data.materials:
        obj.data.materials.clear()
    obj.data.materials.append(mat)
    return mat.name


def _rgb_from(color):
    if isinstance(color, str):
        raw = color.lstrip("#")
        if len(raw) == 3:
            raw = "".join(ch * 2 for ch in raw)
        if len(raw) != 6:
            raise ValueError(f"color must be #rrggbb, got {color!r}")
        try:
            channels = [int(raw[i : i + 2], 16) / 255 for i in (0, 2, 4)]
        except ValueError:
            raise ValueError(f"color must be #rrggbb, got {color!r}") from None
        return tuple(channels)
    if isinstance(color, (list, tuple)) and len(color) == 3:
        return tuple(float(c) for c in color)
    raise ValueError(f"color must be #rrggbb or [r, g, b], got {color!r}")


def _hex_of(rgb):
    return "".join(f"{round(max(0.0, min(1.0, c)) * 255):02x}" for c in rgb)


def _retint(mat, rgb):
    mat.diffuse_color = (*rgb, 1.0)
    nt = mat.node_tree
    if nt is None:
        return
    shade = tuple(c * 0.7 for c in rgb)
    for node in nt.nodes:
        if node.type == "VALTORGB":
            node.color_ramp.elements[0].color = (*shade, 1.0)
            node.color_ramp.elements[-1].color = (*rgb, 1.0)
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
