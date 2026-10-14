import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

type CurveResult = {
  name: string
  type: string
  curve_type?: string
  points?: number
  verts?: number
  polys?: number
  dimensions: number[]
}

export default tool({
  description:
    "Create bezier/nurbs/poly curves, convert them to mesh, or sweep a profile along a path. Use for pipes, cables, organic shapes, railings — anything that follows a path. convert_curve_to_mesh bakes to real geometry for the gate/export.",
  args: {
    action: tool.schema
      .string()
      .describe("create | convert_to_mesh | sweep"),
    type: tool.schema
      .string()
      .optional()
      .describe("Curve type for create: bezier | nurbs | poly (default bezier)"),
    points: tool.schema
      .array(tool.schema.array(tool.schema.number()))
      .optional()
      .describe("Control points as [[x,y,z], ...]; >= 2 points required for create"),
    name: tool.schema.string().optional().describe("Object name (snake_case)"),
    extrude: tool.schema.number().optional().describe("Extrude height for flat ribbons"),
    bevel_depth: tool.schema.number().optional().describe("Bevel radius for round cross-section tubes"),
    bevel_resolution: tool.schema.number().optional().describe("Bevel resolution (default 4)"),
    fill_mode: tool.schema.string().optional().describe("Curve fill: FULL | BACK | FRONT | HALF"),
    path: tool.schema.string().optional().describe("Path curve object name for sweep"),
    profile: tool.schema.string().optional().describe("Profile curve object name for sweep"),
    material: tool.schema.string().optional().describe("Material: concrete | steel | metal | plastic | wood | glass | rubber | fabric | stone | painted"),
  },
  async execute(args) {
    const action = args.action
    try {
      if (action === "create") {
        const result = await request<CurveResult>(
          "create_curve",
          {
            type: args.type,
            points: args.points,
            name: args.name,
            extrude: args.extrude,
            bevel_depth: args.bevel_depth,
            bevel_resolution: args.bevel_resolution,
            fill_mode: args.fill_mode,
            material: args.material,
          },
          60_000,
        )
        return [
          `status: ok`,
          `created ${result.curve_type} curve "${result.name}" with ${result.points} points`,
          `dimensions: ${JSON.stringify(result.dimensions)}`,
          "Use action=convert_to_mesh to bake for gate/export, or action=sweep with a profile.",
        ].join("\n")
      }
      if (action === "convert_to_mesh") {
        const result = await request<CurveResult>(
          "convert_curve_to_mesh",
          { name: args.name },
          60_000,
        )
        return [
          `status: ok`,
          `converted "${result.name}" to mesh`,
          `verts: ${result.verts}  polys: ${result.polys}`,
          `dimensions: ${JSON.stringify(result.dimensions)}`,
        ].join("\n")
      }
      if (action === "sweep") {
        const result = await request<CurveResult>(
          "sweep_curve",
          { path: args.path, profile: args.profile, name: args.name, material: args.material },
          60_000,
        )
        return [
          `status: ok`,
          `swept profile along path → "${result.name}"`,
          `verts: ${result.verts}  polys: ${result.polys}`,
          `dimensions: ${JSON.stringify(result.dimensions)}`,
        ].join("\n")
      }
      return `ERROR: unknown action "${action}"; use create | convert_to_mesh | sweep`
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
