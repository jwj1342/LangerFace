import {
  captureImageViewState,
  clearCanvasDisplayFit,
  fitCanvasDisplayToStage,
  restoreImageViewState,
  type ImageViewResumeState,
} from "./liveCanvasFit.ts";
import {
  describeCameraError,
  openPreferredCameraStream,
  openSelectedCameraStream,
  stopCameraStream,
  type CameraFacingMode,
  type CameraFacingSelection,
} from "./cameraSource.ts";
import { ctx, els } from "./liveDom.ts";
import { clearPhotoVectors } from "./photoVectorOverlay.ts";
import { prepareImageSource } from "./imageSource.ts";
import { resetRstlPhotoHairOcclusion, startRstlPhotoHairOcclusion } from "./rstlPhotoHairOcclusion.ts";
import { confirmLikelyScreenshotUpload } from "./imageUploadPreflight.ts";
import { countMetric, logWarn, recordMetricSample } from "./logger.ts";
import {
  currentLiveSource,
  currentLiveSourceKind,
  modelState,
  renderState,
  sourceState,
  usesPhotoCameraProjection,
} from "./liveState.ts";
import {
  beginFrozenRefineSession,
  captureRefineDisplayState,
  commitRefineForLive,
  resetRefineForNewSource,
  restoreRefineDisplayState,
  startPhotoRstlProjection,
  setRefineAvailability,
  type RefineDisplayResumeState,
} from "./liveRefine2d";
import { LiveFrameScheduler } from "./liveFrameScheduler.ts";
import {
  captureWrinkleDisplayState,
  preparePhotoCameraWrinkles,
  startPhotoWrinkleProjection,
  resetLiveWrinkleAnalysis,
  restoreWrinkleDisplayState,
  updateWrinkleUi,
  type WrinkleDisplayResumeState,
} from "./liveWrinkleAnalysis.ts";
import { loadVideoFirstFrame } from "./videoSource.ts";
import { setLive, setMsg, setTransientMsg } from "./liveUi.ts";
import { cancelFrame, drawSourceFrame, loop, redrawPausedFrame, requestFrame } from "./pipelineLoop.ts";
import { ensureImageReady, ensureReady } from "./pipelineModels.ts";
import { workflowCameraPhotoRequired, workflowOverlayMatchesPhoto } from "./workflowPhotoCamera.ts";

type SourceKind = "camera" | "video" | "image";
let sourceOperationId = 0;
let cameraPendingOperation: number | null = null;
const sourceLayoutScheduler = new LiveFrameScheduler();

export function handlePauseToggle(): void {
  if (!sourceState.running || sourceState.sourceKind === "image") return;
  if (!sourceState.paused) {
    if (!sourceState.lastLM || sourceState.presence <= 0) {
      setMsg("尚未获得稳定人脸，请正对摄像头后再定格。");
      return;
    }
    const frozen = document.createElement("canvas");
    frozen.width = els.canvas.width;
    frozen.height = els.canvas.height;
    const frozenContext = frozen.getContext("2d");
    if (frozenContext) drawSourceFrame(frozenContext, sourceState.source as CanvasImageSource, frozen.width, frozen.height);
    sourceState.frozenFrame = frozen;
    sourceState.paused = true;
    if (!usesPhotoCameraProjection()) resetLiveWrinkleAnalysis();
    beginFrozenRefineSession();
    els.mainWrap.classList.add("image-viewer");
    els.canvas.classList.add("refine-image-source");
    fitCanvasDisplayToStage({ resetView: !usesPhotoCameraProjection() });
    els.pause.textContent = "▶ 继续";
    els.pause.setAttribute("aria-pressed", "true");
    setLive(false, "已定格 · 可微调");
    setTransientMsg("已暂停当前画面。可点击“检测皱纹”，或使用“医生手动微调”继续处理。");
    redrawPausedFrame();
    setRefineAvailability();
    updateWrinkleUi();
    return;
  }
  sourceState.paused = false;
  els.mainWrap.classList.remove("image-viewer");
  els.canvas.classList.remove("refine-image-source");
  sourceState.frozenFrame = null;
  const refinementCommitted = commitRefineForLive();
  if (!usesPhotoCameraProjection()) resetLiveWrinkleAnalysis();
  els.pause.textContent = "⏸ 暂停";
  els.pause.setAttribute("aria-pressed", "false");
  if (refinementCommitted) setTransientMsg("已返回实时画面，当前微调曲线会继续跟随人脸。");
  else setMsg(null);
  setLive(true, sourceState.sourceKind === "camera" ? "实时摄像头" : "视频");
  requestFrame();
}

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

