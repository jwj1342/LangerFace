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
  runtime: resolve(root, "web/src/services/personalized/personalizedRuntime.ts"),
  experiment: resolve(root, "web/compat/personalized/wrinkleRstlExperiment.ts"),
  atlas: resolve(root, "web/assets/atlas_rstl.json"),
};
const [live, pipeline, runtime, experiment, atlasText] = await Promise.all([
  readFile(paths.live, "utf8"),
  readFile(paths.pipeline, "utf8"),
  readFile(paths.runtime, "utf8"),
  readFile(paths.experiment, "utf8"),
  readFile(paths.atlas, "utf8"),
]);

const atlas = JSON.parse(atlasText);
assertStandardRstlAtlas(atlas);
assert.equal(WRINKLE_PIPELINE_VERSION.rstlAtlas, RSTL_STANDARD_CONTRACT.atlasVersion);
assert.equal(WRINKLE_PIPELINE_VERSION.wrinkleDetection, YOLO_WRINKLE_ONNX_VERSION);
assert.equal(WRINKLE_PIPELINE_VERSION.refinementProfile, LATEST_WRINKLE_REFINEMENT_PROFILE);
assert.equal(WRINKLE_PIPELINE_VERSION.refinementMode, "general_yolo_v9_7_2");

const forbiddenLiveTokens = [
  "WRINKLE_PHOTO_SHA256",
  "canonicalWrinkleV10Evidence",
  "wrinkleV10FineLinesUrl",
  "buildPrecomputedFineWrinkleEvidence",
  "wrinkle-v10",
  "DIRECT_NOSE_DORSUM_FINE_LINE_IDS",
];
for (const token of forbiddenLiveTokens) {
  assert.ok(!live.includes(token), `released live path contains controlled-image token: ${token}`);
  assert.ok(!pipeline.includes(token), `general pipeline contains controlled-image token: ${token}`);
}
assert.match(live, /runGeneralLiveWrinklePipeline\(\{/);
assert.match(live, /onnxruntime-web\/dist\/ort-wasm-simd-threaded\.mjs\?url/,
  "released live path must bundle the ONNX Runtime WASM module explicitly");
assert.match(live, /onnxruntime-web\/dist\/ort-wasm-simd-threaded\.wasm\?url/,
  "released live path must bundle the ONNX Runtime WASM binary explicitly");
assert.match(live,
  /wasmPaths:\s*\{\s*mjs:\s*ortWasmModuleUrl,\s*wasm:\s*ortWasmBinaryUrl\s*\}/,
  "released detector must use the bundled ONNX Runtime WASM assets");
assert.match(pipeline,
  /await detector\.load[\s\S]*await detector\.detect[\s\S]*extractFineWrinkleLines[\s\S]*refineV6/);
assert.match(runtime, /v6RstlRefinementV9\.ts/);
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
  detection: YOLO_WRINKLE_ONNX_VERSION,
  refinement: LATEST_WRINKLE_REFINEMENT_PROFILE,
  inputPolicy: "every_input_runs_general_detection_and_refinement",
  controlledEvidenceScope: "compat_experiment_only",
}, null, 2));
