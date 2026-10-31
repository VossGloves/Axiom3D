import { tool } from "@opencode-ai/plugin"
import { request } from "../lib/blender-client"

// LRU cache for API lookups: same query returns instantly without a Blender roundtrip.
// API facts are stable per Blender version, so caching is safe and never
// reuses asset designs — only API surface info.
const CACHE_MAX = 100
const cache = new Map<string, string>()

function cacheGet(key: string): string | undefined {
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

function cacheSet(key: string, value: string) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

export default tool({
  description:
    "Look up Blender 5.2 API facts before planning: node/type sockets and methods (read live from the install), tested pattern snippets, and 5.0-5.2 breaking changes. Query by name, e.g. 'Principled BSDF sockets', 'Curve to Mesh', 'bmesh edit'. Results are cached per query (API surface only — never asset designs). Retrieve before you plan — never guess API details.",
  args: {
    query: tool.schema.string().describe("What to look up, e.g. 'Principled BSDF sockets in 5.2' or 'bmesh edit loop'"),
    limit: tool.schema.number().default(3).describe("Max pattern snippets to return"),
  },
  async execute(args) {
    const key = `${args.query}|${args.limit}`
    const cached = cacheGet(key)
    if (cached !== undefined) return cached
    try {
      const result = await request<Record<string, unknown>>(
        "docs",
        { query: args.query, limit: args.limit },
        60_000,
      )
      const payload = JSON.stringify(result, null, 2)
      cacheSet(key, payload)
      return payload
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
