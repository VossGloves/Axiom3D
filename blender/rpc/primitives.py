"""Primitive mesh commands: create basic shapes via bpy.ops with proper naming/UV/material.

Wraps bpy.ops.mesh.primitive_* — returns the created object's stats. Applies
transforms, ensures UV layer, optional material. Grounds to Z=0 by default.
"""

import bpy

from materials import get_material
from rpc.base import WorkerError, call_op


def _ground_and_uv(obj):
    """Apply transforms, ground to Z=0, ensure UV layer."""
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    # Apply scale/rotation so gate sees identity transforms
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    call_op(bpy.ops.object.transform_apply, location=False, rotation=True, scale=True)
    # Ground
    if obj.type == "MESH":
        zmin = min((obj.matrix_world @ v.co).z for v in obj.data.vertices) if obj.data.vertices else 0
        if abs(zmin) > 1e-9:
            obj.location.z -= zmin
            bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        # UVs
        if not obj.data.uv_layers:
            uv = obj.data.uv_layers.new(name="UVMap")
            for poly in obj.data.polygons:
                n = poly.normal
                axis = max(range(3), key=lambda i: abs(n[i]))
                for li in poly.loop_indices:
                    co = obj.data.vertices[obj.data.loops[li].vertex_index].co
                    uv.data[li].uv = (co[(axis + 1) % 3], co[(axis + 2) % 3])
            obj.data.update()


def _finish(obj, name, material):
    obj.name = name
    if material:
        mat = get_material(material)
        if mat:
            obj.data.materials.clear()
            obj.data.materials.append(mat)
    _ground_and_uv(obj)
    return {
        "name": obj.name,
        "type": obj.type,
        "verts": len(obj.data.vertices) if obj.type == "MESH" else 0,
        "polys": len(obj.data.polygons) if obj.type == "MESH" else 0,
        "dimensions": [round(v, 6) for v in obj.dimensions],
        "location": [round(v, 6) for v in obj.location],
    }


def cmd_create_primitive(params):
    kind = params.get("kind")
    if not kind:
        raise WorkerError("BadRequest", "create_primitive requires params.kind")
    name = params.get("name", f"prim_{kind}")
    material = params.get("material")
    location = params.get("location", (0, 0, 0))

    if kind == "cube":
        size = params.get("size", 1.0)
        call_op(bpy.ops.mesh.primitive_cube_add, size=size, location=location)
    elif kind == "uv_sphere":
        radius = params.get("radius", 0.5)
        segments = int(params.get("segments", 32))
        rings = int(params.get("rings", 16))
        call_op(bpy.ops.mesh.primitive_uv_sphere_add, radius=radius, segments=segments, ring_count=rings, location=location)
    elif kind == "ico_sphere":
        radius = params.get("radius", 0.5)
        subdivisions = int(params.get("subdivisions", 2))
        call_op(bpy.ops.mesh.primitive_ico_sphere_add, radius=radius, subdivisions=subdivisions, location=location)
    elif kind == "cylinder":
        radius = params.get("radius", 0.5)
        depth = params.get("depth", 1.0)
        vertices = int(params.get("vertices", 32))
        call_op(bpy.ops.mesh.primitive_cylinder_add, radius=radius, depth=depth, vertices=vertices, location=location)
    elif kind == "cone":
        radius1 = params.get("radius1", 0.5)
        radius2 = params.get("radius2", 0.0)
        depth = params.get("depth", 1.0)
        vertices = int(params.get("vertices", 32))
        call_op(bpy.ops.mesh.primitive_cone_add, radius1=radius1, radius2=radius2, depth=depth, vertices=vertices, location=location)
    elif kind == "torus":
        major = params.get("major_radius", 1.0)
        minor = params.get("minor_radius", 0.25)
        major_seg = int(params.get("major_segments", 48))
        minor_seg = int(params.get("minor_segments", 12))
        call_op(bpy.ops.mesh.primitive_torus_add, major_radius=major, minor_radius=minor, major_segments=major_seg, minor_segments=minor_seg, location=location)
    elif kind == "plane":
        size = params.get("size", 2.0)
        call_op(bpy.ops.mesh.primitive_plane_add, size=size, location=location)
    elif kind == "circle":
        radius = params.get("radius", 1.0)
        vertices = int(params.get("vertices", 32))
        fill = params.get("fill_type", "NGON")
        call_op(bpy.ops.mesh.primitive_circle_add, radius=radius, vertices=vertices, fill_type=fill, location=location)
    elif kind == "grid":
        size = params.get("size", 2.0)
        x_subdiv = int(params.get("x_subdivisions", 10))
        y_subdiv = int(params.get("y_subdivisions", 10))
        call_op(bpy.ops.mesh.primitive_grid_add, size=size, x_subdivisions=x_subdiv, y_subdivisions=y_subdiv, location=location)
    else:
        raise WorkerError("BadRequest", f"unknown primitive kind: {kind!r}; available: cube, uv_sphere, ico_sphere, cylinder, cone, torus, plane, circle, grid")

    obj = bpy.context.active_object
    if not obj:
        raise WorkerError("InternalError", "bpy.ops created no active object")
    return _finish(obj, name, material)
