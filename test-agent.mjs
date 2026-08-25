import { planTask } from './src/tools/planner.js';
import { executeAgentPlan, buildResultContext } from './src/tools/agent-loop.js';
import { getToolSchema, detectCapabilities } from './src/tools/registry.js';
import { setConfirmCallback } from './src/tools/permissions.js';

// Mock confirmation callback for testing
setConfirmCallback(async (description) => {
  console.log(`  [CONFIRM] ${description}`);
  return true; // Auto-confirm for testing
});

async function testAgentTask(task) {
  console.log(`\n========== Testing: "${task}" ==========\n`);
  
  // Ensure capabilities are detected
  await detectCapabilities();
  
  // Plan
  console.log('--- Planning ---');
  const plan = await planTask(task, { history: [] });
  console.log('Plan:', JSON.stringify(plan, null, 2));
  
  if (!plan || plan.length === 0) {
    console.log('No plan generated (chat-only task)');
    return;
  }
  
  // Execute
  console.log('\n--- Executing ---');
  const results = await executeAgentPlan(plan, {
    onStepStart: (step, total, description) => {
      console.log(`  ◐ [${step}/${total}] ${description}`);
    },
    onStepDone: (step, result) => {
      const status = result.success ? '✓' : '✗';
      console.log(`  ${status} Step ${step}: ${result.output || result.error || 'done'}`);
    },
    onStepError: (step, error) => {
      console.log(`  ✗ Step ${step} failed: ${error}`);
    }
  });
  
  // Result context
  console.log('\n--- Result Context ---');
  const context = buildResultContext(results, task);
  console.log(context);
}

// Test cases
const tests = [
  "open Notepad",
  "set volume to 50%",
  "take a screenshot",
  "list files on Desktop",
  "get system info",
  "check Wi-Fi status",
  "open Chrome and go to github.com",
];

for (const test of tests) {
  await testAgentTask(test);
  console.log('\n');
}