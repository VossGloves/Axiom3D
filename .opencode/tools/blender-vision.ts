import { basename } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

const MODES = ["quick", "full"] as const

type RenderResult = {
  files: string[]
  views?: Array<{ view: string; file: string }>
  engine_used: string
}

export default tool({
  description:
    "Ground the AI in the live Blender scene. Quick mode returns structured geometry/text only; full mode adds multi-view PNG attachments for visual critique.",
  args: {
    mode: tool.schema.enum(MODES).default("quick").describe("quick | full"),
    views: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Subset of front, back, left, right, top, iso for full mode; default all six"),
    width: tool.schema.number().default(640),
    height: tool.schema.number().default(360),
  },
  async execute(args) {
    try {
      const geometry = await request<Record<string, unknown>>("query", { kind: "geometry" }, 120_000)
      const payload: Record<string, unknown> = { mode: args.mode, geometry }
      if (args.mode === "full") {
        try {
          const render = await request<RenderResult>(
            "render",
            { engine: "workbench", width: args.width, height: args.height, views: args.views },
            310_000,
          )
          const attachments = await Promise.all(
            render.files.map(async (file) => ({
              type: "file" as const,
              mime: "image/png",
              url: `data:image/png;base64,${Buffer.from(await Bun.file(file).arrayBuffer()).toString("base64")}`,
            })),
          )
          payload.render = {
            engine: render.engine_used,
            views: render.views ?? render.files.map((file) => ({ view: basename(file, ".png"), file })),
          }
          return {
            title: "Blender vision (full)",
            output: JSON.stringify(payload, null, 2),
            attachments,
          }
        } catch (error) {
          payload.render_error = error instanceof Error ? error.message : String(error)
        }
      }
      return {
        title: `Blender vision (${args.mode})`,
        output: JSON.stringify(payload, null, 2),
      }
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
