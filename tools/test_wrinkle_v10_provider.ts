import assert from "node:assert/strict";
import { Readable } from "node:stream";

import proxyHandler from "../web/api/wrinkle-v10.mjs";
import {
  parseWrinkleV10ProviderCapability,
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
  };
  request.method = method;
  return request;
}

process.env.WRINKLE_V10_SERVICE_URL = "https://v10.internal";
process.env.WRINKLE_V10_SERVICE_TOKEN = "secret-token";
const originalFetch = globalThis.fetch;
try {
  let authorization = "";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify(capability), { status: 200 });
    }
    authorization = String((init?.headers as Record<string, string>)?.Authorization || "");
    return new Response(JSON.stringify({ detectorVersion: WRINKLE_V10_DETECTOR_VERSION }), {
      status: 200,
    });
  };
  const healthResponse = new FakeResponse();
  await proxyHandler(fakeRequest("GET"), healthResponse);
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(JSON.parse(Buffer.from(healthResponse.payload).toString()).detectorVersion,
    WRINKLE_V10_DETECTOR_VERSION);

  const detectResponse = new FakeResponse();
  await proxyHandler(fakeRequest("POST", Buffer.from("synthetic")), detectResponse);
  assert.equal(detectResponse.statusCode, 200);
  assert.equal(authorization, "Bearer secret-token");

  globalThis.fetch = async () => { throw new Error("upstream unavailable"); };
  const failedResponse = new FakeResponse();
  await proxyHandler(fakeRequest("GET"), failedResponse);
  assert.equal(failedResponse.statusCode, 502);
  assert.match(String(failedResponse.payload.error), /upstream unavailable/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("wrinkle V10 provider capability, proxy, auth and failure tests passed");
