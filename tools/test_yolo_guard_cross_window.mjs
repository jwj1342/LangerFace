import assert from "node:assert/strict";
import { yoloGuardCurvesCross } from
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

console.log("global guard monotone crossing window exactly matches full scan");
