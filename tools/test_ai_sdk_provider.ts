// Browser-side Vercel AI SDK adapter contract checks.
import assert from "node:assert/strict";

import {
  __aiSdkProviderForTests as T,
  summarizeIncisionPlanWithAiSdk,
} from "../web/src/services/aiSdkProvider.ts";

const samplePlan = {
  tumor: {
    kind: "subcutaneous",
    diameter_mm: 12,
    depth_mm: 4,
    margin_mm: 0,
    boundary: [[0, 0, 0]],
    boundary_mode: "center_diameter",
  },
  anatomy: {
    region: "cheek",
    subunit: "midface",
    confidence: 0.72,
    nearby_landmarks: [],
  },
  direction: {
    source: "rstl_atlas_weighted_nearest",
    confidence: 0.81,
    angle_deg: 12,
  },
  candidate: {
    id: "linear_subcutaneous_candidate",
    type: "linear",
    length_mm: 15,
    metrics: { rstl_deviation_deg: 0 },
  },
  guardrails: {
    passed: true,
    warnings: [],
    suggested_overrides: [],
  },
  trace: [
    { action: "summarize_tumor_input_quality", summary: "检查肿物输入。" },
    { action: "linear_subcutaneous_incision", summary: "生成线性候选。" },
  ],
  llm: {
    next_step: "医生审阅。",
  },
};

assert.equal(
  T.shouldUseAiSdkSummary({ base_url: "https://api.openai.com/v1", model: "gpt-4.1-mini" }),
  false,
  "default OpenAI provider without key does not auto-call AI SDK",
);
assert.equal(
  T.shouldUseAiSdkSummary({ base_url: "https://example.internal/v1", model: "qwen", api_key: "" }),
  true,
  "custom OpenAI-compatible provider can omit API key",
);

const prompt = T.buildIncisionAiSdkPrompt(samplePlan);
assert.ok(prompt.includes("incision-ai-sdk-summary-input/v0.1"), "AI SDK prompt is versioned");
assert.ok(prompt.includes('"raw_image_sent": false'), "AI SDK prompt states raw images are not sent");
assert.ok(!prompt.includes("data:image"), "AI SDK prompt does not include raw image payloads");
assert.ok(prompt.includes("linear_subcutaneous_incision"), "AI SDK prompt includes deterministic tool trace actions");

let sawRequest = false;
const fakeFetch = async (url, init = {}) => {
  sawRequest = true;
  assert.match(String(url), /\/chat\/completions$/);
  assert.equal(init.method, "POST");
  const auth = typeof init.headers?.get === "function"
    ? init.headers.get("authorization")
    : init.headers?.Authorization || init.headers?.authorization;
  assert.equal(auth, "Bearer sk-test");
  const body = JSON.parse(String(init.body));
  assert.equal(body.model, "summary-model");
  assert.equal(body.messages.some((message) => String(message.content).includes("raw_image_sent")), true);
  return new Response(JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "summary-model",
    choices: [{
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: "已生成线性候选；guardrails 通过；下一步由医生审阅。",
      },
    }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 8,
      total_tokens: 18,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const result = await summarizeIncisionPlanWithAiSdk(
  samplePlan,
  {
    provider: "openai-compatible",
    base_url: "https://example.internal/v1",
    model: "summary-model",
    api_key: "sk-test",
  },
  { fetch: fakeFetch, timeoutMs: 1000 },
);

assert.equal(sawRequest, true, "AI SDK adapter sends a chat completion request");
assert.equal(result.ok, true);
assert.equal(result.provider.mode, "vercel_ai_sdk_openai_compatible_summary");
assert.equal(result.provider.raw_image_sent, false);
assert.equal(result.provider.deterministic_geometry, true);
assert.ok(result.llm.summary.includes("guardrails"), "AI SDK summary text is returned");

console.log("test_ai_sdk_provider: Vercel AI SDK adapter assertions passed");
