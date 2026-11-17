import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { auditExportPayload } from "../web/src/services/exportPrivacy.ts";
import { MarkerRunDiagnostics, DIAGNOSTIC_LIMITS, auditMarkerDiagnosticExport, diagnosticExportPayload, diagnosticSha256, diagnosticPixelBinding, diagnosticReplayMismatches, parseDiagnosticRun, assertDiagnosticJson, classifyDiagnosticEvidence, captureWorkflowInteractionSnapshot, type RunInput } from "../web/src/services/controlledMarkerRunDiagnostics.ts";
import { CANVAS_EXPORT_DIAGNOSTIC_EVENT } from "../web/src/services/canvasRecording.ts";

const pixels = new Uint8ClampedArray([10, 20, 30, 255, 20, 30, 40, 255, 50, 60, 70, 255, 80, 90, 100, 255]);
const identity = { algorithmName: "小肿物边界候选算法", releaseName: "小肿物边界识别：稳定候选选择与中心一致性", changeSlug: "deterministic-selection-center-consistency", profile: "small-lesion-boundary-candidate", implementationVersion: "0.36.0-candidate.1", head: "66c838be4312e237056de5a5487cd9b3f9a42eea", branch: "verify/vh1-lesion-runtime-0.102.1-20261111", worktreeId: "a".repeat(64), sourceDigest: "b6f9d35754eddb9513d156d3f662e932aa287ca4710223350f2f838ca6a0df95", assetDigest: "c".repeat(64), mode: "development" };
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
  profile: "small-lesion-boundary-candidate", implementationVersion: "0.36.0-candidate.1",
};
const detection = { ok: true, geometry_mode: "enclosed_region", boundary: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], center: { x: 1, y: 1 } };
const diagnostics = new MarkerRunDiagnostics(getFrame);
select(); revision = 2;
const transferred = pixels.slice();
const run = diagnostics.begin(input, 1, "web_worker", pixels, transferred);
structuredClone(transferred, { transfer: [transferred.buffer] });
assert.equal(transferred.byteLength, 0);
assert.throws(() => diagnostics.exportLatest(), /等待/);
const pendingSnapshot = JSON.parse(diagnostics.exportSession());
assert.equal(pendingSnapshot.pending_run_count, 1);
assert.equal(pendingSnapshot.runs[0].status, "pending", "export must retain an unfinished failure snapshot");
assert.equal(auditMarkerDiagnosticExport(pendingSnapshot).passed, true);
run.finish(detection);
await run.evidence; await Promise.resolve();
assert.equal(run.run.file_binding, "PASS");
assert.equal(run.run.status, "recorded");
assert.equal(run.run.evidence_state, "ready_for_review");
assert.equal(run.run.detector_rgba_sha256, await diagnosticSha256(pixels));
assert.equal(run.run.service_snapshot_binding, "PASS");
assert.equal(run.run.client_source_binding, "UNKNOWN");
assert.deepEqual(run.run.raw_result, detection);
const linked = diagnostics.begin(input, 10, "web_worker", pixels, pixels, false, undefined, "controlled_marker-test-link");
linked.finish(detection); await linked.evidence; await Promise.resolve();
assert.equal(linked.run.action_id, "controlled_marker-test-link");
const failure = { ...detection, ok: false, failure_code: "no_enclosed_region", area_px: 4, bbox: { x: 0, y: 0, width: 2, height: 2 }, warnings: ["weak_edge"], diagnostics: { failure_stage: "barrier" } };
const rawFailure = diagnostics.begin(input, 11, "web_worker", pixels, pixels, false);
rawFailure.finish(failure); await rawFailure.evidence; await Promise.resolve();
assert.deepEqual(rawFailure.run.raw_result, failure);
assert.equal(rawFailure.run.evidence_state, "detector_failed");
const replayed = diagnostics.begin(input, 12, "web_worker", pixels, pixels, false, run.run);
replayed.finish(detection); await replayed.evidence; await Promise.resolve();
assert.deepEqual(replayed.run.comparison, { raw_result_equal: true, boundary_equal: true });
assert.equal(replayed.run.replay_of?.run_id, run.run.run_id);
for (const status of ["discarded_request", "discarded_source", "discarded_parameters"] as const) {
  const discarded = diagnostics.begin(input, 13, "web_worker", pixels, pixels, false);
  discarded.finish(detection, false, status); await discarded.evidence; await Promise.resolve();
  assert.equal(discarded.run.status, status);
  assert.equal(discarded.run.evidence_state, "input_or_binding_invalid");
  assert.throws(() => parseDiagnosticRun(JSON.stringify(discarded.run)));
}
const exported = diagnostics.exportLatest();
assert.ok(auditExportPayload(JSON.parse(exported)).violations.some(v => v.path === "service_identity.sourceDigest"), "reproduce real digest false positive");
assert.deepEqual(auditMarkerDiagnosticExport(JSON.parse(exported)).violations, [], "typed diagnostic gate must accept real identity");
assert.equal(JSON.parse(exported).service_identity.sourceDigest, identity.sourceDigest, "original fingerprint must not be redacted");
const exportedRun = JSON.parse(exported);
assert.equal(exportedRun.service_identity.branch, undefined, "raw branch text must not leave the browser");
assert.equal(run.run.service_identity?.branch, identity.branch, "export must retain internal identity");
assert.equal(exportedRun.service_identity.branch_sha256, createHash("sha256").update(identity.branch).digest("hex"));
// Include UTF-8, SHA padding boundaries, multiple blocks and phone-like branch text.
const branchVectors = ["test", identity.branch, "修复/诊断-😀", "\ufeffbranch", "138-0.102.1-000", "person@example.com",
  ...Array.from({ length: 128 }, (_, n) => "x".repeat(n + 1)), "分".repeat(512)];