interface StaticSourceResumeState {
  densityFrac: number;
  source: CanvasImageSource;
  imageFile: File | null;
  width: number;
  height: number;
  imageView: ImageViewResumeState;
  refinement: RefineDisplayResumeState;
  wrinkle: WrinkleDisplayResumeState;
  landmarks?: NonNullable<ReturnType<NonNullable<typeof sourceState.planning2d>["getFrameState"]>["landmarks"]>;
}

let lastStaticSource: StaticSourceResumeState | null = null;

function resetAutomaticSourceMirror(): void {
  renderState.mirror = false;
  els.mirror.checked = false;
  els.canvas.classList.remove("mirror");
  renderState.zoomCards.forEach((zoomCard) => zoomCard.canvas.classList.remove("mirror"));
}

export interface StartCameraOptions {
  facing?: CameraFacingSelection;
  switchCamera?: boolean;
  onFacingMode?: (facingMode: CameraFacingMode) => void;
}

function captureCurrentStaticSource(): void {
  const frame = sourceState.planning2d?.getFrameState();
  if (!sourceState.running || frame?.kind !== "image" || !frame.source) return;
  lastStaticSource = {
    densityFrac: renderState.densityFrac,
    source: frame.source as CanvasImageSource,
    imageFile: sourceState.imageFile,
    width: frame.width,
    height: frame.height,
    imageView: captureImageViewState(),
    refinement: captureRefineDisplayState(),
    wrinkle: captureWrinkleDisplayState(),
    landmarks: frame.landmarks ?? undefined,
  };
}

function restoreStaticSourceOrPlaceholder(
  activeIncisionOverlay: typeof renderState.incisionOverlay,
  { announce = true }: { announce?: boolean } = {},
): void {
  const resume = lastStaticSource;
  stopSource({
    preserveOperation: true,
    preserveStaticResume: true,
  });
  if (!resume) {
    renderState.incisionOverlay = activeIncisionOverlay;
    showCameraPlaceholder();
    setLive(false, "待机");
    if (announce) setTransientMsg("已关闭摄像头；当前没有可恢复的照片。", 3_000);
    return;
  }
  sourceState.imageFile = resume.imageFile;
  setSource(resume.source, "image", resume.width, resume.height, {
    imageViewResume: resume.imageView,
  });
  restoreRefineDisplayState(resume.refinement);
  restoreWrinkleDisplayState(resume.wrinkle);
  renderState.densityFrac = sourceState.workflowPhotoCamera ? resume.densityFrac : 1;
  els.density.value = String(Math.round(renderState.densityFrac * 100));
  els.densityVal.textContent = `${els.density.value}%`;
  renderState.incisionOverlay = activeIncisionOverlay;
  lastStaticSource = resume;
  if (announce) setTransientMsg("已关闭摄像头，并恢复上一张照片及其显示状态。", 3_000);
  requestFrame();
}

