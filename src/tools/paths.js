import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** Resolve Windows user folders without assuming Desktop is outside OneDrive. */
export function realDesktop() {
  const candidates = [
    process.env.OneDrive ? resolve(process.env.OneDrive, "Desktop") : null,
    resolve(homedir(), "OneDrive", "Desktop"),
    resolve(homedir(), "Desktop"),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) ?? candidates.at(-1);
}

export function normalizeWindowsPath(value) {
  let path = String(value).trim();
  // Models sometimes copy a placeholder user profile from an example path.
  path = path.replace(/^([a-z]:[\\/])users[\\/]your(?:username|user)[\\/]/i, `${process.env.SystemDrive ?? "C:"}\\Users\\${homedir().split(/[\\/]/).at(-1)}\\`);
  path = path.replace(/^[a-z]:[\\/]users[\\/][^\\/]+[\\/]desktop(?=[\\/]|$)/i, realDesktop());
  const homeDesktop = resolve(homedir(), "Desktop");
  if (path.toLowerCase().startsWith(`${homeDesktop.toLowerCase()}\\`) || path.toLowerCase() === homeDesktop.toLowerCase()) {
    path = `${realDesktop()}${path.slice(homeDesktop.length)}`;
  }
  path = path.replace(/^%DESKTOP%(?=[\\/]|$)/i, realDesktop());
  path = path.replace(/^~[\\/]desktop(?=[\\/]|$)/i, realDesktop());
  path = path.replace(/^desktop(?=[\\/]|$)/i, realDesktop());
  path = path.replace(/^%USERPROFILE%/i, homedir());
  path = path.replace(/^~/, homedir());
  return resolve(path);
}
