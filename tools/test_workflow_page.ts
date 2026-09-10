import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";

import {
  beginWorkflowPointerIntent,
  completesWorkflowCanvasClick,
  minimumWorkflowMarkerScanDiameterMm,
  updateWorkflowPointerIntent,
  workflowCandidateDisplayAllowed,
  workflowDiagnosticCandidateVisible,
  workflowProjectionStatusMayOverride,
  workflowPhotoSurfaceReferenceRecoveryEligible,
  workflowVisibilityLimitedReferenceDisplayActive,
  workflowUpperForeheadSurfaceRecoveryActive,
  workflowBoundaryCentroid,
  workflowBoundaryModeTransition,
  workflowControlledMarkerCrop,
  workflowClosedBoundarySvgPath,
  workflowFreehandBoundaryClosed,
  workflowFreehandContinuationAllowed,
  workflowFreehandToggleAction,
  workflowFocusViewportPoint,
  workflowFusiformEditBase,
  workflowFusiformPlaneNormal,
  workflowFusiformSvgPath,
  workflowInvalidationNeedsLiveFrame,
  workflowLiveOverlayChanged,
  workflowMarkerRequestStillCurrent,
  workflowMarkerScanDiameterForTumor,
  workflowCenteredLinearPath,
  workflowPhotoCircleFootprint,
  workflowPhotoBoundaryEnclosingDiameterMm,
  workflowPhotoEllipseBoundary,
  workflowPhotoOpeningIntersection,
  workflowPhotoTumorOpeningIntersection,
  workflowPhotoTumorOutline,
  workflowPlanningClientPoint,
  workflowScanCircleGeometry,
  recoverWorkflowFreehandBoundary,
  smoothWorkflowClosedBoundary,
  workflowSubcutaneousLengthLimit,
} from "../web/src/services/workflowControllerUtils.ts";
import { svgOverlayExportViewBox } from "../web/src/services/incisionExport.ts";
import { incisionCandidateScreenStyle, incisionOverlayScreenStyle } from "../web/src/services/incisionOverlayStyle.ts";
import { buildPhotoSpaceDiameterEstimate, type SurfaceProjectedFusiformFit } from "../web/src/services/incisionPhotoPlanning.ts";
import type { Vec3 } from "../web/src/services/softBody.ts";
import { tumorDiameterParameterInactive } from "../web/src/services/tumorInput.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const app = read("web/src/App.tsx");
const route = read("web/src/routes/WorkflowRoute.tsx");
const workbench = read("web/src/routes/WorkflowWorkbench.tsx");
const mobileControls = read("web/src/components/MobileWorkflowControls.tsx");
const liveStagePanel = read("web/src/components/LiveStagePanel.tsx");
const workflowDraftRecovery = read("web/src/components/WorkflowDraftRecovery.tsx");
const workflowDraftSession = read("web/src/services/workflowDraftSession.ts");
const mobileVisibility = read("web/src/services/mobileWorkflowVisibility.ts");
const canvasTools = read("web/src/components/WorkflowCanvasTools.tsx");
const stageStatus = read("web/src/components/WorkflowStageStatus.tsx");
const incisionRail = read("web/src/components/WorkflowIncisionRail.tsx");
const standaloneIncision = read("web/src/routes/IncisionWorkbench.tsx");
const candidateResultPanel = read("web/src/components/CandidateResultPanel.tsx");
const candidateLibraryPanel = read("web/src/components/CandidateLibraryPanel.tsx");
const incisionSnapshots = read("web/src/services/incisionSnapshots.ts");
const tumorInputPanel = read("web/src/components/TumorInputPanel.tsx");
const reviewControlsPanel = read("web/src/components/ReviewControlsPanel.tsx");
const liveRail = read("web/src/components/LiveControlRail.tsx");
const liveQualityPanel = read("web/src/components/LiveQualityPanel.tsx");
const liveSourceControls = read("web/src/components/LiveSourceControlsPanel.tsx");
const liveRenderControls = read("web/src/components/LiveRenderControlsPanel.tsx");
const liveCanvasFit = read("web/src/services/liveCanvasFit.ts");
const liveCanvasInteraction = read("web/src/services/liveCanvasInteraction.ts");
const liveRuntime = read("web/src/services/liveRuntime.ts");
const controllerCommand = read("web/src/lib/controllerCommand.ts");
const incisionExport = read("web/src/services/incisionExport.ts");
const reviewPolicy = read("web/src/services/incisionReviewPolicy.ts");
const controller = read("web/src/services/workflowIncisionController.ts");
const pipelineLoop = read("web/src/services/pipelineLoop.ts");
const render2d = read("web/src/services/render2d.ts");
const photoPlanning = read("web/src/services/incisionPhotoPlanning.ts");
const layout = read("web/src/components/WorkflowLayout.tsx");
const sharedLayout = read("web/src/components/WorkbenchLayout.tsx");
const styles = read("web/src/styles.css");
const persistentTooltip = read("web/src/components/ui/persistent-tooltip.tsx");

// Render only the layout shells: no runtime, browser, assets, or models are loaded.
const requireWeb = createRequire(path.join(root, "web/package.json"));
const ts = requireWeb("typescript");
// Execute the production state transitions; only rendering, storage and planning
// boundaries are substituted, so this remains a CPU-only controller regression.
const controllerAst = ts.createSourceFile("controller.ts", controller, ts.ScriptTarget.Latest, true);
const markerFunction = controllerAst.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === "runControlledMarker");
const markerTry = markerFunction.body.statements.find((node: any) => ts.isTryStatement(node)
  && node.getText(controllerAst).includes("const outcome = await runWorkflow(state)"));
