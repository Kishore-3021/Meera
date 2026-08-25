/**
 * System tools: info, processes, volume, brightness, clipboard, screenshot, power.
 */

import { runPowerShell, runPowerShellJson, psSanitize } from "../executor.js";
import { PERMISSION } from "../permissions.js";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Core Audio COM interop (shared by volume tools) ─────────────────────────
const AUDIO_INTEROP = `
$code = @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr n);
  int UnregisterControlChangeNotify(IntPtr n);
  int GetChannelCount(out uint c);
  int SetMasterVolumeLevel(float l, Guid g);
  int SetMasterVolumeLevelScalar(float l, Guid g);
  int GetMasterVolumeLevel(out float l);
  int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint ch, float l, Guid g);
  int SetChannelVolumeLevelScalar(uint ch, float l, Guid g);
  int GetChannelVolumeLevel(uint ch, out float l);
  int GetChannelVolumeLevelScalar(uint ch, out float l);
  int SetMute(bool m, Guid g);
  int GetMute(out bool m);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int f, int m, IntPtr d);
  int GetDefaultAudioEndpoint(int f, int r, out IMMDevice dev);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int ctx, IntPtr p, out IAudioEndpointVolume epv);
}
public static class MeeraAudio {
  static IAudioEndpointVolume Endpoint() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice dev;
    en.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    IAudioEndpointVolume epv;
    dev.Activate(ref iid, 1, IntPtr.Zero, out epv);
    return epv;
  }
  public static double GetVolume() { float v; Endpoint().GetMasterVolumeLevelScalar(out v); return v; }
  public static void SetVolume(double v) { Endpoint().SetMasterVolumeLevelScalar((float)v, Guid.Empty); }
  public static bool GetMute() { bool m; Endpoint().GetMute(out m); return m; }
  public static void SetMute(bool m) { Endpoint().SetMute(m, Guid.Empty); }
}
'@
try { Add-Type -TypeDefinition $code -ErrorAction Stop | Out-Null } catch {
  Write-Output ('AUDIO_INTEROP_FAIL: ' + $_.Exception.Message)
  exit 1
}`;

function parseVolumeJson(stdout) {
  try {
    return JSON.parse(stdout.trim().split("\n").filter((l) => l.startsWith("{"))[0] ?? "{}");
  } catch {
    return null;
  }
}

// ─── system.info ─────────────────────────────────────────────────────────────
export const systemInfo = {
  id: "system.info",
  name: "System Information",
  description: "Get CPU, RAM, disk usage, OS version, uptime, and hostname.",
  category: "system",
  permissionLevel: PERMISSION.READ,
  parameters: [],
  async detect() { return true; },
  async execute() {
    const script = `
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$disk = Get-PSDrive C | Select-Object Used, Free
$uptime = (Get-Date) - $os.LastBootUpTime
@{
  hostname = $env:COMPUTERNAME
  os = $os.Caption
  build = $os.BuildNumber
  cpu = $cpu.Name
  ram_total_gb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
  ram_free_gb = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
  disk_used_gb = [math]::Round($disk.Used / 1GB, 2)
  disk_free_gb = [math]::Round($disk.Free / 1GB, 2)
  uptime_hours = [math]::Round($uptime.TotalHours, 1)
} | ConvertTo-Json`;
    const result = await runPowerShellJson(script);
    if (!result.success) return { success: false, output: null, error: result.error };
    const d = result.data;
    const output = `System: ${d.os} (Build ${d.build}) | Host: ${d.hostname}\nCPU: ${d.cpu}\nRAM: ${d.ram_free_gb} GB free / ${d.ram_total_gb} GB total\nDisk C: ${d.disk_free_gb} GB free / ${(d.disk_used_gb + d.disk_free_gb).toFixed(1)} GB total\nUptime: ${d.uptime_hours} hours`;
    return { success: true, output, data: d };
  },
};

