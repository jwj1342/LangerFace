import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { auditExportPayload } from "../web/src/services/exportPrivacy.ts";
import { MarkerRunDiagnostics, auditMarkerDiagnosticExport, diagnosticSha256, diagnosticPixelBinding, diagnosticReplayMismatches, parseDiagnosticRun, assertDiagnosticJson, type RunInput } from "../web/src/services/controlledMarkerRunDiagnostics.ts";

const pixels = new Uint8ClampedArray([10, 20, 30, 255, 20, 30, 40, 255, 50, 60, 70, 255, 80, 90, 100, 255]);
const identity = { profile: "color-difference-v0.35", implementationVersion: "0.35", head: "66c838be4312e237056de5a5487cd9b3f9a42eea", branch: "test", worktreeId: "a".repeat(64), sourceDigest: "b6f9d35754eddb9513d156d3f662e932aa287ca4710223350f2f838ca6a0df95", assetDigest: "c".repeat(64), mode: "development" };
let revision = 0;
let fetchMode = "ok";
let fetchCalls = 0;
class Input extends EventTarget { id = "fileInput"; files = [new File([new Uint8Array([1, 2, 3])], "private-patient-name.png", { type: "image/png" })]; }
const doc = new EventTarget();
Object.assign(doc, { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels.slice() }) }) }) });
const win = new EventTarget();
Object.defineProperties(globalThis, {
  document: { configurable: true, value: doc }, window: { configurable: true, value: win },
  HTMLInputElement: { configurable: true, value: Input },
  Image: { configurable: true, value: class { width = 2; height = 2; naturalWidth = 2; naturalHeight = 2; src = ""; async decode() {} } },
  fetch: { configurable: true, value: async () => { fetchCalls++; return { ok: fetchMode === "ok", json: async () => identity }; } },
});
function select(type = "change") { const e = new Event(type); Object.defineProperty(e, "target", { value: new Input() }); doc.dispatchEvent(e); }
const getFrame = () => ({ kind: "image", revision, width: 2, height: 2 });
const input: RunInput = {
  revision: 2, width: 2, height: 2, seed: { x: 1, y: 1 }, options: { expectedDiameterPx: 2, roiRadius: 8, scanDiameterMm: 20 },
  parameters: { kind: "cutaneous", diameterMm: 8, marginMm: 0, depthMm: 6, scanDiameterMm: 20 }, repairs: [], mirror: false, pixelsPerMm: 1,
  profile: "color-difference-v0.35", implementationVersion: "0.35",
};
const detection = { ok: true, geometry_mode: "enclosed_region", boundary: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], center: { x: 1, y: 1 } };
const diagnostics = new MarkerRunDiagnostics(getFrame);
select(); revision = 2;
const transferred = pixels.slice();
const run = diagnostics.begin(input, 1, "web_worker", pixels, transferred);
structuredClone(transferred, { transfer: [transferred.buffer] });
assert.equal(transferred.byteLength, 0);
assert.throws(() => diagnostics.exportLatest(), /等待/);
run.finish(detection);
await run.evidence; await Promise.resolve();
assert.equal(run.run.file_binding, "PASS");
assert.equal(run.run.status, "recorded");
assert.equal(run.run.detector_rgba_sha256, await diagnosticSha256(pixels));
assert.equal(run.run.service_snapshot_binding, "PASS");
assert.equal(run.run.client_source_binding, "UNKNOWN");
assert.deepEqual(run.run.raw_result, detection);
const failure = { ...detection, ok: false, failure_code: "no_enclosed_region", area_px: 4, bbox: { x: 0, y: 0, width: 2, height: 2 }, warnings: ["weak_edge"], diagnostics: { failure_stage: "barrier" } };
const rawFailure = diagnostics.begin(input, 11, "web_worker", pixels, pixels, false);
rawFailure.finish(failure); await rawFailure.evidence; await Promise.resolve();
assert.deepEqual(rawFailure.run.raw_result, failure);
const replayed = diagnostics.begin(input, 12, "web_worker", pixels, pixels, false, run.run);
replayed.finish(detection); await replayed.evidence; await Promise.resolve();
assert.deepEqual(replayed.run.comparison, { raw_result_equal: true, boundary_equal: true });
assert.equal(replayed.run.replay_of?.run_id, run.run.run_id);
for (const status of ["discarded_request", "discarded_source", "discarded_parameters"] as const) {
  const discarded = diagnostics.begin(input, 13, "web_worker", pixels, pixels, false);
  discarded.finish(detection, false, status); await discarded.evidence; await Promise.resolve();
  assert.equal(discarded.run.status, status);
  assert.throws(() => parseDiagnosticRun(JSON.stringify(discarded.run)));
}
const exported = diagnostics.exportLatest();
assert.ok(auditExportPayload(JSON.parse(exported)).violations.some(v => v.path === "service_identity.sourceDigest"), "reproduce real digest false positive");
assert.deepEqual(auditMarkerDiagnosticExport(JSON.parse(exported)).violations, [], "typed diagnostic gate must accept real identity");
assert.equal(JSON.parse(exported).service_identity.sourceDigest, identity.sourceDigest, "original fingerprint must not be redacted");
for (const badValue of ["13800138000", "person@example.com", "g".repeat(64), "a".repeat(63)]) {
  const bad = JSON.parse(exported); bad.service_identity.sourceDigest = badValue;
  assert.throws(() => auditMarkerDiagnosticExport(bad));
}
for (const value of ["13800138000", "person@example.com"]) {
  const bad = JSON.parse(exported); bad.raw_result.warnings = [value];
  assert.equal(auditMarkerDiagnosticExport(bad).passed, false, "free-text privacy scanning must remain active");
}
const immutable = JSON.parse(exported); const originalTicket = JSON.stringify(immutable);
auditMarkerDiagnosticExport(immutable);
assert.equal(JSON.stringify(immutable), originalTicket);
assert.ok(!exported.includes("private-patient"));
assert.ok(!exported.includes('"author"'));
assert.deepEqual(diagnosticReplayMismatches(parseDiagnosticRun(exported), run.run), []);
const changed = structuredClone(run.run); changed.input.options.roiRadius++;
assert.ok(diagnosticReplayMismatches(run.run, changed).includes("参数/坐标/变换不同"));
changed.input = structuredClone(run.run.input); changed.file_binding = "UNKNOWN";
assert.ok(diagnosticReplayMismatches(run.run, changed).includes("原图身份未知"));
changed.file_binding = "PASS"; changed.service_snapshot_binding = "UNKNOWN";
assert.ok(diagnosticReplayMismatches(run.run, changed).includes("服务或声明身份未匹配"));
for (const key of ["basename", "name", "path", "author", "lastModified", "secret", "__proto__"]) {
  assert.throws(() => assertDiagnosticJson(JSON.parse(`{"nested":{"${key}":"private"}}`)));
}
for (const value of [new Uint8Array([1]), new ArrayBuffer(8), { bad: "data:image/png;base64,abc" }, { bad: NaN }]) assert.throws(() => assertDiagnosticJson(value));
assert.throws(() => parseDiagnosticRun(" ".repeat(2_000_001)));
assert.equal(diagnosticPixelBinding(run.run.source_file, { width: 3, height: 2 }, run.run.prepared_rgba_sha256), false);

