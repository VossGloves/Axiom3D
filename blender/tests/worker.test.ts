// Worker protocol + client restart/restore tests for the Axiom3D Blender harness.
// Spawns a real headless Blender. Run from blender/:
//   bun test --parallel=1 --no-isolate
// (all test files share one worker through the port file; parallel file workers
// race the scene and snapshot pool). ~30-60s total: worker startup + renders

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { exec, request, restart, status, stop } from "../../.opencode/lib/blender-client"
import type { ExecResult } from "../../.opencode/lib/blender-client"

const ROOT = join(import.meta.dir, "..", "..")

function objects() {
  return request<{ objects: Array<{ name: string; vertices?: number }> }>("query", { kind: "objects" })
}

beforeAll(async () => {
  await status()
  await request("reset")
}, 90_000)

afterAll(() => {
  stop()
})

describe("worker session", () => {
  test("pings a live 5.2 session", async () => {
    const { info } = await status()
    expect(info.version).toContain("5.2")
    expect(info.poisoned).toBe(false)
  })

  test("exec round trips with stdout and scene diff", async () => {
    const result = (await exec(`
bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0, 0, 1))
bpy.context.active_object.name = "crate_test"
print("cube created")
`)) as ExecResult
    expect(result.error).toBeNull()
    expect(result.stdout).toContain("cube created")
    expect(result.scene_diff.added).toContain("crate_test")
    expect(result.snapshot).toStartWith("snap")
  })

  test("query lists the object with mesh stats", async () => {
    const { objects: list } = await objects()
    const crate = list.find((o) => o.name === "crate_test")
    expect(crate).toBeDefined()
    expect(crate?.vertices).toBe(8)
  })

  test("script errors are captured, not fatal", async () => {
    await expect(exec(`raise ValueError("boom")`)).rejects.toThrow(/ValueError.*boom/)
    const { objects: list } = await objects()
    expect(list.some((o) => o.name === "crate_test")).toBe(true)
  })

  test("validate passes clean assets and flags violations", async () => {
    const clean = await request<{ passed: boolean; issues: Array<{ object: string }> }>("validate")
    expect(clean.issues.filter((i) => i.object === "crate_test").length).toBe(0)

    await exec(`bpy.data.objects["crate_test"].scale = (2, 1, 1)`)
    const bad = await request<{ passed: boolean; issues: Array<{ object: string; issue: string }> }>("validate")
    expect(bad.passed).toBe(false)
    expect(bad.issues.some((i) => i.object === "crate_test" && i.issue === "unapplied_scale")).toBe(true)
    await exec(`bpy.data.objects["crate_test"].scale = (1, 1, 1)`)
  })
})

describe("checkpointing", () => {
  test("snapshot then restore recovers deleted objects", async () => {
    const snap = await request<{ id: string }>("snapshot", { label: "crate" })
    await exec(`
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
`)
    const emptied = await objects()
    expect(emptied.objects.length).toBe(0)

    await request("restore", { id: snap.id })
    const restored = await objects()
    expect(restored.objects.some((o) => o.name === "crate_test")).toBe(true)
  })

  test("restore of unknown snapshot fails cleanly", async () => {
    await expect(request("restore", { id: "snap9999_nope" })).rejects.toThrow(/no snapshot/)
  })
})

describe("render and export", () => {
  test("workbench multi-view render writes PNGs", async () => {
    // timeout is generous: CI renders via software GL (llvmpipe under Xvfb), slower
    // than a GPU. Workbench is CPU-only but still needs a GL context.
    const result = await request<{ files: string[]; engine_used: string }>(
      "render",
      { engine: "WORKBENCH", views: ["front", "iso"], width: 320, height: 180 },
      240_000,
    )
    expect(result.engine_used).toBe("BLENDER_WORKBENCH")
    expect(result.files.length).toBe(2)
    for (const file of result.files) {
      expect(await Bun.file(file).exists()).toBe(true)
    }
  }, 240_000)

  test("glb export writes bytes", async () => {
    const path = join(ROOT, ".axiom3d", "test", "crate.glb")
    const result = await request<{ path: string; bytes: number }>("export", { path, format: "glb" }, 60_000)
    expect(result.bytes).toBeGreaterThan(0)
    expect(await Bun.file(result.path).exists()).toBe(true)
  }, 60_000)
})

describe("watchdog", () => {
  test("hung pure-Python exec is soft-interrupted without worker restart", async () => {
    const before = await objects()
    expect(before.objects.some((o) => o.name === "crate_test")).toBe(true)

    // Soft signal timeout catches `while True` before the hard poison path, so
    // the worker stays up and the client does not need to restart + restore.
    await expect(exec("while True:\n    pass", { timeout: 1 })).rejects.toThrow(/ExecTimeout|soft timeout/)

    const { info } = await status()
    expect(info.poisoned).toBe(false)
    const after = await objects()
    expect(after.objects.some((o) => o.name === "crate_test")).toBe(true)
  }, 60_000)

  test("restart is explicit and stateful", async () => {
    await restart()
    const { info } = await status()
    expect(info.poisoned).toBe(false)
    const after = await objects()
    expect(after.objects.some((o) => o.name === "crate_test")).toBe(true)
  }, 60_000)
})