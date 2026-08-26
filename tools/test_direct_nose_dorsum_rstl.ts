import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildDirectNoseDorsumRstl,
  DIRECT_NOSE_DORSUM_FINE_LINE_IDS,
  DIRECT_NOSE_DORSUM_RSTL_ALGORITHM,
  DIRECT_NOSE_DORSUM_RSTL_REGION,
} from "../web/src/services/personalized/directNoseDorsumRstl.ts";

const payload = JSON.parse(await readFile(new URL(
  "../web/assets/wrinkle_fine_lines_v10_wrinkle.json", import.meta.url,
), "utf8"));
const sourceSnapshot = JSON.stringify(payload.lines);
const safeEyePolygons = [
  [[350, 520], [430, 500], [430, 570], [350, 570]],
  [[800, 500], [880, 520], [880, 570], [800, 570]],
] as Array<Array<[number, number]>>;
const result = buildDirectNoseDorsumRstl({
  fineLines: payload.lines,
  faceWidthPx: 622,
  eyePolygons: safeEyePolygons,
  existingCurves: [{ pts: [[300, 700], [900, 700]] }],
});

assert.equal(result.curves.length, 3);
assert.equal(result.diagnostics.algorithm, DIRECT_NOSE_DORSUM_RSTL_ALGORITHM);
assert.equal(result.diagnostics.source_wrinkles_excluded_from_refinement, true);
assert.equal(result.diagnostics.existing_rstl_curve_displacement_count, 0);
assert.equal(result.diagnostics.existing_curve_intersection_count, 0);
assert.equal(result.diagnostics.generated_curve_intersection_count, 0);
assert.deepEqual(result.diagnostics.source_fine_line_ids.sort(),
  [...DIRECT_NOSE_DORSUM_FINE_LINE_IDS].sort());
assert.equal(JSON.stringify(payload.lines), sourceSnapshot,
  "direct generation must not mutate wrinkle evidence");

for (const curve of result.curves) {
  assert.equal(curve.region, DIRECT_NOSE_DORSUM_RSTL_REGION);
  assert.equal(curve.generatedFromWrinkle, true);
  assert.ok(curve.pts.length >= 8);
  assert.deepEqual(curve.pts, curve.priorPts);
  assert.ok(curve.normalOffsetsPx.every((value) => value === 0));
}
for (const record of result.diagnostics.records as Array<Record<string, number>>) {
  assert.ok(record.maximum_turn_degrees <= 8 + 1e-6);
  assert.ok(record.mean_adherence_px <=
    Number(result.diagnostics.maximum_mean_adherence_limit_px) + 1e-6);
  assert.ok(record.minimum_eye_clearance_px >=
    Number(result.diagnostics.minimum_eye_clearance_limit_px) - 1e-6);
}

assert.throws(() => buildDirectNoseDorsumRstl({
  fineLines: payload.lines,
  faceWidthPx: 622,
  eyePolygons: [[[570, 480], [670, 480], [670, 530], [570, 530]]],
}), /eye safety exclusion zone/);

assert.throws(() => buildDirectNoseDorsumRstl({
  fineLines: payload.lines,
  faceWidthPx: 622,
  existingCurves: [{ pts: [[620, 470], [620, 540]] }],
}), /intersects an existing/);

const auditedIntersection = buildDirectNoseDorsumRstl({
  fineLines: payload.lines,
  faceWidthPx: 622,
  existingCurves: [{ name: "nasal-root-vertical", pts: [[620, 470], [620, 540]] }],
  auditExistingCurveIntersections: true,
});
assert.ok(Number(auditedIntersection.diagnostics.existing_curve_intersection_count) > 0);
assert.equal(auditedIntersection.diagnostics.existing_curve_intersection_policy,
  "audited_direct_overlay_intersections");

console.log("direct nose-dorsum wrinkle RSTL generation tests passed");
