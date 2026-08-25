import { PERMISSION } from "../permissions.js";
import { getProductivityDatabase, hasKnowledgeFts } from "../productivity-store.js";

const ok = (data, output) => ({ success: true, output, data });
const fail = (error) => ({ success: false, output: null, error });
const text = (value) => typeof value === "string" ? value.trim() : "";
const within = (value, max, name) => value.length <= max ? null : `${name} must be at most ${max} characters.`;

export const knowledgeAdd = {
  id: "knowledge.add",
  name: "Add Knowledge",
  description: "Save a plain-text knowledge snippet for later local search.",
  category: "productivity",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "text", type: "string", description: "Knowledge snippet", required: true },
    { name: "title", type: "string", description: "Optional short title", required: false },
    { name: "tags", type: "string", description: "Optional comma-separated tags", required: false },
  ],
  async detect() { return true; },
  async execute({ text: value, title = null, tags = null } = {}) {
    const snippet = text(value);
    if (!snippet) return fail("text is required.");
    const sizeError = within(snippet, 20000, "text");
    if (sizeError) return fail(sizeError);
    try {
      const db = getProductivityDatabase();
      const result = db.prepare("INSERT INTO productivity_knowledge (text, title, tags) VALUES (?, ?, ?)").run(snippet, text(title) || null, text(tags) || null);
      if (hasKnowledgeFts()) db.prepare("INSERT INTO productivity_knowledge_fts (rowid, text, title, tags) VALUES (?, ?, ?, ?)").run(result.lastInsertRowid, snippet, text(title), text(tags));
      const item = { id: Number(result.lastInsertRowid), text: snippet, title: text(title) || null, tags: text(tags) || null };
      return ok(item, `Knowledge saved (${item.id}).`);
    } catch (error) {
      return fail(`Knowledge save failed: ${error.message}`);
    }
  },
};

export const knowledgeSearch = {
  id: "knowledge.search",
  name: "Search Knowledge",
  description: "Search saved local knowledge snippets using full-text search when available.",
  category: "productivity",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "query", type: "string", description: "Search text", required: true },
    { name: "limit", type: "number", description: "Maximum results (default: 10)", required: false, min: 1, max: 50 },
  ],
  async detect() { return true; },
  async execute({ query, limit = 10 } = {}) {
    const search = text(query);
    if (!search) return fail("query is required.");
    const sizeError = within(search, 500, "query");
    if (sizeError) return fail(sizeError);
    const bounded = Math.min(50, Math.max(1, Number(limit) || 10));
    try {
      const db = getProductivityDatabase();
      let rows;
      if (hasKnowledgeFts()) {
        const terms = search.split(/\s+/).filter(Boolean).map((term) => `"${term.replaceAll('"', '""')}"*`).join(" AND ");
        try {
          rows = db.prepare("SELECT k.id, k.text, k.title, k.tags, k.created_at FROM productivity_knowledge_fts f JOIN productivity_knowledge k ON k.id = f.rowid WHERE productivity_knowledge_fts MATCH ? ORDER BY k.id DESC LIMIT ?").all(terms, bounded);
        } catch {
          rows = null;
        }
      }
      if (!rows) rows = db.prepare("SELECT id, text, title, tags, created_at FROM productivity_knowledge WHERE text LIKE ? OR title LIKE ? OR tags LIKE ? ORDER BY id DESC LIMIT ?").all(`%${search}%`, `%${search}%`, `%${search}%`, bounded);
      return ok({ query: search, items: rows }, `${rows.length} knowledge result(s).`);
    } catch (error) {
      return fail(`Knowledge search failed: ${error.message}`);
    }
  },
};

export const taskAdd = {
  id: "task.add",
  name: "Add Task",
  description: "Add a local task to the productivity list.",
  category: "productivity",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "title", type: "string", description: "Task title", required: true },
    { name: "due", type: "string", description: "Optional due date or time", required: false },
  ],
  async detect() { return true; },
  async execute({ title, due = null } = {}) {
    const value = text(title);
    if (!value) return fail("title is required.");
    const sizeError = within(value, 500, "title");
    if (sizeError) return fail(sizeError);
    const db = getProductivityDatabase();
    const result = db.prepare("INSERT INTO productivity_tasks (title, due) VALUES (?, ?)").run(value, text(due) || null);
    return ok({ id: Number(result.lastInsertRowid), title: value, due: text(due) || null, completed: false }, "Task added.");
  },
};

