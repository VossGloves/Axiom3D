import { tool } from "@opencode-ai/plugin"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, normalize, sep } from "node:path"

export default tool({
  description:
    "Write a Python build script to .axiom3d/scripts/. Use for asset build scripts (tree, prop, etc). Path must be under .axiom3d/scripts/. Follows fresh-design rule: each generation writes NEW content, never copies prior scripts.",
  args: {
    path: tool
      .schema.string()
      .describe("Path relative to .axiom3d/scripts/, e.g. tree/build.py or stylized_oak/build.py"),
    content: tool.schema.string().describe("Full Python source for the build script"),
  },
  async execute(args, context) {
    const scriptsRoot = join(context.directory, ".axiom3d", "scripts")
    const normalized = normalize(args.path).replace(/^([/\\.])+/, "")
    if (normalized.includes("..")) return "ERROR: path must not contain .."
    const abs = join(scriptsRoot, normalized)
    if (!abs.startsWith(scriptsRoot + sep) && abs !== scriptsRoot)
      return "ERROR: path must be under .axiom3d/scripts/"
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, args.content, "utf8")
    return `Wrote ${abs} (${args.content.length} bytes). Next: blender-gate with code=exec(open(path).read())`
  },
})