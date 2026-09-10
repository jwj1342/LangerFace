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
import { LiveFrameScheduler } from "./liveFrameScheduler.ts";
import { liveBenchmark } from "./liveBenchmark.ts";
import {
  updateLiveWrinkleMeshTracking,
  updateLiveWrinkleTracking,
} from "./liveWrinkleAnalysis.ts";

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
  const sample = liveBenchmark()?.current;
  if (sample) {
    sample.stages.handDetector = 0;
    sample.stages.handMasks = 0;
    sample.handCount = 0;
    sample.handDetectorRan = false;
  }
  if (!renderState.handOcc) return [];
  const imageMode = currentLiveSourceKind() === "image";
  const detector = (imageMode ? modelState.imageHandLandmarker : modelState.handLandmarker) as HandDetector | null;
  if (!detector) return [];
  const start = sample ? performance.now() : 0;
  const result = imageMode
    ? detector.detect?.(currentLiveSource())
    : detector.detectForVideo(liveBenchmark()?.handInput === "canvas" ? els.canvas : currentLiveSource(), timeMs);
  const maskStart = sample ? performance.now() : 0;
  if (sample) {
    sample.stages.handDetector = maskStart - start;
    sample.handCount = result?.landmarks?.length || 0;
    sample.handDetectorRan = true;
  }
  if (!result?.landmarks || !result.landmarks.length) return [];
  const margin = Math.max(5, width * 0.006);
  const masks = buildHandMasks(result.landmarks.map((hand) => toPixels(hand, width, height).map((point) => [point[0], point[1]] as [number, number])), 0.16, margin);
  if (sample) sample.stages.handMasks = performance.now() - maskStart;
  return masks;
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
  const video = liveBenchmark()?.scheduler !== "animation"
    && currentLiveSourceKind() !== "image" ? currentLiveSource() as HTMLVideoElement : null;
  frameScheduler.request(loop, video);
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
  const benchmark = liveBenchmark();
  const sample = benchmark?.recording ? {
    wallTime: performance.now(), mediaTime: source.currentTime || 0,
    presentedFrames: benchmark.presented?.presentedFrames,
    presentedMediaTime: benchmark.presented?.mediaTime,
    expectedDisplayTime: benchmark.presented?.expectedDisplayTime,
    stages: {} as Record<string, number>,
  } : null;
  if (benchmark) benchmark.current = sample || undefined;
  ctx.drawImage(source, 0, 0, width, height);
  const timeMs = performance.now();
  if (sample) sample.stages.capture = timeMs - sample.wallTime;

  let landmarks: Vec3[] | null = null;
  let wrinkleLandmarks: Vec3[] | null = null;
  let hulls: HandMask[] = [];
  if (sourceKind === "image") {
    if (!sourceState.imageDetectionComplete) {
      sourceState.imageDetectionComplete = true;
      const outcome = detectStaticImageWithRetries(
        modelState.imageLandmarker as StaticImageDetector | null,
        source,
      );
      sourceState.imageDetectionAttempts = outcome.attempts;
      const result = outcome.result;
      const imageFaces = result?.faceLandmarks || [];
      sourceState.imageCacheLM = imageFaces.length === 1 ? toPixels(imageFaces[0], width, height) : null;
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
    // Static image detection runs inside the render loop. Notify controls after
    // the cached landmarks are committed so wrinkle/refine buttons reflect the
    // ready state without starting wrinkle analysis automatically.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("langerface:source-frame-ready"));
    }
  } else if (source.currentTime !== undefined) {
    const landmarker = modelState.landmarker as VideoDetector | null;
    // Detect the pixels already copied for display, so video advancement cannot
    // put landmarks and wrinkle evidence on different frames.
    const faceStart = sample ? performance.now() : 0;
    const result = landmarker?.detectForVideo(els.canvas, timeMs);
    const facePostStart = sample ? performance.now() : 0;
    if (sample) sample.stages.faceDetector = facePostStart - faceStart;
    updateFaceExpression(result?.faceBlendshapes);
    if (result?.faceLandmarks && result.faceLandmarks.length) {
      const currentLandmarks = toPixels(result.faceLandmarks[0], width, height);
      wrinkleLandmarks = currentLandmarks.map((point) => [...point] as Vec3);
      landmarks = currentLandmarks;
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
    if (sample) sample.stages.facePostprocess = performance.now() - facePostStart;
    hulls = detectHands(timeMs, width, height);
  }
  sourceState.lastHulls = hulls;
  const trackingStart = sample ? performance.now() : 0;
  if (sample) sample.stages.landmarksAndHands = trackingStart - timeMs;
  if (sourceKind === "camera" || sourceKind === "video") {
    updateLiveWrinkleTracking(wrinkleLandmarks || [], timeMs);
    updateLiveWrinkleMeshTracking(els.canvas, wrinkleLandmarks || []);
  }
  if (sample) sample.stages.wrinkleTracking = performance.now() - trackingStart;

  let lineCount = 0;
  if (landmarks && sourceState.presence > 0) {
    const displayLandmarks = landmarks;
    try {
      const drawStart = sample ? performance.now() : 0;
      lineCount = draw(displayLandmarks, width, height, hulls);
      const zoomStart = sample ? performance.now() : 0;
      if (sample) sample.stages.mainDraw = zoomStart - drawStart;
      drawZooms(displayLandmarks, width);
      const focusStart = sample ? performance.now() : 0;
      if (sample) sample.stages.zooms = focusStart - zoomStart;
      drawFocusedRegion(displayLandmarks, width, height);
      if (sample) sample.stages.focus = performance.now() - focusStart;
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
  if (sample && benchmark) {
    sample.stages.total = now - sample.wallTime;
    benchmark.samples.push(sample);
    benchmark.current = undefined;
  }
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
