// Repair + memory tests against a live worker. Run from blender/:
//   bun test --parallel=1 --no-isolate repair.test.ts

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { request, status, stop } from "../../.opencode/lib/blender-client"
import blenderRepair from "../../.opencode/tools/blender-repair"
import blenderValidate from "../../.opencode/tools/blender-validate"
import type { ToolContext } from "../../packages/plugin/src/tool"

const context: ToolContext = {
  sessionID: "test",
  messageID: "test",
  agent: "axiom3d",
  directory: join(import.meta.dir, "..", "..", ".axiom3d", "test"),
  worktree: join(import.meta.dir, "..", ".."),
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
}

beforeAll(async () => {
  await status()
  await request("reset")
}, 90_000)

beforeEach(async () => {
  await request("reset")
})

afterAll(() => {
  stop()
})

describe("repair command", () => {
  test("fixes default name, unapplied scale, missing UV; residual passes", async () => {
    await request("exec", {
      code: `
import bpy
mesh = bpy.data.meshes.new("raw")
mesh.from_pydata([(0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 0), (0, 0, 2), (2, 0, 2), (2, 2, 2), (0, 2, 2)], [], [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
obj = bpy.data.objects.new("Cube", mesh)
bpy.context.scene.collection.objects.link(obj)
obj.location = (0, 0, 1)
obj.scale = (2.0, 1.0, 1.0)
`,
      snapshot: false,
    })
    const result = await request<{
      fixed: Array<{ object: string; issue: string }>
      skipped: Array<{ issue: string }>
      residual: { passed: boolean; issues: Array<{ issue: string }> }
    }>("repair", {}, 120_000)
    const codes = result.fixed.map((entry) => entry.issue)
    expect(codes).toContain("default_name")
    expect(codes).toContain("unapplied_scale")
    expect(codes).toContain("missing_uv")
    expect(result.residual.passed).toBe(true)
    const objects = await request<{ objects: Array<{ name: string; scale: number[] }> }>("query", { kind: "objects" })
    expect(objects.objects[0].name).toMatch(/^mesh_asset_\d+$/)
    expect(objects.objects[0].scale).toEqual([1, 1, 1])
  })

  test("issues filter restricts fixers; design-level codes come back skipped", async () => {
    await request("exec", {
      code: `
import bpy
bpy.ops.mesh.primitive_cube_add(size=0.0005, location=(0, 0, 0))
`,
      snapshot: false,
    })
    const result = await request<{ fixed: unknown[]; skipped: Array<{ issue: string }> }>(
      "repair",
      { issues: ["degenerate"] },
      120_000,
    )
    expect(result.fixed.length).toBe(0)
    expect(result.skipped.map((entry) => entry.issue)).toContain("degenerate")
  })

  test("repair tool surfaces the report", async () => {
    await request("exec", {
      code: `
import bpy
bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0, 0, 1))
`,
      snapshot: false,
    })
    const out = (await blenderRepair.execute({}, context)) as string
    const report = JSON.parse(out)
    expect(report.residual.passed).toBe(true)
    expect(report.fixed.some((entry: { issue: string }) => entry.issue === "default_name")).toBe(true)
  })

  test("validate is clean after repair", async () => {
    await request("exec", {
      code: `
import bpy
bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0, 0, 1))
bpy.context.active_object.scale = (3.0, 1.0, 1.0)
`,
      snapshot: false,
    })
    await request("repair", {}, 120_000)
    const out = (await blenderValidate.execute({}, context)) as string
    const report = JSON.parse(out)
    expect(report.passed).toBe(true)
  })
})

describe("asset memory", () => {
  test("record_gate writes asset history and gate summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "axiom-memory-"))
    process.env.AXIOM3D_MEMORY_DIR = dir
    try {
      const { recordGate, getAsset } = await import("../../.opencode/lib/asset-memory")
      await recordGate("test_asset", {
        passed: false,
        failed_stage: "geometry",
        duration_ms: 12,
        stages: [{ name: "geometry", passed: false, issues: [{ issue: "missing_uv" }, { issue: "flipped_faces" }] }],
      })
      const asset = (await getAsset("test_asset")) as { gate: { issue_codes: string[] }; history: unknown[] }
      expect(asset.gate.issue_codes).toEqual(["flipped_faces", "missing_uv"])
      expect(asset.history.length).toBe(1)
    } finally {
      delete process.env.AXIOM3D_MEMORY_DIR
      await rm(dir, { recursive: true, force: true })
    }
  })
})
