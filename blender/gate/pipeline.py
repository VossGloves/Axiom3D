"""Staged verification gate (PLAN.md stages 1-7).

Stage order is fixed. Script stages (syntax, api, exec) fail fast — later stages
are meaningless without a script that parses and ran. Scene stages (geometry,
mesh_quality, export_roundtrip, render) all run even when earlier scene stages
flag issues, so a single report carries full evidence for the fix loop.

Snapshot discipline: stage 3 (cmd_exec) auto-snapshots before running; a second
snapshot after a successful exec preserves the post-exec scene so the roundtrip
stage can restore it after wiping the file to re-import the glTF. The render
stage only writes PNGs — the vision critique against the checklist is the agent's
job (axiom3d.md workflow), not the worker's.
"""

import ast
import os
import shutil
import tempfile
import time

import bpy
from mathutils import Vector

from api_index import load_or_build
from gate.api_check import check_tree
from geom.checks import DEFAULT_POLY_BUDGET, mesh_quality_report, scene_geometry_report
from rpc.base import ExecScriptError, STATE, log_telemetry
from rpc.session import cmd_exec, cmd_snapshot

ROUNDTRIP_REL_TOL = 0.01
ROUNDTRIP_ABS_TOL = 0.01


def run_gate(code, params):
    started = time.monotonic()
    poly_budget = int(params.get("poly_budget", DEFAULT_POLY_BUDGET))
    volume_epsilon = float(params.get("volume_epsilon", 1e-6))
    stages = []

    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        stages.append(
            _stage("syntax", False, issues=[{"line": exc.lineno, "message": exc.msg, "severity": "error"}])
        )
        return _report(stages, started)
    stages.append(_stage("syntax", True))

    api_issues = check_tree(tree, load_or_build())
    stages.append(_stage("api", not api_issues, issues=[_with_severity(i) for i in api_issues]))
    if api_issues:
        return _report(stages, started)

    try:
        exec_result = cmd_exec({"code": code, "snapshot": True})
    except ExecScriptError as exc:
        error = exc.result["error"]
        stages.append(
            _stage(
                "exec",
                False,
                issues=[{"type": error["type"], "message": error["message"], "severity": "error"}],
                detail={"stdout": exc.result["stdout"], "traceback": error.get("traceback", "")},
            )
        )
        return _report(stages, started)
    stages.append(
        _stage(
            "exec",
            True,
            detail={
                "stdout": exec_result["stdout"],
                "duration_ms": exec_result["duration_ms"],
                "scene_diff": exec_result["scene_diff"],
            },
        )
    )

    post_exec = cmd_snapshot({"label": "gate"})

    geometry = scene_geometry_report(poly_budget)
    if geometry["mesh_count"] == 0:
        geometry["issues"].append(
            {"object": "<scene>", "issue": "no_mesh_objects", "detail": "script produced no mesh objects", "severity": "error"}
        )
        geometry["passed"] = False
    stages.append(_stage("geometry", geometry["passed"], issues=geometry["issues"]))

    quality = mesh_quality_report(volume_epsilon)
    if quality.get("skipped"):
        stages.append({"name": "mesh_quality", "passed": True, "skipped": True, "detail": {"reason": quality["reason"]}})
    else:
        stages.append(
            _stage(
                "mesh_quality",
                quality["passed"],
                issues=quality["issues"],
                detail={"pair_checks": quality["pair_checks"], "mesh_count": quality["mesh_count"]},
            )
        )

    if params.get("export_roundtrip", True):
        if STATE.get("mode") == "gui":
            log_telemetry("worker.gui.gate_skip_roundtrip", snapshot=post_exec["id"])
            stages.append(
                {
                    "name": "export_roundtrip",
                    "passed": True,
                    "skipped": True,
                    "detail": {
                        "reason": "skipped in gui mode because restoring the live scene would reload the addon bridge"
                    },
                }
            )
        else:
            stages.append(_roundtrip_stage(post_exec["path"]))

    if params.get("render", True):
        stages.append(_render_stage(params))

    return _report(stages, started)


