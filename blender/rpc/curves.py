"""Curve commands: create bezier/nurbs/poly curves, convert to mesh, sweep.

create_curve builds a curve object from control points. convert_to_mesh bakes
it to a real mesh (for gate/export). sweep extrudes a profile along a curve
(bevel_depth or convert with a bevel object).
"""

import bpy

from rpc.base import WorkerError, call_op
from templates.materials import get_material


def _ground_and_uv(obj):
    if obj.type != "MESH":
        return
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    call_op(bpy.ops.object.transform_apply, location=False, rotation=True, scale=True)
    if obj.data.vertices:
        zmin = min((obj.matrix_world @ v.co).z for v in obj.data.vertices)
        if abs(zmin) > 1e-9:
            obj.location.z -= zmin
            bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    if not obj.data.uv_layers and obj.data.polygons:
        uv = obj.data.uv_layers.new(name="UVMap")
        for poly in obj.data.polygons:
            n = poly.normal
            axis = max(range(3), key=lambda i: abs(n[i]))
            for li in poly.loop_indices:
                co = obj.data.vertices[obj.data.loops[li].vertex_index].co
                uv.data[li].uv = (co[(axis + 1) % 3], co[(axis + 2) % 3])
        obj.data.update()


def cmd_create_curve(params):
    curve_type = params.get("type", "bezier")  # bezier | nurbs | poly
    points = params.get("points")  # list of [x,y,z]
    name = params.get("name", "curve_asset")
    material = params.get("material")
    extrude = params.get("extrude", 0.0)
    bevel_depth = params.get("bevel_depth", 0.0)
    fill_mode = params.get("fill_mode", "FULL")

    if not points or len(points) < 2:
        raise WorkerError("BadRequest", "create_curve requires params.points with >= 2 [x,y,z] control points")

    curve_data = bpy.data.curves.new(name, type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.fill_mode = fill_mode
    if extrude:
        curve_data.extrude = float(extrude)
    if bevel_depth:
        curve_data.bevel_depth = float(bevel_depth)
        curve_data.bevel_resolution = int(params.get("bevel_resolution", 4))

    if curve_type == "poly":
        spline = curve_data.splines.new("POLY")
        spline.points.add(len(points) - 1)
        for i, p in enumerate(points):
            spline.points[i].co = (p[0], p[1], p[2], 1.0)
    elif curve_type == "nurbs":
        spline = curve_data.splines.new("NURBS")
        spline.points.add(len(points) - 1)
        for i, p in enumerate(points):
            spline.points[i].co = (p[0], p[1], p[2], 1.0)
        spline.use_endpoint_u = True
        spline.order_u = min(4, len(points))
    else:  # bezier
        spline = curve_data.splines.new("BEZIER")
        spline.bezier_points.add(len(points) - 1)
        for i, p in enumerate(points):
            bp = spline.bezier_points[i]
            bp.co = (p[0], p[1], p[2])
            bp.handle_left_type = "AUTO"
            bp.handle_right_type = "AUTO"

    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.scene.collection.objects.link(obj)

    if material:
        mat = get_material(material)
        if mat:
            obj.data.materials.append(mat)

    return {
        "name": obj.name,
        "type": obj.type,
        "curve_type": curve_type,
        "points": len(points),
        "dimensions": [round(v, 6) for v in obj.dimensions],
    }


def cmd_convert_curve_to_mesh(params):
    name = params.get("name")
    if not name:
        raise WorkerError("BadRequest", "convert_curve_to_mesh requires params.name")
    obj = bpy.data.objects.get(name)
    if not obj or obj.type != "CURVE":
        raise WorkerError("NotFound", f"curve object not found: {name!r}")

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    result = call_op(bpy.ops.object.convert, target="MESH")
    if "FINISHED" not in result:
        raise WorkerError("InternalError", f"curve convert returned {result}")

    mesh_obj = bpy.context.active_object
    _ground_and_uv(mesh_obj)
    return {
        "name": mesh_obj.name,
        "type": mesh_obj.type,
        "verts": len(mesh_obj.data.vertices),
        "polys": len(mesh_obj.data.polygons),
        "dimensions": [round(v, 6) for v in mesh_obj.dimensions],
    }


def cmd_sweep_curve(params):
    """Extrude a profile curve along a path curve, bake to mesh."""
    path_name = params.get("path")
    profile_name = params.get("profile")
    name = params.get("name", "sweep_result")
    material = params.get("material")

    if not path_name or not profile_name:
        raise WorkerError("BadRequest", "sweep_curve requires params.path and params.profile (object names)")
    path_obj = bpy.data.objects.get(path_name)
    profile_obj = bpy.data.objects.get(profile_name)
    if not path_obj or path_obj.type != "CURVE":
        raise WorkerError("NotFound", f"path curve not found: {path_name!r}")
    if not profile_obj or profile_obj.type != "CURVE":
        raise WorkerError("NotFound", f"profile curve not found: {profile_name!r}")

    # Assign profile as bevel object on path
    path_obj.data.bevel_mode = "OBJECT"
    path_obj.data.bevel_object = profile_obj

    # Convert path to mesh
    bpy.ops.object.select_all(action="DESELECT")
    path_obj.select_set(True)
    bpy.context.view_layer.objects.active = path_obj
    call_op(bpy.ops.object.convert, target="MESH")
    mesh_obj = bpy.context.active_object
    mesh_obj.name = name
    if material:
        mat = get_material(material)
        if mat:
            mesh_obj.data.materials.clear()
            mesh_obj.data.materials.append(mat)
    _ground_and_uv(mesh_obj)
    return {
        "name": mesh_obj.name,
        "type": mesh_obj.type,
        "verts": len(mesh_obj.data.vertices),
        "polys": len(mesh_obj.data.polygons),
        "dimensions": [round(v, 6) for v in mesh_obj.dimensions],
    }
