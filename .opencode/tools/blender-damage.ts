import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

type DamageResult = {
  name: string
  strategy: string
  [key: string]: unknown
}

export default tool({
  description:
    "Apply damage/weathering to a mesh: edge_wear (randomized bevel), chips (boolean-subtract cubes), cracks (thin box cuts), surface_noise (displace modifier), dents (sphere cuts). Use for aged/distressed/industrial assets. Run blender-gate after to verify manifold.",
  args: {
    strategy: tool.schema
      .string()
      .describe("edge_wear | chips | cracks | surface_noise | dents"),
    name: tool.schema.string().describe("Target mesh object name"),
    intensity: tool.schema.number().optional().describe("edge_wear: 0-1 scale of width variation"),
    base_width: tool.schema.number().optional().describe("edge_wear: base bevel width (m)"),
    segments: tool.schema.number().optional().describe("edge_wear: bevel segments"),
    angle_limit: tool.schema.number().optional().describe("edge_wear: angle limit (radians, default 0.7854)"),
    count: tool.schema.number().optional().describe("chips/cracks/dents: number of damage sites"),
    size_range: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("chips: [min,max] chip size (m)"),
    length_range: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("cracks: [min,max] crack length (m)"),
    width: tool.schema.number().optional().describe("cracks: crack width (m)"),
    depth: tool.schema.number().optional().describe("cracks: crack depth (m)"),
    radius_range: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("dents: [min,max] dent radius (m)"),
    strength: tool.schema.number().optional().describe("surface_noise: displacement strength (m)"),
    scale: tool.schema.number().optional().describe("surface_noise: noise scale"),
    noise_depth: tool.schema.number().optional().describe("surface_noise: noise depth"),
    seed: tool.schema.number().optional().describe("Random seed for reproducible damage"),
    apply: tool.schema.boolean().optional().describe("Apply booleans immediately (default true)"),
  },
  async execute(args) {
    try {
      const result = await request<DamageResult>("apply_damage", args as Record<string, unknown>, 120_000)
      const lines = [
        `status: ok`,
        `applied ${result.strategy} to "${result.name}"`,
      ]
      if (result.verts_after) lines.push(`verts_after: ${result.verts_after}`)
      if (result.polys_after) lines.push(`polys_after: ${result.polys_after}`)
      if (result.width) lines.push(`bevel_width: ${result.width}`)
      if (result.cutters_created !== undefined)
        lines.push(`cutters: ${result.cutters_created} created, ${result.cutters_applied} applied`)
      if (result.cracks_attempted !== undefined)
        lines.push(`cracks: ${result.cracks_attempted} attempted, ${result.cracks_applied} applied`)
      if (result.dents_attempted !== undefined)
        lines.push(`dents: ${result.dents_attempted} attempted, ${result.dents_applied} applied`)
      lines.push("Run blender-gate to verify manifold/watertight after damage.")
      return lines.join("\n")
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
