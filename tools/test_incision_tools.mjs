// Dependency-free tests for web/incision_tools.js.
import fs from "node:fs";

import { __incisionToolsForTests as T } from "../web/incision_tools.js";

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  passed++;
}
function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
function leftTipAngleDeg(candidate) {
  const outline = candidate.outline;
  const tip = outline[0];
  const upper = sub(outline[1], tip);
  const lower = sub(outline[outline.length - 1], tip);
  const cos = Math.max(-1, Math.min(1, dot(upper, lower) / (norm(upper) * norm(lower))));
  return Math.acos(cos) * 180 / Math.PI;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const clinicalRules = JSON.parse(
  fs.readFileSync(new URL("../assets/clinical_rules_face_incision.json", import.meta.url), "utf8"),
);
ok(T.DEFAULT_RULES.version === clinicalRules.version, "web clinical rules version matches asset");
for (const [section, fields] of Object.entries({
  linear_subcutaneous: ["length_multiplier", "min_length_mm", "max_length_mm"],
  fusiform_cutaneous: ["length_to_width_ratio", "tip_angle_deg", "min_length_mm", "max_length_mm", "samples"],
})) {
  for (const field of fields) {
    ok(T.DEFAULT_RULES[section][field] === clinicalRules[section][field],
      `web ${section}.${field} matches clinical rules asset`);
  }
}
for (const field of [
  "low_direction_confidence",
  "low_region_confidence",
  "free_margin_distance_warn_mm",
  "min_freehand_boundary_points",
  "min_boundary_area_diameter_disk_fraction",
  "boundary_center_shift_diameter_multiplier",
]) {
  ok(T.DEFAULT_RULES.guardrails[field] === clinicalRules.guardrails[field],
    `web guardrails.${field} matches clinical rules asset`);
}
ok(sameJson(
  T.DEFAULT_RULES.guardrails.free_margin_distance_thresholds_mm,
  clinicalRules.guardrails.free_margin_distance_thresholds_mm,
), "web free-margin thresholds match clinical rules asset");
ok(sameJson(
  T.DEFAULT_RULES.guardrails.protective_direction_hints,
  clinicalRules.guardrails.protective_direction_hints,
), "web protective direction hints match clinical rules asset");

const verts = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 10, 0],
  [10, 10, 0],
];
const tris = [[0, 1, 2], [1, 3, 2]];
const atlas = {
  system: "rstl",
  lines: [{
    name: "horizontal_rstl",
    region: "cheek",
    points: [
      [0, 0.7, 0.1],
      [0, 0.35, 0.45],
      [0, 0.0, 0.8],
    ],
  }],
};

const direction = T.queryDirection([4, 2, 0], verts, tris, atlas);
ok(direction.confidence > 0.5, "queryDirection returns useful confidence near atlas line");
ok(Math.abs(direction.vector[0]) > 0.95, "queryDirection follows horizontal atlas tangent");
ok(direction.source === "rstl_atlas_weighted_nearest", "queryDirection uses weighted nearest support");
ok(direction.support_count >= 1, "queryDirection records support count");
const repeatedAngles = Array.from({ length: 100 }, () => T.queryDirection([4, 2, 0], verts, tris, atlas).angle_deg);
ok(Math.max(...repeatedAngles) - Math.min(...repeatedAngles) < 1e-9, "queryDirection is stable across repeated static queries");
const farDirection = T.queryDirection([10, 10, 0], verts, tris, atlas);
ok(farDirection.confidence < 0.1, "queryDirection returns low confidence far from atlas support");
ok(farDirection.confidence_reasons.includes("nearest_atlas_support_far"),
  "queryDirection records far-atlas confidence reason");
const emptyDirection = T.queryDirection([4, 2, 0], verts, tris, { system: "rstl", lines: [] });
ok(emptyDirection.confidence === 0 && emptyDirection.confidence_reasons.includes("empty_atlas"),
  "queryDirection records empty-atlas confidence reason");

