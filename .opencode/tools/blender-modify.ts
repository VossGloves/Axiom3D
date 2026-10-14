import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

type ModifyResult = {
  action?: string
  object?: string
  name?: string
  source?: string
  created?: string[]
  count?: number
  shared_mesh?: string
  modifier?: string
  type?: string
  vertices?: number
  polys?: number
  applied?: Array<[string, string]>
  objects_with_modifiers?: Record<string, Array<{ name: string; type: string }>>
}

export default tool({
  description:
    "Geometry modifiers: bevel, array, solidify, mirror, subsurf, remesh, deform (bend/twist/taper), displace, linked-instance (shared mesh), apply (bake modifiers), list. Use for detail passes and topology rebuilds; call blender-gate after to verify.",
  args: {
    action: tool.schema
      .string()
      .describe(
        "bevel | array | solidify | mirror | subsurf | remesh | deform | displace | instance | apply | list",
      ),
    name: tool.schema.string().optional().describe("Target mesh object name"),
    source: tool.schema.string().optional().describe("Source mesh object name (instance mode)"),
    width: tool.schema.number().optional().describe("Bevel width in meters (bevel)"),
    segments: tool.schema.number().optional().describe("Bevel segments (bevel)"),
    angle_limit: tool.schema.number().optional().describe("Bevel angle limit radians (bevel, default 0.7854)"),
    count: tool.schema.number().optional().describe("Array count or instance copy count"),
    offset: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("Array/instance offset [x,y,z] meters"),
    use_relative: tool.schema.boolean().optional().describe("Array: offset relative to dimensions (default true)"),
    thickness: tool.schema.number().optional().describe("Solidify thickness meters"),
    axis: tool.schema
      .array(tool.schema.boolean())
      .optional()
      .describe("Mirror axis [x,y,z] booleans, or deform axis string for deform"),
    levels: tool.schema.number().optional().describe("Subsurf viewport levels"),
    render_levels: tool.schema.number().optional().describe("Subsurf render levels"),
    mode: tool.schema.string().optional().describe("Remesh mode: VOXEL | SHARP | SMOOTH | BLOCKS, or deform mode: BEND | TWIST | TAPER"),
    voxel_size: tool.schema.number().optional().describe("Remesh voxel size meters (VOXEL mode)"),
    angle: tool.schema.number().optional().describe("Deform angle radians (BEND/TWIST)"),
    factor: tool.schema.number().optional().describe("Deform factor (TAPER)"),
    strength: tool.schema.number().optional().describe("Displace strength"),
    scale: tool.schema.number().optional().describe("Displace noise scale"),
  },
  async execute(args) {
    try {
      const result = await request<ModifyResult>(
        "modify",
        {
          action: args.action,
          name: args.name,
          source: args.source,
          width: args.width,
          segments: args.segments,
          angle_limit: args.angle_limit,
          count: args.count,
          offset: args.offset,
          use_relative: args.use_relative,
          thickness: args.thickness,
          axis: args.axis,
          levels: args.levels,
          render_levels: args.render_levels,
          mode: args.mode,
          voxel_size: args.voxel_size,
          angle: args.angle,
          factor: args.factor,
          strength: args.strength,
          scale: args.scale,
        },
        60_000,
      )

      if (args.action === "list") {
        const entries = Object.entries(result.objects_with_modifiers ?? {})
        if (entries.length === 0) return "no objects with modifiers"
        return entries
          .map(([obj, mods]) => `${obj}: ${mods.map((m) => `${m.name}(${m.type})`).join(", ")}`)
          .join("\n")
      }
      if (args.action === "instance") {
        return [
          `status: ok`,
          `instanced "${result.source}" × ${result.count}`,
          `created: ${result.created?.join(", ")}`,
          `shared mesh: ${result.shared_mesh}`,
          "Run blender-gate to confirm no unintended intersections.",
        ].join("\n")
      }
      if (args.action === "apply") {
        return [
          `status: ok`,
          `applied ${result.applied?.length ?? 0} modifiers on "${result.object}"`,
          `verts: ${result.vertices}  polys: ${result.polys}`,
        ].join("\n")
      }
      return [
        `status: ok`,
        `${result.action} on "${result.object}" → ${result.modifier} (${result.type})`,
        `verts: ${result.vertices}  polys: ${result.polys}`,
      ].join("\n")
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
