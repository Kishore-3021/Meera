/**
 * Execution tools: controlled PowerShell, Python, and Git execution.
 */

import { runPowerShell, runPython, runGit, psSanitize } from "../executor.js";
import { PERMISSION } from "../permissions.js";
import { normalizeWindowsPath } from "../paths.js";

// ─── exec.powershell ─────────────────────────────────────────────────────────
export const execPowerShell = {
  id: "exec.powershell",
  name: "Run PowerShell Script",
  description: "Execute a PowerShell script or command. Read-only/safe by default; use for system queries, configuration, and automation.",
  category: "execution",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "script", type: "string", description: "PowerShell command or script to execute", required: true },
    { name: "timeout", type: "number", description: "Timeout in seconds (default: 15)", required: false },
  ],
  async detect() { return true; },
  async execute({ script, timeout = 15 } = {}) {
    if (!script) return { success: false, output: null, error: "script is required." };

    // Block obviously dangerous patterns
    const BLOCKED = [/format-volume/i, /remove-item.*-recurse.*c:\\/i, /del.*\/[sf].*c:\\/i, /mklink.*\/[dj]/i, /net user.*\/add/i, /reg delete/i];
    for (const pattern of BLOCKED) {
      if (pattern.test(script)) return { success: false, output: null, error: `Blocked: script matches unsafe pattern (${pattern.source}).` };
    }

    const result = await runPowerShell(script, { timeoutMs: Math.min(60, Number(timeout)) * 1000 });
    if (result.timedOut) return { success: false, output: null, error: `Script timed out after ${timeout}s.` };

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 4000);
    return { success: result.success, output: output || "(no output)", error: result.success ? undefined : result.stderr };
  },
};

// ─── exec.python ─────────────────────────────────────────────────────────────
export const execPython = {
  id: "exec.python",
  name: "Run Python Code",
  description: "Execute a Python code snippet and return stdout/stderr.",
  category: "execution",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "code", type: "string", description: "Python code to execute", required: true },
    { name: "cwd", type: "string", description: "Working directory (optional)", required: false },
    { name: "timeout", type: "number", description: "Timeout in seconds (default: 30)", required: false },
  ],
  async detect() {
    const result = await runPython("import sys; print('ok')", { timeoutMs: 5000 });
    return result.success && result.stdout.includes("ok");
  },
  async execute({ code, cwd, timeout = 30 } = {}) {
    if (!code) return { success: false, output: null, error: "code is required." };
    const workDir = cwd ? normalizeWindowsPath(cwd) : undefined;
    const result = await runPython(String(code), { cwd: workDir, timeoutMs: Math.min(120, Number(timeout)) * 1000 });
    if (result.timedOut) return { success: false, output: null, error: `Python execution timed out after ${timeout}s.` };
    const out = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 4000);
    return { success: result.success, output: out || "(no output)", error: result.success ? undefined : result.stderr };
  },
};

// ─── exec.git ────────────────────────────────────────────────────────────────
export const execGit = {
  id: "exec.git",
  name: "Run Git Command",
  description: "Run a git command (e.g. status, log, diff, commit, push) in a directory.",
  category: "execution",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "command", type: "string", description: "Git subcommand and args (e.g. 'status', 'log --oneline -5')", required: true },
    { name: "cwd", type: "string", description: "Repository directory (default: current)", required: false },
  ],
  async detect() {
    const result = await runGit(["--version"], {});
    return result.success;
  },
  async execute({ command, cwd } = {}) {
    if (!command) return { success: false, output: null, error: "command is required." };
    const args = String(command).trim().split(/\s+/);

    // Block push/force-push without explicit flag detection
    const WRITE_OPS = ["push", "reset", "clean", "rm", "checkout", "merge", "rebase"];
    const isWriteOp = WRITE_OPS.includes(args[0]);

    const workDir = cwd ? normalizeWindowsPath(cwd) : process.cwd();
    const result = await runGit(args, { cwd: workDir });
    const out = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 3000);
    return { success: result.success, output: out || "(no output)", error: result.success ? undefined : result.stderr };
  },
};

export const allExecTools = [execPowerShell, execPython, execGit];
