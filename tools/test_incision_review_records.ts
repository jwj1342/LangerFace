import assert from "node:assert/strict";

import {
  buildCandidateEditSession,
  buildIncisionReviewRecord,
  buildIncisionReviewReport,
  findSensitiveStructureInspection,
  formatRecoveredFailureSummary,
} from "../web/src/services/incisionReviewRecords.ts";
import { auditExportPayload } from "../web/src/services/exportPrivacy.ts";

const result = {
  tumor: { kind: "subcutaneous", diameter_mm: 12, margin_mm: 0, author: "clinician" },
  tumor_quality: { warnings: [], warning_count: 0, passed: true },
  anatomy: { region: "cheek", subunit: "malar", confidence_reasons: [] },
  direction: {
    source: "atlas_local_weighted_orientation",
    confidence: 0.9,
    confidence_reasons: [],
    support_count: 4,
    angular_spread_deg: 5,
  },
  candidate: {
    type: "linear",
    length_mm: 18,
    metrics: {},
    provenance: {
      candidate_version: 2,
      clinician_edit: { edit_id: "edit-1" },
      edit_history: [{
        edit_id: "edit-1",
        resulting_candidate_version: 2,
        angle_offset_deg: 5,
        length_scale: 1,
        width_scale: 1,
        tip_angle_deg: null,
        shift_along_mm: 0,
        shift_perp_mm: 0,
        reason: "review",
      }],
    },
  },
  guardrails: { passed: true, warnings: [], suggested_overrides: [] },
  trace: [{
    action: "inspect_sensitive_structures",
    observation: { warning_count: 0 },
  }],
  workflow_audit: {
    candidate_count: 1,
    comparison_ready: true,
    tool_failure_count: 1,
    recovered_failures: [{
      variant: "左偏 10°",
      tool: "guardrail",
      recovery: "skipped_failed_variant_and_kept_other_candidates",
      error: "fixture failure",
    }],
  },
};

const editSession = buildCandidateEditSession(result, {
  undoAvailable: true,
  redoAvailable: false,
});
assert.equal(editSession.edit_count, 1);
assert.equal(editSession.current_edit_id, "edit-1");
assert.equal(editSession.undo_available, true);
assert.equal(editSession.history[0].interaction, "clinician_adjustment");
assert.deepEqual(findSensitiveStructureInspection(result), { warning_count: 0 });

const record = buildIncisionReviewRecord({
  result,
  label: "当前候选",
  createdAt: "2026-07-29T00:00:00.000Z",
  id: "candidate-fixture",
  review: { status: "pending_clinician_confirmation", reviewer: "", notes: "" },
  reviewGate: {
    approval_ready: false,
    live_overlay_ready: false,
    workflow_trace_gate_passed: false,
    high_guardrail_codes: [],
  },
  tumorQuality: result.tumor_quality,
  tumorBoundarySummary: { boundary_used: false },
  headAsset: { topologyId: "mediapipe-468", topologyVersion: "mediapipe-468-v1" },
  secondaryCues: { present: false, used_for_geometry: false },
  candidateEditSession: editSession,
  sensitiveStructureInspection: findSensitiveStructureInspection(result),
  privacyAudit: { raw_image_sent: false },
});
assert.equal(record.schema_version, "incision-review-record/v0.4");
assert.equal(record.id, "candidate-fixture");
assert.equal(record.audit_events.length, 1);
assert.equal(record.audit_events[0].actor, "clinician");
assert.equal(record.candidate_edit_session.edit_count, 1);

const generatedRecord = buildIncisionReviewRecord({
  result,
  label: "当前候选",
  createdAt: "2026-07-29T00:00:00.000Z",
  review: { status: "pending_clinician_confirmation", reviewer: "", notes: "" },
  reviewGate: {
    approval_ready: false,
    live_overlay_ready: false,
    workflow_trace_gate_passed: false,
    high_guardrail_codes: [],
  },
  tumorQuality: result.tumor_quality,
  tumorBoundarySummary: { boundary_used: false },
  headAsset: { topologyId: "mediapipe-468", topologyVersion: "mediapipe-468-v1" },
  secondaryCues: { present: false, used_for_geometry: false },
  candidateEditSession: editSession,
  sensitiveStructureInspection: findSensitiveStructureInspection(result),
  privacyAudit: { raw_image_sent: false },
});
assert.match(generatedRecord.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
assert.equal(auditExportPayload({
  schema_version: "incision-review-export/v0.4",
  exported_at: "2026-07-29T00:00:00.000Z",
  current: generatedRecord,
  saved: [],
}).passed, true, "default review record metadata passes export privacy preflight");

const report = buildIncisionReviewReport([record], 1234);
assert.equal(report.filename, "incision_report_1234.md");
assert.equal(report.mimeType, "text/markdown");
assert.match(report.text, /# 切口候选审阅草案/);
assert.match(report.text, /工作流恢复详情/);
assert.match(report.text, /已跳过失败变体并继续比较/);
assert.match(report.text, /不是临床推荐或手术指令/);
assert.match(
  formatRecoveredFailureSummary(result.workflow_audit, true),
  /fixture failure/,
);

console.log("test_incision_review_records: record audit, edit session, and markdown report passed");
