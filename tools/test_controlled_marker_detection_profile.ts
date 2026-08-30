import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

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
assert.equal(DEFAULT_CONTROLLED_MARKER_DETECTOR_PROFILE, "legacy-v0.23");
assert.equal(resolveControlledMarkerDetectorProfile(), "legacy-v0.23");
assert.equal(resolveControlledMarkerDetectorProfile("current"), "current-v0.34");
assert.equal(resolveControlledMarkerDetectorProfile("legacy"), "legacy-v0.23");
assert.equal(resolveControlledMarkerDetectorProfile("v0.23"), "legacy-v0.23");
assert.throws(() => resolveControlledMarkerDetectorProfile("unknown"), /Unsupported controlled marker detector profile/);
assert.equal(detectorVersionForProfile("current-v0.34"), "0.34");
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
  "ECB74D366BEB7EB3B05B867504037FB092C737B802844E3DC8DD58193789194B",
  "legacy-v0.23 core must remain byte-equivalent after newline normalization",
);

const invalidImage = { width: 0, height: 0, data: new Uint8ClampedArray() };
for (const profile of ["current-v0.34", "legacy-v0.23"] as const) {
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

console.log("controlled marker detector profile tests passed");
