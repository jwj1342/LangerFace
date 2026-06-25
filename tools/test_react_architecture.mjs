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
const incisionRoute = read("src/routes/IncisionRoute.tsx");
const incisionWorkbench = read("src/routes/IncisionWorkbench.tsx");
const threeRoute = read("src/routes/ThreePreviewRoute.tsx");
const worker = read("src/workers/workflow.worker.ts");
const workerClient = read("src/services/workflowWorkerClient.ts");
const workerPanel = read("src/components/WorkerStatusPanel.tsx");
const controller = read("incision_agent_main.js");

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
assert.ok(app.includes('path="/incision"'), "React Router exposes the incision workbench route");
assert.ok(app.includes('path="/three-preview"'), "React Router exposes the R3F preview route");
assert.ok(typedStore.includes("React/Zustand stores low-frequency UI"), "Zustand store documents low-frequency state ownership");
assert.ok(typedStore.includes("per-frame arrays stay outside persisted stores"), "Zustand store forbids high-frequency renderer arrays");
assert.ok(typedStore.includes("interface AppState"), "Zustand store is typed");

assert.ok(incisionRoute.includes("__LANGERFACE_REACT_MANAGED__"), "React incision route disables controller auto-mount");
assert.ok(incisionRoute.includes("mountIncisionAgentWorkbench"), "React incision route mounts the existing controller explicitly");
assert.ok(incisionRoute.includes("disposeIncisionAgentWorkbench"), "React incision route can dispose the existing controller");
assert.ok(incisionRoute.includes("<IncisionWorkbench />"), "React incision route renders the workbench as TSX");
assert.ok(!incisionRoute.includes("DOMParser"), "React incision route should not parse legacy HTML");
assert.ok(!incisionRoute.includes("innerHTML"), "React incision route should not inject legacy HTML");
assert.ok(!incisionRoute.includes("incision_agent.html"), "React incision route should not fetch the legacy workbench HTML");
for (const id of [
  "tumorKind",
  "providerBaseUrl",
  "runAgentBtn",
  "agentCanvas",
  "candidateList",
  "reviewDecision",
  "stageStatus",
]) {
  assert.ok(incisionWorkbench.includes(`id="${id}"`), `React incision workbench exposes #${id}`);
}
assert.ok(incisionWorkbench.includes('href="/index.html"'), "React incision workbench uses absolute links outside /app");
assert.ok(incisionWorkbench.includes('href="/annotate.html"'), "React incision workbench links to 3D annotation from /app safely");
assert.ok(controller.includes("export function mountIncisionAgentWorkbench"), "incision controller exposes a mount lifecycle");
assert.ok(controller.includes("export function disposeIncisionAgentWorkbench"), "incision controller exposes a dispose lifecycle");
assert.ok(controller.includes("cancelAnimationFrame"), "incision controller cancels its render loop on dispose");
assert.ok(controller.includes("S.resizeObserver?.disconnect"), "incision controller disconnects ResizeObserver on dispose");
assert.ok(controller.includes("S.head?.dispose"), "incision controller disposes WebGL resources on dispose");

assert.ok(threeRoute.includes("@react-three/fiber"), "R3F preview uses @react-three/fiber");
assert.ok(threeRoute.includes("@react-three/drei"), "R3F preview uses drei helpers");
assert.ok(threeRoute.includes("OrbitControls"), "R3F preview uses drei OrbitControls");
assert.ok(threeRoute.includes("loadJsonAsset"), "R3F preview lazy-loads runtime assets");
assert.ok(worker.includes("Comlink.expose"), "workflow worker exposes its API through Comlink");
assert.ok(worker.includes("summarizeTumorInputQuality"), "workflow worker can run deterministic browser tools");
assert.ok(worker.includes("handles_high_frequency_render_state: false"), "workflow worker explicitly avoids high-frequency renderer state");
assert.ok(workerClient.includes("Comlink.wrap"), "React app wraps the workflow worker with Comlink");
assert.ok(workerClient.includes("new Worker(new URL"), "workflow worker is loaded through Vite worker URL handling");
assert.ok(workerClient.includes("worker.terminate"), "workflow worker client has an explicit dispose lifecycle");
assert.ok(workerPanel.includes("createWorkflowWorkerClient"), "React dashboard probes the worker boundary");

console.log("test_react_architecture: React SPA architecture boundaries passed");
