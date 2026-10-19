"""Target-scoped vision capture. Frames cameras around a named object (or objects)
instead of the whole scene, so chunked builds can visually inspect one section."""

import math
import os
import time

import bpy
from mathutils import Vector

from rpc.base import AXIOM_DIR, WorkerError
from rpc.render import set_engine

DEFAULT_VIEWS = [
    {"name": "front_3q", "azimuth": 35.0, "elevation": 20.0},
    {"name": "side_3q", "azimuth": 125.0, "elevation": 25.0},
    {"name": "top_3q", "azimuth": 45.0, "elevation": 55.0},
]


def target_bounds(names):
    """World-space bbox of the named mesh objects. Raises if any name is missing."""
    corners = []
    for name in names:
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            raise WorkerError("TargetNotFound", f"mesh object not found: {name}")
        corners.extend(obj.matrix_world @ Vector(c) for c in obj.bound_box)
    if not corners:
        raise WorkerError("NothingToCapture", "no geometry in target bounds")
    minimum = Vector(tuple(min(c[i] for c in corners) for i in range(3)))
    maximum = Vector(tuple(max(c[i] for c in corners) for i in range(3)))
    center = (minimum + maximum) / 2
    radius = max((c - center).length for c in corners) or 1.0
    return center, radius


def spherical_direction(azimuth_deg, elevation_deg):
    """Camera direction from azimuth/elevation in degrees. Azimuth 0 = +X, CCW around Z.
    Elevation 0 = horizontal, 90 = straight down."""
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    return Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def cmd_vision(params):
    scene = bpy.context.scene
    target = params.get("target")
    if not target:
        raise WorkerError("BadRequest", "target parameter required (object name or list of names)")
    names = [target] if isinstance(target, str) else list(target)
    if not names:
        raise WorkerError("BadRequest", "target list empty")

    outdir = params.get("outdir") or os.path.join(AXIOM_DIR, "vision", time.strftime("%Y%m%d_%H%M%S"))
    os.makedirs(outdir, exist_ok=True)
    key = str(params.get("engine", "WORKBENCH")).upper()
    width = int(params.get("width", 640))
    height = int(params.get("height", 360))
    distance_scale = float(params.get("distance", 2.5))

    saved = {
        "engine": scene.render.engine,
        "camera": scene.camera,
        "resolution": (scene.render.resolution_x, scene.render.resolution_y),
    }
    engine_used = set_engine(scene, key)

    camera_data = bpy.data.cameras.new("axiom3d_vision_cam")
    camera = bpy.data.objects.new("axiom3d_vision_cam", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    sun = None
    if engine_used != "BLENDER_WORKBENCH":
        sun_data = bpy.data.lights.new("axiom3d_vision_sun", type="SUN")
        sun = bpy.data.objects.new("axiom3d_vision_sun", sun_data)
        scene.collection.objects.link(sun)
        sun.location = (5, 5, 10)

    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = "PNG"
    center, radius = target_bounds(names)

    views = params.get("views") or DEFAULT_VIEWS
    files = []
    cameras_meta = []
    try:
        for view in views:
            name = str(view.get("name", "view"))
            direction = spherical_direction(
                float(view.get("azimuth", 35.0)),
                float(view.get("elevation", 20.0)),
            )
            camera.location = center + direction * (radius * distance_scale)
            camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
            path = os.path.join(outdir, f"{name}.png")
            scene.render.filepath = path
            try:
                bpy.ops.render.render(write_still=True)
            except RuntimeError as exc:
                if key != "WORKBENCH":
                    set_engine(scene, "WORKBENCH")
                    engine_used = "BLENDER_WORKBENCH"
                    bpy.ops.render.render(write_still=True)
                else:
                    raise WorkerError("RenderFailed", str(exc))
            files.append(path)
            cameras_meta.append({
                "name": name,
                "path": path,
                "location": [round(v, 4) for v in camera.location],
            })
    finally:
        for temp in (camera, sun):
            if temp:
                bpy.data.objects.remove(temp, do_unlink=True)
        scene.camera = saved["camera"]
        scene.render.engine = saved["engine"]
        scene.render.resolution_x, scene.render.resolution_y = saved["resolution"]

    return {
        "files": files,
        "cameras": cameras_meta,
        "outdir": outdir,
        "engine_used": engine_used,
        "target": names,
        "target_bounds": {
            "center": [round(v, 4) for v in center],
            "radius": round(radius, 4),
        },
    }
