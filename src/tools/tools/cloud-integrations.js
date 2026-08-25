/**
 * Credential-gated Gmail and Notion integrations plus a local Obsidian vault.
 * Credentials are read only from environment variables and are never returned.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { mkdir } from "node:fs/promises";
import { PERMISSION } from "../permissions.js";
import { normalizeWindowsPath } from "../paths.js";

const gmailToken = () => process.env.GMAIL_ACCESS_TOKEN;
const notionToken = () => process.env.NOTION_TOKEN;
const notionVersion = () => process.env.NOTION_VERSION || "2022-06-28";
const vaultPath = () => process.env.OBSIDIAN_VAULT_PATH ? normalizeWindowsPath(process.env.OBSIDIAN_VAULT_PATH) : null;
const compact = (value, max = 2500) => String(value ?? "").slice(0, max);

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  let data;
  try { data = body ? JSON.parse(body) : {}; } catch { data = { raw: body }; }
  if (!response.ok) throw new Error(`${response.status}: ${data.message || data.error_description || data.error || body.slice(0, 300)}`);
  return data;
}

export const gmailSearch = {
  id: "gmail.search",
  name: "Search Gmail",
  description: "Search Gmail messages using the configured Gmail OAuth access token.",
  category: "communication",
  permissionLevel: PERMISSION.READ,
  parameters: [{ name: "query", type: "string", description: "Gmail search query", required: true }],
  async detect() { return Boolean(gmailToken()); },
  async execute({ query } = {}) {
    if (!query) return { success: false, output: null, error: "query is required." };
    try {
      const data = await apiJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`, {
        headers: { Authorization: `Bearer ${gmailToken()}` },
      });
      const messages = data.messages || [];
      return { success: true, output: messages.length ? `Gmail returned ${messages.length} matching message IDs:\n${messages.map((m) => m.id).join("\n")}` : "No Gmail messages matched.", data: messages };
    } catch (error) {
      return { success: false, output: null, error: `Gmail search failed: ${error.message}` };
    }
  },
};

export const gmailRead = {
  id: "gmail.read",
  name: "Read Gmail Message",
  description: "Read a Gmail message by ID using the configured Gmail OAuth access token.",
  category: "communication",
  permissionLevel: PERMISSION.READ,
  parameters: [{ name: "messageId", type: "string", description: "Gmail message ID", required: true }],
  async detect() { return Boolean(gmailToken()); },
  async execute({ messageId } = {}) {
    if (!messageId) return { success: false, output: null, error: "messageId is required." };
    try {
      const data = await apiJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata`, {
        headers: { Authorization: `Bearer ${gmailToken()}` },
      });
      const headers = (data.payload?.headers || []).filter((h) => ["Subject", "From", "To", "Date"].includes(h.name));
      return { success: true, output: headers.map((h) => `${h.name}: ${h.value}`).join("\n") || `Gmail message ${messageId} retrieved.`, data };
    } catch (error) {
      return { success: false, output: null, error: `Gmail read failed: ${error.message}` };
    }
  },
};

export const gmailSend = {
  id: "gmail.send",
  name: "Send Gmail Message",
  description: "Send an email through Gmail using a configured OAuth access token.",
  category: "communication",
  permissionLevel: PERMISSION.DESTRUCTIVE,
  confirmDescription: (params) => `Send Gmail message to ${params.to} with subject '${params.subject}'.`,
  parameters: [
    { name: "to", type: "string", description: "Recipient email address", required: true },
    { name: "subject", type: "string", description: "Email subject", required: true },
    { name: "body", type: "string", description: "Plain text email body", required: true },
  ],
  async detect() { return Boolean(gmailToken()); },
  async execute({ to, subject, body } = {}) {
    if (!to || !subject || !body) return { success: false, output: null, error: "to, subject, and body are required." };
    const raw = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
    const encoded = Buffer.from(raw).toString("base64url");
    try {
      const data = await apiJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${gmailToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: encoded }),
      });
      return { success: true, output: `Gmail message sent and acknowledged with ID ${data.id}.`, data: { id: data.id } };
    } catch (error) {
      return { success: false, output: null, error: `Gmail send failed: ${error.message}` };
    }
  },
};

export const notionSearch = {
  id: "notion.search",
  name: "Search Notion",
  description: "Search Notion pages and databases using a configured integration token.",
  category: "knowledge",
  permissionLevel: PERMISSION.READ,
  parameters: [{ name: "query", type: "string", description: "Notion search text", required: true }],
  async detect() { return Boolean(notionToken()); },
  async execute({ query } = {}) {
    if (!query) return { success: false, output: null, error: "query is required." };
    try {
      const data = await apiJson("https://api.notion.com/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${notionToken()}`, "Notion-Version": notionVersion(), "Content-Type": "application/json" },
        body: JSON.stringify({ query, page_size: 20 }),
      });
      const results = data.results || [];
      return { success: true, output: results.length ? results.map((item) => `${item.object}: ${item.id}`).join("\n") : "No Notion pages or databases matched.", data: results };
    } catch (error) {
      return { success: false, output: null, error: `Notion search failed: ${error.message}` };
    }
  },
};

export const notionCreatePage = {
  id: "notion.create_page",
  name: "Create Notion Page",
  description: "Create a plain-text Notion page under a configured parent page.",
  category: "knowledge",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "parentId", type: "string", description: "Parent Notion page ID", required: true },
    { name: "title", type: "string", description: "Page title", required: true },
    { name: "content", type: "string", description: "Plain text page content", required: true },
  ],
  async detect() { return Boolean(notionToken()); },
  async execute({ parentId, title, content } = {}) {
    if (!parentId || !title || !content) return { success: false, output: null, error: "parentId, title, and content are required." };
    try {
      const data = await apiJson("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: { Authorization: `Bearer ${notionToken()}`, "Notion-Version": notionVersion(), "Content-Type": "application/json" },
        body: JSON.stringify({
          parent: { page_id: parentId },
          properties: { title: { title: [{ text: { content: title } }] } },
          children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: compact(content, 1900) } }] } }],
        }),
      });
      return { success: true, output: `Created and verified Notion page ${data.id}.`, data: { id: data.id, url: data.url } };
    } catch (error) {
      return { success: false, output: null, error: `Notion page creation failed: ${error.message}` };
    }
  },
};

async function walkMarkdown(root, current = root, results = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === ".obsidian" || entry.name === "node_modules") continue;
    const full = join(current, entry.name);
    if (entry.isDirectory()) await walkMarkdown(root, full, results);
    else if (entry.name.toLowerCase().endsWith(".md")) results.push(full);
  }
  return results;
}

export const obsidianSearch = {
  id: "obsidian.search",
  name: "Search Obsidian Vault",
  description: "Search Markdown notes in the configured local Obsidian vault.",
  category: "knowledge",
  permissionLevel: PERMISSION.READ,
  parameters: [{ name: "query", type: "string", description: "Text to find in notes", required: true }],
  async detect() { return Boolean(vaultPath() && existsSync(vaultPath())); },
  async execute({ query } = {}) {
    if (!query) return { success: false, output: null, error: "query is required." };
    const root = vaultPath();
    try {
      const matches = [];
      for (const file of await walkMarkdown(root)) {
        const text = await readFile(file, "utf8");
        if (text.toLowerCase().includes(query.toLowerCase())) matches.push(relative(root, file));
      }
      return { success: true, output: matches.length ? matches.join("\n") : `No notes matched '${query}'.`, data: matches };
    } catch (error) {
      return { success: false, output: null, error: `Obsidian search failed: ${error.message}` };
    }
  },
};

export const obsidianWrite = {
  id: "obsidian.write",
  name: "Write Obsidian Note",
  description: "Create or update a Markdown note inside the configured Obsidian vault.",
  category: "knowledge",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "note", type: "string", description: "Relative note path, with or without .md", required: true },
    { name: "content", type: "string", description: "Markdown content", required: true },
  ],
  async detect() { return Boolean(vaultPath() && existsSync(vaultPath())); },
  async execute({ note, content } = {}) {
    if (!note || content === undefined) return { success: false, output: null, error: "note and content are required." };
    const root = vaultPath();
    const relativeNote = String(note).replace(/^[/\\]+/, "").replace(/\.\.[/\\]/g, "");
    const target = join(root, relativeNote.toLowerCase().endsWith(".md") ? relativeNote : `${relativeNote}.md`);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, String(content), "utf8");
      const verified = await readFile(target, "utf8");
      if (verified !== String(content)) return { success: false, output: null, error: "Obsidian note write could not be verified." };
      return { success: true, output: `Wrote and verified Obsidian note: ${relative(root, target)}` };
    } catch (error) {
      return { success: false, output: null, error: `Obsidian note write failed: ${error.message}` };
    }
  },
};

export const allCloudIntegrationTools = [
  gmailSearch, gmailRead, gmailSend,
  notionSearch, notionCreatePage,
  obsidianSearch, obsidianWrite,
];
