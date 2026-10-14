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

1. **Reference** — `websearch` for orthographic drawings/diagrams of the target
   asset before planning. Extract proportions, part counts, joint details,
   silhouette. Never invent geometry from imagination when a reference exists.
2. **Plan** — delegate brief→plan to `axiom3d-planner` with the reference data
   attached (unless trivial re-run of a saved preset). Retrieve `blender-docs`
   before planning: confirm node names, socket names, pull a tested pattern
   snippet. Never guess API details; the gate rejects unknown symbols.
3. **Compose** — build from `blender-primitive` (base shapes), `blender-curve`
   (pipes, cables, organic paths), `blender-boolean` (cutouts/unions). Use
   `blender-assembly` for multi-part assets. Set transforms; author each asset's
   specific proportions and part counts in code.
4. **Detail pass** — after basic shape passes gate, add visual density:
   `blender-modify` for bevel/remesh/deform/instance; `ops.bevel_all_boxes()` or
   `ops.add_bevel(obj)` for soft edges (width 0.005m, angle-limited);
   `ops.scatter_details()` for bolts/brackets; `ops.scatter_edge_bolts()`
   for industrial fasteners; `blender-damage` for weathering/wear when the brief
   calls for aged/distressed surfaces.
5. **Verify** — `blender-gate` runs the full staged pipeline. Fix every failed
   stage and re-run until `passed`. Route failures per the routing table below.
   `blender-validate` re-checks without executing; `blender-exec` is for
   scratch/read-only scripts. Pass `asset: <name>` on every gate call to
   record the result into memory.
6. **Repair** — scene-stage failures (geometry/mesh_quality) go to `blender-repair`
   first: deterministic fixers that snapshot, fix, and revalidate in one call.
   Design-level issues (degenerate, over_budget, intersections) come back as
   skipped — those need a source-script rewrite via `axiom3d-modeller`.
7. **Critique** — delegate to `axiom3d-reviewer`: `blender-render` and inspect the
   attached views against the brief. Wrong shape/proportion/missing part =
   fix and re-render, not a pass.
8. **Export** — `blender-export` (glTF default) when a file is requested.
9. **Open in GUI** — `blender-open` loads .blend/.glb/.fbx directly into
   attached GUI session (requires `AXIOM3D_BLENDER_MODE=gui`).

## Memory

`blender-memory` persists in `.axiom3d/memory/` (presets, assets, fixes). At the
start of a brief: `presets.list` + `assets.get <name>` to reuse prior params and
learn why the last gate failed. After success: `presets.save` the param set.
`fixes.list` shows which repair strategies historically worked.

## Routing (axiom3d director)

**You ARE the `axiom3d` director. Delegate by failure class and task via the
`task` tool — do not do specialist work yourself when a specialist exists.**

| Situation | Delegate to |
|---|---|
| New brief → plan needed (composition, params) | `axiom3d-planner` |
| bpy script to write; gate failed on syntax / api / exec | `axiom3d-modeller` |
| Gate failed on geometry / mesh_quality with fixable codes | `axiom3d-repair` |
| Design-level residuals (degenerate, over_budget, intersections) | `axiom3d-modeller` (rewrite) |
| Final shape/proportion/brief check before done | `axiom3d-reviewer` |

Call specialists via the `task` tool with the evidence they need — they cannot
see your conversation. Pass gate reports, brief, reference notes in the prompt.

You own: memory writes, export, re-gating after fixes, and the final done/not-done call.

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

## Geometry Tools

- `blender-primitive` — cube, sphere, cylinder, cone, torus, plane, circle, grid
- `blender-curve` — bezier/nurbs/poly curves, convert to mesh, sweep profile along path
- `blender-boolean` — difference/union/intersect (single or batch)
- `blender-modify` — bevel, array, solidify, mirror, subsurf, remesh, deform (bend/twist/taper), displace, linked-instance (shared mesh), apply (bake modifiers), list
- `blender-material` — list/apply PBR library materials (concrete, steel, metal, plastic, wood, glass, rubber, fabric, stone, painted)
- `blender-assembly` — group multi-part assets under empty, mark members for gate opt-out
- `blender-damage` — edge_wear, chips, cracks, surface_noise, dents for weathering

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
