// Static UI contract checks for incision overlay on the live 2D page.
import fs from "node:fs";
import assert from "node:assert/strict";

const compatibilityHtml = fs.readFileSync("index.html", "utf8");
const liveRoute = fs.readFileSync("src/routes/LiveWorkbench.tsx", "utf8");
const liveUi = [
  liveRoute,
  fs.readFileSync("src/components/LiveSourceControlsPanel.tsx", "utf8"),
  fs.readFileSync("src/components/LiveQualityPanel.tsx", "utf8"),
].join("\n");
const main = fs.readFileSync("src/services/liveRuntime.ts", "utf8");
const render = fs.readFileSync("src/services/render2d.ts", "utf8");
const overlayStyle = fs.readFileSync("src/services/incisionOverlayStyle.ts", "utf8");
const three3d = fs.readFileSync("src/services/three3d.ts", "utf8");
const source = fs.readFileSync("src/services/pipelineSource.ts", "utf8");
const loop = fs.readFileSync("src/services/pipelineLoop.ts", "utf8");
const exporter = fs.readFileSync("src/services/canvasRecording.ts", "utf8");
const poseQuality = fs.readFileSync("src/services/geometryPoseQuality.ts", "utf8");
const liveSnapshots = fs.readFileSync("src/services/liveSnapshots.ts", "utf8");
const controllerSnapshotSchemas = fs.readFileSync("src/lib/controllerSnapshotSchemas.ts", "utf8");

assert.ok(compatibilityHtml.includes("/src/main.tsx"), "root HTML mounts the React tool launcher");
assert.ok(!compatibilityHtml.includes("main.js"), "legacy live HTML no longer mounts the live controller directly");
assert.ok(liveUi.includes('accept="image/*,video/*"'), "React live page accepts uploaded photos and videos");
assert.ok(liveUi.includes('id="camBtn"'), "React live page exposes camera entry for realtime overlay");
assert.ok(liveUi.includes('id="exportBtn"'), "React live page exposes export action");
assert.ok(!liveRoute.includes("LiveIncisionOverlayPanel"),
  "live page does not inject the incision overlay card into the collaborator-owned layout");
assert.ok(source.includes('setSource(prepared.source, "image"'), "uploaded photos enter the shared live render source");
assert.ok(source.includes('setSource(els.video, "video"'), "uploaded videos enter the shared live render source");
assert.ok(source.includes('setSource(els.video, "camera"'), "camera frames enter the shared live render source");
assert.match(loop, /if \((?:sourceState\.sourceKind|sourceKind) !== "image"\) requestFrame\(\)/, "video and camera sources schedule continuous overlay frames");
assert.ok(loop.includes("eyeBlinkLeft"), "pipeline extracts left blink blendshape for overlay quality gate");
assert.ok(loop.includes("eyeBlinkRight"), "pipeline extracts right blink blendshape for overlay quality gate");
assert.ok(loop.includes("jawOpen"), "pipeline extracts jaw-open blendshape for overlay quality gate");
assert.ok(main.includes("applyStagedIncisionOverlay"), "live page loads staged incision overlay payloads");
assert.ok(main.includes("validateIncisionOverlay(overlay)"), "live page validates incision overlay payloads before rendering");
assert.ok(main.includes("renderState.incisionOverlay = overlay"), "live page stores validated incision overlay in render state");
assert.ok(main.includes("renderState.incisionOverlay = null"), "live page clears an incision overlay without affecting the RSTL atlas");
assert.ok(main.includes("./liveSnapshots"), "live page consumes the shared live snapshot service");
assert.ok(main.includes("buildLiveControllerSnapshot({"), "live page delegates React snapshot construction to the shared service");
assert.ok(liveSnapshots.includes("../lib/controllerSnapshotSchemas"), "shared live snapshot service reuses the lightweight React snapshot schema module");
assert.ok(controllerSnapshotSchemas.includes("react-live-controller-snapshot/v0.2"), "shared snapshot schema module owns the 2D-only live React snapshot schema");
assert.ok(liveSnapshots.includes("buildLiveControllerSnapshot"), "shared live snapshot service builds low-frequency live controller snapshots");
assert.ok(main.includes("setIncisionOverlayQa"), "live page shows pending overlay QA feedback after loading a candidate");
assert.ok(main.includes("上传照片、视频或开启摄像头后，会随 RSTL 一起显示"), "live page gives explicit overlay feedback");
assert.ok(main.includes("buildZoomCards(refreshStaticImage)"), "live page rebuilds zoom cards after loading incision overlay");
assert.ok(main.includes("createCanvasRecordingController"), "live page uses the tested canvas export controller");
assert.ok(main.includes("canvas: els.canvas"), "live page exports the rendered main canvas, including incision overlay");
assert.ok(main.includes("getExtraCanvases: visibleRecordingCanvases"), "live page includes visible zoom canvases in composite export");
assert.ok(!main.includes('label: "3D 视图"'), "live export has no retired 3D canvas");
assert.ok(exporter.includes("sourceCanvas.captureStream(fps)"), "export controller records the selected source canvas stream");
assert.ok(exporter.includes("createCompositeSource(extras)"), "export controller can compose detail canvases");
assert.ok(exporter.includes("drawContain(g, extra.canvas"), "export controller draws extra canvases into recording");
assert.ok(exporter.includes('mimeType: "video/webm"'), "export controller records playable webm output");
assert.ok(render.includes("drawIncisionOverlay(lm"), "renderer draws incision overlay on every frame");
assert.ok(render.includes("incisionOverlayStyle(W, overlay.candidate_type)"),
  "renderer reads candidate presentation from the shared cross-media style contract");
