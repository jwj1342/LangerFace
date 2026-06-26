import { useCallback, useEffect, useMemo, useState } from "react";

import { normalizeProviderBaseUrl, testProviderConnection, type ProviderConfig } from "../../llm_provider.js";
import { Input } from "./ui/input";
import { dispatchControllerEvent } from "../lib/controllerCommand";

const PROVIDER_STORAGE_KEY = "langerface.incision.provider";
const PROVIDER_REACT_STATE_EVENT = "langerface:incision-provider-react-state";
const DEFAULT_TEST_MESSAGE = "尚未测试 LLM Provider 连通性。Vercel 调试请填写可从浏览器访问、允许该 preview origin、并兼容 OpenAI /models 的 HTTPS Provider；候选生成不调用 Provider。";

type TestLevel = "" | "ok" | "warn";

interface StoredProviderConfig {
  provider?: string;
  base_url?: string;
  model?: string;
  timeout_s?: number;
}

function normalizeHost(host = "") {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function isLoopbackHost(host = "") {
  const h = normalizeHost(host);
  return h === "" || h === "localhost" || h === "0.0.0.0" || h === "::1" || /^127(?:\.\d{1,3}){3}$/.test(h);
}

function isPrivateNetworkHost(host = "") {
  const h = normalizeHost(host);
  if (isLoopbackHost(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".lan")) return true;
  const parts = h.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function providerUrlFromConfig(cfg: ProviderConfig) {
  try {
    return new URL(cfg.base_url || "");
  } catch {
    return null;
  }
}

function pageIsLocal() {
  return isLoopbackHost(window.location.hostname);
}

function localProviderFromRemotePageMessage(cfg: ProviderConfig) {
  const url = providerUrlFromConfig(cfg);
  if (!url || pageIsLocal() || !isLoopbackHost(url.hostname)) return "";
  return `当前页面来自 ${window.location.origin}，${url.host} 指的是打开浏览器这台机器，不是 Vercel 或远端 Provider。系统会继续发送测试请求；如果 DevTools 显示 CORS/Private Network 拦截，请改填一个允许该 origin 访问的 HTTPS Provider 地址。`;
}

function insecureProviderFromSecurePageMessage(cfg: ProviderConfig) {
  const url = providerUrlFromConfig(cfg);
  if (!url || window.location.protocol !== "https:" || url.protocol !== "http:" || isLoopbackHost(url.hostname)) return "";
  const networkLabel = isPrivateNetworkHost(url.hostname) ? "HTTP 私网地址" : "HTTP Provider 地址";
  return `当前页面是 HTTPS，但 Provider 是 ${networkLabel} ${url.origin}；浏览器会按 Mixed Content/Private Network 规则拦截。只改成局域网 IP 不够，请改用 HTTPS 反向代理或隧道后的 Provider 地址。`;
}

function isDeprecatedNativeProviderConfig(baseUrl = "", model = "") {
  const base = baseUrl.trim().toLowerCase();
  const name = model.trim().toLowerCase();
  const deprecatedPort = 11000 + 434;
  const deprecatedPath = ["api", "tags"].join("/");
  const deprecatedModel = ["qwen3", "8b"].join(":");
  return base.includes(`:${deprecatedPort}`) || base.includes(`/${deprecatedPath}`) || name === deprecatedModel;
}

function readStoredProvider(): StoredProviderConfig {
  try {
    return JSON.parse(localStorage.getItem(PROVIDER_STORAGE_KEY) || "{}") as StoredProviderConfig;
  } catch {
    return {};
  }
}

function initialProviderState() {
  const stored = readStoredProvider();
  const baseUrl = stored.base_url && !isDeprecatedNativeProviderConfig(stored.base_url, "")
    ? stored.base_url
    : "https://api.openai.com/v1";
  const model = stored.model && !isDeprecatedNativeProviderConfig("", stored.model)
    ? stored.model
    : "gpt-4.1-mini";
  return {
    baseUrl,
    model,
    timeoutS: Number(stored.timeout_s) || 60,
  };
}

function saveProviderPrefs(cfg: ProviderConfig) {
  localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify({
    provider: "openai-compatible",
    base_url: normalizeProviderBaseUrl(cfg.base_url || ""),
    model: cfg.model || "",
    timeout_s: cfg.timeout_s || 60,
  }));
}

function notifyController() {
  setTimeout(() => {
    dispatchControllerEvent(PROVIDER_REACT_STATE_EVENT, { source: "react_provider_panel" });
  }, 0);
}

export function ProviderConfigPanel() {
  const initial = useMemo(initialProviderState, []);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState("");
  const [timeoutS, setTimeoutS] = useState(initial.timeoutS);
  const [providerState, setProviderState] = useState("待运行");
  const [providerTone, setProviderTone] = useState<TestLevel>("");
  const [testState, setTestState] = useState(DEFAULT_TEST_MESSAGE);
  const [testTone, setTestTone] = useState<TestLevel>("");
  const [testing, setTesting] = useState(false);

  const providerConfig = useCallback((): ProviderConfig => {
    const cfg: ProviderConfig = {
      provider: "openai-compatible",
      base_url: normalizeProviderBaseUrl(baseUrl),
      model: model.trim(),
      timeout_s: timeoutS,
    };
    if (apiKey) cfg.api_key = apiKey;
    return cfg;
  }, [apiKey, baseUrl, model, timeoutS]);

  useEffect(() => {
    saveProviderPrefs(providerConfig());
    notifyController();
  }, [providerConfig]);

  function markChanged(message: string) {
    setProviderState("待运行");
    setProviderTone("");
    setTestState(message);
    setTestTone("");
    notifyController();
  }

  async function testProvider() {
    setTesting(true);
    setProviderState("测试中");
    setProviderTone("");
    setTestState("正在测试 LLM Provider 连接…");
    setTestTone("");
    notifyController();
    try {
      const cfg = providerConfig();
      const warnings = [localProviderFromRemotePageMessage(cfg), insecureProviderFromSecurePageMessage(cfg)].filter(Boolean);
      if (warnings.length) {
        setTestState(`${warnings.join(" ")} 正在继续发送测试请求…`);
        setTestTone("warn");
        notifyController();
      }
      const result = await testProviderConnection(cfg, {
        timeoutMs: Math.min(timeoutS * 1000, 10000),
      });
      const count = Number.isInteger(result.model_count) ? ` · 模型 ${result.model_count} 个` : "";
      setProviderState("OpenAI-compatible 已连接");
      setProviderTone("ok");
      setTestState(`Provider 连接正常：${result.test_endpoint}${count}`);
      setTestTone("ok");
    } catch (err) {
      const message = err instanceof Error
        ? err.name === "AbortError" ? "请求超时" : err.message
        : String(err);
      const networkHint = insecureProviderFromSecurePageMessage(providerConfig());
      setProviderState("Provider 未连接");
      setProviderTone("warn");
      setTestState(`Provider 连接失败：${message}。${networkHint || "请检查 Base URL、API Key、网络可达性、/models 兼容性和浏览器 CORS 设置。"}`);
      setTestTone("warn");
    } finally {
      setTesting(false);
      notifyController();
    }
  }

  return (
    <div className="card agent-grid">
      <div className="quality-top">
        <span>LLM Provider</span>
        <span id="providerState" className={`provider-state-${providerTone}`}>{providerState}</span>
      </div>
      <input id="providerMode" type="hidden" value="openai-compatible" readOnly />
      <p className="agent-note">Provider 类型固定为 OpenAI-compatible / vLLM。测试会请求 Base URL 下的 /models。</p>
      <Input
        id="providerBaseUrl"
        value={baseUrl}
        placeholder="https://your-provider.example/v1"
        onChange={(event) => {
          setBaseUrl(event.currentTarget.value);
          markChanged("Provider Base URL 已修改，尚未重新测试连通性。");
        }}
      />
      <Input
        id="providerModel"
        value={model}
        placeholder="模型名，如 gpt-4.1-mini 或 Qwen/Qwen3-14B"
        onChange={(event) => {
          setModel(event.currentTarget.value);
          markChanged("Provider 模型已修改，尚未重新测试连通性。");
        }}
      />
      <Input
        id="providerApiKey"
        type="password"
        value={apiKey}
        placeholder="API Key（Provider 需要时填写；导出会脱敏）"
        onChange={(event) => {
          setApiKey(event.currentTarget.value);
          markChanged("Provider API Key 已更新，尚未重新测试连通性。");
        }}
      />
      <div>
        <label className="field-label" htmlFor="providerTimeout">LLM timeout 秒 <span id="providerTimeoutVal" className="val">{timeoutS}</span></label>
        <input
          id="providerTimeout"
          type="range"
          min="5"
          max="180"
          value={timeoutS}
          onChange={(event) => {
            setTimeoutS(Number(event.currentTarget.value));
            markChanged("Provider timeout 已修改，尚未重新测试连通性。");
          }}
        />
      </div>
      <button className="btn" id="testProviderBtn" type="button" disabled={testing} onClick={testProvider}>
        {testing ? "正在测试…" : "测试 LLM Provider 连接"}
      </button>
      <p className={`agent-note${testTone ? ` ${testTone}` : ""}`} id="providerTestState">{testState}</p>
      <p className="agent-note">生成候选时只执行浏览器内确定性 workflow；Provider 连接测试暂不参与切口几何或工具 trace。</p>
    </div>
  );
}
