# Axiom3D Scene Conventions

Enforced by `blender_validate` (gate stage 4). Agent prompt carries the summary; this file
is the full spec, loaded on demand via `references` config in `.opencode/opencode.jsonc`.

## Status

Finalized in Phase 3 alongside the gate implementation. Enforced by `blender_validate`
(scene lint) and gate stages 4 (geometry) + 5 (mesh quality); the gate report carries
the issue vocabulary below as structured evidence.

## Scale

- 1 unit = 1 meter, always. Scene unit scale = 1.0.
- No applying scale to hit a number: author geometry at final size.
- Asset bounds check: declared dimensions vs measured bounds within 1% tolerance.

## Origin

- Origin at asset logical base: ground-plane contact point for props, center of footprint
  for buildings/structures.
- Ground plane = Z 0. No floating assets, no sunk geometry.
- Applied transforms: location at creation point, rotation/scale zeroed after apply.

## Naming

- Pattern: `<type>_<domain>_<detail>` in snake_case, e.g. `crate_warehouse_shipping`,
  `table_office_desk`, `chair_kitchen_01`.
- Types (open-ended, pick closest): `prop`, `furniture`, `vehicle`, `building`,
  `structure`, `nature`, `industrial`, `character_prop`, `container`, `tool`,
  `camera`, `light`, `material`.
- No default names survive (`Cube.001`, `Material.007`) — validator fails them.

## Mesh health

- Manifold: no non-manifold edges (except intentional open surfaces: declared via
  `["open_surface"]` custom property).
- No self-intersection: separate shells must not overlap (except intentional
  multi-part assemblies — declared via the `["assembly"]` custom property;
  set on any multi-part object whose members overlap at joints).
- No floating parts: a joined multi-part mesh must form one touch-connected
  component group — every shell touches or overlaps another via AABB contact.
  A gap between intended joints fails `floating_component`. The `assembly`
  opt-out covers overlap only, never gaps. Rare intentional islands: declare
  via `["disconnected_parts"]` custom property.
- Contact placement: derive joint positions from half-extents
  (`center = face ± (half_a + half_b)`); never freehand relative offsets for
  faces that must touch.
- No zero-area faces, no flipped normals, triangulated consistently.
- UV layer present on every renderable mesh.
- Poly budget per asset class: default cap is 100,000 evaluated verts per mesh
  (gate param `poly_budget` overrides).

## Materials

- Pick from the library first via `blender-material` (concrete, steel, metal,
  plastic, wood, glass, rubber, fabric, stone, painted); author procedural
  ad-hoc material only when no library entry fits, and expose base
  color/roughness/metallic as node group inputs.

## Export

- glTF default, 1 unit = 1 m, Y-up handled by exporter, apply modifiers before export
  (`export_apply` on Blender 5.2's glTF exporter).
- Roundtrip check (gate stage 6) must pass: mesh object count exact, world bounds
  within 1%, triangle count within 1%. Vertex counts are reported but not compared —
  the glTF exporter splits vertices per unique normal/UV, so they change legitimately
  across a roundtrip.
