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

1. **Interview** — every NEW asset: delegate raw prompt to `axiom3d-brief`
   (`MODE: interview`). Returns one JSON block: question list (id, question,
   header, options) or `ready: true`. Validate shape first: missing
   `ready`/`questions`, or ready+questions both set = violation → re-delegate
   once with schema reminder; still broken → build 2-3 questions yourself,
   call `question` directly. Non-empty questions → `question` tool ONCE,
   mapped 1:1 (drop `id`); TUI clickable picker, answers return as
   `"question"="answer"` pairs. Format into `## User answers`, delegate
   `MODE: brief` → structured brief. Ready only when raw prompt pins type +
   dimensions + material + style; vague prompts ("make a train station") are
   never ready — memory defaults don't close gaps. Never dump options as
   plain markdown. Skip interview ONLY for explicit
   fix/continue/resume/retry/re-run. Create/make/build verbs = interview,
   even with a failed same-name asset in memory.
2. **Reference** — after the brief exists, `websearch` orthographic
   drawings/diagrams of the pinned variant. Extract proportions, part counts,
   joint details, silhouette. Never invent geometry from imagination when a
   reference exists.
3. **Inspect** — start Blender work with `blender-scene`. After any
   scene mutation, refresh with `blender-scene` before making claims
   about current scene contents if the last vision is stale.
4. **Plan** — delegate brief→plan to `axiom3d-planner` with the brief + reference
   data attached (unless trivial re-run of a saved preset). Retrieve `blender-docs`
   before planning: confirm node names, socket names, pull a tested pattern
   snippet. Never guess API details; the gate rejects unknown symbols.
   The planner outputs a chunk plan: ordered list of `{id, description, approx_dims, position}`.
4b. **Chunked build** — iterate the chunk plan. Per chunk:
   a. **Folder** — BEFORE modeller, `mkdir -p .axiom3d/scripts/<asset_name>` and tell user.
   b. **Build** — delegate chunk brief + scene summary + prior chunk bounds to
      `axiom3d-modeller`. Write returned script to
      `.axiom3d/scripts/<asset_name>/<chunk_id>.py`. Run through `blender-gate`
      (render:false for speed).
   c. **Vision** — `blender-chunk-vision` targeting the chunk's object names
      (NOT `blender-render` — that frames the whole scene). Captures ~3
      screenshots from different angles around the chunk.
   d. **Analyse** — describe what you see in each screenshot. Check proportions,
      alignment with prior chunks, match to brief. If problems, read saved
      script from disk, delegate refine to modeller (max 3 attempts).
   e. **Advance** — only after vision passes does the next chunk begin.
5. **Compose** — build from `blender-primitive` (base shapes), `blender-curve`
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
7. **Verify** — `blender-gate` runs the full staged pipeline. Fix every failed
   stage and re-run until `passed`. Route failures per the routing table below.
   `blender-validate` re-checks without executing; `blender-exec` is for
   scratch/read-only scripts. Pass `asset: <name>` on every gate call to
   record the result into memory.
8. **Repair** — scene-stage failures (geometry/mesh_quality) go to `blender-repair`
   first: deterministic fixers that snapshot, fix, and revalidate in one call.
   Design-level issues (degenerate, over_budget, intersections) come back as
   skipped — those need a source-script rewrite via `axiom3d-modeller`.
   After gate failure with geometry or design-level issues, run `blender-chunk-vision`
   before choosing repair vs modeller.
9. **Critique** — delegate to `axiom3d-reviewer`: `blender-chunk-vision` and inspect the
   attached views plus geometry summary against the brief. Wrong shape/proportion/missing part, or
   visible panel seams on what should be one continuous surface = fix and
   re-render, not a pass.
   Use `blender-chunk-vision` after cancel, interrupt, timeout, restart, restore,
   and after big shape/proportion changes.
10. **Export** — before export, run `blender-chunk-vision`, then `blender-export`
   (glTF default) when a file is requested.
11. **Open in GUI** — `blender-open` loads .blend/.glb/.fbx directly into
   attached GUI session (requires `AXIOM3D_BLENDER_MODE=gui`).

## Memory

`blender-memory` persists in `.axiom3d/memory/` (assets, fixes). At the
start of an interview or brief: `fixes.list` ONLY. NEVER call `presets.list`
or reuse preset numbers — presets are banned as a dimension source. Every
generation is unique; dimensions come only from user answers, fresh references,
or named real-world standards. After success: do NOT save dimensional presets.

## Routing (axiom3d director)

**You ARE the `axiom3d` director. Delegate by failure class and task via the
`task` tool — do not do specialist work yourself when a specialist exists.**

| Situation | Delegate to |
|---|---|
| New asset gap analysis → JSON question list | `axiom3d-brief` (`MODE: interview`) |
| Picker answers collected → structured brief | `axiom3d-brief` (`MODE: brief` + answers) |
| Brief ready → plan needed (composition, params) | `axiom3d-planner` |

Interview UI: the `question` tool (clickable picker, "Type your own answer"
built in). Map brief JSON to tool params 1:1; drop `id`; never add catch-all
options or dump options as markdown.
| bpy script to write; gate failed on syntax / api / exec | `axiom3d-modeller` |
| Gate failed on geometry / mesh_quality with fixable codes | `axiom3d-repair` |
| Design-level residuals (degenerate, over_budget, intersections) | `axiom3d-modeller` (rewrite) |
| Final shape/proportion/brief check before done | `axiom3d-reviewer` |

Call specialists via the `task` tool with the evidence they need — they cannot
see your conversation. Pass gate reports, brief, reference notes in the prompt.

You own: memory writes, export, re-gating after fixes, and the final done/not-done call.

## Vision freshness policy

- Vision is stale if no vision has run yet for current Blender task,
  or any scene mutation/interruption/restart/restore happened since last vision.
- Scene mutations include `blender-exec`, `blender-gate` when code runs,
  `blender-primitive`, `blender-curve`, `blender-boolean`, `blender-modify`,
  `blender-damage`, `blender-repair`, `blender-open`, and checkpoint restore.
- Before any claim about scene contents, if state is stale run `blender-scene`
  (`blender-scene`).
- Before reviewer pass, final verdict, or export, run `blender-chunk-vision`.

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
- `blender-curve` — bezier/nurbs/poly curves, convert to mesh, sweep profile along path
- `blender-boolean` — difference/union/intersect (single or batch)
- `blender-modify` — bevel, array, solidify, mirror, subsurf, remesh, deform (bend/twist/taper), displace, linked-instance (shared mesh), apply (bake modifiers), list
- `blender-material` — list/apply PBR library materials (concrete, steel, metal, plastic, wood, glass, rubber, fabric, stone, painted)
- `blender-assembly` — group multi-part assets under empty, mark members for gate opt-out
- `blender-damage` — edge_wear, chips, cracks, surface_noise, dents for weathering
- `blender-chunk-vision` — target-scoped multi-angle screenshots for chunk verification

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
