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
    CREATE TABLE IF NOT EXISTS routing_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      user_input TEXT NOT NULL,
      routed_intent TEXT NOT NULL,
      confidence REAL NOT NULL,
      needs_search INTEGER NOT NULL,
      needs_memory INTEGER NOT NULL,
      search_query TEXT,
      reasoning TEXT,
      execution_ms INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      attribute TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function logDecision({
  userInput,
  routedIntent,
  confidence,
  needsSearch,
  needsMemory,
  searchQuery = "",
  reasoning = "",
  executionMs = 0,
}) {
  try {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO routing_decisions (
        user_input, routed_intent, confidence, needs_search, needs_memory, search_query, reasoning, execution_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      userInput,
      routedIntent,
      confidence,
      needsSearch ? 1 : 0,
      needsMemory ? 1 : 0,
      searchQuery,
      reasoning,
      executionMs
    );
  } catch (error) {
    console.error("Failed to log routing decision to SQLite:", error.message);
  }
}

export function getRecentDecisions(limit = 20) {
  const db = getDatabase();
  const query = db.prepare(`
    SELECT id, timestamp, user_input, routed_intent, confidence, needs_search, needs_memory, search_query, execution_ms
    FROM routing_decisions
    ORDER BY id DESC
    LIMIT ?
  `);
  return query.all(limit);
}
