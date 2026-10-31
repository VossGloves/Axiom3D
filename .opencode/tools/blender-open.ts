import { tool } from "@opencode-ai/plugin"
import { isAbsolute, join } from "node:path"
import { request, status } from "../lib/blender-client"

export default tool({
  description:
    "Open a file directly in the attached Blender session (.blend opens as main file; .glb/.gltf/.fbx/.obj import into current scene). Requires GUI mode attachment. Returns scene summary after load.",
  args: {
    path: tool.schema.string().describe("File path: .blend, .glb, .gltf, .fbx, .obj"),
    mode: tool.schema
      .enum(["open", "import"])
      .default("auto")
      .describe("open = replace scene (.blend only); import = add to scene. auto: .blend=open, else import"),
  },
  async execute(args, context) {
    const target = isAbsolute(args.path) ? args.path : join(context.directory, args.path)

    const { info } = await status()
    if (info.mode !== "gui") {
      return "ERROR: blender-open requires GUI mode. Launch with AXIOM3D_BLENDER_MODE=gui or open Blender + start Axiom3D addon."
    }

    const ext = target.split(".").pop()?.toLowerCase() ?? ""
    const isOpen = ext === "blend" && args.mode !== "import"
    const isImport = ["glb", "gltf", "fbx", "obj", "usd", "usda", "usdc", "abc", "ply", "stl"].includes(ext)

    if (!isOpen && !isImport) {
      return `ERROR: unsupported extension .${ext}. Use .blend (open) or .glb/.gltf/.fbx/.obj/.usd/.ply/.stl (import).`
    }

    try {
      const result = await request<{
        action: string
        file: string
        handoff?: boolean
        objects?: number
        snapshot?: string
      }>(
        "open_file",
        { path: target, mode: args.mode },
        70_000,
      )
      if (result.handoff) {
        await status()
        const summary = await request<{ file: string; objects: Record<string, number> }>("query", { kind: "summary" }, 30_000)
        const meshCount = summary.objects.MESH ?? 0
        return {
          output: `Opened ${target}\nfile: ${summary.file}\nmesh_objects: ${meshCount}`,
          metadata: { blenderSnapshot: result.snapshot ?? null },
        }
      }
      const action = isOpen ? "Opened" : "Imported"
      return {
        output: `${action} ${result.file}\nobjects: ${result.objects ?? 0}`,
        metadata: { blenderSnapshot: result.snapshot ?? null },
      }
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
