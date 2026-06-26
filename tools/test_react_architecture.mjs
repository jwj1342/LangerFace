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
const workbenchBrand = read("src/components/WorkbenchBrand.tsx");
const controllerCommand = read("src/lib/controllerCommand.ts");
const uiButton = read("src/components/ui/button.tsx");
const uiCard = read("src/components/ui/card.tsx");
const uiCheckbox = read("src/components/ui/checkbox.tsx");
const uiInput = read("src/components/ui/input.tsx");
const uiLabel = read("src/components/ui/label.tsx");
const uiSelect = read("src/components/ui/select.tsx");
const uiSlider = read("src/components/ui/slider.tsx");
const uiTextarea = read("src/components/ui/textarea.tsx");
const annotateStore = read("src/stores/annotateStore.ts");
const reactRouteLifecycleHook = read("src/hooks/useReactRouteLifecycle.ts");
const controllerSnapshotBridgeHook = read("src/hooks/useControllerSnapshotBridge.ts");
const annotateBridge = read("src/hooks/useAnnotateControllerBridge.ts");
const annotateStatePanel = read("src/components/AnnotateStatePanel.tsx");
const annotateMeshSourcePanel = read("src/components/AnnotateMeshSourcePanel.tsx");
const annotateDrawPanel = read("src/components/AnnotateDrawPanel.tsx");
const annotateLineLibraryPanel = read("src/components/AnnotateLineLibraryPanel.tsx");
const annotateHelpPanel = read("src/components/AnnotateHelpPanel.tsx");
const annotateStagePanel = read("src/components/AnnotateStagePanel.tsx");
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
const managedWorkbenchHook = read("src/hooks/useManagedWorkbenchController.ts");
const liveBridge = read("src/hooks/useLiveControllerBridge.ts");
const liveStatePanel = read("src/components/LiveStatePanel.tsx");
const liveRouteControlsPanel = read("src/components/LiveRouteControlsPanel.tsx");
const liveSourceControlsPanel = read("src/components/LiveSourceControlsPanel.tsx");
const liveRenderControlsPanel = read("src/components/LiveRenderControlsPanel.tsx");
const liveQualityPanel = read("src/components/LiveQualityPanel.tsx");
const liveStagePanel = read("src/components/LiveStagePanel.tsx");
const dashboardRoute = read("src/routes/DashboardRoute.tsx");
const annotateRoute = read("src/routes/AnnotateRoute.tsx");
const annotateWorkbench = read("src/routes/AnnotateWorkbench.tsx");
const incisionRoute = read("src/routes/IncisionRoute.tsx");
const incisionWorkbench = read("src/routes/IncisionWorkbench.tsx");
const liveRoute = read("src/routes/LiveRoute.tsx");
const liveWorkbench = read("src/routes/LiveWorkbench.tsx");
const surgeryRoute = read("src/routes/SurgeryRoute.tsx");
const surgeryR3FScene = read("src/routes/SurgeryR3FScene.tsx");
const surgeryWorkbench = read("src/routes/SurgeryWorkbench.tsx");
const surgeryControlsPanel = read("src/components/SurgeryControlsPanel.tsx");
const surgeryMetricsPanel = read("src/components/SurgeryMetricsPanel.tsx");
const surgeryHelpPanel = read("src/components/SurgeryHelpPanel.tsx");
const surgeryStagePanel = read("src/components/SurgeryStagePanel.tsx");
const threeRoute = read("src/routes/ThreePreviewRoute.tsx");
const threePreviewScene = read("src/components/ThreePreviewScene.tsx");
const threePreviewSidebar = read("src/components/ThreePreviewSidebar.tsx");
const standardFaceAssets = read("src/services/standardFaceAssets.ts");
const worker = read("src/workers/workflow.worker.ts");
const workerClient = read("src/services/workflowWorkerClient.ts");
const workerPanel = read("src/components/WorkerStatusPanel.tsx");
const providerConfigService = read("src/services/providerConfig.ts");
const tumorInputService = read("src/services/tumorInput.ts");
const annotateSnapshotsService = read("src/services/annotateSnapshots.ts");
const liveSnapshotsService = read("src/services/liveSnapshots.ts");
const incisionSnapshotsService = read("src/services/incisionSnapshots.ts");
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
assert.ok(dashboardRoute.includes("useReactRouteLifecycle"), "React dashboard uses the shared pure route lifecycle hook");
assert.ok(dashboardRoute.includes('workspace: "dashboard"'), "React dashboard publishes its active workspace");
assert.ok(dashboardRoute.includes("WorkbenchBrand"), "React dashboard uses the shared workbench brand");
assert.ok(dashboardRoute.includes("Card"), "React dashboard uses the shared shadcn-style card component");
assert.ok(workbenchBrand.includes('className="brand"'), "React shell uses a shared workbench brand component");
assert.ok(workbenchBrand.includes('className="brand-top"'), "shared workbench brand keeps the existing brand-top structure");
assert.ok(workbenchBrand.includes("{action}"), "shared workbench brand supports page-specific status/actions");
assert.ok(controllerCommand.includes("ControllerCommandDetail"), "React controller command helper keeps command payloads typed");
assert.ok(controllerCommand.includes("dispatchControllerEvent"), "React controller command helper exposes generic controller events");
assert.ok(controllerCommand.includes("dispatchControllerCommand"), "React controller command helper exposes command dispatch");
assert.ok(controllerCommand.includes("CustomEvent<TDetail>"), "React controller command helper preserves typed CustomEvent details");
assert.ok(controllerCommand.includes("window.dispatchEvent"), "React controller command helper centralizes browser event dispatch");
assert.ok(uiButton.includes("@radix-ui/react-slot"), "shadcn-style Button supports asChild through Radix Slot");
assert.ok(uiButton.includes("class-variance-authority"), "shadcn-style Button uses variant composition");
assert.ok(uiButton.includes("workbenchPrimary"), "shadcn-style Button can preserve legacy workbench button styling");
assert.ok(uiButton.includes("miniDanger"), "shadcn-style Button can preserve compact destructive button styling");
assert.ok(uiCard.includes("CardHeader"), "shadcn-style Card exposes a header primitive");
assert.ok(uiCard.includes("CardContent"), "shadcn-style Card exposes a content primitive");
assert.ok(uiCard.includes('cn("card"'), "shadcn-style Card preserves existing card styling");
assert.ok(uiCheckbox.includes('type="checkbox"'), "shadcn-style Checkbox preserves native checkbox behavior");
assert.ok(uiInput.includes('cn("text-input"'), "shadcn-style Input preserves existing text input styling");
assert.ok(uiLabel.includes('cn("field-label"'), "shadcn-style Label preserves existing field label styling");
assert.ok(uiSelect.includes('cn("select"'), "shadcn-style Select preserves existing select styling");
assert.ok(uiSlider.includes('type="range"'), "shadcn-style RangeInput preserves native range input behavior");
assert.ok(uiTextarea.includes('cn("text-area"'), "shadcn-style Textarea preserves existing textarea styling");
assert.ok(typedStore.includes("React/Zustand stores low-frequency UI"), "Zustand store documents low-frequency state ownership");
assert.ok(typedStore.includes("per-frame arrays stay outside persisted stores"), "Zustand store forbids high-frequency renderer arrays");
assert.ok(typedStore.includes("interface AppState"), "Zustand store is typed");
assert.ok(typedStore.includes("export type Workspace"), "app store exports a typed workspace union for route lifecycle hooks");
assert.ok(reactRouteLifecycleHook.includes("useReactRouteLifecycle"), "pure React routes share a typed route lifecycle hook");
assert.ok(reactRouteLifecycleHook.includes("reactManaged"), "pure React route lifecycle can guard legacy auto-mounts when needed");
assert.ok(reactRouteLifecycleHook.includes("previousManagedFlag"), "pure React route lifecycle restores the previous managed flag on unmount");
assert.ok(reactRouteLifecycleHook.includes("setActiveWorkspace(workspace)"), "pure React route lifecycle publishes active workspace state");
assert.ok(reactRouteLifecycleHook.includes("setRouteStatus(mountedStatus)"), "pure React route lifecycle publishes mounted route status");
assert.ok(reactRouteLifecycleHook.includes("setRouteStatus(unloadedStatus)"), "pure React route lifecycle publishes unloaded route status");
assert.ok(managedWorkbenchHook.includes("useManagedWorkbenchController"), "React routes share a managed workbench controller lifecycle hook");
assert.ok(managedWorkbenchHook.includes("__LANGERFACE_REACT_MANAGED__ = true"), "managed workbench hook disables legacy controller auto-mount");
assert.ok(managedWorkbenchHook.includes("previousManagedFlag"), "managed workbench hook restores the previous React-managed flag on unmount");
assert.ok(managedWorkbenchHook.includes("dispose?.(module)"), "managed workbench hook disposes late-loaded modules after route teardown");
assert.ok(managedWorkbenchHook.includes(".catch((err) => {\n      if (disposed) return;"), "managed workbench hook ignores late async failures after route teardown");
assert.ok(managedWorkbenchHook.includes("cleanup?.()"), "managed workbench hook runs controller cleanup on route teardown");
assert.ok(managedWorkbenchHook.includes("setActiveWorkspace(workspace)"), "managed workbench hook publishes active workspace state");
assert.ok(managedWorkbenchHook.includes("setRouteStatus"), "managed workbench hook owns route lifecycle status updates");
assert.ok(controllerSnapshotBridgeHook.includes("useControllerSnapshotBridge"), "React controller snapshots share a typed event bridge hook");
assert.ok(controllerSnapshotBridgeHook.includes("window.addEventListener(eventName"), "shared snapshot bridge subscribes to controller events");
assert.ok(controllerSnapshotBridgeHook.includes("window.removeEventListener(eventName"), "shared snapshot bridge unsubscribes from controller events");
assert.ok(controllerSnapshotBridgeHook.includes("clearSnapshot()"), "shared snapshot bridge clears route snapshots on unmount");
assert.ok(controllerSnapshotBridgeHook.includes("CustomEvent<unknown>"), "shared snapshot bridge treats browser event payloads as unknown before schema guards");
assert.ok(annotateStore.includes("AnnotateControllerSnapshot"), "annotation Zustand store keeps typed controller snapshots");
assert.ok(annotateStore.includes("ANNOTATE_CONTROLLER_STATE_EVENT"), "annotation Zustand store declares the controller bridge event");
assert.ok(annotateStore.includes("No Three.js objects"), "annotation store documents renderer object exclusion");
assert.ok(annotateStore.includes("../services/annotateSnapshots"), "annotation Zustand store reuses the shared typed snapshot service types");
assert.ok(!annotateStore.includes("THREE."), "annotation store must not hold Three.js objects");
assert.ok(!annotateStore.includes("verts:"), "annotation store must not hold mesh vertex arrays");
assert.ok(!annotateStore.includes("tris:"), "annotation store must not hold triangle arrays");
assert.ok(!annotateStore.includes("camera:"), "annotation store must not hold Three.js cameras");
assert.ok(annotateBridge.includes("useControllerSnapshotBridge"), "React annotation hook delegates event wiring to the shared snapshot bridge");
assert.ok(annotateBridge.includes("react-annotate-controller-snapshot/v0.1"), "React annotation hook keeps a schema guard for controller snapshots");
assert.ok(annotateStatePanel.includes("useAnnotateStore"), "React annotation UI reads low-frequency state from Zustand");
assert.ok(liveStore.includes("LiveControllerSnapshot"), "live Zustand store keeps typed controller snapshots");
assert.ok(liveStore.includes("LIVE_CONTROLLER_STATE_EVENT"), "live Zustand store declares the controller bridge event");
assert.ok(liveStore.includes("No MediaPipe task instances"), "live store documents MediaPipe object exclusion");
assert.ok(liveStore.includes("../services/liveSnapshots"), "live Zustand store reuses the shared typed snapshot service types");
assert.ok(!liveStore.includes("THREE."), "live store must not hold Three.js objects");
assert.ok(!liveStore.includes("landmarks:"), "live store must not hold per-frame landmarks");
assert.ok(!liveStore.includes("verts:"), "live store must not hold mesh vertex arrays");
assert.ok(!liveStore.includes("tris:"), "live store must not hold triangle arrays");
assert.ok(!liveStore.includes("fps:"), "live store must not hold frame counters");
assert.ok(liveBridge.includes("useControllerSnapshotBridge"), "React live hook delegates event wiring to the shared snapshot bridge");
assert.ok(liveBridge.includes("react-live-controller-snapshot/v0.1"), "React live hook keeps a schema guard for controller snapshots");
assert.ok(liveStatePanel.includes("useLiveStore"), "React live UI reads low-frequency state from Zustand");
assert.ok(incisionStore.includes("IncisionControllerSnapshot"), "incision Zustand store keeps typed controller snapshots");
assert.ok(incisionStore.includes("INCISION_CONTROLLER_STATE_EVENT"), "incision Zustand store declares the controller bridge event");
assert.ok(incisionStore.includes("No Three.js objects"), "incision store documents renderer object exclusion");
assert.ok(incisionStore.includes("../services/incisionSnapshots"), "incision Zustand store reuses the shared typed snapshot service types");
assert.ok(!incisionStore.includes("THREE."), "incision store must not hold Three.js objects");
assert.ok(!incisionStore.includes("verts:"), "incision store must not hold mesh vertex arrays");
assert.ok(!incisionStore.includes("tris:"), "incision store must not hold triangle arrays");
assert.ok(incisionBridge.includes("useControllerSnapshotBridge"), "React incision hook delegates event wiring to the shared snapshot bridge");
assert.ok(incisionBridge.includes("react-incision-controller-snapshot/v0.1"), "React incision hook keeps a schema guard for controller snapshots");
assert.ok(incisionRoute.includes("useIncisionControllerBridge"), "incision route mounts the Zustand/controller bridge");
assert.ok(incisionStatePanel.includes("useIncisionStore"), "React incision UI reads low-frequency state from Zustand");

