// Pure contract checks for runtime face pose / expression quality gates.
//   node tools/test_pose_quality.ts
import assert from "node:assert/strict";
import {
  estimateFacePoseQuality,
  estimateLocalRegionQuality,
  faceBBox,
  frameMotionNorm,
  normalizeFaceExpression,
  regionMotionNorm,
} from "../web/src/services/geometryPoseQuality.ts";

function makeFace({ noseX = 320, shiftX = 0 } = {}) {
  const lm = Array.from({ length: 478 }, () => [320 + shiftX, 240, 0]);
  lm[1] = [noseX + shiftX, 210, 0];
  lm[33] = [220 + shiftX, 205, 0];
  lm[263] = [420 + shiftX, 205, 0];
  lm[61] = [270 + shiftX, 305, 0];
  lm[291] = [370 + shiftX, 305, 0];
  lm[199] = [320 + shiftX, 355, 0];
  lm[234] = [200 + shiftX, 250, 0];
  lm[454] = [440 + shiftX, 250, 0];
  lm[10] = [320 + shiftX, 100, 0];
  lm[152] = [320 + shiftX, 420, 0];
  return lm;
}

function shiftedRegion(indices, dx, dy = 0) {
  const lm = makeFace();
  for (const idx of indices) lm[idx] = [lm[idx][0] + dx, lm[idx][1] + dy, lm[idx][2] || 0];
  return lm;
}

const neutral = makeFace();
const previous = makeFace();

assert.deepEqual(faceBBox(neutral), { x0: 200, y0: 100, x1: 440, y1: 420, w: 240, h: 320 });

const pass = estimateFacePoseQuality(neutral, 640, 480, {
  presence: 1,
  sourceKind: "camera",
  previousLandmarks: previous,
  expression: { jawOpen: 0.1, eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1 },
});
assert.equal(pass.passed, true, "neutral high-quality frame passes pose gate");
assert.equal(pass.schema_version, "incision-overlay-pose-gate/v0.2");

const firstFrame = estimateFacePoseQuality(neutral, 640, 480, {
  presence: 1,
  sourceKind: "camera",
});
assert.equal(firstFrame.passed, true, "first frame without a previous frame does not fail motion gate");

const side = estimateFacePoseQuality(makeFace({ noseX: 450 }), 640, 480, {
  presence: 1,
  sourceKind: "camera",
  previousLandmarks: previous,
});
assert.equal(side.passed, false, "large yaw fails pose gate");
assert.ok(side.reasons.includes("side_pose_yaw_too_large"));

const rapid = estimateFacePoseQuality(makeFace({ shiftX: 42 }), 640, 480, {
  presence: 1,
  sourceKind: "camera",
  previousLandmarks: previous,
});
assert.equal(rapid.passed, false, "rapid frame-to-frame motion fails pose gate");
assert.ok(rapid.reasons.includes("rapid_frame_motion"));
assert.ok(rapid.frame_motion_norm > rapid.thresholds.max_frame_motion_norm);
assert.ok(frameMotionNorm(makeFace({ shiftX: 42 }), previous) > 0);

const photoRapid = estimateFacePoseQuality(makeFace({ shiftX: 42 }), 640, 480, {
  presence: 1,
  sourceKind: "image",
  previousLandmarks: previous,
});
assert.ok(!photoRapid.reasons.includes("rapid_frame_motion"), "static photos do not use frame-motion gate");

const jaw = estimateFacePoseQuality(neutral, 640, 480, {
  presence: 1,
  sourceKind: "camera",
  previousLandmarks: previous,
  expression: { jawOpen: 0.8 },
});
assert.equal(jaw.passed, false, "large jaw-open expression fails pose gate");
assert.ok(jaw.reasons.includes("jaw_open_expression"));

const blink = estimateFacePoseQuality(neutral, 640, 480, {
  presence: 1,
  sourceKind: "camera",
  previousLandmarks: previous,
  expression: { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2 },
});
assert.equal(blink.passed, false, "strong blink expression fails pose gate");
assert.ok(blink.reasons.includes("eye_blink_expression"));
assert.equal(normalizeFaceExpression({ eyeBlinkLeft: 0.9 }).eye_blink_max, 0.9);

const localBlink = estimateFacePoseQuality(neutral, 640, 480, {
  presence: 1,
  sourceKind: "camera",
  previousLandmarks: previous,
  expression: { eyeBlinkLeft: 0.52, eyeBlinkRight: 0.1 },
});
assert.equal(localBlink.passed, true, "moderate blink does not fail the whole-frame pose gate");
assert.equal(localBlink.local_region_quality.passed, false, "moderate blink still marks eye/brow region for local review");
assert.equal(
  localBlink.local_region_quality.regions.find((r) => r.id === "brow_eye").action,
  "dim",
  "moderate blink dims the eye/brow region",
);
assert.ok(localBlink.local_region_quality.reasons.includes("eye_blink_local_expression"));

const localJaw = estimateLocalRegionQuality(neutral, 640, 480, {
  sourceKind: "camera",
  previousLandmarks: previous,
  expression: { jawOpen: 0.36 },
});
assert.equal(localJaw.regions.find((r) => r.id === "mouth").action, "dim", "moderate jaw-open dims mouth region");

const eyeMotion = shiftedRegion([33, 133, 159, 145, 153, 246, 7, 163], 36);
const localMotion = estimateLocalRegionQuality(eyeMotion, 640, 480, {
  sourceKind: "camera",
  previousLandmarks: previous,
});
assert.equal(localMotion.regions.find((r) => r.id === "brow_eye").action, "freeze", "rapid local eye motion freezes eye/brow region");
assert.ok(regionMotionNorm(eyeMotion, previous, [33, 133, 159, 145]) > localMotion.thresholds.freeze_region_motion_norm);

const photoLocal = estimateLocalRegionQuality(eyeMotion, 640, 480, {
  sourceKind: "image",
  previousLandmarks: previous,
  expression: { eyeBlinkLeft: 0.9, jawOpen: 0.9 },
});
assert.equal(photoLocal.passed, true, "static photos do not apply live local expression gates");

console.log("test_pose_quality: pose/expression/motion/local-region gate assertions passed");
