// @ts-nocheck -- isolated research experiment; production services remain fully typed.
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import visionWasmLoaderUrl from "../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url";
import visionWasmBinaryUrl from "../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url";
import ortWasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import ortWasmBinaryUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";

import { mapAtlas, toPixels } from "../../src/services/geometryAtlas.ts";
import {
  buildForeheadSkinVisibility,
  buildHeadVisibility,
  buildWrinklePhotoForeheadVisibility,
  stabilizeForeheadMask,
  WRINKLE_PHOTO_SHA256,
} from "../../src/services/foreheadVisibility.ts";
import { pointToBary } from "../../src/services/personalized/prstlPipeline.ts";
import { refineV6 } from "../../src/services/personalized/v6RstlRefinement.ts";
import { refineV6 as refineV9Exact } from
  "../../src/services/personalized/v6RstlRefinementV9.ts";
import {
  buildDirectNoseDorsumRstl,
  DIRECT_NOSE_DORSUM_FINE_LINE_IDS,
  DIRECT_NOSE_DORSUM_RSTL_ALGORITHM,
  DIRECT_NOSE_DORSUM_RSTL_REGION,
} from "../../src/services/personalized/directNoseDorsumRstl.ts";
import {
  buildNoseRootIntersectionVisibilityPlan,
  NOSE_ROOT_PRESERVED_CURVE_NAMES,
  noseRootVisibilityDiagnostic,
  noseRootVisibilityGeometryMaximumDelta,
  snapshotNoseRootVisibilityGeometry,
  visibilityMaskForCurve,
} from "../../src/services/personalized/noseRootIntersectionVisibility.ts";
import {
  WrinkleYoloOnnx,
  YOLO_WRINKLE_CLASSES,
  YOLO_WRINKLE_CONFIDENCE,
  YOLO_WRINKLE_MODEL_BYTES,
  YOLO_WRINKLE_MODEL_SHA256,
  fuseStrictUnion,
} from "../../src/services/personalized/yoloWrinkleOnnx.ts";

import atlasUrl from "../../../assets/atlas_rstl_standard_v8.json?url";
import faceLandmarkerUrl from "../../assets/face_landmarker.task?url";
import trianglesUrl from "../../assets/triangles.json?url";
import latestWrinkleFineLinesUrl from "../../assets/wrinkle_fine_lines_v10_wrinkle.json?url";
import modelManifestUrl from "./model/wrinkle-yolov8s-seg-640.json?url";

const $ = (id) => document.getElementById(id);
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
  379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
  234, 127, 162, 21, 54, 103, 67, 109,
];

function pointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1;
    index < polygon.length; previous = index++) {
    const currentPoint = polygon[index], previousPoint = polygon[previous];
    if (!currentPoint || !previousPoint) continue;
    const crosses = (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]);
    if (crosses && point[0] < (previousPoint[0] - currentPoint[0]) *
      (point[1] - currentPoint[1]) / (previousPoint[1] - currentPoint[1]) + currentPoint[0]) {
      inside = !inside;
    }
  }
  return inside;
}
const imageInput = $("imageInput");
const runButton = $("runButton");
const exportButton = $("exportButton");
const statusElement = $("status");
const summaryElement = $("summary");
const searchParams = new URLSearchParams(window.location.search);
const requestedVersion = searchParams.get("version");
const EXPERIMENT_VERSION = requestedVersion === "v7" ? "v7" : "v8";
const requestedRefinement = searchParams.get("refinement");
const V9_REFINEMENT_REPLAY = requestedRefinement === "v9" ||
  (requestedRefinement !== "legacy" && EXPERIMENT_VERSION === "v8");
const TWO_SIDED_NEAREST_MATCHING = V9_REFINEMENT_REPLAY;
const BUNDLE_PROPAGATION = false;
const LOGICAL_WRINKLE_GROUPING = true;
const V8_EYE_GUIDANCE = EXPERIMENT_VERSION === "v8";
$("experimentSubtitle").textContent = V9_REFINEMENT_REPLAY ?
  "v8.1.96 · v10 皱纹检测 · 鼻根仅交叉段隐藏 7.6 · validated=false" : V8_EYE_GUIDANCE ?
  "v8.1.96 · v10 皱纹检测 · v9 主锚最近单线微调 6.3 · validated=false" :
  "v8.1.96 · 本地 YOLO · 逻辑皱纹+全局主锚 v7 · validated=false";

const LATEST_WRINKLE_FINE_LINE_CONTRACT = Object.freeze({
  filename: "wrinkle_fine_lines_v10_wrinkle.json",
  sha256: "702E869890A4D2420A4C396DAB3647855F2009017530D06C789B6364F3B4AB1B",
  sourceSchemaVersion: "langerface.wrinkle-paired-edge.v10-forehead-recall-experiment",
  lineCount: 26,
});

const canvases = Object.freeze({
  "01_prior_rstl.png": $("priorCanvas"),
  "02_wrinkle_evidence.png": $("evidenceCanvas"),
  "03_match_decisions.png": $("decisionCanvas"),
  "04_refined_rstl.png": $("refinedCanvas"),
  "05_before_after.png": $("compareCanvas"),
  "06_displacement_audit.png": $("displacementCanvas"),
  "07_nose_root_visibility_audit.png": $("noseRootAuditCanvas"),
  "08_nose_root_before_visibility.png": $("noseRootBeforeCanvas"),
  "09_nose_root_after_visibility.png": $("noseRootAfterCanvas"),
});

const RSTL_EXPERIMENT_CONTRACT = Object.freeze({
  atlasVersion: "8.1.96",
  curveCount: 204,
  pointCount: 19_030,
  expandForehead: true,
  preservePriorGeometry: true,
  displayClippingOnly: true,
  lineColor: "rgba(200, 0, 200, 0.6)",
});

const COLORS = Object.freeze({
  prior: "rgba(75, 85, 99, 0.82)",
  priorStrong: "#007a8a",
  refined: RSTL_EXPERIMENT_CONTRACT.lineColor,
  accepted: "#00875a",
  rejected: "#b45309",
  follower: "#2563eb",
  forehead: [0, 128, 76],
  frown: [180, 83, 9],
  wrinkle: [190, 35, 55],
  wrinkleFine: "#dc2626",
  noseRootRoi: "#16a34a",
  noseRootPreserved: "#dc2626",
  noseRootDirect: "#2563eb",
});

const EXTENDED_FOREHEAD_REGIONS = new Set([
  "forehead_lower_long_arc_v13",
  "forehead_bridge_arc_v15",
]);

const CONTINUOUS_FACE_DISPLAY_REGIONS = new Set([
  "supraorbital_medial_short_arc_v69",
  DIRECT_NOSE_DORSUM_RSTL_REGION,
]);

const LEFT_EYE_CONTOUR = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
];
const RIGHT_EYE_CONTOUR = [
  362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398,
];

let faceLandmarker = null;
let wrinkleYolo = null;
let assetsPromise = null;
let experiment = null;
let visualizationSnapshot = null;

const MAX_WORKING_SIZE = 1280;

function setStatus(message, summary = "") {
  statusElement.textContent = message;
  summaryElement.textContent = summary;
}

async function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      fetch(atlasUrl).then((response) => response.json()),
      fetch(trianglesUrl).then((response) => response.json()),
      fetch(modelManifestUrl).then((response) => response.json()),
    ]).then(([atlas, triangles, modelManifest]) => ({ atlas, triangles, modelManifest }));
  }
  return assetsPromise;
}

async function ensureFaceLandmarker() {
  if (faceLandmarker) return faceLandmarker;
  faceLandmarker = await FaceLandmarker.createFromOptions(
    { wasmLoaderPath: visionWasmLoaderUrl, wasmBinaryPath: visionWasmBinaryUrl },
    {
      baseOptions: { modelAssetPath: faceLandmarkerUrl, delegate: "CPU" },
      runningMode: "IMAGE",
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    },
  );
  return faceLandmarker;
}

async function detectLandmarksFile(file) {
  if (!file) throw new Error("请选择图片文件");
  const image = await loadImage(file);
  const landmarker = await ensureFaceLandmarker();
  const result = landmarker.detect(image);
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks?.length) throw new Error("未检测到单一正面人脸");
  return landmarks.map((point) => [point.x, point.y, point.z]);
}

async function ensureWrinkleYolo() {
  if (wrinkleYolo) return wrinkleYolo;
  wrinkleYolo = new WrinkleYoloOnnx({
    confidenceThreshold: YOLO_WRINKLE_CONFIDENCE,
    verifySha256: true,
    wasmPaths: { mjs: ortWasmModuleUrl, wasm: ortWasmBinaryUrl },
  });
  await wrinkleYolo.load((progress) => {
    setStatus(
      `正在本机校验并加载 YOLO：${progress.loadedChunks}/${progress.totalChunks}`,
      `${Math.round(progress.loadedBytes / 1024 / 1024)} MB`,
    );
  });
  return wrinkleYolo;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取所选图片"));
    };
    image.src = url;
  });
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function loadFineLineSource() {
  const response = await fetch(latestWrinkleFineLinesUrl);
  if (!response.ok) throw new Error("无法加载内置 v10 皱纹中心线");
  const filename = LATEST_WRINKLE_FINE_LINE_CONTRACT.filename;
  const buffer = await response.arrayBuffer();
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new Error("无法解析细线 JSON");
  }
  return { filename, sha256: await sha256Hex(buffer), payload };
}

