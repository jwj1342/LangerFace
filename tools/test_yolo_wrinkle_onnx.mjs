import assert from "node:assert/strict";

import {
  DEFAULT_MODEL_CHUNK_URLS,
  WrinkleYoloOnnx,
  YoloWrinkleOnnx,
  applyAnatomicalGates,
  boxIou,
  classAwareNms,
  combinePrototypeMasks,
  decodePrototypeMask,
  decodeYoloSegOutput,
  estimateSkeletonDirections,
  fetchBinaryChunks,
  filterConnectedComponents,
  fuseStrictUnion,
  preprocessImageData,
  skeletonizeBinary,
} from "../web/src/services/personalized/yoloWrinkleOnnx.ts";

assert.equal(DEFAULT_MODEL_CHUNK_URLS.length, 4);
assert.ok(DEFAULT_MODEL_CHUNK_URLS.every((url) => /\.onnx\.part0[0-3]$/.test(url)));
assert.equal(WrinkleYoloOnnx, YoloWrinkleOnnx);
assert.equal(typeof YoloWrinkleOnnx.prototype.detect, "function");

{
  const responses = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
  let call = 0;
  const bytes = await fetchBinaryChunks(["part0", "part1"], {
    expectedBytes: 5,
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => responses[call++].buffer }),
  });
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
}

{
  const first = {
    width: 2, height: 2,
    skeleton: new Uint8Array([1, 0, 1, 0]),
    binaryMask: new Uint8Array([1, 1, 1, 0]),
    confidence: new Float32Array([0.2, 0, 0.7, 0]),
    denseConfidence: new Float32Array([0.2, 0.3, 0.7, 0]),
    classMasks: { forehead: new Uint8Array([1, 1, 0, 0]) },
    directionQ: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]),
    directionConsistency: new Float32Array([1, 0, 1, 0]),
  };
  const second = {
    width: 2, height: 2,
    mask: new Uint8Array([0, 255, 255, 0]),
    confidence: new Float32Array([0, 0.8, 0.5, 0]),
    directionQ: new Float32Array([0, 0, 0, 1, -1, 0, 0, 0]),
    directionConsistency: new Float32Array([0, 1, 1, 0]),
  };
  const fused = fuseStrictUnion([first, second]);
  assert.deepEqual([...fused.mask], [255, 255, 255, 0], "union never drops single-expression evidence");
  assert.deepEqual([...fused.support], [1, 2, 2, 0]);
  assert.equal(fused.classMasks.forehead[1], 1, "semantic class masks survive strict union");
  assert.ok(Math.abs(fused.confidence[2] - 0.7) < 1e-6, "confidence uses a maximum");
  assert.ok(fused.directionConsistency[2] < 0.2, "opposite axial evidence lowers consistency");
  assert.equal(fused.fusionOperation, "strict_union");
}

{
  const width = 18, height = 12, pixels = width * height;
  const makeParallel = (row, confidenceValue) => {
    const skeleton = new Uint8Array(pixels);
    const binaryMask = new Uint8Array(pixels);
    const confidence = new Float32Array(pixels);
    const directionQ = new Float32Array(pixels * 2);
    const directionConsistency = new Float32Array(pixels);
    for (let x = 3; x <= 14; x++) {
      const index = row * width + x;
      skeleton[index] = 1;
      binaryMask[index] = 1;
      confidence[index] = confidenceValue;
      directionQ[index * 2] = 1;
      directionConsistency[index] = 1;
    }
    return { width, height, skeleton, binaryMask, confidence, directionQ, directionConsistency };
  };
  const fused = fuseStrictUnion([makeParallel(5, 0.8), makeParallel(7, 0.6)], {
    width, height, consolidationRadiusPx: 3, consolidationDirectionToleranceDegrees: 28,
  });
  assert.equal(fused.mask.reduce((sum, value) => sum + (value ? 1 : 0), 0), 24,
    "exact cross-expression union remains untouched for auditing");
  assert.equal(fused.consolidatedSkeleton.reduce((sum, value) => sum + value, 0), 12,
    "nearby parallel copies collapse to the stronger centerline");
  assert.equal(fused.consolidatedSkeleton[7 * width + 8], 0,
    "weaker displaced duplicate is removed");
  assert.ok(fused.consolidationDiagnostics.removedParallelPixels >= 12);
}

{
  const image = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]),
  };
  const prepared = preprocessImageData(image, 4);
  assert.deepEqual(prepared.dims, [1, 3, 4, 4]);
  assert.deepEqual(
    [prepared.transform.resizedWidth, prepared.transform.resizedHeight,
      prepared.transform.padX, prepared.transform.padY],
    [4, 2, 0, 1],
  );
  assert.ok(Math.abs(prepared.data[0] - 114 / 255) < 1e-6, "top letterbox row uses 114 padding");
  const firstImagePixel = 4; // first pixel of y=1 in the red NCHW plane
  assert.ok(prepared.data[firstImagePixel] > 0.99);
  assert.ok(prepared.data[16 + firstImagePixel] < 0.01);
}

