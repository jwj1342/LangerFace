import { ImageSegmenter } from "@mediapipe/tasks-vision";

import { assetUrl } from "./assetLoader.ts";
import { logWarn } from "./logger.ts";

export interface RstlPhotoHairMask {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  hair: Uint8Array;
  faceSkin: Uint8Array;
}

function expandedMask(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return input;
  const horizontal = new Uint8Array(input.length);
  const output = new Uint8Array(input.length);
  for (let y = 0; y < height; y++) {
    const prefix = new Int32Array(width + 1);
    for (let x = 0; x < width; x++) prefix[x + 1] = prefix[x] + input[y * width + x];
    for (let x = 0; x < width; x++) {
      const lo = Math.max(0, x - radius);
      const hi = Math.min(width, x + radius + 1);
      horizontal[y * width + x] = prefix[hi] > prefix[lo] ? 1 : 0;
    }
  }
  for (let x = 0; x < width; x++) {
    const prefix = new Int32Array(height + 1);
    for (let y = 0; y < height; y++) prefix[y + 1] = prefix[y] + horizontal[y * width + x];
    for (let y = 0; y < height; y++) {
      const lo = Math.max(0, y - radius);
      const hi = Math.min(height, y + radius + 1);
      output[y * width + x] = prefix[hi] > prefix[lo] ? 1 : 0;
    }
  }
  return output;
}

function contractedMask(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return input;
  const horizontal = new Uint8Array(input.length);
  const output = new Uint8Array(input.length);
  for (let y = 0; y < height; y++) {
    const prefix = new Int32Array(width + 1);
    for (let x = 0; x < width; x++) prefix[x + 1] = prefix[x] + (input[y * width + x] ? 0 : 1);
    for (let x = 0; x < width; x++) {
      const lo = Math.max(0, x - radius);
      const hi = Math.min(width, x + radius + 1);
      horizontal[y * width + x] = prefix[hi] === prefix[lo] ? 1 : 0;
    }
  }
  for (let x = 0; x < width; x++) {
    const prefix = new Int32Array(height + 1);
    for (let y = 0; y < height; y++) prefix[y + 1] = prefix[y] + (horizontal[y * width + x] ? 0 : 1);
    for (let y = 0; y < height; y++) {
      const lo = Math.max(0, y - radius);
      const hi = Math.min(height, y + radius + 1);
      output[y * width + x] = prefix[hi] === prefix[lo] ? 1 : 0;
    }
  }
  return output;
}

let segmenterPromise: Promise<ImageSegmenter> | null = null;
let generation = 0;
let pending = false;
let currentMask: RstlPhotoHairMask | null = null;

function loadSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = ImageSegmenter.createFromOptions({
      wasmLoaderPath: new URL("../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js", import.meta.url).href,
      wasmBinaryPath: new URL("../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm", import.meta.url).href,
    }, {
      baseOptions: { modelAssetPath: assetUrl("selfie_multiclass_256x256.tflite"), delegate: "CPU" },
      runningMode: "IMAGE",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    }).catch((error: unknown) => {
      segmenterPromise = null;
      throw error;
    });
  }
  return segmenterPromise;
}

export function buildRstlPhotoHairMask(
  labels: readonly string[],
  confidenceMasks: readonly Float32Array[],
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): RstlPhotoHairMask {
  const hairIndex = labels.indexOf("hair");
  const skinIndex = labels.indexOf("face-skin");
  const hairConfidence = confidenceMasks[hairIndex];
  const skinConfidence = confidenceMasks[skinIndex];
  const pixels = width * height;
  if (hairIndex < 0 || skinIndex < 0 || hairConfidence?.length !== pixels
      || skinConfidence?.length !== pixels) {
    throw new Error("RSTL hair segmenter returned an unexpected label or mask size");
  }
  const hair = new Uint8Array(pixels);
  const faceSkin = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index++) {
    const hairScore = hairConfidence[index];
    const skinScore = skinConfidence[index];
    // Require positive hair evidence over face skin; darkness never enters this decision.
    if (hairScore >= 0.48 && hairScore >= skinScore + 0.12) hair[index] = 1;
    // Semantic evidence avoids background/support objects without using brightness.
    let strongestOtherScore = 0;
    for (let labelIndex = 0; labelIndex < labels.length; labelIndex++) {
      if (labelIndex === skinIndex) continue;
      strongestOtherScore = Math.max(strongestOtherScore, confidenceMasks[labelIndex]?.[index] || 0);
    }
    if (skinScore >= 0.50 && skinScore >= strongestOtherScore + 0.10) faceSkin[index] = 1;
  }
  // Make the boundary conservative at the segmenter's resolution. The margin
  // is expressed in source pixels, so it scales consistently with any input.
  const sourceBoundaryPx = Math.max(8, Math.min(16, Math.round(Math.min(sourceWidth, sourceHeight) * 0.01)));
  const maskRadius = Math.max(1, Math.ceil(sourceBoundaryPx * width / sourceWidth));
  return {
    width,
    height,
    sourceWidth,
    sourceHeight,
    hair: expandedMask(hair, width, height, maskRadius),
    faceSkin: contractedMask(faceSkin, width, height, maskRadius),
  };
}

