import { tool } from "@opencode-ai/plugin"

type SearchResult = {
  title: string
  url: string
  snippet: string
  imageUrl?: string
}

async function searchOpenverse(query: string, maxResults: number): Promise<SearchResult[]> {
  const response = await fetch(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${maxResults}`,
    {
      headers: { "User-Agent": "Axiom3D/1.0" },
      signal: AbortSignal.timeout(15_000),
    },
  )
  if (!response.ok) return []
  const data = await response.json()
  return (data.results ?? []).map((r: Record<string, unknown>) => ({
    title: (r.title as string) ?? "Untitled",
    url: (r.url as string) ?? "",
    snippet: `License: ${r.license ?? "unknown"}. Source: ${r.source ?? "unknown"}.`,
    imageUrl: (r.url as string) ?? undefined,
  }))
}

async function searchWikimedia(query: string, maxResults: number): Promise<SearchResult[]> {
  const searchResponse = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&format=json&srlimit=${maxResults}`,
    { headers: { "User-Agent": "Axiom3D/1.0" }, signal: AbortSignal.timeout(15_000) },
  )
  if (!searchResponse.ok) return []
  const searchData = await searchResponse.json()
  const titles = (searchData.query?.search ?? []).map((r: Record<string, string>) => r.title)
  if (titles.length === 0) return []

  const infoResponse = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join("|"))}&prop=imageinfo&iiprop=url|size&format=json`,
    { headers: { "User-Agent": "Axiom3D/1.0" }, signal: AbortSignal.timeout(15_000) },
  )
  if (!infoResponse.ok) return []
  const infoData = await infoResponse.json()
  const pages = infoData.query?.pages ?? {}

  return titles.flatMap((title: string) => {
    const page = Object.values(pages).find(
      (p: Record<string, unknown>) => (p as Record<string, unknown>).title === title,
    ) as Record<string, unknown> | undefined
    const imageInfo = (page?.imageinfo as Array<Record<string, unknown>> | undefined)?.[0]
    const url = (imageInfo?.url as string) ?? ""
    if (!url || url.endsWith(".pdf") || url.endsWith(".djvu")) return []
    return [{
      title: title.replace(/^File:/, ""),
      url,
      snippet: `Size: ${imageInfo?.width ?? "?"}x${imageInfo?.height ?? "?"}`,
      imageUrl: url,
    }]
  })
}

export default tool({
  description:
    "Search for reference images and technical drawings. Returns titles, URLs, and direct image URLs. Use before planning any 3D asset — search for orthographic drawings, dimension diagrams, blueprints. Pass image URLs to axiom3d-reference to download them.",
  args: {
    query: tool.schema.string().describe("Search query, e.g. 'wooden chair orthographic drawing'"),
    max_results: tool.schema.number().default(5).describe("Max results to return (1-10)"),
  },
  async execute(args) {
    const maxResults = Math.min(Math.max(args.max_results, 1), 10)

    try {
      const [openverse, wikimedia] = await Promise.allSettled([
        searchOpenverse(args.query, maxResults),
        searchWikimedia(args.query, maxResults),
      ])

      const results = [
        ...(openverse.status === "fulfilled" ? openverse.value : []),
        ...(wikimedia.status === "fulfilled" ? wikimedia.value : []),
      ].slice(0, maxResults)

      if (results.length === 0) {
        return `No results found for: ${args.query}`
      }

      const lines = [`Search results for: ${args.query}`, ""]
      for (const r of results) {
        lines.push(`Title: ${r.title}`)
        lines.push(`URL: ${r.url}`)
        if (r.imageUrl) lines.push(`Image: ${r.imageUrl}`)
        lines.push(`Snippet: ${r.snippet}`)
        lines.push("")
      }
      lines.push("Pass the Image URLs to axiom3d-reference to download them.")
      return lines.join("\n")
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