for (const branch of branchVectors) {
  const legacy = structuredClone(run.run);
  legacy.service_identity!.branch = branch;
  const before = JSON.stringify(legacy);
  const converted = diagnosticExportPayload(legacy) as any;
  assert.equal(converted.service_identity.branch_sha256, createHash("sha256").update(branch).digest("hex"));
  assert.equal(converted.service_identity.branch, undefined);
  assert.equal(auditMarkerDiagnosticExport(converted).passed, true);
  assert.equal(JSON.stringify(legacy), before, "normalization may not mutate local evidence");
  assert.deepEqual(diagnosticReplayMismatches(parseDiagnosticRun(JSON.stringify(legacy)), legacy), []);
}
for (const branch of ["", "\ud800", "\udfff", "a".repeat(513)]) {
  const invalidBranch = structuredClone(run.run); invalidBranch.service_identity!.branch = branch;
  assert.throws(() => diagnosticExportPayload(invalidBranch), /分支身份|诊断JSON字段不合法/);
}
const uppercaseBranch = structuredClone(exportedRun);
uppercaseBranch.service_identity.branch_sha256 = uppercaseBranch.service_identity.branch_sha256.toUpperCase();
assert.deepEqual(diagnosticReplayMismatches(parseDiagnosticRun(JSON.stringify(uppercaseBranch)), run.run), []);
assert.deepEqual(diagnosticExportPayload(exportedRun), exportedRun, "identity conversion must be idempotent");
const otherBranch = structuredClone(run.run);
otherBranch.service_identity!.branch = "feat/other-branch";
assert.ok(diagnosticReplayMismatches(exportedRun, otherBranch).includes("服务或声明身份未匹配"));
for (const value of [null, "", "13800138000", "g".repeat(64), "a".repeat(63)]) {
  const invalid = structuredClone(exportedRun); invalid.service_identity.branch_sha256 = value;
  assert.throws(() => parseDiagnosticRun(JSON.stringify(invalid)), /分支/);
  assert.throws(() => auditMarkerDiagnosticExport(invalid), /指纹字段/);
  assert.ok(diagnosticReplayMismatches(invalid, run.run).includes("服务或声明身份未匹配"));
}
const missingBranch = structuredClone(exportedRun); delete missingBranch.service_identity.branch_sha256;
assert.throws(() => parseDiagnosticRun(JSON.stringify(missingBranch)), /缺少分支/);
const conflictingBranch = structuredClone(exportedRun); conflictingBranch.service_identity.branch = "wrong";
assert.throws(() => parseDiagnosticRun(JSON.stringify(conflictingBranch)), /分支指纹不一致/);
for (const key of ["head", "worktreeId", "sourceDigest", "assetDigest", "mode", "profile", "implementationVersion"]) {
  const changedIdentity = structuredClone(run.run); changedIdentity.service_identity![key] = "different";
  assert.ok(diagnosticReplayMismatches(exportedRun, changedIdentity).includes("服务或声明身份未匹配"), key);
}
for (const badValue of ["13800138000", "person@example.com", "g".repeat(64), "a".repeat(63)]) {
  const bad = JSON.parse(exported); bad.service_identity.sourceDigest = badValue;
  assert.throws(() => auditMarkerDiagnosticExport(bad));
}
for (const value of ["13800138000", "person@example.com"]) {
  const bad = JSON.parse(exported); bad.raw_result.warnings = [value];
  assert.equal(auditMarkerDiagnosticExport(bad).passed, false, "free-text privacy scanning must remain active");
  assert.throws(() => parseDiagnosticRun(JSON.stringify(bad)), /隐私检查/);
}
const immutable = JSON.parse(exported); const originalTicket = JSON.stringify(immutable);
auditMarkerDiagnosticExport(immutable);
assert.equal(JSON.stringify(immutable), originalTicket);
assert.ok(!exported.includes("private-patient"));
assert.ok(!exported.includes('"author"'));
diagnostics.observeController({ reason: "controlled_marker_opening_rejected", request_id: 1, source_revision: 2,
  seed: { x: 1, y: 1 }, scan_diameter_mm: 20, kind: "cutaneous", marker_busy: false, boundary_points: 0 });
