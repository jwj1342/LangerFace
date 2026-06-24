// 数据源管理：摄像头 / 上传图片 / 上传视频的开启、切换与停止，以及相机占位图。
// 从 pipeline.js 原样拆出（SRP，见 #45）。
import { clearCanvasDisplayFit, fitCanvasDisplayToStage } from "../canvas_fit.js";
import { CAMERA_CONSTRAINTS, describeCameraError, openCameraStream } from "../camera.js";
import { ctx, els } from "../dom.js";
import { prepareImageSource } from "../image_source.js";
import { countMetric, logWarn } from "../logger.js";
import { renderState, sourceState } from "../state.js";
import { setLive, setMsg } from "../ui.js";
import { ensureReady } from "./models.js";
import { requestFrame } from "./loop.js";

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
