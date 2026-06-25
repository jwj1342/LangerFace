// Dependency-free tests for #19 incision overlay engineering acceptance audit.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIncisionOverlayAcceptanceAudit } from "./audit_incision_overlay_acceptance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function registration(context = "photo_upload") {
  return {
    schema_version: "incision-overlay-registration/v0.1",
    passed: true,
    reason: "runtime_projection_registration_ready",
    thresholds: { context },
    mapped_point_count: 4,
    candidate_point_count: 2,
    tumor_center_mapped: true,
    invalid_ref_count: 0,
    missing_landmark_count: 0,
    degenerate_triangle_count: 0,
    out_of_frame_count: 0,
    bbox_px: { diagonal_px: 42, frame_fraction: 0.2 },
  };
}

function stability(context = "static_camera_or_paused_video") {
  return {
    schema_version: "incision-overlay-stability/v0.1",
    passed: true,
    reason: "within_static_overlay_jitter_thresholds",
    frame_count: 8,
    tracked_point_count: 4,
    sample_count: 28,
    thresholds: { max_rms_px: 2, max_p95_px: 4, max_max_px: 8, context },
    overall: { rms_px: 0.8, p95_px: 1.4, max_px: 2.1 },
    by_group: {
      candidate_polyline: { rms_px: 0.7, p95_px: 1.2, max_px: 1.8 },
      tumor_center: { rms_px: 0.5, p95_px: 1.0, max_px: 1.4 },
    },
  };
}

const stableReplay = {
  schema_version: "incision-overlay-replay-qa/v0.1",
  passed: true,
  reason: "offline_overlay_replay_passed",
  frame_count: 8,
  registration_summary: { passed_count: 8, failed_count: 0, pass_rate: 1 },
  stability: stability("offline_incision_overlay_replay"),
};

const passingEvidence = {
  schema_version: "incision-overlay-acceptance-evidence/v0.1",
  generated_at: "2026-06-25T00:00:00Z",
  resource_qa: { passed: true, checked_count: 28, missing_count: 0 },
  diagnostics: { counters: {}, events: [] },
  evidence: [
    {
      source_kind: "photo",
      registration: registration("photo_upload"),
      runtime_diagnostics: {
        schema_version: "incision-overlay-runtime-diagnostics/v0.1",
        exported_raw_pixels: false,
        exported_landmarks: false,
      },
    },
    {
      source_kind: "video",
      replay_qa: stableReplay,
      export: { mime_type: "video/webm", blob_size_bytes: 4096 },
    },
    {
      source_kind: "camera",
      registration: registration("camera_runtime"),
      stability: stability("static_camera_or_paused_video"),
    },
  ],
};

const passReport = buildIncisionOverlayAcceptanceAudit([passingEvidence], {
  generatedAt: "2026-06-25T00:00:00Z",
});
assert.equal(passReport.schema_version, "incision-overlay-acceptance-audit/v0.1");
assert.equal(passReport.passed, true, "complete sanitized evidence passes #19 acceptance audit");
assert.deepEqual(passReport.failures, []);
assert.equal(passReport.checks.photo_overlay_ready, true);
assert.equal(passReport.checks.video_overlay_stable, true);
assert.equal(passReport.checks.video_export_playable, true);
assert.equal(passReport.checks.camera_overlay_stable, true);
assert.equal(passReport.checks.runtime_error_free, true);
assert.equal(passReport.checks.resources_available, true);
assert.equal(passReport.checks.sanitized_evidence_only, true);
assert.equal(passReport.evidence_counts.photo, 1);
assert.equal(passReport.evidence_counts.video, 1);
assert.equal(passReport.evidence_counts.camera, 1);

const failingEvidence = {
  ...passingEvidence,
  resource_qa: { passed: false, checked_count: 28, missing_count: 1 },
  diagnostics: {
    counters: { "runtime.error": 1 },
    events: [{ event: "runtime.error", detail: { message: "render failed" } }],
  },
  evidence: [
    passingEvidence.evidence[0],
    {
      source_kind: "video",
      replay_qa: { ...stableReplay, passed: false, reason: "registration_frame_failure" },
      export: { mime_type: "video/webm", blob_size_bytes: 0 },
    },
    {
      source_kind: "camera",
      registration: registration("camera_runtime"),
      stability: { ...stability("static_camera_or_paused_video"), passed: false, reason: "jitter_threshold_exceeded" },
    },
    {
      source_kind: "photo",
      audit: { raw_image_sent: true },
    },
  ],
};
const failReport = buildIncisionOverlayAcceptanceAudit([failingEvidence]);
assert.equal(failReport.passed, false, "incomplete/unsafe evidence fails #19 acceptance audit");
assert.ok(failReport.failures.includes("video_overlay_stable"));
assert.ok(failReport.failures.includes("video_export_playable"));
assert.ok(failReport.failures.includes("camera_overlay_stable"));
assert.ok(failReport.failures.includes("runtime_error_free"));
assert.ok(failReport.failures.includes("resources_available"));
assert.ok(failReport.failures.includes("sanitized_evidence_only"));
assert.ok(failReport.raw_media_leak_paths.includes("0.evidence.3.audit.raw_image_sent"));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "incision-overlay-acceptance-"));
const inputPath = path.join(tmpDir, "acceptance.json");
const outputPath = path.join(tmpDir, "audit.json");
fs.writeFileSync(inputPath, JSON.stringify(passingEvidence), "utf8");
const cli = spawnSync(
  process.execPath,
  [
    "tools/audit_incision_overlay_acceptance.mjs",
    "--input",
    inputPath,
    "--output",
    outputPath,
    "--generated-at",
    "2026-06-25T00:00:00Z",
  ],
  { cwd: ROOT, text: true, encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
const cliReport = JSON.parse(fs.readFileSync(outputPath, "utf8"));
assert.equal(cliReport.schema_version, "incision-overlay-acceptance-audit/v0.1");
assert.equal(cliReport.passed, true, "CLI writes passing #19 acceptance report");

const failingInputPath = path.join(tmpDir, "acceptance_fail.json");
fs.writeFileSync(failingInputPath, JSON.stringify(failingEvidence), "utf8");
const failingCli = spawnSync(
  process.execPath,
  ["tools/audit_incision_overlay_acceptance.mjs", "--input", failingInputPath],
  { cwd: ROOT, text: true, encoding: "utf8" },
);
assert.equal(failingCli.status, 1, "CLI exits nonzero on failed #19 acceptance evidence");
assert.ok(failingCli.stdout.includes("video_overlay_stable"), "CLI output includes failed checks");

console.log("test_incision_overlay_acceptance_audit: #19 acceptance audit assertions passed");
