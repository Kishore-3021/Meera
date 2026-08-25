/**
 * Tool Registry — Central hub for all Meera agent tools.
 *
 * Tools register themselves here. The registry:
 *  - Runs capability detection at startup (once, cached)
 *  - Exposes available tools to the planner as a compact schema
 *  - Resolves tool IDs to their execute() implementations
 *  - Can be extended by simply adding new tool files and calling register()
 */

import { allSystemTools } from "./tools/system.js";
import { allAppTools } from "./tools/apps.js";
import { allBrowserTools } from "./tools/browser.js";
import { allFileTools } from "./tools/files.js";
import { allNetworkTools } from "./tools/network.js";
import { allExecTools } from "./tools/exec.js";
import { allUITools } from "./tools/ui.js";
import { allExtendedTools } from "./tools/extended.js";
import { allProductivityTools } from "./tools/productivity.js";
import { allIntegrationTools } from "./tools/integrations.js";
import { allCloudIntegrationTools } from "./tools/cloud-integrations.js";
import { normalizeWindowsPath } from "./paths.js";

const ALL_TOOLS = [
  ...allSystemTools,
  ...allAppTools,
  ...allBrowserTools,
  ...allFileTools,
  ...allNetworkTools,
  ...allExecTools,
  ...allUITools,
  ...allExtendedTools,
  ...allProductivityTools,
  ...allIntegrationTools,
  ...allCloudIntegrationTools,
];

/** @type {Map<string, Object>} id → tool definition */
const registry = new Map();

/** @type {Set<string>} IDs of tools that passed capability detection */
const available = new Set();

/** @type {boolean} Whether detect() has been run */
let detected = false;

/**
 * Register a tool definition.
 * @param {Object} tool — must have { id, name, description, category, permissionLevel, parameters, detect, execute }
 */
export function register(tool) {
  if (!tool.id || !tool.execute) throw new Error(`Tool missing id or execute: ${JSON.stringify(tool)}`);
  registry.set(tool.id, tool);
}

/**
 * Run capability detection for all registered tools.
 * Results are cached — call once at startup.
 * @returns {string[]} List of available tool IDs
 */
export async function detectCapabilities() {
  if (detected) return [...available];
  detected = true;

  const results = await Promise.allSettled(
    [...registry.values()].map(async (tool) => {
      try {
        const ok = tool.detect ? await tool.detect() : true;
        if (ok) available.add(tool.id);
      } catch {
        // detect() failure = tool unavailable
      }
    })
  );

  return [...available];
}

/**
 * Get a tool by ID. Returns null if not registered or not available.
 */
export function getTool(id) {
  const tool = registry.get(id);
  if (!tool) return null;
  if (!available.has(id)) return null;
  return tool;
}

/** Resolve an exact ID or a conservative human-name variant to a registered tool. */
export function resolveToolId(id) {
  if (getTool(id)) return id;
  const normalize = (value) => String(value).toLowerCase()
    .replace(/\b(new|make)\b/g, "create")
    .replace(/[^a-z0-9]/g, "");
  const target = normalize(id);
  if (!target) return null;
  const match = getAvailableTools().find((tool) => normalize(tool.id) === target || normalize(tool.name) === target);
  return match?.id ?? null;
}

/**
 * Get all available tools.
 */
export function getAvailableTools() {
  return [...available].map((id) => registry.get(id)).filter(Boolean);
}

/** Return every registered definition with live detection state. */
export function getRegistrySnapshot() {
  return [...registry.values()].map((tool) => ({
    ...tool,
    available: available.has(tool.id),
  }));
}

/** Return the canonical counts used by status, self-awareness, and diagnostics. */
export function getRegistryHealth() {
  return {
    registered: registry.size,
    loaded: available.size,
    detected,
    missing: [...registry.keys()].filter((id) => !available.has(id)),
  };
}

/**
 * Verify that detection did not leave a definition/count mismatch.
 * Detection failures remain explicit; they are never silently reported as loaded.
 */
export function registrySelfCheck() {
  const health = getRegistryHealth();
  const definitionIds = new Set(registry.keys());
  const loadedIds = [...available].filter((id) => definitionIds.has(id));
  const consistent = health.loaded === loadedIds.length && health.loaded <= health.registered;
  if (!consistent) {
    console.warn(`[registry] self-check mismatch: ${health.loaded}/${health.registered} detected tools.`);
  }
  return { ...health, consistent };
}

/** Literal, compact registry output for the /tools command. */
export function formatRegistryDump() {
  const health = getRegistryHealth();
  const lines = [`TOOLS (${health.loaded}/${health.registered} detected)`];
  for (const tool of getRegistrySnapshot()) {
    const state = tool.available ? "available" : "unavailable";
    const params = (tool.parameters ?? [])
      .map((p) => `${p.name}:${p.type}${p.required ? "" : "?"}`)
      .join(", ") || "none";
    lines.push(`${tool.id} [${state}] (${tool.category}, ${tool.permissionLevel}) params(${params}) — ${tool.description}`);
  }
  return lines.join("\n");
}

