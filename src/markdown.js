const ANSI = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", gray: "\x1b[90m",
};

function safe(text) {
  // Model output should never be able to send terminal-control sequences.
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

function paint(style, text) {
  return `${style}${text}${ANSI.reset}`;
}

function highlightCode(line) {
  const token = /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|class|import|from|export|async|await|def|self|True|False|None|true|false|null|undefined|public|private|static|void|new|try|catch|throw)\b|\b\d+(?:\.\d+)?\b)/g;
  return safe(line).replace(token, (match) => {
    if (/^(\/\/|#)/.test(match)) return paint(ANSI.gray, match);
    if (/^["'`]/.test(match)) return paint(ANSI.green, match);
    if (/^\d/.test(match)) return paint(ANSI.yellow, match);
    return paint(ANSI.magenta, match);
  });
}

function inline(text) {
  let value = safe(text);
  value = value.replace(/`([^`]+)`/g, (_, code) => paint(ANSI.cyan, code));
  value = value.replace(/\*\*([^*]+)\*\*/g, (_, bold) => paint(ANSI.bold, bold));
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => `${paint(ANSI.cyan, label)} ${paint(ANSI.gray, `(${url})`)}`);
  return value;
}

export class MarkdownStreamRenderer {
  constructor(write) {
    this.write = write;
    this.pending = "";
    this.inCodeBlock = false;
  }

  push(chunk) {
    this.pending += chunk;
    let nextBreak;
    while ((nextBreak = this.pending.indexOf("\n")) !== -1) {
      this.renderLine(this.pending.slice(0, nextBreak));
      this.pending = this.pending.slice(nextBreak + 1);
    }
  }

  finish() {
    if (this.pending) this.renderLine(this.pending);
    if (this.inCodeBlock) this.write(`  ${paint(ANSI.gray, "╰") }\n`);
  }

  renderLine(line) {
    const fence = line.match(/^\s*```\s*([^\s]*)/);
    if (fence) {
      this.inCodeBlock = !this.inCodeBlock;
      const label = fence[1] || "code";
      this.write(this.inCodeBlock
        ? `  ${paint(ANSI.gray, `╭─ ${label}`)}\n`
        : `  ${paint(ANSI.gray, "╰")}\n`);
      return;
    }
    if (this.inCodeBlock) {
      this.write(`  ${paint(ANSI.gray, "│")} ${highlightCode(line)}\n`);
      return;
    }
    if (/^\s*$/.test(line)) { this.write("\n"); return; }
    if (/^#{1,6}\s+/.test(line)) {
      this.write(`  ${paint(ANSI.bold + ANSI.cyan, inline(line.replace(/^#{1,6}\s+/, "")))}\n`);
      return;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      this.write(`  ${paint(ANSI.cyan, "•")} ${inline(line.replace(/^\s*[-*+]\s+/, ""))}\n`);
      return;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      this.write(`  ${paint(ANSI.cyan, line.match(/^\s*\d+\./)[0])} ${inline(line.replace(/^\s*\d+\.\s+/, ""))}\n`);
      return;
    }
    if (/^>\s?/.test(line)) {
      this.write(`  ${paint(ANSI.gray, "│")} ${inline(line.replace(/^>\s?/, ""))}\n`);
      return;
    }
    this.write(`  ${inline(line)}\n`);
  }
}

export function renderMarkdown(text, write) {
  const renderer = new MarkdownStreamRenderer(write);
  renderer.push(text);
  renderer.finish();
}
