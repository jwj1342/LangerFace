#!/usr/bin/env node

/**
 * Checkout/deployment guard for the released wrinkle pipeline. Version checks
 * use imported runtime values, while the behavior probe proves that an input
 * reaches detection, centerline extraction and V9 refinement.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runGeneralLiveWrinklePipeline } from
  "../web/src/services/personalized/liveWrinklePipeline.ts";
import { V6_RSTL_ALGORITHM } from
  "../web/src/services/personalized/v6RstlRefinementV9.ts";
import { LATEST_WRINKLE_REFINEMENT_PROFILE } from
  "../web/src/services/personalized/v9RstlRefinementProfile.ts";
import { YOLO_WRINKLE_ONNX_VERSION } from
  "../web/src/services/personalized/yoloWrinkleOnnx.ts";
import {
  assertStandardRstlAtlas,
  RSTL_STANDARD_CONTRACT,
} from "../web/src/services/rstlStandardContract.ts";
import { WRINKLE_PIPELINE_VERSION } from
  "../web/src/services/wrinklePipelineVersion.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const paths = {
  live: resolve(root, "web/src/services/liveWrinkleAnalysis.ts"),
  pipeline: resolve(root, "web/src/services/personalized/liveWrinklePipeline.ts"),
  worker: resolve(root, "web/src/workers/liveWrinklePipeline.worker.ts"),
  workerClient: resolve(root, "web/src/services/personalized/liveWrinklePipelineWorkerClient.ts"),
  localDetector: resolve(root, "tools/run_live_four_region_wrinkle.py"),
  runtime: resolve(root, "web/src/services/personalized/personalizedRuntime.ts"),
  experiment: resolve(root, "web/compat/personalized/wrinkleRstlExperiment.ts"),
  atlas: resolve(root, "web/assets/atlas_rstl.json"),
};
const [live, pipeline, worker, workerClient, localDetector, runtime, experiment, atlasText] = await Promise.all([
  readFile(paths.live, "utf8"),
  readFile(paths.pipeline, "utf8"),
  readFile(paths.worker, "utf8"),
  readFile(paths.workerClient, "utf8"),
  readFile(paths.localDetector, "utf8"),
  readFile(paths.runtime, "utf8"),
  readFile(paths.experiment, "utf8"),
  readFile(paths.atlas, "utf8"),
]);

const atlas = JSON.parse(atlasText);
assertStandardRstlAtlas(atlas);
assert.equal(WRINKLE_PIPELINE_VERSION.rstlAtlas, RSTL_STANDARD_CONTRACT.atlasVersion);
assert.equal(WRINKLE_PIPELINE_VERSION.wrinkleDetection,
  "paired-edge-v10-dynamic-four-region-1.0");
assert.equal(WRINKLE_PIPELINE_VERSION.baselineDetection, YOLO_WRINKLE_ONNX_VERSION);
assert.equal(WRINKLE_PIPELINE_VERSION.refinementProfile, LATEST_WRINKLE_REFINEMENT_PROFILE);
assert.equal(WRINKLE_PIPELINE_VERSION.refinementMode,
  "v10_four_region_guided_direct_nose_v9_7_2");
assert.equal(WRINKLE_PIPELINE_VERSION.executionThread, "web_worker");

const forbiddenLiveTokens = [
  "WRINKLE_PHOTO_SHA256",
  "canonicalWrinkleV10Evidence",
  "wrinkleV10FineLinesUrl",
  "wrinkle_fine_lines_v10_wrinkle",
  "DIRECT_NOSE_DORSUM_FINE_LINE_IDS",
];
for (const token of forbiddenLiveTokens) {
  assert.ok(!live.includes(token), `released live path contains controlled-image token: ${token}`);
  assert.ok(!pipeline.includes(token), `general pipeline contains controlled-image token: ${token}`);
  assert.ok(!worker.includes(token), `worker pipeline contains controlled-image token: ${token}`);
}
assert.match(live, /createLiveWrinklePipelineWorkerClient/);
assert.match(live, /wrinkleWorkerInstance\(\)\.analyze\(\{/);
assert.ok(!live.includes("runGeneralLiveWrinklePipeline"),
  "released live page must not execute the CPU-heavy pipeline on its own thread");
assert.match(worker,
  /detector\.detect[\s\S]*extractFineWrinkleLines[\s\S]*dynamicFourRegionDetection[\s\S]*refineV6/);
assert.match(worker, /\/api\/local-wrinkle-v10/);
assert.match(worker, /buildDirectNoseDorsumRstl/);
assert.match(worker, /buildNoseRootIntersectionVisibilityPlan/);
assert.match(worker, /Comlink\.expose\(api\)/);
assert.match(workerClient, /new Worker\(new URL/);
assert.match(workerClient, /Comlink\.transfer/);
assert.match(pipeline,
  /await detector\.load[\s\S]*await detector\.detect[\s\S]*extractFineWrinkleLines[\s\S]*refineV6/);
assert.match(runtime, /v6RstlRefinementV9\.ts/);
for (const region of ["forehead", "glabellar", "nasal_dorsum", "crow_feet"]) {
  assert.ok(localDetector.includes(`"${region}"`), `dynamic detector must include ${region}`);
}
assert.ok(!localDetector.includes("WRINKLE_PHOTO_SHA256"));
assert.match(experiment, /requestedRefinement !== "legacy"/);
assert.match(experiment, /wrinkle_fine_lines_v10_wrinkle\.json/,
  "v10 controlled evidence must remain available only to the explicit experiment");

const size = 64;
let loadCalls = 0;
let detectCalls = 0;
const forehead = new Uint8Array(size * size);
for (let x = 5; x <= 58; x += 1) forehead[24 * size + x] = 1;
const probe = await runGeneralLiveWrinklePipeline({
  detector: {
    async load() { loadCalls += 1; },
    async detect() {
      detectCalls += 1;
      return {
        version: YOLO_WRINKLE_ONNX_VERSION,
        classMasks: {
          forehead,
          frown: new Uint8Array(size * size),
          wrinkle: new Uint8Array(size * size),
        },
      };
    },
  },
  imageData: {
    width: size,
    height: size,
    data: new Uint8ClampedArray(size * size * 4),
  },
  seeds: [{
    name: "deployment-probe",
    region: "forehead",
    pts: Array.from({ length: 12 }, (_, index) => [5 + index * 5, 26]),
  }],
  size,
  faceWidthPx: 52,
});
assert.equal(loadCalls, 1);
assert.equal(detectCalls, 1);
assert.equal(probe.evidence.lines.length, 1);
assert.equal(probe.refined.diagnostics.algorithm, V6_RSTL_ALGORITHM);
assert.equal(probe.refinementProfile, LATEST_WRINKLE_REFINEMENT_PROFILE);

console.log(JSON.stringify({
  status: "latest_wrinkle_pipeline_verified",
  rstl: RSTL_STANDARD_CONTRACT.atlasVersion,
  detection: WRINKLE_PIPELINE_VERSION.wrinkleDetection,
  baselineDetection: YOLO_WRINKLE_ONNX_VERSION,
  refinement: LATEST_WRINKLE_REFINEMENT_PROFILE,
  executionThread: WRINKLE_PIPELINE_VERSION.executionThread,
  inputPolicy: "every_input_runs_dynamic_four_region_detection_and_refinement",
  controlledEvidenceScope: "compat_experiment_only",
}, null, 2));
