import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");

const read = (rel) => fs.readFileSync(path.join(web, rel), "utf8");
const pkg = JSON.parse(read("package.json"));
const tsconfig = JSON.parse(read("tsconfig.json"));
const appHtml = read("app/index.html");
const vite = read("vite.config.js");
const vercel = read("vercel.json");
const app = read("src/App.tsx");
const typedStore = read("src/stores/appStore.ts");
const annotateStore = read("src/stores/annotateStore.ts");
const annotateBridge = read("src/hooks/useAnnotateControllerBridge.ts");
const annotateStatePanel = read("src/components/AnnotateStatePanel.tsx");
const annotateMeshSourcePanel = read("src/components/AnnotateMeshSourcePanel.tsx");
const annotateDrawPanel = read("src/components/AnnotateDrawPanel.tsx");
const annotateLineLibraryPanel = read("src/components/AnnotateLineLibraryPanel.tsx");
const incisionStore = read("src/stores/incisionStore.ts");
const incisionBridge = read("src/hooks/useIncisionControllerBridge.ts");
const incisionStatePanel = read("src/components/IncisionStatePanel.tsx");
const incisionStagePanel = read("src/components/IncisionStagePanel.tsx");
const tumorPanel = read("src/components/TumorInputPanel.tsx");
const secondaryCuePanel = read("src/components/SecondaryCuePanel.tsx");
const candidateResultPanel = read("src/components/CandidateResultPanel.tsx");
const candidateLibraryPanel = read("src/components/CandidateLibraryPanel.tsx");
const privacyAuditPanel = read("src/components/PrivacyAuditPanel.tsx");
const providerPanel = read("src/components/ProviderConfigPanel.tsx");
const editPanel = read("src/components/EditControlsPanel.tsx");
const reviewPanel = read("src/components/ReviewControlsPanel.tsx");
const liveStore = read("src/stores/liveStore.ts");
const liveBridge = read("src/hooks/useLiveControllerBridge.ts");
const liveStatePanel = read("src/components/LiveStatePanel.tsx");
const liveRouteControlsPanel = read("src/components/LiveRouteControlsPanel.tsx");
const liveSourceControlsPanel = read("src/components/LiveSourceControlsPanel.tsx");
const liveRenderControlsPanel = read("src/components/LiveRenderControlsPanel.tsx");
const annotateRoute = read("src/routes/AnnotateRoute.tsx");
const annotateWorkbench = read("src/routes/AnnotateWorkbench.tsx");
const incisionRoute = read("src/routes/IncisionRoute.tsx");
const incisionWorkbench = read("src/routes/IncisionWorkbench.tsx");
const liveRoute = read("src/routes/LiveRoute.tsx");
const liveWorkbench = read("src/routes/LiveWorkbench.tsx");
const surgeryRoute = read("src/routes/SurgeryRoute.tsx");
const surgeryR3FScene = read("src/routes/SurgeryR3FScene.tsx");
const surgeryWorkbench = read("src/routes/SurgeryWorkbench.tsx");
const threeRoute = read("src/routes/ThreePreviewRoute.tsx");
const worker = read("src/workers/workflow.worker.ts");
const workerClient = read("src/services/workflowWorkerClient.ts");
const workerPanel = read("src/components/WorkerStatusPanel.tsx");
const annotateController = read("annotate_main.js");
const annotateViewer = read("annotate_viewer.js");
const controller = read("incision_agent_main.js");
const dom = read("dom.js");
const liveController = read("main.js");
const surgeryController = read("surgery_main.js");

for (const dep of [
  "react",
  "react-dom",
  "react-router-dom",
  "zustand",
  "@react-three/fiber",
  "@react-three/drei",
  "comlink",
  "@radix-ui/react-slot",
  "tailwind-merge",
]) {
  assert.ok(pkg.dependencies?.[dep], `React architecture dependency ${dep} should be installed`);
}
assert.ok(pkg.devDependencies?.typescript, "TypeScript should be installed");
assert.ok(pkg.devDependencies?.["@types/react"], "React TypeScript types should be installed");
assert.ok(pkg.scripts?.typecheck?.includes("tsc --noEmit"), "package should expose a TypeScript typecheck script");
assert.ok(pkg.devDependencies?.tailwindcss, "Tailwind should be installed for React UI workbench styling");
assert.ok(pkg.devDependencies?.["@tailwindcss/vite"], "Tailwind Vite plugin should be installed");

assert.ok(appHtml.includes('id="root"'), "React app HTML exposes a root mount node");
assert.ok(appHtml.includes("../src/main.tsx"), "React app HTML loads the TypeScript React entrypoint");
assert.ok(tsconfig.compilerOptions?.strict, "TypeScript should run in strict mode");
assert.equal(tsconfig.compilerOptions?.jsx, "react-jsx", "TypeScript should use the React JSX transform");
assert.ok(vite.includes("@tailwindcss/vite"), "Vite config loads the Tailwind plugin");
assert.ok(vite.includes('app: resolve(import.meta.dirname, "app/index.html")'), "Vite builds the SPA app entry");
assert.ok(vercel.includes('"source": "/app/(.*)"'), "Vercel rewrites nested SPA routes");
assert.ok(vercel.includes('"destination": "/app/index.html"'), "Vercel routes SPA paths back to app/index.html");

