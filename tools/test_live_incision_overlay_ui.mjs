// Static UI contract checks for incision overlay on the live 2D page.
import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("index.html", "utf8");
const main = fs.readFileSync("main.js", "utf8");
const render = fs.readFileSync("render.js", "utf8");

assert.ok(html.includes('accept="image/*,video/*"'), "live page accepts uploaded photos and videos");
assert.ok(html.includes('id="camBtn"'), "live page exposes camera entry for realtime overlay");
assert.ok(html.includes('id="exportBtn"'), "live page exposes export action");
assert.ok(main.includes("applyStagedIncisionOverlay"), "live page loads staged incision overlay payloads");
assert.ok(main.includes("validateIncisionOverlay(overlay)"), "live page validates incision overlay payloads before rendering");
assert.ok(main.includes("renderState.incisionOverlay = overlay"), "live page stores validated incision overlay in render state");
assert.ok(main.includes("buildZoomCards(refreshStaticImage)"), "live page rebuilds zoom cards after loading incision overlay");
assert.ok(main.includes("els.canvas.captureStream(30)"), "live page exports rendered canvas, including incision overlay");
assert.ok(main.includes("new MediaRecorder(stream"), "live page records exported overlay video with MediaRecorder");
assert.ok(render.includes("drawIncisionOverlay(lm"), "renderer draws incision overlay on every frame");
assert.ok(render.includes("切口候选"), "zoom strip exposes a dedicated incision candidate detail card");
assert.ok(render.includes("incisionOverlayBounds"), "renderer computes incision overlay bounds for detail zoom");
assert.ok(render.includes("overlay.tumor?.center_ref"), "incision zoom includes tumor center");
assert.ok(render.includes("overlay.tumor?.boundary_refs"), "incision zoom includes tumor boundary");
assert.ok(render.includes("overlay.candidate?.polyline_refs"), "incision zoom includes candidate incision line");
assert.ok(render.includes("mapSurfaceRefs(refs, lm"), "incision zoom maps surface refs through runtime landmarks");

console.log("test_live_incision_overlay_ui: live overlay UI assertions passed");
