import assert from "node:assert/strict";
import fs from "node:fs";
import {
  workflowCandidateDisplayAllowed,
  workflowDiagnosticCandidateOutline,
  workflowDiagnosticCandidateVisible,
  workflowDiagnosticFusiformSvgPath,
  workflowDiagnosticOutlineValid,
  workflowFusiformSvgPath,
} from "../web/src/services/workflowControllerUtils.ts";
import { diagnosticCandidateBlockMessage } from "../web/src/services/incisionClinicalCopy.ts";
import { assessReviewReadiness, buildReviewGate } from "../web/src/services/incisionReviewPolicy.ts";
import type { IncisionPhotoGeometry } from "../web/src/services/incisionPhotoPlanning.ts";
import type { Vec3 } from "../web/src/services/softBody.ts";

// Frozen output of one real image05 run, not a detector rerun or synthetic replacement.
const frozen = JSON.parse(fs.readFileSync(new URL("./fixtures/workflow_rejected_fusiform_05.json", import.meta.url), "utf8"));
const original = JSON.stringify(frozen);
const geometry = frozen.geometry as IncisionPhotoGeometry;
const result = frozen.result;
const project = (p: Vec3) => ({ x: p[0], y: p[1] });
const outline = workflowDiagnosticCandidateOutline("fusiform", geometry);
assert.equal(outline.length, 65);
assert.equal(workflowDiagnosticOutlineValid(outline), true);
assert.equal(workflowDiagnosticCandidateVisible(result, true, outline), true);
const red = workflowDiagnosticFusiformSvgPath(outline, project);
assert.match(red, / Z$/);
assert.equal((red.match(/ L /g) || []).length, 63, "all 64 unique points are present, then closure");
const normal = workflowFusiformSvgPath(geometry.fusiformRendering, project);
assert.doesNotMatch(normal, /Z/, "normal visibility-limited path remains open");
assert.equal((normal.match(/ L /g) || []).length, 46, "normal path keeps only 47 visible points");
assert.equal(workflowCandidateDisplayAllowed(result, true), false);
const message = diagnosticCandidateBlockMessage(result);
assert.match(message, /超出可用面部表面/);
assert.match(message, /默认唇红保护区域/);
assert.doesNotMatch(message, /眼裂|口裂|鼻孔|未显示/);
assert.match(message, /不可确认、保存或用于实时叠加/);
const alternative = { ...result, candidate_alternatives: [{ hard_violations: [{ code: "candidate_intersects_non_skin_opening" }] }] };
assert.equal(diagnosticCandidateBlockMessage(alternative), message, "other alternatives do not mislabel this outline");

for (const code of ["candidate_outside_canonical_surface", "candidate_intersects_default_vermilion_protection", "candidate_intersects_non_skin_opening", "new_unknown_gate"]) {
  const blocked = { candidate_display_blocked: true, candidate: { type: "fusiform", hard_violations: [{ code }] } };
  assert.equal(workflowDiagnosticCandidateVisible(blocked, true, outline), true);
}
const allowed = { ...result, candidate_display_blocked: false };
assert.equal(workflowDiagnosticCandidateVisible(allowed, true, outline), false);
assert.equal(workflowDiagnosticCandidateVisible(allowed, false, outline), true);
assert.equal(workflowDiagnosticCandidateVisible(null, false, outline), false);
const rejected = { ...geometry, candidateProjection: { ...geometry.candidateProjection, valid: false }, diagnosticFusiformRendering: geometry.fusiformRendering };
assert.deepEqual(workflowDiagnosticCandidateOutline("fusiform", rejected), outline);
assert.deepEqual(workflowDiagnosticCandidateOutline("fusiform", { ...rejected, diagnosticFusiformRendering: null }), [], "never borrow an undersized source fallback");

const invalid: Vec3[][] = [[], [[0, 0, 0]], outline.slice(0, -1),
  [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 0]],
  [[0, 0, 0], [4, 4, 0], [0, 3, 0], [4, 0, 0], [0, 0, 0]],
  outline.map((p, i) => i === 5 ? [NaN, p[1], p[2]] : [...p]),
  outline.map((p, i) => i === 5 ? [p[0], p[1], Infinity] : [...p]),
];
for (const points of invalid) {
  assert.equal(workflowDiagnosticOutlineValid(points), false);
  assert.equal(workflowDiagnosticCandidateVisible(result, false, points), false);
  assert.equal(workflowDiagnosticFusiformSvgPath(points, project), "");
}
assert.equal(workflowDiagnosticFusiformSvgPath(outline, p => p === outline[5] ? null : project(p)), "", "no filtered partial contour");
assert.equal(workflowDiagnosticFusiformSvgPath(outline, () => ({ x: Infinity, y: 0 })), "");
const linear = { candidate_display_blocked: true, candidate: { type: "linear", hard_violations: [{ code: "candidate_outside_canonical_surface" }] } };
assert.equal(workflowDiagnosticCandidateVisible(linear, true, outline), false, "linear behavior is preserved");
assert.equal(workflowDiagnosticCandidateVisible(linear, true, outline, "oral-opening"), true);

const review = { status: "approved_for_discussion", reviewer: "offline-test", notes: "review does not override hard blocks" };
assert.equal(assessReviewReadiness({ ...review, result }).ok, false);
const gate = buildReviewGate({ result, review });
assert.equal(gate.approval_ready, false);
assert.equal(gate.live_overlay_ready, false);
assert.equal(gate.hard_violation_count, 2);
assert.equal(JSON.stringify(frozen), original, "display helpers never mutate frozen geometry or block flags");
console.log("test_workflow_rejected_fusiform: image05 full outline, block reasons, malformed geometry and approval/overlay guards passed");
