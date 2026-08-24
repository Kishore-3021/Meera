import { DatabaseSync } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../meera.db");

let dbInstance = null;

export function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    initSchema(dbInstance);
  }
  return dbInstance;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      user_input TEXT NOT NULL,
      intent TEXT NOT NULL,
      confidence REAL NOT NULL,
      needs_search INTEGER NOT NULL,
      needs_memory INTEGER NOT NULL,
      execution_path TEXT NOT NULL
    );
  `);
}

export function logDecision({
  userInput,
  intent,
  confidence,
  needsSearch,
  needsMemory,
  executionPath = "chat",
}) {
  try {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO decisions (
        user_input, intent, confidence, needs_search, needs_memory, execution_path
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      userInput,
      intent,
      confidence,
      needsSearch ? 1 : 0,
      needsMemory ? 1 : 0,
      executionPath
    );
  } catch (error) {
    console.error("Failed to log routing decision to SQLite:", error.message);
  }
}

export function getRecentDecisions(limit = 20) {
  const db = getDatabase();
  const query = db.prepare(`
    SELECT id, timestamp, user_input, intent, confidence, needs_search, needs_memory, execution_path
    FROM decisions
    ORDER BY id DESC
    LIMIT ?
  `);
  return query.all(limit);
}
