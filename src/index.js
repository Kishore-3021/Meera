import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_MODEL, SYSTEM_PROMPT } from "./config.js";
import { getOllamaStatus, streamChat } from "./ollama.js";
import { classifyLiveRequest, getClockContext, getWebContext } from "./live-info.js";
import { routeIntent } from "./router.js";
import { getRecentDecisions } from "./db.js";
import { MeeraTerminal, PromptSession } from "./terminal-ui.js";

const model = DEFAULT_MODEL;
const ui = new MeeraTerminal(output);
let history = [];
let transcript = [];
let activeRequest = null;

function messagesFor(message, liveContext) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];
  if (liveContext) messages.push({ role: "system", content: liveContext });
  messages.push({ role: "user", content: message });
  return messages;
}

function previousUserMessage() {
  return [...history].reverse().find((entry) => entry.role === "user")?.content ?? "";
}

async function respond(message) {
  if (message === "/exit") return { exit: true };
  if (message === "/help") { ui.help(); return {}; }
  if (message === "/clear") {
    history = [];
    transcript = [];
    ui.redraw(transcript);
    ui.note("Conversation cleared.");
    return {};
  }
  if (message === "/model") { ui.note(`Active model: ${model}`); return {}; }
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
    try {
      const status = await getOllamaStatus(model);
      ui.ollamaStatus = status.available ? "Online" : "Model unavailable";
      ui.status({ model, available: status.available });
    } catch (error) {
      ui.ollamaStatus = "Offline";
      ui.status({ model, available: false });
      ui.note(`Ollama check failed: ${error.message}`);
    }
    return {};
  }

  ui.user(message);
  const controller = new AbortController();
  activeRequest = controller;
  let sources = null;
  let liveContext = null;
  let route = { type: "none" };

  try {
    // 1. Fast local clock intent check
    const clockCheck = classifyLiveRequest(message, previousUserMessage());
    if (clockCheck.type === "clock") {
      liveContext = getClockContext(clockCheck).context;
      ui.clockStatus();
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
        ui.searchStart();
        const web = await getWebContext(message, { signal: controller.signal });
        sources = web.results;
        liveContext = web.context;
        ui.searchSuccess(sources.length);
      }
    }

    if (controller.signal.aborted) {
      ui.note("Request cancelled.");
      return {};
    }

    const renderer = ui.beginAnswer();
    const answer = await streamChat(messagesFor(message, liveContext), model, (token) => renderer.push(token), {
      signal: controller.signal,
    });
    renderer.finish();
    ui.write("\n");

    history.push({ role: "user", content: message }, { role: "assistant", content: answer });
    transcript.push({ type: "user", text: message }, { type: "assistant", text: answer });
    if (sources) {
      ui.sources(sources);
      transcript.push({ type: "sources", results: sources });
    }
  } catch (error) {
    if (controller.signal.aborted || error.name === "AbortError") {
      ui.note("Generation cancelled.");
    } else if (route.needsSearch || route.type === "web_search") {
      ui.searchFailure(error.message);
      ui.note("I can't verify current information right now, so I won't guess.");
    } else {
      ui.note(`Meera could not generate a response: ${error.message}`);
    }
  } finally {
    if (activeRequest === controller) activeRequest = null;
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
    const status = await getOllamaStatus(model);
    if (!status.available) {
      console.error(`Model '${model}' was not found in Ollama. Run: ollama pull ${model}`);
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    console.error(`Cannot connect to Ollama at http://localhost:11434: ${error.message}`);
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
