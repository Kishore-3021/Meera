/**
 * Permission gate for Meera's Windows agent.
 *
 * Levels:
 *   read        — runs silently, no side effects
 *   write       — reversible side effect, runs silently
 *   destructive — irreversible; REQUIRES explicit user Y/N confirmation
 *
 * The `confirmDestructive` callback is injected at startup from terminal-ui.
 */

export const PERMISSION = {
  READ: "read",
  WRITE: "write",
  DESTRUCTIVE: "destructive",
};

/** @type {((description: string, toolId: string) => Promise<boolean>) | null} */
let _confirmCallback = null;

/**
 * Register the UI confirmation callback (called once at startup from index.js).
 * @param {(description: string, toolId: string) => Promise<boolean>} fn
 */
export function setConfirmCallback(fn) {
  _confirmCallback = fn;
}

/**
 * Check permission and (for destructive ops) request user confirmation.
 * @param {Object} tool
 * @param {Object} [params] — step params, used to render confirmDescription
 * @returns {{ allowed: boolean, reason?: string }}
 */
export async function checkPermission(tool, params = {}) {
  const level = tool.permissionLevel ?? PERMISSION.READ;

  if (level === PERMISSION.READ || level === PERMISSION.WRITE) {
    return { allowed: true };
  }

  if (level === PERMISSION.DESTRUCTIVE) {
    if (!_confirmCallback) {
      // No UI registered — fail safe: deny
      return { allowed: false, reason: "No confirmation handler registered. Destructive operation denied." };
    }
    const raw = tool.confirmDescription;
    const description =
      typeof raw === "function" ? raw(params) : raw || `Run destructive tool: ${tool.id}`;
    const confirmed = await _confirmCallback(description, tool.id);
    if (!confirmed) return { allowed: false, reason: "User declined." };
    return { allowed: true };
  }

  return { allowed: false, reason: `Unknown permission layer: ${level}` };
}
