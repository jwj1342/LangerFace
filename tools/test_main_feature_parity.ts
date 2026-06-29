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
const cameraSource = read("src/services/cameraSource.ts");
const skinMaterial = read("src/services/skinMaterial.ts");
const incisionStage = read("src/components/IncisionStagePanel.tsx");
const tumorInput = read("src/components/TumorInputPanel.tsx");
const candidateLibrary = read("src/components/CandidateLibraryPanel.tsx");
const candidateResult = read("src/components/CandidateResultPanel.tsx");
const providerConfig = read("src/components/ProviderConfigPanel.tsx");
const reviewControls = read("src/components/ReviewControlsPanel.tsx");
const incisionRuntime = read("src/services/incisionAgentRuntime.ts");
const incisionWorkflowTools = read("src/services/incisionWorkflowTools.ts");
const annotateStage = read("src/components/AnnotateStagePanel.tsx");
const annotateMeshSource = read("src/components/AnnotateMeshSourcePanel.tsx");
const annotateDraw = read("src/components/AnnotateDrawPanel.tsx");
const annotateLineLibrary = read("src/components/AnnotateLineLibraryPanel.tsx");
const annotateRuntime = read("src/services/annotateRuntime.ts");
const annotateViewer = read("src/services/annotateViewer.ts");
const threePreviewScene = read("src/components/ThreePreviewScene.tsx");
const standardFaceAssets = read("src/services/standardFaceAssets.ts");
const caseRoute = read("src/routes/CaseWorkflowRoute.tsx");
const dataSource = read("src/services/dataSource.ts");
const caseStore = read("src/stores/caseStore.ts");

includesAll(app, [
  'path="/cases"',
  'path="/case/new"',
  'path="/case/:caseId/evaluate"',
  'path="/case/:caseId/plan"',
  'path="/case/:caseId/review"',
  'path="/settings/atlas"',
  'path="/settings/developer"',
  'path="/live"',
  'path="/incision"',
  'path="/annotate"',
  'path="/surgery"',
  'path="/three-preview"',
], "router");

includesAll(settingsRoute, [
  'to="/annotate"',
  'to="/three-preview"',
  'to="/surgery"',
  "ProviderConfigPanel",
  "WorkerStatusPanel",
  "不进入医生的病例规划主流程",
  "不应重新出现在医生主导航",
], "controlled settings entry points");

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
], "live 3D reconstruction controls");

includesAll(liveRuntime, [
  "mountLiveWorkbench",
  "startCamera",
  "upload_source",
  "els.upload.addEventListener",
  "els.file.click",
  "setIncisionOverlayQa",
  "readControllerCommandDetail",
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
  'id="agentCanvas"',
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
  'id="runAgentBtn"',
  'commands.tumor("run_agent")',
], "incision tumor input");

includesAll(candidateResult, [
  'id="candidateType"',
  'id: "candidateLength"',
  'id: "candidateWidth"',
  'id: "candidateTipAngle"',
  'id="llmSummary"',
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

includesAll(providerConfig, [
  'id="providerMode"',
  'value="openai-compatible"',
  'id="providerBaseUrl"',
  'id="providerModel"',
  'id="providerApiKey"',
  'id="testProviderBtn"',
], "OpenAI-compatible provider configuration");

includesAll(reviewControls, [
  'id="reviewerName"',
  'id="reviewDecision"',
  'id="reviewNotes"',
  'id="approveCandidateBtn"',
  'id="rejectCandidateBtn"',
  'id="saveReviewBtn"',
], "doctor review controls");

includesAll(incisionRuntime, [
  "mountIncisionAgentWorkbench",
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
  "runAgent",
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
  'id="btnCloudFit"',
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

includesAll(threePreviewScene, [
  "@react-three/fiber",
  "@react-three/drei",
  "Canvas",
  "OrbitControls",
  "buildLineGeometry",
  "previewScale",
  "preserveDrawingBuffer: true",
], "R3F standard face preview");

includesAll(standardFaceAssets, [
  'getHeadMesh("mediapipe-468"',
  'getHeadMesh("flame-2023"',
  "loadFlameBasisAsset",
  "mediaPipeAtlasToFlamePreviewAtlas",
], "standard face asset loader");

includesAll(caseRoute, [
  "CaseClinicalViewport",
  "ThreePreviewScene",
  "useStandardFaceAssets",
  "showLesionOverlay",
  "showIncisionOverlay",
  "case-hidden-file-input",
  'type="file"',
  "onUploadFiles",
  "mediaAssetSummary",
  "准备 3D 扫描",
  "标记重建完成",
  "模拟肿物",
  "simulateTumorInput",
  "描记皮表边界",
  "traceFreehandBoundary",
  "case-lesion-simulation-status",
  "张力闭合模拟",
  "estimateClosureSimulation",
], "case workflow restored clinical inputs");

includesAll(dataSource, [
  "ClinicalCaseMediaAsset",
  "ClinicalCaseScanReconstruction",
  "normalizeMediaAssets",
  "normalizeScanReconstruction",
  "mediaAssets",
  "scanReconstruction",
], "case persistence model");

includesAll(caseStore, [
  "...draft.acquisition",
  "captureSet",
  "quality",
  "scanReconstruction",
  "...current.acquisition.scanReconstruction",
], "case store nested acquisition merge");

console.log("Main feature parity checks passed.");
