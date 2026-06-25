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

export function normalizeProviderBaseUrl(baseUrl?: string): string;

export function providerTestEndpointFor(providerConfig?: ProviderConfig): string;

export function testProviderConnection(
  providerConfig?: ProviderConfig,
  options?: { timeoutMs?: number },
): Promise<ProviderConnectionResult>;
