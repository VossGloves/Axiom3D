"""Asset export: glTF (default), FBX, USD. Blender 5.2 renamed the glTF
apply-modifiers flag to export_apply; FBX still uses use_mesh_modifiers; call_op
drops any kwarg the installed RNA signature does not know."""

import os

import bpy

from rpc.base import WorkerError, call_op

EXPORT_OPS = {
    "glb": lambda path, apply: call_op(
        bpy.ops.export_scene.gltf, filepath=path, export_format="GLB", export_apply=apply
    ),
    "gltf": lambda path, apply: call_op(
        bpy.ops.export_scene.gltf, filepath=path, export_format="GLTF_SEPARATE", export_apply=apply
    ),
    "fbx": lambda path, apply: call_op(
        bpy.ops.export_scene.fbx, filepath=path, use_mesh_modifiers=apply, path_mode="COPY"
    ),
    "usd": lambda path, apply: call_op(bpy.ops.wm.usd_export, filepath=path, export_animation=False),
}


def cmd_export(params):
    path = params.get("path")
    if not path:
        raise WorkerError("BadRequest", "export requires params.path")
    fmt = str(params.get("format", "glb")).lower()
    if fmt not in EXPORT_OPS:
        raise WorkerError("BadRequest", f"unknown format {fmt}; expected one of {sorted(EXPORT_OPS)}")
    apply_modifiers = bool(params.get("apply_modifiers", True))
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    patched = _flatten_base_colors() if fmt in {"glb", "gltf"} else []
    try:
        EXPORT_OPS[fmt](path, apply_modifiers)
    finally:
        _restore_base_colors(patched)
    if not os.path.exists(path):
        raise WorkerError("ExportFailed", f"exporter did not write {path}")
    return {"path": path, "bytes": os.path.getsize(path), "format": fmt}


def _flatten_base_colors():
    """glTF cannot follow non-texture Base Color links (noise/color ramps): the
    exporter drops the factor and the asset exports white. Point each such input
    at its default (the material's viewport color) for the export, restore after."""
    patched = []
    for mat in bpy.data.materials:
        if not (mat.use_nodes and mat.node_tree):
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        sock = bsdf.inputs["Base Color"]
        if not sock.is_linked:
            continue
        link = sock.links[0]
        if link.from_node.type in {"TEX_IMAGE", "TEX_ENVIRONMENT"}:
            continue
        patched.append((sock, link.from_socket, tuple(sock.default_value)))
        mat.node_tree.links.remove(link)
        sock.default_value = (*mat.diffuse_color[:3], 1.0)
    return patched


def _restore_base_colors(patched):
    for sock, from_socket, default in patched:
        sock.default_value = default
        sock.id_data.links.new(from_socket, sock)