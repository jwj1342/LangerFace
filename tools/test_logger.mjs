import assert from "node:assert/strict";

import {
  countMetric,
  diagnostics,
  exportDiagnostics,
  logWarn,
  recordEvent,
  recordMetricSample,
  resetDiagnostics,
  setAssetVersions,
  snapshotDiagnostics,
} from "../web/logger.js";

resetDiagnostics();

setAssetVersions({
  topology: "mediapipe-468",
  rstlAtlasVersion: "0.2",
});
countMetric("camera.openFailure.permission_denied");
countMetric("camera.openFailure.permission_denied", 2);
recordEvent("frame.summary", { phase: "frame", sourceKind: "camera" });
const originalWarn = console.warn;
console.warn = () => {};
logWarn("camera degraded", new Error("permission denied"));
console.warn = originalWarn;

for (let i = 0; i < 130; i++) {
  recordMetricSample("frame.fps", 20 + i, { phase: "frame", seq: i });
}

const snap = snapshotDiagnostics();
assert.equal(snap.schemaVersion, diagnostics.schemaVersion);
assert.equal(snap.assetVersions.topology, "mediapipe-468");
assert.equal(snap.counters["camera.openFailure.permission_denied"], 3);
assert.equal(snap.metrics["frame.fps"].count, 130);
assert.equal(snap.metrics["frame.fps"].latest, 149);
assert.equal(snap.metrics["frame.fps"].samples.length, 120);
assert.equal(snap.metrics["frame.fps"].samples[0].detail.seq, 10);
assert.equal(snap.events.at(-1).detail.message, "permission denied");

const exported = JSON.parse(exportDiagnostics());
assert.equal(exported.assetVersions.rstlAtlasVersion, "0.2");
assert.equal(typeof globalThis.exportLangerfaceDiagnostics, "function");

resetDiagnostics();
assert.deepEqual(snapshotDiagnostics().events, []);
assert.equal(Object.keys(snapshotDiagnostics().counters).length, 0);

console.log("ok: browser diagnostics logger exports structured snapshots");