assert.ok(app.includes("react-router-dom"), "React app is routed through React Router");
assert.ok(app.includes('path="/annotate"'), "React Router exposes the 3D annotation route");
assert.ok(app.includes('path="/incision"'), "React Router exposes the incision workbench route");
assert.ok(app.includes('path="/live"'), "React Router exposes the live workbench route");
assert.ok(app.includes('path="/surgery"'), "React Router exposes the surgery closure route");
assert.ok(app.includes('path="/three-preview"'), "React Router exposes the R3F preview route");
assert.ok(typedStore.includes("React/Zustand stores low-frequency UI"), "Zustand store documents low-frequency state ownership");
assert.ok(typedStore.includes("per-frame arrays stay outside persisted stores"), "Zustand store forbids high-frequency renderer arrays");
assert.ok(typedStore.includes("interface AppState"), "Zustand store is typed");
assert.ok(annotateStore.includes("AnnotateControllerSnapshot"), "annotation Zustand store keeps typed controller snapshots");
assert.ok(annotateStore.includes("ANNOTATE_CONTROLLER_STATE_EVENT"), "annotation Zustand store declares the controller bridge event");
assert.ok(annotateStore.includes("No Three.js objects"), "annotation store documents renderer object exclusion");
assert.ok(!annotateStore.includes("THREE."), "annotation store must not hold Three.js objects");
assert.ok(!annotateStore.includes("verts:"), "annotation store must not hold mesh vertex arrays");
assert.ok(!annotateStore.includes("tris:"), "annotation store must not hold triangle arrays");
assert.ok(!annotateStore.includes("camera:"), "annotation store must not hold Three.js cameras");
assert.ok(annotateBridge.includes("window.addEventListener(ANNOTATE_CONTROLLER_STATE_EVENT"), "React annotation hook listens for controller state events");
assert.ok(annotateStatePanel.includes("useAnnotateStore"), "React annotation UI reads low-frequency state from Zustand");
assert.ok(liveStore.includes("LiveControllerSnapshot"), "live Zustand store keeps typed controller snapshots");
assert.ok(liveStore.includes("LIVE_CONTROLLER_STATE_EVENT"), "live Zustand store declares the controller bridge event");
assert.ok(liveStore.includes("No MediaPipe task instances"), "live store documents MediaPipe object exclusion");
assert.ok(!liveStore.includes("THREE."), "live store must not hold Three.js objects");
assert.ok(!liveStore.includes("landmarks:"), "live store must not hold per-frame landmarks");
assert.ok(!liveStore.includes("verts:"), "live store must not hold mesh vertex arrays");
assert.ok(!liveStore.includes("tris:"), "live store must not hold triangle arrays");
assert.ok(!liveStore.includes("fps:"), "live store must not hold frame counters");
assert.ok(liveBridge.includes("window.addEventListener(LIVE_CONTROLLER_STATE_EVENT"), "React live hook listens for controller state events");
assert.ok(liveStatePanel.includes("useLiveStore"), "React live UI reads low-frequency state from Zustand");
assert.ok(incisionStore.includes("IncisionControllerSnapshot"), "incision Zustand store keeps typed controller snapshots");
assert.ok(incisionStore.includes("INCISION_CONTROLLER_STATE_EVENT"), "incision Zustand store declares the controller bridge event");
assert.ok(incisionStore.includes("No Three.js objects"), "incision store documents renderer object exclusion");
assert.ok(!incisionStore.includes("THREE."), "incision store must not hold Three.js objects");
assert.ok(!incisionStore.includes("verts:"), "incision store must not hold mesh vertex arrays");
assert.ok(!incisionStore.includes("tris:"), "incision store must not hold triangle arrays");
assert.ok(incisionBridge.includes("window.addEventListener(INCISION_CONTROLLER_STATE_EVENT"), "React hook listens for controller state events");
assert.ok(incisionRoute.includes("useIncisionControllerBridge"), "incision route mounts the Zustand/controller bridge");
assert.ok(incisionStatePanel.includes("useIncisionStore"), "React incision UI reads low-frequency state from Zustand");

