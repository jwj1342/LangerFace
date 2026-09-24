export interface RecordingExtraCanvas {
  label?: string;
  canvas: HTMLCanvasElement;
}

export interface CanvasRecordingController {
  readonly recording: boolean;
  readonly chunkCount: number;
  start(): boolean;
  stop(): boolean;
  toggle(): boolean;
  exportImage(): Promise<boolean>;
}

export interface DownloadLink {
  href: string;
  download: string;
  click(): void;
}

export interface FileShareNavigator {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}

export const CANVAS_EXPORT_DIAGNOSTIC_EVENT = "langerface:canvas-export-diagnostic";

export interface CanvasExportDiagnosticDetail {
  export_kind: "image" | "video";
  stage: "recording_started" | "recording_stopped" | "recording_data" | "generated" | "local_transfer_completed" | "local_transfer_failed" | "dialog_opened" | "preview_ready" | "preview_failed" | "share_requested" | "share_unavailable" | "share_completed" | "share_cancelled" | "share_failed" | "download_requested" | "open_requested" | "generation_failed";
  mime: string;
  extension: string;
  size_bytes: number;
  share_api_available: boolean;
  file_share_supported: boolean;
  error_code: string | null;
  observed_at_ms: number;
}

function safeErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) ? name : "UnknownError";
}

function emitExportDiagnostic(detail: Omit<CanvasExportDiagnosticDetail, "observed_at_ms">): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent(CANVAS_EXPORT_DIAGNOSTIC_EVENT, {
    detail: { ...detail, observed_at_ms: Date.now() } satisfies CanvasExportDiagnosticDetail,
  }));
}

function exportKind(blob: Blob): "image" | "video" {
  return blob.type.startsWith("image/") ? "image" : "video";
}

function extensionForMime(mime: string): string {
  return mime.startsWith("video/mp4") ? "mp4" : mime.startsWith("image/") ? "png" : "webm";
}

function recorderMimeType(Recorder: typeof MediaRecorder): string {
  const mobileLike = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (mobileLike) return "";
  const mp4 = ["video/mp4;codecs=avc1.42E01E", "video/mp4"];
  const webm = ["video/webm;codecs=vp8", "video/webm"];
  const candidates = mobileLike ? [...mp4, ...webm] : [...webm, ...mp4];
  const supports = typeof Recorder.isTypeSupported === "function"
    ? (mime: string) => Recorder.isTypeSupported(mime)
    : (mime: string) => mime === "video/webm";
  return candidates.find(supports) || "";
}

export type RecordingSystemName = string | (() => string);

