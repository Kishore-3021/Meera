import {
  getLatestInProgressSession as readLatestInProgressSession,
  setSessionStatus,
  upsertSessionState,
} from "./db.js";

function safeHistory(history) {
  const entries = Array.isArray(history) ? history : [];
  return entries.slice(-50).map((entry) => ({
    step: Number(entry.step) || 0,
    tool: entry.tool ?? "",
    description: entry.description ?? "",
    success: Boolean(entry.success),
    verified: entry.verified !== false,
    skipped: Boolean(entry.skipped),
    output: entry.output == null ? null : String(entry.output).slice(0, 500),
    error: entry.error == null ? null : String(entry.error).slice(0, 500),
  }));
}

function parseHistory(value) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function checkpointSession({
  taskId,
  goalDescription,
  currentStep,
  stepHistory,
  resumable,
  status = "in_progress",
}) {
  if (!taskId || !goalDescription) return;
  upsertSessionState({
    taskId,
    goalDescription,
    currentStep: Number(currentStep) || 0,
    stepHistory: safeHistory(stepHistory),
    resumable: Boolean(resumable),
    status,
  });
}

export function completeSession(taskId, status = "completed") {
  if (!taskId) return;
  setSessionStatus(taskId, status);
}

export function getLatestInProgressSession() {
  const row = readLatestInProgressSession();
  if (!row) return null;
  return {
    taskId: row.task_id,
    goalDescription: row.goal_description,
    currentStep: Number(row.current_step) || 0,
    stepHistory: parseHistory(row.step_history),
    resumable: Boolean(row.resumable),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
