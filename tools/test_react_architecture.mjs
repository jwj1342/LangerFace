import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");

const read = (rel) => fs.readFileSync(path.join(web, rel), "utf8");
const exposesId = (source, id) => source.includes(`id="${id}"`) || source.includes(`id: "${id}"`);
const componentSources = new Map(
  fs.readdirSync(path.join(web, "src/components"))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => [name, read(`src/components/${name}`)]),
);
const routeSources = new Map(
  fs.readdirSync(path.join(web, "src/routes"))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => [name, read(`src/routes/${name}`)]),
);
const pkg = JSON.parse(read("package.json"));
const tsconfig = JSON.parse(read("tsconfig.json"));
const appHtml = read("app/index.html");
const vite = read("vite.config.js");
const vercel = read("vercel.json");
const vercelConfig = JSON.parse(vercel);
const app = read("src/App.tsx");
const typedStore = read("src/stores/appStore.ts");
const reactShell = read("src/components/ReactShell.tsx");
const stageShell = read("src/components/StageShell.tsx");
const workbenchLayout = read("src/components/WorkbenchLayout.tsx");
const workbenchBrand = read("src/components/WorkbenchBrand.tsx");
const controllerCommand = read("src/lib/controllerCommand.ts");
const controllerEvents = read("src/lib/controllerEvents.ts");
const controllerSnapshotSchemas = read("src/lib/controllerSnapshotSchemas.ts");
const reactManagedWorkbench = read("src/lib/reactManagedWorkbench.ts");
const uiAnnotateStatus = read("src/components/ui/annotate-status.tsx");
const uiButton = read("src/components/ui/button.tsx");
const uiButtonRow = read("src/components/ui/button-row.tsx");
const uiCard = read("src/components/ui/card.tsx");
const uiCheckbox = read("src/components/ui/checkbox.tsx");
const uiCheckboxField = read("src/components/ui/checkbox-field.tsx");
const uiFieldGroup = read("src/components/ui/field-group.tsx");
const uiHelpDisclosure = read("src/components/ui/help-disclosure.tsx");
const uiHint = read("src/components/ui/hint.tsx");
const uiIncisionFeedback = read("src/components/ui/incision-feedback.tsx");
const uiIncisionStatus = read("src/components/ui/incision-status.tsx");
const uiInput = read("src/components/ui/input.tsx");
const uiKeyValue = read("src/components/ui/key-value.tsx");
const uiLegend = read("src/components/ui/legend.tsx");
const uiLiveFeedback = read("src/components/ui/live-feedback.tsx");
const uiLibraryList = read("src/components/ui/library-list.tsx");
const uiLabel = read("src/components/ui/label.tsx");
const uiLoadingOverlay = read("src/components/ui/loading-overlay.tsx");
const uiPrivacyAudit = read("src/components/ui/privacy-audit.tsx");
const uiProgress = read("src/components/ui/progress.tsx");
const uiR3FLoadingCard = read("src/components/ui/r3f-loading-card.tsx");
const uiSelect = read("src/components/ui/select.tsx");
const uiSectionTitle = read("src/components/ui/section-title.tsx");
const uiSlider = read("src/components/ui/slider.tsx");
const uiStatusBadge = read("src/components/ui/status-badge.tsx");
const uiSurgeryAction = read("src/components/ui/surgery-action.tsx");
const uiSurgeryFeedback = read("src/components/ui/surgery-feedback.tsx");
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
const workerContract = read("src/workers/workflowWorkerContract.ts");
const workerClient = read("src/services/workflowWorkerClient.ts");
const workflowPlanner = read("src/services/workflowPlanner.ts");
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
const layoutPrimitiveNames = new Set(["ReactShell.tsx", "StageShell.tsx", "WorkbenchLayout.tsx"]);
const stagePanelSources = new Map([
  ["AnnotateStagePanel.tsx", annotateStagePanel],
  ["IncisionStagePanel.tsx", incisionStagePanel],
  ["LiveStagePanel.tsx", liveStagePanel],
  ["SurgeryStagePanel.tsx", surgeryStagePanel],
]);
const libraryPanelSources = new Map([
  ["AnnotateLineLibraryPanel.tsx", annotateLineLibraryPanel],
  ["CandidateLibraryPanel.tsx", candidateLibraryPanel],
]);
const legendConsumerSources = new Map([
  ["IncisionStagePanel.tsx", incisionStagePanel],
  ["SurgeryMetricsPanel.tsx", surgeryMetricsPanel],
]);
const assetLoadingConsumerSources = new Map([
  ["IncisionStagePanel.tsx", incisionStagePanel],
]);
const r3fLoadingConsumerSources = new Map([
  ["SurgeryR3FScene.tsx", surgeryR3FScene],
  ["ThreePreviewScene.tsx", threePreviewScene],
]);
const annotateStatusConsumerSources = new Map([
  ["AnnotateDrawPanel.tsx", annotateDrawPanel],
]);
const surgeryActionConsumerSources = new Map([
  ["SurgeryControlsPanel.tsx", surgeryControlsPanel],
]);
const surgeryFeedbackConsumerSources = new Map([
  ["SurgeryMetricsPanel.tsx", surgeryMetricsPanel],
]);
const privacyAuditConsumerSources = new Map([
  ["PrivacyAuditPanel.tsx", privacyAuditPanel],
]);
const buttonVisibilityConsumerSources = new Map([
  ["AnnotateMeshSourcePanel.tsx", annotateMeshSourcePanel],
  ["LiveRenderControlsPanel.tsx", liveRenderControlsPanel],
]);
const incisionFormVisibilityConsumerSources = new Map([
  ["EditControlsPanel.tsx", editPanel],
  ["SecondaryCuePanel.tsx", secondaryCuePanel],
  ["TumorInputPanel.tsx", tumorPanel],
]);
const liveVisibilityConsumerSources = new Map([
  ["LiveRenderControlsPanel.tsx", liveRenderControlsPanel],
  ["LiveRouteControlsPanel.tsx", liveRouteControlsPanel],
]);
const liveQualityFeedbackConsumerSources = new Map([
  ["LiveQualityPanel.tsx", liveQualityPanel],
]);
const liveScanFeedbackConsumerSources = new Map([
  ["LiveRouteControlsPanel.tsx", liveRouteControlsPanel],
]);
const cardHeaderTitleConsumerSources = new Map([
  ["AnnotateStatePanel.tsx", annotateStatePanel],
  ["IncisionStatePanel.tsx", incisionStatePanel],
  ["LiveQualityPanel.tsx", liveQualityPanel],
  ["LiveStatePanel.tsx", liveStatePanel],
  ["WorkerStatusPanel.tsx", workerPanel],
]);
const reactShellConsumerSources = new Map([
  ["App.tsx", app],
  ["DashboardRoute.tsx", dashboardRoute],
  ["ThreePreviewRoute.tsx", threeRoute],
  ["ThreePreviewSidebar.tsx", threePreviewSidebar],
]);
const helpDisclosureConsumerSources = new Map([
  ["AnnotateHelpPanel.tsx", annotateHelpPanel],
  ["SurgeryHelpPanel.tsx", surgeryHelpPanel],
]);
const fieldValueConsumerSources = new Map([
  ["EditControlsPanel.tsx", editPanel],
  ["LiveRenderControlsPanel.tsx", liveRenderControlsPanel],
  ["ProviderConfigPanel.tsx", providerPanel],
  ["TumorInputPanel.tsx", tumorPanel],
]);
const agentNoteConsumerSources = new Map([
  ["EditControlsPanel.tsx", editPanel],
  ["ProviderConfigPanel.tsx", providerPanel],
  ["ReviewControlsPanel.tsx", reviewPanel],
  ["SecondaryCuePanel.tsx", secondaryCuePanel],
  ["TumorInputPanel.tsx", tumorPanel],
]);
const incisionFeedbackConsumerSources = new Map([
  ["CandidateResultPanel.tsx", candidateResultPanel],
  ["TumorInputPanel.tsx", tumorPanel],
]);
const incisionStatusConsumerSources = new Map([
  ["EditControlsPanel.tsx", editPanel],
  ["ProviderConfigPanel.tsx", providerPanel],
  ["ReviewControlsPanel.tsx", reviewPanel],
]);
const reactUiConsumerSources = new Map([
  ["App.tsx", app],
  ...[...componentSources.entries()].filter(([name]) => !layoutPrimitiveNames.has(name)),
  ...routeSources,
]);
const consumersWithRawClass = (className) => (
  [...reactUiConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
    ))
    .map(([name]) => name)
);
const stagePanelsWithRawClass = (className) => (
  [...stagePanelSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
    ))
    .map(([name]) => name)
);
const libraryPanelsWithRawClass = (className) => (
  [...libraryPanelSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const legendConsumersWithRawClass = (className) => (
  [...legendConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const reactShellConsumersWithRawClass = (className) => (
  [...reactShellConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const helpDisclosureConsumersWithRawClass = (className) => (
  [...helpDisclosureConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const fieldValueConsumersWithRawClass = (className) => (
  [...fieldValueConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const agentNoteConsumersWithRawClass = (className) => (
  [...agentNoteConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const incisionFeedbackConsumersWithRawClass = (className) => (
  [...incisionFeedbackConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const incisionStatusConsumersWithRawClass = (className) => (
  [...incisionStatusConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const assetLoadingConsumersWithRawClass = (className) => (
  [...assetLoadingConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const r3fLoadingConsumersWithRawClass = (className) => (
  [...r3fLoadingConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ${className} `)
    ))
    .map(([name]) => name)
);
const annotateStatusConsumersWithRawClass = (className) => (
  [...annotateStatusConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const surgeryActionConsumersWithRawClass = (className) => (
  [...surgeryActionConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const surgeryFeedbackConsumersWithRawClass = (className) => (
  [...surgeryFeedbackConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const privacyAuditConsumersWithRawClass = (className) => (
  [...privacyAuditConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ? "${className}`)
      || source.includes(`: "${className}`)
    ))
    .map(([name]) => name)
);
const buttonVisibilityConsumersWithRawHidden = () => (
  [...buttonVisibilityConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes('className={showFlame ? "" : "hidden"}')
      || source.includes('className={showFittedFlame ? "" : "hidden"}')
      || source.includes('className={atlasPreview?.active ? "" : "hidden"}')
    ))
    .map(([name]) => name)
);
const incisionFormVisibilityConsumersWithRawHidden = () => (
  [...incisionFormVisibilityConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes("function hiddenClass")
      || source.includes("hiddenClass(")
      || source.includes('className="hidden"')
      || source.includes(' ? "" : "hidden"')
      || source.includes(': "hidden"')
      || source.includes('`two-cols ${')
    ))
    .map(([name]) => name)
);
const liveVisibilityConsumersWithRawHidden = () => (
  [...liveVisibilityConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes('className="hidden"')
      || source.includes(' ? undefined : "hidden"')
      || source.includes(' ? "" : "hidden"')
      || source.includes(': "hidden"')
      || source.includes('" hidden"')
      || source.includes('`scan-panel${')
      || source.includes('`two-cols ${')
    ))
    .map(([name]) => name)
);
const liveQualityFeedbackConsumersWithRawClass = (className) => (
  [...liveQualityFeedbackConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ${className} `)
      || source.includes(` ${className}"`)
    ))
    .map(([name]) => name)
);
const liveScanFeedbackConsumersWithRawClass = (className) => (
  [...liveScanFeedbackConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
      || source.includes(` ${className} `)
      || source.includes(` ${className}"`)
    ))
    .map(([name]) => name)
);
const cardHeaderTitleConsumersWithRawClass = (className) => (
  [...cardHeaderTitleConsumerSources.entries()]
    .filter(([, source]) => (
      source.includes(`className="${className}`)
      || source.includes(`className={\`${className}`)
      || source.includes(`className={cn("${className}`)
    ))
    .map(([name]) => name)
);

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
assert.deepEqual(
  vercelConfig.git?.deploymentEnabled,
  {
    "*": false,
    master: true,
    "React-架构重构": true,
  },
  "Vercel should only auto-deploy production and the active React refactor preview branch",
);
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
for (const [componentName, className] of [
  ["ReactPage", "react-page"],
  ["ReactShell", "react-shell"],
  ["ReactShellSidebar", "react-shell-sidebar"],
  ["ReactShellMain", "react-shell-main"],
  ["ReactShellNavLink", "react-nav-link"],
  ["ReactShellExternalLink", "react-nav-link"],
]) {
  assert.ok(reactShell.includes(componentName), `React shell primitive exports ${componentName}`);
  assert.ok(reactShell.includes(className), `React shell primitive preserves ${className} styling`);
}
assert.ok(reactShell.includes("react-router-dom"), "React shell primitive supports Router links");
assert.ok(app.includes("ReactPage"), "React route fallback uses the shared React page primitive");
assert.ok(dashboardRoute.includes("ReactShellNavLink"), "React dashboard uses shared shell nav links");
assert.ok(dashboardRoute.includes("ReactShellExternalLink"), "React dashboard uses shared shell external nav links");
assert.ok(threeRoute.includes("ReactShellMain"), "R3F preview route uses the shared shell main primitive");
assert.ok(threePreviewSidebar.includes("ReactShellSidebar"), "R3F preview sidebar uses the shared shell sidebar primitive");
for (const className of [
  "react-page",
  "react-shell",
  "react-shell-sidebar",
  "react-shell-main",
  "react-nav-link",
]) {
  assert.deepEqual(
    reactShellConsumersWithRawClass(className),
    [],
    `React shell consumers should use shared shell primitives instead of hand-written ${className} class wrappers`,
  );
}
assert.ok(controllerCommand.includes("ControllerCommandDetail"), "React controller command helper keeps command payloads typed");
assert.ok(controllerCommand.includes("dispatchControllerEvent"), "React controller command helper exposes generic controller events");
assert.ok(controllerCommand.includes("dispatchControllerCommand"), "React controller command helper exposes command dispatch");
assert.ok(controllerCommand.includes("CustomEvent<TDetail>"), "React controller command helper preserves typed CustomEvent details");
assert.ok(controllerCommand.includes("window.dispatchEvent"), "React controller command helper centralizes browser event dispatch");
assert.ok(controllerCommand.includes("readControllerCommandDetail"), "React controller command helper exposes runtime command detail parsing");
assert.ok(controllerCommand.includes("commands.includes"), "React controller command helper validates incoming command names against runtime command sets");
assert.ok(controllerCommand.includes("bindWindowControllerEvents"), "React controller command helper centralizes window event binding cleanup");
assert.ok(controllerCommand.includes("AddEventListenerOptions"), "React controller command helper can receive AbortSignal-backed listener options");
assert.ok(controllerCommand.includes("window.addEventListener"), "React controller command helper owns window listener registration");
assert.ok(controllerCommand.includes("window.removeEventListener"), "React controller command helper owns window listener cleanup");
for (const helperName of [
  "dispatchLiveSourceCommand",
  "dispatchLiveRenderCommand",
  "dispatchLiveRouteCommand",
  "dispatchAnnotateMeshCommand",
  "dispatchAnnotateDrawCommand",
  "dispatchAnnotateLibraryCommand",
  "dispatchIncisionTumorCommand",
  "dispatchIncisionProviderState",
  "dispatchIncisionSecondaryCueCommand",
  "dispatchIncisionEditCommand",
  "dispatchIncisionReviewCommand",
  "dispatchIncisionLibraryCommand",
]) {
  assert.ok(controllerCommand.includes(`export function ${helperName}`), `React controller command helper exports ${helperName}`);
}
for (const commandType of [
  "LiveSourceCommand",
  "LiveRenderCommand",
  "LiveRouteCommand",
  "AnnotateMeshCommand",
  "AnnotateDrawCommand",
  "AnnotateLibraryCommand",
  "IncisionTumorCommand",
  "IncisionSecondaryCueCommand",
  "IncisionEditCommand",
  "IncisionReviewCommand",
  "IncisionLibraryCommand",
]) {
  assert.ok(controllerCommand.includes(`export type ${commandType}`), `React controller command helper types ${commandType}`);
}
for (const commandSet of [
  "LIVE_SOURCE_COMMANDS",
  "LIVE_RENDER_COMMANDS",
  "LIVE_ROUTE_COMMANDS",
  "ANNOTATE_MESH_COMMANDS",
  "ANNOTATE_DRAW_COMMANDS",
  "ANNOTATE_LIBRARY_COMMANDS",
  "INCISION_TUMOR_COMMANDS",
  "INCISION_SECONDARY_CUE_COMMANDS",
  "INCISION_EDIT_COMMANDS",
  "INCISION_REVIEW_COMMANDS",
  "INCISION_LIBRARY_COMMANDS",
]) {
  assert.ok(controllerCommand.includes(`export const ${commandSet}`), `React controller command helper exports runtime ${commandSet}`);
}
for (const eventName of [
  "LIVE_CONTROLLER_STATE_EVENT",
  "LIVE_SOURCE_REACT_COMMAND_EVENT",
  "LIVE_RENDER_REACT_COMMAND_EVENT",
  "LIVE_ROUTE_REACT_COMMAND_EVENT",
  "ANNOTATE_CONTROLLER_STATE_EVENT",
  "ANNOTATE_MESH_REACT_COMMAND_EVENT",
  "ANNOTATE_DRAW_REACT_COMMAND_EVENT",
  "ANNOTATE_LIBRARY_REACT_COMMAND_EVENT",
  "INCISION_CONTROLLER_STATE_EVENT",
  "INCISION_PROVIDER_REACT_STATE_EVENT",
  "INCISION_TUMOR_REACT_COMMAND_EVENT",
  "INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT",
  "INCISION_EDIT_REACT_COMMAND_EVENT",
  "INCISION_REVIEW_REACT_COMMAND_EVENT",
  "INCISION_LIBRARY_REACT_COMMAND_EVENT",
]) {
  assert.ok(controllerEvents.includes(`export const ${eventName}`), `shared controller event module exports ${eventName}`);
}
for (const schemaName of [
  "LIVE_SNAPSHOT_SCHEMA_VERSION",
  "ANNOTATE_SNAPSHOT_SCHEMA_VERSION",
  "INCISION_SNAPSHOT_SCHEMA_VERSION",
]) {
  assert.ok(controllerSnapshotSchemas.includes(`export const ${schemaName}`), `shared snapshot schema module exports ${schemaName}`);
}
assert.ok(reactManagedWorkbench.includes("REACT_MANAGED_WORKBENCH_FLAG"), "shared React-managed flag module exports the global flag name");
assert.ok(reactManagedWorkbench.includes('"__LANGERFACE_REACT_MANAGED__"'), "shared React-managed flag module owns the legacy global flag string");
assert.ok(reactManagedWorkbench.includes("isReactManagedWorkbench"), "shared React-managed flag module exposes a read helper");
assert.ok(reactManagedWorkbench.includes("captureReactManagedWorkbench"), "shared React-managed flag module captures the previous flag value");
assert.ok(reactManagedWorkbench.includes("enableReactManagedWorkbench"), "shared React-managed flag module enables React-managed mode");
assert.ok(reactManagedWorkbench.includes("restoreReactManagedWorkbench"), "shared React-managed flag module restores or deletes the previous flag value");
assert.ok(workbenchLayout.includes('cn("app"'), "React WorkbenchLayout preserves the legacy app shell class");
assert.ok(workbenchLayout.includes('className="sidebar"'), "React WorkbenchLayout preserves the legacy sidebar class");
assert.ok(workbenchLayout.includes('cn("disclaimer"'), "React Disclaimer preserves the legacy disclaimer class");
assert.ok(stageShell.includes('cn("stage"'), "React StageShell preserves the legacy stage class");
assert.ok(stageShell.includes('className="stage-top"'), "React StageShell preserves the legacy stage top class");
assert.ok(stageShell.includes('cn("stage-body"'), "React StageShell preserves the legacy stage body class");
assert.ok(stageShell.includes('cn("stage-actions"'), "React StageActions preserves the legacy stage actions class");
assert.ok(stageShell.includes('cn("main-wrap"'), "React StageViewport preserves the legacy main-wrap class");
assert.ok(stageShell.includes('cn("stage-link"'), "React StageLink preserves the legacy stage link class");
assert.ok(stageShell.includes("StageStatus"), "React StageShell exports a stage status primitive");
assert.ok(stageShell.includes('cn("live"'), "React StageStatus preserves the legacy live status class");
assert.ok(stageShell.includes('className="dot"'), "React StageStatus preserves the legacy status dot class");
assert.ok(stageShell.includes('active && "on"'), "React StageStatus can preserve the active status class");
assert.ok(stageShell.includes("StageMeta"), "React StageShell exports a stage metadata primitive");
assert.ok(stageShell.includes('cn("fps"'), "React StageMeta preserves the legacy fps metadata class");
assert.ok(stageShell.includes('variant === "meta" && "fps"'), "React StageLink can preserve fps-styled stage links");
assert.ok(stageShell.includes("StageCanvas"), "React StageShell exports a canvas primitive");
assert.ok(stageShell.includes('mirror && "mirror"'), "React StageCanvas preserves mirror styling through a typed prop");
assert.ok(stageShell.includes("visible?: boolean"), "React StageShell visibility primitives expose typed visible props");
assert.ok(stageShell.includes('hiddenClassName = "hidden"'), "React StageShell visibility primitives default to the legacy hidden class");
assert.ok(stageShell.includes("StageToast"), "React StageShell exports a scan toast primitive");
assert.ok(stageShell.includes('cn("scan-toast"'), "React StageToast preserves the legacy scan toast class");
assert.ok(stageShell.includes("StageOverlayMessage"), "React StageShell exports an overlay message primitive");
assert.ok(stageShell.includes('cn("overlay-msg"'), "React StageOverlayMessage preserves the legacy overlay message class");
assert.ok(stageShell.includes("StageZoomStrip"), "React StageShell exports a zoom strip primitive");
assert.ok(stageShell.includes('cn("zoom-strip"'), "React StageZoomStrip preserves the legacy zoom strip class");
for (const className of ["live", "dot", "fps", "hidden", "mirror", "scan-toast", "overlay-msg", "zoom-strip"]) {
  assert.deepEqual(
    stagePanelsWithRawClass(className),
    [],
    `React stage panels should use StageShell primitives instead of hand-written ${className} class wrappers`,
  );
}
assert.ok(uiButton.includes("@radix-ui/react-slot"), "shadcn-style Button supports asChild through Radix Slot");
assert.ok(uiButton.includes("class-variance-authority"), "shadcn-style Button uses variant composition");
assert.ok(uiButton.includes("workbenchPrimary"), "shadcn-style Button can preserve legacy workbench button styling");
assert.ok(uiButton.includes("miniDanger"), "shadcn-style Button can preserve compact destructive button styling");
assert.ok(uiButton.includes("visible?: boolean"), "shadcn-style Button exposes a typed visibility prop");
assert.ok(uiButton.includes('hiddenClassName = "hidden"'), "shadcn-style Button defaults invisible buttons to the legacy hidden class");
assert.ok(uiButton.includes("!visible && hiddenClassName"), "shadcn-style Button centralizes hidden class application");
assert.deepEqual(
  buttonVisibilityConsumersWithRawHidden(),
  [],
  "React button consumers should use Button visible instead of hand-written hidden class toggles",
);
assert.ok(annotateMeshSourcePanel.includes("visible={showFlame}"), "React annotation mesh source panel uses Button visible for optional FLAME action");
assert.ok(annotateMeshSourcePanel.includes("visible={showFittedFlame}"), "React annotation mesh source panel uses Button visible for optional fitted FLAME action");
assert.ok(liveRenderControlsPanel.includes("visible={Boolean(atlasPreview?.active)}"), "React live render panel uses Button visible for restore atlas action");
assert.ok(uiButtonRow.includes('cn("btn-row"'), "shadcn-style ButtonRow preserves existing button row styling");
assert.ok(uiButtonRow.includes("visible?: boolean"), "shadcn-style ButtonRow exposes a typed visibility prop");
assert.ok(uiButtonRow.includes('hiddenClassName = "hidden"'), "shadcn-style ButtonRow defaults invisible rows to the legacy hidden class");
assert.ok(uiButtonRow.includes("!visible && hiddenClassName"), "shadcn-style ButtonRow centralizes hidden class application");
assert.ok(uiCard.includes("CardHeader"), "shadcn-style Card exposes a header primitive");
assert.ok(uiCard.includes("CardHeaderTitle"), "shadcn-style Card exposes a header title primitive");
assert.ok(uiCard.includes('cn("inline-flex items-center gap-2"'), "shadcn-style CardHeaderTitle preserves compact icon-title alignment");
assert.ok(uiCard.includes("CardContent"), "shadcn-style Card exposes a content primitive");
assert.ok(uiCard.includes('cn("card"'), "shadcn-style Card preserves existing card styling");
assert.ok(uiCard.includes("@radix-ui/react-slot"), "shadcn-style Card supports asChild through Radix Slot");
assert.ok(uiCard.includes("asChild?: boolean"), "shadcn-style Card exposes an asChild prop for semantic containers");
assert.ok(uiCard.includes("visible?: boolean"), "shadcn-style Card exposes a typed visibility prop");
assert.ok(uiCard.includes('hiddenClassName = "hidden"'), "shadcn-style Card defaults invisible cards to the legacy hidden class");
assert.ok(uiCard.includes("!visible && hiddenClassName"), "shadcn-style Card centralizes hidden class application");
assert.deepEqual(
  [...componentSources.entries()]
    .filter(([, source]) => source.includes('className="card'))
    .map(([name]) => name),
  [],
  "React component panels should use the shared Card primitive instead of raw card class wrappers",
);
assert.deepEqual(
  cardHeaderTitleConsumersWithRawClass("inline-flex items-center gap-2"),
  [],
  "React state panels should use CardHeaderTitle instead of hand-written icon-title class wrappers",
);
for (const [name, source] of cardHeaderTitleConsumerSources.entries()) {
  assert.ok(source.includes("CardHeaderTitle"), `${name} should render icon-title headers through CardHeaderTitle`);
}
assert.ok(uiCheckbox.includes('type="checkbox"'), "shadcn-style Checkbox preserves native checkbox behavior");
assert.ok(uiCheckboxField.includes("visible?: boolean"), "shadcn-style CheckboxField exposes a typed visibility prop");
assert.ok(uiCheckboxField.includes('hiddenClassName = "hidden"'), "shadcn-style CheckboxField defaults invisible rows to the legacy hidden class");
assert.ok(uiCheckboxField.includes("!visible && hiddenClassName"), "shadcn-style CheckboxField centralizes hidden class application");
assert.ok(uiFieldGroup.includes("FieldGroup"), "shadcn-style form primitives export FieldGroup");
assert.ok(uiFieldGroup.includes("visible?: boolean"), "shadcn-style FieldGroup exposes a typed visibility prop");
assert.ok(uiFieldGroup.includes('hiddenClassName = "hidden"'), "shadcn-style FieldGroup defaults invisible groups to the legacy hidden class");
assert.ok(uiFieldGroup.includes("!visible && hiddenClassName"), "shadcn-style FieldGroup centralizes hidden class application");
assert.deepEqual(
  incisionFormVisibilityConsumersWithRawHidden(),
  [],
  "React incision form panels should use FieldGroup/ButtonRow visible and native hidden inputs instead of hand-written hidden classes",
);
assert.ok(tumorPanel.includes("FieldGroup"), "React tumor input panel uses FieldGroup for conditional tumor fields");
assert.ok(tumorPanel.includes('id="depthWrap" visible={!cutaneous}'), "React tumor input panel shows depth only for subcutaneous lesions through FieldGroup visible");
assert.ok(tumorPanel.includes('id="marginWrap" visible={cutaneous}'), "React tumor input panel shows cutaneous margin through FieldGroup visible");
assert.ok(tumorPanel.includes('id="ellipseWrap" visible={cutaneous && boundaryMode === "ellipse"}'), "React tumor input panel shows ellipse controls through FieldGroup visible");
assert.ok(tumorPanel.includes('id="freehandControls" visible={freehand}'), "React tumor input panel shows freehand controls through ButtonRow visible");
assert.ok(tumorPanel.includes('<Input id="tumorImportFile" hidden'), "React tumor input panel uses native hidden file input semantics");
assert.ok(editPanel.includes("FieldGroup"), "React edit controls panel uses FieldGroup for conditional edit controls");
assert.ok(editPanel.includes('id="widthScaleWrap" visible={widthScaleVisible}'), "React edit controls panel shows width scale through FieldGroup visible");
assert.ok(secondaryCuePanel.includes('<Input id="secondaryCueImportFile" hidden'), "React secondary cue panel uses native hidden file input semantics");
assert.ok(uiHelpDisclosure.includes("HelpDisclosure"), "shadcn-style help disclosure primitive exports HelpDisclosure");
assert.ok(uiHelpDisclosure.includes('cn("help-doc"'), "shadcn-style help disclosure primitive preserves existing help-doc styling");
assert.ok(uiHelpDisclosure.includes("<Card asChild"), "shadcn-style help disclosure primitive preserves Card asChild semantics");
assert.ok(uiHelpDisclosure.includes("<details"), "shadcn-style help disclosure primitive owns native details semantics");
assert.ok(uiHelpDisclosure.includes("<summary>"), "shadcn-style help disclosure primitive owns native summary semantics");
for (const className of ["help-doc"]) {
  assert.deepEqual(
    helpDisclosureConsumersWithRawClass(className),
    [],
    `React help panels should use HelpDisclosure instead of hand-written ${className} class wrappers`,
  );
}
for (const [name, source] of helpDisclosureConsumerSources.entries()) {
  assert.ok(source.includes("HelpDisclosure"), `${name} should render help through the shared HelpDisclosure primitive`);
  assert.ok(!source.includes("<details"), `${name} should not hand-write native details wrappers`);
  assert.ok(!source.includes("<summary"), `${name} should not hand-write native summary wrappers`);
  assert.ok(!source.includes("<Card asChild"), `${name} should not hand-write card-backed disclosure wrappers`);
}
assert.ok(uiInput.includes('cn("text-input"'), "shadcn-style Input preserves existing text input styling");
assert.ok(uiLabel.includes('cn("field-label"'), "shadcn-style Label preserves existing field label styling");
assert.ok(uiLabel.includes("FieldValue"), "shadcn-style Label module exports a FieldValue primitive");
assert.ok(uiLabel.includes('cn("val"'), "shadcn-style FieldValue preserves existing inline value styling");
assert.deepEqual(
  fieldValueConsumersWithRawClass("val"),
  [],
  "React form panels should use FieldValue instead of hand-written val spans",
);
for (const [name, source] of fieldValueConsumerSources.entries()) {
  assert.ok(source.includes("FieldValue"), `${name} should render inline slider values through the shared FieldValue primitive`);
}
assert.ok(uiSelect.includes('cn("select"'), "shadcn-style Select preserves existing select styling");
assert.ok(uiSlider.includes('type="range"'), "shadcn-style RangeInput preserves native range input behavior");
assert.ok(uiTextarea.includes('cn("text-area"'), "shadcn-style Textarea preserves existing textarea styling");
assert.ok(uiCheckboxField.includes('cn("check"'), "shadcn-style CheckboxField preserves existing checkbox row styling");
assert.ok(uiCheckboxField.includes("CheckboxProps"), "shadcn-style CheckboxField forwards typed native checkbox props");
assert.deepEqual(
  [...componentSources.entries()]
    .filter(([, source]) => source.includes('className="check') || source.includes("className={`check"))
    .map(([name]) => name),
  [],
  "React component checkbox rows should use CheckboxField instead of hand-written label.check wrappers",
);
assert.ok(uiSectionTitle.includes('cn("section-title"'), "shadcn-style SectionTitle preserves existing section title styling");
assert.ok(uiSectionTitle.includes("valueProps"), "shadcn-style SectionTitle can preserve value span ids");
assert.ok(uiHint.includes('cn("hint"'), "shadcn-style Hint preserves existing hint styling");
assert.ok(uiHint.includes("AgentNote"), "shadcn-style Hint module exports an AgentNote primitive");
assert.ok(uiHint.includes('cn("agent-note"'), "shadcn-style AgentNote preserves existing agent-note styling");
assert.ok(uiHint.includes("visible?: boolean"), "shadcn-style Hint/AgentNote expose a typed visibility prop");
assert.ok(uiHint.includes('hiddenClassName = "hidden"'), "shadcn-style Hint/AgentNote default invisible copy to the legacy hidden class");
assert.ok(uiHint.includes("!visible && hiddenClassName"), "shadcn-style Hint/AgentNote centralize hidden class application");
assert.deepEqual(
  agentNoteConsumersWithRawClass("agent-note"),
  [],
  "React incision note panels should use AgentNote instead of hand-written agent-note paragraphs",
);
for (const [name, source] of agentNoteConsumerSources.entries()) {
  assert.ok(source.includes("AgentNote"), `${name} should render incision explanatory notes through the shared AgentNote primitive`);
}
for (const [componentName, className] of [
  ["BoundaryStatus", "boundary-status"],
  ["AnatomyPreview", "anatomy-preview"],
  ["GuardrailDetails", "guardrail-details"],
]) {
  assert.ok(uiIncisionFeedback.includes(componentName), `shadcn-style incision feedback primitive exports ${componentName}`);
  assert.ok(uiIncisionFeedback.includes(className), `shadcn-style incision feedback primitive preserves ${className} styling`);
}
assert.ok(uiIncisionFeedback.includes('warn && "warn"'), "incision feedback text primitives preserve warn styling");
assert.ok(uiIncisionFeedback.includes('tone !== "neutral" && tone'), "guardrail feedback text primitive preserves warn/danger tone styling");
for (const className of ["boundary-status", "anatomy-preview", "guardrail-details"]) {
  assert.deepEqual(
    incisionFeedbackConsumersWithRawClass(className),
    [],
    `React incision feedback panels should use shared feedback primitives instead of hand-written ${className} wrappers`,
  );
}
assert.ok(tumorPanel.includes("BoundaryStatus"), "React tumor panel uses the shared boundary status primitive");
assert.ok(tumorPanel.includes("AnatomyPreview"), "React tumor panel uses the shared anatomy preview primitive");
assert.ok(candidateResultPanel.includes("GuardrailDetails"), "React candidate result panel uses the shared guardrail details primitive");
for (const componentName of [
  "ProviderConnectionStatus",
  "EditStatus",
  "ReviewStatus",
]) {
  assert.ok(uiIncisionStatus.includes(componentName), `shadcn-style incision status primitive exports ${componentName}`);
}
for (const className of [
  "provider-state-${tone}",
  "edit-status",
  "review-state",
]) {
  assert.ok(uiIncisionStatus.includes(className), `shadcn-style incision status primitive preserves ${className} styling`);
}
assert.ok(uiIncisionStatus.includes('active && "active"'), "incision edit status primitive preserves active styling");
for (const className of ["provider-state-", "edit-status", "review-state"]) {
  assert.deepEqual(
    incisionStatusConsumersWithRawClass(className),
    [],
    `React incision status panels should use shared status primitives instead of hand-written ${className} wrappers`,
  );
}
assert.ok(providerPanel.includes("ProviderConnectionStatus"), "React provider panel uses the shared provider connection status primitive");
assert.ok(editPanel.includes("EditStatus"), "React edit panel uses the shared edit status primitive");
assert.ok(reviewPanel.includes("ReviewStatus"), "React review panel uses the shared review status primitive");
assert.ok(uiStatusBadge.includes('cn("badge"'), "shadcn-style StatusBadge preserves existing badge styling");
assert.ok(uiStatusBadge.includes('cn("react-route-status"'), "shadcn-style RouteStatus preserves existing route status styling");
assert.ok(uiStatusBadge.includes("@radix-ui/react-slot"), "shadcn-style StatusBadge supports asChild through Radix Slot");
assert.ok(uiKeyValue.includes("KeyValueGrid"), "shadcn-style key/value primitives expose a neutral grid");
assert.ok(uiKeyValue.includes("KeyValueItem"), "shadcn-style key/value primitives expose a neutral item");
assert.ok(uiKeyValue.includes("visible?: boolean"), "shadcn-style key/value grids expose a typed visibility prop");
assert.ok(uiKeyValue.includes('hiddenClassName = "hidden"'), "shadcn-style key/value grids default invisible content to the legacy hidden class");
assert.ok(uiKeyValue.includes("!visible && hiddenClassName"), "shadcn-style key/value grids centralize hidden class application");
assert.ok(uiKeyValue.includes('cn("metric-grid"'), "shadcn-style MetricGrid preserves existing metric grid styling");
assert.ok(uiKeyValue.includes('cn("metric"'), "shadcn-style MetricItem preserves existing metric styling");
assert.ok(uiKeyValue.includes('cn("stat-grid"'), "shadcn-style StatGrid preserves existing stat grid styling");
assert.ok(uiKeyValue.includes('cn("stat"'), "shadcn-style StatItem preserves existing stat styling");
assert.ok(uiLiveFeedback.includes("LiveOverlayQa"), "shadcn-style live feedback primitives export LiveOverlayQa");
assert.ok(uiLiveFeedback.includes('cn("overlay-qa"'), "shadcn-style LiveOverlayQa preserves existing overlay QA styling");
assert.ok(uiLiveFeedback.includes("tone !== \"neutral\" && tone"), "shadcn-style LiveOverlayQa preserves ok/warn tone classes");
assert.ok(uiLiveFeedback.includes("visible?: boolean"), "shadcn-style LiveOverlayQa exposes a typed visibility prop");
assert.ok(uiLiveFeedback.includes('hiddenClassName = "hidden"'), "shadcn-style LiveOverlayQa defaults invisible QA to the legacy hidden class");
assert.ok(uiLiveFeedback.includes("LiveOverlayQaHeader"), "shadcn-style live feedback primitives export LiveOverlayQaHeader");
assert.ok(uiLiveFeedback.includes('cn("overlay-qa-top"'), "shadcn-style LiveOverlayQaHeader preserves existing overlay QA header styling");
assert.ok(uiLiveFeedback.includes("LiveScanPanel"), "shadcn-style live feedback primitives export LiveScanPanel");
assert.ok(uiLiveFeedback.includes('cn("scan-panel"'), "shadcn-style LiveScanPanel preserves existing scan panel styling");
assert.ok(uiLiveFeedback.includes("LiveScanRow"), "shadcn-style live feedback primitives export LiveScanRow");
assert.ok(uiLiveFeedback.includes('cn("scan-row"'), "shadcn-style LiveScanRow preserves existing scan row styling");
assert.ok(uiLiveFeedback.includes("LiveYawMeter"), "shadcn-style live feedback primitives export LiveYawMeter");
assert.ok(uiLiveFeedback.includes('cn("yaw-meter"'), "shadcn-style LiveYawMeter preserves existing yaw meter styling");
for (const [componentName, className] of [
  ["Legend", "legend"],
  ["Legend", "canvas-legend"],
  ["LegendSwatch", "legend-sw"],
  ["CanvasLegendItem", "legend-item"],
  ["CanvasLegendItem", "legend-swatch"],
]) {
  assert.ok(uiLegend.includes(componentName), `shadcn-style legend primitive exports ${componentName}`);
  assert.ok(uiLegend.includes(className), `shadcn-style legend primitive preserves ${className} styling`);
}
for (const className of [
  "legend",
  "canvas-legend",
  "legend-sw",
  "legend-item",
  "legend-swatch",
]) {
  assert.deepEqual(
    legendConsumersWithRawClass(className),
    [],
    `React legend consumers should use shared legend primitives instead of hand-written ${className} class wrappers`,
  );
}
for (const [componentName, className] of [
  ["CandidateList", "candidate-list"],
  ["CandidateRow", "candidate-row"],
  ["CandidateRowTop", "top"],
  ["CandidateRowMeta", "meta"],
  ["CandidateRowStatus", "danger-text"],
  ["LineList", "line-list"],
  ["LineRow", "line-row"],
  ["LineMain", "line-main"],
  ["LineMeta", "line-meta"],
  ["LineWarning", "line-warning"],
  ["LineActions", "line-actions"],
  ["LineEmpty", "line-empty"],
]) {
  assert.ok(uiLibraryList.includes(componentName), `shadcn-style library list primitive exports ${componentName}`);
  assert.ok(uiLibraryList.includes(className), `shadcn-style library list primitive preserves ${className} styling`);
}
for (const className of [
  "candidate-list",
  "candidate-row",
  "top",
  "meta",
  "line-list",
  "line-row",
  "line-main",
  "line-meta",
  "line-warning",
  "line-actions",
  "line-empty",
]) {
  assert.deepEqual(
    libraryPanelsWithRawClass(className),
    [],
    `React library panels should use shared list primitives instead of hand-written ${className} class wrappers`,
  );
}
assert.ok(uiProgress.includes('cn("bar"'), "shadcn-style ProgressBar preserves existing progress track styling");
assert.ok(uiProgress.includes('cn("bar-fill"'), "shadcn-style ProgressBar preserves existing progress fill styling");
assert.ok(uiProgress.includes("fillProps"), "shadcn-style ProgressBar can preserve controller-owned fill ids");
assert.ok(uiProgress.includes("clampPercent"), "shadcn-style ProgressBar clamps React-controlled percentage values");
assert.ok(uiLoadingOverlay.includes("AssetLoadingOverlay"), "shadcn-style loading overlay primitive exports AssetLoadingOverlay");
assert.ok(uiLoadingOverlay.includes('cn("asset-loading"'), "shadcn-style loading overlay preserves existing asset-loading styling");
assert.ok(uiLoadingOverlay.includes('className="asset-spinner"'), "shadcn-style loading overlay preserves existing spinner styling");
assert.ok(uiLoadingOverlay.includes('!visible && "hidden"'), "shadcn-style loading overlay preserves hidden state styling");
for (const className of ["asset-loading", "asset-spinner"]) {
  assert.deepEqual(
    assetLoadingConsumersWithRawClass(className),
    [],
    `React asset loading consumers should use AssetLoadingOverlay instead of hand-written ${className} wrappers`,
  );
}
assert.ok(incisionStagePanel.includes("AssetLoadingOverlay"), "React incision stage uses the shared asset loading overlay primitive");
assert.ok(uiAnnotateStatus.includes("CurrentLineStatus"), "shadcn-style annotation status primitive exports CurrentLineStatus");
assert.ok(uiAnnotateStatus.includes('cn("current-state"'), "annotation status primitive preserves current-state styling");
assert.ok(uiAnnotateStatus.includes('active && "active"'), "annotation status primitive preserves active styling");
assert.ok(uiAnnotateStatus.includes('warn && "warning"'), "annotation status primitive preserves fallback warning styling");
assert.deepEqual(
  annotateStatusConsumersWithRawClass("current-state"),
  [],
  "React annotate draw panel should use CurrentLineStatus instead of hand-written current-state wrappers",
);
assert.ok(annotateDrawPanel.includes("CurrentLineStatus"), "React annotate draw panel uses the shared current line status primitive");
assert.ok(uiR3FLoadingCard.includes("R3FLoadingCard"), "R3F loading primitive exports R3FLoadingCard");
assert.ok(uiR3FLoadingCard.includes("@react-three/drei"), "R3F loading primitive owns the Drei Html overlay");
assert.ok(uiR3FLoadingCard.includes("<Html center>"), "R3F loading primitive centers loading content through Drei Html");
assert.ok(uiR3FLoadingCard.includes("rounded-[10px]"), "R3F loading primitive preserves the existing loading card radius");
assert.ok(uiR3FLoadingCard.includes("bg-black/60"), "R3F loading primitive preserves the existing loading card contrast");
for (const className of ["rounded-[10px]", "bg-black/60", "text-[#dbe4ee]"]) {
  assert.deepEqual(
    r3fLoadingConsumersWithRawClass(className),
    [],
    `R3F scenes should use R3FLoadingCard instead of hand-written ${className} loading card classes`,
  );
}
for (const [name, source] of r3fLoadingConsumerSources.entries()) {
  assert.ok(source.includes("R3FLoadingCard"), `${name} should render loading state through the shared R3F loading primitive`);
  assert.ok(!source.includes("<Html center>"), `${name} should not hand-write Drei Html loading overlays`);
}
assert.ok(uiSurgeryAction.includes("SurgeryCutButton"), "shadcn-style surgery action primitive exports SurgeryCutButton");
assert.ok(uiSurgeryAction.includes('cn("cut-along"'), "surgery action primitive preserves cut-along styling");
assert.ok(uiSurgeryAction.includes('active && "active"'), "surgery action primitive preserves active cut styling");
assert.ok(uiSurgeryAction.includes('variant = "workbench"'), "surgery action primitive defaults to workbench button styling");
assert.deepEqual(
  surgeryActionConsumersWithRawClass("cut-along"),
  [],
  "React surgery controls should use SurgeryCutButton instead of hand-written cut-along class wrappers",
);
assert.ok(surgeryControlsPanel.includes("SurgeryCutButton"), "React surgery controls use the shared surgery cut action primitive");
assert.ok(uiSurgeryFeedback.includes("SurgeryVerdict"), "shadcn-style surgery feedback primitive exports SurgeryVerdict");
assert.ok(uiSurgeryFeedback.includes('`surgery-verdict-${tone}`'), "surgery feedback primitive preserves verdict tone styling");
assert.ok(uiSurgeryFeedback.includes('tone = "neutral"'), "surgery feedback primitive defaults to neutral verdict tone");
assert.deepEqual(
  surgeryFeedbackConsumersWithRawClass("surgery-verdict-"),
  [],
  "React surgery metrics should use SurgeryVerdict instead of hand-written surgery-verdict class wrappers",
);
assert.ok(surgeryMetricsPanel.includes("SurgeryVerdict"), "React surgery metrics use the shared verdict feedback primitive");
assert.ok(uiPrivacyAudit.includes("PrivacyStateText"), "shadcn-style privacy audit primitive exports PrivacyStateText");
assert.ok(uiPrivacyAudit.includes("PrivacyAuditMessage"), "shadcn-style privacy audit primitive exports PrivacyAuditMessage");
assert.ok(uiPrivacyAudit.includes('blocked && "danger-text"'), "privacy audit primitive preserves blocked danger styling");
assert.ok(uiPrivacyAudit.includes("<Hint"), "privacy audit message primitive preserves shared Hint semantics");
assert.deepEqual(
  privacyAuditConsumersWithRawClass("danger-text"),
  [],
  "React privacy audit panel should use privacy audit primitives instead of hand-written danger-text class wrappers",
);
assert.ok(privacyAuditPanel.includes("PrivacyStateText"), "React privacy audit panel uses the shared privacy state primitive");
assert.ok(privacyAuditPanel.includes("PrivacyAuditMessage"), "React privacy audit panel uses the shared privacy message primitive");
for (const className of [
  "hint",
  "badge",
  "react-route-status",
  "metric-grid",
  "metric",
  "stat-grid",
  "stat",
  "bar",
  "bar-fill",
  "app",
  "sidebar",
  "disclaimer",
  "stage",
  "stage-top",
  "stage-body",
  "stage-actions",
  "main-wrap",
  "stage-link",
]) {
  assert.deepEqual(
    consumersWithRawClass(className),
    [],
    `React UI consumers should use shared primitives instead of hand-written ${className} class wrappers`,
  );
}
assert.deepEqual(
  [...componentSources.entries()]
    .filter(([, source]) => source.includes('className="btn-row') || source.includes("className={`btn-row"))
    .map(([name]) => name),
  [],
  "React component button groups should use ButtonRow instead of hand-written btn-row wrappers",
);
assert.deepEqual(
  [...componentSources.entries()]
    .filter(([, source]) => source.includes('className="section-title') || source.includes("className={`section-title"))
    .map(([name]) => name),
  [],
  "React component section titles should use SectionTitle instead of hand-written section-title wrappers",
);
assert.ok(typedStore.includes("React/Zustand stores low-frequency UI"), "Zustand store documents low-frequency state ownership");
assert.ok(typedStore.includes("per-frame arrays stay outside persisted stores"), "Zustand store forbids high-frequency renderer arrays");
assert.ok(typedStore.includes("interface AppState"), "Zustand store is typed");
assert.ok(typedStore.includes("export type Workspace"), "app store exports a typed workspace union for route lifecycle hooks");
assert.ok(reactRouteLifecycleHook.includes("useReactRouteLifecycle"), "pure React routes share a typed route lifecycle hook");
assert.ok(reactRouteLifecycleHook.includes("reactManaged"), "pure React route lifecycle can guard legacy auto-mounts when needed");
assert.ok(reactRouteLifecycleHook.includes("../lib/reactManagedWorkbench"), "pure React route lifecycle uses the shared managed flag helper");
assert.ok(reactRouteLifecycleHook.includes("captureReactManagedWorkbench"), "pure React route lifecycle captures the previous managed flag");
assert.ok(reactRouteLifecycleHook.includes("enableReactManagedWorkbench"), "pure React route lifecycle enables managed mode through the helper");
assert.ok(reactRouteLifecycleHook.includes("restoreReactManagedWorkbench"), "pure React route lifecycle restores the previous managed flag on unmount");
assert.ok(!reactRouteLifecycleHook.includes("window.__LANGERFACE_REACT_MANAGED__"), "pure React route lifecycle does not touch the global flag directly");
assert.ok(reactRouteLifecycleHook.includes("setActiveWorkspace(workspace)"), "pure React route lifecycle publishes active workspace state");
assert.ok(reactRouteLifecycleHook.includes("setRouteStatus(mountedStatus)"), "pure React route lifecycle publishes mounted route status");
assert.ok(reactRouteLifecycleHook.includes("setRouteStatus(unloadedStatus)"), "pure React route lifecycle publishes unloaded route status");
assert.ok(managedWorkbenchHook.includes("useManagedWorkbenchController"), "React routes share a managed workbench controller lifecycle hook");
assert.ok(managedWorkbenchHook.includes("../lib/reactManagedWorkbench"), "managed workbench hook uses the shared managed flag helper");
assert.ok(managedWorkbenchHook.includes("captureReactManagedWorkbench"), "managed workbench hook captures the previous managed flag");
assert.ok(managedWorkbenchHook.includes("enableReactManagedWorkbench"), "managed workbench hook disables legacy controller auto-mount through the helper");
assert.ok(managedWorkbenchHook.includes("restoreReactManagedWorkbench"), "managed workbench hook restores the previous React-managed flag on unmount");
assert.ok(!managedWorkbenchHook.includes("window.__LANGERFACE_REACT_MANAGED__"), "managed workbench hook does not touch the global flag directly");
assert.ok(managedWorkbenchHook.includes("dispose?.(module)"), "managed workbench hook disposes late-loaded modules after route teardown");
assert.ok(managedWorkbenchHook.includes(".catch((err) => {\n      if (disposed) return;"), "managed workbench hook ignores late async failures after route teardown");
assert.ok(managedWorkbenchHook.includes("cleanup?.()"), "managed workbench hook runs controller cleanup on route teardown");
assert.ok(managedWorkbenchHook.includes("setActiveWorkspace(workspace)"), "managed workbench hook publishes active workspace state");
assert.ok(managedWorkbenchHook.includes("setRouteStatus"), "managed workbench hook owns route lifecycle status updates");
assert.ok(controllerSnapshotBridgeHook.includes("useControllerSnapshotBridge"), "React controller snapshots share a typed event bridge hook");
assert.ok(controllerSnapshotBridgeHook.includes("../lib/controllerCommand"), "shared snapshot bridge imports the shared controller event binding helper");
assert.ok(controllerSnapshotBridgeHook.includes("bindWindowControllerEvents([[eventName, handleStateEvent]]"), "shared snapshot bridge subscribes through the shared controller event binding helper");
assert.ok(controllerSnapshotBridgeHook.includes("cleanup()"), "shared snapshot bridge runs shared listener cleanup on unmount");
assert.ok(controllerSnapshotBridgeHook.includes("clearSnapshot()"), "shared snapshot bridge clears route snapshots on unmount");
assert.ok(controllerSnapshotBridgeHook.includes("CustomEvent<unknown>"), "shared snapshot bridge treats browser event payloads as unknown before schema guards");
assert.ok(annotateStore.includes("AnnotateControllerSnapshot"), "annotation Zustand store keeps typed controller snapshots");
assert.ok(annotateStore.includes("ANNOTATE_CONTROLLER_STATE_EVENT"), "annotation Zustand store declares the controller bridge event");
assert.ok(annotateStore.includes("../lib/controllerEvents"), "annotation Zustand store re-exports controller state event from the shared event module");
assert.ok(annotateStore.includes("No Three.js objects"), "annotation store documents renderer object exclusion");
assert.ok(annotateStore.includes("../services/annotateSnapshots"), "annotation Zustand store reuses the shared typed snapshot service types");
assert.ok(!annotateStore.includes("THREE."), "annotation store must not hold Three.js objects");
assert.ok(!annotateStore.includes("verts:"), "annotation store must not hold mesh vertex arrays");
assert.ok(!annotateStore.includes("tris:"), "annotation store must not hold triangle arrays");
assert.ok(!annotateStore.includes("camera:"), "annotation store must not hold Three.js cameras");
assert.ok(annotateBridge.includes("useControllerSnapshotBridge"), "React annotation hook delegates event wiring to the shared snapshot bridge");
assert.ok(annotateBridge.includes("../lib/controllerSnapshotSchemas"), "React annotation hook imports the lightweight shared snapshot schema version");
assert.ok(!annotateBridge.includes("../services/annotateSnapshots"), "React annotation hook does not pull the full snapshot service at runtime");
assert.ok(annotateBridge.includes("ANNOTATE_SNAPSHOT_SCHEMA_VERSION"), "React annotation hook guards snapshots with the shared schema version constant");
assert.ok(annotateStatePanel.includes("useAnnotateStore"), "React annotation UI reads low-frequency state from Zustand");
assert.ok(annotateStatePanel.includes("<Card"), "React annotation state panel uses the shared shadcn-style card primitive");
assert.ok(liveStore.includes("LiveControllerSnapshot"), "live Zustand store keeps typed controller snapshots");
assert.ok(liveStore.includes("LIVE_CONTROLLER_STATE_EVENT"), "live Zustand store declares the controller bridge event");
assert.ok(liveStore.includes("../lib/controllerEvents"), "live Zustand store re-exports controller state event from the shared event module");
assert.ok(liveStore.includes("No MediaPipe task instances"), "live store documents MediaPipe object exclusion");
assert.ok(liveStore.includes("../services/liveSnapshots"), "live Zustand store reuses the shared typed snapshot service types");
assert.ok(!liveStore.includes("THREE."), "live store must not hold Three.js objects");
assert.ok(!liveStore.includes("landmarks:"), "live store must not hold per-frame landmarks");
assert.ok(!liveStore.includes("verts:"), "live store must not hold mesh vertex arrays");
assert.ok(!liveStore.includes("tris:"), "live store must not hold triangle arrays");
assert.ok(!liveStore.includes("fps:"), "live store must not hold frame counters");
assert.ok(liveBridge.includes("useControllerSnapshotBridge"), "React live hook delegates event wiring to the shared snapshot bridge");
assert.ok(liveBridge.includes("../lib/controllerSnapshotSchemas"), "React live hook imports the lightweight shared snapshot schema version");
assert.ok(!liveBridge.includes("../services/liveSnapshots"), "React live hook does not pull the full snapshot service at runtime");
assert.ok(liveBridge.includes("LIVE_SNAPSHOT_SCHEMA_VERSION"), "React live hook guards snapshots with the shared schema version constant");
assert.ok(liveStatePanel.includes("useLiveStore"), "React live UI reads low-frequency state from Zustand");
assert.ok(liveStatePanel.includes("<Card"), "React live state panel uses the shared shadcn-style card primitive");
assert.ok(incisionStore.includes("IncisionControllerSnapshot"), "incision Zustand store keeps typed controller snapshots");
assert.ok(incisionStore.includes("INCISION_CONTROLLER_STATE_EVENT"), "incision Zustand store declares the controller bridge event");
assert.ok(incisionStore.includes("../lib/controllerEvents"), "incision Zustand store re-exports controller state event from the shared event module");
assert.ok(incisionStore.includes("No Three.js objects"), "incision store documents renderer object exclusion");
assert.ok(incisionStore.includes("../services/incisionSnapshots"), "incision Zustand store reuses the shared typed snapshot service types");
assert.ok(!incisionStore.includes("THREE."), "incision store must not hold Three.js objects");
assert.ok(!incisionStore.includes("verts:"), "incision store must not hold mesh vertex arrays");
assert.ok(!incisionStore.includes("tris:"), "incision store must not hold triangle arrays");
assert.ok(incisionBridge.includes("useControllerSnapshotBridge"), "React incision hook delegates event wiring to the shared snapshot bridge");
assert.ok(incisionBridge.includes("../lib/controllerSnapshotSchemas"), "React incision hook imports the lightweight shared snapshot schema version");
assert.ok(!incisionBridge.includes("../services/incisionSnapshots"), "React incision hook does not pull the full snapshot service at runtime");
assert.ok(incisionBridge.includes("INCISION_SNAPSHOT_SCHEMA_VERSION"), "React incision hook guards snapshots with the shared schema version constant");
assert.ok(incisionRoute.includes("useIncisionControllerBridge"), "incision route mounts the Zustand/controller bridge");
assert.ok(incisionStatePanel.includes("useIncisionStore"), "React incision UI reads low-frequency state from Zustand");
assert.ok(incisionStatePanel.includes("<Card"), "React incision state panel uses the shared shadcn-style card primitive");

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
  assert.ok(exposesId(incisionStagePanel, id), `React incision stage exposes #${id}`);
}
assert.ok(incisionStore.includes("IncisionAssetLoadingState"), "incision Zustand store keeps typed asset loading state");
assert.ok(incisionWorkbench.includes("IncisionStagePanel"), "React incision workbench renders the stage as a React component");
assert.ok(incisionWorkbench.includes("WorkbenchLayout"), "React incision workbench uses the shared workbench layout shell");
assert.ok(incisionWorkbench.includes("Disclaimer"), "React incision workbench uses the shared disclaimer primitive");
assert.ok(incisionStagePanel.includes("useIncisionStore"), "React incision stage reads low-frequency stage and asset loading state from Zustand");
assert.ok(incisionStagePanel.includes("StageShell"), "React incision stage uses the shared stage shell primitive");
assert.ok(incisionStagePanel.includes("StageViewport"), "React incision stage uses the shared stage viewport primitive");
assert.ok(incisionStagePanel.includes("StageActions"), "React incision stage uses the shared stage actions primitive");
assert.ok(incisionStagePanel.includes("StageLink"), "React incision stage uses the shared stage link primitive");
assert.ok(incisionStagePanel.includes("StageStatus"), "React incision stage uses the shared stage status primitive");
assert.ok(incisionStagePanel.includes("StageMeta"), "React incision stage uses the shared stage metadata primitive");
assert.ok(incisionStagePanel.includes("Legend"), "React incision stage uses the shared legend primitive");
assert.ok(incisionStagePanel.includes("CanvasLegendItem"), "React incision stage uses the shared canvas legend item primitive");
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
assert.ok(tumorPanel.includes("dispatchIncisionTumorCommand"), "React tumor panel uses the typed incision tumor command helper");
assert.ok(!tumorPanel.includes("../lib/controllerEvents"), "React tumor panel does not import controller event names directly");
assert.ok(tumorPanel.includes("useIncisionStore"), "React tumor panel syncs low-frequency tumor status from Zustand");
assert.ok(tumorPanel.includes("Button"), "React tumor panel uses the shared shadcn-style button primitive");
assert.ok(tumorPanel.includes("Input"), "React tumor panel uses the shared shadcn-style input primitive");
assert.ok(tumorPanel.includes("Label"), "React tumor panel uses the shared shadcn-style label primitive");
assert.ok(tumorPanel.includes("Select"), "React tumor panel uses the shared shadcn-style select primitive");
assert.ok(tumorPanel.includes("RangeInput"), "React tumor panel uses the shared shadcn-style range primitive");
assert.ok(tumorPanel.includes("ButtonRow"), "React tumor panel uses the shared shadcn-style button row primitive");
assert.ok(tumorPanel.includes("<Card"), "React tumor panel uses the shared shadcn-style card primitive");
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
  assert.ok(exposesId(secondaryCuePanel, id), `React secondary cue panel exposes #${id}`);
}
assert.ok(incisionStore.includes("IncisionSecondaryCueState"), "incision Zustand store keeps typed secondary cue state");
assert.ok(incisionWorkbench.includes("SecondaryCuePanel"), "React incision workbench renders the secondary cue controls as a React component");
assert.ok(secondaryCuePanel.includes("dispatchIncisionSecondaryCueCommand"), "React secondary cue panel uses the typed incision secondary cue command helper");
assert.ok(!secondaryCuePanel.includes("../lib/controllerEvents"), "React secondary cue panel does not import controller event names directly");
assert.ok(secondaryCuePanel.includes("useIncisionStore"), "React secondary cue panel syncs low-frequency cue state from Zustand");
assert.ok(secondaryCuePanel.includes("Button"), "React secondary cue panel uses the shared shadcn-style button primitive");
assert.ok(secondaryCuePanel.includes("ButtonRow"), "React secondary cue panel uses the shared shadcn-style button row primitive");
assert.ok(secondaryCuePanel.includes("Input"), "React secondary cue panel uses the shared shadcn-style input primitive");
assert.ok(secondaryCuePanel.includes("CheckboxField"), "React secondary cue panel uses the shared shadcn-style checkbox field primitive");
assert.ok(secondaryCuePanel.includes("<Card"), "React secondary cue panel uses the shared shadcn-style card primitive");
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
  assert.ok(exposesId(candidateResultPanel, id), `React candidate result panel exposes #${id}`);
}
assert.ok(incisionStore.includes("IncisionResultViewState"), "incision Zustand store keeps typed candidate result view state");
assert.ok(incisionWorkbench.includes("CandidateResultPanel"), "React incision workbench renders the candidate result as a React component");
assert.ok(candidateResultPanel.includes("useIncisionStore"), "React candidate result panel reads low-frequency result view state from Zustand");
assert.ok(candidateResultPanel.includes("<Card"), "React candidate result panel uses the shared shadcn-style card primitive");
assert.ok(candidateResultPanel.includes("CardHeader"), "React candidate result panel uses the shared shadcn-style card header primitive");
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
assert.ok(candidateLibraryPanel.includes("dispatchIncisionLibraryCommand"), "React candidate library uses the typed incision library command helper");
assert.ok(!candidateLibraryPanel.includes("../lib/controllerEvents"), "React candidate library does not import controller event names directly");
assert.ok(candidateLibraryPanel.includes("useIncisionStore"), "React candidate library reads saved candidate summaries from Zustand");
assert.ok(candidateLibraryPanel.includes("useState"), "React candidate library owns short-lived clear confirmation state in React");
assert.ok(candidateLibraryPanel.includes("confirmClear"), "React candidate library renders a controlled clear confirmation state");
assert.ok(!candidateLibraryPanel.includes("window.confirm"), "React candidate library does not use browser-native confirm dialogs");
assert.ok(candidateLibraryPanel.includes("Button"), "React candidate library uses the shared shadcn-style button primitive");
assert.ok(candidateLibraryPanel.includes("ButtonRow"), "React candidate library uses the shared shadcn-style button row primitive");
assert.ok(candidateLibraryPanel.includes("CandidateList"), "React candidate library uses the shared candidate list primitive");
assert.ok(candidateLibraryPanel.includes("CandidateRow"), "React candidate library uses the shared candidate row primitive");
assert.ok(candidateLibraryPanel.includes("CandidateRowTop"), "React candidate library uses the shared candidate row top primitive");
assert.ok(candidateLibraryPanel.includes("CandidateRowMeta"), "React candidate library uses the shared candidate row metadata primitive");
assert.ok(candidateLibraryPanel.includes("CandidateRowStatus"), "React candidate library uses the shared candidate row status primitive");
assert.ok(candidateLibraryPanel.includes("<Card"), "React candidate library uses the shared shadcn-style card primitive");
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
assert.ok(privacyAuditPanel.includes("<Card"), "React privacy audit panel uses the shared shadcn-style card primitive");
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
assert.ok(providerPanel.includes("dispatchIncisionProviderState"), "React provider panel uses the typed incision provider state helper");
assert.ok(!providerPanel.includes("../lib/controllerEvents"), "React provider panel does not import controller event names directly");
assert.ok(providerPanel.includes("../services/providerConfig"), "React provider panel consumes the shared typed Provider config service");
assert.ok(providerConfigService.includes("PROVIDER_STORAGE_KEY"), "Provider config service owns browser storage keying");
assert.ok(providerConfigService.includes("initialProviderState"), "Provider config service owns stored/default Provider initialization");
assert.ok(providerConfigService.includes("isDeprecatedNativeProviderConfig"), "Provider config service owns deprecated native Provider cleanup");
assert.ok(providerConfigService.includes("browserProviderStorage"), "Provider config service centralizes browser storage access");
assert.ok(providerConfigService.includes("browserProviderLocation"), "Provider config service centralizes browser location access");
assert.ok(providerConfigService.includes('typeof window === "undefined"'), "Provider config service guards non-browser imports");
assert.ok(!providerConfigService.includes("= window.localStorage"), "Provider config service does not bind window.localStorage in function defaults");
assert.ok(!providerConfigService.includes("= window.location"), "Provider config service does not bind window.location in function defaults");
assert.ok(providerConfigService.includes("localProviderFromRemotePageMessage"), "Provider config service owns loopback Provider browser warning text");
assert.ok(providerConfigService.includes("insecureProviderFromSecurePageMessage"), "Provider config service owns HTTPS-to-HTTP Provider warning text");
assert.ok(providerConfigService.includes("redactedProviderConfig"), "Provider config service owns Provider export redaction");
assert.ok(providerPanel.includes("Input"), "React provider panel uses the shared shadcn-style input primitive");
assert.ok(providerPanel.includes("Label"), "React provider panel uses the shared shadcn-style label primitive");
assert.ok(providerPanel.includes("RangeInput"), "React provider panel uses the shared shadcn-style range primitive");
assert.ok(providerPanel.includes("Button"), "React provider panel uses the shared shadcn-style button primitive");
assert.ok(providerPanel.includes("<Card"), "React provider panel uses the shared shadcn-style card primitive");
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
assert.ok(editPanel.includes("dispatchIncisionEditCommand"), "React edit panel uses the typed incision edit command helper");
assert.ok(!editPanel.includes("../lib/controllerEvents"), "React edit panel does not import controller event names directly");
assert.ok(editPanel.includes("useIncisionStore"), "React edit panel syncs low-frequency edit state from Zustand");
assert.ok(editPanel.includes("Button"), "React edit panel uses the shared shadcn-style button primitive");
assert.ok(editPanel.includes("Label"), "React edit panel uses the shared shadcn-style label primitive");
assert.ok(editPanel.includes("Select"), "React edit panel uses the shared shadcn-style select primitive");
assert.ok(editPanel.includes("RangeInput"), "React edit panel uses the shared shadcn-style range primitive");
assert.ok(editPanel.includes("ButtonRow"), "React edit panel uses the shared shadcn-style button row primitive");
assert.ok(editPanel.includes("<Card"), "React edit panel uses the shared shadcn-style card primitive");
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
assert.ok(reviewPanel.includes("dispatchIncisionReviewCommand"), "React review panel uses the typed incision review command helper");
assert.ok(!reviewPanel.includes("../lib/controllerEvents"), "React review panel does not import controller event names directly");
assert.ok(reviewPanel.includes("useIncisionStore"), "React review panel syncs low-frequency review state from Zustand");
assert.ok(reviewPanel.includes("Input"), "React review panel uses the shared shadcn-style input primitive");
assert.ok(reviewPanel.includes("Label"), "React review panel uses the shared shadcn-style label primitive");
assert.ok(reviewPanel.includes("Select"), "React review panel uses the shared shadcn-style select primitive");
assert.ok(reviewPanel.includes("Textarea"), "React review panel uses the shared shadcn-style textarea primitive");
assert.ok(reviewPanel.includes("Button"), "React review panel uses the shared shadcn-style button primitive");
assert.ok(reviewPanel.includes("ButtonRow"), "React review panel uses the shared shadcn-style button row primitive");
assert.ok(reviewPanel.includes("<Card"), "React review panel uses the shared shadcn-style card primitive");
assert.ok(reviewPanel.includes('variant="workbenchPrimary"'), "React review panel keeps primary workbench button styling through Button variants");
assert.ok(incisionWorkbench.includes('to="/live"'), "React incision workbench returns to the React live route");
assert.ok(incisionStagePanel.includes('to="/annotate"'), "React incision stage links to the React 3D annotation route");
assert.ok(controller.includes("export function mountIncisionAgentWorkbench"), "incision controller exposes a mount lifecycle");
assert.ok(controller.includes("export function disposeIncisionAgentWorkbench"), "incision controller exposes a dispose lifecycle");
assert.ok(controller.includes("INCISION_TUMOR_REACT_COMMAND_EVENT"), "incision controller listens for React tumor input commands");
assert.ok(controller.includes("./src/lib/controllerEvents.ts"), "incision controller imports event names from the shared module");
assert.ok(controller.includes("./src/lib/controllerCommand.ts"), "incision controller imports the shared command parsing module");
assert.ok(controller.includes("bindWindowControllerEvents"), "incision controller binds React command events through the shared helper");
assert.ok(controller.includes("reactCommandCleanup"), "incision controller stores a single React command cleanup handle");
assert.ok(!controller.includes("window.addEventListener(INCISION"), "incision controller does not register React command listeners one-by-one");
assert.ok(!controller.includes("window.removeEventListener(INCISION"), "incision controller does not remove React command listeners one-by-one");
assert.ok(controller.includes("readControllerCommandDetail(event, INCISION_TUMOR_COMMANDS)"), "incision tumor handler validates incoming command names");
assert.ok(controller.includes("readControllerCommandDetail(event, INCISION_SECONDARY_CUE_COMMANDS)"), "incision secondary cue handler validates incoming command names");
assert.ok(controller.includes("readControllerCommandDetail(event, INCISION_EDIT_COMMANDS)"), "incision edit handler validates incoming command names");
assert.ok(controller.includes("readControllerCommandDetail(event, INCISION_REVIEW_COMMANDS)"), "incision review handler validates incoming command names");
assert.ok(controller.includes("readControllerCommandDetail(event, INCISION_LIBRARY_COMMANDS)"), "incision library handler validates incoming command names");
assert.ok(!controller.includes("event?.detail?.command"), "incision controller does not read raw command detail directly");
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
assert.ok(incisionSnapshotsService.includes("IncisionPlanResultLike"), "shared incision snapshot service types candidate result inputs");
assert.ok(incisionSnapshotsService.includes("IncisionSavedCandidateRecordLike"), "shared incision snapshot service types saved candidate record inputs");
assert.ok(!incisionSnapshotsService.includes("result: any"), "shared incision snapshot service does not accept untyped candidate results");
assert.ok(!incisionSnapshotsService.includes("records?: any[]"), "shared incision snapshot service does not accept untyped saved candidate records");
assert.ok(incisionSnapshotsService.includes("../lib/controllerSnapshotSchemas"), "shared incision snapshot service re-exports the lightweight schema version");
assert.ok(controller.includes("./src/services/incisionSnapshots.ts"), "incision controller consumes the shared typed snapshot service");
assert.ok(controller.includes("buildIncisionControllerSnapshot({"), "incision controller delegates React snapshot construction to the shared service");
assert.ok(controller.includes("INCISION_REVIEW_REACT_COMMAND_EVENT"), "incision controller listens for React review commands");
assert.ok(controller.includes("handleReactReviewCommand"), "incision controller routes React review commands to existing review workflow functions");
assert.ok(controller.includes("INCISION_EDIT_REACT_COMMAND_EVENT"), "incision controller listens for React edit commands");
assert.ok(controller.includes("handleReactEditCommand"), "incision controller routes React edit commands to existing edit workflow functions");
assert.ok(controller.includes("INCISION_LIBRARY_REACT_COMMAND_EVENT"), "incision controller listens for React candidate library commands");
assert.ok(controller.includes("handleReactLibraryCommand"), "incision controller routes React library commands to existing save/export workflow functions");
assert.ok(controller.includes("./src/lib/reactManagedWorkbench.ts"), "incision controller imports the shared React-managed flag helper");
assert.ok(controller.includes("isReactManagedWorkbench()"), "incision controller can branch between React and legacy provider handling");
assert.ok(!controller.includes("window.__LANGERFACE_REACT_MANAGED__"), "incision controller does not touch the managed flag directly");
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
assert.ok(worker.includes('from "./workflowWorkerContract"'), "workflow worker consumes the shared Comlink contract");
assert.ok(workerContract.includes("export interface PlanIncisionRequest"), "workflow worker contract types incision planning requests");
assert.ok(workerContract.includes("export type WorkflowPlanResult"), "workflow worker contract names planning results");
assert.ok(workerContract.includes("export interface WorkflowWorkerApi"), "workflow worker contract owns the Comlink API surface");
assert.ok(workerClient.includes("Comlink.wrap"), "React app wraps the workflow worker with Comlink");
assert.ok(workerClient.includes("new Worker(new URL"), "workflow worker is loaded through Vite worker URL handling");
assert.ok(workerClient.includes("worker.terminate"), "workflow worker client has an explicit dispose lifecycle");
assert.ok(workerClient.includes('from "../workers/workflowWorkerContract"'), "workflow worker client depends on the shared contract, not the worker entry");
assert.ok(!workerClient.includes('from "../workers/workflow.worker"'), "workflow worker client does not import types from the worker runtime entry");
assert.ok(workerClient.includes("WorkflowWorkerProbeResult"), "workflow worker client exposes a typed low-frequency probe result");
assert.ok(workerClient.includes("probeWorkflowWorkerClient"), "workflow worker client centralizes dashboard worker health checks");
assert.ok(workerClient.includes("summarizeTumorInput"), "workflow worker probe exercises a deterministic tool through Comlink");
assert.ok(!workerClient.includes("planIncisionWorkflow"), "workflow worker client stays light for dashboard probes");
assert.ok(workflowPlanner.includes("planIncisionWithWorkflowFallback"), "workflow planner centralizes worker planning and fallback");
assert.ok(workflowPlanner.includes("client.api.planIncision"), "workflow planner delegates planning to the Comlink worker");
assert.ok(workflowPlanner.includes("planIncisionWorkflow(request)"), "workflow planner keeps deterministic main-thread fallback");
assert.ok(workerPanel.includes("createWorkflowWorkerClient"), "React dashboard probes the worker boundary");
assert.ok(workerPanel.includes("probeWorkflowWorkerClient"), "React worker status panel consumes the shared worker probe service");
assert.ok(!workerPanel.includes("client.api.diagnostics"), "React worker status panel does not inline Comlink API probing");
assert.ok(workerPanel.includes("CardHeader"), "React worker status panel uses the shared shadcn-style card primitives");
assert.ok(controller.includes("createWorkflowWorkerClient"), "incision controller uses the Comlink workflow worker client");
assert.ok(controller.includes("planIncisionWithWorkflowFallback"), "incision controller uses the shared worker planning service");
assert.ok(!controller.includes("worker.api.planIncision"), "incision controller does not call the worker API directly");
assert.ok(workflowPlanner.includes("main_thread_fallback"), "workflow planner keeps a deterministic fallback if worker startup fails");
assert.ok(controller.includes("S.workflowWorker?.dispose"), "incision controller disposes the workflow worker on route teardown");
assert.ok(incisionSnapshotsService.includes("INCISION_SNAPSHOT_SCHEMA_VERSION"), "shared incision snapshot service publishes typed low-frequency snapshots to React");
assert.ok(controller.includes("dispatchControllerEvent(INCISION_CONTROLLER_STATE_EVENT"), "incision controller emits state snapshots through the shared browser event helper");
assert.ok(!controller.includes("CustomEvent(INCISION_CONTROLLER_STATE_EVENT"), "incision controller does not hand-roll state snapshot CustomEvent dispatch");
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
  assert.ok(exposesId(annotateDrawPanel, id), `React annotate draw panel exposes #${id}`);
}
assert.ok(annotateStore.includes("AnnotateMeshActionsState"), "annotation Zustand store keeps typed mesh source action state");
assert.ok(annotateWorkbench.includes("AnnotateMeshSourcePanel"), "React annotate workbench renders the mesh source panel as a React component");
assert.ok(annotateWorkbench.includes("AnnotateDrawPanel"), "React annotate workbench renders the current-line draw panel as a React component");
assert.ok(annotateWorkbench.includes("AnnotateHelpPanel"), "React annotate workbench renders annotation help as a React component");
assert.ok(annotateWorkbench.includes("AnnotateStagePanel"), "React annotate workbench renders the 3D stage shell as a React component");
assert.ok(annotateWorkbench.includes("WorkbenchLayout"), "React annotate workbench uses the shared workbench layout shell");
assert.ok(annotateWorkbench.includes("Disclaimer"), "React annotate workbench uses the shared disclaimer primitive");
assert.ok(annotateStagePanel.includes("StageShell"), "React annotate stage uses the shared stage shell primitive");
assert.ok(annotateStagePanel.includes("StageViewport"), "React annotate stage uses the shared stage viewport primitive");
assert.ok(annotateStagePanel.includes("StageActions"), "React annotate stage uses the shared stage actions primitive");
assert.ok(annotateStagePanel.includes("StageLink"), "React annotate stage uses the shared stage link primitive");
assert.ok(annotateStagePanel.includes("StageStatus"), "React annotate stage uses the shared stage status primitive");
assert.ok(annotateStagePanel.includes("StageMeta"), "React annotate stage uses the shared stage metadata primitive");
assert.ok(annotateMeshSourcePanel.includes("dispatchAnnotateMeshCommand"), "React annotate mesh source panel uses the typed mesh command helper");
assert.ok(annotateDrawPanel.includes("dispatchAnnotateDrawCommand"), "React annotate draw panel uses the typed draw command helper");
assert.ok(!annotateMeshSourcePanel.includes("../lib/controllerEvents"), "React annotate mesh source panel does not import controller event names directly");
assert.ok(!annotateDrawPanel.includes("../lib/controllerEvents"), "React annotate draw panel does not import controller event names directly");
assert.ok(annotateMeshSourcePanel.includes("useAnnotateStore"), "React annotate mesh source panel reads low-frequency mesh state from Zustand");
assert.ok(annotateDrawPanel.includes("useAnnotateStore"), "React annotate draw panel reads low-frequency draft state from Zustand");
assert.ok(annotateMeshSourcePanel.includes("Button"), "React annotate mesh source panel uses the shared shadcn-style button primitive");
assert.ok(annotateMeshSourcePanel.includes("Button asChild"), "React annotate mesh source panel uses shared Button asChild for upload labels and Router links");
assert.ok(annotateMeshSourcePanel.includes("Input"), "React annotate mesh source panel uses the shared shadcn-style input primitive");
assert.ok(annotateMeshSourcePanel.includes("Label"), "React annotate mesh source panel uses the shared shadcn-style label primitive");
assert.ok(annotateMeshSourcePanel.includes("<Card"), "React annotate mesh source panel uses the shared shadcn-style card primitive");
assert.ok(annotateMeshSourcePanel.includes('variant="workbenchPrimary"'), "React annotate mesh source panel keeps primary workbench button styling through Button variants");
assert.ok(annotateDrawPanel.includes("SectionTitle"), "React annotate draw panel uses the shared shadcn-style section title primitive");
assert.ok(annotateDrawPanel.includes("ButtonRow"), "React annotate draw panel uses the shared shadcn-style button row primitive");
assert.ok(annotateDrawPanel.includes("Button"), "React annotate draw panel uses the shared shadcn-style button primitive");
assert.ok(annotateDrawPanel.includes("Input"), "React annotate draw panel uses the shared shadcn-style input primitive");
assert.ok(annotateDrawPanel.includes("Label"), "React annotate draw panel uses the shared shadcn-style label primitive");
assert.ok(annotateDrawPanel.includes("Select"), "React annotate draw panel uses the shared shadcn-style select primitive");
assert.ok(annotateDrawPanel.includes("<Card"), "React annotate draw panel uses the shared shadcn-style card primitive");
assert.ok(annotateDrawPanel.includes('variant="workbenchPrimary"'), "React annotate draw panel keeps primary workbench button styling through Button variants");
assert.ok(annotateHelpPanel.includes("标注帮助"), "React annotate help panel keeps the user-facing annotation guide");
assert.ok(annotateHelpPanel.includes("HelpDisclosure"), "React annotate help panel uses the shared help disclosure primitive");
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
assert.ok(annotateLineLibraryPanel.includes("dispatchAnnotateLibraryCommand"), "React annotate line library uses the typed library command helper");
assert.ok(!annotateLineLibraryPanel.includes("../lib/controllerEvents"), "React annotate line library does not import controller event names directly");
assert.ok(annotateLineLibraryPanel.includes("useAnnotateStore"), "React annotate line library reads saved line state from Zustand");
assert.ok(annotateLineLibraryPanel.includes("useState"), "React annotate line library owns short-lived clear confirmation state in React");
assert.ok(annotateLineLibraryPanel.includes("confirmClear"), "React annotate line library renders a controlled clear confirmation state");
assert.ok(!annotateLineLibraryPanel.includes("window.confirm"), "React annotate line library does not use browser-native confirm dialogs");
assert.ok(annotateLineLibraryPanel.includes("Button"), "React annotate line library uses the shared shadcn-style button primitive");
assert.ok(annotateLineLibraryPanel.includes("ButtonRow"), "React annotate line library uses the shared shadcn-style button row primitive");
assert.ok(annotateLineLibraryPanel.includes("LineList"), "React annotate line library uses the shared line list primitive");
assert.ok(annotateLineLibraryPanel.includes("LineRow"), "React annotate line library uses the shared line row primitive");
assert.ok(annotateLineLibraryPanel.includes("LineMain"), "React annotate line library uses the shared line main primitive");
assert.ok(annotateLineLibraryPanel.includes("LineMeta"), "React annotate line library uses the shared line metadata primitive");
assert.ok(annotateLineLibraryPanel.includes("LineWarning"), "React annotate line library uses the shared line warning primitive");
assert.ok(annotateLineLibraryPanel.includes("LineActions"), "React annotate line library uses the shared line actions primitive");
assert.ok(annotateLineLibraryPanel.includes("LineEmpty"), "React annotate line library uses the shared line empty-state primitive");
assert.ok(annotateLineLibraryPanel.includes("<Card"), "React annotate line library uses the shared shadcn-style card primitive");
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
assert.ok(annotateController.includes("./src/lib/controllerEvents.ts"), "annotation controller imports event names from the shared module");
assert.ok(annotateController.includes("ANNOTATE_MESH_REACT_COMMAND_EVENT"), "annotation controller declares a React mesh source command bridge event");
assert.ok(annotateController.includes("ANNOTATE_DRAW_REACT_COMMAND_EVENT"), "annotation controller declares a React current-line command bridge event");
assert.ok(annotateController.includes("ANNOTATE_LIBRARY_REACT_COMMAND_EVENT"), "annotation controller declares a React saved line command bridge event");
assert.ok(annotateController.includes("./src/lib/controllerCommand.ts"), "annotation controller imports the shared command parsing module");
assert.ok(annotateController.includes("bindWindowControllerEvents"), "annotation controller binds React command events through the shared helper");
assert.ok(!annotateController.includes("window.addEventListener(ANNOTATE"), "annotation controller does not register React command listeners one-by-one");
assert.ok(annotateController.includes("readControllerCommandDetail(event, ANNOTATE_MESH_COMMANDS)"), "annotation mesh handler validates incoming command names");
assert.ok(annotateController.includes("readControllerCommandDetail(event, ANNOTATE_DRAW_COMMANDS)"), "annotation draw handler validates incoming command names");
assert.ok(annotateController.includes("readControllerCommandDetail(event, ANNOTATE_LIBRARY_COMMANDS)"), "annotation library handler validates incoming command names");
assert.ok(!annotateController.includes("event.detail || {}"), "annotation controller does not read raw command detail directly");
assert.ok(annotateController.includes("handleReactMeshCommand"), "annotation controller routes React mesh source commands to existing workflow functions");
assert.ok(annotateController.includes("handleReactDrawCommand"), "annotation controller routes React current-line commands to existing workflow functions");
assert.ok(annotateController.includes("handleReactLineLibraryCommand"), "annotation controller routes React saved line commands to existing workflow functions");
assert.ok(annotateController.includes("./src/services/annotateSnapshots.ts"), "annotation controller consumes the shared typed snapshot service");
assert.ok(annotateController.includes("buildAnnotateControllerSnapshot({"), "annotation controller delegates React snapshot construction to the shared service");
assert.ok(!annotateController.includes("function currentDraftSnapshot"), "annotation controller no longer owns current-line snapshot construction");
assert.ok(!annotateController.includes("function savedSummarySnapshot"), "annotation controller no longer owns saved-line snapshot construction");
assert.ok(annotateController.includes("renderLegacyLineList"), "annotation controller keeps legacy saved line DOM rendering isolated");
assert.ok(annotateController.includes("./src/lib/reactManagedWorkbench.ts"), "annotation controller imports the shared React-managed flag helper");
assert.ok(annotateController.includes("!isReactManagedWorkbench()"), "legacy annotation HTML still owns direct saved line handlers outside React");
assert.ok(!annotateController.includes("window.__LANGERFACE_REACT_MANAGED__"), "annotation controller does not touch the managed flag directly");
assert.ok(annotateSnapshotsService.includes("../lib/controllerSnapshotSchemas"), "shared annotation snapshot service re-exports the lightweight schema version");
assert.ok(annotateController.includes("dispatchControllerEvent(ANNOTATE_CONTROLLER_STATE_EVENT"), "annotation controller emits state snapshots through the shared browser event helper");
assert.ok(!annotateController.includes("CustomEvent(ANNOTATE_CONTROLLER_STATE_EVENT"), "annotation controller does not hand-roll state snapshot CustomEvent dispatch");
assert.ok(annotateController.includes("cancelAnimationFrame"), "annotation controller cancels its render loop on dispose");
assert.ok(annotateController.includes("abortController?.abort"), "annotation controller aborts DOM listeners on dispose");
assert.ok(annotateController.includes("activeSession"), "annotation controller guards async loaders across SPA unmounts");
assert.ok(annotateController.includes('"/app/live"'), "annotation preview jumps back to the React live route when managed by React");
assert.ok(annotateController.includes("!isReactManagedWorkbench()"), "legacy annotation HTML still auto-mounts outside React");
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
  assert.ok(exposesId(liveRouteControlsPanel, id), `React live route controls expose #${id}`);
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
  assert.ok(exposesId(liveRenderControlsPanel, id), `React live render controls expose #${id}`);
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
  assert.ok(exposesId(liveQualityPanel, id), `React live quality panel exposes #${id}`);
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
assert.ok(liveWorkbench.includes("Card"), "React live workbench uses the shared shadcn-style card primitive");
assert.ok(liveWorkbench.includes("LiveRouteControlsPanel"), "React live workbench renders route controls as a React component");
assert.ok(liveWorkbench.includes("LiveSourceControlsPanel"), "React live workbench renders source controls as a React component");
assert.ok(liveWorkbench.includes("LiveRenderControlsPanel"), "React live workbench renders render controls as a React component");
assert.ok(liveWorkbench.includes("LiveQualityPanel"), "React live workbench renders quality and overlay QA as a React component");
assert.ok(liveWorkbench.includes("LiveStagePanel"), "React live workbench renders the stage shell as a React component");
assert.ok(liveWorkbench.includes("WorkbenchLayout"), "React live workbench uses the shared workbench layout shell");
assert.ok(liveWorkbench.includes("Disclaimer"), "React live workbench uses the shared disclaimer primitive");
assert.ok(liveStagePanel.includes("StageShell"), "React live stage uses the shared stage shell primitive");
assert.ok(liveStagePanel.includes("StageViewport"), "React live stage uses the shared stage viewport primitive");
assert.ok(liveStagePanel.includes("StageStatus"), "React live stage uses the shared stage status primitive");
assert.ok(liveStagePanel.includes("StageMeta"), "React live stage uses the shared stage metadata primitive");
assert.ok(liveStagePanel.includes("StageCanvas"), "React live stage uses the shared stage canvas primitive");
assert.ok(liveStagePanel.includes('<StageCanvas id="canvas" mirror'), "React live stage mirrors the 2D canvas through StageCanvas props");
assert.ok(liveStagePanel.includes('<StageCanvas id="three" visible={false}'), "React live stage hides the 3D canvas through StageCanvas visible");
assert.ok(liveStagePanel.includes("StageToast"), "React live stage uses the shared stage toast primitive");
assert.ok(liveStagePanel.includes('<StageToast id="scanToast" visible={false}>'), "React live stage hides the scan toast through StageToast visible");
assert.ok(liveStagePanel.includes("StageOverlayMessage"), "React live stage uses the shared stage overlay message primitive");
assert.ok(liveStagePanel.includes("StageZoomStrip"), "React live stage uses the shared stage zoom strip primitive");
assert.deepEqual(
  ["hidden", "mirror", "scan-toast", "overlay-msg", "zoom-strip"]
    .filter((className) => stagePanelsWithRawClass(className).includes("LiveStagePanel.tsx")),
  [],
  "React live stage should use StageShell primitives instead of hand-written stage element classes",
);
assert.ok(liveQualityPanel.includes("<StatGrid visible={false}>"), "React live quality panel hides frame-owned stats through StatGrid visible");
assert.ok(liveQualityPanel.includes("LiveOverlayQa"), "React live quality panel uses shared live overlay QA primitive");
assert.ok(liveQualityPanel.includes('<LiveOverlayQa id="incisionOverlayQa" visible={false}>'), "React live quality panel hides overlay QA through LiveOverlayQa visible");
assert.ok(liveQualityPanel.includes("LiveOverlayQaHeader"), "React live quality panel uses shared live overlay QA header primitive");
for (const className of ["hidden", "overlay-qa", "overlay-qa-top"]) {
  assert.deepEqual(
    liveQualityFeedbackConsumersWithRawClass(className),
    [],
    `React live quality panel should use live feedback primitives instead of hand-written ${className} class wrappers`,
  );
}
assert.ok(liveRouteControlsPanel.includes("dispatchLiveRouteCommand"), "React live route controls use the typed route command helper");
assert.ok(liveSourceControlsPanel.includes("dispatchLiveSourceCommand"), "React live source controls use the typed source command helper");
assert.ok(liveRenderControlsPanel.includes("dispatchLiveRenderCommand"), "React live render controls use the typed render command helper");
assert.ok(!liveRouteControlsPanel.includes("../lib/controllerEvents"), "React live route controls do not import controller event names directly");
assert.ok(!liveSourceControlsPanel.includes("../lib/controllerEvents"), "React live source controls do not import controller event names directly");
assert.ok(!liveRenderControlsPanel.includes("../lib/controllerEvents"), "React live render controls do not import controller event names directly");
assert.deepEqual(
  liveVisibilityConsumersWithRawHidden(),
  [],
  "React live control panels should use visible props instead of hand-written hidden class toggles",
);
assert.ok(liveRouteControlsPanel.includes("useLiveStore"), "React live route controls read low-frequency route and recon state from Zustand");
assert.ok(liveSourceControlsPanel.includes("useLiveStore"), "React live source controls read low-frequency source state from Zustand");
assert.ok(liveRenderControlsPanel.includes("useLiveStore"), "React live render controls read low-frequency render state from Zustand");
assert.ok(liveWorkbench.includes("Button asChild"), "React live workbench uses shared Button asChild for Router links");
assert.ok(liveWorkbench.includes("Label"), "React live workbench uses the shared shadcn-style label primitive");
assert.ok(liveRouteControlsPanel.includes("Button"), "React live route controls use the shared shadcn-style button primitive");
assert.ok(liveRouteControlsPanel.includes("ButtonRow"), "React live route controls use the shared shadcn-style button row primitive");
assert.ok(liveRouteControlsPanel.includes("CheckboxField"), "React live route controls use the shared shadcn-style checkbox field primitive");
assert.ok(liveRouteControlsPanel.includes("Label"), "React live route controls use the shared shadcn-style label primitive");
assert.ok(liveRouteControlsPanel.includes("ProgressBar"), "React live route controls use the shared shadcn-style progress primitive");
assert.ok(liveRouteControlsPanel.includes("Select"), "React live route controls use the shared shadcn-style select primitive");
assert.ok(liveRouteControlsPanel.includes("<Card"), "React live route controls use the shared shadcn-style card primitive");
assert.ok(liveRouteControlsPanel.includes('<FieldGroup id="route3dPanel" className="live-stack" visible={is3d}>'), "React live route controls show 3D route panel through FieldGroup visible");
assert.ok(liveRouteControlsPanel.includes('<LiveScanPanel id="scanPanel" visible={scanning}>'), "React live route controls show scan progress through LiveScanPanel visible");
assert.ok(liveRouteControlsPanel.includes("LiveScanRow"), "React live route controls use shared scan row primitive");
assert.ok(liveRouteControlsPanel.includes("LiveYawMeter"), "React live route controls use shared yaw meter primitive");
for (const className of ["scan-panel", "scan-row", "yaw-meter"]) {
  assert.deepEqual(
    liveScanFeedbackConsumersWithRawClass(className),
    [],
    `React live route controls should use live feedback primitives instead of hand-written ${className} class wrappers`,
  );
}
assert.ok(liveRouteControlsPanel.includes('hiddenClassName="live-hidden-inline"'), "React live route controls preserve inline twin option hiding through CheckboxField");
assert.ok(liveRouteControlsPanel.includes('<Card id="threeDWorkflowCard" visible={is3d}>'), "React live route controls show 3D workflow card through Card visible");
assert.ok(liveRouteControlsPanel.includes("Button asChild"), "React live route controls use shared Button asChild for Router links");
assert.ok(liveRouteControlsPanel.includes('variant="workbenchPrimary"'), "React live route controls keep primary workbench button styling through Button variants");
assert.ok(liveSourceControlsPanel.includes("Button"), "React live source controls use the shared shadcn-style button primitive");
assert.ok(liveSourceControlsPanel.includes("ButtonRow"), "React live source controls use the shared shadcn-style button row primitive");
assert.ok(liveSourceControlsPanel.includes("Input"), "React live source controls use the shared shadcn-style input primitive");
assert.ok(liveSourceControlsPanel.includes("<Card"), "React live source controls use the shared shadcn-style card primitive");
assert.ok(liveSourceControlsPanel.includes('variant="workbenchPrimary"'), "React live source controls keep primary workbench button styling through Button variants");
assert.ok(liveRenderControlsPanel.includes("Button"), "React live render controls use the shared shadcn-style button primitive");
assert.ok(liveRenderControlsPanel.includes("CheckboxField"), "React live render controls use the shared shadcn-style checkbox field primitive");
assert.ok(liveRenderControlsPanel.includes("FieldGroup"), "React live render controls use FieldGroup for conditional render controls");
assert.ok(liveRenderControlsPanel.includes("Label"), "React live render controls use the shared shadcn-style label primitive");
assert.ok(liveRenderControlsPanel.includes("Select"), "React live render controls use the shared shadcn-style select primitive");
assert.ok(liveRenderControlsPanel.includes("RangeInput"), "React live render controls use the shared shadcn-style range primitive");
assert.ok(liveRenderControlsPanel.includes("<Card"), "React live render controls use the shared shadcn-style card primitive");
assert.ok(liveRenderControlsPanel.includes('<Hint visible={Boolean(atlasPreview?.active)} id="atlasProvenance">'), "React live render controls show atlas provenance through Hint visible");
assert.ok(liveRenderControlsPanel.includes("<FieldGroup visible={false}>"), "React live render controls keep hidden compatibility sliders through FieldGroup visible");
assert.ok(liveRenderControlsPanel.includes('<CheckboxField visible={false} checkboxProps={{ id: "clip", defaultChecked: true }}>'), "React live render controls keep hidden compatibility checkboxes through CheckboxField visible");
assert.ok(liveQualityPanel.includes("<Card"), "React live quality panel uses the shared shadcn-style card primitive");
assert.ok(liveQualityPanel.includes("ProgressBar"), "React live quality panel uses the shared shadcn-style progress primitive");
assert.ok(liveQualityPanel.includes('data-frame-owned="true"'), "React live quality panel documents that frame-updated labels stay outside Zustand");
assert.ok(!liveQualityPanel.includes("useLiveStore"), "live quality panel should not subscribe high-frequency quality updates through Zustand");
assert.ok(liveSnapshotsService.includes("buildLiveControllerSnapshot"), "shared live snapshot service builds typed controller snapshots");
assert.ok(liveSnapshotsService.includes("liveTextOf"), "shared live snapshot service owns text normalization helpers");
assert.ok(liveSnapshotsService.includes("visibleLiveTextOf"), "shared live snapshot service owns visible text normalization helpers");
assert.ok(liveSnapshotsService.includes("../lib/controllerSnapshotSchemas"), "shared live snapshot service re-exports the lightweight schema version");
assert.ok(liveRouteControlsPanel.includes('to="/annotate"'), "React live route controls link to the React annotation route");
assert.ok(liveWorkbench.includes('to="/incision"'), "React live workbench links to the React incision route");
assert.ok(dom.includes("export function bindDom"), "DOM module can rebind element references for SPA route mounts");
assert.ok(dom.includes("export let ctx"), "DOM module exports a live canvas context binding");
assert.ok(liveController.includes("export function mountLiveWorkbench"), "live controller exposes a mount lifecycle");
assert.ok(liveController.includes("export function disposeLiveWorkbench"), "live controller exposes a dispose lifecycle");
assert.ok(liveController.includes("LIVE_CONTROLLER_STATE_EVENT"), "live controller declares a React state bridge event");
assert.ok(liveController.includes("./src/lib/controllerEvents.ts"), "live controller imports event names from the shared module");
assert.ok(liveController.includes("LIVE_ROUTE_REACT_COMMAND_EVENT"), "live controller declares a React route command bridge event");
assert.ok(liveController.includes("LIVE_SOURCE_REACT_COMMAND_EVENT"), "live controller declares a React source command bridge event");
assert.ok(liveController.includes("LIVE_RENDER_REACT_COMMAND_EVENT"), "live controller declares a React render command bridge event");
assert.ok(liveController.includes("./src/lib/controllerCommand.ts"), "live controller imports the shared command parsing module");
assert.ok(liveController.includes("bindWindowControllerEvents"), "live controller binds React command events through the shared helper");
assert.ok(!liveController.includes("window.addEventListener(LIVE"), "live controller does not register React command listeners one-by-one");
assert.ok(liveController.includes("readControllerCommandDetail(event, LIVE_SOURCE_COMMANDS)"), "live source handler validates incoming command names");
assert.ok(liveController.includes("readControllerCommandDetail(event, LIVE_RENDER_COMMANDS)"), "live render handler validates incoming command names");
assert.ok(liveController.includes("readControllerCommandDetail(event, LIVE_ROUTE_COMMANDS)"), "live route handler validates incoming command names");
assert.ok(!liveController.includes("event.detail || {}"), "live controller does not read raw command detail directly");
assert.ok(liveController.includes("handleReactRouteCommand"), "live controller routes React route commands to existing 3D workflow functions");
assert.ok(liveController.includes("handleReactSourceCommand"), "live controller routes React source commands to existing workflow functions");
assert.ok(liveController.includes("handleReactRenderCommand"), "live controller routes React render commands to existing workflow functions");
assert.ok(liveController.includes("./src/services/liveSnapshots.ts"), "live controller consumes the shared typed snapshot service");
assert.ok(liveController.includes("buildLiveControllerSnapshot({"), "live controller delegates React snapshot construction to the shared service");
assert.ok(!liveController.includes("function textOf"), "live controller no longer owns snapshot text normalization");
assert.ok(!liveController.includes("function visibleTextOf"), "live controller no longer owns visible snapshot text normalization");
assert.ok(liveController.includes("dispatchControllerEvent(LIVE_CONTROLLER_STATE_EVENT"), "live controller emits state snapshots through the shared browser event helper");
assert.ok(!liveController.includes("CustomEvent(LIVE_CONTROLLER_STATE_EVENT"), "live controller does not hand-roll state snapshot CustomEvent dispatch");
assert.ok(liveController.includes("scheduleLiveState"), "live controller publishes low-frequency state snapshots from user actions");
assert.ok(liveController.includes("bindDom(root)"), "live controller rebinds DOM references on mount");
assert.ok(liveController.includes("abortController?.abort"), "live controller aborts DOM listeners on dispose");
assert.ok(liveController.includes("resizeCleanup?.()"), "live controller disconnects resize observers on dispose");
assert.ok(liveController.includes("stopSource()"), "live controller stops camera/media sources on dispose");
assert.ok(liveController.includes("stopTwin()"), "live controller stops twin RAF on dispose");
assert.ok(liveController.includes("./src/lib/reactManagedWorkbench.ts"), "live controller imports the shared React-managed flag helper");
assert.ok(liveController.includes("!isReactManagedWorkbench()"), "legacy live HTML still auto-mounts outside React");
assert.ok(!liveController.includes("window.__LANGERFACE_REACT_MANAGED__"), "live controller does not touch the managed flag directly");
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
  assert.ok(exposesId(surgeryControlsPanel, id), `React surgery controls expose #${id}`);
}
for (const id of [
  "tensionVal",
  "tensionBar",
  "verdict",
]) {
  assert.ok(exposesId(surgeryMetricsPanel, id), `React surgery metrics expose #${id}`);
}
assert.ok(surgeryWorkbench.includes("SurgeryControlsPanel"), "React surgery workbench renders closure controls as a React component");
assert.ok(surgeryWorkbench.includes("WorkbenchBrand"), "React surgery workbench uses the shared workbench brand");
assert.ok(surgeryWorkbench.includes("SurgeryMetricsPanel"), "React surgery workbench renders closure metrics as a React component");
assert.ok(surgeryWorkbench.includes("SurgeryHelpPanel"), "React surgery workbench renders closure help as a React component");
assert.ok(surgeryWorkbench.includes("SurgeryStagePanel"), "React surgery workbench renders the R3F stage shell as a React component");
assert.ok(surgeryWorkbench.includes("WorkbenchLayout"), "React surgery workbench uses the shared workbench layout shell");
assert.ok(surgeryWorkbench.includes("Disclaimer"), "React surgery workbench uses the shared disclaimer primitive");
assert.ok(surgeryStagePanel.includes("StageShell"), "React surgery stage uses the shared stage shell primitive");
assert.ok(surgeryStagePanel.includes("StageViewport"), "React surgery stage uses the shared stage viewport primitive");
assert.ok(surgeryStagePanel.includes("StageActions"), "React surgery stage uses the shared stage actions primitive");
assert.ok(surgeryStagePanel.includes("StageLink"), "React surgery stage uses the shared stage link primitive");
assert.ok(surgeryStagePanel.includes("StageStatus"), "React surgery stage uses the shared stage status primitive");
assert.ok(surgeryStagePanel.includes("StageMeta"), "React surgery stage uses the shared stage metadata primitive");
assert.equal((surgeryControlsPanel.match(/id="btnAlong"/g) || []).length, 1, "React surgery controls have exactly one cut action");
assert.ok(!surgeryControlsPanel.includes("btnAcross"), "React surgery controls do not expose inverse-RSTL action");
assert.ok(surgeryControlsPanel.includes("Button"), "React surgery controls use the shared shadcn-style button primitive");
assert.ok(surgeryControlsPanel.includes("Button asChild"), "React surgery controls use shared Button asChild for the checkbox label button");
assert.ok(surgeryControlsPanel.includes("CheckboxField"), "React surgery controls use the shared shadcn-style checkbox field primitive");
assert.ok(surgeryControlsPanel.includes("ButtonRow"), "React surgery controls use the shared shadcn-style button row primitive");
assert.ok(surgeryControlsPanel.includes("SectionTitle"), "React surgery controls use the shared shadcn-style section title primitive");
assert.ok(surgeryControlsPanel.includes("Label"), "React surgery controls use the shared shadcn-style label primitive");
assert.ok(surgeryControlsPanel.includes("RangeInput"), "React surgery controls use the shared shadcn-style range primitive");
assert.ok(surgeryControlsPanel.includes("<Card"), "React surgery controls use the shared shadcn-style card primitive");
assert.ok(surgeryMetricsPanel.includes("<Card"), "React surgery metrics use the shared shadcn-style card primitive");
assert.ok(surgeryMetricsPanel.includes("ProgressBar"), "React surgery metrics use the shared shadcn-style progress primitive");
assert.ok(surgeryMetricsPanel.includes("Legend"), "React surgery metrics use the shared legend primitive");
assert.ok(surgeryMetricsPanel.includes("LegendSwatch"), "React surgery metrics use the shared legend swatch primitive");
assert.ok(surgeryHelpPanel.includes("这是在演示什么？"), "React surgery help panel keeps the closure explanation");
assert.ok(surgeryHelpPanel.includes("HelpDisclosure"), "React surgery help panel uses the shared help disclosure primitive");
assert.ok(surgeryStagePanel.includes('to="/annotate"'), "React surgery stage returns to the React annotation route");
assert.ok(surgeryController.includes("export function mountSurgeryClosureDemo"), "surgery controller exposes a mount lifecycle");
assert.ok(surgeryController.includes("export function disposeSurgeryClosureDemo"), "surgery controller exposes a dispose lifecycle");
assert.ok(surgeryController.includes("cancelAnimationFrame"), "surgery controller cancels its render loop on dispose");
assert.ok(surgeryController.includes("S.resizeObserver?.disconnect"), "surgery controller disconnects ResizeObserver on dispose");
assert.ok(surgeryController.includes("S.abortController?.abort"), "surgery controller aborts DOM listeners on dispose");
assert.ok(surgeryController.includes("S.head?.dispose"), "surgery controller disposes WebGL resources on dispose");
assert.ok(surgeryController.includes("./src/lib/reactManagedWorkbench.ts"), "surgery controller imports the shared React-managed flag helper");
assert.ok(surgeryController.includes("!isReactManagedWorkbench()"), "legacy surgery HTML still auto-mounts outside React");
assert.ok(!surgeryController.includes("window.__LANGERFACE_REACT_MANAGED__"), "surgery controller does not touch the managed flag directly");

console.log("test_react_architecture: React SPA architecture boundaries passed");
