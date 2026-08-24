import assert from "node:assert/strict";

import {
  buildNoseRootIntersectionVisibilityPlan,
  NOSE_ROOT_PRESERVED_CURVE_NAMES,
  noseRootVisibilityGeometryMaximumDelta,
  snapshotNoseRootVisibilityGeometry,
  visibilityMaskForCurve,
} from "../web/src/services/personalized/noseRootIntersectionVisibility.ts";
import { DIRECT_NOSE_DORSUM_RSTL_REGION } from
  "../web/src/services/personalized/directNoseDorsumRstl.ts";

const preserved = NOSE_ROOT_PRESERVED_CURVE_NAMES.map((name, index) => ({
  name,
  region: "orbital_brow_upturn_v11",
  id: index,
  pts: [
    [12 + index, 0], [12 + index, 6], [12 + index, 10],
    [12 + index, 14], [12 + index, 18], [12 + index, 24],
  ],
}));
const crossing = {
  name: "unmarked_crossing",
  region: "nose_root_cross_v9",
  id: 4,
  pts: [[0, 0], [8, 8], [15, 15], [26, 26], [30, 30]],
};
const direct = [0, 1, 2].map((index) => ({
  name: `personalized_nose_dorsum_wrinkle_${index + 1}`,
  region: DIRECT_NOSE_DORSUM_RSTL_REGION,
  id: 5 + index,
  pts: [[10, 10 + index * 4], [15, 10 + index * 4], [20, 10 + index * 4]],
}));
const curves = [...preserved, crossing, ...direct];
const snapshot = snapshotNoseRootVisibilityGeometry(curves);
const plan = buildNoseRootIntersectionVisibilityPlan({ curves, faceWidthPx: 100 });

assert.deepEqual(plan.roi, {
  minX: 6, minY: 6, maxX: 24, maxY: 22, width: 18, height: 16,
});
assert.equal(plan.preservedCurveIndices.length, 4);
assert.equal(plan.directNoseCurveIndices.length, 3);
assert.equal(plan.hiddenCurveCount, 4);
assert.equal(plan.contracts.preservedTrajectoryIntersectionGapCurveCount, 4);
assert.equal(plan.contracts.visiblePreservedDirectIntersectionCount, 0);
assert.deepEqual(
  visibilityMaskForCurve(crossing, [true, true, true, true, false], plan),
  [true, true, true, true, false],
  "non-intersection curves and their existing visibility must remain unchanged",
);
for (const curve of preserved) {
  assert.deepEqual(visibilityMaskForCurve(curve, [true, true, true, true, true, true], plan),
    [true, true, true, false, false, true],
    "the lateral contact point stays visible while only the crossing tail is interrupted");
}
for (const curve of direct) {
  assert.deepEqual(visibilityMaskForCurve(curve, [true, false, true], plan),
    [true, false, true], "direct nose curves must keep their base visibility");
}
assert.equal(noseRootVisibilityGeometryMaximumDelta(curves, snapshot), 0);
assert.deepEqual(curves.map((curve) => curve.pts), snapshot,
  "building or applying visibility must not mutate curve geometry");

console.log("nose-root intersection visibility tests passed");
