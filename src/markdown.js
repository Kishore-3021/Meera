const ANSI = {
  reset: "\x1b[0m", bold: "\x1b[1m", italic: "\x1b[3m",
  purple: "\x1b[35m", brightPurple: "\x1b[95m", lavender: "\x1b[38;5;183m",
  green: "\x1b[38;5;114m", yellow: "\x1b[38;5;221m", gray: "\x1b[38;5;245m",
  white: "\x1b[97m", violet: "\x1b[38;5;141m",
};

function safe(text) {
  return String(text ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

function paint(style, text) { return `${style}${text}${ANSI.reset}`; }

function highlightCode(line) {
  const token = /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|class|import|from|export|async|await|def|self|True|False|None|true|false|null|undefined|public|private|static|void|new|try|catch|throw)\b|\b\d+(?:\.\d+)?\b)/g;
  return safe(line).replace(token, (match) => {
    if (/^(\/\/|#)/.test(match)) return paint(ANSI.gray, match);
    if (/^["'`]/.test(match)) return paint(ANSI.green, match);
    if (/^\d/.test(match)) return paint(ANSI.yellow, match);
    return paint(ANSI.brightPurple, match);
  });
}

function inline(text) {
  let value = safe(text);
  value = value.replace(/`([^`]+)`/g, (_, code) => paint(ANSI.lavender, code));
  value = value.replace(/\*\*([^*]+)\*\*/g, (_, bold) => paint(ANSI.bold + ANSI.white, bold));
  value = value.replace(/\*([^*]+)\*/g, (_, italic) => paint(ANSI.italic, italic));
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => `${paint(ANSI.lavender, label)} ${paint(ANSI.gray, `(${url})`)}`);
  return value;
}

export class MarkdownStreamRenderer {
  constructor(write) {
    this.write = write;
    this.pending = "";
    this.inCodeBlock = false;
  }

  push(chunk) {
    this.pending += safe(chunk);
    let nextBreak;
    while ((nextBreak = this.pending.indexOf("\n")) !== -1) {
      this.renderLine(this.pending.slice(0, nextBreak));
      this.pending = this.pending.slice(nextBreak + 1);
    }
  }

  finish() {
    if (this.pending) this.renderLine(this.pending);
    if (this.inCodeBlock) {
      this.write(`  ${paint(ANSI.gray, "╰─")}\n`);
      this.inCodeBlock = false;
    }
  }

  renderLine(line) {
    const fence = line.match(/^\s*```\s*([^\s]*)/);
    if (fence) {
      this.inCodeBlock = !this.inCodeBlock;
      const label = fence[1] || "code";
      this.write(this.inCodeBlock
        ? `  ${paint(ANSI.violet, `╭─ ${label}`)}\n`
        : `  ${paint(ANSI.violet, "╰─")}\n`);
      return;
    }
    if (this.inCodeBlock) {
      this.write(`  ${paint(ANSI.gray, "│")} ${highlightCode(line)}\n`);
      return;
    }
    if (/^\s*$/.test(line)) { this.write("\n"); return; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        this.write(`  ${paint(ANSI.violet, `├${"─".repeat(Math.min(72, cells.length * 12))}┤`)}\n`);
      } else {
        this.write(`  ${paint(ANSI.violet, "│")} ${cells.map((cell) => inline(cell)).join(` ${paint(ANSI.gray, "│")} `)} ${paint(ANSI.violet, "│")}\n`);
      }
      return;
    }
    if (/^#{1,6}\s+/.test(line)) {
      this.write(`\n  ${paint(ANSI.brightPurple + ANSI.bold, inline(line.replace(/^#{1,6}\s+/, "")))}\n`);
      return;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      this.write(`  ${paint(ANSI.lavender, "•")} ${inline(line.replace(/^\s*[-*+]\s+/, ""))}\n`);
      return;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      this.write(`  ${paint(ANSI.lavender, line.match(/^\s*\d+\./)[0])} ${inline(line.replace(/^\s*\d+\.\s+/, ""))}\n`);
      return;
    }
    if (/^>\s?/.test(line)) {
      this.write(`  ${paint(ANSI.violet, "│")} ${inline(line.replace(/^>\s?/, ""))}\n`);
      return;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      this.write(`  ${paint(ANSI.violet, "─".repeat(42))}\n`);
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
