/**
 * Browser tools: open URLs and search queries in the system default browser.
 */

import { runPowerShell, psSanitize } from "../executor.js";
import { PERMISSION } from "../permissions.js";

const SEARCH_ENGINES = {
  google: "https://www.google.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  bing: "https://www.bing.com/search?q=",
  youtube: "https://www.youtube.com/results?search_query=",
};

const BROWSER_PROCESS_NAMES = ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc", "comet"];

async function openAndVerify(url) {
  const safe = psSanitize(url);
  const processNames = BROWSER_PROCESS_NAMES.join(",");
  const result = await runPowerShell(`try {
    Start-Process '${safe}' | Out-Null
    $browser = $null
    for ($attempt = 0; $attempt -lt 16 -and -not $browser; $attempt++) {
      Start-Sleep -Milliseconds 500
      $browser = Get-Process ${processNames} -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
    }
    if ($browser) { Write-Output "BROWSER_RUNNING:$($browser.ProcessName):$($browser.MainWindowTitle)" }
    else { Write-Output "BROWSER_NOT_RUNNING" }
  } catch { Write-Output "BROWSER_ERROR:$($_.Exception.Message)"; exit 1 }`, { timeoutMs: 12_000 });
  if (!result.success || !result.stdout.includes("BROWSER_RUNNING")) {
    return { success: false, error: result.stderr || result.stdout.replace(/^BROWSER_ERROR:/, "") || "The browser process could not be verified after launch." };
  }
  return { success: true, browser: result.stdout.trim() };
}

// ─── browser.open_url ────────────────────────────────────────────────────────
export const browserOpenUrl = {
  id: "browser.open_url",
  name: "Open URL in Browser",
  description: "Open a URL in the system default browser.",
  category: "browser",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "url", type: "string", description: "Full URL including https://", required: true },
  ],
  async detect() { return true; },
  async execute({ url } = {}) {
    if (!url) return { success: false, output: null, error: "url is required." };
    let finalUrl = String(url).trim();
    if (!/^https?:\/\//i.test(finalUrl)) finalUrl = `https://${finalUrl}`;
    const result = await openAndVerify(finalUrl);
    return {
      success: result.success,
      output: result.success ? `Opened ${finalUrl} in the default browser and verified a browser window is running.` : null,
      error: result.success ? undefined : result.error,
    };
  },
};

// ─── browser.search ──────────────────────────────────────────────────────────
export const browserSearch = {
  id: "browser.search",
  name: "Web Search in Browser",
  description: "Open a search query in the default browser using Google (or specify engine).",
  category: "browser",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "query", type: "string", description: "Search query", required: true },
    { name: "engine", type: "string", description: "Search engine: google (default), bing, duckduckgo, youtube", required: false, enum: ["google", "bing", "duckduckgo", "youtube"] },
  ],
  async detect() { return true; },
  async execute({ query, engine = "google" } = {}) {
    if (!query) return { success: false, output: null, error: "query is required." };
    const base = SEARCH_ENGINES[String(engine).toLowerCase()] ?? SEARCH_ENGINES.google;
    const url = base + encodeURIComponent(String(query));
    const result = await openAndVerify(url);
    return {
      success: result.success,
      output: result.success ? `Opened browser search for "${query}" using ${engine} and verified a browser window is running.` : null,
      error: result.success ? undefined : result.error,
    };
  },
};

export const allBrowserTools = [browserOpenUrl, browserSearch];
