"""Multi-view render command. Auto-framed cameras around scene bounds; Workbench
is the CI-safe default, EEVEE for final looks (falls back to Workbench at runtime
when headless EEVEE has no GPU)."""

import os
import time

import bpy
from mathutils import Vector

from rpc.base import AXIOM_DIR, WorkerError, call_op

ENGINE_CANDIDATES = {
    "WORKBENCH": ["BLENDER_WORKBENCH"],
    "EEVEE": ["BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"],
    "CYCLES": ["CYCLES"],
}

VIEW_DIRECTIONS = [
    ("front", (1, 0, 0)),
    ("back", (-1, 0, 0)),
    ("left", (0, 1, 0)),
    ("right", (0, -1, 0)),
    ("top", (0, 0, 1)),
    ("iso", (1, 1, 1)),
]


def set_engine(scene, key):
    for ident in ENGINE_CANDIDATES.get(key, []):
        try:
            scene.render.engine = ident
            return ident
        except TypeError:
            continue
    raise WorkerError("RenderEngine", f"engine {key} unavailable, tried {ENGINE_CANDIDATES.get(key)}")


def scene_bounds():
    corners = []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not corners:
        raise WorkerError("NothingToRender", "no renderable mesh objects in scene")
    minimum = Vector(tuple(min(c[i] for c in corners) for i in range(3)))
    maximum = Vector(tuple(max(c[i] for c in corners) for i in range(3)))
    center = (minimum + maximum) / 2
    radius = max((corner - center).length for corner in corners) or 1.0
    return center, radius


def cmd_render(params):
    scene = bpy.context.scene
    outdir = params.get("outdir") or os.path.join(AXIOM_DIR, "render", time.strftime("%Y%m%d_%H%M%S"))
    os.makedirs(outdir, exist_ok=True)
    key = str(params.get("engine", "WORKBENCH")).upper()
    width = int(params.get("width", 960))
    height = int(params.get("height", 540))

    saved = {
        "engine": scene.render.engine,
        "camera": scene.camera,
        "resolution": (scene.render.resolution_x, scene.render.resolution_y),
        "color_type": scene.display.shading.color_type,
    }
    engine_used = set_engine(scene, key)
    # Workbench defaults to STUDIO (uniform grey) — force material albedo so
    # gate/vision renders show the asset's actual colors.
    scene.display.shading.color_type = "MATERIAL"

    camera_data = bpy.data.cameras.new("axiom3d_render_cam")
    camera = bpy.data.objects.new("axiom3d_render_cam", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    sun = None
    if engine_used != "BLENDER_WORKBENCH":
        sun_data = bpy.data.lights.new("axiom3d_render_sun", type="SUN")
        sun = bpy.data.objects.new("axiom3d_render_sun", sun_data)
        scene.collection.objects.link(sun)
        sun.location = (5, 5, 10)

    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = "PNG"
    center, radius = scene_bounds()
    wanted = params.get("views")
    views = [v for v in VIEW_DIRECTIONS if not wanted or v[0] in wanted]
    if not views:
        raise WorkerError("BadRequest", f"no matching views for {wanted}")

    files = []
    rendered_views = []
    try:
        for name, direction in views:
            direction_v = Vector(direction).normalized()
            camera.location = center + direction_v * (radius * 2.5)
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
            rendered_views.append({"view": name, "file": path})
    finally:
        for temp in (camera, sun):
            if temp:
                bpy.data.objects.remove(temp, do_unlink=True)
        scene.camera = saved["camera"]
        scene.render.engine = saved["engine"]
        scene.render.resolution_x, scene.render.resolution_y = saved["resolution"]
        scene.display.shading.color_type = saved["color_type"]
    return {"files": files, "views": rendered_views, "engine_used": engine_used, "outdir": outdir}
