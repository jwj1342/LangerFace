import assert from "node:assert/strict";

import { createCanvasRecordingController } from "../web/src/services/canvasRecording.ts";

const chunks = [
  { size: 7, payload: "frame-a" },
  { size: 0, payload: "empty" },
  { size: 11, payload: "frame-b" },
];
const recorderCalls = [];

class FakeMediaRecorder {
  static isTypeSupported(mime) {
    return mime === "video/webm";
  }

  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    recorderCalls.push({ stream, options });
  }

  start() {
    recorderCalls.push({ op: "start" });
    for (const data of chunks) this.ondataavailable?.({ data });
  }

  stop() {
    recorderCalls.push({ op: "stop" });
    this.onstop?.();
  }
}

class FakeBlob {
  constructor(parts, options) {
    this.parts = parts;
    this.options = options;
    this.size = parts.reduce((acc, item) => acc + item.size, 0);
    this.type = options.type;
  }
}

const downloads = [];
const links = [];
const requestedDownloads = [];
const canvas = {
  captureStream(fps) {
    recorderCalls.push({ op: "captureStream", fps });
    return { kind: "main-canvas-stream", fps };
  },
};

let recordingStates = [];
let system = "rstl";
const controller = createCanvasRecordingController({
  canvas,
  system: () => system,
  fps: 30,
  now: () => 123456,
  Recorder: FakeMediaRecorder,
  BlobCtor: FakeBlob,
  createObjectURL(blob) {
    downloads.push(blob);
    return `blob://export/${blob.size}`;
  },
  createLink() {
    const link = {
      href: "",
      download: "",
      click() {
        links.push({ href: this.href, download: this.download });
      },
    };
    return link;
  },
  onStateChange(recording) {
    recordingStates.push(recording);
  },
  onDownloadRequested(filename) {
    requestedDownloads.push(filename);
  },
});