const bundle = diagnostics.exportBundle();
assert.equal(auditMarkerDiagnosticExport(JSON.parse(bundle)).passed, true);
assert.equal(JSON.parse(bundle).controller_events.at(-1).reason, "controlled_marker_opening_rejected");
assert.equal(JSON.parse(bundle).controller_events.at(-1).operation_type, "controlled_marker");
diagnostics.observeController({ reason: "controlled_marker_failed", request_id: 10, source_revision: 2,
  action_id: "controlled_marker-test-link", diagnostic_run_id: linked.run.run_id,
  seed: { x: 1, y: 1 }, scan_diameter_mm: 20, kind: "cutaneous", marker_busy: false, boundary_points: 0,
  rejected_boundary_points: 48, rejected_reasons: ["candidate_not_compact"] });
const linkedController = JSON.parse(diagnostics.exportBundle()).controller_events.at(-1);
assert.equal(linkedController.action_id, linked.run.action_id);
assert.equal(linkedController.diagnostic_run_id, linked.run.run_id);
assert.deepEqual(linkedController.rejected_reasons, ["candidate_not_compact"]);
assert.equal(parseDiagnosticRun(bundle).run_id, run.run.run_id, "bundle import keeps last actual detector run");
const privateBundle = JSON.parse(bundle); privateBundle.controller_events[0].reason = "person@example.com";
assert.equal(auditMarkerDiagnosticExport(privateBundle).passed, false);
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
assert.throws(() => parseDiagnosticRun(" ".repeat(DIAGNOSTIC_LIMITS.bytes + 1)));
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
assert.equal(classifyDiagnosticEvidence(stale.run), "input_or_binding_invalid");
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
// Execute the actual size-limiting method with a small byte budget, preserving
// the production trimming algorithm while avoiding an 8MB fixture.
const recorderSource = fs.readFileSync(new URL("../web/src/services/controlledMarkerRunDiagnostics.ts", import.meta.url), "utf8");
const exportStart = recorderSource.indexOf("  exportSession(): string {");
const exportEnd = recorderSource.indexOf("\n  import(", exportStart);
const history = [{ event_type: "candidate_edit", stage: "preview", reason: "size_test", payload: "x".repeat(500) }];
const smallSession = { ...JSON.parse(bundle), schema: "marker-diagnostic-session/2", runs: [], page_instances: [], sources: [], client_modules: [],
  workflow_events: history, dropped_preview_events: 0, dropped_workflow_events: 0 };
const minimalBytes = new TextEncoder().encode(JSON.stringify({ ...smallSession, workflow_events: [], exported_at_ms: Date.now(),
  export_events: [], pending_run_count: 0, raw_image_embedded: false, uploaded: false }, null, 2)).length;
const sizeContext = vm.createContext({ structuredClone, TextEncoder, assertDiagnosticJson, diagnosticExportPayload, MAX_DIAGNOSTIC_BYTES: minimalBytes + 100 });
const sizeMethod = vm.runInContext(stripTypeScriptTypes(`(class {${recorderSource.slice(exportStart, exportEnd)}}).prototype.exportSession`), sizeContext);
const originalHistory = JSON.stringify(history);
const sizeState = { runs: [], controllerEvents: [{}], workflowEvents: history, actionEvents: [], interactionEvents: [], exportEvents: [],
  captureInteraction() {}, persisted: () => smallSession };
