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
]);

calls.length = 0;
assert.equal(router.render("template_change", "provider"), false);
assert.equal(router.render("density_input", -1), false);
assert.equal(router.render("density_input", 101), false);
assert.equal(router.render("density_input", null), false);
assert.equal(router.render("opacity_input", "NaN"), false);
assert.equal(router.render("mirror_toggle", "false"), false);
assert.equal(router.handleSourceEvent(event({ command: "unknown" })), false);
assert.equal(router.handleRenderEvent(event({ command: "density_input", value: 120 })), false);
assert.deepEqual(calls, [], "invalid commands and payloads never enter action code");

assert.equal(router.handleSourceEvent(event({ command: "camera_toggle" })), true);
assert.equal(router.handleRenderEvent(event({ command: "density_input", value: 66 })), true);
assert.deepEqual(calls, [
  "run:camera_toggle", "cameraToggle",
  "run:density_input", "densityInput:66",
]);

console.log("ok: live command router validates and dispatches source and render actions");
