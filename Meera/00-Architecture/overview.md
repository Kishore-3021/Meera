# Meera — Architecture & Master Build Plan

Local AI system powered by Ollama (Qwen 2.5 family) as the core intelligence and Meera as the local orchestration layer. Features a streaming terminal interface and local SearXNG metasearch instance via Docker.

---

## High-Level Architecture

```
User Input ──► Intent Router (JSON-constrained)
                    │
       ┌────────────┼─────────────┬─────────────┬─────────────┐
       ▼            ▼             ▼             ▼             ▼
   [Direct Chat] [Memory]    [SearXNG]    [Code Agent]    [Vision]
       │            │             │             │             │
       └────────────┴──────┬──────┴─────────────┴─────────────┘
                           ▼
                  Response Synthesizer
                           ▼
              Terminal UI (Streaming / Markdown)
```

---

## Phase Roadmap

### Phase 0 — Foundation Audit (**DONE**)
- [x] Ollama + `qwen2.5:7b-instruct-q4_K_M` running.
- [x] Terminal interface with streaming markdown, command support (`/help`, `/status`, `/clear`, `/model`, `/exit`), history navigation.
- [x] Local Dockerized SearXNG integration on `http://127.0.0.1:8080`.
- [x] Model allocation & benchmarking decided.
- [x] Git repository and Obsidian vault initialized.

### Phase 1 — Orchestration Core (Intent Router) (**DONE**)
- [x] Schema-constrained JSON routing (`intent`, `confidence`, `needs_search`, `needs_memory`).
- [x] High-speed classification pass separated from main generation prompt.
- [x] Low-confidence fallback to clarifying conversation.
- [x] SQLite decision logging table (`routing_decisions`) for auditing and tuning.
- [x] Automated 20-case test suite (`npm test`) achieving 100% accuracy.

### Phase 2 — Multi-Tier Memory (**NEXT**)
- [ ] **Working Memory**: In-process recent conversation turns.
- [ ] **Episodic Memory**: ChromaDB semantic embeddings with top-k vector retrieval.
- [ ] **Structured Memory**: SQLite exact recall (key facts, user preferences, project metadata).
- [ ] Memory lookup preceding external search.

### Phase 3 — Search Reliability
- [ ] Query rewriting module producing 2-3 focused search strings.
- [ ] Strict source-synthesis prompt preventing hallucinated facts.
- [ ] Automatic bracketed citations referencing source indices.
- [ ] Fallback flag for unverified parametric responses.

### Phase 4 — Sandboxed Coding Agent
- [ ] ReAct loop: Plan → Execute → Evaluate → AutoFix → Report.
- [ ] Minimal 5-tool set: `read_file`, `write_file`, `edit_file`, `run_shell`, `git_op`.
- [ ] Strict workspace directory sandboxing and explicit safety confirmation gates.
- [ ] Context window compaction and step budget caps.

### Phase 5 — Screen & Visual Awareness
- [ ] On-demand screen capture via `mss`.
- [ ] Scene understanding with `moondream2` and dense text extraction via `EasyOCR`.
- [ ] Step-by-step Guide Mode prompt template.

### Phase 6 — Multi-Language Voice Interface
- [ ] Multilingual Speech-to-Text via `faster-whisper`.
- [ ] Text-to-Speech using fast local `Piper` neural voices.
- [ ] Fast language identification routing voice models dynamically.

### Phase 7 — Proactive Automation Layer
- [ ] Background service runner for continuous monitoring.
- [ ] File system watchers and Git hooks triggering automated diagnostics.
- [ ] Scheduled timers for periodic reports and task reminders.
