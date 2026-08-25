import { planTask } from './src/tools/planner.js';
import { executeAgentPlan, buildResultContext } from './src/tools/agent-loop.js';
import { detectCapabilities } from './src/tools/registry.js';
import { setConfirmCallback } from './src/tools/permissions.js';

setConfirmCallback(async (description) => {
  console.log(`  [CONFIRM] ${description}`);
  return true;
});

async function testAgentTask(task) {
  console.log(`\n========== Testing: "${task}" ==========\n`);
  await detectCapabilities();
  
  const plan = await planTask(task, { history: [] });
  console.log('Plan:', JSON.stringify(plan, null, 2));
  
  if (!plan || plan.length === 0) {
    console.log('No plan generated (chat-only task)');
    return;
  }
  
  console.log('\n--- Executing ---');
  const results = await executeAgentPlan(plan, {
    onStepStart: (step, total, description) => console.log(`  ◐ [${step}/${total}] ${description}`),
    onStepDone: (step, result) => {
      const status = result.success ? '✓' : '✗';
      console.log(`  ${status} Step ${step}: ${result.output || result.error || 'done'}`);
    },
    onStepError: (step, error) => console.log(`  ✗ Step ${step} failed: ${error}`)
  });
  
  console.log('\n--- Result Context ---');
  console.log(buildResultContext(results, task));
}

await testAgentTask("list files on Desktop");