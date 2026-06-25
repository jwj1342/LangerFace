import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");

const read = (rel) => fs.readFileSync(path.join(web, rel), "utf8");
const pkg = JSON.parse(read("package.json"));
const appHtml = read("app/index.html");
const vite = read("vite.config.js");
const vercel = read("vercel.json");
const app = read("src/App.jsx");
const store = read("src/stores/appStore.js");
const incisionRoute = read("src/routes/IncisionRoute.jsx");
const threeRoute = read("src/routes/ThreePreviewRoute.jsx");
const controller = read("incision_agent_main.js");

for (const dep of [
  "react",
  "react-dom",
  "react-router-dom",
  "zustand",
  "@react-three/fiber",
  "@react-three/drei",
  "@radix-ui/react-slot",
  "tailwind-merge",
]) {
  assert.ok(pkg.dependencies?.[dep], `React architecture dependency ${dep} should be installed`);
}
assert.ok(pkg.devDependencies?.tailwindcss, "Tailwind should be installed for React UI workbench styling");
assert.ok(pkg.devDependencies?.["@tailwindcss/vite"], "Tailwind Vite plugin should be installed");

assert.ok(appHtml.includes('id="root"'), "React app HTML exposes a root mount node");
assert.ok(appHtml.includes("../src/main.jsx"), "React app HTML loads the React entrypoint");
assert.ok(vite.includes("@tailwindcss/vite"), "Vite config loads the Tailwind plugin");
assert.ok(vite.includes('app: resolve(import.meta.dirname, "app/index.html")'), "Vite builds the SPA app entry");
assert.ok(vercel.includes('"source": "/app/(.*)"'), "Vercel rewrites nested SPA routes");
assert.ok(vercel.includes('"destination": "/app/index.html"'), "Vercel routes SPA paths back to app/index.html");

assert.ok(app.includes("react-router-dom"), "React app is routed through React Router");
assert.ok(app.includes('path="/incision"'), "React Router exposes the incision workbench route");
assert.ok(app.includes('path="/three-preview"'), "React Router exposes the R3F preview route");
assert.ok(store.includes("React/Zustand stores low-frequency UI"), "Zustand store documents low-frequency state ownership");
assert.ok(store.includes("per-frame arrays stay outside persisted stores"), "Zustand store forbids high-frequency renderer arrays");

assert.ok(incisionRoute.includes("__LANGERFACE_REACT_MANAGED__"), "React incision route disables controller auto-mount");
assert.ok(incisionRoute.includes("mountIncisionAgentWorkbench"), "React incision route mounts the existing controller explicitly");
assert.ok(incisionRoute.includes("disposeIncisionAgentWorkbench"), "React incision route can dispose the existing controller");
assert.ok(controller.includes("export function mountIncisionAgentWorkbench"), "incision controller exposes a mount lifecycle");
assert.ok(controller.includes("export function disposeIncisionAgentWorkbench"), "incision controller exposes a dispose lifecycle");
assert.ok(controller.includes("cancelAnimationFrame"), "incision controller cancels its render loop on dispose");
assert.ok(controller.includes("S.resizeObserver?.disconnect"), "incision controller disconnects ResizeObserver on dispose");
assert.ok(controller.includes("S.head?.dispose"), "incision controller disposes WebGL resources on dispose");

assert.ok(threeRoute.includes("@react-three/fiber"), "R3F preview uses @react-three/fiber");
assert.ok(threeRoute.includes("@react-three/drei"), "R3F preview uses drei helpers");
assert.ok(threeRoute.includes("OrbitControls"), "R3F preview uses drei OrbitControls");
assert.ok(threeRoute.includes("loadJsonAsset"), "R3F preview lazy-loads runtime assets");

console.log("test_react_architecture: React SPA architecture boundaries passed");
