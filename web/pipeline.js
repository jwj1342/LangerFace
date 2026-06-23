// 浏览器实时管线：摄像头/上传 → MediaPipe FaceLandmarker(客户端) → 平滑 →
// 图谱映射 → 背面剔除 + 手部遮挡 → 画布叠加。
import { FaceLandmarker, HandLandmarker, FilesetResolver }
  from "@mediapipe/tasks-vision";
import { validateAtlas } from "./atlas_contract.js";
import { assetUrls } from "./assets.js";
import { clearCanvasDisplayFit, fitCanvasDisplayToStage } from "./canvas_fit.js";
import { CAMERA_CONSTRAINTS, describeCameraError, openCameraStream } from "./camera.js";
import { CDN } from "./constants.js";
import { ctx, els } from "./dom.js";
import { buildHandMasks, noseTriangles, toPixels, validateAtlasLines } from "./geometry.js";
import { prepareImageSource } from "./image_source.js";
import { countMetric, logInfo, logWarn } from "./logger.js";
import { projectVerts } from "./projection3d.js";
import { clearZooms, draw, drawFocusedRegion, drawZooms, updateStats } from "./render.js";
import { modelState, renderState, sourceState } from "./state.js";
import { setLive, setMsg } from "./ui.js";

// ── 资产 / 模型加载 ───────────────────────────────────────────────────────────
export async function ensureReady() {
  if (modelState.landmarker) return;
  const [tri, rstl, langer] = await Promise.all([
    fetch(assetUrls.triangles).then((r) => r.json()),
    fetch(assetUrls.atlasRstl).then((r) => r.json()),
    fetch(assetUrls.atlasLanger).then((r) => r.json()),
  ]);
  const loadAtlas = (system, atlas) => {
    const issues = validateAtlas(atlas, tri.length, { expectedSystem: system });
    if (issues.length) {
      logWarn(`图谱 ${system} 校验失败。`, { issues });
      throw new Error(`图谱 ${system} 校验失败：${issues.join("；")}`);
    }
    return atlas.lines;
  };
  modelState.triangles = tri; modelState.noseTris = noseTriangles(tri);
  modelState.atlases.rstl = loadAtlas("rstl", rstl);
  modelState.atlases.langer = loadAtlas("langer", langer);
  modelState.officialAtlases.rstl = modelState.atlases.rstl;
  modelState.officialAtlases.langer = modelState.atlases.langer;
  const resolver = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const build = (delegate) => FaceLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: assetUrls.faceLandmarkerTask, delegate },
    runningMode: "VIDEO", numFaces: 1,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { modelState.landmarker = await build("GPU"); }
  catch (e) {
    countMetric("faceLandmarker.gpuFallback");
    logWarn("Face Landmarker GPU 初始化失败，回退到 CPU。", e);
    modelState.landmarker = await build("CPU");
  }

  // 手部检测器（用于前方手部遮挡）。失败不阻塞主流程。
  const buildHand = (delegate) => HandLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: assetUrls.handLandmarkerTask, delegate },
    runningMode: "VIDEO", numHands: 2,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { modelState.handLandmarker = await buildHand("GPU"); }
  catch (e) {
    countMetric("handLandmarker.gpuFallback");
    logWarn("Hand Landmarker GPU 初始化失败，回退到 CPU。", e);
    try { modelState.handLandmarker = await buildHand("CPU"); }
    catch (err) {
      countMetric("handLandmarker.loadFailure");
      logWarn("手部模型加载失败，手部遮挡功能将暂不可用。", err);
    }
  }

  els.badge.textContent = "模型就绪"; els.badge.classList.remove("loading");
  logInfo("模型与图谱加载完成。", {
    triangles: tri.length,
    rstlLines: rstl.lines.length,
    langerLines: langer.lines.length,
    handOcclusionReady: Boolean(modelState.handLandmarker),
  });
}

function requestRedraw() {
  if (sourceState.running && !sourceState.paused) requestAnimationFrame(loop);
}

function isSupportedAtlasSystem(system) {
  return system === "rstl" || system === "langer";
}

export function setActiveAtlas(system, lines) {
  if (!isSupportedAtlasSystem(system)) {
    logWarn("拒绝注入未知图谱系统。", { system });
    return false;
  }
  if (!validateAtlasLines(lines, modelState.triangles)) {
    logWarn("拒绝注入无效图谱。", { system, lineCount: Array.isArray(lines) ? lines.length : null });
    return false;
  }
  modelState.atlases[system] = lines;
  renderState.system = system;
  requestRedraw();
  return true;
}

export function restoreOfficialAtlas(system) {
  if (!isSupportedAtlasSystem(system) || !modelState.officialAtlases[system]) {
    logWarn("无法恢复官方图谱。", { system });
    return false;
  }
  modelState.atlases[system] = modelState.officialAtlases[system];
  requestRedraw();
  return true;
}

