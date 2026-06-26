// Static UI assertions for the surgery closure demo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "web", "surgery.html"), "utf8");
const route = readFileSync(join(root, "web", "src", "routes", "SurgeryRoute.tsx"), "utf8");
const scene = readFileSync(join(root, "web", "src", "routes", "SurgeryR3FScene.tsx"), "utf8");
const controls = readFileSync(join(root, "web", "src", "components", "SurgeryControlsPanel.tsx"), "utf8");

assert.ok(html.includes("/app/surgery"), "legacy surgery page redirects to the React surgery route");
assert.ok(!html.includes("surgery_main.js"), "legacy surgery page no longer mounts the legacy controller");
assert.ok(route.includes("SurgeryR3FScene"), "React surgery route renders the R3F closure scene");
assert.ok(scene.includes('id="surgeryCanvas"'), "React surgery scene exposes the canvas id");
assert.ok(controls.includes('id="btnAlong"'), "React surgery controls expose the along-RSTL action");
assert.equal((controls.match(/id="btnAlong"/g) || []).length, 1, "React surgery controls have exactly one cut action");
assert.ok(!controls.includes("逆 RSTL 切除"), "React surgery controls do not expose inverse-RSTL action copy");
assert.ok(!controls.includes("不好"), "React surgery controls avoid good/bad binary comparison copy");
assert.ok(!controls.includes("btnAcross"), "React surgery controls do not expose an inverse-RSTL button");
assert.ok(!controls.includes("cut-across"), "React surgery controls do not style an inverse-RSTL UI action");

console.log("test_surgery_ui: along-RSTL-only closure UI assertions passed");
