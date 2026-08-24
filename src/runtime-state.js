import { DEFAULT_MODEL } from "./config.js";
import { getOllamaStatus } from "./ollama.js";
import { getSearxngStatus } from "./searxng.js";

export class RuntimeState {
  constructor() {
    this.identity = "Meera";
    this.model = DEFAULT_MODEL;
    this.currentTask = "Idle";
    this.lastAction = "None";
    this.lastActionResult = "None";
    this.ollamaOnline = true;
    this.searxngOnline = true;
  }

  getCapabilities() {
    return [
      {
        id: "chat",
        name: "Local Conversational Reasoning",
        description: `High-performance local LLM chat powered by ${this.model} via Ollama`,
        enabled: true,
      },
      {
        id: "web_search",
        name: "Live Web Search & Synthesis",
        description: "Local metasearch engine via Docker SearXNG (JSON API)",
        enabled: true,
      },
      {
        id: "intent_router",
        name: "Orchestration & Intent Routing",
        description: "Schema-constrained JSON classifier directing user intents",
        enabled: true,
      },
      {
        id: "clock",
        name: "Local Clock & Timezone Context",
        description: "Live system date, time, and timezone context",
        enabled: true,
      },
      {
        id: "audit_logging",
        name: "SQLite Decision Audit Logging",
        description: "Persistent logging of all routing decisions in SQLite (decisions table)",
        enabled: true,
      },
    ];
  }

  setTask(task) {
    this.currentTask = task;
  }

  setLastAction(action, result = "Success") {
    this.lastAction = action;
    this.lastActionResult = result;
    this.currentTask = "Idle";
  }

  async refreshHealth() {
    try {
      const ollama = await getOllamaStatus(this.model).catch(() => ({ available: false }));
      this.ollamaOnline = Boolean(ollama.available);
    } catch {
      this.ollamaOnline = false;
    }

    try {
      const searxng = await getSearxngStatus().catch(() => ({ reachable: false }));
      this.searxngOnline = Boolean(searxng.reachable);
    } catch {
      this.searxngOnline = false;
    }

    return {
      identity: this.identity,
      model: this.model,
      ollamaOnline: this.ollamaOnline,
      searxngOnline: this.searxngOnline,
      toolsCount: this.getCapabilities().filter((c) => c.enabled).length,
      currentTask: this.currentTask,
      lastAction: this.lastAction,
      lastActionResult: this.lastActionResult,
    };
  }

  async getPromptContext() {
    await this.refreshHealth();
    const activeCaps = this.getCapabilities()
      .filter((c) => c.enabled)
      .map((c) => c.name)
      .join(", ");

    return `RUNTIME STATE (Live ground truth generated now):
• Assistant Identity: ${this.identity}
• Active Model: ${this.model} (via local Ollama)
• Service Health: Ollama is ${this.ollamaOnline ? "Online" : "Offline"}, SearXNG is ${this.searxngOnline ? "Online" : "Offline"}
• Available Capabilities: ${activeCaps}
• Currently Disabled / Unimplemented: File editing, shell execution, persistent memory (ChromaDB), vision screen capture, voice TTS/STT
• Current Task: ${this.currentTask}
• Last Action: ${this.lastAction} (Result: ${this.lastActionResult})

CRITICAL GROUND TRUTH RULES:
1. Always identify as Meera.
2. If asked what model you are using, accurately report ${this.model}.
3. If asked what you can do, describe only your actual available capabilities (${activeCaps}). Never claim to have tools or capabilities that are not enabled.
4. If asked what you are doing right now, describe your current task (${this.currentTask}).
5. If asked what you just did, report your last action: ${this.lastAction} with result ${this.lastActionResult}.`;
  }
}

export const runtimeState = new RuntimeState();
