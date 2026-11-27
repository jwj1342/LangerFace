import assert from "node:assert/strict";
import fs from "node:fs";

import { auditExportPayload } from "../web/src/services/exportPrivacy.ts";
import {
  confirmLesionDetectionDraft,
  normalizeLesionDetectionAdapter,
} from "../web/src/services/lesionDetectionAdapter.ts";

const mesh = {
  topologyId: "mediapipe-468",
  topologyVersion: "mediapipe-canonical-468-v1",
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as [number, number, number][],
  triangles: [[0, 1, 2]] as [number, number, number][],
};
const ref = (u: number, v: number) => ({ tri: 0, u, v, w: 1 - u - v });
const fixture = (source: "manual" | "import" | "detector" = "detector") => ({
  schema: "lesion-detection-adapter/v0.1",
  source,
  kind: "cutaneous",
  topology: { id: mesh.topologyId, version: mesh.topologyVersion },
  center_ref: ref(0.3, 0.3),
  boundary_refs: [ref(0.2, 0.2), ref(0.5, 0.2), ref(0.2, 0.5)],
  diameter_mm: 12,
  depth_mm: null,
  margin_mm: 2,
  confidence: source === "detector" ? 0.88 : 1,
  units: "mm",
  author: source === "detector" ? "must-not-be-trusted" : "coded-clinician",
  model: source === "detector" ? { name: "fixture-detector", version: "0.1" } : undefined,
  warnings: [],
});

for (const source of ["manual", "import"] as const) {
  const normalized = normalizeLesionDetectionAdapter(fixture(source), mesh);
  assert.equal(normalized.tumor?.source, source);
  assert.equal(normalized.tumor?.author, "coded-clinician");
  assert.equal(normalized.eligible_for_candidate, true);
  assert.equal(normalized.human_confirmation_required, false);
}

const detector = normalizeLesionDetectionAdapter(fixture(), mesh);
assert.equal(detector.tumor?.author, "", "detector metadata cannot impersonate a clinician author");
assert.equal(detector.draft_only, true);
assert.equal(detector.eligible_for_candidate, false);
assert.equal(detector.human_confirmation_required, true);
assert.deepEqual(detector.model, { name: "fixture-detector", version: "0.1" });
assert.ok(detector.geometry.center.every((value, index) =>
  Math.abs(value - [0.3, 0.4, 0][index]) < 1e-12));
assert.equal(auditExportPayload(detector).passed, true, "adapter export contains no raw media or direct PII");

const confirmed = confirmLesionDetectionDraft(detector, { diameter_mm: 14, margin_mm: 3 }, "coded-clinician");
assert.equal(confirmed.source, "detector_confirmed");
assert.equal(confirmed.tumor?.diameter_mm, 14);
assert.equal(confirmed.tumor?.author, "coded-clinician");
assert.equal(confirmed.eligible_for_candidate, true);
assert.equal(confirmed.human_confirmation_required, false);
assert.equal(confirmed.provenance.original_detection.diameter_mm, 12);
assert.equal(confirmed.provenance.clinician_override.diameter_mm, 14);

const lowConfidence = fixture();
lowConfidence.confidence = 0.2;
assert.equal(normalizeLesionDetectionAdapter(lowConfidence, mesh).eligible_for_candidate, false);

const invalidCases: Array<[string, (payload: any) => void, RegExp]> = [
  ["schema", (payload) => { payload.schema = "lesion-detection-adapter/v9"; }, /unsupported/],
  ["topology", (payload) => { payload.topology.id = "flame"; }, /topology/],
  ["triangle", (payload) => { payload.center_ref.tri = 4; }, /outside/],
  ["barycentric", (payload) => { payload.center_ref = { tri: 0, u: 2, v: 0, w: -1 }; }, /barycentric/],
  ["NaN", (payload) => { payload.diameter_mm = Number.NaN; }, /finite/],
  ["empty boundary", (payload) => { payload.boundary_refs = []; }, /at least three/],
  ["units", (payload) => { payload.units = "px"; }, /units/],
  ["confidence", (payload) => { payload.confidence = 1.2; }, /between/],
  ["raw media", (payload) => { payload.image_base64 = "data:image/png;base64,AAAA"; }, /forbidden/],
  ["nested media", (payload) => { payload.metadata = { note: "data:video/webm;base64,AAAA" }; }, /embedded media/],
  ["secret", (payload) => { payload.model.api_key = "secret"; }, /forbidden/],
  ["review bypass", (payload) => { payload.review_status = "approved_for_discussion"; }, /forbidden/],
];
for (const [name, mutate, expected] of invalidCases) {
  const payload = structuredClone(fixture());
  mutate(payload);
  assert.throws(() => normalizeLesionDetectionAdapter(payload, mesh), expected, name);
}
assert.throws(() => confirmLesionDetectionDraft(detector, {}, ""), /author/);

const source = fs.readFileSync("src/services/lesionDetectionAdapter.ts", "utf8");
assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|\bfetch\s*\(|axios|onnxruntime|mediapipe/i,
  "adapter contract must not depend on DOM, network, or detector SDKs");

console.log("test_lesion_detection_adapter: sources, refs, privacy, confirmation, and rejection cases passed");
