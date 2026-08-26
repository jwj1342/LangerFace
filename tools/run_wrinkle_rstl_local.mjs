#!/usr/bin/env node

/**
 * Browser-free local runner for the checked-in single-image experiment.
 *
 * The YOLO stage is executed with the same onnxruntime-web WASM runtime and
 * model chunks used by the browser. The v8.1.96/V9 geometry is replayed from
 * the frozen, contract-checked artifact because FaceLandmarker and canvas
 * rasterization are browser assets; the runner verifies the live YOLO output
 * before emitting that exact artifact.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectRoot = resolve(scriptRoot, "..");
const webRoot = resolve(scriptRoot, "web");
const sourcePath = resolve(process.env.WRINKLE_LOCAL_INPUT || resolve(projectRoot, "langer线-cc/wrinkle.png"));
const frozenDir = resolve(
  process.env.WRINKLE_LOCAL_BASELINE ||
    resolve(projectRoot, "langer线-cc/wrinkle_rstl_crows_feet_bundle_v22_v9"),
);
const outputDir = resolve(
  process.env.WRINKLE_LOCAL_OUTPUT ||
    resolve(projectRoot, "langer线-cc/wrinkle_rstl_local_v8_1_96_v10_v9"),
);
const expectedSha256 = "1C6A677EA8AA2EBCCD871EA39A7507AE64D9F64E83B03C389F6B18854FAE5458";
const expectedDiagnostics = Object.freeze({
  candidateCount: 122,
  detectionCount: 17,
  componentPixels: 25941,
  skeletonPixels: 1861,
});

function fail(message) {
  throw new Error(`[wrinkle-local] ${message}`);
}

function decodePng(file) {
  const python = process.env.WRINKLE_LOCAL_PYTHON || "/opt/anaconda3/envs/longerface/bin/python";
  const result = spawnSync(python, [
    "-c",
    [
      "import sys",
      "from PIL import Image",
      "image = Image.open(sys.argv[1]).convert('RGBA')",
      "sys.stdout.buffer.write(f'{image.width} {image.height}\\n'.encode('ascii'))",
      "sys.stdout.buffer.write(image.tobytes())",
    ].join(";"),
    file,
  ], { maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) fail(`无法解码 PNG：${result.stderr.toString().trim()}`);
  const headerEnd = result.stdout.indexOf(10);
  if (headerEnd < 0) fail("PNG 解码器没有返回尺寸");
  const [width, height] = result.stdout.subarray(0, headerEnd).toString("ascii")
    .split(" ").map(Number);
  const pixels = result.stdout.subarray(headerEnd + 1);
  if (!(width > 0 && height > 0) || pixels.length !== width * height * 4) {
    fail(`PNG 像素尺寸异常：${width}x${height}, ${pixels.length} bytes`);
  }
  return { width, height, data: new Uint8ClampedArray(pixels) };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function fileFetch() {
  return async (url) => {
    const value = String(url);
    if (!value.startsWith("file:")) return fetch(url);
    return new Response(await readFile(new URL(value)), { status: 200 });
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} 不一致：实际 ${actual}，期望 ${expected}`);
}

function assertClose(actual, expected, label, tolerance = 1e-5) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    fail(`${label} 不一致：实际 ${actual}，期望 ${expected}（容差 ${tolerance}）`);
  }
}

const inputBytes = await readFile(sourcePath);
const sourceSha256 = sha256(inputBytes);
assertEqual(sourceSha256, expectedSha256, "输入图片 SHA-256");
if (!existsSync(frozenDir)) fail(`冻结基线目录不存在：${frozenDir}`);
if (existsSync(outputDir)) fail(`拒绝覆盖已有输出目录：${outputDir}`);

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const value = String(url);
  if (value.startsWith("file:")) return new Response(await readFile(new URL(value)), { status: 200 });
  return nativeFetch(url, options);
};
globalThis.ImageData = class ImageDataPolyfill {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};

const ort = await import("../web/node_modules/onnxruntime-web/dist/ort.wasm.mjs");
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
const { YoloWrinkleOnnx } = await import("../web/src/services/personalized/yoloWrinkleOnnx.ts");
const image = decodePng(sourcePath);
const chunkUrls = [0, 1, 2, 3].map((index) =>
  `file://${resolve(webRoot, `compat/personalized/model/wrinkle-yolov8s-seg-640.onnx.part0${index}`)}`);
const wasmPaths = {
  mjs: `file://${resolve(webRoot, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs")}`,
  wasm: `file://${resolve(webRoot, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm")}`,
};
const model = new YoloWrinkleOnnx({
  chunkUrls,
  wasmPaths,
  runtime: ort,
  fetchImpl: fileFetch(),
  persistentCache: false,
  verifySha256: true,
});
const startedAt = Date.now();
await model.load();
const detection = await model.detect(new ImageData(image.data, image.width, image.height));
await model.close();
for (const [key, expected] of Object.entries(expectedDiagnostics)) {
  assertEqual(detection.diagnostics[key], expected, `YOLO diagnostics.${key}`);
}

const baselineEvidence = JSON.parse(await readFile(resolve(frozenDir, "wrinkle_yolo_evidence.json"), "utf8"));
assertEqual(baselineEvidence.sourceImage.sha256, sourceSha256, "冻结证据 sourceImage.sha256");
assertEqual(baselineEvidence.diagnostics.detectionCount, detection.diagnostics.detectionCount,
  "冻结证据 detectionCount");
assertEqual(baselineEvidence.diagnostics.componentPixels, detection.diagnostics.componentPixels,
  "冻结证据 componentPixels");
assertEqual(baselineEvidence.diagnostics.skeletonPixels, detection.diagnostics.skeletonPixels,
  "冻结证据 skeletonPixels");
assertEqual(detection.detections.length, baselineEvidence.detections.length, "冻结证据 detections.length");
for (const [index, actual] of detection.detections.entries()) {
  const expected = baselineEvidence.detections[index];
  assertEqual(actual.classId, expected.classId, `检测 ${index} classId`);
  assertClose(actual.score, expected.score, `检测 ${index} score`);
  for (const [coordinate, value] of actual.box.entries()) {
    assertClose(value, expected.box[coordinate], `检测 ${index} box[${coordinate}]`);
  }
}

await mkdir(outputDir, { recursive: false });
const artifactNames = [
  "01_prior_rstl.png", "02_wrinkle_evidence.png", "03_match_decisions.png",
  "04_refined_rstl.png", "05_before_after.png", "06_displacement_audit.png",
  "07_nose_root_visibility_audit.png", "08_nose_root_before_visibility.png",
  "09_nose_root_after_visibility.png", "wrinkle_yolo_evidence.json",
  "wrinkle_rstl_refinement.json", "personalized_rstl_atlas.json",
];
for (const name of artifactNames) await copyFile(resolve(frozenDir, name), resolve(outputDir, name));

const refinement = JSON.parse(await readFile(resolve(outputDir, "wrinkle_rstl_refinement.json"), "utf8"));
const atlas = JSON.parse(await readFile(resolve(outputDir, "personalized_rstl_atlas.json"), "utf8"));
assertEqual(refinement.prior.atlasVersion, "8.1.96", "RSTL prior atlasVersion");
assertEqual(refinement.parameters.mode, "v10_three_region_guided_direct_nose_v7_2", "V9 微调模式");
assertEqual(atlas.lines.length, 207, "个性化 atlas 曲线数");

const manifest = {
  schemaVersion: "langerface.wrinkle-local-run.v1",
  validated: true,
  localOnly: true,
  sourceImage: { filename: sourcePath.split("/").pop(), sha256: sourceSha256, width: image.width, height: image.height },
  runtime: {
    yolo: "onnxruntime-web/wasm 1.27.0",
    modelSha256: baselineEvidence.model.onnx_sha256,
    modelBytes: baselineEvidence.model.onnx_bytes,
    confidenceThreshold: baselineEvidence.model.confidence,
    elapsedMs: Date.now() - startedAt,
  },
  stages: {
    rstlGeneration: "frozen v8.1.96 single-image prior",
    wrinkleDetection: "YOLOv8-seg paired-edge-v10 runtime inference",
    wrinkleGuidedRefinement: "V9 v10_three_region_guided_direct_nose_v7_2",
  },
  exactMatch: {
    yoloDiagnostics: detection.diagnostics,
    frozenBaseline: frozenDir,
    geometryArtifactReplay: true,
    note: "FaceLandmarker/canvas-dependent v8.1.96 geometry is replayed from the checked-in browser artifact after live YOLO verification.",
  },
  outputs: artifactNames,
};
await writeFile(resolve(outputDir, "local_run_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  outputDir,
  sourceSha256,
  elapsedMs: manifest.runtime.elapsedMs,
  yolo: detection.diagnostics,
  refinement: refinement.summary,
  atlasCurves: atlas.lines.length,
}, null, 2));
