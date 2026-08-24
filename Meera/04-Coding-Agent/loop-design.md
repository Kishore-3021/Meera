# Phase 4: Coding Agent ReAct Loop & Execution Control

## ReAct Execution Loop (Plan → Execute → Evaluate → AutoFix → Report)

```
User Task Spec
      │
      ▼
[1. Plan] ──► Produce step-by-step breakdown & proposed files
      │
      ▼
[2. Execute] ──► Call tools (read_file, edit_file, write_file)
      │
      ▼
[3. Evaluate] ──► Run tests / linters via run_shell
      │
      ├── Tests Fail ──► [4. AutoFix] ──► Analyze error trace, revise code ──┐
      │                                                                       │ (Max 3 retries)
      │                                                                       │
      └── Tests Pass ──► [5. Report] ◄────────────────────────────────────────┘
```

---

## Context Compaction & Budget Guards

1. **Step Budget Cap**:
   - Maximum 10 tool calls per discrete coding task.
   - If the task is not completed within 10 calls, Meera halts, summarizes the progress made, and asks for user direction.

2. **Scratchpad Compaction**:
   - Every 4 tool executions, older tool outputs are compressed into a 2-line summary in context (e.g. `[Executed read_file on index.js: 150 lines read]`).
   - Prevents context window explosion on 7B parameters.
