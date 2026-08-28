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

for (const rel of ["web/src/services/pipelineModels.ts"]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /runningMode: "VIDEO"/, `${rel} keeps the camera/video detector in VIDEO mode`);
  assert.match(source, /runningMode: "IMAGE"/, `${rel} creates an independent IMAGE detector`);
  assert.match(source, /imageLandmarker/, `${rel} stores the IMAGE detector separately`);
  const imageInitializer = source.match(/async function initializeImageReady[\s\S]*?export function ensureImageReady/)?.[0] || "";
  assert.match(imageInitializer, /await ensureAssetsReady\(\)/,
    `${rel} shares topology and WASM initialization with the image detector`);
  assert.doesNotMatch(imageInitializer, /await ensureReady\(\)/,
    `${rel} does not initialize VIDEO detectors before the independent IMAGE detector`);
  assert.match(imageInitializer, /await Promise\.all\(\[\s*initializeImageFaceReady\(\),\s*initializeImageHandReady\(\),?\s*\]\)/,
    `${rel} initializes face and hand IMAGE models in parallel instead of adding their cold-start times`);
}

for (const rel of ["web/src/services/liveRuntime.ts"]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /ensureImageReady\(\)\.then/,
    `${rel} prewarms the dominant static-photo path without starting unused VIDEO detector instances`);
}

for (const rel of ["web/src/services/pipelineLoop.ts"]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /imageLandmarker/, `${rel} selects the independent IMAGE detector`);
  assert.match(source, /detectStaticImageWithRetries/, `${rel} uses bounded single-image detection`);
  assert.match(source, /detectForVideo/, `${rel} keeps camera/video detection on detectForVideo`);
}

for (const rel of ["web/src/services/pipelineSource.ts"]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /els\.file\.value = "";/, `${rel} permits selecting the same file repeatedly`);
  assert.match(source, /imageDetectionComplete = false/, `${rel} resets per-image detection completion`);
  assert.match(source, /imageDetectionAttempts = 0/, `${rel} resets per-image attempt state`);
  assert.match(source, /operationId !== sourceOperationId/, `${rel} prevents stale uploads from replacing a newer source`);
  assert.match(source, /setMsg\("图片加载中", 0, true\)/,
    `${rel} exposes an explicit image-loading state on the central canvas`);
  assert.match(source, /if \(!file\.type\.startsWith\("image\/"\)\) \{[\s\S]*?return;[\s\S]*?const startedAt/,
    `${rel} rejects non-photo files before stopping or replacing the active source`);
  assert.match(source, /const modelReady = ensureImageReady\(\)\.then[\s\S]*?const decoded = img\.decode\(\)\.then[\s\S]*?await Promise\.all\(\[modelReady, decoded\]\)/,
    `${rel} overlaps image decoding with cached static-model initialization while timing both stages`);
  assert.doesNotMatch(source, /await ensureReady\(\);\s*if \(imageFile\) await ensureImageReady\(\)/,
    `${rel} does not initialize the shared model twice in the image branch`);
  assert.match(source, /recordMetricSample\("source\.imageUploadToSourceSetMs"/,
    `${rel} records end-to-end upload readiness timing without logging image content`);
}

{
  const loopSource = readFileSync(join(root, "web/src/services/pipelineLoop.ts"), "utf8");
  const runtimeSource = readFileSync(join(root, "web/src/services/liveRuntime.ts"), "utf8");
  const wrinkleSource = readFileSync(join(root, "web/src/services/liveWrinkleAnalysis.ts"), "utf8");
  const wrinklePanelSource = readFileSync(join(root, "web/src/components/LiveWrinklePanel.tsx"), "utf8");
  assert.doesNotMatch(loopSource, /scheduleCurrentWrinkleAnalysis|analyzeCurrentWrinkles/,
    "static-photo rendering never starts optional YOLO work as a side effect of uploading or drawing");
  assert.match(loopSource, /sourceState\.imageCacheLM[\s\S]*?dispatchEvent\(new CustomEvent\("langerface:source-frame-ready"\)\)/,
    "completed face detection publishes readiness without starting optional wrinkle work");
  assert.match(runtimeSource, /addEventListener\("langerface:source-frame-ready"[\s\S]*?updateWrinkleUi\(\)/,
    "the live runtime consumes frame readiness and enables the explicit wrinkle action");
  assert.doesNotMatch(loopSource, /void analyzeCurrentWrinkles\(\)/,
    "the first photo frame no longer starts the extra CPU Face + YOLO chain immediately");
  assert.doesNotMatch(runtimeSource, /scheduleCurrentWrinkleAnalysis|cancelScheduledCurrentWrinkleAnalysis/,
    "repeated file-picker use has no hidden wrinkle-analysis timer to cancel or revive");
  assert.doesNotMatch(wrinkleSource, /AUTO_WRINKLE_ANALYSIS_DELAY_MS|requestIdleCallback/,
    "YOLO is explicit user work rather than a delayed automatic main-thread task");
  assert.match(wrinklePanelSource, /点击“检测皱纹”后才会启动 V10/,
    "the panel tells operators that V10 runs only after an explicit action");
  assert.match(wrinkleSource, /return isWrinkleFrameReady\(\) \? "等待手动检测"/,
    "the ready state cannot imply that automatic YOLO is pending");
}

for (const rel of ["web/src/services/pipelineLoop.ts"]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /未检测到人脸（已尝试/, `${rel} exposes a clear no-landmarks retry message`);
  assert.match(source, /imageDetectionComplete/, `${rel} does not retry indefinitely on redraw`);
}

console.log("ok: image upload size, IMAGE detection, state isolation, and bounded retry contracts");