assert.ok(incisionRoute.includes("useManagedWorkbenchController"), "React incision route uses the shared managed controller lifecycle");
assert.ok(incisionRoute.includes("mountIncisionAgentWorkbench"), "React incision route configures the existing controller mount function");
assert.ok(incisionRoute.includes("disposeIncisionAgentWorkbench"), "React incision route configures the existing controller dispose function");
assert.ok(!incisionRoute.includes("window.__LANGERFACE_REACT_MANAGED__ = true"), "React incision route does not duplicate managed flag logic");
assert.ok(incisionRoute.includes("<IncisionWorkbench />"), "React incision route renders the workbench as TSX");
assert.ok(incisionWorkbench.includes("WorkbenchBrand"), "React incision workbench uses the shared workbench brand");
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
assert.ok(tumorPanel.includes("dispatchControllerCommand"), "React tumor panel uses the shared controller command helper");
assert.ok(tumorPanel.includes("useIncisionStore"), "React tumor panel syncs low-frequency tumor status from Zustand");
assert.ok(tumorPanel.includes("Button"), "React tumor panel uses the shared shadcn-style button primitive");
assert.ok(tumorPanel.includes("Input"), "React tumor panel uses the shared shadcn-style input primitive");
assert.ok(tumorPanel.includes("Label"), "React tumor panel uses the shared shadcn-style label primitive");
assert.ok(tumorPanel.includes("Select"), "React tumor panel uses the shared shadcn-style select primitive");
assert.ok(tumorPanel.includes("RangeInput"), "React tumor panel uses the shared shadcn-style range primitive");
assert.ok(tumorPanel.includes('variant="workbenchPrimary"'), "React tumor panel keeps primary workbench button styling through Button variants");
assert.ok(tumorInputService.includes("buildTumorInput"), "shared tumor input service builds typed TumorInput payloads");
assert.ok(tumorInputService.includes("buildTumorFormSnapshot"), "shared tumor input service builds React-safe tumor form snapshots");
assert.ok(tumorInputService.includes("importedTumorFormState"), "shared tumor input service normalizes imported tumor payloads for form controls");
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
assert.ok(secondaryCuePanel.includes("dispatchControllerCommand"), "React secondary cue panel uses the shared controller command helper");
assert.ok(secondaryCuePanel.includes("useIncisionStore"), "React secondary cue panel syncs low-frequency cue state from Zustand");
assert.ok(secondaryCuePanel.includes("Button"), "React secondary cue panel uses the shared shadcn-style button primitive");
assert.ok(secondaryCuePanel.includes("Input"), "React secondary cue panel uses the shared shadcn-style input primitive");
assert.ok(secondaryCuePanel.includes("Checkbox"), "React secondary cue panel uses the shared shadcn-style checkbox primitive");
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
assert.ok(candidateLibraryPanel.includes("dispatchControllerCommand"), "React candidate library uses the shared controller command helper");
assert.ok(candidateLibraryPanel.includes("useIncisionStore"), "React candidate library reads saved candidate summaries from Zustand");
assert.ok(candidateLibraryPanel.includes("Button"), "React candidate library uses the shared shadcn-style button primitive");
assert.ok(candidateLibraryPanel.includes('variant="workbenchPrimary"'), "React candidate library keeps primary workbench button styling through Button variants");
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
assert.ok(providerPanel.includes("dispatchControllerEvent"), "React provider panel uses the shared controller event helper");
assert.ok(providerPanel.includes("../services/providerConfig"), "React provider panel consumes the shared typed Provider config service");
assert.ok(providerConfigService.includes("PROVIDER_STORAGE_KEY"), "Provider config service owns browser storage keying");
assert.ok(providerConfigService.includes("initialProviderState"), "Provider config service owns stored/default Provider initialization");
assert.ok(providerConfigService.includes("isDeprecatedNativeProviderConfig"), "Provider config service owns deprecated native Provider cleanup");
assert.ok(providerConfigService.includes("localProviderFromRemotePageMessage"), "Provider config service owns loopback Provider browser warning text");
assert.ok(providerConfigService.includes("insecureProviderFromSecurePageMessage"), "Provider config service owns HTTPS-to-HTTP Provider warning text");
assert.ok(providerConfigService.includes("redactedProviderConfig"), "Provider config service owns Provider export redaction");
assert.ok(providerPanel.includes("Input"), "React provider panel uses the shared shadcn-style input primitive");
assert.ok(providerPanel.includes("Label"), "React provider panel uses the shared shadcn-style label primitive");
assert.ok(providerPanel.includes("RangeInput"), "React provider panel uses the shared shadcn-style range primitive");
assert.ok(providerPanel.includes("Button"), "React provider panel uses the shared shadcn-style button primitive");
assert.ok(!providerPanel.includes("<input"), "React provider panel should route hidden and visible inputs through the shared input primitive");
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
assert.ok(editPanel.includes("dispatchControllerCommand"), "React edit panel uses the shared controller command helper");
assert.ok(editPanel.includes("useIncisionStore"), "React edit panel syncs low-frequency edit state from Zustand");
assert.ok(editPanel.includes("Button"), "React edit panel uses the shared shadcn-style button primitive");
assert.ok(editPanel.includes("Label"), "React edit panel uses the shared shadcn-style label primitive");
assert.ok(editPanel.includes("Select"), "React edit panel uses the shared shadcn-style select primitive");
assert.ok(editPanel.includes("RangeInput"), "React edit panel uses the shared shadcn-style range primitive");
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
assert.ok(reviewPanel.includes("dispatchControllerCommand"), "React review panel uses the shared controller command helper");
assert.ok(reviewPanel.includes("useIncisionStore"), "React review panel syncs low-frequency review state from Zustand");
assert.ok(reviewPanel.includes("Input"), "React review panel uses the shared shadcn-style input primitive");
assert.ok(reviewPanel.includes("Label"), "React review panel uses the shared shadcn-style label primitive");
assert.ok(reviewPanel.includes("Select"), "React review panel uses the shared shadcn-style select primitive");
assert.ok(reviewPanel.includes("Textarea"), "React review panel uses the shared shadcn-style textarea primitive");
assert.ok(reviewPanel.includes("Button"), "React review panel uses the shared shadcn-style button primitive");
assert.ok(reviewPanel.includes('variant="workbenchPrimary"'), "React review panel keeps primary workbench button styling through Button variants");
assert.ok(incisionWorkbench.includes('to="/live"'), "React incision workbench returns to the React live route");
assert.ok(incisionStagePanel.includes('to="/annotate"'), "React incision stage links to the React 3D annotation route");
assert.ok(controller.includes("export function mountIncisionAgentWorkbench"), "incision controller exposes a mount lifecycle");
assert.ok(controller.includes("export function disposeIncisionAgentWorkbench"), "incision controller exposes a dispose lifecycle");
assert.ok(controller.includes("INCISION_TUMOR_REACT_COMMAND_EVENT"), "incision controller listens for React tumor input commands");
assert.ok(controller.includes("handleReactTumorCommand"), "incision controller routes React tumor commands to existing tumor workflow functions");
assert.ok(controller.includes("./src/services/tumorInput.ts"), "incision controller consumes the shared typed tumor input service");
assert.ok(controller.includes("buildTumorInput({"), "incision controller delegates TumorInput construction to the shared service");
assert.ok(controller.includes("buildTumorFormSnapshot({"), "incision controller delegates tumor snapshot normalization to the shared service");
assert.ok(controller.includes("importedTumorFormState(payload"), "incision controller delegates imported tumor normalization to the shared service");
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
assert.ok(controller.includes("./src/services/providerConfig.ts"), "incision controller consumes the shared typed Provider config service");
assert.ok(controller.includes("persistProviderPrefs(providerConfig())"), "incision controller saves Provider config through the shared service");
assert.ok(controller.includes("redactProviderConfig(providerConfig())"), "incision controller redacts Provider config through the shared service");
assert.ok(incisionSnapshotsService.includes("buildIncisionControllerSnapshot"), "shared incision snapshot service builds typed controller snapshots");
assert.ok(incisionSnapshotsService.includes("buildIncisionResultViewSnapshot"), "shared incision snapshot service builds candidate result view snapshots");
assert.ok(incisionSnapshotsService.includes("buildIncisionSavedCandidateSummaries"), "shared incision snapshot service builds saved candidate summaries");
assert.ok(incisionSnapshotsService.includes("react-incision-controller-snapshot/v0.1"), "shared incision snapshot service owns the typed React snapshot schema");
assert.ok(controller.includes("./src/services/incisionSnapshots.ts"), "incision controller consumes the shared typed snapshot service");
assert.ok(controller.includes("buildIncisionControllerSnapshot({"), "incision controller delegates React snapshot construction to the shared service");
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

