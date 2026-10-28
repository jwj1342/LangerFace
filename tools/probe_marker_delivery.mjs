#!/usr/bin/env node

import { captureMarkerIdentity, assertMarkerIdentity, markerRepoRoot } from "./marker_runtime_identity.mts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const expected = captureMarkerIdentity("small-lesion-boundary-candidate");
const timeoutMs = Number(process.env.DELIVERY_PROBE_TIMEOUT_MS || 20000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 50 || timeoutMs > 20000) throw new Error("invalid probe timeout");
const urls = process.argv.slice(2);
const targets = urls.length ? urls : ["http://127.0.0.1:5199"];
const requiredAssets = [
  "/__runtime-identity.json",
  "/app/workflow?developer=1",
  "/assets/face_landmarker.task",
  "/assets/hand_landmarker.task",
  "/node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm",
];

const failures = [];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const binaries = new Map(requiredAssets.filter(p => p.endsWith(".task") || p.endsWith(".wasm"))
  .map(p => [p, digest(readFileSync(resolve(markerRepoRoot, "web", p.slice(1))))]));
for (const base of targets) {
  for (const path of requiredAssets) {
    const url = new URL(path, base).href;
    try {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
      const bytes = Buffer.from(await response.arrayBuffer());
      const body = bytes.toString("utf8");
      if (!response.ok || bytes.length === 0) throw new Error(`HTTP ${response.status}, empty=${bytes.length === 0}`);
      if (path === "/__runtime-identity.json") {
        const identity = JSON.parse(body);
        assertMarkerIdentity(identity, expected);
        if (identity.profile !== "small-lesion-boundary-candidate") {
          throw new Error(`profile=${identity.profile || "missing"}`);
        }
      }
      if (path.startsWith("/app/") && !body.includes("/src/main.tsx")) {
        throw new Error("unexpected application entry");
      }
      if (path.endsWith(".wasm") && bytes.subarray(0, 4).toString("hex") !== "0061736d") {
        throw new Error("not a WASM resource");
      }
      if (binaries.has(path) && digest(bytes) !== binaries.get(path)) throw new Error("binary fingerprint mismatch");
      console.log(`[delivery-probe] PASS ${url} HTTP ${response.status} bytes=${bytes.length}`);
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
}
if (failures.length) {
  console.error("[delivery-probe] FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`[delivery-probe] PASS targets=${targets.length} checks=${targets.length * requiredAssets.length}`);
}