function fineLineExtractionVersion(payload) {
  return payload.summary?.sourceSchemaVersion ||
    payload.method?.adapter ||
    payload.schemaVersion ||
    "unknown";
}

function faceWidth(mesh, fallbackSize = 320) {
  const xs = (mesh || []).map((point) => Number(point?.[0])).filter(Number.isFinite);
  return xs.length ? Math.max(...xs) - Math.min(...xs) : fallbackSize * 0.72;
}

function paintBase(canvas, imageData) {
  if (canvas.width !== imageData.width) canvas.width = imageData.width;
  if (canvas.height !== imageData.height) canvas.height = imageData.height;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, imageData.width, imageData.height);
  context.putImageData(imageData, 0, 0);
  return context;
}

function outputLineWidth(imageData, scale = 1) {
  return Math.max(1.5, imageData.width / 560) * scale;
}

function rasterSegment(start, end, visit) {
  let x0 = Math.round(start[0]), y0 = Math.round(start[1]);
  const x1 = Math.round(end[0]), y1 = Math.round(end[1]);
  const dx = Math.abs(x1 - x0), stepX = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), stepY = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    visit(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x0 += stepX; }
    if (doubled <= dx) { error += dx; y0 += stepY; }
  }
}

function buildFineLineEvidence(payload, size, { excludedLineIds = new Set() } = {}) {
  if (payload?.schemaVersion !== "langerface.wrinkle-fine-lines.v1" ||
      !Array.isArray(payload?.lines) || !payload.lines.length) {
    throw new Error("细线 JSON 不符合 wrinkle-fine-lines.v1 契约");
  }
  if (payload.source?.width !== size || payload.source?.height !== size) {
    throw new Error("细线 JSON 与实验工作坐标尺寸不一致");
  }
  const pixels = size * size;
  const mask = new Uint8Array(pixels);
  const confidence = new Float32Array(pixels);
  const directionQ = new Float32Array(pixels * 2);
  const directionWeight = new Float32Array(pixels);
  const classMasks = Object.fromEntries(
    YOLO_WRINKLE_CLASSES.map((name) => [name, new Uint8Array(pixels)]),
  );
  const includedLines = payload.lines.filter((line) => !excludedLineIds.has(line.id));
  for (const line of includedLines) {
    if (!classMasks[line.class] || !Array.isArray(line.points) || line.points.length < 2) continue;
    for (let pointIndex = 0; pointIndex < line.points.length - 1; pointIndex += 1) {
      const start = line.points[pointIndex], end = line.points[pointIndex + 1];
      const dx = Number(end[0]) - Number(start[0]);
      const dy = Number(end[1]) - Number(start[1]);
      const squared = dx * dx + dy * dy;
      if (!(squared > 1e-8)) continue;
      const q0 = (dx * dx - dy * dy) / squared;
      const q1 = 2 * dx * dy / squared;
      rasterSegment(start, end, (x, y) => {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        const index = y * size + x;
        mask[index] = 1;
        confidence[index] = 1;
        classMasks[line.class][index] = 1;
        directionQ[index * 2] += q0;
        directionQ[index * 2 + 1] += q1;
        directionWeight[index] += 1;
      });
    }
  }
  for (let index = 0; index < pixels; index += 1) {
    if (!(directionWeight[index] > 0)) continue;
    const q0 = directionQ[index * 2], q1 = directionQ[index * 2 + 1];
    const length = Math.hypot(q0, q1);
    if (!(length > 1e-8)) continue;
    directionQ[index * 2] = q0 / length;
    directionQ[index * 2 + 1] = q1 / length;
  }
  return {
    mask,
    confidence,
    directionQ,
    classMasks,
    lines: includedLines,
    summary: payload.summary,
    rasterPixelCount: mask.reduce((sum, value) => sum + (value ? 1 : 0), 0),
  };
}

function buildWorkingImage(image) {
  const sourceWidth = image.naturalWidth, sourceHeight = image.naturalHeight;
  const maximum = Math.max(sourceWidth, sourceHeight);
  const size = Math.min(MAX_WORKING_SIZE, maximum);
  const scale = size / maximum;
  const drawWidth = sourceWidth * scale, drawHeight = sourceHeight * scale;
  const offsetX = 0.5 * (size - drawWidth), offsetY = 0.5 * (size - drawHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#000000";
  context.fillRect(0, 0, size, size);
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  return {
    imageData: context.getImageData(0, 0, size, size),
    size,
    scale,
    offsetX,
    offsetY,
  };
}

function strokePolyline(context, points, color, width = 1, dash = [], visibility = null) {
  if (!Array.isArray(points) || points.length < 2) return;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(dash);
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      context.beginPath();
      context.moveTo(run[0][0], run[0][1]);
      for (let index = 1; index < run.length; index += 1) {
        context.lineTo(run[index][0], run[index][1]);
      }
      context.stroke();
    }
    run = [];
  };
  for (let index = 0; index < points.length; index += 1) {
    if (!visibility || visibility[index]) run.push(points[index]);
    else flush();
  }
  flush();
  context.restore();
}

function buildDisplayVisibility(imageData, mesh, sourceSha256) {
  const useWrinklePhotoHairline =
    sourceSha256.toLowerCase() === WRINKLE_PHOTO_SHA256;
  return {
    faceOval: FACE_OVAL.map((index) => mesh[index]).filter(Boolean),
    headVisible: buildHeadVisibility(mesh),
    foreheadVisible: useWrinklePhotoHairline
      ? buildWrinklePhotoForeheadVisibility(imageData.width, imageData.height)
      : null,
    visibilityProfile: useWrinklePhotoHairline
      ? "wrinkle_photo_hairline_v1"
      : "generic_forehead_skin_v1",
    skinVisible: buildForeheadSkinVisibility(
      imageData, imageData.width, imageData.height, mesh,
    ),
  };
}

function lineVisibility(points, region, visibility, curve = null, noseRootPlan = null,
  curveIndex = undefined) {
  const extendedForehead = EXTENDED_FOREHEAD_REGIONS.has(region);
  const continuousFaceDisplay = CONTINUOUS_FACE_DISPLAY_REGIONS.has(region);
  let mask = points.map((point) => {
    if (extendedForehead) {
      return visibility.headVisible(point) && (
      visibility.foreheadVisible
        ? visibility.foreheadVisible(point)
        : visibility.skinVisible(point)
      );
    }
    const insideFace = pointInPolygon(point, visibility.faceOval);
    return insideFace && (continuousFaceDisplay || visibility.skinVisible(point));
  });
  if (extendedForehead) mask = stabilizeForeheadMask(mask);
  if (curve && noseRootPlan) {
    mask = visibilityMaskForCurve(curve, mask, noseRootPlan, curveIndex);
  }
  return mask;
}

function snapshotSeedGeometry(seeds) {
  return seeds.map((curve) => curve.pts.map((point) => [point[0], point[1]]));
}

function assertSeedGeometryPreserved(seeds, snapshot, stage) {
  if (seeds.length !== snapshot.length) {
    throw new Error(`${stage}: 原始 RSTL 曲线数量被修改`);
  }
  for (let curveIndex = 0; curveIndex < seeds.length; curveIndex += 1) {
    const points = seeds[curveIndex].pts;
    const expected = snapshot[curveIndex];
    if (points.length !== expected.length) {
      throw new Error(`${stage}: 原始 RSTL 第 ${curveIndex} 条曲线点数被修改`);
    }
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      if (points[pointIndex][0] !== expected[pointIndex][0] ||
          points[pointIndex][1] !== expected[pointIndex][1]) {
        throw new Error(`${stage}: 原始 RSTL 第 ${curveIndex} 条曲线坐标被修改`);
      }
    }
  }
}

function drawLegend(context, entries) {
  const width = 132;
  const height = 12 + entries.length * 18;
  context.save();
  context.fillStyle = "rgba(17, 24, 39, 0.82)";
  context.fillRect(6, 6, width, height);
  context.font = "11px sans-serif";
  context.textBaseline = "middle";
  entries.forEach((entry, index) => {
    const y = 20 + index * 18;
    context.strokeStyle = entry.color;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(14, y);
    context.lineTo(34, y);
    context.stroke();
    context.fillStyle = "#f8fafc";
    context.fillText(entry.label, 42, y);
  });
  context.restore();
}

function drawPrior(imageData, seeds, visibility) {
  const context = paintBase(canvases["01_prior_rstl.png"], imageData);
  const width = outputLineWidth(imageData);
  for (const curve of seeds) {
    strokePolyline(context, curve.pts, COLORS.refined, width, [],
      lineVisibility(curve.pts, curve.region, visibility));
  }
  drawLegend(context, [{ label: "v8.1.96 prior", color: COLORS.refined }]);
}

function drawEvidence(imageData, fineEvidence) {
  const canvas = canvases["02_wrinkle_evidence.png"];
  const context = paintBase(canvas, imageData);
  for (const line of fineEvidence.lines) {
    strokePolyline(context, line.points, COLORS.wrinkleFine, 1);
  }
  return fineEvidence.classMasks;
}

