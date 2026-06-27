import { ctx, els } from "./liveDom.ts";
import { toPixels, type NormalizedLandmark } from "./geometryAtlas.ts";
import { buildHandMasks, type HandMask } from "./geometryOccluders.ts";
import type { Vec3 } from "./softBody.ts";
import { countMetric, logWarn, recordMetricSample } from "./logger.ts";
import { projectVerts } from "./projection3d.ts";
import { clearZooms, draw, drawFocusedRegion, drawZooms, updateStats } from "./render2d.ts";
import { modelState, renderState, sourceState } from "./liveState.ts";

interface VideoDetector {
  detectForVideo: (source: unknown, timeMs: number) => {
    faceLandmarks?: NormalizedLandmark[][];
    faceBlendshapes?: Array<{ categories?: BlendshapeCategory[] }>;
    landmarks?: NormalizedLandmark[][];
  };
}

interface BlendshapeCategory {
  categoryName?: string;
  score?: number;
}

export function detectHands(timeMs: number, width: number, height: number): HandMask[] {
  if (!renderState.handOcc || !modelState.handLandmarker) return [];
  const detector = modelState.handLandmarker as VideoDetector;
  const result = detector.detectForVideo(sourceState.source, timeMs);
  if (!result.landmarks || !result.landmarks.length) return [];
  const margin = Math.max(5, width * 0.006);
  return buildHandMasks(result.landmarks.map((hand) => toPixels(hand, width, height).map((point) => [point[0], point[1]] as [number, number])), 0.16, margin);
}

let fpsEMA = 0;
let lastT = performance.now();
let drawFailureLogged = false;
let frameScheduled = false;
let frameMetricsSeen = 0;

function blendshapeScore(categories: BlendshapeCategory[] | undefined, names: string[]): number {
  if (!Array.isArray(categories)) return 0;
  for (const name of names) {
    const hit = categories.find((category) => category.categoryName === name);
    if (hit && Number.isFinite(hit.score)) return hit.score as number;
  }
  return 0;
}

function updateFaceExpression(faceBlendshapes: Array<{ categories?: BlendshapeCategory[] }> = []): void {
  const categories = faceBlendshapes[0]?.categories || [];
  sourceState.jawOpen = blendshapeScore(categories, ["jawOpen"]);
  sourceState.eyeBlinkLeft = blendshapeScore(categories, ["eyeBlinkLeft", "eyeBlink_L"]);
  sourceState.eyeBlinkRight = blendshapeScore(categories, ["eyeBlinkRight", "eyeBlink_R"]);
}

export function requestFrame(): void {
  if (!sourceState.running || sourceState.paused || frameScheduled) return;
  frameScheduled = true;
  requestAnimationFrame(loop);
}

export function loop(): void {
  frameScheduled = false;
  if (!sourceState.running || sourceState.paused) return;
  if (!ctx) return;
  const source = sourceState.source as (CanvasImageSource & { currentTime?: number }) | null;
  if (!source) return;
  const width = els.canvas.width;
  const height = els.canvas.height;
  ctx.drawImage(source, 0, 0, width, height);
  const timeMs = performance.now();

  let landmarks: Vec3[] | null = null;
  let hulls: HandMask[] = [];
  const landmarker = modelState.landmarker as VideoDetector | null;
  if (sourceState.sourceKind === "image") {
    if (!sourceState.imageCacheLM) {
      const result = landmarker?.detectForVideo(source, timeMs);
      sourceState.imageCacheLM = (result?.faceLandmarks && result.faceLandmarks[0]) ? toPixels(result.faceLandmarks[0], width, height) : null;
      updateFaceExpression(result?.faceBlendshapes);
      sourceState.imageHulls = detectHands(timeMs, width, height);
    } else if (renderState.handOcc && sourceState.imageHulls === null) {
      sourceState.imageHulls = detectHands(timeMs, width, height);
    }
    landmarks = sourceState.imageCacheLM as Vec3[] | null;
    hulls = renderState.handOcc ? (sourceState.imageHulls as HandMask[] | null) || [] : [];
    sourceState.presence = landmarks ? 1 : 0;
  } else if (source.currentTime !== undefined) {
    const result = landmarker?.detectForVideo(source, timeMs);
    updateFaceExpression(result?.faceBlendshapes);
    if (result?.faceLandmarks && result.faceLandmarks.length) {
      landmarks = toPixels(result.faceLandmarks[0], width, height);
      if (renderState.smoothLevel > 0) landmarks = renderState.smoother.filter(landmarks, timeMs / 1000);
      sourceState.lastLM = landmarks;
      sourceState.presence = Math.min(1, sourceState.presence + 0.34);
    } else {
      sourceState.presence = Math.max(0, sourceState.presence - 0.16);
      if (sourceState.presence <= 0) {
        renderState.smoother.reset();
        sourceState.lastLM = null;
      }
      landmarks = sourceState.lastLM as Vec3[] | null;
    }
    hulls = detectHands(timeMs, width, height);
  }

  let lineCount = 0;
  if (landmarks && sourceState.presence > 0) {
    const displayLandmarks = projectVerts(landmarks);
    try {
      lineCount = draw(displayLandmarks, width, height, hulls);
      drawZooms(displayLandmarks, width);
      drawFocusedRegion(displayLandmarks, width, height);
      drawFailureLogged = false;
    } catch (error) {
      if (!drawFailureLogged) logWarn("渲染图谱失败，本帧已跳过。", error);
      drawFailureLogged = true;
      clearZooms();
    }
  } else {
    clearZooms();
  }
  updateStats(landmarks, width, height, lineCount);

  const now = performance.now();
  fpsEMA = fpsEMA ? fpsEMA * 0.9 + (1000 / Math.max(1, now - lastT)) * 0.1 : 30;
  frameMetricsSeen += 1;
  if (sourceState.sourceKind !== "image" && frameMetricsSeen % 30 === 0) {
    const detail = {
      phase: "frame",
      sourceKind: sourceState.sourceKind,
      facePresent: Boolean(landmarks && sourceState.presence > 0),
      lineCount,
      canvasWidth: width,
      canvasHeight: height,
    };
    recordMetricSample("frame.fps", Number(fpsEMA.toFixed(2)), detail);
    recordMetricSample("frame.durationMs", Number((now - timeMs).toFixed(2)), detail);
    if (!detail.facePresent) countMetric(`faceLandmarker.noFaceFrame.${sourceState.sourceKind || "unknown"}`);
  }
  lastT = now;
  els.fps.textContent = `${fpsEMA.toFixed(0)} fps`;
  if (sourceState.sourceKind !== "image") requestFrame();
}