const wrapVerts = [
  [0.2, 0.0035, 0],
  [0, 0, 0],
  [-0.2, -0.0035, 0],
  [0.2, -0.0035, 0],
  [0, 0, 0],
  [-0.2, 0.0035, 0],
];
const wrapTris = [[0, 1, 2], [3, 4, 5]];
const wrapAtlas = {
  system: "rstl",
  lines: [
    { name: "wrap_negative", region: "cheek", points: [[0, 1, 0], [0, 0, 1], [0, 0, 0]] },
    { name: "wrap_positive", region: "cheek", points: [[1, 1, 0], [1, 0, 1], [1, 0, 0]] },
  ],
};
const wrapDirection = T.queryDirection([0, 0, 0], wrapVerts, wrapTris, wrapAtlas);
ok(wrapDirection.support_count >= 4, "queryDirection keeps wrapped-angle support samples");
ok(wrapDirection.angular_spread_deg < 3, "queryDirection treats 179/-179 as low axial spread");
ok(wrapDirection.confidence > 0.9, "queryDirection does not penalize confidence across axial angle wrap");

const linear = T.generateLinearIncision(
  { kind: "subcutaneous", center: [4, 2, 0], diameter_mm: 10, depth_mm: 5 },
  { vector: [1, 0, 0], confidence: 0.9 },
  0.1,
);
ok(linear.type === "linear", "linear candidate generated");
ok(near(linear.length_mm, 12.5), "linear length follows multiplier");
ok(near(linear.metrics.length_target_mm, 12.5), "linear records target length");
ok(near(linear.metrics.diameter_coverage_deficit_mm, 0), "linear records zero diameter coverage deficit");
ok(near(linear.endpoints[0][0], 3.375) && near(linear.endpoints[1][0], 4.625), "linear endpoints centered on tumor");
ok(linear.provenance.candidate_version === 1 && Array.isArray(linear.provenance.edit_history),
  "linear candidate starts with versioned provenance");
const lowDirectionLinear = T.generateLinearIncision(
  { kind: "subcutaneous", center: [10, 10, 0], diameter_mm: 10, depth_mm: 5 },
  farDirection,
  0.1,
);
ok(lowDirectionLinear.provenance.direction_confidence_reasons.includes("nearest_atlas_support_far"),
  "linear provenance keeps RSTL confidence reasons");
const lowDirectionGuard = T.evaluateGuardrails(lowDirectionLinear, { region: "cheek", confidence: 0.8 });
ok(lowDirectionGuard.warnings.some((w) => w.code === "low_rstl_confidence" && w.message.includes("nearest_atlas_support_far")),
  "low RSTL guardrail reports confidence reason");

const linearRules = structuredClone(T.DEFAULT_RULES);
linearRules.linear_subcutaneous.max_length_mm = 30;
const clampedLinear = T.generateLinearIncision(
  { kind: "subcutaneous", center: [4, 2, 0], diameter_mm: 40, depth_mm: 5 },
  { vector: [1, 0, 0], confidence: 0.9 },
  0.1,
  linearRules,
);
ok(near(clampedLinear.length_mm, 30), "linear candidate respects max length");
ok(near(clampedLinear.metrics.diameter_coverage_deficit_mm, 10), "linear records diameter coverage deficit");
const linearCoverageGuard = T.evaluateGuardrails(clampedLinear, { region: "cheek", confidence: 0.8 }, linearRules);
ok(linearCoverageGuard.passed === false, "linear diameter coverage deficit fails guardrails");
ok(linearCoverageGuard.warnings.some((w) => w.code === "linear_diameter_coverage_deficit"),
  "guardrails flag linear diameter coverage deficit");