assert.ok(incisionRoute.includes("__LANGERFACE_REACT_MANAGED__"), "React incision route disables controller auto-mount");
assert.ok(incisionRoute.includes("mountIncisionAgentWorkbench"), "React incision route mounts the existing controller explicitly");
assert.ok(incisionRoute.includes("disposeIncisionAgentWorkbench"), "React incision route can dispose the existing controller");
assert.ok(incisionRoute.includes("<IncisionWorkbench />"), "React incision route renders the workbench as TSX");
assert.ok(!incisionRoute.includes("DOMParser"), "React incision route should not parse legacy HTML");
assert.ok(!incisionRoute.includes("innerHTML"), "React incision route should not inject legacy HTML");
assert.ok(!incisionRoute.includes("incision_agent.html"), "React incision route should not fetch the legacy workbench HTML");
for (const id of [
  "agentCanvas",
  "stageStatus",
  "assetLoading",
  "assetLoadingText",
]) {
  assert.ok(incisionStagePanel.includes(`id="${id}"`), `React incision stage exposes #${id}`);
}
assert.ok(incisionStore.includes("IncisionAssetLoadingState"), "incision Zustand store keeps typed asset loading state");
assert.ok(incisionWorkbench.includes("IncisionStagePanel"), "React incision workbench renders the stage as a React component");
assert.ok(incisionStagePanel.includes("useIncisionStore"), "React incision stage reads low-frequency stage and asset loading state from Zustand");
for (const id of [
  "tumorKind",
  "diameterMm",
  "tumorAuthor",
  "depthMm",
  "marginMm",
  "boundaryMode",
  "ellipseRatio",
  "startBoundaryBtn",
  "clearBoundaryBtn",
  "exportTumorBtn",
  "importTumorBtn",
  "tumorImportFile",
  "runAgentBtn",
  "boundaryStatus",
  "pickState",
  "anatomyPreview",
]) {
  assert.ok(tumorPanel.includes(`id="${id}"`), `React tumor panel exposes #${id}`);
}
assert.ok(incisionWorkbench.includes("TumorInputPanel"), "React incision workbench renders the tumor input controls as a React component");
assert.ok(tumorPanel.includes("TUMOR_REACT_COMMAND_EVENT"), "React tumor panel dispatches tumor commands to the controller boundary");
assert.ok(tumorPanel.includes("useIncisionStore"), "React tumor panel syncs low-frequency tumor status from Zustand");
for (const id of [
  "secondaryCueState",
  "secondaryCueSummary",
  "importSecondaryCueBtn",
  "clearSecondaryCueBtn",
  "secondaryCueImportFile",
  "secondaryCueConfirmed",
]) {
  assert.ok(secondaryCuePanel.includes(`id="${id}"`), `React secondary cue panel exposes #${id}`);
}
assert.ok(incisionStore.includes("IncisionSecondaryCueState"), "incision Zustand store keeps typed secondary cue state");
assert.ok(incisionWorkbench.includes("SecondaryCuePanel"), "React incision workbench renders the secondary cue controls as a React component");
assert.ok(secondaryCuePanel.includes("SECONDARY_CUE_REACT_COMMAND_EVENT"), "React secondary cue panel dispatches cue commands to the controller boundary");
assert.ok(secondaryCuePanel.includes("useIncisionStore"), "React secondary cue panel syncs low-frequency cue state from Zustand");
for (const id of [
  "candidateType",
  "candidateLength",
  "candidateWidth",
  "candidateTipAngle",
  "directionConf",
  "regionVal",
  "guardrailVal",
  "llmSummary",
  "directionSource",
  "agentGate",
  "agentComparison",
  "nextStep",
  "guardrailDetails",
]) {
  assert.ok(candidateResultPanel.includes(`id="${id}"`), `React candidate result panel exposes #${id}`);
}
assert.ok(incisionStore.includes("IncisionResultViewState"), "incision Zustand store keeps typed candidate result view state");
assert.ok(incisionWorkbench.includes("CandidateResultPanel"), "React incision workbench renders the candidate result as a React component");
assert.ok(candidateResultPanel.includes("useIncisionStore"), "React candidate result panel reads low-frequency result view state from Zustand");
for (const id of [
  "savedCount",
  "saveCandidateBtn",
  "makeVariantsBtn",
  "clearSavedBtn",
  "exportJsonBtn",
  "exportReportBtn",
  "exportPngBtn",
  "stageLiveOverlayBtn",
  "candidateList",
]) {
  assert.ok(candidateLibraryPanel.includes(`id="${id}"`), `React candidate library panel exposes #${id}`);
}
assert.ok(incisionStore.includes("IncisionSavedCandidateSummary"), "incision Zustand store keeps typed saved candidate summaries");
assert.ok(incisionWorkbench.includes("CandidateLibraryPanel"), "React incision workbench renders the candidate library as a React component");
assert.ok(candidateLibraryPanel.includes("LIBRARY_REACT_COMMAND_EVENT"), "React candidate library dispatches library commands to the controller boundary");
assert.ok(candidateLibraryPanel.includes("useIncisionStore"), "React candidate library reads saved candidate summaries from Zustand");
for (const id of [
  "privacyState",
  "privacyAudit",
]) {
  assert.ok(privacyAuditPanel.includes(`id="${id}"`), `React privacy audit panel exposes #${id}`);
}
assert.ok(incisionStore.includes("IncisionPrivacyAuditState"), "incision Zustand store keeps typed privacy audit state");
assert.ok(incisionWorkbench.includes("PrivacyAuditPanel"), "React incision workbench renders the privacy audit panel as a React component");
assert.ok(privacyAuditPanel.includes("useIncisionStore"), "React privacy audit panel reads low-frequency audit state from Zustand");
for (const id of [
  "providerMode",
  "providerBaseUrl",
  "providerModel",
  "providerApiKey",
  "providerTimeout",
  "testProviderBtn",
  "providerTestState",
]) {
  assert.ok(providerPanel.includes(`id="${id}"`), `React provider panel exposes #${id}`);
}
assert.ok(incisionWorkbench.includes("ProviderConfigPanel"), "React incision workbench renders the provider panel as a React component");
assert.ok(providerPanel.includes("testProviderConnection"), "React provider panel owns the browser-side Provider connectivity test");
assert.ok(providerPanel.includes("normalizeProviderBaseUrl"), "React provider panel normalizes provider Base URL");
assert.ok(providerPanel.includes("PROVIDER_REACT_STATE_EVENT"), "React provider panel notifies the legacy controller to republish snapshots");
for (const id of [
  "editStatus",
  "angleOffsetDeg",
  "angleOffsetVal",
  "lengthScale",
  "lengthScaleVal",
  "widthScaleWrap",
  "widthScale",
  "widthScaleVal",
  "shiftAlongMm",
  "shiftAlongVal",
  "shiftPerpMm",
  "shiftPerpVal",
  "editReason",
  "undoEditBtn",
  "redoEditBtn",
  "resetEditBtn",
  "editHistoryState",
]) {
  assert.ok(editPanel.includes(`id="${id}"`), `React edit panel exposes #${id}`);
}
assert.ok(incisionStore.includes("IncisionEditState"), "incision Zustand store keeps typed edit state");
assert.ok(incisionWorkbench.includes("EditControlsPanel"), "React incision workbench renders the edit controls as a React component");
assert.ok(editPanel.includes("EDIT_REACT_COMMAND_EVENT"), "React edit panel dispatches edit commands to the controller boundary");
assert.ok(editPanel.includes("useIncisionStore"), "React edit panel syncs low-frequency edit state from Zustand");
for (const id of [
  "reviewState",
  "reviewerName",
  "reviewDecision",
  "reviewNotes",
  "approveCandidateBtn",
  "rejectCandidateBtn",
  "saveReviewBtn",
]) {
  assert.ok(reviewPanel.includes(`id="${id}"`), `React review panel exposes #${id}`);
}
assert.ok(incisionWorkbench.includes("ReviewControlsPanel"), "React incision workbench renders the review controls as a React component");
assert.ok(reviewPanel.includes("REVIEW_REACT_COMMAND_EVENT"), "React review panel dispatches review commands to the controller boundary");
assert.ok(reviewPanel.includes("useIncisionStore"), "React review panel syncs low-frequency review state from Zustand");
assert.ok(incisionWorkbench.includes('to="/live"'), "React incision workbench returns to the React live route");
assert.ok(incisionStagePanel.includes('to="/annotate"'), "React incision stage links to the React 3D annotation route");
assert.ok(controller.includes("export function mountIncisionAgentWorkbench"), "incision controller exposes a mount lifecycle");
assert.ok(controller.includes("export function disposeIncisionAgentWorkbench"), "incision controller exposes a dispose lifecycle");
assert.ok(controller.includes("INCISION_TUMOR_REACT_COMMAND_EVENT"), "incision controller listens for React tumor input commands");
assert.ok(controller.includes("handleReactTumorCommand"), "incision controller routes React tumor commands to existing tumor workflow functions");
assert.ok(controller.includes("INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT"), "incision controller listens for React secondary cue commands");
assert.ok(controller.includes("handleReactSecondaryCueCommand"), "incision controller routes React secondary cue commands to existing cue workflow functions");
assert.ok(controller.includes("currentResultViewSnapshot"), "incision controller publishes candidate result view state for React rendering");
assert.ok(controller.includes("currentSavedCandidateSummaries"), "incision controller publishes saved candidate summaries for React rendering");
assert.ok(controller.includes("currentPrivacyAuditSnapshot"), "incision controller publishes privacy audit state for React rendering");
assert.ok(controller.includes('publishIncisionState("privacy_preflight_failed")'), "privacy preflight failures republish React audit state");
assert.ok(controller.includes("currentAssetLoadingSnapshot"), "incision controller publishes asset loading state for React rendering");
assert.ok(controller.includes('publishIncisionState("asset_loading")'), "asset loading progress republishes React stage state");
assert.ok(controller.includes('publishIncisionState("asset_loaded")'), "asset load completion republishes React stage state");
assert.ok(controller.includes('publishIncisionState("asset_load_failed")'), "asset load failures republish React stage state");
assert.ok(controller.includes("INCISION_PROVIDER_REACT_STATE_EVENT"), "incision controller listens for React provider state changes");
assert.ok(controller.includes("INCISION_REVIEW_REACT_COMMAND_EVENT"), "incision controller listens for React review commands");
assert.ok(controller.includes("handleReactReviewCommand"), "incision controller routes React review commands to existing review workflow functions");
assert.ok(controller.includes("INCISION_EDIT_REACT_COMMAND_EVENT"), "incision controller listens for React edit commands");
assert.ok(controller.includes("handleReactEditCommand"), "incision controller routes React edit commands to existing edit workflow functions");
assert.ok(controller.includes("INCISION_LIBRARY_REACT_COMMAND_EVENT"), "incision controller listens for React candidate library commands");
assert.ok(controller.includes("handleReactLibraryCommand"), "incision controller routes React library commands to existing save/export workflow functions");
assert.ok(controller.includes("window.__LANGERFACE_REACT_MANAGED__"), "incision controller can branch between React and legacy provider handling");
assert.ok(controller.includes("els.tumorKind.onchange"), "legacy incision HTML still owns direct tumor input handlers");
assert.ok(controller.includes("els.importSecondaryCue.onclick"), "legacy incision HTML still owns direct secondary cue handlers");
assert.ok(controller.includes("el.oninput = applyEditControls"), "legacy incision HTML still owns direct edit preview handlers");
assert.ok(controller.includes("els.testProvider.onclick = testProviderEndpoint"), "legacy incision HTML still owns provider connectivity testing");
assert.ok(controller.includes("els.approveCandidate.onclick"), "legacy incision HTML still owns direct review action handlers");
assert.ok(controller.includes("els.saveCandidate.onclick"), "legacy incision HTML still owns direct candidate library handlers");
assert.ok(controller.includes("cancelAnimationFrame"), "incision controller cancels its render loop on dispose");
assert.ok(controller.includes("S.resizeObserver?.disconnect"), "incision controller disconnects ResizeObserver on dispose");
assert.ok(controller.includes("S.head?.dispose"), "incision controller disposes WebGL resources on dispose");

