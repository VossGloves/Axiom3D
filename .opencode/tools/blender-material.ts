import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

type ListResult = { materials: Record<string, string> }
type ApplyResult = { name: string; material: string; slots: number }

export default tool({
  description:
    "List or apply PBR materials from the library (concrete, steel, metal, plastic, wood, glass, rubber, fabric, stone, painted). Use for surface assignment; author custom shaders via blender-exec when no library material fits.",
  args: {
    action: tool.schema.string().describe("list | apply"),
    name: tool.schema.string().optional().describe("Target mesh object name (apply mode)"),
    material: tool.schema.string().optional().describe("Material key (apply mode): concrete | steel | metal | plastic | wood | glass | rubber | fabric | stone | painted"),
  },
  async execute(args) {
    try {
      if (args.action === "list") {
        const result = await request<ListResult>("list_materials", {}, 30_000)
        return Object.entries(result.materials)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      }
      if (!args.name || !args.material) {
        return "ERROR: apply requires name and material"
      }
      const result = await request<ApplyResult>(
        "apply_material",
        { name: args.name, material: args.material },
        30_000,
      )
      return [
        `status: ok`,
        `applied ${result.material} to "${result.name}"`,
        `slots: ${result.slots}`,
      ].join("\n")
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
