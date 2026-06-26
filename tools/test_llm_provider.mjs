// Dependency-free tests for browser-side OpenAI-compatible provider helpers.
import assert from "node:assert/strict";
import { __llmProviderForTests as T } from "../web/llm_provider.js";

assert.equal(
  T.normalizeProviderBaseUrl("example.internal/v1/"),
  "https://example.internal/v1",
  "provider base URL gains https and trims trailing slash",
);
assert.equal(
  T.normalizeProviderBaseUrl("127.0.0.1:8000/v1/"),
  "http://127.0.0.1:8000/v1",
  "loopback provider base URL gains http",
);
assert.equal(
  T.providerTestEndpointFor({ provider: "openai-compatible", base_url: "https://example.internal/v1/" }),
  "https://example.internal/v1/models",
  "OpenAI-compatible connectivity test uses /models",
);
assert.equal(
  T.providerTestEndpointFor({ provider: "legacy-native", base_url: "https://example.internal/v1/" }),
  "https://example.internal/v1/models",
  "connectivity test always uses the single OpenAI-compatible /models contract",
);

console.log("test_llm_provider: browser provider helper assertions passed");
