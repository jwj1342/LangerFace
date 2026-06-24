// Dependency-free tests for canonical incision overlay projection.
import assert from "node:assert/strict";
import { __incisionOverlayForTests as T } from "../web/incision_overlay.js";

const verts = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 10, 0],
  [10, 10, 0],
];
const tris = [[0, 1, 2], [1, 3, 2]];
const landmarks = [
  [0, 0, 0],
  [100, 0, 0],
  [0, 100, 0],
  [100, 100, 0],
];

const record = {
  label: "测试候选",
  tumor: {
    kind: "subcutaneous",
    center: [4, 2, 0],
    diameter_mm: 10,
    boundary: [[3, 2, 0], [4, 3, 0], [5, 2, 0], [3, 2, 0]],
  },
  candidate: {
    type: "linear",
    polyline: [[2, 2, 0], [8, 2, 0]],
    length_mm: 12.5,
  },
  guardrails: { passed: true },
  review_status: "approved_for_discussion",
  review: { status: "approved_for_discussion", reviewer: "测试医生", notes: "" },
  guardrail_summary: { passed: true, high_codes: [], medium_codes: [] },
  review_gate: {
    reviewer_required: true,
    reviewer_present: true,
    notes_required_for_high_guardrails: false,
    notes_present: false,
    high_guardrail_codes: [],
    approval_ready: true,
    live_overlay_ready: true,
    reason: "approved_candidate_ready_for_research_overlay",
  },
};

const overlay = T.compileIncisionOverlay(record, verts, tris);
assert.ok(T.validateIncisionOverlay(overlay), "compiled overlay is valid");
assert.equal(overlay.audit.raw_image_sent, false, "overlay audit records no raw image export");
assert.equal(overlay.review.status, "approved_for_discussion", "overlay carries clinician review state");
assert.equal(overlay.review_gate.live_overlay_ready, true, "overlay carries live overlay gate");
assert.equal(overlay.guardrail_summary.passed, true, "overlay carries guardrail summary");
assert.equal(overlay.candidate.polyline_refs.length, 2, "candidate line is encoded as surface refs");
assert.equal(overlay.tumor.boundary_refs.length, 4, "tumor boundary is encoded as surface refs");

const mapped = T.mapSurfaceRefs(overlay.candidate.polyline_refs, landmarks, tris);
assert.equal(mapped.pts.length, 2, "surface refs map to runtime landmark pixels");
assert.ok(Math.abs(mapped.pts[0][0] - 20) < 1e-6, "first endpoint x maps through barycentric ref");
assert.ok(Math.abs(mapped.pts[0][1] - 20) < 1e-6, "first endpoint y maps through barycentric ref");
assert.ok(Math.abs(mapped.pts[1][0] - 80) < 1e-6, "second endpoint x maps through barycentric ref");
assert.ok(Math.abs(mapped.pts[1][1] - 20) < 1e-6, "second endpoint y maps through barycentric ref");

const near = T.pointToSurfaceRef([11, 5, 0], verts, tris);
assert.equal(near.tri, 1, "off-surface point snaps to nearest surface triangle");
assert.ok(near.distance > 0, "off-surface snap records distance");

assert.equal(T.validateIncisionOverlay({}), false, "bad overlay is rejected");
assert.equal(
  T.compileIncisionOverlay({ ...record, review_gate: { ...record.review_gate, live_overlay_ready: false } }, verts, tris),
  null,
  "not-ready candidates are not compiled for live overlay",
);
assert.equal(
  T.validateIncisionOverlay({ ...overlay, review_gate: { ...overlay.review_gate, live_overlay_ready: false } }),
  false,
  "not-ready overlay payloads are rejected",
);

console.log("test_incision_overlay: projection contract assertions passed");
