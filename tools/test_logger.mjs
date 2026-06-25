import assert from "node:assert/strict";

import {
  countMetric,
  diagnostics,
  exportDiagnostics,
  installGlobalErrorHandlers,
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

// 回归：对外导出入口绝不能因某条 detail 含循环引用而抛错；嵌套 Error 应被归一化为可读字段。
const circular = { reason: "loop" };
circular.self = circular;
recordEvent("diag.circular", circular);
recordEvent("diag.nestedError", { reason: "fail", error: new Error("boom") });
assert.doesNotThrow(() => exportDiagnostics());
const robust = JSON.parse(exportDiagnostics());
assert.equal(robust.events.at(-2).detail.reason, "loop");
assert.equal(robust.events.at(-2).detail.self, "[circular]");
assert.equal(robust.events.at(-1).detail.error.message, "boom");

resetDiagnostics();
const listeners = {};
const fakeWindow = {
  addEventListener(type, handler) {
    listeners[type] = handler;
  },
};
assert.equal(installGlobalErrorHandlers(fakeWindow), true);
assert.equal(installGlobalErrorHandlers(fakeWindow), false, "global error handlers install once per target");
listeners.error({
  message: "render failed",
  filename: "main.js",
  lineno: 12,
  colno: 7,
  error: new Error("render failed"),
});
listeners.unhandledrejection({ reason: new Error("stream failed") });
const runtime = snapshotDiagnostics();
assert.equal(runtime.counters["runtime.error"], 1);
assert.equal(runtime.counters["runtime.unhandledrejection"], 1);
assert.equal(runtime.events.at(-2).event, "runtime.error");
assert.equal(runtime.events.at(-2).detail.filename, "main.js");
assert.equal(runtime.events.at(-1).event, "runtime.unhandledrejection");
assert.equal(runtime.events.at(-1).detail.reason.message, "stream failed");

console.log("ok: browser diagnostics logger exports structured snapshots");
