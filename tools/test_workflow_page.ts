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
  workflowDiagnosticCandidateVisible,
  workflowProjectionStatusMayOverride,
  workflowPhotoSurfaceReferenceRecoveryEligible,
  workflowVisibilityLimitedReferenceDisplayActive,
  workflowUpperForeheadSurfaceRecoveryActive,
  workflowBoundaryCentroid,
  workflowBoundaryModeTransition,
  workflowClosedBoundarySvgPath,
  workflowFreehandBoundaryClosed,
  workflowFreehandContinuationAllowed,
  workflowFocusViewportPoint,
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
  workflowScanCircleGeometry,
  recoverWorkflowFreehandBoundary,
  smoothWorkflowClosedBoundary,
  workflowSubcutaneousLengthLimit,
} from "../web/src/services/workflowControllerUtils.ts";
import { svgOverlayExportViewBox } from "../web/src/services/incisionExport.ts";
import { incisionCandidateScreenStyle } from "../web/src/services/incisionOverlayStyle.ts";
import { buildPhotoSpaceDiameterEstimate, type SurfaceProjectedFusiformFit } from "../web/src/services/incisionPhotoPlanning.ts";
import type { Vec3 } from "../web/src/services/softBody.ts";
import { tumorDiameterParameterInactive } from "../web/src/services/tumorInput.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const app = read("web/src/App.tsx");
const route = read("web/src/routes/WorkflowRoute.tsx");
const workbench = read("web/src/routes/WorkflowWorkbench.tsx");
const mobileControls = read("web/src/components/MobileWorkflowControls.tsx");
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
const render2d = read("web/src/services/render2d.ts");
const photoPlanning = read("web/src/services/incisionPhotoPlanning.ts");
const layout = read("web/src/components/WorkflowLayout.tsx");
const sharedLayout = read("web/src/components/WorkbenchLayout.tsx");
const styles = read("web/src/styles.css");
const persistentTooltip = read("web/src/components/ui/persistent-tooltip.tsx");

assert.match(app, /path="\/app\/workflow"\s+element={<WorkflowRoute\s*\/>}/, "workflow route stays inside the React SPA");
assert.match(route, /import\("\.\.\/services\/liveRuntime"\)/, "workflow route reuses the live media runtime");
assert.match(route, /import\("\.\.\/services\/workflowIncisionController"\)/, "workflow route mounts the canvas-free incision controller");
assert.doesNotMatch(route, /incisionRuntime/, "workflow route must not mount the legacy incision runtime beside liveRuntime");
assert.equal((workbench.match(/<LiveStagePanel\b/g) || []).length, 1, "workflow renders one visible live stage");
assert.match(workbench, /workflowActions={<WorkflowCanvasTools\s*\/>}/, "workflow places incision actions in the shared stage header");
assert.match(workbench, /workflowOverlay={<WorkflowCanvasOverlay\s*\/>}/, "workflow keeps only the incision drawing layer over the shared canvas");
assert.match(workbench, /workflowStatus={<WorkflowStageStatus\s*\/>}/, "workflow places incision status in the shared stage header");
assert.match(workbench, /mobileControls={<MobileWorkflowControls\s*\/>}/,
  "workflow mounts one phone-only control dock beside the shared canvas");
