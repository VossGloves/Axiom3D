import { tool } from "@opencode-ai/plugin"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const PROGRESS_FILE = join(process.cwd(), ".axiom3d", "progress.json")

async function readExisting(): Promise<Record<string, unknown>> {
  try {
    const raw = await Bun.file(PROGRESS_FILE).text()
    if (!raw.trim()) return {}
    const data = JSON.parse(raw)
    if (!data || typeof data !== "object") return {}
    return data
  } catch {
    return {}
  }
}

export default tool({
  description:
    "Update the TUI build-steps panel. Call at every step transition during an asset build. Provide steps=[...] once when the build plan is accepted, then keep step_index in sync. Later calls merge over existing state — omit unchanged fields. Call with clear=true when the build finishes or is abandoned.",
  args: {
    asset: tool.schema.string().optional().describe("Asset name shown in the panel"),
    step: tool.schema.string().optional().describe('Current step, e.g. "Building canopy"'),
    step_index: tool.schema.number().optional().describe("1-based index of current step in steps[]"),
    step_total: tool.schema.number().optional().describe("Total steps (defaults to steps.length)"),
    steps: tool
      .schema.array(tool.schema.string())
      .optional()
      .describe("Full ordered step list for this build, declared once when the plan is accepted"),
    status: tool.schema.string().optional().describe('Short status, e.g. "building", "gate passed"'),
    detail: tool.schema.string().optional().describe("Extra detail line"),
    clear: tool.schema.boolean().default(false).describe("Clear the panel (end of build)"),
  },
  async execute(args) {
    await mkdir(join(process.cwd(), ".axiom3d"), { recursive: true })
    if (args.clear) {
      await Bun.write(PROGRESS_FILE, "")
      return "progress panel cleared"
    }
    const progress = await readExisting()
    if (args.asset) progress.asset = args.asset
    if (args.step) progress.step = args.step
    if (args.step_index !== undefined) progress.step_index = args.step_index
    if (args.steps) {
      progress.steps = args.steps
      progress.step_total = args.steps.length
    }
    if (args.step_total !== undefined) progress.step_total = args.step_total
    if (args.status) progress.status = args.status
    if (args.detail) progress.detail = args.detail
    const changed = [args.asset, args.step, args.step_index, args.step_total, args.steps, args.status, args.detail].some(
      (v) => v !== undefined,
    )
    if (!changed) return "ERROR: provide at least one field or clear=true"
    await Bun.write(PROGRESS_FILE, JSON.stringify(progress))
    return `progress updated: ${Object.entries(progress).map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.length} steps]` : v}`).join(" ")}`
  },
})
