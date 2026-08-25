// End-to-end test of the general Windows computer-control layer
import { detectCapabilities, getAvailableTools } from './src/tools/registry.js';
import { planTask } from './src/tools/planner.js';
import { executeAgentPlan } from './src/tools/agent-loop.js';
import { setConfirmCallback } from './src/tools/permissions.js';

setConfirmCallback(async (description) => {
  console.log(`  [CONFIRM REQUIRED] ${description}`);
  return true; // auto-confirm for testing
});

const available = await detectCapabilities();
console.log(`Registry: ${available.length} tools available\n`);

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
    onStepDone: (s, r) => console.log(`  ${r.success ? '✓' : '✗'} ${r.success ? (r.output ?? 'done') : r.error}`.split('\n').join('\n    ')),
    onStepError: (s, e) => console.log(`  ✗ Step ${s}: ${e}`),
  });

  const ok = results.filter((r) => r.success).length;
  console.log(`  RESULT: ${ok}/${results.length} steps succeeded`);
}

// ── Read-only / verification-heavy tasks ──
await run("get system info");
await run("what GPU do I have");
await run("check my Wi-Fi status");
await run("list bluetooth devices");
await run("how much volume is set right now");

// ── Action + verify ──
await run("set volume to 40%");
await run("set volume to 65%");
await run("unmute the audio");

// ── Discovery-based app launch ──
await run("open Obsidian");
await run("open Docker Desktop");

// ── Multi-step decomposition ──
await run("open Notepad and type hello world");
await run("take a screenshot named meera-e2e-test");

// ── File operations on real Desktop ──
await run("create a folder called MeeraTest on my Desktop and write a file hello.txt inside it with content written by Meera");
await run("read the file ~/Desktop/MeeraTest/hello.txt");
await run("delete the folder ~/Desktop/MeeraTest"); // destructive → confirm callback fires

console.log('\nDONE');