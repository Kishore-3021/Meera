/**
 * File system tools: read, write, list, create folder, delete, move, copy.
 */

import { readFile, writeFile, readdir, mkdir, unlink, rename, copyFile, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { PERMISSION } from "../permissions.js";
import { normalizeWindowsPath } from "../paths.js";

/** Resolve the real Desktop folder (OneDrive redirection aware). */
const expandPath = (path) => normalizeWindowsPath(path);

/** Guard against path traversal and system directories */
function isSafePath(p) {
  const resolved = resolve(p);
  const dangerous = ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)"];
  return !dangerous.some((d) => resolved.toLowerCase().startsWith(d.toLowerCase()));
}

// ─── files.read ──────────────────────────────────────────────────────────────
export const filesRead = {
  id: "files.read",
  name: "Read File",
  description: "Read the text content of a file.",
  category: "files",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "path", type: "string", description: "File path (supports ~ and %DESKTOP%)", required: true },
    { name: "maxBytes", type: "number", description: "Max bytes to read (default: 8192)", required: false },
  ],
  async detect() { return true; },
  async execute({ path, maxBytes = 8192 } = {}) {
    if (!path) return { success: false, output: null, error: "path is required." };
    const full = expandPath(path);
    if (!existsSync(full)) return { success: false, output: null, error: `File not found: ${full}` };
    try {
      const buffer = await readFile(full);
      const truncated = buffer.slice(0, Number(maxBytes));
      const text = truncated.toString("utf8");
      const note = buffer.length > maxBytes ? `\n[...truncated at ${maxBytes} bytes of ${buffer.length} total]` : "";
      return { success: true, output: `Contents of ${basename(full)}:\n${text}${note}` };
    } catch (e) {
      return { success: false, output: null, error: `Read failed: ${e.message}` };
    }
  },
};

// ─── files.write ─────────────────────────────────────────────────────────────
export const filesWrite = {
  id: "files.write",
  name: "Write File",
  description: "Write or create a text file with given content.",
  category: "files",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "path", type: "string", description: "File path", required: true },
    { name: "content", type: "string", description: "Text content to write", required: true },
    { name: "append", type: "boolean", description: "Append instead of overwrite (default: false)", required: false },
  ],
  async detect() { return true; },
  async execute({ path, content = "", append = false } = {}) {
    if (!path) return { success: false, output: null, error: "path is required." };
    const full = expandPath(path);
    if (!isSafePath(full)) return { success: false, output: null, error: "Path is in a protected system directory." };
    try {
      await mkdir(dirname(full), { recursive: true });
      const previous = append && existsSync(full) ? await readFile(full, "utf8") : "";
      if (append) {
        await writeFile(full, previous + content, "utf8");
      } else {
        await writeFile(full, String(content), "utf8");
      }
      const verified = await readFile(full, "utf8");
      const expected = append
        ? previous + String(content)
        : String(content);
      if (verified !== expected) return { success: false, output: null, error: "Write completed but read-back verification failed." };
      return { success: true, verified: true, output: `${append ? "Appended to" : "Wrote"} ${basename(full)} (${content.length} chars) at ${full}` };
    } catch (e) {
      return { success: false, output: null, error: `Write failed: ${e.message}` };
    }
  },
};

// ─── files.list ──────────────────────────────────────────────────────────────
export const filesList = {
  id: "files.list",
  name: "List Directory",
  description: "List files and folders in a directory.",
  category: "files",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "path", type: "string", description: "Directory path (default: current directory)", required: false },
  ],
  async detect() { return true; },
  async execute({ path = "." } = {}) {
    const full = expandPath(path);
    if (!existsSync(full)) return { success: false, output: null, error: `Directory not found: ${full}` };
    try {
      const entries = await readdir(full, { withFileTypes: true });
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      const lines = sorted.map((e) => `  ${e.isDirectory() ? "📁" : "📄"} ${e.name}`);
      return { success: true, output: `Contents of ${full} (${entries.length} items):\n${lines.join("\n")}` };
    } catch (e) {
      return { success: false, output: null, error: `List failed: ${e.message}` };
    }
  },
};

