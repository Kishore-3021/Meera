/**
 * Task Planner — uses Qwen to decompose a user task into an ordered list of tool calls.
 *
 * Input:  user task string + available tool schema
 * Output: JSON array of { tool, params, description, step } objects
 *
 * Falls back gracefully when the model returns malformed JSON.
 */

import { OLLAMA_URL, DEFAULT_MODEL } from "../config.js";
import { getRelevantTools } from "./registry.js";
import { getToolReliability, getUnhealthyTools } from "../self-model.js";
import { subscribe } from "../event-bus.js";

const plannerSignals = {
  networkOnline: true,
  degradedTools: new Set(),
};

subscribe("network.changed", ({ payload }) => {
  plannerSignals.networkOnline = Boolean(payload?.online);
});
subscribe("tool.reliability.updated", ({ payload }) => {
  if (!payload?.toolName) return;
  if (payload.recentSuccessRate < 0.35 && payload.sampleSize >= 5) plannerSignals.degradedTools.add(payload.toolName);
  else plannerSignals.degradedTools.delete(payload.toolName);
});

const ADAPTIVE_SYSTEM_PROMPT = `You are Meera's reactive task executor. You control this Windows PC ONE ACTION AT A TIME.

You will receive:
- The user's overall task.
- Actions already executed, with their real verified results.

Your job: decide the SINGLE NEXT action, or declare the task complete.

Rules:
1. Return ONLY valid JSON, no markdown.
2. If more work is needed: {"done": false, "tool": "<exact tool id>", "params": {...}, "description": "<short summary>"}
3. If the task is fully accomplished (check the results!): {"done": true}
4. Use EXACT tool IDs from the list. Never invent IDs.
5. If a previous action FAILED, either try a sensible alternative or finish with {"done": true} — do not retry the identical failing call more than once.
6. Extract concrete param values from the user's words (app names, levels, paths, filenames, URLs, exact text to type).
7. Never re-do an action that already succeeded.
8. The tool field must be copied character-for-character from the AVAILABLE TOOL IDS line. Names such as NewFolder, ReadFile, or OpenBrowser are invalid.

AVAILABLE TOOLS:
{TOOLS}`;

/**
 * Adaptive mode: decide the next single action given everything executed so far.
 * @returns {Promise<{ done: boolean, tool?: string, params?: object, description?: string }>}
 */
export async function decideNextAction(userTask, executed = [], { signal, feedback = null, taskState = null } = {}) {
  const tools = sortToolsByReliability(getRelevantTools(userTask), userTask);
  const toolText = tools.map((t) => {
    const params = (t.parameters ?? []).map((p) => `${p.name}:${p.type}${p.required ? "" : "?"}${p.min !== undefined ? `[${p.min}-${p.max ?? "∞"}]` : ""}`).join(", ");
    return `${t.id} [${t.permissionLevel}] params(${params || "none"}): ${t.description}`;
  }).join("\n");
  const systemPrompt = ADAPTIVE_SYSTEM_PROMPT
    .replace("{TOOLS}", `${tools.map((tool) => tool.id).join(", ")}\n\n${toolText}`);
  const reliabilityHints = buildReliabilityHints(tools);
  const networkHint = plannerSignals.networkOnline
    ? "Network status: connected."
    : "Network status: disconnected. Avoid network-dependent tools unless the task is specifically to diagnose connectivity.";

  const lines = executed.length
    ? executed.map((r) =>
        `Step ${r.step} [${r.tool}] "${r.description}": ${r.success ? "SUCCESS" : "FAILED"}${r.output ? ` — ${String(r.output).slice(0, 300)}` : ""}${r.error ? ` — error: ${String(r.error).slice(0, 200)}` : ""}`
      ).join("\n")
    : "(no actions executed yet)";
  const stateLine = taskState
    ? `\nTask state: step ${taskState.step ?? "?"} of ${taskState.maxSteps ?? "?"}; current goal remains the original task.`
    : "";
  const feedbackLine = feedback
    ? `\n\nVALIDATOR FEEDBACK (must correct this before acting again):\n${feedback}`
    : "";
  const prompt = `Overall task: ${userTask}${stateLine}\n\n${networkHint}\n${reliabilityHints}\n\nExecuted so far:\n${lines}${feedbackLine}\n\nWhat is the next single action?`;

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        system: systemPrompt,
        prompt,
        format: buildDecisionSchema(tools),
        stream: false,
        options: { temperature: 0.0, num_predict: 256 },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { done: false, error: `Planner returned HTTP ${response.status}.` };
    const data = await response.json();
    const parsed = JSON.parse(data.response?.trim() || "{}");
    if (typeof parsed.done !== "boolean" || (parsed.done === false && typeof parsed.tool !== "string")) {
      return { done: false, error: "Planner returned an invalid action decision." };
    }
    return {
      done: Boolean(parsed.done),
      tool: typeof parsed.tool === "string" ? parsed.tool.trim() : undefined,
      params: parsed.params && typeof parsed.params === "object" ? parsed.params : {},
      description: typeof parsed.description === "string" ? parsed.description : "Next action",
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { done: false, error: `Planner failed: ${error.message}` };
  }
}

