import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AGENT_RESULT_PROMPT, DEFAULT_MODEL, SYSTEM_PROMPT } from "./config.js";
import { getOllamaStatus, streamChat } from "./ollama.js";
import { classifyLiveRequest, getClockContext, getWebContext } from "./live-info.js";
import { routeIntent } from "./router.js";
import { getRecentDecisions } from "./db.js";
import { runtimeState } from "./runtime-state.js";
import { MeeraTerminal, PromptSession } from "./terminal-ui.js";
import { detectCapabilities, formatRegistryDump, registrySelfCheck } from "./tools/registry.js";
import { runAdaptiveTask, buildAgentFinalResponse, buildResultContext } from "./tools/agent-loop.js";
import { setConfirmCallback } from "./tools/permissions.js";
import { startAwarenessLoop, stopAwarenessLoop } from "./awareness-loop.js";
import { completeSession, getLatestInProgressSession } from "./session-state.js";
import { isMem0Configured, mem0Remember, mem0Search } from "./mem0.js";

const model = DEFAULT_MODEL;
const ui = new MeeraTerminal(output);
let history = [];
let transcript = [];
let activeRequest = null;
let pendingResumableTask = null;

function messagesFor(message, liveContext, runtimeContext) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  if (liveContext?.startsWith("AGENT TASK EXECUTION RESULTS")) {
    messages.push({ role: "system", content: AGENT_RESULT_PROMPT });
  }
  if (runtimeContext) messages.push({ role: "system", content: runtimeContext });
  messages.push(...history);
  if (liveContext) messages.push({ role: "system", content: liveContext });
  messages.push({ role: "user", content: message });
  return messages;
}

