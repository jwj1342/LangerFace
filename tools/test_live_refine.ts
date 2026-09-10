import assert from "node:assert/strict";

import {
  assessRefineLineQuality,
  applyMirroredCurveDelta,
  applyCurveRefinementTransport,
  buildCurveRefinementTransport,
  curvePointWindow,
  curveEraseTargets,
  deformCurveWide,
  explicitSymmetryPartnerIndex,
  mapRefineViewportPoint,
  moveCurvePoints,
  stabilizeCurveToReference,
} from "../web/src/services/liveRefineMath.ts";

const cleanQuality = assessRefineLineQuality(
  [{ name: "upper", pts: [[0, 0], [20, 0]] }, { name: "lower", pts: [[0, 20], [20, 20]] }],
  [{ name: "upper", pts: [[0, 1], [20, 1]] }, { name: "lower", pts: [[0, 20], [20, 20]] }],
  { minimumSpacingPx: 6 },
);
assert.equal(cleanQuality.ok, true, "small safe edits must pass the post-edit quality review");

const selfIntersectionQuality = assessRefineLineQuality(
  [{ name: "loop", pts: [[0, 0], [10, 0], [20, 0], [30, 0]] }],
  [{ name: "loop", pts: [[0, 0], [20, 20], [0, 20], [20, 0]] }],
);
assert.deepEqual(selfIntersectionQuality.warnings.map((warning) => warning.code), ["new_self_intersection"],
  "a newly introduced self-intersection must require review");

const crossingQuality = assessRefineLineQuality(
  [{ name: "a", pts: [[0, 0], [20, 0]] }, { name: "b", pts: [[0, 20], [20, 20]] }],
  [{ name: "a", pts: [[0, 0], [20, 0]] }, { name: "b", pts: [[10, -10], [10, 10]] }],
);
assert.ok(crossingQuality.warnings.some((warning) => warning.code === "new_curve_intersection"),
  "a new crossing between edited curves must require review");

const denseQuality = assessRefineLineQuality(
  [{ name: "a", pts: [[0, 0], [20, 0]] }, { name: "b", pts: [[0, 20], [20, 20]] }],
  [{ name: "a", pts: [[0, 0], [20, 0]] }, { name: "b", pts: [[0, 4], [20, 4]] }],
  { minimumSpacingPx: 6 },
);
assert.ok(denseQuality.warnings.some((warning) => warning.code === "new_dense_spacing"),
  "a newly over-dense neighbouring curve pair must require review");

const preExistingCrossing = assessRefineLineQuality(
  [{ name: "a", pts: [[0, 0], [20, 20]] }, { name: "b", pts: [[0, 20], [20, 0]] }],
  [{ name: "a", pts: [[0, 0], [20, 20]] }, { name: "b", pts: [[1, 20], [20, 1]] }],
);
assert.equal(preExistingCrossing.ok, true,
  "pre-existing atlas crossings must not be mislabeled as risks introduced by the edit");

const automatic = [{ name: "left", pts: [[10, 20, 0], [20, 20, 0], [30, 20, 0]] }];
const deformed = deformCurveWide(automatic[0].pts, 1, [20, 28], { width: 100, height: 100 });
assert.deepEqual(deformed[1].slice(0, 2), [20, 28], "grabbed point must follow the pointer exactly");
assert.ok(deformed[0][1] > 20 && deformed[2][1] > 20, "curve-wide falloff must move neighbouring points smoothly");
assert.ok(deformed[1][1] - 20 > deformed[0][1] - 20,
  "line drag must retain a real local curve deformation instead of becoming rigid translation");

const transport = buildCurveRefinementTransport(automatic, [{ ...automatic[0], pts: deformed }]);
const nextFrame = [{ name: "left", pts: [[20, 40, 0], [40, 40, 0], [60, 40, 0]] }];
const transported = applyCurveRefinementTransport(nextFrame, transport, { width: 100, height: 100 });
assert.ok(transported[0].pts[1][1] > 50, "frozen-frame edit must scale onto a later live frame");

