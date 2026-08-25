import { getAwarenessSnapshot } from "./live-info.js";
import { publish } from "./event-bus.js";

const DEFAULT_INTERVAL_MS = Number(process.env.MEERA_AWARENESS_INTERVAL_MS || 10_000);

let timer = null;
let running = false;
let lastSnapshot = null;
let lastError = null;

function changed(prev, next, key) {
  if (!prev) return true;
  return JSON.stringify(prev[key]) !== JSON.stringify(next[key]);
}

function emitDiff(next) {
  if (changed(lastSnapshot, next, "networkOnline")) {
    publish("network.changed", { online: next.networkOnline, host: next.host });
  }
  if (changed(lastSnapshot, next, "services")) {
    publish("services.changed", next.services);
  }
  if (changed(lastSnapshot, next, "minuteKey")) {
    publish("clock.tick", { minuteKey: next.minuteKey, timeZone: next.timeZone });
  }
}

async function tick() {
  try {
    const next = await getAwarenessSnapshot();
    emitDiff(next);
    lastSnapshot = next;
    lastError = null;
    publish("awareness.snapshot.updated", next);
  } catch (error) {
    lastError = error.message;
    publish("awareness.snapshot.error", { error: error.message });
  }
}

export function getAwarenessState() {
  return {
    running,
    intervalMs: DEFAULT_INTERVAL_MS,
    lastSnapshot,
    lastError,
  };
}

export function startAwarenessLoop(intervalMs = DEFAULT_INTERVAL_MS) {
  if (running) return;
  running = true;
  void tick();
  timer = setInterval(() => { void tick(); }, Math.max(2_000, Number(intervalMs) || DEFAULT_INTERVAL_MS));
}

export function stopAwarenessLoop() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}
