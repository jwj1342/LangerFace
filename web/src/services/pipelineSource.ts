import { clearCanvasDisplayFit, fitCanvasDisplayToStage } from "./liveCanvasFit.ts";
import { CAMERA_CONSTRAINTS, describeCameraError, openCameraStream, stopCameraStream } from "./cameraSource.ts";
import { ctx, els } from "./liveDom.ts";
import { prepareImageSource } from "./imageSource.ts";
import { countMetric, logWarn } from "./logger.ts";
import {
  currentLiveSource,
  currentLiveSourceKind,
  modelState,
  renderState,
  sourceState,
} from "./liveState.ts";
import { resetRefineForNewSource } from "./liveRefine2d";
import { LiveFrameScheduler } from "./liveFrameScheduler.ts";
import { resetLiveWrinkleAnalysis, waitForLiveWrinkleAnalysis } from "./liveWrinkleAnalysis.ts";
import { loadVideoFirstFrame } from "./videoSource.ts";
import { setLive, setMsg, setTransientMsg } from "./liveUi.ts";
import { cancelFrame, loop, requestFrame } from "./pipelineLoop.ts";
import { ensureImageReady, ensureReady } from "./pipelineModels.ts";

type SourceKind = "camera" | "video" | "image";
let sourceOperationId = 0;
const sourceLayoutScheduler = new LiveFrameScheduler();

async function prepareVideoUrl(file: File): Promise<{ url: string; release: () => void }> {
  if (import.meta.env?.VITE_SERVER_COMPUTE !== "true") {
    const url = URL.createObjectURL(file);
    return { url, release: () => URL.revokeObjectURL(url) };
  }
  setMsg("正在上传并准备视频…");
  const response = await fetch("/api/gpu/media/video", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-LangerFace-Filename": encodeURIComponent(file.name),
    },
    body: file,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok) throw new Error(`Video preparation failed: ${response.status}`);
  const payload = await response.json() as { url?: unknown };
  if (typeof payload.url !== "string" || !payload.url.startsWith("/api/gpu/media/video/")) {
    throw new Error("Video preparation returned an invalid URL");
  }
  let released = false;
  return {
    url: payload.url,
    release: () => {
      if (released) return;
      released = true;
      void fetch(payload.url as string, { method: "DELETE", keepalive: true }).catch(() => {});
    },
  };
}

export async function startCamera(): Promise<void> {
  const operationId = ++sourceOperationId;
  let pendingStream: MediaStream | null = null;
  const releasePendingStream = (): void => {
    const stream = pendingStream;
    if (!stream) return;
    if (els.video?.srcObject === stream) els.video.srcObject = null;
    stopCameraStream(stream);
    pendingStream = null;
  };
  if (currentLiveSourceKind() === "camera") {
    stopSource();
    setLive(false, "待机");
    els.cam.setAttribute("aria-pressed", "false");
    return;
  }
  setMsg("加载模型…");
  try {
    await ensureReady();
    if (operationId !== sourceOperationId) return;
    setMsg("请求摄像头权限…");
    pendingStream = await openCameraStream(CAMERA_CONSTRAINTS);
    if (operationId !== sourceOperationId) {
      releasePendingStream();
      return;
    }
    stopSource({ preserveOperation: true });
    els.video.srcObject = pendingStream;
    await els.video.play();
    if (operationId !== sourceOperationId) {
      releasePendingStream();
      return;
    }
    const stream = pendingStream;
    if (!stream) return;
    setSource(els.video, "camera", els.video.videoWidth, els.video.videoHeight, {
      release: () => stopCameraStream(stream),
    });
    pendingStream = null;
    els.cam.setAttribute("aria-pressed", "true");
  } catch (error) {
    releasePendingStream();
    if (operationId !== sourceOperationId) return;
    const detail = describeCameraError(error);
    countMetric(`camera.openFailure.${detail.reason}`);
    logWarn("无法开启摄像头。", { reason: detail.reason, error });
    els.cam.setAttribute("aria-pressed", "false");
    if (!currentLiveSource()) {
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
  const operationId = ++sourceOperationId;
  let pendingObjectUrl: string | null = null;
  let pendingVideoRelease: (() => void) | null = null;
  els.file.value = "";
  stopSource({ preserveOperation: true });
  setLive(false, "待机");
  setMsg(file.type.startsWith("image/") ? "加载图片检测模型…" : "加载模型…");
  try {
    await ensureReady();
    if (file.type.startsWith("image/")) await ensureImageReady();
    if (operationId !== sourceOperationId) return;

    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      pendingObjectUrl = url;
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        if (operationId !== sourceOperationId) return;
        const prepared = prepareImageSource(img);
        setSource(prepared.source, "image", prepared.width, prepared.height);
        if (prepared.scaled) {
          setTransientMsg(`已自动降采样到 ${prepared.width}×${prepared.height}，以保证流畅。`);
        }
      } finally {
        URL.revokeObjectURL(url);
        pendingObjectUrl = null;
      }
    } else {
      const preparedVideo = await prepareVideoUrl(file);
      const url = preparedVideo.url;
      pendingVideoRelease = preparedVideo.release;
      if (operationId !== sourceOperationId) return;
      els.video.loop = true;
      await loadVideoFirstFrame(els.video, url);
      if (operationId !== sourceOperationId) return;
      setSource(els.video, "video", els.video.videoWidth, els.video.videoHeight, {
        release: preparedVideo.release,
      });
      pendingVideoRelease = null;
      els.pause.disabled = true;
      // Render and extract once while the media clock is still at the first frame.
      cancelFrame();
      loop();
      cancelFrame();
      await waitForLiveWrinkleAnalysis();
      if (operationId !== sourceOperationId) return;
      await els.video.play();
      if (operationId !== sourceOperationId) return;
      els.pause.disabled = false;
      requestFrame();
    }
    els.cam.setAttribute("aria-pressed", "false");
  } catch (error) {
    if (operationId !== sourceOperationId) return;
    countMetric("source.fileLoadFailure");
    logWarn("上传文件加载失败。", error);
    setLive(false, "待机");
    setMsg("无法读取或检测该文件。请重新上传；若仍失败，请换用受支持的清晰图片或视频。");
  } finally {
    if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
    pendingVideoRelease?.();
  }
}