assert.match(workbench, /<LiveControlRail[\s\S]*?moveQualityToMobileStage/,
  "workflow moves its existing quality panel to the phone canvas instead of mounting a duplicate badge");
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
assert.match(controller, /function resetWorkflowForSourceChange\([\s\S]*?state\.centerRef = null;[\s\S]*?state\.boundaryRefs = \[\];[\s\S]*?invalidateCandidate\(state[\s\S]*?setSelection\(\{ centerRef: null, boundaryRefs: \[\] \}\)/,
  "a new media revision clears the current lesion, boundary and candidate from the shared canvas");
assert.match(controller, /function resetWorkflowForSourceChange\([\s\S]*?clearWorkflowDraftOverlay\(state\)/,
  "source replacement synchronously removes stale boundary and candidate SVG paths before new landmarks arrive");
assert.match(controller, /revision !== state\.lastSourceRevision[\s\S]*?resetWorkflowForSourceChange\(state, revision\)/,
  "the live-source bridge resets all media-bound incision state when an upload replaces the photo");
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
assert.match(pointerHandler, /if \(mobileMarkerTouch\) \{\s*event\.preventDefault\(\);\s*return;\s*\}[\s\S]*?const sourcePoint = planning\.clientToSource/,
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
    < controlledMarkerHandler.indexOf("workflowSurfaceRefAtSource(state, frame, detection.center"),
  "the detected photo footprint is checked before surface snapping can erase opening information",
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
assert.match(incisionRail, /<CandidateLibraryPanel[\s\S]*?automaticOverlay[\s\S]*?showHandoffStatus={false}[\s\S]*?showDirectionVariants={false}[\s\S]*?showJsonExport={false}[\s\S]*?showSaveAndExportActions={false}[\s\S]*?showCandidateRowActions[\s\S]*?\/>/,
  "workflow hides redundant top-level actions while retaining each record's load and delete controls");
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
assert.match(controller, /function saveReview[\s\S]*?state\.saved = \[\.\.\.state\.saved\.filter\(\(item\) => item\.id !== record\.id\), record\];/,
  "saving the selected review state also persists the reviewed candidate in the library");
assert.match(controller, /candidate:\s*diagnosticCandidateVisible\s*\?\s*null\s*:\s*buildIncisionCandidateSnapshot\(state\.result\)/,
  "a red diagnostic outline is not exposed as a current candidate or counted by candidate actions");
assert.match(controller, /assessDiagnosticReviewAcknowledgement[\s\S]*?diagnostic_review_acknowledged/,
  "red diagnostic review uses the shared note gate and a non-candidate acknowledgement path");
assert.match(reviewControlsPanel, /id="reviewNotes"[\s\S]*?notesAttentionRequired[\s\S]*?aria-invalid/,
  "a missing diagnostic or high-risk review note is highlighted at the nearby notes field");
assert.match(controller, /红色虚线表示候选进入敏感开口，已阻断且不会保存；请调整位置或范围。/,
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
assert.match(canvasTools, /aria-label="切口标注图例"[\s\S]*?病灶中心[\s\S]*?肿物范围[\s\S]*?候选切口[\s\S]*?端点控制/,
  "workflow restores the four-item canvas legend in the shared stage");
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
assert.match(styles, /\.workflow-workbench\.app\s*{[^}]*grid-template-columns:[^}]*}\s*\.workflow-workbench \.stage-top\s*{[^}]*display:\s*grid;/s,
  "the unlayered workflow layout overrides the imported legacy flex header on wide screens");
assert.match(styles, /@media \(min-width:\s*1281px\) and \(max-width:\s*1760px\)\s*{[\s\S]*?\.workflow-workbench \.stage-top\s*{[^}]*display:\s*grid;[^}]*grid-template-areas:[\s\S]*?workflow-actions workflow-actions workflow-actions[\s\S]*?min-height:\s*92px;/,
  "intermediate desktop widths keep the complete tool strip in a second header row instead of clipping actions");
assert.match(styles, /@media \(max-width:\s*1280px\)\s*{[\s\S]*?\.workflow-workbench\.app\s*{[\s\S]*?grid-template-columns:\s*1fr;/, "workflow collapses before its readable three-column minimum can overflow");

assert.match(styles, /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.workflow-workbench\.app\s*\{[^}]*grid-template-rows:\s*auto auto auto;[^}]*overflow-x:\s*hidden;/,
  "phone workflow rows grow with their content instead of overlapping the following control rail");
assert.match(styles, /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.workflow-workbench \.stage-body\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/,
  "phone workflow stage contains its canvas and focus cards instead of spilling over the next section");
assert.match(styles, /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.workflow-workbench \.main-wrap\s*\{[^}]*flex:\s*0 0 clamp\(300px,\s*54dvh,\s*480px\);/,
  "phone workflow keeps the shared face canvas prominent without consuming an unbounded viewport height");
assert.match(styles, /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.workflow-workbench \.zoom-strip\s*\{[^}]*overflow-x:\s*auto;[^}]*scroll-snap-type:\s*x mandatory;/,
  "phone focus previews form a readable horizontal snap rail");
assert.match(styles, /@media \(max-width:\s*560px\) and \(pointer:\s*coarse\) and \(hover:\s*none\)[\s\S]*?\.workflow-tumor-transfer-actions,[\s\S]*?\.workflow-recalculate-action\s*\{[^}]*display:\s*none;/,
  "phone workflow hides tumor transfer and manual recalculation without removing their desktop actions");
assert.match(styles, /@media \(max-width:\s*560px\) and \(pointer:\s*coarse\) and \(hover:\s*none\)[\s\S]*?\.workflow-stage-status\s*\{[^}]*block-size:\s*56px;[^}]*overflow-y:\s*auto;/,
  "phone workflow reserves a stable status row so recognition copy cannot move the face canvas");
assert.match(styles, /--workflow-mobile-zoom-card-size:\s*calc\(\(100vw - 44px\) \/ 3\)[\s\S]*?\.workflow-workbench \.zoom-card\s*\{[^}]*flex:\s*0 0 var\(--workflow-mobile-zoom-card-size\);[^}]*min-width:\s*var\(--workflow-mobile-zoom-card-size\);[^}]*max-width:\s*var\(--workflow-mobile-zoom-card-size\);/,
  "phone focus previews fit three cards inside one viewport while retaining the horizontal rail for later regions");
