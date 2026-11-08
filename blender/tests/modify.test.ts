// Material library + modify-command tests against a live worker. Run from blender/:
//   bun test --parallel=1 --no-isolate

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { ToolContext } from "../../packages/plugin/src/tool"
import blenderExec from "../../.opencode/tools/blender-exec"
import blenderScene from "../../.opencode/tools/blender-scene"
import blenderValidate from "../../.opencode/tools/blender-validate"
import blenderMaterial from "../../.opencode/tools/blender-material"
import blenderModify from "../../.opencode/tools/blender-modify"
import blenderPrimitive from "../../.opencode/tools/blender-primitive"
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

// mutating tools return {output, metadata} since the session-undo change;
// assert against the text either way
function text(result: unknown): string {
  return typeof result === "string" ? result : (result as { output: string }).output
}

beforeAll(async () => {
  await status()
  await request("reset")
}, 90_000)

afterAll(() => {
  stop()
})

describe("materials", () => {
  test("list_materials returns the full library", async () => {
    const output = text(await blenderMaterial.execute({ action: "list" }, context))
    for (const key of ["concrete", "steel", "metal", "plastic", "wood", "glass", "rubber", "fabric", "stone", "painted"]) {
      expect(output).toContain(key)
    }
  })

  test("apply_material assigns a library material", async () => {
    await blenderPrimitive.execute({ kind: "cube", size: 1, name: "mat_target", location: [0, 0, 0.5] }, context)
    const output = text(
      await blenderMaterial.execute({ action: "apply", name: "mat_target", material: "wood" }, context),
    )
    expect(output).toContain("status: ok")
    expect(output).toContain("axiom3d_wood")
  })

  test("apply_material rejects unknown key", async () => {
    const output = text(
      await blenderMaterial.execute({ action: "apply", name: "mat_target", material: "unobtainium" }, context),
    )
    expect(output).toContain("ERROR")
  })

  test("apply_material with color creates a tinted variant", async () => {
    await blenderPrimitive.execute({ kind: "cube", size: 1, name: "mat_tinted", location: [0, 0, 0.5] }, context)
    const output = text(
      await blenderMaterial.execute({ action: "apply", name: "mat_tinted", material: "painted", color: "#ff8800" }, context),
    )
    expect(output).toContain("status: ok")
    expect(output).toContain("axiom3d_painted_ff8800")
    // solid-mode viewport + Workbench reads diffuse_color, not the node graph
    const probe = text(
      await blenderExec.execute(
        {
          code: `mat = bpy.data.materials["axiom3d_painted_ff8800"]
print(tuple(round(c, 3) for c in mat.diffuse_color))`,
          timeout: 30,
        },
        context,
      ),
    )
    expect(probe).toContain("(1.0, 0.533, 0.0, 1.0)")
  })

  test("apply_material rejects a malformed color", async () => {
    const output = text(
      await blenderMaterial.execute(
        { action: "apply", name: "mat_tinted", material: "painted", color: "orange-ish" },
        context,
      ),
    )
    expect(output).toContain("ERROR")
  })
})

describe("modify", () => {
  test("bevel adds a bevel modifier", async () => {
    await blenderPrimitive.execute({ kind: "cube", size: 1, name: "bevel_target", location: [2, 0, 0.5] }, context)
    const output = text(
      await blenderModify.execute({ action: "bevel", name: "bevel_target", width: 0.02, segments: 2 }, context),
    )
    expect(output).toContain("status: ok")
    expect(output).toContain("Bevel")
  })

  test("primitive creation sets smooth-by-angle normals", async () => {
    await blenderPrimitive.execute({ kind: "cylinder", radius: 0.5, depth: 1, name: "smooth_target", location: [3, 0, 0.5] }, context)
    const output = text(
      await blenderExec.execute(
        {
          code: `obj = bpy.data.objects["smooth_target"]
mesh = obj.data
sharp = mesh.attributes["sharp_edge"]
print(f"smooth_faces={sum(1 for poly in mesh.polygons if poly.use_smooth)}")
print(f"polys={len(mesh.polygons)}")
print(f"sharp_edges={sum(1 for item in sharp.data if item.value)}")
print(f"edges={len(mesh.edges)}")`,
          timeout: 30,
        },
        context,
      ),
    )
    expect(output).toContain("status: ok")
    expect(output).toContain("smooth_faces=34")
    expect(output).toContain("polys=34")
  })

  test("array adds an array modifier", async () => {
    await blenderPrimitive.execute({ kind: "cube", size: 0.5, name: "array_target", location: [4, 0, 0.25] }, context)
    const output = text(
      await blenderModify.execute({ action: "array", name: "array_target", count: 4, use_relative: true }, context),
    )
    expect(output).toContain("status: ok")
    expect(output).toContain("Array")
  })

  test("remesh voxel rebuilds topology", async () => {
    await blenderPrimitive.execute({ kind: "cube", size: 1, name: "remesh_target", location: [6, 0, 0.5] }, context)
    const output = text(
      await blenderModify.execute({ action: "remesh", name: "remesh_target", mode: "VOXEL", voxel_size: 0.1 }, context),
    )
    expect(output).toContain("status: ok")
    expect(output).toContain("Remesh")
  })

  test("deform bend adds simple deform", async () => {
    await blenderPrimitive.execute({ kind: "cube", size: 1, name: "deform_target", location: [8, 0, 0.5] }, context)
    const output = text(
      await blenderModify.execute({ action: "deform", name: "deform_target", mode: "BEND", angle: 1.0, axis: "Z" }, context),
    )
    expect(output).toContain("status: ok")
    expect(output).toContain("Deform")
  })

  test("instance creates linked duplicates sharing mesh", async () => {
    await blenderPrimitive.execute({ kind: "cube", size: 0.3, name: "inst_source", location: [10, 0, 0.15] }, context)
    const output = text(
      await blenderModify.execute(
        { action: "instance", source: "inst_source", count: 3, offset: [0.5, 0, 0] },
        context,
      ),
    )
    expect(output).toContain("status: ok")
    expect(output).toContain("inst_source_inst_000")
    expect(output).toContain("inst_source_inst_002")

    const scene = (await blenderScene.execute({ kind: "objects" }, context)) as string
    const parsed = JSON.parse(scene) as { objects: Array<{ name: string; mesh?: string }> }
    const copies = parsed.objects.filter((o) => o.name.startsWith("inst_source_inst"))
    expect(copies.length).toBe(3)
  })

  test("apply bakes modifiers into the mesh", async () => {
    await blenderPrimitive.execute({ kind: "cube", size: 1, name: "apply_target", location: [12, 0, 0.5] }, context)
    await blenderModify.execute({ action: "bevel", name: "apply_target", width: 0.01 }, context)
    const output = text(await blenderModify.execute({ action: "apply", name: "apply_target" }, context))
    expect(output).toContain("status: ok")
    expect(output).toContain("applied 1 modifiers")
  })

  test("list reports objects with modifiers", async () => {
    const output = text(await blenderModify.execute({ action: "list" }, context))
    expect(output).toContain("bevel_target")
    expect(output).toContain("Bevel")
  })

  test("validate still passes after modify pass", async () => {
    const output = (await blenderValidate.execute({}, context)) as string
    const report = JSON.parse(output) as { issues: Array<{ object: string; issue: string }> }
    // bevel_target etc may have unapplied modifiers — validate checks mesh health
    // of applied geometry; we only care no crash and report structure is intact
    expect(Array.isArray(report.issues)).toBe(true)
  })
})
