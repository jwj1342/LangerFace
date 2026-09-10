import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

import { COLOR_DIFFERENCE_BASELINE_VERSION } from "../web/src/services/controlledMarkerDetectionColorV035.ts";
import {
  CONTROLLED_MARKER_DETECTOR_PROFILE,
  CONTROLLED_MARKER_DETECTOR_VERSION,
  DEFAULT_CONTROLLED_MARKER_DETECTOR_PROFILE,
  LEGACY_CONTROLLED_MARKER_SOURCE_COMMIT,
  detectorVersionForProfile,
  detectControlledMarkerWithProfile,
  resolveControlledMarkerDetectorProfile,
} from "../web/src/services/controlledMarkerDetectionProfile.ts";

assert.equal(LEGACY_CONTROLLED_MARKER_SOURCE_COMMIT, "fe703e2bb37d837f339f2b4fb9861d202568b8e6");
assert.equal(COLOR_DIFFERENCE_BASELINE_VERSION, "0.23");
assert.equal(DEFAULT_CONTROLLED_MARKER_DETECTOR_PROFILE, "legacy-v0.23");
assert.equal(resolveControlledMarkerDetectorProfile(), "legacy-v0.23");
assert.equal(resolveControlledMarkerDetectorProfile("current"), "current-v0.34");
assert.equal(resolveControlledMarkerDetectorProfile("color"), "color-difference-v0.35");
assert.equal(resolveControlledMarkerDetectorProfile("color-difference"), "color-difference-v0.35");
assert.equal(resolveControlledMarkerDetectorProfile("v0.35"), "color-difference-v0.35");
assert.equal(resolveControlledMarkerDetectorProfile("legacy"), "legacy-v0.23");
assert.equal(resolveControlledMarkerDetectorProfile("v0.23"), "legacy-v0.23");
assert.throws(() => resolveControlledMarkerDetectorProfile("unknown"), /Unsupported controlled marker detector profile/);
assert.equal(detectorVersionForProfile("current-v0.34"), "0.34");
assert.equal(detectorVersionForProfile("color-difference-v0.35"), "0.35");
assert.equal(detectorVersionForProfile("legacy-v0.23"), "0.23");
const expectedActiveProfile = resolveControlledMarkerDetectorProfile(
  process.env.VITE_CONTROLLED_MARKER_DETECTOR_PROFILE,
);
assert.equal(CONTROLLED_MARKER_DETECTOR_PROFILE, expectedActiveProfile);
assert.equal(CONTROLLED_MARKER_DETECTOR_VERSION, detectorVersionForProfile(expectedActiveProfile));

const legacySource = fs.readFileSync("src/services/controlledMarkerDetectionLegacyV023.ts", "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\n+$/, "\n");
assert.equal(
  crypto.createHash("sha256").update(legacySource).digest("hex").toUpperCase(),
  "FBD74F2C1E9265C2E4C55C382F634A2A72D8894088BF122B9722A05019E8105A",
  "the audited diagnostic-instrumented legacy core changed; recheck v0.23 behavior before updating this fingerprint",
);
assert.match(legacySource, /acceptBoundaryWithinFullScan\?: boolean/,
  "the wider scan contract must remain an explicit opt-in rather than the v0.23 default");
assert.match(legacySource, /options\.acceptBoundaryWithinFullScan\s*\?[\s\S]*:\s*maximumBoundaryRadius >= roiRadius \* 0\.88/,
  "legacy-v0.23 must retain its original scan-range condition unless a caller opts in");

const invalidImage = { width: 0, height: 0, data: new Uint8ClampedArray() };
for (const profile of ["color-difference-v0.35", "current-v0.34", "legacy-v0.23"] as const) {
  const result = detectControlledMarkerWithProfile(profile, invalidImage, { x: 0, y: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.failure_code, "invalid_image");
  assert.deepEqual(result.audit, {
    local_only: true,
    raw_media_retained: false,
    network_request_made: false,
  });
}

const workerSource = fs.readFileSync("src/workers/workflow.worker.ts", "utf8");
const workflowSource = fs.readFileSync("src/services/workflowIncisionController.ts", "utf8");
const photoRuntimeSource = fs.readFileSync("src/services/incisionPhotoRuntime.ts", "utf8");
assert.match(workerSource, /services\/controlledMarkerDetectionProfile\.ts/);
assert.match(workflowSource, /controlledMarkerDetectionProfile/);
assert.match(photoRuntimeSource, /controlledMarkerDetectionProfile/);
assert.match(
  fs.readFileSync("src/services/controlledMarkerDetectionProfile.ts", "utf8"),
  /controlled marker profile result/,
  "diagnostic mode records profile, version, parameters, boundary and detector diagnostics without image pixels",
);

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(
  packageJson.scripts["dev:marker-v035"],
  "node ../tools/run_controlled_marker_v035_dev.mjs",
  "v0.35 has a stable, cross-platform development entrypoint",
);
assert.match(
  packageJson.scripts["predev:marker-v035"],
  /doctor_wrinkle_runtime\.ts/,
  "the stable entrypoint checks page-wide runtime assets before startup",
);
const markerLauncherSource = fs.readFileSync("../tools/run_controlled_marker_v035_dev.mjs", "utf8");
assert.match(markerLauncherSource, /const EXPECTED_PROFILE = "color-difference-v0\.35"/);
assert.match(markerLauncherSource, /VITE_CONTROLLED_MARKER_DETECTOR_PROFILE: EXPECTED_PROFILE/);
assert.match(markerLauncherSource, /defaultProfileUnchanged: DEFAULT_PROFILE/);
assert.match(markerLauncherSource, /deferred_to_main_launcher/);
assert.match(markerLauncherSource, /pageWideModelAssetsCheck/);

console.log("controlled marker detector profile tests passed");
