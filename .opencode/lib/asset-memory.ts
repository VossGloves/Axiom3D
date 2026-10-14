import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")

// AXIOM3D_MEMORY_DIR override exists for tests; production always uses .axiom3d/memory.
const files = () => {
  const dir = process.env.AXIOM3D_MEMORY_DIR ?? join(ROOT, ".axiom3d", "memory")
  return {
    dir,
    presets: join(dir, "presets.json"),
    assets: join(dir, "assets.json"),
    fixes: join(dir, "fixes.json"),
  }
}

const HISTORY_CAP = 20

export type GateSummary = {
  passed: boolean
  failed_stage: string | null
  issue_codes: string[]
  duration_ms: number
  at: string
}

async function load<T>(file: string): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch {
    return {} as T
  }
}

async function save(file: string, data: unknown): Promise<void> {
  await mkdir(files().dir, { recursive: true })
  const tmp = file + ".tmp"
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8")
  await rename(tmp, file)
}

export async function listPresets(): Promise<Record<string, unknown>> {
  return load(files().presets)
}

export async function getPreset(name: string): Promise<unknown> {
  const presets = await load<Record<string, unknown>>(files().presets)
  return presets[name] ?? null
}

export async function savePreset(name: string, value: unknown): Promise<void> {
  const presets = await load<Record<string, unknown>>(files().presets)
  presets[name] = value
  await save(files().presets, presets)
}

export async function listAssets(): Promise<Record<string, unknown>> {
  return load(files().assets)
}

export async function getAsset(name: string): Promise<unknown> {
  const assets = await load<Record<string, Record<string, unknown>>>(files().assets)
  return assets[name] ?? null
}

type AssetRecord = {
  updated_at: string
  brief?: string
  params?: Record<string, number>
  gate?: GateSummary
  history?: GateSummary[]
}

export async function upsertAsset(name: string, patch: Partial<AssetRecord>): Promise<AssetRecord> {
  const assets = await load<Record<string, AssetRecord>>(files().assets)
  const record: AssetRecord = { updated_at: new Date().toISOString(), ...assets[name], ...patch }
  assets[name] = record
  await save(files().assets, assets)
  return record
}

export async function recordGate(asset: string, report: Record<string, unknown>): Promise<void> {
  const issueCodes = new Set<string>()
  for (const stage of (report.stages as Array<Record<string, unknown>> | undefined) ?? []) {
    for (const issue of (stage.issues as Array<Record<string, unknown>> | undefined) ?? []) {
      if (typeof issue.issue === "string") issueCodes.add(issue.issue)
    }
  }
  const summary: GateSummary = {
    passed: report.passed === true,
    failed_stage: (report.failed_stage as string | null) ?? null,
    issue_codes: [...issueCodes].sort(),
    duration_ms: Number(report.duration_ms ?? 0),
    at: new Date().toISOString(),
  }
  const assets = await load<Record<string, AssetRecord>>(files().assets)
  const record = assets[asset] ?? {}
  const history = [summary, ...(record.history ?? [])].slice(0, HISTORY_CAP)
  assets[asset] = { ...record, updated_at: summary.at, gate: summary, history }
  await save(files().assets, assets)
}

type FixRecord = { strategy: string; success: number; failure: number; last_used: string }

export async function listFixes(): Promise<Record<string, FixRecord>> {
  return load(files().fixes)
}

export async function recordFixOutcome(issue: string, strategy: string, success: boolean): Promise<void> {
  const fixes = await load<Record<string, FixRecord>>(files().fixes)
  const record = fixes[issue] ?? { strategy, success: 0, failure: 0, last_used: "" }
  record.strategy = strategy
  if (success) record.success += 1
  else record.failure += 1
  record.last_used = new Date().toISOString()
  fixes[issue] = record
  await save(files().fixes, fixes)
}