const trimmed = JSON.parse(sizeMethod.call(sizeState));
assert.equal(trimmed.workflow_events.length, 0);
assert.equal(trimmed.dropped_preview_events, 1);
assert.equal(JSON.stringify(history), originalHistory, "export-size trimming must never erase the local history");
assert.equal(smallSession.dropped_preview_events, 0, "export-only counters must not leak into persistence");
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
  const fake = {
    recordAction: () => "controlled_marker-test-action",
    begin: () => ({ run: { run_id: 99 }, finish: () => { finishCalls++; } }),
    message() {},
  };
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
const bounded = new MarkerRunDiagnostics(getFrame);
assert.throws(() => bounded.exportBundle(), /操作一次/);
win.dispatchEvent(new CustomEvent(CANVAS_EXPORT_DIAGNOSTIC_EVENT, { detail: {
  export_kind: "image", stage: "download_requested", mime: "image/png", extension: "png",
  size_bytes: 321, share_api_available: true, file_share_supported: false,
  error_code: null, observed_at_ms: 123,
} }));
const exportOnly = JSON.parse(bounded.exportBundle());
assert.equal(exportOnly.export_events[0].stage, "download_requested");
assert.equal(exportOnly.export_events[0].size_bytes, 321);
assert.equal(auditMarkerDiagnosticExport(exportOnly).passed, true);
bounded.observeController({ reason: "freehand_boundary_started", request_id: 0, source_revision: 2,
  seed: null, scan_diameter_mm: 10, kind: "cutaneous", marker_busy: false, boundary_points: 0,
  boundary_mode: "freehand", boundary_closed: false, freehand_drawing: true, freehand_point_count: 1 });
const freehandOnly = JSON.parse(bounded.exportBundle());
assert.equal(freehandOnly.runs.length, 0, "freehand operations are not detector runs");
assert.equal(freehandOnly.controller_events[0].operation_type, "freehand");
assert.equal(freehandOnly.controller_events[0].freehand_point_count, 1);
assert.throws(() => parseDiagnosticRun(JSON.stringify(freehandOnly)), /尚无已执行的识别记录/, "freehand-only bundles remain non-replayable");
for (let i = 0; i < DIAGNOSTIC_LIMITS.controllerEvents + 6; i++) bounded.observeController({ reason: "controlled_marker_no_photo", request_id: i,
  source_revision: null, seed: null, scan_diameter_mm: 10, kind: "subcutaneous", marker_busy: false, boundary_points: 0 });
assert.equal(JSON.parse(bounded.exportBundle()).controller_events.length, DIAGNOSTIC_LIMITS.controllerEvents);
assert.equal(JSON.parse(bounded.exportBundle()).dropped_controller_events, 7, "超出控制器事件上限时必须记录丢弃数量");
assert.equal(JSON.parse(bounded.exportBundle()).runs.length, 0, "preflight failure is not a detector run");
bounded.observeController({ reason: "controlled_marker_applied", request_id: 70, source_revision: 2,
  seed: { x: 1, y: 1 }, scan_diameter_mm: 10, kind: "cutaneous", marker_busy: false, boundary_points: 24,
  candidate_display_blocked: true, candidate_selection_reason: "all_direction_variants_have_engineering_hard_violations",
  candidate_guardrails_passed: false });
const gateEvent = JSON.parse(bounded.exportBundle()).controller_events.at(-1);
assert.equal(gateEvent.candidate_display_blocked, true);
assert.equal(gateEvent.candidate_guardrails_passed, false);
assert.equal(auditMarkerDiagnosticExport(JSON.parse(bounded.exportBundle())).passed, true);
for (let i = 0; i < 240; i++) {
  const entry = bounded.begin(input, i, "web_worker", pixels, pixels);
  assert.throws(() => bounded.exportBundle(), /尚在生成/);
  entry.finish(failure); await entry.evidence; await Promise.resolve();
}
const retained = JSON.parse(bounded.exportBundle());
assert.equal(retained.runs.length, 240);
assert.equal(retained.runs[0].request_id, 0);
assert.equal(retained.runs[239].request_id, 239);
assert.equal(retained.dropped_runs, 0, "240次识别不应触发容量淘汰");
const beforeEdit = {
  geometry_revision: 1, workflow_request_id: 2, source_revision: 3,
  candidate: { type: "fusiform", center: [1, 2, 3], length_mm: 24, width_mm: 8,
    angle_offset_deg: 0, length_scale: 1, width_scale: 1, point_count: 48, geometry_fingerprint: "fnv1a32-12345678" },
  display: {
    candidate_point_count: 97,
    geometry_fingerprint: "fnv1a32-abcdef12",
    fit_mode: "photoCanonical",
    fit_scale: 1.125,
    boundary_outside_count: 0,
    minimum_boundary_distance_px: 0.04,
  },
};
bounded.observeWorkflow({ event_type: "candidate_edit", stage: "preview", reason: "mobile_edit_previewed",
  control_id: "angleOffsetDeg", requested_value: 10, before: beforeEdit, after: beforeEdit });