// 检测手部 → 凸包列表（图像空间），落在其中的脸部线点将被剔除
export function detectHands(t, W, H) {
  if (!renderState.handOcc || !modelState.handLandmarker) return [];
  const hr = modelState.handLandmarker.detectForVideo(sourceState.source, t);
  if (!hr.landmarks || !hr.landmarks.length) return [];
  const margin = Math.max(5, W * 0.006);
  return buildHandMasks(hr.landmarks.map((h) => toPixels(h, W, H)), 0.16, margin);
}

// ── 数据源 ────────────────────────────────────────────────────────────────────
export async function startCamera() {
  if (sourceState.sourceKind === "camera") { stopSource(); setLive(false, "待机"); els.cam.setAttribute("aria-pressed","false"); return; }
  setMsg("加载模型…");
  try {
    await ensureReady();
    setMsg("请求摄像头权限…");
    const stream = await openCameraStream(CAMERA_CONSTRAINTS);
    stopSource();
    els.video.srcObject = stream; await els.video.play();
    setSource(els.video, "camera", els.video.videoWidth, els.video.videoHeight);
    els.cam.setAttribute("aria-pressed", "true");
  } catch (e) {
    const detail = describeCameraError(e);
    countMetric(`camera.openFailure.${detail.reason}`);
    logWarn("无法开启摄像头。", { reason: detail.reason, error: e });
    els.cam.setAttribute("aria-pressed", "false");
    if (!sourceState.source) {
      showCameraPlaceholder(detail.message);
      setLive(false, "待机");
    }
    setMsg(detail.message);
  }
}

export function showCameraPlaceholder(message) {
  const W = els.canvas.width || 1280, H = els.canvas.height || 720;
  els.canvas.width = W; els.canvas.height = H;
  ctx.save();
  ctx.fillStyle = "#07111f"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,.84)";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `${Math.max(18, Math.round(W / 46))}px system-ui, sans-serif`;
  ctx.fillText(message, W / 2, H / 2);
  ctx.restore();
}

export async function handleFile(file) {
  if (!file) return;
  setMsg("加载模型…"); await ensureReady();
  stopSource();
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) {
    const img = new Image(); img.src = url; await img.decode();
    const prepared = prepareImageSource(img);
    setSource(prepared.source, "image", prepared.width, prepared.height);
    URL.revokeObjectURL(url);
    if (prepared.scaled) setMsg(`已自动降采样到 ${prepared.width}×${prepared.height}，以保证流畅。`);
  } else {
    els.video.srcObject = null; els.video.src = url; els.video.loop = true; await els.video.play();
    setSource(els.video, "video", els.video.videoWidth, els.video.videoHeight);
  }
  els.cam.setAttribute("aria-pressed", "false");
}

export function setSource(src, kind, w, h) {
  sourceState.source = src; sourceState.sourceKind = kind;
  els.canvas.width = w || 1280; els.canvas.height = h || 720;
  els.mainWrap.classList.toggle("image-viewer", kind === "image");
  els.canvas.classList.toggle("image-source", kind === "image");
  if (kind === "image") {
    fitCanvasDisplayToStage({ resetView: true });
    requestAnimationFrame(() => fitCanvasDisplayToStage({ resetView: true }));
  } else {
    clearCanvasDisplayFit();
  }
  renderState.smoother.reset();
  sourceState.presence = 0; sourceState.lastLM = null; sourceState.imageCacheLM = null; sourceState.imageHulls = null;
  sourceState.running = true; sourceState.paused = false;
  els.pause.disabled = false; els.export.disabled = false; els.pause.textContent = "⏸ 暂停";
  setMsg(null); setLive(true, kind === "camera" ? "实时摄像头" : kind === "video" ? "视频" : "照片");
  requestFrame();
}

export function stopSource() {
  const ms = els.video.srcObject;
  if (ms) ms.getTracks().forEach((t) => t.stop());
  els.video.srcObject = null; els.video.removeAttribute("src");
  sourceState.source = null; sourceState.sourceKind = null; sourceState.running = false;
  els.mainWrap.classList.remove("image-viewer");
  els.canvas.classList.remove("image-source");
  clearCanvasDisplayFit();
  sourceState.imageCacheLM = null; sourceState.imageHulls = null; sourceState.lastLM = null;
}

// ── 主循环 ────────────────────────────────────────────────────────────────────
let fpsEMA = 0, lastT = performance.now();
let drawFailureLogged = false;
let frameScheduled = false;

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
      sourceState.imageHulls = detectHands(t, W, H);
    } else if (renderState.handOcc && sourceState.imageHulls === null) {
      sourceState.imageHulls = detectHands(t, W, H);
    }
    lm = sourceState.imageCacheLM; hulls = renderState.handOcc ? sourceState.imageHulls || [] : [];
    sourceState.presence = lm ? 1 : 0;
  } else if (sourceState.source.currentTime !== undefined) {
    const res = modelState.landmarker.detectForVideo(sourceState.source, t);
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
  lastT = now; els.fps.textContent = fpsEMA.toFixed(0) + " fps";
  if (sourceState.sourceKind !== "image") requestFrame();
}
