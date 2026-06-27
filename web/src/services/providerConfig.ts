import { normalizeProviderBaseUrl, type ProviderConfig } from "./llmProvider";

export const PROVIDER_STORAGE_KEY = "langerface.incision.provider";
export const DEFAULT_PROVIDER_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_PROVIDER_MODEL = "gpt-4.1-mini";
export const DEFAULT_PROVIDER_TIMEOUT_S = 60;

export interface StoredProviderConfig {
  provider?: string;
  base_url?: string;
  model?: string;
  timeout_s?: number;
}

export interface ProviderInitialState {
  baseUrl: string;
  model: string;
  timeoutS: number;
}

type ProviderReadableStorage = Pick<Storage, "getItem">;
type ProviderWritableStorage = Pick<Storage, "setItem">;
type ProviderBrowserStorage = ProviderReadableStorage & ProviderWritableStorage;
type ProviderBrowserLocation = Pick<Location, "hostname" | "origin" | "protocol">;

export function browserProviderStorage(): ProviderBrowserStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function browserProviderLocation(): ProviderBrowserLocation | null {
  if (typeof window === "undefined") return null;
  try {
    return window.location;
  } catch {
    return null;
  }
}

export function normalizeHost(host = "") {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

export function isLoopbackHost(host = "") {
  const h = normalizeHost(host);
  return h === "" || h === "localhost" || h === "0.0.0.0" || h === "::1" || /^127(?:\.\d{1,3}){3}$/.test(h);
}

export function isPrivateNetworkHost(host = "") {
  const h = normalizeHost(host);
  if (isLoopbackHost(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".lan")) return true;
  const parts = h.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function providerUrlFromConfig(cfg: ProviderConfig) {
  try {
    return new URL(cfg.base_url || "");
  } catch {
    return null;
  }
}

export function isDeprecatedNativeProviderConfig(baseUrl = "", model = "") {
  const base = String(baseUrl || "").trim().toLowerCase();
  const name = String(model || "").trim().toLowerCase();
  const deprecatedPort = 11000 + 434;
  const deprecatedPath = ["api", "tags"].join("/");
  const deprecatedModel = ["qwen3", "8b"].join(":");
  return base.includes(`:${deprecatedPort}`) || base.includes(`/${deprecatedPath}`) || name === deprecatedModel;
}

export function readStoredProvider(storage: ProviderReadableStorage | null = browserProviderStorage()): StoredProviderConfig {
  if (!storage) return {};
  try {
    return JSON.parse(storage.getItem(PROVIDER_STORAGE_KEY) || "{}") as StoredProviderConfig;
  } catch {
    return {};
  }
}

export function initialProviderState(storage: ProviderReadableStorage | null = browserProviderStorage()): ProviderInitialState {
  const stored = readStoredProvider(storage);
  const baseUrl = stored.base_url && !isDeprecatedNativeProviderConfig(stored.base_url, "")
    ? stored.base_url
    : DEFAULT_PROVIDER_BASE_URL;
  const model = stored.model && !isDeprecatedNativeProviderConfig("", stored.model)
    ? stored.model
    : DEFAULT_PROVIDER_MODEL;
  return {
    baseUrl,
    model,
    timeoutS: Number(stored.timeout_s) || DEFAULT_PROVIDER_TIMEOUT_S,
  };
}

export function saveProviderPrefs(
  cfg: ProviderConfig,
  storage: ProviderWritableStorage | null = browserProviderStorage(),
) {
  if (!storage) return;
  storage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify({
    provider: "openai-compatible",
    base_url: normalizeProviderBaseUrl(cfg.base_url || ""),
    model: cfg.model || "",
    timeout_s: cfg.timeout_s || DEFAULT_PROVIDER_TIMEOUT_S,
  }));
}

export function redactedProviderConfig(cfg: ProviderConfig): ProviderConfig {
  return {
    ...cfg,
    api_key: cfg.api_key ? "[redacted]" : "",
  };
}

export function localProviderFromRemotePageMessage(
  cfg: ProviderConfig,
  location: Pick<Location, "hostname" | "origin"> | null = browserProviderLocation(),
) {
  const url = providerUrlFromConfig(cfg);
  if (!location) return "";
  if (!url || isLoopbackHost(location.hostname) || !isLoopbackHost(url.hostname)) return "";
  return `当前页面来自 ${location.origin}，${url.host} 指的是打开浏览器这台机器，不是 Vercel 或远端 Provider。系统会继续发送测试请求；如果 DevTools 显示 CORS/Private Network 拦截，请改填一个允许该 origin 访问的 HTTPS Provider 地址。`;
}

export function insecureProviderFromSecurePageMessage(
  cfg: ProviderConfig,
  location: Pick<Location, "protocol"> | null = browserProviderLocation(),
) {
  const url = providerUrlFromConfig(cfg);
  if (!location) return "";
  if (!url || location.protocol !== "https:" || url.protocol !== "http:" || isLoopbackHost(url.hostname)) return "";
  const networkLabel = isPrivateNetworkHost(url.hostname) ? "HTTP 私网地址" : "HTTP Provider 地址";
  return `当前页面是 HTTPS，但 Provider 是 ${networkLabel} ${url.origin}；浏览器会按 Mixed Content/Private Network 规则拦截。只改成局域网 IP 不够，请改用 HTTPS 反向代理或隧道后的 Provider 地址。`;
}