/** Find whether a live local capability clearly covers a request category. */
export function getLocalToolMatch(request) {
  const text = String(request).toLowerCase();
  const patterns = [
    { pattern: /\b(system specs?|computer specs?|hardware specs?|cpu|ram|memory|gpu|graphics card|battery|operating system|os version|disk usage|hostname|computer name)\b/, categories: ["system"] },
    { pattern: /\b(volume|sound|audio|mute|unmute)\b/, categories: ["system"] },
    { pattern: /\b(wifi|wi-fi|wireless|network adapter|bluetooth)\b/, categories: ["network"] },
    { pattern: /\b(processes?|running apps?|open windows?)\b/, categories: ["apps", "system"] },
    { pattern: /\b(battery|charge|runtime)\b/, categories: ["system"] },
    { pattern: /\b(file search|find a file|search files|metadata|file size)\b/, categories: ["files"] },
    { pattern: /\b(service|services)\b/, categories: ["system"] },
    { pattern: /\b(dns|resolve hostname|ping)\b/, categories: ["network"] },
    { pattern: /\b(zip|archive|compress)\b/, categories: ["files"] },
    { pattern: /\b(spotify|music|song|track|album|artist)\b/, categories: ["media", "apps"] },
    { pattern: /\b(gmail|email|mail|inbox)\b/, categories: ["communication"] },
    { pattern: /\b(notion|obsidian|vault|knowledge base|notes?)\b/, categories: ["knowledge"] },
    { pattern: /\b(task|todo|reminder|knowledge base|snippet)\b/, categories: ["productivity"] },
    { pattern: /\b(clipboard)\b/, categories: ["system", "ui"] },
  ];
  for (const candidate of patterns) {
    if (!candidate.pattern.test(text)) continue;
    const tool = getAvailableTools().find((entry) => candidate.categories.includes(entry.category)
      && candidate.pattern.test(`${entry.name} ${entry.description}`.toLowerCase()));
    if (tool) return tool;
  }
  return null;
}

