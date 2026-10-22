// blender-sdf tool tests: organic mesh building through the real tool + RPC path,
// then validate + full gate on the resulting scene. Requires vendor/libfive
// (./blender/install-libfive.sh). Run from blender/:
//   bun test --parallel=1 --no-isolate

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { ToolContext } from "../../packages/plugin/src/tool"
import blenderSdf from "../../.opencode/tools/blender-sdf"
import blenderValidate from "../../.opencode/tools/blender-validate"
import blenderScene from "../../.opencode/tools/blender-scene"
import { request, status, stop } from "../../.opencode/lib/blender-client"
import type { GateReport } from "../../.opencode/tools/blender-gate"

const ROOT = join(import.meta.dir, "..", "..")

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

// Fused pebble blob: two spheres smooth-unioned — one skin, no boolean seams.
const blobSpec = {
  kind: "csg",
  op: "union",
  blend: 0.15,
  children: [
    { kind: "primitive", shape: "sphere", params: { radius: 0.35 }, location: [0, 0, 0.35] },
    { kind: "primitive", shape: "sphere", params: { radius: 0.22 }, location: [0.25, 0, 0.4] },
  ],
}

// Hollow twirled ring: shell of a twisted torus — shell + warp in one form.
const handleSpec = {
  kind: "shell",
  offset: 0.12,
  child: {
    kind: "twirl",
    axis: "z",
    amount_deg: 45,
    radius: 0.6,
    center: [1.5, 0, 0.5],
    child: {
      kind: "primitive",
      shape: "torus",
      params: { major_radius: 0.25, minor_radius: 0.14 },
      // lift the ring clear of the blob so the two objects never intersect
      location: [1.5, 0, 0.5],
    },
  },
}

beforeAll(async () => {
  await status()
  await request("reset")
}, 90_000)

afterAll(() => {
  stop()
})

describe("blender-sdf", () => {
  test("tool has description, args, execute", () => {
    expect(typeof blenderSdf.description).toBe("string")
    expect(blenderSdf.description.length).toBeGreaterThan(40)
    expect(blenderSdf.args).toBeDefined()
    expect(typeof blenderSdf.execute).toBe("function")
  })

  test("sdf_status reports libfive available", async () => {
    const reported = await request<{ available: boolean; error: string | null; install: string }>("sdf_status", {}, 15_000)
    expect(reported.available).toBe(true)
    expect(reported.error).toBeNull()
  })

  test("builds fused organic blob", async () => {
    const output = (await blenderSdf.execute({ spec: blobSpec, name: "sdf_blob", resolution: 32 }, context)) as string
    expect(output).toContain("status: ok")
    expect(output).toContain("sdf_blob")
    const verts = Number(/verts: (\d+)/.exec(output)?.[1])
    expect(verts).toBeGreaterThan(100)
  })

  test("builds shell+twirled hollow ring", async () => {
    // twirl displaces the ring ~2x beyond its static AABB and drops it in z;
    // bounds must cover the full deformed extent or the surface grazes the
    // box and MC emits cut slivers
    const output = (await blenderSdf.execute({
      spec: handleSpec,
      name: "sdf_handle",
      resolution: 32,
      bounds_min: [-0.3, -0.8, -0.4],
      bounds_max: [2.4, 0.8, 1.1],
    }, context)) as string
    expect(output).toContain("status: ok")
    expect(output).toContain("sdf_handle")
    expect(output).not.toContain("WARN: surface touches bounds")
  })

  test("scene reports both objects", async () => {
    const output = (await blenderScene.execute({ kind: "objects" }, context)) as string
    const parsed = JSON.parse(output) as { objects: Array<{ name: string; vertices?: number }> }
    const blob = parsed.objects.find((o) => o.name === "sdf_blob")
    const handle = parsed.objects.find((o) => o.name === "sdf_handle")
    expect(blob?.vertices ?? 0).toBeGreaterThan(100)
    expect(handle?.vertices ?? 0).toBeGreaterThan(100)
  })

  test("validate reports no issues on sdf objects", async () => {
    const output = (await blenderValidate.execute({}, context)) as string
    const report = JSON.parse(output) as { passed: boolean; issues: Array<{ object: string }> }
    const sdfIssues = report.issues.filter((i) => i.object === "sdf_blob" || i.object === "sdf_handle")
    expect(sdfIssues).toEqual([])
  })
})

describe("blender-sdf gate", () => {
  test("full gate passes on SDF-built scene (geometry, mesh quality, export, render)", async () => {
    const report = await request<GateReport>(
      "gate",
      { code: "import bpy\nprint('gate noop')", render: true, export_roundtrip: true, timeout: 300 },
      420_000,
    )
    if (!report.passed) {
      const failed = report.stages.find((entry) => entry.name === report.failed_stage)
      console.error("gate failed:", JSON.stringify({ failed_stage: report.failed_stage, issues: failed?.issues }, null, 2))
    }
    expect(report.passed).toBe(true)
  }, 420_000)
})
