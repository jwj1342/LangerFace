import assert from "node:assert/strict";
import { yoloGuardCurvesCross, yoloGuardSelfCrosses } from
  "../web/src/services/personalized/yoloGuidedRstlScope.ts";

let state = 0x97b4ae15;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2 ** 32;
};

const check = (first, second) => {
  assert.equal(yoloGuardCurvesCross(first, second, true),
    yoloGuardCurvesCross(first, second, false),
    `global guard crossing changed for ${JSON.stringify({ first, second })}`);
};

for (const [first, second] of [
  [[], []], [[[0, 0]], [[0, 0]]],
  [[[0, 0], [10, 10]], [[0, 10], [10, 0]]],
  [[[0, 0], [10, 10]], [[10, 10], [20, 0]]],
  [[[0, 0], [0, 10]], [[-5, 5], [5, 5]]],
  [[[0, 0], [10, 0]], [[5, 0], [15, 0]]],
  [[[0, 0], [10, 10]], [[0, Number.NaN], [10, 0]]],
  [[[0, 0], [10, 10]], [[0, Infinity], [10, 0]]],
  [[[Number.NaN, 0], [10, 10]], [[0, 10], [10, 0]]],
]) check(first, second);

const curve = (length, mode) => {
  let x = -100;
  const points = Array.from({ length }, () => {
    x += mode === 0 ? 0 : random() * 6;
    return [x, (random() - 0.5) * 200];
  });
  if (mode === 2) points.reverse();
  if (mode === 3) points[Math.floor(length / 2)][0] -= 40;
  return points;
};
for (let trial = 0; trial < 2000; trial += 1) {
  check(curve(2 + Math.floor(random() * 60), trial % 4),
    curve(2 + Math.floor(random() * 60), (trial >>> 2) % 4));
}

const orientation = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) -
  (b[1] - a[1]) * (c[0] - a[0]);
const strictSelfCross = (points) => {
  for (let first = 1; first < points.length; first++) {
    for (let second = first + 2; second < points.length; second++) {
      const a = points[first - 1], b = points[first];
      const c = points[second - 1], d = points[second];
      if (orientation(a, b, c) * orientation(a, b, d) < -1e-7 &&
          orientation(c, d, a) * orientation(c, d, b) < -1e-7) return true;
    }
  }
  return false;
};
for (const points of [
  [], [[0, 0]], [[0, 0], [0, 10], [0, -10], [0, 5]],
  [[0, 0], [10, 10], [0, 10], [10, 0]],
  [[10, 0], [5, 4], [5, -4], [0, 0]],
  [[10, 0], [5, 4], [0, 0]],
  [[0, 0], [1, 1], [2, Number.NaN], [3, 0]],
  [[0, 0], [1, 1], [2, Infinity], [3, 0]],
]) assert.equal(yoloGuardSelfCrosses(points), strictSelfCross(points));
for (let trial = 0; trial < 3000; trial++) {
  const points = curve(2 + Math.floor(random() * 75), trial % 4);
  assert.equal(yoloGuardSelfCrosses(points), strictSelfCross(points),
    `global guard self-cross changed for ${JSON.stringify(points)}`);
}

console.log("global guard crossing and self-cross windows exactly match full scans");
