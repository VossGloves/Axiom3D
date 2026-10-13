/// <reference path="../env.d.ts" />
// Persistent headless Blender worker client for Axiom3D.
// Spawns `blender --background --python blender/worker.py`, talks newline JSON over TCP.
// Safety: per-call timeout; on timeout or a poisoned worker it kills, respawns, and
// restores the pre-exec snapshot so a bad script never leaves the scene wrecked.

import net from "node:net"
import { join } from "node:path"
import { readdir } from "node:fs/promises"

const ROOT = join(import.meta.dir, "..", "..")
const AXIOM_DIR = join(ROOT, ".axiom3d")
const PORT_FILE = join(AXIOM_DIR, "blender.port")
const WORKER_SCRIPT = join(ROOT, "blender", "worker.py")
const STARTUP_TIMEOUT_MS = 60_000

export type PortInfo = {
  port: number
  pid: number
  version: string
  mode: "headless" | "gui"
  last_snapshot: string | null
  poisoned: boolean
}

export type ExecResult = {
  stdout: string
  stderr: string
  error: { type: string; message: string; traceback: string } | null
  duration_ms: number
  snapshot: string | null
  scene_diff: { added: string[]; removed: string[]; modified: string[] }
}

/** Command-level failure with the worker's structured payload attached (exec errors
 * carry stdout/traceback that tool surfaces should show the model). */
export class CommandError extends Error {
  readonly details: unknown
  constructor(message: string, details?: unknown) {
    super(message)
    this.name = "CommandError"
    this.details = details
  }
}

type Response<T> = { id: number; ok: true; result: T } | { id: number; ok: false; error: { type: string; message: string } }

let subprocess: Bun.Subprocess | null = null
let requestSeq = 0
let chain: Promise<unknown> = Promise.resolve()

// Blender's bpy is main-thread-only: the worker serializes internally, and we
// serialize here too so parallel tool calls queue instead of racing a restart.
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn)
  chain = run.then(
    () => {},
    () => {},
  )
  return run
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function portInfo(): Promise<PortInfo | null> {
  try {
    return await Bun.file(PORT_FILE).json()
  } catch {
    return null
  }
}

