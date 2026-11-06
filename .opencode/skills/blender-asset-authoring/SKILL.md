---
name: blender-asset-authoring
description: Author 3D assets in Blender 5.2 via the Axiom3D harness — staged gate verification, live API docs, general-purpose modeling tools. Use when building, validating, or exporting Blender geometry.
---

# Blender Asset Authoring

Generate and verify 3D assets through the persistent headless Blender 5.2 worker.
Every claim about the scene comes from a tool, never from memory.

## Workflow

**Mandatory: you are the `axiom3d` director. Delegate via `task` — do not do
specialist work yourself when a specialist exists.**

One-pass build — the raw prompt is the brief:

1. **Inspect memory + scene** — `blender-memory` `fixes.list` once (learn why
   the last gate failed and which fix worked; NEVER `presets.list` — presets are
   banned as a dimension source). `blender-scene` once before any assumption
   about current scene state. Refining an asset already in the scene? Run
   `blender-diff <asset>` too: `diverged` or `known:false` = live scene holds
   manual/unknown state → Refine branch below, scene is source of truth.
2. **Reference numbers** — ONE `websearch` for dimensions only when the prompt
   lacks them. State assumptions in one line to the user and build.
3. **Plan UI** — `asset-plan` + `axiom3d-progress` with a 3-step plan
   (Build → Gate → Done).
4. **Build** — ONE `axiom3d-modeller` delegation covering the WHOLE asset as a
   single script → `.axiom3d/scripts/<asset>/build.py` — FRESH builds only.
   Use the `write-script` tool to create the file (never embed the full script
   in a `blender-exec` code arg). No chunk plan, no chunk folders. Run the
   script through `blender-gate` ONCE (render:true for final verify;
   render:false only for fast syntax probes). Fix every failure INLINE in this
   session — never fan out `task` fix loops. Do NOT re-run gate on small tweaks;
   use targeted `blender-exec` edits on the named objects for quick probes, and
   save one full gate for the final verify. NEVER re-run the whole build script
   as a probe — it recreates its objects and wipes manual GUI edits.
5. **Compose** — build from `blender-primitive` (base shapes), `blender-sdf`
   (organic forms that must read as one skin: smooth blend unions/differences,
   shell, twirl/taper/attract warps), `blender-curve`
   (pipes, cables, organic paths), `blender-boolean` (cutouts/unions). Use
   `blender-assembly` for multi-part assets. When forms should read as one skin,
   boolean-union or remesh them; do not leave stacked coplanar boxes that read
   like Lego pieces. Set transforms; author each asset's specific proportions and
   part counts in code.
6. **Detail pass** — after basic shape passes gate, add visual density:
   `blender-modify` for bevel/remesh/deform/instance; `ops.bevel_all_boxes()` or
   `ops.add_bevel(obj)` for soft edges (width 0.005m, angle-limited);
   `ops.smooth_by_angle(obj)` when you need cleaner shading without rounding;
   `ops.scatter_details()` for bolts/brackets; `ops.scatter_edge_bolts()`
   for industrial fasteners; `blender-damage` for weathering/wear when the brief
   calls for aged/distressed surfaces.
7. **Verify** — `blender-gate` runs the full staged pipeline ONCE per build
   (render:true). Fix every failed stage and re-run ONLY if the fix changed
   geometry materially — for small tweaks use `blender-exec` probe. Route
   failures per the routing table below. `blender-validate` re-checks without
   executing; `blender-exec` is for scratch/read-only scripts. Pass
   `asset: <name>` on every gate call to record the result into memory.
   `blender-docs` results are cached per query — repeat lookups are instant.
8. **Repair** — scene-stage failures (geometry/mesh_quality) go to `blender-repair`
   first: deterministic fixers that snapshot, fix, and revalidate in one call.
   Design-level issues (degenerate, over_budget, intersections) come back as
   skipped — those need a source-script rewrite via `axiom3d-modeller`.
   After gate failure with geometry or design-level issues, run `blender-chunk-vision`
   before choosing repair vs modeller. NO vision on the happy path — only after
   a gate geometry / mesh_quality / design failure: one `blender-chunk-vision`
   to see the defect.
9. **Export** — gate passes = done. Before export, run
   `blender-chunk-vision`, then `blender-export` (glTF default) when a file is
   requested.
10. **Open in GUI** — `blender-open` loads .blend/.glb/.fbx directly into
    attached GUI session (requires `AXIOM3D_BLENDER_MODE=gui`).

## Refine (manual-edit preservation)

The live scene may contain edits the user made by hand in the Blender GUI.
Those edits survive only if nothing recreates their objects.

- `build.py` is the recipe, never current state. While the asset exists in the
  scene, NEVER re-run it (no `blender-gate` on it, no
  `exec(open(".../build.py").read())`).
- Refine = ONE patch script `.axiom3d/scripts/<asset>/patch_<slug>.py` (via
  `axiom3d-modeller`): creates new objects, modifies ONLY director-named
  targets, never clears the scene, never deletes objects it did not create in
  the same script.
