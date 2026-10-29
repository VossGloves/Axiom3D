/// <reference path="../env.d.ts" />
// Persistent headless Blender worker client for Axiom3D.
// Spawns `blender --background --python blender/worker.py`, talks newline JSON over TCP.
// Safety: per-call timeout; pure-Python hangs soft-interrupt via SIGALRM; hard poison
// auto-clears on GUI when the main thread frees. Dead GUI addon TCP falls back to a
// separate headless worker so tools keep working without a Blender restart.

import net from "node:net"
import { appendFile, mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const AXIOM_DIR = join(ROOT, ".axiom3d")
const PORT_FILE = join(AXIOM_DIR, "blender.port")
const TELEMETRY_FILE = join(AXIOM_DIR, "blender-bridge.jsonl")
const WORKER_SCRIPT = join(ROOT, "blender", "worker.py")
const STARTUP_TIMEOUT_MS = 60_000
const GUI_RECONNECT_GRACE_MS = 15_000

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

class RpcTransportError extends Error {
  readonly phase: "connect" | "response"
  readonly code: string | undefined
  constructor(message: string, phase: "connect" | "response", code?: string) {
    super(message)
    this.name = "RpcTransportError"
    this.phase = phase
    this.code = code
  }
}

type Response<T> = { id: number; ok: true; result: T } | { id: number; ok: false; error: { type: string; message: string } }

let subprocess: Bun.Subprocess | null = null
let lastGuiInfo: PortInfo | null = null
let requestSeq = 0
let chain: Promise<unknown> = Promise.resolve()
let telemetryChain: Promise<void> = Promise.resolve()

// Client-side lock: ensures() / restarts serialize per process so two gate calls
// never spawn two workers against the same port file.
let ensureLock: Promise<unknown> = Promise.resolve()

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

function rememberGui(info: PortInfo | null) {
  if (info?.mode !== "gui") return
  lastGuiInfo = info
}

function portFields(info: PortInfo | null) {
  if (!info) return {}
  return {
    port: info.port,
    blender_pid: info.pid,
    session_mode: info.mode,
    poisoned: info.poisoned,
    last_snapshot: info.last_snapshot,
  }
}

function liveRememberedGui() {
  if (!lastGuiInfo) return null
  if (pidAlive(lastGuiInfo.pid)) return lastGuiInfo
  lastGuiInfo = null
  return null
}

function errorFields(error: unknown) {
  if (error instanceof RpcTransportError) {
    return {
      error_name: error.name,
      error_message: error.message,
      error_phase: error.phase,
      error_code: error.code ?? null,
    }
  }
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: error.message,
    }
  }
  return {
    error_name: typeof error,
    error_message: String(error),
  }
}

