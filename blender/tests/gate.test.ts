// Phase 3 verification-gate tests: one fixture per failure class against a live
// worker. Failure-class runs disable render/roundtrip for speed; the happy path
// exercises every stage. Run from blender/:
//   bun test --parallel=1 --no-isolate

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { request, status, stop } from "../../.opencode/lib/blender-client"
import type { GateReport } from "../../.opencode/tools/blender-gate"

const FAST = { render: false, export_roundtrip: false, timeout: 120 }

function gate(code: string, params: Record<string, unknown> = {}): Promise<GateReport> {
  const timeout = params.timeout ?? FAST.timeout
  return request<GateReport>("gate", { code, ...FAST, ...params }, (Number(timeout) + 120) * 1000)
}

function stage(report: GateReport, name: string) {
  const found = report.stages.find((entry) => entry.name === name)
  if (!found) throw new Error(`stage ${name} missing from ${report.stages.map((entry) => entry.name).join(",")}`)
  return found
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

describe("gate stage 1: syntax", () => {
  test("syntax error fails fast with line evidence, worker survives", async () => {
    const report = await gate("def broken(:\n    pass")
    expect(report.passed).toBe(false)
    expect(report.failed_stage).toBe("syntax")
    expect(stage(report, "syntax").issues?.[0]).toMatchObject({ line: 1 })
    expect(report.stages.map((entry) => entry.name)).toEqual(["syntax"])
    const { info } = await status()
    expect(info.poisoned).toBe(false)
  })
})

describe("gate stage 2: API symbols", () => {
  test("hallucinated operator fails with a suggestion and never executes", async () => {
    const report = await gate("import bpy\nbpy.ops.mesh.primitive_cube_ad(size=1.0)")
    expect(report.failed_stage).toBe("api")
    const issue = stage(report, "api").issues?.[0]
    expect(issue?.chain).toBe("bpy.ops.mesh.primitive_cube_ad")
    expect(String(issue?.message)).toContain("primitive_cube_add")
    expect(report.stages.map((entry) => entry.name)).toEqual(["syntax", "api"])
    const { objects } = await request<{ objects: unknown[] }>("query", { kind: "objects" })
    expect(objects.length).toBe(0)
  })

  test("hallucinated bpy.data collection and bmesh op are caught", async () => {
    const report = await gate("import bpy\nimport bmesh\nbpy.data.meshez.new('x')\nbmesh.ops.create_cub(bm)")
    const issues = stage(report, "api").issues ?? []
    expect(issues.some((entry) => String(entry.chain).includes("bpy.data.meshez"))).toBe(true)
    expect(issues.some((entry) => String(entry.chain).includes("bmesh.ops.create_cub"))).toBe(true)
  })

  test("clean chains produce no false positives", async () => {
    const report = await gate(
      "import bpy\nimport bmesh\nbmesh.ops.create_cube(bm=bmesh.new(), size=1.0)\nbpy.context.scene.render.engine",
      { render: false, export_roundtrip: false, timeout: 120 },
    )
    expect(report.failed_stage).not.toBe("api")
  })
})

describe("gate stage 3: exec", () => {
  test("runtime errors land on the exec stage, not a crash", async () => {
    const report = await gate('raise ValueError("boom")')
    expect(report.failed_stage).toBe("exec")
    expect(stage(report, "exec").issues?.[0]).toMatchObject({ type: "ValueError", message: "boom" })
    const { info } = await status()
    expect(info.poisoned).toBe(false)
  })
})

describe("gate stage 4: geometry", () => {
  test("unapplied scale fails geometry", async () => {
    const report = await gate(`
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
bpy.context.active_object.name = "crate_scaled"
bpy.data.objects["crate_scaled"].scale = (2, 1, 1)
`)
    expect(report.failed_stage).toBe("geometry")
    expect(
      stage(report, "geometry").issues?.some((entry) => entry.object === "crate_scaled" && entry.issue === "unapplied_scale"),
    ).toBe(true)
    expect(report.stages.map((entry) => entry.name)).toEqual(["syntax", "api", "exec", "geometry", "mesh_quality"])
  })

  test("default naming and non-snake_case names fail geometry", async () => {
    const report = await gate(`
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.4, location=(3, 0, 0.4))
bpy.context.active_object.name = "Bad Name"
`)
    const issues = stage(report, "geometry").issues ?? []
    expect(issues.some((entry) => entry.issue === "default_name")).toBe(true)
    expect(issues.some((entry) => entry.issue === "bad_naming" && entry.object === "Bad Name")).toBe(true)
  })

  test("non-manifold mesh is flagged; open_surface opt-out suppresses it", async () => {
    const openShell = `
import bmesh
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
obj = bpy.context.active_object
obj.name = "shell_open"
bm = bmesh.new()
bm.from_mesh(obj.data)
bm.faces.ensure_lookup_table()
bm.faces.remove(bm.faces[0])
bm.to_mesh(obj.data)
bm.free()
`
    const flagged = await gate(openShell)
    expect(
      stage(flagged, "geometry").issues?.some((entry) => entry.issue === "non_manifold" && entry.object === "shell_open"),
    ).toBe(true)
    expect(stage(flagged, "mesh_quality").issues?.some((entry) => entry.issue === "not_watertight")).toBe(true)

    await request("reset")
    const optedOut = await gate(`${openShell}\nobj["open_surface"] = True`)
    expect(
      stage(optedOut, "geometry").issues?.filter((entry) => entry.issue === "non_manifold" && entry.object === "shell_open")
        .length ?? 0,
    ).toBe(0)
  })

  test("flipped face fails geometry", async () => {
    const report = await gate(`
import bmesh
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
obj = bpy.context.active_object
obj.name = "crate_flipped"
bm = bmesh.new()
bm.from_mesh(obj.data)
bm.faces.ensure_lookup_table()
bm.faces[0].normal_flip()
bm.to_mesh(obj.data)
bm.free()
`)
    expect(
      stage(report, "geometry").issues?.some((entry) => entry.issue === "flipped_faces" && entry.object === "crate_flipped"),
    ).toBe(true)
  })

  test("a script that creates nothing fails with no_mesh_objects", async () => {
    const report = await gate("print('did nothing')")
    expect(report.failed_stage).toBe("geometry")
    expect(stage(report, "geometry").issues?.some((entry) => entry.issue === "no_mesh_objects")).toBe(true)
  })
})

describe("gate stage 5: mesh quality", () => {
  test("overlapping shells inside one mesh fail with self_intersection", async () => {
    const report = await gate(`
import bmesh
import mathutils
mesh = bpy.data.meshes.new("jammed")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.create_cube(bm, size=1.0, matrix=mathutils.Matrix.Translation((0.5, 0, 0)))
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("jammed_crates", mesh)
bpy.context.scene.collection.objects.link(obj)
`)
    const quality = stage(report, "mesh_quality")
    expect(quality.issues?.some((entry) => entry.issue === "self_intersection" && entry.object === "jammed_crates")).toBe(
      true,
    )
    expect(quality.passed).toBe(false)
  })

  test("overlapping separate objects fail with object_intersection", async () => {
    const report = await gate(`
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
bpy.context.active_object.name = "block_west"
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.5, 0, 0.5))
bpy.context.active_object.name = "block_east"
`)
    expect(report.failed_stage).toBe("mesh_quality")
    expect(stage(report, "geometry").passed).toBe(true)
    expect(
      stage(report, "mesh_quality").issues?.some(
        (entry) => entry.issue === "object_intersection" && String(entry.detail).includes("block_west"),
      ),
    ).toBe(true)
  })

  test("joined shells with a gap fail with floating_component", async () => {
    const report = await gate(`
import bmesh
import mathutils
mesh = bpy.data.meshes.new("gapped")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.create_cube(bm, size=1.0, matrix=mathutils.Matrix.Translation((1.01, 0, 0)))
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("bench_gapped", mesh)
bpy.context.scene.collection.objects.link(obj)
`)
    const quality = stage(report, "mesh_quality")
    expect(quality.issues?.some((entry) => entry.issue === "floating_component" && entry.object === "bench_gapped")).toBe(
      true,
    )
    expect(quality.passed).toBe(false)
  })

  test("joined face-touching assembly passes mesh quality", async () => {
    const report = await gate(`
import bmesh
import mathutils
mesh = bpy.data.meshes.new("touching")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.create_cube(bm, size=1.0, matrix=mathutils.Matrix.Translation((1.0, 0, 0)))
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("crate_touching", mesh)
obj["assembly"] = True
bpy.context.scene.collection.objects.link(obj)
`)
    const quality = stage(report, "mesh_quality")
    expect((quality.issues ?? []).some((entry) => entry.issue === "floating_component")).toBe(false)
    expect(quality.passed).toBe(true)
  })

  test("assembly opt-out does not hide floating_component", async () => {
    const report = await gate(`
import bmesh
import mathutils
mesh = bpy.data.meshes.new("gapped_assembly")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.create_cube(bm, size=1.0, matrix=mathutils.Matrix.Translation((1.01, 0, 0)))
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("bench_assembly_gapped", mesh)
obj["assembly"] = True
bpy.context.scene.collection.objects.link(obj)
`)
    const quality = stage(report, "mesh_quality")
    expect(
      quality.issues?.some(
        (entry) => entry.issue === "floating_component" && entry.object === "bench_assembly_gapped",
      ),
    ).toBe(true)
    expect(quality.passed).toBe(false)
  })
})

describe("gate full pipeline", () => {
  test("a clean crate passes every stage including roundtrip and renders", async () => {
    const report = await gate(
      `
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
bpy.context.active_object.name = "crate_gate"
`,
      { timeout: 300, render: true, export_roundtrip: true },
    )
    expect(report.passed).toBe(true)
    expect(report.failed_stage).toBeNull()
    for (const name of ["syntax", "api", "exec", "geometry", "mesh_quality", "export_roundtrip", "render"]) {
      expect(stage(report, name).passed).toBe(true)
    }
    expect((stage(report, "render").detail?.files as string[]).length).toBe(6)
    const roundtrip = stage(report, "export_roundtrip").detail
    expect((roundtrip?.pre as { objects: number }).objects).toBe(1)
    expect((roundtrip?.post as { objects: number }).objects).toBe(1)
  }, 420_000)
})