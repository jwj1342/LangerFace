import assert from "node:assert/strict";

import {
  inspectPathPolygonRelation,
  resamplePolyline2d,
} from "../web/src/services/incisionPathGeometry.ts";
import {
  annotateCandidateEngineeringViolations,
  annotateCandidateSensitiveDistances,
  buildMediaPipeEngineeringExclusionZones,
  inspectTumorEngineeringExclusions,
  inspectTumorPointEngineeringExclusion,
} from "../web/src/services/incisionToolCore.ts";
import { assessReviewReadiness, buildReviewGate } from "../web/src/services/incisionReviewPolicy.ts";

const exclusion = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]] as Array<[number, number]>;

const crossing = inspectPathPolygonRelation([[0.2, 0.5], [0.8, 0.5]], exclusion);
assert.equal(crossing.intersects, true, "a sparse line detects a middle crossing");
assert.equal(crossing.boundary_intersects, true);

const enclosingFusiform = [[0.2, 0.5], [0.5, 0.8], [0.8, 0.5], [0.5, 0.2]] as Array<[number, number]>;
const enclosing = inspectPathPolygonRelation(enclosingFusiform, exclusion, { closedPath: true });
assert.equal(enclosing.intersects, true, "a closed outline detects a contained exclusion polygon");
assert.equal(enclosing.path_contains_polygon, true);

const near = inspectPathPolygonRelation([[0.2, 0.35], [0.8, 0.35]], exclusion);
assert.equal(near.intersects, false, "nearby geometry is not treated as an intersection");
assert.ok((near.minimum_distance || 0) > 0);

const sparseSamples = resamplePolyline2d([[0.2, 0.59], [0.8, 0.59]], 0.01);
const denseSamples = resamplePolyline2d([[0.2, 0.59], [0.5, 0.59], [0.8, 0.59]], 0.01);
assert.deepEqual(sparseSamples[0], denseSamples[0]);
assert.deepEqual(sparseSamples.at(-1), denseSamples.at(-1));
for (const samples of [sparseSamples, denseSamples]) {
  assert.ok(samples.slice(1).every((point, index) =>
    Math.hypot(point[0] - samples[index][0], point[1] - samples[index][1]) <= 0.01 + 1e-12),
  "resampling keeps a stable maximum step across source densities");
}

const verts = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0]];
const sparseCandidate = { type: "linear", polyline: [[2, 5.9, 0], [8, 5.9, 0]], metrics: {} };
const denseCandidate = { type: "linear", polyline: [[2, 5.9, 0], [5, 5.9, 0], [8, 5.9, 0]], metrics: {} };
annotateCandidateSensitiveDistances(sparseCandidate, verts);
annotateCandidateSensitiveDistances(denseCandidate, verts);
assert.ok(Math.abs(
  sparseCandidate.metrics.sensitive_free_margin_min_distance_mm
    - denseCandidate.metrics.sensitive_free_margin_min_distance_mm,
) < 1e-9, "sensitive distance is stable across path sampling densities");

const outsideCandidate = { type: "linear", polyline: [[-1, 8, 0], [5, 8, 0]], metrics: {} };
annotateCandidateEngineeringViolations(outsideCandidate, verts);
assert.deepEqual(outsideCandidate.hard_violations.map((item) => item.code), ["candidate_outside_canonical_surface"]);

const invalidCandidate = { type: "linear", polyline: [[2, 5, 0], [Number.NaN, 5, 0]], metrics: {} };
annotateCandidateSensitiveDistances(invalidCandidate, verts);
assert.equal(invalidCandidate.hard_violations[0].code, "invalid_candidate_geometry");

const exclusionCandidate = {
  type: "linear",
  polyline: [[2, 5, 0], [8, 5, 0]],
  engineering_exclusion_zones: [{ id: "fixture-opening", code: "candidate_intersects_non_skin_opening", polygon: exclusion }],
};
annotateCandidateEngineeringViolations(exclusionCandidate, verts);
assert.equal(exclusionCandidate.hard_violations[0].code, "candidate_intersects_non_skin_opening");

for (const [marginId, polyline] of [
  ["left_nasal_ala_margin", [[2, 4.8, 0], [6, 4.8, 0]]],
  ["lip_vermilion_margin", [[5, 2, 0], [5, 4, 0]]],
] as const) {
  const freeMarginCandidate = { type: "linear", polyline };
  annotateCandidateEngineeringViolations(freeMarginCandidate, verts);
  assert.ok(!freeMarginCandidate.hard_violations.some((item) =>
    item.code === "candidate_crosses_sensitive_free_margin"),
  `${marginId} remains a reviewable sensitive guide instead of a non-skin-opening hard block`);
}