const fusiform = T.generateFusiformIncision(
  {
    kind: "cutaneous",
    center: [4, 2, 0],
    diameter_mm: 8,
    margin_mm: 2,
    author: "clinician",
  },
  { vector: [1, 0, 0], confidence: 0.9 },
  0.1,
  [0, 0, 1],
);
ok(fusiform.type === "fusiform", "fusiform candidate generated");
ok(near(fusiform.width_mm, 12), "fusiform width includes margins");
ok(near(fusiform.length_mm, 36), "fusiform length uses 3:1 default");
ok(near(fusiform.tip_angle_deg, 30, 1e-9), "fusiform tip angle follows configured rule");
ok(fusiform.metrics.profile === "cubic_hermite_tip_angle_constrained", "fusiform records constrained profile");
ok(near(fusiform.metrics.tip_angle_error_deg, 0, 1e-9), "fusiform records near-zero tip angle error");
ok(fusiform.metrics.outline_area_mm2 > 0, "fusiform records outline area");
ok(fusiform.metrics.outline_self_intersection === false, "fusiform outline is simple");
ok(fusiform.metrics.outline_half_width_monotone === true, "fusiform outline tapers monotonically");
ok(fusiform.metrics.outline_symmetry_max_error_mm < 1e-9, "fusiform outline records symmetry error");
ok(fusiform.metrics.boundary_envelope_min_margin_mm === null, "fusiform without boundary records no envelope margin");
ok(fusiform.metrics.boundary_envelope_outside_count === 0, "fusiform without boundary records zero outside boundary points");
ok(leftTipAngleDeg(fusiform) > 29 && leftTipAngleDeg(fusiform) < 32, "fusiform outline segment angle matches tip rule");
ok(fusiform.outline.length > 20, "fusiform outline is renderable");

const boundaryTumor = {
  kind: "cutaneous",
  center: [4, 2, 0],
  diameter_mm: 8,
  margin_mm: 1,
  boundary: [[3, 2, 0], [4, 3, 0], [7, 2, 0], [4, 1, 0]],
  boundary_mode: "freehand",
  boundary_source: "manual_freehand",
  author: "clinician",
};
const boundarySummary = T.summarizeTumorBoundary(boundaryTumor, [1, 0, 0], [0, 0, 1], 0.1);
ok(boundarySummary.boundary_used === true, "freehand boundary summary is used");
ok(boundarySummary.axis_diameter_mm > 35, "freehand boundary records long-axis coverage");
const boundaryQuality = T.summarizeTumorInputQuality(boundaryTumor);
ok(boundaryQuality.passed === true, "sparse cutaneous boundary input remains reviewable");
ok(boundaryQuality.warnings.some((w) => w.code === "sparse_cutaneous_boundary_input"),
  "tumor input quality flags sparse freehand boundary");
const boundaryFusiform = T.generateFusiformIncision(boundaryTumor, { vector: [1, 0, 0], confidence: 0.9 }, 0.1, [0, 0, 1]);
ok(boundaryFusiform.metrics.boundary_used === true, "fusiform candidate records boundary use");
ok(boundaryFusiform.center[0] > 4, "fusiform candidate recenters to boundary centroid");
ok(boundaryFusiform.length_mm >= boundaryFusiform.metrics.boundary_axis_diameter_mm + 2,
  "fusiform length covers freehand boundary plus margin");
ok(boundaryFusiform.metrics.boundary_envelope_min_margin_mm >= 0,
  "fusiform records non-negative boundary envelope margin for contained freehand boundary");
ok(boundaryFusiform.metrics.boundary_envelope_outside_count === 0,
  "fusiform records zero outside points for contained freehand boundary");
const editedBoundaryFusiform = T.applyCandidateEdit({
  tumor: boundaryTumor,
  candidate: boundaryFusiform,
  anatomy: { region: "cheek", confidence: 0.8 },
  guardrails: T.evaluateGuardrails(boundaryFusiform, { region: "cheek", confidence: 0.8 }),
  trace: [],
}, {
  width_scale: 0.2,
  reason: "manual narrow closure test",
}, [0, 0, 1], 0.1);
ok(editedBoundaryFusiform.candidate.metrics.outline_area_mm2 > 0,
  "edited fusiform recomputes outline area");
ok(editedBoundaryFusiform.candidate.metrics.outline_half_width_monotone === true,
  "edited fusiform recomputes smooth taper metric");
ok(editedBoundaryFusiform.candidate.metrics.boundary_envelope_min_margin_mm < 0,
  "edited fusiform recomputes negative boundary envelope margin");
ok(editedBoundaryFusiform.candidate.metrics.boundary_envelope_outside_count > 0,
  "edited fusiform counts boundary points outside edited envelope");
ok(editedBoundaryFusiform.guardrails.warnings.some((w) => w.code === "fusiform_boundary_outside_envelope"),
  "edited fusiform boundary envelope warning is re-evaluated");

