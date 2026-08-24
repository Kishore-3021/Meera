import { OLLAMA_URL, DEFAULT_MODEL } from "./config.js";
import { logDecision } from "./db.js";

const VALID_INTENTS = new Set(["chat", "web_search", "memory_lookup", "code_task", "vision_task"]);

const EXPLICIT_SEARCH_PATTERN = /\b(search (?:the )?web|look (?:this|it) up|check online|use (?:the )?internet|search online|search for)\b/i;

const ROUTER_SYSTEM_PROMPT = `You are the Meera Intent Classifier. Your ONLY job is to classify the user's latest message based on intent. Do NOT answer the user's question.

Intents:
- "chat": general conversation, questions about Meera's own identity, model, capabilities, current state, or previous actions (e.g. "what are you?", "what model are you using?", "what can you do?", "what are you doing right now?", "what did you just do?"), math, explanations, concepts, or general tutoring.
- "web_search": questions about current/real-time external world events, latest third-party software/model versions (e.g. "What's the latest Ollama version?"), release dates, live news, product prices/specs (e.g. "Search for OnePlus 15", "iPhone 17"), or explicit requests to search online/web.
- "memory_lookup": questions about user's personal identity, stored preferences, past discussions, or remembering/recalling previous facts (e.g. "What laptop do I have?", "What did we discuss earlier?").
- "code_task": requests to write, create, fix, debug, refactor code, inspect project files, or run coding commands (e.g. "Fix this Python error", "Build a React component").
- "vision_task": requests referencing the screen, screenshots, display UI, or visual analysis (e.g. "Analyze this screenshot", "What is shown on my screen?").

Rules:
- Explicit search requests ("search the web", "look this up", "check online", "use internet") MUST be classified as "web_search" with needs_search: true.
- If previous conversation was about a product or real-world entity, follow-up questions (e.g. "What's its price?") inherit the "web_search" intent.

Output strictly valid JSON with NO markdown formatting:
{
  "intent": "chat" | "web_search" | "memory_lookup" | "code_task" | "vision_task",
  "confidence": number between 0.0 and 1.0,
  "needs_search": boolean,
  "needs_memory": boolean
}`;

export async function routeIntent(userInput, { history = [], signal } = {}) {
  let result = null;

  try {
    // Build short context from recent conversation for follow-up resolution
    const recentMessages = history.slice(-4).map((m) => `${m.role}: ${m.content}`).join("\n");
    const promptText = recentMessages
      ? `Recent Conversation:\n${recentMessages}\n\nLatest User Message: ${userInput}`
      : `Latest User Message: ${userInput}`;

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        system: ROUTER_SYSTEM_PROMPT,
        prompt: promptText,
        format: "json",
        stream: false,
        options: {
          temperature: 0.0,
          num_predict: 96,
        },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    });

    if (response.ok) {
      const data = await response.json();
      result = JSON.parse(data.response.trim());
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  // Force web_search for explicit search triggers if not caught
  if (EXPLICIT_SEARCH_PATTERN.test(userInput)) {
    if (!result) {
      result = { intent: "web_search", confidence: 0.98, needs_search: true, needs_memory: false };
    } else {
      result.intent = "web_search";
      result.needs_search = true;
      result.confidence = Math.max(result.confidence || 0.95, 0.95);
    }
  }

  let finalIntent = "chat";
  let confidence = 0.5;
  let needsSearch = false;
  let needsMemory = false;
  let executionPath = "chat";

  if (result && typeof result === "object") {
    const rawIntent = String(result.intent || "chat").toLowerCase().trim();
    if (VALID_INTENTS.has(rawIntent)) {
      finalIntent = rawIntent;
    }
    confidence = typeof result.confidence === "number" ? Math.max(0, Math.min(1, result.confidence)) : 0.85;
    needsSearch = Boolean(result.needs_search || finalIntent === "web_search");
    needsMemory = Boolean(result.needs_memory || finalIntent === "memory_lookup");

    // Confidence threshold rule: if confidence < 0.80, default to chat
    if (confidence < 0.80) {
      finalIntent = "chat";
      needsSearch = false;
      needsMemory = false;
      executionPath = "chat (low_confidence_fallback)";
    } else {
      executionPath = finalIntent;
    }
  }

  // Log every routing decision to SQLite `decisions` table
  logDecision({
    userInput,
    intent: finalIntent,
    confidence,
    needsSearch,
    needsMemory,
    executionPath,
  });

  return {
    intent: finalIntent,
    confidence,
    needsSearch,
    needsMemory,
    executionPath,
  };
}