assert.match(liveQualityPanel, /MOBILE_WORKFLOW_MEDIA_QUERY[\s\S]*?media\.matches \? document\.querySelector\(mobilePortalSelector\) : null/,
  "quality relocation is gated to phone-class coarse-pointer viewports and leaves desktop placement unchanged");
assert.match(styles, /@media \(max-width:\s*560px\) and \(pointer:\s*coarse\) and \(hover:\s*none\)[\s\S]*?\.mobile-workflow-dock\s*\{[^}]*display:\s*grid;/,
  "the compact input and layer dock is exposed only on phone-class coarse pointers");
assert.match(mobileControls, /upload_source[\s\S]*?camera_toggle[\s\S]*?pause_toggle[\s\S]*?recording_toggle/,
  "the mobile dock retains photo, rear-camera, pause and export command paths");
assert.doesNotMatch(mobileControls, /if \(!nextRstl && !nextWrinkles\) return;/,
  "mobile operators may hide RSTL and wrinkles together to inspect the unmodified source image");
assert.match(mobileControls, /setMobileRstlLayerVisible\(rstlVisible\)[\s\S]*?setMobileWrinkleLayerVisible\(wrinklesVisible\)[\s\S]*?setMobileIncisionCandidateVisible\(incisionVisible\)/,
  "all three phone overlay switches have independent display-only visibility gates");
assert.match(styles, /\.workflow-canvas-tools\s*\{[^}]*flex-wrap:\s*wrap;[^}]*width:\s*100%;[^}]*overflow:\s*visible;/,
  "the phone marker toolbar wraps instead of clipping the recognition action outside the viewport");
assert.match(styles, /\.workflow-marker-scan\s*\{[^}]*order:\s*3;[^}]*width:\s*100%;/,
  "the scan-diameter control receives a full-width phone row after the primary marker actions");
assert.match(styles, /\[data-workflow-marker-scan-label\]\s*\{[^}]*display:\s*none;/,
  "the face-obscuring scan-diameter label is hidden only inside the phone media query");
assert.match(mobileControls, /preview_edit", "lengthScale"[\s\S]*?preview_edit", "widthScale"/,
  "mobile margin adjustment changes fusiform length and width together");
assert.match(mobileControls, /min="100"[\s\S]*?max="150"/,
  "mobile margin adjustment only enlarges the tool suggestion within the existing upper bound");
