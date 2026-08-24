# Meera

A minimal terminal chat application for local Ollama and `qwen2.5:7b-instruct-q4_K_M`.

## Run

1. Ensure Ollama is running at `http://localhost:11434` and the model is installed.
2. From this folder, run:

   ```powershell
   npm start
   ```

## Install as a command

From this project folder, run once:

```powershell
npm link
```

Then launch Meera from any folder with:

```powershell
meera
```

Meera retains conversation history only while it is running. It streams responses from Ollama and formats Markdown/code directly in the terminal. Questions that require fresh information are enriched with either the local clock or the isolated `DuckDuckGoSearchProvider`; the live context is given to Qwen and sources are shown for web answers. If a web search fails, Meera says so instead of attempting a current answer.

Interactive terminal keys: `↑`/`↓` prompt history, `Ctrl+C` cancels a response (or exits when idle), and `Ctrl+L` redraws the terminal. The conversation remains in the terminal's normal scrollback.

## Commands

`/help`, `/clear`, `/status`, `/model`, `/exit`
