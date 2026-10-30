import { tool } from "@opencode-ai/plugin"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const PLAN_FILE = join(process.cwd(), ".axiom3d", "asset-plan.json")

async function readExisting(): Promise<Record<string, unknown>> {
  try {
    const raw = await Bun.file(PLAN_FILE).text()
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
    "Declare and update the asset plan shown in the Axiom Menu. Call once with asset + steps[]. Then keep step_index in sync at every step transition. Later calls merge over existing state — omit unchanged fields. Call with clear=true when the asset build finishes or is abandoned.",
  args: {
    asset: tool.schema.string().optional().describe("Asset name shown in the menu"),
    steps: tool
      .schema.array(tool.schema.string())
      .optional()
      .describe("Full ordered step list, declared once when the plan is created"),
    step_index: tool.schema.number().optional().describe("1-based index of current step in steps[]"),
    step: tool.schema.string().optional().describe('Current step label, e.g. "Building canopy"'),
    status: tool.schema.string().optional().describe('Short status, e.g. "building", "gate passed"'),
    detail: tool.schema.string().optional().describe("Extra detail line"),
    clear: tool.schema.boolean().default(false).describe("Clear the plan (end of build)"),
  },
  async execute(args) {
    await mkdir(join(process.cwd(), ".axiom3d"), { recursive: true })
    if (args.clear) {
      await Bun.write(PLAN_FILE, "")
      return "asset plan cleared"
    }
    const plan = await readExisting()
    if (args.asset) plan.asset = args.asset
    if (args.steps) plan.steps = args.steps
    if (args.step_index !== undefined) plan.step_index = args.step_index
    if (args.step) plan.step = args.step
    if (args.status) plan.status = args.status
    if (args.detail) plan.detail = args.detail
    const changed = [args.asset, args.steps, args.step_index, args.step, args.status, args.detail].some((v) => v !== undefined)
    if (!changed) return "ERROR: provide at least one field or clear=true"
    await Bun.write(PLAN_FILE, JSON.stringify(plan))
    return `asset plan updated: ${Object.entries(plan)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.length} steps]` : v}`)
      .join(" ")}`
  },
})
