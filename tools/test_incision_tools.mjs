// Dependency-free tests for web/incision_tools.js.
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

const linear = T.generateLinearIncision(
  { kind: "subcutaneous", center: [4, 2, 0], diameter_mm: 10, depth_mm: 5 },
  { vector: [1, 0, 0], confidence: 0.9 },
  0.1,
);
ok(linear.type === "linear", "linear candidate generated");
ok(near(linear.length_mm, 12.5), "linear length follows multiplier");
ok(near(linear.endpoints[0][0], 3.375) && near(linear.endpoints[1][0], 4.625), "linear endpoints centered on tumor");

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
const boundaryFusiform = T.generateFusiformIncision(boundaryTumor, { vector: [1, 0, 0], confidence: 0.9 }, 0.1, [0, 0, 1]);
ok(boundaryFusiform.metrics.boundary_used === true, "fusiform candidate records boundary use");
ok(boundaryFusiform.center[0] > 4, "fusiform candidate recenters to boundary centroid");
ok(boundaryFusiform.length_mm >= boundaryFusiform.metrics.boundary_axis_diameter_mm + 2,
  "fusiform length covers freehand boundary plus margin");

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

const anatomy = T.classifyRegion([3, 6, 0], verts);
const guard = T.evaluateGuardrails({ direction_confidence: 0.8 }, anatomy);
ok(anatomy.region === "lower_eyelid", "region classifier reaches sensitive lower eyelid bucket");
ok(guard.passed === false && guard.warnings.some((w) => w.severity === "high"), "guardrails flag sensitive region");
ok(T.classifyRegion([5, 3, 0], verts).region === "lip_vermilion", "region classifier reaches lip vermilion bucket");
ok(T.classifyRegion([4.2, 4.6, 0], verts).region === "nasal_ala", "region classifier reaches nasal ala bucket");
const nearMarginCandidate = {
  type: "linear",
  direction_confidence: 0.9,
  polyline: [[2.9, 5.9, 0], [4.5, 5.9, 0]],
  metrics: { rstl_deviation_deg: 0 },
};
T.annotateCandidateSensitiveDistances(nearMarginCandidate, verts);
ok(nearMarginCandidate.metrics.sensitive_free_margin_min_distance_mm < 5, "candidate path distance to sensitive margin is measured");
const candidateGuard = T.evaluateGuardrails(nearMarginCandidate, { region: "cheek", confidence: 0.8 });
ok(candidateGuard.passed === false, "candidate geometry near sensitive margin fails guardrails");
ok(candidateGuard.warnings.some((w) => w.code === "candidate_near_sensitive_free_margin"),
  "guardrails flag candidate geometry near sensitive margin");

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
ok(plan.trace.length === 4, "deterministic plan records four tool calls");
ok(plan.candidate.type === "linear", "deterministic plan returns candidate");
ok(plan.agent_trace_mode === "single_turn_react_with_deterministic_tools", "plan records trace mode");
ok(T.TOOL_SCHEMAS.some((s) => s.name === "clinician_edit_candidate"), "tool schemas include clinician edit");
ok(T.TOOL_SCHEMAS.some((s) => s.name === "save_review_record"), "tool schemas include review record export");

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
ok(edited.trace.some((step) => step.action === "clinician_edit_candidate"), "edited plan adds trace step");
ok(edited.guardrails.warnings.some((w) => w.code === "rstl_deviation_override"), "edited deviation triggers guardrail warning");

console.log(`test_incision_tools: ${passed} assertions passed`);
