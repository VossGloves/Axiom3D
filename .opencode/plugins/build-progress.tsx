/** @jsxImportSource @opentui/solid */
import { createSignal, createEffect, onCleanup, Show } from "solid-js"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

type Progress = {
  asset?: string
  step?: string
  step_index?: number
  step_total?: number
  chunk?: string
  status?: string
  detail?: string
}

const PROGRESS_FILE = join(process.cwd(), ".axiom3d", "progress.json")
const POLL_MS = 500

function readProgress(): Progress | null {
  try {
    if (!existsSync(PROGRESS_FILE)) return null
    const raw = readFileSync(PROGRESS_FILE, "utf-8")
    if (!raw.trim()) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function ProgressBar(props: { index: number; total: number }) {
  const filled = () => Math.round((props.index / Math.max(props.total, 1)) * 20)
  const bar = () => {
    const f = filled()
    return "█".repeat(f) + "░".repeat(20 - f)
  }
  return (
    <box flexDirection="row" gap={1}>
      <text fg="cyan">{bar()}</text>
      <text fg="muted">
        {props.index}/{props.total}
      </text>
    </box>
  )
}

function ProgressBanner() {
  const [progress, setProgress] = createSignal<Progress | null>(null)

  createEffect(() => {
    const interval = setInterval(() => {
      setProgress(readProgress())
    }, POLL_MS)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <Show when={progress()}>
      {(p) => (
        <box
          border
          borderColor="cyan"
          paddingLeft={1}
          paddingRight={1}
          paddingTop={0}
          paddingBottom={0}
          marginBottom={0}
          flexDirection="column"
          width="100%"
        >
          <box flexDirection="row" gap={2} alignItems="center">
            <Show when={p().step_index && p().step_total}>
              {(idx) => <ProgressBar index={idx() as number} total={p().step_total!} />}
            </Show>
            <text fg="cyan" bold>
              {p().asset ?? "asset"}
            </text>
            <Show when={p().step}>
              <text fg="white">→ {p().step}</text>
            </Show>
            <Show when={p().chunk}>
              <text fg="yellow">[{p().chunk}]</text>
            </Show>
          </box>
          <Show when={p().status || p().detail}>
            <box flexDirection="row" gap={2}>
              <Show when={p().status}>
                <text fg="muted">{p().status}</text>
              </Show>
              <Show when={p().detail}>
                <text fg="gray">{p().detail}</text>
              </Show>
            </box>
          </Show>
        </box>
      )}
    </Show>
  )
}

const plugin: TuiPlugin = async (api: TuiPluginApi) => {
  api.slots.register({
    order: -10,
    slots: {
      session_prompt(ctx, value) {
        const Prompt = api.ui.Prompt
        const Slot = api.ui.Slot
        return (
          <box flexDirection="column" width="100%">
            <ProgressBanner />
            <Prompt
              sessionID={value.session_id}
              visible={value.visible}
              disabled={value.disabled}
              onSubmit={value.on_submit}
              ref={value.ref}
              right={<Slot name="session_prompt_right" session_id={value.session_id} />}
            />
          </box>
        )
      },
    },
  })
}

export { plugin as tui }
