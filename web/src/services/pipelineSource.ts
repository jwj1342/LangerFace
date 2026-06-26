import { clearCanvasDisplayFit, fitCanvasDisplayToStage } from "./liveCanvasFit.ts";
import { CAMERA_CONSTRAINTS, describeCameraError, openCameraStream } from "./cameraSource.ts";
import { ctx, els } from "./liveDom.ts";
import { prepareImageSource } from "./imageSource.ts";
import { countMetric, logWarn } from "./logger.ts";
import { renderState, sourceState } from "./liveState.ts";
import { setLive, setMsg } from "./liveUi.ts";
import { requestFrame } from "./pipelineLoop.ts";
import { ensureReady } from "./pipelineModels.ts";

type SourceKind = "camera" | "video" | "image";

export async function startCamera(): Promise<void> {
  if (sourceState.sourceKind === "camera") {
    stopSource();
    setLive(false, "待机");
    els.cam.setAttribute("aria-pressed", "false");
    return;
  }
  setMsg("加载模型…");
  try {
    await ensureReady();
    setMsg("请求摄像头权限…");
    const stream = await openCameraStream(CAMERA_CONSTRAINTS);
    stopSource();
    els.video.srcObject = stream;
    await els.video.play();
    setSource(els.video, "camera", els.video.videoWidth, els.video.videoHeight);
    els.cam.setAttribute("aria-pressed", "true");
  } catch (error) {
    const detail = describeCameraError(error);
    countMetric(`camera.openFailure.${detail.reason}`);
    logWarn("无法开启摄像头。", { reason: detail.reason, error });
    els.cam.setAttribute("aria-pressed", "false");
    if (!sourceState.source) {
      showCameraPlaceholder(detail.message);
      setLive(false, "待机");
    }
    setMsg(detail.message);
  }
}

export function showCameraPlaceholder(message = ""): void {
  if (!ctx) return;
  const width = els.canvas.width || 1280;
  const height = els.canvas.height || 720;
  els.canvas.width = width;
  els.canvas.height = height;
  ctx.save();
  ctx.fillStyle = "#07111f";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,.84)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(18, Math.round(width / 46))}px system-ui, sans-serif`;
  ctx.fillText(message, width / 2, height / 2);
  ctx.restore();
}

export async function handleFile(file?: File): Promise<void> {
  if (!file) return;
  setMsg("加载模型…");
  await ensureReady();
  stopSource();
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const prepared = prepareImageSource(img);
    setSource(prepared.source, "image", prepared.width, prepared.height);
    URL.revokeObjectURL(url);
    if (prepared.scaled) setMsg(`已自动降采样到 ${prepared.width}×${prepared.height}，以保证流畅。`);
  } else {
    els.video.srcObject = null;
    els.video.src = url;
    els.video.loop = true;
    await els.video.play();
    setSource(els.video, "video", els.video.videoWidth, els.video.videoHeight);
  }
  els.cam.setAttribute("aria-pressed", "false");
}

export function setSource(src: CanvasImageSource, kind: SourceKind, width?: number, height?: number): void {
  sourceState.source = src;
  sourceState.sourceKind = kind;
  els.canvas.width = width || 1280;
  els.canvas.height = height || 720;
  els.mainWrap.classList.toggle("image-viewer", kind === "image");
  els.canvas.classList.toggle("image-source", kind === "image");
  if (kind === "image") {
    fitCanvasDisplayToStage({ resetView: true });
    requestAnimationFrame(() => fitCanvasDisplayToStage({ resetView: true }));
  } else {
    clearCanvasDisplayFit();
  }
  renderState.smoother.reset();
  sourceState.presence = 0;
  sourceState.lastLM = null;
  sourceState.imageCacheLM = null;
  sourceState.imageHulls = null;
  sourceState.jawOpen = 0;
  sourceState.eyeBlinkLeft = 0;
  sourceState.eyeBlinkRight = 0;
  sourceState.qualityGate = null;
  sourceState.localRegionQuality = null;
  sourceState.running = true;
  sourceState.paused = false;
  els.pause.disabled = false;
  els.export.disabled = false;
  els.pause.textContent = "⏸ 暂停";
  setMsg(null);
  setLive(true, kind === "camera" ? "实时摄像头" : kind === "video" ? "视频" : "照片");
  requestFrame();
}

export function stopSource(): void {
  const mediaStream = els.video.srcObject as MediaStream | null;
  if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
  els.video.srcObject = null;
  els.video.removeAttribute("src");
  sourceState.source = null;
  sourceState.sourceKind = null;
  sourceState.running = false;
  els.mainWrap.classList.remove("image-viewer");
  els.canvas.classList.remove("image-source");
  clearCanvasDisplayFit();
  sourceState.imageCacheLM = null;
  sourceState.imageHulls = null;
  sourceState.lastLM = null;
  sourceState.jawOpen = 0;
  sourceState.eyeBlinkLeft = 0;
  sourceState.eyeBlinkRight = 0;
  sourceState.qualityGate = null;
  sourceState.localRegionQuality = null;
}