const guidedBaseline = [{
  name: "nose_reference",
  region: "nose",
  pts: [[20, 10, 0], [20, 30, 0], [20, 50, 0]],
  tris: [1, 2, 3],
}];
const guidedResult = [{
  ...guidedBaseline[0],
  hiddenPointRuns: [[0, 1] as [number, number]],
  pts: [[22, 10, 0], [22, 30, 0], [22, 50, 0]],
}, {
  name: "personalized_nose_dorsum_wrinkle_1",
  region: "personalized_nose_dorsum_wrinkle_v1",
  pts: [[26, 15, 0], [27, 30, 0], [26, 45, 0]],
  tris: [],
}];
const guidedTransport = buildCurveRefinementTransport(guidedBaseline, guidedResult);
assert.equal(guidedTransport.addedLines?.length, 1,
  "wrinkle-guided curves outside the standard atlas must become display-only live attachments");
const guidedLiveFrame = [{
  name: "nose_reference",
  region: "nose",
  pts: [[40, 20, 0], [40, 60, 0], [40, 100, 0]],
  tris: [11, 12, 13],
}];
const guidedLive = applyCurveRefinementTransport(guidedLiveFrame, guidedTransport, {
  width: 200,
  height: 200,
});
assert.equal(guidedLive.length, 2,
  "the live frame must append wrinkle-guided generated lines instead of falling back to standard RSTL only");
assert.equal(guidedLive[1].name, "personalized_nose_dorsum_wrinkle_1");
assert.deepEqual(guidedLive[1].tris, [11, 12, 13],
  "generated live lines inherit current-frame face visibility anchors rather than frozen screen coordinates");
assert.deepEqual(guidedLive[0].hiddenPointRuns, [[0, 1]],
  "wrinkle-guided visibility gaps must survive transport into the camera renderer");
assert.ok(guidedLive[1].pts.every((point) => point[0] > 40),
  "generated lines must retain their local offset while following the current face frame");
assert.deepEqual(curveEraseTargets(2, 7, true), [2, 7], "symmetry erase must include the partner curve");
assert.deepEqual(curveEraseTargets(2, 7, false), [2], "independent erase must affect only the selected curve");
assert.equal(explicitSymmetryPartnerIndex([
  { name: "brow_left_main", pts: [[10, 10]] },
  { name: "nearby_unpaired", pts: [[12, 10]] },
  { name: "brow_right_main", pts: [[90, 10]] },
], 0), 2, "explicit left/right names must resolve their declared mirror");
assert.equal(explicitSymmetryPartnerIndex([
  { name: "curve_a", region: "brow", pts: [[10, 10]] },
  { name: "curve_b", region: "brow", pts: [[12, 10]] },
], 0), null, "nearby unpaired curves must never be guessed as symmetry partners");
assert.equal(explicitSymmetryPartnerIndex([
  { name: "curve_a", symmetryPairId: "pair-1", pts: [[10, 10]] },
  { name: "curve_b", symmetryPairId: "pair-1", pts: [[90, 10]] },
], 0), 1, "symmetry pair ids must remain opt-in linkage contracts");

const largeDrag = deformCurveWide(
  [[0, 40], [25, 40], [50, 40], [75, 40], [100, 40]],
  2,
  [50, 500],
  { width: 200, height: 600, spread: 0.12 },
);
assert.ok(largeDrag[2][1] <= 58.01,
  "large line drags must be softly capped relative to curve and frame scale");
assert.ok(Math.max(...largeDrag.slice(1).map((point, index) => Math.abs(point[1] - largeDrag[index][1]))) < 10,
  "large line drags must broaden their falloff instead of creating a sharp spike");
assert.ok(Math.abs((largeDrag[2][1] - 40) - (largeDrag[0][1] - 40)) < 1,
  "extreme line drags must converge on rigid translation instead of stretching the curve");