// ─── system.processes ────────────────────────────────────────────────────────
export const systemProcesses = {
  id: "system.processes",
  name: "Running Processes",
  description: "List top running processes sorted by CPU usage.",
  category: "system",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "count", type: "number", description: "Number of processes to show (default: 15)", required: false },
  ],
  async detect() { return true; },
  async execute({ count = 15 } = {}) {
    const n = Math.max(1, Math.min(50, Number(count)));
    const script = `Get-Process | Sort-Object CPU -Descending | Select-Object -First ${n} Name, Id, @{N='CPU_s';E={[math]::Round($_.CPU,1)}}, @{N='RAM_MB';E={[math]::Round($_.WorkingSet/1MB,1)}} | ConvertTo-Json`;
    const result = await runPowerShellJson(script);
    if (!result.success) return { success: false, output: null, error: result.error };
    const list = Array.isArray(result.data) ? result.data : [result.data];
    const lines = list.map((p, i) => `  ${String(i + 1).padStart(2)}. ${p.Name.padEnd(25)} PID:${String(p.Id).padStart(6)}  CPU:${String(p.CPU_s ?? 0).padStart(7)}s  RAM:${p.RAM_MB} MB`);
    return { success: true, output: `Top ${n} Processes:\n${lines.join("\n")}`, data: list };
  },
};

// ─── system.kill_process ─────────────────────────────────────────────────────
export const systemKillProcess = {
  id: "system.kill_process",
  name: "Kill Process",
  description: "Terminate a running process by name or PID.",
  category: "system",
  permissionLevel: PERMISSION.DESTRUCTIVE,
  requiresOneOf: ["name", "pid"],
  confirmDescription: (params) => `Kill process: ${params.name ?? `PID ${params.pid}`}`,
  parameters: [
    { name: "name", type: "string", description: "Process name (e.g. 'notepad')", required: false },
    { name: "pid", type: "number", description: "Process ID", required: false },
  ],
  async detect() { return true; },
  async execute({ name, pid } = {}) {
    if (!name && !pid) return { success: false, output: null, error: "Provide name or pid." };
    const target = pid ? `Stop-Process -Id ${Number(pid)} -Force` : `Stop-Process -Name '${psSanitize(name)}' -Force`;
    const result = await runPowerShell(target);
    if (!result.success) return { success: false, output: null, error: result.stderr || "Failed to kill process." };
    const check = await runPowerShell(pid
      ? `(Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) -eq $null`
      : `(Get-Process -Name '${psSanitize(name)}' -ErrorAction SilentlyContinue) -eq $null`);
    const verified = check.success && /^true$/i.test(check.stdout.trim());
    return { success: verified, verified, output: verified ? `Process ${name ?? pid} terminated and was verified absent.` : null, error: verified ? undefined : "Process termination could not be verified." };
  },
};

// ─── system.volume.get ───────────────────────────────────────────────────────
export const systemVolumeGet = {
  id: "system.volume.get",
  name: "Get Volume",
  description: "Get the current master volume level and mute state (verified via Core Audio).",
  category: "system",
  permissionLevel: PERMISSION.READ,
  parameters: [],
  async detect() { return true; },
  async execute() {
    const result = await runPowerShell(`${AUDIO_INTEROP}
try {
  $v = [MeeraAudio]::GetVolume(); $m = [MeeraAudio]::GetMute()
  @{ ok = $true; volume = [int][math]::Round($v * 100); muted = $m } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`);
    const failLine = result.stdout.split("\n").find((l) => l.startsWith("AUDIO_INTEROP_FAIL"));
    if (failLine || !result.success) {
      return { success: false, output: null, error: `Core Audio unavailable: ${failLine ?? result.stderr ?? "unknown error"}` };
    }
    const d = parseVolumeJson(result.stdout);
    if (!d?.ok) return { success: false, output: null, error: d?.error ?? "Volume query failed." };
    return { success: true, output: `Current volume: ${d.volume}%${d.muted ? " (MUTED)" : ""}`, data: d };
  },
};

