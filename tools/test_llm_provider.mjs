// Dependency-free tests for agent SSE trace parsing.
import assert from "node:assert/strict";
import { __llmProviderForTests as T, streamEndpointFor } from "../web/llm_provider.js";

assert.equal(
  streamEndpointFor("/api/agentic-incision"),
  "/api/agentic-incision/stream",
  "stream endpoint appends /stream",
);
assert.equal(
  streamEndpointFor("/api/agentic-incision/stream"),
  "/api/agentic-incision/stream",
  "stream endpoint is idempotent",
);
assert.equal(
  T.providerTestEndpointFor({ provider: "ollama", base_url: "http://127.0.0.1:11434" }),
  "http://127.0.0.1:11434/api/tags",
  "Ollama native connectivity test uses /api/tags",
);
assert.equal(
  T.providerTestEndpointFor({ provider: "openai-compatible", base_url: "https://example.internal/v1/" }),
  "https://example.internal/v1/models",
  "OpenAI-compatible connectivity test uses /models",
);

const parsed = T.parseSseBlock("event: trace\ndata: {\"index\":0,\"action\":\"query_rstl_direction\"}");
assert.equal(parsed.event, "trace", "SSE parser reads event name");
assert.equal(parsed.data.action, "query_rstl_direction", "SSE parser parses JSON data");

const events = [];
let rest = T.drainSseBuffer(
  [
    "event: provider",
    "data: {\"mode\":\"openai-compatible\",\"model\":\"Qwen\"}",
    "",
    "event: trace",
    "data: {\"index\":0,\"action\":\"classify_region\"}",
    "",
    "event: result",
    "data: {\"ok\":true}",
    "",
    "event: trace",
    "data: {\"index\":1",
  ].join("\n"),
  (evt) => events.push(evt),
);
assert.equal(events.length, 3, "complete SSE events are emitted");
assert.equal(events[0].event, "provider");
assert.equal(events[1].data.action, "classify_region");
assert.equal(events[2].event, "result");
assert.ok(rest.includes("index"), "partial SSE block remains buffered");

rest = T.drainSseBuffer(`${rest},\"action\":\"query_rstl_direction\"}\n\n`, (evt) => events.push(evt));
assert.equal(rest, "", "completed partial block is drained");
assert.equal(events[3].data.action, "query_rstl_direction");

console.log("test_llm_provider: SSE trace parser assertions passed");