export function rstlPointOverHair(
  mask: RstlPhotoHairMask,
  x: number,
  y: number,
  sourceMarginPx = 0,
): boolean {
  const cx = Math.round(x * mask.width / mask.sourceWidth);
  const cy = Math.round(y * mask.height / mask.sourceHeight);
  const radiusX = Math.ceil(sourceMarginPx * mask.width / mask.sourceWidth);
  const radiusY = Math.ceil(sourceMarginPx * mask.height / mask.sourceHeight);
  for (let yy = Math.max(0, cy - radiusY); yy <= Math.min(mask.height - 1, cy + radiusY); yy++) {
    for (let xx = Math.max(0, cx - radiusX); xx <= Math.min(mask.width - 1, cx + radiusX); xx++) {
      if (mask.hair[yy * mask.width + xx]) return true;
    }
  }
  return false;
}

export function clipRstlRunToPhotoHair(
  points: readonly [number, number, number][],
  mask: RstlPhotoHairMask,
  sourceMarginPx: number,
  geometryVisible: (point: [number, number, number]) => boolean = () => true,
): [number, number, number][][] {
  const runs: [number, number, number][][] = [];
  let current: [number, number, number][] = [];
  const sampleStep = Math.min(2, mask.sourceWidth / mask.width, mask.sourceHeight / mask.height);
  const append = (point: [number, number, number]): void => {
    if (rstlPointOverHair(mask, point[0], point[1], sourceMarginPx)
        || !rstlPointOnFaceSkin(mask, point[0], point[1], 0)
        || !geometryVisible(point)) {
      if (current.length >= 2) runs.push(current);
      current = [];
    } else {
      current.push(point);
    }
  };
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (index === 0) {
      append(point);
      continue;
    }
    const previous = points[index - 1];
    const distance = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    const steps = Math.max(1, Math.ceil(distance / sampleStep));
    for (let step = 1; step <= steps; step++) {
      const fraction = step / steps;
      append([
        previous[0] + (point[0] - previous[0]) * fraction,
        previous[1] + (point[1] - previous[1]) * fraction,
        previous[2] + (point[2] - previous[2]) * fraction,
      ]);
    }
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

export function rstlPointOnFaceSkin(
  mask: RstlPhotoHairMask,
  x: number,
  y: number,
  sourceMarginPx = 0,
): boolean {
  const cx = Math.round(x * mask.width / mask.sourceWidth);
  const cy = Math.round(y * mask.height / mask.sourceHeight);
  const radiusX = Math.ceil(sourceMarginPx * mask.width / mask.sourceWidth);
  const radiusY = Math.ceil(sourceMarginPx * mask.height / mask.sourceHeight);
  if (sourceMarginPx <= 0) {
    let skin = 0;
    let total = 0;
    for (let yy = Math.max(0, cy - 1); yy <= Math.min(mask.height - 1, cy + 1); yy++) {
      for (let xx = Math.max(0, cx - 1); xx <= Math.min(mask.width - 1, cx + 1); xx++) {
        total++;
        skin += mask.faceSkin[yy * mask.width + xx] ? 1 : 0;
      }
    }
    return total > 0 && skin / total >= 0.65;
  }
  for (let yy = Math.max(0, cy - radiusY); yy <= Math.min(mask.height - 1, cy + radiusY); yy++) {
    for (let xx = Math.max(0, cx - radiusX); xx <= Math.min(mask.width - 1, cx + radiusX); xx++) {
      if (mask.faceSkin[yy * mask.width + xx]) return true;
    }
  }
  return false;
}

export function resetRstlPhotoHairOcclusion(): void {
  generation++;
  pending = false;
  currentMask = null;
}

export function rstlPhotoHairOcclusionPending(): boolean {
  return pending;
}

export function currentRstlPhotoHairMask(): RstlPhotoHairMask | null {
  return currentMask;
}

export function startRstlPhotoHairOcclusion(
  source: TexImageSource,
  sourceWidth: number,
  sourceHeight: number,
  onReady: () => void,
): void {
  const run = ++generation;
  currentMask = null;
  pending = true;
  void loadSegmenter().then((segmenter) => {
    if (run !== generation) return;
    const result = segmenter.segment(source);
    try {
      const masks = result.confidenceMasks;
      if (!masks?.length) throw new Error("RSTL hair segmenter returned no confidence masks");
      currentMask = buildRstlPhotoHairMask(
        segmenter.getLabels(),
        masks.map((mask) => mask.getAsFloat32Array()),
        masks[0].width,
        masks[0].height,
        sourceWidth,
        sourceHeight,
      );
    } finally {
      result.close();
    }
  }).catch((error: unknown) => {
    if (run === generation) logWarn("RSTL 照片毛发区域识别失败，回退到原有可见性规则。", error);
  }).finally(() => {
    if (run !== generation) return;
    pending = false;
    onReady();
  });
}
