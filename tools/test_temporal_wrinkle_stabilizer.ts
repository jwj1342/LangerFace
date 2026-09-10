import assert from "node:assert/strict";

import { TemporalWrinkleStabilizer } from
  "../web/src/services/temporalWrinkleStabilizer.ts";

const stabilizer = new TemporalWrinkleStabilizer({ previousShapeWeight: 0.5 });
const first = stabilizer.update([{
  id: "first-id",
  className: "forehead",
  points: [[10, 10], [20, 12], [30, 10]],
}], 100);
assert.deepEqual(first[0].points, [[10, 10], [20, 12], [30, 10]]);

const translatedWithJitter = [[20, 15], [30, 19], [40, 15]] as Array<[number, number]>;
const second = stabilizer.update([{
  id: "unstable-new-id",
  className: "forehead",
  points: translatedWithJitter,
}], 100);
assert.equal(second[0].id, "first-id", "a matched fresh detection keeps a stable identity");
const inputCenter = translatedWithJitter.reduce(
  (sum, point) => [sum[0] + point[0] / 3, sum[1] + point[1] / 3],
  [0, 0],
);
const outputCenter = second[0].points.reduce(
  (sum, point) => [sum[0] + point[0] / 3, sum[1] + point[1] / 3],
  [0, 0],
);
assert.ok(Math.hypot(inputCenter[0] - outputCenter[0], inputCenter[1] - outputCenter[1]) < 1e-9,
  "temporal smoothing preserves current-detection global motion");
assert.ok(Math.abs(second[0].points[1][1] - 19) > 0.5,
  "temporal smoothing reduces local point jitter");

assert.deepEqual(stabilizer.update([], 100), [],
  "a missing current line is never retained from history");
const reappeared = stabilizer.update([{
  id: "new-after-gap",
  className: "forehead",
  points: [[20, 15], [30, 15], [40, 15]],
}], 100);
assert.equal(reappeared[0].id, "new-after-gap",
  "a line after a missing frame starts a new association");

console.log("ok: fresh wrinkle detections preserve motion, reduce jitter, and never retain missing lines");