export const taskList = {
  id: "task.list",
  name: "List Tasks",
  description: "List local tasks, optionally including completed tasks.",
  category: "productivity",
  permissionLevel: PERMISSION.READ,
  parameters: [
    { name: "includeCompleted", type: "boolean", description: "Include completed tasks", required: false },
    { name: "limit", type: "number", description: "Maximum results (default: 50)", required: false, min: 1, max: 100 },
  ],
  async detect() { return true; },
  async execute({ includeCompleted = false, limit = 50 } = {}) {
    const db = getProductivityDatabase();
    const bounded = Math.min(100, Math.max(1, Number(limit) || 50));
    const rows = db.prepare(`SELECT id, title, due, completed, created_at, completed_at FROM productivity_tasks ${includeCompleted ? "" : "WHERE completed = 0"} ORDER BY completed ASC, id DESC LIMIT ?`).all(bounded)
      .map((row) => ({ ...row, completed: Boolean(row.completed) }));
    return ok({ items: rows }, `${rows.length} task(s).`);
  },
};

export const taskComplete = {
  id: "task.complete",
  name: "Complete Task",
  description: "Mark a local task as completed.",
  category: "productivity",
  permissionLevel: PERMISSION.WRITE,
  parameters: [{ name: "id", type: "number", description: "Task ID", required: true, min: 1 }],
  async detect() { return true; },
  async execute({ id } = {}) {
    const db = getProductivityDatabase();
    const result = db.prepare("UPDATE productivity_tasks SET completed = 1, completed_at = datetime('now') WHERE id = ? AND completed = 0").run(id);
    if (!result.changes) return fail("Task not found or already completed.");
    return ok({ id, completed: true }, "Task completed.");
  },
};

export const reminderAdd = {
  id: "reminder.add",
  name: "Add Reminder",
  description: "Persist a local reminder without creating an OS scheduled task.",
  category: "productivity",
  permissionLevel: PERMISSION.WRITE,
  parameters: [
    { name: "text", type: "string", description: "Reminder text", required: true },
    { name: "remindAt", type: "string", description: "Reminder date or time", required: true },
  ],
  async detect() { return true; },
  async execute({ text: value, remindAt } = {}) {
    const reminder = text(value);
    const at = text(remindAt);
    if (!reminder || !at) return fail("text and remindAt are required.");
    const sizeError = within(reminder, 500, "text");
    if (sizeError) return fail(sizeError);
    const dateError = within(at, 100, "remindAt");
    if (dateError) return fail(dateError);
    const db = getProductivityDatabase();
    const result = db.prepare("INSERT INTO productivity_reminders (text, remind_at) VALUES (?, ?)").run(reminder, at);
    return ok({ id: Number(result.lastInsertRowid), text: reminder, remindAt: at }, "Reminder saved.");
  },
};

export const reminderList = {
  id: "reminder.list",
  name: "List Reminders",
  description: "List persisted local reminders.",
  category: "productivity",
  permissionLevel: PERMISSION.READ,
  parameters: [{ name: "limit", type: "number", description: "Maximum results (default: 50)", required: false, min: 1, max: 100 }],
  async detect() { return true; },
  async execute({ limit = 50 } = {}) {
    const bounded = Math.min(100, Math.max(1, Number(limit) || 50));
    const rows = getProductivityDatabase().prepare("SELECT id, text, remind_at AS remindAt, created_at AS createdAt FROM productivity_reminders ORDER BY remind_at ASC, id DESC LIMIT ?").all(bounded);
    return ok({ items: rows }, `${rows.length} reminder(s).`);
  },
};

export const allProductivityTools = [knowledgeAdd, knowledgeSearch, taskAdd, taskList, taskComplete, reminderAdd, reminderList];
