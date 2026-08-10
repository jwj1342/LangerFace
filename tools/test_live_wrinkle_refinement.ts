import assert from "node:assert/strict";
import fs from "node:fs";

import {
  fromWrinkleWorkingPoint,
  toWrinkleWorkingPoint,
} from "../web/src/services/liveWrinkleMath.ts";
import { YoloWrinkleOnnx } from "../web/src/services/personalized/yoloWrinkleOnnx.ts";

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
assert.match(analysisRuntime, /await Promise\.allSettled\(\[\.\.\.activeAnalyses\]\);[\s\S]*await current\?\.close\(\)/,
  "route disposal must wait for active model work before releasing the ONNX session");
assert.match(analysisRuntime, /const detection = await model\.detect[\s\S]*if \(generation !== state\.generation\) return;/,
  "a source generation change must reject stale inference results");

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
