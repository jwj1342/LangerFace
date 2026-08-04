import assert from "node:assert/strict";
import {
  displacementSamples,
  percentile,
  resultExtent,
  validateV6Result,
  V6_ALGORITHM,
  V6_EXPECTED_CURVE_COUNT,
} from "../web/src/services/personalized/v6ReviewModel.ts";

assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
assert.deepEqual(resultExtent([{ points_xy: [[10, 20]], points_prior_xy: [[8, 18]] }]), { width: 10, height: 20 });
assert.equal(displacementSamples({ points_prior_xy: [[0, 0], [1, 0]], points_xy: [[0, 0], [2, 0]] }).length, 1);

const lines = Array.from({ length: V6_EXPECTED_CURVE_COUNT }, (_, index) => ({
  name: `curve_${index}`,
  points_prior_xy: [[0, 0], [1, 0]],
  points_xy: index === 0 ? [[0, 0], [2, 0]] : [[0, 0], [1, 0]],
}));
const report = validateV6Result({
  diagnostics: { algorithm: V6_ALGORITHM, topology_contract_preserved: true },
  lines,
});
assert.equal(report.ok, true);
assert.equal(report.metrics.curveCount, V6_EXPECTED_CURVE_COUNT);
assert.equal(report.metrics.pointCount, V6_EXPECTED_CURVE_COUNT * 2);
assert.equal(report.metrics.movedCurveCount, 1);
assert.equal(report.metrics.movedPointCount, 1);

const broken = validateV6Result({ lines: lines.slice(1) });
assert.equal(broken.ok, false);
assert.match(broken.errors.join(" "), /曲线数/);

console.log("v6 review model tests passed");
