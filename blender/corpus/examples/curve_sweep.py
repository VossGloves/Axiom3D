# id: curve-sweep
# title: Sweep profile along curve (pipes, rails, arches)
# tags: curve, sweep, profile, pipe, rail, arch, loft
# description: Create a curve path, use bevel_depth to sweep a circular cross-section, convert to mesh. Reference technique — works for pipes, handrails, arches, any swept geometry.

import bpy


def run():
    # Create a curve path (arc)
    curve_data = bpy.data.curves.new("path", "CURVE")
    curve_data.dimensions = "3D"
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(2)  # 3 points total
    pts = [(-2.0, 0, 0), (0, 0, 1.5), (2.0, 0, 0)]
    for i, co in enumerate(pts):
        bp = spline.bezier_points[i]
        bp.co = co
        bp.handle_left_type = "AUTO"
        bp.handle_right_type = "AUTO"
    curve_obj = bpy.data.objects.new("path", curve_data)
    bpy.context.scene.collection.objects.link(curve_obj)

    # Sweep circular cross-section along curve
    curve_data.bevel_depth = 0.05
    curve_data.bevel_resolution = 4
    curve_data.use_fill_caps = True

    # Convert curve to mesh: evaluate, bake into new mesh, replace data
    deps = bpy.context.evaluated_depsgraph_get()
    ev = curve_obj.evaluated_get(deps)
    baked = bpy.data.meshes.new_from_object(ev)
    # curve_obj.data is Curve type; create new object to hold the mesh
    mesh_obj = bpy.data.objects.new("swept", baked)
    bpy.context.scene.collection.objects.link(mesh_obj)
    # Remove the curve object (and its now-baked data)
    old_data = curve_obj.data
    bpy.data.objects.remove(curve_obj, do_unlink=True)
    if old_data.users == 0:
        bpy.data.curves.remove(old_data)

    verts = len(mesh_obj.data.vertices)
    bpy.data.objects.remove(mesh_obj, do_unlink=True)
    return {"verts": verts}