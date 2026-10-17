import { tool } from "@opencode-ai/plugin"
import { request, snapshots, status } from "../lib/blender-client"

export default tool({
  description:
    "Save, list, or restore scene checkpoints (.blend snapshots). Every blender-exec also snapshots automatically — use these for manual recovery points around risky edits.",
  args: {
    action: tool.schema.string().describe("save | list | restore"),
    label: tool.schema.string().optional().describe("Label for save (e.g. before-modularization)"),
    id: tool.schema.string().optional().describe("Snapshot id, required for restore (from list or a save result)"),
  },
  async execute(args) {
    try {
      if (args.action === "list") {
        const ids = await snapshots()
        return ids.length ? ids.join("\n") : "no snapshots"
      }
      if (args.action === "save") {
        const result = await request<{ id: string; path: string }>(
          "snapshot",
          { label: args.label ?? "manual" },
          60_000,
        )
        return `saved ${result.id}`
      }
      if (args.action === "restore") {
        if (!args.id) return "ERROR: restore requires id (run action=list first)"
        const result = await request<{ restored: string; handoff?: boolean }>("restore", { id: args.id }, 60_000)
        if (result.handoff) await status()
        return `restored ${result.restored}`
      }
      return `ERROR: unknown action ${args.action}; expected save | list | restore`
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
