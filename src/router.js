import { OLLAMA_URL, DEFAULT_MODEL } from "./config.js";
import { logDecision } from "./db.js";
import { getLocalToolMatch } from "./tools/registry.js";
import { subscribe } from "./event-bus.js";
import { getUnhealthyTools } from "./self-model.js";

const routerSignals = {
  networkOnline: true,
  degradedTools: new Set(),
};

subscribe("network.changed", ({ payload }) => {
  routerSignals.networkOnline = Boolean(payload?.online);
});
subscribe("tool.reliability.updated", ({ payload }) => {
  if (!payload?.toolName) return;
  if (payload.sampleSize >= 5 && payload.recentSuccessRate < 0.35) routerSignals.degradedTools.add(payload.toolName);
  else routerSignals.degradedTools.delete(payload.toolName);
});

const VALID_INTENTS = new Set(["chat", "web_search", "memory_lookup", "code_task", "vision_task", "agent_task"]);

const EXPLICIT_SEARCH_PATTERN = /\b(search (?:the )?web|look (?:this|it) up|check online|use (?:the )?internet|search online|search on(?: the)? internet|search for (?!a file\b|files\b|a folder\b|folders\b|spotify\b|my knowledge\b))\b/i;
const AGENT_ACTION_PATTERN = /\b(?:open|launch|start|close|quit|focus|read|write|create|make|delete|remove|move|copy|list|find|set|mute|unmute|turn|enable|disable|check|get|run|execute|type|press|click|take|capture)\b[\s\S]*\b(?:app|application|browser|url|file|folder|directory|desktop|path|volume|audio|brightness|wifi|wi-fi|network|bluetooth|process|program|screen|screenshot|powershell|python|script|command|terminal|clipboard|system|adapter)\b/i;
const CODE_REQUEST_PATTERN = /\b(?:write|create|build|design|generate|refactor|explain|debug)\b[\s\S]*\b(?:code|function|class|component|query|regex|regular expression|error|stack trace|python|javascript|typescript|sql|css|html|react)\b/i;
const MEMORY_CONTEXT_PATTERN = /\b(?:previous|earlier|last|before|remember|recall|saved preference)\b/i;
const INTEGRATION_ACTION_PATTERN = /(?:\b(?:gmail|notion|obsidian)\b[\s\S]*\b(?:open|read|write|create|send|search|find|list|save)\b|\b(?:open|read|write|create|send|search|find|list|save)\b[\s\S]*\b(?:gmail|notion|obsidian)\b)/i;
const GENERIC_EXPLANATION_PATTERN = /^(?:how do i|how can i|what does|what is|why)\b/i;
const POWER_ACTION_PATTERN = /\b(?:shut\s*down|restart|reboot|sleep|lock)\b[\s\S]*\b(?:computer|pc|laptop|windows|system|session)\b/i;

const ROUTER_SYSTEM_PROMPT = `You are the Meera Intent Classifier. Your ONLY job is to classify the user's latest message based on intent. Do NOT answer the user's question.

Intents:
- "chat": general conversation, questions about Meera's own identity, model, capabilities, current state, or previous actions (e.g. "what are you?", "what model are you using?", "what can you do?"), math, explanations, concepts, or general tutoring.
- "web_search": questions about current/real-time external world events, latest third-party software/model versions, release dates, live news, product prices/specs, or explicit requests to search online/web.
- "agent_task": requests to perform Windows computer actions such as: opening/closing applications, controlling volume or brightness, managing files/folders, checking Wi-Fi or network status, taking screenshots, running Python/PowerShell scripts, typing text, sending hotkeys, controlling system power, managing processes, opening URLs, or any multi-step computer automation (e.g. "open Chrome", "set volume to 40%", "create a folder on the desktop", "take a screenshot", "run a Python script", "check my Wi-Fi", "open VS Code in this project", "type hello world in notepad").
- "memory_lookup": questions about user's personal identity, stored preferences, past discussions, or remembering/recalling previous facts.
- "code_task": requests to WRITE, CREATE, or EXPLAIN code without executing it (e.g. "write a Python function", "explain this error", "build a React component"). Does NOT include running scripts — that is agent_task.
- "vision_task": requests referencing visual analysis of screen content, UI inspection, or reading what is displayed.

Rules:
- Explicit search requests ("search the web", "look this up", "check online") MUST be classified as "web_search".
- Any request to CONTROL or INTERACT with Windows/apps/system → "agent_task".
- If previous conversation was about a product, follow-up questions (e.g. "What's its price?") → "web_search".

Output strictly valid JSON with NO markdown formatting:
{
  "intent": "chat" | "web_search" | "memory_lookup" | "code_task" | "vision_task" | "agent_task",
  "confidence": number between 0.0 and 1.0,
  "needs_search": boolean,
  "needs_memory": boolean
}`;

export async function routeIntent(userInput, { history = [], signal } = {}) {
  let result = null;
  const explicitSearch = EXPLICIT_SEARCH_PATTERN.test(userInput);
  const localTool = MEMORY_CONTEXT_PATTERN.test(userInput) ? null : getLocalToolMatch(userInput);

  // Prefer a live local capability before asking Qwen to classify the request.
  // This prevents local facts such as system specs or Wi-Fi state from becoming web searches.
  if (localTool) {
    result = {
      intent: "agent_task",
      confidence: 1,
      needs_search: false,
      needs_memory: false,
    };
  } else try {
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
  if (explicitSearch) {
    if (!result) {
      result = { intent: "web_search", confidence: 0.98, needs_search: true, needs_memory: false };
    } else {
      result.intent = "web_search";
      result.needs_search = true;
      result.confidence = Math.max(result.confidence || 0.95, 0.95);
    }

  }

  // Operational requests must reach the real tool loop; do not let an uncertain
  // classifier route them into a prose-only path.
  if ((AGENT_ACTION_PATTERN.test(userInput) || INTEGRATION_ACTION_PATTERN.test(userInput) || POWER_ACTION_PATTERN.test(userInput))
    && (!CODE_REQUEST_PATTERN.test(userInput) || localTool)) {
    result = {
      intent: "agent_task",
      confidence: 0.99,
      needs_search: false,
      needs_memory: false,
    };
  }

  // Explicit external-search language wins over the classifier and broad
  // action matching, while local-specific searches remain agent tasks.
  if (explicitSearch && !/\b(?:spotify|my knowledge|a file|files|a folder|folders)\b/i.test(userInput)) {
    result = {
      intent: "web_search",
      confidence: 0.99,
      needs_search: true,
      needs_memory: false,
    };
  }

  if (result?.intent === "code_task"
    && GENERIC_EXPLANATION_PATTERN.test(userInput.trim())
    && !/\b(?:code|function|class|component|query|regex|stack trace|python|javascript|typescript|sql|css|html|react|implement|write|build|create|debug|refactor)\b/i.test(userInput)) {
    result.intent = "chat";
    result.confidence = 0.95;
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
  if (finalIntent === "web_search" && !routerSignals.networkOnline) {
    executionPath = "web_search (network_degraded)";
  }
  if (finalIntent === "agent_task") {
    const weak = getUnhealthyTools(0.35, 5);
    if (weak.length > 0) executionPath = `${executionPath} (reliability_guarded)`;
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
