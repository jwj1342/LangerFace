import { useCallback, useEffect, useMemo, useState } from "react";

import { normalizeProviderBaseUrl, testProviderConnection, type ProviderConfig } from "../../llm_provider.js";
import {
  initialProviderState,
  insecureProviderFromSecurePageMessage,
  localProviderFromRemotePageMessage,
  saveProviderPrefs,
} from "../services/providerConfig";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RangeInput } from "./ui/slider";
import { dispatchControllerEvent } from "../lib/controllerCommand";

const PROVIDER_REACT_STATE_EVENT = "langerface:incision-provider-react-state";
const DEFAULT_TEST_MESSAGE = "尚未测试 LLM Provider 连通性。Vercel 调试请填写可从浏览器访问、允许该 preview origin、并兼容 OpenAI /models 的 HTTPS Provider；候选生成不调用 Provider。";

type TestLevel = "" | "ok" | "warn";

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
      <Input id="providerMode" type="hidden" value="openai-compatible" readOnly />
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
        <Label htmlFor="providerTimeout">LLM timeout 秒 <span id="providerTimeoutVal" className="val">{timeoutS}</span></Label>
        <RangeInput
          id="providerTimeout"
          min="5"
          max="180"
          value={timeoutS}
          onChange={(event) => {
            setTimeoutS(Number(event.currentTarget.value));
            markChanged("Provider timeout 已修改，尚未重新测试连通性。");
          }}
        />
      </div>
      <Button variant="workbench" id="testProviderBtn" type="button" disabled={testing} onClick={testProvider}>
        {testing ? "正在测试…" : "测试 LLM Provider 连接"}
      </Button>
      <p className={`agent-note${testTone ? ` ${testTone}` : ""}`} id="providerTestState">{testState}</p>
      <p className="agent-note">生成候选时只执行浏览器内确定性 workflow；Provider 连接测试暂不参与切口几何或工具 trace。</p>
    </div>
  );
}
