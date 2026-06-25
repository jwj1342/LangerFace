export function createCanvasRecordingController({
  canvas,
  system = "rstl",
  fps = 30,
  now = () => Date.now(),
  Recorder = globalThis.MediaRecorder,
  BlobCtor = globalThis.Blob,
  createLink = () => document.createElement("a"),
  createObjectURL = (blob) => URL.createObjectURL(blob),
  onStateChange = () => {},
} = {}) {
  let recorder = null;
  let chunks = [];

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

    const stream = canvas.captureStream(fps);
    chunks = [];
    recorder = new Recorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = (event) => {
      if (event?.data?.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
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