assert.ok(threeRoute.includes("@react-three/fiber"), "R3F preview uses @react-three/fiber");
assert.ok(threeRoute.includes("@react-three/drei"), "R3F preview uses drei helpers");
assert.ok(threeRoute.includes("OrbitControls"), "R3F preview uses drei OrbitControls");
assert.ok(threeRoute.includes("loadJsonAsset"), "R3F preview lazy-loads runtime assets");
assert.ok(worker.includes("Comlink.expose"), "workflow worker exposes its API through Comlink");
assert.ok(worker.includes("summarizeTumorInputQuality"), "workflow worker can run deterministic browser tools");
assert.ok(worker.includes("planIncisionWorkflow"), "workflow worker can run deterministic incision planning");
assert.ok(worker.includes("planIncision(request"), "workflow worker exposes incision planning through its API");
assert.ok(worker.includes("handles_high_frequency_render_state: false"), "workflow worker explicitly avoids high-frequency renderer state");
assert.ok(workerClient.includes("Comlink.wrap"), "React app wraps the workflow worker with Comlink");
assert.ok(workerClient.includes("new Worker(new URL"), "workflow worker is loaded through Vite worker URL handling");
assert.ok(workerClient.includes("worker.terminate"), "workflow worker client has an explicit dispose lifecycle");
assert.ok(workerPanel.includes("createWorkflowWorkerClient"), "React dashboard probes the worker boundary");
assert.ok(controller.includes("createWorkflowWorkerClient"), "incision controller uses the Comlink workflow worker client");
assert.ok(controller.includes("worker.api.planIncision"), "incision candidate generation is delegated to the workflow worker");
assert.ok(controller.includes("main_thread_fallback"), "incision controller keeps a deterministic fallback if worker startup fails");
assert.ok(controller.includes("S.workflowWorker?.dispose"), "incision controller disposes the workflow worker on route teardown");
assert.ok(controller.includes("react-incision-controller-snapshot/v0.1"), "incision controller publishes typed low-frequency snapshots to React");
assert.ok(controller.includes("CustomEvent(INCISION_CONTROLLER_STATE_EVENT"), "incision controller emits state snapshots through a browser event");
assert.ok(annotateRoute.includes("__LANGERFACE_REACT_MANAGED__"), "React annotate route disables controller auto-mount");
assert.ok(annotateRoute.includes("useAnnotateControllerBridge"), "annotation route mounts the Zustand/controller bridge");
assert.ok(annotateRoute.includes("mountAnnotateWorkbench"), "React annotate route mounts the annotation controller explicitly");
assert.ok(annotateRoute.includes("disposeAnnotateWorkbench"), "React annotate route can dispose the annotation controller");
assert.ok(annotateRoute.includes("<AnnotateWorkbench />"), "React annotate route renders the annotation UI as TSX");
assert.ok(!annotateRoute.includes("DOMParser"), "React annotate route should not parse legacy HTML");
assert.ok(!annotateRoute.includes("innerHTML"), "React annotate route should not inject legacy HTML");
for (const id of [
  "stage",
]) {
  assert.ok(annotateWorkbench.includes(`id="${id}"`), `React annotate workbench exposes #${id}`);
}
assert.ok(annotateWorkbench.includes("AnnotateStatePanel"), "React annotate workbench renders the controller state panel");
for (const id of [
  "hint",
  "btnLoadCanonical",
  "btnLoadFlame",
  "btnLoadFittedFlame",
  "btnCloudFit",
  "meshFile",
  "resampleSpacing",
  "slicerFile",
]) {
  assert.ok(annotateMeshSourcePanel.includes(`id="${id}"`), `React annotate mesh source panel exposes #${id}`);
}
for (const id of [
  "drawMode",
  "annSystem",
  "annName",
  "annRegion",
  "currentState",
  "btnNew",
  "btnUndo",
  "btnFinish",
]) {
  assert.ok(annotateDrawPanel.includes(`id="${id}"`), `React annotate draw panel exposes #${id}`);
}
assert.ok(annotateStore.includes("AnnotateMeshActionsState"), "annotation Zustand store keeps typed mesh source action state");
assert.ok(annotateWorkbench.includes("AnnotateMeshSourcePanel"), "React annotate workbench renders the mesh source panel as a React component");
assert.ok(annotateWorkbench.includes("AnnotateDrawPanel"), "React annotate workbench renders the current-line draw panel as a React component");
assert.ok(annotateMeshSourcePanel.includes("ANNOTATE_MESH_REACT_COMMAND_EVENT"), "React annotate mesh source panel dispatches mesh commands to the controller boundary");
assert.ok(annotateDrawPanel.includes("ANNOTATE_DRAW_REACT_COMMAND_EVENT"), "React annotate draw panel dispatches current-line commands to the controller boundary");
assert.ok(annotateMeshSourcePanel.includes("useAnnotateStore"), "React annotate mesh source panel reads low-frequency mesh state from Zustand");
assert.ok(annotateDrawPanel.includes("useAnnotateStore"), "React annotate draw panel reads low-frequency draft state from Zustand");
for (const id of [
  "annStatus",
  "lineList",
  "btnExportAtlas",
  "btnExportXyz",
  "btnSetActiveAtlas",
  "btnClear",
]) {
  assert.ok(annotateLineLibraryPanel.includes(`id="${id}"`), `React annotate line library exposes #${id}`);
}
assert.ok(annotateStore.includes("AnnotateSavedLineSummary"), "annotation Zustand store keeps typed saved line summaries");
assert.ok(annotateWorkbench.includes("AnnotateLineLibraryPanel"), "React annotate workbench renders the saved line library as a React component");
assert.ok(annotateLineLibraryPanel.includes("ANNOTATE_LIBRARY_REACT_COMMAND_EVENT"), "React annotate line library dispatches saved line commands to the controller boundary");
assert.ok(annotateLineLibraryPanel.includes("useAnnotateStore"), "React annotate line library reads saved line state from Zustand");
assert.ok(annotateMeshSourcePanel.includes('to="/surgery"'), "React annotation mesh source panel links to the React surgery closure route");
assert.ok(annotateMeshSourcePanel.includes('to="/live"'), "React annotation mesh source panel returns to the React live route");
assert.ok(annotateController.includes("export function mountAnnotateWorkbench"), "annotation controller exposes a mount lifecycle");
assert.ok(annotateController.includes("export function disposeAnnotateWorkbench"), "annotation controller exposes a dispose lifecycle");
assert.ok(annotateController.includes("ANNOTATE_CONTROLLER_STATE_EVENT"), "annotation controller declares a React state bridge event");
assert.ok(annotateController.includes("ANNOTATE_MESH_REACT_COMMAND_EVENT"), "annotation controller declares a React mesh source command bridge event");
assert.ok(annotateController.includes("ANNOTATE_DRAW_REACT_COMMAND_EVENT"), "annotation controller declares a React current-line command bridge event");
assert.ok(annotateController.includes("ANNOTATE_LIBRARY_REACT_COMMAND_EVENT"), "annotation controller declares a React saved line command bridge event");
assert.ok(annotateController.includes("handleReactMeshCommand"), "annotation controller routes React mesh source commands to existing workflow functions");
assert.ok(annotateController.includes("handleReactDrawCommand"), "annotation controller routes React current-line commands to existing workflow functions");
assert.ok(annotateController.includes("handleReactLineLibraryCommand"), "annotation controller routes React saved line commands to existing workflow functions");
assert.ok(annotateController.includes("renderLegacyLineList"), "annotation controller keeps legacy saved line DOM rendering isolated");
assert.ok(annotateController.includes("!window.__LANGERFACE_REACT_MANAGED__"), "legacy annotation HTML still owns direct saved line handlers outside React");
assert.ok(annotateController.includes("react-annotate-controller-snapshot/v0.1"), "annotation controller publishes a typed React snapshot");
assert.ok(annotateController.includes("CustomEvent(ANNOTATE_CONTROLLER_STATE_EVENT"), "annotation controller emits state snapshots through a browser event");
assert.ok(annotateController.includes("cancelAnimationFrame"), "annotation controller cancels its render loop on dispose");
assert.ok(annotateController.includes("abortController?.abort"), "annotation controller aborts DOM listeners on dispose");
assert.ok(annotateController.includes("activeSession"), "annotation controller guards async loaders across SPA unmounts");
assert.ok(annotateController.includes('"/app/live"'), "annotation preview jumps back to the React live route when managed by React");
assert.ok(annotateController.includes("!window.__LANGERFACE_REACT_MANAGED__"), "legacy annotation HTML still auto-mounts outside React");
assert.ok(annotateViewer.includes("dispose()"), "annotation viewer exposes a WebGL dispose lifecycle");
assert.ok(liveRoute.includes("__LANGERFACE_REACT_MANAGED__"), "React live route disables controller auto-mount");
assert.ok(liveRoute.includes("useLiveControllerBridge"), "live route mounts the Zustand/controller bridge");
assert.ok(liveRoute.includes("mountLiveWorkbench"), "React live route mounts the live controller explicitly");
assert.ok(liveRoute.includes("disposeLiveWorkbench"), "React live route can dispose the live controller");
assert.ok(liveRoute.includes("<LiveWorkbench />"), "React live route renders the live UI as TSX");
assert.ok(!liveRoute.includes("DOMParser"), "React live route should not parse legacy HTML");
assert.ok(!liveRoute.includes("innerHTML"), "React live route should not inject legacy HTML");
for (const id of [
  "canvas",
  "video",
  "modelBadge",
  "overlayMsg",
]) {
  assert.ok(liveWorkbench.includes(`id="${id}"`), `React live workbench exposes #${id}`);
}
for (const id of [
  "routeSel",
  "routeModeHint",
  "route3dPanel",
  "reconDemoBtn",
  "reconScanBtn",
  "reconStatus",
  "scanPanel",
  "scanProgressVal",
  "scanProgressBar",
  "scanYawVal",
  "view3dBtn",
  "project3dBtn",
  "reset3dBtn",
  "cloudFitFlameBtn",
  "flameHeadToggleWrap",
  "flameStdToggle",
  "twinTextureWrap",
  "twinTextureToggle",
  "threeDWorkflowCard",
]) {
  assert.ok(liveRouteControlsPanel.includes(`id="${id}"`), `React live route controls expose #${id}`);
}
for (const id of [
  "uploadBtn",
  "fileInput",
  "camBtn",
  "pauseBtn",
  "exportBtn",
]) {
  assert.ok(liveSourceControlsPanel.includes(`id="${id}"`), `React live source controls expose #${id}`);
}
for (const id of [
  "templateSel",
  "atlasProvenance",
  "restoreAtlasBtn",
  "density",
  "densityVal",
  "smooth",
  "smoothVal",
  "opacity",
  "opacityVal",
  "clip",
  "handOcc",
  "mirror",
  "bands",
  "zoom",
  "meshPts",
]) {
  assert.ok(liveRenderControlsPanel.includes(`id="${id}"`), `React live render controls expose #${id}`);
}
assert.ok(liveWorkbench.includes("LiveStatePanel"), "React live workbench renders the controller state panel");
assert.ok(liveWorkbench.includes("LiveRouteControlsPanel"), "React live workbench renders route controls as a React component");
assert.ok(liveWorkbench.includes("LiveSourceControlsPanel"), "React live workbench renders source controls as a React component");
assert.ok(liveWorkbench.includes("LiveRenderControlsPanel"), "React live workbench renders render controls as a React component");
assert.ok(liveRouteControlsPanel.includes("LIVE_ROUTE_REACT_COMMAND_EVENT"), "React live route controls dispatch 3D route commands to the controller boundary");
assert.ok(liveSourceControlsPanel.includes("LIVE_SOURCE_REACT_COMMAND_EVENT"), "React live source controls dispatch source commands to the controller boundary");
assert.ok(liveRenderControlsPanel.includes("LIVE_RENDER_REACT_COMMAND_EVENT"), "React live render controls dispatch render commands to the controller boundary");
assert.ok(liveRouteControlsPanel.includes("useLiveStore"), "React live route controls read low-frequency route and recon state from Zustand");
assert.ok(liveSourceControlsPanel.includes("useLiveStore"), "React live source controls read low-frequency source state from Zustand");
assert.ok(liveRenderControlsPanel.includes("useLiveStore"), "React live render controls read low-frequency render state from Zustand");
assert.ok(liveRouteControlsPanel.includes('to="/annotate"'), "React live route controls link to the React annotation route");
assert.ok(liveWorkbench.includes('to="/incision"'), "React live workbench links to the React incision route");
assert.ok(dom.includes("export function bindDom"), "DOM module can rebind element references for SPA route mounts");
assert.ok(dom.includes("export let ctx"), "DOM module exports a live canvas context binding");
assert.ok(liveController.includes("export function mountLiveWorkbench"), "live controller exposes a mount lifecycle");
assert.ok(liveController.includes("export function disposeLiveWorkbench"), "live controller exposes a dispose lifecycle");
assert.ok(liveController.includes("LIVE_CONTROLLER_STATE_EVENT"), "live controller declares a React state bridge event");
assert.ok(liveController.includes("LIVE_ROUTE_REACT_COMMAND_EVENT"), "live controller declares a React route command bridge event");
assert.ok(liveController.includes("LIVE_SOURCE_REACT_COMMAND_EVENT"), "live controller declares a React source command bridge event");
assert.ok(liveController.includes("LIVE_RENDER_REACT_COMMAND_EVENT"), "live controller declares a React render command bridge event");
assert.ok(liveController.includes("handleReactRouteCommand"), "live controller routes React route commands to existing 3D workflow functions");
assert.ok(liveController.includes("handleReactSourceCommand"), "live controller routes React source commands to existing workflow functions");
assert.ok(liveController.includes("handleReactRenderCommand"), "live controller routes React render commands to existing workflow functions");
assert.ok(liveController.includes("react-live-controller-snapshot/v0.1"), "live controller publishes a typed React snapshot");
assert.ok(liveController.includes("CustomEvent(LIVE_CONTROLLER_STATE_EVENT"), "live controller emits state snapshots through a browser event");
assert.ok(liveController.includes("scheduleLiveState"), "live controller publishes low-frequency state snapshots from user actions");
assert.ok(liveController.includes("bindDom(root)"), "live controller rebinds DOM references on mount");
assert.ok(liveController.includes("abortController?.abort"), "live controller aborts DOM listeners on dispose");
assert.ok(liveController.includes("resizeCleanup?.()"), "live controller disconnects resize observers on dispose");
assert.ok(liveController.includes("stopSource()"), "live controller stops camera/media sources on dispose");
assert.ok(liveController.includes("stopTwin()"), "live controller stops twin RAF on dispose");
assert.ok(liveController.includes("!window.__LANGERFACE_REACT_MANAGED__"), "legacy live HTML still auto-mounts outside React");
assert.ok(surgeryRoute.includes("__LANGERFACE_REACT_MANAGED__"), "React surgery route disables controller auto-mount");
assert.ok(surgeryRoute.includes("loadJsonAsset"), "React surgery route lazy-loads closure demo assets");
assert.ok(surgeryRoute.includes("SurgeryR3FScene"), "React surgery route renders the R3F closure scene directly");
assert.ok(!surgeryRoute.includes("surgery_main.js"), "React surgery route should not mount the legacy surgery controller");
assert.ok(!surgeryRoute.includes("mountSurgeryClosureDemo"), "React surgery route should not call the legacy surgery controller");
assert.ok(!surgeryRoute.includes("disposeSurgeryClosureDemo"), "React surgery route should not dispose a controller it no longer owns");
assert.ok(surgeryRoute.includes("<SurgeryWorkbench"), "React surgery route renders the closure demo as TSX");
assert.ok(!surgeryRoute.includes("DOMParser"), "React surgery route should not parse legacy HTML");
assert.ok(!surgeryRoute.includes("innerHTML"), "React surgery route should not inject legacy HTML");
assert.ok(surgeryR3FScene.includes("@react-three/fiber"), "React surgery scene uses @react-three/fiber");
assert.ok(surgeryR3FScene.includes("@react-three/drei"), "React surgery scene uses drei helpers");
assert.ok(surgeryR3FScene.includes("useFrame"), "React surgery scene keeps per-frame simulation inside the renderer loop");
assert.ok(surgeryR3FScene.includes("runtimeRef"), "React surgery scene keeps high-frequency soft-body state in refs");
assert.ok(surgeryR3FScene.includes("buildSoftBody"), "React surgery scene imports the soft-body tool directly");
assert.ok(surgeryR3FScene.includes("stepSoftBody"), "React surgery scene advances soft-body simulation in R3F");
assert.ok(surgeryR3FScene.includes("vertexTension"), "React surgery scene computes closure tension");
assert.ok(surgeryR3FScene.includes("rstlDirField"), "React surgery scene derives local RSTL direction");
assert.ok(surgeryR3FScene.includes("buildLineGeometry"), "React surgery scene renders RSTL guide lines");
assert.ok(surgeryR3FScene.includes('id="surgeryCanvas"'), "React surgery R3F canvas keeps #surgeryCanvas for UI tests");
assert.ok(!surgeryR3FScene.includes("useAppStore"), "React surgery scene should not put frame state into Zustand");
assert.ok(!surgeryR3FScene.includes("innerHTML"), "React surgery scene should not inject HTML strings");
for (const id of [
  "btnAlong",
  "btnReset",
  "showLines",
  "sizeRange",
  "tensionVal",
  "verdict",
]) {
  assert.ok(surgeryWorkbench.includes(`id="${id}"`), `React surgery workbench exposes #${id}`);
}
assert.equal((surgeryWorkbench.match(/id="btnAlong"/g) || []).length, 1, "React surgery workbench has exactly one cut action");
assert.ok(!surgeryWorkbench.includes("btnAcross"), "React surgery workbench does not expose inverse-RSTL action");
assert.ok(surgeryController.includes("export function mountSurgeryClosureDemo"), "surgery controller exposes a mount lifecycle");
assert.ok(surgeryController.includes("export function disposeSurgeryClosureDemo"), "surgery controller exposes a dispose lifecycle");
assert.ok(surgeryController.includes("cancelAnimationFrame"), "surgery controller cancels its render loop on dispose");
assert.ok(surgeryController.includes("S.resizeObserver?.disconnect"), "surgery controller disconnects ResizeObserver on dispose");
assert.ok(surgeryController.includes("S.abortController?.abort"), "surgery controller aborts DOM listeners on dispose");
assert.ok(surgeryController.includes("S.head?.dispose"), "surgery controller disposes WebGL resources on dispose");
assert.ok(surgeryController.includes("!window.__LANGERFACE_REACT_MANAGED__"), "legacy surgery HTML still auto-mounts outside React");

console.log("test_react_architecture: React SPA architecture boundaries passed");
