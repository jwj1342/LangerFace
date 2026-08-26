import assert from "node:assert/strict";
import fs from "node:fs";

import {
  fromWrinkleWorkingPoint,
  toWrinkleWorkingPoint,
} from "../web/src/services/liveWrinkleMath.ts";
import { runGeneralLiveWrinklePipeline } from
  "../web/src/services/personalized/liveWrinklePipeline.ts";
import { V6_RSTL_ALGORITHM } from
  "../web/src/services/personalized/v6RstlRefinementV9.ts";
import { LATEST_WRINKLE_REFINEMENT_PROFILE } from
  "../web/src/services/personalized/v9RstlRefinementProfile.ts";
import {
  YoloWrinkleOnnx,
  YOLO_WRINKLE_ONNX_VERSION,
} from "../web/src/services/personalized/yoloWrinkleOnnx.ts";
import { buildPrecomputedFineWrinkleEvidence } from "../web/src/services/personalized/precomputedFineWrinkleEvidence.ts";

const waitUntil = async (predicate: () => boolean, message: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
};

const emptyYoloOutputs = () => ({
  prediction: {
    dims: [1, 39, 1],
    data: new Float32Array(39),
    dispose() {},
  },
  prototype: {
    dims: [1, 32, 1, 1],
    data: new Float32Array(32),
    dispose() {},
  },
});

class FakeTensor {
  data: Float32Array;
  dims: readonly number[];

  constructor(_type: string, data: Float32Array, dims: readonly number[]) {
    this.data = data;
    this.dims = dims;
  }

  dispose(): void {}
}

const transform = { scale: 0.5, offsetX: 12, offsetY: 38 };
const sourcePoint = [320, 180] as const;
const workingPoint = toWrinkleWorkingPoint(sourcePoint, transform);
assert.deepEqual(workingPoint, [172, 128]);
assert.deepEqual(fromWrinkleWorkingPoint(workingPoint, transform), sourcePoint);

const panel = fs.readFileSync(
  new URL("../web/src/components/LiveWrinklePanel.tsx", import.meta.url),
  "utf8",
);
assert.match(panel, /只显示 RSTL/);
assert.match(panel, /只显示皱纹/);
assert.match(panel, /RSTL 与皱纹同时显示/);
assert.match(panel, /皱纹引导自动微调/);
assert.match(panel, /医生手动微调（2D）/);

const runtime = fs.readFileSync(
  new URL("../web/src/services/liveRuntime.ts", import.meta.url),
  "utf8",
);
assert.match(runtime, /analyzeCurrentWrinkles/);
assert.match(runtime, /applyWrinkleGuidedRefinement/);
assert.doesNotMatch(runtime, /if \(!isRefineActive\(\)\) toggleRefine2d\(\)/);
assert.match(runtime, /beginFrozenRefineSession\(\)/,
  "every frozen frame must start a fresh geometry session");
assert.match(runtime, /function handleTemplateChange[\s\S]*resetRefineForNewSource\(\);[\s\S]*resetLiveWrinkleAnalysis\(\);/,
  "changing the atlas must invalidate refinement and wrinkle results from the previous geometry");
assert.doesNotMatch(runtime, /preloadLiveWrinkleModel|scheduleWrinkleModelPreload|requestIdleCallback/,
  "the 47 MB wrinkle model must remain lazy until the user requests wrinkle detection");