assert.equal(controller.recording, false);
assert.equal(controller.start(), true);
assert.equal(controller.recording, true);
assert.equal(controller.chunkCount, 2, "empty MediaRecorder chunks are ignored");
assert.deepEqual(recordingStates, [true], "start reports recording state");
assert.deepEqual(recorderCalls[0], { op: "captureStream", fps: 30 });
assert.equal(recorderCalls[1].stream.kind, "main-canvas-stream");
assert.equal(recorderCalls[1].options.mimeType, "video/webm");
system = "langer";
assert.equal(controller.stop(), true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(controller.recording, false);
assert.deepEqual(recordingStates, [true, false], "stop reports idle state");
assert.equal(downloads.length, 1);
assert.equal(downloads[0].options.type, "video/webm");
assert.equal(downloads[0].parts.length, 2);
assert.deepEqual(links, [{ href: "blob://export/18", download: "langer_langer_123456.webm" }]);
assert.deepEqual(requestedDownloads, ["langer_langer_123456.webm"]);

class Mp4MediaRecorder extends FakeMediaRecorder {
  static isTypeSupported(mime) {
    return mime === "video/mp4";
  }
}
const mp4Links = [];
const mp4Controller = createCanvasRecordingController({
  canvas,
  Recorder: Mp4MediaRecorder,
  BlobCtor: FakeBlob,
  now: () => 999,
  createObjectURL: () => "blob://export/mp4",
  createLink: () => ({ href: "", download: "", click() { mp4Links.push(this.download); } }),
});
assert.equal(mp4Controller.start(), true);
assert.equal(mp4Controller.stop(), true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(mp4Links, ["langer_rstl_999.mp4"], "supported MP4 recording uses a matching extension");

assert.throws(
  () => createCanvasRecordingController({ canvas: {}, Recorder: FakeMediaRecorder, BlobCtor: FakeBlob }).start(),
  /canvas\.captureStream/,
);

const compositeCalls = [];
const compositeCtx = {
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  font: "",
  textBaseline: "",
  fillRect: (...args) => compositeCalls.push({ op: "fillRect", args }),
  strokeRect: (...args) => compositeCalls.push({ op: "strokeRect", args }),
  fillText: (...args) => compositeCalls.push({ op: "fillText", args }),
  drawImage: (...args) => compositeCalls.push({ op: "drawImage", source: args[0]?.name || args[0]?.kind || "unknown", args }),
};

const compositeCanvas = {
  name: "composite-canvas",
  width: 0,
  height: 0,
  getContext(type) {
    assert.equal(type, "2d");
    return compositeCtx;
  },
  captureStream(fps) {
    compositeCalls.push({ op: "captureStream", source: "composite", fps });
    return { kind: "composite-stream", fps };
  },
};

const mainCanvas = {
  name: "main-canvas",
  width: 1280,
  height: 720,
  captureStream(fps) {
    compositeCalls.push({ op: "captureStream", source: "main", fps });
    return { kind: "main-stream", fps };
  },
};

const zoomCanvas = { name: "切口候选", width: 300, height: 300 };
const threeCanvas = { name: "3D 视图", width: 640, height: 480 };
const compositeRecorderCalls = [];
class CompositeRecorder extends FakeMediaRecorder {
  constructor(stream, options) {
    super(stream, options);
    compositeRecorderCalls.push({ stream, options });
  }
}

const compositeController = createCanvasRecordingController({
  canvas: mainCanvas,
  getExtraCanvases: () => [
    { label: "切口候选", canvas: zoomCanvas },
    { label: "3D 视图", canvas: threeCanvas },
  ],
  Recorder: CompositeRecorder,
  BlobCtor: FakeBlob,
  createCanvas: () => compositeCanvas,
  requestFrame() { compositeCalls.push({ op: "requestFrame" }); return 44; },
  cancelFrame(id) { compositeCalls.push({ op: "cancelFrame", id }); },
  createObjectURL(blob) { return `blob://composite/${blob.size}`; },
  createLink() { return { click() {} }; },
});

assert.equal(compositeController.start(), true);
assert.equal(compositeCanvas.width, 1280 + Math.max(12, Math.round(1280 * 0.012)) + Math.max(240, Math.min(420, Math.round(1280 * 0.28))));
assert.equal(compositeCanvas.height, 720);
assert.equal(compositeRecorderCalls[0].stream.kind, "composite-stream");
assert.ok(compositeCalls.some((call) => call.op === "captureStream" && call.source === "composite"), "composite canvas stream is recorded");
assert.ok(!compositeCalls.some((call) => call.op === "captureStream" && call.source === "main"), "main canvas is not recorded directly when extras exist");
assert.ok(compositeCalls.some((call) => call.op === "drawImage" && call.source === "main-canvas"), "composite export draws main canvas");
assert.ok(compositeCalls.some((call) => call.op === "drawImage" && call.source === "切口候选"), "composite export draws zoom canvas");
assert.ok(compositeCalls.some((call) => call.op === "drawImage" && call.source === "3D 视图"), "composite export draws 3D canvas");
assert.ok(compositeCalls.some((call) => call.op === "fillText" && call.args[0] === "切口候选"), "composite export labels zoom view");
assert.equal(compositeController.stop(), true);
assert.ok(compositeCalls.some((call) => call.op === "cancelFrame" && call.id === 44), "composite painter is stopped");

const imageDownloads = [];
const revokedUrls = [];
const pngBlob = { size: 31, type: "image/png" };
const imageCanvas = {
  width: 640,
  height: 480,
  toBlob(callback, type) {
    assert.equal(type, "image/png");
    callback(pngBlob);
  },
};
const imageController = createCanvasRecordingController({
  canvas: imageCanvas,
  system: "rstl",
  now: () => 654321,
  createObjectURL(blob) {
    assert.equal(blob, pngBlob);
    return "blob://still/31";
  },
  revokeObjectURL(url) { revokedUrls.push(url); },
  scheduleRevoke(callback, delayMs) {
    assert.equal(delayMs, 5 * 60 * 1000);
    callback();
  },
  createLink() {
    return {
      href: "",
      download: "",
      click() { imageDownloads.push({ href: this.href, download: this.download }); },
    };
  },
});
assert.equal(await imageController.exportImage(), true);
assert.equal(imageController.recording, false, "still image export never starts MediaRecorder");
assert.deepEqual(imageDownloads, [{ href: "blob://still/31", download: "langer_rstl_654321.png" }]);
assert.deepEqual(revokedUrls, ["blob://still/31"], "PNG object URL is released after download begins");

const sharedFiles = [];
const pendingFiles = [];
const deferredController = createCanvasRecordingController({
  canvas: imageCanvas,
  presentFile(blob, filename) { pendingFiles.push({ blob, filename }); return true; },
  shareNavigator: { async share() { throw new Error("must wait for a fresh click"); } },
  createObjectURL() { throw new Error("must not auto-download while save panel is open"); },
});
await deferredController.exportImage();
assert.equal(pendingFiles.length, 1);
assert.equal(pendingFiles[0].blob, pngBlob);
assert.equal(deferredController.recording, false);
class FakeFile {
  constructor(parts, name, options) {
    this.parts = parts;
    this.name = name;
    this.type = options.type;
  }
}
const sharedController = createCanvasRecordingController({
  canvas: imageCanvas,
  system: "langer",
  now: () => 777,
  FileCtor: FakeFile,
  shareNavigator: {
    canShare: ({ files }) => files?.[0]?.type === "image/png",
    async share({ files }) { sharedFiles.push(files[0]); },
  },
  createObjectURL() { return "blob://direct-download"; },
  createLink() { return { href: "", download: "", click() { sharedFiles.push("download"); } }; },
});
assert.equal(await sharedController.exportImage(), true);
assert.deepEqual(sharedFiles, ["download"], "export downloads directly even when the browser supports system sharing");
await assert.rejects(
  () => createCanvasRecordingController({ canvas: { width: 0, height: 0 } }).exportImage(),
  /有效画布尚未准备好/,
);
await assert.rejects(
  () => createCanvasRecordingController({ canvas: { width: 10, height: 10 } }).exportImage(),
  /不支持 PNG 图片导出/,
);
await assert.rejects(
  () => createCanvasRecordingController({
    canvas: { width: 10, height: 10, toBlob(callback) { callback(null); } },
  }).exportImage(),
  /PNG 图片生成失败/,
);

const emptyErrors = [];
class EmptyRecorder extends FakeMediaRecorder {
  start(timeslice) { assert.equal(timeslice, 1000); }
}
const emptyController = createCanvasRecordingController({
  canvas, Recorder: EmptyRecorder, BlobCtor: FakeBlob,
  onError(error) { emptyErrors.push(error.name); },
  createObjectURL() { throw new Error("empty recordings must not download"); },
});
emptyController.start();
emptyController.stop();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(emptyErrors, ["EmptyRecordingError"]);
assert.equal(emptyController.recording, false);

console.log("test_export_canvas: WebM recording and PNG still export assertions passed");