// A late completion cannot become the latest run or claim a later selection.
const older = diagnostics.begin(input, 2, "web_worker", pixels, pixels);
const newer = diagnostics.begin(input, 3, "main_thread_fallback", pixels, pixels);
newer.finish(detection); older.finish({ ...detection, ok: false });
await Promise.all([older.evidence, newer.evidence]); await Promise.resolve();
assert.equal(JSON.parse(diagnostics.exportLatest()).request_id, 3);
const stale = diagnostics.begin(input, 4, "web_worker", pixels, pixels);
select(); revision = 3;
stale.finish(detection); await stale.evidence; await Promise.resolve();
assert.equal(stale.run.file_binding, "UNKNOWN");
select(); revision += 4;
const multipleRevisions = diagnostics.begin({ ...input, revision }, 14, "web_worker", pixels, pixels, false);
multipleRevisions.finish(detection); await multipleRevisions.evidence; await Promise.resolve();
assert.equal(multipleRevisions.run.file_binding, "UNKNOWN");
select("cancel");
const cancelled = diagnostics.begin({ ...input, revision: 3 }, 5, "web_worker", pixels, pixels);
cancelled.finish(null, true); await cancelled.evidence; await Promise.resolve();
assert.equal(cancelled.run.status, "detection_error"); assert.equal(cancelled.run.file_binding, "UNKNOWN");
fetchMode = "409";
const missing = diagnostics.begin({ ...input, revision: 3 }, 6, "web_worker", pixels, pixels);
missing.finish(detection); await missing.evidence; await Promise.resolve();
assert.equal(missing.run.service_snapshot_binding, "UNKNOWN");
diagnostics.dispose(); const count = fetchCalls; select(); await Promise.resolve(); assert.equal(fetchCalls, count);