const baseline: Array<[number, number]> = [[0, 40], [25, 40], [50, 40], [75, 40], [100, 40]];
let cumulative = baseline.map((point) => [...point]);
for (let iteration = 0; iteration < 8; iteration++) {
  const anchorIndex = iteration % baseline.length;
  const dx = iteration % 2 === 0 ? 800 : -800;
  const dy = iteration % 3 === 0 ? 700 : -700;
  cumulative = deformCurveWide(
    cumulative,
    anchorIndex,
    [cumulative[anchorIndex][0] + dx, cumulative[anchorIndex][1] + dy],
    { width: 200, height: 600, spread: 0.12 },
  );
  cumulative = stabilizeCurveToReference(
    baseline,
    cumulative,
    { width: 200, height: 600 },
    anchorIndex,
  );
  assert.ok(cumulative.every((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])),
    "pathological pointer jumps must never produce invalid curve coordinates");
  for (let index = 1; index < baseline.length; index++) {
    const baseDx = baseline[index][0] - baseline[index - 1][0];
    const baseDy = baseline[index][1] - baseline[index - 1][1];
    const currentDx = cumulative[index][0] - cumulative[index - 1][0];
    const currentDy = cumulative[index][1] - cumulative[index - 1][1];
    assert.ok(Math.hypot(currentDx - baseDx, currentDy - baseDy) <= Math.hypot(baseDx, baseDy) * 0.281,
      "every segment deformation must stay within the configured strain bound");
  }
}
assert.ok(cumulative.every((point, index) => Math.hypot(
  point[0] - baseline[index][0],
  point[1] - baseline[index][1],
) <= 18.01), "repeated line drags must remain bounded relative to the frozen automatic baseline");

const curvedBaseline: Array<[number, number]> = [
  [280, 280], [310, 270], [340, 276], [370, 295], [400, 305], [430, 296], [460, 278], [490, 272],
];
let stressedCurve = curvedBaseline.map((point) => [...point]);
for (let iteration = 0; iteration < 60; iteration++) {
  const anchorIndex = (iteration * 5) % curvedBaseline.length;
  const angle = iteration * 1.73;
  stressedCurve = deformCurveWide(
    stressedCurve,
    anchorIndex,
    [
      stressedCurve[anchorIndex][0] + Math.cos(angle) * 5000,
      stressedCurve[anchorIndex][1] + Math.sin(angle) * 5000,
    ],
    { width: 900, height: 700, spread: 0.12, maxDisplacement: 30 },
  );
  stressedCurve = stabilizeCurveToReference(
    curvedBaseline,
    stressedCurve,
    { width: 900, height: 700, maxDisplacement: 30 },
    anchorIndex,
  );
}
assert.ok(stressedCurve.every((point, index) => Math.hypot(
  point[0] - curvedBaseline[index][0],
  point[1] - curvedBaseline[index][1],
) <= 30.01), "many adversarial drags must not escape the cumulative displacement limit");
for (let index = 1; index < curvedBaseline.length; index++) {
  const baseVector: [number, number] = [
    curvedBaseline[index][0] - curvedBaseline[index - 1][0],
    curvedBaseline[index][1] - curvedBaseline[index - 1][1],
  ];
  const currentVector: [number, number] = [
    stressedCurve[index][0] - stressedCurve[index - 1][0],
    stressedCurve[index][1] - stressedCurve[index - 1][1],
  ];
  assert.ok(Math.hypot(currentVector[0] - baseVector[0], currentVector[1] - baseVector[1])
    <= Math.hypot(baseVector[0], baseVector[1]) * 0.281,
  "many adversarial drags must not stretch or reverse any curve segment");
}
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

assert.deepEqual(
  mapRefineViewportPoint([640, 360], { width: 1280, height: 720 }, { sx: 100, sy: 50, sw: 400, sh: 200 }),
  [300, 150],
  "focused-region pointer coordinates must map through the exact rendered crop",
);
assert.deepEqual(
  mapRefineViewportPoint([320, 180], { width: 1280, height: 720 }, null),
  [320, 180],
  "full-face pointer coordinates must remain unchanged",
);

console.log("test_live_refine: strain-bounded line deformation, point-window, focus mapping, transport, and delta symmetry passed");
