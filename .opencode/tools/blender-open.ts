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

    const code = isOpen
      ? `import bpy
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(target)})
result = {"objects": len(bpy.data.objects), "file": bpy.data.filepath}`
      : `import bpy, os
if not os.path.exists(${JSON.stringify(target)}):
    raise FileNotFoundError(${JSON.stringify(target)})
ext = ${JSON.stringify(ext)}
if ext in ("glb", "gltf"):
    bpy.ops.import_scene.gltf(filepath=${JSON.stringify(target)})
elif ext == "fbx":
    bpy.ops.import_scene.fbx(filepath=${JSON.stringify(target)})
elif ext == "obj":
    bpy.ops.wm.obj_import(filepath=${JSON.stringify(target)})
elif ext in ("usd", "usda", "usdc"):
    bpy.ops.wm.usd_import(filepath=${JSON.stringify(target)})
elif ext == "ply":
    bpy.ops.import_mesh.ply(filepath=${JSON.stringify(target)})
elif ext == "stl":
    bpy.ops.import_mesh.stl(filepath=${JSON.stringify(target)})
result = {"objects": len(bpy.data.objects), "added_hint": "imported ${ext}"}`

    try {
      const result = await request<{ stdout: string; error: unknown }>(
        "exec",
        { code, timeout: 60 },
        70_000,
      )
      if (result.error) {
        return `ERROR: import failed — ${JSON.stringify(result.error)}`
      }
      const action = isOpen ? "Opened" : "Imported"
      return `${action} ${target}\n${result.stdout.trim()}`
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