// Prepare first; the operator's subsequent click supplies fresh user activation.
function presentMobileFile(blob: Blob, filename: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return false;
  document.getElementById("canvas-file-save")?.dispatchEvent(new Event("export-replace"));
  const dialog = document.createElement("dialog");
  dialog.id = "canvas-file-save";
  dialog.setAttribute("aria-label", "保存导出文件");
  dialog.style.cssText = "width:min(90vw,480px);max-height:85dvh;overflow:auto;padding:20px;border:1px solid #64748b;border-radius:12px;background:#111827;color:white";
  const title = document.createElement("h2");
  title.textContent = "文件已生成，请选择保存方式";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = filename + " · " + Math.ceil(blob.size / 1024) + " KB";
  const url = URL.createObjectURL(blob);
  const file = new File([blob], filename, { type: blob.type });
  const imageFile = blob.type === "image/png";
  const kind = exportKind(blob);
  const extension = extensionForMime(blob.type);
  const shareApiAvailable = typeof navigator.share === "function";
  const fileShareSupported = shareApiAvailable
    && typeof navigator.canShare === "function"
    && navigator.canShare({ files: [file] });
  const diagnostic = (stage: CanvasExportDiagnosticDetail["stage"], errorCode: string | null = null) => emitExportDiagnostic({
    export_kind: kind, stage, mime: blob.type || "application/octet-stream", extension,
    size_bytes: blob.size, share_api_available: shareApiAvailable,
    file_share_supported: fileShareSupported, error_code: errorCode,
  });
  const preview = document.createElement(imageFile ? "img" : "video");
  preview.src = url;
  preview.style.cssText = "display:block;width:100%;max-height:45dvh;object-fit:contain";
  if (preview instanceof HTMLVideoElement) { preview.controls = true; preview.playsInline = true; preview.preload = "metadata"; }
  else preview.alt = "导出图片预览，可长按保存";
  preview.addEventListener(imageFile ? "load" : "loadedmetadata", () => diagnostic("preview_ready"), { once: true });
  preview.addEventListener("error", () => {
    status.textContent = `当前浏览器无法预览 ${blob.type || "该格式"} 文件；文件已经生成，可改用系统分享或在新页面打开。`;
    diagnostic("preview_failed", "MediaPreviewError");
  }, { once: true });
  const share = document.createElement("button");
  share.textContent = fileShareSupported ? "系统保存／分享" : "系统保存／分享（不可用）";
  share.style.cssText = "padding:12px;margin:8px 8px 8px 0";
  share.onclick = async () => {
    if (!fileShareSupported) {
      status.textContent = "此浏览器不支持把当前文件交给系统保存／分享。请使用“在新页面打开”，图片也可以长按预览保存。";
      diagnostic("share_unavailable");
      return;
    }
    diagnostic("share_requested");
    share.disabled = true;
    try {
      await navigator.share({ files: [file], title: filename });
      status.textContent = "文件已交给所选应用；请在该应用确认保存。";
      diagnostic("share_completed");
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "AbortError";
      status.textContent = cancelled ? "已取消保存，可重新选择。" : "系统分享未完成，请改用“在新页面打开”或浏览器下载。";
      diagnostic(cancelled ? "share_cancelled" : "share_failed", safeErrorCode(error));
    } finally { share.disabled = false; }
  };
  const download = document.createElement("a");
  download.href = url; download.download = filename; download.textContent = "浏览器下载";
  download.style.cssText = "display:inline-block;color:#7dd3fc;padding:12px";
  download.addEventListener("click", () => {
    status.textContent = "已向浏览器提交下载请求。浏览器是否真正保存，需要在它的下载记录中确认。";
    diagnostic("download_requested");
  });
  const open = document.createElement("button");
  open.textContent = "在新页面打开";
  open.style.cssText = "padding:12px;margin:8px 8px 8px 0";
  open.onclick = () => {
    diagnostic("open_requested");
    const opened = window.open(url, "_blank", "noopener");
    status.textContent = opened
      ? "已在新页面打开；图片可长按保存，视频可使用浏览器播放器菜单保存。"
      : "浏览器阻止了新页面，请允许弹窗后重试。";
  };
  const hint = document.createElement("p");
  hint.textContent = imageFile
    ? "也可长按上方图片保存。若下载仍为0%，请保留此页并尝试其他浏览器。"
    : "先播放预览确认视频内容。若下载仍为0%，请尝试保存／分享或其他浏览器。";
  const close = document.createElement("button");
  close.textContent = "关闭";
  close.style.cssText = "padding:12px";
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (preview instanceof HTMLVideoElement) preview.pause();
    preview.removeAttribute("src");
    dialog.remove();
    setTimeout(() => URL.revokeObjectURL(url), 300000);
  };
  close.onclick = () => dialog.close();
  dialog.addEventListener("close", cleanup, { once: true });
  dialog.addEventListener("export-replace", cleanup, { once: true });
  dialog.append(title, status, preview, share, open, download, hint, close);
  document.body.append(dialog);
  dialog.showModal();
  diagnostic("dialog_opened");
  return true;
}

export interface CanvasRecordingOptions {
  canvas?: HTMLCanvasElement;
  getExtraCanvases?: () => Array<RecordingExtraCanvas | HTMLCanvasElement>;
  system?: RecordingSystemName;
  fps?: number;
  now?: () => number;
  Recorder?: typeof MediaRecorder;
  BlobCtor?: typeof Blob;
  FileCtor?: typeof File;
  createCanvas?: () => HTMLCanvasElement;
  createLink?: () => DownloadLink;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  scheduleRevoke?: (callback: () => void, delayMs: number) => void;
  shareNavigator?: FileShareNavigator;
  presentFile?: (blob: Blob, filename: string) => boolean;
  onError?: (error: unknown) => void;
  onDownloadRequested?: (filename: string) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  onStateChange?: (recording: boolean) => void;
}

function isRecordingExtraCanvas(item: RecordingExtraCanvas | HTMLCanvasElement | null | undefined): item is RecordingExtraCanvas {
  return Boolean(item && "canvas" in item);
}

function drawableCanvas(item: RecordingExtraCanvas | HTMLCanvasElement | null | undefined): RecordingExtraCanvas | null {
  const cv = isRecordingExtraCanvas(item) ? item.canvas : item;
  if (!cv || !cv.width || !cv.height) return null;
  return {
    canvas: cv,
    label: isRecordingExtraCanvas(item) ? item.label || "" : cv.dataset?.exportLabel || "",
  };
}

function drawContain(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, x: number, y: number, w: number, h: number): void {
  const scale = Math.min(w / source.width, h / source.height);
  const dw = source.width * scale;
  const dh = source.height * scale;
  try {
    ctx.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } catch {
    ctx.fillStyle = "#151a20";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#d1d5db";
    ctx.fillText("预览不可录制", x + 12, y + 24);
  }
}

