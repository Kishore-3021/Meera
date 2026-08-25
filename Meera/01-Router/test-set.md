# Router Reliability Test Set

## Local-first cases

- What are my system specs?
- How much RAM and CPU do I have?
- What is my current volume?
- Is my Wi-Fi connected?
- Show running processes.
- What Bluetooth devices are paired?
- Read my clipboard.
- Take a screenshot.

Expected result: `agent_task` when the matching local capability is detected; no SearXNG request.

## Explicit web cases

- Search the web for the latest Qwen model.
- Look this up online.
- What is the current price of the latest iPhone?

Expected result: `web_search`, even when a local tool also exists.

## Context and ambiguity cases

- After opening an app: “mention it clearly.”
- After creating a file: “make it better.”
- After a failed launch: “try that again.”

Expected result: remain scoped to the current goal, ask for clarification when the action is ambiguous, and never invent a new unrelated action.

## Weak-result cases

- Search for a niche product with no relevant hits.
- Search for a breaking event with conflicting results.

Expected result: explain that results are weak or inconclusive; never assert nonexistence from missing search hits alone.
