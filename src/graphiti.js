const GRAPHITI_URL = process.env.GRAPHITI_URL?.trim() || "";
const GRAPHITI_API_KEY = process.env.GRAPHITI_API_KEY?.trim() || "";

export function isGraphitiConfigured() {
  return Boolean(GRAPHITI_URL);
}

export async function recordGraphitiReliabilityEvent(event) {
  if (!isGraphitiConfigured()) return { forwarded: false, reason: "Graphiti not configured" };
  try {
    const response = await fetch(`${GRAPHITI_URL.replace(/\/+$/, "")}/events/reliability`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(GRAPHITI_API_KEY ? { Authorization: `Bearer ${GRAPHITI_API_KEY}` } : {}),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return { forwarded: false, reason: `Graphiti HTTP ${response.status}` };
    }
    return { forwarded: true };
  } catch (error) {
    return { forwarded: false, reason: error.message };
  }
}
