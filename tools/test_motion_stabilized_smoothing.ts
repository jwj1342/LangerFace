// Contract checks for #39 whole-face motion stabilization.
//   node tools/test_motion_stabilized_smoothing.ts
import assert from "node:assert/strict";
import { RIGID3D } from "../web/src/services/constantsGenerated.ts";
import { MotionStabilizedOneEuro, OneEuro, __smoothingForTests } from "../web/src/services/geometrySmoothing.ts";

function makeFace(shiftX = 0, localEyeNoise = 0) {
  const landmarks = Array.from({ length: 478 }, (_, index) => [
    320 + (index % 17) * 2 + shiftX,
    240 + Math.floor(index / 17) * 1.5,
    0,
  ]);
  for (const index of RIGID3D) {
    landmarks[index] = [320 + shiftX + (index % 5) * 6, 240 + Math.floor(index % 11) * 7, 0];
  }
  landmarks[33][0] += localEyeNoise;
  landmarks[133][0] += localEyeNoise;
  return landmarks;
}

function sequence({ frames = 36, velocity = 9, jitter = 5 }) {
  const out = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const sign = frame % 2 === 0 ? 1 : -1;
    out.push(makeFace(frame * velocity + sign * jitter));
  }
  return out;
}

function centerX(points) {
  return __smoothingForTests.meanAnchorPoint(points, RIGID3D)[0];
}

function interframeJitter(values, expectedStep) {
  const residuals = [];
  for (let i = 1; i < values.length; i += 1) {
    residuals.push(Math.abs((values[i] - values[i - 1]) - expectedStep));
  }
  return residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
}

const frames = sequence({ frames: 40, velocity: 8, jitter: 4 });
const rawCenters = frames.map(centerX);
const rawJitter = interframeJitter(rawCenters, 8);

const pointwise = new OneEuro({ minCutoff: 2.7, beta: 0.056 });
const stabilized = new MotionStabilizedOneEuro({ minCutoff: 2.7, beta: 0.056 });
stabilized.configureForSmoothLevel(0.6);

const pointwiseCenters = [];
const stabilizedCenters = [];
for (let i = 0; i < frames.length; i += 1) {
  const t = i / 30;
  pointwiseCenters.push(centerX(pointwise.filter(frames[i].map((p) => p.slice()), t)));
  stabilizedCenters.push(centerX(stabilized.filter(frames[i].map((p) => p.slice()), t)));
}

const pointwiseJitter = interframeJitter(pointwiseCenters.slice(8), 8);
const stabilizedJitter = interframeJitter(stabilizedCenters.slice(8), 8);

assert.ok(rawJitter > 6, "synthetic sequence contains high-frequency whole-face jitter");
assert.ok(
  stabilizedJitter < pointwiseJitter * 0.72,
  `motion stabilizer reduces fast whole-face jitter (${stabilizedJitter} < ${pointwiseJitter})`,
);

const centered = __smoothingForTests.centeredLandmarks(makeFace(12), [12, 0, 0]);
const restored = __smoothingForTests.restoreCenter(centered, [12, 0, 0]);
assert.deepEqual(restored[1], makeFace(12)[1], "centered/restored landmarks round-trip");

stabilized.reset();
const first = stabilized.filter(makeFace(15, 20), 0);
assert.equal(first[33][0] - first[133][0], makeFace(15, 20)[33][0] - makeFace(15, 20)[133][0]);

console.log("test_motion_stabilized_smoothing: whole-face motion stabilization assertions passed");
