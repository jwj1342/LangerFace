import assert from "node:assert/strict";

import { neutralIncisionEdit } from "../web/src/services/incisionEditHistory.ts";
import { buildIncisionWorkspaceSession } from "../web/src/services/incisionWorkspaceSession.ts";
import {
  clearWorkflowDraftSession,
  loadWorkflowDraftSession,
  saveWorkflowDraftPhoto,
  saveWorkflowIncisionDraft,
  WORKFLOW_DRAFT_SESSION_KEY,
  WORKFLOW_DRAFT_TTL_MS,
} from "../web/src/services/workflowDraftSession.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) || null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const now = Date.parse("2026-08-28T16:00:00.000Z");
const storage = new MemoryStorage();
const photo = {
  dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
  fileName: "portrait.jpg",
  mimeType: "image/jpeg" as const,
  width: 960,
  height: 1280,
};

assert.equal(saveWorkflowDraftPhoto(photo, storage, now), true);
const photoOnly = loadWorkflowDraftSession(storage, now + 1);
assert.deepEqual(photoOnly?.photo, photo);
assert.equal(photoOnly?.incision, null, "a new photo clears an older incision draft");

const tumor = {
  kind: "cutaneous" as const,
  center: [0.25, 0.5, 0.75] as [number, number, number],
  diameter_mm: 18,
  depth_mm: null,
  margin_mm: 4,
  boundary: [] as [number, number, number][],
  boundary_mode: "ellipse",
  boundary_source: "manual_ellipse",
  source: "manual_web_agent",
  author: "clinician",
  units: "mm",
};
const workspace = buildIncisionWorkspaceSession({
  tumor,
  result: { tumor, candidate: { type: "fusiform" } },
  baseResult: { tumor, candidate: { type: "fusiform" } },
  saved: [],
  review: { status: "pending_clinician_confirmation", reviewer: "clinician", notes: "" },
  generationCount: 1,
});
const incision = {
  workspace,
  edit: neutralIncisionEdit(),
  boundaryMode: "ellipse" as const,
  ellipseRatio: 120,
  controlledBoundary: false,
  controlledBoundaryPhotoDiameterMm: null,
};
assert.equal(saveWorkflowIncisionDraft(incision, storage, now + 2_000), true);
assert.deepEqual(loadWorkflowDraftSession(storage, now + 2_001)?.incision, incision,
  "the workflow restores the logical incision draft without storing model objects");
assert.equal(loadWorkflowDraftSession(storage, now + 2_000 + WORKFLOW_DRAFT_TTL_MS - 1)?.photo.fileName, "portrait.jpg");
assert.equal(loadWorkflowDraftSession(storage, now + 2_000 + WORKFLOW_DRAFT_TTL_MS), null,
  "the face-photo draft expires after thirty minutes");
assert.equal(storage.getItem(WORKFLOW_DRAFT_SESSION_KEY), null, "expired drafts are deleted");

saveWorkflowDraftPhoto(photo, storage, now);
clearWorkflowDraftSession(storage);
assert.equal(loadWorkflowDraftSession(storage, now), null, "explicit clear removes the temporary draft");

console.log("test_workflow_draft_session: session-only photo and incision recovery contracts passed");
