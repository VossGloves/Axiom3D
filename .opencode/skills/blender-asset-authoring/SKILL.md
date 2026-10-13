---
name: blender-asset-authoring
description: Author 3D assets in Blender 5.2 via the Axiom3D harness — templates, staged gate verification, live API docs. Use when building, validating, or exporting Blender geometry.
---

# Blender Asset Authoring

Generate and verify 3D assets through the persistent headless Blender 5.2 worker.
Every claim about the scene comes from a tool, never from memory.

## Workflow

1. **Retrieve** — `blender-docs` before planning. Confirm node names, socket names,
   and pull a tested pattern snippet. Never guess API details; the gate rejects
   unknown symbols with a suggestion.
2. **Template first** — for railway/station parts (rail, sleepers, columns, fence,
   platform, canopy truss) call `blender-template` to instantiate a parametric,
   grounded, UV'd, gate-clean mesh. Set parameters; do not rebuild geometry.
3. **Compose** — position instances with `blender-exec`/`blender-gate`. Keep parts
   non-intersecting (the gate flags object overlap): hairline gaps are fine.
4. **Verify** — `blender-gate` runs the full staged pipeline. Fix every failed
   stage and re-run until `passed`. `blender-validate` re-checks the current scene
   without executing; `blender-exec` is for scratch/read-only scripts. Pass
   `asset: <name>` on every gate call to record the result into memory.
5. **Repair** — scene-stage failures (geometry/mesh_quality) go to `blender-repair`
   first: conservative deterministic fixers (naming, scale, UVs, zero-area faces,
   normals, duplicate verts, unit settings) that snapshot, fix, and revalidate in
   one call. Design-level issues (degenerate, over_budget, intersections) come back
   as skipped — those need a source-script rewrite, not a mesh patch.
6. **Critique** — `blender-render` and inspect the attached views against the brief.
7. **Export** — `blender-export` (glTF default) when a file is requested.
8. **Open in GUI** — `blender-open` loads .blend/.glb/.fbx directly into attached
   GUI session (requires `AXIOM3D_BLENDER_MODE=gui`). Prefer over export+manual
   import when a live Blender session is attached.

## Memory

`blender-memory` persists in `.axiom3d/memory/` (presets, assets, fixes). At the
start of a brief: `presets.list` + `assets.get <name>` to reuse prior params and
learn why the last gate failed. After success: `presets.save` the param set.
`fixes.list` shows which repair strategies historically worked.

## Routing (axiom3d director)

The `axiom3d` director delegates: brief→plan to `axiom3d-planner`, script work and
syntax/api/exec failures to `axiom3d-modeller`, scene-stage repair to
`axiom3d-repair`, final critique to `axiom3d-reviewer`. Call specialists via the
`task` tool with the evidence they need — they cannot see your conversation.

## Gate stages

`syntax` → `api` → `exec` fail fast (a script that does not parse/run stops here).
`geometry` → `mesh_quality` → `export_roundtrip` → `render` all run and accumulate
evidence. The report is JSON: `passed`, `failed_stage`, and per-stage `issues`.

Issue vocabulary (fix all errors):
- geometry: `unit_scale`, `no_unit_system`, `default_name`, `bad_naming`,
  `unapplied_scale`, `degenerate`, `missing_uv`, `over_budget`, `non_manifold`,
  `zero_area_faces`, `flipped_faces`, `no_mesh_objects`
- mesh_quality: `not_watertight` (warning), `inconsistent_winding`, `zero_volume`,
  `inverted_volume`, `self_intersection`, `object_intersection`, `boolean_failed`
- roundtrip: `roundtrip_empty`, `roundtrip_object_count`, `roundtrip_bounds`,
  `roundtrip_tris`

## Conventions (full spec: docs/axiom3d/conventions.md)

- 1 unit = 1 meter; scene scale_length = 1.0; no applying scale to hit a number.
- Origin at the asset base (ground contact); nothing floating or sunk.
- snake_case names, no default names (`Cube.001`). Pattern `<type>_<domain>_<detail>`.
- Transforms applied (scale/rotation = 1/0). Read geometry through the evaluated
  mesh: `depsgraph = bpy.context.evaluated_depsgraph_get()` then
  `mesh = obj.evaluated_get(depsgraph).to_mesh()`.
- Manifold, no flipped/zero-area faces, UV layer on every mesh, poly budget 100k.
  Opt-outs: `obj["open_surface"] = True` (intentional open surface),
  `obj["assembly"] = True` (multi-part asset whose members overlap at joints).
- glTF export applies modifiers (`export_apply` on 5.2).

## Templates

`blender-template` with no args lists the library + inputs/defaults. Instantiate
with a template name + params (+ optional `name`, `material: concrete|steel`):
rail_segment, sleeper_array, column_grid, fence_run, platform_outline, canopy_truss.
Each bakes to a real, grounded, UV'd mesh.

## Blender 5.2 gotchas (verified, these drift across versions)

- GN modifier inputs are NOT idproperties: set via
  `mod.properties.inputs[<identifier>]["value"]`, and coerce numbers to float
  (an int does not stick on a float slot).
- glTF exporter uses `export_apply` (not `use_mesh_modifiers`).
- Curve Tangent node is `GeometryNodeInputTangent`.
- Prefer the EXACT boolean solver for reliability; MANIFOLD can crash on
  multi-shell input.
- Snapshot before risky edits (the tools do this automatically); on hard timeout
  the headless worker restores the last checkpoint, or the GUI session auto-recovers
  once the main thread frees.

## Resources

- conventions: `docs/axiom3d/conventions.md`
- pattern cookbook: `blender/corpus/examples/` (validated by
  `blender/corpus/validate_patterns.py`)
- harness plan/architecture: `PLAN.md`
