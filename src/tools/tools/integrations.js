/**
 * Optional integrations. A tool is available only when its local backend is
 * installed; unavailable integrations are reported instead of being guessed.
 */

import { existsSync } from "node:fs";
import { PERMISSION } from "../permissions.js";
import { runPowerShell, runProcess } from "../executor.js";
import { normalizeWindowsPath } from "../paths.js";

const quotePs = (value) => String(value).replace(/'/g, "''");

export const networkDnsResolve = {
  id: "network.dns.resolve",
  name: "Resolve DNS",
  description: "Resolve a hostname using the local Windows DNS configuration.",
  category: "network",
  permissionLevel: PERMISSION.READ,
  parameters: [{ name: "host", type: "string", description: "Hostname to resolve", required: true }],
  async detect() { return true; },
  async execute({ host } = {}) {
    if (!host) return { success: false, output: null, error: "host is required." };
    const result = await runPowerShell(`Resolve-DnsName -Name '${quotePs(host)}' -ErrorAction Stop | Where-Object Type -in 'A','AAAA' | Select-Object Name, Type, IPAddress | ConvertTo-Json -Compress`);
    if (!result.success) return { success: false, output: null, error: result.stderr || `DNS resolution failed for ${host}.` };
    return { success: true, output: result.stdout || `No address records found for ${host}.` };
  },
};

export const systemServices = {
  id: "system.services",
  name: "List Windows Services",
  description: "List Windows services, optionally filtered by name or display name.",
  category: "system",
  permissionLevel: PERMISSION.READ,
  parameters: [{ name: "filter", type: "string", description: "Optional service-name filter", required: false }],
  async detect() { return true; },
  async execute({ filter = "" } = {}) {
    const condition = filter ? ` | Where-Object { $_.Name -like '*${quotePs(filter)}*' -or $_.DisplayName -like '*${quotePs(filter)}*' }` : "";
    const result = await runPowerShell(`Get-Service${condition} | Select-Object -First 50 Name, DisplayName, Status, StartType | ConvertTo-Json -Compress`);
    if (!result.success) return { success: false, output: null, error: result.stderr || "Service enumeration failed." };
    return { success: true, output: result.stdout || "No matching services found." };
  },
};

export const filesArchive = {
  id: "files.archive",
  name: "Create ZIP Archive",
  description: "Create a ZIP archive from a file or directory.",
  category: "files",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "source", type: "string", description: "File or directory to archive", required: true },
    { name: "destination", type: "string", description: "Destination .zip path", required: true },
  ],
  async detect() { return true; },
  async execute({ source, destination } = {}) {
    if (!source || !destination) return { success: false, output: null, error: "source and destination are required." };
    const input = normalizeWindowsPath(source);
    const output = normalizeWindowsPath(destination);
    if (!existsSync(input)) return { success: false, output: null, error: `Source not found: ${input}` };
    const result = await runPowerShell(`Compress-Archive -LiteralPath '${quotePs(input)}' -DestinationPath '${quotePs(output)}' -Force -ErrorAction Stop; if (Test-Path '${quotePs(output)}') { Write-Output 'ARCHIVE_VERIFIED' }`);
    if (!result.success || !result.stdout.includes("ARCHIVE_VERIFIED")) return { success: false, output: null, error: result.stderr || "Archive could not be verified." };
    return { success: true, output: `Created and verified archive: ${output}` };
  },
};

async function pythonModuleAvailable(moduleName) {
  const result = await runProcess("python", ["-c", `import ${moduleName}`], { timeoutMs: 5_000 });
  return result.success;
}

export const uiPyAutoGUI = {
  id: "ui.pyautogui",
  name: "PyAutoGUI Interaction",
  description: "Use locally installed PyAutoGUI for mouse, keyboard, and hotkey actions as a fallback UI backend.",
  category: "ui",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "action", type: "string", description: "type, click, or hotkey", required: true },
    { name: "value", type: "string", description: "Text, key combination, or x,y coordinates", required: true },
  ],
  async detect() { return pythonModuleAvailable("pyautogui"); },
  async execute({ action, value } = {}) {
    if (!action || !value) return { success: false, output: null, error: "action and value are required." };
    const payload = JSON.stringify({ action, value });
    const code = `import json, pyautogui
p=json.loads(${JSON.stringify(payload)})
a=p["action"].lower()
if a=="type": pyautogui.write(p["value"])
elif a=="hotkey": pyautogui.hotkey(*[x.strip() for x in p["value"].split("+")])
elif a=="click":
 x,y=[int(v.strip()) for v in p["value"].split(",",1)]; pyautogui.click(x,y)
else: raise ValueError("unsupported action")
print("PYAUTOGUI_DONE")`;
    const result = await runProcess("python", ["-c", code], { timeoutMs: 15_000 });
    return result.success && result.stdout.includes("PYAUTOGUI_DONE")
      ? { success: true, output: `PyAutoGUI ${action} completed.` }
      : { success: false, output: null, error: result.stderr || "PyAutoGUI action failed." };
  },
};

export const uiPyWinAuto = {
  id: "ui.pywinauto",
  name: "pywinauto Native UI",
  description: "Use locally installed pywinauto for native Windows application window discovery.",
  category: "ui",
  permissionLevel: PERMISSION.READ,
  parameters: [{ name: "title", type: "string", description: "Window title substring", required: true }],
  async detect() { return pythonModuleAvailable("pywinauto"); },
  async execute({ title } = {}) {
    if (!title) return { success: false, output: null, error: "title is required." };
    const payload = JSON.stringify(title);
    const code = `from pywinauto import Desktop
needle=${JSON.stringify(payload)}
needle=__import__("json").loads(needle).lower()
matches=[w.window_text() for w in Desktop(backend="uia").windows() if needle in w.window_text().lower()]
print("\\n".join(matches[:20]))`;
    const result = await runProcess("python", ["-c", code], { timeoutMs: 15_000 });
    if (!result.success) return { success: false, output: null, error: result.stderr || "pywinauto window query failed." };
    return { success: true, output: result.stdout || `No windows matched '${title}'.` };
  },
};

export const browserPlaywright = {
  id: "browser.playwright",
  name: "Playwright Browser Automation",
  description: "Navigate a URL with locally installed Playwright and return the verified page title.",
  category: "browser",
  permissionLevel: PERMISSION.WRITE,
  parameters: [{ name: "url", type: "string", description: "URL to navigate", required: true }],
  async detect() {
    const result = await runProcess("node", ["-e", "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))"], { timeoutMs: 8_000 });
    return result.success;
  },
  async execute({ url } = {}) {
    if (!url) return { success: false, output: null, error: "url is required." };
    const finalUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const code = `import('playwright').then(async({chromium})=>{const b=await chromium.launch({headless:true});const p=await b.newPage();await p.goto(${JSON.stringify(finalUrl)},{waitUntil:'domcontentloaded',timeout:15000});console.log(JSON.stringify({title:await p.title(),url:p.url()}));await b.close()}).catch(e=>{console.error(e.message);process.exit(1)})`;
    const result = await runProcess("node", ["-e", code], { timeoutMs: 25_000 });
    if (!result.success) return { success: false, output: null, error: result.stderr || "Playwright navigation failed." };
    return { success: true, output: `Verified page: ${result.stdout}` };
  },
};

export const allIntegrationTools = [
  networkDnsResolve, systemServices, filesArchive,
  uiPyAutoGUI, uiPyWinAuto, browserPlaywright,
];
