import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(100);

const lastEventByTopic = new Map();

export function publish(topic, payload = {}) {
  const event = {
    topic,
    payload,
    timestamp: new Date().toISOString(),
  };
  lastEventByTopic.set(topic, event);
  bus.emit(topic, event);
  bus.emit("*", event);
  return event;
}

export function subscribe(topic, handler) {
  bus.on(topic, handler);
  return () => bus.off(topic, handler);
}

export function once(topic, handler) {
  bus.once(topic, handler);
}

export function getLastEvent(topic) {
  return lastEventByTopic.get(topic) ?? null;
}

export function getAwarenessCache() {
  return Object.fromEntries(lastEventByTopic.entries());
}
