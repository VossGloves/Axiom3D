# Axiom3D — General-Purpose Blender Modeling Harness for Opencode

Plan source of truth. Update phase checkboxes here as work completes so any session can resume.

## Context

Turn this opencode fork (github.com/madmarv10/Axiom3D) into a general-purpose AI harness
for Blender 3D asset generation. LLM-generated `bpy` scripts fail two ways: hallucinated
APIs and silent geometry failures. Fix: persistent headless Blender session + scene
introspection + staged verification gate + version-pinned API docs.

**Environment (verified 2026-10-09):**
- Windows 11, Blender 5.2 at `C:\Program Files\Blender Foundation\Blender 5.2` (not on PATH)
- Repo: opencode source, local `main` = single initial commit, upstream default branch is `dev`
- Local custom tools already exist under `.opencode/tool/*.ts` (plugin `tool()` API)

## Locked decisions

1. **Pin Blender 5.2 exactly.** Docs corpus pinned to `docs.blender.org/api/5.2/`.
2. **Persistent session** = `blender --background --python worker.py`, JSON-RPC over
   localhost TCP. Keeps exact installed Blender + addon compat. Not the `bpy` pip wheel.
3. **Checkpoints** = `.blend` snapshots to temp dir + reload. Never `bpy.ops.ed.undo`
   (unreliable in background mode).
4. **Tool layering** = project tools first (`.opencode/tool/*.ts`), promote into
   `packages/core/src/tool/` builtins only in Phase 6 after stable.
5. **Upstream sync** = add `anomalyco/opencode` as upstream remote, rebase onto `dev`
   periodically. Custom tools live in `.opencode/` so they survive rebases.
6. **No template asset library** (superseded). Agents compose from primitives/curves/
   booleans + modifier tools (`blender-modify`) with asset-specific parameters. A
   prebuilt parametric library (Phase 4, now removed) produced samey assets — every
   brief that hit a template returned the same silhouette. Visual variety comes from
   reference-driven composition in code, not preset node groups. GN node-building via
   exec remains allowed when the modeller has confirmed the API via `blender-docs`.
7. **Conventions**: 1 unit = 1 m, origin placement rules, object naming lint — enforced by
   the validator, documented in `docs/axiom3d/conventions.md`.
8. **Cut from original idea**: Sverchok (stray mention, geonodes covers it), external
   `manifold3d` (Blender 5.x has native manifold boolean solver).

## Architecture

```
Axiom3D/
├── PLAN.md                        this file
├── .opencode/
│   ├── tools/blender-*.ts         thin TS tools (Phase 2/4)
│   ├── lib/blender-client.ts      TS worker client: spawn, RPC, timeout, restart
│   └── agent/axiom3d.md           agent workflow: request -> retrieve -> plan -> exec -> gate
├── blender/                       harness core, zero opencode dependencies
│   ├── worker.py                  persistent session, JSON-RPC loop, snapshot/restore
│   ├── rpc/                       command handlers (exec, query, render, export, validate, gate, materials, modify)
│   ├── gate/                      staged verification pipeline
│   ├── geom/                      evaluated-mesh checks
│   ├── materials.py               PBR material library builders
│   ├── api_index.py               live bpy symbol index for hallucination checks
│   ├── corpus/                    live bpy introspection + pattern cookbook + breaking changes
│   └── tests/                     bun test (worker/tools/gate/modify/corpus)
└── docs/axiom3d/conventions.md    scale, origin, naming rules
```

**RPC protocol**: newline-delimited JSON over TCP `127.0.0.1`, port written to
`.axiom3d/blender.port`. Every `exec` auto-snapshots first. TS client enforces per-call
timeout; on timeout it kills and restarts the worker, restoring last snapshot.

**Gate stages (fail fast, structured JSON report with evidence):**
1. `ast.parse` syntax check
2. API symbol check against live `bpy` symbol index (`hasattr` walk of `bpy.ops`,
   `bpy.types`, `bpy.data`) — reports unknown attribute + nearest suggestion
3. Execute in session, capture stdout/stderr/traceback
4. Geometry on **evaluated** mesh (depsgraph `to_mesh()`): non-manifold edges, flipped /
   zero-area faces, bounds, polycount vs budget, UV layers, unit scale, naming lint
