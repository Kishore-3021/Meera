import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_MODEL, SYSTEM_PROMPT } from "./config.js";
import { getOllamaStatus, streamChat } from "./ollama.js";
import { classifyLiveRequest, getClockContext, getWebContext } from "./live-info.js";
import { routeIntent } from "./router.js";
import { getRecentDecisions } from "./db.js";
import { runtimeState } from "./runtime-state.js";
import { MeeraTerminal, PromptSession } from "./terminal-ui.js";

const model = DEFAULT_MODEL;
const ui = new MeeraTerminal(output);
let history = [];
let transcript = [];
let activeRequest = null;

function messagesFor(message, liveContext, runtimeContext) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  if (runtimeContext) messages.push({ role: "system", content: runtimeContext });
  messages.push(...history);
  if (liveContext) messages.push({ role: "system", content: liveContext });
  messages.push({ role: "user", content: message });
  return messages;
}

function previousUserMessage() {
  return [...history].reverse().find((entry) => entry.role === "user")?.content ?? "";
}

async function respond(message) {
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
        ui.note("Recent Intent Router Decisions (SQLite):\n" +
          decisions.map((d, i) => `  ${i + 1}. [${d.intent}] "${d.user_input.slice(0, 35)}" (conf: ${(d.confidence * 100).toFixed(0)}%, path: ${d.execution_path})`).join("\n")
        );
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

  ui.user(message);
  const controller = new AbortController();
  activeRequest = controller;
  let sources = null;
  let liveContext = null;
  let route = { type: "none" };

  try {
    runtimeState.setTask("Routing request");

    // 1. Check local clock intent directly
    const clockCheck = classifyLiveRequest(message, previousUserMessage());
    if (clockCheck.type === "clock") {
      liveContext = getClockContext(clockCheck).context;
      ui.clockStatus();
      route = { type: "clock" };
    } else {
      // 2. Structured Intent Router
      const decision = await routeIntent(message, { history, signal: controller.signal });
      route = { type: decision.intent, ...decision };

      if (decision.intent === "vision_task") {
        ui.note("Vision and screen analysis subsystems are scheduled for Phase 5.");
      } else if (decision.intent === "memory_lookup" && history.length === 0) {
        liveContext = "MEMORY NOTICE: Persistent episodic memory (ChromaDB) and structured recall (SQLite) will be active in Phase 2. Currently only active session history is available.";
      } else if (decision.intent === "code_task") {
        liveContext = "CODING AGENT NOTICE: File editing and shell execution tools will be active in Phase 4. Provide helpful code guidance or code snippets directly in your response.";
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
    const answer = await streamChat(messagesFor(message, liveContext, runtimeContext), model, (token) => renderer.push(token), {
      signal: controller.signal,
    });
    renderer.finish();
    ui.write("\n");

    if (sources) {
      runtimeState.setLastAction(`Web search for "${message.slice(0, 35)}"`, `${sources.length} sources retrieved`);
    } else if (route.type === "clock") {
      runtimeState.setLastAction("Local clock lookup", "Success");
    } else {
      runtimeState.setLastAction(`Conversational response (${route.type || "chat"})`, "Success");
    }

    history.push({ role: "user", content: message }, { role: "assistant", content: answer });
    transcript.push({ type: "user", text: message }, { type: "assistant", text: answer });
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

async function main() {
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
}

main();
