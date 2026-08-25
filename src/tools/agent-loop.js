/**
 * Agent Loop — orchestrates plan execution with permission gating and verification.
 *
 * Flow for each step:
 *   1. Resolve tool from registry
 *   2. Check permission (destructive → prompt user)
 *   3. Execute tool
 *   4. Verify result
 *   5. Stream progress to UI
 *   6. Collect results for Qwen synthesis
 */

import { getTool, resolveToolId, validateToolParams, isToolRelevantToTask, getRelevantTools } from "./registry.js";
import { checkPermission } from "./permissions.js";
import { decideNextAction } from "./planner.js";
import { logToolCall } from "../db.js";
import { randomUUID } from "node:crypto";
import { checkpointSession, completeSession } from "../session-state.js";
import { recordToolOutcome } from "../self-model.js";
import { publish } from "../event-bus.js";

const MAX_ADAPTIVE_STEPS = 8;
const MAX_RETRIES_PER_ACTION = 1;

/**
 * @typedef {Object} StepResult
 * @property {number} step
 * @property {string} tool
 * @property {string} description
 * @property {boolean} success
 * @property {string|null} output
 * @property {string|undefined} error
 * @property {boolean} skipped
 */

/**
 * Execute a planned task step by step.
 *
 * @param {Array<{ step: number, tool: string, params: object, description: string }>} plan
 * @param {{
 *   onStepStart?: (step: number, total: number, description: string) => void,
 *   onStepDone?: (step: number, result: StepResult) => void,
 *   onStepError?: (step: number, error: string) => void,
 *   signal?: AbortSignal
 * }} callbacks
 * @returns {Promise<StepResult[]>}
 */
export async function executeAgentPlan(plan, { userTask = "", onStepStart, onStepDone, onStepError, signal } = {}) {
  const results = [];
  const total = plan.length;
  const taskId = randomUUID();
  let resumable = true;

  checkpointSession({
    taskId,
    goalDescription: userTask || "Planned task",
    currentStep: 0,
    stepHistory: [],
    resumable,
    status: "in_progress",
  });

  for (const planStep of plan) {
    if (signal?.aborted) break;

    const { step, tool: toolId, params, description } = planStep;
    onStepStart?.(step, total, description);

    // 1. Resolve tool
    const resolvedToolId = resolveToolId(toolId);
    const tool = resolvedToolId ? getTool(resolvedToolId) : null;
    if (!tool) {
      const result = { step, tool: toolId, action: description, description, success: false, verified: false, output: null, result: null, error: `Tool '${toolId}' is not available.`, skipped: false };
      console.warn(`[agent] rejected unknown tool '${toolId}'`);
      onStepError?.(step, result.error);
      results.push(result);
      continue;
    }
    if (userTask && !isToolRelevantToTask(tool, userTask, params ?? {})) {
      const result = { step, tool: toolId, action: description, description, success: false, verified: false, output: null, result: null, error: "Planner step is unrelated to the original user task.", skipped: true };
      console.warn(`[agent] rejected unrelated planned step '${toolId}'`);
      onStepError?.(step, result.error);
      results.push(result);
      continue;
    }

    // 2. Validate model parameters before permission checks or execution.
    const validation = await validateToolParams(tool, params ?? {});
    if (!validation.valid) {
      const result = { step, tool: toolId, action: description, description, success: false, verified: false, output: null, result: null, error: `Invalid parameters: ${validation.error}`, skipped: false };
      console.warn(`[agent] rejected invalid parameters for '${toolId}': ${validation.error}`);
      onStepError?.(step, result.error);
      results.push(result);
      continue;
    }

    // 3. Permission check (normalized params feed confirmDescription rendering)
    const permission = await checkPermission(tool, validation.params);
    if (!permission.allowed) {
      const result = { step, tool: toolId, action: description, description, success: false, verified: false, output: null, result: null, error: permission.reason ?? "Permission denied.", skipped: true };
      onStepError?.(step, result.error);
      results.push(result);
      continue;
    }

    // 4. Execute with one bounded retry; only the final real result is recorded.
    let execResult;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        execResult = await tool.execute(validation.params);
      } catch (error) {
        execResult = { success: false, error: error.message };
      }
      if (execResult?.success || attempt === 1 || signal?.aborted) break;
    }
    if (signal?.aborted) break;

    // 4. Verify and collect
    const result = {
      step,
      tool: resolvedToolId,
      description,
      success: Boolean(execResult?.success),
      verified: Boolean(execResult?.success) && execResult.verified !== false,
      action: description,
      output: execResult?.output ?? null,
      result: execResult?.result ?? execResult?.output ?? null,
      error: execResult?.error,
      skipped: false,
      data: execResult.data,
    };
    logToolCall({ taskId, step, tool: resolvedToolId, parameters: validation.params, success: result.success, verified: result.verified, output: result.output, error: result.error });
    recordToolOutcome({ toolName: resolvedToolId, success: result.success, verified: result.verified, error: result.error });
    publish("tool.execution.verified", { taskId, step, tool: resolvedToolId, success: result.success, verified: result.verified, error: result.error });
    if (tool.permissionLevel !== "read") resumable = false;
    checkpointSession({
      taskId,
      goalDescription: userTask || "Planned task",
      currentStep: step,
      stepHistory: results.concat(result),
      resumable,
      status: "in_progress",
    });

    if (result.success && result.verified) onStepDone?.(step, result);
    else onStepError?.(step, result.error ?? "Tool reported an unverified result.");
    results.push(result);

    // Stop plan on critical failure (tool explicitly failed)
    if (!result.success && !planStep.continueOnError) {
      break;
    }
  }

  completeSession(taskId, results.every((entry) => entry.success && entry.verified) ? "completed" : "failed");

  return results;
}

