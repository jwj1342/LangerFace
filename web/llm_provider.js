export function streamEndpointFor(endpoint) {
  const clean = String(endpoint || "").trim().replace(/\/$/, "");
  if (!clean) return "";
  return clean.endsWith("/stream") ? clean : `${clean}/stream`;
}

export function providerTestEndpointFor(providerConfig = {}) {
  const mode = String(providerConfig.provider || "openai-compatible");
  const clean = String(providerConfig.base_url || "").trim().replace(/\/$/, "");
  if (!clean) return "";
  if (mode === "ollama") {
    return `${clean.replace(/\/api$/, "")}/api/tags`;
  }
  return `${clean}/models`;
}

export async function testProviderConnection(providerConfig = {}, { timeoutMs = 5000 } = {}) {
  const testEndpoint = providerTestEndpointFor(providerConfig);
  if (!testEndpoint) throw new Error("LLM Provider Base URL is empty");
  const mode = String(providerConfig.provider || "openai-compatible");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = { Accept: "application/json" };
  if (mode !== "ollama" && providerConfig.api_key) {
    headers.Authorization = `Bearer ${providerConfig.api_key}`;
  }
  try {
    const resp = await fetch(testEndpoint, {
      method: "GET",
      headers,
      signal: ctrl.signal,
    });
    const data = await resp.json().catch(() => ({}));
    const error = typeof data.error === "string" ? data.error : data.error?.message;
    if (!resp.ok) throw new Error(error || `provider ${resp.status}`);
    return {
      ok: true,
      mode,
      test_endpoint: testEndpoint,
      status: resp.status,
      model_count: Array.isArray(data.models) ? data.models.length : undefined,
      ...data,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseSseBlock(block) {
  const lines = String(block || "").split(/\r?\n/);
  let event = "message";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join("\n");
  let data = raw;
  try { data = JSON.parse(raw); } catch {
    // SSE data may be plain text for future providers.
  }
  return { event, data };
}

function drainSseBuffer(buffer, onEvent) {
  const parts = String(buffer || "").split(/\r?\n\r?\n/);
  const rest = parts.pop() || "";
  for (const block of parts) {
    const parsed = parseSseBlock(block);
    if (parsed) onEvent(parsed);
  }
  return rest;
}

async function requestAgentPlanStream(
  tumor,
  {
    endpoint,
    timeoutMs,
    providerConfig,
    onStreamEvent,
  },
) {
  const streamEndpoint = streamEndpointFor(endpoint);
  if (!streamEndpoint) throw new Error("agent endpoint is empty");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let result = null;
  try {
    const resp = await fetch(streamEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ tumor, provider_config: providerConfig }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || `agent stream ${resp.status}`);
    }
    if (!resp.body?.getReader) throw new Error("agent stream response has no readable body");

    const decoder = new TextDecoder();
    const reader = resp.body.getReader();
    let buffer = "";
    const emit = (evt) => {
      if (evt.event === "result" && evt.data && typeof evt.data === "object") result = evt.data;
      if (typeof onStreamEvent === "function") onStreamEvent(evt);
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = drainSseBuffer(buffer, emit);
    }
    buffer += decoder.decode();
    if (buffer.trim()) drainSseBuffer(`${buffer}\n\n`, emit);
    if (!result) throw new Error("agent stream completed without a result event");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestAgentPlan(
  tumor,
  {
    endpoint = "/api/agentic-incision",
    timeoutMs = 22000,
    providerConfig = null,
    stream = false,
    onStreamEvent = null,
  } = {},
) {
  if (stream) {
    try {
      return await requestAgentPlanStream(tumor, { endpoint, timeoutMs, providerConfig, onStreamEvent });
    } catch (err) {
      if (typeof onStreamEvent === "function") onStreamEvent({ event: "fallback", data: { error: err.message } });
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tumor, provider_config: providerConfig }),
      signal: ctrl.signal,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `agent server ${resp.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const __llmProviderForTests = {
  drainSseBuffer,
  parseSseBlock,
  providerTestEndpointFor,
  streamEndpointFor,
};
