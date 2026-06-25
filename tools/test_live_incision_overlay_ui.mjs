// Static UI contract checks for incision overlay on the live 2D page.
import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("index.html", "utf8");
const main = fs.readFileSync("main.js", "utf8");
const render = fs.readFileSync("render.js", "utf8");
const source = fs.readFileSync("pipeline/source.js", "utf8");
const loop = fs.readFileSync("pipeline/loop.js", "utf8");
const exporter = fs.readFileSync("export_canvas.js", "utf8");

assert.ok(html.includes('accept="image/*,video/*"'), "live page accepts uploaded photos and videos");
assert.ok(html.includes('id="camBtn"'), "live page exposes camera entry for realtime overlay");
assert.ok(html.includes('id="exportBtn"'), "live page exposes export action");
assert.ok(source.includes('setSource(prepared.source, "image"'), "uploaded photos enter the shared live render source");
assert.ok(source.includes('setSource(els.video, "video"'), "uploaded videos enter the shared live render source");
assert.ok(source.includes('setSource(els.video, "camera"'), "camera frames enter the shared live render source");
assert.ok(loop.includes('sourceState.sourceKind !== "image"'), "video and camera sources schedule continuous overlay frames");
assert.ok(main.includes("applyStagedIncisionOverlay"), "live page loads staged incision overlay payloads");
assert.ok(main.includes("validateIncisionOverlay(overlay)"), "live page validates incision overlay payloads before rendering");
assert.ok(main.includes("renderState.incisionOverlay = overlay"), "live page stores validated incision overlay in render state");
assert.ok(main.includes("上传照片、视频或开启摄像头后，会随 RSTL 一起显示"), "live page gives explicit overlay feedback");
assert.ok(main.includes("buildZoomCards(refreshStaticImage)"), "live page rebuilds zoom cards after loading incision overlay");
assert.ok(main.includes("createCanvasRecordingController"), "live page uses the tested canvas export controller");
assert.ok(main.includes("canvas: els.canvas"), "live page exports the rendered main canvas, including incision overlay");
assert.ok(exporter.includes("canvas.captureStream(fps)"), "export controller records the canvas stream");
assert.ok(exporter.includes('mimeType: "video/webm"'), "export controller records playable webm output");
assert.ok(render.includes("drawIncisionOverlay(lm"), "renderer draws incision overlay on every frame");
assert.ok(render.includes("measureIncisionOverlayRegistration"), "renderer measures incision overlay projection registration");
assert.ok(render.includes("incisionOverlay.registration.pass"), "renderer records passing overlay registration diagnostics");
assert.ok(render.includes("incisionOverlay.registration.fail"), "renderer records failing overlay registration diagnostics");
assert.ok(render.includes("incisionOverlay.registration.bboxDiagonalPx"), "renderer records overlay registration bbox metric");
assert.ok(render.includes("切口候选"), "zoom strip exposes a dedicated incision candidate detail card");
assert.ok(render.includes("incisionOverlayBounds"), "renderer computes incision overlay bounds for detail zoom");
assert.ok(render.includes("overlay.tumor?.center_ref"), "incision zoom includes tumor center");
assert.ok(render.includes("overlay.tumor?.boundary_refs"), "incision zoom includes tumor boundary");
assert.ok(render.includes("overlay.candidate?.polyline_refs"), "incision zoom includes candidate incision line");
assert.ok(render.includes("mapSurfaceRefs(refs, lm"), "incision zoom maps surface refs through runtime landmarks");

console.log("test_live_incision_overlay_ui: live overlay UI assertions passed");
