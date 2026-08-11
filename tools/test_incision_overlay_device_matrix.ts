import assert from "node:assert/strict";

import {
  auditIncisionOverlayDeviceMatrix,
  DEVICE_MATRIX_SCHEMA,
} from "./audit_incision_overlay_device_matrix.ts";

const environment = {
  browser: "Chromium",
  browser_version: "test-version",
  os: "controlled-test-os",
  resolution: { width: 1280, height: 720 },
  fps: 30,
  lighting: "controlled diffuse light",
};
const manual_review = {
  reviewer_id: "reviewer-01",
  reviewer_role: "engineering reviewer",
  reviewed_at: "2026-08-05T12:00:00Z",
  status: "pass",
};
const privacy = { raw_media_included: false, landmark_coordinates_included: false };
const stable = { passed: true, rms_px: 1.5, p95_px: 3.2, max_px: 7.1 };

const success = (id: string, source_kind: string, scenario: string) => ({
  id,
  source_kind,
  scenario,
  environment,
  manual_review,
  privacy,
  engineering: {
    overlay_visible: true,
    registration_passed: true,
    clear_preserved_media_and_rstl: true,
    console_error_count: 0,
    stability: stable,
    export_playable: true,
  },
});
const failure = (scenario: string) => ({
  id: `failure-${scenario}`,
  source_kind: "camera",
  scenario,
  environment,
  manual_review: { ...manual_review, status: "review" },
  privacy,
  engineering: { overlay_state: "review", visible_reason: `visible ${scenario} gate`, console_error_count: 0 },
});

const passing = {
  schema_version: DEVICE_MATRIX_SCHEMA,
  samples: [
    success("photo-front", "photo", "front"),
    success("photo-yaw", "photo", "mild_yaw"),
    success("photo-light", "photo", "different_lighting"),
    success("video-turn", "video", "slow_turn"),
    success("video-expression", "video", "expression"),
    success("camera-fixed", "camera", "fixed_camera"),
    ...["no_face", "multiple_faces", "fast_motion", "large_yaw", "occlusion", "low_light"].map(failure),
  ],
};
assert.equal(auditIncisionOverlayDeviceMatrix(passing, "2026-08-05T12:00:00Z").passed, true);

const missingCamera = { ...passing, samples: passing.samples.filter((sample) => sample.scenario !== "fixed_camera") };
const missingCameraAudit = auditIncisionOverlayDeviceMatrix(missingCamera);
assert.equal(missingCameraAudit.passed, false);
assert.equal(missingCameraAudit.checks.find((check) => check.id === "camera_fixed_camera")?.passed, false);

const unstable = structuredClone(passing);
unstable.samples.find((sample: any) => sample.id === "video-turn").engineering.stability.rms_px = 2.1;
assert.equal(auditIncisionOverlayDeviceMatrix(unstable).checks.find((check) => check.id === "video_slow_turn")?.passed, false);

const leaked = structuredClone(passing);
leaked.samples[0].privacy.raw_media_included = true;
assert.equal(auditIncisionOverlayDeviceMatrix(leaked).checks.find((check) => check.id === "all_samples_sanitized")?.passed, false);

console.log("test_incision_overlay_device_matrix: fixed-device coverage, thresholds, review, and privacy passed");
