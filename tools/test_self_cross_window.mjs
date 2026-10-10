import assert from "node:assert/strict";
import { selfCrossesWithWindow } from "../web/src/services/personalized/v6RstlRefinementV9.ts";

let state = 0x71564a8d;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2 ** 32;
};

const check = (points) => {
  // The implementation memoizes by point-array identity, so each path needs
  // its own input to actually exercise both algorithms.
  const full = selfCrossesWithWindow(points.map((point) => [...point]), false);
  const windowed = selfCrossesWithWindow(points.map((point) => [...point]), true);
  assert.equal(windowed, full,
    `self-crossing result changed for ${JSON.stringify(points)}`);
};

for (const points of [
  [], [[0, 0]], [[0, 0], [1, 1]],
  [[0, 0], [2, 2], [0, 2], [2, 0]],
  [[0, 0], [0, 10], [0, -10], [0, 0]],
  [[0, 0], [10, 10], [20, 0], [30, 10]],
  [[0, 0], [10, Number.NaN], [20, 0], [30, 10]],
  [[0, 0], [10, Infinity], [20, 0], [30, 10]],
]) check(points);

for (let trial = 0; trial < 2000; trial += 1) {
  const length = 2 + Math.floor(random() * 80);
  let x = -100;
  const points = Array.from({ length }, () => {
    x += trial % 4 === 0 ? 0 : random() * 6;
    return [x, (random() - 0.5) * 200];
  });
  if (trial % 4 === 2) points.reverse();
  if (trial % 4 === 3) points[Math.floor(length / 2)][0] -= 40;
  check(points);
}

console.log("monotone self-cross window exactly matches full scan on boundary and randomized cases");
