/**
 * UI interaction tools: keyboard typing, hotkeys, mouse clicks.
 * All implemented via PowerShell System.Windows.Forms / WinAPI — no extra npm packages.
 */

import { runPowerShell, psSanitize } from "../executor.js";
import { PERMISSION } from "../permissions.js";

// ─── ui.type ─────────────────────────────────────────────────────────────────
export const uiType = {
  id: "ui.type",
  name: "Type Text",
  description: "Type text using keyboard simulation into the active window. Optionally focus an app first.",
  category: "ui",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "text", type: "string", description: "Text to type", required: true },
    { name: "delay_ms", type: "number", description: "Delay before typing in ms (default: 300)", required: false },
  ],
  async detect() { return true; },
  async execute({ text, delay_ms = 300 } = {}) {
    if (!text) return { success: false, output: null, error: "text is required." };
    // Escape special SendKeys characters: + ^ % ~ ( ) [ ] { }
    const escaped = String(text)
      .replace(/[+^%~()[\]{}]/g, (c) => `{${c}}`);
    const safe = psSanitize(escaped);
    const delay = Math.max(0, Math.min(5000, Number(delay_ms)));
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds ${delay}
[System.Windows.Forms.SendKeys]::SendWait('${safe}')
Write-Output "TYPED"`;
    const result = await runPowerShell(script);
    if (result.stdout.includes("TYPED")) return { success: true, output: `Typed "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"` };
    return { success: false, output: null, error: result.stderr || "Type failed." };
  },
};

// ─── ui.hotkey ───────────────────────────────────────────────────────────────
export const uiHotkey = {
  id: "ui.hotkey",
  name: "Send Hotkey",
  description: "Send a keyboard hotkey combination (e.g. 'ctrl+c', 'alt+f4', 'win+d', 'ctrl+shift+esc').",
  category: "ui",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "keys", type: "string", description: "Key combination like 'ctrl+c', 'alt+tab', 'win+d'", required: true },
    { name: "delay_ms", type: "number", description: "Delay before sending in ms (default: 100)", required: false },
  ],
  async detect() { return true; },
  async execute({ keys, delay_ms = 100 } = {}) {
    if (!keys) return { success: false, output: null, error: "keys is required." };
    // Convert human-readable keys to SendKeys format
    const parts = String(keys).toLowerCase().split(/\+/).map((k) => k.trim());
    let sequence = "";
    let modifiers = "";
    for (const part of parts) {
      switch (part) {
        case "ctrl": case "control": modifiers += "^"; break;
        case "alt": modifiers += "%"; break;
        case "shift": modifiers += "+"; break;
        case "win": case "windows":
          // Win key requires special handling
          sequence = "WIN_KEY";
          break;
        case "enter": sequence += "{ENTER}"; break;
        case "tab": sequence += "{TAB}"; break;
        case "esc": case "escape": sequence += "{ESC}"; break;
        case "space": sequence += " "; break;
        case "backspace": sequence += "{BACKSPACE}"; break;
        case "delete": sequence += "{DELETE}"; break;
        case "home": sequence += "{HOME}"; break;
        case "end": sequence += "{END}"; break;
        case "pgup": sequence += "{PGUP}"; break;
        case "pgdn": sequence += "{PGDN}"; break;
        case "f4": sequence += "{F4}"; break;
        case "f5": sequence += "{F5}"; break;
        case "f11": sequence += "{F11}"; break;
        case "f12": sequence += "{F12}"; break;
        default:
          if (/^f\d+$/.test(part)) sequence += `{${part.toUpperCase()}}`;
          else sequence += part;
      }
    }
    const delay = Math.max(0, Math.min(5000, Number(delay_ms)));

    let script;
    if (sequence === "WIN_KEY") {
      // Win key via WScript
      script = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds ${delay}
$wsh = New-Object -ComObject WScript.Shell
$wsh.SendKeys('^{ESC}')
Write-Output "SENT"`;
    } else {
      const sendKeys = modifiers ? `${modifiers}(${sequence})` : sequence;
      const safe = psSanitize(sendKeys);
      script = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds ${delay}
[System.Windows.Forms.SendKeys]::SendWait('${safe}')
Write-Output "SENT"`;
    }
    const result = await runPowerShell(script);
    if (result.stdout.includes("SENT")) return { success: true, output: `Sent hotkey: ${keys}` };
    return { success: false, output: null, error: result.stderr || "Hotkey failed." };
  },
};

// ─── ui.mouse_click ──────────────────────────────────────────────────────────
export const uiMouseClick = {
  id: "ui.mouse_click",
  name: "Mouse Click",
  description: "Move mouse to screen coordinates and click. Use with caution.",
  category: "ui",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "x", type: "number", description: "X coordinate (pixels from left)", required: true, min: 0 },
    { name: "y", type: "number", description: "Y coordinate (pixels from top)", required: true, min: 0 },
    { name: "button", type: "string", description: "left (default), right, or double", required: false, enum: ["left", "right", "double"] },
  ],
  async detect() { return true; },
  async execute({ x, y, button = "left" } = {}) {
    if (x === undefined || y === undefined) return { success: false, output: null, error: "x and y are required." };
    const px = Math.round(Number(x));
    const py = Math.round(Number(y));
    const btn = String(button).toLowerCase();
    const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  public const uint LBDOWN = 0x0002, LBUP = 0x0004, RBDOWN = 0x0008, RBUP = 0x0010;
  public static void LeftClick(int x, int y) { SetCursorPos(x,y); System.Threading.Thread.Sleep(50); mouse_event(LBDOWN,0,0,0,IntPtr.Zero); mouse_event(LBUP,0,0,0,IntPtr.Zero); }
  public static void RightClick(int x, int y) { SetCursorPos(x,y); System.Threading.Thread.Sleep(50); mouse_event(RBDOWN,0,0,0,IntPtr.Zero); mouse_event(RBUP,0,0,0,IntPtr.Zero); }
  public static void DoubleClick(int x, int y) { LeftClick(x,y); System.Threading.Thread.Sleep(80); LeftClick(x,y); }
}
'@ -ErrorAction SilentlyContinue 2>&1 | Out-Null
${btn === "right" ? `[Mouse]::RightClick(${px}, ${py})` :
  btn === "double" ? `[Mouse]::DoubleClick(${px}, ${py})` :
  `[Mouse]::LeftClick(${px}, ${py})`}
Write-Output "CLICKED"`;
    const result = await runPowerShell(script);
    if (result.stdout.includes("CLICKED")) return { success: true, output: `${btn} clicked at (${px}, ${py}).` };
    return { success: false, output: null, error: result.stderr || "Mouse click failed." };
  },
};

export const allUITools = [uiType, uiHotkey, uiMouseClick];