function drawDecisions(imageData, seeds, audit, visibility, directNoseCurves = []) {
  const context = paintBase(canvases["03_match_decisions.png"], imageData);
  const width = outputLineWidth(imageData);
  for (const curve of seeds) {
    strokePolyline(context, curve.pts, "rgba(75, 85, 99, 0.52)", width * 0.65, [],
      lineVisibility(curve.pts, curve.region, visibility));
  }
  const acceptedCurves = new Set((audit.matchRecords || [])
    .filter((record) => record.final_accepted)
    .map((record) => record.rstl_curve_index));
  for (const index of acceptedCurves) {
    const curve = seeds[index];
    if (curve) {
      strokePolyline(context, curve.pts, COLORS.priorStrong, width * 1.15, [],
        lineVisibility(curve.pts, curve.region, visibility));
    }
  }
  const propagatedCurves = new Set((audit.bundleFollowerRecords || [])
    .filter((record) => record.final_status === "propagated")
    .map((record) => record.rstl_curve_index));
  for (const index of propagatedCurves) {
    const curve = seeds[index];
    if (curve) {
      strokePolyline(context, curve.pts, COLORS.follower, width, [5, 3],
        lineVisibility(curve.pts, curve.region, visibility));
    }
  }
  for (const trend of audit.wrinkleTrends || []) {
    strokePolyline(
      context, trend.points, trend.finalAccepted ? COLORS.accepted : COLORS.rejected, width * 1.55,
    );
  }
  for (const curve of directNoseCurves) {
    strokePolyline(context, curve.pts, COLORS.accepted, width * 1.55, [],
      lineVisibility(curve.pts, curve.region, visibility));
  }
  drawLegend(context, [
    { label: "采用皱纹", color: COLORS.accepted },
    { label: "拒绝皱纹", color: COLORS.rejected },
    ...(directNoseCurves.length ? [{ label: "鼻背直接 RSTL", color: COLORS.accepted }] : []),
    { label: BUNDLE_PROPAGATION ? "主锚 RSTL" : "匹配 RSTL", color: COLORS.priorStrong },
    ...(BUNDLE_PROPAGATION ? [{ label: "传播 RSTL", color: COLORS.follower }] : []),
  ]);
}

function drawRefined(imageData, curves, visibility, noseRootPlan) {
  const context = paintBase(canvases["04_refined_rstl.png"], imageData);
  const width = outputLineWidth(imageData);
  for (const [curveIndex, curve] of curves.entries()) {
    strokePolyline(context, curve.pts, COLORS.refined, width, [],
      lineVisibility(curve.pts, curve.region, visibility, curve, noseRootPlan, curveIndex));
  }
  drawLegend(context, [{ label: "refined RSTL", color: COLORS.refined }]);
}

function drawComparison(imageData, seeds, curves, visibility, noseRootPlan) {
  const context = paintBase(canvases["05_before_after.png"], imageData);
  const width = outputLineWidth(imageData);
  for (const curve of seeds) {
    strokePolyline(context, curve.pts, COLORS.priorStrong, width * 0.95, [6, 4],
      lineVisibility(curve.pts, curve.region, visibility));
  }
  for (const [curveIndex, curve] of curves.entries()) {
    strokePolyline(context, curve.pts, COLORS.refined, width * 1.08, [],
      lineVisibility(curve.pts, curve.region, visibility, curve, noseRootPlan, curveIndex));
  }
  drawLegend(context, [
    { label: "调整前", color: COLORS.priorStrong },
    { label: "调整后", color: COLORS.refined },
  ]);
}

function displacementColor(magnitude, maximum) {
  const ratio = Math.max(0, Math.min(1, magnitude / Math.max(1e-6, maximum)));
  const red = Math.round(ratio * 190);
  const green = Math.round(120 - ratio * 80);
  const blue = Math.round(150 - ratio * 95);
  return `rgb(${red}, ${green}, ${blue})`;
}

function drawDisplacements(imageData, curves, maximum, visibility, noseRootPlan) {
  const context = paintBase(canvases["06_displacement_audit.png"], imageData);
  const width = outputLineWidth(imageData);
  for (const [curveIndex, curve] of curves.entries()) {
    strokePolyline(context, curve.priorPts, "rgba(75, 85, 99, 0.48)", width * 0.65, [],
      lineVisibility(curve.priorPts, curve.region, visibility, curve, noseRootPlan, curveIndex));
  }
  context.save();
  context.lineCap = "round";
  for (const [curveIndex, curve] of curves.entries()) {
    const visible = lineVisibility(
      curve.pts, curve.region, visibility, curve, noseRootPlan, curveIndex,
    );
    const step = Math.max(1, Math.floor(curve.pts.length / 18));
    for (let index = 0; index < curve.pts.length; index += step) {
      if (!visible[index]) continue;
      const offset = Math.abs(Number(curve.normalOffsetsPx[index] || 0));
      if (offset <= 0.05) continue;
      const start = curve.priorPts[index], end = curve.pts[index];
      context.strokeStyle = displacementColor(offset, maximum);
      context.lineWidth = width * 1.15;
      context.beginPath();
      context.moveTo(start[0], start[1]);
      context.lineTo(end[0], end[1]);
      context.stroke();
      context.fillStyle = context.strokeStyle;
      context.beginPath();
      context.arc(end[0], end[1], width, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
  drawLegend(context, [
    { label: "小位移", color: displacementColor(0, maximum) },
    { label: "大位移", color: displacementColor(maximum, maximum) },
  ]);
}

function paintNoseRootCrop(canvas, imageData, roi, paddingPx) {
  const minX = Math.max(0, Math.floor(roi.minX - paddingPx));
  const minY = Math.max(0, Math.floor(roi.minY - paddingPx));
  const maxX = Math.min(imageData.width, Math.ceil(roi.maxX + paddingPx));
  const maxY = Math.min(imageData.height, Math.ceil(roi.maxY + paddingPx));
  const cropWidth = Math.max(1, maxX - minX), cropHeight = Math.max(1, maxY - minY);
  const scale = 3;
  canvas.width = cropWidth * scale;
  canvas.height = cropHeight * scale;
  const source = document.createElement("canvas");
  source.width = imageData.width;
  source.height = imageData.height;
  source.getContext("2d").putImageData(imageData, 0, 0);
  const context = canvas.getContext("2d");
  context.drawImage(source, minX, minY, cropWidth, cropHeight,
    0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  context.translate(-minX, -minY);
  return context;
}

function drawNoseRootVisibilityArtifacts(imageData, curves, visibility, plan) {
  const width = outputLineWidth(imageData);
  const audit = paintBase(canvases["07_nose_root_visibility_audit.png"], imageData);
  for (const curve of curves) {
    strokePolyline(audit, curve.pts, "rgba(75, 85, 99, 0.45)", width * 0.7, [],
      lineVisibility(curve.pts, curve.region, visibility));
  }
  for (const curveIndex of plan.preservedCurveIndices) {
    const curve = curves[curveIndex];
    strokePolyline(audit, curve.pts, COLORS.noseRootPreserved, width * 1.45, [],
      lineVisibility(curve.pts, curve.region, visibility, curve, plan, curveIndex));
  }
  for (const curveIndex of plan.directNoseCurveIndices) {
    const curve = curves[curveIndex];
    strokePolyline(audit, curve.pts, COLORS.noseRootDirect, width * 1.45, [],
      lineVisibility(curve.pts, curve.region, visibility));
  }
  audit.save();
  audit.strokeStyle = COLORS.noseRootRoi;
  audit.lineWidth = Math.max(2, width * 1.4);
  audit.setLineDash([8, 5]);
  audit.strokeRect(plan.roi.minX, plan.roi.minY, plan.roi.width, plan.roi.height);
  audit.restore();
  drawLegend(audit, [
    { label: "保留眉间/眉弓", color: COLORS.noseRootPreserved },
    { label: "保留鼻背新线", color: COLORS.noseRootDirect },
    { label: "局部整理区域", color: COLORS.noseRootRoi },
  ]);

  const padding = plan.roiMarginPx * 0.45;
  const before = paintNoseRootCrop(
    canvases["08_nose_root_before_visibility.png"], imageData, plan.roi, padding,
  );
  for (const curve of curves) {
    strokePolyline(before, curve.pts, COLORS.refined, width, [],
      lineVisibility(curve.pts, curve.region, visibility));
  }
  const after = paintNoseRootCrop(
    canvases["09_nose_root_after_visibility.png"], imageData, plan.roi, padding,
  );
  for (const [curveIndex, curve] of curves.entries()) {
    strokePolyline(after, curve.pts, COLORS.refined, width, [],
      lineVisibility(curve.pts, curve.region, visibility, curve, plan, curveIndex));
  }
}

function encodeRuns(mask) {
  const output = [];
  let start = -1;
  for (let index = 0; index <= mask.length; index += 1) {
    const active = index < mask.length && Number(mask[index]) > 0;
    if (active && start < 0) start = index;
    if (!active && start >= 0) {
      output.push([start, index - start]);
      start = -1;
    }
  }
  return output;
}

function rounded(value, digits = 6) {
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
  if (Array.isArray(value)) return value.map((item) => rounded(item, digits));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item, digits)]));
  }
  return value;
}

function validBarycentric(value, epsilon = 1e-3) {
  if (!value || !Number.isInteger(value.tri) ||
      ![value.u, value.v].every(Number.isFinite)) return false;
  const w = 1 - value.u - value.v;
  return Math.min(value.u, value.v, w) >= -epsilon &&
    Math.max(value.u, value.v, w) <= 1 + epsilon;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * (sorted.length - 1)))];
}

