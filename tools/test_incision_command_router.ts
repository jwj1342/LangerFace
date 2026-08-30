import assert from "node:assert/strict";

import {
  IncisionCommandRouter,
  type IncisionCommandActions,
} from "../web/src/services/incisionCommandRouter.ts";
import { resetIncisionBoundaryState } from "../web/src/services/incisionBoundaryState.ts";

type Call = [string, ...unknown[]];
const calls: Call[] = [];
const record = (name: string, ...values: unknown[]) => {
  calls.push([name, ...values]);
};

const actions: IncisionCommandActions = {
  applyTumorControl: (command, value) => record("applyTumorControl", command, value),
  resetBoundaryForTumorKind: () => record("resetBoundaryForTumorKind"),
  setBoundaryInactive: () => record("setBoundaryInactive"),
  updateFormVisibility: (kind) => record("updateFormVisibility", ...(kind ? [kind] : [])),
  publish: (reason) => record("publish", reason),
  previewWorkflow: () => record("previewWorkflow"),
  updateTumorRing: () => record("updateTumorRing"),
  toggleBoundaryDrawing: () => record("toggleBoundaryDrawing"),
  clearBoundaryPoints: () => record("clearBoundaryPoints"),
  exportTumor: () => record("exportTumor"),
  importTumor: () => record("importTumor"),
  runWorkflow: () => record("runWorkflow"),
  importSecondaryCue: () => record("importSecondaryCue"),
  clearSecondaryCue: () => record("clearSecondaryCue"),
  confirmSecondaryCue: () => record("confirmSecondaryCue"),
  applyEditControl: (controlId, value) => record("applyEditControl", controlId, value),
  applyEditControls: () => record("applyEditControls"),
  commitEdit: (interaction) => record("commitEdit", interaction),
  undoEdit: () => record("undoEdit"),
  redoEdit: () => record("redoEdit"),
  resetEdit: () => record("resetEdit"),
  updateReviewState: () => record("updateReviewState"),
  saveReview: () => record("saveReview"),
  saveCurrentCandidate: () => record("saveCurrentCandidate"),
  makeVariants: () => record("makeVariants"),
  clearSaved: () => record("clearSaved"),
  loadCandidate: (id) => record("loadCandidate", id),
  toggleCandidateReviewStatus: (id) => record("toggleCandidateReviewStatus", id),
  removeCandidate: (id) => record("removeCandidate", id),
  exportJson: () => record("exportJson"),
  exportReport: () => record("exportReport"),
  exportPng: () => record("exportPng"),
  stageLiveOverlay: () => record("stageLiveOverlay"),
};

const router = new IncisionCommandRouter(actions);
const event = (detail: unknown) => ({ detail });
const expectDispatch = (
  handler: (event: { detail: unknown }) => boolean,
  detail: Record<string, unknown>,
  expected: Call[],
) => {
  calls.length = 0;
  assert.equal(handler(event(detail)), true, `expected ${String(detail.command)} to dispatch`);
  assert.deepEqual(calls, expected, `unexpected sequence for ${String(detail.command)}`);
};

const tumor = router.handleTumorEvent.bind(router);
expectDispatch(tumor, { command: "kind_changed", value: "cutaneous" }, [
  ["applyTumorControl", "kind_changed", "cutaneous"],
  ["resetBoundaryForTumorKind"],
  ["updateFormVisibility", "cutaneous"],
  ["publish", "tumor_kind_changed"],
  ["previewWorkflow"],
]);

const boundaryState = {
  boundaryPoints: [[1, 2, 3] as [number, number, number]],
  boundaryRefs: [{ tri: 1, u: 1, v: 0, w: 0 }],
  boundaryActive: true,
  controlledBoundaryActive: true,
};
resetIncisionBoundaryState(boundaryState);
assert.deepEqual(boundaryState.boundaryPoints, [], "tumor kind reset clears incompatible boundary points");
assert.deepEqual(boundaryState.boundaryRefs, [], "tumor kind reset clears incompatible surface refs");
assert.equal(boundaryState.boundaryActive, false, "tumor kind reset stops active boundary drawing");
assert.equal(boundaryState.controlledBoundaryActive, false,
  "tumor kind reset clears the accepted controlled-marker boundary mode");
