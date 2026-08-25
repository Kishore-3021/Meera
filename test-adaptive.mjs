// Test adaptive multi-step execution
import { detectCapabilities } from './src/tools/registry.js';
import { runAdaptiveTask } from './src/tools/agent-loop.js';
import { setConfirmCallback } from './src/tools/permissions.js';

setConfirmCallback(async (description) => {
  console.log(`  [CONFIRM REQUIRED] ${description}`);
  return true;
});

await detectCapabilities();

async function run(task) {
  console.log(`\n========== ADAPTIVE: "${task}" ==========`);

  const results = await runAdaptiveTask(task, {
    onStepStart: (s, t, d) => console.log(`  ◐ [${s}] ${d}`),
    onStepDone: (s, r) => console.log(`  ✓ ${(r.output ?? 'done').split('\n')[0].slice(0, 100)}`),
    onStepError: (s, e) => console.log(`  ✗ ${e.slice(0, 100)}`),
  });

  const ok = results.filter((r) => r.success).length;
  console.log(`  RESULT: ${ok}/${results.length} steps succeeded`);
}

await run("open Notepad and type hello world");
await run("create a folder called MeeraAdaptive on my Desktop and write a file note.txt inside it containing the text adaptive works");
await run("read ~/Desktop/MeeraAdaptive/note.txt then delete the folder");

console.log('\nDONE');