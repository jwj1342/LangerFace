import { ctx, els } from "./liveDom.ts";
import { toPixels, type NormalizedLandmark } from "./geometryAtlas.ts";
import { buildHandMasks, type HandMask } from "./geometryOccluders.ts";
import type { Vec3 } from "./softBody.ts";
import { countMetric, logWarn, recordMetricSample } from "./logger.ts";
import { clearZooms, draw, drawFocusedRegion, drawZooms, updateStats } from "./render2d.ts";
import {
  currentLiveSource,
  currentLiveSourceKind,
  modelState,
  renderState,
  sourceState,
} from "./liveState.ts";
import { setMsg } from "./liveUi.ts";
import {
  detectStaticImageWithRetries,
  type StaticImageDetector,
} from "./staticImageDetection.ts";
import { updateWrinkleUi } from "./liveWrinkleAnalysis.ts";
import { LiveFrameScheduler } from "./liveFrameScheduler.ts";

interface VideoDetector {
  detectForVideo: (source: unknown, timeMs: number) => {
    faceLandmarks?: NormalizedLandmark[][];
    faceBlendshapes?: Array<{ categories?: BlendshapeCategory[] }>;
    landmarks?: NormalizedLandmark[][];
  };
}

interface HandDetector extends VideoDetector {
  detect?: (source: unknown) => {
    landmarks?: NormalizedLandmark[][];
  };
}

interface BlendshapeCategory {
  categoryName?: string;
  score?: number;
}

export function detectHands(timeMs: number, width: number, height: number): HandMask[] {
  if (!renderState.handOcc) return [];
  const imageMode = currentLiveSourceKind() === "image";
  const detector = (imageMode ? modelState.imageHandLandmarker : modelState.handLandmarker) as HandDetector | null;
  if (!detector) return [];
  const result = imageMode
    ? detector.detect?.(currentLiveSource())
    : detector.detectForVideo(currentLiveSource(), timeMs);
  if (!result?.landmarks || !result.landmarks.length) return [];
  const margin = Math.max(5, width * 0.006);
  return buildHandMasks(result.landmarks.map((hand) => toPixels(hand, width, height).map((point) => [point[0], point[1]] as [number, number])), 0.16, margin);
}

let fpsEMA = 0;
let lastT = performance.now();
let drawFailureLogged = false;
let frameMetricsSeen = 0;
const frameScheduler = new LiveFrameScheduler();

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
  if (!sourceState.running || sourceState.paused) return;
  frameScheduler.request(loop);
}

export function cancelFrame(): void {
  frameScheduler.cancel();
}

