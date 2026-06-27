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

assert.ok(routePanel.includes("扫描人脸重建"), "3D route exposes scan reconstruction as the primary action");
assert.ok(routePanel.includes("const projectionLabel = mode3d === \"project\" ? \"返回 3D 模型\" : \"投影到画面\""),
  "projection action can toggle back to the 3D model");
assert.ok(routePanel.includes('className="live-two-col mode-actions"'), "3D route groups scan and projection as the primary action row");
assert.ok(routePanel.includes('id="project3dBtn"'), "3D route exposes a projection toggle");
assert.ok(routePanel.includes('id="reconDemoBtn"'), "3D route keeps the hidden demo node for controller compatibility");
assert.ok(routePanel.includes("hidden") && routePanel.includes('aria-hidden="true"'), "demo reconstruction entry is hidden from the visible React UI");
assert.ok(!routePanel.includes("用示例脸"), "3D route copy does not advertise sample reconstruction");
assert.ok(routePanel.includes('visible={false} disabled={!hasModel} onClick={() => commands.route("reset_3d")}'),
  "advanced reset control is kept as a hidden compatibility node");
assert.ok(routePanel.includes('visible={false} disabled={scanning} onClick={() => commands.route("start_twin")}'),
  "experimental twin control is kept as a hidden compatibility node");

assert.ok(sourcePanel.includes('id="liveInputCard"'), "2D upload/camera controls are grouped for route visibility");
assert.ok(sourcePanel.includes('visible={route !== "3d"}'), "entering the 3D route hides the 2D upload/camera card");

assert.ok(liveRuntime.includes('if (reconState.mode3d === "project") setMode3d("view")'),
  "projection command toggles back to 3D view when already projecting");
assert.ok(mode3d.includes('els.project3d.textContent = m === "project" ? "返回 3D 模型" : "投影到画面"'),
  "legacy controller keeps the projection button label in sync");
assert.ok(mode3d.includes("3D Beta：请先扫描人脸重建"), "3D route hint points users to scanning instead of the sample face");

console.log("test_3d_route_ui: React 3D route entry assertions passed");
