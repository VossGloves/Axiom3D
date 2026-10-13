import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"
import { recordFixOutcome } from "../lib/asset-memory"

type RepairEntry = { object: string; issue: string; action?: string; reason?: string }
type RepairResult = {
  snapshot: string
  fixed: RepairEntry[]
  skipped: RepairEntry[]
  residual: { passed: boolean; issues: Array<Record<string, unknown>> }
}

export default tool({
  description:
    "Conservative auto-repair of the current scene: renames to snake_case, applies scale, adds box-project UVs, deletes zero-area faces, recalculates normals, merges duplicate verts, fixes unit settings. Never touches design-level issues (degenerate, over_budget, intersections) — those come back as skipped. Snapshots first, revalidates after. Pass the issue codes from a failed gate report, or omit to run all fixers.",
  args: {
    issues: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Issue codes to fix (from a gate report); omit to run every fixer"),
  },
  async execute(args) {
    try {
      const result = await request<RepairResult>(
        "repair",
        args.issues ? { issues: args.issues } : {},
        120_000,
      )
      if (result.residual.passed && result.fixed.length > 0) {
        for (const entry of result.fixed) {
          await recordFixOutcome(entry.issue, entry.action ?? "auto", true).catch(() => {})
        }
      }
      return JSON.stringify(result, null, 2)
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
