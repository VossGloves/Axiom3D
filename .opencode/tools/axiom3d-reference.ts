import { tool } from "@opencode-ai/plugin"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const REFERENCES_DIR = join(process.cwd(), ".axiom3d", "references")

async function downloadImage(url: string, dir: string, index: number): Promise<string | null> {
  try {
    const tmpPath = join(dir, `.tmp_${index}`)
    const proc = Bun.spawn(
      ["curl", "-sL", "-A", "Mozilla/5.0", "--max-time", "15", "-o", tmpPath, url],
      { stdout: "pipe", stderr: "pipe" },
    )
    const exitCode = await proc.exited
    if (exitCode !== 0) return null

    const bytes = await Bun.file(tmpPath).bytes()
    if (bytes.length < 100 || bytes.length > 10_000_000) {
      await Bun.write(tmpPath, "")
      return null
    }

    // Verify it's an image by magic bytes
    const isImage =
      (bytes[0] === 0xff && bytes[1] === 0xd8) || // JPEG
      (bytes[0] === 0x89 && bytes[1] === 0x50) || // PNG
      (bytes[0] === 0x47 && bytes[1] === 0x49) || // GIF
      (bytes[0] === 0x52 && bytes[1] === 0x49) // RIFF (WebP)
    if (!isImage) {
      await Bun.write(tmpPath, "")
      return null
    }

    const ext = (() => {
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return ".jpg"
      if (bytes[0] === 0x89 && bytes[1] === 0x50) return ".png"
      if (bytes[0] === 0x47 && bytes[1] === 0x49) return ".gif"
      return ".webp"
    })()

    const filename = `ref_${String(index).padStart(2, "0")}${ext}`
    const filepath = join(dir, filename)
    await Bun.write(filepath, bytes)
    await Bun.write(tmpPath, "")
    return filepath
  } catch {
    return null
  }
}

export default tool({
  description:
    "Download reference images from URLs to a fresh folder .axiom3d/references/<asset>_<timestamp>/. Call after interview with 2-5 image URLs from websearch results (prefer orthographic drawings, dimensioned diagrams). Each generation gets its own timestamped folder so old reference images never confuse the AI. Returns saved file paths — pass this exact path to planner and modeller.",
  args: {
    asset: tool.schema.string().describe("Asset name (snake_case) — folder prefix under references/"),
    urls: tool.schema
      .array(tool.schema.string())
      .describe("Image URLs to download (2-5 recommended, from websearch results)"),
  },
  async execute(args) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const dir = join(REFERENCES_DIR, `${args.asset}_${timestamp}`)
    await mkdir(dir, { recursive: true })

    const results = await Promise.all(args.urls.map((url, i) => downloadImage(url, dir, i + 1)))
    const saved = results.filter((p): p is string => p !== null)

    if (saved.length === 0) {
      return "ERROR: no images downloaded. URLs may not be direct image links. Try different URLs from websearch results."
    }

    return [
      `Saved ${saved.length} reference image(s) to ${dir}/:`,
      ...saved.map((p) => `  ${p}`),
      "",
      "IMPORTANT: Use this exact folder path when telling planner and modeller where to find reference images.",
      "Read these images with the read tool before planning or during chunk generation to match proportions and design.",
    ].join("\n")
  },
})
