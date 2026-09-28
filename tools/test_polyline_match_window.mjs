import assert from "node:assert/strict";
import {
  pointToPolylineMatch,
  polylineMatchSegments,
} from "../web/src/services/personalized/v6RstlRefinementV9.ts";

let state = 0x6c9f8b27;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2 ** 32;
};

const check = (curve, points) => {
  const segments = polylineMatchSegments(curve);
  for (const point of points) {
    const full = pointToPolylineMatch(point, curve, segments, false);
    const windowed = pointToPolylineMatch(point, curve, segments, true);
    assert.deepStrictEqual(windowed, full,
      `nearest segment changed for ${JSON.stringify({ curve, point })}`,
    );
    const reusable = { distance: -1, tangent: [-1, -1] };
    assert.strictEqual(pointToPolylineMatch(point, curve, segments, true, reusable), reusable);
    assert.deepStrictEqual(reusable, full,
      `reused nearest-segment output changed for ${JSON.stringify({ curve, point })}`);
  }
};

for (const curve of [
  [], [[0, 0]], [[0, 0], [0, 0]],
  [[0, 0], [0, 10], [0, -10], [10, 0]],
  [[10, 0], [0, 0], [-10, 0]],
  [[-10, 0], [0, 10], [0, -10], [10, 0]],
  [[-10, 0], [-5, 0], [0, 0], [5, 0], [10, 0]],
  [[0, 0], [10, Number.NaN], [20, 0]],
  [[0, 0], [10, Infinity], [20, 0]],
]) {
  check(curve, Array.from({ length: 50 }, () =>
    [(random() - 0.5) * 100, (random() - 0.5) * 100]));
}
check([[0, 0], [10, 0], [20, 0]], [[Number.NaN, 0], [Infinity, 0]]);

for (let trial = 0; trial < 200; trial += 1) {
  const length = 2 + Math.floor(random() * 100);
  let x = -100;
  const curve = Array.from({ length }, () => {
    x += trial % 4 === 0 ? 0 : random() * 5;
    return [x, (random() - 0.5) * 200];
  });
  if (trial % 5 === 0) curve.reverse();
  if (trial % 7 === 0) curve[Math.floor(length / 2)][0] -= 30;
  check(curve, Array.from({ length: 100 }, () =>
    [-120 + random() * 400, (random() - 0.5) * 300]));
}

console.log("polyline match window exactly matches full scan on boundary and randomized cases");
