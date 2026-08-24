import { OLLAMA_URL, DEFAULT_MODEL } from "./config.js";
import { logDecision } from "./db.js";

const VALID_INTENTS = new Set(["chat", "web_search", "code_task", "memory_lookup", "vision_task"]);

const ROUTER_SYSTEM_PROMPT = `You are the Meera Intent Classifier. Classify the user's input into a single JSON object.

Valid intents:
- "chat": general conversation, math, logic, concepts, reasoning, explanations, or questions not needing real-time external data.
- "web_search": current real-world facts, recent events, live news, product prices/specs, release versions, sports scores, weather, or explicit search requests.
- "code_task": requests to create, read, edit, debug, or refactor workspace code files, run terminal commands, or manage git repositories.
- "memory_lookup": requests to remember, store, or recall personal preferences, profile facts, or past interactions.
- "vision_task": requests to inspect, capture, read, or analyze the user's active screen, display, or visible desktop windows.

Respond ONLY with valid JSON matching:
{
  "intent": "chat" | "web_search" | "code_task" | "memory_lookup" | "vision_task",
  "confidence": number,
  "needs_search": boolean,
  "needs_memory": boolean,
  "search_query": string or null,
  "reasoning": string
}`;

export async function routeIntent(userInput, { history = [], signal } = {}) {
  const startTime = Date.now();
  let result = null;
  let rawResponse = "";

  try {
    const recentContext = history.slice(-2).map((m) => `${m.role}: ${m.content}`).join("\n");
    const fullPrompt = recentContext
      ? `Recent Conversation Context:\n${recentContext}\n\nUser Input: ${userInput}`
      : userInput;

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        system: ROUTER_SYSTEM_PROMPT,
        prompt: fullPrompt,
        format: "json",
        stream: false,
        options: {
          temperature: 0.0,
          num_predict: 128,
        },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    });

    if (response.ok) {
      const data = await response.json();
      rawResponse = data.response;
      result = JSON.parse(rawResponse);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    // On failure or timeout, result will be null
  }

  const executionMs = Date.now() - startTime;

  // Validate and normalize classification
  let finalIntent = "chat";
  let confidence = 0.5;
  let needsSearch = false;
  let needsMemory = false;
  let searchQuery = null;
  let reasoning = "Default conversational fallback";

  if (result && typeof result === "object") {
    if (VALID_INTENTS.has(result.intent)) {
      finalIntent = result.intent;
    }
    confidence = typeof result.confidence === "number" ? Math.max(0, Math.min(1, result.confidence)) : 0.8;
    needsSearch = Boolean(result.needs_search || finalIntent === "web_search");
    needsMemory = Boolean(result.needs_memory || finalIntent === "memory_lookup");
    searchQuery = typeof result.search_query === "string" && result.search_query.trim() ? result.search_query.trim() : null;
    reasoning = typeof result.reasoning === "string" ? result.reasoning : "Classified by Qwen Router";

    // Low confidence fallback rule
    if (confidence < 0.65) {
      finalIntent = "chat";
      needsSearch = false;
      needsMemory = false;
      reasoning = `Low confidence (${confidence.toFixed(2)}) fallback to chat`;
    }
  }

  // Log decision to SQLite
  logDecision({
    userInput,
    routedIntent: finalIntent,
    confidence,
    needsSearch,
    needsMemory,
    searchQuery: searchQuery || (needsSearch ? userInput : ""),
    reasoning,
    executionMs,
  });

  return {
    intent: finalIntent,
    confidence,
    needsSearch,
    needsMemory,
    searchQuery: searchQuery || userInput,
    reasoning,
    executionMs,
  };
}
