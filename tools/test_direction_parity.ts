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

function assertResultMatchesContract(result, expected, caseName) {
  assert.equal(result.source, expected.source, caseName);
  assert.ok(
    vectorError(result.point, expected.point) <= fixture.scalar_tolerance,
    `${caseName}: query point drifted`,
  );
  assert.ok(
    vectorError(result.vector, expected.vector) <= fixture.scalar_tolerance,
    `${caseName}: direction vector drifted`,
  );
  assert.ok(
    axisAngleDiffDeg(result.angle_deg, expected.angle_deg) <= fixture.angle_tolerance_deg,
    `${caseName}: axial angle drifted`,
  );
  assert.ok(
    Math.abs(result.confidence - expected.confidence) <= fixture.scalar_tolerance,
    `${caseName}: confidence drifted`,
  );
  if (expected.nearest_distance === null) {
    assert.equal(result.nearest_distance, null, `${caseName}: no-support distance must be null`);
  } else {
    assert.ok(
      Math.abs(result.nearest_distance - expected.nearest_distance) <= fixture.scalar_tolerance,
      `${caseName}: nearest distance drifted`,
    );
  }
  assert.equal(result.support_count, expected.support_count, caseName);
  assert.ok(
    Math.abs(result.angular_spread_deg - expected.angular_spread_deg)
      <= fixture.angle_tolerance_deg,
    `${caseName}: angular spread drifted`,
  );
  assert.deepEqual(result.confidence_reasons, expected.confidence_reasons, caseName);

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("Infinity"), `${caseName}: result must be strict JSON`);
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), Object.keys(expected).sort(), caseName);
}

for (const testCase of fixture.cases) {
  const result = queryDirection(
    testCase.point,
    testCase.vertices,
    testCase.triangles,
    testCase.atlas,
  );
  const expected = testCase.expected;
  assertResultMatchesContract(result, expected, testCase.name);
}

const stableCase = fixture.cases[0];
// Repeated identical calls guard against future global caches or mutable
// module state making same-frame queries drift; this is not a timing test.
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
  "static direction query must not acquire cache or module-state drift",
);

const sequence = fixture.static_face_sequence;
assert.equal(sequence.frames.length, 100, "real static-face fixture must contain 100 frames");
assert.equal(sequence.frames.length, sequence.thresholds.frame_count);
assert.equal(sequence.source.kind, "privacy_minimized_real_landmark_sequence");
assert.equal(sequence.source.detected_landmark_count, 478);
const frameResults = sequence.frames.map((frame) => {
  const result = queryDirection(frame.point, frame.vertices, frame.triangles, frame.atlas);
  assertResultMatchesContract(result, frame.expected, `static frame ${frame.frame_index}`);
  return result;
});
const frameAngles = frameResults.map((result) => result.angle_deg);
const frameConfidences = frameResults.map((result) => result.confidence);
const angleMean = frameAngles.reduce((sum, value) => sum + value, 0) / frameAngles.length;
const angleStdDev = Math.sqrt(
  frameAngles.reduce((sum, value) => sum + (value - angleMean) ** 2, 0) / frameAngles.length,
);
const maxInterframeDelta = Math.max(
  ...frameAngles.slice(1).map((value, index) => Math.abs(value - frameAngles[index])),
);
assert.ok(
  Math.max(...frameAngles) - Math.min(...frameAngles)
    <= sequence.thresholds.max_axial_angle_range_deg,
  "real 100-frame axial angle range exceeds its stability gate",
);
assert.ok(
  maxInterframeDelta <= sequence.thresholds.max_interframe_angle_delta_deg,
  "real 100-frame interframe angle delta exceeds its stability gate",
);
assert.ok(
  angleStdDev <= sequence.thresholds.max_angle_std_dev_deg,
  "real 100-frame angle standard deviation exceeds its stability gate",
);
assert.ok(
  Math.min(...frameConfidences) >= sequence.thresholds.min_confidence,
  "real 100-frame confidence falls below its stability gate",
);

console.log(
  `test_direction_parity: ${fixture.cases.length} boundary cases + `
  + `${sequence.frames.length} real landmark frames passed`,
);
