import { OLLAMA_URL } from "./config.js";

function endpoint(path) {
  return `${OLLAMA_URL}${path}`;
}

export async function getOllamaStatus(model) {
  const response = await fetch(endpoint("/api/tags"), { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  const data = await response.json();
  const available = data.models?.some((item) => item.name === model) ?? false;
  return { available, models: data.models ?? [] };
}

// Streams only the generated text. The Ollama API returns newline-delimited JSON.
export async function streamChat(messages, model, onToken, { signal } = {}) {
  const response = await fetch(endpoint("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.error) throw new Error(event.error);
      const token = event.message?.content ?? "";
      answer += token;
      onToken(token);
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    if (event.error) throw new Error(event.error);
    const token = event.message?.content ?? "";
    answer += token;
    onToken(token);
  }
  return answer;
}
