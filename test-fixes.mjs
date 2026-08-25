// Re-test the five fixed failures
import { detectCapabilities } from './src/tools/registry.js';
import { planTask } from './src/tools/planner.js';
import { executeAgentPlan } from './src/tools/agent-loop.js';
import { setConfirmCallback } from './src/tools/permissions.js';

setConfirmCallback(async (description) => {
  console.log(`  [CONFIRM REQUIRED] ${description}`);
  return true;
});

await detectCapabilities();

async function run(task) {
  console.log(`\n========== TASK: "${task}" ==========`);

  const plan = await planTask(task);
  if (!plan.length) {
    console.log('  (planner: no tools needed — chat path)');
    return;
  }
  console.log('  Plan:', plan.map((p) => p.tool).join(' → '));

  const results = await executeAgentPlan(plan, {
    onStepStart: (s, t, d) => console.log(`  ◐ [${s}/${t}] ${d}`),
    onStepDone: (s, r) => console.log(`  ${r.success ? '✓' : '✗'} ${(r.success ? r.output : r.error) ?? 'done'}`.split('\n').join('\n    ')),
    onStepError: (s, e) => console.log(`  ✗ Step ${s}: ${e}`),
  });

  const ok = results.filter((r) => r.success).length;
  console.log(`  RESULT: ${ok}/${results.length} steps succeeded`);
}

await run("list bluetooth devices");
await run("open Docker Desktop");
await run("open Notepad and type hello world");
await run("create a folder called MeeraTest on my Desktop and write a file hello.txt inside it with content written by Meera");
await run("read the file ~/Desktop/MeeraTest/hello.txt");
await run("delete the folder ~/Desktop/MeeraTest");

console.log('\nDONE');