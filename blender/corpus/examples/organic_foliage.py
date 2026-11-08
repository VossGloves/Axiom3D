# id: organic-foliage
# title: Organic foliage clump with tapered branch
# tags: organic, foliage, sphere, clump, remesh, boolean, deform
# description: Smooth-unioned sphere clump + tapered branch via boolean union, voxel remesh, and SimpleDeform taper. Reference technique — adapt proportions to your asset; never copy-paste.

"""Organic foliage pattern: smooth-unioned sphere clump + tapered branch.

Reference technique for `blender-sdf` organic builds — retrieved via `blender-docs`
(query "organic foliage"). Adapt to the asset's proportions; never copy-paste.

Rules (from sdf.py docstring):
- Clump: 8-12 varied spheres, blend 0.05-0.10m (blend > 0.15 collapses to one ball).
- Branch: cone + taper node, base_scale 2-3x, min radius 0.02m.
- Post-pass: blender-damage surface_noise + blender-modify displace + material.
- Span > 4m: chunk into 2-3 SDF builds.
"""

import bpy


def run():
    # Foliage clump: 10 varied spheres smooth-unioned, blend 0.08m
    spheres = []
    radii = [0.4, 0.35, 0.3, 0.38, 0.28, 0.33, 0.25, 0.36, 0.3, 0.27]
    offsets = [
        (0, 0, 0), (0.3, 0.1, 0.05), (-0.25, 0.15, 0.08), (0.1, -0.3, 0.1),
        (-0.1, -0.2, -0.05), (0.2, 0.25, 0.12), (-0.3, -0.1, 0.03),
        (0.05, 0.3, -0.02), (-0.15, 0.05, 0.15), (0.25, -0.15, 0.07),
    ]
    for i, (r, (ox, oy, oz)) in enumerate(zip(radii, offsets)):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(ox, oy, 4.0 + oz), segments=24)
        spheres.append(bpy.context.active_object)

    # Smooth-union via voxel remesh (approximates SDF blend_expt_union)
    for obj in spheres[1:]:
        mod = spheres[0].modifiers.new(name="bool_union", type="BOOLEAN")
        mod.operation = "UNION"
        mod.object = obj
        bpy.context.view_layer.objects.active = spheres[0]
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(obj)

    remesh = spheres[0].modifiers.new(name="remesh", type="REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = 0.03
    bpy.context.view_layer.objects.active = spheres[0]
    bpy.ops.object.modifier_apply(modifier=remesh.name)

    # Branch: cone base, will be tapered via SimpleDeform
    bpy.ops.mesh.primitive_cone_add(radius1=0.15, radius2=0.05, depth=4, location=(0, 0, 2))
    branch = bpy.context.active_object
    branch.name = "organic_branch"
    spheres[0].name = "organic_foliage"

    taper = branch.modifiers.new(name="taper", type="SIMPLE_DEFORM")
    taper.deform_method = "TAPER"
    taper.factor = 0.6
    bpy.ops.object.modifier_apply(modifier=taper.name)

    # Post-pass: surface noise + displace
    for obj in (spheres[0], branch):
        damage = obj.modifiers.new(name="noise", type="DISPLACE")
        tex = bpy.data.textures.new(name=f"noise_{obj.name}", type="CLOUDS")
        tex.noise_scale = 0.15
        damage.texture = tex
        damage.strength = 0.02
        bpy.ops.object.modifier_apply(modifier=damage.name)
        bpy.ops.object.shade_smooth()

    return {"foliage": spheres[0].name, "branch": branch.name}


if __name__ == "__main__":
    print(run())