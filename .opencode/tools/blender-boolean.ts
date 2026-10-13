import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

type BooleanResult = {
  target: string
  cutter: string
  operation: string
  solver: string
  applied: boolean
  cutter_removed: boolean
  verts_before: number
  verts_after: number
  polys_before: number
  polys_after: number
  dimensions: number[]
}

type BatchResult = {
  target: string
  operations: Array<Record<string, unknown>>
  verts: number
  polys: number
}

export default tool({
  description:
    "Boolean operations on meshes: difference (cut), union (merge), intersect (keep overlap). Use for holes, cutouts, joining solids. Solver EXACT is stable headless; MANIFOLD can crash on multi-shell. apply=true bakes the result and removes the cutter.",
  args: {
    action: tool.schema.string().describe("single | batch"),
    target: tool.schema.string().describe("Target mesh object name (modified)"),
    cutter: tool.schema.string().optional().describe("Cutter mesh object name (single mode)"),
    operation: tool.schema
      .string()
      .optional()
      .describe("DIFFERENCE | UNION | INTERSECT (default DIFFERENCE)"),
    solver: tool.schema.string().optional().describe("EXACT | MANIFOLD (default EXACT)"),
    apply: tool.schema
      .boolean()
      .optional()
      .describe("Apply modifier and remove cutter (default true)"),
    operations: tool.schema
      .array(
        tool.schema.object({
          cutter: tool.schema.string(),
          operation: tool.schema.string().optional(),
          apply: tool.schema.boolean().optional(),
        }),
      )
      .optional()
      .describe("Batch mode: list of {cutter, operation, apply} applied in sequence"),
  },
  async execute(args) {
    try {
      if (args.action === "batch") {
        const result = await request<BatchResult>(
          "batch_boolean",
          { target: args.target, operations: args.operations, solver: args.solver },
          120_000,
        )
        return [
          `status: ok`,
          `batch boolean on "${result.target}" — ${result.operations.length} ops`,
          `final verts: ${result.verts}  polys: ${result.polys}`,
          `ops: ${JSON.stringify(result.operations)}`,
        ].join("\n")
      }
      const result = await request<BooleanResult>(
        "run_boolean",
        {
          target: args.target,
          cutter: args.cutter,
          operation: args.operation,
          solver: args.solver,
          apply: args.apply,
        },
        60_000,
      )
      return [
        `status: ok`,
        `${result.operation} ${result.target} ← ${result.cutter} (${result.solver})`,
        `applied: ${result.applied}  cutter_removed: ${result.cutter_removed}`,
        `verts: ${result.verts_before} → ${result.verts_after}  polys: ${result.polys_before} → ${result.polys_after}`,
        `dimensions: ${JSON.stringify(result.dimensions)}`,
        "Run blender-gate to verify manifold/watertight after boolean.",
      ].join("\n")
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