export function loop(): void {
  if (!sourceState.running || sourceState.paused) return;
  if (!ctx) return;
  const source = currentLiveSource() as (CanvasImageSource & { currentTime?: number }) | null;
  if (!source) return;
  const sourceKind = currentLiveSourceKind();
  const width = els.canvas.width;
  const height = els.canvas.height;
  ctx.drawImage(source, 0, 0, width, height);
  const timeMs = performance.now();

  let landmarks: Vec3[] | null = null;
  let hulls: HandMask[] = [];
  if (sourceKind === "image") {
    if (!sourceState.imageDetectionComplete) {
      sourceState.imageDetectionComplete = true;
      const detectionStartedAt = performance.now();
      const outcome = detectStaticImageWithRetries(
        modelState.imageLandmarker as StaticImageDetector | null,
        source,
      );
      recordMetricSample("source.imageFaceDetectionMs", performance.now() - detectionStartedAt, {
        attempts: outcome.attempts,
      });
      sourceState.imageDetectionAttempts = outcome.attempts;
      const result = outcome.result;
      const imageFaces = result?.faceLandmarks || [];
      sourceState.imageCacheLM = imageFaces.length === 1 ? toPixels(imageFaces[0], width, height) : null;
      updateWrinkleUi();
      sourceState.planning2d?.setDetection({
        sourceRevision: sourceState.planning2d.sourceRevision(),
        status: sourceState.imageCacheLM ? "ready" : "failed",
        landmarks: sourceState.imageCacheLM,
        attempts: outcome.attempts,
        reason: sourceState.imageCacheLM
          ? ""
          : imageFaces.length > 1
            ? "multiple_faces"
            : outcome.error
              ? "detection_error"
              : "no_face",
      });
      updateFaceExpression(result?.faceBlendshapes);
      sourceState.imageHulls = detectHands(timeMs, width, height);
      if (!sourceState.imageCacheLM) {
        countMetric("faceLandmarker.noFaceImage");
        if (outcome.error) logWarn("静态图片检测失败。", outcome.error);
        setMsg(imageFaces.length > 1
          ? "检测到多张人脸。请上传仅包含一位受试者的照片。"
          : outcome.error
            ? `图片检测失败（已尝试 ${outcome.attempts} 次）。请重新上传；若仍失败，请换一张正面清晰的照片。`
            : `未检测到人脸（已尝试 ${outcome.attempts} 次）。请换用正面、清晰、光线充足的照片后重新上传。`);
      }
    } else if (renderState.handOcc && sourceState.imageHulls === null) {
      sourceState.imageHulls = detectHands(timeMs, width, height);
    }
    landmarks = sourceState.imageCacheLM as Vec3[] | null;
    hulls = renderState.handOcc ? (sourceState.imageHulls as HandMask[] | null) || [] : [];
    sourceState.presence = landmarks ? 1 : 0;
  } else if (source.currentTime !== undefined) {
    const landmarker = modelState.landmarker as VideoDetector | null;
    const result = landmarker?.detectForVideo(source, timeMs);
    updateFaceExpression(result?.faceBlendshapes);
    if (result?.faceLandmarks && result.faceLandmarks.length) {
      landmarks = toPixels(result.faceLandmarks[0], width, height);
      if (renderState.smoothLevel > 0) landmarks = renderState.smoother.filter(landmarks, timeMs / 1000);
      sourceState.lastLM = landmarks;
      if (sourceState.planning2d?.getSnapshot().detection.status !== "ready") {
        sourceState.planning2d?.setDetection({
          sourceRevision: sourceState.planning2d.sourceRevision(),
          status: "ready",
          landmarks,
          attempts: 1,
        });
      }
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
  sourceState.lastHulls = hulls;

  let lineCount = 0;
  if (landmarks && sourceState.presence > 0) {
    const displayLandmarks = landmarks;
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
  const incisionOverlay = renderState.incisionOverlay as Record<string, any> | null;
  sourceState.planning2d?.setOverlaySummary({
    rstlLineCount: lineCount,
    tumorVisible: Boolean(incisionOverlay?.tumor?.center_ref),
    candidatePointCount: incisionOverlay?.candidate?.polyline_refs?.length || 0,
  });

  const now = performance.now();
  fpsEMA = fpsEMA ? fpsEMA * 0.9 + (1000 / Math.max(1, now - lastT)) * 0.1 : 30;
  frameMetricsSeen += 1;
  if (sourceKind !== "image" && frameMetricsSeen % 30 === 0) {
    const detail = {
      phase: "frame",
      sourceKind,
      facePresent: Boolean(landmarks && sourceState.presence > 0),
      lineCount,
      canvasWidth: width,
      canvasHeight: height,
    };
    recordMetricSample("frame.fps", Number(fpsEMA.toFixed(2)), detail);
    recordMetricSample("frame.durationMs", Number((now - timeMs).toFixed(2)), detail);
    if (!detail.facePresent) countMetric(`faceLandmarker.noFaceFrame.${sourceKind || "unknown"}`);
  }
  lastT = now;
  els.fps.textContent = `${fpsEMA.toFixed(0)} fps`;
  if (sourceKind !== "image") requestFrame();
}

export function redrawPausedFrame(): boolean {
  if (!sourceState.running || !sourceState.paused || !sourceState.frozenFrame || !ctx) return false;
  const width = els.canvas.width;
  const height = els.canvas.height;
  ctx.drawImage(sourceState.frozenFrame, 0, 0, width, height);
  const landmarks = sourceState.lastLM ? sourceState.lastLM as Vec3[] : null;
  let lineCount = 0;
  if (landmarks && sourceState.presence > 0) {
    lineCount = draw(landmarks, width, height, sourceState.lastHulls as HandMask[]);
    drawZooms(landmarks, width);
    drawFocusedRegion(landmarks, width, height);
  }
  updateStats(landmarks, width, height, lineCount);
  return true;
}
