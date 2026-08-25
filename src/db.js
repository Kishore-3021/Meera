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
    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      task_id TEXT NOT NULL,
      step INTEGER,
      tool TEXT NOT NULL,
      parameters TEXT NOT NULL,
      success INTEGER NOT NULL,
      verified INTEGER NOT NULL,
      output TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS session_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      goal_description TEXT NOT NULL,
      current_step INTEGER NOT NULL DEFAULT 0,
      step_history TEXT NOT NULL DEFAULT '[]',
      resumable INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed', 'abandoned')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_session_state_task_id ON session_state(task_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_session_state_task_id ON session_state(task_id);
    CREATE INDEX IF NOT EXISTS idx_session_state_status ON session_state(status, updated_at);
    CREATE TABLE IF NOT EXISTS tool_reliability (
      tool_name TEXT PRIMARY KEY,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_failure_reason TEXT,
      last_updated TEXT NOT NULL DEFAULT (datetime('now')),
      rolling_window TEXT NOT NULL DEFAULT '[]'
    );
  `);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => (
    /token|password|secret|authorization|api[-_]?key|credential/i.test(key)
      ? [key, "[REDACTED]"]
      : [key, redact(item)]
  )));
}

export function logToolCall({
  taskId,
  step,
  tool,
  parameters = {},
  success = false,
  verified = false,
  output = null,
  error = null,
}) {
  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO tool_calls (task_id, step, tool, parameters, success, verified, output, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      step ?? null,
      tool,
      JSON.stringify(redact(parameters)),
      success ? 1 : 0,
      verified ? 1 : 0,
      output == null ? null : String(output).slice(0, 4000),
      error == null ? null : String(error).slice(0, 1000),
    );
  } catch (error) {
    console.error("Failed to log tool call to SQLite:", error.message);
  }
}

export function getRecentToolCalls(limit = 20) {
  const db = getDatabase();
  return db.prepare(`
    SELECT id, timestamp, task_id, step, tool, parameters, success, verified, output, error
    FROM tool_calls ORDER BY id DESC LIMIT ?
  `).all(limit);
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

export function upsertSessionState({
  taskId,
  goalDescription,
  currentStep = 0,
  stepHistory = [],
  resumable = true,
  status = "in_progress",
}) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO session_state (task_id, goal_description, current_step, step_history, resumable, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(task_id) DO UPDATE SET
      goal_description = excluded.goal_description,
      current_step = excluded.current_step,
      step_history = excluded.step_history,
      resumable = excluded.resumable,
      status = excluded.status,
      updated_at = datetime('now')
  `).run(
    taskId,
    goalDescription,
    Number(currentStep) || 0,
    JSON.stringify(stepHistory),
    resumable ? 1 : 0,
    status,
  );
}

export function getLatestInProgressSession() {
  const db = getDatabase();
  return db.prepare(`
    SELECT task_id, goal_description, current_step, step_history, resumable, status, created_at, updated_at
    FROM session_state
    WHERE status = 'in_progress'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get();
}

export function setSessionStatus(taskId, status) {
  const db = getDatabase();
  db.prepare(`
    UPDATE session_state
    SET status = ?, updated_at = datetime('now')
    WHERE task_id = ?
  `).run(status, taskId);
}

export function getToolReliabilityRow(toolName) {
  const db = getDatabase();
  return db.prepare(`
    SELECT tool_name, success_count, failure_count, last_failure_reason, last_updated, rolling_window
    FROM tool_reliability
    WHERE tool_name = ?
  `).get(toolName);
}

export function upsertToolReliabilityRow({
  toolName,
  successCount,
  failureCount,
  lastFailureReason = null,
  rollingWindow = [],
}) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO tool_reliability (tool_name, success_count, failure_count, last_failure_reason, last_updated, rolling_window)
    VALUES (?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(tool_name) DO UPDATE SET
      success_count = excluded.success_count,
      failure_count = excluded.failure_count,
      last_failure_reason = excluded.last_failure_reason,
      last_updated = datetime('now'),
      rolling_window = excluded.rolling_window
  `).run(
    toolName,
    Number(successCount) || 0,
    Number(failureCount) || 0,
    lastFailureReason,
    JSON.stringify(rollingWindow),
  );
}

export function listToolReliabilityRows(limit = 100) {
  const db = getDatabase();
  return db.prepare(`
    SELECT tool_name, success_count, failure_count, last_failure_reason, last_updated, rolling_window
    FROM tool_reliability
    ORDER BY last_updated DESC
    LIMIT ?
  `).all(limit);
}
