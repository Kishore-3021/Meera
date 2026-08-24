# Phase 6: Multi-Language Voice Interface & Mapping

## Pipeline Design

```
Audio Input (Mic)
      │
      ▼
Speech-to-Text (`faster-whisper` base/small)
      │
      ▼
Transcribed Text
      │
      ▼
Language Detection (`fasttext` / regex / whisper metadata)
      │
      ▼
Meera Processing (Qwen 2.5)
      │
      ▼
Target Voice Selector ──► Piper TTS Voice Model ──► Audio Output
```

---

## Language to Piper TTS Voice Mapping

| Language | Language Code | Target Piper Voice Model | Format |
|---|---|---|---|
| **English** | `en` | `en_US-lessac-medium` | ONNX |
| **Telugu** | `te` | `te_IN-vasavi-medium` | ONNX |
| **Hindi** | `hi` | `hi_IN-priyamvada-medium` | ONNX |
| **Spanish** | `es` | `es_ES-davefx-medium` | ONNX |

---

## Memory & Latency Footprint
- `faster-whisper-base`: ~150 MB VRAM / RAM
- `Piper TTS`: Runs on CPU in <100ms per utterance, avoiding VRAM contention with Ollama