// ─── files.create_folder ─────────────────────────────────────────────────────
export const filesCreateFolder = {
  id: "files.create_folder",
  name: "Create Folder",
  description: "Create a directory (including nested).",
  category: "files",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "path", type: "string", description: "Folder path to create", required: true },
  ],
  async detect() { return true; },
  async execute({ path } = {}) {
    if (!path) return { success: false, output: null, error: "path is required." };
    const full = expandPath(path);
    if (!isSafePath(full)) return { success: false, output: null, error: "Path is in a protected system directory." };
    try {
      await mkdir(full, { recursive: true });
      return { success: true, verified: existsSync(full), output: `Created folder: ${full}` };
    } catch (e) {
      return { success: false, output: null, error: `Create folder failed: ${e.message}` };
    }
  },
};

// ─── files.delete ────────────────────────────────────────────────────────────
export const filesDelete = {
  id: "files.delete",
  name: "Delete File / Folder",
  description: "Permanently delete a file or folder (recursive for folders). Requires confirmation.",
  category: "files",
  permissionLevel: PERMISSION.DESTRUCTIVE,
  confirmDescription: (params) => `Permanently delete: ${params.path}`,
  parameters: [
    { name: "path", type: "string", description: "File or folder path to delete", required: true },
  ],
  async detect() { return true; },
  async execute({ path } = {}) {
    if (!path) return { success: false, output: null, error: "path is required." };
    const full = expandPath(path);
    if (!existsSync(full)) return { success: false, output: null, error: `Not found: ${full}` };
    if (!isSafePath(full)) return { success: false, output: null, error: "Path is in a protected system directory." };
    try {
      const s = await stat(full);
      if (s.isDirectory()) {
        await rm(full, { recursive: true, force: true });
      } else {
        await unlink(full);
      }
      return {
        success: true,
        output: `Deleted ${s.isDirectory() ? "folder (with contents)" : "file"}: ${full}`,
      };
    } catch (e) {
      return { success: false, output: null, error: `Delete failed: ${e.message}` };
    }
  },
};

// ─── files.move ──────────────────────────────────────────────────────────────
export const filesMove = {
  id: "files.move",
  name: "Move / Rename File",
  description: "Move or rename a file.",
  category: "files",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "from", type: "string", description: "Source path", required: true },
    { name: "to", type: "string", description: "Destination path", required: true },
  ],
  async detect() { return true; },
  async execute({ from, to } = {}) {
    if (!from || !to) return { success: false, output: null, error: "from and to are required." };
    const src = expandPath(from);
    const dst = expandPath(to);
    if (!existsSync(src)) return { success: false, output: null, error: `Source not found: ${src}` };
    if (!isSafePath(dst)) return { success: false, output: null, error: "Destination is in a protected system directory." };
    try {
      await mkdir(dirname(dst), { recursive: true });
      await rename(src, dst);
      return { success: true, verified: existsSync(dst) && !existsSync(src), output: `Moved ${basename(src)} → ${dst}` };
    } catch (e) {
      return { success: false, output: null, error: `Move failed: ${e.message}` };
    }
  },
};

// ─── files.copy ──────────────────────────────────────────────────────────────
export const filesCopy = {
  id: "files.copy",
  name: "Copy File",
  description: "Copy a file to a new location.",
  category: "files",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "from", type: "string", description: "Source path", required: true },
    { name: "to", type: "string", description: "Destination path", required: true },
  ],
  async detect() { return true; },
  async execute({ from, to } = {}) {
    if (!from || !to) return { success: false, output: null, error: "from and to are required." };
    const src = expandPath(from);
    const dst = expandPath(to);
    if (!existsSync(src)) return { success: false, output: null, error: `Source not found: ${src}` };
    if (!isSafePath(dst)) return { success: false, output: null, error: "Destination is in a protected system directory." };
    try {
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
      return { success: true, verified: existsSync(dst), output: `Copied ${basename(src)} → ${dst}` };
    } catch (e) {
      return { success: false, output: null, error: `Copy failed: ${e.message}` };
    }
  },
};

export const allFileTools = [filesRead, filesWrite, filesList, filesCreateFolder, filesDelete, filesMove, filesCopy];
