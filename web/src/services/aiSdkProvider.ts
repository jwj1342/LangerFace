import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { normalizeProviderBaseUrl, type ProviderConfig } from "./llmProvider.ts";

type AnyRecord = Record<string, any>;
const DEFAULT_PROVIDER_BASE_URL = "https://api.openai.com/v1";

export interface AiSdkSummaryOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface AiSdkSummaryResult {
  ok: boolean;
  llm: {
    summary: string;
    rationale: string;
    next_step: string;
    model: string;
    reasoning: string;
  };
  provider: {
    mode: "vercel_ai_sdk_openai_compatible_summary";
    model: string;
    base_url: string;
    sdk: "vercel_ai_sdk";
    raw_image_sent: false;
    raw_video_sent: false;
    deterministic_geometry: true;
    usage?: unknown;
    finish_reason?: unknown;
  };
}

function compactWarnings(guardrails: AnyRecord = {}) {
  return (Array.isArray(guardrails.warnings) ? guardrails.warnings : []).map((warning: AnyRecord) => ({
    code: warning.code || "",
    severity: warning.severity || "",
    message: warning.message || "",
  }));
}

function compactTrace(trace: AnyRecord[] = []) {
  return trace.map((step, index) => ({
    index,
    action: step?.action || "",
    summary: step?.summary || "",
  }));
}

export function shouldUseAiSdkSummary(config: ProviderConfig = {}): boolean {
  const baseURL = normalizeProviderBaseUrl(config.base_url || "");
  const model = String(config.model || "").trim();
  if (!baseURL || !model) return false;
  const defaultOpenAI = baseURL === normalizeProviderBaseUrl(DEFAULT_PROVIDER_BASE_URL);
  return Boolean(config.api_key || !defaultOpenAI);
}

export function buildIncisionAiSdkPrompt(result: AnyRecord = {}): string {
  const candidate = result.candidate || {};
  const tumor = result.tumor || {};
  const payload = {
    schema_version: "incision-ai-sdk-summary-input/v0.1",
    clinical_boundary: "Summarize deterministic engineering outputs only. Do not issue surgical instructions.",
    raw_image_sent: false,
    raw_video_sent: false,
    tumor: {
      kind: tumor.kind,
      diameter_mm: tumor.diameter_mm,
      depth_mm: tumor.depth_mm,
      margin_mm: tumor.margin_mm,
      boundary_mode: tumor.boundary_mode,
      boundary_point_count: Array.isArray(tumor.boundary) ? tumor.boundary.length : 0,
    },
    anatomy: {
      region: result.anatomy?.region,
      subunit: result.anatomy?.subunit,
      confidence: result.anatomy?.confidence,
      free_margin_distance_mm: result.anatomy?.free_margin_distance_mm,
      nearby_landmarks: result.anatomy?.nearby_landmarks || [],
    },
    direction: {
      source: result.direction?.source,
      confidence: result.direction?.confidence,
      angle_deg: result.direction?.angle_deg,
      support_count: result.direction?.support_count,
      angular_spread_deg: result.direction?.angular_spread_deg,
      confidence_reasons: result.direction?.confidence_reasons || [],
    },
    candidate: {
      id: candidate.id,
      type: candidate.type,
      length_mm: candidate.length_mm,
      width_mm: candidate.width_mm,
      tip_angle_deg: candidate.tip_angle_deg,
      direction_confidence: candidate.direction_confidence,
      metrics: candidate.metrics || {},
    },
    guardrails: {
      passed: result.guardrails?.passed === true,
      warnings: compactWarnings(result.guardrails),
      suggested_overrides: result.guardrails?.suggested_overrides || [],
    },
    candidate_comparison: Array.isArray(result.candidate_comparison)
      ? result.candidate_comparison.slice(0, 3)
      : [],
    trace: compactTrace(result.trace || []),
    required_output: {
      language: "Chinese",
      style: "concise clinician-review briefing",
      include: [
        "what deterministic workflow generated",
        "guardrail review points",
        "candidate comparison caveat",
        "next clinician action",
      ],
      exclude: [
        "new incision geometry",
        "surgical command",
        "raw image assumptions",
      ],
    },
  };
  return JSON.stringify(payload, null, 2);
}

export async function summarizeIncisionPlanWithAiSdk(
  result: AnyRecord,
  config: ProviderConfig,
  options: AiSdkSummaryOptions = {},
): Promise<AiSdkSummaryResult> {
  const baseURL = normalizeProviderBaseUrl(config.base_url || "");
  const modelId = String(config.model || "").trim();
  if (!baseURL) throw new Error("AI SDK Provider Base URL is empty");
  if (!modelId) throw new Error("AI SDK Provider model is empty");

  const provider = createOpenAICompatible({
    name: "langerface-openai-compatible",
    baseURL,
    apiKey: config.api_key || undefined,
    fetch: options.fetch,
  });

  const response = await generateText({
    model: provider(modelId),
    system: [
      "你是 LangerFace 的切口设计审计摘要器。",
      "只能解释浏览器确定性工具已经输出的结果。",
      "不能生成新的切口几何，不能替代医生审阅，不能给出手术指令。",
      "请用中文，简洁说明候选、guardrails、风险和下一步。",
    ].join("\n"),
    prompt: buildIncisionAiSdkPrompt(result),
    maxRetries: 0,
    timeout: options.timeoutMs,
  });

  const summary = response.text.trim() || result.llm?.summary || "确定性 workflow 已完成，请医生复核。";
  return {
    ok: true,
    llm: {
      summary,
      rationale: "Vercel AI SDK 仅基于浏览器确定性工具 trace 生成中文审阅摘要；不计算或修改切口几何。",
      next_step: result.llm?.next_step || "医生查看 trace、候选比较和 guardrails 后，编辑、确认或否决该候选。",
      model: modelId,
      reasoning: "",
    },
    provider: {
      mode: "vercel_ai_sdk_openai_compatible_summary",
      model: modelId,
      base_url: baseURL,
      sdk: "vercel_ai_sdk",
      raw_image_sent: false,
      raw_video_sent: false,
      deterministic_geometry: true,
      usage: response.usage,
      finish_reason: response.finishReason,
    },
  };
}

export const __aiSdkProviderForTests = {
  buildIncisionAiSdkPrompt,
  shouldUseAiSdkSummary,
};
