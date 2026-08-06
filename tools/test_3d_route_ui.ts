// Static assertions for the React 3D route entry flow. node tools/test_3d_route_ui.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const routePanel = read("web/src/components/LiveRouteControlsPanel.tsx");
const sourcePanel = read("web/src/components/LiveSourceControlsPanel.tsx");
const liveRuntime = read("web/src/services/liveRuntime.ts");
const mode3d = read("web/src/services/mode3d.ts");
const app = read("web/src/App.tsx");
const dashboardRoute = read("web/src/routes/DashboardRoute.tsx");
const settingsRoute = read("web/src/routes/SettingsRoute.tsx");
const viteConfig = read("web/vite.config.ts");
const vercelConfig = read("web/vercel.json");

assert.ok(!app.includes('path="/three-preview"'), "React Router should not expose the public 3D preview route");
assert.ok(!app.includes('path="/app/three-preview"'), "React Router should not preserve the legacy 3D preview route");
assert.ok(!dashboardRoute.includes('to: "/three-preview"'), "dashboard should not expose the public 3D preview card");
assert.ok(!settingsRoute.includes('to="/three-preview"'), "developer settings should not expose the public 3D preview entry");
assert.ok(!viteConfig.includes('pathname === "/three-preview"'), "Vite dev fallback should not keep a public 3D preview route");
assert.ok(!vercelConfig.includes('"source": "/three-preview"'), "Vercel rewrites should not keep a public 3D preview route");

assert.ok(routePanel.includes('id="routeSel"'), "live mode selector remains available for the 2D route");
assert.ok(!routePanel.includes('<option value="3d">'), "live mode selector should not expose the 3D reconstruction mode");
assert.ok(routePanel.includes('id="route3dPanel"'), "3D compatibility panel remains in code for the retained runtime boundary");
assert.ok(routePanel.includes('visible={is3d}'), "3D compatibility panel is only reachable through internal state");
assert.ok(routePanel.includes('id="reconDemoBtn"'), "demo reconstruction node is retained only for controller compatibility");
assert.ok(routePanel.includes("hidden") && routePanel.includes('aria-hidden="true"'), "demo reconstruction entry stays hidden from the visible React UI");
assert.ok(routePanel.includes('visible={false} disabled={!hasModel} onClick={() => commands.route("reset_3d")}'),
  "advanced reset control is retained as a hidden compatibility node");
assert.ok(routePanel.includes('visible={false} disabled={scanning} onClick={() => commands.route("start_twin")}'),
  "experimental twin control is retained as a hidden compatibility node");

assert.ok(sourcePanel.includes('id="liveInputCard"'), "2D upload/camera controls are grouped for route visibility");
assert.ok(sourcePanel.includes('visible={route !== "3d"}'), "retained 3D runtime state can still hide the 2D upload/camera card internally");

assert.ok(liveRuntime.includes('if (reconState.mode3d === "project") setMode3d("view")'),
  "retained projection command toggles back to 3D view when already projecting");
assert.ok(mode3d.includes('els.project3d.textContent = m === "project" ? "返回 3D 模型" : "投影到画面"'),
  "retained legacy controller keeps the projection button label in sync");
assert.ok(mode3d.includes("3D Beta：请先扫描人脸重建"), "retained 3D runtime hint remains available for the follow-up cleanup list");
assert.ok(mode3d.includes("export function stopScan"), "3D scan exposes one lifecycle cleanup boundary");
assert.ok(mode3d.includes("new LiveScanLifecycle"), "3D scan delegates session, frame, and stream ownership");
assert.ok(mode3d.includes("scanLifecycle.adoptStream"), "3D scan rejects and releases stale camera streams");
assert.ok(mode3d.includes("scanLifecycle.schedule(generation, tick)"), "3D scan schedules cancellable frames through its lifecycle");
assert.ok(mode3d.includes("new Head3DResourceLifecycle"), "3D renderer initialization is bound to the active route session");
assert.ok(mode3d.includes("bindHead3DControls"), "3D canvas controls expose one cleanup boundary");
assert.ok(mode3d.includes("export function disposeMode3d"), "3D mode exposes one complete route cleanup boundary");
assert.ok(mode3d.includes('reconState.route = "2d"') && mode3d.includes('reconState.mode3d = "view"'),
  "3D route disposal restores the public 2D/view initial state");
assert.ok(mode3d.includes("await buildViewer(generation)"), "async demo reconstruction cannot create a viewer in a later route session");
assert.ok(liveRuntime.includes("disposeMode3d();"), "live route disposal releases all 3D resources");

console.log("test_3d_route_ui: public 3D route closure assertions passed");
