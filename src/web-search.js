import { ensureSearxng, SEARXNG_URL } from "./searxng.js";

const MAX_RESULTS = 5;

function cleanText(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export class SearXNGSearchProvider {
  async search(query, { signal } = {}) {
    const isReady = await ensureSearxng();
    if (!isReady) {
      throw new Error(`SearXNG is not reachable at ${SEARXNG_URL}. Please ensure Docker container 'meera-searxng' is running.`);
    }

    const searchUrl = new URL(`${SEARXNG_URL}/search`);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("format", "json");

    const response = await fetch(searchUrl, {
      headers: { "User-Agent": "Meera/1.0 (local terminal assistant)" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`SearXNG returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawResults = Array.isArray(data.results) ? data.results : [];

    const results = rawResults.slice(0, MAX_RESULTS).map((item) => ({
      title: cleanText(item.title || ""),
      url: item.url || "",
      snippet: cleanText(item.content || item.snippet || ""),
    })).filter((result) => result.title && result.url);

    if (!results.length) {
      throw new Error(`SearXNG returned no usable results for '${query}'`);
    }

    return { results };
  }
}

export function formatSearchContext(results) {
  return results.map((result, index) =>
    `[${index + 1}] ${result.title}\nURL: ${result.url}\nSummary: ${result.snippet || "No summary available."}`
  ).join("\n\n");
}