bounded.observeWorkflow({ event_type: "candidate_edit", stage: "preview", reason: "mobile_edit_previewed",
  control_id: "angleOffsetDeg", requested_value: 20, before: beforeEdit, after: beforeEdit });
bounded.observeWorkflow({ event_type: "candidate_edit", stage: "committed", reason: "mobile_edit_committed",
  control_id: "angleOffsetDeg", requested_value: 20, before: beforeEdit, after: beforeEdit });
const actionId = bounded.recordAction({ domain: "wrinkle", action: "detection", stage: "started",
  reason: "wrinkle_detection_started", request_id: 22, details: { input_kind: "photo", source_revision: 3 } });
assert.match(actionId || "", /^action-/);
assert.equal(bounded.recordAction({ domain: "Bad Domain", action: "detection", stage: "started", reason: "invalid" }), null);
const session = JSON.parse(bounded.exportSession());
const legacySession = structuredClone(session);
legacySession.runs = [structuredClone(run.run)];
legacySession.page_instances = [{ service_identity: structuredClone(run.run.service_identity) }];
assert.deepEqual(diagnosticReplayMismatches(parseDiagnosticRun(JSON.stringify(legacySession)), run.run), [], "old restored session stays replayable");
const pageOnly = structuredClone(legacySession); pageOnly.runs = [];
const normalizedPageOnly = diagnosticExportPayload(pageOnly) as any;
assert.equal(auditMarkerDiagnosticExport(normalizedPageOnly).passed, true, "page-only exports must handle the real runtime branch too");
assert.equal(normalizedPageOnly.page_instances[0].service_identity.branch, undefined);
for (const fingerprint of ["fnv1a32-3721431b", "fnv1a32-12345678", "fnv1a32-00000000"]) {
  const typedModule = structuredClone(normalizedPageOnly);
  typedModule.page_instances[0].client_module_fingerprint = fingerprint;
  assert.equal(auditMarkerDiagnosticExport(typedModule).passed, true, "real browser module fingerprint is typed metadata");
  assert.equal(typedModule.page_instances[0].client_module_fingerprint, fingerprint, "audit must not change downloaded identity");
}
for (const fingerprint of ["13800138000", "person@example.com", "fnv1a32-13800138000", "fnv1a32-12345678\n", null]) {
  const invalidModule = structuredClone(normalizedPageOnly); invalidModule.page_instances[0].client_module_fingerprint = fingerprint;
  assert.throws(() => auditMarkerDiagnosticExport(invalidModule), /模块指纹/);
}
for (const key of ["head", "worktreeId", "sourceDigest", "assetDigest", "branch_sha256"]) {
  for (const badValue of ["13800138000", "person@example.com", "g".repeat(64)]) {
    const badPage = structuredClone(normalizedPageOnly); badPage.page_instances[0].service_identity[key] = badValue;
    assert.throws(() => auditMarkerDiagnosticExport(badPage), /指纹字段不合法/);
  }
}
const privatePage = structuredClone(normalizedPageOnly); privatePage.page_instances[0].extra = "person@example.com";
assert.equal(auditMarkerDiagnosticExport(privatePage).passed, false);
assert.equal(session.schema, "marker-diagnostic-session/2");
assert.equal(session.workflow_events.length, 2, "consecutive previews are compacted");
assert.equal(session.workflow_events[0].preview_count, 2);
assert.equal(session.workflow_events[0].first_requested_value, 10);
assert.equal(session.workflow_events[0].requested_value, 20);
assert.equal(session.workflow_events[1].stage, "committed");
assert.equal(session.workflow_events[0].action_id, session.workflow_events[1].action_id, "preview and commit share one action id");
assert.equal(session.workflow_events[1].after.display.fit_mode, "photoCanonical");
assert.equal(session.workflow_events[1].after.display.fit_scale, 1.125);
assert.equal(session.workflow_events[1].after.display.boundary_outside_count, 0);
assert.equal(session.workflow_events[1].after.display.minimum_boundary_distance_px, 0.04);
assert.equal(session.runs.length, 240);
assert.equal(session.action_events.length, 1);
assert.equal(session.action_events[0].domain, "wrinkle");
// Real session export: browser version metadata must not be mistaken for a phone.
for (const engine of ["Chrome/149.0.7827.55", "Chrome/145.0.7632.6", "Edg/149.0.7827.55", "Firefox/145.0", "Version/18.1", "unknown"]) {
  const ticket = structuredClone(session);
  ticket.page_instances[0].browser_engine = engine;
  const original = JSON.stringify(ticket);
  assert.equal(auditMarkerDiagnosticExport(ticket).passed, true, `typed browser metadata: ${engine}`);
  assert.equal(JSON.stringify(ticket), original, "audit must preserve original browser evidence");
}
for (const engine of ["13800138000", "person@example.com", "Chrome/13800138000", "Chrome/149.0.7827.55 person@example.com", "Chrome/1..2", "Chrome/149.0.7827.55\n", "unknown\n", "Chrome/1.2.3.4.5", "Chrome/" + "1".repeat(200), 149, null, {}]) {
  const ticket = structuredClone(session);
  ticket.page_instances[0].browser_engine = engine;
  assert.throws(() => auditMarkerDiagnosticExport(ticket), /浏览器元数据/, "invalid typed browser metadata must fail closed");
}
for (const text of ["13800138000", "person@example.com"]) {
  const ticket = structuredClone(session);
  ticket.page_instances[0].navigation_type = text;
  assert.equal(auditMarkerDiagnosticExport(ticket).passed, false, "other page free text remains scanned");
}
const sessionAudit = auditMarkerDiagnosticExport(session);
assert.deepEqual(sessionAudit.violations, [], JSON.stringify(sessionAudit.violations));
assert.equal(parseDiagnosticRun(JSON.stringify(session)).request_id, 239, "v2 session import keeps latest detector run");
bounded.observeController({ reason: "unrelated_review_event", request_id: 99, source_revision: null,
  seed: null, scan_diameter_mm: 10, kind: "cutaneous", marker_busy: false, boundary_points: 0 });