const envelopeRules = structuredClone(T.DEFAULT_RULES);
envelopeRules.fusiform_cutaneous.max_length_mm = 200;
const rectangularBoundaryTumor = {
  ...boundaryTumor,
  center: [5, 2, 0],
  boundary: [[0, 4, 0], [10, 4, 0], [10, 0, 0], [0, 0, 0]],
};
const envelopeFusiform = T.generateFusiformIncision(
  rectangularBoundaryTumor,
  { vector: [1, 0, 0], confidence: 0.9 },
  0.1,
  [0, 0, 1],
  envelopeRules,
);
ok(envelopeFusiform.metrics.boundary_envelope_min_margin_mm < 0,
  "fusiform records negative boundary envelope margin when contour falls outside tapered outline");
ok(envelopeFusiform.metrics.boundary_envelope_outside_count === 4,
  "fusiform counts boundary points outside tapered outline");
const envelopeGuard = T.evaluateGuardrails(envelopeFusiform, { region: "cheek", confidence: 0.8 }, envelopeRules);
ok(envelopeGuard.passed === false, "boundary outside fusiform envelope fails guardrails");
ok(envelopeGuard.warnings.some((w) => w.code === "fusiform_boundary_outside_envelope"),
  "guardrails flag boundary outside fusiform envelope");

const coverageRules = structuredClone(T.DEFAULT_RULES);
coverageRules.fusiform_cutaneous.max_length_mm = 40;
const oversizedBoundaryTumor = {
  ...boundaryTumor,
  margin_mm: 2,
  boundary: [[0, 2, 0], [4, 3, 0], [10, 2, 0], [4, 1, 0]],
};
const clampedFusiform = T.generateFusiformIncision(
  oversizedBoundaryTumor,
  { vector: [1, 0, 0], confidence: 0.9 },
  0.1,
  [0, 0, 1],
  coverageRules,
);
ok(clampedFusiform.metrics.axis_coverage_deficit_mm > 0, "fusiform records boundary axis coverage deficit");
ok(clampedFusiform.metrics.length_clamped_by_max === true, "fusiform records max-length clamp");
const coverageGuard = T.evaluateGuardrails(clampedFusiform, { region: "cheek", confidence: 0.8 }, coverageRules);
ok(coverageGuard.passed === false, "boundary coverage deficit fails guardrails");
ok(coverageGuard.warnings.some((w) => w.code === "fusiform_axis_coverage_deficit"),
  "guardrails flag fusiform axis coverage deficit");

const sparseBoundaryTumor = {
  ...boundaryTumor,
  boundary: [[3, 2, 0], [4, 3, 0], [5, 2, 0]],
};
const sparseFusiform = T.generateFusiformIncision(sparseBoundaryTumor, { vector: [1, 0, 0], confidence: 0.9 }, 0.1, [0, 0, 1]);
const sparseGuard = T.evaluateGuardrails(sparseFusiform, { region: "cheek", confidence: 0.8 });
ok(sparseGuard.passed === true, "sparse cutaneous boundary is a review warning, not an automatic failure");
ok(sparseGuard.warnings.some((w) => w.code === "cutaneous_boundary_too_few_points" && w.severity === "medium"),
  "guardrails warn about sparse cutaneous boundary");

const shiftedBoundaryTumor = {
  ...boundaryTumor,
  center: [0, 2, 0],
};
const shiftedFusiform = T.generateFusiformIncision(shiftedBoundaryTumor, { vector: [1, 0, 0], confidence: 0.9 }, 0.1, [0, 0, 1]);
const shiftedGuard = T.evaluateGuardrails(shiftedFusiform, { region: "cheek", confidence: 0.8 });
ok(shiftedGuard.passed === false, "far-shifted cutaneous boundary fails guardrails");
ok(shiftedGuard.warnings.some((w) => w.code === "cutaneous_boundary_center_shift"),
  "guardrails flag cutaneous boundary center shift");

const degenerateBoundaryTumor = {
  ...boundaryTumor,
  boundary: [[3, 2, 0], [4, 2.01, 0], [5, 2, 0], [4, 1.99, 0]],
};
const degenerateFusiform = T.generateFusiformIncision(degenerateBoundaryTumor, { vector: [1, 0, 0], confidence: 0.9 }, 0.1, [0, 0, 1]);
ok(degenerateFusiform.metrics.boundary_area_ratio_to_diameter_disk < 0.08,
  "fusiform records degenerate boundary area ratio");