function logTelemetry(event: string, fields: Record<string, unknown> = {}) {
  const write = async () => {
    try {
      await mkdir(AXIOM_DIR, { recursive: true })
      await appendFile(
        TELEMETRY_FILE,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          event,
          client_pid: process.pid,
          ...fields,
        })}\n`,
      )
    } catch {
      // telemetry must never break the bridge
    }
  }
  telemetryChain = telemetryChain.then(write, write)
  return telemetryChain
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
    let connected = false
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      reject(error)
    }
    const succeed = (value: Response<unknown>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(value)
    }
    const timer = setTimeout(() => {
      fail(new RpcTransportError(`rpc timeout after ${timeoutMs}ms`, connected ? "response" : "connect"))
    }, timeoutMs)
    socket.on("connect", () => {
      connected = true
      socket.write(payload + "\n")
    })
    socket.on("data", (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf("\n")
      if (newline === -1) return
      try {
        succeed(JSON.parse(buffer.slice(0, newline)))
      } catch (error) {
        fail(error instanceof Error ? error : new Error("unparseable worker response"))
      }
    })
    socket.on("error", (error) => {
      fail(
        new RpcTransportError(
          error.message,
          connected ? "response" : "connect",
          "code" in error && typeof error.code === "string" ? error.code : undefined,
        ),
      )
    })
    socket.on("close", (hadError) => {
      if (settled || buffer.length > 0) return
      fail(
        new RpcTransportError(
          hadError ? "rpc connection closed after a transport error" : "rpc connection closed before a response",
          connected ? "response" : "connect",
        ),
      )
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

/** True if a pid is still a live process we can signal (ESRCH when dead). */
function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Drop a stale port file so the next ensure() does not trust a dead worker. */
async function clearPortFile() {
  try {
    await Bun.write(PORT_FILE, "")
  } catch {
    // best-effort; portInfo() already treats unreadable as null
  }
}

/** Ping with short retries — covers the window where the worker just bound its
 * socket (GUI auto-start / headless spawn) or a transient refused connection. */
async function pingableWithRetry(port: number, attempts = 4): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (await pingable(port)) return true
    await sleep(150)
  }
  return false
}

async function waitForGuiReady(previous: PortInfo | null, budgetMs = GUI_RECONNECT_GRACE_MS, reason = "unknown"): Promise<PortInfo | null> {
  const started = Date.now()
  const deadline = started + budgetMs
  while (Date.now() < deadline) {
    const current = await portInfo()
    if (current?.mode === "gui" && (await pingableWithRetry(current.port, 2)) && current.poisoned === false) {
      rememberGui(current)
      await logTelemetry("client.gui.wait_ready", {
        reason,
        recovered: true,
        duration_ms: Date.now() - started,
        matched_previous_pid: previous ? current.pid === previous.pid : null,
        previous_blender_pid: previous?.pid ?? null,
        ...portFields(current),
      })
      return current
    }
    await sleep(250)
  }
  await logTelemetry("client.gui.wait_ready", {
    reason,
    recovered: false,
    duration_ms: Date.now() - started,
    previous_blender_pid: previous?.pid ?? null,
    ...portFields(previous),
  })
  return null
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
  const started = Date.now()
  const blender = await findBlender()
  await logTelemetry("client.spawn.start", { blender_path: blender })
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
    if (info && info.pid === proc.pid && (await pingable(info.port))) {
      rememberGui(info)
      await logTelemetry("client.spawn.ready", {
        duration_ms: Date.now() - started,
        ...portFields(info),
      })
      return info
    }
    if (proc.exitCode !== null) break
  }
  await logTelemetry("client.spawn.failed", {
    blender_path: blender,
    duration_ms: Date.now() - started,
    exit_code: proc.exitCode,
  })
  throw new Error(`Blender worker failed to start; see ${join(AXIOM_DIR, "worker.log")}`)
}

async function ensureUnlocked(): Promise<PortInfo> {
  const mode = process.env.AXIOM3D_BLENDER_MODE // "gui" | "headless" | undefined (auto)
  let existing = await portInfo()
  const rememberedGui = liveRememberedGui()

  // Stale port file from a Blender process that is gone: clear it so we do not
  // keep reporting "server died, restart Blender" against a dead pid.
  if (existing && !pidAlive(existing.pid)) {
    await logTelemetry("client.ensure.stale_port_file", {
      reason: "pid_dead",
      ...portFields(existing),
    })
    await clearPortFile()
    existing = null
  }

  // Attach to live session if port file alive and mode is gui or auto-detect finds gui
  if (existing && (await pingableWithRetry(existing.port))) {
    rememberGui(existing)
    if (mode === "gui" || existing.mode === "gui") {
      // Prefer the live GUI session; shut down any headless fallback we spawned.
      if (subprocess && existing.mode === "gui") {
        await logTelemetry("client.ensure.prefer_gui", {
          reason: "live_gui_available",
          ...portFields(existing),
        })
        subprocess.kill()
        subprocess = null
      }
      return existing
    }
    // Headless mode already running; reuse it
    if (mode !== "headless") return existing
  }

  const guiCandidate = existing?.mode === "gui" ? existing : rememberedGui
  if (mode === "gui") {
    const recovered = await waitForGuiReady(
      guiCandidate,
      GUI_RECONNECT_GRACE_MS,
      guiCandidate ? "ensure_gui_reconnect" : "ensure_gui_missing_port",
    )
    if (recovered) return recovered
  }

  // Live GUI Blender but addon TCP dead (server crashed / never started): fall
  // back to a headless worker so tools keep working. The GUI timer also
  // self-heals the addon server; once it is back, the next session prefers GUI.
  const guiAlive = existing?.mode === "gui" && pidAlive(existing.pid)
  if (existing && !guiAlive) {
    await logTelemetry("client.ensure.unreachable_existing", {
      reason: "ping_failed",
      requested_mode: mode ?? "auto",
      ...portFields(existing),
    })
  }
  if (guiAlive) {
    if (mode === "gui") {
      await logTelemetry("client.ensure.gui_required_failed", {
        reason: "addon_server_down_after_grace",
        requested_mode: "gui",
        ...portFields(existing),
      })
      throw new Error(
        `AXIOM3D_BLENDER_MODE=gui but addon server is still down after waiting for reconnect (Blender pid ${existing.pid} alive). ` +
          "Open Blender, re-enable the Axiom3D addon if needed, or click Start Server on the Axiom3D panel.",
      )
    }
    const allowFallback = process.env.AXIOM3D_NO_HEADLESS_FALLBACK !== "1"
    await logTelemetry("client.ensure.gui_fallback_headless", {
      reason: "addon_server_down",
      requested_mode: mode ?? "auto",
      allow_headless_fallback: allowFallback,
      ...portFields(existing),
    })
    // Fall through: never kill the GUI process; spawn a separate headless worker.
  } else if (mode === "gui") {
    const hint = existing
      ? "Stale port file (server died). Restart Blender or re-enable addon, then click Start Server if needed."
      : "No live Blender GUI session found. Open Blender, enable Axiom3D addon, and wait a moment for it to re-register."
    await logTelemetry("client.ensure.gui_required_failed", {
      reason: existing ? "stale_or_dead_server_after_grace" : "no_gui_session_after_grace",
      requested_mode: "gui",
      ...portFields(existing),
    })
    throw new Error(`AXIOM3D_BLENDER_MODE=gui but ${hint}`)
  }

  // Kill stale process if we own it (headless only — never kill GUI)
  if (existing && existing.mode !== "gui") {
    await logTelemetry("client.ensure.kill_stale_headless", {
      reason: "replace_unreachable_headless",
      ...portFields(existing),
    })
    tryKill(existing.pid)
  }
  if (subprocess) {
    await logTelemetry("client.ensure.kill_owned_subprocess", {
      subprocess_pid: subprocess.pid,
    })
    subprocess.kill()
    subprocess = null
  }
  return spawnWorker()
}

async function ensure(): Promise<PortInfo> {
  const run = ensureLock.then(() => ensureUnlocked())
  ensureLock = run.then(
    () => {},
    () => {},
  )
  return run
}

/** Kill the worker (whatever state it is in) and bring up a fresh one, restoring the
 * last snapshot the worker recorded before its last exec. No-op for GUI sessions. */
export async function restart(): Promise<void> {
  const run = ensureLock.then(() => restartUnlocked())
  ensureLock = run.then(
    () => {},
    () => {},
  )
  return run
}

async function restartUnlocked(): Promise<void> {
  const previous = await portInfo()
  // Never kill a GUI session — user owns that process
  if (previous?.mode === "gui") {
    await logTelemetry("client.restart.refused", {
      reason: "gui_session",
      ...portFields(previous),
    })
    throw new Error(
      "Cannot restart Blender GUI session. " +
        "Restore manually via blender-checkpoint or restart Blender + reload addon.",
    )
  }
  const snapshot = previous?.last_snapshot ?? null
  await logTelemetry("client.restart.begin", {
    snapshot,
    ...portFields(previous),
  })
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
      await logTelemetry("client.restart.restore_succeeded", { snapshot })
    } catch (error) {
      await logTelemetry("client.restart.restore_failed", {
        snapshot,
        ...errorFields(error),
      })
      console.error(`blender-client: restart restore of ${snapshot} failed`, error)
    }
  }
}

async function call<T>(cmd: string, params: Record<string, unknown>, timeoutMs: number, autoRecover: boolean): Promise<T> {
  let info = await ensure()
  let retriedConnect = false
  const started = Date.now()
  let response: Response<T>
  while (true) {
    const isGui = info.mode === "gui"
    try {
      requestSeq += 1
      response = (await rpc(info.port, JSON.stringify({ id: requestSeq, cmd, params }), timeoutMs)) as Response<T>
      break
    } catch (error) {
      if (!retriedConnect && error instanceof RpcTransportError && error.phase === "connect") {
        await logTelemetry("client.rpc.retry_connect", {
          cmd,
          timeout_ms: timeoutMs,
          auto_recover: autoRecover,
          duration_ms: Date.now() - started,
          ...portFields(info),
          ...errorFields(error),
        })
        retriedConnect = true
        info = await ensure()
        continue
      }
      // GUI: don't restart the user's Blender; wait for the addon to recover or reconnect.
      if (isGui) {
        const recovered = await waitForGuiReady(info, 20_000, "rpc_transport_failure")
        await logTelemetry("client.rpc.gui_transport_failure", {
          cmd,
          timeout_ms: timeoutMs,
          auto_recover: autoRecover,
          duration_ms: Date.now() - started,
          recovered: recovered !== null,
          ...portFields(info),
          ...errorFields(error),
        })
        if (recovered) {
          throw new CommandError(
            `Blender ${cmd} transport failed (${String(error)}) but the GUI session recovered on its own. ` +
              "Retry the command — no Blender restart needed.",
          )
        }
        throw new CommandError(
          `Blender ${cmd} transport failed (${String(error)}). GUI session still busy or unreachable — ` +
            "wait for Blender to free the main thread, or use blender-checkpoint to restore.",
        )
      }
      if (!autoRecover) throw error
      await logTelemetry("client.rpc.restart_after_transport_failure", {
        cmd,
        timeout_ms: timeoutMs,
        auto_recover: autoRecover,
        duration_ms: Date.now() - started,
        ...portFields(info),
        ...errorFields(error),
      })
      await restart()
      throw new Error(
        `Blender ${cmd} transport failed or worker died (${String(error)}). Worker restarted, scene restored to ${info.last_snapshot ?? "fresh state"}.`,
      )
    }
  }
  if (!response.ok) {
    const error = response.error as { type: string; message: string; result?: unknown }
    // Soft timeout (signal) leaves the worker healthy — only poison when the
    // transport says the main thread is still stuck inside the job.
    const poisoned =
      error.type === "WorkerPoisoned" ||
      (error.type === "ExecTimeout" && String(error.message).includes("still running"))
    if (poisoned) {
      // GUI: wait for auto-unpoison instead of demanding a Blender restart
      if (isGui) {
        const recovered = await waitForGuiReady(info, 20_000, "rpc_poisoned")
        await logTelemetry("client.rpc.gui_poisoned", {
          cmd,
          timeout_ms: timeoutMs,
          duration_ms: Date.now() - started,
          recovered: recovered !== null,
          worker_error_type: error.type,
          worker_error_message: error.message,
          ...portFields(info),
        })
        if (recovered) {
          throw new CommandError(`Blender ${cmd} failed: ${error.message} Session recovered — retry.`, error.result)
        }
        throw new CommandError(
          `Blender ${cmd} failed: ${error.message} GUI session still poisoned — ` +
            "wait for the main thread to free (auto-recovers) or restart Blender.",
          error.result,
        )
      }
      if (autoRecover) {
        await logTelemetry("client.rpc.restart_after_poison", {
          cmd,
          timeout_ms: timeoutMs,
          duration_ms: Date.now() - started,
          worker_error_type: error.type,
          worker_error_message: error.message,
          ...portFields(info),
        })
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
