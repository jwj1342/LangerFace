import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMarkerRuntime } from "../web/e2e/support/verifyMarkerRuntime.ts";
import { captureMarkerIdentity, assertMarkerIdentity, hashSourceText, TARGET_MARKER_PROFILE } from "./marker_runtime_identity.mts";

assert.equal(hashSourceText(Buffer.from("const x = 1;\r\n// 中文\r\n")), hashSourceText("const x = 1;\n// 中文\n"));
assert.notEqual(hashSourceText("const x = 1;\n"), hashSourceText("const x = 2;\n"));
assert.notEqual(hashSourceText("const x = 1;\n"), hashSourceText("const  x = 1;\n"));
assert.notEqual(hashSourceText("const x = 1;\n"), hashSourceText("const x = 1;"));

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "web/package.json"), "utf8"));
assert.match(packageJson.scripts.predev, /report_default_marker_profile\.mjs dev/);
assert.match(packageJson.scripts.prebuild, /report_default_marker_profile\.mjs build/);
assert.equal(packageJson.scripts["verify:build-default"], "node ../tools/run_controlled_marker_v035_build.mjs --verify-default-dist");
for (const mode of ["dev", "build"]) {
  const warning = spawnSync(process.execPath, [resolve(repoRoot, "tools/report_default_marker_profile.mjs"), mode], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(warning.status, 0, `generic ${mode} identity warning exits successfully`);
  assert.match(`${warning.stdout}${warning.stderr}`, /profile=small-lesion-boundary-candidate/);
  assert.match(`${warning.stdout}${warning.stderr}`, /VITE_CONTROLLED_MARKER_DETECTOR_PROFILE=legacy-v0\.23/);
}

const expected = captureMarkerIdentity(TARGET_MARKER_PROFILE);
assertMarkerIdentity(expected, expected);
for (const key of ["algorithmName", "releaseName", "changeSlug", "profile", "implementationVersion", "branch", "head", "worktreeId", "sourceDigest", "algorithmDigest", "assetDigest"] as const) {
  assert.throws(() => assertMarkerIdentity({ ...expected, [key]: "wrong" }, expected), new RegExp(key));
}
assert.throws(() => assertMarkerIdentity({}, expected), /schema/);
const ordinary = captureMarkerIdentity(undefined);
assert.equal(ordinary.profile, TARGET_MARKER_PROFILE, "generic default must use the candidate profile");
assertMarkerIdentity(ordinary, expected);
const legacy = captureMarkerIdentity("legacy-v0.23");
assert.equal(legacy.profile, "legacy-v0.23", "legacy remains an explicit rollback profile");
assert.throws(() => assertMarkerIdentity(legacy, expected), /profile/);
console.log("身份检查通过：普通启动使用候选算法；显式旧版本、名称、profile和源码错误均拒绝。");

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
  payload = JSON.stringify(legacy);
  await assert.rejects(readMarkerRuntime(url, expected), /profile/);
  payload = JSON.stringify({ ...expected, sourceDigest: "stale-build" });
  await assert.rejects(readMarkerRuntime(url, expected), /sourceDigest/);
  status = 409;
  await assert.rejects(readMarkerRuntime(url, expected), /端点不可用/);
  console.log("HTTP 反证 5 项通过：正确 JSON 放行；200 旧页面、旧算法、旧源码和 409 均拒绝。");
} finally {
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
}