const degenerateGuard = T.evaluateGuardrails(degenerateFusiform, { region: "cheek", confidence: 0.8 });
ok(degenerateGuard.passed === false, "degenerate cutaneous boundary area fails guardrails");
ok(degenerateGuard.warnings.some((w) => w.code === "cutaneous_boundary_degenerate_area"),
  "guardrails flag degenerate cutaneous boundary area");

const selfIntersectingBoundaryTumor = {
  ...boundaryTumor,
  boundary: [[3, 1, 0], [5, 3, 0], [3, 3, 0], [5, 1, 0]],
};
const selfIntersectingFusiform = T.generateFusiformIncision(selfIntersectingBoundaryTumor, { vector: [1, 0, 0], confidence: 0.9 }, 0.1, [0, 0, 1]);
ok(selfIntersectingFusiform.metrics.boundary_self_intersection === true,
  "fusiform records self-intersecting boundary");
const selfIntersectingGuard = T.evaluateGuardrails(selfIntersectingFusiform, { region: "cheek", confidence: 0.8 });
ok(selfIntersectingGuard.passed === false, "self-intersecting cutaneous boundary fails guardrails");
ok(selfIntersectingGuard.warnings.some((w) => w.code === "cutaneous_boundary_self_intersection"),
  "guardrails flag self-intersecting cutaneous boundary");

const anatomy = T.classifyRegion([3, 6, 0], verts);
const guard = T.evaluateGuardrails({ direction_confidence: 0.8 }, anatomy);
ok(anatomy.region === "lower_eyelid", "region classifier reaches sensitive lower eyelid bucket");
ok(guard.passed === false && guard.warnings.some((w) => w.severity === "high"), "guardrails flag sensitive region");
ok(guard.suggested_overrides.some((o) =>
  o.kind === "protective_direction" &&
  o.structure === "lower_eyelid" &&
  o.requires_clinician_override_reason === true),
  "guardrails suggest protective lower-eyelid direction");
const segmentAnatomy = T.classifyRegion([4, 5.9, 0], verts);
ok(segmentAnatomy.free_margin_distance_mm < 1, "free-margin distance uses eyelid margin segments");
ok(segmentAnatomy.nearby_landmarks.includes("left_lower_eyelid_margin"),
  "free-margin landmarks include eyelid margin segment");
ok(segmentAnatomy.confidence_reasons.includes("near_sensitive_free_margin"),
  "region classifier records sensitive-margin confidence reason");
const earAnatomy = T.classifyRegion([0.8, 5.5, 0], verts);
ok(earAnatomy.region === "ear_region", "region classifier reaches ear bucket");
ok(earAnatomy.confidence_reasons.includes("heuristic_region_low_confidence"),
  "region classifier records low-confidence heuristic reason");
ok(earAnatomy.confidence_reasons.includes("lateral_face_edge_bucket"),
  "region classifier records lateral edge reason");
ok(Number.isFinite(earAnatomy.region_boundary_margin_norm),
  "region classifier records normalized boundary margin");
const earGuard = T.evaluateGuardrails({ type: "linear", direction_confidence: 0.9 }, earAnatomy);
ok(earGuard.warnings.some((w) => w.code === "low_region_confidence" && w.message.includes("lateral_face_edge_bucket")),
  "low-region guardrail reports region confidence reason");
ok(T.classifyRegion([5, 3, 0], verts).region === "lip_vermilion", "region classifier reaches lip vermilion bucket");
ok(T.classifyRegion([4.2, 4.6, 0], verts).region === "nasal_ala", "region classifier reaches nasal ala bucket");
const lipGuard = T.evaluateGuardrails({ direction_confidence: 0.9 }, T.classifyRegion([5, 3, 0], verts));
ok(lipGuard.suggested_overrides.some((o) =>
  o.kind === "protective_direction" &&
  o.structure === "lip_vermilion" &&
  o.direction_hint.includes("vermilion")),
  "guardrails suggest protective lip-vermilion direction");
