// Static assertions for the removal of the retired Live 3D runtime.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const routePanel = read("web/src/components/LiveRouteControlsPanel.tsx");
const sourcePanel = read("web/src/components/LiveSourceControlsPanel.tsx");
const liveRuntime = read("web/src/services/liveRuntime.ts");
const liveState = read("web/src/services/liveState.ts");
const controllerCommand = read("web/src/lib/controllerCommand.ts");
const app = read("web/src/App.tsx");
const annotateRuntime = read("web/src/services/annotateRuntime.ts");
const annotationMeshService = read("web/src/services/annotationMeshService.ts");
const incisionRuntime = read("web/src/services/incisionRuntime.ts");
const surgeryRoute = read("web/src/routes/SurgeryRoute.tsx");

for (const route of ["/annotate", "/incision", "/surgery"]) {
  assert.ok(app.includes(`path="${route}"`), `${route} remains available`);
}
for (const route of ["/three-preview", "/app/three-preview"]) {
  assert.ok(!app.includes(`path="${route}"`), `${route} stays removed`);
}
for (const retired of [
  "web/src/services/mode3d.ts",
  "web/src/services/projection3d.ts",
  "web/src/services/liveScanLifecycle.ts",
  "web/assets/recon_demo.json",
]) {
  assert.ok(!existsSync(join(root, retired)), `${retired} is removed`);
}

assert.ok(routePanel.includes("2D 实时贴合"), "Live declares the 2D MediaPipe/RSTL runtime");
assert.ok(!/route3d|recon|scan|twin|FLAME|commands\.route/.test(routePanel), "Live UI has no hidden 3D controls");
assert.ok(!sourcePanel.includes('route !== "3d"'), "Live source controls are not gated by retired route state");
assert.ok(!/mode3d|projection3d|liveScanLifecycle|reconState|LIVE_ROUTE/.test(liveRuntime), "Live runtime cannot dispatch or enter 3D");
assert.ok(!/LiveReconState|reconState/.test(liveState), "Live state owns no 3D reconstruction resources");
assert.ok(!/LIVE_ROUTE|load_demo_recon|start_scan|view_3d|project_3d|start_twin/.test(controllerCommand), "controller API exposes no Live 3D commands");

assert.ok(annotateRuntime.includes("AnnotationMeshService"), "annotation runtime keeps the extracted mesh service");
assert.ok(annotationMeshService.includes("loadFlameBasis"), "offline FLAME-backed annotation remains available");
assert.ok(incisionRuntime.includes("mountIncisionWorkbench"), "incision workflow remains available");
assert.ok(surgeryRoute.includes("SurgeryWorkbench"), "surgery workflow remains available");

console.log("test_3d_route_ui: retired Live 3D runtime is absent while offline/workflow tools remain");
