import assert from "node:assert/strict";
import {
  detectCapabilities,
  formatRegistryDump,
  getRegistryHealth,
  getLocalToolMatch,
  getTool,
  validateToolParams,
} from "../src/tools/registry.js";

await detectCapabilities();

const health = getRegistryHealth();
assert.equal(health.consistent ?? true, true);
assert.ok(health.loaded > 0);
assert.match(formatRegistryDump(), new RegExp(`TOOLS \\(${health.loaded}/${health.registered} detected\\)`));

assert.equal(getLocalToolMatch("What are my system specs?")?.id, "system.info");
assert.equal(getLocalToolMatch("What is my current volume?")?.id, "system.volume.get");
assert.equal(getLocalToolMatch("Is my Wi-Fi connected?")?.id, "network.wifi.status");
assert.equal(getLocalToolMatch("Search the web for the latest Qwen model"), null);

const writeTool = getTool("files.write");
const writeValidation = await validateToolParams(writeTool, { path: "", content: "x" });
assert.equal(writeValidation.valid, false);

const volumeTool = getTool("system.volume.set");
const volumeValidation = await validateToolParams(volumeTool, { level: 140 });
assert.equal(volumeValidation.valid, false);

const unknownParameter = await validateToolParams(writeTool, { path: "Desktop\\x.txt", content: "x", typo: true });
assert.equal(unknownParameter.valid, false);

console.log(`Reliability checks passed: ${health.loaded} detected tools, local-first routing, and strict validation.`);