assert.match(controller, /function handleMobileEditCommand[\s\S]*?if \(!mobileWorkflowViewportActive\(\)\) return;/,
  "workflow candidate editing rejects the phone UI event outside the mobile viewport contract");
assert.match(controller, /state\.edit\.angle_offset_deg = Math\.max\(-35,[\s\S]*?state\.edit\.length_scale = Math\.max\(1,[\s\S]*?state\.edit\.width_scale = Math\.max\(1,/,
  "workflow clamps the two mobile-only adjustment dimensions before applying the existing candidate editor");
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
assert.match(controller, /centerCircle\.setAttribute\("r", mobileWorkflowViewportActive\(\) \? "4" : "6"\)/,
  "the lesion center becomes finer only on the phone workflow and keeps the desktop radius");
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
assert.equal(workflowDiagnosticCandidateVisible({
  candidate_display_blocked: true,
  candidate: { hard_violations: [{ code: "candidate_outside_canonical_surface" }] },
} as any, true, 40), false,
"a general face-surface exit never borrows the red style reserved for sensitive openings");
assert.equal(workflowDiagnosticCandidateVisible({
  candidate_display_blocked: true,
  candidate: { hard_violations: [{ code: "candidate_intersects_non_skin_opening" }] },
} as any, true, 40), true,
"an eye, mouth or nostril opening rejection remains available to the red diagnostic renderer");
assert.equal(workflowDiagnosticCandidateVisible({ candidate_display_blocked: true }, true, 40, "left-nostril-opening"), true,
  "a photo-space nostril crossing independently qualifies for the sensitive red diagnostic layer");
assert.equal(workflowDiagnosticCandidateVisible({ candidate_display_blocked: false }, false, 40), false,
  "a generic failed photo projection is withheld instead of being colored as a sensitive-opening diagnosis");
assert.equal(workflowDiagnosticCandidateVisible({ candidate_display_blocked: false }, true, 40), false,
  "a valid candidate never receives the red diagnostic style");
assert.equal(workflowDiagnosticCandidateVisible({ candidate_display_blocked: true }, false, 0), false,
  "the diagnostic layer does not invent geometry when no candidate points exist");
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
assert.match(controller, /geometry\.candidateProjection\.valid\s*\?\s*geometry\.candidate\.length\s*:\s*geometry\.diagnosticCandidate\.length/,
  "diagnostic visibility counts the actual rejected geometry rather than the undersized source fallback");
assert.match(controller, /geometry\?\.candidateProjection\.valid[\s\S]*?geometry\?\.diagnosticCandidate \|\| \[\][\s\S]*?geometry\?\.diagnosticFusiformRendering/,
  "the red path switches to the separate rejected fit whenever photo projection fails");
assert.match(photoPlanning, /const projectionGateReason[\s\S]*?diagnosticFusiformRendering[\s\S]*?"photo_surface_exit"/,
  "the reported failure reason stays tied to the actual rejected outline shown in red");
assert.match(controller, /红色虚线表示候选进入敏感开口，已阻断且不会保存/,
  "the status reserves the red line for a sensitive non-skin opening instead of a general face-surface exit");
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
  boundaryActive: true, clearCenter: true, mayGenerateCandidate: false,
}, "switching into freehand mode invalidates the ellipse center and cannot regenerate the old candidate");
assert.deepEqual(workflowBoundaryModeTransition("freehand", "clear"), {
  boundaryActive: true, clearCenter: true, mayGenerateCandidate: false,
}, "clearing a freehand boundary keeps drawing active while preventing the old ellipse candidate from returning");
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
const verticalEllipseSpan = ellipseSpan(workflowPhotoEllipseBoundary({
  center: { x: 100, y: 80 },
  diameterMm: 14,
  ellipseRatio: 150,
  pixelsPerMm: 2,
}));
assert.ok(Math.abs(verticalEllipseSpan.width - 28) < 1e-9
  && Math.abs(verticalEllipseSpan.height - 42) < 1e-9,
"a ratio above 100 percent makes the vertical reference axis longer without pretending it is a fixed minor axis");

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
