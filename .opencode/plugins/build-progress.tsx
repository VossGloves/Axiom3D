/** @jsxImportSource @opentui/solid */
import { createSignal, createEffect, onCleanup, Show, For } from "solid-js"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

type Progress = {
  asset?: string
  step?: string
  step_index?: number
  step_total?: number
  steps?: string[]
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
    const data = JSON.parse(raw)
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) return null
    return data
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
    <box flexDirection="row" gap={1} marginTop={1}>
      <text fg="cyan">{bar()}</text>
      <text fg="muted">
        {props.index}/{props.total}
      </text>
    </box>
  )
}

function StepList(props: { progress: Progress }) {
  const steps = () => props.progress.steps ?? []
  const currentIndex = () => {
    const idx = props.progress.step_index
    if (idx !== undefined) return idx
    return steps().indexOf(props.progress.step ?? "") + 1
  }

  return (
    <box flexDirection="column" marginTop={1}>
      <For each={steps()}>
        {(label, i) => {
          const index = () => i() + 1
          const done = () => currentIndex() > index()
          const current = () => currentIndex() === index()
          return (
            <box flexDirection="column">
              <box flexDirection="row" gap={1}>
                <text fg={done() ? "green" : current() ? "cyan" : "dimgrey"}>{done() ? "✓" : current() ? "▶" : "○"}</text>
                <text fg={done() ? "green" : current() ? "white" : "dimgrey"}>{label}</text>
              </box>
              <Show when={current() && (props.progress.status || props.progress.detail)}>
                <box paddingLeft={3} flexDirection="column">
                  <Show when={props.progress.status}>
                    <text fg="muted">{props.progress.status}</text>
                  </Show>
                  <Show when={props.progress.detail}>
                    <text fg="gray">{props.progress.detail}</text>
                  </Show>
                </box>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function BuildPanel() {
  const [progress, setProgress] = createSignal<Progress | null>(null)

  createEffect(() => {
    setProgress(readProgress())
    const interval = setInterval(() => {
      setProgress(readProgress())
    }, POLL_MS)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <box
      border
      borderColor={progress() ? "cyan" : "dimgrey"}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      marginBottom={0}
      flexDirection="column"
      width="100%"
      minHeight={progress() ? undefined : 3}
    >
      <Show when={progress()} fallback={<text fg="dimgrey"> no active build</text>}>
        {(p) => (
          <>
            <box flexDirection="row" gap={2} alignItems="center">
              <text fg="cyan" bold>
                {p().asset ?? "asset"}
              </text>
              <Show when={p().chunk}>
                <text fg="yellow">[{p().chunk}]</text>
              </Show>
            </box>
            <Show when={p().step_index && p().step_total}>
              {(idx) => <ProgressBar index={idx() as number} total={p().step_total!} />}
            </Show>
            <Show
              when={(p().steps?.length ?? 0) > 0}
              fallback={
                <Show when={p().step}>
                  <box marginTop={1}>
                    <text fg="white">▶ {p().step}</text>
                    <Show when={p().status}>
                      <text fg="muted">  {p().status}</text>
                    </Show>
                    <Show when={p().detail}>
                      <text fg="gray">  {p().detail}</text>
                    </Show>
                  </box>
                </Show>
              }
            >
              <StepList progress={p()} />
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

const plugin: TuiPlugin = async (api: TuiPluginApi) => {
  api.slots.register({
    order: -10,
    slots: {
      sidebar_content() {
        return <BuildPanel />
      },
    },
  })
}

export { plugin as tui }