assert.ok(render.includes("overlayStyle.candidate.haloColor"),
  "renderer gives the candidate line the shared dark contrast halo");
assert.ok(render.includes("overlayStyle.candidate.lineWidth"),
  "renderer gives the candidate line the shared foreground width");
assert.ok(overlayStyle.includes("nominalCandidateLineWidth = Math.max(0.3, rstlLineWidth / 6)"),
  "shared live media retain the nominal one-sixth RSTL candidate width");
assert.ok(overlayStyle.includes("visibleCandidateSourceWidth"),
  "photo-only rendering may enforce a bounded final-display visibility floor without changing RSTL");
assert.ok(render.includes("estimateFacePoseQuality"), "renderer estimates pose quality before drawing incision overlay");
assert.ok(poseQuality.includes("incision-overlay-pose-gate/v0.2"), "renderer exports a versioned incision overlay pose gate");
assert.ok(poseQuality.includes("rapid_frame_motion"), "pose gate blocks rapid frame-to-frame motion");
assert.ok(poseQuality.includes("jaw_open_expression"), "pose gate blocks large jaw-open expression");
assert.ok(poseQuality.includes("eye_blink_expression"), "pose gate blocks strong blink expression");
assert.ok(render.includes("renderQualityDiagnostics"), "renderer tracks previous frame for whole-frame quality gate");
assert.ok(render.includes("sourceState.qualityGate = gate"), "renderer stores whole-frame quality gate for status UI");
assert.ok(render.includes("sourceState.localRegionQuality = gate.local_region_quality"), "renderer stores local region quality gate for status UI");
assert.ok(render.includes('const canDrawAtlas = sourceState.sourceKind === "image" || frameQualityGate.passed'), "renderer pauses live RSTL lines when quality gate fails");
assert.ok(render.includes('gate && !gate.passed ? "需复核"'), "quality indicator reflects gated frames as review-needed");
assert.ok(poseQuality.includes("rstl-local-region-quality-gate/v0.1"), "renderer exports versioned local region quality gate");
assert.ok(render.includes("buildLocalRegionMasks"), "renderer maps local quality regions to screen regions");
assert.ok(render.includes('localActionForPoints([p], localRegionMasks).action === "freeze"'), "renderer freezes unstable local RSTL regions");
assert.ok(render.includes('localLineAction.action === "dim"'), "renderer dims locally unstable RSTL regions");
assert.ok(render.includes('"局部复核"'), "quality indicator reflects local region review state");
assert.ok(render.includes("incisionOverlay.poseGate.frameMotionNorm"), "renderer records overlay motion gate metric");
assert.ok(render.includes("incisionOverlay.poseGate.eyeBlinkMax"), "renderer records overlay blink gate metric");
assert.ok(render.includes("incisionOverlay.localRegionQuality.activeRegionCount"), "renderer records local region quality metrics");
assert.ok(render.includes("minTriangleAreaPx2"), "renderer filters degenerate projected triangles during live occlusion");
assert.ok(render.includes("measureIncisionOverlayRegistration"), "renderer measures incision overlay projection registration");
assert.ok(render.includes("measureIncisionOverlayJitter"), "renderer measures live incision overlay rolling jitter");
assert.ok(render.includes("incisionOverlay.poseGate.blocked"), "renderer records blocked overlay pose gate diagnostics");
assert.ok(render.includes("incisionOverlay.registration.pass"), "renderer records passing overlay registration diagnostics");
assert.ok(render.includes("incisionOverlay.registration.fail"), "renderer records failing overlay registration diagnostics");
assert.ok(render.includes("incisionOverlay.registration.bboxDiagonalPx"), "renderer records overlay registration bbox metric");
assert.ok(render.includes("incisionOverlay.stability.rmsPx"), "renderer records overlay stability rms metric");
assert.ok(render.includes("incision-overlay-runtime-diagnostics/v0.1"), "renderer exports runtime overlay diagnostics section");
assert.ok(render.includes('setDiagnosticSection("incision_overlay_runtime"'), "renderer publishes sanitized overlay diagnostics section");
assert.ok(render.includes("exported_landmarks: false"), "overlay diagnostics do not export landmark coordinates");
assert.ok(render.includes("updateIncisionOverlayQa(registration, stability, poseGate, localRegionQuality)"), "renderer updates visible overlay QA from measured results");
assert.ok(render.includes("pose_gate: compactPoseGate(poseGate)"), "runtime overlay diagnostics include sanitized pose gate state");
assert.ok(render.includes("local_region_quality: compactLocalRegionQuality(localRegionQuality)"), "runtime overlay diagnostics include sanitized local region quality");
assert.ok(render.includes("landmark_smoothing: compactLandmarkSmoothing()"), "runtime overlay diagnostics include smoothing parameters");
assert.ok(render.includes("landmark-motion-stabilized-smoothing/v0.1"), "renderer exports versioned smoothing diagnostics");
assert.ok(render.includes('method: hasGlobal ? "global_translation_plus_local_one_euro"'), "smoothing diagnostics identify global motion stabilization");
assert.ok(render.includes("姿态需复核"), "renderer surfaces pose-gated overlay feedback");
assert.ok(render.includes("局部需复核"), "renderer surfaces local-region overlay feedback");
assert.ok(render.includes("投射需复核"), "renderer surfaces registration failure feedback");
assert.ok(render.includes("抖动需复核"), "renderer surfaces stability failure feedback");
assert.ok(render.includes("叠加稳定"), "renderer surfaces stable overlay feedback");
assert.ok(render.includes("切口候选"), "zoom strip exposes a dedicated incision candidate detail card");
assert.ok(render.includes("incisionOverlayBounds"), "renderer computes incision overlay bounds for detail zoom");
assert.ok(render.includes("overlay.tumor?.center_ref"), "incision zoom includes tumor center");
assert.ok(render.includes("overlay.tumor?.boundary_refs"), "incision zoom includes tumor boundary");
assert.ok(render.includes("overlay.candidate?.polyline_refs"), "incision zoom includes candidate incision line");
assert.ok(render.includes("mapSurfaceRefs(refs, lm"), "incision zoom maps surface refs through runtime landmarks");
assert.ok(three3d.includes("setIncisionOverlay("), "3D viewer can render incision overlay surface refs");
assert.ok(three3d.includes("setIncisionOverlayPoints("), "3D viewer can render mapped overlay points");
assert.ok(three3d.includes("tumor_boundary_points"), "3D viewer renders tumor boundary points");
assert.ok(three3d.includes("candidate_points"), "3D viewer renders candidate incision points");
assert.ok(!fs.existsSync("src/services/mode3d.ts"), "Live overlay no longer ships the retired 3D runtime");

console.log("test_live_incision_overlay_ui: live overlay UI assertions passed");
