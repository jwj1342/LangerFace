const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function includesAll(source, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(source.includes(fragment), `${label} missing: ${fragment}`);
  }
}

const app = read("src/App.tsx");
const settingsRoute = read("src/routes/SettingsRoute.tsx");
const liveStage = read("src/components/LiveStagePanel.tsx");
const liveSourceControls = read("src/components/LiveSourceControlsPanel.tsx");
const liveRouteControls = read("src/components/LiveRouteControlsPanel.tsx");
const liveControllerBridge = read("src/hooks/useLiveControllerBridge.ts");
const liveDom = read("src/services/liveDom.ts");
const liveRuntime = read("src/services/liveRuntime.ts");
const pipelineSource = read("src/services/pipelineSource.ts");
const controllerCommand = read("src/lib/controllerCommand.ts");
const sharedThree3d = read("src/services/three3d.ts");
const render2d = read("src/services/render2d.ts");
const typedConstants = read("src/services/constants.ts");
const liveState = read("src/services/liveState.ts");
const liveRenderControls = read("src/components/LiveRenderControlsPanel.tsx");
const foreheadVisibility = read("src/services/foreheadVisibility.ts");
const cameraSource = read("src/services/cameraSource.ts");
const skinMaterial = read("src/services/skinMaterial.ts");
const incisionStage = read("src/components/IncisionStagePanel.tsx");
const tumorInput = read("src/components/TumorInputPanel.tsx");
const candidateLibrary = read("src/components/CandidateLibraryPanel.tsx");
const candidateResult = read("src/components/CandidateResultPanel.tsx");
const reviewControls = read("src/components/ReviewControlsPanel.tsx");
const incisionRuntime = read("src/services/incisionRuntime.ts");
const incisionWorkflowTools = read("src/services/incisionWorkflowTools.ts");
const annotateStage = read("src/components/AnnotateStagePanel.tsx");
const annotateMeshSource = read("src/components/AnnotateMeshSourcePanel.tsx");
const annotateDraw = read("src/components/AnnotateDrawPanel.tsx");
const annotateLineLibrary = read("src/components/AnnotateLineLibraryPanel.tsx");
const annotateRuntime = read("src/services/annotateRuntime.ts");
const annotateViewer = read("src/services/annotateViewer.ts");
const standardFaceAssets = read("src/services/standardFaceAssets.ts");
const dashboardRoute = read("src/routes/DashboardRoute.tsx");
const dataSource = read("src/services/dataSource.ts");

includesAll(app, [
  'path="/settings/atlas"',
  'path="/settings/developer"',
  'path="/live"',
  'path="/incision"',
  'path="/annotate"',
  'path="/surgery"',
], "router");
assert.ok(!app.includes('path="/three-preview"'), "router should not expose the public 3D preview route");
assert.ok(!app.includes('path="/app/three-preview"'), "router should not preserve the legacy 3D preview route");

includesAll(settingsRoute, [
  'to="/annotate"',
  'to="/surgery"',
  "WorkerStatusPanel",
  "病例存储",
  "不提供",
  "不保存患者或病例信息",
], "controlled settings entry points");
assert.ok(!settingsRoute.includes('to="/three-preview"'), "developer settings should not expose the public 3D preview entry");
assert.ok(!settingsRoute.includes("ProviderConfigPanel"), "developer settings should not expose remote model configuration");

includesAll(liveStage, [
  'id="video"',
  'id="canvas"',
  'id="overlayMsg"',
  'id="zoomStrip"',
], "live viewport");

includesAll(liveSourceControls, [
  'id="uploadBtn"',
  'id="fileInput"',
  'accept="image/*,video/*"',
  'id="camBtn"',
  'id="pauseBtn"',
  'id="exportBtn"',
  'commands.source("upload_source")',
  'commands.source("camera_toggle")',
], "live acquisition controls");

assert.ok(liveRouteControls.includes("2D 实时贴合"), "Live workbench declares its only supported runtime mode");
assert.ok(!/3D|recon|twin|route_change/.test(liveRouteControls), "Live controls do not retain hidden 3D commands");

includesAll(liveRuntime, [
  "mountLiveWorkbench",
  "startCamera",
  "upload_source",
  "els.upload.addEventListener",
  "els.file.click",
  "setIncisionOverlayQa",
  "readLiveSourceCommand",
], "live runtime bridge");

includesAll(liveControllerBridge, [
  "useLiveControllerBridge",
  "LIVE_SNAPSHOT_SCHEMA_VERSION",
], "live typed snapshot bridge");

