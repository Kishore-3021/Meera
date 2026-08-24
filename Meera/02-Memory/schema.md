# Phase 2: Multi-Tier Memory Schema & Architecture

## Design Overview
Combines 3 distinct memory layers to deliver low-latency recall, semantic similarity retrieval, and exact relational data storage.

---

## 1. Working Memory (Short-Term)
- **Scope**: In-process conversational buffer.
- **Capacity**: Last $N$ turns (configurable, default 10 turns).
- **Format**: Array of `{ role: "user" | "assistant" | "system", content: string, timestamp: number }`.

---

## 2. Episodic Memory (ChromaDB / Vector Store)
- **Scope**: Cross-session contextual recall using semantic embeddings.
- **Collection Name**: `meera_conversations`.
- **Embedding Model**: `nomic-embed-text` or `all-minilm-l6-v2` via local embedding service / Ollama.
- **Document Structure**:
  ```json
  {
    "id": "turn_20260824_101500_user",
    "document": "User requested information on ASUS TUF F16 laptop specifications.",
    "metadata": {
      "session_id": "sess_20260824_01",
      "timestamp": "2026-08-24T10:15:00Z",
      "speaker": "user",
      "topic": "hardware"
    }
  }
  ```
- **Pruning / Decay Rule**: Maximum 5,000 active episodic fragments; older records summarized periodically into structured memory notes.

---

## 3. Structured Memory (SQLite)
- **Scope**: Exact facts, user preferences, project directory pointers, entity knowledge.

```sql
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

CREATE TABLE IF NOT EXISTS project_contexts (
  project_name TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  description TEXT,
  stack TEXT,
  last_accessed TEXT NOT NULL DEFAULT (datetime('now'))
);
```
