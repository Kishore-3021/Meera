/**
 * Controlled execution layer for Meera's Windows agent.
 * All Windows interactions go through this module — never raw shell injection.
 * Every function captures stdout/stderr, enforces timeouts, and returns structured results.
 */

import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 15_000;
const PYTHON_TIMEOUT_MS = 30_000;
const DESTRUCTIVE_TIMEOUT_MS = 10_000;

/**
 * Run a child process and collect output.
 * @returns {{ success: boolean, stdout: string, stderr: string, code: number|null }}
 */
export async function runProcess(command, args = [], { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    }

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0 && !timedOut,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code: timedOut ? null : code,
        timedOut,
      });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ success: false, stdout: "", stderr: error.message, code: null, timedOut: false });
    });
  });
}

/**
 * Execute a PowerShell script string.
 * Uses -NonInteractive -NoProfile to prevent prompts.
 */
export async function runPowerShell(script, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const result = await runProcess(
    "powershell.exe",
    [
      "-NonInteractive",
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command", script,
    ],
    { timeoutMs }
  );
  return result;
}

/**
 * Execute a Python code snippet by writing it to a temp file and running it.
 * The temp file is always cleaned up, even on error.
 */
export async function runPython(code, { timeoutMs = PYTHON_TIMEOUT_MS, cwd } = {}) {
  const filename = join(tmpdir(), `meera_py_${randomBytes(6).toString("hex")}.py`);
  try {
    await writeFile(filename, code, "utf8");
    const result = await runProcess("python", [filename], { cwd, timeoutMs });
    return result;
  } finally {
    await unlink(filename).catch(() => {});
  }
}

/**
 * Run a git command in a specified directory.
 */
export async function runGit(args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return runProcess("git", args, { cwd, timeoutMs });
}

/**
 * Run a PowerShell script and parse the output as JSON.
 * Useful for querying Windows WMI/CIM objects.
 */
export async function runPowerShellJson(script, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const result = await runPowerShell(script, { timeoutMs });
  if (!result.success) return { success: false, data: null, error: result.stderr || "PowerShell failed" };
  try {
    const data = JSON.parse(result.stdout);
    return { success: true, data };
  } catch {
    return { success: false, data: null, error: `JSON parse failed. Raw: ${result.stdout.slice(0, 200)}` };
  }
}

/**
 * Sanitize a string for safe inclusion in a PowerShell command.
 * Escapes single quotes and wraps in single-quote delimited string.
 */
export function psSanitize(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * Sanitize a filesystem path for PowerShell — returns escaped version.
 */
export function psPath(value) {
  return psSanitize(String(value).replace(/\//g, "\\"));
}
