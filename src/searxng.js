import { spawn } from "node:child_process";

export const SEARXNG_URL = "http://127.0.0.1:8080";
const CONTAINER_NAME = "meera-searxng";

export async function getSearxngStatus() {
  try {
    const response = await fetch(`${SEARXNG_URL}/config`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return { reachable: false };
    const config = await response.json();
    return { reachable: true, instanceName: config.instance_name ?? "SearXNG" };
  } catch {
    return { reachable: false };
  }
}

function startExistingContainer() {
  return new Promise((resolve) => {
    const child = spawn("docker", ["start", CONTAINER_NAME], { windowsHide: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

// The container is created during setup. This only restarts that local source
// instance when Meera needs web search; it never pulls an external SearXNG image.
export async function ensureSearxng() {
  if ((await getSearxngStatus()).reachable) return true;
  if (!(await startExistingContainer())) return false;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if ((await getSearxngStatus()).reachable) return true;
  }
  return false;
}
