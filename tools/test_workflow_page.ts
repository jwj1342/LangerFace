import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  beginWorkflowPointerIntent,
  completesWorkflowCanvasClick,
  minimumWorkflowMarkerScanDiameterMm,
  updateWorkflowPointerIntent,
  workflowCandidateDisplayAllowed,
  workflowFusiformSvgPath,
  workflowInvalidationNeedsLiveFrame,
  workflowLiveOverlayChanged,
  workflowMarkerRequestStillCurrent,
  workflowMarkerScanDiameterForTumor,
  workflowCenteredLinearPath,
  workflowPhotoCircleFootprint,
  workflowPhotoEllipseBoundary,
  workflowPhotoOpeningIntersection,
  workflowPhotoTumorOpeningIntersection,
  workflowPhotoTumorOutline,
  workflowScanCircleGeometry,
  workflowSubcutaneousLengthLimit,
} from "../web/src/services/workflowControllerUtils.ts";
import { svgOverlayExportViewBox } from "../web/src/services/incisionExport.ts";
import { incisionCandidateScreenStyle } from "../web/src/services/incisionOverlayStyle.ts";
import { buildPhotoSpaceDiameterEstimate, type SurfaceProjectedFusiformFit } from "../web/src/services/incisionPhotoPlanning.ts";
import type { Vec3 } from "../web/src/services/softBody.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const app = read("web/src/App.tsx");
const route = read("web/src/routes/WorkflowRoute.tsx");
const workbench = read("web/src/routes/WorkflowWorkbench.tsx");
const canvasTools = read("web/src/components/WorkflowCanvasTools.tsx");
const stageStatus = read("web/src/components/WorkflowStageStatus.tsx");
const incisionRail = read("web/src/components/WorkflowIncisionRail.tsx");
const candidateResultPanel = read("web/src/components/CandidateResultPanel.tsx");
const candidateLibraryPanel = read("web/src/components/CandidateLibraryPanel.tsx");
const tumorInputPanel = read("web/src/components/TumorInputPanel.tsx");
const liveRail = read("web/src/components/LiveControlRail.tsx");
const liveSourceControls = read("web/src/components/LiveSourceControlsPanel.tsx");
const liveRenderControls = read("web/src/components/LiveRenderControlsPanel.tsx");
const liveCanvasFit = read("web/src/services/liveCanvasFit.ts");
const controller = read("web/src/services/workflowIncisionController.ts");
const layout = read("web/src/components/WorkflowLayout.tsx");
const sharedLayout = read("web/src/components/WorkbenchLayout.tsx");
const styles = read("web/src/styles.css");