// Execute the actual controller command function, with side-effect traps, gate closed.
const source = fs.readFileSync(new URL("../web/src/services/workflowIncisionController.ts", import.meta.url), "utf8");
const start = source.indexOf("function applyTumorCommand(");
const end = source.indexOf("\nfunction ", start + 1);
const commandSource = source.slice(start, end);
const context = vm.createContext({
  markerDiagnostics: new WeakMap(), MARKER_DIAGNOSTIC_COMMANDS: ["export_marker_diagnostic", "import_marker_diagnostic", "replay_marker_diagnostic"],
  readControllerCommandDetail: (event: { detail: unknown }) => event.detail,
  readIncisionTumorCommand: () => { throw new Error("old router reached"); },
  invalidateCandidate: () => { throw new Error("candidate changed"); }, resetMarkerRepair: () => { throw new Error("repair changed"); },
});
vm.runInContext(stripTypeScriptTypes(commandSource), context);
for (const command of ["export_marker_diagnostic", "import_marker_diagnostic", "replay_marker_diagnostic"]) {
  const state = { markerBusy: false, markerRequestId: 7, selection: { x: 1 } }; const before = JSON.stringify(state);
  context.testState = state; context.testEvent = { detail: { command } };
  vm.runInContext("applyTumorCommand(testState, testEvent)", context);
  assert.equal(JSON.stringify(state), before);
}
const replayStart = source.indexOf("async function replayMarkerDiagnostic(");
const replayEnd = source.indexOf("\nasync function runControlledMarker(", replayStart);
const replaySource = source.slice(replayStart, replayEnd);
assert.ok(replaySource.indexOf("diagnosticReplayMismatches") < replaySource.indexOf("ensureWorker(state)"));
assert.ok(replaySource.indexOf("ensureWorker(state)") < replaySource.indexOf("await runControlledMarker"));
assert.ok(!replaySource.includes("setSelection("));
assert.ok(!replaySource.includes("prepareControlledMarkerAttempt("));
// Execute the actual preflight against a known mismatch; none of the product traps may fire.
const trap = () => { throw new Error("product side effect during mismatch"); };
const replayState = { mounted: true, markerBusy: false, kind: "cutaneous", boundaryMode: "ellipse", markerRequestId: 1 };
let replayMessage = "";
const fakeDiagnostics = { imported: parseDiagnosticRun(exported), begin: () => ({ evidence: Promise.resolve(), run: changed }), message: (s: string) => { replayMessage = s; } };
const replayContext = vm.createContext({
  markerDiagnostics: new WeakMap([[replayState, fakeDiagnostics]]), sourceState: { planning2d: { getFrameState: () => ({ ...getFrame(), source: {} }) } },
  workflowPhotoProjection: () => ({ surfaceLandmarks: [] }), controlledMarkerPixelsPerMm: () => 1,
  markerDiagnosticInput: () => input, document: doc, drawRepairsToContext() {}, diagnosticReplayMismatches,
  ensureWorker: trap, runControlledMarker: trap, replayState,
});
vm.runInContext(stripTypeScriptTypes(replaySource), replayContext);
const stateBefore = JSON.stringify(replayState);
await vm.runInContext("replayMarkerDiagnostic(replayState)", replayContext);
assert.equal(JSON.stringify(replayState), stateBefore);
assert.match(replayMessage, /身份/);

// Compare the actual detector-call boundary with diagnostics off/on; no browser/model.
const runStart = source.indexOf("async function runControlledMarker(");
const runEnd = source.indexOf("\nfunction pathData", runStart);
const runSource = source.slice(runStart, runEnd);
async function detectorBoundary(enabled: boolean, rejection = false) {
  const state = { mounted: true, markerMode: true, markerBusy: false, markerRequestId: 0, boundaryMode: "ellipse", kind: "cutaneous", repairStrokes: [] };
  let call: unknown; let finishCalls = 0;
  const fake = { begin: () => ({ finish: () => { finishCalls++; } }), message() {} };
  const frame = { kind: "image", source: {}, landmarks: [1], revision: 2, width: 2, height: 2 };
  const environment = vm.createContext({
    state, testSeed: { x: 1, y: 1 }, mobileWorkflowViewportActive: () => false,
    sourceState: { planning2d: { getFrameState: () => frame, setSelection() {} } },
    markerRequestSnapshot: () => input.parameters, minimumWorkflowMarkerScanDiameterMm: () => 8,
    workflowPhotoProjection: () => ({ surfaceLandmarks: [] }), controlledMarkerPixelsPerMm: () => 1,
    document: doc, prepareControlledMarkerAttempt() {}, requestFrame() {}, drawRepairsToContext() {},
    markerDiagnostics: new WeakMap(enabled ? [[state, fake]] : []), markerDiagnosticInput: () => input,
    setStatus() {}, publish() {}, ensureWorker: () => null,
    detectControlledMarker: (image: { data: Uint8ClampedArray }, seed: unknown, options: unknown) => {
      call = { pixels: [...image.data], seed, options };
      return rejection ? Promise.reject(new Error("controlled rejection")) : { ok: false };
    },
    workflowMarkerRequestStillCurrent: () => true, completeControlledMarkerAttempt() {},
    controlledMarkerRepairable: () => false, controlledMarkerFailureMessage: () => "test failure",
  });
  vm.runInContext(stripTypeScriptTypes(runSource), environment);
  await vm.runInContext("runControlledMarker(state, testSeed)", environment);
  return { call: JSON.stringify(call), finishCalls };
}
const off = await detectorBoundary(false); const on = await detectorBoundary(true);
assert.equal(on.call, off.call); assert.equal(on.finishCalls, 1); assert.equal(off.finishCalls, 0);
assert.equal((await detectorBoundary(true, true)).finishCalls, 1);
assert.ok(source.indexOf("diagnosticRun = diagnostics.begin") < source.indexOf("Comlink.transfer({ width: image.width"));
console.log("test_controlled_marker_run_diagnostics: transfer, file binding, run isolation, privacy, identity, replay preflight and controller gate passed");
