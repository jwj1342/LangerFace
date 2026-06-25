// Dependency-free tests for #19 incision overlay acceptance evidence packaging.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIncisionOverlayAcceptanceAudit } from "./audit_incision_overlay_acceptance.mjs";
import { buildIncisionOverlayAcceptanceEvidence } from "./build_incision_overlay_acceptance_evidence.mjs";

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
    bbox_px: { diagonal_px: 48, frame_fraction: 0.18 },
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
    overall: { rms_px: 0.7, p95_px: 1.2, max_px: 1.8 },
  };
}

function runtimeDiagnostics(kind) {
  return {
    schemaVersion: "0.1",
    counters: {},
    events: [],
    sections: {
      incision_overlay_runtime: {
        schema_version: "incision-overlay-runtime-diagnostics/v0.1",
        source_kind: kind,
        exported_raw_pixels: false,
        exported_landmarks: false,
        registration: registration(`${kind}_runtime`),
        stability: kind === "photo" ? null : stability(`${kind}_runtime`),
      },
    },
  };
}

const replayQa = {
  schema_version: "incision-overlay-replay-qa/v0.1",
  passed: true,
  reason: "offline_overlay_replay_passed",
  frame_count: 8,
  registration_summary: { passed_count: 8, failed_count: 0, pass_rate: 1 },
  stability: stability("offline_incision_overlay_replay"),
};

const evidence = buildIncisionOverlayAcceptanceEvidence({
  photoDiagnostics: [runtimeDiagnostics("photo")],
  videoReplays: [replayQa],
  videoExports: [{ mimeType: "video/webm", size_bytes: 8192, playable: true }],
  cameraDiagnostics: [runtimeDiagnostics("camera")],
  resourceQa: [{ passed: true, checked_count: 31, missing_count: 0, source: "dist-assets" }],
  diagnostics: [{ counters: {}, events: [] }],
}, { generatedAt: "2026-06-25T00:00:00Z" });

assert.equal(evidence.schema_version, "incision-overlay-acceptance-evidence/v0.1");
assert.equal(evidence.evidence.length, 4);
assert.equal(evidence.resource_qa.passed, true);
assert.equal(evidence.privacy.raw_media_or_landmark_payloads, false);
assert.equal(evidence.evidence_sources.photo_diagnostics, 1);
assert.equal(evidence.evidence_sources.video_replay, 1);
assert.equal(evidence.evidence_sources.video_export, 1);
assert.equal(evidence.evidence_sources.camera_diagnostics, 1);
assert.ok(evidence.clinical_boundary.includes("sanitized engineering QA"));

const audit = buildIncisionOverlayAcceptanceAudit([evidence], { generatedAt: "2026-06-25T00:00:00Z" });
assert.equal(audit.passed, true, "packaged evidence passes #19 acceptance audit");
assert.deepEqual(audit.failures, []);
assert.equal(audit.evidence_counts.photo, 1);
assert.equal(audit.evidence_counts.video, 2);
assert.equal(audit.evidence_counts.camera, 1);

assert.throws(
  () => buildIncisionOverlayAcceptanceEvidence({
    videoReplays: [{ ...replayQa, landmark_frames: [[[1, 2, 3]]] }],
  }),
  /raw media or landmark payloads/,
);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "incision-overlay-evidence-"));
const photoPath = path.join(tmpDir, "photo.json");
const replayPath = path.join(tmpDir, "replay.json");
const exportPath = path.join(tmpDir, "export.json");
const cameraPath = path.join(tmpDir, "camera.json");
const resourcePath = path.join(tmpDir, "resources.json");
const outputPath = path.join(tmpDir, "evidence.json");
const auditPath = path.join(tmpDir, "audit.json");
fs.writeFileSync(photoPath, JSON.stringify(runtimeDiagnostics("photo")), "utf8");
fs.writeFileSync(replayPath, JSON.stringify(replayQa), "utf8");
fs.writeFileSync(exportPath, JSON.stringify({ mime_type: "video/webm", blob_size_bytes: 8192 }), "utf8");
fs.writeFileSync(cameraPath, JSON.stringify(runtimeDiagnostics("camera")), "utf8");
fs.writeFileSync(resourcePath, JSON.stringify({ passed: true, checked_count: 31, missing_count: 0 }), "utf8");

const cli = spawnSync(
  process.execPath,
  [
    "tools/build_incision_overlay_acceptance_evidence.mjs",
    "--photo-diagnostics",
    photoPath,
    "--video-replay",
    replayPath,
    "--video-export",
    exportPath,
    "--camera-diagnostics",
    cameraPath,
    "--resource-qa",
    resourcePath,
    "--output",
    outputPath,
    "--audit-output",
    auditPath,
    "--generated-at",
    "2026-06-25T00:00:00Z",
  ],
  { cwd: ROOT, text: true, encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
const cliEvidence = JSON.parse(fs.readFileSync(outputPath, "utf8"));
const cliAudit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
assert.equal(cliEvidence.schema_version, "incision-overlay-acceptance-evidence/v0.1");
assert.equal(cliAudit.schema_version, "incision-overlay-acceptance-audit/v0.1");
assert.equal(cliAudit.passed, true);

console.log("test_incision_overlay_acceptance_evidence: #19 acceptance evidence assertions passed");
