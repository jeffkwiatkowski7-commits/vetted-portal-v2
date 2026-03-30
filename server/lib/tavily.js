/**
 * Shared Tavily web search client.
 */

export async function tavilySearch(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 5,
    }),
  });
  if (!res.ok) { console.warn("[tavily] search failed:", res.status); return null; }
  const data = await res.json();
  const results = (data.results || [])
    .map((r) => `**${r.title}** (${r.url})\n${r.content}`)
    .join("\n\n");
  return results || null;
}

export function hasTavily() {
  return !!process.env.TAVILY_API_KEY;
}