export function setSource(
  src: CanvasImageSource,
  kind: SourceKind,
  width?: number,
  height?: number,
  { release }: { release?: () => void } = {},
): void {
  const planning2d = sourceState.planning2d;
  if (!planning2d) throw new Error("live photo planning controller is not mounted");
  const sourceWidth = width || 1280;
  const sourceHeight = height || 720;
  const revision = planning2d.replaceSource({
    source: src,
    kind,
    width: sourceWidth,
    height: sourceHeight,
    release,
  });
  planning2d.setTopology(modelState.triangles || []);
  planning2d.setDetectorLease({
    detector: kind === "image" ? modelState.imageLandmarker : modelState.landmarker,
  });
  planning2d.setDetection({ sourceRevision: revision, status: "detecting" });
  els.canvas.width = sourceWidth;
  els.canvas.height = sourceHeight;
  els.mainWrap.classList.toggle("image-viewer", kind === "image");
  els.canvas.classList.toggle("image-source", kind === "image");
  if (kind === "image") {
    fitCanvasDisplayToStage({ resetView: true });
    sourceLayoutScheduler.request(() => {
      if (sourceState.running && currentLiveSourceKind() === "image") {
        fitCanvasDisplayToStage({ resetView: true });
      }
    });
  } else {
    sourceLayoutScheduler.cancel();
    clearCanvasDisplayFit();
  }
  renderState.smoother.reset();
  resetRefineForNewSource();
  resetLiveWrinkleAnalysis();
  sourceState.presence = 0;
  sourceState.lastLM = null;
  sourceState.imageCacheLM = null;
  sourceState.imageHulls = null;
  sourceState.imageDetectionComplete = false;
  sourceState.imageDetectionAttempts = 0;
  sourceState.jawOpen = 0;
  sourceState.eyeBlinkLeft = 0;
  sourceState.eyeBlinkRight = 0;
  sourceState.qualityGate = null;
  sourceState.localRegionQuality = null;
  sourceState.frozenFrame = null;
  sourceState.lastHulls = [];
  sourceState.running = true;
  sourceState.paused = false;
  els.pause.disabled = kind === "image";
  els.export.disabled = false;
  els.pause.textContent = kind === "camera" ? "📷 定格微调" : "⏸ 暂停";
  setMsg(null);
  setLive(true, kind === "camera" ? "实时摄像头" : kind === "video" ? "视频" : "照片");
  requestFrame();
}

export function stopSource({ preserveOperation = false }: { preserveOperation?: boolean } = {}): void {
  if (!preserveOperation) sourceOperationId += 1;
  cancelFrame();
  sourceLayoutScheduler.cancel();
  sourceState.planning2d?.clearSource();
  els.video.srcObject = null;
  els.video.removeAttribute("src");
  sourceState.running = false;
  sourceState.paused = false;
  sourceState.frozenFrame = null;
  sourceState.lastHulls = [];
  els.mainWrap.classList.remove("image-viewer");
  els.canvas.classList.remove("image-source");
  clearCanvasDisplayFit();
  sourceState.imageCacheLM = null;
  sourceState.imageHulls = null;
  sourceState.imageDetectionComplete = false;
  sourceState.imageDetectionAttempts = 0;
  sourceState.lastLM = null;
  sourceState.jawOpen = 0;
  sourceState.eyeBlinkLeft = 0;
  sourceState.eyeBlinkRight = 0;
  sourceState.qualityGate = null;
  sourceState.localRegionQuality = null;
  resetRefineForNewSource();
  resetLiveWrinkleAnalysis();
  els.pause.disabled = true;
  els.pause.textContent = "📷 定格微调";
}