assert.match(app, /path="\/app\/workflow"\s+element={<WorkflowRoute\s*\/>}/, "workflow route stays inside the React SPA");
assert.match(route, /import\("\.\.\/services\/liveRuntime"\)/, "workflow route reuses the live media runtime");
assert.match(route, /import\("\.\.\/services\/workflowIncisionController"\)/, "workflow route mounts the canvas-free incision controller");
assert.doesNotMatch(route, /incisionRuntime/, "workflow route must not mount the legacy incision runtime beside liveRuntime");
assert.equal((workbench.match(/<LiveStagePanel\b/g) || []).length, 1, "workflow renders one visible live stage");
assert.match(workbench, /workflowActions={<WorkflowCanvasTools\s*\/>}/, "workflow places incision actions in the shared stage header");
assert.match(workbench, /workflowOverlay={<WorkflowCanvasOverlay\s*\/>}/, "workflow keeps only the incision drawing layer over the shared canvas");
assert.match(workbench, /workflowStatus={<WorkflowStageStatus\s*\/>}/, "workflow places incision status in the shared stage header");
assert.match(stageStatus, /snapshot\?\.stageStatus/, "workflow stage status renders the current incision result or warning");
assert.match(stageStatus, /snapshot\?\.stageBusy/, "workflow stage status consumes the incision-only busy state");
assert.match(stageStatus, /workflow-stage-spinner/, "workflow renders an explicit waiting animation for incision work");
assert.match(stageStatus, /aria-busy={busy}/, "workflow exposes waiting state to assistive technology");
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
assert.match(canvasTools, /commands\.tool\("clear_repair"\)/, "the text clear-repair control keeps its existing command");
assert.match(canvasTools, /commands\.tool\("reset_view"\)/, "the reset control uses the workflow tool contract");
assert.match(controller, /resetImageView\(\)/, "workflow reset reuses the existing Live image-view state");
assert.match(controller, /workflowLiveOverlayChanged/, "workflow suppresses no-op Live overlay snapshots");
assert.match(controller, /workflowInvalidationNeedsLiveFrame/, "workflow invalidation refreshes Live only when an active overlay was removed");
assert.match(controller, /completesWorkflowCanvasClick[\s\S]*?state\.centerRef = ref;[\s\S]*?void runWorkflow\(state\)/, "a direct canvas click selects the lesion center and starts workflow generation");
assert.match(controller, /buildForeheadSurfaceLandmarks\(frame\.landmarks\)/, "workflow restores the legacy extended forehead picking surface");
assert.match(controller, /buildIncisionPhotoGeometry\(/, "workflow candidate drafts reuse the established photo geometry and smoothing gates");
assert.match(controller, /workflowFusiformSvgPath\(geometry\.fusiformRendering/, "workflow draws the established smooth fusiform fit instead of the raw model polyline");
assert.match(canvasTools, /data-workflow-marker-scan-circle/, "workflow restores the controlled-marker circular scan feedback");
assert.match(canvasTools, /data-workflow-marker-scan-label/, "workflow scan circle reports its millimetre diameter");
assert.match(controller, /workflowScanCircleGeometry/, "workflow scan feedback follows the shared source-to-client transform");
assert.match(canvasTools, /disabled={markerUnavailable}/, "controlled-marker entry stays unavailable until a cutaneous photo is ready");
assert.match(canvasTools, /tools\?\.markerBusy \|\| !tools\?\.repairAvailable/, "repair cannot change detector inputs while a request is running");
assert.match(controller, /photoReady:\s*workflowPhotoReady\(state\)/, "workflow snapshots expose shared-photo readiness to the merged toolbar");
assert.match(controller, /minimumWorkflowMarkerScanDiameterMm/, "workflow restores the standalone minimum scan-coverage precondition");
assert.match(controller, /workflowMarkerRequestStillCurrent/, "workflow discards controlled-marker results computed from stale parameters");
assert.match(controller, /stablePhotoPixelsPerMm/, "workflow reuses the standalone face-wide controlled-marker scale");
assert.match(controller, /workflowPhotoEllipseBoundary/, "workflow default cutaneous boundaries are constructed in current photo coordinates");
assert.match(controller, /ellipseRatio:\s*state\.kind === "cutaneous" \? state\.ellipseRatio : null/,
  "the merged snapshot exposes the actual near-circular default instead of leaving the slider at its legacy 70% label");
assert.match(tumorInputPanel, /tumor\.ellipseRatio != null\) setEllipseRatio/,
  "the cutaneous ellipse control stays synchronized with the merged controller default");
assert.match(controller, /photoDiameterEstimateMm:\s*layerContract\.showDiameterEstimate\s*\?\s*state\.diameterMm/, "workflow restores the standalone subcutaneous diameter estimate input");
assert.match(controller, /candidateLengthMm:\s*Number\(candidate\.length_mm\)/,
  "the merged photo renderer consumes the computed linear length instead of re-projecting a curved standard face");
assert.match(controller, /incisionPhotoStatusPresentation\(/,
  "the merged canvas status reuses the standalone photo projection status contract");
assert.match(incisionRail, /<TumorInputPanel\s+showDepthControl={false}\s*\/>/, "workflow hides the currently non-operative depth control");
assert.match(tumorInputPanel, /showDepthControl\s*=\s*true/, "the standalone incision page retains its legacy depth-control default");
assert.match(tumorInputPanel, /visible={!cutaneous\s*&&\s*showDepthControl}/, "depth data remains mounted behind an explicit presentation boundary");
assert.match(controller, /controlledMarkerScale\?\.sourceRevision === frame\.revision/, "workflow caches one marker scale per photo revision");
assert.match(controller, /state\.controlledMarkerScale = null;[\s\S]*?state\.photoFrameRevision = frame\.revision/, "a new photo revision invalidates the cached marker scale");
assert.match(controller, /downloadCanvasWithSvgOverlayPng/, "workflow screenshot export includes the merged SVG drawing layer");
assert.match(controller, /async function importTumor[\s\S]*?resetMarkerRepair\(state\);[\s\S]*?state\.markerMode = false;/,
  "tumor import cancels an in-flight marker request before replacing planning state");
assert.match(controller, /case "load_candidate":[\s\S]*?resetMarkerRepair\(state\);[\s\S]*?state\.markerMode = false;/,
  "candidate loading cancels an in-flight marker request before replacing planning state");
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
const controlledMarkerHandler = controller.slice(
  controller.indexOf("async function runControlledMarker"),
  controller.indexOf("function pathData"),
);
assert.match(controlledMarkerHandler, /controlledMarkerPixelsPerMm\(state, frame, seed, photoProjection\.surfaceLandmarks\)/,
  "controlled-marker detection uses the same stable scale as its scan circle");
assert.ok(
  controlledMarkerHandler.indexOf("setSelection({ centerRef: null, boundaryRefs: [] })")
    < controlledMarkerHandler.indexOf("detectControlledMarker"),
  "every controlled-marker attempt clears the previous shared selection before detection",
);
assert.ok(
  controlledMarkerHandler.indexOf("workflowPhotoOpeningIntersection")
    < controlledMarkerHandler.indexOf("detectControlledMarker"),
  "the complete photo-space scan footprint is rejected before detector failure copy can mask the opening warning",
);
assert.ok(
  controlledMarkerHandler.lastIndexOf("workflowPhotoOpeningIntersection")
    < controlledMarkerHandler.indexOf("sourcePointToSurfaceRef(detection.center"),
  "the detected photo footprint is checked before surface snapping can erase opening information",
);
assert.match(liveRail, /<LiveSourceControlsPanel\s*\/>/, "workflow receives the existing Live upload controls through its only left rail");
assert.match(liveRail, /<LiveRenderControlsPanel\s*\/>/, "workflow receives the existing Live mirror control through its only left rail");
assert.match(liveSourceControls, /commands\.source\("upload_source"\)/, "the shared photo upload dispatches the single Live source command");
assert.match(liveRenderControls, /commands\.render\("mirror_toggle", checked\)/, "the shared mirror toggle dispatches the single Live render command");
assert.doesNotMatch(canvasTools, /upload_source|mirror_toggle/, "the incision overlay does not own duplicate upload or mirror state");
assert.match(liveCanvasFit, /mirror:\s*renderState\.mirror/, "shared planning coordinates consume the current Live mirror state");
for (const panel of [
  "TumorInputPanel",
  "SecondaryCuePanel",
  "CandidateResultPanel",
  "ReviewControlsPanel",
  "CandidateLibraryPanel",
  "PrivacyAuditPanel",
]) {
  assert.match(incisionRail, new RegExp(`<${panel}\\b`), `workflow incision rail includes ${panel}`);
}
assert.doesNotMatch(incisionRail, /IncisionStatePanel/,
  "workflow removes the duplicate incision state card while the standalone incision page keeps it");
assert.match(incisionRail, /<CandidateResultPanel\s+showWorkflowGuidance={false}\s*\/>/,
  "workflow keeps the candidate result card but hides duplicate generated/review guidance");
assert.match(incisionRail, /<CandidateLibraryPanel\s+automaticOverlay\s+showHandoffStatus={false}\s*\/>/,
  "workflow removes the second copy of canvas handoff status from the candidate library");
assert.match(candidateResultPanel, /showWorkflowGuidance\s*=\s*true/,
  "standalone candidate results retain their existing guidance by default");
assert.match(candidateLibraryPanel, /showHandoffStatus\s*=\s*true/,
  "standalone candidate library retains its existing handoff status by default");
assert.doesNotMatch(incisionRail, /打开独立切口工作台/, "workflow no longer substitutes navigation for incision controls");
assert.doesNotMatch(controller, /createPhotoPlanningController|incisionRuntime|sessionStorage/, "workflow incision controller owns no canvas runtime or page handoff storage");
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
assert.match(styles, /\.workflow-incision-overlay \[data-workflow-candidate\]\s*{[^}]*stroke:\s*#003b73;[^}]*stroke-width:\s*1;/s,
  "workflow restores the legacy matte dark-blue one-CSS-pixel candidate stroke");
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
assert.match(styles, /\.workflow-workbench\.app\s*{[^}]*grid-template-columns:[^}]*}\s*\.workflow-workbench \.stage-top\s*{[^}]*display:\s*grid;/s,
  "the unlayered workflow layout overrides the imported legacy flex header on wide screens");
