// 主循环 + 渲染调度 + FPS + 手部遮挡检测：从 pipeline.js 原样拆出（SRP，见 #45）。
// detectHands 仅被本主循环消费，放在此处可避免 source ↔ loop 的循环依赖。
import { ctx, els } from "../dom.js";
import { buildHandMasks, toPixels } from "../geometry.js";
import { countMetric, logWarn, recordMetricSample } from "../logger.js";
import { projectVerts } from "../projection3d.js";
import { clearZooms, draw, drawFocusedRegion, drawZooms, updateStats } from "../render.js";
import { modelState, renderState, sourceState } from "../state.js";

// 检测手部 → 凸包列表（图像空间），落在其中的脸部线点将被剔除
export function detectHands(t, W, H) {
  if (!renderState.handOcc || !modelState.handLandmarker) return [];
  const hr = modelState.handLandmarker.detectForVideo(sourceState.source, t);
  if (!hr.landmarks || !hr.landmarks.length) return [];
  const margin = Math.max(5, W * 0.006);
  return buildHandMasks(hr.landmarks.map((h) => toPixels(h, W, H)), 0.16, margin);
}

// ── 主循环 ────────────────────────────────────────────────────────────────────
let fpsEMA = 0, lastT = performance.now();
let drawFailureLogged = false;
let frameScheduled = false;
let frameMetricsSeen = 0;

function blendshapeScore(categories, names) {
  if (!Array.isArray(categories)) return 0;
  for (const name of names) {
    const hit = categories.find((c) => c.categoryName === name);
    if (hit && Number.isFinite(hit.score)) return hit.score;
  }
  return 0;
}

function updateFaceExpression(faceBlendshapes = []) {
  const categories = faceBlendshapes[0]?.categories || [];
  sourceState.jawOpen = blendshapeScore(categories, ["jawOpen"]);
  sourceState.eyeBlinkLeft = blendshapeScore(categories, ["eyeBlinkLeft", "eyeBlink_L"]);
  sourceState.eyeBlinkRight = blendshapeScore(categories, ["eyeBlinkRight", "eyeBlink_R"]);
}

export function requestFrame() {
  if (!sourceState.running || sourceState.paused || frameScheduled) return;
  frameScheduled = true;
  requestAnimationFrame(loop);
}

export function loop() {
  frameScheduled = false;
  if (!sourceState.running || sourceState.paused) return;
  const W = els.canvas.width, H = els.canvas.height;
  ctx.drawImage(sourceState.source, 0, 0, W, H);
  const t = performance.now();

  let lm = null, hulls = [];
  if (sourceState.sourceKind === "image") {
    if (!sourceState.imageCacheLM) {
      const res = modelState.landmarker.detectForVideo(sourceState.source, t);
      sourceState.imageCacheLM = (res.faceLandmarks && res.faceLandmarks[0]) ? toPixels(res.faceLandmarks[0], W, H) : null;
      updateFaceExpression(res.faceBlendshapes);
      sourceState.imageHulls = detectHands(t, W, H);
    } else if (renderState.handOcc && sourceState.imageHulls === null) {
      sourceState.imageHulls = detectHands(t, W, H);
    }
    lm = sourceState.imageCacheLM; hulls = renderState.handOcc ? sourceState.imageHulls || [] : [];
    sourceState.presence = lm ? 1 : 0;
  } else if (sourceState.source.currentTime !== undefined) {
    const res = modelState.landmarker.detectForVideo(sourceState.source, t);
    updateFaceExpression(res.faceBlendshapes);
    if (res.faceLandmarks && res.faceLandmarks.length) {
      lm = toPixels(res.faceLandmarks[0], W, H);
      if (renderState.smoothLevel > 0) lm = renderState.smoother.filter(lm, t / 1000);
      sourceState.lastLM = lm; sourceState.presence = Math.min(1, sourceState.presence + 0.34);
    } else {
      sourceState.presence = Math.max(0, sourceState.presence - 0.16);
      if (sourceState.presence <= 0) { renderState.smoother.reset(); sourceState.lastLM = null; }
      lm = sourceState.lastLM;
    }
    hulls = detectHands(t, W, H);
  }

  let lineCount = 0;
  if (lm && sourceState.presence > 0) {
    const dlm = projectVerts(lm);
    try {
      lineCount = draw(dlm, W, H, hulls);
      drawZooms(dlm, W);
      drawFocusedRegion(dlm, W, H);
      drawFailureLogged = false;
    } catch (e) {
      if (!drawFailureLogged) logWarn("渲染图谱失败，本帧已跳过。", e);
      drawFailureLogged = true;
      clearZooms();
    }
  }
  else clearZooms();
  updateStats(lm, W, H, lineCount);

  const now = performance.now();
  fpsEMA = fpsEMA ? fpsEMA * 0.9 + (1000 / Math.max(1, now - lastT)) * 0.1 : 30;
  frameMetricsSeen += 1;
  if (sourceState.sourceKind !== "image" && frameMetricsSeen % 30 === 0) {
    const detail = {
      phase: "frame",
      sourceKind: sourceState.sourceKind,
      facePresent: Boolean(lm && sourceState.presence > 0),
      lineCount,
      canvasWidth: W,
      canvasHeight: H,
    };
    recordMetricSample("frame.fps", Number(fpsEMA.toFixed(2)), detail);
    recordMetricSample("frame.durationMs", Number((now - t).toFixed(2)), detail);
    if (!detail.facePresent) countMetric(`faceLandmarker.noFaceFrame.${sourceState.sourceKind || "unknown"}`);
  }
  lastT = now; els.fps.textContent = fpsEMA.toFixed(0) + " fps";
  if (sourceState.sourceKind !== "image") requestFrame();
}
