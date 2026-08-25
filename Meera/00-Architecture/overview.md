# Meera Reliability-First Plan (v2)

Meera prioritizes truthful execution over plausible prose:

```
User request
  -> live capability registry
  -> deterministic local-first routing
  -> minimal plan
  -> schema validation and permission gate
  -> real execution and verification
  -> bounded recovery
  -> grounded response
```

The registry in `src/tools/registry.js` is the source of truth for detected tools. Router, planner, runtime self-awareness, status, and `/tools` must consume it live. Planner output is never execution evidence.

## Reliability exit tests

1. `/tools` reports the same detected count and definitions as the registry.
2. Unknown tool IDs and incomplete parameters are rejected before execution and returned to Qwen with compact live-tool feedback.
3. Ten varied tool tasks execute with no empty or placeholder parameters.
4. Ambiguous follow-ups stay scoped or request clarification; they do not fan out into unrelated actions.
5. Local queries use a detected local tool before SearXNG.
6. Weak search results are reported as inconclusive, never as proof that something does not exist.

Phase 3 browser/native automation backends remain downstream of this reliability foundation.

## Scope

The plan remains in scope for incremental milestones: Ollama/Qwen, terminal UI,
self-awareness, the canonical capability registry, router/planner and task
context, validation, permissions, verified Windows execution and recovery,
SearXNG/current web, applications/processes, filesystem, PowerShell, Python,
Git/GitHub, Playwright/browser automation, native Windows UI automation with
pywinauto, PyAutoGUI fallback, Wi-Fi/network, Bluetooth, audio/volume,
brightness, supported RGB/peripheral controls, screenshots as a utility,
clipboard, hardware monitoring, Spotify/media, PDF/document intelligence,
RAG/ChromaDB, productivity, communications, MCP/plugins, multi-agent/server/
mobile/multi-device architecture, notifications, background automation,
regression testing, controlled self-development, Git rollback,
performance/context optimization, security, and audit logging.

## Explicitly deferred

Voice and Vision are not implemented in this roadmap phase:

- no voice input, speech-to-text, text-to-speech, voice cloning, or multilingual voice
- no camera recognition, OCR reasoning, screen understanding, visual reasoning,
  object recognition, or computer-vision models

Screenshots may still be captured and saved as a utility, but Meera must not
interpret their contents. Future Voice and Vision modules must plug into the
existing request, capability, validation, execution, and verification
interfaces without redesigning the core.

## Milestone discipline

Do not combine the roadmap into one rewrite. Inspect and reuse existing
systems, deduplicate capabilities, ship stable milestones, run real regression
tests, and create Git checkpoints. The immediate order remains:

1. canonical registry
2. validation and reject-and-feedback
3. task-state context
4. intelligent tool selection with deterministic local-first routing
5. real execution, verification, recovery, and expanded regression coverage
6. remaining platform integrations
