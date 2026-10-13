import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

type AssemblyResult = {
  assembly?: string
  members?: string[]
  member_count?: number
  location?: number[]
  dissolved?: string
  released?: string[]
  released_count?: number
  tagged?: string[]
  tagged_count?: number
  assemblies?: Array<Record<string, unknown>>
  loose_assembly_members?: string[]
}

export default tool({
  description:
    "Group multi-part assets under an assembly empty. Members get obj['assembly']=True (gate self-intersection opt-out for intentional joint overlaps). create_assembly parents objects; mark_assembly tags without empty; dissolve_assembly releases members.",
  args: {
    action: tool.schema.string().describe("create | list | dissolve | mark"),
    name: tool.schema.string().optional().describe("Assembly empty name (create/dissolve)"),
    members: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Object names to group/tag (create/mark)"),
    location: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("[x,y,z] for the assembly empty (create)"),
  },
  async execute(args) {
    try {
      if (args.action === "list") {
        const result = await request<AssemblyResult>("list_assemblies", {}, 30_000)
        return JSON.stringify(result, null, 2)
      }
      if (args.action === "dissolve") {
        const result = await request<AssemblyResult>("dissolve_assembly", { name: args.name }, 30_000)
        return [
          `status: ok`,
          `dissolved assembly "${result.dissolved}"`,
          `released: ${result.released?.join(", ")}`,
        ].join("\n")
      }
      if (args.action === "mark") {
        const result = await request<AssemblyResult>("mark_assembly", { members: args.members }, 30_000)
        return [
          `status: ok`,
          `tagged ${result.tagged_count} objects as assembly members`,
          `tagged: ${result.tagged?.join(", ")}`,
        ].join("\n")
      }
      // create
      const result = await request<AssemblyResult>(
        "create_assembly",
        { name: args.name, members: args.members, location: args.location },
        30_000,
      )
      return [
        `status: ok`,
        `created assembly "${result.assembly}" with ${result.member_count} members`,
        `members: ${result.members?.join(", ")}`,
        `location: ${JSON.stringify(result.location)}`,
      ].join("\n")
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