export async function startCamera(options: StartCameraOptions = {}): Promise<void> {
  const needsPhoto = sourceState.workflowPhotoCamera;
  if (needsPhoto && sourceState.cameraPending) return;
  const cameraActive = currentLiveSourceKind() === "camera";
  const switching = needsPhoto && options.switchCamera === true;
  if (switching && (!cameraActive || !options.facing || !lastStaticSource?.landmarks
    || sourceState.cameraFacing === options.facing)) return;
  sourceState.cameraError = null;

  const operationId = ++sourceOperationId;
  let pendingStream: MediaStream | null = null;
  const releasePendingStream = (): void => {
    const stream = pendingStream;
    if (!stream) return;
    if (els.video?.srcObject === stream) els.video.srcObject = null;
    stopCameraStream(stream);
    pendingStream = null;
  };
  if (cameraActive && !switching) {
    restoreStaticSourceOrPlaceholder(renderState.incisionOverlay);
    els.cam.setAttribute("aria-pressed", "false");
    return;
  }
  const photo = sourceState.planning2d?.getFrameState();
  if (needsPhoto && !switching && (photo?.kind !== "image" || !photo.source || (photo.landmarks?.length ?? 0) < 468)) {
    setTransientMsg(workflowCameraPhotoRequired);
    return;
  }
  let restoreOverlay: typeof renderState.incisionOverlay = null;
  let leftPhoto = false;
  if (needsPhoto) {
    cameraPendingOperation = operationId;
    sourceState.cameraPending = true;
  }
  setMsg("加载模型…");
  try {
    await ensureReady();
    if (operationId !== sourceOperationId) return;
    if (needsPhoto && !switching) {
      setMsg("正在准备参考照片的皱纹和张力线…");
      await preparePhotoCameraWrinkles(
        () => operationId === sourceOperationId,
        () => !workflowOverlayMatchesPhoto(renderState.incisionOverlay, photo?.source),
      );
      if (operationId !== sourceOperationId) return;
    }
    if (switching) {
      restoreOverlay = renderState.incisionOverlay;
      // Mobile browsers may only allow one camera at a time.
      stopSource({ preserveOperation: true, preserveStaticResume: true });
      leftPhoto = true;
    }
    setMsg(switching ? "正在切换摄像头…" : "请求摄像头权限…");
    const openedCamera = options.facing
      ? { stream: await openSelectedCameraStream(options.facing), facingMode: options.facing }
      : await openPreferredCameraStream(undefined, () => operationId === sourceOperationId);
    pendingStream = openedCamera.stream;
    if (operationId !== sourceOperationId) {
      releasePendingStream();
      return;
    }
    if (!switching && !needsPhoto) {
      captureCurrentStaticSource();
      restoreOverlay = renderState.incisionOverlay;
      stopSource({ preserveOperation: true, preserveStaticResume: true });
    }
    els.video.srcObject = pendingStream;
    await els.video.play();
    if (operationId !== sourceOperationId) {
      releasePendingStream();
      return;
    }
    options.onFacingMode?.(openedCamera.facingMode);
    const stream = pendingStream;
    if (!stream) return;
    if (needsPhoto && !switching) {
      // Keep the reference source and its review active during permission and
      // playback startup. Commit the handoff only once video can play.
      captureCurrentStaticSource();
      restoreOverlay = renderState.incisionOverlay;
      leftPhoto = true;
      resetRstlPhotoHairOcclusion();
      clearPhotoVectors(els.canvas);
    }
    const resume = lastStaticSource;
    const activeIncisionOverlay = !needsPhoto || (resume && workflowOverlayMatchesPhoto(restoreOverlay, resume.source))
      ? restoreOverlay : null;
    setSource(els.video, "camera", els.video.videoWidth, els.video.videoHeight, {
      release: () => stopCameraStream(stream),
    });
    renderState.incisionOverlay = activeIncisionOverlay;
    sourceState.cameraFacing = openedCamera.facingMode;
    if (needsPhoto && resume?.landmarks) {
      startPhotoWrinkleProjection(resume.wrinkle, resume.landmarks);
      startPhotoRstlProjection(resume.refinement, resume.landmarks);
    }
    requestFrame();
    pendingStream = null;
    els.cam.setAttribute("aria-pressed", "true");
  } catch (error) {
    releasePendingStream();
    if (operationId !== sourceOperationId) return;
    const detail = describeCameraError(error, options.facing);
    countMetric(`camera.openFailure.${detail.reason}`);
    logWarn("无法开启摄像头。", { reason: detail.reason, error });
    els.cam.setAttribute("aria-pressed", "false");
    if (leftPhoto && lastStaticSource) restoreStaticSourceOrPlaceholder(restoreOverlay, { announce: false });
    if (!currentLiveSource()) {
      showCameraPlaceholder(detail.message);
      setLive(false, "待机");
    }
    setMsg(detail.message);
    sourceState.cameraError = detail.message;
  } finally {
    if (cameraPendingOperation === operationId) {
      cameraPendingOperation = null;
      sourceState.cameraPending = false;
    }
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

export async function handleFile(
  file?: File,
  { suppressScreenshotWarning = false }: { suppressScreenshotWarning?: boolean } = {},
): Promise<void> {
  if (!file) return;
  els.file.value = "";
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) {
    setTransientMsg("仅支持上传照片或视频。");
    return;
  }
  const startedAt = performance.now();
  const operationId = ++sourceOperationId;
  sourceState.cameraError = null;
  let pendingObjectUrl: string | null = null;
  let pendingVideoRelease: (() => void) | null = null;
  let sourceReplaced = false;
  const workflowUpload = Boolean(document.querySelector(".workflow-workbench"));
  setMsg(isImage ? "图片加载中" : "正在准备视频…", 0, true);
  try {
    if (isImage) {
      const url = URL.createObjectURL(file);
      pendingObjectUrl = url;
      try {
        const img = new Image();
        img.src = url;
        let modelReadyAt = startedAt;
        let decodedAt = startedAt;
        const modelReady = ensureImageReady().then(() => {
          modelReadyAt = performance.now();
        });
        const decoded = img.decode().then(() => {
          decodedAt = performance.now();
        });
        // Keep the current source visible while the new file is decoding and
        // the cached MediaPipe models are warming up.  The model promise is
        // intentionally started in parallel, but it must not delay showing
        // the decoded image.
        await decoded;
        if (operationId !== sourceOperationId) return;
        const dimensions = {
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
        };
        if (workflowUpload && !suppressScreenshotWarning && !confirmLikelyScreenshotUpload(file, dimensions)) {
          setTransientMsg("已取消疑似手机截图；请重新选择不包含网页界面的原始人像。", 4_000);
          return;
        }
        if (workflowUpload) setMsg("图片加载中", 0, true);
        const prepared = prepareImageSource(img);
        stopSource({ preserveOperation: true });
        sourceReplaced = true;
        setLive(false, "待机");
        sourceState.imageFile = file;
        setSource(prepared.source, "image", prepared.width, prepared.height);
        sourceReplaced = false;
        // setSource() paints the image immediately.  Static landmarks are
        // requested again after the model promise resolves, so model startup
        // never produces a blank canvas.
        await modelReady;
        if (operationId !== sourceOperationId) return;
        requestFrame();
        sourceState.imageFileName = file.name;
        const sourceSetAt = performance.now();
        recordMetricSample("source.imageModelWaitMs", modelReadyAt - startedAt, { bytes: file.size });
        recordMetricSample("source.imageDecodeMs", decodedAt - startedAt, { bytes: file.size });
        recordMetricSample("source.imageUploadToSourceSetMs", sourceSetAt - startedAt, {
          bytes: file.size,
          width: prepared.width,
          height: prepared.height,
          scaled: prepared.scaled,
        });
        if (prepared.scaled) {
          setTransientMsg(`已自动降采样到 ${prepared.width}×${prepared.height}，以保证流畅。`);
        }
      } finally {
        URL.revokeObjectURL(url);
        pendingObjectUrl = null;
      }
    } else {
      await ensureReady();
      if (operationId !== sourceOperationId) return;
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
      sourceState.imageFile = null;
      pendingVideoRelease = null;
      els.pause.disabled = true;
      // Render and extract once while the media clock is still at the first frame.
      cancelFrame();
      loop();
      cancelFrame();
      // Do not hold video playback behind optional wrinkle inference. The
      // worker continues in the background and generation guards discard stale
      // results if another source is selected meanwhile.
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
    if (sourceReplaced) {
      setLive(false, "待机");
      setMsg("无法读取或检测该文件。请重新上传；若仍失败，请换用受支持的清晰照片或视频。");
    } else {
      setTransientMsg("无法读取该文件；当前画面未被替换。请重新选择受支持的清晰照片。", 4_000);
    }
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
  {
    release,
    preserveRefinementForLive = false,
    imageViewResume,
  }: {
    release?: () => void;
    preserveRefinementForLive?: boolean;
    imageViewResume?: ImageViewResumeState;
  } = {},
): void {
  const planning2d = sourceState.planning2d;
  if (!planning2d) throw new Error("live photo planning controller is not mounted");
  // Every new media source starts in anatomical orientation. Mirroring remains
  // available as an explicit, per-source display choice after the source loads.
  resetAutomaticSourceMirror();
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
  const cameraView = kind === "camera" && sourceState.workflowPhotoCamera;
  els.mainWrap.classList.toggle("image-viewer", kind === "image");
  els.mainWrap.classList.toggle("camera-viewer", cameraView);
  els.canvas.classList.toggle("image-source", kind === "image");
  els.canvas.classList.toggle("camera-source", cameraView);
  if (kind === "image" || cameraView) {
    fitCanvasDisplayToStage({ resetView: !imageViewResume });
    if (imageViewResume) restoreImageViewState(imageViewResume);
    sourceLayoutScheduler.request(() => {
      if (sourceState.running && currentLiveSourceKind() === kind) {
        fitCanvasDisplayToStage({ resetView: kind === "image" && !imageViewResume });
        if (imageViewResume) restoreImageViewState(imageViewResume);
      }
    });
  } else {
    sourceLayoutScheduler.cancel();
    clearCanvasDisplayFit();
  }
  renderState.smoother.reset();
  resetRefineForNewSource({ preserveLiveTransport: preserveRefinementForLive });
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
  els.pause.textContent = "⏸ 暂停";
  setMsg(null);
  setLive(true, kind === "camera" ? "实时摄像头" : kind === "video" ? "视频" : "照片");
  if (kind === "image") {
    startRstlPhotoHairOcclusion(src as TexImageSource, sourceWidth, sourceHeight, requestFrame);
    lastStaticSource = {
      densityFrac: renderState.densityFrac,
      source: src,
      imageFile: sourceState.imageFile,
      width: sourceWidth,
      height: sourceHeight,
      imageView: captureImageViewState(),
      refinement: captureRefineDisplayState(),
      wrinkle: captureWrinkleDisplayState(),
    };
  }
  requestFrame();
}

export function stopSource({
  preserveOperation = false,
  preserveRefinementForLive = false,
  preserveStaticResume = false,
}: {
  preserveOperation?: boolean;
  preserveRefinementForLive?: boolean;
  preserveStaticResume?: boolean;
} = {}): void {
  if (!preserveOperation) sourceOperationId += 1;
  if (!preserveOperation) {
    cameraPendingOperation = null;
    sourceState.cameraPending = false;
    sourceState.cameraError = null;
  }
  if (!preserveOperation) setMsg(null);
  cancelFrame();
  resetRstlPhotoHairOcclusion();
  sourceLayoutScheduler.cancel();
  sourceState.planning2d?.clearSource();
  clearPhotoVectors(els.canvas);
  els.video.pause();
  els.video.srcObject = null;
  els.video.removeAttribute("src");
  // Removing src alone can leave the browser's decoder and buffered media
  // alive across repeated uploads. load() forces the element to release it.
  els.video.load();
  sourceState.running = false;
  sourceState.cameraFacing = "unknown";
  sourceState.paused = false;
  sourceState.frozenFrame = null;
  sourceState.lastHulls = [];
  els.mainWrap.classList.remove("image-viewer", "camera-viewer");
  els.canvas.classList.remove("image-source", "camera-source");
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
  resetRefineForNewSource({ preserveLiveTransport: preserveRefinementForLive });
  resetLiveWrinkleAnalysis();
  if (!preserveStaticResume) lastStaticSource = null;
  if (!preserveStaticResume) sourceState.imageFileName = null;
  if (!preserveStaticResume) sourceState.imageFile = null;
  els.pause.disabled = true;
  els.pause.textContent = "⏸ 暂停";
}
