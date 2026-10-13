import { tool } from "@opencode-ai/plugin"

type SearchResult = {
  title: string
  url: string
  snippet: string
}

function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  const titles: Array<{ url: string; title: string }> = []
  let match
  while ((match = resultRegex.exec(html)) !== null) {
    const url = match[1]
    const title = match[2].replace(/<[^>]+>/g, "").trim()
    if (url.startsWith("http")) {
      titles.push({ url, title })
    }
  }

  const snippets: string[] = []
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]+>/g, "").trim())
  }

  for (let i = 0; i < Math.min(titles.length, snippets.length, 8); i++) {
    results.push({
      title: titles[i].title,
      url: titles[i].url,
      snippet: snippets[i],
    })
  }
  return results
}

export default tool({
  description:
    "Search the web via DuckDuckGo. Returns titles, URLs, and snippets for reference images, dimensions, technical drawings. Use before planning any 3D asset — search for orthographic drawings, dimension diagrams, blueprints of the target asset.",
  args: {
    query: tool.schema.string().describe("Search query, e.g. 'train station platform orthographic drawing'"),
    max_results: tool.schema.number().default(5).describe("Max results to return (1-10)"),
  },
  async execute(args) {
    const query = encodeURIComponent(args.query)
    const maxResults = Math.min(Math.max(args.max_results, 1), 10)

    try {
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
        },
        signal: AbortSignal.timeout(15_000),
      })

      if (!response.ok) {
        return `ERROR: search failed with status ${response.status}`
      }

      const html = await response.text()
      const results = parseDuckDuckGoHtml(html).slice(0, maxResults)

      if (results.length === 0) {
        return `No results found for: ${args.query}`
      }

      const lines = [`Search results for: ${args.query}`, ""]
      for (const r of results) {
        lines.push(`Title: ${r.title}`)
        lines.push(`URL: ${r.url}`)
        lines.push(`Snippet: ${r.snippet}`)
        lines.push("")
      }
      return lines.join("\n")
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