function rpc(port: number, payload: string, timeoutMs: number): Promise<Response<unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" })
    let buffer = ""
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`rpc timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    socket.on("connect", () => socket.write(payload + "\n"))
    socket.on("data", (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf("\n")
      if (newline === -1) return
      clearTimeout(timer)
      socket.destroy()
      try {
        resolve(JSON.parse(buffer.slice(0, newline)))
      } catch (error) {
        reject(error instanceof Error ? error : new Error("unparseable worker response"))
      }
    })
    socket.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function pingable(port: number): Promise<boolean> {
  try {
    const response = await rpc(port, JSON.stringify({ id: 0, cmd: "ping", params: {} }), 2000)
    return response.ok === true
  } catch {
    return false
  }
}

async function findBlender(): Promise<string> {
  if (process.env.BLENDER_PATH) return process.env.BLENDER_PATH
  // Try PATH first (Linux/macOS)
  const which = Bun.which("blender")
  if (which) return which
  // Windows: search Program Files
  const candidates: string[] = []
  try {
    const glob = new Bun.Glob("Blender */blender.exe")
    const base = "C:/Program Files/Blender Foundation"
    for await (const hit of glob.scan({ cwd: base })) candidates.push(`${base}/${hit}`)
  } catch {
    // base dir absent on this machine; fall through to the error below
  }
  const newest = candidates.sort().at(-1)
  if (!newest) throw new Error("Blender not found; set BLENDER_PATH")
  return newest
}

function tryKill(pid: number | undefined) {
  if (!pid) return
  try {
    process.kill(pid)
  } catch {
    // already dead or not ours
  }
}

async function spawnWorker(): Promise<PortInfo> {
  const blender = await findBlender()
  const proc = Bun.spawn([blender, "--background", "--factory-startup", "--python", WORKER_SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, AXIOM3D_ROOT: ROOT },
    stdout: "ignore",
    stderr: "ignore",
  })
  subprocess = proc
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(250)
    const info = await portInfo()
    if (info && info.pid === proc.pid && (await pingable(info.port))) return info
    if (proc.exitCode !== null) break
  }
  throw new Error(`Blender worker failed to start; see ${join(AXIOM_DIR, "worker.log")}`)
}

async function ensure(): Promise<PortInfo> {
  const mode = process.env.AXIOM3D_BLENDER_MODE // "gui" | "headless" | undefined (auto)
  const existing = await portInfo()

  // Attach to existing GUI session if port file alive and mode is gui or auto-detect finds gui
  if (existing && (await pingable(existing.port))) {
    if (mode === "gui" || existing.mode === "gui") return existing
    // Headless mode already running; reuse it
    if (mode !== "headless") return existing
  }

  // GUI mode requested but no live session: error (don't spawn headless)
  if (mode === "gui") {
    // Check if Blender is even running (any blender process)
    const stale = existing && !(await pingable(existing.port))
    const hint = stale
      ? "Stale port file (server died). Restart Blender, re-enable addon, click Start Server."
      : "No live Blender GUI session found. Open Blender, enable Axiom3D addon, click Start Server."
    throw new Error(`AXIOM3D_BLENDER_MODE=gui but ${hint}`)
  }

  // Kill stale process if we own it (headless only — never kill GUI)
  if (existing && existing.mode !== "gui") tryKill(existing.pid)
  if (subprocess) {
    subprocess.kill()
    subprocess = null
  }
  return spawnWorker()
}

/** Kill the worker (whatever state it is in) and bring up a fresh one, restoring the
 * last snapshot the worker recorded before its last exec. No-op for GUI sessions. */
export async function restart(): Promise<void> {
  const previous = await portInfo()
  // Never kill a GUI session — user owns that process
  if (previous?.mode === "gui") {
    throw new Error(
      "Cannot restart Blender GUI session. " +
        "Restore manually via blender-checkpoint or restart Blender + reload addon.",
    )
  }
  const snapshot = previous?.last_snapshot ?? null
  if (subprocess) {
    subprocess.kill()
    subprocess = null
  }
  if (previous) tryKill(previous.pid)
  await sleep(500)
  await spawnWorker()
  if (snapshot) {
    try {
      await rpc((await portInfo())!.port, JSON.stringify({ id: 0, cmd: "restore", params: { id: snapshot } }), 30_000)
    } catch (error) {
      console.error(`blender-client: restart restore of ${snapshot} failed`, error)
    }
  }
}

async function call<T>(cmd: string, params: Record<string, unknown>, timeoutMs: number, autoRecover: boolean): Promise<T> {
  const info = await ensure()
  const isGui = info.mode === "gui"
  let response: Response<T>
  try {
    requestSeq += 1
    response = (await rpc(info.port, JSON.stringify({ id: requestSeq, cmd, params }), timeoutMs)) as Response<T>
  } catch (error) {
    // GUI: don't restart, surface error with recovery hint
    if (isGui) {
      throw new CommandError(
        `Blender ${cmd} timed out (${String(error)}). GUI session not restarted — ` +
          "check Blender is responsive, or use blender-checkpoint to restore.",
      )
    }
    if (!autoRecover) throw error
    await restart()
    throw new Error(`Blender ${cmd} timed out or worker died (${String(error)}). Worker restarted, scene restored to ${info.last_snapshot ?? "fresh state"}.`)
  }
  if (!response.ok) {
    const error = response.error as { type: string; message: string; result?: unknown }
    const poisoned = error.type === "ExecTimeout" || error.type === "WorkerPoisoned"
    if (poisoned) {
      // GUI: don't restart, surface poisoned state
      if (isGui) {
        throw new CommandError(
          `Blender ${cmd} failed: ${error.message} GUI session poisoned — restart Blender or restore via checkpoint.`,
          error.result,
        )
      }
      if (autoRecover) {
        await restart()
        throw new CommandError(
          `Blender ${cmd} failed: ${error.message} Worker restarted, scene restored to ${info.last_snapshot ?? "fresh state"}.`,
          error.result,
        )
      }
    }
    throw new CommandError(`Blender ${cmd} failed [${error.type}]: ${error.message}`, error.result)
  }
  return response.result
}

/** Queued command call. Worker answers with a typed error; timeout/poisoned errors
 * trigger kill + restart + snapshot restore before the error surfaces. */
export async function request<T>(cmd: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
  return enqueue(() => call<T>(cmd, params, timeoutMs, true))
}

/** Run Python in the persistent session. Worker answers ExecTimeout at `timeout` + 2s;
 * client kills+restarts+restores only if nothing arrives by `timeout` + 10s. */
export async function exec(code: string, options: { timeout?: number } = {}): Promise<ExecResult> {
  const timeout = options.timeout ?? 30
  return enqueue(() => call<ExecResult>("exec", { code, timeout }, (timeout + 10) * 1000, true))
}

export async function status(): Promise<{ info: PortInfo; fresh: boolean }> {
  return enqueue(async () => {
    const info = await ensure()
    return { info, fresh: info.pid === subprocess?.pid }
  })
}

/** Shut the worker down (test teardown / explicit cleanup). */
export function stop(): void {
  if (subprocess) {
    subprocess.kill()
    subprocess = null
  }
}

/** Newest-first snapshot ids from .axiom3d/snapshots (no worker round trip). */
export async function snapshots(): Promise<string[]> {
  try {
    const entries = await readdir(join(AXIOM_DIR, "snapshots"))
    return entries
      .filter((entry) => entry.endsWith(".blend"))
      .map((entry) => entry.slice(0, -".blend".length))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

/** Call without auto-recovery (GUI sessions, tests that manage restart manually). */
export async function callWithoutRecovery<T>(cmd: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
  return enqueue(() => call<T>(cmd, params, timeoutMs, false))
}

export { portInfo as readPortFile }