expectDispatch(tumor, { command: "diameter_input", value: "12" }, [
  ["applyTumorControl", "diameter_input", "12"], ["updateTumorRing"], ["publish", "tumor_diameter_input"],
]);
expectDispatch(tumor, { command: "diameter_inactive_hint" }, [
  ["applyTumorControl", "diameter_inactive_hint", undefined], ["publish", "diameter_inactive_hint"],
]);
for (const command of ["depth_input", "author_changed"] as const) {
  expectDispatch(tumor, { command, value: command === "depth_input" ? "6" : "clinician" }, [
    ["applyTumorControl", command, command === "depth_input" ? "6" : "clinician"], ["publish", command],
  ]);
}
for (const command of ["margin_input", "ellipse_ratio_input"] as const) {
  expectDispatch(tumor, { command, value: "5" }, [
    ["applyTumorControl", command, "5"], ["updateTumorRing"], ["publish", command],
  ]);
}
for (const command of ["diameter_changed", "depth_changed", "margin_changed", "ellipse_ratio_changed"] as const) {
  expectDispatch(tumor, { command, value: "8" }, [
    ["applyTumorControl", command, "8"], ["previewWorkflow"],
  ]);
}
expectDispatch(tumor, { command: "boundary_mode_changed", value: "freehand" }, [
  ["applyTumorControl", "boundary_mode_changed", "freehand"],
  ["setBoundaryInactive"],
  ["updateFormVisibility"],
  ["publish", "tumor_boundary_mode_changed"],
  ["previewWorkflow"],
]);
for (const [command, action] of [
  ["toggle_boundary", "toggleBoundaryDrawing"],
  ["clear_boundary", "clearBoundaryPoints"],
  ["export_tumor", "exportTumor"],
  ["import_tumor", "importTumor"],
  ["run_workflow", "runWorkflow"],
] as const) {
  expectDispatch(tumor, { command }, [["applyTumorControl", command, undefined], [action]]);
}

const secondary = router.handleSecondaryCueEvent.bind(router);
for (const [command, action] of [
  ["import_secondary_cue", "importSecondaryCue"],
  ["clear_secondary_cue", "clearSecondaryCue"],
  ["secondary_cue_confirmed", "confirmSecondaryCue"],
] as const) {
  expectDispatch(secondary, { command }, [[action]]);
}

const edit = router.handleEditEvent.bind(router);
expectDispatch(edit, { command: "preview_edit", controlId: "angleOffsetDeg", value: "10" }, [
  ["applyEditControl", "angleOffsetDeg", "10"], ["applyEditControls"],
]);
expectDispatch(edit, { command: "commit_edit", controlId: "lengthScale", value: "110" }, [
  ["applyEditControl", "lengthScale", "110"], ["commitEdit", "control_change"],
]);
expectDispatch(edit, { command: "commit_reason", controlId: "editReason", value: "manual clinician preference" }, [
  ["applyEditControl", "editReason", "manual clinician preference"],
  ["applyEditControls"],
  ["commitEdit", "reason_change"],
]);
for (const [command, action] of [
  ["undo_edit", "undoEdit"],
  ["redo_edit", "redoEdit"],
  ["reset_edit", "resetEdit"],
] as const) {
  expectDispatch(edit, { command }, [[action]]);
}

const review = router.handleReviewEvent.bind(router);
expectDispatch(review, { command: "review_state_changed" }, [["updateReviewState"]]);
expectDispatch(review, { command: "save_review" }, [["saveReview"]]);

const library = router.handleLibraryEvent.bind(router);
for (const [command, action] of [
  ["save_current", "saveCurrentCandidate"],
  ["make_variants", "makeVariants"],
  ["clear_saved", "clearSaved"],
  ["export_json", "exportJson"],
  ["export_report", "exportReport"],
  ["export_png", "exportPng"],
  ["stage_live_overlay", "stageLiveOverlay"],
] as const) {
  expectDispatch(library, { command }, [[action]]);
}
expectDispatch(library, { command: "load_candidate", id: "candidate-1" }, [["loadCandidate", "candidate-1"]]);
expectDispatch(library, { command: "toggle_candidate_review_status", id: "candidate-1" }, [["toggleCandidateReviewStatus", "candidate-1"]]);
expectDispatch(library, { command: "remove_candidate", id: "candidate-2" }, [["removeCandidate", "candidate-2"]]);

for (const [handler, detail] of [
  [tumor, { command: "diameter_input", value: "NaN" }],
  [secondary, { command: "unknown" }],
  [edit, { command: "preview_edit", controlId: "__proto__", value: "10" }],
  [edit, { command: "commit_edit", controlId: "angleOffsetDeg", value: "NaN" }],
  [edit, { command: "commit_reason", controlId: "editReason", value: "unreviewed reason" }],
  [review, { command: "unknown" }],
  [library, { command: "load_candidate", id: "" }],
  [library, { command: "toggle_candidate_review_status", id: "" }],
] as const) {
  calls.length = 0;
  assert.equal(handler(event(detail)), false);
  assert.deepEqual(calls, [], "invalid payloads cannot enter incision action code");
}

console.log("ok: incision command router validates and dispatches all command groups");
