import assert from "node:assert/strict";

import {
  buildReviewExportPayload,
  buildTumorExportPayload,
} from "../web/src/services/incisionExport.ts";

const current = {
  id: "current",
  label: "当前候选",
  guardrail_summary: { high: 0, medium: 0 },
  candidate: { metrics: { angle_delta_to_rstl_deg: 2, target_length_deficit_mm: 0 } },
};
const saved = [{
  id: "saved",
  label: "已保存候选",
  guardrail_summary: { high: 1, medium: 0 },
  candidate: { metrics: { angle_delta_to_rstl_deg: 8, target_length_deficit_mm: 1 } },
}];
const review = buildReviewExportPayload({
  current,
  saved,
  secondaryCues: { present: false, used_for_geometry: false },
  exportedAt: "2026-07-29T00:00:00.000Z",
});

assert.equal(review.schema_version, "incision-review-export/v0.4");
assert.equal(review.exported_at, "2026-07-29T00:00:00.000Z");
assert.equal(review.current, current);
assert.equal(review.saved, saved);
assert.equal(review.secondary_cues.used_for_geometry, false);
assert.equal(review.candidate_comparison.length, 2);
assert.equal(review.candidate_comparison[0].id, "current");

const tumor = {
  kind: "subcutaneous" as const,
  center: [0.5, 0.5, 0] as [number, number, number],
  diameter_mm: 12,
  depth_mm: 4,
  margin_mm: 0,
  boundary: [],
  boundary_mode: "none",
  boundary_source: "none",
  source: "manual",
  author: "reviewer",
  units: "mm",
};
const tumorExport = buildTumorExportPayload({
  tumor,
  tumorQuality: { passed: true, warnings: [] },
  boundarySummary: { boundary_used: false },
  exportedAt: "2026-07-29T00:00:00.000Z",
});

assert.equal(tumorExport.schema_version, "tumor-input/v0.2");
assert.equal(tumorExport.tumor, tumor);
assert.equal(tumorExport.tumor_quality.passed, true);
assert.equal(tumorExport.boundary_summary.boundary_used, false);
assert.deepEqual(tumorExport.privacy_audit, {
  raw_image_sent: false,
  raw_video_sent: false,
  contains_face_image: false,
  contains_abstract_face_coordinates: true,
});

console.log("test_incision_export: payload schema and ranking assertions passed");