const alarGuard = T.evaluateGuardrails({ direction_confidence: 0.9 }, T.classifyRegion([4.2, 4.6, 0], verts));
ok(alarGuard.suggested_overrides.some((o) =>
  o.kind === "protective_direction" &&
  o.structure === "nasal_ala" &&
  o.direction_hint.includes("alar")),
  "guardrails suggest protective nasal-ala direction");
const nearMarginCandidate = {
  type: "linear",
  direction_confidence: 0.9,
  polyline: [[2.9, 5.9, 0], [4.5, 5.9, 0]],
  metrics: { rstl_deviation_deg: 0 },
};
T.annotateCandidateSensitiveDistances(nearMarginCandidate, verts);
ok(nearMarginCandidate.metrics.sensitive_free_margin_min_distance_mm < 5, "candidate path distance to sensitive margin is measured");
ok(nearMarginCandidate.metrics.sensitive_free_margin_nearest === "left_lower_eyelid_margin",
  "candidate path distance can use sensitive margin segments");
const candidateGuard = T.evaluateGuardrails(nearMarginCandidate, { region: "cheek", confidence: 0.8 });
ok(candidateGuard.passed === false, "candidate geometry near sensitive margin fails guardrails");
ok(candidateGuard.warnings.some((w) => w.code === "candidate_near_sensitive_free_margin"),
  "guardrails flag candidate geometry near sensitive margin");
ok(candidateGuard.suggested_overrides.some((o) =>
  o.kind === "protective_direction" &&
  o.source_warning === "candidate_near_sensitive_free_margin" &&
  o.structure === "lower_eyelid"),
  "candidate-margin guardrail suggests protective direction");
const nasalCenterGuard = T.evaluateGuardrails(
  { type: "linear", direction_confidence: 0.9, metrics: { rstl_deviation_deg: 0 } },
  { region: "cheek", confidence: 0.8, free_margin_distance_mm: 11, nearby_landmarks: ["nasal_tip"] },
);
ok(!nasalCenterGuard.warnings.some((w) => w.code === "near_sensitive_free_margin"),
  "nasal-tip center threshold does not flag 11 mm");
const eyelidCenterGuard = T.evaluateGuardrails(
  { type: "linear", direction_confidence: 0.9, metrics: { rstl_deviation_deg: 0 } },
  { region: "cheek", confidence: 0.8, free_margin_distance_mm: 11, nearby_landmarks: ["left_lower_eyelid_margin"] },
);
ok(eyelidCenterGuard.warnings.some((w) => w.code === "near_sensitive_free_margin" && w.message.includes("threshold 16.0 mm")),
  "lower-eyelid center threshold flags 11 mm and reports threshold");
ok(eyelidCenterGuard.suggested_overrides.some((o) =>
  o.kind === "protective_direction" &&
  o.source_warning === "near_sensitive_free_margin" &&
  o.structure === "lower_eyelid"),
  "center-margin guardrail suggests protective lower-eyelid direction");
const nasalCandidateGuard = T.evaluateGuardrails(
  {
    type: "linear",
    direction_confidence: 0.9,
    metrics: {
      rstl_deviation_deg: 0,
      sensitive_free_margin_min_distance_mm: 11,
      sensitive_free_margin_nearest: "nasal_tip",
    },
  },
  { region: "cheek", confidence: 0.8 },
);
ok(!nasalCandidateGuard.warnings.some((w) => w.code === "candidate_near_sensitive_free_margin"),
  "nasal-tip candidate threshold does not flag 11 mm");
const eyelidCandidateGuard = T.evaluateGuardrails(
  {
    type: "linear",
    direction_confidence: 0.9,
    metrics: {
      rstl_deviation_deg: 0,
      sensitive_free_margin_min_distance_mm: 11,
      sensitive_free_margin_nearest: "left_lower_eyelid_margin",
    },
  },
  { region: "cheek", confidence: 0.8 },
);
ok(eyelidCandidateGuard.warnings.some((w) => w.code === "candidate_near_sensitive_free_margin" && w.message.includes("threshold 16.0 mm")),
  "lower-eyelid candidate threshold flags 11 mm and reports threshold");
ok(eyelidCandidateGuard.suggested_overrides.some((o) =>
  o.kind === "protective_direction" &&
  o.source_warning === "candidate_near_sensitive_free_margin" &&
  o.structure === "lower_eyelid"),
  "candidate-threshold guardrail suggests protective lower-eyelid direction");