function previousUserMessage() {
  return [...history].reverse().find((entry) => entry.role === "user")?.content ?? "";
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

async function handleCommand(message) {
  if (message === "/exit") return { exit: true };

  if (message === "/help") {
    ui.help();
    return {};
  }

  if (message === "/clear") {
    history = [];
    transcript = [];
    runtimeState.setLastAction("Cleared conversation history", "Success");
    ui.redraw(transcript);
    ui.note("Conversation cleared.");
    return {};
  }

  if (message === "/model") {
    ui.note(`Active model: ${model}`);
    return {};
  }

  if (message === "/tools") {
    ui.note(formatRegistryDump().split("\n").map((line) => `  ${line}`).join("\n"));
    return {};
  }

  if (message === "/resume") {
    if (!pendingResumableTask) {
      ui.note("No resumable task is pending.");
      return {};
    }
    const resumed = await runResumedTask(pendingResumableTask);
    pendingResumableTask = null;
    return resumed;
  }

  if (message === "/about") {
    const health = await runtimeState.refreshHealth();
    ui.about({
      model,
      ollamaOnline: health.ollamaOnline,
      searxngOnline: health.searxngOnline,
      capabilities: runtimeState.getCapabilities(),
    });
    return {};
  }

  if (message === "/decisions") {
    try {
      const decisions = getRecentDecisions(5);
      if (!decisions.length) {
        ui.note("No routing decisions logged yet.");
      } else {
        const lines = decisions.map((d, i) =>
          `  ${i + 1}. [${d.intent}] "${d.user_input.slice(0, 35)}" (conf: ${(d.confidence * 100).toFixed(0)}%, path: ${d.execution_path})`
        );
        ui.note(`Recent Intent Router Decisions:\n${lines.join("\n")}`);
      }
    } catch (e) {
      ui.note(`Could not read decision log: ${e.message}`);
    }
    return {};
  }

  if (message === "/status") {
    const health = await runtimeState.refreshHealth();
    ui.ollamaStatus = health.ollamaOnline ? "Online" : "Offline";
    ui.webStatus = health.searxngOnline ? "Online" : "Offline";
    ui.toolsCount = health.toolsCount;
    ui.status(health);
    return {};
  }

  if (message.startsWith("/")) {
    ui.note(`Unknown command: ${message}. Type /help to see available commands.`);
    return {};
  }

  return null; // Not a command
}

// ─── Agent Task Handler ───────────────────────────────────────────────────────

async function handleAgentTask(message, controller) {
  runtimeState.setTask(`Working on: "${message.slice(0, 40)}"`);
  ui.write(`  ${"\x1b[90m"}◐ Working on task...\x1b[0m\n`);

  const results = await runAdaptiveTask(message, {
    onStepStart: (step, total, description) => {
      runtimeState.setTask(`Step ${step}: ${description}`);
      ui.agentStep(step, total, description);
    },
    onStepDone: (step, result) => {
      ui.agentDone(step, result.output);
    },
    onStepError: (step, error) => {
      ui.agentError(step, error);
    },
    signal: controller.signal,
  });

  if (results.length === 0) return null; // nothing to execute → treat as chat

  if (controller.signal.aborted) return { aborted: true };

  ui.agentResults(results);

  // Build context for Qwen synthesis
  const resultContext = buildResultContext(results, message);
  const runtimeContext = await runtimeState.getPromptContext();

  const lastSuccessful = results.filter((r) => r.success && r.verified);
  const actionSummary = lastSuccessful.length > 0
    ? lastSuccessful.map((r) => r.description).join(", ")
    : "agent task (all steps failed)";
  runtimeState.setLastAction(actionSummary, `${lastSuccessful.length}/${results.length} steps succeeded`);

  return { resultContext, runtimeContext, results };
}

async function runResumedTask(session) {
  const controller = new AbortController();
  runtimeState.setTask(`Resuming: "${session.goalDescription.slice(0, 40)}"`);
  ui.write(`  ${"\x1b[90m"}◐ Resuming unfinished task...\x1b[0m\n`);
  const results = await runAdaptiveTask(session.goalDescription, {
    seedResults: session.stepHistory ?? [],
    taskId: session.taskId,
    onStepStart: (step, total, description) => {
      runtimeState.setTask(`Step ${step}: ${description}`);
      ui.agentStep(step, total, description);
    },
    onStepDone: (step, result) => ui.agentDone(step, result.output),
    onStepError: (step, error) => ui.agentError(step, error),
    signal: controller.signal,
  });
  ui.agentResults(results);
  const answer = buildAgentFinalResponse(results);
  ui.answer(answer);
  history.push({ role: "user", content: `Resume task: ${session.goalDescription}` }, { role: "assistant", content: answer });
  transcript.push({ type: "user", text: `Resume task: ${session.goalDescription}` }, { type: "assistant", text: answer });
  runtimeState.setTask("Idle");
  return {};
}

// ─── Main Respond Handler ─────────────────────────────────────────────────────

async function respond(message) {
  // Check slash commands first
  const cmdResult = await handleCommand(message);
  if (cmdResult !== null) return cmdResult;

  ui.user(message);
  const controller = new AbortController();
  activeRequest = controller;
  let sources = null;
  let liveContext = null;
  let route = { type: "none" };

  try {
    runtimeState.setTask("Routing request");

    // 1. Clock check (deterministic, no model needed)
    const clockCheck = classifyLiveRequest(message, previousUserMessage());
    if (clockCheck.type === "clock") {
      liveContext = getClockContext(clockCheck).context;
      ui.clockStatus();
      route = { type: "clock" };
    } else {
      // 2. Structured Intent Router
      const decision = await routeIntent(message, { history, signal: controller.signal });
      route = { type: decision.intent, ...decision };

      if (decision.intent === "agent_task") {
        // ── Agent Path ──────────────────────────────────────────────────────
        const agentResult = await handleAgentTask(message, controller);

        if (agentResult === null) {
          // Planner returned empty — treat as chat
          route = { type: "chat" };
        } else if (agentResult.aborted) {
          runtimeState.setLastAction("Agent task", "Aborted by user");
          ui.note("Task cancelled.");
          return {};
        } else {
          liveContext = agentResult.resultContext;
          const answer = buildAgentFinalResponse(agentResult.results);
          ui.answer(answer);
          history.push({ role: "user", content: message }, { role: "assistant", content: answer });
          transcript.push({ type: "user", text: message }, { type: "assistant", text: answer });
          runtimeState.setTask("Idle");
          return {};
        }
      } else if (decision.intent === "vision_task") {
        ui.note("Vision and screen analysis is planned for Phase 5.");
      } else if (decision.intent === "memory_lookup") {
        if (isMem0Configured()) {
          const memory = await mem0Search(message, 6);
          if (memory.success && memory.items.length) {
            const rows = memory.items
              .map((item, idx) => {
                const text = item.memory ?? item.text ?? item.content ?? JSON.stringify(item);
                return `[${idx + 1}] ${String(text).slice(0, 240)}`;
              })
              .join("\n");
            liveContext = `EPISODIC MEMORY CONTEXT (Mem0)\nUse only items below as recall evidence.\n${rows}`;
          } else {
            liveContext = "EPISODIC MEMORY CONTEXT (Mem0): no matching memories found.";
          }
        } else if (history.length === 0) {
          liveContext = "MEMORY NOTICE: Mem0 is not configured. Only active session history is available.";
        }
      } else if (decision.intent === "code_task") {
        liveContext = "CODING AGENT NOTICE: File editing and shell execution tools are active in the agent_task system. For pure code writing tasks, provide code directly in your response.";
      } else if (decision.needsSearch || decision.intent === "web_search") {
        runtimeState.setTask(`Searching the web for "${message.slice(0, 40)}"`);
        ui.searchStart();
        const web = await getWebContext(message, { signal: controller.signal });
        sources = web.results;
        liveContext = web.context;
        ui.searchSuccess(sources.length);
      }
    }

    if (controller.signal.aborted) {
      runtimeState.setLastAction("Cancelled request", "Aborted by user");
      ui.note("Request cancelled.");
      return {};
    }

    runtimeState.setTask("Generating response");
    const runtimeContext = await runtimeState.getPromptContext();

    const renderer = ui.beginAnswer();
    const answer = await streamChat(
      messagesFor(message, liveContext, runtimeContext),
      model,
      (token) => renderer.push(token),
      { signal: controller.signal }
    );
    renderer.finish();
    ui.write("\n");

    if (sources) {
      runtimeState.setLastAction(`Web search for "${message.slice(0, 35)}"`, `${sources.length} sources retrieved`);
    } else if (route.type === "clock") {
      runtimeState.setLastAction("Local clock lookup", "Success");
    } else if (route.type === "agent_task") {
      // Already set in handleAgentTask
    } else {
      runtimeState.setLastAction(`Conversational response (${route.type || "chat"})`, "Success");
    }

    history.push({ role: "user", content: message }, { role: "assistant", content: answer });
    transcript.push({ type: "user", text: message }, { type: "assistant", text: answer });
    if (isMem0Configured()) {
      void mem0Remember(`User: ${message}\nAssistant: ${answer}`, { source: "meera-chat" });
    }
    if (sources) {
      ui.sources(sources);
      transcript.push({ type: "sources", results: sources });
    }
  } catch (error) {
    if (controller.signal.aborted || error.name === "AbortError") {
      runtimeState.setLastAction("Cancelled request", "Aborted by user");
      ui.note("Generation cancelled.");
    } else if (route.needsSearch || route.type === "web_search") {
      runtimeState.setLastAction("Web search attempt", `Failed: ${error.message}`);
      ui.searchFailure(error.message);
      ui.note("I can't verify current information right now, so I won't guess.");
    } else {
      runtimeState.setLastAction("Request processing", `Error: ${error.message}`);
      ui.note(`Meera could not generate a response: ${error.message}`);
    }
  } finally {
    if (activeRequest === controller) activeRequest = null;
    runtimeState.setTask("Idle");
  }

  return {};
}

function cancelActiveRequest() {
  activeRequest?.abort();
}

async function runFallback() {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const message = line.trim();
      if (!message) continue;
      const result = await respond(message);
      if (result.exit) break;
    }
  } finally {
    rl.close();
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  // Register destructive action confirmation callback
  setConfirmCallback((description) => ui.confirmDestructive(description));

  // Run capability detection for all agent tools (once, cached)
  const availableToolIds = await detectCapabilities();
  startAwarenessLoop();
  const registryHealth = registrySelfCheck();
  if (registryHealth.loaded !== availableToolIds.length) {
    console.warn(`[registry] detection result mismatch: ${availableToolIds.length} returned, ${registryHealth.loaded} loaded.`);
  }

  // Health check
  try {
    const health = await runtimeState.refreshHealth();
    if (!health.ollamaOnline) {
      console.error(`Cannot connect to Ollama or model '${model}' was not found. Run: ollama pull ${model}`);
      process.exitCode = 1;
      return;
    }
    ui.ollamaStatus = "Online";
    ui.webStatus = health.searxngOnline ? "Online" : "Offline";
    ui.toolsCount = health.toolsCount;
  } catch (error) {
    console.error(`Startup health check error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  ui.start();
  const unfinished = getLatestInProgressSession();
  if (unfinished && input.isTTY && output.isTTY) {
    pendingResumableTask = await resolveStartupSessionDecision(unfinished);
  }
  if (pendingResumableTask) {
    ui.note(`Unfinished task detected: "${pendingResumableTask.goalDescription}". Use /resume to continue.`);
  }

  if (input.isTTY && output.isTTY) {
    const prompt = new PromptSession({
      input,
      output,
      onSubmit: respond,
      onCancel: cancelActiveRequest,
      onRedraw: () => ui.redraw(transcript),
    });
    await prompt.run();
  } else {
    await runFallback();
  }

  ui.write("\nGoodbye.\n");
  stopAwarenessLoop();
}

main();

async function resolveStartupSessionDecision(session) {
  ui.note(`Unfinished task found: "${session.goalDescription}" (step ${session.currentStep}, status: ${session.status}).`);
  const rl = readline.createInterface({ input, output });
  try {
    const choice = (await rl.question("Resume, abandon, or start fresh? [resume/abandon/fresh]: ")).trim().toLowerCase();
    if (choice === "abandon" || choice === "fresh") {
      completeSession(session.taskId, "abandoned");
      return null;
    }
    if (choice !== "resume") return null;
    if (!session.resumable) {
      const confirm = (await rl.question("This task includes non-read actions. Type RESUME to continue: ")).trim();
      if (confirm !== "RESUME") return null;
    }
    return session;
  } finally {
    rl.close();
  }
}
