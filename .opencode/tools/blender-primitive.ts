import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

type PrimitiveResult = {
  name: string
  type: string
  verts: number
  polys: number
  dimensions: number[]
  location: number[]
}

export default tool({
  description:
    "Create a primitive mesh in the Blender scene: cube, uv_sphere, ico_sphere, cylinder, cone, torus, plane, circle, grid. Auto-applies transforms, grounds to Z=0, ensures UV layer. Use for base shapes; use blender-template for railway/station parametric assets.",
  args: {
    kind: tool.schema
      .string()
      .describe("Primitive type: cube | uv_sphere | ico_sphere | cylinder | cone | torus | plane | circle | grid"),
    name: tool.schema.string().optional().describe("Object name (snake_case)"),
    size: tool.schema.number().optional().describe("Cube/plane/grid size in meters"),
    radius: tool.schema.number().optional().describe("Sphere/cylinder/cone/circle/torus radius"),
    depth: tool.schema.number().optional().describe("Cylinder/cone depth (height)"),
    major_radius: tool.schema.number().optional().describe("Torus major radius"),
    minor_radius: tool.schema.number().optional().describe("Torus minor radius"),
    vertices: tool.schema.number().optional().describe("Vertex count for cylinder/cone/circle/torus"),
    segments: tool.schema.number().optional().describe("Sphere segments"),
    rings: tool.schema.number().optional().describe("Sphere rings"),
    subdivisions: tool.schema.number().optional().describe("Ico sphere subdivisions"),
    x_subdivisions: tool.schema.number().optional().describe("Grid X subdivisions"),
    y_subdivisions: tool.schema.number().optional().describe("Grid Y subdivisions"),
    fill_type: tool.schema.string().optional().describe("Circle fill: NOTHING | NGON | TRIFAN"),
    location: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("[x,y,z] location; grounded to Z=0 after creation"),
    material: tool.schema.string().optional().describe("Material: concrete | steel"),
  },
  async execute(args) {
    try {
      const result = await request<PrimitiveResult>("create_primitive", args as Record<string, unknown>, 60_000)
      return [
        `status: ok`,
        `created ${args.kind} as "${result.name}"`,
        `verts: ${result.verts}  polys: ${result.polys}`,
        `dimensions: ${JSON.stringify(result.dimensions)}`,
        `location: ${JSON.stringify(result.location)}`,
        "Run blender-validate or blender-gate to confirm it is clean before composing.",
      ].join("\n")
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
