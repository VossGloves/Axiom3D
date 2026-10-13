"""Auto-repair command: conservative deterministic fixes, then revalidation.

Snapshots first (same discipline as exec), runs geom.repair fixers, then re-runs
both check suites so the response always carries residual truth — the agent never
has to trust the fix log alone.
"""

from geom.checks import DEFAULT_POLY_BUDGET, mesh_quality_report, scene_geometry_report
from geom.repair import repair_scene
from rpc.base import WorkerError, require_live
from rpc.session import cmd_snapshot


def cmd_repair(params):
    require_live("repair")
    issues = params.get("issues")
    if issues is not None and not isinstance(issues, list):
        raise WorkerError("BadRequest", "params.issues must be a list of issue codes")
    snapshot = cmd_snapshot({"label": "auto-repair"})
    fixed, skipped = repair_scene(issues)
    geo = scene_geometry_report(DEFAULT_POLY_BUDGET)
    quality = mesh_quality_report()
    residual = geo["issues"] + quality["issues"]
    return {
        "snapshot": snapshot["id"],
        "fixed": fixed,
        "skipped": skipped,
        "residual": {"passed": geo["passed"] and quality["passed"], "issues": residual},
    }