/**
 * Adaptive agent loop: decide → execute → verify → feed result back → repeat.
 * Handles arbitrary multi-action tasks without requiring an upfront perfect plan.
 *
 * @param {string} userTask
 * @param {{
 *   maxSteps?: number,
 *   onStepStart?: (step: number, total: number, description: string) => void,
 *   onStepDone?: (step: number, result: StepResult) => void,
 *   onStepError?: (step: number, error: string) => void,
 *   signal?: AbortSignal
 * }} callbacks
 * @returns {Promise<StepResult[]>}
 */
export async function runAdaptiveTask(userTask, {
  maxSteps = MAX_ADAPTIVE_STEPS,
  onStepStart,
  onStepDone,
  onStepError,
  signal,
  seedResults = [],
  taskId = randomUUID(),
} = {}) {
  const results = [...seedResults];
  let consecutiveInvalid = 0;
  let plannerFeedback = null;
  let resumable = true;

  for (const previous of results) {
    if (previous?.tool) {
      const previousTool = getTool(previous.tool);
      if (previousTool?.permissionLevel !== "read") resumable = false;
    }
  }
  checkpointSession({
    taskId,
    goalDescription: userTask,
    currentStep: results.length,
    stepHistory: results,
    resumable,
    status: "in_progress",
  });

  for (let step = results.length + 1; step <= maxSteps; step += 1) {
    if (signal?.aborted) break;

    // 1. Ask Qwen for the next single action (or done)
    const decision = await decideNextAction(userTask, results, {
      signal,
      feedback: plannerFeedback,
      taskState: { step, maxSteps },
    });
    plannerFeedback = null;
    if (decision.error) {
      const result = {
        step, tool: "planner", action: "plan next step", description: "Plan next step",
        success: false, verified: false, output: null, result: null,
        error: decision.error, skipped: false,
      };
      logToolCall({ taskId, step, tool: "planner", parameters: {}, success: result.success, verified: result.verified, output: result.output, error: result.error });
      results.push(result);
      onStepError?.(step, decision.error);
      checkpointSession({
        taskId,
        goalDescription: userTask,
        currentStep: step,
        stepHistory: results,
        resumable,
        status: "failed",
      });
      break;
    }
    if (decision.done || !decision.tool) break;

    const toolId = decision.tool;
    const resolvedToolId = resolveToolId(toolId);
    if (!resolvedToolId) {
      consecutiveInvalid += 1;
      console.warn(`[agent] rejected unknown tool '${toolId}'`);
      results.push({
        step, tool: toolId, description: decision.description,
        success: false, verified: false, output: null, result: null, error: `Unknown tool '${toolId}'.`, skipped: false,
      });
      onStepError?.(step, `Unknown tool '${toolId}'`);
      const available = getRelevantTools(userTask)
        .map((tool) => `${tool.id} (${tool.description})`)
        .join("\n");
      plannerFeedback = `Rejected unknown tool '${toolId}'. Use only one of these live relevant tools:\n${available}`;
      if (consecutiveInvalid >= 2) break;
      continue;
    }
    consecutiveInvalid = 0;

    const description = decision.description ?? `Step ${step}`;
    onStepStart?.(step, maxSteps, description);

    // 2. Validate against the live tool schema before permissions or execution.
    const tool = getTool(resolvedToolId);
    const rawSignature = `${resolvedToolId}:${JSON.stringify(decision.params ?? {})}`;
    if (results.some((result) => result.success && result.signature === rawSignature)) {
      const error = "Repeated successful action detected; stopping to avoid a stall.";
      const result = { step, tool: resolvedToolId, action: description, description, success: false, verified: false, output: null, result: null, error, skipped: false, signature: rawSignature };
      results.push(result);
      onStepError?.(step, error);
      break;
    }
    if (userTask && !isToolRelevantToTask(tool, userTask, decision.params ?? {})) {
      consecutiveInvalid += 1;
      const error = "Planner step is unrelated to the original user task.";
      console.warn(`[agent] rejected unrelated planned step '${resolvedToolId}'`);
      const result = {
        step, tool: resolvedToolId, action: description, description, success: false, verified: false,
        output: null, result: null, error, skipped: true, signature: rawSignature,
      };
      results.push(result);
      onStepError?.(step, error);
      plannerFeedback = `${error} Stay scoped to the original goal: "${userTask}". Ask for clarification instead of taking unrelated actions.`;
      if (consecutiveInvalid >= 2) break;
      continue;
    }
    const validation = await validateToolParams(tool, decision.params ?? {});
    if (!validation.valid) {
      consecutiveInvalid += 1;
      console.warn(`[agent] rejected invalid parameters for '${resolvedToolId}': ${validation.error}`);
      const result = {
        step, tool: resolvedToolId, action: description, description, success: false, verified: false, output: null, result: null,
        error: `Invalid parameters: ${validation.error}`, skipped: false,
      };
      results.push({ ...result, signature: rawSignature });
      onStepError?.(step, result.error);
      plannerFeedback = `${result.error}\nUse the exact required parameter names/types from the live tool schema. Do not invent placeholder values.`;
      if (consecutiveInvalid >= 2) break;
      continue;
    }
    consecutiveInvalid = 0;

    // 3. Permission gate
    const permission = await checkPermission(tool, validation.params);
    if (!permission.allowed) {
      results.push({
        step, tool: resolvedToolId, action: description, description, success: false, verified: false,
        output: null, result: null, error: permission.reason ?? "Permission denied.", skipped: true,
      });
      onStepError?.(step, permission.reason ?? "Permission denied.");
      plannerFeedback = `The permission gate rejected '${resolvedToolId}': ${permission.reason ?? "Permission denied."} Do not repeat it; choose a safe alternative or finish honestly.`;
      continue;
    }

    // 4. Execute with one bounded retry for a repeated transient failure.
    let execResult;
    const signature = `${resolvedToolId}:${JSON.stringify(validation.params)}`;
    const priorFailures = results.filter((result) => !result.success && result.signature === signature).length;
    if (priorFailures >= MAX_RETRIES_PER_ACTION + 1) {
      const error = "Repeated failing action detected; stopping to avoid a stall.";
      results.push({ step, tool: resolvedToolId, action: description, description, success: false, verified: false, output: null, result: null, error, skipped: false, signature });
      onStepError?.(step, error);
      break;
    }
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_ACTION; attempt += 1) {
      try {
        execResult = await tool.execute(validation.params);
      } catch (error) {
        execResult = { success: false, output: null, error: error.message };
      }
      if (execResult.success || attempt === MAX_RETRIES_PER_ACTION) break;
      if (signal?.aborted) break;
    }
    if (signal?.aborted) break;

    // 4. Record verified result — fed back into the next decision
    const result = {
      step,
      tool: resolvedToolId,
      description,
      success: Boolean(execResult.success),
      verified: Boolean(execResult.success) && execResult.verified !== false,
      action: description,
      output: execResult.output ?? null,
      result: execResult.result ?? execResult.output ?? null,
      error: execResult.error,
      skipped: false,
      data: execResult.data,
      signature,
    };
    results.push(result);
    logToolCall({ taskId, step, tool: resolvedToolId, parameters: validation.params, success: result.success, verified: result.verified, output: result.output, error: result.error });
    recordToolOutcome({ toolName: resolvedToolId, success: result.success, verified: result.verified, error: result.error });
    publish("tool.execution.verified", { taskId, step, tool: resolvedToolId, success: result.success, verified: result.verified, error: result.error });
    if (tool.permissionLevel !== "read") resumable = false;
    checkpointSession({
      taskId,
      goalDescription: userTask,
      currentStep: step,
      stepHistory: results,
      resumable,
      status: "in_progress",
    });
    if (result.success && result.verified) onStepDone?.(step, result);
    else {
      const error = result.error ?? "Tool reported failure.";
      onStepError?.(step, error);
      plannerFeedback = `The real execution of '${resolvedToolId}' failed: ${error}. Do not claim success. Choose a different relevant tool only if it can address the original task, otherwise finish honestly.`;
    }
  }

  const completed = results.length > 0 && results.every((entry) => entry.success && entry.verified);
  completeSession(taskId, completed ? "completed" : "failed");

  return results;
}

