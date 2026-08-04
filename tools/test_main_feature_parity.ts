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
const mode3d = read("src/services/mode3d.ts");
const sharedThree3d = read("src/services/three3d.ts");
const render2d = read("src/services/render2d.ts");
const typedConstants = read("src/services/constants.ts");
const liveState = read("src/services/liveState.ts");
const liveRenderControls = read("src/components/LiveRenderControlsPanel.tsx");
const compatConstants = read("compat/shared/constants.js");
const currentRender = read("current/render.js");
const currentState = read("current/state.js");
const currentHtml = read("current/index.html");
const foreheadVisibility = read("current/forehead_visibility.js");
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
  'id="three"',
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

includesAll(liveRouteControls, [
  'id="routeSel"',
  'id="route3dPanel"',
  'id="reconScanBtn"',
  'commands.route("start_scan")',
  'id="project3dBtn"',
  'commands.route("project_3d")',
  'id="scanPanel"',
  'id="scanProgressVal"',
  'id="scanYawVal"',
  'id="view3dBtn"',
  'id="reset3dBtn"',
  'id="cloudFitFlameBtn"',
  'commands.route("start_twin")',
  'id: "flameStdToggle"',
  'commands.route("toggle_twin_head"',
  'id: "twinTextureToggle"',
  'commands.route("toggle_twin_texture"',
], "retained live 3D compatibility controls");
assert.ok(!liveRouteControls.includes('<option value="3d">'), "live mode selector should not expose the 3D reconstruction mode");

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

includesAll(mode3d, [
  "startScan",
  "finishScan",
  "setMode3d",
  "loadDemoRecon",
  "startTwin",
  "toggleTwinHead",
  "toggleTwinTexture",
  "projectColors",
  "sampleFrameColors",
  "mergeVertexColors",
  "reconState.twinTexture",
], "3D reconstruction runtime");

includesAll(sharedThree3d, [
  "preserveDrawingBuffer: true",
  "configureSkinRenderer",
  "incisionOverlay",
  "vertexColors",
  "Float32BufferAttribute",
], "shared Three.js viewer visual QA support");

includesAll(controllerCommand, [
  '"load_demo_recon"',
  '"start_scan"',
  '"view_3d"',
  '"project_3d"',
  '"reset_3d"',
  '"start_twin"',
  '"toggle_twin_head"',
  '"toggle_twin_texture"',
], "3D reconstruction controller commands");

includesAll(render2d, [
  "INCISION_ZOOM_REGION",
  "incisionOverlay",
  "renderState",
], "2D render overlay support");

for (const [label, source] of [
  ["typed live constants", typedConstants],
  ["shared compatibility constants", compatConstants],
]) {
  assert.ok(source.includes('rstl: "#c800c8"'), `${label} must use the v8.1.67 reference magenta`);
}
assert.ok(
  render2d.includes("Math.max(2, W / 1300)"),
  "typed live RSTL strokes must use the two-pixel reference minimum",
);
// #141：modelState.atlases 存的是 lines 数组，写成 atlas?.lines 会恒为 undefined，
// 密度筛选拿到空集后整页一条线都不画。正反向各一条，回退任一侧都会红。
assert.match(
  render2d,
  /lineIndicesForDensity\(\s*atlasLines \|\| \[\],\s*renderState\.densityFrac,?\s*\)/,
  "typed live must apply density selection to the atlas line array",
);
assert.doesNotMatch(
  render2d,
  /lineIndicesForDensity\(\s*\w*\?\.lines/,
  "typed live must not treat the atlas line array as an atlas payload",
);
// #141：外推的额头线在两套运行时都必须再裁一次，且用同一份 region 集合
for (const [label, source] of [
  ["typed live", render2d],
  ["current live", currentRender],
] as const) {
  assert.ok(
    source.includes('"forehead_lower_long_arc_v13"') && source.includes('"forehead_bridge_arc_v15"'),
    `${label} must gate the extended forehead regions by name`,
  );
  assert.ok(
    /stabilizeForeheadMask\(/.test(source) && /headVisible\(/.test(source) && /skinVisible\(/.test(source),
    `${label} must clip extended forehead arcs by head envelope and skin colour`,
  );
}
assert.ok(
  currentRender.includes("Math.max(2, W / 1300)"),
  "current live RSTL strokes must use the two-pixel reference minimum",
);
assert.ok(
  currentRender.includes('"forehead_bridge_arc_v15"'),
  "current live must not clip v8.1.67 bridge arcs to the MediaPipe face oval",
);
includesAll(currentRender, [
  "buildForeheadSkinVisibility",
  "buildHeadVisibility",
  "stabilizeForeheadMask",
  "headVisible(p) && skinVisible(p)",
], "current live v8.1.67 forehead visibility integration");
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
], "current live hair-aware forehead visibility");
assert.ok(
  !foreheadVisibility.includes("longestRun"),
  "current live forehead visibility must preserve every qualifying run instead of selecting one longest run (#145)",
);
assert.ok(liveState.includes("opacity: 0.60"), "typed live RSTL opacity must match the 60% reference");
assert.ok(currentState.includes("opacity: 0.60"), "current live RSTL opacity must match the 60% reference");
includesAll(currentHtml, ['id="opacityVal">60%</span>', 'id="opacity" min="25" max="100" value="60"'], "current live reference opacity controls");
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
  'id="approveCandidateBtn"',
  'id="rejectCandidateBtn"',
  'id="saveReviewBtn"',
], "doctor review controls");

includesAll(incisionRuntime, [
  "mountIncisionWorkbench",
  "loadFlameBasisAsset",
  "mediaPipeAtlasToFlamePreviewAtlas",
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
  'href: "/personalized"',
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
