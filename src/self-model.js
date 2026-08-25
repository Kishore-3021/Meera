import {
  getToolReliabilityRow,
  listToolReliabilityRows,
  upsertToolReliabilityRow,
} from "./db.js";
import { publish } from "./event-bus.js";
import { recordGraphitiReliabilityEvent } from "./graphiti.js";

const WINDOW_SIZE = 20;

function parseWindow(value) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildSummary(row) {
  const rolling = parseWindow(row?.rolling_window);
  const successes = rolling.filter((entry) => entry.success).length;
  const total = rolling.length;
  const successRate = total > 0 ? successes / total : 1;
  return {
    toolName: row?.tool_name,
    successCount: Number(row?.success_count ?? 0),
    failureCount: Number(row?.failure_count ?? 0),
    lastFailureReason: row?.last_failure_reason ?? null,
    rollingWindow: rolling,
    sampleSize: total,
    recentSuccessRate: successRate,
    healthy: total < 5 ? true : successRate >= 0.5,
    updatedAt: row?.last_updated ?? null,
  };
}

export function getToolReliability(toolName) {
  const row = getToolReliabilityRow(toolName);
  if (!row) {
    return {
      toolName,
      successCount: 0,
      failureCount: 0,
      lastFailureReason: null,
      rollingWindow: [],
      sampleSize: 0,
      recentSuccessRate: 1,
      healthy: true,
      updatedAt: null,
    };
  }
  return buildSummary(row);
}

export function getToolReliabilitySnapshot(limit = 100) {
  return listToolReliabilityRows(limit).map(buildSummary);
}

export function getUnhealthyTools(threshold = 0.4, minSamples = 5) {
  return getToolReliabilitySnapshot()
    .filter((entry) => entry.sampleSize >= minSamples && entry.recentSuccessRate < threshold);
}

export function recordToolOutcome({
  toolName,
  success,
  verified,
  error = null,
}) {
  if (!toolName) return;
  const normalizedSuccess = Boolean(success) && verified !== false;
  const current = getToolReliability(toolName);
  const nextWindow = [...current.rollingWindow, {
    timestamp: new Date().toISOString(),
    success: normalizedSuccess,
    reason: normalizedSuccess ? null : (error ? String(error).slice(0, 500) : "Unknown failure"),
  }].slice(-WINDOW_SIZE);

  upsertToolReliabilityRow({
    toolName,
    successCount: current.successCount + (normalizedSuccess ? 1 : 0),
    failureCount: current.failureCount + (normalizedSuccess ? 0 : 1),
    lastFailureReason: normalizedSuccess ? current.lastFailureReason : (error ? String(error).slice(0, 500) : "Unknown failure"),
    rollingWindow: nextWindow,
  });

  const updated = getToolReliability(toolName);
  publish("tool.reliability.updated", {
    toolName,
    success: normalizedSuccess,
    recentSuccessRate: updated.recentSuccessRate,
    lastFailureReason: updated.lastFailureReason,
    sampleSize: updated.sampleSize,
  });
  recordGraphitiReliabilityEvent({
    toolName,
    success: normalizedSuccess,
    recentSuccessRate: updated.recentSuccessRate,
    error,
  });
}
