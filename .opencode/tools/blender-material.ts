import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

type ListResult = { materials: Record<string, string> }
type ApplyResult = { name: string; material: string; slots: number; snapshot?: string }

export default tool({
  description:
    "List or apply PBR materials from the library (concrete, steel, metal, plastic, wood, glass, rubber, fabric, stone, painted). Use for surface assignment; pass color to tint a library material (any hex, e.g. #ff8800) for multi-color assets; author custom shaders via blender-exec when no library material fits.",
  args: {
    action: tool.schema.string().describe("list | apply"),
    name: tool.schema.string().optional().describe("Target mesh object name (apply mode)"),
    material: tool.schema
      .string()
      .optional()
      .describe("Material key (apply mode): concrete | steel | metal | plastic | wood | glass | rubber | fabric | stone | painted"),
    color: tool.schema
      .string()
      .optional()
      .describe("Optional tint (apply mode): #rrggbb — creates/reuses variant axiom3d_<key>_<hex>, keeps key's roughness/metallic"),
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
        { name: args.name, material: args.material, color: args.color },
        30_000,
      )
      return {
        output: [
          `status: ok`,
          `applied ${result.material} to "${result.name}"`,
          `slots: ${result.slots}`,
        ].join("\n"),
        metadata: { blenderSnapshot: result.snapshot ?? null },
      }
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