const markerCompletion = markerTry.tryBlock.statements;
const completionStart = markerCompletion.findIndex((node: any) => node.getText(controllerAst).startsWith("completeControlledMarkerAttempt(state, mobileRetrySeed)"));
const completionSource = markerCompletion.slice(completionStart).map((node: any) => node.getText(controllerAst)).join("\n");
assert.ok(completionStart >= 0, "extract the actual post-planning marker completion path");
const settleMarker = runInNewContext(ts.transpileModule(`(function(state, outcome) { const mobileRetrySeed = null; ${completionSource} })`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, {
  completeControlledMarkerAttempt: (state: any) => { state.markerBusy = false; },
  publish: (state: any, reason: string) => { state.published = { reason, markerBusy: state.markerBusy, status: state.stageStatus }; },
  setStatus: (state: any, message: string) => { state.stageStatus = message; },
  CONTROLLED_MARKER_DETECTOR_VERSION: "test",
});
const staleMarker = { markerBusy: true, workflowRequestId: 2, stageStatus: "newer workflow status" };
settleMarker(staleMarker, { status: "stale", requestId: 1 });
assert.deepEqual(JSON.parse(JSON.stringify(staleMarker)), {
  markerBusy: false, workflowRequestId: 2, stageStatus: "newer workflow status",
  published: { reason: "controlled_marker_candidate_stale", markerBusy: false, status: "newer workflow status" },
}, "stale candidate completion releases the marker UI without replacing newer status");
const transitionNames = ["createState", "publishLiveOverlayState", "invalidateCandidate", "markCandidatePendingReview", "revokeActiveRecord",
  "invalidateSavedSources", "savedCandidateUsable", "activateRecord", "loadSavedCandidateState",
  "toggleSavedCandidateReviewStatus", "handleLibraryCommand", "reconcileProjectedRstlSnapshot",
  "activeProjectedRstlLines", "projectedRstlFingerprint", "applyWorkflowDraftRestore", "runWorkflow"];
const transitionSource = controllerAst.statements.filter((node: any) => ts.isFunctionDeclaration(node)
  && transitionNames.includes(node.name?.text)).map((node: any) => node.getText(controllerAst)).join("\n");
function controllerHarness() {
  const frame = { kind: "image", revision: 1, source: {}, landmarks: [] };
  const render = { incisionOverlay: null as any, refine2d: { lines: [{ pts: [[1, 2, 3]] }] } };
  const events: string[] = [];
  let redraws = 0;
  let planner: () => Promise<any> = async () => ({ result: { candidate: { type: "fusiform" }, guardrails: { passed: true } } });
  const neutral = () => ({ angle_offset_deg: 0, length_scale: 1, width_scale: 1, reason: "" });
  const context = {
    sourceState: { sourceKind: "image", paused: false, planning2d: { getFrameState: () => frame, setOverlaySummary() {} } },
    renderState: render, neutralIncisionEdit: neutral, cloneIncisionEdit: (edit: any) => ({ ...edit }),
    cancelCandidateRecompute() {}, cancelMobileEditPreview() {}, cancelWorkflowDraftRestoreRetry() {},
    scheduleWorkflowDraftRestoreRetry() {}, resetMarkerRepair() {},
    completeWorkflowDraftRestoreRequest() {},
    resetFreehandPhotoBoundary() {}, syncSelection() {}, rootInput: () => null,
    publish: (_state: any, reason: string) => events.push(reason),
    LIVE_CONTROLLER_STATE_EVENT: "live-state", workflowLiveOverlayChanged,
    dispatchControllerEvent: (_name: string, detail: any) => events.push(detail.reason),
    setStatus: (state: any, message: string) => { state.stageStatus = message; },
    requestFrame: () => { redraws += 1; }, workflowInvalidationNeedsLiveFrame: (had: boolean) => had,
    compileIncisionOverlay: (record: any) => record.review?.status === "approved_for_discussion" ? { id: record.id } : null,
    currentReview: (state: any) => state.review,
    transitionIncisionReviewRecord: ({ record, targetStatus }: any) => ({ ok: true,
      record: { ...record, review: { ...record.review, status: targetStatus }, review_status: targetStatus } }),
    readIncisionLibraryCommand: (event: any) => event.detail,
    pointToSurfaceRef: (point: any) => point, pointsToSurfaceRefs: (points: any) => points,
    workflowPhotoReady: () => true,
    importedTumorFormState: (tumor: any) => ({ tumor, kind: "cutaneous", diameterValue: 8, depthValue: 6,
      marginValue: 0, author: "test", boundaryPoints: [] }),
    tumorContextsMatch: () => true, restoredWorkflowEdit: (edit: any) => edit,
    currentTumor: (state: any) => state.centerRef ? { center: [0, 0, 0] } : null,
    workflowPhotoProjection: () => null, activeAtlas: () => ({}), queryIncisionPhotoRstlDirection: () => null,
    nearestVertex: () => 0, ensureWorker: () => null, incisionEditIsActive: () => false,
    planIncisionWithWorkflowFallback: () => planner(),
  };
  const presentNames = controllerAst.statements.filter((node: any) => ts.isFunctionDeclaration(node)
    && transitionNames.includes(node.name?.text)).map((node: any) => node.name.text);
  const api = runInNewContext(ts.transpileModule(`${transitionSource}\n({${presentNames.join(",")}})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  const state = api.createState({});
  Object.assign(state, { loading: false, verts: [[0, 0, 0]], tris: [[0, 0, 0]], atlas: {}, centerRef: [0, 0, 0],
    liveSnapshot: { incisionOverlay: { loaded: false } } });
  const record = { id: "review-uuid", candidate: {}, tumor: { center: [0, 0, 0] },
    review: { status: "approved_for_discussion", reviewer: "test" } };
  state.result = { id: "planner-result-id", candidate: {} };
  state.saved = [record, { ...record, id: "other" }];
  return { api, state, record, frame, render, events, context, redraws: () => redraws,
    plan: (fn: () => Promise<any>) => { planner = fn; } };
}
const stateFailures: string[] = [];
async function stateRegression(name: string, check: () => unknown) {
  try { await check(); } catch (error) { stateFailures.push(`${name}: ${error}`); }
}
for (const command of ["toggle_candidate_review_status", "remove_candidate", "clear_saved"]) {
  await stateRegression(`active ${command}`, () => {
    const h = controllerHarness();
    h.api.activateRecord(h.state, h.record);
    const before = h.redraws();
    h.api.handleLibraryCommand(h.state, { detail: { command, id: h.record.id } });
    assert.equal(h.render.incisionOverlay, null);
    assert.equal(h.state.liveSnapshot.incisionOverlay.loaded, false);
    assert.equal(h.state.activeReviewRecordId, null);
    assert.equal(h.redraws(), before + 1, "one redraw for revocation");
  });
}
await stateRegression("remove unrelated record", () => {
  const h = controllerHarness();
  h.api.activateRecord(h.state, h.record);
  const before = h.redraws();
  h.api.handleLibraryCommand(h.state, { detail: { command: "remove_candidate", id: "other" } });
  assert.equal(h.render.incisionOverlay.id, h.record.id);
  assert.equal(h.redraws(), before);
});
for (const nextLines of [[], [{ pts: [[4, 5, 6]] }]]) {
  await stateRegression(`RSTL A to ${nextLines.length ? "B" : "none"}`, () => {
    const h = controllerHarness();
    h.api.activateRecord(h.state, h.record);
    h.state.candidateRstlFingerprint = h.api.projectedRstlFingerprint(h.render.refine2d.lines);
    h.render.refine2d.lines = nextLines;
    assert.equal(h.api.reconcileProjectedRstlSnapshot(h.state), true);
    assert.equal(h.state.result, null);
    for (const command of ["load_candidate", "toggle_candidate_review_status"]) {
      h.api.handleLibraryCommand(h.state, { detail: { command, id: h.record.id } });
      assert.equal(h.state.result, null, "invalid source cannot re-enter by library");
      assert.equal(h.render.incisionOverlay, null);
    }
  });
}
await stateRegression("camera projection keeps approved overlay", () => {
  const h = controllerHarness();
  h.api.activateRecord(h.state, h.record);
  h.state.candidateRstlFingerprint = h.api.projectedRstlFingerprint(h.render.refine2d.lines);
  h.context.sourceState.sourceKind = "camera";
  h.frame.kind = "video";
  assert.equal(h.api.reconcileProjectedRstlSnapshot(h.state), false);
  assert.equal(h.render.incisionOverlay.id, h.record.id);
});
await stateRegression("draft restores input only and blocks old library", () => {
  const h = controllerHarness();
  h.api.activateRecord(h.state, h.record);
  h.state.pendingDraftRestore = { workspace: { tumor: { center: [0, 0, 0] }, result: h.state.result,
    baseResult: h.state.result, saved: h.state.saved, review: h.record.review, generationCount: 2 },
    edit: { angle_offset_deg: 20 }, boundaryMode: "ellipse" };
  assert.equal(h.api.applyWorkflowDraftRestore(h.state), true);
  assert.equal(h.state.result, null);
  assert.equal(h.state.baseResult, null);
  assert.equal(h.state.edit.angle_offset_deg, 0);
  assert.equal(h.state.review.status, "pending_clinician_confirmation");
  assert.equal(h.state.saved.length, 2, "history retained");
  for (const command of ["load_candidate", "toggle_candidate_review_status"]) {
    h.api.handleLibraryCommand(h.state, { detail: { command, id: h.record.id } });
    assert.equal(h.state.result, null);
    assert.equal(h.render.incisionOverlay, null);
  }
  assert.ok(!h.events.includes("workflow_running"), "restore must not generate automatically");
});
await stateRegression("workflow outcome distinguishes failure and not-ready", async () => {
  const h = controllerHarness();
  h.plan(async () => { throw new Error("planned failure"); });
  assert.equal((await h.api.runWorkflow(h.state)).status, "failure");
  assert.match(h.state.stageStatus, /planned failure/);
  h.state.centerRef = null;
  assert.equal((await h.api.runWorkflow(h.state)).status, "not-ready");
});
await stateRegression("late success or failure cannot overwrite newer request", async () => {
  for (const rejectLate of [false, true]) {
    const h = controllerHarness();
    let settle: (value?: any) => void = () => {};
    h.plan(() => new Promise((resolve, reject) => { settle = rejectLate ? reject : resolve; }));
    const pending = h.api.runWorkflow(h.state);
    h.state.workflowRequestId += 1;
    h.state.stageStatus = "newer request";
    settle(rejectLate ? new Error("old failure") : { result: { candidate: {} } });
    assert.equal((await pending).status, "stale");
    assert.equal(h.state.stageStatus, "newer request");
    assert.equal(h.state.result, null);
  }
});
await stateRegression("clear library cancels a pending result", async () => {
  const h = controllerHarness();
  let finish: (value: any) => void = () => {};
  h.plan(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.api.runWorkflow(h.state);
  h.api.handleLibraryCommand(h.state, { detail: { command: "clear_saved" } });
  finish({ result: { candidate: {} } });
  assert.equal((await pending).status, "stale");
  assert.equal(h.state.result, null);
  assert.equal(h.render.incisionOverlay, null);
});
await stateRegression("source change makes late rejection stale", async () => {
  const h = controllerHarness();
  let fail: (value: any) => void = () => {};
  h.plan(() => new Promise((_resolve, reject) => { fail = reject; }));
  const pending = h.api.runWorkflow(h.state);
  h.frame.revision += 1;
  fail(new Error("old source failure"));
  assert.equal((await pending).status, "stale");
  assert.ok(!h.state.stageStatus.includes("old source failure"));
});
await stateRegression("successful request is explicit and becomes unapproved", async () => {
  const h = controllerHarness();
  const outcome = await h.api.runWorkflow(h.state);
  assert.equal(outcome.status, "success");
  assert.equal(outcome.requestId, h.state.workflowRequestId);
  assert.equal(h.state.review.status, "pending_clinician_confirmation");
  assert.equal(h.render.incisionOverlay, null);
});
await stateRegression("empty planner result is not a successful generation", async () => {
  const h = controllerHarness();
  h.plan(async () => ({ result: {} }));
  assert.equal((await h.api.runWorkflow(h.state)).status, "failure");
  assert.equal(h.state.result, null);
});
await stateRegression("stale source also clears retained photo geometry", async () => {
  const h = controllerHarness();
  let finish: (value: any) => void = () => {};
  h.plan(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.api.runWorkflow(h.state, false, true);
  h.frame.revision += 1;
  finish({ result: { candidate: {} } });
  assert.equal((await pending).status, "stale");
  assert.equal(h.state.result, null);
});
await stateRegression("photo-only restore revokes the active overlay", () => {
  const h = controllerHarness();
  h.api.activateRecord(h.state, h.record);
  h.state.pendingDraftRestore = null;
  h.api.applyWorkflowDraftRestore(h.state);
  assert.equal(h.state.result, null);
  assert.equal(h.render.incisionOverlay, null);
});
await stateRegression("invalidation event cannot recursively modify RSTL", () => {
  const h = controllerHarness();
  h.api.activateRecord(h.state, h.record);
  h.state.candidateRstlFingerprint = h.api.projectedRstlFingerprint(h.render.refine2d.lines);
  h.render.refine2d.lines = [{ pts: [[4, 5, 6]] }];
  const sourceBefore = JSON.stringify(h.render.refine2d);
  let calls = 0;
  h.context.dispatchControllerEvent = () => {
    calls += 1;
    assert.ok(calls <= 1, "invalidation event must settle");
    h.api.reconcileProjectedRstlSnapshot(h.state);
  };
  h.api.reconcileProjectedRstlSnapshot(h.state);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(h.render.refine2d), sourceBefore);
});
assert.deepEqual(stateFailures, [], "production controller state regressions");
const react = requireWeb("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server");
const { clsx } = requireWeb("clsx");
const { twMerge } = requireWeb("tailwind-merge");
const h = react.createElement;
const loadLayout = (source: string, phone: boolean, shared?: unknown) => {
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === "react/jsx-runtime") return requireWeb(name);
    if (name === "react") return { ...react, useState: () => [phone], useEffect: () => {} };
    if (name === "../lib/cn") return { cn: (...values: unknown[]) => twMerge(clsx(values)) };
    if (name === "./WorkbenchLayout") return shared;
    throw new Error(`Unexpected layout dependency: ${name}`);
  } });
  return exports;
};
const layoutExports = loadLayout(sharedLayout, false) as Record<string, typeof react.Component>;
const stageFixture = h("main", { id: "stage-fixture" }, "stage");
const liveFixture = h("button", { id: "live-fixture" }, "live");
const incisionFixture = h("button", { id: "incision-fixture" }, "incision");
// Attribute order is immaterial; compare the complete element/attribute tree.
const canonicalMarkup = (element: unknown) => renderToStaticMarkup(element).replace(
  /<([a-z][\w-]*)(\s[^<>]*?)?>/g,
  (_: string, tag: string, attrs = "") => `<${tag}${(attrs.match(/\s+[\w:-]+(?:="[^"]*")?/g) || []).sort().join("")}>`,
);
for (const workspace of ["annotate", "incision", "live", "surgery", "workflow"]) {
  for (const secondary of [null, incisionFixture]) {
    const sidebar = h("aside", { "aria-label": "live", className: "sidebar live-rail" }, liveFixture);
    const trailing = secondary ? h("aside", { "aria-label": "incision", className: "sidebar incision-rail" }, secondary) : null;
    const expected = h("div", { className: `app clinical-compat-workbench ${workspace}-workbench`, id: "frame" },
      workspace === "incision" ? stageFixture : sidebar,
      workspace === "incision" ? sidebar : stageFixture, trailing);
    const actual = h(layoutExports.WorkbenchLayout, { workspace, id: "frame", stage: stageFixture,
      sidebarLabel: "live", sidebarClassName: "live-rail", secondarySidebar: secondary,
      secondarySidebarLabel: "incision", secondarySidebarClassName: "incision-rail" }, liveFixture);
    assert.equal(canonicalMarkup(actual), canonicalMarkup(expected), `${workspace}: shell DOM and order stay unchanged`);
  }
}
for (const phone of [false, true]) {
  for (const operations of [null, h("button", { id: "operations-fixture" }, "operations")]) {
    const { WorkflowLayout } = loadLayout(layout, phone, layoutExports) as Record<string, typeof react.Component>;
    const actual = h(WorkflowLayout, { stage: stageFixture, liveRail: liveFixture, incisionRail: incisionFixture, mobileOperations: operations });
    const expected = phone
      ? h("div", { className: "app clinical-compat-workbench workflow-workbench" }, stageFixture,
        h("div", { className: "workflow-mobile-operation-pane", "aria-label": "移动端操作台" },
          h("div", { className: "workflow-mobile-recovery-slot" }), operations,
          h("aside", { "aria-label": "实时 RSTL 操作台", className: "sidebar workflow-live-rail live-workbench" }, liveFixture),
          h("aside", { "aria-label": "切口规划操作台", className: "sidebar workflow-incision-rail incision-workbench" }, incisionFixture)))
      : h(layoutExports.WorkbenchLayout, { workspace: "workflow", stage: stageFixture,
        sidebarLabel: "实时 RSTL 操作台", sidebarClassName: "workflow-live-rail live-workbench",
        secondarySidebarLabel: "切口规划操作台", secondarySidebarClassName: "workflow-incision-rail incision-workbench",
        secondarySidebar: incisionFixture }, liveFixture);
    assert.equal(canonicalMarkup(actual), canonicalMarkup(expected), `phone=${phone}: workflow DOM stays unchanged`);
  }
}

assert.match(app, /path="\/app\/workflow"\s+element={<WorkflowRoute\s*\/>}/, "workflow route stays inside the React SPA");
assert.match(route, /import\("\.\.\/services\/liveRuntime"\)/, "workflow route reuses the live media runtime");
assert.match(route, /import\("\.\.\/services\/workflowIncisionController"\)/, "workflow route mounts the canvas-free incision controller");
assert.doesNotMatch(route, /incisionRuntime/, "workflow route must not mount the legacy incision runtime beside liveRuntime");
assert.equal((workbench.match(/<LiveStagePanel\b/g) || []).length, 1, "workflow renders one visible live stage");
assert.doesNotMatch(liveStagePanel, /workflow-mobile-scroll-zone|从这里向上滑动，查看更多操作/,
  "the fixed mobile stage no longer renders the obsolete page-scroll prompt");
assert.doesNotMatch(sharedLayout, /mobileOperations|workflow-mobile-operation-pane/,
  "the shared desktop workbench keeps its original source order and has no workflow-only mobile branch");
assert.match(layout, /MOBILE_WORKFLOW_LAYOUT_QUERY[\s\S]*?if \(mobileViewport\)[\s\S]*?stage[\s\S]*?workflow-mobile-operation-pane[\s\S]*?mobileOperations[\s\S]*?workflow-live-rail[\s\S]*?workflow-incision-rail/,
  "the workflow-only phone branch keeps the fixed stage before its ordered independent operation pane");
assert.match(layout, /if \(mobileViewport\)[\s\S]*?return \([\s\S]*?<WorkbenchLayout/,
  "non-phone viewports continue through the unchanged shared desktop workbench");
assert.match(styles, /\.workflow-workbench > \.workflow-mobile-operation-pane\s*{[^}]*display:\s*flex;[^}]*overflow-y:\s*auto;[^}]*scrollbar-width:\s*none;[^}]*touch-action:\s*pan-y;/s,
  "the phone operation pane owns vertical touch scrolling without a visible scrollbar");
assert.match(controller, /dataset\.workflowMarkerMode = String\(state\.markerMode\)/,
  "the workflow root exposes controlled-marker mode for mobile layout containment");
assert.match(controller, /delete state\.root\.dataset\.workflowMarkerMode/,
  "disposing the workflow controller removes its controlled-marker layout state");
assert.doesNotMatch(styles, /workflow-marker-mode="true"[^}]*\.main-wrap\s*{[^}]*flex-basis:/s,
  "controlled-marker mode does not resize the shared face canvas");
assert.doesNotMatch(styles, /workflow-mobile-scroll-zone/,
  "the removed mobile scroll prompt has no stale styling contract");
assert.match(styles, /"quality incision-status"[\s\S]*?"workflow-actions workflow-actions"/,
  "phone workflow keeps compact quality and result information above the face instead of over it");
assert.match(styles, /\.workflow-canvas-tools\s*{[^}]*grid-template-rows:\s*40px;[^}]*block-size:\s*42px;[^}]*padding:\s*0;[\s\S]*?\.workflow-canvas-tools\[data-marker-mode="true"\]\s*{[^}]*grid-template-rows:\s*repeat\(2, 40px\);[^}]*block-size:\s*88px;/s,
  "phone workflow uses one tool row normally and adds the second row only during controlled marking");
assert.match(canvasTools, /data-marker-mode={String\(markerMode\)}[\s\S]*?data-marker-busy={String\(markerBusy\)}/,
  "phone tool layout exposes marker state without changing command semantics");
assert.match(styles, /#wrinkleSummary\s*{[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s,
  "long local V10 runtime errors wrap inside the mobile workflow rail instead of widening the shared canvas");
assert.match(mobileControls, /const candidateReady = Boolean\(edit\?\.widthScaleVisible\)/,
  "mobile candidate editing follows the controller capability instead of the intentionally hidden candidate summary");
const fusiformBase = { candidate: { type: "fusiform", id: "base" } };
assert.equal(
  workflowFusiformEditBase({ candidate: { type: "fusiform", id: "edited" } }, fusiformBase),
  fusiformBase,
  "mobile candidate editing uses the stored unedited fusiform baseline when it is available",
);
const recoveredFusiformBase = workflowFusiformEditBase({
  candidate: { type: "fusiform", id: "edited" },
  original_candidate: { type: "fusiform", id: "original" },
}, null);
assert.equal(recoveredFusiformBase?.candidate?.id, "original",
  "a restored fusiform candidate recovers its editable baseline from original_candidate");
assert.equal(workflowFusiformEditBase({ candidate: { type: "linear" } }, fusiformBase), null,
  "the mobile fusiform controls remain unavailable for linear candidates");
assert.match(controller, /widthScaleVisible: Boolean\(workflowFusiformEditBase\(state\.result, state\.baseResult\)\)/,
  "the mobile adjustment capability follows the recoverable current fusiform instead of requiring one internal state path");
assert.match(controller, /const baseResult = workflowFusiformEditBase\(state\.result, state\.baseResult\)[\s\S]*?state\.baseResult = baseResult[\s\S]*?applyCandidateEdit\(baseResult/,
  "mobile edit commands restore a recoverable fusiform baseline before applying the adjustment");
assert.match(workflowDraftRecovery, /仅保存在这个浏览器标签页，30 分钟后过期；不会上传服务器。/,
  "temporary face-photo recovery states its session-only privacy boundary next to the controls");
assert.match(workflowDraftRecovery, /if \(!draft \|\| sourceKind === "image"\) return null;/,
  "temporary saving stays silent while the current photo is active");
assert.doesNotMatch(workflowDraftRecovery, /当前照片已临时保存|当前页面已临时保存/,
  "the active-page temporary-save notice is not rendered");
assert.match(workflowDraftSession, /globalThis\.sessionStorage/,
  "workflow recovery stays within the current browser-tab session");
assert.doesNotMatch(workflowDraftSession, /indexedDB|localStorage/,
  "workflow recovery cannot grow into a persistent browser case database");
assert.match(workbench, /workflowActions={<WorkflowCanvasTools\s*\/>}/, "workflow places incision actions in the shared stage header");
assert.match(workbench, /workflowOverlay={<WorkflowCanvasOverlay\s*\/>}/, "workflow keeps only the incision drawing layer over the shared canvas");
assert.match(workbench, /workflowStatus={<WorkflowStageStatus\s*\/>}/, "workflow places incision status in the shared stage header");
assert.match(workbench, /mobileOperations={<MobileWorkflowControls\s*\/>}/,
  "workflow mounts one phone-only control dock inside the independent operation pane");
assert.match(workbench, /<LiveControlRail[\s\S]*?moveQualityToMobileStage/,
  "workflow moves its existing quality panel to the phone stage header instead of mounting a duplicate badge");
assert.doesNotMatch(workbench, /MobileCanvasQualityBadge|mobileOverlay=/,
  "workflow no longer creates a second quality readout beside the original panel");
assert.match(liveQualityPanel, /createPortal\(panel, mobileTarget\)/,
  "the original quality panel moves to the phone canvas while retaining its existing DOM ids and updates");
assert.match(liveQualityPanel, /langerface:live-quality-relocated/,
  "quality relocation announces its DOM move so the running renderer can refresh cached element references");
assert.match(liveRuntime, /langerface:live-quality-relocated[\s\S]*?bindDom\(root\)/,
  "the live runtime safely rebinds its original quality DOM references after a responsive relocation");
assert.match(liveQualityPanel, /mobileTarget \? "跟踪质量参考" : "追踪质量"[\s\S]*?id="qualityVal"[\s\S]*?id:\s*"qualityBar"[\s\S]*?受分辨率与光线影响/,
  "the moved panel exposes the requested three-line phone copy and the existing dynamic quality scale");
assert.match(stageStatus, /snapshot\?\.stageStatus/, "workflow stage status renders the current incision result or warning");
assert.match(stageStatus, /snapshot\?\.stageBusy/, "workflow stage status consumes the incision-only busy state");
assert.match(stageStatus, /workflow-stage-spinner/, "workflow renders an explicit waiting animation for incision work");
assert.match(stageStatus, /aria-busy={busy}/, "workflow exposes waiting state to assistive technology");
assert.match(stageStatus, /window\.setTimeout\(\(\) => setVisible\(false\), 4_000\)/,
  "ordinary mobile result copy visually clears after four seconds");
assert.match(stageStatus, /MOBILE_WORKFLOW_MEDIA_QUERY[\s\S]*?if \(!mobileViewport \|\| persistent\) return;/,
  "the four-second result presentation is gated to phone-class coarse-pointer viewports");
assert.match(stageStatus, /busy \|\| warning \|\| activeTool/,
  "busy, warning, and active-tool guidance remains persistent instead of being timed away");
assert.match(styles, /@media \(max-width:\s*560px\) and \(pointer:\s*coarse\) and \(hover:\s*none\)[\s\S]*?\.workflow-stage-status\.is-collapsed\s*{[^}]*visibility:\s*hidden;/,
  "desktop workflow status cannot inherit the phone-only timed presentation style");
assert.match(styles, /\.workflow-workbench \.workflow-stage-status\s*\{[^}]*white-space:\s*normal;[^}]*overflow:\s*visible;/s,
  "workflow canvas status wraps instead of truncating operator guidance");