{
  const channels = 8, anchors = 3;
  const data = new Float32Array(channels * anchors);
  const set = (channel, anchor, value) => { data[channel * anchors + anchor] = value; };
  // 4 boxes + 2 classes + 2 prototype coefficients.
  for (const [anchor, cx, score0, score1] of [[0, 20, 0.8, 0.1], [1, 21, 0.7, 0.2], [2, 80, 0.1, 0.9]]) {
    set(0, anchor, cx); set(1, anchor, 20); set(2, anchor, 20); set(3, anchor, 10);
    set(4, anchor, score0); set(5, anchor, score1);
    set(6, anchor, anchor + 1); set(7, anchor, -(anchor + 1));
  }
  const transform = {
    inputSize: 100, sourceWidth: 50, sourceHeight: 50,
    padX: 0, padY: 0, scaleX: 2, scaleY: 2,
  };
  const decoded = decodeYoloSegOutput({ dims: [1, channels, anchors], data }, transform, {
    classCount: 2, maskChannels: 2, confidenceThreshold: 0.07,
  });
  assert.equal(decoded.length, 3);
  assert.equal(decoded[0].classId, 0);
  assert.deepEqual(decoded[0].box, [5, 7.5, 15, 12.5]);
  assert.deepEqual([...decoded[2].coefficients], [3, -3]);
  const kept = classAwareNms(decoded, 0.4, 10);
  assert.equal(kept.length, 2, "same-class overlap is suppressed while another class remains");
  assert.deepEqual(kept.map((item) => item.classId).sort(), [0, 1]);
}

assert.equal(boxIou([0, 0, 10, 10], [0, 0, 10, 10]), 1);
assert.equal(boxIou([0, 0, 2, 2], [3, 3, 4, 4]), 0);

{
  const prototype = new Float32Array([
    1, 1, -1, -1,
    1, -1, 1, -1,
  ]);
  const mask = decodePrototypeMask(prototype, new Float32Array([1, 1]), 2, 2, 2);
  assert.ok(mask[0] > 0.87);
  assert.ok(Math.abs(mask[1] - 0.5) < 1e-6);
  assert.ok(mask[3] < 0.13);
}

{
  const prototype = { dims: [1, 1, 2, 2], data: new Float32Array([4, 4, 4, -4]) };
  const detections = [{
    classId: 1, score: 0.8, box: [0, 0, 2, 2], modelBox: [0, 0, 2, 2],
    coefficients: new Float32Array([1]),
  }];
  const combined = combinePrototypeMasks(detections, prototype, {
    inputSize: 2, sourceWidth: 2, sourceHeight: 2,
    padX: 0, padY: 0, scaleX: 1, scaleY: 1,
  });
  assert.deepEqual([...combined.binaryMask], [1, 1, 1, 0]);
  assert.deepEqual([...combined.classMasks[1]], [1, 1, 1, 0]);
  assert.ok(combined.confidence[0] > 0.78 && combined.confidence[3] === 0);
}

{
  const width = 12, height = 8, binary = new Uint8Array(width * height);
  const confidence = new Float32Array(width * height).fill(0.8);
  for (let x = 1; x <= 9; x++) binary[4 * width + x] = 1;
  binary[0] = 1; // short noise component
  const skin = new Uint8Array(width * height).fill(1);
  const forbidden = new Uint8Array(width * height);
  forbidden[4 * width + 5] = 1;
  const gated = applyAnatomicalGates(binary, confidence, width, height, {
    skinMask: skin, forbiddenMask: forbidden,
  });
  assert.equal(gated.mask[4 * width + 5], 0);
  assert.equal(gated.confidence[4 * width + 5], 0);

  // Test filtering without the deliberate gap introduced by the gate.
  const filtered = filterConnectedComponents(binary, width, height, { minArea: 4, minSpan: 6 });
  assert.equal(filtered[0], 0);
  assert.equal(filtered[4 * width + 4], 1);
  const ungated = applyAnatomicalGates(binary, confidence, width, height);
  assert.deepEqual([...ungated.mask], [...binary], "omitted optional gates preserve evidence");

  const regionGate = new Float32Array(width * height).fill(1);
  regionGate[4 * width + 4] = 0.1;
  regionGate[4 * width + 6] = 0.5;
  const regionGated = applyAnatomicalGates(binary, confidence, width, height, {
    regionGate, regionGateThreshold: 0.18,
  });
  assert.equal(regionGated.mask[4 * width + 4], 0, "expression region gate rejects unrelated anatomy");
  assert.equal(regionGated.mask[4 * width + 6], 1, "expression region gate retains expected anatomy");
  assert.ok(Math.abs(regionGated.confidence[4 * width + 6] - 0.4) < 1e-6,
    "region confidence softly weights retained evidence");
}

{
  const width = 15, height = 9, thick = new Uint8Array(width * height);
  for (let y = 3; y <= 5; y++) for (let x = 2; x <= 12; x++) thick[y * width + x] = 1;
  const skeleton = skeletonizeBinary(thick, width, height);
  const thickCount = thick.reduce((sum, value) => sum + value, 0);
  const skeletonCount = skeleton.reduce((sum, value) => sum + value, 0);
  assert.ok(skeletonCount > 5 && skeletonCount < thickCount / 2, "thick ribbon becomes a centerline");
  const confidence = new Float32Array(width * height).fill(1);
  const direction = estimateSkeletonDirections(skeleton, confidence, width, height, 5);
  const middle = 4 * width + 7;
  assert.ok(direction.consistency[middle] > 0.8);
  assert.ok(direction.q[middle * 2] > 0.8, "horizontal line has q close to (1,0)");
  assert.ok(Math.abs(direction.q[middle * 2 + 1]) < 0.2);
}

console.log("YOLO wrinkle ONNX pure helper tests passed");
