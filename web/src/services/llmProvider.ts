export interface ProviderConfig {
  provider?: string;
  base_url?: string;
  model?: string;
  api_key?: string;
  timeout_s?: number;
}

export interface ProviderConnectionResult {
  ok: boolean;
  mode: string;
  test_endpoint: string;
  status: number;
  model_count?: number;
  [key: string]: unknown;
}

export interface ProviderConnectionOptions {
  timeoutMs?: number;
}

export function normalizeProviderBaseUrl(baseUrl = ""): string {
  const clean = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!clean) return "";
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(clean) || clean.startsWith("/")) return clean;
  if (/^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)(:\d+)?(\/|$)/i.test(clean)) {
    return `http://${clean}`;
  }
  return `https://${clean}`;
}

export function providerTestEndpointFor(providerConfig: ProviderConfig = {}): string {
  const clean = normalizeProviderBaseUrl(providerConfig.base_url);
  if (!clean) return "";
  return `${clean}/models`;
}

function modelCountFromResponse(data: Record<string, unknown>): number | undefined {
  if (Array.isArray(data.models)) return data.models.length;
  if (Array.isArray(data.data)) return data.data.length;
  return undefined;
}

export async function testProviderConnection(
  providerConfig: ProviderConfig = {},
  { timeoutMs = 5000 }: ProviderConnectionOptions = {},
): Promise<ProviderConnectionResult> {
  const testEndpoint = providerTestEndpointFor(providerConfig);
  if (!testEndpoint) throw new Error("LLM Provider Base URL is empty");
  const mode = "openai-compatible";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (providerConfig.api_key) {
    headers.Authorization = `Bearer ${providerConfig.api_key}`;
  }
  try {
    const resp = await fetch(testEndpoint, {
      method: "GET",
      headers,
      signal: ctrl.signal,
    });
    const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
    const error = typeof data.error === "string"
      ? data.error
      : typeof (data.error as { message?: unknown } | undefined)?.message === "string"
        ? (data.error as { message: string }).message
        : "";
    if (!resp.ok) throw new Error(error || `provider ${resp.status}`);
    return {
      ok: true,
      mode,
      test_endpoint: testEndpoint,
      status: resp.status,
      model_count: modelCountFromResponse(data),
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
