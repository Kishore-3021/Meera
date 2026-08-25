import { planTask } from './src/tools/planner.js';

async function testPlanner(task) {
  console.log(`\n=== Testing Planner: "${task}" ===`);
  const plan = await planTask(task, { history: [] });
  console.log('Plan:', JSON.stringify(plan, null, 2));
}

await testPlanner("open Notepad");
await testPlanner("set volume to 50%");
await testPlanner("take a screenshot");
await testPlanner("list files on Desktop");
await testPlanner("check Wi-Fi status");
await testPlanner("open Chrome and go to github.com");