const mediapipeVerts = Array.from({ length: 468 }, () => [5, 5, 0]);
mediapipeVerts[0] = [0, 0, 0];
mediapipeVerts[1] = [10, 0, 0];
mediapipeVerts[2] = [0, 10, 0];
mediapipeVerts[3] = [10, 10, 0];
const leftEye = [33, 160, 158, 133, 153, 144];
const leftEyePolygon = [[3, 6, 0], [3.5, 6.5, 0], [4, 6.5, 0], [4.5, 6, 0], [4, 5.5, 0], [3.5, 5.5, 0]];
leftEye.forEach((vertexIndex, index) => { mediapipeVerts[vertexIndex] = leftEyePolygon[index]; });
const rightEye = [362, 385, 387, 263, 373, 380];
const rightEyePolygon = [[6, 6, 0], [6.5, 6.5, 0], [7, 6.5, 0], [7.5, 6, 0], [7, 5.5, 0], [6.5, 5.5, 0]];
rightEye.forEach((vertexIndex, index) => { mediapipeVerts[vertexIndex] = rightEyePolygon[index]; });
const oralOpening = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
oralOpening.forEach((vertexIndex, index) => {
  const angle = (Math.PI * 2 * index) / oralOpening.length;
  mediapipeVerts[vertexIndex] = [5 + Math.cos(angle) * 1.5, 3 + Math.sin(angle) * 0.6, 0];
});
const outerLip = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
outerLip.forEach((vertexIndex, index) => {
  const angle = (Math.PI * 2 * index) / outerLip.length;
  mediapipeVerts[vertexIndex] = [5 + Math.cos(angle) * 2, 3 + Math.sin(angle), 0];
});
const topologyZones = buildMediaPipeEngineeringExclusionZones(mediapipeVerts);
assert.deepEqual(topologyZones.map((zone) => zone.id), [
  "left-eye-opening",
  "right-eye-opening",
  "oral-opening",
  "left-nostril-opening",
  "right-nostril-opening",
  "default-vermilion-protection",
]);
assert.equal(topologyZones[0].projection_buffer_scale, 1,
  "eye opening hard gate follows the topology loop without an unvalidated expansion buffer");
for (const [zoneId, polyline] of [
  ["left-eye-opening", [[2, 6, 0], [5, 6, 0]]],
  ["right-eye-opening", [[5.5, 6, 0], [8, 6, 0]]],
  ["oral-opening", [[3, 3, 0], [7, 3, 0]]],
] as const) {
  const topologyOpeningCandidate = { type: "linear", polyline };
  annotateCandidateEngineeringViolations(topologyOpeningCandidate, mediapipeVerts);
  assert.ok(topologyOpeningCandidate.hard_violations.some((item) =>
    item.code === "candidate_intersects_non_skin_opening" && item.location.zone_id === zoneId));
}
assert.match(topologyZones[0].clinical_boundary, /engineering exclusions only/);
const invalidCenter = inspectTumorPointEngineeringExclusion([3.7, 6, 0], mediapipeVerts);
assert.equal(invalidCenter?.zone_id, "left-eye-opening", "lesion centers inside an eye opening are rejected");
assert.equal(inspectTumorPointEngineeringExclusion([3.7, 6.6, 0], mediapipeVerts), null,
  "visible eyelid skin just outside the topology opening is not rejected by an expansion buffer");
assert.equal(inspectTumorPointEngineeringExclusion([5, 5, 0], mediapipeVerts), null);
assert.equal(inspectTumorPointEngineeringExclusion([5, 2.2, 0], mediapipeVerts), null,
  "the conservative vermilion candidate gate does not prohibit a lip lesion center");
assert.equal(inspectTumorPointEngineeringExclusion([4.05, 5.3, 0], mediapipeVerts)?.zone_id,
  "left-nostril-opening", "lesion centers inside the audited nostril aperture are rejected");
assert.equal(inspectTumorPointEngineeringExclusion([3.65, 5.3, 0], mediapipeVerts), null,
  "visible nasal-ala skin outside the aperture is not rejected");
const nostrilCrossingCandidate = { type: "linear", polyline: [[3.8, 5.3, 0], [4.3, 5.3, 0]] };
annotateCandidateEngineeringViolations(nostrilCrossingCandidate, mediapipeVerts);
assert.ok(nostrilCrossingCandidate.hard_violations.some((item) =>
  item.code === "candidate_intersects_non_skin_opening"
    && item.location?.zone_id === "left-nostril-opening"),
"a complete candidate path crossing a nostril aperture is hard-blocked");
const vermilionCrossingCandidate = { type: "linear", polyline: [[2.5, 2.2, 0], [7.5, 2.2, 0]] };
annotateCandidateEngineeringViolations(vermilionCrossingCandidate, mediapipeVerts);
assert.ok(vermilionCrossingCandidate.hard_violations.some((item) =>
  item.code === "candidate_intersects_default_vermilion_protection"
    && item.location?.zone_id === "default-vermilion-protection"),
"the generic workflow blocks a candidate crossing vermilion until a dedicated flow or override exists");

const invalidBoundary = inspectTumorEngineeringExclusions({
  kind: "cutaneous",
  center: [3.7, 6.9, 0],
  diameter_mm: 8,
  boundary: [[3.1, 6.9, 0], [3.7, 6.3, 0], [4.3, 6.9, 0], [3.7, 7.4, 0]],
}, mediapipeVerts);
assert.equal(invalidBoundary.passed, false);
assert.ok(invalidBoundary.violations.some((item) =>
  item.code === "tumor_boundary_intersects_non_skin_opening" && item.location.zone_id === "left-eye-opening"));

