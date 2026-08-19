import assert from "node:assert/strict";

import { reviewForCandidateRecord } from "../web/src/services/incisionReviewPolicy.ts";
import {
  buildIncisionWorkspaceSession,
  loadIncisionWorkspaceSession,
  saveIncisionWorkspaceSession,
  tumorContextsMatch,
} from "../web/src/services/incisionWorkspaceSession.ts";
import {
  importedTumorFormState,
  shouldClearFreehandBoundaryOnLesionRepick,
  withControlledMarkerProvenance,
} from "../web/src/services/tumorInput.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) || null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const tumor = {
  kind: "cutaneous" as const,
  center: [0.25, 0.5, 0.75] as [number, number, number],
  diameter_mm: 18,
  depth_mm: null,
  margin_mm: 4,
  boundary: [
    [0.20, 0.48, 0.75],
    [0.25, 0.44, 0.75],
    [0.30, 0.48, 0.75],
  ] as [number, number, number][],
  boundary_mode: "freehand",
  boundary_source: "manual_freehand",
  source: "manual_web_agent",
  author: "coded-reviewer",
  units: "mm",
};
const saved = [{ id: "candidate-a", tumor, candidate: { id: "incision-a" } }];
const session = buildIncisionWorkspaceSession({
  tumor,
  result: saved[0],
  baseResult: saved[0],
  saved,
  review: { status: "pending_clinician_confirmation", reviewer: "coded-reviewer", notes: "" },
  generationCount: 3,
  updatedAt: "2026-08-05T12:00:00.000Z",
});
const storage = new MemoryStorage();
assert.equal(saveIncisionWorkspaceSession(session, storage), true);
const loaded = loadIncisionWorkspaceSession(storage);
assert.deepEqual(loaded, session, "route remount restores the complete logical workspace");
assert.equal(tumorContextsMatch(loaded!.result!.tumor, loaded!.tumor), true);
assert.equal(tumorContextsMatch(loaded!.tumor, { ...loaded!.tumor, center: [0.5, 0.5, 0.5] }), false);

const tumorControls = {
  diameterMin: 1,
  diameterMax: 80,
  depthMin: 1,
  depthMax: 50,
  depthFallback: 4,
  marginMin: 0,
  marginMax: 20,
  authorFallback: "fallback",
};
const restoredForm = importedTumorFormState(loaded!.saved[0].tumor, tumorControls);
assert.equal(restoredForm.kind, "cutaneous");
assert.equal(restoredForm.diameterValue, "18");
assert.equal(restoredForm.marginValue, "4");
assert.equal(restoredForm.boundaryMode, "freehand");
assert.deepEqual(restoredForm.boundaryPoints, tumor.boundary,
  "loading a saved candidate restores its center-independent freehand boundary");

const invalidImport = {
  tumor: {
    kind: "cutaneous",
    center: [0.25, 0.5],
    diameter_mm: -4,
  },
};
const invalidImportBefore = structuredClone(invalidImport);
assert.throws(
  () => importedTumorFormState(invalidImport, tumorControls),
  /center must be a 3D point/,
  "invalid tumor payloads fail before a form state can be applied",
);
assert.deepEqual(invalidImport, invalidImportBefore, "failed normalization does not mutate the imported payload");

const validResult = { trace: [
  { action: "summarize_tumor_input_quality" },
  { action: "classify_region" },
  { action: "query_rstl_direction" },
  { action: "inspect_sensitive_structures" },
  { action: "linear_subcutaneous_incision" },
  { action: "evaluate_guardrails" },
  { action: "preview_incision_on_face" },
], guardrails: { passed: true, warnings: [] }, candidate: { polyline: [[0, 0, 0], [1, 0, 0]] } };
const invalidApproval = reviewForCandidateRecord({
  review: { status: "approved_for_discussion", reviewer: "", reviewed_at: "2026-08-05T12:00:00.000Z" },
  result: validResult,
});
assert.equal(invalidApproval.readiness.ok, false);
assert.equal(invalidApproval.review.status, "pending_clinician_confirmation");
assert.equal(invalidApproval.review.reviewed_at, null);
assert.equal(invalidApproval.downgraded, true);

const validApproval = reviewForCandidateRecord({
  review: { status: "approved_for_discussion", reviewer: "coded-reviewer", notes: "" },
  result: validResult,
});
assert.equal(validApproval.readiness.ok, true);
assert.equal(validApproval.review.status, "approved_for_discussion");
const forcedDraft = reviewForCandidateRecord({
  review: validApproval.review,
  result: validResult,
  forceDraft: true,
});
assert.equal(forcedDraft.review.status, "pending_clinician_confirmation");

assert.equal(shouldClearFreehandBoundaryOnLesionRepick({
  kind: "cutaneous",
  boundaryMode: "freehand",
  boundaryPointCount: 7,
}), true);
assert.equal(shouldClearFreehandBoundaryOnLesionRepick({
  kind: "cutaneous",
  boundaryMode: "ellipse",
  boundaryPointCount: 7,
}), false);
const controlledMarkerTumor = withControlledMarkerProvenance(tumor, true);
assert.equal(controlledMarkerTumor.boundary_mode, "controlled_marker");
assert.equal(controlledMarkerTumor.boundary_source, "controlled_marker_confirmed");
assert.equal(controlledMarkerTumor.source, "detector_confirmed");
const importedSubcutaneous = importedTumorFormState({
  ...tumor,
  kind: "subcutaneous",
  depth_mm: 5,
}, {
  diameterMin: 1,
  diameterMax: 80,
  depthMin: 1,
  depthMax: 50,
  depthFallback: 4,
  marginMin: 0,
  marginMax: 20,
  authorFallback: "fallback",
});
assert.deepEqual(importedSubcutaneous.boundaryPoints, [], "subcutaneous imports discard incompatible skin-boundary state");

storage.setItem("langerface:incision-workspace-session:v1", "{invalid");
assert.equal(loadIncisionWorkspaceSession(storage), null, "corrupt session state fails closed");

console.log("test_incision_workspace_session: restore, review gate, and boundary reset policies passed");
