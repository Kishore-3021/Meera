/**
 * Additional non-vision/non-voice capabilities.
 * These tools reuse the existing controlled executors and permission policy.
 */

import { existsSync } from "node:fs";
import { basename } from "node:path";
import { stat } from "node:fs/promises";
import { PERMISSION } from "../permissions.js";
import { runPowerShell, runPowerShellJson, runProcess } from "../executor.js";
import { normalizeWindowsPath } from "../paths.js";

const safePs = (value) => String(value).replace(/'/g, "''");

export const systemBattery = {
  id: "system.battery",
  name: "Battery Status",
  description: "Read battery charge, status, and estimated remaining runtime.",
  category: "system",
  permissionLevel: PERMISSION.READ,
  parameters: [],
  async detect() {
    const result = await runPowerShell("Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 | ConvertTo-Json -Compress");
    return result.success && result.stdout.trim().length > 0;
  },
  async execute() {
    const result = await runPowerShellJson("Get-CimInstance Win32_Battery | Select-Object Name, EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime | ConvertTo-Json -Compress");
    if (!result.success || !result.data) return { success: false, output: null, error: "Battery information is unavailable." };
    const battery = Array.isArray(result.data) ? result.data[0] : result.data;
    return {
      success: true,
      output: `Battery: ${battery.EstimatedChargeRemaining ?? "unknown"}% charge, status ${battery.BatteryStatus ?? "unknown"}, estimated runtime ${battery.EstimatedRunTime ?? "unknown"} minutes.`,
      data: battery,
    };
  },
};

export const systemEnvironment = {
  id: "system.environment",
  name: "Environment Information",
  description: "Read safe Windows environment details such as user, profile, computer name, and OS variables.",
  category: "system",
  permissionLevel: PERMISSION.READ,
  parameters: [],
  async detect() { return true; },
  async execute() {
    const result = await runPowerShellJson("$env = Get-ChildItem Env: | Where-Object { $_.Name -in @('USERNAME','USERPROFILE','COMPUTERNAME','OS','PROCESSOR_ARCHITECTURE','OneDrive') }; $env | Select-Object Name, Value | ConvertTo-Json -Compress");
    if (!result.success) return { success: false, output: null, error: result.error };
    const values = Array.isArray(result.data) ? result.data : [result.data];
    return { success: true, output: values.map((entry) => `${entry.Name}: ${entry.Value}`).join("\n"), data: values };
  },
};

export const filesSearch = {
  id: "files.search",
  name: "Search Files",
  description: "Search a directory tree for files or folders by name, with a bounded result count.",
  category: "files",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "query", type: "string", description: "Name or wildcard pattern to search for", required: true },
    { name: "path", type: "string", description: "Directory to search", required: false },
    { name: "limit", type: "number", description: "Maximum results (1–100)", required: false, min: 1, max: 100 },
  ],
  async detect() { return true; },
  async execute({ query, path = ".", limit = 25 } = {}) {
    if (!query) return { success: false, output: null, error: "query is required." };
    const root = normalizeWindowsPath(path);
    const pattern = safePs(String(query));
    const result = await runPowerShellJson(`Get-ChildItem -LiteralPath '${safePs(root)}' -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*${pattern}*' } | Select-Object -First ${Math.round(limit)} FullName, Name, PSIsContainer | ConvertTo-Json -Compress`, { timeoutMs: 20_000 });
    if (!result.success) return { success: false, output: null, error: result.error };
    const matches = result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
    return { success: true, output: matches.length ? matches.map((entry) => `${entry.PSIsContainer ? "[DIR]" : "[FILE]"} ${entry.FullName}`).join("\n") : `No matches for '${query}'.`, data: matches };
  },
};

