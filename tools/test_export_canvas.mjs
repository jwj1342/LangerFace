import assert from "node:assert/strict";

import { createCanvasRecordingController } from "../web/export_canvas.js";

const chunks = [
  { size: 7, payload: "frame-a" },
  { size: 0, payload: "empty" },
  { size: 11, payload: "frame-b" },
];
const recorderCalls = [];

class FakeMediaRecorder {
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
  }
}

const downloads = [];
const links = [];
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
assert.equal(controller.recording, false);
assert.deepEqual(recordingStates, [true, false], "stop reports idle state");
assert.equal(downloads.length, 1);
assert.equal(downloads[0].options.type, "video/webm");
assert.equal(downloads[0].parts.length, 2);
assert.deepEqual(links, [{ href: "blob://export/18", download: "langer_langer_123456.webm" }]);

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

console.log("test_export_canvas: canvas webm recorder contract assertions passed");
