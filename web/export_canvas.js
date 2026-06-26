export function createCanvasRecordingController({
  canvas,
  getExtraCanvases = () => [],
  system = "rstl",
  fps = 30,
  now = () => Date.now(),
  Recorder = globalThis.MediaRecorder,
  BlobCtor = globalThis.Blob,
  createCanvas = () => document.createElement("canvas"),
  createLink = () => document.createElement("a"),
  createObjectURL = (blob) => URL.createObjectURL(blob),
  requestFrame = (cb) => requestAnimationFrame(cb),
  cancelFrame = (id) => cancelAnimationFrame(id),
  onStateChange = () => {},
} = {}) {
  let recorder = null;
  let chunks = [];
  let compositeFrame = 0;

  function drawableCanvas(item) {
    const cv = item?.canvas || item;
    if (!cv || !cv.width || !cv.height) return null;
    return {
      canvas: cv,
      label: item?.label || cv.dataset?.exportLabel || "",
    };
  }

  function normalizeExtraCanvases() {
    return (getExtraCanvases?.() || []).map(drawableCanvas).filter(Boolean);
  }

  function drawContain(ctx, source, x, y, w, h) {
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

  function createCompositeSource(extras) {
    const exportCanvas = createCanvas();
    const mainWidth = canvas.width || 1280;
    const mainHeight = canvas.height || 720;
    const gap = Math.max(12, Math.round(mainWidth * 0.012));
    const sideWidth = Math.max(240, Math.min(420, Math.round(mainWidth * 0.28)));
    exportCanvas.width = mainWidth + gap + sideWidth;
    exportCanvas.height = mainHeight;
    const g = exportCanvas.getContext("2d");
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
      compositeFrame = requestFrame(paint);
    };
    paint();
    return exportCanvas;
  }

  function stopCompositeLoop() {
    if (!compositeFrame) return;
    cancelFrame(compositeFrame);
    compositeFrame = 0;
  }

  function stop() {
    if (!recorder) return false;
    recorder.stop();
    return true;
  }

  function start() {
    if (recorder) return stop();
    if (!canvas?.captureStream) throw new Error("canvas.captureStream is required for overlay export");
    if (!Recorder) throw new Error("MediaRecorder is not available in this browser");
    if (!BlobCtor) throw new Error("Blob is not available in this browser");

    const extras = normalizeExtraCanvases();
    const sourceCanvas = extras.length ? createCompositeSource(extras) : canvas;
    if (!sourceCanvas?.captureStream) throw new Error("canvas.captureStream is required for overlay export");
    const stream = sourceCanvas.captureStream(fps);
    chunks = [];
    recorder = new Recorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = (event) => {
      if (event?.data?.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      stopCompositeLoop();
      const blob = new BlobCtor(chunks, { type: "video/webm" });
      const link = createLink();
      link.href = createObjectURL(blob);
      const systemName = typeof system === "function" ? system() : system;
      link.download = `langer_${systemName || "rstl"}_${now()}.webm`;
      link.click();
      recorder = null;
      onStateChange(false);
    };
    recorder.start();
    onStateChange(true);
    return true;
  }

  return {
    get recording() { return Boolean(recorder); },
    get chunkCount() { return chunks.length; },
    start,
    stop,
    toggle: start,
  };
}
