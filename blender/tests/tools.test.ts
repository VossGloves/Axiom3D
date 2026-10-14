// Phase 2 tool-layer tests: exercises the nine .opencode/tools/blender-* tools against
// a live worker, the way the agent will call them. Run from blender/:
//   bun test --parallel=1 --no-isolate

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { ToolContext } from "../../packages/plugin/src/tool"
import blenderExec from "../../.opencode/tools/blender-exec"
import blenderScene from "../../.opencode/tools/blender-scene"
import blenderCheckpoint from "../../.opencode/tools/blender-checkpoint"
import blenderValidate from "../../.opencode/tools/blender-validate"
import blenderRender from "../../.opencode/tools/blender-render"
import blenderExport from "../../.opencode/tools/blender-export"
import blenderGate from "../../.opencode/tools/blender-gate"
import blenderDocs from "../../.opencode/tools/blender-docs"
import blenderMaterial from "../../.opencode/tools/blender-material"
import blenderModify from "../../.opencode/tools/blender-modify"
import { request, status, stop } from "../../.opencode/lib/blender-client"

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

const tools = {
  exec: blenderExec,
  scene: blenderScene,
  checkpoint: blenderCheckpoint,
  validate: blenderValidate,
  render: blenderRender,
  export: blenderExport,
  gate: blenderGate,
  docs: blenderDocs,
  material: blenderMaterial,
  modify: blenderModify,
}

beforeAll(async () => {
  await status()
  await request("reset")
}, 90_000)

afterAll(() => {
  stop()
})

describe("tool shape", () => {
  test("ten tools, each with description, args, execute", () => {
    for (const [name, definition] of Object.entries(tools)) {
      expect(typeof definition.description, name).toBe("string")
      expect(definition.description.length, name).toBeGreaterThan(40)
      expect(definition.args, name).toBeDefined()
      expect(typeof definition.execute, name).toBe("function")
    }
  })
})

describe("agent flow: crate", () => {
  test("exec creates a named cube", async () => {
    const output = (await tools.exec.execute(
      {
        code: `bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
bpy.context.active_object.name = "crate_tool"
print("made crate")`,
        timeout: 30,
      },
      context,
    )) as string
    expect(output).toContain("status: ok")
    expect(output).toContain('"crate_tool"')
  })

  test("scene reports it", async () => {
    const output = (await tools.scene.execute({ kind: "objects" }, context)) as string
    const parsed = JSON.parse(output) as { objects: Array<{ name: string; vertices?: number }> }
    const crate = parsed.objects.find((o) => o.name === "crate_tool")
    expect(crate?.vertices).toBe(8)
  })

  test("validate passes the clean crate", async () => {
    const output = (await tools.validate.execute({}, context)) as string
    const report = JSON.parse(output) as { passed: boolean; issues: Array<{ object: string }> }
    expect(report.issues.filter((i) => i.object === "crate_tool").length).toBe(0)
  })

  test("checkpoint save, delete, restore round trip", async () => {
    const saved = (await tools.checkpoint.execute({ action: "save", label: "tooltest" }, context)) as string
    expect(saved).toMatch(/^saved snap/)

    await tools.exec.execute(
      { code: `for o in list(bpy.data.objects):\n    bpy.data.objects.remove(o, do_unlink=True)`, timeout: 30 },
      context,
    )
    const emptied = (await tools.scene.execute({ kind: "objects" }, context)) as string
    expect((JSON.parse(emptied) as { objects: unknown[] }).objects.length).toBe(0)

    const restored = (await tools.checkpoint.execute({ action: "restore", id: saved.slice(6) }, context)) as string
    expect(restored).toContain("restored")
    const back = (await tools.scene.execute({ kind: "objects" }, context)) as string
    expect((JSON.parse(back) as { objects: Array<{ name: string }> }).objects.some((o) => o.name === "crate_tool")).toBe(
      true,
    )
  })

  test("render attaches a data-URL PNG", async () => {
    // generous timeout: CI renders via software GL (llvmpipe under Xvfb)
    const result = (await tools.render.execute(
      { engine: "workbench", width: 320, height: 180, views: ["front"] },
      context,
    )) as { title: string; output: string; attachments: Array<{ mime: string; url: string }> }
    expect(result.attachments.length).toBe(1)
    expect(result.attachments[0].mime).toBe("image/png")
    expect(result.attachments[0].url.startsWith("data:image/png;base64,")).toBe(true)
    expect(result.output).toContain(".png")
  }, 240_000)

  test("export resolves relative path against project", async () => {
    const output = (await tools.export.execute(
      { path: "out/crate_tool.glb", format: "glb", apply_modifiers: true },
      context,
    )) as string
    expect(output).toContain("exported glb")
    expect(output).toContain(join(".axiom3d", "test", "out", "crate_tool.glb"))
  }, 60_000)
})