function buildActiveAtlas(atlas, curves, refMesh, triangles, diagnostics) {
  const mesh3 = refMesh.map((point) => [point[0], point[1], 0]);
  const baseMapped = mapAtlas(atlas.lines, mesh3, triangles, { expandForehead: false });
  const coherentForehead = diagnostics?.forehead_bundle_coherence?.applied === true;
  const runtimeExpansionEnabled = (region) => EXTENDED_FOREHEAD_REGIONS.has(region);
  const basePoints = curves.map((curve, curveIndex) => {
    if (curve.generatedFromWrinkle === true) {
      return curve.pts.map((point) => [point[0], point[1]]);
    }
    const line = baseMapped[curveIndex];
    const region = curves[curveIndex]?.region || atlas.lines[curveIndex]?.region || "";
    const source = runtimeExpansionEnabled(region) ? line.pts : curves[curveIndex].pts;
    return source.map((point) => [point[0], point[1]]);
  });

  const encodeLines = (countFallbacks = false) => {
    let fallbackPointCount = 0;
    let sourceAnchorReusePointCount = 0;
    let boundaryProjectionPointCount = 0;
    const lines = basePoints.map((points, curveIndex) => {
      const curve = curves[curveIndex];
      const source = atlas.lines[curveIndex];
      const region = curve.region || source?.region || "";
      const runtimeExpansion = runtimeExpansionEnabled(region);
      return {
        name: curve.name,
        region,
        disableRuntimeExpansion: !runtimeExpansion,
        ...(curve.generatedFromWrinkle === true ? {
          personalization: {
            source: DIRECT_NOSE_DORSUM_RSTL_ALGORITHM,
            sourceFineLineId: curve.sourceFineLineId,
            directWrinkleGenerated: true,
          },
        } : {}),
        points: points.map((point, pointIndex) => {
          const bary = pointToBary(point, refMesh, triangles);
          if (validBarycentric(bary)) return [bary.tri, bary.u, bary.v];
          const anchor = baseMapped[curveIndex]?.pts[pointIndex];
          if (anchor) {
            let invalidFraction = 0, validFraction = 1;
            let projectedBary = pointToBary(anchor, refMesh, triangles);
            if (validBarycentric(projectedBary)) {
              for (let iteration = 0; iteration < 32; iteration += 1) {
                const fraction = 0.5 * (invalidFraction + validFraction);
                const candidate = [
                  point[0] + fraction * (anchor[0] - point[0]),
                  point[1] + fraction * (anchor[1] - point[1]),
                ];
                const candidateBary = pointToBary(candidate, refMesh, triangles);
                if (validBarycentric(candidateBary)) {
                  validFraction = fraction;
                  projectedBary = candidateBary;
                } else {
                  invalidFraction = fraction;
                }
              }
              if (countFallbacks) boundaryProjectionPointCount += 1;
              return [projectedBary.tri, projectedBary.u, projectedBary.v];
            }
          }
          if (source?.points?.[pointIndex]) {
            if (countFallbacks) sourceAnchorReusePointCount += 1;
            return [...source.points[pointIndex]];
          }
          if (countFallbacks) fallbackPointCount += 1;
          return [0, 0, 0];
        }),
      };
    });
    return { lines, fallbackPointCount, sourceAnchorReusePointCount,
      boundaryProjectionPointCount };
  };

  // Forehead v68 lines are normalized by mapAtlas at runtime. Solve small V6
  // offsets back into their pre-normalization coordinates so the exported atlas
  // replays the same final curves instead of disabling the v68 transform.
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const candidate = encodeLines().lines;
    const replay = mapAtlas(candidate, mesh3, triangles);
    for (let curveIndex = 0; curveIndex < curves.length; curveIndex += 1) {
      const curve = curves[curveIndex];
      if (!runtimeExpansionEnabled(curve.region)) continue;
      if (coherentForehead && curve.region === "forehead_bridge_arc_v15") continue;
      for (let pointIndex = 0; pointIndex < curve.pts.length; pointIndex += 1) {
        const target = curve.pts[pointIndex];
        const current = replay[curveIndex]?.pts[pointIndex];
        if (!current) continue;
        const errorX = target[0] - current[0], errorY = target[1] - current[1];
        if (Math.hypot(errorX, errorY) <= 0.02) continue;
        for (const scale of [0.72, 0.36, 0.18, 0.09]) {
          const proposed = [
            basePoints[curveIndex][pointIndex][0] + scale * errorX,
            basePoints[curveIndex][pointIndex][1] + scale * errorY,
          ];
          if (validBarycentric(pointToBary(proposed, refMesh, triangles))) {
            basePoints[curveIndex][pointIndex] = proposed;
            break;
          }
        }
      }
    }
  }

  const encoded = encodeLines(true);
  const lines = encoded.lines;
  const fallbackPointCount = encoded.fallbackPointCount;
  const sourceAnchorReusePointCount = encoded.sourceAnchorReusePointCount;
  const boundaryProjectionPointCount = encoded.boundaryProjectionPointCount;
  const initialReplay = mapAtlas(lines, mesh3, triangles);
  const meshXs = refMesh.map((point) => point[0]).filter(Number.isFinite);
  const meshFaceWidth = Math.max(...meshXs) - Math.min(...meshXs);
  const coherentForeheadMaximumDisplacementPx = coherentForehead ? curves.reduce(
    (maximum, curve) => curve.region !== "forehead_bridge_arc_v15" ? maximum :
      Math.max(maximum, ...curve.pts.map((point, pointIndex) => Math.hypot(
        point[0] - curve.priorPts[pointIndex][0],
        point[1] - curve.priorPts[pointIndex][1],
      ))),
    0,
  ) : 0;
  const postExpansionCorrectionLimitPx = Math.max(
    2, 0.004 * meshFaceWidth, coherentForeheadMaximumDisplacementPx + 0.5,
  );
  let postExpansionCorrectionPointCount = 0, postExpansionCorrectionMaximumPx = 0;
  for (let curveIndex = 0; curveIndex < curves.length; curveIndex += 1) {
    const corrections = [];
    for (let pointIndex = 0; pointIndex < curves[curveIndex].pts.length; pointIndex += 1) {
      const expected = curves[curveIndex].pts[pointIndex];
      const actual = initialReplay[curveIndex]?.pts[pointIndex];
      if (!actual) continue;
      const dx = expected[0] - actual[0], dy = expected[1] - actual[1];
      const error = Math.hypot(dx, dy);
      if (error <= 0.01) continue;
      corrections.push([pointIndex, dx / meshFaceWidth, dy / meshFaceWidth]);
      postExpansionCorrectionPointCount += 1;
      postExpansionCorrectionMaximumPx = Math.max(postExpansionCorrectionMaximumPx, error);
    }
    if (corrections.length) lines[curveIndex].postExpansionOffsetsFaceRatioSparse = corrections;
  }
  const replay = mapAtlas(lines, mesh3, triangles);
  const replayErrors = [];
  let maximumReplayError = { error: -Infinity, curveIndex: -1, pointIndex: -1,
    expected: null, actual: null };
  for (let curveIndex = 0; curveIndex < curves.length; curveIndex += 1) {
    for (let pointIndex = 0; pointIndex < curves[curveIndex].pts.length; pointIndex += 1) {
      const expected = curves[curveIndex].pts[pointIndex];
      const actual = replay[curveIndex]?.pts[pointIndex];
      const error = actual ? Math.hypot(expected[0] - actual[0], expected[1] - actual[1]) : Infinity;
      replayErrors.push(error);
      if (error > maximumReplayError.error) {
        maximumReplayError = { error, curveIndex, pointIndex,
          expected: [...expected], actual: actual ? [...actual] : null };
      }
    }
  }
  const replayDiagnostics = {
    runtime_expansion_curve_count: lines.filter((line) => !line.disableRuntimeExpansion).length,
    replay_mean_error_px: replayErrors.reduce((sum, value) => sum + value, 0) / replayErrors.length,
    replay_p90_error_px: percentile(replayErrors, 0.90),
    replay_max_error_px: Math.max(...replayErrors),
    replay_max_error_curve_index: maximumReplayError.curveIndex,
    replay_max_error_point_index: maximumReplayError.pointIndex,
    replay_max_error_expected_xy: maximumReplayError.expected,
    replay_max_error_actual_xy: maximumReplayError.actual,
    replay_max_error_base_xy:
      basePoints[maximumReplayError.curveIndex]?.[maximumReplayError.pointIndex] || null,
    replay_max_error_base_bary: (() => {
      const point = basePoints[maximumReplayError.curveIndex]?.[maximumReplayError.pointIndex];
      return point ? pointToBary(point, refMesh, triangles) : null;
    })(),
    post_expansion_correction_point_count: postExpansionCorrectionPointCount,
    post_expansion_correction_maximum_px: postExpansionCorrectionMaximumPx,
    post_expansion_correction_limit_px: postExpansionCorrectionLimitPx,
  };
  return {
    atlas: {
      system: "rstl",
      version: V9_REFINEMENT_REPLAY ?
        "v8.1.96-single-image-regional-direct-nose-intersection-only-7.6" : V8_EYE_GUIDANCE ?
        "v8.1.96-single-image-nearest-single-curve-6.3" :
        "v8.1.96-single-image-v7-complete-fine-lines-v7",
      topologyId: atlas.topologyId,
      topologyVersion: atlas.topologyVersion,
      provenance: V9_REFINEMENT_REPLAY ?
        "rstl-v8.1.96-v10-centerlines-regional-guidance-direct-nose" : V8_EYE_GUIDANCE ?
        "rstl-v68-local-yolo-frozen-v1-fine-lines-v8" :
        "rstl-v68-local-yolo-frozen-v1-fine-lines-v7-v7",
      validated: false,
      diagnostics: {
        ...diagnostics,
        barycentric_fallback_point_count: fallbackPointCount,
        source_anchor_reuse_point_count: sourceAnchorReusePointCount,
        boundary_projection_point_count: boundaryProjectionPointCount,
        ...replayDiagnostics,
      },
      lines,
    },
    fallbackPointCount,
    replayDiagnostics,
  };
}

