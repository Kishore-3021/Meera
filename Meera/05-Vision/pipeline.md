# Phase 5: Vision & Screen Awareness Pipeline

## Architecture Overview

```
Trigger (Manual / User Request / Guide Mode)
      │
      ▼
Screen Capture (`mss` Python / Node screenshot buffer)
      │
      ├───────────────────────────────┐
      ▼                               ▼
Vision LLM (`moondream2`)      Dense Text OCR (`EasyOCR`)
      │                               │
      ▼                               ▼
Visual Scene Summary           Extracted On-Screen Text
      │                               │
      └──────────────┬────────────────┘
                     ▼
             Guide Mode Prompt
                     ▼
       Concise, Next-Action Direction
```

---

## Guide Mode Prompt Template

```text
You are Meera assisting the user with their current screen.
Visual Context: {moondream_scene_summary}
On-Screen Text (OCR): {ocr_extracted_text}
User Goal: {user_goal}

Provide ONLY the single next concrete action the user should take. Do not repeat descriptive details that the user can already see.
```
# Deferred

Camera recognition, OCR reasoning, screen understanding, visual reasoning,
object recognition, and computer-vision models are explicitly out of scope for
the current implementation roadmap. Screenshot capture may remain a utility
without interpretation.
