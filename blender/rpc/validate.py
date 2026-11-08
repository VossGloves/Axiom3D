"""Scene-only validation: the same evaluated-mesh checks the gate runs as stage 4,
minus script execution. For re-checking the current scene between gate runs."""

from geom.checks import DEFAULT_POLY_BUDGET, scene_geometry_report


def cmd_validate(params):
    poly_budget = int(params.get("poly_budget", DEFAULT_POLY_BUDGET))
    require_material = bool(params.get("require_material", True))
    report = scene_geometry_report(poly_budget, require_material=require_material)
    return {"phase": "basic", "issues": report["issues"], "passed": report["passed"]}