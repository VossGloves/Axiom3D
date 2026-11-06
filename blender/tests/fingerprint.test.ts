// Manual-edit detection: fingerprint compute/diff over the live worker, gate
// report embedding, memory baseline storage, and the blender-diff tool.
// Run from blender/: bun test --parallel=1 --no-isolate

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import type { ToolContext } from "../../packages/plugin/src/tool"
import blenderExec from "../../.opencode/tools/blender-exec"
import blenderGate from "../../.opencode/tools/blender-gate"
import blenderDiff from "../../.opencode/tools/blender-diff"
import { request, restart, stop } from "../../.opencode/lib/blender-client"

const ROOT = join(import.meta.dir, "..", "..")
const MEMORY_DIR = join(ROOT, ".axiom3d", "test", "memory-fingerprint")

const context: ToolContext = {
  sessionID: "test",
  messageID: "test",
  agent: "axiom3d",
  directory: join(ROOT, ".axiom3d", "test"),
  worktree: ROOT,
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
}

type Fingerprint = { objects: Record<string, Record<string, unknown>> }
type FingerprintResult = { fingerprint: Fingerprint; diff?: Diff }
type Diff = { diverged: boolean; added: string[]; removed: string[]; changed: Array<{ name: string; fields: string[] }> }

const fingerprint = (stored: Fingerprint | null = null) =>
  request<FingerprintResult>("fingerprint", { stored }, 60_000)

beforeAll(async () => {
  process.env.AXIOM3D_MEMORY_DIR = MEMORY_DIR
  // Run beside a live GUI Blender: force the dedicated headless worker so the
  // suite never touches the user's attached session.
  process.env.AXIOM3D_BLENDER_MODE = "headless"
  await restart()
  await request("reset")
}, 90_000)

afterAll(async () => {
  stop()
  // Drop the dead headless port entry so the GUI addon timer re-registers it.
  await rm(join(ROOT, ".axiom3d", "blender.port"), { force: true })
  delete process.env.AXIOM3D_MEMORY_DIR
  // AXIOM3D_BLENDER_MODE stays set: later test files in this process must keep
  // running headless instead of attaching to the live GUI session.
})

describe("fingerprint command", () => {
  test("stable when the scene is untouched", async () => {
    await blenderExec.execute(
      {
        code: `bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
bpy.context.active_object.name = "fp_alpha"
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(5, 0, 0.5))
bpy.context.active_object.name = "fp_beta"
print("two cubes")`,
        timeout: 30,
      },
      context,
    )
    const a = await fingerprint()
    const b = await fingerprint(a.fingerprint)
    expect(b.diff?.diverged).toBe(false)
    expect(Object.keys(a.fingerprint.objects).sort()).toEqual(["fp_alpha", "fp_beta"])
  })

  test("detects a moved object", async () => {
    const before = await fingerprint()
    await blenderExec.execute(
      { code: `bpy.data.objects["fp_alpha"].location.x = 0.75
print("moved")`, timeout: 30 },
      context,
    )
    const after = await fingerprint(before.fingerprint)
    expect(after.diff?.diverged).toBe(true)
    expect(after.diff?.changed).toEqual([{ name: "fp_alpha", fields: ["bounds", "loc"] }])
  })

  test("detects added and removed objects", async () => {
    const before = await fingerprint()
    await blenderExec.execute(
      {
        code: `bpy.ops.mesh.primitive_cube_add(size=1.0, location=(10, 0, 0.5))
bpy.context.active_object.name = "fp_gamma"
bpy.data.objects.remove(bpy.data.objects["fp_beta"], do_unlink=True)
print("added gamma, removed beta")`,
        timeout: 30,
      },
      context,
    )
    const after = await fingerprint(before.fingerprint)
    expect(after.diff?.diverged).toBe(true)
    expect(after.diff?.added).toEqual(["fp_gamma"])
    expect(after.diff?.removed).toEqual(["fp_beta"])
  })

  test("detects vertex edits on the same object", async () => {
    const before = await fingerprint()
    await blenderExec.execute(
      {
        code: `import bmesh
me = bpy.data.objects["fp_gamma"].data
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.scale(bm, vec=(2.0, 1.0, 1.0), verts=bm.verts)
bm.to_mesh(me)
bm.free()
me.update()
print("scaled verts")`,
        timeout: 30,
      },
      context,
    )
    const after = await fingerprint(before.fingerprint)
    expect(after.diff?.diverged).toBe(true)
    const gamma = after.diff?.changed.find((c) => c.name === "fp_gamma")
    expect(gamma?.fields).toContain("mesh_md5")
  })
})

describe("gate + memory baseline", () => {
  test("passing gate stores fingerprint under the asset name", async () => {
    const executed = (await blenderGate.execute(
      {
        code: `bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 6, 0.5))
bpy.context.active_object.name = "fp_gate"
print("gate cube")`,
        timeout: 120,
        render: false,
        export_roundtrip: false,
        asset: "fingerprint_probe",
      },
      context,
    )) as { output: string } | string
    const raw = typeof executed === "string" ? executed : executed.output
    const report = JSON.parse(raw) as { passed: boolean; fingerprint: Fingerprint | null }
    expect(report.passed).toBe(true)
    expect(report.fingerprint?.objects?.fp_gate).toBeDefined()

    const { getAsset } = await import("../../.opencode/lib/asset-memory")
    const record = (await getAsset("fingerprint_probe")) as { fingerprint?: Fingerprint | null } | null
    expect(record?.fingerprint?.objects?.fp_gate).toBeDefined()
  })
})

describe("blender-diff tool", () => {
  test("known baseline with no edits reports clean", async () => {
    const output = (await blenderDiff.execute({ asset: "fingerprint_probe" }, context)) as string
    const result = JSON.parse(output) as Diff & { known: boolean; live_object_count: number }
    expect(result.known).toBe(true)
    expect(result.live_object_count).toBeGreaterThan(0)
    expect(result.diverged).toBe(false)
  })

  test("after a manual edit the baseline diverges", async () => {
    await blenderExec.execute(
      { code: `bpy.data.objects["fp_gate"].location.x = 1.5
print("manual edit")`, timeout: 30 },
      context,
    )
    const output = (await blenderDiff.execute({ asset: "fingerprint_probe" }, context)) as string
    const result = JSON.parse(output) as Diff & { known: boolean }
    expect(result.known).toBe(true)
    expect(result.diverged).toBe(true)
    expect(result.changed.some((c) => c.name === "fp_gate")).toBe(true)
  })

  test("unknown asset yields known:false with diverged:true", async () => {
    const output = (await blenderDiff.execute({ asset: "never_gated_asset" }, context)) as string
    const result = JSON.parse(output) as { known: boolean; diverged: boolean }
    expect(result.known).toBe(false)
    expect(result.diverged).toBe(true)
  })
})
