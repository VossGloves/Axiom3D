import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"
import { recordGate } from "../lib/asset-memory"

export type GateStage = {
  name: string
  passed: boolean
  skipped?: boolean
  issues?: Array<Record<string, unknown>>
  detail?: Record<string, unknown>
}

export type GateReport = {
  passed: boolean
  failed_stage: string | null
  blender_version: string
  duration_ms: number
  stages: GateStage[]
}

export default tool({
  description:
    "Run a bpy script through the staged verification gate: syntax, API-symbol check against the live Blender 5.2 index, in-session execution, evaluated-mesh geometry, trimesh quality + intersections, glTF roundtrip, multi-view renders. Returns the JSON gate report; fix every failed stage and re-run until passed.",
  args: {
    code: tool.schema.string().describe("Python (bpy) source to verify and execute"),
    timeout: tool.schema
      .number()
      .default(300)
      .describe("Seconds the gate may run before the worker answers with a timeout error"),
    render: tool.schema
      .boolean()
      .default(true)
      .describe("Include the multi-view Workbench render stage; disable for fast failure loops"),
    export_roundtrip: tool.schema
      .boolean()
      .default(true)
      .describe("Include the glTF export/re-import comparison stage; disable for fast failure loops"),
    asset: tool.schema
      .string()
      .optional()
      .describe("Asset name to record this gate result into memory (.axiom3d/memory/assets.json)"),
  },
  async execute(args) {
    const timeout = args.timeout ?? 300
    try {
      const report = await request<GateReport>(
        "gate",
        { code: args.code, timeout, render: args.render, export_roundtrip: args.export_roundtrip },
        (timeout + 60) * 1000,
      )
      if (args.asset) {
        await recordGate(args.asset, report as unknown as Record<string, unknown>).catch(() => {})
      }
      return JSON.stringify(report, null, 2)
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
