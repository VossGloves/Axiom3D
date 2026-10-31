import { request, status } from "../lib/blender-client"

const AXIOM_DIR = new URL("../../", import.meta.url).pathname
const STATE_PATH = `${AXIOM_DIR}.axiom3d/undo-state.json`

type UndoState = Record<string, string>

async function loadState(): Promise<UndoState> {
  try {
    return (await Bun.file(STATE_PATH).json()) as UndoState
  } catch {
    return {}
  }
}

async function saveState(state: UndoState) {
  await Bun.write(STATE_PATH, JSON.stringify(state, null, 2))
}

async function restoreSnapshot(id: string) {
  const result = await request<{ restored: string; handoff?: boolean }>("restore", { id }, 60_000)
  if (result.handoff) await status()
}

export default {
  id: "blender-undo",
  server: async () => ({
    "session.revert": async (input: { sessionID: string; phase: "revert" | "unrevert" | "cleanup"; blenderSnapshot?: string }) => {
      try {
        const state = await loadState()
        if (input.phase === "revert") {
          if (!input.blenderSnapshot) return
          if (!state[input.sessionID]) {
            const snap = await request<{ id: string }>("snapshot", { label: "undo-save" }, 60_000)
            state[input.sessionID] = snap.id
            await saveState(state)
          }
          await restoreSnapshot(input.blenderSnapshot)
          return
        }
        if (input.phase === "unrevert") {
          const snap = state[input.sessionID]
          if (!snap) return
          await restoreSnapshot(snap)
          delete state[input.sessionID]
          await saveState(state)
          return
        }
        if (input.phase === "cleanup") {
          if (state[input.sessionID]) {
            delete state[input.sessionID]
            await saveState(state)
          }
        }
      } catch {
        // plugin must never fail session revert
      }
    },
  }),
}