const invalidDiameter = inspectTumorEngineeringExclusions({
  kind: "subcutaneous",
  center: [3.7, 6.9, 0],
  diameter_mm: 24,
  boundary: [],
}, mediapipeVerts);
assert.equal(invalidDiameter.passed, false);
assert.ok(invalidDiameter.violations.some((item) => item.code === "tumor_diameter_intersects_non_skin_opening"));
const projectionBufferCandidate = { type: "linear", polyline: [[2, 6.6, 0], [5, 6.6, 0]] };
annotateCandidateEngineeringViolations(projectionBufferCandidate, mediapipeVerts);
assert.ok(!projectionBufferCandidate.hard_violations.some((item) =>
  item.location?.zone_id === "left-eye-opening"),
"a path on visible eyelid skin remains reviewable when it does not cross the eye opening");

const requiredActions = [
  "summarize_tumor_input_quality",
  "classify_region",
  "query_rstl_direction",
  "inspect_sensitive_structures",
  "linear_subcutaneous_incision",
  "evaluate_guardrails",
  "preview_incision_on_face",
];
const clinicalWarningResult = {
  candidate: { polyline: [[2, 5, 0], [8, 5, 0]], hard_violations: [] },
  guardrails: { passed: false, hard_violations: [], warnings: [{ code: "sensitive_region_lower_eyelid", severity: "high" }] },
  trace: requiredActions.map((action) => ({ action })),
};
assert.equal(assessReviewReadiness({
  status: "approved_for_discussion",
  result: clinicalWarningResult,
  reviewer: "doctor",
  notes: "reviewed warning",
}).ok, true, "clinical warnings retain the documented review path");

const referenceCandidateResult = structuredClone(clinicalWarningResult);
referenceCandidateResult.candidate.metrics = { photo_reference_candidate: true };
const referenceReadiness = assessReviewReadiness({
  status: "approved_for_discussion",
  result: referenceCandidateResult,
  reviewer: "doctor",
  notes: "reviewed warning",
});
assert.equal(referenceReadiness.ok, false, "a nonstandard reference candidate cannot be approved as a standard candidate");
assert.match(referenceReadiness.message, /受限参考候选.*不能直接确认/);
const referenceGate = buildReviewGate({
  review: { status: "approved_for_discussion", reviewer: "doctor", notes: "reviewed warning" },
  result: referenceCandidateResult,
});
assert.equal(referenceGate.approval_ready, false);
assert.equal(referenceGate.live_overlay_ready, false);
assert.equal(referenceGate.live_overlay_blocked_reason, "nonstandard_reference_candidate");

const visibilityLimitedCandidateResult = structuredClone(clinicalWarningResult);
visibilityLimitedCandidateResult.candidate.metrics = { photo_visibility_limited_candidate: true };
const visibilityLimitedReadiness = assessReviewReadiness({
  status: "approved_for_discussion",
  result: visibilityLimitedCandidateResult,
  reviewer: "doctor",
  notes: "reviewed visible segment",
});
assert.equal(visibilityLimitedReadiness.ok, false,
  "a view-limited reference cannot be approved without the hidden region being reviewed");
assert.match(visibilityLimitedReadiness.message, /视野受限参考.*另一视角.*方可确认或进入实时叠加/);
const visibilityLimitedGate = buildReviewGate({
  review: { status: "approved_for_discussion", reviewer: "doctor", notes: "reviewed visible segment" },
  result: visibilityLimitedCandidateResult,
});
assert.equal(visibilityLimitedGate.approval_ready, false);
assert.equal(visibilityLimitedGate.live_overlay_ready, false);
assert.equal(visibilityLimitedGate.live_overlay_blocked_reason, "visibility_limited_reference_candidate");

const hardResult = {
  ...clinicalWarningResult,
  candidate: { polyline: [[-1, 5, 0], [5, 5, 0]], hard_violations: outsideCandidate.hard_violations },
  guardrails: { ...clinicalWarningResult.guardrails, hard_violations: outsideCandidate.hard_violations },
};
const staleGuardrailResult = {
  ...hardResult,
  guardrails: { ...hardResult.guardrails, hard_violations: [] },
};
assert.equal(assessReviewReadiness({
  status: "approved_for_discussion",
  result: staleGuardrailResult,
  reviewer: "doctor",
  notes: "must not bypass",
}).ok, false, "stale guardrail summaries cannot mask candidate hard violations");
assert.equal(assessReviewReadiness({
  status: "approved_for_discussion",
  result: hardResult,
  reviewer: "doctor",
  notes: "must not bypass",
}).ok, false, "notes cannot override engineering-invalid geometry");
const gate = buildReviewGate({
  review: { status: "approved_for_discussion", reviewer: "doctor", notes: "must not bypass" },
  result: hardResult,
});
assert.equal(gate.approval_ready, false);
assert.equal(gate.live_overlay_ready, false);
assert.equal(gate.reason, "engineering_hard_violation");

console.log("test_incision_path_guardrails: full-path geometry and hard-gate checks passed");
