// Dependency-free tests for browser-side OpenAI-compatible provider helpers.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "../web/node_modules/typescript/lib/typescript.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function importTypeScriptModule(rel) {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const providerModule = await importTypeScriptModule("web/src/services/llmProvider.ts");
const T = providerModule.__llmProviderForTests;

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

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  assert.equal(url, "https://example.internal/v1/models");
  assert.equal(init.method, "GET");
  assert.equal(init.headers.Authorization, "Bearer sk-test");
  return {
    ok: true,
    status: 200,
    async json() {
      return { data: [{ id: "model-a" }, { id: "model-b" }] };
    },
  };
};

const result = await providerModule.testProviderConnection({
  provider: "openai-compatible",
  base_url: "example.internal/v1/",
  api_key: "sk-test",
});
assert.equal(result.ok, true);
assert.equal(result.model_count, 2, "OpenAI-compatible /models data array is counted");
globalThis.fetch = originalFetch;

console.log("test_llm_provider: browser provider helper assertions passed");
