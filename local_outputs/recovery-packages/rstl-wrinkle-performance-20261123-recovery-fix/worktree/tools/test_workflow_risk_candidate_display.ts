import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  workflowCandidateDisplayAllowed,
  workflowDiagnosticCandidateVisible,
  workflowPhotoCandidatePresentation,
} from "../web/src/services/workflowControllerUtils.ts";
import type { Vec3 } from "../web/src/services/softBody.ts";

const outline: Vec3[] = [[0, 0, 0], [4, 2, 0], [0, 4, 0], [-4, 2, 0], [0, 0, 0]];
const risk = { candidate_display_blocked: false, guardrails: { passed: false }, candidate: { type: "fusiform" } };
assert.deepEqual(workflowPhotoCandidatePresentation(risk, true, outline),
  { normalVisible: true, diagnosticVisible: false }, "non-sensitive guardrail warnings keep a usable incision blue");
const sensitiveRisk = { ...risk, candidate: { type: "fusiform", hard_violations: [{ code: "candidate_intersects_non_skin_opening" }] } };
assert.deepEqual(workflowPhotoCandidatePresentation(sensitiveRisk, true, outline),
  { normalVisible: false, diagnosticVisible: true }, "sensitive-area incision uses red diagnostic styling");
assert.deepEqual(workflowPhotoCandidatePresentation({ ...risk, guardrails: { passed: true } }, true, outline),
  { normalVisible: true, diagnosticVisible: false }, "allowed incision keeps its normal presentation");
assert.deepEqual(workflowPhotoCandidatePresentation({ candidate: { type: "fusiform" } }, true, outline),
  { normalVisible: true, diagnosticVisible: false }, "absent risk result does not invent a new hard gate");
for (const points of [[], outline.slice(0, -1), [[0, 0, 0], [NaN, 1, 0], [0, 0, 0]] as Vec3[]]) {
  assert.deepEqual(workflowPhotoCandidatePresentation(risk, true, points),
    { normalVisible: true, diagnosticVisible: false }, "usable warning does not invent a red path or alter geometry");
}
const hard = { ...risk, candidate_display_blocked: true };
assert.deepEqual(workflowPhotoCandidatePresentation(hard, true, outline),
  { normalVisible: false, diagnosticVisible: true }, "existing complete hard-blocked fit remains diagnostic");
assert.equal(workflowDiagnosticCandidateVisible(risk, true, outline), false,
  "risk colour alone must not enter the hard diagnostic review/save path");
assert.equal(workflowCandidateDisplayAllowed(risk, true), true,
  "the existing nonvisual eligibility helper retains its original semantics");
assert.equal(workflowDiagnosticCandidateVisible(hard, true, outline), true,
  "hard diagnostic review/save blocking remains intact");
for (const passed of [true, false, undefined]) {
  for (const blocked of [true, false]) {
    for (const valid of [true, false]) {
      const result = { ...risk, candidate_display_blocked: blocked, guardrails: { passed } };
      const before = JSON.stringify([result, outline]);
      const shown = workflowPhotoCandidatePresentation(result, valid, outline);
      assert.equal(shown.normalVisible, valid && !blocked);
      assert.equal(shown.diagnosticVisible, blocked || !valid);
      assert.equal(shown.normalVisible && shown.diagnosticVisible, false, "ordinary and red paths are mutually exclusive");
      assert.equal(JSON.stringify([result, outline]), before, "display policy does not mutate results or geometry");
    }
  }
}
assert.deepEqual(workflowPhotoCandidatePresentation(risk, true,
  [[0, 0, 0], [4, 4, 0], [0, 4, 0], [4, 0, 0], [0, 0, 0]]),
{ normalVisible: true, diagnosticVisible: false }, "self-crossing warning does not change the display policy");
assert.deepEqual(workflowPhotoCandidatePresentation({ ...risk, candidate: { type: "linear" } }, true, outline.slice(0, 2)),
  { normalVisible: true, diagnosticVisible: false }, "a finite projected linear fit can carry a warning without turning red");
assert.deepEqual(workflowPhotoCandidatePresentation({ ...risk, candidate: { type: "linear" } }, false, outline.slice(0, 2)),
  { normalVisible: false, diagnosticVisible: false }, "risk colour does not bypass a failed linear projection");
assert.deepEqual(workflowPhotoCandidatePresentation({ ...hard, candidate: { type: "linear" } }, true, outline.slice(0, 2)),
  { normalVisible: false, diagnosticVisible: false }, "risk colour does not widen the original non-fusiform hard-block display policy");
assert.deepEqual(workflowPhotoCandidatePresentation({ ...hard, candidate: { type: "linear",
  hard_violations: [{ code: "candidate_intersects_non_skin_opening" }] } }, true, outline.slice(0, 2)),
  { normalVisible: false, diagnosticVisible: true }, "eligible non-skin-opening linear diagnostic remains visible");

const controller = readFileSync(new URL("../web/src/services/workflowIncisionController.ts", import.meta.url), "utf8");
assert.match(controller, /const candidatePresentation = workflowPhotoCandidatePresentation\(/);
assert.match(controller, /const displayedDiagnosticPathData = workflowCandidateDisplayAllowed\([\s\S]*?\) \? renderedCandidatePathData : diagnosticCandidatePathData;/,
  "risk-only styling reuses the original photo cubic/clipped path; hard diagnostics retain their geometry");
assert.match(controller, /candidate:\s*diagnosticCandidateVisible \? null : buildIncisionCandidateSnapshot\(state.result\)/,
  "snapshot eligibility still follows the original hard diagnostic flag, not risk colour");
assert.match(controller, /if \(!currentDiagnosticCandidateVisible\(state\)\) return false/,
  "review commands keep the original hard-block predicate");
console.log("photo risk styling, complete geometry, normal control and hard-review isolation passed");
