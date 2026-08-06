import assert from "node:assert/strict";

import {
  LiveCommandRouter,
  type LiveCommandActions,
} from "../web/src/services/liveCommandRouter.ts";

const calls: string[] = [];
const action = (name: string, value?: unknown) => {
  calls.push(value === undefined ? name : `${name}:${String(value)}`);
};

const actions: LiveCommandActions = {
  run(reason, callback) {
    calls.push(`run:${reason}`);
    return callback();
  },
  uploadSource: () => action("uploadSource"),
  cameraToggle: () => action("cameraToggle"),
  pauseToggle: () => action("pauseToggle"),
  recordingToggle: () => action("recordingToggle"),
  templateChange: (value) => action("templateChange", value),
  densityInput: (value) => action("densityInput", value),
  opacityInput: (value) => action("opacityInput", value),
  mirrorToggle: (value) => action("mirrorToggle", value),
  meshPointsToggle: (value) => action("meshPointsToggle", value),
  restoreAtlas: () => action("restoreAtlas"),
  clearIncisionOverlay: () => action("clearIncisionOverlay"),
  routeChange: (value) => action("routeChange", value),
  loadDemoRecon: () => action("loadDemoRecon"),
  startScan: () => action("startScan"),
  view3d: () => action("view3d"),
  project3d: () => action("project3d"),
  reset3d: () => action("reset3d"),
  startTwin: () => action("startTwin"),
  toggleTwinHead: () => action("toggleTwinHead"),
  toggleTwinTexture: () => action("toggleTwinTexture"),
};

const router = new LiveCommandRouter(actions);
const event = (detail: unknown) => ({ detail });

router.source("upload_source");
router.source("camera_toggle");
router.source("pause_toggle");
router.source("recording_toggle");
router.render("template_change", "langer");
router.render("density_input", "72");
router.render("opacity_input", 45);
router.render("mirror_toggle", false);
router.render("mesh_points_toggle", true);
router.render("restore_atlas");
router.render("clear_incision_overlay");
router.route("route_change", "3d");
router.route("load_demo_recon");
router.route("start_scan");
router.route("view_3d");
router.route("project_3d");
router.route("reset_3d");
router.route("start_twin");
router.route("toggle_twin_head");
router.route("toggle_twin_texture");

assert.deepEqual(calls, [
  "run:upload_source", "uploadSource",
  "run:camera_toggle", "cameraToggle",
  "run:pause_toggle", "pauseToggle",
  "run:recording_toggle", "recordingToggle",
  "run:template_change", "templateChange:langer",
  "run:density_input", "densityInput:72",
  "run:opacity_input", "opacityInput:45",
  "run:mirror_toggle", "mirrorToggle:false",
  "run:mesh_points_toggle", "meshPointsToggle:true",
  "run:restore_atlas", "restoreAtlas",
  "run:clear_incision_overlay", "clearIncisionOverlay",
  "run:route_change", "routeChange:3d",
  "run:load_demo_recon", "loadDemoRecon",
  "run:start_scan", "startScan",
  "run:view_3d", "view3d",
  "run:project_3d", "project3d",
  "run:reset_3d", "reset3d",
  "run:start_twin", "startTwin",
  "run:toggle_twin_head", "toggleTwinHead",
  "run:toggle_twin_texture", "toggleTwinTexture",
]);

calls.length = 0;
assert.equal(router.render("template_change", "provider"), false);
assert.equal(router.render("density_input", -1), false);
assert.equal(router.render("density_input", 101), false);
assert.equal(router.render("density_input", null), false);
assert.equal(router.render("opacity_input", "NaN"), false);
assert.equal(router.render("mirror_toggle", "false"), false);
assert.equal(router.route("route_change", "agentic"), false);
assert.equal(router.handleSourceEvent(event({ command: "unknown" })), false);
assert.equal(router.handleRenderEvent(event({ command: "density_input", value: 120 })), false);
assert.equal(router.handleRouteEvent(event({ command: "route_change", value: "agentic" })), false);
assert.deepEqual(calls, [], "invalid commands and payloads never enter action code");

assert.equal(router.handleSourceEvent(event({ command: "camera_toggle" })), true);
assert.equal(router.handleRenderEvent(event({ command: "density_input", value: 66 })), true);
assert.equal(router.handleRouteEvent(event({ command: "route_change", value: "2d" })), true);
assert.deepEqual(calls, [
  "run:camera_toggle", "cameraToggle",
  "run:density_input", "densityInput:66",
  "run:route_change", "routeChange:2d",
]);

console.log("ok: live command router validates and dispatches source, render, and route actions");