assert.equal(JSON.parse(bounded.exportBundle()).controller_events.at(-1).request_id, 70);
bounded.dispose(); assert.throws(() => bounded.exportBundle(), /操作一次/);
const panelSource = fs.readFileSync(new URL("../web/src/components/TumorInputPanel.tsx", import.meta.url), "utf8");
assert.match(panelSource, /isDeveloperMode\(\)/, "developer diagnostics must follow the explicit developer-mode gate");
assert.match(panelSource, /换图、肿物识别、切口生成、旋转和缩放/);
assert.match(panelSource, /刷新后仍可接续/);
const mountSource = source.slice(source.indexOf("export function mountWorkflowIncisionController"));
assert.match(mountSource, /new MarkerRunDiagnostics/);
assert.doesNotMatch(mountSource, /import\.meta\.env\.DEV/);
// The logger must capture the actual branch inputs, not infer them from touch support.
assert.equal(captureWorkflowInteractionSnapshot(), null, "missing workflow DOM is an explicit observation gap");
const mediaValues = new Map([
  ["(max-width: 560px)", true], ["(pointer: fine)", true],
  ["(pointer: coarse)", false], ["(hover: none)", false],
  ["(hover: hover)", true], ["(any-pointer: coarse)", true],
]);
const rect = { x: 0, y: 0, width: 360, height: 596 };
class WorkflowElement extends EventTarget {
  dataset: Record<string, string> = {};
  id = "canvas";
  scrollTop = 0; clientHeight = 596; scrollHeight = 1400;
  getBoundingClientRect() { return rect; }
  closest(selector: string) { return selector === ".workflow-workbench" ? workflowRoot : null; }
}
const workflowRoot = new WorkflowElement();
const contextRoot = new WorkflowElement();
contextRoot.dataset = { workflowMarkerMode: "true", workflowMarkerBusy: "false" };
const oldQuery = (doc as any).querySelector;
Object.assign(doc, { querySelector(selector: string) {
  if (selector === ".workflow-workbench") return workflowRoot;
  if (selector === "[data-workflow-marker-mode]") return contextRoot;
  return null;
} });
Object.assign(win, { innerWidth: 360, innerHeight: 596, devicePixelRatio: 3,
  matchMedia: (query: string) => ({ matches: mediaValues.get(query) ?? false }),
});
Object.defineProperties(globalThis, {
  Element: { configurable: true, value: WorkflowElement },
  getComputedStyle: { configurable: true, value: () => ({ display: "flex", overflowY: "hidden", touchAction: "auto", gridTemplateRows: "none" }) },
});
const originalRestore = (MarkerRunDiagnostics.prototype as any).restore;
const originalCapture = MarkerRunDiagnostics.prototype.captureClientModule;
let releaseRestore: () => void = () => {};
let captureAfterRestore = false;
(MarkerRunDiagnostics.prototype as any).restore = async function () {
  await new Promise<void>(resolve => { releaseRestore = resolve; });
  await originalRestore.call(this);
};
MarkerRunDiagnostics.prototype.captureClientModule = async function () { captureAfterRestore = true; };
const delayedRestoreDiagnostic = new MarkerRunDiagnostics(getFrame);
assert.equal(captureAfterRestore, false, "source capture must wait for prior session restoration");
releaseRestore();
await delayedRestoreDiagnostic.whenReady();
await Promise.resolve();
assert.equal(captureAfterRestore, true);
delayedRestoreDiagnostic.dispose();
(MarkerRunDiagnostics.prototype as any).restore = originalRestore;
MarkerRunDiagnostics.prototype.captureClientModule = originalCapture;
const uiDiagnostic = new MarkerRunDiagnostics(getFrame);
await uiDiagnostic.whenReady();
const snapshot = captureWorkflowInteractionSnapshot() as any;
assert.equal(snapshot.media.mobile_query, false);
assert.equal(snapshot.media.primary_pointer_fine, true);
assert.equal(snapshot.layout.mobile_pane_present, false);
assert.equal(snapshot.layout.root.scroll_height, 1400);
const touchEvent = new Event("pointerdown", { cancelable: true });
Object.defineProperties(touchEvent, { target: { value: workflowRoot }, pointerType: { value: "touch" }, pointerId: { value: 2 } });
doc.dispatchEvent(touchEvent);
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(touchEvent.defaultPrevented, false, "logging must not consume the touch");
const uiSession = JSON.parse(uiDiagnostic.exportSession());
const uiEvent = uiSession.page_instances.at(-1).interaction_events.find((event: any) => event.action === "pointerdown");
assert.equal(uiEvent.details.pointer_type, "touch");
assert.equal(uiEvent.details.active_pointers, 1);
assert.equal(uiEvent.details.context.media.mobile_query, false);
assert.equal(uiEvent.details.after.layout.marker_busy, false);
assert.equal(uiEvent.details.after_phase, "later_task_sample");
assert.equal(uiSession.page_instances.at(-1).interaction_context.media.primary_pointer_fine, true);
assert.equal(auditMarkerDiagnosticExport(uiSession).passed, true);
assert.equal(uiSession.runs.length, 0, "UI failure evidence must not require a detector run");
const inFlight = uiDiagnostic.begin(input, 999, "web_worker", pixels, pixels);
const incidentSnapshot = JSON.parse(uiDiagnostic.exportSession());
assert.equal(incidentSnapshot.pending_run_count, 1);
assert.equal(incidentSnapshot.runs.at(-1).status, "pending", "export must not pretend the unfinished detector has completed");
assert.equal(auditMarkerDiagnosticExport(incidentSnapshot).passed, true);
assert.throws(() => parseDiagnosticRun(JSON.stringify(incidentSnapshot)), /不支持复放/,
  "an in-flight incident snapshot is evidence only, never a replayable completed result");