const PLANNER_SYSTEM_PROMPT = `You are Meera's Task Planner. Your ONLY job is to decompose the user's task into an ordered list of tool calls.

You have access to a set of tools. For each task:
1. Identify the minimal sequence of tool calls needed to complete the task.
2. Return ONLY a JSON array — no explanation, no markdown, no extra text.
3. Each step MUST have: { "step": number, "tool": "tool.id", "params": {}, "description": "what this step does" }
4. If the task can be answered with chat/knowledge alone (no tools needed), return: []
5. Keep plans concise — do not add unnecessary steps.
6. Use EXACT tool IDs from the schema below.
7. For multi-part tasks (e.g. "open X and do Y"), create MULTIPLE steps — one for each action. NEVER collapse two requested actions into one step.
8. Extract concrete parameter values from the user's words (app names, volume levels, paths, filenames, URLs, exact text to type).
9. For Desktop, home, and relative paths, preserve the user's wording (Desktop, ~, or %DESKTOP%); never invent a username or absolute path.

TOOL SCHEMA (available tools):
{TOOLS}

OUTPUT FORMAT (valid JSON array only):
[
  { "step": 1, "tool": "app.open", "params": { "app": "notepad" }, "description": "Open Notepad" }
]

Chat-only example:
[]`;

/**
 * Plan a multi-step task.
 * @param {string} userTask
 * @param {{ history?: object[], signal?: AbortSignal }} options
 * @returns {Promise<Array<{ step: number, tool: string, params: object, description: string }>>}
 */