/**
 * Summarize execution results into a context block for Qwen synthesis.
 * @param {StepResult[]} results
 * @param {string} originalTask
 */
export function buildResultContext(results, originalTask) {
  const compact = (value, limit = 700) => {
    const text = String(value ?? "");
    return text.length > limit ? `${text.slice(0, limit)}...[truncated]` : text;
  };
  const lines = [
    `AGENT TASK EXECUTION RESULTS for: "${originalTask}"`,
    `Steps: ${results.length} | Succeeded: ${results.filter((r) => r.success && r.verified).length} | Failed: ${results.filter((r) => !r.success || !r.verified).length}`,
    "",
  ];

  for (const r of results) {
    lines.push(`Step ${r.step} [${r.tool}]: ${r.description}`);
    if (r.skipped) {
      lines.push(`  → SKIPPED: ${compact(r.error)}`);
    } else if (r.success && r.verified) {
      lines.push(`  → SUCCESS (verified): ${compact(r.output ?? "(done)")}`);
    } else {
      lines.push(`  → FAILED: ${compact(r.error ?? "Unknown error")}`);
      if (r.output) lines.push(`  → Output: ${compact(r.output)}`);
    }
    lines.push("");
  }

  const allSuccess = results.length > 0 && results.every((r) => (r.success && r.verified) || r.skipped);
  const anySuccess = results.some((r) => r.success && r.verified);

  lines.push(allSuccess
    ? "All executed steps completed successfully. This does not prove that unexecuted parts of the user's request were completed."
    : anySuccess
      ? "Some steps completed. See failures above."
      : "All steps failed.");

  lines.push("");
  lines.push("CRITICAL RULES:");
  lines.push("1. Only report what actually happened based on the results above.");
  lines.push("2. Only report SUCCESS when verified is true.");
  lines.push("3. Do NOT invent tool output. Use only the data provided above.");
  lines.push("4. If steps failed, clearly acknowledge what could not be done.");
  lines.push("5. Never claim an action happened unless that exact action appears as a verified ledger step.");
  lines.push("6. Do not restate remaining requested actions as completed or as execution steps.");

  return lines.join("\n");
}

/** Produce a truthful final response without allowing the model to invent steps. */
export function buildAgentFinalResponse(results) {
  const lines = [`Executed ${results.length} real step${results.length === 1 ? "" : "s"}:`];
  for (const result of results) {
    const label = result.success && result.verified ? "SUCCESS (verified)" : result.skipped ? "SKIPPED" : "FAILED";
    const detail = result.success && result.verified
      ? result.output ?? "completed"
      : result.error ?? "no verified result";
    lines.push(`${result.step}. ${label} — ${result.action ?? result.description}: ${String(detail).split("\n")[0]}`);
  }
  if (results.some((result) => !result.success || !result.verified)) {
    lines.push("I did not claim completion for failed, skipped, or unverified actions.");
  } else {
    lines.push("Only the steps listed above were executed and verified.");
  }
  return lines.join("\n");
}