// ─── system.volume.set ───────────────────────────────────────────────────────
export const systemVolumeSet = {
  id: "system.volume.set",
  name: "Set Volume",
  description: "Set master volume to a percentage (0–100), then read it back to verify.",
  category: "system",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "level", type: "number", description: "Volume level 0–100", required: true, min: 0, max: 100 },
  ],
  async detect() { return true; },
  async execute({ level } = {}) {
    if (level === undefined || level === null) return { success: false, output: null, error: "level is required." };
    const vol = Math.max(0, Math.min(100, Math.round(Number(level))));
    const scalar = (vol / 100).toFixed(3);
    const script = `${AUDIO_INTEROP}
[MeeraAudio]::SetVolume(${scalar})
Start-Sleep -Milliseconds 250
$v = [MeeraAudio]::GetVolume(); $m = [MeeraAudio]::GetMute()
@{ requested = ${vol}; actual = [int][math]::Round($v * 100); muted = $m } | ConvertTo-Json -Compress`;
    const result = await runPowerShell(script);
    const failLine = result.stdout.split("\n").find((l) => l.startsWith("AUDIO_INTEROP_FAIL"));
    if (failLine || !result.success) {
      return { success: false, output: null, error: `Could not set volume: ${failLine ?? result.stderr ?? "unknown error"}` };
    }
    const d = parseVolumeJson(result.stdout);
    if (!d) return { success: false, output: null, error: "Volume verification failed." };
    const drift = Math.abs(d.actual - d.requested);
    if (drift <= 2) {
      return { success: true, output: `Volume set to ${d.actual}%${d.muted ? " (note: audio is currently muted)" : ""} — verified by read-back.` };
    }
    return { success: false, output: null, error: `Requested ${d.requested}% but actual level reads ${d.actual}%. Audio driver did not apply the change.` };
  },
};

// ─── system.volume.mute ──────────────────────────────────────────────────────
export const systemVolumeMute = {
  id: "system.volume.mute",
  name: "Mute / Unmute Audio",
  description: "Set mute state explicitly or toggle it. Verifies state after the change.",
  category: "system",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "mute", type: "boolean", description: "true to mute, false to unmute, omit to toggle", required: false },
  ],
  async detect() { return true; },
  async execute({ mute } = {}) {
    const toggle = mute === undefined;
    const targetExpr = toggle ? "-not $cur" : `$${Boolean(mute)}`;
    const script = `${AUDIO_INTEROP}
$cur = [MeeraAudio]::GetMute()
$target = ${targetExpr}
[MeeraAudio]::SetMute($target)
Start-Sleep -Milliseconds 250
$m = [MeeraAudio]::GetMute()
@{ target = [bool]$target; actual = $m; volume = [int][math]::Round([MeeraAudio]::GetVolume() * 100) } | ConvertTo-Json -Compress`;
    const result = await runPowerShell(script);
    const failLine = result.stdout.split("\n").find((l) => l.startsWith("AUDIO_INTEROP_FAIL"));
    if (failLine || !result.success) {
      return { success: false, output: null, error: `Mute control failed: ${failLine ?? result.stderr ?? "unknown error"}` };
    }
    const d = parseVolumeJson(result.stdout);
    if (!d) return { success: false, output: null, error: "Mute verification failed." };
    const verified = d.actual === d.target;
    return {
      success: verified,
      output: verified
        ? `Audio is now ${d.actual ? "muted" : "unmuted"} (volume stays at ${d.volume}%) — verified.`
        : `Requested ${d.target ? "mute" : "unmute"} but system reports ${d.actual ? "muted" : "unmuted"}.`,
      error: verified ? undefined : "Mute state did not change.",
    };
  },
};

// ─── system.clipboard.get ────────────────────────────────────────────────────
export const systemClipboardGet = {
  id: "system.clipboard.get",
  name: "Read Clipboard",
  description: "Read the current text content of the clipboard.",
  category: "system",
  permissionLevel: PERMISSION.READ,
  parameters: [],
  async detect() { return true; },
  async execute() {
    const result = await runPowerShell("Get-Clipboard");
    if (!result.success) return { success: false, output: null, error: result.stderr };
    const text = result.stdout;
    if (!text) return { success: true, output: "Clipboard is empty." };
    return { success: true, output: `Clipboard content:\n${text.slice(0, 2000)}${text.length > 2000 ? "\n[...truncated]" : ""}` };
  },
};

