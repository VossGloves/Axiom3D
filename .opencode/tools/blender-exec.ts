import { tool } from "@opencode-ai/plugin"
import { CommandError, request } from "../lib/blender-client"
import type { ExecResult } from "../lib/blender-client"

export default tool({
  description:
    "Run Python in the persistent Blender 5.2 session. The scene auto-snapshots before execution; returns stdout, error with traceback, duration, and an object diff. Use this for every scene change.",
  args: {
    code: tool.schema.string().describe("Python source; bpy, bmesh, mathutils and numpy are available"),
    timeout: tool.schema.number().default(30).describe("Seconds before the worker gives up; pure-Python hangs soft-interrupt, hard hangs restart+restore the worker"),
  },
  async execute(args) {
    const timeout = args.timeout ?? 30
    try {
      const result = await request<ExecResult>(
        "exec",
        { code: args.code, timeout },
        (timeout + 10) * 1000,
      )
      const lines = [
        "status: ok",
        `duration_ms: ${result.duration_ms}`,
        `snapshot: ${result.snapshot}`,
        `stdout:\n${result.stdout.trim() || "(empty)"}`,
      ]
      if (result.stderr.trim()) lines.push(`stderr:\n${result.stderr.trim()}`)
      lines.push(`scene_diff: ${JSON.stringify(result.scene_diff)}`)
      return lines.join("\n")
    } catch (error) {
      const details = error instanceof CommandError && error.details ? error.details : null
      const head = error instanceof Error ? error.message : String(error)
      if (details) {
        const exec = details as ExecResult
        return [
          "status: script_error",
          head,
          `stdout:\n${exec.stdout?.trim() || "(empty)"}`,
          exec.error ? `error: ${exec.error.type}: ${exec.error.message}\n${exec.error.traceback}` : "",
          `scene_diff: ${JSON.stringify(exec.scene_diff)}`,
          "The scene was NOT rolled back — fix the script and run again, or restore a checkpoint if state is suspect.",
        ]
          .filter(Boolean)
          .join("\n")
      }
      return `status: worker_error\n${head}`
    }
  },
})