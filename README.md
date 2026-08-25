# Meera

**A local-first AI orchestration layer built around Ollama + Qwen 2.5.**

Meera isn't a chatbot wrapper — it's an orchestration layer that routes intent, executes real system actions through a verified tool pipeline, and is being upgraded toward a persistent agent with continuous situational awareness. Everything runs locally: no external API in the runtime path.

> **Note on "self-awareness":** Meera tracks its own operational state — tool reliability, task progress, system conditions — the same way an observability system does. This is not a claim of sentience or consciousness.

---

## What Meera does

- Routes every request through an **Intent Router** — chat, web search, memory lookup, code task, or multi-step agent task
- Executes real actions on your machine through a **64-tool capability registry** (56 currently available), covering system control, applications, browser automation, files, network, execution (PowerShell/Python/Git), UI automation, media, and productivity tools
- **Never trusts its own output** — every tool call is planned, schema-validated, permission-gated, executed, and then verified against real system state before being reported as successful
- Retrieves live information through a self-hosted **SearXNG** instance (Docker) — free, private web search with no external API dependency
- Runs entirely offline-capable except for the search step, which stays local via Docker

---

## Architecture

```
User → Terminal UI → Intent Router
                          │
              ┌───────────┼────────────┐
              ▼           ▼            ▼
        Runtime State  Live Context  Ollama (Qwen2.5)
        (self-awareness)             │
              │                  chat/web/memory/code
              ▼
        Adaptive Agent Loop
              │
           Planner
              │
        Capability Registry (64 tools)
              │
     Schema + Parameter Validation
              │
        Permission / Safety Gate
              │
          Tool Execution
              │
        Real Result Verification
              │
    ┌─────────┴─────────┐
verified success      failure
    │                    │
  loop continues    retry / recover / replan
              │
        SQLite (Audit · Productivity · Knowledge)
```

### Core modules

| File | Responsibility |
|---|---|
| `src/index.js` | Entry point |
| `src/terminal-ui.js` | Terminal interface |
| `src/markdown.js` | Markdown/code rendering |
| `src/router.js` | Intent routing (chat / web / memory / code / agent_task) |
| `src/runtime-state.js` | Runtime self-awareness |
| `src/live-info.js` | Live environment/system context |
| `src/tools/agent-loop.js` | Adaptive multi-step execution loop |
| `src/tools/planner.js` | Proposes next tool call |
| `src/tools/registry.js` | Canonical capability registry |
| `src/tools/permissions.js` | Permission / safety gate |

---

## Tool ecosystem

64 registered tools across:

- **System** — info, processes, GPU, battery, audio/volume, clipboard, screenshot, display brightness, power
- **Applications** — open, close, focus, list (via PATH, Windows App Paths registry, Start Menu discovery)
- **Browser** — Playwright-backed navigation, clicking, typing, forms, tabs, page extraction
- **Files & archives** — read, write, list, create, delete, move, copy
- **Network** — Wi-Fi status/on/off, network info, DNS, Bluetooth devices
- **Execution** — PowerShell, Python, Git
- **UI Automation** — pywinauto (native Windows GUI), PyAutoGUI (fallback), typed input, hotkeys, mouse control
- **Media & productivity** — Spotify, PDF, tasks/reminders/knowledge, with optional Gmail/Notion/Obsidian integrations

The full registry is available via `/tools` in the terminal.

---

## Stack

| Layer | Technology |
|---|---|
| Core model | Ollama + `qwen2.5:7b-instruct-q4_K_M` |
| Web search | SearXNG (self-hosted, Docker) |
| Browser automation | Playwright |
| Native GUI automation | pywinauto, PyAutoGUI |
| Persistence | SQLite (audit, productivity, knowledge) |
| Runtime | Node.js |

---

## Getting started

```bash
# clone
git clone <repo-url>
cd meera

# install dependencies
npm install

# start SearXNG (Docker)
docker compose up -d searxng

# make sure Ollama is running with the model pulled
ollama pull qwen2.5:7b-instruct-q4_K_M

# start Meera
npm start
```

---

## Terminal commands

| Command | Description |
|---|---|
| `/help` | List available commands |
| `/about` | What Meera is |
| `/status` | Live connection + service status |
| `/tools` | Full capability registry dump |
| `/model` | Active model info |
| `/decisions` | Recent routing decisions |
| `/clear` | Clear the console |
| `/exit` | Exit |

---

## Design principles

- **Local-first.** No external API dependency in the runtime path. Development tools (Copilot, Codex, etc.) are used to build Meera — they are not part of its runtime.
- **Verify, don't assume.** `Planner output ≠ execution evidence.` Every action is verified against real system state before being reported as successful.
- **Never claim what isn't true.** Meera should never report a tool as available, an action as successful, or information as retrieved when it wasn't.
- **Small-model-aware routing.** Qwen2.5 7B doesn't see the full tool registry on every request — the router loads only the relevant capability category per task, keeping context small and tool selection reliable.

---

## Roadmap

Currently moving from a reactive request/response architecture toward a **persistent-agent architecture**:

- [x] Intent router with structured JSON output
- [x] Capability registry (64 tools) with schema validation and permission gating
- [x] Verified execution loop with retry/recovery
- [x] SearXNG-backed real-time search
- [ ] Continuous situational awareness (background polling, independent of user input)
- [ ] Persistent session/task state (resume in-progress tasks across restarts)
- [ ] Operational self-model with rolling tool-reliability tracking
- [ ] Event bus for cross-module state propagation
- [ ] Schema-constrained tool-call generation (Outlines / strict Ollama JSON schema)
- [ ] Episodic memory (Mem0)
- [ ] Temporal self-model memory (Graphiti)
- [ ] Vision (screen awareness, OCR-assisted guidance)
- [ ] Voice (multi-language STT/TTS)
- [ ] Mobile/server deployment

---

## Status

Actively developed. Expect rough edges — known issues are tracked internally around tool-call reliability, parameter extraction, and local-vs-web routing accuracy as the system scales its tool ecosystem.

---

## License

Meera is open source and released under the **MIT License**.

You are free to use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the software, subject to the terms of the MIT License.

Third-party dependencies, models, services, and integrations remain subject to their respective licenses.
---
