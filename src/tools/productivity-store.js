import { getDatabase } from "../db.js";

let initialized = false;
let ftsAvailable = false;

export function getProductivityDatabase() {
  const db = getDatabase();
  if (!initialized) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS productivity_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        title TEXT,
        tags TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS productivity_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        due TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS productivity_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        remind_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    try {
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS productivity_knowledge_fts USING fts5(text, title, tags);");
      ftsAvailable = true;
      const count = db.prepare("SELECT COUNT(*) AS count FROM productivity_knowledge_fts").get().count;
      if (count === 0) {
        db.prepare("INSERT INTO productivity_knowledge_fts(rowid, text, title, tags) SELECT id, text, COALESCE(title, ''), COALESCE(tags, '') FROM productivity_knowledge").run();
      } else {
        db.prepare("INSERT INTO productivity_knowledge_fts(rowid, text, title, tags) SELECT k.id, k.text, COALESCE(k.title, ''), COALESCE(k.tags, '') FROM productivity_knowledge k WHERE NOT EXISTS (SELECT 1 FROM productivity_knowledge_fts f WHERE f.rowid = k.id)").run();
      }
    } catch {
      ftsAvailable = false;
    }
    initialized = true;
  }
  return db;
}

export function hasKnowledgeFts() {
  getProductivityDatabase();
  return ftsAvailable;
}
