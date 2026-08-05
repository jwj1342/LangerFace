import assert from "node:assert/strict";

import { auditExportPayload } from "../web/src/services/exportPrivacy.ts";

function safeReviewExport() {
  return {
    schema_version: "incision-review-export/v0.4",
    exported_at: "2026-06-25T12:34:56.000Z",
    current: {
      id: "12345678-1234-4234-8234-123456789012",
      created_at: "2026-06-25T12:34:56.000Z",
      schema_version: "incision-review-record/v0.4",
      credentials: { token_present: true, token: "[redacted]" },
      privacy_audit: {
        raw_image_sent: false,
        raw_video_sent: false,
        contains_face_image: false,
      },
      secondary_cues: {
        present: true,
        used_for_geometry: false,
        outputs: { cue_overlay: "review-overlay.png" },
      },
      review: {},
      audit_events: [{
        event: "candidate_saved",
        at: "2026-06-25T12:34:56.000Z",
      }],
    },
    saved: [{
      id: "12345678-1234-4234-8234-123456789013",
      schema_version: "incision-review-record/v0.4",
      created_at: "2026-06-25T12:34:56.000Z",
      audit_events: [{ at: "2026-06-25T12:34:56.000Z" }],
    }],
  };
}

let report = auditExportPayload(safeReviewExport());
assert.equal(report.schema_version, "browser-export-privacy-preflight/v0.1");
assert.equal(report.passed, true);
assert.equal(report.violation_count, 0);

const unsafe = safeReviewExport();
unsafe.current.credentials.token = "test-not-redacted";
unsafe.current.privacy_audit.raw_image_sent = true;
unsafe.current.patient_name = "Alice Example";
unsafe.current.review = { notes: "Call +1 555 010 9999 before review" };
unsafe.current.secondary_cues.used_for_geometry = true;
unsafe.current.secondary_cues.outputs.cue_overlay = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
report = auditExportPayload(unsafe);
const codes = new Set(report.violations.map((item) => item.code));
assert.equal(report.passed, false);
assert.ok(codes.has("secret_value_present"));
assert.ok(codes.has("raw_media_flag_true"));
assert.ok(codes.has("pii_field_present"));
assert.ok(codes.has("pii_pattern_present"));
assert.ok(codes.has("secondary_cue_used_for_geometry_true"));
assert.ok(codes.has("embedded_media_payload"));

const malformedMetadata = safeReviewExport();
malformedMetadata.current.id = "12345678-1234-0234-1234-123456789012";
malformedMetadata.current.audit_events[0].at = "2026-06-25T12:34:56.000+1 555 010 9999";
report = auditExportPayload(malformedMetadata);
assert.equal(report.passed, false, "malformed UUID and timestamp values must not receive metadata exemptions");
assert.ok(report.violations.some((item) => item.path === "current.id" && item.code === "pii_pattern_present"));
assert.ok(report.violations.some((item) => item.path === "current.audit_events.0.at" && item.code === "pii_pattern_present"));

const untrustedTimestampPath = safeReviewExport();
untrustedTimestampPath.current.review.notes_at = "2026-06-25T12:34:56.000Z";
untrustedTimestampPath.current.review.audit = { at: "2026-06-25T12:34:56.000Z" };
report = auditExportPayload(untrustedTimestampPath);
assert.equal(report.passed, false, "only contract-defined metadata paths may exempt timestamps");
assert.ok(report.violations.some((item) => item.path === "current.review.notes_at" && item.code === "pii_pattern_present"));
assert.ok(report.violations.some((item) => item.path === "current.review.audit.at" && item.code === "pii_pattern_present"));

const freeTextPhone = safeReviewExport();
freeTextPhone.current.review.notes = "可联系 +1 555 010 9999 复核";
report = auditExportPayload(freeTextPhone);
assert.equal(report.passed, false, "free text phone numbers must remain blocked");
assert.ok(report.violations.some((item) => item.path === "current.review.notes" && item.code === "pii_pattern_present"));

report = auditExportPayload({
  current: { id: null, audit_events: [null, { at: null }], values: [null, false, []] },
  saved: [],
});
assert.equal(report.passed, true, "null values and nested arrays must remain exportable");

const nestedAuditPii = safeReviewExport();
nestedAuditPii.current.audit_events.push({ metadata: { note: "请联系 +1 555 010 9999" } });
report = auditExportPayload(nestedAuditPii);
assert.equal(report.passed, false, "nested audit objects must remain recursively scanned");
assert.ok(report.violations.some((item) => item.path === "current.audit_events.1.metadata.note" && item.code === "pii_pattern_present"));

console.log("test_export_privacy: browser export privacy preflight assertions passed");