// ─── system.clipboard.set ────────────────────────────────────────────────────
export const systemClipboardSet = {
  id: "system.clipboard.set",
  name: "Write Clipboard",
  description: "Write text to the clipboard.",
  category: "system",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "text", type: "string", description: "Text to write to clipboard", required: true },
  ],
  async detect() { return true; },
  async execute({ text } = {}) {
    if (!text) return { success: false, output: null, error: "text is required." };
    const safe = psSanitize(text);
    const result = await runPowerShell(`Set-Clipboard -Value '${safe}'`);
    const check = result.success ? await runPowerShell("Get-Clipboard") : null;
    const verified = Boolean(check?.success && check.stdout === String(text));
    return { success: verified, verified, output: verified ? `Clipboard set (${text.length} chars) and verified.` : null, error: verified ? undefined : result.stderr || "Clipboard write could not be verified." };
  },
};

// ─── system.screenshot ───────────────────────────────────────────────────────
export const systemScreenshot = {
  id: "system.screenshot",
  name: "Take Screenshot",
  description: "Capture the screen, save it as a PNG on the user's real Desktop (OneDrive-aware), and verify the file was written.",
  category: "system",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "filename", type: "string", description: "Filename without extension (default: meera-screenshot)", required: false },
  ],
  async detect() { return true; },
  async execute({ filename = "meera-screenshot" } = {}) {
    const safeName = String(filename).replace(/[^a-zA-Z0-9_-]/g, "_");
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$desktop = [Environment]::GetFolderPath('Desktop')
$path = Join-Path $desktop '${safeName}.png'
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
if ((Test-Path $path) -and ((Get-Item $path -ErrorAction SilentlyContinue).Length -gt 0)) {
  @{ ok = $true; path = $path; bytes = (Get-Item $path).Length } | ConvertTo-Json -Compress
} else {
  @{ ok = $false } | ConvertTo-Json -Compress
}`;
    const result = await runPowerShellJson(script);
    if (!result.success) return { success: false, output: null, error: result.error };
    if (!result.data?.ok) return { success: false, output: null, error: "Screenshot capture failed — no file written." };
    return { success: true, output: `Screenshot saved to: ${result.data.path} (${Math.round(result.data.bytes / 1024)} KB) — verified on disk.`, data: result.data };
  },
};

// ─── system.power ────────────────────────────────────────────────────────────
export const systemPower = {
  id: "system.power",
  name: "Power / Session Control",
  description: "Sleep, lock, shutdown, or restart Windows.",
  category: "system",
  permissionLevel: PERMISSION.DESTRUCTIVE,
  confirmDescription: (params) => `${params.action} this Windows session/system`,
  parameters: [
    { name: "action", type: "string", description: "One of: sleep, lock, shutdown, restart", required: true, enum: ["sleep", "lock", "shutdown", "restart"] },
  ],
  async detect() { return true; },
  async execute({ action } = {}) {
    const act = String(action).toLowerCase().trim();
    let script;
    if (act === "lock") script = "rundll32.exe user32.dll,LockWorkStation";
    else if (act === "sleep") script = "Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)";
    else if (act === "shutdown") script = "Stop-Computer -Force";
    else if (act === "restart") script = "Restart-Computer -Force";
    else return { success: false, output: null, error: `Unknown action: ${action}. Use sleep, lock, shutdown, or restart.` };
    const result = await runPowerShell(script, { timeoutMs: 5_000 });
    return { success: result.success, verified: false, output: result.success ? `${act} command sent; completion cannot be verified without disrupting the session.` : null, error: result.success ? undefined : result.stderr || `${act} command failed.` };
  },
};

export const systemDisplayBrightness = {
  id: "system.display.brightness",
  name: "Display Brightness",
  description: "Get or set display brightness (laptop screens only).",
  category: "system",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "level", type: "number", description: "Brightness 0–100, omit to read current", required: false, min: 0, max: 100 },
  ],
  async detect() {
    const result = await runPowerShell("Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1 | ConvertTo-Json");
    return result.success && result.stdout.includes("CurrentBrightness");
  },
  async execute({ level } = {}) {
    if (level === undefined) {
      const result = await runPowerShellJson("Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightness | Select-Object CurrentBrightness | ConvertTo-Json");
      if (!result.success) return { success: false, output: null, error: result.error };
      const b = Array.isArray(result.data) ? result.data[0] : result.data;
      return { success: true, output: `Current brightness: ${b.CurrentBrightness}%` };
    }
    const l = Math.max(0, Math.min(100, Math.round(Number(level))));
    const result = await runPowerShell(`(Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${l}); Start-Sleep -Milliseconds 250; (Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightness).CurrentBrightness`);
    const actual = Number(result.stdout.trim().split(/\r?\n/).at(-1));
    const verified = result.success && Number.isFinite(actual) && Math.abs(actual - l) <= 2;
    return { success: verified, verified, output: verified ? `Brightness set to ${actual}%.` : null, error: verified ? undefined : result.stderr || `Brightness read-back was ${result.stdout || "unavailable"}.` };
  },
};

// ─── system.gpu ──────────────────────────────────────────────────────────────
export const systemGpu = {
  id: "system.gpu",
  name: "GPU Information",
  description: "Get installed graphics cards: name, driver version, VRAM (approximate), and status.",
  category: "system",
  permissionLevel: PERMISSION.READ,
  parameters: [],
  async detect() { return true; },
  async execute() {
    const result = await runPowerShellJson(`
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion,
  @{N='VRAM_MB';E={[math]::Round($_.AdapterRAM / 1MB)}}, Status, VideoModeDescription |
  ConvertTo-Json`);
    if (!result.success) return { success: false, output: null, error: result.error };
    const list = Array.isArray(result.data) ? result.data : [result.data];
    const lines = list.map((g) =>
      `  • ${g.Name}\n    Driver: ${g.DriverVersion} | Status: ${g.Status}${g.VRAM_MB ? ` | VRAM: ~${(g.VRAM_MB / 1024).toFixed(1)} GB` : ""}${g.VideoModeDescription ? `\n    Mode: ${g.VideoModeDescription}` : ""}`
    );
    return { success: true, output: `Graphics (${list.length}):\n${lines.join("\n")}`, data: list };
  },
};

// ─── system.installed_apps ───────────────────────────────────────────────────
export const systemInstalledApps = {
  id: "system.installed_apps",
  name: "Installed Applications",
  description: "List installed programs (from registry uninstall keys). Use to discover app names before launching.",
  category: "system",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "filter", type: "string", description: "Filter by name substring (case-insensitive)", required: false },
    { name: "limit", type: "number", description: "Max entries to show (default: 40)", required: false },
  ],
  async detect() { return true; },
  async execute({ filter = "", limit = 40 } = {}) {
    const safeFilter = psSanitize(String(filter));
    const n = Math.max(1, Math.min(200, Math.round(Number(limit))));
    const script = `
$keys = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$apps = Get-ItemProperty $keys -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName } |
  ${safeFilter ? `Where-Object { $_.DisplayName -like '*${safeFilter}*' } |` : ""}
  Sort-Object DisplayName -Unique
$total = ($apps | Measure-Object).Count
@{ total = $total; apps = @($apps | Select-Object -First ${n} DisplayName, DisplayVersion, Publisher) } | ConvertTo-Json -Depth 3 -Compress`;
    const result = await runPowerShellJson(script);
    if (!result.success) return { success: false, output: null, error: result.error };
    const apps = result.data.apps ?? [];
    const total = result.data.total ?? apps.length;
    const lines = apps.map((a) => `  • ${a.DisplayName}${a.DisplayVersion ? ` v${a.DisplayVersion}` : ""}${a.Publisher ? ` (${a.Publisher})` : ""}`);
    return {
      success: true,
      output: `${total} installed program(s)${safeFilter ? ` matching '${filter}'` : ""} — showing ${apps.length}:\n${lines.join("\n") || "  (none)"}`,
      data: result.data,
    };
  },
};

export const allSystemTools = [
  systemInfo, systemProcesses, systemKillProcess,
  systemVolumeGet, systemVolumeSet, systemVolumeMute,
  systemClipboardGet, systemClipboardSet,
  systemScreenshot, systemPower, systemDisplayBrightness,
  systemGpu, systemInstalledApps,
];