inFlight.finish(detection, false, "discarded_request");
await inFlight.evidence;
const recordedBefore = (uiDiagnostic as any).interactionEvents.length;
for (let i = 0; i < DIAGNOSTIC_LIMITS.interactionEvents + 5; i++) doc.dispatchEvent(touchEvent);
await new Promise(resolve => setTimeout(resolve, 5));
const capped = JSON.parse(uiDiagnostic.exportSession());
assert.equal(capped.page_instances.at(-1).interaction_events.length, DIAGNOSTIC_LIMITS.interactionEvents);
const expectedDrops = recordedBefore + DIAGNOSTIC_LIMITS.interactionEvents + 5 + 1 - DIAGNOSTIC_LIMITS.interactionEvents;
assert.equal(capped.page_instances.at(-1).dropped_interaction_events, expectedDrops);
(uiDiagnostic as any).mergePrior(structuredClone(capped));
(uiDiagnostic as any).mergePrior(structuredClone(capped));
assert.equal((uiDiagnostic as any).persisted().page_instances.at(-1).dropped_interaction_events, expectedDrops,
  "merging persisted data must not count the same dropped UI sample again");
assert.equal((uiDiagnostic as any).persisted().action_events.length, 0, "UI samples never occupy the core event buffer");
const otherPageId = "page-" + "1".repeat(24);
const stalePage = { page_instance_id: otherPageId, interaction_revision: 1, interaction_events: [] };
(uiDiagnostic as any).pageInstances.unshift(stalePage);
const newerPrior = structuredClone(capped);
newerPrior.page_instances.unshift({ ...stalePage, interaction_revision: 2,
  interaction_events: [{ action: "pointerdown", observed_at_ms: 1, phase: "capture" }] });
