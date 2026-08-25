import { detectCapabilities, getAvailableTools, getToolSummaryText, getToolSchema } from './src/tools/registry.js';

console.log('=== Detecting Capabilities ===');
const available = await detectCapabilities();
console.log('Available tools:', available.length);

console.log('\n=== Tool Schema ===');
const schema = getToolSchema();
for (const t of schema) {
  console.log(`  [${t.category}] ${t.id} (${t.permissionLevel}): ${t.description}`);
}

console.log('\n=== Tool Summary ===');
console.log(getToolSummaryText());