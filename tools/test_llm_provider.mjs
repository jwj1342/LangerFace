// Dependency-free tests for agent SSE trace parsing.
import assert from "node:assert/strict";
import { __llmProviderForTests as T, streamEndpointFor } from "../web/llm_provider.js";

assert.equal(
  streamEndpointFor("http://127.0.0.1:8765/api/agentic-incision"),
  "http://127.0.0.1:8765/api/agentic-incision/stream",
  "stream endpoint appends /stream",
);
assert.equal(
  streamEndpointFor("http://127.0.0.1:8765/api/agentic-incision/stream"),
  "http://127.0.0.1:8765/api/agentic-incision/stream",
  "stream endpoint is idempotent",
);
assert.equal(
  T.healthEndpointFor("http://127.0.0.1:8765/api/agentic-incision"),
  "http://127.0.0.1:8765/api/health",
  "health endpoint maps agent planning endpoint to /api/health",
);
assert.equal(
  T.healthEndpointFor("http://127.0.0.1:8765/api/agentic-incision/session/stream"),
  "http://127.0.0.1:8765/api/health",
  "health endpoint maps session stream endpoint to /api/health",
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
