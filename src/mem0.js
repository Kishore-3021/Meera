const MEM0_URL = process.env.MEM0_URL?.trim() || "";
const MEM0_API_KEY = process.env.MEM0_API_KEY?.trim() || "";
const MEM0_USER_ID = process.env.MEM0_USER_ID?.trim() || "meera-local-user";

function endpoint(path) {
  return `${MEM0_URL.replace(/\/+$/, "")}${path}`;
}

function headers() {
  return {
    "Content-Type": "application/json",
    ...(MEM0_API_KEY ? { Authorization: `Bearer ${MEM0_API_KEY}` } : {}),
  };
}

export function isMem0Configured() {
  return Boolean(MEM0_URL);
}

export async function mem0Search(query, limit = 5) {
  if (!isMem0Configured()) return { success: false, items: [], error: "Mem0 not configured" };
  try {
    const response = await fetch(endpoint("/v1/memories/search"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ query, user_id: MEM0_USER_ID, limit }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { success: false, items: [], error: `Mem0 HTTP ${response.status}` };
    const data = await response.json();
    const items = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
    return { success: true, items };
  } catch (error) {
    return { success: false, items: [], error: error.message };
  }
}

export async function mem0Remember(content, metadata = {}) {
  if (!isMem0Configured() || !content) return { success: false, error: "Mem0 not configured" };
  try {
    const response = await fetch(endpoint("/v1/memories"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        user_id: MEM0_USER_ID,
        messages: [{ role: "user", content: String(content).slice(0, 1500) }],
        metadata,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    return { success: response.ok, error: response.ok ? null : `Mem0 HTTP ${response.status}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
