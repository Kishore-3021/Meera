import { OLLAMA_URL, DEFAULT_MODEL } from './src/config.js';
import { getToolSchema } from './src/tools/registry.js';

const PLANNER_SYSTEM_PROMPT = `You are Meera's Task Planner. Your ONLY job is to decompose the user's task into an ordered list of tool calls.

You have access to a set of tools. For each task:
1. Identify the minimal sequence of tool calls needed to complete the task.
2. Return ONLY a JSON array — no explanation, no markdown.
3. Each step MUST have: { "step": number, "tool": "tool.id", "params": {}, "description": "what this step does" }
4. If the task can be answered with chat/knowledge alone (no tools needed), return: []
5. Keep plans concise — do not add unnecessary steps.
6. Use exact tool IDs from the schema.

TOOL SCHEMA (available tools):
{TOOLS}

OUTPUT FORMAT: JSON array only, no markdown:
[
  { "step": 1, "tool": "tool.id", "params": { "param": "value" }, "description": "..." },
  { "step": 2, "tool": "tool.id", "params": {}, "description": "..." }
]

Or for chat-only tasks:
[]`;

async function testPlanner(task) {
  const schema = getToolSchema();
  const toolText = schema.map((t) =>
    `• ${t.id} [${t.permissionLevel}]: ${t.description}\n  Params: ${t.parameters.length ? t.parameters.join(", ") : "none"}`
  ).join("\n");

  const systemPrompt = PLANNER_SYSTEM_PROMPT.replace("{TOOLS}", toolText);
  const prompt = `Task: ${task}`;

  console.log(`\n=== Testing Planner: "${task}" ===`);
  console.log('System prompt length:', systemPrompt.length);
  
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      system: systemPrompt,
      prompt,
      format: "json",
      stream: false,
      options: { temperature: 0.0, num_predict: 512 },
    }),
  });

  if (response.ok) {
    const data = await response.json();
    console.log('Raw response:', data.response);
  } else {
    console.log('Error:', response.status, await response.text());
  }
}

await testPlanner("open Notepad");
await testPlanner("set volume to 50%");
await testPlanner("take a screenshot");