import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fitImageToMaxSide, MAX_IMAGE_SOURCE_DIM } from "../web/src/services/imageSource.ts";
import {
  detectStaticImageWithRetries,
  STATIC_IMAGE_MAX_ATTEMPTS,
} from "../web/src/services/staticImageDetection.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

{
  const fit = fitImageToMaxSide(6000, 4000);
  assert.equal(fit.width, MAX_IMAGE_SOURCE_DIM);
  assert.equal(fit.height, 1067);
  assert.equal(fit.scaled, true);
}

{
  const fit = fitImageToMaxSide(3000, 6000);
  assert.equal(fit.width, 800);
  assert.equal(fit.height, MAX_IMAGE_SOURCE_DIM);
  assert.equal(fit.scaled, true);
}

{
  const fit = fitImageToMaxSide(1280, 720);
  assert.equal(fit.width, 1280);
  assert.equal(fit.height, 720);
  assert.equal(fit.scaled, false);
}

{
  const fit = fitImageToMaxSide(4000, 3000, 1200);
  assert.equal(fit.width, 1200);
  assert.equal(fit.height, 900);
  assert.equal(fit.scale, 0.3);
}

{
  const detector = {
    detect(source: unknown) {
      const id = String((source as { id: string }).id);
      return { faceLandmarks: [[{ x: id === "A" ? 0.25 : 0.75, y: 0.5, z: 0 }]] };
    },
  };
  const sameImage = Array.from({ length: 5 }, () => detectStaticImageWithRetries(detector, { id: "A" }));
  assert.ok(sameImage.every(({ attempts }) => attempts === 1), "same image succeeds on the first IMAGE detection attempt");
  assert.ok(sameImage.every(({ result }) => result?.faceLandmarks?.[0]?.[0]?.x === 0.25),
    "same image is stable across five independent uploads");

  const switched = ["A", "B", "A"].map((id) => detectStaticImageWithRetries(detector, { id }));
  assert.deepEqual(switched.map(({ result }) => result?.faceLandmarks?.[0]?.[0]?.x), [0.25, 0.75, 0.25],
    "switching images does not carry detection state between sources");
}

{
  let calls = 0;
  const outcome = detectStaticImageWithRetries({
    detect() {
      calls += 1;
      return { faceLandmarks: [] };
    },
  }, { id: "no-face" });
  assert.equal(calls, STATIC_IMAGE_MAX_ATTEMPTS, "no-landmarks retry is bounded");
  assert.equal(outcome.attempts, STATIC_IMAGE_MAX_ATTEMPTS);
  assert.equal(outcome.result?.faceLandmarks?.length, 0);
}

{
  let calls = 0;
  const outcome = detectStaticImageWithRetries({
    detect() {
      calls += 1;
      return calls < STATIC_IMAGE_MAX_ATTEMPTS
        ? { faceLandmarks: [] }
        : { faceLandmarks: [[{ x: 0.5, y: 0.5, z: 0 }]] };
    },
  }, { id: "transient" });
  assert.equal(outcome.attempts, STATIC_IMAGE_MAX_ATTEMPTS, "bounded retry can recover on the final attempt");
  assert.equal(outcome.result?.faceLandmarks?.[0]?.length, 1);
}

for (const rel of ["web/src/services/pipelineModels.ts", "web/current/pipeline.js"]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /runningMode: "VIDEO"/, `${rel} keeps the camera/video detector in VIDEO mode`);
  assert.match(source, /runningMode: "IMAGE"/, `${rel} creates an independent IMAGE detector`);
  assert.match(source, /imageLandmarker/, `${rel} stores the IMAGE detector separately`);
}

for (const rel of ["web/src/services/pipelineLoop.ts", "web/current/pipeline.js"]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /imageLandmarker/, `${rel} selects the independent IMAGE detector`);
  assert.match(source, /detectStaticImageWithRetries/, `${rel} uses bounded single-image detection`);
  assert.match(source, /detectForVideo/, `${rel} keeps camera/video detection on detectForVideo`);
}

for (const rel of ["web/src/services/pipelineSource.ts", "web/current/pipeline.js"]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /els\.file\.value = "";/, `${rel} permits selecting the same file repeatedly`);
  assert.match(source, /imageDetectionComplete = false/, `${rel} resets per-image detection completion`);
  assert.match(source, /imageDetectionAttempts = 0/, `${rel} resets per-image attempt state`);
  assert.match(source, /operationId !== sourceOperationId/, `${rel} prevents stale uploads from replacing a newer source`);
}

for (const rel of ["web/src/services/pipelineLoop.ts", "web/current/pipeline.js"]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /未检测到人脸（已尝试/, `${rel} exposes a clear no-landmarks retry message`);
  assert.match(source, /imageDetectionComplete/, `${rel} does not retry indefinitely on redraw`);
}

console.log("ok: image upload size, IMAGE detection, state isolation, and bounded retry contracts");
