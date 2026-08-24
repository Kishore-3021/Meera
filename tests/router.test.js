import { routeIntent } from "../src/router.js";
import { getRecentDecisions } from "../src/db.js";

const testCases = [
  // 1. General Chat
  { input: "Hello, who are you and how can you help me?", expected: "chat" },
  { input: "Explain how quicksort works in simple terms", expected: "chat" },
  { input: "What is 15% of 850?", expected: "chat" },
  { input: "Write a short haiku about rain", expected: "chat" },

  // 2. Web Search
  { input: "What is the current price of ASUS TUF Gaming F16 laptop?", expected: "web_search" },
  { input: "Who won the latest Premier League match yesterday?", expected: "web_search" },
  { input: "Search for the newest features in Node.js 24", expected: "web_search" },
  { input: "What is the weather today in Hyderabad?", expected: "web_search" },

  // 3. Code Task
  { input: "Can you refactor src/web-search.js to handle retry logic?", expected: "code_task" },
  { input: "Fix the syntax error in my Python script", expected: "code_task" },
  { input: "Run git status and show uncommitted changes", expected: "code_task" },
  { input: "Write a unit test for the router function", expected: "code_task" },

  // 4. Memory Lookup
  { input: "Remember that my name is Kraven and I prefer dark theme", expected: "memory_lookup" },
  { input: "What did I tell you about my preferred programming language?", expected: "memory_lookup" },
  { input: "Save this note: project deadline is next Friday", expected: "memory_lookup" },
  { input: "Recall my project settings from last session", expected: "memory_lookup" },

  // 5. Vision Task
  { input: "Take a screenshot and tell me what error is shown on screen", expected: "vision_task" },
  { input: "Look at my screen and guide me through the next step", expected: "vision_task" },
  { input: "Read the code currently visible in my VS Code window", expected: "vision_task" },
  { input: "Is the submit button visible on my display?", expected: "vision_task" }
];

async function runTests() {
  console.log("==================================================");
  console.log(" Running Phase 1 Intent Router Test Suite (20 Cases)");
  console.log("==================================================\n");

  let passed = 0;
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const res = await routeIntent(tc.input);
    const isPass = res.intent === tc.expected;
    if (isPass) passed++;

    const statusMark = isPass ? "✓ PASS" : "✗ FAIL";
    console.log(`[${String(i + 1).padStart(2, "0")}/20] ${statusMark} | Input: "${tc.input}"`);
    console.log(`         → Routed: ${res.intent} (conf: ${(res.confidence * 100).toFixed(0)}%, ${res.executionMs}ms) | Expected: ${tc.expected}\n`);
  }

  const accuracy = (passed / testCases.length) * 100;
  console.log("==================================================");
  console.log(` Final Result: ${passed}/${testCases.length} Passed (${accuracy.toFixed(1)}% Accuracy)`);
  console.log("==================================================\n");

  const recent = getRecentDecisions(5);
  console.log("Recent 5 Decisions in SQLite `routing_decisions`:");
  console.table(recent);

  if (accuracy < 90.0) {
    console.error("Phase 1 Exit Criteria Failed: Accuracy < 90%");
    process.exit(1);
  } else {
    console.log("Phase 1 Exit Criteria Met (≥90% Accuracy)!");
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
