import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"
import { getAsset } from "../lib/asset-memory"

type Fingerprint = { objects: Record<string, Record<string, unknown>> }
type AssetWithFingerprint = { updated_at?: string; fingerprint?: Fingerprint | null }
type DiffResult = {
  fingerprint: Fingerprint
  diff?: { diverged: boolean; added: string[]; removed: string[]; changed: Array<{ name: string; fields: string[] }> }
}

export default tool({
  description:
    "Compare the live Blender scene against the stored fingerprint from the last passing gate — detects manual edits (added/removed/changed objects). Run before any refine on an existing asset: diverged or unknown baseline forces the scene-as-truth patch-only workflow (never re-run build.py).",
  args: {
    asset: tool.schema.string().describe("Asset name whose stored fingerprint to compare against"),
  },
  async execute(args) {
    try {
      const record = (await getAsset(args.asset)) as AssetWithFingerprint | null
      const stored = record?.fingerprint ?? null
      const result = await request<DiffResult>(
        "fingerprint",
        { stored: stored && stored.objects ? stored : null },
        60_000,
      )
      const liveObjectCount = Object.keys(result.fingerprint.objects).length
      if (!stored?.objects) {
        return JSON.stringify(
          {
            known: false,
            diverged: true,
            reason: "no stored fingerprint — asset never passed gate under fingerprint harness; treat live scene as source of truth",
            stored_at: null,
            live_object_count: liveObjectCount,
          },
          null,
          2,
        )
      }
      return JSON.stringify(
        {
          known: true,
          stored_at: record?.updated_at ?? null,
          live_object_count: liveObjectCount,
          ...(result.diff ?? { diverged: false, added: [], removed: [], changed: [] }),
        },
        null,
        2,
      )
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
