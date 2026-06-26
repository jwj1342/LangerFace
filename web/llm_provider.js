export function normalizeProviderBaseUrl(baseUrl = "") {
  const clean = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!clean) return "";
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(clean) || clean.startsWith("/")) return clean;
  if (/^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)(:\d+)?(\/|$)/i.test(clean)) {
    return `http://${clean}`;
  }
  return `https://${clean}`;
}

export function providerTestEndpointFor(providerConfig = {}) {
  const clean = normalizeProviderBaseUrl(providerConfig.base_url);
  if (!clean) return "";
  return `${clean}/models`;
}

export async function testProviderConnection(providerConfig = {}, { timeoutMs = 5000 } = {}) {
  const testEndpoint = providerTestEndpointFor(providerConfig);
  if (!testEndpoint) throw new Error("LLM Provider Base URL is empty");
  const mode = "openai-compatible";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = { Accept: "application/json" };
  if (providerConfig.api_key) {
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

export const __llmProviderForTests = {
  normalizeProviderBaseUrl,
  providerTestEndpointFor,
};
