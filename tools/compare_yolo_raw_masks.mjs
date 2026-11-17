#!/usr/bin/env node

/** Compare the raw 640 YOLO masks for one local image. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const webRoot = join(projectRoot, "web");
const inputPath = process.argv[2];
const outputDir = resolve(process.argv[3] || join(dirname(inputPath || ""), "yolo-mask-comparison"));
const confidenceThreshold = Number(process.argv[4] ?? "0.10");

if (!inputPath) {
  console.error("用法：node tools/compare_yolo_raw_masks.mjs <图片路径> [输出目录] [置信度阈值]");
  process.exit(2);
}
if (!existsSync(inputPath)) throw new Error(`输入图片不存在：${inputPath}`);
if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) {
  throw new Error(`置信度阈值必须在 0 到 1 之间：${process.argv[4]}`);
}

const variants = [{
  name: "640",
  inputSize: 640,
  bytes: 47_346_618,
  sha256: "E60DDE489CB7202B59CF39E6C4043AC9A6DE3FFC80BAE3F74B52A84B943D07C9",
}];

const chunkNames = (size) => Array.from({ length: 4 }, (_, index) =>
  `wrinkle-yolov8s-seg-${size}.onnx.part0${index}`);
const fail = (message) => { throw new Error(message); };

function runPython(args) {
  const result = spawnSync("python3", ["-c", PYTHON_HELPER, ...args], { maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    fail(`Python 图像编解码失败：${result.stderr?.toString().trim() || result.error?.message || result.status}`);
  }
}

const PYTHON_HELPER = String.raw`
from PIL import Image
import sys
mode, source, target, size = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
if mode == "prepare":
    image = Image.open(source).convert("RGBA")
    # Match the browser path: cap the source at 1600px first, then build the
    # square YOLO working frame. This is intentionally two-stage resizing.
    source_scale = min(1.0, 1600 / max(image.width, image.height))
    source_width = max(1, round(image.width * source_scale))
    source_height = max(1, round(image.height * source_scale))
    if (source_width, source_height) != image.size:
        image = image.resize((source_width, source_height), Image.Resampling.LANCZOS)
    scale = min(size / image.width, size / image.height)
    width = max(1, min(size, round(image.width * scale)))
    height = max(1, min(size, round(image.height * scale)))
    resized = image.resize((width, height), Image.Resampling.BILINEAR)
    canvas = Image.new("RGBA", (size, size), (114, 114, 114, 255))
    canvas.paste(resized, ((size - width) // 2, (size - height) // 2))
    open(target, "wb").write(canvas.tobytes())
    print(f"{size} {size}")
elif mode == "png":
    raw = open(source, "rb").read()
    Image.frombytes("RGBA", (size, size), raw).save(target, format="PNG")
else:
    raise SystemExit("unknown mode")
`;

const tempDir = await mkdtemp(join(tmpdir(), "langerface-yolo-"));
try {
  await mkdir(outputDir, { recursive: true });
  const ort = await import(pathToFileURL(join(webRoot, "node_modules/onnxruntime-web/dist/ort.wasm.mjs")).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  globalThis.ImageData = class ImageDataPolyfill {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
  };
  const { YoloWrinkleOnnx, YOLO_WRINKLE_CLASSES } =
    await import(pathToFileURL(join(webRoot, "src/services/personalized/yoloWrinkleOnnx.ts")).href);
  const { extractFineWrinkleLines } =
    await import(pathToFileURL(join(webRoot, "src/services/personalized/fineWrinkleLines.ts")).href);
  const nativeFetch = globalThis.fetch;
  const fileFetch = async (url) => {
    const value = String(url);
    if (!value.startsWith("file:")) return nativeFetch(url);
    return new Response(await readFile(new URL(value)), { status: 200 });
  };
  const output = { input: resolve(inputPath), confidenceThreshold, variants: {} };
  const colors = [[255, 70, 70], [70, 220, 255], [255, 210, 50]];

  for (const variant of variants) {
    const rawPath = join(tempDir, `${variant.name}.rgba`);
    runPython(["prepare", resolve(inputPath), rawPath, String(variant.inputSize)]);
    const rgba = new Uint8ClampedArray(await readFile(rawPath));
    const imageData = new ImageData(rgba, variant.inputSize, variant.inputSize);
    const chunkUrls = chunkNames(variant.name).map((name) =>
      pathToFileURL(join(webRoot, "compat/personalized/model", name)).href);
    const model = new YoloWrinkleOnnx({
      inputSize: variant.inputSize,
      chunkUrls,
      expectedModelBytes: variant.bytes,
      expectedModelSha256: variant.sha256,
      wasmPaths: {
        mjs: pathToFileURL(join(webRoot, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs")).href,
        wasm: pathToFileURL(join(webRoot, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm")).href,
      },
      runtime: ort,
      fetchImpl: fileFetch,
      persistentCache: false,
    });
    const detection = await model.detectClassMasks(imageData, {
      confidenceThreshold,
      preserveInstanceMasks: true,
    });
    await model.close();

    const overlay = new Uint8ClampedArray(rgba);
    const byClass = Object.fromEntries(YOLO_WRINKLE_CLASSES.map((name) => [name, 0]));
    for (const item of detection.detections) byClass[YOLO_WRINKLE_CLASSES[item.classId] || "unknown"]++;
    for (let classId = 0; classId < YOLO_WRINKLE_CLASSES.length; classId++) {
      const mask = detection.classMasks[YOLO_WRINKLE_CLASSES[classId]];
      const [red, green, blue] = colors[classId];
      for (let index = 0; index < mask.length; index++) {
        if (!mask[index]) continue;
        const offset = index * 4;
        overlay[offset] = Math.round(overlay[offset] * 0.52 + red * 0.48);
        overlay[offset + 1] = Math.round(overlay[offset + 1] * 0.52 + green * 0.48);
        overlay[offset + 2] = Math.round(overlay[offset + 2] * 0.52 + blue * 0.48);
      }
    }
    const outputPath = join(outputDir, `${basename(inputPath, extname(inputPath))}-yolo-${variant.name}-raw-mask.png`);
    const overlayRaw = join(tempDir, `${variant.name}-overlay.rgba`);
    await writeFile(overlayRaw, overlay);
    runPython(["png", overlayRaw, outputPath, String(variant.inputSize)]);

    // Diagnostic-only view: turn every raw YOLO instance mask into a centerline
    // without the browser's region, target, duplicate, or minimum-length gates.
    const rawCenterlines = extractFineWrinkleLines(detection.classMasks, variant.inputSize, variant.inputSize, {
      classes: YOLO_WRINKLE_CLASSES,
      instanceMasks: detection.instanceMasks,
      minimumLineLengthPx: 0,
      resampleSpacingPx: 1,
      maximumSkeletonIterations: 96,
      outputMode: "full",
    });
    const centerlineOverlay = new Uint8ClampedArray(rgba);
    for (const line of rawCenterlines.lines) {
      const classId = YOLO_WRINKLE_CLASSES.indexOf(line.class);
      const [red, green, blue] = colors[classId >= 0 ? classId : 0];
      for (let pointIndex = 1; pointIndex < line.points.length; pointIndex++) {
        const [x0, y0] = line.points[pointIndex - 1];
        const [x1, y1] = line.points[pointIndex];
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
        for (let step = 0; step <= steps; step++) {
          const t = step / steps;
          const x = Math.round(x0 + (x1 - x0) * t);
          const y = Math.round(y0 + (y1 - y0) * t);
          if (x < 0 || y < 0 || x >= variant.inputSize || y >= variant.inputSize) continue;
          const offset = (y * variant.inputSize + x) * 4;
          centerlineOverlay[offset] = red;
          centerlineOverlay[offset + 1] = green;
          centerlineOverlay[offset + 2] = blue;
          centerlineOverlay[offset + 3] = 255;
        }
      }
    }
    const centerlineOutputPath = join(outputDir,
      `${basename(inputPath, extname(inputPath))}-yolo-${variant.name}-raw-centerlines.png`);
    const centerlineRaw = join(tempDir, `${variant.name}-centerlines.rgba`);
    await writeFile(centerlineRaw, centerlineOverlay);
    runPython(["png", centerlineRaw, centerlineOutputPath, String(variant.inputSize)]);
    output.variants[variant.name] = {
      inputSize: variant.inputSize,
      detectionCount: detection.detections.length,
      byClass,
      scores: detection.detections.map((item) => ({
        className: YOLO_WRINKLE_CLASSES[item.classId] || "unknown",
        score: Number(item.score.toFixed(4)),
        box: item.box.map((value) => Number(value.toFixed(1))),
      })),
      outputPath,
      rawCenterlineCount: rawCenterlines.lines.length,
      rawCenterlinesByClass: rawCenterlines.summary.lineCountByClass,
      rawCenterlineRejectedCount: rawCenterlines.rejectedComponents.length,
      rawCenterlines: rawCenterlines.lines.map((line) => ({
        sourceComponentId: line.sourceComponentId,
        className: line.class,
        lengthPx: line.lengthPx,
        pointCount: line.points.length,
        start: line.points[0],
        end: line.points[line.points.length - 1],
        minX: Math.min(...line.points.map(([x]) => x)),
        maxX: Math.max(...line.points.map(([x]) => x)),
        minY: Math.min(...line.points.map(([, y]) => y)),
        maxY: Math.max(...line.points.map(([, y]) => y)),
      })),
      rawCenterlineOutputPath: centerlineOutputPath,
    };
  }
  await writeFile(join(outputDir, `${basename(inputPath, extname(inputPath))}-yolo-mask-comparison.json`),
    `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