assert.match(styles, /\.workflow-workbench \.workflow-stage-status > span:last-child\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/s,
  "the status text child does not reintroduce ellipsis truncation");
assert.match(workbench, /<LiveControlRail[\s\S]*?showIncisionEntry={false}[\s\S]*?showStatusOverview={false}[\s\S]*?showPersonalizedHint={false}[\s\S]*?\/>/,
  "workflow hides its duplicate RSTL status overview and personalized hint without changing the standalone rail");
assert.match(liveRail, /showStatusOverview\s*=\s*true/, "the standalone RSTL page retains its status overview by default");
assert.match(liveRail, /showPersonalizedHint\s*=\s*true/, "the standalone RSTL page retains its existing personalized hint by default");
assert.doesNotMatch(workbench, /IncisionStagePanel/, "workflow does not mount the legacy incision stage toolbar");
for (const duplicateControl of ["incisionPhotoUploadLabel", "incisionPhotoMirrorBtn", "incisionSurfaceModeBtn"]) {
  assert.doesNotMatch(canvasTools, new RegExp(duplicateControl), `workflow omits duplicate legacy control ${duplicateControl}`);
}
assert.doesNotMatch(canvasTools, /选择肿物|MousePointer2|commands\.tool\("select_lesion"\)/, "direct canvas selection needs no extra lesion-selection button");
assert.doesNotMatch(canvasTools, /Undo2|commands\.tool\("undo_repair"\)/, "workflow hides the undo-repair control without removing its command");
for (const expectedControl of ["受控标记", "补线", "清除补线", "复位"]) {
  assert.match(canvasTools, new RegExp(expectedControl), `workflow keeps the explicit ${expectedControl} control`);
}
assert.match(canvasTools, /workflow-mobile-marker-confirm/, "workflow renders a mobile-only controlled-marker confirmation action");
assert.match(canvasTools, /commands\.tool\("confirm_controlled_marker"\)/, "mobile marker confirmation uses the typed workflow command bridge");
assert.match(canvasTools, /commands\.tool\("cancel_controlled_marker"\)[\s\S]*?取消识别/,
  "controlled-marker detection exposes one explicit cancellation action");
assert.match(canvasTools, /disabled=\{markerHardUnavailable \|\| markerBusy\}[\s\S]*?disabled=\{markerBusy\}[\s\S]*?scan_diameter_changed/,
  "marker exit and scan-size changes are frozen while recognition is running");
assert.match(canvasTools, /disabled=\{markerBusy\}[\s\S]*?commands\.tool\("reset_view"\)/,
  "image reset is frozen while recognition is running");
