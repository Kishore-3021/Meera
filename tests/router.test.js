import { routeIntent } from "../src/router.js";
import { getRecentDecisions } from "../src/db.js";
import { detectCapabilities } from "../src/tools/registry.js";

const singleTurnTestCases = [
  // 1. Chat & Self-Awareness
  { input: "Explain Python functions", expected: "chat" },
  { input: "Explain Python classes", expected: "chat" },
  { input: "What is a MOSFET?", expected: "chat" },
  { input: "My bad, Claude", expected: "chat" },
  { input: "what are you?", expected: "chat" },
  { input: "what model are you using?", expected: "chat" },
  { input: "what can you do?", expected: "chat" },
  { input: "what are you doing right now?", expected: "chat" },
  { input: "what did you just do?", expected: "chat" },

  // 2. Web Search
  { input: "What's the latest Ollama version?", expected: "web_search" },
  { input: "Search for OnePlus 15", expected: "web_search" },
  { input: "What's today's AI news?", expected: "web_search" },
  { input: "Check this on the internet", expected: "web_search" },
  { input: "Search the web for ASUS TUF F16 laptop price", expected: "web_search" },

  // 3. Memory Lookup
  { input: "What laptop do I have?", expected: "memory_lookup" },
  { input: "What did we discuss earlier?", expected: "memory_lookup" },
  { input: "Remember that my name is Kraven and I prefer dark theme", expected: "memory_lookup" },

  // 4. Code Task
  { input: "Fix this Python error", expected: "code_task" },
  { input: "Build a React component", expected: "code_task" },
  { input: "Create a React component", expected: "code_task" },
  { input: "Debug this project", expected: "code_task" },
  { input: "Run git status and check for unstaged changes", expected: "agent_task" },

  // 5. Vision Task
  { input: "Analyze this screenshot", expected: "vision_task" },
  { input: "What is shown on my screen?", expected: "vision_task" },
  { input: "Look at my display and guide me through the next step", expected: "vision_task" }
];

const localFirstTestCases = [
  { input: "What are my system specs?", expected: "agent_task" },
  { input: "How much RAM and CPU do I have?", expected: "agent_task" },
  { input: "What is my current volume?", expected: "agent_task" },
  { input: "Is my Wi-Fi connected?", expected: "agent_task" },
  { input: "Show my running processes", expected: "agent_task" },
];

const followUpTestCases = [
  {
    history: [
      { role: "user", content: "Tell me about the iPhone 17 Pro." },
      { role: "assistant", content: "The iPhone 17 Pro is Apple's upcoming flagship smartphone." }
    ],
    input: "What's its price?",
    expected: "web_search"
  }
];

async function runTests() {
  console.log("==========================================================");
  console.log(" Running Meera Test Suite (Intent Router + Self-Awareness)");
  console.log("==========================================================\n");

  await detectCapabilities();
  let passed = 0;
  const total = singleTurnTestCases.length + followUpTestCases.length + localFirstTestCases.length;

  for (let i = 0; i < singleTurnTestCases.length; i++) {
    const tc = singleTurnTestCases[i];
    const res = await routeIntent(tc.input);
    const isPass = res.intent === tc.expected;
    if (isPass) passed++;

    const statusMark = isPass ? "✓ PASS" : "✗ FAIL";
    console.log(`[${String(i + 1).padStart(2, "0")}/${total}] ${statusMark} | Input: "${tc.input}"`);
    console.log(`         → Routed: ${res.intent} (conf: ${(res.confidence * 100).toFixed(0)}%, path: ${res.executionPath}) | Expected: ${tc.expected}\n`);
  }

  for (let j = 0; j < localFirstTestCases.length; j++) {
    const tc = localFirstTestCases[j];
    const index = singleTurnTestCases.length + followUpTestCases.length + j + 1;
    const res = await routeIntent(tc.input);
    const isPass = res.intent === tc.expected && !res.needsSearch;
    if (isPass) passed++;
    console.log(`[${String(index).padStart(2, "0")}/${total}] ${isPass ? "✓ PASS" : "✗ FAIL"} | Local-first: "${tc.input}"`);
    console.log(`         → Routed: ${res.intent} (search: ${res.needsSearch}) | Expected: ${tc.expected}, no search\n`);
  }

  // Run contextual follow-up test
  for (let j = 0; j < followUpTestCases.length; j++) {
    const ftc = followUpTestCases[j];
    const index = singleTurnTestCases.length + j + 1;
    const res = await routeIntent(ftc.input, { history: ftc.history });
    const isPass = res.intent === ftc.expected;
    if (isPass) passed++;

    const statusMark = isPass ? "✓ PASS" : "✗ FAIL";
    console.log(`[${String(index).padStart(2, "0")}/${total}] ${statusMark} | Follow-up: "${ftc.input}" (context: iPhone 17 Pro)`);
    console.log(`         → Routed: ${res.intent} (conf: ${(res.confidence * 100).toFixed(0)}%, path: ${res.executionPath}) | Expected: ${ftc.expected}\n`);
  }

  const accuracy = (passed / total) * 100;
  console.log("==========================================================");
  console.log(` Final Result: ${passed}/${total} Passed (${accuracy.toFixed(1)}% Accuracy)`);
  console.log("==========================================================\n");

  const recent = getRecentDecisions(5);
  console.log("Recent 5 Decisions in SQLite `decisions` table:");
  console.table(recent);

  if (accuracy < 90.0) {
    console.error("Test Suite Failed: Accuracy < 90%");
    process.exit(1);
  } else {
    console.log("Test Suite Met (≥90% Accuracy)!");
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