def _roundtrip_stage(snapshot_path):
    """Export glTF, wipe the file, re-import, compare — then restore the scene.

    Object count is exact; bounds and triangle count allow 1% (conventions).
    Vertex counts are reported but not compared: the glTF exporter splits vertices
    per unique normal/UV, so they legitimately change across a roundtrip.
    """
    pre = _census()
    tmpdir = tempfile.mkdtemp(prefix="axiom3d_gate_")
    issues = []
    detail = {"pre": pre}
    try:
        glb = os.path.join(tmpdir, "roundtrip.glb")
        bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_apply=True)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        imported = bpy.ops.import_scene.gltf(filepath=glb)
        post = _census()
        detail["post"] = post
        detail["import"] = list(imported)
        if post["objects"] == 0:
            issues.append({"issue": "roundtrip_empty", "detail": "import produced no mesh objects", "severity": "error"})
        else:
            if post["objects"] != pre["objects"]:
                issues.append(
                    {"issue": "roundtrip_object_count", "detail": f"{pre['objects']} -> {post['objects']}", "severity": "error"}
                )
            if not _bounds_within(post["bounds"], pre["bounds"]):
                issues.append(
                    {"issue": "roundtrip_bounds", "detail": f"{pre['bounds']} -> {post['bounds']}", "severity": "error"}
                )
            if pre["tris"] and abs(post["tris"] - pre["tris"]) > max(1, pre["tris"] * ROUNDTRIP_REL_TOL):
                issues.append(
                    {"issue": "roundtrip_tris", "detail": f"{pre['tris']} -> {post['tris']}", "severity": "error"}
                )
    except Exception as exc:  # noqa: BLE001 - any exporter failure becomes stage evidence
        issues.append({"issue": "roundtrip_failed", "detail": f"{type(exc).__name__}: {exc}", "severity": "error"})
    finally:
        _restore(snapshot_path)
        shutil.rmtree(tmpdir, ignore_errors=True)
    return _stage("export_roundtrip", not issues, issues=issues, detail=detail)


def _restore(snapshot_path):
    if not snapshot_path or not os.path.exists(snapshot_path):
        return
    try:
        bpy.ops.wm.open_mainfile(filepath=snapshot_path)
    except Exception as exc:  # noqa: BLE001 - a failed restore must not kill the report
        print(f"gate: restore of {snapshot_path} failed: {exc}")


def _census():
    deps = bpy.context.evaluated_depsgraph_get()
    objects = 0
    tris = 0
    corners = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        try:
            if not mesh.polygons:
                continue
            objects += 1
            tris += sum(len(polygon.vertices) - 2 for polygon in mesh.polygons)
        finally:
            ev.to_mesh_clear()
        corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    bounds = None
    if corners:
        bounds = (
            [min(corner[i] for corner in corners) for i in range(3)],
            [max(corner[i] for corner in corners) for i in range(3)],
        )
    return {"objects": objects, "tris": tris, "bounds": bounds}


def _bounds_within(post, pre):
    if not post or not pre:
        return post == pre
    return all(
        abs(post[bound][axis] - pre[bound][axis])
        <= max(ROUNDTRIP_ABS_TOL, abs(pre[bound][axis]) * ROUNDTRIP_REL_TOL)
        for bound in (0, 1)
        for axis in range(3)
    )


def _render_stage(params):
    from rpc.render import cmd_render

    render_params = {
        "engine": "WORKBENCH",
        "width": int(params.get("render_width", 480)),
        "height": int(params.get("render_height", 270)),
    }
    if params.get("views"):
        render_params["views"] = params["views"]
    try:
        result = cmd_render(render_params)
        return _stage("render", True, detail={"files": result["files"], "engine_used": result["engine_used"]})
    except Exception as exc:  # noqa: BLE001 - render failure is stage evidence, not a crash
        return _stage("render", False, issues=[{"issue": "render_failed", "detail": str(exc), "severity": "error"}])


def _with_severity(issue):
    return {**issue, "severity": "error"}


def _stage(name, passed, issues=None, detail=None):
    stage = {"name": name, "passed": passed}
    if issues:
        stage["issues"] = issues
    if detail:
        stage["detail"] = detail
    return stage


def _report(stages, started):
    failed = next((stage["name"] for stage in stages if not stage["passed"]), None)
    return {
        "passed": failed is None,
        "failed_stage": failed,
        "blender_version": bpy.app.version_string,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "stages": stages,
    }
