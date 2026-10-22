import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

type SdfResult = {
  name: string
  verts: number
  polys: number
  bounds_min?: number[]
  bounds_max?: number[]
  bounds_expanded?: boolean
  bounds_clipped?: boolean
  resolution_reduced?: boolean
}

type SdfStatus = {
  available: boolean
  error: string | null
  install: string
}

const NODE_SPEC = [
  "Node kinds:",
  "  {kind:'primitive', shape:'sphere|box|rounded_box|cylinder|cone|torus', params:{...}, location?, rotation_deg?, scale?}",
  "  params: sphere {radius}, box {size:[x,y,z]}, rounded_box {size, radius}, cylinder {radius, depth}, cone {radius1, depth}, torus {major_radius, minor_radius}",
  "  {kind:'csg', op:'union|difference|intersection', blend:0, children:[node,node,...]}  blend>0 = smooth blend (meters)",
  "  {kind:'shell', offset:0.05, child:node}",
  "  {kind:'twirl', axis:'x|y|z', amount_deg:90, radius:1, center?, child:node}",
  "  {kind:'taper', base?:[0,0,0], height:1, scale:0.5, base_scale?:1, child:node}",
  "  {kind:'attract'|'repel', locus:[0,0,0], radius:0.5, exaggerate?:1, axes?:'xyz|x|y|z|xy|xz|yz', child:node}",
  "  {kind:'symmetry', axis:'x|y|z', blend:0, child:node}",
  "Node transforms (location/rotation_deg/scale) apply after the node's own content.",
].join("\n")

export default tool({
  description:
    "Build one organic mesh from a JSON SDF spec: shapes fuse with smooth blends (clay-like fillets instead of boolean seams), hollow shell, warps (twirl/taper/attract/repel/symmetry). Non-destructive: edit spec numbers and re-run to rebuild. Output is a normal mesh — run blender-validate or blender-gate after. Prefer for organic/fused forms; blender-boolean stays for hard cuts.\n" +
    NODE_SPEC,
  args: {
    spec: tool.schema
      .record(tool.schema.string(), tool.schema.any())
      .describe("Root spec node (recursive dict, see tool description for kinds)"),
    name: tool.schema.string().optional().describe("Object name (snake_case)"),
    resolution: tool.schema
      .number()
      .optional()
      .describe("Cells per meter, 4..512 (default 32). Vertex budget 100000; tool auto-reduces once then errors"),
    bounds_min: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("Explicit meshing bounds min [x,y,z]; omit to derive from spec AABB (+ blend pad)"),
    bounds_max: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("Explicit meshing bounds max [x,y,z]; must pair with bounds_min"),
    material: tool.schema.string().optional().describe("Library material key: concrete | steel | metal | plastic | wood | glass | rubber | fabric | stone | painted"),
  },
  async execute(args) {
    try {
      const status = await request<SdfStatus>("sdf_status", {}, 15_000)
      if (!status.available)
        return `ERROR: ${status.error}\nInstall once: ${status.install} — then restart the Blender worker.`
      const result = await request<SdfResult>("sdf_build", args as Record<string, unknown>, 120_000)
      const notes = [
        result.bounds_expanded ? "note: auto-bounds expanded once (spec extended past first estimate)" : "",
        result.bounds_clipped
          ? "WARN: surface touches bounds — geometry may be cut; pass explicit bounds_min/bounds_max with margin"
          : "",
        result.resolution_reduced ? `note: resolution auto-reduced to ${result.resolution} for the 100k vertex budget` : "",
        result.verts > 90_000 ? "near vertex budget (100000) — gate may fail; lower resolution if so" : "",
      ].filter(Boolean)
      return [
        `status: ok`,
        `created ${result.name}  verts: ${result.verts}  polys: ${result.polys}`,
        `dimensions: ${JSON.stringify(result.dimensions)}  resolution: ${result.resolution} cells/m`,
        `bounds: ${JSON.stringify(result.bounds_min)} -> ${JSON.stringify(result.bounds_max)}`,
        ...notes,
        "Run blender-validate or blender-gate to confirm it is clean before composing.",
      ].join("\n")
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
