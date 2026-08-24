import { SearXNGSearchProvider, formatSearchContext } from "./web-search.js";

const searchProvider = new SearXNGSearchProvider();

const DATE_PATTERN = /\b(today'?s date|current date|what (?:is|day) (?:is it|today)|date today)\b/i;
const TIME_PATTERN = /\b(what time is it|current (?:local )?time|time is it|time now|date and time)\b/i;
const FRESHNESS_PATTERN = /\b(latest|newest|current|currently|today|recent|news|happening|update|updates|version|versions|release|releases|availability|available|price|prices|specification|specifications|specs|score|scores|who won|2026)\b/i;
const FOLLOW_UP_WEB_PATTERN = /\b(?:check|search|look(?: it)? up|use|verify)\b[\s\S]*\b(?:web|internet|online|web access)\b|\b(?:it'?s|that'?s)\s+(?:a|an)\s+(?:phone|laptop|product|device)\b/i;
const PRODUCT_PATTERN = /\b(?:oneplus\s*\d*|samsung|galaxy|iphone|pixel|xiaomi|redmi|nothing phone|motorola|lenovo|asus|acer|dell|macbook|surface|thinkpad|ryzen|snapdragon|geforce|rtx|radeon|core i[3579]|playstation|xbox|airpods|qwen|chatgpt|claude|gemini)\b/i;
const PRODUCT_CATEGORY_PATTERN = /\b(?:product|phone|smartphone|laptop|cpu|gpu|graphics card|processor)\b/i;
const COMPANY_PATTERN = /\b(?:openai|anthropic|google|microsoft|apple|tesla|nvidia|amd|intel|qualcomm|meta|samsung|oneplus|ollama)\b/i;
const PEOPLE_PATTERN = /\b(?:elon musk|sam altman|mark zuckerberg|satya nadella|sundar pichai|jensen huang)\b/i;
const NAMED_PERSON_QUERY_PATTERN = /\b(?:who is|who are|tell me about|news about)\s+[a-z]+\s+[a-z]+/i;

const OFFICIAL_DOMAINS = {
  samsung: ["samsung.com"], oneplus: ["oneplus.com"], ollama: ["ollama.com", "github.com/ollama"],
  qwen: ["qwenlm.github.io", "github.com/qwenlm", "huggingface.co/qwen"], openai: ["openai.com"],
  anthropic: ["anthropic.com"], google: ["google.com"], microsoft: ["microsoft.com"],
  apple: ["apple.com"], nvidia: ["nvidia.com"], amd: ["amd.com"], intel: ["intel.com"],
  asus: ["asus.com", "rog.asus.com"],
};

export function normalizeEntity(value) {
  let entity = value.trim().replace(/\s+/g, " ");
  entity = entity.replace(/\boneplus\s*(\d+)\b/gi, "OnePlus $1");
  entity = entity.replace(/\bsamsung\s+s(\d+)\s+ultra\b/gi, "Samsung Galaxy S$1 Ultra");
  entity = entity.replace(/\bgalaxy\s+s(\d+)\s+ultra\b/gi, "Samsung Galaxy S$1 Ultra");
  entity = entity.replace(/\bqwen\b/gi, "Qwen");
  entity = entity.replace(/\bollama\b/gi, "Ollama");
  return entity;
}

function productNameFrom(value) {
  const oneplus = value.match(/\boneplus\s*(\d+)\b/i);
  if (oneplus) return `OnePlus ${oneplus[1]}`;
  const samsung = value.match(/\b(?:samsung\s+)?(?:galaxy\s+)?s(\d+)\s+ultra\b/i);
  if (samsung) return `Samsung Galaxy S${samsung[1]} Ultra`;
  return null;
}

function topicKey(value) {
  const lower = value.toLowerCase();
  return Object.keys(OFFICIAL_DOMAINS).find((key) => lower.includes(key));
}

function queryPlan(subject, { followUp = false } = {}) {
  const product = productNameFrom(subject);
  const normalized = product ?? normalizeEntity(subject);
  const lower = normalized.toLowerCase();
  let queries;

  if (/^oneplus \d+$/i.test(normalized)) {
    queries = followUp
      ? [`${normalized} phone`, `${normalized} phone official`, `${normalized} phone specifications`]
      : [`${normalized} phone official`, `${normalized} phone specifications`, `${normalized} phone`];
  } else if (/^samsung galaxy s\d+ ultra$/i.test(normalized)) {
    queries = [`${normalized} official specifications`, `${normalized} specifications`, normalized];
  } else if (/\bqwen\b/.test(lower) && /\b(latest|newest|model|version)\b/.test(lower)) {
    queries = ["latest Qwen model official", "Qwen latest model official", "Qwen model release"];
  } else if (/\bollama\b/.test(lower) && /\b(latest|newest|version|release)\b/.test(lower)) {
    queries = ["latest Ollama version official", "Ollama latest release official", "Ollama GitHub releases"];
  } else if (/\bai\b/.test(lower) && /\b(news|happening|today|recent|latest)\b/.test(lower)) {
    queries = ["AI news today", "latest AI news", "AI industry news"];
  } else {
    const key = topicKey(normalized);
    queries = key ? [`${normalized} official`, normalized, `${normalized} latest`] : [normalized, `${normalized} official`, `${normalized} latest`];
  }

  return {
    subject: normalized,
    topicKey: topicKey(normalized),
    queries: [...new Set(queries.map((query) => query.replace(/\s+/g, " ").trim()))].slice(0, 3),
  };
}

// Deterministic router: no model judgement is involved in choosing web access.
export function classifyLiveRequest(message, previousUserMessage = "") {
  const wantsDate = DATE_PATTERN.test(message);
  const wantsTime = TIME_PATTERN.test(message);
  if (wantsDate || wantsTime) return { type: "clock", wantsDate, wantsTime };

  const followUp = FOLLOW_UP_WEB_PATTERN.test(message) && Boolean(previousUserMessage);
  if (followUp) return { type: "web", ...queryPlan(previousUserMessage, { followUp: true }), followUp: true };

  const shouldSearch = FRESHNESS_PATTERN.test(message)
    || PRODUCT_PATTERN.test(message)
    || PRODUCT_CATEGORY_PATTERN.test(message)
    || COMPANY_PATTERN.test(message)
    || PEOPLE_PATTERN.test(message)
    || NAMED_PERSON_QUERY_PATTERN.test(message);
  if (!shouldSearch) return { type: "none" };
  return { type: "web", ...queryPlan(message) };
}

export function getClockContext({ wantsDate, wantsTime }) {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone,
  }).format(now);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short", timeZone,
  }).format(now);
  const facts = [
    `Timezone: ${timeZone}.`, wantsDate ? `Current date: ${date}.` : null, wantsTime ? `Current time: ${time}.` : null,
  ].filter(Boolean).join("\n");
  return { context: `LIVE CLOCK CONTEXT (generated just now)\n${facts}`, date, time, timeZone };
}