const regionCases = {
  forehead: [5, 8.6, 0],
  ear_region: [0.8, 5.5, 0],
  temple_cheek: [1.8, 6.8, 0],
  upper_eyelid: [3, 7.2, 0],
  lower_eyelid: [3, 6, 0],
  inner_canthus: [5, 6, 0],
  nasal_dorsum: [5, 5.2, 0],
  nasal_ala: [4.2, 4.6, 0],
  nasal_tip: [5, 4.2, 0],
  nasolabial_fold: [3, 4.1, 0],
  cheek: [7, 5, 0],
  lip_vermilion: [5, 3, 0],
  upper_lip: [5, 3.7, 0],
  oral_commissure: [3.4, 3.1, 0],
  chin: [5, 1.6, 0],
  jawline: [2, 2.4, 0],
};
for (const [region, point] of Object.entries(regionCases)) {
  ok(T.classifyRegion(point, verts).region === region, `region classifier covers ${region}`);
}

const plan = T.planIncisionDeterministic({
  tumor: { kind: "subcutaneous", center: [4, 2, 0], diameter_mm: 10, depth_mm: 5 },
  verts,
  tris,
  atlas,
});
ok(plan.trace.length === 7, "deterministic plan records seven tool calls");
ok(plan.trace[0].action === "summarize_tumor_input_quality", "deterministic plan checks tumor input first");
ok(plan.trace[3].action === "inspect_sensitive_structures", "deterministic plan inspects sensitive structures before geometry");
ok(plan.trace.at(-1).action === "preview_incision_on_face", "deterministic plan previews the candidate before review");
ok(plan.preview.renderable === true, "deterministic preview confirms renderable geometry");
ok(plan.preview.raw_image_sent === false, "deterministic preview does not send raw images");
ok(plan.candidate.type === "linear", "deterministic plan returns candidate");
ok(plan.tumor_quality.warning_count === 1, "deterministic plan returns tumor quality summary");
ok(plan.tumor_quality.warnings[0].code === "missing_tumor_author", "tumor quality flags missing author");
ok(plan.sensitive_structure_inspection.schema_version === "sensitive-structure-inspection/v0.1",
  "deterministic plan returns sensitive structure inspection summary");
ok(plan.agent_trace_mode === "single_turn_react_with_deterministic_tools", "plan records trace mode");
ok(T.TOOL_SCHEMAS.some((s) => s.name === "summarize_tumor_input_quality"),
  "tool schemas include tumor input quality");
ok(T.TOOL_SCHEMAS.some((s) => s.name === "inspect_sensitive_structures"),
  "tool schemas include sensitive structure inspection");
ok(T.TOOL_SCHEMAS.some((s) => s.name === "preview_incision_on_face"), "tool schemas include face preview");
ok(T.TOOL_SCHEMAS.some((s) => s.name === "clinician_edit_candidate"), "tool schemas include clinician edit");
ok(T.TOOL_SCHEMAS.some((s) => s.name === "compare_candidates"), "tool schemas include candidate comparison");
ok(T.TOOL_SCHEMAS.some((s) => s.name === "save_review_record"), "tool schemas include review record export");

const incompleteQuality = T.summarizeTumorInputQuality({
  kind: "subcutaneous",
  center: [4, 2, 0],
  diameter_mm: 8,
  depth_mm: null,
  units: "cm",
});
const incompleteCodes = new Set(incompleteQuality.warnings.map((w) => w.code));
ok(incompleteQuality.passed === false, "non-mm tumor input fails quality gate");
ok(incompleteCodes.has("missing_tumor_author"), "tumor input quality flags missing author");
ok(incompleteCodes.has("non_mm_tumor_units"), "tumor input quality flags non-mm units");
ok(incompleteCodes.has("missing_subcutaneous_depth"), "tumor input quality flags missing depth");

