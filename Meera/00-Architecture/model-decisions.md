# Model Strategy & Allocation Decisions

## Current Baseline
- **Primary Model**: `qwen2.5:7b-instruct-q4_K_M`
- **Host**: Ollama (Windows local runtime with GPU acceleration)
- **VRAM / Footprint**: ~4.7 GB (fits comfortably within 8GB VRAM envelope alongside vision/TTS/STT modules)

---

## Single Model vs. Split Model Strategy

### Option A: Unified Model (`qwen2.5:7b-instruct-q4_K_M`)
- **Pros**:
  - Zero model swap latency in Ollama VRAM.
  - Consistent personality, formatting, and instruction-following.
  - Highly capable in general reasoning, structured JSON output, query synthesis, and moderate coding tasks.
- **Cons**:
  - May have slightly lower token-level accuracy on complex multi-file code diffs than a dedicated coder checkpoint.

### Option B: Split Model (`qwen2.5:7b-instruct` + `qwen2.5-coder:7b-instruct`)
- **Pros**:
  - `qwen2.5-coder:7b-instruct` has domain-specific fine-tuning for code generation, syntax correctness, and debugging traces.
- **Cons**:
  - Model unloading/loading overhead (~2-4 seconds) when switching between Chat and Coding Agent if both cannot remain pinned in VRAM simultaneously.

---

## Decision & Roadmap
1. **Phases 1-3 (Router, Memory, Search)**: Use `qwen2.5:7b-instruct-q4_K_M` as the unified core for routing, memory synthesis, and search answer generation.
2. **Phase 4 (Coding Agent)**: Benchmark `qwen2.5:7b-instruct` against `qwen2.5-coder:7b-instruct` on the 5-6 coding tool calling tasks. If `qwen2.5:7b-instruct` satisfies the ≥80% task pass rate, keep single model; otherwise configure dynamic coder agent delegation.
