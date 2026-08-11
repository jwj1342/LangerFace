import assert from "node:assert/strict";

import {
  inspectPathPolygonRelation,
  resamplePolyline2d,
} from "../web/src/services/incisionPathGeometry.ts";
import {
  annotateCandidateEngineeringViolations,
  annotateCandidateSensitiveDistances,
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

const outsideCandidate = { type: "linear", polyline: [[-1, 5, 0], [5, 5, 0]], metrics: {} };
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