assert.ok(standardFaceAssets.includes("loadStandardFaceAssets"), "standard face asset service exposes a shared lazy loader");
assert.ok(standardFaceAssets.includes('"canonicalVertices"'), "standard face asset service loads canonical vertices");
assert.ok(standardFaceAssets.includes('"triangles"'), "standard face asset service loads triangle topology");
assert.ok(standardFaceAssets.includes('"atlasRstl"'), "standard face asset service loads the RSTL atlas");
assert.ok(threeRoute.includes("loadStandardFaceAssets"), "R3F preview lazy-loads runtime assets through the shared service");
assert.ok(threeRoute.includes("useReactRouteLifecycle"), "R3F preview route uses the shared pure route lifecycle hook");
assert.ok(threeRoute.includes('workspace: "three-preview"'), "R3F preview route publishes its active workspace through the lifecycle hook");
assert.ok(threeRoute.includes("reloadSerial"), "R3F preview reload is driven by React route state");
assert.ok(threeRoute.includes("setAssets(null)"), "R3F preview clears stale assets before a route-local reload");
assert.ok(!threeRoute.includes("window.location.reload"), "R3F preview should not reload the whole SPA");
assert.ok(threeRoute.includes("ThreePreviewScene"), "R3F preview route renders the scene through a React component");
assert.ok(threeRoute.includes("ThreePreviewSidebar"), "R3F preview route renders the sidebar through a React component");
assert.ok(threePreviewScene.includes("@react-three/fiber"), "R3F preview scene uses @react-three/fiber");
assert.ok(threePreviewScene.includes("@react-three/drei"), "R3F preview scene uses drei helpers");
assert.ok(threePreviewScene.includes("OrbitControls"), "R3F preview scene uses drei OrbitControls");
assert.ok(threePreviewScene.includes("buildLineGeometry"), "R3F preview scene renders atlas line geometry");
assert.ok(threeRoute.includes(".catch((err) => {\n      if (disposed) return;"), "R3F preview route ignores late asset loader failures after route teardown");
assert.ok(threePreviewSidebar.includes("R3F RENDERER BOUNDARY"), "R3F preview sidebar keeps the renderer boundary note");
assert.ok(threePreviewSidebar.includes("WorkbenchBrand"), "R3F preview sidebar uses the shared workbench brand");
assert.ok(threePreviewSidebar.includes("Card"), "R3F preview sidebar uses the shared shadcn-style card component");
assert.ok(worker.includes("Comlink.expose"), "workflow worker exposes its API through Comlink");
assert.ok(worker.includes("summarizeTumorInputQuality"), "workflow worker can run deterministic browser tools");
assert.ok(worker.includes("planIncisionWorkflow"), "workflow worker can run deterministic incision planning");
assert.ok(worker.includes("planIncision(request"), "workflow worker exposes incision planning through its API");
assert.ok(worker.includes("handles_high_frequency_render_state: false"), "workflow worker explicitly avoids high-frequency renderer state");
assert.ok(workerClient.includes("Comlink.wrap"), "React app wraps the workflow worker with Comlink");
assert.ok(workerClient.includes("new Worker(new URL"), "workflow worker is loaded through Vite worker URL handling");
assert.ok(workerClient.includes("worker.terminate"), "workflow worker client has an explicit dispose lifecycle");
assert.ok(workerClient.includes("WorkflowWorkerProbeResult"), "workflow worker client exposes a typed low-frequency probe result");
assert.ok(workerClient.includes("probeWorkflowWorkerClient"), "workflow worker client centralizes dashboard worker health checks");
assert.ok(workerClient.includes("summarizeTumorInput"), "workflow worker probe exercises a deterministic tool through Comlink");
assert.ok(workerPanel.includes("createWorkflowWorkerClient"), "React dashboard probes the worker boundary");
assert.ok(workerPanel.includes("probeWorkflowWorkerClient"), "React worker status panel consumes the shared worker probe service");
assert.ok(!workerPanel.includes("client.api.diagnostics"), "React worker status panel does not inline Comlink API probing");
assert.ok(workerPanel.includes("CardHeader"), "React worker status panel uses the shared shadcn-style card primitives");
assert.ok(controller.includes("createWorkflowWorkerClient"), "incision controller uses the Comlink workflow worker client");
assert.ok(controller.includes("worker.api.planIncision"), "incision candidate generation is delegated to the workflow worker");
assert.ok(controller.includes("main_thread_fallback"), "incision controller keeps a deterministic fallback if worker startup fails");
assert.ok(controller.includes("S.workflowWorker?.dispose"), "incision controller disposes the workflow worker on route teardown");
assert.ok(incisionSnapshotsService.includes("react-incision-controller-snapshot/v0.1"), "shared incision snapshot service publishes typed low-frequency snapshots to React");
assert.ok(controller.includes("CustomEvent(INCISION_CONTROLLER_STATE_EVENT"), "incision controller emits state snapshots through a browser event");
assert.ok(annotateRoute.includes("useAnnotateControllerBridge"), "annotation route mounts the Zustand/controller bridge");
assert.ok(annotateRoute.includes("useManagedWorkbenchController"), "React annotation route uses the shared managed controller lifecycle");
assert.ok(annotateRoute.includes("mountAnnotateWorkbench"), "React annotation route configures the annotation controller mount function");
assert.ok(annotateRoute.includes("disposeAnnotateWorkbench"), "React annotation route configures the annotation controller dispose function");
assert.ok(!annotateRoute.includes("window.__LANGERFACE_REACT_MANAGED__ = true"), "React annotation route does not duplicate managed flag logic");
assert.ok(annotateRoute.includes("<AnnotateWorkbench />"), "React annotate route renders the annotation UI as TSX");
assert.ok(!annotateRoute.includes("DOMParser"), "React annotate route should not parse legacy HTML");
assert.ok(!annotateRoute.includes("innerHTML"), "React annotate route should not inject legacy HTML");
for (const id of [
  "stage",
]) {
  assert.ok(annotateStagePanel.includes(`id="${id}"`), `React annotate stage exposes #${id}`);
}
assert.ok(annotateWorkbench.includes("AnnotateStatePanel"), "React annotate workbench renders the controller state panel");
assert.ok(annotateWorkbench.includes("WorkbenchBrand"), "React annotate workbench uses the shared workbench brand");
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
assert.ok(annotateWorkbench.includes("AnnotateHelpPanel"), "React annotate workbench renders annotation help as a React component");
assert.ok(annotateWorkbench.includes("AnnotateStagePanel"), "React annotate workbench renders the 3D stage shell as a React component");
assert.ok(annotateMeshSourcePanel.includes("ANNOTATE_MESH_REACT_COMMAND_EVENT"), "React annotate mesh source panel dispatches mesh commands to the controller boundary");
assert.ok(annotateDrawPanel.includes("ANNOTATE_DRAW_REACT_COMMAND_EVENT"), "React annotate draw panel dispatches current-line commands to the controller boundary");
assert.ok(annotateMeshSourcePanel.includes("dispatchControllerCommand"), "React annotate mesh source panel uses the shared controller command helper");
assert.ok(annotateDrawPanel.includes("dispatchControllerCommand"), "React annotate draw panel uses the shared controller command helper");
assert.ok(annotateMeshSourcePanel.includes("useAnnotateStore"), "React annotate mesh source panel reads low-frequency mesh state from Zustand");
assert.ok(annotateDrawPanel.includes("useAnnotateStore"), "React annotate draw panel reads low-frequency draft state from Zustand");
assert.ok(annotateMeshSourcePanel.includes("Button"), "React annotate mesh source panel uses the shared shadcn-style button primitive");
assert.ok(annotateMeshSourcePanel.includes("Button asChild"), "React annotate mesh source panel uses shared Button asChild for upload labels and Router links");
assert.ok(annotateMeshSourcePanel.includes("Input"), "React annotate mesh source panel uses the shared shadcn-style input primitive");
assert.ok(annotateMeshSourcePanel.includes("Label"), "React annotate mesh source panel uses the shared shadcn-style label primitive");
assert.ok(annotateMeshSourcePanel.includes('variant="workbenchPrimary"'), "React annotate mesh source panel keeps primary workbench button styling through Button variants");
assert.ok(annotateDrawPanel.includes("Button"), "React annotate draw panel uses the shared shadcn-style button primitive");
assert.ok(annotateDrawPanel.includes("Input"), "React annotate draw panel uses the shared shadcn-style input primitive");
assert.ok(annotateDrawPanel.includes("Label"), "React annotate draw panel uses the shared shadcn-style label primitive");
assert.ok(annotateDrawPanel.includes("Select"), "React annotate draw panel uses the shared shadcn-style select primitive");
assert.ok(annotateDrawPanel.includes('variant="workbenchPrimary"'), "React annotate draw panel keeps primary workbench button styling through Button variants");
assert.ok(annotateHelpPanel.includes("标注帮助"), "React annotate help panel keeps the user-facing annotation guide");
assert.ok(annotateStagePanel.includes('to="/live"'), "React annotate stage returns to the React live route");
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
assert.ok(annotateLineLibraryPanel.includes("dispatchControllerCommand"), "React annotate line library uses the shared controller command helper");
assert.ok(annotateLineLibraryPanel.includes("useAnnotateStore"), "React annotate line library reads saved line state from Zustand");
assert.ok(annotateLineLibraryPanel.includes("Button"), "React annotate line library uses the shared shadcn-style button primitive");
assert.ok(annotateLineLibraryPanel.includes('variant="miniDanger"'), "React annotate line library keeps compact destructive styling through Button variants");
assert.ok(annotateSnapshotsService.includes("buildAnnotateControllerSnapshot"), "shared annotation snapshot service builds typed controller snapshots");
assert.ok(annotateSnapshotsService.includes("buildAnnotateDraftSnapshot"), "shared annotation snapshot service builds current-line draft summaries");
assert.ok(annotateSnapshotsService.includes("buildAnnotateSavedSummary"), "shared annotation snapshot service builds saved line summaries");
assert.ok(annotateSnapshotsService.includes("buildAnnotateExportState"), "shared annotation snapshot service builds export capability state");
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
assert.ok(annotateController.includes("./src/services/annotateSnapshots.ts"), "annotation controller consumes the shared typed snapshot service");
assert.ok(annotateController.includes("buildAnnotateControllerSnapshot({"), "annotation controller delegates React snapshot construction to the shared service");
assert.ok(!annotateController.includes("function currentDraftSnapshot"), "annotation controller no longer owns current-line snapshot construction");
assert.ok(!annotateController.includes("function savedSummarySnapshot"), "annotation controller no longer owns saved-line snapshot construction");
assert.ok(annotateController.includes("renderLegacyLineList"), "annotation controller keeps legacy saved line DOM rendering isolated");
assert.ok(annotateController.includes("!window.__LANGERFACE_REACT_MANAGED__"), "legacy annotation HTML still owns direct saved line handlers outside React");
assert.ok(annotateSnapshotsService.includes("react-annotate-controller-snapshot/v0.1"), "shared annotation snapshot service owns the typed React snapshot schema");
assert.ok(annotateController.includes("CustomEvent(ANNOTATE_CONTROLLER_STATE_EVENT"), "annotation controller emits state snapshots through a browser event");
assert.ok(annotateController.includes("cancelAnimationFrame"), "annotation controller cancels its render loop on dispose");
assert.ok(annotateController.includes("abortController?.abort"), "annotation controller aborts DOM listeners on dispose");
assert.ok(annotateController.includes("activeSession"), "annotation controller guards async loaders across SPA unmounts");
assert.ok(annotateController.includes('"/app/live"'), "annotation preview jumps back to the React live route when managed by React");
assert.ok(annotateController.includes("!window.__LANGERFACE_REACT_MANAGED__"), "legacy annotation HTML still auto-mounts outside React");
assert.ok(annotateViewer.includes("dispose()"), "annotation viewer exposes a WebGL dispose lifecycle");
assert.ok(liveRoute.includes("useLiveControllerBridge"), "live route mounts the Zustand/controller bridge");
assert.ok(liveRoute.includes("useManagedWorkbenchController"), "React live route uses the shared managed controller lifecycle");
assert.ok(liveRoute.includes("mountLiveWorkbench"), "React live route configures the live controller mount function");
assert.ok(liveRoute.includes("disposeLiveWorkbench"), "React live route configures the live controller dispose function");
assert.ok(!liveRoute.includes("window.__LANGERFACE_REACT_MANAGED__ = true"), "React live route does not duplicate managed flag logic");
assert.ok(liveRoute.includes("<LiveWorkbench />"), "React live route renders the live UI as TSX");
assert.ok(!liveRoute.includes("DOMParser"), "React live route should not parse legacy HTML");
assert.ok(!liveRoute.includes("innerHTML"), "React live route should not inject legacy HTML");
for (const id of [
  "canvas",
  "video",
  "modelBadge",
  "overlayMsg",
]) {
  const source = id === "modelBadge" ? liveWorkbench : liveStagePanel;
  assert.ok(source.includes(`id="${id}"`), `React live surface exposes #${id}`);
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
for (const id of [
  "qualityVal",
  "qualityBar",
  "statState",
  "statFace",
  "statYaw",
  "statLines",
  "incisionOverlayQa",
  "incisionOverlayQaState",
  "incisionOverlayQaDetail",
]) {
  assert.ok(liveQualityPanel.includes(`id="${id}"`), `React live quality panel exposes #${id}`);
}
for (const id of [
  "livePill",
  "fps",
  "video",
  "canvas",
  "three",
  "scanToast",
  "overlayMsg",
  "zoomStrip",
]) {
  assert.ok(liveStagePanel.includes(`id="${id}"`), `React live stage exposes #${id}`);
}
assert.ok(liveWorkbench.includes("LiveStatePanel"), "React live workbench renders the controller state panel");
assert.ok(liveWorkbench.includes("WorkbenchBrand"), "React live workbench uses the shared workbench brand");
assert.ok(liveWorkbench.includes("LiveRouteControlsPanel"), "React live workbench renders route controls as a React component");
assert.ok(liveWorkbench.includes("LiveSourceControlsPanel"), "React live workbench renders source controls as a React component");
assert.ok(liveWorkbench.includes("LiveRenderControlsPanel"), "React live workbench renders render controls as a React component");
assert.ok(liveWorkbench.includes("LiveQualityPanel"), "React live workbench renders quality and overlay QA as a React component");
assert.ok(liveWorkbench.includes("LiveStagePanel"), "React live workbench renders the stage shell as a React component");
assert.ok(liveRouteControlsPanel.includes("LIVE_ROUTE_REACT_COMMAND_EVENT"), "React live route controls dispatch 3D route commands to the controller boundary");
assert.ok(liveSourceControlsPanel.includes("LIVE_SOURCE_REACT_COMMAND_EVENT"), "React live source controls dispatch source commands to the controller boundary");
assert.ok(liveRenderControlsPanel.includes("LIVE_RENDER_REACT_COMMAND_EVENT"), "React live render controls dispatch render commands to the controller boundary");
assert.ok(liveRouteControlsPanel.includes("dispatchControllerCommand"), "React live route controls use the shared controller command helper");
assert.ok(liveSourceControlsPanel.includes("dispatchControllerCommand"), "React live source controls use the shared controller command helper");
assert.ok(liveRenderControlsPanel.includes("dispatchControllerCommand"), "React live render controls use the shared controller command helper");
assert.ok(liveRouteControlsPanel.includes("useLiveStore"), "React live route controls read low-frequency route and recon state from Zustand");
assert.ok(liveSourceControlsPanel.includes("useLiveStore"), "React live source controls read low-frequency source state from Zustand");
assert.ok(liveRenderControlsPanel.includes("useLiveStore"), "React live render controls read low-frequency render state from Zustand");
assert.ok(liveWorkbench.includes("Button asChild"), "React live workbench uses shared Button asChild for Router links");
assert.ok(liveWorkbench.includes("Label"), "React live workbench uses the shared shadcn-style label primitive");
assert.ok(liveRouteControlsPanel.includes("Button"), "React live route controls use the shared shadcn-style button primitive");
assert.ok(liveRouteControlsPanel.includes("Checkbox"), "React live route controls use the shared shadcn-style checkbox primitive");
assert.ok(liveRouteControlsPanel.includes("Label"), "React live route controls use the shared shadcn-style label primitive");
assert.ok(liveRouteControlsPanel.includes("Select"), "React live route controls use the shared shadcn-style select primitive");
assert.ok(liveRouteControlsPanel.includes("Button asChild"), "React live route controls use shared Button asChild for Router links");
assert.ok(liveRouteControlsPanel.includes('variant="workbenchPrimary"'), "React live route controls keep primary workbench button styling through Button variants");
assert.ok(liveSourceControlsPanel.includes("Button"), "React live source controls use the shared shadcn-style button primitive");
assert.ok(liveSourceControlsPanel.includes("Input"), "React live source controls use the shared shadcn-style input primitive");
assert.ok(liveSourceControlsPanel.includes('variant="workbenchPrimary"'), "React live source controls keep primary workbench button styling through Button variants");
assert.ok(liveRenderControlsPanel.includes("Button"), "React live render controls use the shared shadcn-style button primitive");
assert.ok(liveRenderControlsPanel.includes("Checkbox"), "React live render controls use the shared shadcn-style checkbox primitive");
assert.ok(liveRenderControlsPanel.includes("Label"), "React live render controls use the shared shadcn-style label primitive");
assert.ok(liveRenderControlsPanel.includes("Select"), "React live render controls use the shared shadcn-style select primitive");
assert.ok(liveRenderControlsPanel.includes("RangeInput"), "React live render controls use the shared shadcn-style range primitive");
assert.ok(liveQualityPanel.includes('data-frame-owned="true"'), "React live quality panel documents that frame-updated labels stay outside Zustand");
assert.ok(!liveQualityPanel.includes("useLiveStore"), "live quality panel should not subscribe high-frequency quality updates through Zustand");
assert.ok(liveSnapshotsService.includes("buildLiveControllerSnapshot"), "shared live snapshot service builds typed controller snapshots");
assert.ok(liveSnapshotsService.includes("liveTextOf"), "shared live snapshot service owns text normalization helpers");
assert.ok(liveSnapshotsService.includes("visibleLiveTextOf"), "shared live snapshot service owns visible text normalization helpers");
assert.ok(liveSnapshotsService.includes("react-live-controller-snapshot/v0.1"), "shared live snapshot service owns the typed React snapshot schema");
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
assert.ok(liveController.includes("./src/services/liveSnapshots.ts"), "live controller consumes the shared typed snapshot service");
assert.ok(liveController.includes("buildLiveControllerSnapshot({"), "live controller delegates React snapshot construction to the shared service");
assert.ok(!liveController.includes("function textOf"), "live controller no longer owns snapshot text normalization");
assert.ok(!liveController.includes("function visibleTextOf"), "live controller no longer owns visible snapshot text normalization");
assert.ok(liveController.includes("CustomEvent(LIVE_CONTROLLER_STATE_EVENT"), "live controller emits state snapshots through a browser event");
assert.ok(liveController.includes("scheduleLiveState"), "live controller publishes low-frequency state snapshots from user actions");
assert.ok(liveController.includes("bindDom(root)"), "live controller rebinds DOM references on mount");
assert.ok(liveController.includes("abortController?.abort"), "live controller aborts DOM listeners on dispose");
assert.ok(liveController.includes("resizeCleanup?.()"), "live controller disconnects resize observers on dispose");
assert.ok(liveController.includes("stopSource()"), "live controller stops camera/media sources on dispose");
assert.ok(liveController.includes("stopTwin()"), "live controller stops twin RAF on dispose");
assert.ok(liveController.includes("!window.__LANGERFACE_REACT_MANAGED__"), "legacy live HTML still auto-mounts outside React");
assert.ok(surgeryRoute.includes("useReactRouteLifecycle"), "React surgery route uses the shared pure route lifecycle hook");
assert.ok(surgeryRoute.includes('workspace: "surgery"'), "React surgery route publishes its active workspace through the lifecycle hook");
assert.ok(surgeryRoute.includes("reactManaged: true"), "React surgery route disables legacy auto-mounts through the lifecycle hook");
assert.ok(!surgeryRoute.includes("previousManagedFlag"), "React surgery route does not duplicate managed flag cleanup");
assert.ok(surgeryRoute.includes("loadStandardFaceAssets"), "React surgery route lazy-loads closure demo assets through the shared service");
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
]) {
  assert.ok(surgeryControlsPanel.includes(`id="${id}"`), `React surgery controls expose #${id}`);
}
for (const id of [
  "tensionVal",
  "tensionBar",
  "verdict",
]) {
  assert.ok(surgeryMetricsPanel.includes(`id="${id}"`), `React surgery metrics expose #${id}`);
}
assert.ok(surgeryWorkbench.includes("SurgeryControlsPanel"), "React surgery workbench renders closure controls as a React component");
assert.ok(surgeryWorkbench.includes("WorkbenchBrand"), "React surgery workbench uses the shared workbench brand");
assert.ok(surgeryWorkbench.includes("SurgeryMetricsPanel"), "React surgery workbench renders closure metrics as a React component");
assert.ok(surgeryWorkbench.includes("SurgeryHelpPanel"), "React surgery workbench renders closure help as a React component");
assert.ok(surgeryWorkbench.includes("SurgeryStagePanel"), "React surgery workbench renders the R3F stage shell as a React component");
assert.equal((surgeryControlsPanel.match(/id="btnAlong"/g) || []).length, 1, "React surgery controls have exactly one cut action");
assert.ok(!surgeryControlsPanel.includes("btnAcross"), "React surgery controls do not expose inverse-RSTL action");
assert.ok(surgeryControlsPanel.includes("Button"), "React surgery controls use the shared shadcn-style button primitive");
assert.ok(surgeryControlsPanel.includes("Button asChild"), "React surgery controls use shared Button asChild for the checkbox label button");
assert.ok(surgeryControlsPanel.includes("Checkbox"), "React surgery controls use the shared shadcn-style checkbox primitive");
assert.ok(surgeryControlsPanel.includes("Label"), "React surgery controls use the shared shadcn-style label primitive");
assert.ok(surgeryControlsPanel.includes("RangeInput"), "React surgery controls use the shared shadcn-style range primitive");
assert.ok(surgeryHelpPanel.includes("这是在演示什么？"), "React surgery help panel keeps the closure explanation");
assert.ok(surgeryStagePanel.includes('to="/annotate"'), "React surgery stage returns to the React annotation route");
assert.ok(surgeryController.includes("export function mountSurgeryClosureDemo"), "surgery controller exposes a mount lifecycle");
assert.ok(surgeryController.includes("export function disposeSurgeryClosureDemo"), "surgery controller exposes a dispose lifecycle");
assert.ok(surgeryController.includes("cancelAnimationFrame"), "surgery controller cancels its render loop on dispose");
assert.ok(surgeryController.includes("S.resizeObserver?.disconnect"), "surgery controller disconnects ResizeObserver on dispose");
assert.ok(surgeryController.includes("S.abortController?.abort"), "surgery controller aborts DOM listeners on dispose");
assert.ok(surgeryController.includes("S.head?.dispose"), "surgery controller disposes WebGL resources on dispose");
assert.ok(surgeryController.includes("!window.__LANGERFACE_REACT_MANAGED__"), "legacy surgery HTML still auto-mounts outside React");

console.log("test_react_architecture: React SPA architecture boundaries passed");
