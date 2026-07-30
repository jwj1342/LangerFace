// Shared-golden parity for the Python and Web TypeScript local RSTL direction services.
import assert from "node:assert/strict";
import fs from "node:fs";

import { queryDirection } from "../web/src/services/incisionToolCore.ts";

const fixture = JSON.parse(
  fs.readFileSync(new URL("../web/test/rstl_direction_contract.json", import.meta.url), "utf8"),
);

function axisAngleDiffDeg(left, right) {
  return Math.abs((((left - right + 90) % 180) + 180) % 180 - 90);
}

function vectorError(left, right) {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

for (const testCase of fixture.cases) {
  const result = queryDirection(
    testCase.point,
    testCase.vertices,
    testCase.triangles,
    testCase.atlas,
  );
  const expected = testCase.expected;
  assert.equal(result.source, "rstl_atlas_weighted_nearest", testCase.name);
  assert.ok(
    vectorError(result.vector, expected.vector) <= fixture.scalar_tolerance,
    `${testCase.name}: direction vector drifted`,
  );
  assert.ok(
    axisAngleDiffDeg(result.angle_deg, expected.angle_deg) <= fixture.angle_tolerance_deg,
    `${testCase.name}: axial angle drifted`,
  );
  assert.ok(
    Math.abs(result.confidence - expected.confidence) <= fixture.scalar_tolerance,
    `${testCase.name}: confidence drifted`,
  );
  assert.ok(
    Math.abs(result.nearest_distance - expected.nearest_distance) <= fixture.scalar_tolerance,
    `${testCase.name}: nearest distance drifted`,
  );
  assert.equal(result.support_count, expected.support_count, testCase.name);
  assert.ok(
    Math.abs(result.angular_spread_deg - expected.angular_spread_deg)
      <= fixture.angle_tolerance_deg,
    `${testCase.name}: angular spread drifted`,
  );
  assert.deepEqual(result.confidence_reasons, expected.confidence_reasons, testCase.name);
}

const stableCase = fixture.cases[0];
const repeatedAngles = Array.from(
  { length: 100 },
  () => queryDirection(
    stableCase.point,
    stableCase.vertices,
    stableCase.triangles,
    stableCase.atlas,
  ).angle_deg,
);
assert.ok(
  Math.max(...repeatedAngles) - Math.min(...repeatedAngles) < 1e-12,
  "static direction query must remain stable across 100 frames",
);

console.log(`test_direction_parity: ${fixture.cases.length} shared Python/TypeScript cases passed`);
