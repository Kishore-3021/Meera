/**
 * Network tools: Wi-Fi status/on/off, network interface info.
 */

import { runPowerShell, runPowerShellJson } from "../executor.js";
import { PERMISSION } from "../permissions.js";

/** Read the live Wi-Fi interface state for verification. */
async function readWifiState() {
  const result = await runPowerShell("netsh wlan show interfaces");
  if (!result.success) return { present: false, connected: false, detail: "netsh failed" };
  if (result.stdout.includes("There is no wireless interface")) {
    return { present: false, connected: false, detail: "No wireless interface on this system." };
  }
  const lines = result.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const extract = (key) => {
    const line = lines.find((l) => l.toLowerCase().startsWith(key.toLowerCase()));
    return line ? line.split(":").slice(1).join(":").trim() : null;
  };
  const state = extract("State") ?? "unknown";
  return { present: true, connected: state.toLowerCase().includes("connected"), state, ssid: extract("SSID"), signal: extract("Signal"), detail: state };
}

// ─── network.wifi.status ─────────────────────────────────────────────────────
export const networkWifiStatus = {
  id: "network.wifi.status",
  name: "Wi-Fi Status",
  description: "Check current Wi-Fi connection status, SSID, and signal strength.",
  category: "network",
  permissionLevel: PERMISSION.READ,
  parameters: [],
  async detect() { return true; },
  async execute() {
    const s = await readWifiState();
    if (!s.present) return { success: true, output: `Wi-Fi: ${s.detail}` };
    if (s.connected) {
      return { success: true, output: `Wi-Fi: Connected\nNetwork: ${s.ssid}\nSignal: ${s.signal}`, data: s };
    }
    return { success: true, output: `Wi-Fi: ${s.state} (not connected)`, data: s };
  },
};

// ─── network.wifi.on ─────────────────────────────────────────────────────────
export const networkWifiOn = {
  id: "network.wifi.on",
  name: "Enable Wi-Fi",
  description: "Enable the Wi-Fi network adapter, then verify the adapter radio state.",
  category: "network",
  permissionLevel: PERMISSION.WRITE,
  parameters: [],
  async detect() { return true; },
  async execute() {
    const result = await runPowerShell(`
$adapter = Get-NetAdapter | Where-Object { $_.Name -match 'Wi-?Fi|Wireless|WLAN|802' } | Select-Object -First 1
if ($adapter) {
  Enable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop
  Write-Output "ENABLED:$($adapter.Name)"
} else { Write-Output "NO_ADAPTER" }`);
    if (result.stdout.includes("NO_ADAPTER")) {
      return { success: false, output: null, error: "No Wi-Fi adapter found." };
    }
    // Verify actual radio/interface state regardless of exit code
    await new Promise((r) => setTimeout(r, 1500));
    const state = await readWifiState();
    if (!state.present) return { success: false, output: null, error: "No Wi-Fi adapter detected after enable attempt." };
    const adminUp = /enabled|connected|disconnected/i.test(state.state) && !/disabled/i.test(state.state);
    if (adminUp || state.connected) {
      return { success: true, output: `Wi-Fi enabled. Interface state: ${state.state}${state.connected ? `, connected to ${state.ssid}` : ""} — verified.` };
    }
    return { success: false, output: null, error: `Enable command sent but interface reports '${state.state}'. May require administrator rights.` };
  },
};

// ─── network.wifi.off ────────────────────────────────────────────────────────
export const networkWifiOff = {
  id: "network.wifi.off",
  name: "Disable Wi-Fi",
  description: "Disable the Wi-Fi network adapter, then verify the adapter is actually down.",
  category: "network",
  permissionLevel: PERMISSION.WRITE,
  parameters: [],
  async detect() { return true; },
  async execute() {
    const before = await readWifiState();
    const result = await runPowerShell(`
$adapter = Get-NetAdapter | Where-Object { $_.Name -match 'Wi-?Fi|Wireless|WLAN|802' } | Select-Object -First 1
if ($adapter) {
  Disable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop
  Write-Output "DISABLED:$($adapter.Name)"
} else { Write-Output "NO_ADAPTER" }`);
    if (result.stdout.includes("NO_ADAPTER")) {
      return { success: false, output: null, error: "No Wi-Fi adapter found." };
    }
    await new Promise((r) => setTimeout(r, 1500));
    const state = await readWifiState();
    if (/disabled/i.test(state.state) || !state.present) {
      return { success: true, output: "Wi-Fi disabled — verified via interface state." };
    }
    return {
      success: false,
      output: null,
      error: `Disable command sent but interface still reports '${state.state}'. This usually requires an elevated (administrator) terminal.`,
    };
  },
};

// ─── network.info ────────────────────────────────────────────────────────────
export const networkInfo = {
  id: "network.info",
  name: "Network Information",
  description: "Get IP addresses, active adapters, DNS, and gateway.",
  category: "network",
  permissionLevel: PERMISSION.READ,
  parameters: [],
  async detect() { return true; },
  async execute() {
    const result = await runPowerShellJson(`
Get-NetIPAddress | Where-Object { $_.AddressState -eq 'Preferred' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object InterfaceAlias, IPAddress, AddressFamily |
  ConvertTo-Json`);
    if (!result.success) return { success: false, output: null, error: result.error };
    const list = Array.isArray(result.data) ? result.data : [result.data];
    const filtered = list.filter((a) => !a.IPAddress.startsWith("169.") && !a.IPAddress.includes(":fe80"));
    const lines = filtered.map((a) => `  ${a.InterfaceAlias.padEnd(20)} ${a.AddressFamily === 2 ? "IPv4" : "IPv6"}: ${a.IPAddress}`);
    return { success: true, output: `Network Adapters:\n${lines.join("\n")}` };
  },
};

// ─── network.bluetooth.devices ───────────────────────────────────────────────
export const networkBluetoothDevices = {
  id: "network.bluetooth.devices",
  name: "Bluetooth Devices",
  description: "List Bluetooth radios and paired/connected Bluetooth devices with their status.",
  category: "network",
  permissionLevel: PERMISSION.READ,
  parameters: [],
  async detect() {
    const r = await runPowerShell("Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Select-Object -First 1 | Out-String");
    return r.success && r.stdout.trim().length > 0;
  },
  async execute() {
    const result = await runPowerShell(`
$out = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue |
  Select-Object FriendlyName, Status |
  ConvertTo-Json
if ([string]::IsNullOrWhiteSpace($out)) { Write-Output '[]' } else { Write-Output $out }`);
    if (!result.success) return { success: false, output: null, error: "Bluetooth enumeration failed." };
    let list;
    try {
      list = JSON.parse(result.stdout);
      if (!Array.isArray(list)) list = [list];
    } catch {
      return { success: true, output: "No Bluetooth devices found on this system." };
    }
    if (!list.length) return { success: true, output: "No Bluetooth devices found on this system." };
    const lines = list.map((d) => `  • ${d.FriendlyName ?? "(unnamed)"} — ${d.Status}`);
    const okCount = list.filter((d) => d.Status === "OK").length;
    return { success: true, output: `Bluetooth devices (${list.length}, ${okCount} OK):\n${lines.join("\n")}`, data: list };
  },
};

export const allNetworkTools = [networkWifiStatus, networkWifiOn, networkWifiOff, networkInfo, networkBluetoothDevices];