function normalizeType(value, type) {
  if (type === "number" && typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  if (type === "boolean" && typeof value === "string") {
    if (/^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === "true";
  }
  return value;
}

function normalizePathParameter(name, value) {
  if (!["path", "from", "to", "cwd"].includes(name) || typeof value !== "string") return value;
  // Keep command arguments and app names untouched; only path-shaped parameters are normalized.
  return value.includes("\\") || value.includes("/") || /^%|^~|^desktop$/i.test(value.trim())
    ? normalizeWindowsPath(value)
    : value;
}

/**
 * Validate and normalize model-produced parameters against the registered schema.
 * Unknown fields are rejected so a hallucinated argument cannot reach a tool.
 */
export async function validateToolParams(tool, rawParams = {}) {
  if (!rawParams || typeof rawParams !== "object" || Array.isArray(rawParams)) {
    return { valid: false, error: "Tool parameters must be a JSON object." };
  }
  const definitions = tool.parameters ?? [];
  if (Array.isArray(tool.requiresOneOf) && !tool.requiresOneOf.some((name) => rawParams[name] !== undefined && rawParams[name] !== null && rawParams[name] !== "")) {
    return { valid: false, error: `At least one of these parameters is required: ${tool.requiresOneOf.join(", ")}.` };
  }
  const allowed = new Set(definitions.map((parameter) => parameter.name));
  const unknown = Object.keys(rawParams).filter((name) => !allowed.has(name));
  if (unknown.length) return { valid: false, error: `Unknown parameter(s): ${unknown.join(", ")}.` };

  const params = {};
  for (const definition of definitions) {
    const value = rawParams[definition.name];
    if (value === undefined || value === null) {
      if (definition.required) return { valid: false, error: `Missing required parameter: ${definition.name}.` };
      continue;
    }
    const normalized = normalizeType(value, definition.type);
    const typeOk = definition.type === "number"
      ? typeof normalized === "number" && Number.isFinite(normalized)
      : definition.type === "boolean"
        ? typeof normalized === "boolean"
        : definition.type === "string"
          ? typeof normalized === "string"
          : true;
    if (!typeOk) return { valid: false, error: `Parameter '${definition.name}' must be a ${definition.type}.` };
    if (definition.type === "string" && definition.required && !normalized.trim()) {
      return { valid: false, error: `Parameter '${definition.name}' cannot be empty.` };
    }
    if (typeof normalized === "number" && definition.min !== undefined && normalized < definition.min) {
      return { valid: false, error: `Parameter '${definition.name}' must be at least ${definition.min}.` };
    }
    if (typeof normalized === "number" && definition.max !== undefined && normalized > definition.max) {
      return { valid: false, error: `Parameter '${definition.name}' must be at most ${definition.max}.` };
    }
    if (Array.isArray(definition.enum) && !definition.enum.includes(normalized)) {
      return { valid: false, error: `Parameter '${definition.name}' must be one of: ${definition.enum.join(", ")}.` };
    }
    params[definition.name] = normalizePathParameter(definition.name, normalized);
  }
  return { valid: true, params };
}

/** Expose only tools likely relevant to this task, while retaining composition tools. */
export function getRelevantTools(task, limit = 14) {
  const words = String(task).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const aliases = {
    open: ["apps", "browser"], launch: ["apps"], close: ["apps"], window: ["apps", "ui"],
    file: ["files"], folder: ["files"], directory: ["files"], desktop: ["files", "system"],
    type: ["ui"], click: ["ui"], key: ["ui"], keyboard: ["ui"], mouse: ["ui"],
    wifi: ["network"], network: ["network"], bluetooth: ["network"], volume: ["system"],
    mute: ["system"], brightness: ["system"], screen: ["system"], screenshot: ["system"],
    power: ["system"], process: ["system"], cpu: ["system"], ram: ["system"],
    python: ["execution"], powershell: ["execution"], git: ["execution"], command: ["execution"],
    url: ["browser"], search: ["browser", "web"],
    spotify: ["media"], music: ["media"], song: ["media"], track: ["media"],
    pdf: ["documents"], document: ["documents"],
    knowledge: ["productivity"], snippet: ["productivity"], note: ["productivity"],
    task: ["productivity"], todo: ["productivity"], reminder: ["productivity"],
    productivity: ["productivity"],
  };
  const scored = getAvailableTools().map((tool, index) => {
    const haystack = `${tool.id} ${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
    const score = words.reduce((total, word) => total
      + (haystack.includes(word) ? 2 : 0)
      + (aliases[word]?.includes(tool.category) ? 3 : 0), 0);
    return { tool, score, index };
  });
  const matches = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return (matches.length ? matches : scored).slice(0, limit).map(({ tool }) => tool);
}

/** Reject planner proposals whose capability category is absent from the request. */
export function isToolRelevantToTask(tool, task, params = {}) {
  const text = `${String(task)} ${Object.values(params).join(" ")}`.toLowerCase();
  const categoryTerms = {
    apps: /\b(open|launch|start|close|quit|focus|app|application|program|window|chrome|firefox|edge|notepad|code|spotify|discord)\b/,
    browser: /\b(browser|url|website|webpage|search|youtube|google|bing)\b/,
    files: /\b(file|folder|directory|desktop|path|read|write|create|delete|move|copy)\b/,
    ui: /\b(type|press|hotkey|key|click|mouse|keyboard)\b/,
    system: /\b(system|volume|audio|mute|brightness|screen|screenshot|process|cpu|ram|gpu|clipboard|power)\b/,
    network: /\b(wifi|wi-fi|network|bluetooth|adapter|internet)\b/,
    execution: /\b(powershell|python|script|command|git|terminal|execute|run)\b/,
    media: /\b(spotify|music|song|track|album|artist|media|play)\b/,
    documents: /\b(pdf|document|extract text|read document)\b/,
    communication: /\b(gmail|email|mail|inbox|message|send)\b/,
    knowledge: /\b(notion|obsidian|vault|knowledge|note|notes)\b/,
    productivity: /\b(knowledge|snippet|note|task|todo|reminder|remember|productivity)\b/,
  };
  return categoryTerms[tool.category]?.test(text) ?? false;
}

/**
 * Return a compact schema of available tools for the planner prompt.
 * Each entry: { id, name, description, category, permissionLevel, parameters }
 */
export function getToolSchema() {
  return getAvailableTools().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    permissionLevel: t.permissionLevel,
    parameters: (t.parameters ?? []).map((p) => `${p.name}:${p.type}${p.required ? "" : "?"} — ${p.description}`),
  }));
}

/**
 * Return a compact string summary of available tools for prompt injection.
 */
export function getToolSummaryText() {
  const byCategory = {};
  for (const t of getAvailableTools()) {
    const cat = t.category ?? "other";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(`${t.id}: ${t.description}`);
  }
  return Object.entries(byCategory)
    .map(([cat, tools]) => `[${cat}]\n${tools.map((t) => `  • ${t}`).join("\n")}`)
    .join("\n\n");
}

/**
 * Mark all tools as available (skips detection — for testing).
 */
export function markAllAvailable() {
  for (const id of registry.keys()) available.add(id);
}

// Register all built-in tools
for (const tool of ALL_TOOLS) register(tool);
