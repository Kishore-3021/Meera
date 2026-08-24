import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_MODEL, SYSTEM_PROMPT } from "./config.js";
import { getOllamaStatus, streamChat } from "./ollama.js";
import { classifyLiveRequest, getClockContext, getWebContext } from "./live-info.js";
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
    route = classifyLiveRequest(message, previousUserMessage());
    if (route.type === "clock") {
      liveContext = getClockContext(route).context;
      ui.clockStatus();
    } else if (route.type === "web") {
      ui.searchStart();
      const web = await getWebContext(route, { signal: controller.signal });
      sources = web.results;
      liveContext = web.context;
      ui.searchSuccess(sources.length);
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
    } else if (route.type === "web") {
      // A fresh-information request must never fall through to the model if its
      // live source could not be fetched.
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
