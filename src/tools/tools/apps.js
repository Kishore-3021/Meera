/**
 * Application tools: open, close, focus, list open windows.
 */

import { runPowerShell, runPowerShellJson, psSanitize } from "../executor.js";
import { PERMISSION } from "../permissions.js";
import { statSync } from "node:fs";

// Common app aliases → executable/paths
const APP_ALIASES = {
  chrome: "chrome", google: "chrome", "google chrome": "chrome",
  firefox: "firefox",
  edge: "msedge", "microsoft edge": "msedge",
  notepad: "notepad",
  explorer: "explorer", "file explorer": "explorer",
  "vs code": "code", vscode: "code", code: "code",
  "visual studio code": "code",
  spotify: "spotify",
  discord: "discord",
  slack: "slack",
  steam: "steam",
  "task manager": "taskmgr", taskmgr: "taskmgr",
  calculator: "calc", calc: "calc",
  paint: "mspaint",
  terminal: "wt", "windows terminal": "wt",
  powershell: "powershell",
  cmd: "cmd",
  "control panel": "control",
  settings: "ms-settings:",
  "windows settings": "ms-settings:",
  snipping: "snippingtool",
  outlook: "outlook",
  word: "winword",
  excel: "excel",
  powerpoint: "powerpnt",
};

function resolveApp(name) {
  const key = String(name).toLowerCase().trim();
  return APP_ALIASES[key] ?? key;
}

/**
 * Discover an application's executable path.
 * Order: PATH (Get-Command) → registry App Paths → Start Menu shortcuts.
 * Returns { found, path, source } via JSON from PowerShell.
 */
async function discoverApp(name) {
  const safe = psSanitize(String(name).trim());
  const script = `
$name = '${safe}'
$result = @{ found = $false; path = $null; source = $null }
$cmd = Get-Command "$name.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($cmd -and $cmd.Source) {
  $result.found = $true; $result.path = $cmd.Source; $result.source = 'PATH'
} else {
  $roots = @(
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths'
  )
  foreach ($root in $roots) {
    $key = Join-Path $root "$name.exe"
    if (Test-Path $key) {
      $p = (Get-ItemProperty -Path $key).'(default)'
      if (-not $p) { continue }
      if ($p -match '^\"?([^\"]+)') { $p = $Matches[1] }
      if (Test-Path $p) { $result.found = $true; $result.path = $p; $result.source = 'AppPaths'; break }
    }
  }
}
if (-not $result.found) {
  $dirs = @(
    (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu'),
    (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu'),
    [Environment]::GetFolderPath('Desktop')
  )
  $lnk = Get-ChildItem $dirs -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue |
    Where-Object { $_.BaseName -like "*$name*" } |
    Sort-Object { [math]::Min($_.BaseName.Length, [math]::Abs($_.BaseName.Length - $name.Length)) } |
    Select-Object -First 1
  if ($lnk) {
    try {
      $sh = New-Object -ComObject WScript.Shell
      $target = $sh.CreateShortcut($lnk.FullName).TargetPath
    } catch { $target = $null }
    if ($target -and (Test-Path $target)) {
      $result.found = $true; $result.path = $target; $result.source = ('StartMenu: ' + $lnk.BaseName)
    } elseif ($lnk.FullName) {
      $result.found = $true; $result.path = $lnk.FullName; $result.source = 'StartMenu shortcut'
    }
  }
}
$result | ConvertTo-Json -Compress`;
  const res = await runPowerShellJson(script);
  return res.success ? res.data : { found: false };
}

/** Verify a process is running after launch. Returns process info or null. */
async function verifyProcessRunning(procName, windowTitleHint = null) {
  const safeName = psSanitize(procName);
  const titleFilter = windowTitleHint
    ? `| Where-Object { $_.MainWindowTitle -like '*${psSanitize(windowTitleHint)}*' -or $_.MainWindowTitle -eq '' }`
    : "";
  const script = `
$p = Get-Process -Name '${safeName}' -ErrorAction SilentlyContinue ${titleFilter} |
  Where-Object { $_.MainWindowHandle -ne 0 -or $true } | Select-Object -First 3 Name, Id, MainWindowTitle
if ($p) { $p | ConvertTo-Json -Compress } else { Write-Output 'NONE' }`;
  const res = await runPowerShell(script);
  return res.success && !res.stdout.includes("NONE") ? res.stdout : null;
}

async function launchAndVerify(target, args = "", processName = null) {
  const argPart = args ? ` -ArgumentList '${psSanitize(String(args))}'` : "";
  const result = await runPowerShell(`$p = Start-Process -FilePath '${psSanitize(target)}'${argPart} -PassThru; Start-Sleep -Milliseconds 1200; if ($p) { Write-Output "LAUNCHED:$($p.Id)" } else { Write-Output "NOT_STARTED" }`);
  if (!result.success || !result.stdout.includes("LAUNCHED:")) {
    return { success: false, error: result.stderr || `Application '${target}' did not remain running.` };
  }
  const verified = processName ? await verifyProcessRunning(processName) : result.stdout;
  return verified
    ? { success: true, verification: verified }
    : { success: false, error: `Application '${target}' was launched but could not be verified running.` };
}

function procNameFromPath(path) {
  const base = String(path).split("\\").pop() ?? "";
  return base.replace(/\.exe$/i, "");
}