function buildArtifacts({ file, sourceSha256, atlas, modelManifest, detection, fused,
  fineEvidence, guidanceEvidence, fineLineSource, refined, masks, activeAtlas, fallbackPointCount,
  refMesh, workingSize }) {
  const source = {
    filename: file.name,
    sha256: sourceSha256,
    embedded: false,
    width: workingSize,
    height: workingSize,
  };
  const evidence = {
    schemaVersion: "langerface.wrinkle-yolo-evidence.v1",
    validated: false,
    localOnly: true,
    sourceImage: source,
    model: {
      ...modelManifest,
      onnx_bytes: YOLO_WRINKLE_MODEL_BYTES,
      onnx_sha256: YOLO_WRINKLE_MODEL_SHA256,
    },
    diagnostics: detection.diagnostics,
    detections: detection.detections,
    centerlineSource: {
      filename: fineLineSource.filename,
      sha256: fineLineSource.sha256,
      schemaVersion: fineLineSource.payload.schemaVersion,
      extractionVersion: fineLineExtractionVersion(fineLineSource.payload),
      adapter: fineLineSource.payload.method?.adapter || null,
      fineLineCount: fineEvidence.lines.length,
      rasterPixelCount: fineEvidence.rasterPixelCount,
      sourceImageSha256Matches: String(fineLineSource.payload.source?.imageSha256 || "")
        .toUpperCase() === sourceSha256.toUpperCase(),
    },
    masks: {
      encoding: "zero_based_row_major_start_length_runs",
      width: workingSize,
      height: workingSize,
      rawYoloStrictUnion: encodeRuns(fused.mask),
      centerlineUnion: encodeRuns(fineEvidence.mask),
      guidanceCenterlineUnionExcludingNoseDorsum: encodeRuns(guidanceEvidence.mask),
      classes: Object.fromEntries(YOLO_WRINKLE_CLASSES.map((name) => [name, encodeRuns(masks[name])])),
    },
  };
  const refinement = {
    schemaVersion: "langerface.wrinkle-guided-rstl-refinement.v1",
    validated: false,
    purpose: "research_visualization_only",
    localOnly: true,
    sourceImage: source,
    summary: {
      detectionCount: detection.detections.length,
      fineLineCount: fineEvidence.lines.length,
      fineLineExtractionVersion: fineLineExtractionVersion(fineLineSource.payload),
      wrinkleTrendCount: refined.audit.wrinkleTrends.length,
      acceptedTrendCount: refined.audit.wrinkleTrends
        .filter((trend) => trend.finalAccepted).length,
      alreadyAlignedTrendCount: refined.audit.wrinkleTrends
        .filter((trend) => trend.finalStatus === "already_aligned").length,
      rejectedTrendCount: refined.audit.wrinkleTrends
        .filter((trend) => !trend.finalAccepted).length,
      movedCurveCount: refined.diagnostics.moved_curve_count,
      movedPointCount: refined.diagnostics.moved_point_count,
      directNoseDorsumGeneratedCurveCount:
        refined.diagnostics.direct_nose_dorsum_generated_curve_count,
      outputCurveCount: refined.curves.length,
      ...(BUNDLE_PROPAGATION ? {
        ...(V8_EYE_GUIDANCE ? {
          primaryAnchorGroupCount:
            refined.diagnostics.bundle_primary_anchor_curve_indices.length,
        } : {}),
        primaryAnchorCurveCount: V8_EYE_GUIDANCE ?
          new Set(refined.diagnostics.bundle_primary_anchor_curve_indices).size :
          refined.diagnostics.bundle_primary_anchor_curve_indices.length,
        propagatedFollowerCurveCount:
          refined.diagnostics.bundle_follower_moved_curve_count,
        multiSourceFollowerCurveCount:
          refined.diagnostics.bundle_multi_source_follower_curve_count,
      } : {}),
      barycentricFallbackPointCount: fallbackPointCount,
    },
    prior: {
      baseline: "rstl_v8_1_96",
      atlasVersion: atlas.atlasVersion,
      curveCount: atlas.lines.length,
      pointCount: atlas.lines.reduce((sum, line) => sum + line.points.length, 0),
      experimentContract: {
        ...RSTL_EXPERIMENT_CONTRACT,
        visibilityProfile: sourceSha256.toLowerCase() === WRINKLE_PHOTO_SHA256
          ? "wrinkle_photo_hairline_v1"
          : "generic_forehead_skin_v1",
      },
      requiredRegion: "lateral_canthus_short_arc_v65",
    },
    coordinateSpace: {
      name: "single_image_working_2d",
      width: workingSize,
      height: workingSize,
      faceWidthPx: faceWidth(refMesh, workingSize),
    },
    parameters: {
      yoloConfidenceThreshold: YOLO_WRINKLE_CONFIDENCE,
      directionToleranceDegrees: 40,
      nearestSingleCurveMatching: refined.diagnostics.nearest_single_curve_matching,
      exclusiveTrendMatching: refined.diagnostics.exclusive_trend_matching,
      oneToOneTrendCurveMatching: refined.diagnostics.one_to_one_trend_curve_matching,
      postAdherenceGate: refined.diagnostics.post_adherence_gate,
      targetWrinkleGapPx: refined.diagnostics.target_wrinkle_gap_px,
      trajectoryDataAttractionStrength:
        refined.diagnostics.trajectory_data_attraction_strength,
      displacementP90FaceRatio:
        refined.diagnostics.displacement_p90_limit_ratio_face_width,
      maximumDisplacementFaceRatio:
        refined.diagnostics.maximum_displacement_ratio_face_width,
      wrinkleDominantCoreStrength: refined.diagnostics.wrinkle_dominant_core_strength,
      curvatureFairing: refined.diagnostics.curvature_fairing_enabled,
      adherenceMeanThresholdPx: refined.diagnostics.trajectory_adherence_mean_threshold_px,
      adherenceP90ThresholdPx: refined.diagnostics.trajectory_adherence_p90_threshold_px,
      adherenceDirectionP90Degrees:
        refined.diagnostics.trajectory_adherence_direction_p90_threshold_degrees,
      ...(BUNDLE_PROPAGATION ? {
        bundleFollowerStrength: refined.diagnostics.bundle_follower_strength,
        bundlePropagationRadiusPx: refined.diagnostics.bundle_propagation_radius_px,
        bundleFollowerCountPerSide: refined.diagnostics.bundle_follower_count_per_side,
        bundleMultiSourceWeightsNormalized:
          refined.diagnostics.bundle_multi_source_weights_normalized,
      } : {}),
      mode: V9_REFINEMENT_REPLAY ?
        "v10_three_region_guided_direct_nose_v7_2" : V8_EYE_GUIDANCE ?
        "v10_nearest_single_curve_v9_anchor_trajectory_v8" : LOGICAL_WRINKLE_GROUPING ?
        "v68_logical_wrinkle_global_anchor_bundle_v7" : BUNDLE_PROPAGATION ?
          "exclusive_anchor_normalized_bundle_propagation_v5" :
        "complete_fine_line_wrinkle_dominant_v4",
    },
    diagnostics: refined.diagnostics,
    audit: refined.audit,
    lines: refined.lines,
    activeAtlas: {
      filename: "personalized_rstl_atlas.json",
      barycentricFallbackPointCount: fallbackPointCount,
    },
    limitations: [
      "validated=false; research visualization only.",
      "Single frontal image experiment; multi-expression registration is out of scope.",
      "Forehead, glabellar, and crow-feet RSTL geometry is guided by paired-edge v10 centerlines; nasal-dorsum centerlines are excluded from deformation guidance.",
      "Each accepted nasal-dorsum wrinkle is exported directly as a new personalized RSTL curve after smoothing and anatomical safety gates.",
      ...(BUNDLE_PROPAGATION ? [
        V8_EYE_GUIDANCE ?
          "V8 permits non-overlapping anchor intervals on one RSTL and propagates normalized deformation only to nearby non-anchor RSTL." :
          "V7 keeps exclusive positional anchors and propagates normalized deformation only to nearby non-anchor RSTL.",
      ] : []),
      "The source image is not embedded in JSON exports.",
    ],
  };
  return {
    "wrinkle_yolo_evidence.json": rounded(evidence),
    "wrinkle_rstl_refinement.json": rounded(refinement),
    "personalized_rstl_atlas.json": rounded(activeAtlas, 9),
  };
}

function blobDownload(name, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function canvasBlob(canvas, scale = 1) {
  const output = document.createElement("canvas");
  output.width = canvas.width * scale;
  output.height = canvas.height * scale;
  const context = output.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, output.width, output.height);
  return new Promise((resolve, reject) => output.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("PNG 导出失败")), "image/png",
  ));
}

async function artifactData() {
  if (!experiment) throw new Error("尚无实验结果");
  const images = {};
  for (const [name, canvas] of Object.entries(canvases)) {
    images[name] = (await canvasBlob(canvas)).arrayBuffer().then((buffer) => [...new Uint8Array(buffer)]);
  }
  return {
    images: Object.fromEntries(await Promise.all(Object.entries(images).map(async ([name, promise]) => [name, await promise]))),
    json: experiment.artifacts,
  };
}

