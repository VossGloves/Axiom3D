/** @jsxImportSource @opentui/solid */
import { createSignal, createEffect, onCleanup, Show, For } from "solid-js"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

type Plan = {
  asset?: string
  steps?: string[]
  step_index?: number
  step?: string
  status?: string
  detail?: string
}

const PLAN_FILE = join(process.cwd(), ".axiom3d", "asset-plan.json")
const POLL_MS = 500

function readPlan(): Plan | null {
  try {
    if (!existsSync(PLAN_FILE)) return null
    const raw = readFileSync(PLAN_FILE, "utf-8")
    if (!raw.trim()) return null
    const data = JSON.parse(raw)
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) return null
    return data
  } catch {
    return null
  }
}

function StepList(props: { plan: Plan }) {
  const steps = () => props.plan.steps ?? []
  const currentIndex = () => {
    const idx = props.plan.step_index
    if (idx !== undefined) return idx
    return steps().indexOf(props.plan.step ?? "") + 1
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
              <Show when={current() && (props.plan.status || props.plan.detail)}>
                <box paddingLeft={3} flexDirection="column">
                  <Show when={props.plan.status}>
                    <text fg="muted">{props.plan.status}</text>
                  </Show>
                  <Show when={props.plan.detail}>
                    <text fg="gray">{props.plan.detail}</text>
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

function PlanPanel() {
  const [plan, setPlan] = createSignal<Plan | null>(null)

  createEffect(() => {
    setPlan(readPlan())
    const interval = setInterval(() => {
      setPlan(readPlan())
    }, POLL_MS)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <box flexDirection="column" marginTop={1} width="100%">
      <Show when={plan()} fallback={<text fg="dimgrey">No asset plan yet</text>}>
        {(p) => (
          <>
            <text fg="cyan" bold>
              {p().asset ?? "asset"}
            </text>
            <Show when={(p().steps?.length ?? 0) > 0}>
              <StepList plan={p()} />
            </Show>
            <Show when={(p().steps?.length ?? 0) === 0 && p().step}>
              <box marginTop={1}>
                <text fg="white">▶ {p().step}</text>
              </box>
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
      axiom_menu_content() {
        return <PlanPanel />
      },
    },
  })
}

export { plugin as tui }