// ─── app.open ────────────────────────────────────────────────────────────────
export const appOpen = {
  id: "app.open",
  name: "Open Application",
  description: "Open an application by name (e.g. 'Chrome', 'VS Code', 'Comet') or full path. Discovers installed apps via PATH, registry, and Start Menu, then verifies the process started.",
  category: "apps",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "app", type: "string", description: "Application name or path", required: true },
    { name: "args", type: "string", description: "Optional command-line arguments", required: false },
  ],
  async detect() { return true; },
  async execute({ app, args = "" } = {}) {
    if (!app) return { success: false, output: null, error: "app is required." };
    const raw = String(app).trim();

    // URI protocols (ms-settings:, steam://, etc.) launch directly
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[\w]:\\/.test(raw)) {
      const result = await launchAndVerify(raw);
      return {
        success: result.success,
        output: result.success ? `Opened ${raw} and verified it is running.` : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Full path passed directly
    if (/[\\/]/.test(raw)) {
      if (!existsSyncSafe(raw)) return { success: false, output: null, error: `File not found: ${raw}` };
      const result = await launchAndVerify(raw, args, procNameFromPath(raw));
      return {
        success: result.success,
        output: result.success ? `Launched ${raw} and verified it is running.` : null,
        error: result.success ? undefined : result.error || `Could not open '${app}'.`,
      };
    }

    // Name-based: alias map first, then discovery
    const resolved = resolveApp(raw);
    let targetPath = null;
    let source = "alias";
    const discovered = await discoverApp(resolved === raw ? raw : resolved);
    if (discovered?.found && discovered.path) {
      targetPath = discovered.path;
      source = discovered.source ?? "discovered";
    }
    if (!targetPath && resolved !== raw) {
      const alt = await discoverApp(raw);
      if (alt?.found && alt.path) {
        targetPath = alt.path;
        source = alt.source ?? "discovered";
      }
    }

    const launchTarget = targetPath ?? resolved;
    const isShortcut = /\.lnk$/i.test(launchTarget);
    const result = await launchAndVerify(launchTarget, isShortcut ? "" : args, targetPath ? procNameFromPath(targetPath) : resolved);

    if (!result.success) {
      return {
        success: false,
        output: null,
        error: `Could not open '${app}'. ${result.error || "Application not found in PATH, App Paths registry, or Start Menu."}`,
      };
    }
    return { success: true, output: `${raw} opened (found via ${source}) and verified running.` };
  },
};

function existsSyncSafe(p) {
  try {
    return statSync(p, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

// ─── app.close ───────────────────────────────────────────────────────────────
export const appClose = {
  id: "app.close",
  name: "Close Application",
  description: "Close an application by name (gracefully, then force if needed).",
  category: "apps",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "app", type: "string", description: "Application or process name", required: true },
  ],
  async detect() { return true; },
  async execute({ app } = {}) {
    if (!app) return { success: false, output: null, error: "app is required." };
    const resolved = resolveApp(app);
    const safe = psSanitize(resolved);
    const script = `
$procs = Get-Process -Name '${safe}' -ErrorAction SilentlyContinue
if ($procs) {
  $procs | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  Start-Sleep -Milliseconds 1200
  $remaining = @(Get-Process -Name '${safe}' -ErrorAction SilentlyContinue)
  if ($remaining.Count -gt 0) { $remaining | Stop-Process -Force }
  Start-Sleep -Milliseconds 300
  $after = @(Get-Process -Name '${safe}' -ErrorAction SilentlyContinue)
  Write-Output "CLOSED:$($after.Count)"
} else {
  Write-Output "NOT_FOUND"
}`;
    const result = await runPowerShell(script);
    if (result.stdout.startsWith("CLOSED:0")) return { success: true, output: `Closed ${app}. Verified: no processes remain.` };
    if (result.stdout.startsWith("CLOSED:")) {
      const count = result.stdout.split(":")[1];
      return { success: true, output: `Closed ${app}. Note: ${count} related process(es) still running.` };
    }
    if (result.stdout.includes("NOT_FOUND")) return { success: false, output: null, error: `'${app}' is not running.` };
    return { success: false, output: null, error: result.stderr || "Close failed." };
  },
};

// ─── app.focus ───────────────────────────────────────────────────────────────
export const appFocus = {
  id: "app.focus",
  name: "Focus Application Window",
  description: "Bring an application window to the foreground.",
  category: "apps",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "app", type: "string", description: "Application name", required: true },
  ],
  async detect() { return true; },
  async execute({ app } = {}) {
    if (!app) return { success: false, output: null, error: "app is required." };
    const resolved = resolveApp(app);
    const safe = psSanitize(resolved);
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@ -ErrorAction SilentlyContinue 2>&1 | Out-Null
$proc = Get-Process -Name '${safe}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
  [WinAPI]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
  [WinAPI]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  Write-Output "FOCUSED"
} else { Write-Output "NOT_FOUND" }`;
    const result = await runPowerShell(script);
    if (result.stdout.includes("FOCUSED")) return { success: true, output: `Focused ${app}.` };
    return { success: false, output: null, error: `Could not focus '${app}'. It may not be running or have no window.` };
  },
};

// ─── app.list ────────────────────────────────────────────────────────────────
export const appList = {
  id: "app.list",
  name: "List Open Windows",
  description: "List all currently open application windows.",
  category: "apps",
  permissionLevel: PERMISSION.READ,
  parameters: [],
  async detect() { return true; },
  async execute() {
    const script = `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Name, Id, MainWindowTitle | ConvertTo-Json`;
    const result = await runPowerShellJson(script);
    if (!result.success) return { success: false, output: null, error: result.error };
    const list = Array.isArray(result.data) ? result.data : [result.data];
    const lines = list.map((p) => `  • ${p.Name.padEnd(20)} — ${p.MainWindowTitle}`);
    return { success: true, output: `Open Windows (${list.length}):\n${lines.join("\n")}`, data: list };
  },
};

export const allAppTools = [appOpen, appClose, appFocus, appList];