- New scripts must not contain a scene-wide clear (`_clear_scene()`,
  `read_factory_settings`, deleting every object). Scope cleanup to objects the
  script itself owns.
- Full rebuild only on an explicit user "rebuild from scratch".
- A passing gate with `asset: <name>` re-anchors the stored fingerprint baseline
  — keep passing it so the next session can detect edits.

## Memory

`blender-memory` persists in `.axiom3d/memory/` (assets, fixes). At the start
of a build: `fixes.list` ONLY. NEVER call `presets.list` or reuse preset
numbers — presets are banned as a dimension source. Every generation is unique;
dimensions come only from the prompt, fresh websearch results, or named
real-world standards. After success: do NOT save dimensional presets.

## Routing (axiom3d director)

**You ARE the `axiom3d` director. Delegate by failure class and task via the
`task` tool — do not do specialist work yourself when a specialist exists.**

| Situation | Delegate to |
|---|---|
| bpy script to write; gate failed on syntax / api / exec | `axiom3d-modeller` |
| Gate failed on geometry / mesh_quality with fixable codes | `axiom3d-repair` |
| Design-level residuals (degenerate, over_budget, intersections) | `axiom3d-modeller` (rewrite) |

Call specialists via the `task` tool with the evidence they need — they cannot
see your conversation. Pass gate reports in the prompt.

You own: memory writes, export, re-gating after fixes, and the final done/not-done call.

## Vision freshness policy

- Vision is stale if no vision has run yet for current Blender task,
  or any scene mutation/interruption/restart/restore happened since last vision.
- Scene mutations include `blender-exec`, `blender-gate` when code runs,
  `blender-primitive`, `blender-sdf`, `blender-curve`, `blender-boolean`,
  `blender-modify`, `blender-damage`, `blender-repair`, `blender-open`, and checkpoint restore.
- Before any claim about scene contents, if state is stale run `blender-scene`
  (`blender-scene`).
- After gate failure with geometry or design-level issues, run `blender-chunk-vision`
  before routing repair vs modeller.
- Before final verdict or export, run `blender-chunk-vision`.

## Gate stages

`syntax` → `api` → `exec` fail fast (a script that does not parse/run stops here).
`geometry` → `mesh_quality` → `export_roundtrip` → `render` all run and accumulate
evidence. The report is JSON: `passed`, `failed_stage`, and per-stage `issues`.

Issue vocabulary (fix all errors):
- geometry: `unit_scale`, `no_unit_system`, `default_name`, `bad_naming`,
  `unapplied_scale`, `degenerate`, `missing_uv`, `over_budget`, `non_manifold`,
  `zero_area_faces`, `flipped_faces`, `no_mesh_objects`
- mesh_quality: `not_watertight` (warning), `inconsistent_winding`, `zero_volume`,
  `inverted_volume`, `self_intersection`, `object_intersection`, `floating_component`,
  `boolean_failed`
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
  Joined multi-part meshes must be one touch-connected component group —
  gaps between parts fail `floating_component` (assembly opts out of overlap
  only, never gaps; rare intentional islands: `obj["disconnected_parts"] = True`).
  Place joints from half-extents (`center = face ± (half_a + half_b)`), never
  freehand relative offsets.
- glTF export applies modifiers (`export_apply` on 5.2).

## Geometry Tools

- `blender-primitive` — cube, sphere, cylinder, cone, torus, plane, circle, grid
- `blender-sdf` — organic mesh from JSON SDF spec: smooth blend union/difference/intersection, shell, twirl/taper/attract/repel/symmetry (one-time `./blender/install-libfive.sh`; auto-reduces resolution to the 100k vertex budget, min floor 16 cells/m, thin-geometry res bump <0.1m span). Organic rules: clumps = 8-12 varied spheres blend 0.05-0.10m; limbs = cone + taper base_scale 2-3x min radius 0.02m; post-pass damage/displace/material; span >4m chunk 2-3 builds.
- `blender-curve` — bezier/nurbs/poly curves, convert to mesh, sweep profile along path
- `blender-boolean` — difference/union/intersect (single or batch)
- `blender-modify` — bevel, array, solidify, mirror, subsurf, remesh, deform (bend/twist/taper), displace, linked-instance (shared mesh), apply (bake modifiers), list
- `blender-material` — list/apply PBR library materials (concrete, steel, metal, plastic, wood, glass, rubber, fabric, stone, painted)
- `blender-assembly` — group multi-part assets under empty, mark members for gate opt-out
- `blender-damage` — edge_wear, chips, cracks, surface_noise, dents for weathering
- `blender-chunk-vision` — target-scoped multi-angle screenshots for visual inspection
- `blender-diff` — live scene vs stored fingerprint from last passing gate; reports added/removed/changed objects (manual-edit detection, gate on refine)

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
  `blender/corpus/validate_patterns.py`) — API patterns only, NEVER copy
  asset designs from here; every generation is fresh
- harness plan/architecture: `PLAN.md`