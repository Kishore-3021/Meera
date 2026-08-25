# Router Design — Reliability-First

## Objective
Use a live registry-aware deterministic pre-check before the schema-constrained classifier. Local capabilities take precedence over web search unless the user explicitly requests the web.

---

## Architecture Flow

```
Raw User Input
      │
      ▼
Live local-capability pre-check
      │
      ▼
Local agent route ── no LLM routing call
       │
       └── no match ──► Intent Classifier
                              │
                              ▼
Parsed JSON: { intent, confidence, needs_search, needs_memory, extracted_subject }
      │
      ├── confidence < 0.70 ──► Fallback to direct conversational clarification
      │
      └── confidence ≥ 0.70 ──► Route to Target Handler
                                   ├── "chat"
                                   ├── "web_search"
                                   ├── "code_task"
                                   ├── "vision_task"
                                   └── "memory_lookup"

Explicit web requests override the local pre-check. A weak search result means “inconclusive,” not “does not exist.”
```

---

## JSON Output Schema

```json
{
  "type": "object",
  "properties": {
    "intent": {
      "type": "string",
      "enum": ["chat", "web_search", "code_task", "vision_task", "memory_lookup"]
    },
    "confidence": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0
    },
    "needs_search": {
      "type": "boolean"
    },
    "needs_memory": {
      "type": "boolean"
    },
    "extracted_subject": {
      "type": "string"
    },
    "reasoning": {
      "type": "string"
    }
  },
  "required": ["intent", "confidence", "needs_search", "needs_memory"]
}
```

---

## Classifier Prompt Spec
- Keep instructions under 150 tokens for maximum generation speed.
- System prompt instructs model to act purely as a classification router.
- Examples provided covering ambiguous cases, fresh facts, and coding commands.

---

## SQLite Decision Logging Schema

```sql
CREATE TABLE IF NOT EXISTS routing_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  user_input TEXT NOT NULL,
  routed_intent TEXT NOT NULL,
  confidence REAL NOT NULL,
  needs_search INTEGER NOT NULL,
  needs_memory INTEGER NOT NULL,
  extracted_subject TEXT,
  execution_ms INTEGER,
  override_flag INTEGER DEFAULT 0
);
```