export const filesInfo = {
  id: "files.info",
  name: "File Metadata",
  description: "Read file or directory metadata including size, timestamps, and type.",
  category: "files",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "path", type: "string", description: "File or directory path", required: true },
  ],
  async detect() { return true; },
  async execute({ path } = {}) {
    if (!path) return { success: false, output: null, error: "path is required." };
    const full = normalizeWindowsPath(path);
    if (!existsSync(full)) return { success: false, output: null, error: `Path not found: ${full}` };
    try {
      const info = await stat(full);
      return {
        success: true,
        output: `${info.isDirectory() ? "Directory" : "File"}: ${basename(full)}\nPath: ${full}\nSize: ${info.size} bytes\nModified: ${info.mtime.toISOString()}`,
        data: { path: full, directory: info.isDirectory(), size: info.size, modified: info.mtime.toISOString() },
      };
    } catch (error) {
      return { success: false, output: null, error: `Metadata failed: ${error.message}` };
    }
  },
};

export const networkPing = {
  id: "network.ping",
  name: "Ping Host",
  description: "Check whether a host responds to a bounded network ping.",
  category: "network",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "host", type: "string", description: "Hostname or IP address", required: true },
  ],
  async detect() { return true; },
  async execute({ host } = {}) {
    if (!host) return { success: false, output: null, error: "host is required." };
    const result = await runPowerShell(`Test-Connection -ComputerName '${safePs(host)}' -Count 1 -Quiet -ErrorAction SilentlyContinue`, { timeoutMs: 8_000 });
    const reachable = result.success && /^true$/i.test(result.stdout.trim());
    return { success: true, output: `${host}: ${reachable ? "reachable" : "not reachable"}`, data: { host, reachable } };
  },
};

export const mediaSpotify = {
  id: "media.spotify",
  name: "Open Spotify Search",
  description: "Open a Spotify track, album, artist, or search query and verify the Spotify process.",
  category: "media",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "query", type: "string", description: "Track, artist, album, or Spotify URL", required: true },
  ],
  async detect() { return true; },
  async execute({ query } = {}) {
    if (!query) return { success: false, output: null, error: "query is required." };
    const raw = String(query).trim();
    const uri = /^spotify:/i.test(raw) || /^https?:\/\/open\.spotify\.com/i.test(raw)
      ? raw
      : `https://open.spotify.com/search/${encodeURIComponent(raw)}`;
    const result = await runPowerShell(`Start-Process '${safePs(uri)}'; Start-Sleep -Milliseconds 1500; if (Get-Process -Name Spotify -ErrorAction SilentlyContinue) { Write-Output 'SPOTIFY_RUNNING' } else { Write-Output 'SPOTIFY_NOT_VERIFIED' }`);
    if (!result.success || !result.stdout.includes("SPOTIFY_RUNNING")) {
      return { success: false, output: null, error: "Spotify could not be verified after opening the request." };
    }
    return { success: true, output: `Opened Spotify search for '${raw}' and verified Spotify is running.` };
  },
};

export const documentsPdfText = {
  id: "documents.pdf_text",
  name: "Extract PDF Text",
  description: "Extract text from a PDF using the locally installed pdftotext utility when available.",
  category: "documents",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "path", type: "string", description: "PDF file path", required: true },
    { name: "maxBytes", type: "number", description: "Maximum returned text bytes (1–50000)", required: false, min: 1, max: 50000 },
  ],
  async detect() {
    const result = await runProcess("where", ["pdftotext"], { timeoutMs: 5_000 });
    return result.success;
  },
  async execute({ path, maxBytes = 12000 } = {}) {
    if (!path) return { success: false, output: null, error: "path is required." };
    const full = normalizeWindowsPath(path);
    if (!existsSync(full)) return { success: false, output: null, error: `PDF not found: ${full}` };
    const result = await runProcess("pdftotext", ["-layout", full, "-"], { timeoutMs: 20_000 });
    if (!result.success) return { success: false, output: null, error: result.stderr || "PDF text extraction failed." };
    return { success: true, output: result.stdout.slice(0, Math.round(maxBytes)), data: { path: full, truncated: result.stdout.length > maxBytes } };
  },
};

export const allExtendedTools = [
  systemBattery, systemEnvironment, filesSearch, filesInfo,
  networkPing, mediaSpotify, documentsPdfText,
];
