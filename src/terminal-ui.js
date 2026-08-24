import { MarkdownStreamRenderer, renderMarkdown } from "./markdown.js";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m",
  green: "\x1b[32m", yellow: "\x1b[33m", gray: "\x1b[90m", blue: "\x1b[34m",
};
const stripAnsi = (value) => value.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "");
const style = (codes, value) => `${codes}${value}${C.reset}`;

function line(totalWidth, left, right = "") {
  const gap = Math.max(1, totalWidth - 4 - stripAnsi(left).length - stripAnsi(right).length);
  return `│ ${left}${" ".repeat(gap)}${right} │`;
}

export class MeeraTerminal {
  constructor(output) {
    this.output = output;
    this.interactive = Boolean(output.isTTY);
    this.ollamaStatus = "Online";
    this.webStatus = "Ready";
  }

  write(text) { this.output.write(text); }

  width() {
    return Math.max(48, Math.min(this.output.columns || 72, 92));
  }

  header() {
    const width = this.width();
    const model = style(C.dim, "Qwen 2.5 · Ollama");
    const live = style(C.green, "●") + ` ${this.ollamaStatus}`;
    const webColor = this.webStatus === "Offline" ? C.yellow : C.green;
    const web = `Web ${style(webColor, "●")} ${this.webStatus}`;
    this.write(`${style(C.cyan, `╭${"─".repeat(width - 2)}╮`)}\n`);
    this.write(`${style(C.cyan, line(width, style(C.bold + C.cyan, "MEERA"), model))}\n`);
    this.write(`${style(C.cyan, line(width, live, web))}\n`);
    this.write(`${style(C.cyan, `╰${"─".repeat(width - 2)}╯`)}\n\n`);
  }

  start() {
    if (this.interactive) this.write("\x1b[2J\x1b[H");
    this.header();
    this.note("Local chat · /help for commands");
  }

  redraw(transcript = []) {
    if (!this.interactive) return;
    this.write("\x1b[2J\x1b[H");
    this.header();
    for (const item of transcript) {
      if (item.type === "user") this.user(item.text);
      if (item.type === "assistant") this.answer(item.text);
      if (item.type === "sources") this.sources(item.results);
    }
  }

  user(text) {
    this.write(`${style(C.bold, "›")} ${text}\n\n`);
  }

  note(text) {
    this.write(`  ${style(C.dim, text)}\n\n`);
  }

  searchStart() {
    this.webStatus = "Searching";
    this.write(`  ${style(C.cyan, "◐")} ${style(C.dim, "Searching the web...")}\n`);
  }

  searchSuccess(count) {
    this.webStatus = "Online";
    this.write(`  ${style(C.green, "✓")} ${style(C.dim, `${count} sources found`)}\n\n`);
  }

  searchFailure(message) {
    this.webStatus = "Offline";
    this.write(`  ${style(C.yellow, "!")} ${style(C.yellow, `Live web information unavailable: ${message}`)}\n\n`);
  }

  clockStatus() {
    this.write(`  ${style(C.green, "✓")} ${style(C.dim, "Using local clock")}\n\n`);
  }

  beginAnswer() {
    this.write(`${style(C.bold + C.cyan, "  Meera")}\n`);
    return new MarkdownStreamRenderer((text) => this.write(text));
  }

  answer(text) {
    this.write(`${style(C.bold + C.cyan, "  Meera")}\n`);
    renderMarkdown(text, (chunk) => this.write(chunk));
    this.write("\n");
  }

  sources(results) {
    this.write(`${style(C.bold, "  Sources")}\n`);
    results.forEach((result, index) => {
      this.write(`  ${style(C.cyan, `${index + 1}.`)} ${result.title}\n`);
      this.write(`     ${style(C.gray, result.url)}\n`);
    });
    this.write("\n");
  }

  status({ model, available }) {
    this.write(`  ${style(C.bold, "Status")}\n`);
    this.write(`  Ollama  ${available ? style(C.green, "● Online") : style(C.yellow, "● Model unavailable")}\n`);
    this.write(`  Model   ${model}\n`);
    this.write(`  Web     ${this.webStatus === "Offline" ? style(C.yellow, "● Offline") : style(C.green, `● ${this.webStatus}`)}\n\n`);
  }

  help() {
    this.write(`${style(C.bold, "  Commands")}\n`);
    this.write("  /help    Show commands\n  /clear   Clear the visible chat and session history\n  /status  Check Ollama and web status\n  /model   Show the active model\n  /exit    Exit Meera\n\n");
    this.write(`  ${style(C.dim, "Keys: ↑/↓ history · Ctrl+C cancel/exit · Ctrl+L redraw")}\n\n`);
  }
}

export class PromptSession {
  constructor({ input, output, onSubmit, onCancel, onRedraw }) {
    this.input = input;
    this.output = output;
    this.onSubmit = onSubmit;
    this.onCancel = onCancel;
    this.onRedraw = onRedraw;
    this.buffer = "";
    this.history = [];
    this.historyIndex = 0;
    this.busy = false;
    this.closed = false;
  }

  prompt() {
    const columns = this.output.columns || 80;
    const prefix = `${C.bold}›${C.reset} `;
    const available = Math.max(12, columns - 3);
    const visible = this.buffer.length > available ? `…${this.buffer.slice(-(available - 1))}` : this.buffer;
    this.output.write(`\r\x1b[2K${prefix}${visible}`);
  }

  async submit() {
    const value = this.buffer.trim();
    this.output.write("\r\x1b[2K");
    if (!value) { this.prompt(); return; }
    if (this.history.at(-1) !== value) this.history.push(value);
    this.historyIndex = this.history.length;
    this.buffer = "";
    this.busy = true;
    const result = await this.onSubmit(value);
    this.busy = false;
    if (result?.exit) { this.close(); return; }
    this.prompt();
  }

  async cancel() {
    if (this.busy) {
      this.onCancel();
      return;
    }
    this.output.write("\n");
    this.close();
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

  previous() {
    if (!this.history.length) return;
    this.historyIndex = Math.max(0, this.historyIndex - 1);
    this.buffer = this.history[this.historyIndex];
    this.prompt();
  }

  next() {
    if (!this.history.length) return;
    this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
    this.buffer = this.history[this.historyIndex] ?? "";
    this.prompt();
  }

  run() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.input.setRawMode(true);
      this.input.resume();
      this.input.setEncoding("utf8");
      this.listener = (data) => this.consume(data);
      this.resizeListener = () => { if (!this.busy) { this.onRedraw(); this.prompt(); } };
      this.input.on("data", this.listener);
      process.on("SIGWINCH", this.resizeListener);
      this.output.on("resize", this.resizeListener);
      this.prompt();
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.input.off("data", this.listener);
    process.off("SIGWINCH", this.resizeListener);
    this.output.off("resize", this.resizeListener);
    this.input.setRawMode(false);
    this.input.pause();
    this.resolve?.();
  }
}
