import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

type VisionResult = {
  files: string[]
  cameras: Array<{ name: string; path: string; location: number[] }>
  engine_used: string
  target: string[]
  target_bounds: { center: number[]; radius: number }
}

export default tool({
  description:
    "Capture screenshots of a target object from ~3 angles for visual inspection. Frames cameras around the target's bounds, not the whole scene. Use after building a chunk to verify proportions, positioning, and design before moving on.",
  args: {
    target: tool.schema
      .string()
      .describe("Object name (or comma-separated names) to frame cameras around"),
    engine: tool.schema.string().default("workbench").describe("workbench | eevee | cycles"),
    width: tool.schema.number().default(640),
    height: tool.schema.number().default(360),
    distance: tool.schema
      .number()
      .default(2.5)
      .describe("Camera distance as multiple of target radius"),
    views: tool.schema
      .array(
        tool.schema.object({
          name: tool.schema.string(),
          azimuth: tool.schema.number(),
          elevation: tool.schema.number(),
        }),
      )
      .optional()
      .describe("Custom views: [{name, azimuth, elevation}]. Default: 3 three-quarter angles"),
  },
  async execute(args) {
    try {
      const target = args.target
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const result = await request<VisionResult>(
        "vision",
        {
          target,
          engine: args.engine,
          width: args.width,
          height: args.height,
          distance: args.distance,
          views: args.views,
        },
        310_000,
      )
      const attachments = await Promise.all(
        result.files.map(async (file) => ({
          type: "file" as const,
          mime: "image/png",
          url: `data:image/png;base64,${Buffer.from(await Bun.file(file).arrayBuffer()).toString("base64")}`,
        })),
      )
      const viewLabels = result.cameras
        .map((c) => `${c.name} (at ${c.location.map((v) => v.toFixed(2)).join(", ")})`)
        .join("\n")
      return {
        title: `Chunk vision: ${result.target.join(", ")} — ${result.files.length} views (${result.engine_used})`,
        output: [
          `target: ${result.target.join(", ")}`,
          `bounds: center=(${result.target_bounds.center.join(", ")}) radius=${result.target_bounds.radius}`,
          `engine: ${result.engine_used}`,
          `views:\n${viewLabels}`,
          "Attached images show the target from different angles. Analyse: are proportions correct? Is it positioned right relative to prior chunks? Does geometry match the brief? Cite the view name when reporting issues.",
        ].join("\n"),
        attachments,
      }
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