assert.match(controllerCommand, /"confirm_controlled_marker"/, "the mobile marker confirmation command is part of the typed command allowlist");
assert.match(controllerCommand, /"cancel_controlled_marker"/, "explicit marker cancellation is part of the typed command allowlist");
const scanDiameterCommand = controller.match(/case "scan_diameter_changed":[\s\S]*?break;/)?.[0] || "";
assert.ok(scanDiameterCommand, "workflow controller keeps an explicit scan-diameter command branch");
assert.doesNotMatch(scanDiameterCommand, /runControlledMarker\(/,
  "changing the scan diameter only updates its preview and never starts lesion recognition");
assert.match(scanDiameterCommand, /当前识别结果未更新[\s\S]*?点击“识别此处”/,
  "mobile scan-size guidance requires an explicit confirmation before recognition");
assert.match(styles, /\.workflow-canvas-tools \.workflow-mobile-marker-confirm\s*\{[^}]*display:\s*none;/s,
  "the controlled-marker confirmation action stays hidden from the desktop toolbar");
assert.match(styles, /@media \(max-width:\s*560px\) and \(pointer:\s*coarse\) and \(hover:\s*none\)[\s\S]*?\.workflow-mobile-marker-confirm\s*\{[^}]*display:\s*inline-flex;/s,
  "the controlled-marker confirmation action is exposed only on narrow coarse-pointer devices");
assert.match(styles, /@media \(max-width:\s*560px\)[\s\S]*?\.main-wrap\.image-viewer\s*\{[^}]*touch-action:\s*none;/s,
  "only the mobile workflow image owns browser touch gestures");
assert.match(canvasTools, /commands\.tool\("clear_repair"\)/, "the text clear-repair control keeps its existing command");
assert.match(canvasTools, /commands\.tool\("reset_view"\)/, "the reset control uses the workflow tool contract");
assert.match(controller, /resetImageView\(\)/, "workflow reset reuses the existing Live image-view state");
assert.match(controller, /workflowLiveOverlayChanged/, "workflow suppresses no-op Live overlay snapshots");
assert.match(controller, /workflowInvalidationNeedsLiveFrame/, "workflow invalidation refreshes Live only when an active overlay was removed");
assert.match(controller, /completesWorkflowCanvasClick[\s\S]*?state\.centerRef = ref;[\s\S]*?void runWorkflow\(state\)/, "a direct canvas click selects the lesion center and starts workflow generation");
assert.match(controller, /buildForeheadSurfaceLandmarks\(frame\.landmarks\)/, "workflow restores the legacy extended forehead picking surface");
assert.match(controller, /buildIncisionPhotoGeometry\(/, "workflow candidate drafts reuse the established photo geometry and smoothing gates");
assert.match(controller, /buildIncisionPhotoGeometry\([\s\S]*?projectedRstlLines: activeProjectedRstlLines\(\)/,
  "photo rendering consumes the same final projected RSTL snapshot shown on the canvas");
assert.match(controller, /queryIncisionPhotoRstlDirection\([\s\S]*?projectedRstlLines/,
  "candidate generation queries the current projected RSTL snapshot instead of only the base atlas");
assert.match(controller, /workflowFusiformSvgPath\(geometry\.fusiformRendering/, "workflow draws the established smooth fusiform fit instead of the raw model polyline");
assert.match(canvasTools, /data-workflow-marker-scan-circle/, "workflow restores the controlled-marker circular scan feedback");
assert.match(canvasTools, /data-workflow-marker-scan-label/, "workflow retains the desktop scan-diameter annotation source");
assert.match(controller, /workflowScanCircleGeometry/, "workflow scan feedback follows the shared source-to-client transform");
assert.match(canvasTools, /snapshot\?\.tumor\.boundaryMode === "freehand"/,
  "manual freehand is an explicit controlled-marker unavailable state");
assert.match(canvasTools, /aria-disabled={markerUnavailable \|\| markerBusy}/,
  "the unavailable or busy controlled-marker entry exposes its semantic disabled state");
assert.match(canvasTools, /disabled={markerHardUnavailable \|\| markerBusy}/,
  "only hard prerequisites or an active recognition use native disabled semantics");
assert.match(canvasTools, /FREEHAND_MARKER_DISABLED_MESSAGE/,
  "hover and click guidance share the reviewed freehand-mode explanation");
assert.match(canvasTools, /aria-describedby={freehandMarkerUnavailable \? "freehandMarkerDisabledTooltip" : undefined}/,
  "the freehand marker trigger describes its persistent custom tooltip");
assert.match(canvasTools, /<PersistentTooltip[\s\S]*?id="freehandMarkerDisabledTooltip"[\s\S]*?message={FREEHAND_MARKER_DISABLED_MESSAGE}/,
  "the controlled-marker explanation uses the shared persistent tooltip layer");
assert.doesNotMatch(canvasTools, /freehandMarkerUnavailable[\s\S]{0,120}\? FREEHAND_MARKER_DISABLED_MESSAGE[\s\S]{0,120}: !cutaneous/,
  "the freehand marker no longer relies on a transient native title tooltip");
assert.match(canvasTools, /disabled={markerBusy \|\| !tools\?\.repairAvailable}/,
  "repair cannot change detector inputs while a request is running");
assert.match(controller, /const photoReady = workflowPhotoReady\(state\)/, "workflow snapshots expose shared-photo readiness to the merged toolbar");
assert.match(controller, /workflowPhotoReady\(state\) !== state\.lastPublishedPhotoReady[\s\S]*?workflow_photo_readiness_changed/,
  "a newly detected photo republishes toolbar readiness without requiring a canvas click");
assert.match(controller, /minimumWorkflowMarkerScanDiameterMm/, "workflow restores the standalone minimum scan-coverage precondition");
assert.match(controller, /workflowMarkerRequestStillCurrent/, "workflow discards controlled-marker results computed from stale parameters");
assert.match(controller, /stablePhotoPixelsPerMm/, "workflow reuses the standalone face-wide controlled-marker scale");
assert.match(controller, /workflowPhotoEllipseBoundary/, "workflow default cutaneous boundaries are constructed in current photo coordinates");
assert.match(controller, /boundaryMode:\s*"ellipse",/, "workflow starts cutaneous planning in ellipse mode");
assert.match(tumorInputPanel, /useState\("ellipse"\)/, "the React panel shows ellipse mode before its first controller snapshot");
assert.match(controller, /diameterMm:\s*8,/, "workflow starts with the requested 8 mm cutaneous diameter");
assert.match(tumorInputPanel, /useState\("8"\)/, "the React slider displays 8 mm before its first controller snapshot");
assert.match(tumorInputPanel, /disabled={diameterDisabled}/,
  "the diameter slider is physically disabled while boundary geometry overrides it");
assert.match(tumorInputPanel, /id="diameterMm"[\s\S]*?min="2"[\s\S]*?max="40"/,
  "the simulated lesion diameter can be reduced to the requested 2 mm minimum");
assert.match(tumorInputPanel, /diameter-field-disabled/,
  "the disabled diameter control has an explicit grey visual state");
assert.match(tumorInputPanel, /aria-describedby="diameterDisabledTooltip"/,
  "the disabled diameter trigger describes its persistent custom tooltip");
assert.match(tumorInputPanel, /<PersistentTooltip[\s\S]*?id="diameterDisabledTooltip"[\s\S]*?message={TUMOR_DIAMETER_DISABLED_MESSAGE}/,
  "the diameter explanation uses the shared persistent tooltip layer");
assert.doesNotMatch(tumorInputPanel, /title={diameterDisabled \? TUMOR_DIAMETER_DISABLED_MESSAGE/,
  "the disabled diameter no longer relies on a transient native title tooltip");
assert.match(persistentTooltip, /role="tooltip"/,
  "the shared persistent hint is exposed with tooltip semantics");
assert.match(persistentTooltip, /TOOLTIP_RELEASE_DISMISS_MS\s*=\s*2_000/,
  "click and touch guidance share the reviewed two-second release timeout");
assert.match(persistentTooltip, /setTimeout\([\s\S]*?setActivated\(false\)[\s\S]*?setInteractionSuppressed\(true\)[\s\S]*?TOOLTIP_RELEASE_DISMISS_MS/,
  "an activated hint closes two seconds after release and suppresses stale hover or focus");
assert.match(persistentTooltip, /onFocus:[\s\S]*?if \(pointerFocusRef\.current\) return;[\s\S]*?setFocused\(true\)/,
  "keyboard focus stays supported while pointer-generated focus is ignored");
assert.match(persistentTooltip, /onPointerDown:[\s\S]*?pointerFocusRef\.current = true;[\s\S]*?setFocused\(false\)/,
  "pointer-generated focus cannot keep a released tooltip open");
assert.match(canvasTools, /onPointerDown={markerTooltip\.onPointerDown}[\s\S]*?markerTooltip\.showForRelease\(\)/,
  "the controlled-marker hint covers press and release-driven mouse or touch activation");
assert.match(tumorInputPanel, /onPointerDown={diameterTooltip\.onPointerDown}[\s\S]*?diameterTooltip\.showForRelease\(\)/,
  "the diameter hint covers press and release-driven mouse or touch activation");
assert.match(styles, /\.persistent-disabled-tooltip\s*\{[^}]*position:\s*fixed;[^}]*max-width:[^}]*white-space:\s*normal;/s,
  "persistent hints escape clipped toolbars and wrap within the viewport");
assert.match(controller, /stateLabel:\s*"设备本地"[\s\S]*?原始照片仅在当前设备中处理，不随候选记录上传；记录仅保留 \$\{privacyAudit\(state\)\.local_workflow_fields\.length\} 类必要参数。/,
  "the workflow privacy card uses device-neutral local-processing copy");
assert.doesNotMatch(controller.slice(controller.indexOf("privacyAudit: buildIncisionPrivacyAuditSnapshot"), controller.indexOf("review: buildIncisionReviewSnapshot")), /浏览器/,
  "the workflow privacy snapshot does not limit its promise to a browser");
assert.equal(tumorDiameterParameterInactive({ kind: "cutaneous", boundaryMode: "freehand" }), true,
  "manual freehand disables the operator diameter");
assert.equal(tumorDiameterParameterInactive({ kind: "cutaneous", boundaryMode: "ellipse", controlledMarkerMode: true }), true,
  "controlled-marker acquisition disables the operator diameter before and after detection");
assert.equal(tumorDiameterParameterInactive({ kind: "cutaneous", boundaryMode: "ellipse" }), false,
  "switching back to ellipse restores the diameter control");
assert.equal(tumorDiameterParameterInactive({ kind: "subcutaneous", boundaryMode: "freehand", controlledMarkerMode: true }), false,
  "subcutaneous diameter remains operative");
assert.match(controller, /case "diameter_input":\s*case "diameter_changed":[\s\S]*?tumorDiameterParameterInactive[\s\S]*?break;/,
  "stale diameter events are ignored while a drawn or detected boundary owns candidate scale");
assert.match(controller, /if \(!state\.markerMode && state\.controlledBoundary\)[\s\S]*?state\.boundaryMode = "ellipse";[\s\S]*?resetFreehandPhotoBoundary\(state, true\)/,
  "exiting a confirmed controlled marker returns to ellipse mode and restores diameter semantics");
assert.match(controller, /ellipseRatio:\s*state\.kind === "cutaneous" \? state\.ellipseRatio : null/,
  "the merged snapshot exposes the actual near-circular default instead of leaving the slider at its legacy 70% label");
assert.match(tumorInputPanel, /tumor\.ellipseRatio != null\) setEllipseRatio/,
  "the cutaneous ellipse control stays synchronized with the merged controller default");
assert.match(controller, /ellipseRatio:\s*100,/, "the merged controller defaults cutaneous boundaries to a circle");
assert.match(tumorInputPanel, /ellipseRatioDisabled[\s\S]*?controlledMarkerMode[\s\S]*?id="ellipseRatio"[\s\S]*?disabled={ellipseRatioDisabled}/,
  "controlled-marker mode disables the simulated ellipse aspect-ratio slider without hiding it");
assert.match(controller, /detail\.command === "ellipse_ratio_input"[\s\S]*?state\.markerMode[\s\S]*?ellipse_ratio_inactive[\s\S]*?return;/,
  "the controller ignores stale aspect-ratio events while controlled-marker mode owns the real boundary");
assert.match(tumorInputPanel, /useState\("100"\)/, "the ellipse slider displays the circular default before the first snapshot");
assert.match(tumorInputPanel, /轮廓纵\/横比例[\s\S]*?min="40"[\s\S]*?max="200"/,
  "the unambiguous vertical-to-horizontal ratio supports either axis becoming visually longer");
assert.equal((reviewControlsPanel.match(/<option\s/g) || []).length, 2,
  "the current review selector exposes only pending and confirm-draft choices");
assert.match(reviewControlsPanel, /待医生确认[\s\S]*确认候选草案/,
  "the two visible review choices retain their requested Chinese labels");
assert.doesNotMatch(reviewControlsPanel, /status === "approved_for_discussion"[\s\S]*?return "approved"/,
  "confirmed research status uses the same clear text and background style as pending review");
assert.match(controller, /function buildRecord[\s\S]*?if \(!rawReview\.reviewer\) return null;/,
  "candidate-record construction itself rejects a missing reviewer instead of relying only on the visible button path");
assert.match(reviewControlsPanel, /id="reviewerName"[\s\S]*?reviewerAttentionRequired[\s\S]*?aria-invalid/,
  "a missing-reviewer block is repeated as an accessible local highlight on the reviewer input");
assert.match(reviewControlsPanel, /id="reviewDecision"[\s\S]*?decisionAttentionRequired[\s\S]*?aria-invalid/,
  "a limited-visibility confirmation block highlights the nearby review-decision control");
assert.match(styles, /@keyframes workflow-review-attention[\s\S]*?prefers-reduced-motion/,
  "review attention has a breathing cue with a reduced-motion fallback");
assert.match(styles, /animation:\s*workflow-review-attention\s+0\.85s\s+ease-in-out\s+2;/,
  "review attention breathes exactly twice instead of flashing forever");
assert.match(reviewControlsPanel, /REVIEW_SAVE_NOTICE_REASONS[\s\S]*?review_blocked[\s\S]*?review_missing_candidate[\s\S]*?diagnostic_review_blocked[\s\S]*?diagnostic_review_acknowledged/,
  "review save notices cover every non-persisting save outcome without reacting to unrelated warnings");
assert.match(reviewControlsPanel, /id="reviewSaveFeedback"[\s\S]*?role="alert"[\s\S]*?snapshot\?\.stageStatus/,
  "the review panel displays the controller's actual non-persisting reason beside the save button");
assert.match(reviewControlsPanel, /classList\.remove\("workflow-review-attention"\)[\s\S]*?offsetWidth[\s\S]*?classList\.add\("workflow-review-attention"\)[\s\S]*?snapshot\?\.updatedAt/,
  "each blocked save attempt restarts the two-cycle attention animation");
assert.match(controller, /reviewAttention:\s*"reviewer"/,
  "missing reviewer paths publish a reviewer-specific attention reason");
assert.match(reviewPolicy, /photo_visibility_limited_candidate[\s\S]*?attention:\s*"decision"/,
  "limited-visibility approval blocks publish a decision-specific attention reason through the shared policy");
assert.match(controller, /state\.reviewAttention = readiness\.attention/,
  "the workflow publishes the shared policy's nearby-control attention reason");
assert.match(controller, /function prepareControlledMarkerAttempt[\s\S]*?state\.centerRef = null;[\s\S]*?state\.boundaryRefs = \[\];[\s\S]*?invalidateCandidate/,
  "a new controlled-marker attempt removes the previous lesion and candidate before reporting a new failure");
assert.match(controller, /照片估算最大直径 \$\{state\.controlledBoundaryPhotoDiameterMm\.toFixed\(1\)\}/,
  "controlled-marker feedback reports the preserved photo scale instead of the distorted face-edge surface extent");
assert.match(controller, /photoDiameterEstimateMm:\s*layerContract\.showDiameterEstimate\s*\?\s*state\.diameterMm/, "workflow restores the standalone subcutaneous diameter estimate input");
assert.match(controller, /candidateLengthMm:\s*Number\(candidate\.length_mm\)/,
  "the merged photo renderer consumes the computed linear length instead of re-projecting a curved standard face");
assert.match(controller, /incisionPhotoStatusPresentation\(/,
  "the merged canvas status reuses the standalone photo projection status contract");
assert.match(incisionRail, /<TumorInputPanel\s+showDepthControl={false}\s+continuousFreehand\s*\/>/,
  "workflow hides the non-operative depth control and explicitly enables continuous freehand drawing");
assert.match(tumorInputPanel, /showDepthControl\s*=\s*true/, "the standalone incision page retains its legacy depth-control default");
assert.match(tumorInputPanel, /visible={!cutaneous\s*&&\s*showDepthControl}/, "depth data remains mounted behind an explicit presentation boundary");
assert.match(controller, /controlledMarkerScale\?\.sourceRevision === frame\.revision/, "workflow caches one marker scale per photo revision");
assert.match(controller, /state\.controlledMarkerScale = null;[\s\S]*?state\.photoFrameRevision = frame\.revision/, "a new photo revision invalidates the cached marker scale");
assert.match(controller, /function resetWorkflowForSourceChange\([\s\S]*?preserveActiveCandidate[\s\S]*?if \(preserveActiveCandidate\) resetFreehandPhotoBoundary\(state\);[\s\S]*?else \{[\s\S]*?state\.centerRef = null;[\s\S]*?state\.boundaryRefs = \[\];[\s\S]*?invalidateCandidate\(state\)/,
  "source replacement preserves an activated reviewed candidate while still clearing unapproved media-bound drafts");
assert.match(controller, /if \(preserveActiveCandidate\) \{[\s\S]*?syncSelection\(state\);[\s\S]*?publishLiveOverlayState\(state, true,[\s\S]*?requestFrame\(\);/,
  "both load-then-camera and camera-then-load keep the approved surface overlay active on the new source");
assert.match(controller, /function resetWorkflowForSourceChange\([\s\S]*?clearWorkflowDraftOverlay\(state\)/,
  "source replacement synchronously removes stale boundary and candidate SVG paths before new landmarks arrive");
assert.match(controller, /revision !== state\.lastSourceRevision[\s\S]*?resetWorkflowForSourceChange\(state, revision\)/,
  "the live-source bridge resets all media-bound incision state when an upload replaces the photo");
assert.match(controller, /downloadCanvasWithSvgOverlayPng/, "workflow screenshot export includes the merged SVG drawing layer");
assert.match(controller, /async function importTumor[\s\S]*?resetMarkerRepair\(state\);[\s\S]*?state\.markerMode = false;/,
  "tumor import cancels an in-flight marker request before replacing planning state");
assert.match(controller, /function loadSavedCandidateState[\s\S]*?resetMarkerRepair\(state\);[\s\S]*?state\.markerMode = false;/,
  "candidate loading cancels an in-flight marker request before replacing planning state");
assert.match(controller, /function loadSavedCandidateState[\s\S]*?state\.boundaryMode = record\.tumor\?\.boundary_mode === "freehand" \? "freehand" : "ellipse";/,
  "candidate loading restores freehand only from its explicit mode instead of inferring it from boundary point count");
assert.match(controller, /tumorPointEngineeringExclusionMessage/, "workflow restores the established non-skin-opening center gate");
assert.match(controller, /inspectTumorEngineeringExclusions/, "controlled-marker results retain the full tumor opening gate");
assert.match(controller, /workflowCandidateDisplayAllowed/, "workflow rendering consumes the deterministic candidate-display hard block");
assert.match(controller, /candidatePointCount:\s*state\.result\?\.candidate_display_blocked === true\s*\? 0/s,
  "a hard-blocked candidate is not advertised as visible to the shared Live state");
const pointerHandler = controller.slice(
  controller.indexOf("function handleCanvasPointerDown"),
  controller.indexOf("function handleCanvasPointerMove"),
);
assert.ok(pointerHandler.indexOf("if (state.markerMode)") < pointerHandler.indexOf("workflowSurfaceRefAtSource"),
  "controlled-marker detection starts from photo coordinates before surface-hit validation");
assert.match(pointerHandler, /if \(mobileMarkerTouch\) \{\s*event\.preventDefault\(\);\s*return;\s*\}[\s\S]*?const sourcePoint = sourcePointAtClient/,
  "mobile marker touches return before desktop point mapping so pinch fingers cannot publish false selection errors");
assert.match(pointerHandler, /if \(state\.markerMode\) \{[\s\S]*?void runControlledMarker\(state, sourcePoint\)/,
  "desktop marker clicks retain their immediate click-to-detect branch");
assert.match(controller, /case "confirm_controlled_marker":[\s\S]*?mobileWorkflowViewportActive\(\)[\s\S]*?state\.markerPendingSeed[\s\S]*?runControlledMarker\(state, seed\)/,
  "only the mobile confirmation command can run a pending touch placement");
const mobileMarkerConfirmation = controller.slice(
  controller.indexOf('case "confirm_controlled_marker"'),
  controller.indexOf('case "cancel_controlled_marker"'),
);
assert.doesNotMatch(mobileMarkerConfirmation, /state\.markerPendingSeed\s*=\s*null/,
  "mobile confirmation does not discard the retry location before the attempt can preserve it");
assert.match(controller, /const mobileRetrySeed = mobileWorkflowViewportActive\(\) && state\.markerPendingSeed[\s\S]*?if \(mobileRetrySeed\) state\.markerPendingSeed = null;[\s\S]*?state\.markerBusy = true;/,
  "a mobile attempt remembers its location while keeping the confirmation disabled during recognition");
assert.match(controller, /function completeControlledMarkerAttempt[\s\S]*?state\.markerBusy = false;[\s\S]*?state\.markerPendingSeed = \{ \.\.\.mobileRetrySeed \};[\s\S]*?state\.markerPointerSource = \{ \.\.\.mobileRetrySeed \};/,
  "a completed mobile attempt restores the same retry location and scan-circle position");
assert.match(controller, /await runWorkflow\(state\);[\s\S]*?requestId !== state\.markerRequestId[\s\S]*?completeControlledMarkerAttempt\(state, mobileRetrySeed\)[\s\S]*?controlled_marker_applied/,
  "successful recognition restores the retry location only after candidate generation and stale-request checks");
assert.match(controller, /function blockMarkerBusyPointer[\s\S]*?state\.markerBusy[\s\S]*?claimWorkflowPointer\(event\)[\s\S]*?handleCanvasPointerDown[\s\S]*?blockMarkerBusyPointer\(state, event\)/,
  "ordinary canvas input is claimed before it can change a running marker request");
assert.match(controller, /function markerBusyToolbarPointer[\s\S]*?closest\("\.workflow-canvas-tools"\)[\s\S]*?handleCanvasPointerDown[\s\S]*?markerBusyToolbarPointer\(state, event\)[\s\S]*?blockMarkerBusyPointer\(state, event\)/,
  "the explicit cancellation control stays reachable before busy canvas input is claimed");
assert.match(controller, /function cancelControlledMarker[\s\S]*?state\.markerRequestId \+= 1;[\s\S]*?state\.markerBusy = false;[\s\S]*?state\.markerPendingSeed = state\.markerMode \? \{ \.\.\.seed \} : null;/,
  "explicit cancellation invalidates the in-flight result and restores the mobile confirmation seed");
assert.match(controller, /case "cancel_controlled_marker":[\s\S]*?cancelControlledMarker\(state\)/,
  "the typed cancellation command owns marker cancellation");
assert.match(styles, /workflow-marker-busy="true"[\s\S]*?\.workflow-incision-rail,[\s\S]*?\.zoom-strip\s*\{[^}]*pointer-events:\s*none;/,
  "non-cancel planning controls and focus cards cannot receive accidental pointer input while recognition runs");
assert.match(liveRuntime, /isMobileTouchImageGestureEnabled:[\s\S]*?\.workflow-workbench[\s\S]*?max-width: 560px[\s\S]*?pointer: coarse[\s\S]*?hover: none[\s\S]*?pointerMode === "marker"/,
  "pinch gestures are gated to the mobile workflow and do not alter desktop or standalone Live input");
assert.match(liveRuntime, /pointerMode === "marker" \|\| pointerMode === "freehand"/,
  "the mobile workflow keeps two-finger image gestures available while freehand drawing owns one finger");
assert.match(liveRuntime, /transformImageViewGesture/,
  "the mobile workflow uses one atomic pinch transform so combined pan and zoom stay aligned");
assert.match(liveCanvasInteraction, /callbacks\.transformImageViewGesture[\s\S]*?pinch\.centerX[\s\S]*?nextPinch\.centerX[\s\S]*?ratio/,
  "the mobile gesture bridge preserves both pinch centres and the exact scale ratio");
assert.match(controller, /MOBILE_WORKFLOW_MEDIA_QUERY\s*=\s*"\(max-width: 560px\) and \(pointer: coarse\) and \(hover: none\)"/,
  "mobile marker placement and confirmation share the same narrow touch-device gate");
assert.match(liveCanvasInteraction, /event\.pointerType === "touch"[\s\S]*?touchPoints\.size >= 2/,
  "shared image interaction requires two touch pointers before entering pinch mode");
const controlledMarkerHandler = controller.slice(
  controller.indexOf("async function runControlledMarker"),
  controller.indexOf("function pathData"),
);
assert.doesNotMatch(controlledMarkerHandler, /state\.boundaryMode = "freehand"/,
  "a successful controlled-marker result keeps the visible acquisition mode on ellipse");
assert.match(controller, /case "controlled_marker":[\s\S]*?state\.boundaryMode === "freehand"[\s\S]*?FREEHAND_MARKER_DISABLED_MESSAGE[\s\S]*?return;/,
  "clicking the visually disabled marker control in freehand mode publishes its reason without starting acquisition");
assert.match(controlledMarkerHandler, /controlledMarkerPixelsPerMm\(state, frame, seed, photoProjection\.surfaceLandmarks\)/,
  "controlled-marker detection uses the same stable scale as its scan circle");
assert.match(controlledMarkerHandler, /canvas\.width = frame\.width;[\s\S]*?context\.getImageData\(0, 0, frame\.width, frame\.height\)/,
  "controlled-marker detection restores the proven full-photo input used by the stable reference workflow");
assert.match(controlledMarkerHandler, /detectControlledMarker\(image, seed, options\)/,
  "the stable detector receives the unchanged source-photo seed instead of crop-local coordinates");
assert.doesNotMatch(controlledMarkerHandler, /workflowControlledMarkerCrop|translateControlledMarkerDetection/,
  "the merged workflow does not alter the stable detector input with an extra crop/translation layer");
assert.ok(
  controlledMarkerHandler.indexOf("setSelection({ centerRef: null, boundaryRefs: [] })")
    < controlledMarkerHandler.indexOf("detectControlledMarker"),
  "every controlled-marker attempt clears the previous shared selection before detection",
);
assert.doesNotMatch(controlledMarkerHandler, /workflowPhotoOpeningIntersection/,
  "a broad 2D opening polygon cannot discard a detected skin boundary before surface mapping");
assert.ok(
  controlledMarkerHandler.indexOf("workflowSurfaceRefAtSource(state, frame, detection.center")
    < controlledMarkerHandler.indexOf("inspectTumorEngineeringExclusions"),
  "detected boundaries still pass through surface mapping and the 3D non-skin-opening safety gate",
);
assert.match(controlledMarkerHandler, /detection\.boundary[\s\S]*?workflowSurfaceRefAtSource\(state, frame, point\)/,
  "controlled-marker boundaries share the bounded outer-face recovery used by ordinary photo picks");
assert.match(liveRail, /<LiveSourceControlsPanel\s*\/>/, "workflow receives the existing Live upload controls through its only left rail");
assert.match(liveRail, /<LiveRenderControlsPanel\s*\/>/, "workflow receives the existing Live mirror control through its only left rail");
assert.match(liveSourceControls, /commands\.source\("upload_source"\)/, "the shared photo upload dispatches the single Live source command");
assert.match(liveRenderControls, /commands\.render\("mirror_toggle", checked\)/, "the shared mirror toggle dispatches the single Live render command");
assert.doesNotMatch(canvasTools, /upload_source|mirror_toggle/, "the incision overlay does not own duplicate upload or mirror state");
assert.match(liveCanvasFit, /mirror:\s*renderState\.mirror/, "shared planning coordinates consume the current Live mirror state");
for (const panel of [
  "TumorInputPanel",
  "CandidateResultPanel",
  "ReviewControlsPanel",
  "CandidateLibraryPanel",
  "PrivacyAuditPanel",
]) {
  assert.match(incisionRail, new RegExp(`<${panel}\\b`), `workflow incision rail includes ${panel}`);
}
assert.doesNotMatch(incisionRail, /SecondaryCuePanel|高级研究辅助线索/,
  "the merged workflow no longer mounts the retired advanced research cue panel");
assert.match(standaloneIncision, /hidden aria-hidden="true" data-retired-secondary-cue-compatibility>[\s\S]*?<SecondaryCuePanel/,
  "the standalone page keeps the retired cue DOM as a hidden runtime compatibility layer");
assert.match(tumorInputPanel, /continuousFreehand\s*=\s*false/,
  "the standalone incision page keeps its historical point-by-point freehand contract by default");
assert.match(tumorInputPanel, /id="runWorkflowBtn"[\s\S]*?>重新计算候选<\/Button>/,
  "the explicit workflow action is named as a recalculation rather than an unexplained first-time generation");
assert.match(tumorInputPanel, /workflow-tumor-transfer-actions[\s\S]*?id="exportTumorBtn"[\s\S]*?id="importTumorBtn"/,
  "tumor import and export share one presentation-only mobile visibility hook");
assert.match(tumorInputPanel, /className="workflow-recalculate-action"[\s\S]*?id="runWorkflowBtn"/,
  "candidate recalculation has a presentation-only mobile visibility hook");
assert.match(tumorInputPanel, /自由轮廓鼠绘/,
  "the merged panel names the continuous interaction as freehand drawing rather than discrete points");
assert.doesNotMatch(incisionRail, /IncisionStatePanel/,
  "workflow removes the duplicate incision state card while the standalone incision page keeps it");
assert.match(incisionRail, /<CandidateResultPanel\s+showWorkflowGuidance={false}\s*\/>/,
  "workflow keeps the candidate result card but hides duplicate generated/review guidance");
assert.match(incisionRail, /<CandidateLibraryPanel[\s\S]*?automaticOverlay[\s\S]*?showHandoffStatus={false}[\s\S]*?showDirectionVariants={false}[\s\S]*?showJsonExport={false}[\s\S]*?showSaveAndExportActions={false}[\s\S]*?showCandidateRowActions[\s\S]*?showReviewTransitions[\s\S]*?\/>/,
  "workflow hides redundant top-level actions while retaining record load, delete, and guarded review-transition controls");
assert.match(candidateResultPanel, /showWorkflowGuidance\s*=\s*true/,
  "standalone candidate results retain their existing guidance by default");
assert.match(candidateLibraryPanel, /showHandoffStatus\s*=\s*true/,
  "standalone candidate library retains its existing handoff status by default");
assert.match(candidateLibraryPanel, /showDirectionVariants\s*=\s*true/,
  "standalone candidate library retains its historical direction-variant action by default");
assert.match(candidateLibraryPanel, /showJsonExport\s*=\s*true/,
  "standalone candidate library retains its historical review JSON action by default");
assert.match(candidateLibraryPanel, /showSaveAndExportActions\s*=\s*true/,
  "standalone candidate library retains its historical save and export actions by default");
assert.match(candidateLibraryPanel, /showCandidateRowActions\s*=\s*true/,
  "standalone candidate library retains its historical candidate-row actions by default");
assert.match(candidateLibraryPanel, /showReviewTransitions\s*=\s*false/,
  "review status transitions stay scoped to the merged workflow controller that implements the gate");
assert.match(candidateLibraryPanel, /toggle_candidate_review_status/,
  "saved candidate cards expose the guarded pending/approved transition command");
assert.match(candidateLibraryPanel, /candidate-actions[\s\S]*?three-cols[\s\S]*?load_candidate[\s\S]*?remove_candidate[\s\S]*?toggle_candidate_review_status/,
  "candidate load, delete, and review-transition actions share one equal-width row in the requested order");
assert.match(candidateLibraryPanel, /candidate-overlay-status[\s\S]*?overlayStatusLabel/,
  "saved candidate cards keep the live-overlay eligibility explanation visible");
assert.match(incisionSnapshots, /reviewTransitionLabel:[\s\S]*?转为已确认[\s\S]*?转为待确认/,
  "saved candidate summaries derive both guarded review transition labels from the persisted status");
assert.match(incisionSnapshots, /visibility_limited_reference_candidate[\s\S]*?暂不能确认：[\s\S]*?reviewTransitionDisabled:/,
  "intrinsically blocked saved candidates expose an adjacent plain-language confirmation reason");
assert.match(candidateLibraryPanel, /candidate-review-condition-[\s\S]*?reviewTransitionReason[\s\S]*?disabled={item\.reviewTransitionDisabled}[\s\S]*?暂不能确认/,
  "the candidate library disables misleading approval actions and keeps their reason beside the record");
assert.match(incisionSnapshots, /未进入实时叠加：该候选仍为“待医生确认”/,
  "saved candidate summaries explain the pending live-overlay block in plain language");
assert.match(controller, /function toggleSavedCandidateReviewStatus[\s\S]*?transitionIncisionReviewRecord/,
  "saved candidate review transitions reuse the shared review gate instead of mutating a label only");
assert.match(controller, /已载入待医生确认草案；照片中可继续核对，但实时摄像头不会显示该候选/,
  "loading a pending candidate explicitly explains why it is absent from the live camera");
assert.match(controller, /function saveReview[\s\S]*?state\.saved = \[\.\.\.state\.saved\.filter\(\(item\) => item\.id !== record\.id\), record\];/,
  "saving the selected review state also persists the reviewed candidate in the library");
assert.match(controller, /candidate:\s*diagnosticCandidateVisible\s*\?\s*null\s*:\s*buildIncisionCandidateSnapshot\(state\.result\)/,
  "a red diagnostic outline is not exposed as a current candidate or counted by candidate actions");
assert.match(controller, /assessDiagnosticReviewAcknowledgement[\s\S]*?diagnostic_review_acknowledged/,
  "red diagnostic review uses the shared note gate and a non-candidate acknowledgement path");
assert.match(reviewControlsPanel, /id="reviewNotes"[\s\S]*?notesAttentionRequired[\s\S]*?aria-invalid/,
  "a missing diagnostic or high-risk review note is highlighted at the nearby notes field");
assert.match(controller, /diagnosticCandidateBlockMessage\(state\.result,/,
  "the red diagnostic canvas warning is concise and explicitly says it is not saved");
assert.match(controller, /无法导出肿物：请先在中央照片上选择肿物位置。/,
  "tumor export explains its required position instead of appearing unresponsive");
assert.match(controller, /已触发肿物输入 JSON 下载。文件不包含原始照片。[\s\S]*?publish\(state, "tumor_exported"\)/,
  "successful tumor export publishes visible completion feedback");
assert.match(incisionExport, /host\.append\(anchor\);[\s\S]*?anchor\.click\(\);[\s\S]*?anchor\.remove\(\);/,
  "text export mounts a temporary download anchor for browser-compatible activation and then removes it");
assert.match(controller, /肿物导出失败：[\s\S]*?publish\(state, "tumor_export_failed"\)/,
  "tumor export reports synchronous browser download failures instead of appearing unresponsive");
assert.match(controller, /const visible = frame\?\.kind === "image" && Boolean\(frame\.landmarks\?\.length\);/,
  "photo candidate rendering does not switch away from the workflow SVG when review status activates the live overlay");
assert.match(controller, /focused_photo_edit_blocked/,
  "focused local views reject edits so full-face remains the only geometry authoring source");
assert.match(render2d, /sourceState\.sourceKind === "image" && renderState\.workflowPhotoOverlay/,
  "the live canvas avoids double-drawing an approved candidate while the workflow SVG owns photo rendering");
assert.match(render2d, /CustomEvent\("langerface:focus-crop-changed"\)/,
  "focus crop changes publish an explicit redraw signal for the workflow SVG");
assert.match(controller, /addEventListener\("langerface:focus-crop-changed"[\s\S]*?scheduleOverlayDraw/,
  "the workflow SVG redraws after the canvas focus crop has been computed");
assert.match(canvasTools, /aria-label="切口标注图例"[\s\S]*?病灶中心[\s\S]*?肿物范围/,
  "workflow keeps the two clinician-requested canvas legend items");
assert.doesNotMatch(canvasTools, />候选切口<|>端点控制</,
  "workflow hides candidate and endpoint legend labels without removing their SVG layers");
assert.doesNotMatch(incisionRail, /打开独立切口工作台/, "workflow no longer substitutes navigation for incision controls");
assert.doesNotMatch(controller, /createPhotoPlanningController|incisionRuntime|sessionStorage/,
  "workflow incision controller owns no second canvas runtime and delegates short-lived storage to the session service");
assert.match(controller, /saveWorkflowIncisionDraft/,
  "workflow controller supplies only serializable low-frequency incision state to the draft service");
assert.match(controller, /sourceState\.planning2d\?\.getFrameState\(\)/, "workflow incision controller consumes the shared live planning frame");
assert.match(controller, /assessReviewReadiness/, "workflow keeps the established clinician review gate");
assert.match(controller, /renderState\.incisionOverlay = overlay/, "approved candidates activate directly on the current live renderer");
assert.match(controller, /renderState\.incisionOverlay = null/, "candidate invalidation clears the active overlay");
assert.match(layout, /<WorkbenchLayout/, "workflow reuses the shared workbench shell");
assert.match(layout, /workflow-live-rail/, "workflow exposes a dedicated RSTL rail");
assert.match(layout, /workflow-incision-rail/, "workflow exposes a dedicated incision rail");
assert.match(layout, /workflow-live-rail live-workbench/, "workflow RSTL rail reuses the protected legacy Live presentation scope");
assert.match(layout, /workflow-incision-rail incision-workbench/, "workflow incision rail reuses the established incision presentation scope");
assert.match(sharedLayout, /secondarySidebar/, "shared workbench shell owns the optional third-column primitive");
assert.match(styles, /grid-template-columns:\s*clamp\(320px,\s*21\.25vw,\s*340px\)\s+minmax\(640px,\s*1fr\)\s+clamp\(320px,\s*21\.25vw,\s*340px\)/, "desktop layout reserves a large central canvas with balanced legacy-width rails");
assert.match(styles, /\.workflow-workbench \.zoom-strip\s*{[^}]*max-height:/s, "zoom strip is bounded so it cannot crowd out the main face canvas");
assert.match(styles, /\.workflow-incision-overlay \[data-workflow-candidate\]\s*{[^}]*stroke:\s*#67e8f9;[^}]*stroke-width:\s*1;/s,
  "desktop workflow keeps the one-CSS-pixel candidate width while using the mobile highlight hue");
assert.match(canvasTools, /data-workflow-diagnostic-candidate/,
  "the merged SVG owns a separate display-only diagnostic candidate layer");
assert.match(styles, /\[data-workflow-diagnostic-candidate\]\s*{[^}]*stroke:\s*#ef4444;[^}]*stroke-dasharray:/s,
  "a rejected diagnostic candidate is a distinct red dashed line without restyling the valid candidate");
assert.match(styles, /\.workflow-incision-overlay \[data-workflow-marker-scan-circle\]\s*{[^}]*border-radius|\.workflow-incision-overlay \[data-workflow-marker-scan-circle\]\s*{[^}]*stroke:/s,
  "workflow scan feedback has an explicit visible circular stroke");
const unlayeredOverrides = styles.indexOf("/* Critical, unlayered overrides");
const unlayeredWarningTone = styles.lastIndexOf('.workflow-workbench .workflow-stage-status[data-tone="warning"]');
assert.ok(unlayeredOverrides >= 0 && unlayeredWarningTone > unlayeredOverrides,
  "workflow warning color stays in the unlayered cascade and cannot be replaced by the generic stage-meta color");
assert.match(styles.slice(unlayeredWarningTone), /color:\s*#fde68a;/,
  "workflow warning status uses the established yellow warning color");
assert.match(styles, /\.workflow-workbench \.stage-top\s*{[^}]*display:\s*grid;/s, "workflow owns explicit status and action regions in the stage header");
assert.match(styles, /\.workflow-workbench \.workflow-stage-spinner\s*{[^}]*animation:\s*workflow-stage-spin/s,
  "the incision waiting indicator is scoped to the merged workflow rather than the RSTL runtime");
assert.match(styles, /\.workflow-workbench\.app\s*{[^}]*grid-template-columns:[^}]*}[\s\S]*?\.workflow-workbench \.stage-top\s*{[^}]*display:\s*grid;/s,
  "the unlayered workflow layout overrides the imported legacy flex header on wide screens");
assert.match(styles, /@media \(min-width:\s*1281px\) and \(max-width:\s*1760px\)\s*{[\s\S]*?\.workflow-workbench \.stage-top\s*{[^}]*display:\s*grid;[^}]*grid-template-areas:[\s\S]*?workflow-actions workflow-actions workflow-actions[\s\S]*?min-height:\s*92px;/,
  "intermediate desktop widths keep the complete tool strip in a second header row instead of clipping actions");
assert.match(styles, /@media \(max-width:\s*1280px\)\s*{[\s\S]*?\.workflow-workbench\.app\s*{[\s\S]*?grid-template-columns:\s*1fr;/, "workflow collapses before its readable three-column minimum can overflow");

assert.match(styles, /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.workflow-workbench\.app\s*\{[^}]*--workflow-mobile-stage-height:\s*max\([\s\S]*?min\(calc\(100dvh - 170px\),\s*calc\(100vw \+ 100px\)\)[\s\S]*?grid-template-rows:\s*var\(--workflow-mobile-stage-height\) minmax\(0, 1fr\);[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/,
  "phone workflow sizes the observation region from both usable height and the width needed for a full photo");
assert.match(styles, /\.react-workflow-host\[data-workflow-marker-mode="true"\] \.workflow-workbench\.app\s*\{[^}]*--workflow-mobile-stage-height:\s*max\([\s\S]*?min\(calc\(100dvh - 130px\),\s*calc\(100vw \+ 150px\)\)/,
  "controlled-marker mode reserves stage height for the second toolbar row without shrinking the photo");
assert.match(styles, /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.workflow-workbench \.stage-body\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/,
  "phone workflow stage contains its canvas and focus cards instead of spilling over the next section");
assert.match(styles, /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.workflow-workbench \.main-wrap\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/,
  "phone workflow lets the shared face canvas fill its fixed observation region without entering the control scroll pane");
assert.match(styles, /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.workflow-workbench \.zoom-strip\s*\{[^}]*display:\s*none;/,
  "phone workflow hides the redundant focus-preview rail while direct canvas zoom is available");
assert.match(styles, /@media \(max-width:\s*560px\) and \(pointer:\s*coarse\) and \(hover:\s*none\)[\s\S]*?\.workflow-tumor-transfer-actions,[\s\S]*?\.workflow-recalculate-action\s*\{[^}]*display:\s*none;/,
  "phone workflow hides tumor transfer and manual recalculation without removing their desktop actions");
assert.match(styles, /@media \(max-width:\s*560px\) and \(pointer:\s*coarse\) and \(hover:\s*none\)[\s\S]*?\.workflow-stage-status\s*\{[^}]*min-block-size:\s*34px;[^}]*max-block-size:\s*48px;[^}]*overflow-y:\s*auto;/,
  "phone workflow bounds persistent recognition guidance above the face canvas");
assert.match(render2d, /const zoomItems:[\s\S]*?\{ label: "全脸", region: null \}[\s\S]*?\.\.\.ZOOM_REGIONS/,
  "focus-preview generation remains available for desktop and future rollback");
assert.match(styles, /--workflow-mobile-zoom-card-size:\s*calc\(\(100vw - 44px\) \/ 3\)[\s\S]*?\.workflow-workbench \.zoom-card\s*\{[^}]*flex:\s*0 0 var\(--workflow-mobile-zoom-card-size\);[^}]*min-width:\s*var\(--workflow-mobile-zoom-card-size\);[^}]*max-width:\s*var\(--workflow-mobile-zoom-card-size\);/,
  "hidden phone focus-card sizing remains intact instead of deleting the reversible implementation");
assert.match(liveQualityPanel, /MOBILE_WORKFLOW_MEDIA_QUERY[\s\S]*?media\.matches \? document\.querySelector\(mobilePortalSelector\) : null/,
  "quality relocation is gated to phone-class coarse-pointer viewports and leaves desktop placement unchanged");
assert.match(liveRail, /workflow-mobile-quality-slot/,
  "phone quality feedback is relocated to the stage header rather than covering the face");
assert.match(styles, /\.workflow-workbench \.stage-top > #livePill\s*\{[^}]*display:\s*none;[\s\S]*?\.workflow-workbench \.stage-top > #fps\s*\{[^}]*display:\s*none;/s,
  "redundant phone source and FPS labels are hidden while their underlying runtime data remains intact");
assert.match(styles, /@media \(max-width:\s*560px\) and \(pointer:\s*coarse\) and \(hover:\s*none\)[\s\S]*?\.mobile-workflow-dock\s*\{[^}]*display:\s*grid;/,
  "the compact input and layer dock is exposed only on phone-class coarse pointers");
assert.match(mobileControls, /upload_source[\s\S]*?camera_toggle[\s\S]*?pause_toggle[\s\S]*?recording_toggle/,
  "the mobile dock retains photo, rear-camera, pause and export command paths");
assert.doesNotMatch(mobileControls, /if \(!nextRstl && !nextWrinkles\) return;/,
  "mobile operators may hide RSTL and wrinkles together to inspect the unmodified source image");
assert.match(mobileControls, /setMobileRstlLayerVisible\(rstlVisible\)[\s\S]*?setMobileWrinkleLayerVisible\(wrinklesVisible\)[\s\S]*?setMobileIncisionCandidateVisible\(incisionVisible\)/,
  "all three phone overlay switches have independent display-only visibility gates");
assert.match(styles, /\.workflow-canvas-tools\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);[^}]*overflow:\s*hidden;/,
  "the phone marker toolbar uses a fixed grid instead of growing when recognition controls appear");
assert.match(styles, /\.workflow-canvas-tools > button\s*\{[^}]*font-size:\s*11px;[^}]*white-space:\s*nowrap;/,
  "phone marker action labels stay on one line inside the stable four-column grid");
assert.match(styles, /\.workflow-marker-scan\s*\{[^}]*grid-area:\s*2 \/ 2 \/ 3 \/ 5;[^}]*width:\s*100%;/,
  "the scan-diameter control occupies the reserved second phone tool row");
assert.match(styles, /\[data-workflow-marker-scan-label\]\s*\{[^}]*display:\s*none;/,
  "the face-obscuring scan-diameter label is hidden only inside the phone media query");
assert.match(mobileControls, /preview_edit", "uniformScale"[\s\S]*?commit_edit", "uniformScale"/,
  "mobile margin adjustment changes fusiform length and width atomically");
assert.match(mobileControls, /min="100"[\s\S]*?max="150"/,
  "mobile margin adjustment only enlarges the tool suggestion within the existing upper bound");
assert.match(controller, /function handleMobileEditCommand[\s\S]*?if \(!mobileWorkflowViewportActive\(\)\) return;/,
  "workflow candidate editing rejects the phone UI event outside the mobile viewport contract");
assert.match(controller, /state\.edit\.angle_offset_deg = Math\.max\(-35,[\s\S]*?state\.edit\.length_scale = Math\.max\(1,[\s\S]*?state\.edit\.width_scale = Math\.max\(1,/,
  "workflow clamps the two mobile-only adjustment dimensions before applying the existing candidate editor");
assert.match(controller, /workflowFusiformPlaneNormal\(baseResult\.candidate, fallbackNormal\)/,
  "mobile direction adjustment rotates in the candidate's original plane instead of a potentially different nearby mesh plane");
assert.match(controller, /scheduleMobileCandidateEdit[\s\S]*?requestAnimationFrame[\s\S]*?cancelMobileEditPreview/,
  "mobile adjustment previews are coalesced to one expensive candidate rebuild per display frame");
assert.match(mobileControls, /梭形整体缩放[\s\S]*?不替代以毫米记录的医学安全切缘/,
  "mobile copy distinguishes geometric scaling from the clinical margin parameter");
assert.match(controller, /liveParameterCommands[\s\S]*?candidateRecomputeTimer = window\.setTimeout[\s\S]*?runWorkflow\(state, false, true\)/,
  "continuous tumor-parameter input keeps the visible candidate and debounces live recomputation");
assert.match(controller, /committedParameterCommands[\s\S]*?runWorkflow\(state, false, true\)/,
  "committed tumor-parameter changes replace the retained candidate atomically");
assert.match(controller, /state\.baseResult = \{[\s\S]*?const retainedEdit = retainedCandidate \? cloneIncisionEdit\(state\.edit\)[\s\S]*?state\.edit = state\.baseResult\.candidate\?\.type === "fusiform" \? retainedEdit[\s\S]*?applyCandidateEdit/,
  "tumor-parameter recomputation reapplies the existing fusiform scale and direction instead of clearing them");
assert.match(controller, /candidateDirectionEdited:[\s\S]*?state\.edit\.angle_offset_deg/,
  "photo projection is told when the clinician explicitly changed candidate direction");
assert.match(controller, /currentRstlFingerprint !== rstlFingerprint[\s\S]*?workflow_stale_rstl/,
  "an async candidate computed from an obsolete RSTL snapshot is discarded");
assert.match(controller, /langerface:refine2d-state[\s\S]*?reconcileProjectedRstlSnapshot/,
  "manual or wrinkle-guided RSTL changes invalidate the old candidate without continuously rotating it");
assert.match(styles, /\.mobile-candidate-adjust\s*\{[^}]*background:\s*#0f141b;[^}]*border-left:\s*3px solid var\(--clinical-accent\);/s,
  "candidate adjustment uses the established dark navy panel and clinical blue accent");
assert.match(pipelineLoop, /setOverlaySummary\(renderState\.workflowPhotoOverlay[\s\S]*?\? \{ rstlLineCount: lineCount \}/,
  "RSTL redraws retain the workflow draft summary instead of clearing the lesion and incision candidate");
assert.match(controller, /frame\.transform\?\.viewportLeft \?\? rect\.left[\s\S]*?frame\.transform\?\.viewportTop \?\? rect\.top/,
  "workflow overlays use the same cached viewport origin as their source mapping while mobile controls reflow");
{
  const start = controller.indexOf("function observeWorkflowOverlayResize(");
  const end = controller.indexOf("\nfunction drawRepairStrokes", start);
  assert.ok(start >= 0 && end > start, "overlay resize observer is isolated from source-coordinate mutations");
  const source = controller.slice(start, end)
    .replace("state: WorkflowIncisionState", "state")
    .replace(/querySelector<(?:HTMLElement|HTMLCanvasElement)>/g, "querySelector");
  const frames = new Map<number, () => void>();
  let nextFrame = 0;
  let notify = () => {};
  let disconnected = false;
  const observed: unknown[] = [];
  const wrap = {};
  const canvas = {};
  const state = { mounted: true, root: { querySelector: (selector: string) => selector === ".main-wrap" ? wrap : canvas } };
  let displayWidth = 430;
  const draws: number[] = [];
  const context = {
    ResizeObserver: class {
      constructor(callback: () => void) { notify = callback; }
      observe(element: unknown) { observed.push(element); }
      disconnect() { disconnected = true; }
    },
    requestAnimationFrame(callback: () => void) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
    drawDraftOverlay() { draws.push(displayWidth); },
  };
  const observe = runInNewContext(`(${source})`, context);
  const cleanup = observe(state);
  assert.deepEqual(observed, [wrap, canvas], "observe both stage reflow and the fitted image size");
  const tick = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); };
  notify(); notify();
  assert.equal(frames.size, 1, "coalesce resize notifications");
  tick();
  assert.equal(draws.length, 0, "do not draw before the Live fit callback in the first frame");
  displayWidth = 426;
  tick();
  assert.deepEqual(draws, [426], "draw with the updated image transform, not the 430px stale fit");
  notify(); tick(); cleanup(); tick(); notify(); tick();
  assert.equal(draws.length, 1, "cleanup cancels queued redraw and ignores late observer notifications");
  assert.equal(disconnected, true);
  const cleanupAgain = observe(state);
  notify(); state.mounted = false; tick(); tick();
  assert.equal(draws.length, 1, "unmounted controller never redraws");
  cleanupAgain();
  const withoutObserver = runInNewContext(`(${source})`, { ...context, ResizeObserver: undefined });
  withoutObserver(state)();
  const missingWrap = { mounted: true, root: { querySelector: () => null } };
  observe(missingWrap)();
  assert.match(controller, /const cleanupOverlayResize = observeWorkflowOverlayResize\(state\)/);
  assert.match(controller, /state\.cleanup = \(\) => \{\s*cleanupOverlayResize\(\)/);
}
assert.match(mobileVisibility, /let rstlLayerVisible = true;[\s\S]*?let wrinkleLayerVisible = true;[\s\S]*?let incisionCandidateVisible = true;/,
  "all phone display layers default to visible");
assert.match(mobileVisibility, /resetMobileWorkflowVisibility[\s\S]*?rstlLayerVisible = true;[\s\S]*?wrinkleLayerVisible = true;[\s\S]*?incisionCandidateVisible = true;/,
  "all phone display layers reset when the mobile workflow unmounts");
assert.match(mobileVisibility, /return !mobileWorkflowViewportActive\(\) \|\| rstlLayerVisible;[\s\S]*?return !mobileWorkflowViewportActive\(\) \|\| wrinkleLayerVisible;[\s\S]*?return !mobileWorkflowViewportActive\(\) \|\| incisionCandidateVisible;/,
  "phone visibility choices cannot suppress any desktop overlay after a viewport change");
assert.match(render2d, /shouldDrawRstlLayer\(\) && mobileRstlLayerVisible\(\)[\s\S]*?shouldDrawWrinkleLayer\(\) && mobileWrinkleLayerVisible\(\)/,
  "RSTL and wrinkle generation retain their established gates and add only phone display suppression");
assert.match(render2d, /if \(mobileIncisionCandidateVisible\(\)\)\s*\{[\s\S]*?overlayStyle\.candidate\.haloColor[\s\S]*?overlayStyle\.candidate\.color/,
  "the mobile visibility gate wraps only candidate strokes while retaining lesion boundary and center drawing");
assert.ok(
  incisionRail.indexOf("<TumorInputPanel") < incisionRail.indexOf("<MobileCandidateAdjustPanel")
    && incisionRail.indexOf("<MobileCandidateAdjustPanel") < incisionRail.indexOf("<CandidateResultPanel"),
  "the phone candidate adjustment panel follows the main parameter panel and precedes candidate results",
);
assert.match(controller, /incisionOverlayScreenStyle\(state\.result\?\.candidate\?\.type,[\s\S]*?compact: mobileWorkflowViewportActive\(\),[\s\S]*?viewScale: frame\.transform\?\.zoom/,
  "the photo overlay derives its visual scale from the same compact contract and the current photo zoom");
assert.match(controller, /centerCircle\.setAttribute\("r", String\(overlayStyle\.center\.radiusCss\)\)/,
  "the photo lesion center consumes the shared responsive radius instead of a fixed mobile radius");
assert.ok(canvasTools.includes("data-workflow-boundary-halo")
  && canvasTools.includes("data-workflow-candidate-halo"),
"photo boundary and incision strokes have the same explicit under-stroke structure as live canvas rendering");
assert.equal(incisionOverlayScreenStyle("fusiform", { compact: true }).center.radiusCss, 3,
  "the compact full-photo lesion center uses the finer baseline");
assert.match(styles, /@media \(max-width:\s*560px\) and \(pointer:\s*coarse\) and \(hover:\s*none\)[\s\S]*?\[data-workflow-boundary\][\s\S]*?stroke:\s*#fde047;[\s\S]*?\[data-workflow-candidate\][\s\S]*?stroke:\s*#67e8f9;[\s\S]*?\[data-workflow-center\][\s\S]*?fill:\s*#fb7185;/,
  "phone drawing marks use the requested bright, thin clinical legend colors without restyling desktop");
const clickIntent = beginWorkflowPointerIntent(1, 0, 10, 10);
updateWorkflowPointerIntent(clickIntent, 1, 13, 13);
assert.equal(completesWorkflowCanvasClick(clickIntent, 1), true, "small pointer jitter remains a lesion-selection click");
assert.deepEqual(
  workflowFocusViewportPoint(
    { x: 400, y: 260 },
    { width: 1000, height: 800 },
    { sx: 200, sy: 100, sw: 400, sh: 320 },
  ),
  { x: 500, y: 400 },
  "the same surface-projected source point is reprojected into the focused crop viewport",
);
assert.deepEqual(
  workflowFocusViewportPoint({ x: 400, y: 260 }, { width: 1000, height: 800 }, null),
  { x: 400, y: 260 },
  "full-face view keeps source coordinates unchanged",
);
const dragIntent = beginWorkflowPointerIntent(2, 0, 10, 10);
updateWorkflowPointerIntent(dragIntent, 2, 18, 10);
assert.equal(completesWorkflowCanvasClick(dragIntent, 2), false, "canvas panning is not misread as lesion selection");
assert.equal(beginWorkflowPointerIntent(3, 2, 10, 10), null, "non-primary pointer buttons do not select lesions");
assert.equal(workflowLiveOverlayChanged({ loaded: false, qaLabel: null }, false, null), false, "unchanged overlay state does not refresh the Live rail");
assert.equal(workflowLiveOverlayChanged({ loaded: true, qaLabel: "已自动激活" }, false, null), true, "real overlay changes still refresh the Live rail");
assert.equal(workflowInvalidationNeedsLiveFrame(false), false,
  "right-rail parameter changes do not refresh the Live/RSTL frame when no active incision overlay exists");
assert.equal(workflowInvalidationNeedsLiveFrame(true), true,
  "removing an active incision overlay still refreshes the shared frame once");
assert.equal(workflowCandidateDisplayAllowed({ candidate_display_blocked: true }, true), false,
  "hard-blocked candidates never reach the merged draft renderer");
assert.equal(workflowCandidateDisplayAllowed({ candidate_display_blocked: false }, true), true,
  "valid projected candidates remain visible");
const rejectedOutline: [number, number, number][] = [[0, 0, 0], [4, 2, 0], [0, 4, 0], [-4, 2, 0], [0, 0, 0]];
for (const code of ["candidate_outside_canonical_surface", "candidate_intersects_non_skin_opening", "candidate_intersects_default_vermilion_protection", "other_gate"]) {
  assert.equal(workflowDiagnosticCandidateVisible({ candidate_display_blocked: true,
    candidate: { type: "fusiform", hard_violations: [{ code }] },
  }, true, rejectedOutline), true, "all blocked fusiform categories can show their real complete outline");
}
assert.equal(workflowDiagnosticCandidateVisible({ candidate: { type: "fusiform" } }, false, rejectedOutline), true,
  "a failed photo projection may show a valid complete rejected fit");
assert.equal(workflowDiagnosticCandidateVisible({ candidate_display_blocked: false, candidate: { type: "fusiform" } }, true, rejectedOutline), false,
  "a valid allowed candidate never receives the red diagnostic style");
assert.equal(workflowDiagnosticCandidateVisible({ candidate_display_blocked: true, candidate: { type: "fusiform" } }, false, []), false,
  "the diagnostic layer does not invent missing geometry");
assert.equal(workflowUpperForeheadSurfaceRecoveryActive({
  canonicalSurfaceOnly: true,
  projectionValid: true,
  smoothingMode: "photoCanonical",
  meshOutsideCount: 8,
  surfaceOutsideCount: 0,
  rstlSupportedMeshOutsideCount: 8,
}), true, "a fully RSTL-supported upper-forehead mesh gap can recover the photo display gate");
assert.equal(workflowUpperForeheadSurfaceRecoveryActive({
  canonicalSurfaceOnly: true,
  projectionValid: true,
  smoothingMode: "photoCanonical",
  meshOutsideCount: 0,
  surfaceOutsideCount: 0,
  rstlSupportedMeshOutsideCount: 0,
  upperForeheadPointCount: 72,
  pointCount: 72,
} as any), true,
"a lower safe-forehead candidate already contained by the extended photo mesh does not fail merely because it has zero mesh-outside points");
assert.equal(workflowPhotoSurfaceReferenceRecoveryEligible({
  candidate_display_blocked: true,
  tumor_engineering_validation: { passed: true },
  candidate: { hard_violations: [{ code: "candidate_outside_canonical_surface" }] },
  candidate_alternatives: [{
    candidate: { hard_violations: [{ code: "candidate_intersects_non_skin_opening" }] },
  }],
}), true,
"upper-forehead recovery audits the displayed primary candidate instead of inheriting unrelated hidden-variant failures");
assert.equal(workflowPhotoSurfaceReferenceRecoveryEligible({
  candidate_display_blocked: true,
  tumor_engineering_validation: { passed: true },
  candidate: { hard_violations: [
    { code: "candidate_outside_canonical_surface" },
    { code: "candidate_intersects_non_skin_opening" },
  ] },
}), false, "a real opening violation on the displayed candidate still blocks forehead recovery");
assert.equal(workflowVisibilityLimitedReferenceDisplayActive({
  canonicalSurfaceOnly: true,
  projectionValid: true,
  smoothingMode: "limitedVisibility",
  visibilityLimited: true,
  hiddenPointCount: 9,
  visibleFraction: 0.68,
}), true, "a geometry-vetted single hidden tip uses the blue view-limited reference layer");
assert.equal(workflowVisibilityLimitedReferenceDisplayActive({
  canonicalSurfaceOnly: false,
  projectionValid: true,
  smoothingMode: "limitedVisibility",
  visibilityLimited: true,
  hiddenPointCount: 9,
  visibleFraction: 0.68,
}), false, "sensitive-opening failures cannot borrow the view-limited blue reference path");
assert.equal(workflowVisibilityLimitedReferenceDisplayActive({
  canonicalSurfaceOnly: true,
  projectionValid: true,
  smoothingMode: "limitedVisibility",
  visibilityLimited: true,
  hiddenPointCount: 9,
  visibleFraction: 0.5,
  openingIntersection: "left-nostril-opening",
}), false, "a full candidate crossing an eye, mouth or nostril cannot borrow the blue view-limited path");
assert.equal(workflowVisibilityLimitedReferenceDisplayActive({
  canonicalSurfaceOnly: true,
  projectionValid: true,
  smoothingMode: "limitedVisibility",
  visibilityLimited: true,
  hiddenPointCount: 9,
  visibleFraction: 0.5,
  openingIntersection: null,
}), true, "approximately half-visible geometry remains eligible when the full candidate avoids photo openings");
assert.match(controller, /photo_visibility_limited_candidate = visibilityLimitedReference[\s\S]*?photo_visible_fraction = geometry\.candidateProjection\.visibleFraction/,
  "the merged workflow publishes the established visibility-reference metrics used by review and presenter gates");
assert.match(controller, /state\.kind === "cutaneous" && candidate\.type === "fusiform"/,
  "controlled and freehand fusiform candidates receive the same stable photo metric scale as ellipse candidates");
assert.match(controller, /candidateDisplayBlocked = \(state\.result\.candidate_display_blocked === true && !displayRecoveryActive\)[\s\S]*?Boolean\(photoOpeningIntersection\)/,
  "a photo-space sensitive opening blocks the blue layer even when model-space projection looked valid");
for (const unsafeRecovery of [
  { canonicalSurfaceOnly: false, projectionValid: true, smoothingMode: "photoCanonical", meshOutsideCount: 8, surfaceOutsideCount: 0, rstlSupportedMeshOutsideCount: 8 },
  { canonicalSurfaceOnly: true, projectionValid: false, smoothingMode: "photoCanonical", meshOutsideCount: 8, surfaceOutsideCount: 0, rstlSupportedMeshOutsideCount: 8 },
  { canonicalSurfaceOnly: true, projectionValid: true, smoothingMode: "photoCanonical", meshOutsideCount: 8, surfaceOutsideCount: 1, rstlSupportedMeshOutsideCount: 8 },
  { canonicalSurfaceOnly: true, projectionValid: true, smoothingMode: "photoCanonical", meshOutsideCount: 8, surfaceOutsideCount: 0, rstlSupportedMeshOutsideCount: 7 },
  { canonicalSurfaceOnly: true, projectionValid: true, smoothingMode: "constrainedReference", meshOutsideCount: 8, surfaceOutsideCount: 0, rstlSupportedMeshOutsideCount: 8 },
]) {
  assert.equal(workflowUpperForeheadSurfaceRecoveryActive(unsafeRecovery), false,
    "other hard violations, invalid projections, incomplete RSTL support, and nonstandard references stay blocked");
}
assert.match(controller, /workflowDiagnosticCandidateOutline\(state\.result\.candidate\?\.type, geometry\)/,
  "diagnostic visibility uses the real complete fit");
assert.match(controller, /workflowDiagnosticFusiformSvgPath\(diagnosticCandidate,/,
  "the red layer uses its own complete-outline renderer");
assert.match(photoPlanning, /const projectionGateReason[\s\S]*?diagnosticFusiformRendering[\s\S]*?"photo_surface_exit"/,
  "the reported failure reason stays tied to the actual rejected outline shown in red");
assert.match(controller, /diagnosticCandidateBlockMessage\(state\.result,/,
  "the red status explains the actual blocked candidate");
assert.match(controller, /无法完整覆盖肿物边界，因此不显示容易误解的红色轮廓/,
  "a boundary-coverage failure produces a precise warning without drawing an undersized candidate");
assert.equal(workflowProjectionStatusMayOverride("candidate_result", "候选已生成并等待审阅"), true,
  "a new candidate result may publish its projection or diagnostic status");
assert.equal(workflowProjectionStatusMayOverride("workflow_photo_readiness_changed", "照片状态变化"), true,
  "a photo projection refresh may publish the candidate projection status");
assert.equal(workflowProjectionStatusMayOverride("tumor_opening_photo_rejected", "识别范围进入眼裂"), false,
  "an opening rejection cannot be overwritten by an older red diagnostic candidate");
assert.equal(workflowProjectionStatusMayOverride("freehand_boundary_open", "轮廓尚未闭合"), false,
  "a freehand interaction warning cannot be overwritten by candidate presentation");
const freehandPointerUpSource = controller.slice(
  controller.indexOf("function handleFreehandPointerUp"),
  controller.indexOf("function handleCanvasPointerDown"),
);
assert.doesNotMatch(freehandPointerUpSource, /recoverWorkflowFreehandBoundary|runWorkflow\(/,
  "pointer-up only pauses sampling; it cannot recognize the boundary or generate a candidate before explicit completion");
assert.match(controller, /function claimFreehandPointer[\s\S]*?event\.preventDefault\(\);[\s\S]*?isMobileWorkflowTouch\(event\)\) return;/,
  "mobile one-finger freehand drawing no longer stops the shared two-finger gesture listener");
assert.match(controller, /mobileFreehandTouch[\s\S]*?mobileTouchPointers\.size > 1[\s\S]*?cancelFreehandStrokeForTouchGesture\(state\)/,
  "a second touch cancels the current uncommitted stroke before pinch zoom or pan begins");
assert.match(controller, /function cancelFreehandStrokeForTouchGesture[\s\S]*?splice\(state\.boundaryDrawingStartIndex\)[\s\S]*?boundaryDrawingPointerId = null/,
  "pinch takeover rolls back only the active stroke segment and preserves earlier paused freehand segments");
assert.match(controller, /case "toggle_boundary":[\s\S]*?finalizeWorkflowFreehandBoundary\(state\)/,
  "the explicit end-drawing command owns freehand recognition and candidate generation");
assert.match(controller, /boundaryMode === "freehand"[\s\S]*?当前已有自由轮廓肿物边界[\s\S]*?再次点击“开始描绘”[\s\S]*?切换为“椭圆近似”[\s\S]*?freehand_inactive_canvas_click_blocked/,
  "an inactive freehand mode explains how to redraw or return to ellipse simulation without ambiguous mode language");
const closedDisplayStroke = [
  { x: 10, y: 10 }, { x: 20, y: 8 }, { x: 30, y: 10 }, { x: 32, y: 20 },
  { x: 30, y: 30 }, { x: 20, y: 32 }, { x: 10, y: 30 }, { x: 11, y: 11 },
];
assert.equal(workflowFreehandBoundaryClosed(closedDisplayStroke), true,
  "a continuous stroke closes only when enough samples return to the visible starting point");
assert.equal(workflowFreehandBoundaryClosed([...closedDisplayStroke.slice(0, -1), { x: 40, y: 40 }]), false,
  "an open freehand stroke is not silently joined across a visible gap");
assert.equal(workflowFreehandContinuationAllowed(closedDisplayStroke.slice(0, -1), { x: 18, y: 31 }), true,
  "a follow-up stroke may continue near the previous endpoint");
assert.equal(workflowFreehandContinuationAllowed(closedDisplayStroke.slice(0, -1), { x: 80, y: 80 }), false,
  "a remote follow-up stroke cannot insert an unreviewed straight gap");
const roughBoundary = [
  { x: 10, y: 10 }, { x: 18, y: 9 }, { x: 20, y: 10 }, { x: 30, y: 10 },
  { x: 31, y: 18 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 22, y: 31 },
  { x: 20, y: 30 }, { x: 10, y: 30 }, { x: 9, y: 22 }, { x: 10, y: 20 },
];
const smoothedBoundary = smoothWorkflowClosedBoundary(roughBoundary);
assert.equal(smoothedBoundary.length, 48, "a valid mouse-drawn loop is resampled to a stable smooth closed boundary");
const smoothBoundaryPath = workflowClosedBoundarySvgPath(smoothedBoundary);
assert.match(smoothBoundaryPath, /^M .* Q .* Z$/, "tumor boundaries render as a smooth closed quadratic path");
assert.doesNotMatch(smoothBoundaryPath, / L /, "the final tumor boundary is not downgraded to a jagged polygon");
const tailedFreehandStroke = [
  { x: -14, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: -2 },
  { x: 20, y: 0 }, { x: 24, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 22 },
  { x: 0, y: 20 }, { x: 0, y: 10 }, { x: -4, y: 5 },
];
const recoveredFreehand = recoverWorkflowFreehandBoundary(
  tailedFreehandStroke.map((point) => ({ source: point, display: point })),
);
assert.equal(recoveredFreehand.length, 48,
  "freehand recovery extracts and smooths the main loop from a stroke that crosses itself after an entry tail");
assert.ok(Math.min(...recoveredFreehand.map((point) => point.x)) > -2,
  "the recovered main loop trims the protruding entry and exit tail instead of smoothing it into the lesion");
const recoveredCenter = workflowBoundaryCentroid(recoveredFreehand);
assert.ok(recoveredCenter && Math.abs(recoveredCenter.x - 10) < 1 && Math.abs(recoveredCenter.y - 10) < 1,
  "the recovered loop supplies a new planning center instead of retaining the pre-freehand click");
const nearClosedStroke = [
  { x: 0, y: 0 }, { x: 10, y: -3 }, { x: 20, y: 0 }, { x: 24, y: 10 },
  { x: 20, y: 20 }, { x: 10, y: 23 }, { x: 0, y: 20 }, { x: -4, y: 10 }, { x: 5, y: 4 },
];
assert.equal(recoverWorkflowFreehandBoundary(
  nearClosedStroke.map((point) => ({ source: point, display: point })),
).length, 48, "a visually closed stroke may recover within the display tolerance without pixel-perfect endpoint alignment");
const proportionallyNearClosedStroke = [
  { x: 0, y: 0 }, { x: 30, y: -15 }, { x: 60, y: 0 }, { x: 75, y: 30 },
  { x: 60, y: 60 }, { x: 30, y: 75 }, { x: 0, y: 60 }, { x: -15, y: 30 }, { x: -6, y: 36 },
];
assert.equal(recoverWorkflowFreehandBoundary(
  proportionallyNearClosedStroke.map((point) => ({ source: point, display: point })),
).length, 48, "a short endpoint gap is judged against the full drawn loop instead of a fixed 24-pixel cutoff");
const openHorseshoeStroke = [
  { x: -20, y: 0 }, { x: -30, y: 20 }, { x: -20, y: 40 }, { x: 0, y: 50 },
  { x: 20, y: 40 }, { x: 30, y: 20 }, { x: 26, y: 8 }, { x: 20, y: 0 },
];
assert.equal(recoverWorkflowFreehandBoundary(
  openHorseshoeStroke.map((point) => ({ source: point, display: point })),
).length, 0, "an obviously open horseshoe is not force-closed by the adaptive endpoint tolerance");
assert.equal(workflowPhotoBoundaryEnclosingDiameterMm(
  { x: 100, y: 80 },
  [{ x: 90, y: 80 }, { x: 100, y: 70 }, { x: 110, y: 80 }, { x: 100, y: 90 }],
  2,
), 10, "controlled-marker planning preserves the photo-space enclosing diameter before face-edge surface snapping");
const mainLoopWithCrossedSpike = [
  { x: 0, y: 0 }, { x: 10, y: -3 }, { x: 20, y: 0 }, { x: 24, y: 10 },
  { x: 20, y: 20 }, { x: 10, y: 23 }, { x: 0, y: 20 }, { x: -4, y: 10 }, { x: 2, y: 2 },
  { x: 8, y: 2 }, { x: 14, y: -5 }, { x: 22, y: -5 }, { x: 28, y: 2 },
  { x: 28, y: 10 }, { x: 22, y: 17 }, { x: 14, y: 17 }, { x: 8, y: 10 }, { x: 8, y: 2 },
];
const recoveredMainOverSpike = recoverWorkflowFreehandBoundary(
  mainLoopWithCrossedSpike.map((point) => ({ source: point, display: point })),
);
assert.ok(recoveredMainOverSpike.length === 48 && Math.max(...recoveredMainOverSpike.map((point) => point.x)) < 26,
  "a small exact crossed spike cannot outrank a substantially larger near-closed lesion loop");
assert.deepEqual(workflowBoundaryModeTransition("freehand", "select"), {
  boundaryActive: true, clearCenter: true, mayGenerateCandidate: false, exitControlledMarker: true,
}, "switching into freehand mode exits controlled-marker display suppression and cannot regenerate the old candidate");
assert.deepEqual(workflowBoundaryModeTransition("freehand", "clear"), {
  boundaryActive: true, clearCenter: true, mayGenerateCandidate: false, exitControlledMarker: false,
}, "clearing a freehand boundary keeps drawing active while preventing the old ellipse candidate from returning");
assert.deepEqual(workflowBoundaryModeTransition("ellipse", "select"), {
  boundaryActive: false, clearCenter: false, mayGenerateCandidate: true, exitControlledMarker: false,
}, "ellipse mode preserves its existing marker transition contract");
assert.equal(workflowFreehandToggleAction(false, 0), "start",
  "the freehand action starts when drawing is inactive");
assert.equal(workflowFreehandToggleAction(true, 0), "cancel_empty",
  "ending an empty freehand session exits instead of trapping the operator in drawing mode");
assert.equal(workflowFreehandToggleAction(true, 12), "finalize",
  "ending a non-empty freehand session still submits the recorded boundary");
const scanCircle = workflowScanCircleGeometry({
  sourcePoint: { x: 100, y: 80 },
  scanDiameterMm: 20,
  pixelsPerMm: 2,
  project: (point) => ({ x: 10 + point.x * 0.5, y: 20 + point.y * 0.5 }),
});
assert.deepEqual(scanCircle, { center: { x: 60, y: 60 }, radius: 10 },
  "scan diameter follows the current display transform instead of using stale source pixels");
assert.deepEqual(workflowPlanningClientPoint(
  { x: 180, y: 420 },
  { left: 0, top: -240 },
  { viewportLeft: 0, viewportTop: 0 },
), { x: 180, y: 660 },
"a page scroll is compensated before a mobile touch is mapped through the cached planning viewport");
assert.deepEqual(
  workflowFusiformPlaneNormal({ axis: [1, 0, 0], width_axis: [0, 1, 0] }, [0, 1, 0]),
  [0, 0, 1],
  "fusiform editing preserves the candidate's own geometric plane even when the nearby mesh normal differs",
);
assert.deepEqual(
  workflowFusiformPlaneNormal({ axis: [1, 0, 0], width_axis: [2, 0, 0] }, [0, 0, -2]),
  [0, 0, -1],
  "degenerate candidate plane data falls back to a normalized surface normal",
);
assert.deepEqual(workflowControlledMarkerCrop({
  frameWidth: 1280,
  frameHeight: 1280,
  seed: { x: 640, y: 640 },
  roiRadius: 120,
}), { x: 516, y: 516, width: 249, height: 249, seed: { x: 124, y: 124 } },
"controlled-marker crops include the scan radius plus a bounded safety margin");
assert.deepEqual(workflowControlledMarkerCrop({
  frameWidth: 320,
  frameHeight: 240,
  seed: { x: 3, y: 2 },
  roiRadius: 30,
}), { x: 0, y: 0, width: 38, height: 37, seed: { x: 3, y: 2 } },
"controlled-marker crops clamp safely at phone-photo edges without moving the seed");
assert.equal(minimumWorkflowMarkerScanDiameterMm(12), 15, "controlled-marker scan covers at least 1.2 times the lesion diameter");
assert.equal(minimumWorkflowMarkerScanDiameterMm(40), 50, "scan coverage rounds upward in the legacy five-millimetre steps");
assert.equal(minimumWorkflowMarkerScanDiameterMm(100), 60, "scan coverage respects the established maximum");
assert.match(canvasTools, /<RangeInput\s+min="10"\s+max="60"\s+step="5"/,
  "scan control uses the native range component with fixed 10–60 mm endpoints");
assert.doesNotMatch(canvasTools, /minimumScanDiameterMm/,
  "tumor-dependent detection coverage must not move the slider's minimum");
const manualScanStart = controller.indexOf('case "scan_diameter_changed":');
const manualScanEnd = controller.indexOf('case "reset_view":', manualScanStart);
assert.ok(manualScanStart >= 0 && manualScanEnd > manualScanStart);
const changeManualScan = runInNewContext(
  `(function(state, detail) { switch(detail.command) { ${controller.slice(manualScanStart, manualScanEnd)} } return state; })`,
  { scheduleOverlayDraw() {} },
);
for (const diameterMm of [8, 28, 50]) {
  for (const [requested, expected] of [[-5, 10], [10, 10], [35, 35], [60, 60], [100, 60], [NaN, 10], [Infinity, 10]]) {
    const state = { diameterMm, scanDiameterMm: 35, markerRequestId: 4, markerBusy: false, markerMode: false };
    changeManualScan(state, { command: "scan_diameter_changed", value: requested });
    assert.equal(state.scanDiameterMm, expected, "manual slider endpoint must not depend on tumor diameter");
    assert.equal(state.markerRequestId, 5, "range changes still invalidate stale requests");
  }
}
assert.match(controller, /if \(started.scanDiameterMm < minimumScanDiameterMm\)[\s\S]*?controlled_marker_scan_too_small[\s\S]*?return;/,
  "choosing a small scan must not bypass the existing detection coverage precondition");
assert.equal(workflowMarkerScanDiameterForTumor(30, 33), 40,
  "changing cutaneous diameter automatically expands an undersized controlled-marker scan");
assert.equal(workflowMarkerScanDiameterForTumor(50, 20), 50,
  "a deliberately larger controlled-marker scan remains unchanged");
const markerRequest = {
  kind: "cutaneous" as const,
  diameterMm: 12,
  depthMm: 6,
  marginMm: 0,
  scanDiameterMm: 20,
  author: "clinician",
};
assert.equal(workflowMarkerRequestStillCurrent(markerRequest, { ...markerRequest }), true, "unchanged marker requests remain current");
assert.equal(workflowMarkerRequestStillCurrent(markerRequest, { ...markerRequest, scanDiameterMm: 25 }), false,
  "scan-range changes invalidate an in-flight marker request");
assert.equal(workflowMarkerRequestStillCurrent(markerRequest, { ...markerRequest, marginMm: 2 }), false,
  "tumor-parameter changes invalidate an in-flight marker request");

const ellipseAt = (x: number, y: number) => workflowPhotoEllipseBoundary({
  center: { x, y },
  diameterMm: 14,
  ellipseRatio: 70,
  pixelsPerMm: 2,
});
const ellipseSpan = (points: Array<{ x: number; y: number }>) => ({
  width: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
  height: Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
});
const firstEllipseSpan = ellipseSpan(ellipseAt(100, 80));
const secondEllipseSpan = ellipseSpan(ellipseAt(420, 260));
assert.ok(Math.abs(firstEllipseSpan.width - secondEllipseSpan.width) < 1e-9
  && Math.abs(firstEllipseSpan.height - secondEllipseSpan.height) < 1e-9,
  "identical cutaneous parameters keep identical photo-space axes at different face locations");
const equivalentCircleDiameterPx = 28;
assert.ok(Math.abs(firstEllipseSpan.height / firstEllipseSpan.width - 0.7) < 1e-9
  && Math.abs(firstEllipseSpan.width * firstEllipseSpan.height - equivalentCircleDiameterPx ** 2) < 1e-9,
  "photo-space ellipse changes its axis ratio while preserving the equivalent-circle area");
const circularEllipseSpan = ellipseSpan(workflowPhotoEllipseBoundary({
  center: { x: 100, y: 80 },
  diameterMm: 14,
  ellipseRatio: 100,
  pixelsPerMm: 2,
}));
assert.ok(Math.abs(circularEllipseSpan.width - equivalentCircleDiameterPx) < 1e-9
  && Math.abs(circularEllipseSpan.height - equivalentCircleDiameterPx) < 1e-9,
  "100 percent remains the circle defined by the requested diameter");
const mildEllipseSpan = ellipseSpan(workflowPhotoEllipseBoundary({
  center: { x: 100, y: 80 },
  diameterMm: 14,
  ellipseRatio: 90,
  pixelsPerMm: 2,
}));
assert.ok(Math.abs(mildEllipseSpan.height / mildEllipseSpan.width - 0.9) < 1e-9
  && Math.abs(mildEllipseSpan.width * mildEllipseSpan.height - equivalentCircleDiameterPx ** 2) < 1e-9,
  "a near-circular ratio preserves the same simulated lesion area");
const verticalEllipseSpan = ellipseSpan(workflowPhotoEllipseBoundary({
  center: { x: 100, y: 80 },
  diameterMm: 14,
  ellipseRatio: 150,
  pixelsPerMm: 2,
}));
assert.ok(Math.abs(verticalEllipseSpan.height / verticalEllipseSpan.width - 1.5) < 1e-9
  && Math.abs(verticalEllipseSpan.width * verticalEllipseSpan.height - equivalentCircleDiameterPx ** 2) < 1e-9,
  "a ratio above 100 percent makes the vertical reference axis longer without changing area");
const horizontalHalfSpan = ellipseSpan(workflowPhotoEllipseBoundary({
  center: { x: 100, y: 80 },
  diameterMm: 14,
  ellipseRatio: 50,
  pixelsPerMm: 2,
}));
const verticalDoubleSpan = ellipseSpan(workflowPhotoEllipseBoundary({
  center: { x: 100, y: 80 },
  diameterMm: 14,
  ellipseRatio: 200,
  pixelsPerMm: 2,
}));
assert.ok(Math.abs(horizontalHalfSpan.width - verticalDoubleSpan.height) < 1e-9
  && Math.abs(horizontalHalfSpan.height - verticalDoubleSpan.width) < 1e-9,
  "50 and 200 percent produce the same ellipse rotated by ninety degrees");

assert.deepEqual(
  workflowCenteredLinearPath([[0, 0, 0], [10, 0, 0]], [5, 1, 0]),
  [[0, 0, 0], [5, 1, 0], [10, 0, 0]],
  "the displayed subcutaneous line explicitly passes through the detector-confirmed lesion center",
);
assert.deepEqual(workflowSubcutaneousLengthLimit({
  type: "linear",
  length_mm: 35,
  metrics: { diameter_coverage_deficit_mm: 4, length_clamped_by_max: true },
}, 39), { lengthMm: 35, diameterMm: 39, deficitMm: 4 },
"a max-clamped subcutaneous candidate is surfaced as a coverage limit instead of looking unchanged");
assert.deepEqual(workflowSubcutaneousLengthLimit({
  type: "linear",
  length_mm: 35,
  metrics: { diameter_coverage_deficit_mm: 0, length_clamped_by_max: true },
}, 30), { lengthMm: 35, diameterMm: 30, deficitMm: 0 },
"a capped but still covering candidate is distinguished from a true diameter-coverage failure");

const projectedLandmarks = Array.from({ length: 468 }, () => [50, 50, 0] as Vec3);
projectedLandmarks[0] = [0, 0, 0];
projectedLandmarks[1] = [100, 100, 0];
const leftEyeIndices = [33, 160, 158, 133, 153, 144];
const leftEyePolygon: Vec3[] = [
  [30, 40, 0], [34, 37, 0], [40, 37, 0], [44, 40, 0], [40, 43, 0], [34, 43, 0],
];
leftEyeIndices.forEach((index, position) => { projectedLandmarks[index] = leftEyePolygon[position]; });
const oralIndices = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
oralIndices.forEach((index, position) => {
  const angle = position / oralIndices.length * Math.PI * 2;
  projectedLandmarks[index] = [50 + Math.cos(angle) * 10, 72 + Math.sin(angle) * 4, 0];
});
assert.equal(
  workflowPhotoOpeningIntersection(workflowPhotoCircleFootprint({ x: 37, y: 40 }, 8), projectedLandmarks),
  "left-eye-opening",
  "a scan footprint crossing the eye opening is rejected in photo coordinates",
);
assert.equal(
  workflowPhotoOpeningIntersection(workflowPhotoCircleFootprint({ x: 50, y: 72 }, 8), projectedLandmarks),
  "oral-opening",
  "a mouth scan is classified as a non-skin opening before detector size failures can replace its warning",
);
assert.equal(
  workflowPhotoOpeningIntersection(workflowPhotoCircleFootprint({ x: 82, y: 82 }, 3), projectedLandmarks),
  null,
  "a scan footprint on mapped skin remains eligible",
);
assert.equal(
  workflowPhotoOpeningIntersection(workflowPhotoCircleFootprint({ x: 40.5, y: 53 }, 1), projectedLandmarks),
  "left-nostril-opening",
  "photo-space nostril masks retain the established image-y-down location",
);
assert.equal(
  workflowPhotoOpeningIntersection(workflowPhotoCircleFootprint({ x: 40.5, y: 46 }, 1), projectedLandmarks),
  null,
  "visible nasal-bridge skin above the photographed nostril aperture remains selectable",
);

assert.match(incisionSnapshots, /reviewerLabel:\s*`审阅人：\$\{rec\.review\?\.reviewer \|\| "未填写"\}`/,
  "candidate summaries expose their own reviewer instead of the current review form");
assert.match(incisionSnapshots, /reviewNotesLabel:\s*`审阅备注：\$\{rec\.review\?\.notes \|\| "无"\}`/,
  "candidate summaries use 无 for an empty record-level review note");
assert.match(candidateLibraryPanel, /item\.reviewerLabel[\s\S]*?item\.reviewNotesLabel/,
  "candidate rows render reviewer and notes as record-level metadata");
const closedMouthLandmarks = projectedLandmarks.map((point) => [...point] as Vec3);
const upperInnerLip = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const lowerInnerLip = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
upperInnerLip.forEach((index, position) => {
  closedMouthLandmarks[index] = [40 + position * 2, 72, 0];
});
lowerInnerLip.forEach((index, position) => {
  closedMouthLandmarks[index] = [40 + position * 2, 72, 0];
});
assert.equal(
  workflowPhotoOpeningIntersection(workflowPhotoCircleFootprint({ x: 50, y: 72 }, 1), closedMouthLandmarks),
  "oral-opening",
  "a closed mouth keeps a small photo-space opening corridor instead of collapsing to zero area",
);
assert.equal(
  workflowPhotoOpeningIntersection(workflowPhotoCircleFootprint({ x: 50, y: 69 }, 1), closedMouthLandmarks),
  null,
  "the closed-mouth uncertainty corridor does not turn the adjacent visible lip into an opening",
);
assert.equal(
  workflowPhotoTumorOpeningIntersection({
    center: { x: 50, y: 64 },
    kind: "subcutaneous",
    diameterMm: 10,
    ellipseRatio: 70,
    pixelsPerMm: 2,
    photoLandmarks: closedMouthLandmarks,
  }),
  "oral-opening",
  "a lesion center on skin is rejected when its complete diameter footprint reaches the mouth opening",
);
const photoDiameterEstimate = buildPhotoSpaceDiameterEstimate([20, 30, 0], 6, 2);
assert.equal(photoDiameterEstimate.length, 49, "a valid subcutaneous diameter produces a closed photo-space circle");
assert.strictEqual(
  workflowPhotoTumorOutline("subcutaneous", { boundary: [], diameterEstimate: photoDiameterEstimate }),
  photoDiameterEstimate,
  "the merged SVG selects the restored diameter estimate for subcutaneous tumors",
);
const cutaneousBoundary: Vec3[] = [[10, 10, 0], [20, 10, 0], [20, 20, 0]];
assert.strictEqual(
  workflowPhotoTumorOutline("cutaneous", { boundary: cutaneousBoundary, diameterEstimate: photoDiameterEstimate }),
  cutaneousBoundary,
  "cutaneous tumors keep their established boundary rather than the diameter estimate",
);
assert.deepEqual(svgOverlayExportViewBox(
  { left: 100, top: 80, width: 640, height: 360 },
  { left: 20, top: 30, width: 900, height: 500 },
), { x: 80, y: 50, width: 640, height: 360 }, "workflow PNG export crops the workbench SVG to the displayed canvas rectangle");

const desktopFusiformStyle = incisionCandidateScreenStyle("fusiform");
assert.deepEqual(desktopFusiformStyle, {
  color: "#67e8f9",
  lineWidth: 1,
  haloColor: "#67e8f9",
  haloWidth: 1,
}, "desktop workflow style stays identical to the standalone highlighted photo candidate");
const smoothFit = {
  outline: [],
  sourceOutline: [],
  upperCurve: [[0, 0, 0], [2, -2, 0], [8, -2, 0], [10, 0, 0]],
  lowerCurve: [[0, 0, 0], [2, 2, 0], [8, 2, 0], [10, 0, 0]],
  upperCurves: [],
  lowerCurves: [],
  strategy: "global_cubic",
  blend: 1,
  medianSegment: 1,
} satisfies SurfaceProjectedFusiformFit;
const smoothPath = workflowFusiformSvgPath(smoothFit, (point) => ({ x: point[0], y: point[1] }));
assert.match(smoothPath, /^M .* C .* C .* Z$/, "workflow serializes the legacy global fusiform fit as two cubic curves");
assert.doesNotMatch(smoothPath, / L /, "a smooth fusiform is not downgraded to a straight-segment outline");

console.log("test_workflow_page: routed single-runtime layout boundary passed");
