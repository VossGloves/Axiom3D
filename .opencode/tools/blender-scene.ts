import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

export default tool({
  description:
    "Inspect the live Blender scene: objects, modifiers, materials, node groups, units, engine. Call this before assuming any scene state — never guess what is in the scene.",
  args: {
    kind: tool.schema
      .string()
      .default("summary")
      .describe("summary | objects | geometry | materials | node_groups"),
  },
  async execute(args) {
    try {
      const result = await request<Record<string, unknown>>("query", { kind: args.kind }, 60_000)
      return JSON.stringify(result, null, 2)
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