assert.match(styles, /@media \(min-width:\s*1281px\) and \(max-width:\s*1760px\)\s*{[\s\S]*?\.workflow-workbench \.stage-top\s*{[^}]*display:\s*grid;[^}]*grid-template-areas:[\s\S]*?workflow-actions workflow-actions workflow-actions[\s\S]*?min-height:\s*92px;/,
  "intermediate desktop widths keep the complete tool strip in a second header row instead of clipping actions");
assert.match(styles, /@media \(max-width:\s*1280px\)\s*{[\s\S]*?\.workflow-workbench\.app\s*{[\s\S]*?grid-template-columns:\s*1fr;/, "workflow collapses before its readable three-column minimum can overflow");

const clickIntent = beginWorkflowPointerIntent(1, 0, 10, 10);
updateWorkflowPointerIntent(clickIntent, 1, 13, 13);
assert.equal(completesWorkflowCanvasClick(clickIntent, 1), true, "small pointer jitter remains a lesion-selection click");
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
const scanCircle = workflowScanCircleGeometry({
  sourcePoint: { x: 100, y: 80 },
  scanDiameterMm: 20,
  pixelsPerMm: 2,
  project: (point) => ({ x: 10 + point.x * 0.5, y: 20 + point.y * 0.5 }),
});
assert.deepEqual(scanCircle, { center: { x: 60, y: 60 }, radius: 10 },
  "scan diameter follows the current display transform instead of using stale source pixels");
assert.equal(minimumWorkflowMarkerScanDiameterMm(12), 15, "controlled-marker scan covers at least 1.2 times the lesion diameter");
assert.equal(minimumWorkflowMarkerScanDiameterMm(40), 50, "scan coverage rounds upward in the legacy five-millimetre steps");
assert.equal(minimumWorkflowMarkerScanDiameterMm(100), 60, "scan coverage respects the established maximum");
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
assert.ok(Math.abs(firstEllipseSpan.width - 28) < 1e-9
  && Math.abs(firstEllipseSpan.height - 19.6) < 1e-9,
  "photo-space ellipse axes follow the stable millimetre scale and requested aspect ratio");
const mildEllipseSpan = ellipseSpan(workflowPhotoEllipseBoundary({
  center: { x: 100, y: 80 },
  diameterMm: 14,
  ellipseRatio: 90,
  pixelsPerMm: 2,
}));
assert.ok(Math.abs(mildEllipseSpan.width - 28) < 1e-9
  && Math.abs(mildEllipseSpan.height - 25.2) < 1e-9,
"the merged-page default can represent a near-circular cutaneous lesion without a strong 70% flattening");

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

const legacyFusiformStyle = incisionCandidateScreenStyle("fusiform");
assert.deepEqual(legacyFusiformStyle, {
  color: "#003b73",
  lineWidth: 1,
  haloColor: "#003b73",
  haloWidth: 1,
}, "workflow style contract stays identical to the standalone photo candidate");
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