const edited = T.applyCandidateEdit(plan, {
  angle_offset_deg: 20,
  length_scale: 1.2,
  shift_along_mm: 1,
  shift_perp_mm: -0.5,
  reason: "manual free-margin protection",
}, [0, 0, 1], 0.1);
ok(edited.candidate.edited === true, "edited candidate is marked");
ok(near(edited.candidate.length_mm, 15), "edited linear length is recalculated");
ok(near(edited.candidate.metrics.rstl_deviation_deg, 20), "edited candidate records RSTL deviation");
ok(edited.candidate.provenance.clinician_edit.reason.includes("free-margin"), "edited candidate records override reason");
ok(edited.candidate.provenance.candidate_version === 2, "edited candidate increments candidate version");
ok(edited.candidate.provenance.parent_candidate_id === plan.candidate.id,
  "edited candidate records parent candidate id");
ok(edited.candidate.provenance.edit_history.length === 1,
  "edited candidate records edit history entry");
ok(edited.candidate.provenance.edit_history[0].edit_id.startsWith("edit_v2_"),
  "edited candidate records stable edit id");
ok(edited.trace.some((step) => step.action === "clinician_edit_candidate"), "edited plan adds trace step");
ok(edited.guardrails.warnings.some((w) => w.code === "rstl_deviation_override"), "edited deviation triggers guardrail warning");

const multiStepEdited = T.applyCandidateEdit(plan, {
  angle_offset_deg: 10,
  length_scale: 1.1,
  shift_along_mm: 2,
  reason: "manual clinician preference",
  session_history: [
    {
      angle_offset_deg: -5,
      length_scale: 1,
      width_scale: 1,
      shift_along_mm: 0,
      shift_perp_mm: 0,
      reason: "manual scar camouflage",
      interaction: "control_change",
    },
    {
      angle_offset_deg: 10,
      length_scale: 1.1,
      width_scale: 1,
      shift_along_mm: 2,
      shift_perp_mm: 0,
      reason: "manual clinician preference",
      interaction: "endpoint_drag",
    },
  ],
}, [0, 0, 1], 0.1);
ok(multiStepEdited.candidate.provenance.candidate_version === 3,
  "multi-step edit history increments candidate version per committed edit");
ok(multiStepEdited.candidate.provenance.edit_history.length === 2,
  "multi-step edit history is preserved in provenance");
ok(multiStepEdited.candidate.provenance.clinician_edit.interaction === "endpoint_drag",
  "latest edit records the interaction source");
ok(multiStepEdited.candidate.provenance.edit_history[0].edit_id.startsWith("edit_v2_") &&
  multiStepEdited.candidate.provenance.edit_history[1].edit_id.startsWith("edit_v3_"),
  "multi-step edit ids track resulting candidate versions");

const comparison = T.compareCandidateRecords([
  {
    id: "baseline",
    label: "低风险候选",
    review_status: "approved_for_discussion",
    candidate: { type: "linear", metrics: { rstl_deviation_deg: 0, diameter_coverage_deficit_mm: 0 } },
    guardrails: { passed: true, warnings: [] },
  },
  {
    id: "high-risk",
    label: "高风险候选",
    review_status: "approved_for_discussion",
    candidate: {
      type: "linear",
      metrics: {
        rstl_deviation_deg: 20,
        diameter_coverage_deficit_mm: 3,
        sensitive_free_margin_min_distance_mm: 4,
        sensitive_free_margin_nearest: "left_lower_eyelid_margin",
      },
    },
    guardrails: { passed: false, warnings: [{ code: "candidate_near_sensitive_free_margin", severity: "high" }] },
  },
  {
    id: "rejected",
    label: "否决候选",
    review_status: "rejected_by_clinician",
    candidate: { type: "fusiform", metrics: { rstl_deviation_deg: 0, tip_angle_error_deg: 0 } },
    guardrails: { passed: true, warnings: [] },
  },
]);
ok(comparison[0].id === "baseline", "candidate comparison ranks low-risk candidate first");
ok(comparison[2].id === "rejected", "candidate comparison ranks rejected candidate last");
ok(comparison[1].reasons.some((r) => r.includes("high guardrail")), "candidate comparison explains high-risk score");
ok(comparison[1].score_breakdown.sensitive_free_margin_threshold_mm === 16,
  "candidate comparison records per-structure sensitive-margin threshold");
ok(comparison[0].clinical_boundary.includes("不是临床推荐"), "candidate comparison records clinical boundary");

console.log(`test_incision_tools: ${passed} assertions passed`);