includesAll(liveDom, [
  'elementById<HTMLInputElement>(root, "fileInput")',
  "file:",
], "live DOM upload binding");

includesAll(pipelineSource, [
  "handleFile",
  "URL.createObjectURL(file)",
  'file.type.startsWith("image/")',
  'setSource(els.video, "video"',
], "live image/video upload pipeline");

for (const retiredLiveRuntime of ["mode3d.ts", "projection3d.ts", "liveScanLifecycle.ts"]) {
  assert.ok(!fs.existsSync(path.join(process.cwd(), "src/services", retiredLiveRuntime)), `${retiredLiveRuntime} is removed from Live`);
}

includesAll(sharedThree3d, [
  "preserveDrawingBuffer: true",
  "configureSkinRenderer",
  "incisionOverlay",
  "vertexColors",
  "Float32BufferAttribute",
], "shared Three.js viewer visual QA support");

assert.ok(!/load_demo_recon|start_scan|view_3d|project_3d|start_twin/.test(controllerCommand), "Live controller commands exclude retired 3D actions");

includesAll(render2d, [
  "INCISION_ZOOM_REGION",
  "incisionOverlay",
  "renderState",
], "2D render overlay support");

assert.ok(typedConstants.includes('rstl: "#c800c8"'), "live constants must use the v8.1.68 reference magenta");
assert.ok(
  render2d.includes("Math.max(2, W / 1300)"),
  "typed live RSTL strokes must use the two-pixel reference minimum",
);
// #141：modelState.atlases 存的是 lines 数组，写成 atlas?.lines 会恒为 undefined，
// 密度筛选拿到空集后整页一条线都不画。正反向各一条，回退任一侧都会红。
assert.match(
  render2d,
  /lineIndicesForDensity\(\s*displayLines \|\| \[\],\s*renderState\.densityFrac,?\s*\)/,
  "typed live must apply density selection to the displayed atlas line array",
);
assert.doesNotMatch(
  render2d,
  /lineIndicesForDensity\(\s*\w*\?\.lines/,
  "typed live must not treat the atlas line array as an atlas payload",
);
// #141：外推的额头线必须在唯一的 TypeScript 运行时再按头部包络与肤色裁剪。
assert.ok(
  render2d.includes('"forehead_lower_long_arc_v13"') && render2d.includes('"forehead_bridge_arc_v15"'),
  "live renderer must gate the extended forehead regions by name",
);
includesAll(render2d, [
  "buildForeheadSkinVisibility",
  "buildHeadVisibility",
  "stabilizeForeheadMask",
  "headVisible(p) && skinVisible(p)",
], "live v8.1.68 forehead visibility integration");
includesAll(foreheadVisibility, [
  "skinColorMatchesReferences",
  "distance <= 26",
  "achromaticHair",
  "0.54 * faceWidth",
  "0.46 * faceHeight",
  "maxGap",
  "minRun",
  "minVisibleSpan",
  "visibleCount < minVisibleSpan",
], "live hair-aware forehead visibility");
assert.ok(
  !foreheadVisibility.includes("longestRun"),
  "live forehead visibility must preserve every qualifying run instead of selecting one longest run (#145)",
);
assert.ok(liveState.includes("opacity: 0.60"), "typed live RSTL opacity must match the 60% reference");
assert.ok(
  liveRenderControls.includes("render?.opacityPct || 60"),
  "React live opacity control must default to the 60% reference",
);

includesAll(cameraSource, [
  "navigator.mediaDevices.getUserMedia",
  "openCameraStream",
  "describeCameraError",
], "camera source support");

includesAll(skinMaterial, [
  "createSkinMaterial",
  "MeshStandardMaterial",
], "face texture material support");

includesAll(incisionStage, [
  'id="incisionCanvas"',
  "AssetLoadingOverlay",
  "病灶中心",
  "肿物范围",
  "候选切口",
  "端点控制",
], "incision viewport");

includesAll(tumorInput, [
  'id="tumorKind"',
  'id="diameterMm"',
  'id="depthMm"',
  'id="marginMm"',
  'id="boundaryMode"',
  'id="startBoundaryBtn"',
  'id="clearBoundaryBtn"',
  'id="exportTumorBtn"',
  'id="importTumorBtn"',
  'id="tumorImportFile"',
  'id="runWorkflowBtn"',
  'commands.tumor("run_workflow")',
], "incision tumor input");

includesAll(candidateResult, [
  'id="candidateType"',
  'id: "candidateLength"',
  'id: "candidateWidth"',
  'id: "candidateTipAngle"',
  'id="workflowSummary"',
  'id="guardrailDetails"',
], "incision candidate metrics");

includesAll(candidateLibrary, [
  'id="saveCandidateBtn"',
  'id="makeVariantsBtn"',
  'id="exportJsonBtn"',
  'id="exportReportBtn"',
  'id="exportPngBtn"',
  'id="stageLiveOverlayBtn"',
  'commands.library("stage_live_overlay")',
], "incision candidate library and exports");

includesAll(reviewControls, [
  'id="reviewerName"',
  'id="reviewDecision"',
  'id="reviewNotes"',
  'id="saveReviewBtn"',
], "doctor review controls");
assert.ok(!reviewControls.includes('id="approveCandidateBtn"'), "review panel removes duplicate approval button");
assert.ok(!reviewControls.includes('id="rejectCandidateBtn"'), "review panel removes duplicate rejection button");

includesAll(incisionRuntime, [
  "mountIncisionWorkbench",
  "loadMediaPipeIncisionAssets",
  "resolveIncisionAtlas",
  "takePreviewAtlas",
  "planWorkflowForCurrentTumor",
  "stageLiveOverlay",
  "compileIncisionOverlay",
  "exportTumorJson",
  "importTumorFile",
  "exportReviewJson",
  "exportReport",
  "exportScreenshot",
  "summarizeTumorInputQuality",
  "runWorkflow",
], "incision runtime workflow");
assert.ok(!incisionRuntime.includes("loadFlameBasisAsset"), "incision runtime should not load FLAME assets");
assert.ok(!incisionRuntime.includes("mediaPipeAtlasToFlamePreviewAtlas"), "incision runtime should not map RSTL onto FLAME");

includesAll(incisionWorkflowTools, [
  "linear_subcutaneous_incision",
  "fusiform_cutaneous_incision",
  "preview_incision_on_face",
  "summarize_tumor_input_quality",
], "incision deterministic tools");

includesAll(annotateStage, ['id="stage"'], "3D annotation viewport");

includesAll(annotateMeshSource, [
  'id="btnLoadCanonical"',
  'id="btnLoadFlame"',
  'id="btnLoadFittedFlame"',
  'id="meshFile"',
  'id="slicerFile"',
], "3D annotation mesh controls");

includesAll(annotateDraw, [
  'id="annSystem"',
  'id="annName"',
  'id="annRegion"',
  'id="btnNew"',
  'id="btnUndo"',
  'id="btnFinish"',
], "3D annotation drawing controls");

includesAll(annotateLineLibrary, [
  'id="lineList"',
  'id="btnExportAtlas"',
  'id="btnExportXyz"',
  'id="btnSetActiveAtlas"',
  'id="btnClear"',
], "3D annotation export controls");

includesAll(annotateRuntime, [
  "loadBundledFlameStandard",
  "loadCanonical",
  'getHeadMesh("mediapipe-468")',
  'topologyMeta("flame-2023")',
  "loadSlicerFile",
  "export_atlas",
  "set_active_atlas",
], "3D annotation runtime");

includesAll(annotateViewer, [
  "preserveDrawingBuffer: true",
  "configureSkinRenderer",
  "setMesh",
  "raycast",
], "3D annotation viewer visual QA support");

includesAll(standardFaceAssets, [
  'getHeadMesh("mediapipe-468"',
  'getHeadMesh("flame-2023"',
  "loadFlameBasisAsset",
  "mediaPipeAtlasToFlamePreviewAtlas",
], "standard face asset loader");

includesAll(dashboardRoute, [
  'to: "/live"',
  'to: "/personalized"',
  'to: "/incision"',
  "不创建、恢复或保存病例",
  "不维护病例大厅、患者档案、历史记录或云端病例库",
], "stateless tool launcher");
assert.ok(!dashboardRoute.includes('to: "/three-preview"'), "dashboard should not expose the public 3D preview card");

for (const forbidden of [
  "CaseWorkflowRoute",
  'path="/cases"',
  'path="/case/',
]) {
  assert.ok(!app.includes(forbidden), `router should not expose case workflow: ${forbidden}`);
}

for (const forbidden of [
  "ClinicalCase",
  "langerface.cases",
  "saveCase(",
  "listCases(",
  "getCase(",
]) {
  assert.ok(!dataSource.includes(forbidden), `data source should not persist cases: ${forbidden}`);
}

console.log("Main feature parity checks passed.");