(uiDiagnostic as any).mergePrior(newerPrior);
assert.equal((uiDiagnostic as any).pageInstances.find((page: any) => page.page_instance_id === otherPageId).interaction_revision, 2,
  "a stale cached page must not overwrite another active page's newer persisted observations");
const historicalPages = Array.from({ length: 8 }, (_, pageIndex) => ({
  page_instance_id: "page-" + (pageIndex + 2).toString(16).repeat(24),
  interaction_revision: 1,
  interaction_events: Array.from({ length: 100 }, (_, index) => ({
    action: "pointermove", observed_at_ms: index + pageIndex * 100,
    details: { padding: "x".repeat(4000) },
  })),
}));
(uiDiagnostic as any).pageInstances.unshift(...historicalPages);
const budgeted = (uiDiagnostic as any).persisted();
const uiSamples = budgeted.page_instances.flatMap((page: any) => page.interaction_events || []);
assert.ok(uiSamples.length <= DIAGNOSTIC_LIMITS.interactionEvents, "UI capacity is bounded for the session, not only per page");
assert.ok(uiSamples.reduce((sum: number, sample: any) => sum + new TextEncoder().encode(JSON.stringify(sample)).byteLength, 0) <= DIAGNOSTIC_LIMITS.interactionBytes);
assert.ok(budgeted.page_instances.reduce((sum: number, page: any) => sum + (page.session_budget_omitted_interaction_events || 0), 0) > 0);
win.dispatchEvent(new Event("resize"));
await new Promise(resolve => setTimeout(resolve, 270));
assert.equal((uiDiagnostic as any).observedPointers.size, 1, "resize does not mean that fingers were released");
const productHandler = () => { contextRoot.dataset.workflowMarkerBusy = "true"; };
doc.addEventListener("pointerdown", productHandler);
doc.dispatchEvent(touchEvent);
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal((uiDiagnostic as any).interactionEvents.at(-1).details.after.layout.marker_busy, true,
  "later task must observe state changed by a subsequent product handler");
doc.removeEventListener("pointerdown", productHandler);
const outsideWorkflow = new WorkflowElement();
outsideWorkflow.closest = () => null;
const rawTouchEvent = new Event("touchstart", { cancelable: true });
Object.defineProperties(rawTouchEvent, { target: { value: workflowRoot }, touches: { value: [
  { target: workflowRoot, clientX: 20, clientY: 30 }, { target: outsideWorkflow, clientX: 900, clientY: 800 },
] } });
doc.dispatchEvent(rawTouchEvent);
const touchObservation = (uiDiagnostic as any).interactionEvents.at(-1);
assert.equal(touchObservation.details.touch_count, 1);
assert.deepEqual(touchObservation.details.touch_positions, [{ client_x: 20, client_y: 30 }],
  "workflow touches must never include coordinates from outside the workflow");
assert.equal(rawTouchEvent.defaultPrevented, false);
Object.assign(win, { matchMedia() { throw new Error("unavailable"); } });
assert.doesNotThrow(() => doc.dispatchEvent(touchEvent), "observation failures must not escape into product interaction");
uiDiagnostic.dispose();
Object.assign(doc, { querySelector: oldQuery });
console.log("test_controlled_marker_run_diagnostics: transfer, file binding, run isolation, privacy, identity, replay preflight and controller gate passed");
