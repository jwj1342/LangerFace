import assert from "node:assert/strict";

import {
  applyMirroredCurveDelta,
  applyCurveRefinementTransport,
  buildCurveRefinementTransport,
  curvePointWindow,
  curveEraseTargets,
  deformCurveWide,
  moveCurvePoints,
  projectOffsetToCurveNormal,
} from "../web/src/services/liveRefineMath.ts";

const automatic = [{ name: "left", pts: [[10, 20, 0], [20, 20, 0], [30, 20, 0]] }];
const deformed = deformCurveWide(automatic[0].pts, 1, [20, 28], { width: 100, height: 100 });
assert.deepEqual(deformed[1].slice(0, 2), [20, 28], "grabbed point must follow the pointer exactly");
assert.ok(deformed[0][1] > 20 && deformed[2][1] > 20, "curve-wide falloff must move neighbouring points smoothly");

const transport = buildCurveRefinementTransport(automatic, [{ ...automatic[0], pts: deformed }]);
const nextFrame = [{ name: "left", pts: [[20, 40, 0], [40, 40, 0], [60, 40, 0]] }];
const transported = applyCurveRefinementTransport(nextFrame, transport, { width: 100, height: 100 });
assert.ok(transported[0].pts[1][1] > 50, "frozen-frame normal edit must scale onto a later live frame");
assert.deepEqual(curveEraseTargets(2, 7, true), [2, 7], "symmetry erase must include the partner curve");
assert.deepEqual(curveEraseTargets(2, 7, false), [2], "independent erase must affect only the selected curve");

const normalOffset = projectOffsetToCurveNormal([[0, 10], [10, 10], [20, 10]], 1, [4, 3]);
assert.ok(Math.abs(normalOffset[0]) < 1e-9 && Math.abs(normalOffset[1] - 3) < 1e-9,
  "normal refinement must remove movement along the curve");
assert.deepEqual(curvePointWindow(40, 20, 30), { start: 6, end: 35 },
  "point refinement must support an exact 30-point window");
const pointGroupMoved = moveCurvePoints(
  [[0, 10], [10, 10], [20, 10], [30, 10], [40, 10], [50, 10], [60, 10]],
  3,
  5,
  [0, 8],
  { width: 100, height: 100 },
);
assert.equal(pointGroupMoved.filter((point, index) => point[1] !== 10 && index !== 3).length, 4,
  "a five-point window must move exactly five contiguous points");
assert.equal(pointGroupMoved[3][1], 18, "the grabbed point must follow the pointer exactly");
assert.deepEqual(pointGroupMoved[0], [0, 10], "points outside the selected window must stay fixed");

const mirroredDelta = applyMirroredCurveDelta(
  [[20, 10], [25, 20], [30, 30]],
  [[15, 13], [25, 20], [30, 30]],
  [[80, 12], [75, 22], [70, 32]],
  50,
  { start: 0, end: 0 },
  { width: 100, height: 100 },
);
assert.deepEqual(mirroredDelta, [[85, 15], [75, 22], [70, 32]],
  "symmetry must mirror only the edit delta while preserving the partner's original fit");

console.log("test_live_refine: line, normal, point-window, transport, and delta symmetry passed");