export async function planTask(userTask, { history = [], signal } = {}) {
  const schema = getRelevantTools(userTask);
  const ranked = sortToolsByReliability(schema, userTask);
  // Compact tool list for prompt
  const toolText = ranked.map((t) => {
    const params = (t.parameters ?? []).map((p) => `${p.name}:${p.type}${p.required ? "" : "?"}${p.min !== undefined ? `[${p.min}-${p.max ?? "∞"}]` : ""}`).join(", ");
    return `${t.id} [${t.permissionLevel}] params(${params || "none"}): ${t.description}`;
  }).join("\n");

  const systemPrompt = PLANNER_SYSTEM_PROMPT.replace("{TOOLS}", toolText);

  const recentHistory = history.slice(-4).map((m) => `${m.role}: ${m.content}`).join("\n");
  const prompt = recentHistory
    ? `Context:\n${recentHistory}\n\nTask: ${userTask}`
    : `Task: ${userTask}`;

  let raw = null;
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        system: systemPrompt,
        prompt,
        format: buildPlanSchema(ranked),
        stream: false,
        options: { temperature: 0.0, num_predict: 768 },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      const data = await response.json();
      raw = data.response?.trim();
    }

    function toolParamSchema(tool) {
      const properties = {};
      const required = [];
      for (const param of tool.parameters ?? []) {
        const item = { type: param.type === "number" ? "number" : param.type === "boolean" ? "boolean" : "string" };
        if (param.description) item.description = param.description;
        if (Array.isArray(param.enum)) item.enum = param.enum;
        if (typeof param.min === "number") item.minimum = param.min;
        if (typeof param.max === "number") item.maximum = param.max;
        properties[param.name] = item;
        if (param.required) required.push(param.name);
      }
      const base = { type: "object", additionalProperties: false, properties };
      if (required.length) base.required = required;
      return base;
    }

    function buildDecisionSchema(tools) {
      const toolIds = tools.map((tool) => tool.id);
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          done: { type: "boolean" },
          tool: { type: "string", enum: toolIds },
          params: { type: "object" },
          description: { type: "string" },
        },
        required: ["done"],
        allOf: [
          {
            if: { properties: { done: { const: false } }, required: ["done"] },
            then: { required: ["tool", "params", "description"] },
          },
          ...tools.map((tool) => ({
            if: { properties: { tool: { const: tool.id } }, required: ["tool"] },
            then: { properties: { params: toolParamSchema(tool) } },
          })),
        ],
      };
    }

    function buildPlanSchema(tools) {
      const toolIds = tools.map((tool) => tool.id);
      const stepSchema = {
        type: "object",
        additionalProperties: false,
        properties: {
          step: { type: "number" },
          tool: { type: "string", enum: toolIds },
          params: { type: "object" },
          description: { type: "string" },
        },
        required: ["step", "tool", "params", "description"],
        allOf: tools.map((tool) => ({
          if: { properties: { tool: { const: tool.id } }, required: ["tool"] },
          then: { properties: { params: toolParamSchema(tool) } },
        })),
      };
      return {
        type: "array",
        items: stepSchema,
        maxItems: 12,
      };
    }

    function buildReliabilityHints(tools) {
      const hints = tools
        .map((tool) => ({ tool, reliability: getToolReliability(tool.id) }))
        .filter((entry) => entry.reliability.sampleSize >= 3)
        .map((entry) => {
          const pct = Math.round(entry.reliability.recentSuccessRate * 100);
          return `${entry.tool.id}: ${pct}% recent success (${entry.reliability.sampleSize} samples)`;
        });
      if (!hints.length) return "Reliability trends: no recent samples yet.";
      return `Reliability trends:\n${hints.join("\n")}`;
    }

    function sortToolsByReliability(tools, task) {
      const networkDependent = /\b(web|internet|online|dns|wifi|network|browser)\b/i.test(String(task));
      const unhealthy = new Set(getUnhealthyTools().map((entry) => entry.toolName));
      return [...tools].sort((a, b) => {
        const ra = getToolReliability(a.id);
        const rb = getToolReliability(b.id);
        const blockedA = plannerSignals.degradedTools.has(a.id) || unhealthy.has(a.id);
        const blockedB = plannerSignals.degradedTools.has(b.id) || unhealthy.has(b.id);
        if (blockedA !== blockedB) return blockedA ? 1 : -1;
        if (!plannerSignals.networkOnline && !networkDependent) {
          const aNet = a.category === "network" || a.category === "browser";
          const bNet = b.category === "network" || b.category === "browser";
          if (aNet !== bNet) return aNet ? 1 : -1;
        }
        return rb.recentSuccessRate - ra.recentSuccessRate;
      });
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    // Planner failure → fallback to empty plan (chat handles it)
    return [];
  }

  if (!raw) return [];

  // Parse and validate the plan
  try {
    // Handle case where model wraps in markdown or returns single object
    let plan = null;
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      plan = JSON.parse(arrayMatch[0]);
    } else {
      // Try parsing as single object, then wrap in array
      const objMatch = raw.match(/\{[\s\S]*\}/);
      if (objMatch) {
        const obj = JSON.parse(objMatch[0]);
        if (obj.tool) plan = [obj];
      }
    }
    if (!plan || !Array.isArray(plan)) return [];

    // Validate each step, snapping near-miss tool IDs to real ones
    return plan
      .filter((step) => step && typeof step.tool === "string" && step.tool)
      .map((step, i) => {
        const rawTool = String(step.tool).trim();
        return {
          step: Number(step.step ?? i + 1),
          tool: rawTool,
          params: step.params && typeof step.params === "object" ? step.params : {},
          description: String(step.description ?? `Step ${i + 1}`),
        };
      });
  } catch {
    return [];
  }
}