export function createCanvasRecordingController({
  canvas,
  getExtraCanvases = () => [],
  system = "rstl",
  fps = 30,
  now = () => Date.now(),
  Recorder = globalThis.MediaRecorder,
  BlobCtor = globalThis.Blob,
  FileCtor = globalThis.File,
  createCanvas = () => document.createElement("canvas"),
  createLink = () => document.createElement("a"),
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
  scheduleRevoke = (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  },
  shareNavigator = globalThis.navigator,
  presentFile = () => false,
  onError = (error) => console.error("视频保存失败", error),
  onDownloadRequested = () => {},
  requestFrame = (cb) => requestAnimationFrame(cb),
  cancelFrame = (id) => cancelAnimationFrame(id),
  onStateChange = () => {},
}: CanvasRecordingOptions = {}): CanvasRecordingController {
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let compositeFrame = 0;
  const downloadUrlLifetimeMs = 5 * 60 * 1000;

  function normalizeExtraCanvases(): RecordingExtraCanvas[] {
    return (getExtraCanvases?.() || []).map(drawableCanvas).filter((item): item is RecordingExtraCanvas => Boolean(item));
  }

  function createCompositeSource(extras: RecordingExtraCanvas[], animate: boolean): HTMLCanvasElement {
    if (!canvas) throw new Error("canvas is required for overlay export");
    const exportCanvas = createCanvas();
    const mainWidth = canvas.width || 1280;
    const mainHeight = canvas.height || 720;
    const gap = extras.length ? Math.max(12, Math.round(mainWidth * 0.012)) : 0;
    const sideWidth = extras.length ? Math.max(240, Math.min(420, Math.round(mainWidth * 0.28))) : 0;
    exportCanvas.width = mainWidth + gap + sideWidth;
    exportCanvas.height = mainHeight;
    const g = exportCanvas.getContext("2d");
    if (!g) throw new Error("2d canvas context is required for overlay export");
    const labelHeight = 24;
    const slotGap = Math.max(8, Math.round(mainHeight * 0.012));
    const slotHeight = Math.floor((mainHeight - slotGap * Math.max(0, extras.length - 1)) / Math.max(1, extras.length));
    const sideX = mainWidth + gap;
    const paint = () => {
      g.fillStyle = "#05070a";
      g.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      g.drawImage(canvas, 0, 0, mainWidth, mainHeight);
      g.fillStyle = "#111820";
      g.fillRect(mainWidth, 0, gap, mainHeight);
      g.font = `${Math.max(12, Math.round(mainHeight * 0.018))}px system-ui, sans-serif`;
      g.textBaseline = "top";
      extras.forEach((extra, index) => {
        const y = index * (slotHeight + slotGap);
        g.fillStyle = "#0b1117";
        g.fillRect(sideX, y, sideWidth, slotHeight);
        g.strokeStyle = "rgba(148, 163, 184, 0.45)";
        g.lineWidth = 1;
        g.strokeRect(sideX + 0.5, y + 0.5, sideWidth - 1, slotHeight - 1);
        g.fillStyle = "#dbeafe";
        g.fillText(extra.label || `视图 ${index + 1}`, sideX + 10, y + 7);
        drawContain(g, extra.canvas, sideX + 8, y + labelHeight, sideWidth - 16, Math.max(1, slotHeight - labelHeight - 8));
      });
      if (animate) compositeFrame = requestFrame(paint);
    };
    paint();
    return exportCanvas;
  }

  function stopCompositeLoop(): void {
    if (!compositeFrame) return;
    cancelFrame(compositeFrame);
    compositeFrame = 0;
  }

  async function saveBlob(blob: Blob, filename: string): Promise<void> {
    if (presentFile(blob, filename)) return;
    const mobileLike = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    let url = "";
    let revoke = false;
    if (mobileLike && typeof fetch === "function") {
      try {
        const response = await fetch(`/__local-export?filename=${encodeURIComponent(filename)}`, {
          method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob,
        });
        const payload = await response.json() as { download_url?: string };
        if (!response.ok || !payload.download_url) throw new Error("LocalExportTransferError");
        url = payload.download_url;
        emitExportDiagnostic({ export_kind: exportKind(blob), stage: "local_transfer_completed", mime: blob.type,
          extension: filename.split(".").at(-1) || "", size_bytes: blob.size,
          share_api_available: Boolean(shareNavigator?.share), file_share_supported: false, error_code: null });
      } catch (error) {
        emitExportDiagnostic({ export_kind: exportKind(blob), stage: "local_transfer_failed", mime: blob.type,
          extension: filename.split(".").at(-1) || "", size_bytes: blob.size,
          share_api_available: Boolean(shareNavigator?.share), file_share_supported: false, error_code: safeErrorCode(error) });
      }
    }
    if (!url) { url = createObjectURL(blob); revoke = true; }
    const link = createLink();
    link.href = url;
    link.download = filename;
    // Some browsers only accept download clicks on an attached anchor.
    const element = typeof HTMLAnchorElement !== "undefined" && link instanceof HTMLAnchorElement ? link : null;
    if (element) { element.hidden = true; document.body.append(element); }
    try {
      link.click();
      onDownloadRequested(filename);
      emitExportDiagnostic({ export_kind: exportKind(blob), stage: "download_requested", mime: blob.type || "application/octet-stream",
        extension: filename.split(".").at(-1) || "", size_bytes: blob.size,
        share_api_available: Boolean(shareNavigator?.share), file_share_supported: false, error_code: null });
    } finally {
      element?.remove();
      if (revoke) scheduleRevoke(() => revokeObjectURL(url), downloadUrlLifetimeMs);
    }
  }

  function stop(): boolean {
    if (!recorder) return false;
    recorder.stop();
    return true;
  }

  function start(): boolean {
    if (recorder) return stop();
    if (!canvas?.captureStream) throw new Error("canvas.captureStream is required for overlay export");
    if (!Recorder) throw new Error("MediaRecorder is not available in this browser");
    if (!BlobCtor) throw new Error("Blob is not available in this browser");

    const extras = normalizeExtraCanvases();
    const mobileLike = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    const sourceCanvas = extras.length || mobileLike ? createCompositeSource(extras, true) : canvas;
    if (!sourceCanvas?.captureStream) throw new Error("canvas.captureStream is required for overlay export");
    const stream = sourceCanvas.captureStream(fps);
    chunks = [];
    const selectedMime = recorderMimeType(Recorder);
    recorder = selectedMime ? new Recorder(stream, { mimeType: selectedMime }) : new Recorder(stream);
    const actualMime = recorder.mimeType || selectedMime || "video/webm";
    const outputMime = actualMime.split(";", 1)[0] || "video/webm";
    const extension = extensionForMime(outputMime);
    const observeRecording = (stage: CanvasExportDiagnosticDetail["stage"], size = 0, error: string | null = null) =>
      emitExportDiagnostic({ export_kind: "video", stage, mime: outputMime, extension, size_bytes: size,
        share_api_available: Boolean(shareNavigator?.share), file_share_supported: false, error_code: error });
    let receivedData = false;
    recorder.ondataavailable = (event) => {
      if (event?.data?.size) chunks.push(event.data);
      if (!receivedData) { observeRecording("recording_data", event?.data?.size || 0); receivedData = true; }
    };
    recorder.onstop = async () => {
      stopCompositeLoop();
      observeRecording("recording_stopped", chunks.reduce((sum, chunk) => sum + chunk.size, 0));
      const blob = new BlobCtor(chunks, { type: outputMime });
      const systemName = typeof system === "function" ? system() : system;
      try {
        if (!blob.size) {
          const error = new Error("浏览器未生成视频帧，未发起下载。请导出诊断日志，并记录录制时长和浏览器名称。");
          error.name = "EmptyRecordingError";
          throw error;
        }
        emitExportDiagnostic({ export_kind: "video", stage: "generated", mime: outputMime, extension,
          size_bytes: blob.size, share_api_available: Boolean(shareNavigator?.share), file_share_supported: false, error_code: null });
        await saveBlob(blob, `langer_${systemName || "rstl"}_${now()}.${extension}`);
      } catch (error) {
        emitExportDiagnostic({ export_kind: "video", stage: "generation_failed", mime: outputMime, extension,
          size_bytes: blob.size, share_api_available: Boolean(shareNavigator?.share), file_share_supported: false,
          error_code: safeErrorCode(error) });
        onError(error);
      } finally {
        recorder = null;
        onStateChange(false);
      }
    };
    recorder.start(1000);
    observeRecording("recording_started");
    onStateChange(true);
    return true;
  }

  async function exportImage(): Promise<boolean> {
    if (!canvas?.width || !canvas.height) throw new Error("有效画布尚未准备好，无法导出图片");
    const extras = normalizeExtraCanvases();
    const sourceCanvas = extras.length ? createCompositeSource(extras, false) : canvas;
    if (typeof sourceCanvas.toBlob !== "function") throw new Error("当前浏览器不支持 PNG 图片导出");
    const blob = await new Promise<Blob>((resolve, reject) => {
      sourceCanvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("PNG 图片生成失败"));
      }, "image/png");
    });
    const systemName = typeof system === "function" ? system() : system;
    const filename = `langer_${systemName || "rstl"}_${now()}.png`;
    emitExportDiagnostic({ export_kind: "image", stage: "generated", mime: blob.type || "image/png", extension: "png",
      size_bytes: blob.size, share_api_available: Boolean(shareNavigator?.share), file_share_supported: false, error_code: null });
    await saveBlob(blob, filename);
    return true;
  }

  return {
    get recording() { return Boolean(recorder); },
    get chunkCount() { return chunks.length; },
    start,
    stop,
    toggle: start,
    exportImage,
  };
}
