export async function requestAgentPlan(tumor, { endpoint = "http://127.0.0.1:8765/api/agentic-incision", timeoutMs = 22000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tumor }),
      signal: ctrl.signal,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `agent server ${resp.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}
