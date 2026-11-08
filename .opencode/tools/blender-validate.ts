import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

export default tool({
  description:
    "Check the scene against Axiom3D conventions: unit scale, snake_case naming, applied transforms, UVs, manifold geometry, poly budget, materials (colored by default). Returns pass/fail with an issue list. Run after every modelling exec and fix all issues.",
  args: {
    require_material: tool.schema
      .boolean()
      .default(true)
      .describe("Flag meshes with no material; set false when the user asked for uncolored assets"),
  },
  async execute(args) {
    try {
      const report = await request<{ phase: string; issues: unknown[]; passed: boolean }>(
        "validate",
        { require_material: args.require_material ?? true },
        120_000,
      )
      return JSON.stringify(report, null, 2)
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
