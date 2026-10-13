import { tool } from "@opencode-ai/plugin"
import {
  getAsset,
  getPreset,
  listAssets,
  listFixes,
  listPresets,
  recordFixOutcome,
  recordGate,
  savePreset,
  upsertAsset,
} from "../lib/asset-memory"

const OPS = [
  "presets.get",
  "presets.list",
  "presets.save",
  "assets.get",
  "assets.list",
  "assets.save",
  "record_gate",
  "fixes.list",
  "fixes.record",
] as const

export default tool({
  description:
    "Asset memory: persistent presets (named template param sets), per-asset records (brief, params, gate history), and learned fix outcomes. Use before planning (check presets/assets for prior work) and after builds (save preset, record gate). Storage: .axiom3d/memory/*.json.",
  args: {
    op: tool.schema.enum(OPS).describe("Memory operation"),
    key: tool.schema.string().optional().describe("Preset or asset name (presets.*, assets.*, fixes.record)"),
    value: tool.schema
      .string()
      .optional()
      .describe("JSON payload: preset/asset record for save ops, gate report for record_gate, fix outcome {issue, strategy, success} for fixes.record"),
  },
  async execute(args) {
    try {
      const value = args.value ? (JSON.parse(args.value) as Record<string, unknown>) : null
      switch (args.op) {
        case "presets.list":
          return JSON.stringify(await listPresets(), null, 2)
        case "presets.get": {
          if (!args.key) return "ERROR: presets.get requires key"
          const preset = await getPreset(args.key)
          return preset === null ? `no preset "${args.key}"` : JSON.stringify(preset, null, 2)
        }
        case "presets.save": {
          if (!args.key || !value) return "ERROR: presets.save requires key and value (JSON)"
          await savePreset(args.key, value)
          return `preset "${args.key}" saved`
        }
        case "assets.list":
          return JSON.stringify(await listAssets(), null, 2)
        case "assets.get": {
          if (!args.key) return "ERROR: assets.get requires key"
          const asset = await getAsset(args.key)
          return asset === null ? `no asset "${args.key}"` : JSON.stringify(asset, null, 2)
        }
        case "assets.save": {
          if (!args.key || !value) return "ERROR: assets.save requires key and value (JSON)"
          await upsertAsset(args.key, value)
          return `asset "${args.key}" saved`
        }
        case "record_gate": {
          if (!args.key || !value) return "ERROR: record_gate requires key (asset name) and value (gate report JSON)"
          await recordGate(args.key, value)
          return `gate recorded for asset "${args.key}"`
        }
        case "fixes.list":
          return JSON.stringify(await listFixes(), null, 2)
        case "fixes.record": {
          if (!value || typeof value.issue !== "string" || typeof value.strategy !== "string")
            return 'ERROR: fixes.record requires value JSON {issue, strategy, success}'
          await recordFixOutcome(value.issue, value.strategy, value.success === true)
          return `fix outcome recorded for "${value.issue}"`
        }
      }
      return `ERROR: unknown op ${args.op}`
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