5. Trimesh pass (installed into Blender's bundled Python): volume, self-intersection,
   intersection between assets, export sanity
6. Export roundtrip: export glTF, re-import, compare bounds + counts
7. Multi-view render (4-6 auto-framed cameras, Workbench fast / EEVEE final) + vision
   critique by the agent against a checklist

## Phases

### Phase 0 — Bootstrap
- [x] `PLAN.md` (this file), `docs/axiom3d/conventions.md` skeleton
- [x] Add upstream remote `https://github.com/anomalyco/opencode.git`
- [x] Blender smoke script: `blender --background --factory-startup --python smoke.py`
  prints version, creates a cube, exit 0. Runnable from repo
  (`blender/tests/run-smoke.ps1`). Verified 2026-10-09: Blender 5.2.2 LTS, exit 0.
- Deliverable: one command proves headless Blender works on this machine. **DONE.**

### Phase 1 — Persistent worker
- [x] `blender/worker.py`: TCP JSON-RPC server inside Blender background process.
  Commands: `ping`, `exec`, `snapshot`, `restore`, `reset`, `query`, `render`, `export`,
  `validate`. Handlers live inline in worker.py for now (rpc/ split comes with the gate)
- [x] Timeout + kill/restart + snapshot restore in TS client
- [x] `.opencode/lib/blender-client.ts`: spawn, port discovery, RPC, Windows paths,
  request serialization (bpy is main-thread-only: worker queues jobs to a main-thread
  pump; client queues calls so parallel tools never race a restart)
- [x] Tests: `cd blender && bun test` (bun test, not pytest — root bunfig blocks test
  discovery from repo root). 11 tests: protocol, exec diff, error capture, validate,
  snapshot/restore, render PNGs, glb export, hung-exec watchdog restart+restore.
  Verified 2026-10-09: 11/11 pass, twice in a row.
- Deliverable: `client.exec("import bpy; print(bpy.app.version_string)")` round trip.
  **DONE.**

### Phase 2 — Core tools + agent
- [x] Tools: `.opencode/tools/blender-{exec,scene,checkpoint,validate,render,export}.ts`
  (hyphenated filenames — `export` is a reserved word, so file-per-tool default export;
  tool name = filename). scene = list objects/modifiers/materials/node trees; render =
  PNG attachments as `data:image/png;base64,...` (message-v2 filters non-data URLs);
  export = glTF/FBX/USD presets, relative paths resolved against `context.directory`
- [x] `.opencode/agent/axiom3d.md`: **lean** workflow prompt — inspect before guess, gate
  pass/fail loop, render-critique checklist, one-line conventions summary. Small fixed
  size; never grows with knowledge. Full conventions detail stays in
  `docs/axiom3d/conventions.md`, loaded on demand via `references` config in
  `.opencode/opencode.jsonc` — not pasted into the standing prompt. Note: reference
  paths resolve relative to `.opencode/`, so repo-root files need `../` prefix
- [x] Standing prompt carries only 1-2 always-hot idioms (snapshot-before-edit habit,
  depsgraph `evaluated_get().to_mesh()` for reading geometry). Everything else —
  library pattern cookbook — goes to retrieval (Phase 5). Reason: prompt + tool schemas
  ship with every request; heavy standing context costs tokens every turn and weakens
  rule adherence
- [x] Tool descriptions: 2-3 lines each. Usage detail goes to retrieval or `.txt` help
  files (existing opencode pattern: `packages/opencode/src/tool/*.txt`)
- [x] Tests: `cd blender && bun test` — 18/18 (tools.test.ts 7: shape check, live exec→
  scene→validate→checkpoint→render→export flow; worker.test.ts 11). Verified
  2026-10-09. `bun run dev debug agent axiom3d` shows all 6 tools enabled;
  `agent list` shows `axiom3d (primary)` with `"blender-*": allow`.
- Deliverable: ask the agent "make a 1 m crate", get a validated asset back.
  Tool-layer tests cover the flow; live opencode session check pending.

### Phase 3 — Verification gate
- [x] `blender/gate/` staged pipeline per architecture section above
      (rpc/ handler split also landed: worker.py is now transport-only)
- [x] `blender/api_index.py` symbol index builder — dir() walk (getattr on missing
      bpy.ops names does NOT raise, so hasattr lies), cached to
      `.axiom3d/api_index.json` keyed by Blender version
- [x] Install `trimesh` into Blender's bundled Python via `pip install --target`,
  pinned in `blender/requirements.txt`. Used after the evaluated-mesh checks: volume,
  watertight/winding. Intersections (self + cross-object) use Blender 5.x native
  MANIFOLD booleans through the depsgraph — in-process, no subprocess
- [x] Fixture tests per failure class (`blender/tests/gate.test.ts`): bad API name
  (with suggestion), syntax error, runtime error, non-manifold + open_surface
  opt-out, flipped face, scale violation, default/bad names, empty scene,
  self-intersecting shells, cross-object overlap, full-pipeline happy path
- Extra fixes found along the way: glTF export on 5.2 uses `export_apply`
  (old `use_mesh_modifiers` had been silently dropped by the RNA filter);
  snapshot prune is mtime-ordered (name order evicted a restarted worker's
  fresh checkpoints); test files must run single-worker
  (`bun test --parallel=1 --no-isolate`) because they share one Blender.
- Deliverable: hallucinated API name fails at stage 2 with a suggestion, never crashes
  the worker. **DONE.** Verified 2026-10-09: 31/31 (worker 11, tools 7, gate 13).

### Phase 4 — Template asset library — REMOVED (2026-10-14)

Builder scripts produced GN template groups + PBR materials under `blender/templates/`
(rail segment, sleeper array, column grid, fence run, platform outline, canopy truss,
concrete + steel). Worker commands `list_templates`/`instantiate` + a `blender-template`
agent tool. Railway-station milestone assembled from templates.

**Removed because the library produced samey assets** — every brief that hit a template
returned the same silhouette regardless of reference. Replaced by general-purpose
composition: primitives/curves/booleans + `blender-modify` (bevel, array, remesh,
deform, displace, linked-instance) with asset-specific parameters. Materials relocated
to `blender/materials.py` and expanded to a 10-entry PBR set (concrete, steel, metal,
plastic, wood, glass, rubber, fabric, stone, painted) exposed via `blender-material`.
GN node-building via `blender-exec` remains allowed when confirmed via `blender-docs`.

### Phase 5 — API doc retrieval
- `blender/corpus/` — API source is **live introspection of the installed Blender**
  (corpus/introspect.py), not a docs.blender.org fetch: reading sockets/methods straight
  from the pinned 5.2 install is version-true by construction and cannot drift from the
  runtime the way fetched docs can. Resolves human names ("Principled BSDF") to bpy.types
  node classes via camelCase-token scoring, instantiates in a throwaway tree, lists real
  sockets. Breaking changes (5.0-5.2 renames this harness hit) are hand-curated in
  corpus/breaking_changes.py
- [x] Library pattern cookbook — `blender/corpus/examples/`: tested Blender 5.2 snippets
  (depsgraph to_mesh, bmesh edit, numpy layout, mathutils Matrix + KDTree, Principled
  sockets, GN modifier inputs, boolean opening, curve sweep, radial array, detail scatter,
  composition assembly, bevel modifier, deform simple, remesh voxel, linked instance).
  Retrieved on demand via `blender_docs`, never in the standing prompt. Runtime execution
  validated by `blender/corpus/validate_patterns.py` (a build-time script — Bun.spawn of
  Blender segfaults Bun 1.4.2 on Windows, so the live check lives there, not in the bun suite)
- [x] `docs` worker command + `blender-docs` tool return introspected sockets + runnable
  pattern code + matching breaking changes, not just signatures
- [x] Wire into agent workflow: "Retrieve" step before "Plan" (axiom3d.md)
- Deliverable: query "Principled BSDF sockets in 5.2" returns the correct, version-true
  32-socket list (Base Color, Metallic, Roughness, ...) read from the live install.
  **DONE.** Verified 2026-10-09.

### Phase 6 — Promotion / packaging (after stable)
- [x] `blender-asset-authoring` skill (`.opencode/skills/blender-asset-authoring/SKILL.md`):
  the on-demand reference for the authoring workflow, gate stages + issue vocabulary,
  conventions, geometry tools, and the verified 5.2 gotchas. Complements the lean agent
  prompt (heavy detail lives here, loaded only when relevant).
- [x] CI (`.github/workflows/axiom3d.yml`): on push/PR to main — installs the pinned
  Blender 5.2.2 Linux tarball (cached), installs trimesh into its bundled Python, then
  runs `bun typecheck`, the pattern cookbook validator, and the headless Workbench test
  suite (`bun test --parallel=1 --no-isolate` from blender/). The harness tests live
  outside packages/, so the monorepo `bun turbo test` does not cover them; this
  workflow does. Renders are Workbench/CPU only (no GPU).
- Deferred — promote tools into `packages/core/src/tool/` builtins: the Blender
  tools are Axiom3D-harness-specific, not generic opencode capabilities. Pushing them
  into core would pollute the product for every user; they correctly stay as project
  tools (`.opencode/tools/`). Locked decision #4's spirit: domain tools stay local.
- Deferred — MCP server wrap: viable (the `@modelcontextprotocol/sdk` is already a
  packages/opencode dependency) but the harness is fully integrated in opencode, its
  target platform. An MCP server adds a parallel integration surface needing its own
  tests and maintenance for no current consumer. Noted as a clean future path if the
  harness is ever reused by non-opencode MCP clients.

### Phase 7 — GUI mode (attach to running Blender)
- [x] Extract transport from `worker.py` into `blender/transport.py`: socket server,
  JOBS queue, Handler, pump parameterized by mode (background blocking loop vs GUI
  `bpy.app.timers`). Port file gains `mode: "headless"|"gui"`.
- [x] `blender/addon.py`: GUI addon with N-panel (Start/Stop, port, poison status),
  auto-start timer on enable. Refuses `bpy.app.background`. Imports transport + rpc.
- [x] `blender-client.ts` attach mode: `ensure()` pings port file → attach if live GUI
  session, else spawn headless. `AXIOM3D_BLENDER_MODE=gui|headless` forces mode; unset
  auto-detects from port file. GUI mode: no kill/restart on timeout — surface error
  with recovery hint (user owns GUI process). `restart()` throws for GUI.
- Install: symlink `blender/addon.py` into Blender addons folder as `axiom3d.py`,
  enable in Preferences. Server listens on ephemeral port, writes port file, client
  attaches on next tool call.
- Safety deltas: GUI sessions never auto-restart (user process); poisoned state
  auto-clears once the main thread is free again (no Blender restart); dead addon
  TCP with live Blender falls back to a separate headless worker so tools keep
  working; snapshot-restore of unsaved work requires manual `blender-checkpoint`
  call. Soft signal timeout interrupts pure-Python hangs before hard poison.
- [x] `blender-open` tool (`.opencode/tools/blender-open.ts`): opens .blend as main
  file or imports .glb/.gltf/.fbx/.obj/.usd/.ply/.stl directly into attached GUI
  session. Requires GUI mode; errors if headless. AI prefers this over export+manual
  import when session attached.

## Verification

- `bun test --parallel=1 --no-isolate` from `blender/` (spawns a real headless Blender;
  all test files share one worker through the port file, so parallel file workers must
  stay off — they race the scene and the snapshot pool)
- `bun typecheck` from `packages/opencode` after TS changes (repo AGENTS.md rule)
- Milestone demos: crate → table (multi-part composition) → chair (bevel + material).
  Each ends with gate report JSON + multi-view render + export roundtrip pass.
- Negative test: deliberately hallucinated `bpy` attribute must fail at gate stage 2.

## Risks

- **Blender 5.2 API drift vs model training data** — core problem; mitigated by symbol
  index + pinned docs.
- **Headless EEVEE needs GPU on Windows** — Workbench fallback flag in render tool.
- **Worker crash loses scene** — snapshot before every exec, auto-restart (headless);
  GUI auto-unpoisons + headless fallback when addon TCP dies.
- **Long exec hangs Blender** — soft SIGALRM timeout for pure-Python; hard poison +
  auto-unpoison / headless fallback for C-level hangs.
- **Upstream churn** — project-tools-only surface keeps rebase pain near zero.

## Session resume protocol

1. Read this file first.
2. Update checkboxes as phases complete.
3. Next unboxed phase = current work.