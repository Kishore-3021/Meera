import { MarkdownStreamRenderer, renderMarkdown } from "./markdown.js";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  purple: "\x1b[35m", brightPurple: "\x1b[95m", lavender: "\x1b[38;5;183m",
  white: "\x1b[97m", gray: "\x1b[38;5;245m", green: "\x1b[38;5;114m",
  yellow: "\x1b[38;5;221m", red: "\x1b[38;5;168m", violet: "\x1b[38;5;141m",
};

const style = (codes, value) => `${codes}${value}${C.reset}`;
const clean = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
const widthFor = (output) => Math.max(56, Math.min(78, (output.columns || 80) - 2));
const truncate = (value, length) => {
  const text = clean(value);
  return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}…` : text;
};

const ASCII_LOGO = [
  "███╗   ███╗███████╗███████╗██████╗  █████╗ ",
  "████╗ ████║██╔════╝██╔════╝██╔══██╗██╔══██╗",
  "██╔████╔██║█████╗  █████╗  ██████╔╝███████║",
  "██║╚██╔╝██║██╔══╝  ██╔══╝  ██╔══██╗██╔══██║",
  "██║ ╚═╝ ██║███████╗███████╗██║  ██║██║  ██║",
  "╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
];

export class MeeraTerminal {
  constructor(output) {
    this.output = output;
    this.interactive = Boolean(output.isTTY);
    this.ollamaStatus = "Online";
    this.webStatus = "Online";
    this.toolsCount = 5;
    this.state = "idle";
  }

  write(text) { this.output.write(text); }

  dot(status, busy = false) {
    if (busy) return style(C.lavender, "◌");
    return status === "Online" ? style(C.green, "●") : style(C.yellow, "●");
  }

  statusLine() {
    const web = this.webStatus === "Searching" ? "Searching" : this.webStatus;
    return `  ${this.dot(this.ollamaStatus)} ${style(C.white, "Ollama")}   ${this.dot(web, web === "Searching")} ${style(C.white, "Web")}   ${style(C.brightPurple, "●")} ${style(C.white, `${this.toolsCount} Tools`)}   ${style(C.lavender, "Qwen 2.5")}`;
  }

  header() {
    const width = widthFor(this.output);
    const inner = width - 2;
    const line = (text = "") => `│${text.padEnd(inner).slice(0, inner)}│\n`;
    this.write(`\n${style(C.purple, `╭${"─".repeat(inner)}╮`)}\n`);
    this.write(line());
    for (const logoLine of ASCII_LOGO) {
      const centered = logoLine.padStart(Math.floor((inner + logoLine.length) / 2));
      this.write(style(C.brightPurple, line(`   ${centered}`)));
    }
    this.write(line());
    const tagline = "LOCAL AI  •  QWEN  •  OLLAMA";
    this.write(style(C.lavender, line(tagline.padStart(Math.floor((inner + tagline.length) / 2)))));
    this.write(line());
    this.write(style(C.purple, `╰${"─".repeat(inner)}╯\n`));
    this.write(`${this.statusLine()}\n\n`);
  }

  start() {
    if (this.interactive) this.write("\x1b[2J\x1b[H");
    this.state = "idle";
    this.header();
    this.note("Ready when you are  ·  /help for commands");
  }

  redraw(transcript = []) {
    if (!this.interactive) return;
    this.write("\x1b[2J\x1b[H");
    this.header();
    for (const item of transcript) {
      if (item.type === "user") this.user(item.text);
      if (item.type === "assistant") this.answer(item.text);
      if (item.type === "sources") this.sources(item.results);
      if (item.type === "note") this.note(item.text);
    }
  }

  user(text) {
    this.write(`\n  ${style(C.brightPurple + C.bold, "›")} ${style(C.white + C.bold, clean(text))}\n`);
  }

  note(text) {
    this.write(`  ${style(C.gray, clean(text))}\n\n`);
  }

  activity(icon, message, color = C.lavender) {
    this.state = message.toLowerCase().includes("search") ? "searching" : "thinking";
    this.write(`  ${style(color, icon)} ${style(C.gray, clean(message))}\n`);
  }

  searchStart() {
    this.webStatus = "Searching";
    this.activity("◌", "Searching the web...");
  }

  searchSuccess(count) {
    this.webStatus = "Online";
    this.state = "success";
    this.write(`  ${style(C.green, "✓")} ${style(C.gray, `${count} source${count === 1 ? "" : "s"} found`)}\n\n`);
  }

  searchFailure(message) {
    this.webStatus = "Offline";
    this.state = "error";
    this.write(`  ${style(C.red, "✗")} ${style(C.red, `Web search unavailable — ${truncate(message, 100)}`)}\n\n`);
  }

  clockStatus() {
    this.state = "success";
    this.write(`  ${style(C.green, "✓")} ${style(C.gray, "Using local clock")}\n\n`);
  }

  beginAnswer() {
    this.state = "thinking";
    this.write(`\n  ${style(C.brightPurple + C.bold, "✦ Meera")}\n`);
    this.write(`  ${style(C.violet, "─".repeat(Math.min(38, widthFor(this.output) - 4)))}\n`);
    return new MarkdownStreamRenderer((text) => this.write(text));
  }

  answer(text) {
    this.state = "success";
    this.write(`\n  ${style(C.brightPurple + C.bold, "✦ Meera")}\n`);
    this.write(`  ${style(C.violet, "─".repeat(Math.min(38, widthFor(this.output) - 4)))}\n`);
    renderMarkdown(text, (chunk) => this.write(chunk));
    this.write("\n");
  }

  sources(results) {
    this.write(`\n  ${style(C.lavender + C.bold, "Sources")}\n`);
    for (const [index, result] of results.entries()) {
      this.write(`  ${style(C.brightPurple, `${index + 1}.`)} ${style(C.white, truncate(result.title, 72))}\n`);
      this.write(`     ${style(C.gray, truncate(result.url, 92))}\n`);
    }
    this.write("\n");
  }

  status({ model, ollamaOnline, searxngOnline, toolsCount, currentTask, lastAction, lastActionResult }) {
    this.write(`\n  ${style(C.brightPurple + C.bold, "MEERA STATUS")}\n`);
    this.write(`  ${style(C.violet, "─".repeat(42))}\n`);
    this.write(`  ${style(C.gray, "Model   ")} ${style(C.white, model)}\n`);
    this.write(`  ${style(C.gray, "Ollama  ")} ${ollamaOnline ? style(C.green, "● Online") : style(C.yellow, "● Offline")}\n`);
    this.write(`  ${style(C.gray, "Web     ")} ${searxngOnline ? style(C.green, "● Online") : style(C.yellow, "● Offline")}\n`);
    this.write(`  ${style(C.gray, "Tools   ")} ${style(C.white, `${toolsCount ?? this.toolsCount} available`)}\n`);
    this.write(`  ${style(C.gray, "State   ")} ${style(C.lavender, this.state)}\n`);
    this.write(`  ${style(C.gray, "Task    ")} ${style(C.white, currentTask || "Idle")}\n`);
    const lastDisplay = lastAction && lastAction !== "None" ? `${lastAction} (${lastActionResult || "Success"})` : "None";
    this.write(`  ${style(C.gray, "Last    ")} ${style(C.white, lastDisplay)}\n\n`);
  }

  about({ model, ollamaOnline, searxngOnline, capabilities = [] }) {
    this.write(`\n  ${style(C.brightPurple + C.bold, "✦ MEERA — LOCAL AI ASSISTANT")}\n`);
    this.write(`  ${style(C.violet, "─".repeat(42))}\n`);
    this.write(`  ${style(C.gray, "Identity     ")} ${style(C.white, "Meera")}\n`);
    this.write(`  ${style(C.gray, "Architecture ")} ${style(C.white, "Ollama + SearXNG + SQLite")}\n`);
    this.write(`  ${style(C.gray, "Model        ")} ${style(C.white, model)}\n`);
    this.write(`  ${style(C.gray, "Ollama       ")} ${ollamaOnline ? style(C.green, "● Online") : style(C.yellow, "● Offline")}\n`);
    this.write(`  ${style(C.gray, "SearXNG      ")} ${searxngOnline ? style(C.green, "● Online") : style(C.yellow, "● Offline")}\n\n`);
    this.write(`  ${style(C.lavender + C.bold, "Available capabilities")}\n`);
    for (const cap of capabilities) this.write(`  ${style(C.brightPurple, "•")} ${style(C.white, cap.name)} ${style(C.gray, `— ${cap.description}`)}\n`);
    this.write("\n");
  }

  help() {
    this.write(`\n  ${style(C.lavender + C.bold, "COMMANDS")}\n`);
    this.write(`  ${style(C.brightPurple, "/help")}       Show available commands\n`);
    this.write(`  ${style(C.brightPurple, "/about")}      Show identity and capabilities\n`);
    this.write(`  ${style(C.brightPurple, "/status")}     Check live service and task status\n`);
    this.write(`  ${style(C.brightPurple, "/tools")}      List available Windows tools\n`);
    this.write(`  ${style(C.brightPurple, "/decisions")}  View recent router decisions\n`);
    this.write(`  ${style(C.brightPurple, "/model")}      Show the active model\n`);
    this.write(`  ${style(C.brightPurple, "/clear")}      Clear conversation and screen\n`);
    this.write(`  ${style(C.brightPurple, "/exit")}       Exit Meera\n\n`);
    this.write(`  ${style(C.gray, "↑/↓ history  ·  Ctrl+C cancel/exit  ·  Ctrl+L redraw")}\n\n`);
  }

  agentPlan(steps) {
    this.write(`  ${style(C.gray, `Plan · ${steps.length} step${steps.length !== 1 ? "s" : ""}`)} ${style(C.violet, steps.map((s) => s.tool).join("  →  "))}\n\n`);
  }

  agentStep(step, total, description) {
    this.state = "executing";
    this.write(`  ${style(C.lavender, "◌")} ${style(C.gray, `[${step}/${total}]`)} ${style(C.white, truncate(description, 100))}\n`);
  }

  agentDone(step, output) {
    this.state = "success";
    const preview = output ? ` — ${truncate(output.split("\n")[0], 70)}` : "";
    this.write(`  ${style(C.green, "✓")} ${style(C.gray, `Step ${step} complete${preview}`)}\n`);
  }

  agentError(step, errorMessage) {
    this.state = "error";
    this.write(`  ${style(C.red, "✗")} ${style(C.red, `Step ${step} failed — ${truncate(errorMessage, 90)}`)}\n`);
  }

  agentResults(results) {
    const succeeded = results.filter((r) => r.success && r.verified).length;
    const failed = results.filter((r) => !r.success && !r.skipped).length;
    this.write(`\n  ${style(C.gray, `${succeeded}/${results.length} executed steps verified`)}\n`);
    for (const result of results.filter((r) => failed && !r.success && !r.skipped)) {
      this.write(`  ${style(C.red, "•")} ${style(C.gray, `${result.description}: ${truncate(result.error ?? "failed", 90)}`)}\n`);
    }
    this.write("\n");
  }

  async confirmDestructive(description) {
    return new Promise((resolve) => {
      this.write(`\n  ${style(C.yellow, "⚠")} ${style(C.white + C.bold, "Confirmation required")}\n`);
      this.write(`  ${style(C.yellow, truncate(description, 100))}\n`);
      this.write(`  ${style(C.gray, "Type ")}${style(C.lavender + C.bold, "y")}${style(C.gray, " to confirm, anything else cancels: ")}`);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      const handler = (char) => {
        process.stdin.off("data", handler);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        const confirmed = char.trim().toLowerCase() === "y";
        this.write(`${confirmed ? style(C.green, "confirmed") : style(C.gray, "cancelled")}\n\n`);
        resolve(confirmed);
      };
      process.stdin.on("data", handler);
    });
  }
}

export class PromptSession {
  constructor({ input, output, onSubmit, onCancel, onRedraw }) {
    this.input = input; this.output = output; this.onSubmit = onSubmit;
    this.onCancel = onCancel; this.onRedraw = onRedraw;
    this.buffer = ""; this.history = []; this.historyIndex = 0;
    this.busy = false; this.closed = false;
  }

  prompt() {
    const columns = this.output.columns || 80;
    const prefix = `${C.bold}${C.brightPurple}›${C.reset} `;
    const available = Math.max(12, columns - 3);
    const visible = this.buffer.length > available ? `…${this.buffer.slice(-(available - 1))}` : this.buffer;
    this.output.write(`\r\x1b[2K${prefix}${visible}`);
  }

  async submit() {
    const value = this.buffer.trim();
    this.output.write("\r\x1b[2K");
    if (!value) { this.prompt(); return; }
    if (this.history.at(-1) !== value) this.history.push(value);
    this.historyIndex = this.history.length; this.buffer = ""; this.busy = true;
    const result = await this.onSubmit(value);
    this.busy = false;
    if (result?.exit) { this.close(); return; }
    this.prompt();
  }

  async cancel() {
    if (this.busy) { this.onCancel(); return; }
    this.output.write("\n"); this.close();
  }

  consume(data) {
    for (let index = 0; index < data.length; index += 1) {
      const char = data[index];
      if (char === "\x1b" && data.slice(index, index + 3) === "\x1b[A") { index += 2; if (!this.busy) this.previous(); continue; }
      if (char === "\x1b" && data.slice(index, index + 3) === "\x1b[B") { index += 2; if (!this.busy) this.next(); continue; }
      if (char === "\u0003") { this.cancel(); continue; }
      if (char === "\f") { if (!this.busy) { this.onRedraw(); this.prompt(); } continue; }
      if (this.busy) continue;
      if (char === "\r" || char === "\n") { this.submit(); continue; }
      if (char === "\x7f" || char === "\b") { this.buffer = this.buffer.slice(0, -1); this.prompt(); continue; }
      if (char >= " ") { this.buffer += char; this.prompt(); }
    }
  }

  previous() { if (!this.history.length) return; this.historyIndex = Math.max(0, this.historyIndex - 1); this.buffer = this.history[this.historyIndex]; this.prompt(); }
  next() { if (!this.history.length) return; this.historyIndex = Math.min(this.history.length, this.historyIndex + 1); this.buffer = this.history[this.historyIndex] ?? ""; this.prompt(); }

  run() {
    return new Promise((resolve) => {
      this.resolve = resolve; this.input.setRawMode(true); this.input.resume(); this.input.setEncoding("utf8");
      this.listener = (data) => this.consume(data);
      this.resizeListener = () => { if (!this.busy) { this.onRedraw(); this.prompt(); } };
      this.input.on("data", this.listener); process.on("SIGWINCH", this.resizeListener);
      this.output.on("resize", this.resizeListener); this.prompt();
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true; this.input.off("data", this.listener);
    process.off("SIGWINCH", this.resizeListener); this.output.off("resize", this.resizeListener);
    this.input.setRawMode(false); this.input.pause(); this.resolve?.();
  }
}
