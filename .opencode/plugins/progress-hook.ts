import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

// Auto-show the TUI build banner the moment the interview picker returns.
// The director agent also updates progress later via axiom3d-progress; this
// hook only covers the interview→brief gap so the user sees feedback without
// waiting for the next LLM turn to remember the tool.
const ProgressHookPlugin: Plugin = async (input) => ({
  async "tool.execute.after"(toolInput) {
    if (toolInput.tool !== "question") return
    const file = join(input.directory, ".axiom3d", "progress.json")
    await mkdir(join(input.directory, ".axiom3d"), { recursive: true })
    await Bun.write(file, JSON.stringify({ step: "Interview complete", status: "planning brief" }))
  },
})

export default ProgressHookPlugin