const pipelineSource = fs.readFileSync(
  new URL("../web/src/services/pipelineSource.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(pipelineSource, /sourceSha256|crypto\.subtle\.digest\(\s*"SHA-256"/,
  "the shared upload path must not hash every image for one experiment sample");
assert.doesNotMatch(pipelineSource, /sourceFile/,
  "the shared upload path must not retain files for controlled-image branching");

const renderRuntime = fs.readFileSync(
  new URL("../web/src/services/render2d.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(renderRuntime, /WRINKLE_PHOTO_SHA256|sourceSpecificForeheadVisible/,
  "the shared RSTL renderer must not switch geometry visibility for one image hash");
assert.match(renderRuntime, /ln\.hiddenPointRuns\?\.some/,
  "the deployed renderer must honor the latest nose-root intersection visibility gaps");

const refineRuntime = fs.readFileSync(
  new URL("../web/src/services/liveRefine2d.ts", import.meta.url),
  "utf8",
);
assert.match(refineRuntime, /s\.liveBaselineLines \|\| s\.latestAutoLines/,
  "live transport must use the standard frozen-frame baseline when wrinkle guidance replaces the reset baseline");
assert.match(refineRuntime, /s\.liveBaselineLines = null;[\s\S]*s\.selected = null;[\s\S]*s\.dirty = false;/,
  "a later freeze must discard stale baseline geometry and manual state");

const analysisRuntime = fs.readFileSync(
  new URL("../web/src/services/liveWrinkleAnalysis.ts", import.meta.url),
  "utf8",
);
assert.match(analysisRuntime, /delegate: "CPU"/,
  "single-frame refinement must use deterministic CPU landmarks");
assert.match(analysisRuntime, /runningMode: "IMAGE"/,
  "single-frame refinement must not reuse the live VIDEO detector");
assert.match(analysisRuntime, /outputFaceBlendshapes: false/);
assert.match(analysisRuntime, /detectV9ReferenceLandmarks/,
  "v9 refinement must remap the atlas from the dedicated reference landmarks");
assert.match(analysisRuntime, /expandForehead: RSTL_STANDARD_CONTRACT\.expandForehead/,
  "live wrinkle refinement must use the same v8.1.96 forehead mapping as the experiment");
assert.match(analysisRuntime, /from "\.\/personalized\/v6RstlRefinementV9\.ts"/,
  "the deployed live page must execute the latest V9 refinement implementation");
assert.match(analysisRuntime,
  /onnxruntime-web\/dist\/ort-wasm-simd-threaded\.mjs\?url/,
  "the deployed live page must bundle the ONNX Runtime WASM module explicitly");
assert.match(analysisRuntime,
  /onnxruntime-web\/dist\/ort-wasm-simd-threaded\.wasm\?url/,
  "the deployed live page must bundle the ONNX Runtime WASM binary explicitly");
assert.match(analysisRuntime,
  /wasmPaths:\s*\{\s*mjs:\s*ortWasmModuleUrl,\s*wasm:\s*ortWasmBinaryUrl\s*\}/,
  "the deployed detector must use the bundled ONNX Runtime WASM assets");
assert.doesNotMatch(analysisRuntime,
  /WRINKLE_PHOTO_SHA256|canonicalWrinkleV10Evidence|wrinkleV10FineLinesUrl|buildPrecomputedFineWrinkleEvidence|wrinkle-v10|DIRECT_NOSE_DORSUM_FINE_LINE_IDS/,
  "the released live path must never select precomputed evidence for one image");
assert.match(analysisRuntime, /runGeneralLiveWrinklePipeline\(\{/,
  "the deployed live page must route every source through the general detector pipeline");
assert.match(analysisRuntime, /onEvidence:[\s\S]*state\.evidenceLines = evidence\.lines\.map[\s\S]*assertRefinementGate/,
  "validated wrinkle evidence must be committed before refinement safety gates run");
assert.doesNotMatch(analysisRuntime, /bundlePropagation: true/,
  "live refinement must not propagate one wrinkle to neighboring RSTL curves");
assert.match(analysisRuntime, /maximum_selected_rstl_curves_per_wrinkle\) > 2/,
  "the V9 live safety gate must reject more than the intended bilateral assignment");
assert.match(analysisRuntime, /bundle_follower_moved_curve_count \|\| 0\) > 0/,
  "the live safety gate must reject bundle follower movement");
assert.match(analysisRuntime, /if \(state\.evidenceLines\.length > 0\)[\s\S]*updateStatus\("evidence", message\)/,
  "a rejected refinement must retain wrinkle evidence and report a non-fatal evidence state");
assert.match(analysisRuntime, /await Promise\.allSettled\(\[\.\.\.activeAnalyses\]\);[\s\S]*await current\?\.close\(\)/,
  "route disposal must wait for active model work before releasing the ONNX session");
assert.match(analysisRuntime, /assertCurrent:[\s\S]*generation !== state\.generation/,
  "a source generation change must reject stale pipeline results");

const generalPipelineRuntime = fs.readFileSync(
  new URL("../web/src/services/personalized/liveWrinklePipeline.ts", import.meta.url),
  "utf8",
);
assert.match(generalPipelineRuntime,
  /await detector\.load[\s\S]*await detector\.detect[\s\S]*extractFineWrinkleLines[\s\S]*refineV6/,
  "the general pipeline must execute detector, centerline extraction and V9 refinement in order");
assert.doesNotMatch(generalPipelineRuntime,
  /WRINKLE_PHOTO_SHA256|wrinkle_fine_lines_v10_wrinkle|PrecomputedFineWrinkle/,
  "the general pipeline API must not accept controlled precomputed evidence");

{
  const size = 64;
  const markers: number[] = [];
  let loadCalls = 0;
  let detectCalls = 0;
  const detector = {
    async load() { loadCalls += 1; },
    async detect(imageData: ImageData) {
      detectCalls += 1;
      const marker = Number(imageData.data[0]);
      markers.push(marker);
      const forehead = new Uint8Array(size * size);
      const y = marker === 1 ? 22 : 30;
      for (let x = 5; x <= 58; x += 1) forehead[y * size + x] = 1;
      return {
        version: YOLO_WRINKLE_ONNX_VERSION,
        classMasks: {
          forehead,
          frown: new Uint8Array(size * size),
          wrinkle: new Uint8Array(size * size),
        },
      };
    },
  };
  const seeds = [{
    name: "general-live-test-curve",
    region: "forehead",
    pts: Array.from({ length: 12 }, (_, index) => [5 + index * 5, 26]),
  }];
  const makeImageData = (marker: number) => ({
    width: size,
    height: size,
    data: Uint8ClampedArray.from({ length: size * size * 4 }, (_, index) =>
      index === 0 ? marker : 0),
  }) as ImageData;

  const first = await runGeneralLiveWrinklePipeline({
    detector,
    imageData: makeImageData(1),
    seeds,
    size,
    faceWidthPx: 52,
  });
  const second = await runGeneralLiveWrinklePipeline({
    detector,
    imageData: makeImageData(2),
    seeds,
    size,
    faceWidthPx: 52,
  });
  assert.equal(loadCalls, 2, "every input must enter the detector pipeline");
  assert.equal(detectCalls, 2, "every input must run inference rather than reuse an answer");
  assert.deepEqual(markers, [1, 2], "the detector must receive each distinct input image");
  assert.equal(first.evidence.lines.length, 1);
  assert.equal(second.evidence.lines.length, 1);
  assert.notDeepEqual(first.evidence.lines[0].points, second.evidence.lines[0].points,
    "different detector masks must produce different extracted centerlines");
  assert.equal(first.refined.diagnostics.algorithm, V6_RSTL_ALGORITHM);
  assert.equal(second.refined.diagnostics.algorithm, V6_RSTL_ALGORITHM);
  assert.equal(first.refinementProfile, LATEST_WRINKLE_REFINEMENT_PROFILE);
  assert.equal(second.refinementProfile, LATEST_WRINKLE_REFINEMENT_PROFILE);
}

{
  // The helper and checked-in evidence remain available to the explicit
  // single-image compat experiment; this block does not authorize live-page use.
  const payload = JSON.parse(fs.readFileSync(
    new URL("../web/assets/wrinkle_fine_lines_v10_wrinkle.json", import.meta.url),
    "utf8",
  ));
  const evidence = buildPrecomputedFineWrinkleEvidence(
    payload,
    1254,
    "1c6a677ea8aa2ebccd871ea39a7507ae64d9f64e83b03c389f6b18854fae5458",
  );
  assert.equal(evidence.lines.length, 26, "the canonical v10 evidence must preserve all centerlines");
  assert.ok(evidence.rasterPixelCount > 0);
  assert.throws(() => buildPrecomputedFineWrinkleEvidence(payload, 1254, "different-image"),
    /different image/, "precomputed evidence cannot be reused for another image hash");
}

{
  let fetchCalls = 0;
  let createCalls = 0;
  let releaseCalls = 0;
  let releaseFetch!: () => void;
  let releaseFirstSession!: () => void;
  const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
  const firstSessionReleaseGate = new Promise<void>((resolve) => { releaseFirstSession = resolve; });
  const progressA: number[] = [];
  const progressB: number[] = [];
  const runtime = {
    Tensor: FakeTensor,
    InferenceSession: {
      async create() {
        const sessionNumber = ++createCalls;
        return {
          inputNames: ["images"],
          async run() { return emptyYoloOutputs(); },
          async release() {
            releaseCalls += 1;
            if (sessionNumber === 1) await firstSessionReleaseGate;
          },
        };
      },
    },
  };
  const model = new YoloWrinkleOnnx({
    chunkUrls: ["model-part"],
    expectedModelBytes: 4,
    verifySha256: false,
    runtime,
    fetchImpl: (async () => {
      fetchCalls += 1;
      await fetchGate;
      return {
        ok: true,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      } as Response;
    }) as typeof fetch,
  });

  const firstLoad = model.load((progress) => progressA.push(progress.loadedChunks));
  const duplicateLoad = model.load((progress) => progressB.push(progress.loadedChunks));
  await waitUntil(() => fetchCalls === 1, "the shared model load should start once");
  releaseFetch();
  await Promise.all([firstLoad, duplicateLoad]);
  assert.equal(fetchCalls, 1, "concurrent loads fetch the model once");
  assert.equal(createCalls, 1, "concurrent loads create one ONNX session");
  assert.deepEqual(progressA, [1]);
  assert.deepEqual(progressB, [1], "all active source generations receive shared load progress");

  const closing = model.close();
  await waitUntil(() => releaseCalls === 1, "close should release the active session");
  const reloadAfterClose = model.load();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(createCalls, 1, "a load during close waits for session release");
  releaseFirstSession();
  await Promise.all([closing, reloadAfterClose]);
  assert.equal(createCalls, 2, "loading after close creates exactly one replacement session");
  assert.equal(fetchCalls, 2, "closed sessions do not leave a permanent model-load cache");
  await model.close();
  assert.equal(releaseCalls, 2);
}

{
  const releases: Array<() => void> = [];
  let activeRuns = 0;
  let maximumActiveRuns = 0;
  let sessionReleases = 0;
  const session = {
    inputNames: ["images"],
    async run() {
      activeRuns += 1;
      maximumActiveRuns = Math.max(maximumActiveRuns, activeRuns);
      await new Promise<void>((resolve) => releases.push(resolve));
      activeRuns -= 1;
      return emptyYoloOutputs();
    },
    async release() { sessionReleases += 1; },
  };
  const model = new YoloWrinkleOnnx({
    inputSize: 2,
    verifySha256: false,
    runtime: { Tensor: FakeTensor, InferenceSession: { async create() { return session; } } },
    session,
  });
  const imageData = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(16),
  } as ImageData;
  let sourceGeneration = 0;
  const committed: string[] = [];
  const analyze = async (source: string) => {
    const generation = ++sourceGeneration;
    await model.detect(imageData);
    if (generation === sourceGeneration) committed.push(source);
  };

  const staleAnalysis = analyze("old-source");
  await waitUntil(() => releases.length === 1, "the old source should enter inference");
  sourceGeneration += 1; // Immediate source replacement/reset.
  const freshAnalysis = analyze("new-freeze");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 1, "a new freeze cannot run concurrently on the same session");
  releases[0]();
  await waitUntil(() => releases.length === 2, "the new freeze should run after stale inference finishes");
  const closing = model.close();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(sessionReleases, 0, "route disposal cannot release a session during inference");
  releases[1]();
  await Promise.all([staleAnalysis, freshAnalysis, closing]);
  assert.equal(maximumActiveRuns, 1, "ONNX session.run calls remain serialized across sources");
  assert.equal(sessionReleases, 1, "the session is released once after queued inference completes");
  assert.deepEqual(committed, ["new-freeze"], "only the current source owns the inference result");
}

console.log("single-frame wrinkle display and refinement tests passed");
