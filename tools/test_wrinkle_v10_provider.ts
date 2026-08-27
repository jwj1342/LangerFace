import assert from "node:assert/strict";
import { Readable } from "node:stream";

import proxyHandler from "../web/api/wrinkle-v10.mjs";
import {
  parseWrinkleV10ProviderCapability,
  parseWrinkleV10ProviderSession,
  wrinkleV10ProcessingLocationLabel,
  WRINKLE_V10_CHECKPOINT_SHA256,
  WRINKLE_V10_DETECTOR_VERSION,
  WRINKLE_V10_PROVIDER_SCHEMA,
} from "../web/src/services/personalized/wrinkleV10Provider.ts";

const capability = {
  schemaVersion: WRINKLE_V10_PROVIDER_SCHEMA,
  providerId: "remote-python-v10",
  detectorVersion: WRINKLE_V10_DETECTOR_VERSION,
  checkpointSha256: WRINKLE_V10_CHECKPOINT_SHA256,
  processingLocation: "remote_service" as const,
  ready: true as const,
};
assert.deepEqual(parseWrinkleV10ProviderCapability(capability), capability);
assert.equal(wrinkleV10ProcessingLocationLabel(capability, "example.test"), "远程 V10 服务");
assert.equal(wrinkleV10ProcessingLocationLabel({
  ...capability,
  providerId: "local-python-v10",
  processingLocation: "host_machine",
}, "127.0.0.1"), "当前电脑");
assert.throws(() => parseWrinkleV10ProviderCapability({
  ...capability,
  detectorVersion: "old-detector",
}), /版本或能力声明无效/);
assert.throws(() => parseWrinkleV10ProviderCapability({
  ...capability,
  checkpointSha256: "wrong-checkpoint",
}), /版本或能力声明无效/);

class FakeResponse {
  statusCode = 0;
  headers = new Map<string, string>();
  payload: any = null;

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  send(value: unknown) {
    this.payload = value;
    return this;
  }

  json(value: unknown) {
    this.payload = value;
    return this;
  }
}

function fakeRequest(method: string, body: Buffer = Buffer.alloc(0)) {
  const request = Readable.from(body.length ? [body] : [] as Buffer[]) as Readable & {
    method: string;
    headers: Record<string, string>;
  };
  request.method = method;
  request.headers = {
    host: "preview.example.test",
    origin: "https://preview.example.test",
    "user-agent": "synthetic-provider-test",
    "x-forwarded-for": "192.0.2.10",
    "x-forwarded-proto": "https",
  };
  return request;
}

process.env.WRINKLE_V10_SERVICE_URL = "https://v10.internal";
process.env.WRINKLE_V10_TICKET_SECRET = "ticket-secret-at-least-32-random-bytes";
process.env.WRINKLE_V10_ALLOWED_ORIGINS = "https://preview.example.test";
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify(capability), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url} ${init?.method || "GET"}`);
  };
  const healthResponse = new FakeResponse();
  await proxyHandler(fakeRequest("GET"), healthResponse);
  assert.equal(healthResponse.statusCode, 200);
  const session = parseWrinkleV10ProviderSession(healthResponse.payload);
  assert.equal(session.capability.detectorVersion, WRINKLE_V10_DETECTOR_VERSION);
  assert.equal(session.directDetectUrl, "https://v10.internal/v1/detect");
  assert.ok(session.accessToken?.includes("."));
  assert.equal(session.maximumRequestBytes, 32 * 1024 * 1024);
  assert.ok(JSON.stringify(healthResponse.payload).length < 4_096,
    "the Vercel ticket response must remain far below the platform body limit");

  const detectResponse = new FakeResponse();
  await proxyHandler(fakeRequest("POST", Buffer.from("synthetic")), detectResponse);
  assert.equal(detectResponse.statusCode, 405,
    "large image bodies must never enter the Vercel function");

  globalThis.fetch = async () => { throw new Error("upstream unavailable"); };
  const failedResponse = new FakeResponse();
  await proxyHandler(fakeRequest("GET"), failedResponse);
  assert.equal(failedResponse.statusCode, 502);
  assert.match(String(failedResponse.payload.error), /upstream unavailable/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("wrinkle V10 provider capability, proxy, auth and failure tests passed");
