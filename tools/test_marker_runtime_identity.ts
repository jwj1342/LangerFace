import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readMarkerRuntime } from "../web/e2e/support/verifyMarkerRuntime.ts";
import { captureMarkerIdentity, assertMarkerIdentity, TARGET_MARKER_PROFILE } from "./marker_runtime_identity.mts";

const expected = captureMarkerIdentity(TARGET_MARKER_PROFILE);
assertMarkerIdentity(expected, expected);
for (const key of ["profile", "implementationVersion", "branch", "head", "worktreeId", "sourceDigest", "assetDigest"] as const) {
  assert.throws(() => assertMarkerIdentity({ ...expected, [key]: "wrong" }, expected), new RegExp(key));
}
assert.throws(() => assertMarkerIdentity({}, expected), /schema/);
const ordinary = captureMarkerIdentity(undefined);
assert.equal(ordinary.profile, "legacy-v0.23", "generic default must remain unchanged");
assert.throws(() => assertMarkerIdentity(ordinary, expected), /profile/);
console.log("身份检查 10 项通过：正确身份放行；7 类错误、缺失身份和默认旧版本均拒绝。");

let payload = JSON.stringify(expected);
let status = 200;
let contentType = "application/json";
const server = createServer((_req, res) => {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(payload);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试端口未分配");
  const url = `http://127.0.0.1:${address.port}`;
  await readMarkerRuntime(url, expected);
  payload = "<!doctype html>旧页面";
  contentType = "text/html";
  await assert.rejects(readMarkerRuntime(url, expected), /端点不可用/);
  contentType = "application/json";
  payload = JSON.stringify(ordinary);
  await assert.rejects(readMarkerRuntime(url, expected), /profile/);
  payload = JSON.stringify({ ...expected, sourceDigest: "stale-build" });
  await assert.rejects(readMarkerRuntime(url, expected), /sourceDigest/);
  status = 409;
  await assert.rejects(readMarkerRuntime(url, expected), /端点不可用/);
  console.log("HTTP 反证 5 项通过：正确 JSON 放行；200 旧页面、旧算法、旧源码和 409 均拒绝。");
} finally {
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
}
