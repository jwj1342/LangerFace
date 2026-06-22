// 浏览器实时管线：摄像头/上传 → MediaPipe FaceLandmarker(客户端) → 平滑 →
// 图谱映射 → 背面剔除 + 手部遮挡 → 画布叠加。
import { FaceLandmarker, HandLandmarker, FilesetResolver }
  from "@mediapipe/tasks-vision";
import { assetUrls } from "./assets.js";
import { CDN } from "./constants.js";
import { ctx, els } from "./dom.js";
import { buildHandMasks, noseTriangles, toPixels } from "./geometry.js";
import { projectVerts } from "./mode3d.js";
import { clearZooms, draw, drawZooms, updateStats } from "./render.js";
import { S } from "./state.js";
import { setLive, setMsg } from "./ui.js";

// ── 资产 / 模型加载 ───────────────────────────────────────────────────────────
export async function ensureReady() {
  if (S.landmarker) return;
  const [tri, rstl, langer] = await Promise.all([
    fetch(assetUrls.triangles).then((r) => r.json()),
    fetch(assetUrls.atlasRstl).then((r) => r.json()),
    fetch(assetUrls.atlasLanger).then((r) => r.json()),
  ]);
  S.triangles = tri; S.noseTris = noseTriangles(tri);
  S.atlases.rstl = rstl.lines; S.atlases.langer = langer.lines;
  const resolver = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const build = (delegate) => FaceLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: assetUrls.faceLandmarkerTask, delegate },
    runningMode: "VIDEO", numFaces: 1,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { S.landmarker = await build("GPU"); }
  catch { S.landmarker = await build("CPU"); }

  // 手部检测器（用于前方手部遮挡）。失败不阻塞主流程。
  const buildHand = (delegate) => HandLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: assetUrls.handLandmarkerTask, delegate },
    runningMode: "VIDEO", numHands: 2,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { S.handLandmarker = await buildHand("GPU"); }
  catch { try { S.handLandmarker = await buildHand("CPU"); } catch (e) { console.warn("手部模型加载失败", e); } }

  els.badge.textContent = "模型就绪"; els.badge.classList.remove("loading");
}

// 检测手部 → 凸包列表（图像空间），落在其中的脸部线点将被剔除
export function detectHands(t, W, H) {
  if (!S.handOcc || !S.handLandmarker) return [];
  const hr = S.handLandmarker.detectForVideo(S.source, t);
  if (!hr.landmarks || !hr.landmarks.length) return [];
  const margin = Math.max(5, W * 0.006);
  return buildHandMasks(hr.landmarks.map((h) => toPixels(h, W, H)), 0.16, margin);
}

// ── 数据源 ────────────────────────────────────────────────────────────────────
export async function startCamera() {
  if (S.sourceKind === "camera") { stopSource(); setLive(false, "待机"); els.cam.setAttribute("aria-pressed","false"); return; }
  setMsg("加载模型…");
  try {
    await ensureReady();
    setMsg("请求摄像头权限…");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false });
    stopSource();
    els.video.srcObject = stream; await els.video.play();
    setSource(els.video, "camera", els.video.videoWidth, els.video.videoHeight);
    els.cam.setAttribute("aria-pressed", "true");
  } catch (e) { setMsg("无法开启摄像头：" + e.message); }
}

export async function handleFile(file) {
  if (!file) return;
  setMsg("加载模型…"); await ensureReady();
  stopSource();
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) {
    const img = new Image(); img.src = url; await img.decode();
    S.imageCacheLM = null;
    setSource(img, "image", img.naturalWidth, img.naturalHeight);
  } else {
    els.video.srcObject = null; els.video.src = url; els.video.loop = true; await els.video.play();
    setSource(els.video, "video", els.video.videoWidth, els.video.videoHeight);
  }
  els.cam.setAttribute("aria-pressed", "false");
}

export function setSource(src, kind, w, h) {
  S.source = src; S.sourceKind = kind;
  els.canvas.width = w || 1280; els.canvas.height = h || 720;
  S.smoother.reset(); S.presence = 0; S.running = true; S.paused = false;
  els.pause.disabled = false; els.export.disabled = false; els.pause.textContent = "⏸ 暂停";
  setMsg(null); setLive(true, kind === "camera" ? "实时摄像头" : kind === "video" ? "视频" : "照片");
  requestAnimationFrame(loop);
}

export function stopSource() {
  const ms = els.video.srcObject;
  if (ms) ms.getTracks().forEach((t) => t.stop());
  els.video.srcObject = null; els.video.removeAttribute("src");
  S.source = null; S.sourceKind = null; S.running = false;
}

// ── 主循环 ────────────────────────────────────────────────────────────────────
let fpsEMA = 0, lastT = performance.now();
export function loop() {
  if (!S.running || S.paused) return;
  const W = els.canvas.width, H = els.canvas.height;
  ctx.drawImage(S.source, 0, 0, W, H);
  const t = performance.now();

  let lm = null, hulls = [];
  if (S.sourceKind === "image") {
    if (!S.imageCacheLM) {
      const res = S.landmarker.detectForVideo(S.source, t);
      S.imageCacheLM = (res.faceLandmarks && res.faceLandmarks[0]) ? toPixels(res.faceLandmarks[0], W, H) : null;
      S.imageHulls = detectHands(t, W, H);
    }
    lm = S.imageCacheLM; hulls = S.imageHulls || [];
    S.presence = lm ? 1 : 0;
  } else if (S.source.currentTime !== undefined) {
    const res = S.landmarker.detectForVideo(S.source, t);
    if (res.faceLandmarks && res.faceLandmarks.length) {
      lm = toPixels(res.faceLandmarks[0], W, H);
      if (S.smoothLevel > 0) lm = S.smoother.filter(lm, t / 1000);
      S.lastLM = lm; S.presence = Math.min(1, S.presence + 0.34);
    } else {
      S.presence = Math.max(0, S.presence - 0.16);
      if (S.presence <= 0) { S.smoother.reset(); S.lastLM = null; }
      lm = S.lastLM;
    }
    hulls = detectHands(t, W, H);
  }

  let lineCount = 0;
  if (lm && S.presence > 0) { const dlm = projectVerts(lm); lineCount = draw(dlm, W, H, hulls); drawZooms(dlm, W); }
  else clearZooms();
  updateStats(lm, W, H, lineCount);

  const now = performance.now();
  fpsEMA = fpsEMA ? fpsEMA * 0.9 + (1000 / Math.max(1, now - lastT)) * 0.1 : 30;
  lastT = now; els.fps.textContent = fpsEMA.toFixed(0) + " fps";
  requestAnimationFrame(loop);
}