async function exportAll() {
  if (!experiment) return;
  exportButton.disabled = true;
  try {
    for (const [name, canvas] of Object.entries(canvases)) {
      blobDownload(name, await canvasBlob(canvas));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    for (const [name, payload] of Object.entries(experiment.artifacts)) {
      blobDownload(name, new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    setStatus("导出完成。", experiment.summary);
  } finally {
    exportButton.disabled = false;
  }
}

async function runExperiment(file) {
  if (!file) throw new Error("请选择图片文件");
  exportButton.disabled = true;
  experiment = null;
  setStatus("正在加载本地资产…");
  const [{ atlas, triangles, modelManifest }, image, sourceBuffer, fineLineSource] = await Promise.all([
    loadAssets(), loadImage(file), file.arrayBuffer(), loadFineLineSource(),
  ]);
  const sourceSha256 = await sha256Hex(sourceBuffer);
  if (String(fineLineSource.payload.source?.imageSha256 || "").toUpperCase() !==
      sourceSha256.toUpperCase()) {
    throw new Error("细线 JSON 不属于当前人脸图片");
  }
  if (V8_EYE_GUIDANCE && (
    fineLineSource.sha256 !== LATEST_WRINKLE_FINE_LINE_CONTRACT.sha256 ||
    fineLineExtractionVersion(fineLineSource.payload) !==
      LATEST_WRINKLE_FINE_LINE_CONTRACT.sourceSchemaVersion ||
    fineLineSource.payload.lines?.length !== LATEST_WRINKLE_FINE_LINE_CONTRACT.lineCount
  )) {
    throw new Error("v8 实验必须使用完整的 26 条 v10 皱纹中心线");
  }
  if (atlas.validated !== false ||
      atlas.atlasVersion !== RSTL_EXPERIMENT_CONTRACT.atlasVersion ||
      atlas.lines.length !== RSTL_EXPERIMENT_CONTRACT.curveCount ||
      !atlas.lines.some((line) => line.region === "lateral_canthus_short_arc_v65") ||
      atlas.lines.some((line) => line.region === "supraorbital_lateral_short_arc_v66") ||
      !atlas.lines.some((line) => line.region === "supraorbital_medial_short_arc_v69") ||
      !atlas.lines.some((line) => line.region === "brow_temporal_fan_v94") ||
      !atlas.lines.some((line) => line.region === "cheek_alar_gap_fill_v95")) {
    throw new Error(
      "RSTL atlas 必须是 validated=false 的 v8.1.96 204 曲线版本",
    );
  }
  const pointCount = atlas.lines.reduce((sum, line) => sum + line.points.length, 0);
  if (pointCount !== RSTL_EXPERIMENT_CONTRACT.pointCount) {
    throw new Error(`RSTL atlas 点数异常：${pointCount}`);
  }

  setStatus("正在本机定位人脸并建立统一坐标…");
  const landmarker = await ensureFaceLandmarker();
  const faceResult = landmarker.detect(image);
  const normalizedLandmarks = faceResult.faceLandmarks?.[0];
  if (!normalizedLandmarks?.length) throw new Error("未检测到单一正面人脸");
  const sourceMesh = toPixels(normalizedLandmarks, image.naturalWidth, image.naturalHeight);
  const working = buildWorkingImage(image);
  const workingImage = working.imageData;
  const refMesh = sourceMesh.map((point) => [
    point[0] * working.scale + working.offsetX,
    point[1] * working.scale + working.offsetY,
  ]);
  const mesh3 = refMesh.map((point) => [point[0], point[1], 0]);
  const seeds = mapAtlas(atlas.lines, mesh3, triangles, {
    expandForehead: RSTL_EXPERIMENT_CONTRACT.expandForehead,
  }).map((line, id) => ({
    name: line.name,
    region: line.region || atlas.lines[id]?.region || "",
    id,
    tris: [...line.tris],
    pts: line.pts.map((point) => [point[0], point[1]]),
  }));
  if (seeds.length !== 204 || seeds.some((line, index) =>
    line.pts.length !== atlas.lines[index].points.length)) {
    throw new Error("映射后的 RSTL 未保持 204 条 / 19030 点拓扑");
  }
  const seedGeometrySnapshot = snapshotSeedGeometry(seeds);
  const displayVisibility = buildDisplayVisibility(workingImage, refMesh, sourceSha256);
  drawPrior(workingImage, seeds, displayVisibility);
  assertSeedGeometryPreserved(seeds, seedGeometrySnapshot, "原始 RSTL 绘制后");

  setStatus("正在本机运行固定 YOLO 模型…");
  const model = await ensureWrinkleYolo();
  const detection = await model.detect(workingImage, {
    confidenceThreshold: YOLO_WRINKLE_CONFIDENCE,
  });
  const fused = await fuseStrictUnion([detection], {
    width: working.size,
    height: working.size,
    operation: "strict_union",
    consolidationRadiusPx: Math.max(
      2, Math.min(9, Math.round(faceWidth(refMesh, working.size) * 0.014)),
    ),
    consolidationDirectionToleranceDegrees: 28,
  });
  const fineEvidence = buildFineLineEvidence(fineLineSource.payload, working.size);
  const guidanceEvidence = buildFineLineEvidence(fineLineSource.payload, working.size, {
    excludedLineIds: new Set(DIRECT_NOSE_DORSUM_FINE_LINE_IDS),
  });
  const wrinkleMask = guidanceEvidence.mask;
  const masks = drawEvidence(workingImage, fineEvidence);
  const workingFaceWidth = faceWidth(refMesh, working.size);

  setStatus("正在执行皱纹主导的 RSTL 局部轨迹重建…");
  const refinementFunction = V9_REFINEMENT_REPLAY ? refineV9Exact : refineV6;
  const refined = refinementFunction({
    seeds,
    wrinkleMask,
    confidenceMap: guidanceEvidence.confidence,
    directionQ: guidanceEvidence.directionQ,
    size: working.size,
    faceWidthPx: workingFaceWidth,
    options: {
      ...(V9_REFINEMENT_REPLAY ? {
        twoSidedNearestMatching: true,
        foreheadNearestSingleCurveMatching: true,
        regionalNearestSingleCurveMatching: true,
        regionalCandidateFamilyFiltering: true,
        nearestSingleCurveMatching: false,
        exclusiveTrendMatching: false,
        oneToOneTrendCurveMatching: false,
        searchRadiusPx: workingFaceWidth * 0.110,
      } : {
        nearestSingleCurveMatching: true,
      }),
      ...(LOGICAL_WRINKLE_GROUPING ? {
        logicalTrendGrouping: true,
        softLinkDistancePx: workingFaceWidth * 0.030,
        softLinkTurnDegrees: 18,
        softLinkTangentSpanPx: Math.round(workingFaceWidth * 0.020),
        ...(V9_REFINEMENT_REPLAY ? { globalLengthAwareMatching: true } : {}),
      } : {}),
      ...(V8_EYE_GUIDANCE ? {
        adherenceRetryAttempts: 10,
        shortWrinkleQuantizationTolerance: true,
        shortWrinkleMaximumLengthRatio: 0.12,
        shortWrinkleP90TolerancePx: Math.max(0.5, workingFaceWidth * 0.001),
        adherenceDirectionSoftDegrees: 25,
        adherenceDirectionHardDegrees: 40,
      } : {}),
      topologyRetryAttempts: 3,
      postAdherenceGate: true,
      targetGapPx: V9_REFINEMENT_REPLAY ?
        Math.max(0.75, workingFaceWidth * 0.0012) :
        Math.max(1.25, workingFaceWidth * 0.0025),
      dataAttractionStrength: 20,
      wrinkleDominantCoreStrength: 0.95,
      wrinkleDominantCoreSupportRatio: 0.08,
      smoothingPasses: 12,
      transitionLengthPx: workingFaceWidth * (V9_REFINEMENT_REPLAY ? 0.040 : 0.010),
      p90LimitPx: workingFaceWidth * 0.030,
      maxDisplacementPx: workingFaceWidth * 0.045,
      maxCurvatureChangeDegrees: 60,
      curvatureFairing: V9_REFINEMENT_REPLAY,
      ...(V9_REFINEMENT_REPLAY ? {
        curvatureFairingPasses: 64,
        curvatureFairingMaximumTurnDegrees: 4,
        curvatureFairingStrictMaximumTurnDegrees: 3,
        curvatureFairingBaselineSlackDegrees: 0.75,
        curvatureFairingMaterialTurnDegrees: 0.35,
        curvatureFairingMaximumAddedSignChanges: 0,
        curvatureFairingForeheadMaximumAddedSignChanges: 4,
        curvatureFairingEndpointTangentChangeDegrees: 20,
        curvatureFairingMaximumMeanAdherencePx: Math.max(2, workingFaceWidth * 0.0035),
        curvatureFairingMaximumP90AdherencePx: Math.max(4, workingFaceWidth * 0.0065),
        curvatureFairingForeheadMaximumTurnDegrees: 8,
        curvatureFairingForeheadMaximumMeanAdherencePx: 1.5,
        curvatureFairingForeheadMaximumP90AdherencePx: 3,
        foreheadAdherenceMeanThresholdPx: 1.5,
        foreheadAdherenceP90ThresholdPx: 3,
        foreheadBundleCoherence: true,
        foreheadBundleMinimumSpacingRatio: 0.65,
        foreheadBundleMaximumSpacingRatio: 1.45,
        foreheadBundleMaximumTurnDegrees: 8,
        foreheadBundleMaximumAddedSignChanges: 6,
        foreheadBundleMinimumReversalSpacingPx: 12,
        curvatureFairingGlabellarMaximumTurnDegrees: 8,
        curvatureFairingGlabellarMaximumAddedSignChanges: 4,
        curvatureFairingGlabellarMaximumMeanAdherencePx: 2.6,
        curvatureFairingGlabellarMaximumP90AdherencePx: 7,
        curvatureFairingGlabellarMinimumReversalSpacingPx: 15,
        glabellarAdherenceMeanThresholdPx: 2.6,
        glabellarAdherenceP90ThresholdPx: 7,
        glabellarMaximumDisplacementPx: workingFaceWidth * 0.08,
        glabellarTransitionLengthPx: workingFaceWidth * 0.08,
        curvatureFairingCrowsFeetMaximumTurnDegrees: 9,
        curvatureFairingCrowsFeetMaximumAddedSignChanges: 2,
        curvatureFairingCrowsFeetMaximumMeanAdherencePx: 3.75,
        curvatureFairingCrowsFeetMaximumP90AdherencePx: 7,
        curvatureFairingCrowsFeetMinimumReversalSpacingPx: 10,
        curvatureFairingCrowsFeetMaximumDirectionP90Degrees: 40,
        curvatureFairingCrowsFeetDirectionWeight: 2.0,
        crowsFeetAdherenceMeanThresholdPx: 3.75,
        crowsFeetAdherenceP90ThresholdPx: 7,
        crowsFeetAdherenceDirectionP90Degrees: 40,
        crowsFeetMaximumDisplacementPx: workingFaceWidth * 0.07,
        crowsFeetTransitionLengthPx: workingFaceWidth * 0.06,
        crowsFeetRetainAlignedRefinement: true,
        crowsFeetNeighborCoherence: true,
        crowsFeetNeighborCountPerAnchor: 2,
        crowsFeetNeighborRadiusPx: workingFaceWidth * 0.030,
        crowsFeetNeighborStrength: 0.28,
        crowsFeetNeighborMinimumSpacingRatio: 0.70,
        crowsFeetNeighborMaximumTurnDegrees: 10,
        crowsFeetDirectionalBundleMinimumPriorDirectionDegrees: 20,
      } : {}),
      ...(BUNDLE_PROPAGATION ? {
        bundlePropagation: true,
        bundleFollowerCountPerSide: 1,
        bundleFollowerStrength: 0.85,
        bundlePropagationRadiusPx: workingFaceWidth * 0.050,
        bundleDirectionConflictDegrees: 25,
        bundleConflictDominanceRatio: 1.5,
        bundleDataAttractionStrength: 8,
        bundleSmoothingPasses: 16,
        bundleFollowerTopologyPriority: 0.25,
        ...(V8_EYE_GUIDANCE ? {
          bundleMinimumSpacingRatio: 0.65,
          bundleDenseFollowerRegion: "lateral_canthus_short_arc_v65",
          bundleDenseFollowerCountPerSide: 3,
        } : {}),
      } : {}),
    },
  });
  assertSeedGeometryPreserved(seeds, seedGeometrySnapshot, "皱纹引导微调后");
  const regionalRefinementAlgorithm = refined.diagnostics.algorithm;
  const directNoseDorsum = buildDirectNoseDorsumRstl({
    fineLines: fineEvidence.lines,
    faceWidthPx: workingFaceWidth,
    eyePolygons: [LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR]
      .map((indices) => indices.map((index) => refMesh[index]).filter(Boolean)),
    existingCurves: refined.curves,
    maximumTurnLimitDegrees: 8,
    auditExistingCurveIntersections: true,
  });
  const baseCurveCount = refined.curves.length;
  const directNoseCurves = directNoseDorsum.curves.map((curve, offset) => ({
    ...curve,
    id: baseCurveCount + offset,
    curveIndex: baseCurveCount + offset,
    tris: [],
  }));
  refined.curves = [...refined.curves, ...directNoseCurves];
  refined.lines = [
    ...refined.lines,
    ...directNoseCurves.map((curve) => ({
      name: curve.name,
      region: curve.region,
      points_prior_xy: curve.priorPts.map((point) => [...point]),
      points_xy: curve.pts.map((point) => [...point]),
      normal_offsets_px: [...curve.normalOffsetsPx],
      affected_intervals: [],
      rollback_reason: null,
      generated_from_wrinkle: true,
      source_fine_line_id: curve.sourceFineLineId,
      generation_algorithm: DIRECT_NOSE_DORSUM_RSTL_ALGORITHM,
    })),
  ];
  const noseRootGeometrySnapshot = snapshotNoseRootVisibilityGeometry(refined.curves);
  const noseRootVisibilityPlan = buildNoseRootIntersectionVisibilityPlan({
    curves: refined.curves,
    faceWidthPx: workingFaceWidth,
  });
  noseRootVisibilityPlan.geometryMaximumDeltaPx =
    noseRootVisibilityGeometryMaximumDelta(refined.curves, noseRootGeometrySnapshot);
  noseRootVisibilityPlan.contracts.geometryUnchanged =
    noseRootVisibilityPlan.geometryMaximumDeltaPx === 0;
  for (const record of noseRootVisibilityPlan.hiddenCurves) {
    Object.assign(refined.lines[record.curveIndex], {
      nose_root_visibility_hidden_point_runs: record.hiddenPointRuns.map((run) => [...run]),
      nose_root_visibility_hidden_point_count: record.hiddenPointCount,
    });
  }
  const noseRootVisibilityAudit = noseRootVisibilityDiagnostic(noseRootVisibilityPlan);
  Object.assign(refined.diagnostics, {
    algorithm: "regional-wrinkle-guided-plus-direct-nose-rstl-intersection-only-7.6",
    regional_refinement_algorithm: regionalRefinementAlgorithm,
    source_nose_dorsum_wrinkles_excluded_from_refinement: true,
    direct_nose_dorsum_rstl: directNoseDorsum.diagnostics,
    direct_nose_dorsum_generated_curve_count: directNoseCurves.length,
    base_rstl_curve_count: baseCurveCount,
    curve_count: refined.curves.length,
    point_count: refined.curves.reduce((sum, curve) => sum + curve.pts.length, 0),
    personalized_curve_extension_contract_preserved:
      directNoseCurves.length === DIRECT_NOSE_DORSUM_FINE_LINE_IDS.length,
    nose_root_intersection_visibility: noseRootVisibilityAudit,
  });
  refined.audit.directNoseDorsumRstl = {
    ...directNoseDorsum.diagnostics,
    generatedCurveIndices: directNoseCurves.map((curve) => curve.curveIndex),
  };
  refined.audit.noseRootIntersectionVisibility = noseRootVisibilityAudit;
  const refinementModeContractViolated = V9_REFINEMENT_REPLAY ?
    refined.diagnostics.algorithm !==
      "regional-wrinkle-guided-plus-direct-nose-rstl-intersection-only-7.6" ||
      refined.diagnostics.regional_refinement_algorithm !==
        "regional-wrinkle-guided-smooth-rstl-refinement-7.2" ||
      refined.diagnostics.two_sided_nearest_matching !== true ||
      refined.diagnostics.forehead_nearest_single_curve_matching !== true ||
      refined.diagnostics.forehead_single_curve_selected_count < 3 ||
      refined.diagnostics.forehead_bundle_coherence?.applied !== true ||
      refined.diagnostics.forehead_bundle_coherence?.anchorReplayMaximumErrorPx > 1e-6 ||
      refined.diagnostics.forehead_bundle_coherence?.afterSpacing?.minimumRatio < 0.65 ||
      refined.diagnostics.forehead_bundle_coherence?.afterSpacing?.maximumRatio > 1.45 ||
      refined.diagnostics.forehead_bundle_coherence?.afterSpacing?.orderPreserved !== true ||
      refined.diagnostics.forehead_bundle_coherence?.maximumTurnDegrees > 8 ||
      refined.diagnostics.forehead_bundle_coherence?.newIntersectionPairs?.length !== 0 ||
      refined.diagnostics.forehead_bundle_coherence?.newSelfCrossCurveCount !== 0 ||
      refined.diagnostics.glabellar_single_curve_selected_count < 2 ||
      refined.diagnostics.nose_bridge_single_curve_selected_count !== 0 ||
      refined.diagnostics.nose_bridge_planar_warp?.applied === true ||
      refined.diagnostics.direct_nose_dorsum_generated_curve_count !== 3 ||
      refined.diagnostics.crows_feet_single_curve_selected_count < 7 ||
      refined.diagnostics.maximum_selected_rstl_curves_per_wrinkle > 2 ||
      refined.diagnostics.curve_unique_wrinkle_ownership !== true ||
      refined.diagnostics.wrinkle_with_single_side_selected_count !== 0 ||
      refined.diagnostics.bundle_propagation_enabled === true ||
      refined.diagnostics.curvature_fairing_enabled !== true ||
      refined.diagnostics.curvature_fairing_contract_preserved !== true ||
      refined.diagnostics.post_fairing_adherence_contract_preserved !== true ||
      refined.diagnostics.personalized_curve_extension_contract_preserved !== true ||
      noseRootVisibilityPlan.applied !== true ||
      noseRootVisibilityPlan.preservedCurveIndices.length !==
        NOSE_ROOT_PRESERVED_CURVE_NAMES.length ||
      noseRootVisibilityPlan.directNoseCurveIndices.length !== 3 ||
      noseRootVisibilityPlan.contracts.preservedTrajectoryIntersectionGapCurveCount !== 4 ||
      noseRootVisibilityPlan.contracts.visiblePreservedDirectIntersectionCount !== 0 ||
      noseRootVisibilityPlan.hiddenCurveCount !== 4 ||
      noseRootVisibilityPlan.hiddenPointCount < 1 ||
      noseRootVisibilityPlan.contracts.nonIntersectionCurveChangedPointCount !== 0 ||
      noseRootVisibilityPlan.contracts.visibilityOutsideRoiChangedPointCount !== 0 ||
      noseRootVisibilityPlan.contracts.geometryUnchanged !== true ||
      noseRootVisibilityPlan.geometryMaximumDeltaPx !== 0 ||
      refined.diagnostics.bundle_minimum_spacing_ratio < 0.65 :
    refined.diagnostics.nearest_single_curve_matching !== true ||
      refined.diagnostics.maximum_selected_rstl_curves_per_wrinkle > 1 ||
      refined.diagnostics.bundle_propagation_enabled === true;
  if (!refined.diagnostics.topology_contract_preserved ||
      refinementModeContractViolated ||
      refined.diagnostics.post_export_new_intersection_pair_count !== 0 ||
      refined.diagnostics.post_export_new_self_cross_curve_count !== 0) {
    const worstSpacing = [...(refined.diagnostics.bundle_follower_records || [])]
      .sort((left, right) => left.minimum_spacing_ratio - right.minimum_spacing_ratio)[0];
    throw new Error(`V6 几何或拓扑门禁未通过：${JSON.stringify({
      topology: refined.diagnostics.topology_contract_preserved,
      intersections: refined.diagnostics.post_export_new_intersection_pair_count,
      selfIntersections: refined.diagnostics.post_export_new_self_cross_curve_count,
      postFairingAdherence:
        refined.diagnostics.post_fairing_adherence_contract_preserved,
      foreheadSingleCurveSelectedCount:
        refined.diagnostics.forehead_single_curve_selected_count,
      glabellarSingleCurveSelectedCount:
        refined.diagnostics.glabellar_single_curve_selected_count,
      noseBridgeSingleCurveSelectedCount:
        refined.diagnostics.nose_bridge_single_curve_selected_count,
      directNoseDorsumGeneratedCurveCount:
        refined.diagnostics.direct_nose_dorsum_generated_curve_count,
      crowsFeetSingleCurveSelectedCount:
        refined.diagnostics.crows_feet_single_curve_selected_count,
      bothSidesSelectedCount:
        refined.diagnostics.wrinkle_with_both_sides_selected_count,
      postFairingAdherenceFailures:
        (refined.diagnostics.trajectory_adherence_records || []).filter((record) =>
          record.final_accepted && record.final_status !== "already_aligned" &&
          (record.final_mean_distance_px > record.mean_distance_threshold_px ||
           record.final_p90_distance_px > record.p90_distance_threshold_px ||
           record.final_direction_p90_degrees > record.direction_p90_threshold_degrees)),
      curvatureFairingFailures:
        (refined.diagnostics.curvature_fairing_events || []).filter((event) =>
          event.status === "rolled_back"),
      foreheadAdherenceRetryRecords:
        (refined.diagnostics.adherence_candidate_retry_records || []).filter((record) =>
          String(record.curvature_fairing_event?.region || "").includes("forehead")),
      spacing: refined.diagnostics.bundle_minimum_spacing_ratio,
      worstSpacing,
    })}`);
  }
  const curves = refined.curves;
  drawDecisions(workingImage, seeds, refined.audit, displayVisibility, directNoseCurves);
  drawRefined(workingImage, curves, displayVisibility, noseRootVisibilityPlan);
  drawComparison(workingImage, seeds, curves, displayVisibility, noseRootVisibilityPlan);
  drawDisplacements(
    workingImage, curves, refined.diagnostics.maximum_displacement_px, displayVisibility,
    noseRootVisibilityPlan,
  );
  drawNoseRootVisibilityArtifacts(
    workingImage, curves, displayVisibility, noseRootVisibilityPlan,
  );
  visualizationSnapshot = {
    workingSize: working.size,
    refMesh: refMesh.map((point) => [...point]),
    seeds: seeds.map((curve) => ({
      name: curve.name,
      region: curve.region,
      id: curve.id,
      tris: [...curve.tris],
      pts: curve.pts.map((point) => [...point]),
    })),
    curves: curves.map((curve) => ({
      name: curve.name,
      region: curve.region,
      id: curve.id,
      tris: [...(seeds[curve.id]?.tris || [])],
      pts: curve.pts.map((point) => [...point]),
    })),
    diagnostics: refined.diagnostics,
  };

  const { atlas: activeAtlas, fallbackPointCount, replayDiagnostics } = buildActiveAtlas(
    atlas, curves, refMesh, triangles, refined.diagnostics,
  );
  activeAtlas.visibility = {
    noseRootIntersection: noseRootVisibilityAudit,
  };
  for (const record of noseRootVisibilityPlan.hiddenCurves) {
    activeAtlas.lines[record.curveIndex].visibility = {
      algorithm: noseRootVisibilityPlan.algorithm,
      hiddenPointRuns: record.hiddenPointRuns.map((run) => [...run]),
    };
  }
  if (fallbackPointCount !== 0 ||
      !Number.isFinite(replayDiagnostics.replay_max_error_px) ||
      replayDiagnostics.post_expansion_correction_maximum_px >
        replayDiagnostics.post_expansion_correction_limit_px ||
      replayDiagnostics.replay_p90_error_px > 0.10 ||
      replayDiagnostics.replay_max_error_px > 1.0) {
    throw new Error(
      "个性化 atlas 重新映射未达到 1 像素精度门禁：" +
      `fallback=${fallbackPointCount}, p90=${replayDiagnostics.replay_p90_error_px.toFixed(3)}, ` +
      `max=${replayDiagnostics.replay_max_error_px.toFixed(3)}, ` +
      `correctionMax=${replayDiagnostics.post_expansion_correction_maximum_px.toFixed(3)}, ` +
      `correctionLimit=${replayDiagnostics.post_expansion_correction_limit_px.toFixed(3)}, ` +
      `curve=${replayDiagnostics.replay_max_error_curve_index}, ` +
      `point=${replayDiagnostics.replay_max_error_point_index}, ` +
      `detail=${JSON.stringify({
        expected: replayDiagnostics.replay_max_error_expected_xy,
        actual: replayDiagnostics.replay_max_error_actual_xy,
        base: replayDiagnostics.replay_max_error_base_xy,
        bary: replayDiagnostics.replay_max_error_base_bary,
        curve: (() => {
          const curveIndex = replayDiagnostics.replay_max_error_curve_index;
          const pointIndex = replayDiagnostics.replay_max_error_point_index;
          const curve = curves[curveIndex];
          return {
            name: curve?.name,
            normalOffset: curve?.normalOffsetsPx?.[pointIndex],
            intervals: curve?.affectedIntervals,
            neighborhood: curve?.pts?.slice(Math.max(0, pointIndex - 4), pointIndex + 5)
              .map((point, localIndex) => {
                const index = Math.max(0, pointIndex - 4) + localIndex;
                return { index, point, prior: curve?.priorPts?.[index],
                  offset: curve?.normalOffsetsPx?.[index] };
              }),
          };
        })(),
      })}`,
    );
  }
  const artifacts = buildArtifacts({
    file, sourceSha256, atlas, modelManifest, detection, fused, fineEvidence, guidanceEvidence,
    fineLineSource, refined, masks, activeAtlas, fallbackPointCount,
    refMesh, workingSize: working.size,
  });
  const acceptedTrends = refined.audit.wrinkleTrends.filter((trend) => trend.finalAccepted).length;
  const rejectedTrends = refined.audit.wrinkleTrends.length - acceptedTrends;
  const bundleSummary = BUNDLE_PROPAGATION ?
    ` · ${refined.diagnostics.bundle_follower_moved_curve_count} 条邻线传播` : "";
  const summary = `${fineEvidence.lines.length} 条 v10 中心线 · ` +
    `${detection.detections.length} 个 YOLO 原始检测 · ${acceptedTrends} 段采用 · ` +
    `${rejectedTrends} 段拒绝 · ${refined.diagnostics.moved_curve_count} 条 RSTL 被微调 · ` +
    `${refined.diagnostics.direct_nose_dorsum_generated_curve_count} 条鼻背 RSTL 直接生成 · ` +
    `鼻根区域隐藏 ${noseRootVisibilityPlan.hiddenCurveCount} 条交叉线的 ` +
    `${noseRootVisibilityPlan.hiddenPointCount} 个采样点` +
    bundleSummary;
  experiment = { artifacts, summary, sourceSha256, detection, refined, activeAtlas };
  exportButton.disabled = false;
  setStatus("实验完成，结果尚未接入正式 atlas。", summary);
  return { summary, artifacts, diagnostics: refined.diagnostics };
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  try {
    await runExperiment(imageInput.files?.[0]);
  } catch (error) {
    console.error(error);
    setStatus(`实验失败：${error?.message || error}`);
  } finally {
    runButton.disabled = false;
  }
});
exportButton.addEventListener("click", exportAll);

for (const canvas of Object.values(canvases)) {
  const context = canvas.getContext("2d");
  context.fillStyle = "#111827";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

window.__wrinkleRstlExperiment = {
  runFile: runExperiment,
  detectLandmarksFile,
  exportAll,
  artifactData,
  getState: () => experiment,
  getVisualizationSnapshot: () => visualizationSnapshot,
};