function hostname(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function isOfficial(result, topic) {
  const host = hostname(result.url);
  return (OFFICIAL_DOMAINS[topic] ?? []).some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function relevance(result, subject) {
  const haystack = `${result.title} ${result.url} ${result.snippet}`.toLowerCase();
  const tokens = subject.toLowerCase().match(/[a-z]+|\d+/g)?.filter((token) => token.length > 1 || /^\d+$/.test(token)) ?? [];
  return [...new Set(tokens)].reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function rankResults(results, plan) {
  return results.map((result) => ({ ...result, official: isOfficial(result, plan.topicKey), relevance: relevance(result, plan.subject) }))
    .sort((a, b) => (Number(b.official) - Number(a.official)) || (b.relevance - a.relevance));
}

function mergeResults(results) {
  const seen = new Set();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}

function hasUsableResults(results) {
  const relevant = results.filter((result) => result.relevance > 0);
  return relevant.some((result) => result.official) || relevant.length >= 3;
}

export async function getWebContext(plan, { signal } = {}) {
  const normalizedPlan = typeof plan === "string" ? queryPlan(plan) : plan;
  const collected = [];
  const failures = [];

  for (const query of normalizedPlan.queries.slice(0, 3)) {
    try {
      const search = await searchProvider.search(query, { signal });
      collected.push(...rankResults(search.results, normalizedPlan));
      if (hasUsableResults(rankResults(mergeResults(collected), normalizedPlan))) break;
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push(error.message);
    }
  }

  const results = rankResults(mergeResults(collected), normalizedPlan).filter((result) => result.relevance > 0).slice(0, 5);
  if (!hasUsableResults(results)) {
    const detail = failures.length ? ` (${failures.join("; ")})` : "";
    throw new Error(`No reliable live results for '${normalizedPlan.subject}'${detail}`);
  }

  const officialSources = results.filter((result) => result.official);
  const verification = officialSources.length
    ? `VERIFIED LIVE SOURCE STATUS:\n${officialSources.map((result, index) => `• Official source ${index + 1}: ${result.title} (${result.url})`).join("\n")}\nThese official live pages verify that ${normalizedPlan.subject} is a real, publicly documented subject. Do not call it nonexistent, hypothetical, pending announcement, or only a future rumour.\n\n`
    : "";
  const context = `LIVE WEB SEARCH CONTEXT FOR: ${normalizedPlan.subject}
The following information was retrieved from live external sources. Use it as the primary source for current facts. Do not replace current retrieved information with your older model knowledge. If the sources do not contain enough information, say so.

${verification}Only state product details, versions, prices, dates, or availability that are explicitly supported below. Cite sources as [1], [2], and so on. Do not say the product does not exist, is unannounced, or refer to training data. Do not fabricate specifications.

${formatSearchContext(results)}`;
  return { results, context, query: normalizedPlan.queries[0] };
}
