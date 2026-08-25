import { DEFAULT_MODEL } from "./config.js";
import { getOllamaStatus } from "./ollama.js";
import { getSearxngStatus } from "./searxng.js";
import { getAvailableTools, getRegistryHealth } from "./tools/registry.js";
import { getAwarenessState } from "./awareness-loop.js";
import { getToolReliabilitySnapshot } from "./self-model.js";

export class RuntimeState {
  constructor() {
    this.identity = "Meera";
    this.model = DEFAULT_MODEL;
    this.currentTask = "Idle";
    this.lastAction = "None";
    this.lastActionResult = "None";
    this.ollamaOnline = true;
    this.searxngOnline = true;
    this.agentToolCount = 0;
  }

  /** Agent capabilities derived live from the actual tool registry — never hardcoded. */
  getAgentCapabilities() {
    const tools = getAvailableTools();
    const byCategory = {};
    for (const t of tools) {
      const cat = t.category ?? "other";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(t.id);
    }
    return { tools, byCategory, count: tools.length };
  }

  getCapabilities() {
    // Core built-in capabilities
    const core = [
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

    // Agent capability generated from what the registry ACTUALLY exposes
    const { byCategory, count } = this.getAgentCapabilities();
    core.push({
      id: "agent_task",
      name: "Windows Computer Agent",
      description: count > 0
        ? `General Windows control through a ${count}-tool registry: ${Object.entries(byCategory)
            .map(([cat, ids]) => `${cat} (${ids.length})`)
            .join(", ")}`
        : "No agent tools currently available",
      enabled: count > 0,
    });
    return core;
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
    const awareness = getAwarenessState();
    if (awareness.lastSnapshot?.services) {
      this.ollamaOnline = Boolean(awareness.lastSnapshot.services.ollamaOnline);
      this.searxngOnline = Boolean(awareness.lastSnapshot.services.searxngOnline);
    } else {
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
    }

    try {
      this.agentToolCount = this.getAgentCapabilities().count;
    } catch {
      this.agentToolCount = 0;
    }
    return {
      identity: this.identity,
      model: this.model,
      ollamaOnline: this.ollamaOnline,
      searxngOnline: this.searxngOnline,
      // This is the canonical detected tool count, not the number of high-level
      // capability cards shown by /about.
      toolsCount: this.agentToolCount,
      agentToolCount: this.agentToolCount,
      registry: getRegistryHealth(),
      awareness,
      reliability: getToolReliabilitySnapshot(20),
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
    const { byCategory, count } = this.getAgentCapabilities();
    const agentLine = count > 0
      ? Object.entries(byCategory).map(([cat, ids]) => `${cat}: ${ids.join(", ")}`).join(" | ")
      : "No agent tools available";
    const weakTools = getToolReliabilitySnapshot(20)
      .filter((entry) => entry.sampleSize >= 5 && entry.recentSuccessRate < 0.4)
      .slice(0, 5)
      .map((entry) => `${entry.toolName} (${Math.round(entry.recentSuccessRate * 100)}% recent success)`)
      .join(", ");

    return `RUNTIME STATE (Live ground truth generated now):
• Assistant Identity: ${this.identity}
• Active Model: ${this.model} (via local Ollama)
• Service Health: Ollama is ${this.ollamaOnline ? "Online" : "Offline"}, SearXNG is ${this.searxngOnline ? "Online" : "Offline"}
• Available Capabilities: ${activeCaps}
• Agent Tool Registry (${count} tools, auto-detected): ${agentLine}
• Tool Reliability Alerts: ${weakTools || "No low-reliability tools currently flagged"}
• Current Task: ${this.currentTask}
• Last Action: ${this.lastAction} (Result: ${this.lastActionResult})

CRITICAL GROUND TRUTH RULES:
1. Always identify as Meera.
2. If asked what model you are using, accurately report ${this.model}.
3. If asked what you can do, describe ONLY the capabilities and tools listed above. Never claim capabilities that are not listed; never deny ones that are.
4. If asked what you are doing right now, describe your current task (${this.currentTask}).
5. If asked what you just did, report your last action: ${this.lastAction} with result ${this.lastActionResult}.
6. For computer-control requests, state that you can execute them as agent tasks (apps, files, shell, network, UI, browser, system).
7. Registry ground truth: ${count} detected tools are available; never claim a tool outside that live list.`;
  }
}

export const runtimeState = new RuntimeState();
