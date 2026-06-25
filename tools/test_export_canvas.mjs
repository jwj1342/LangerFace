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

console.log("test_export_canvas: canvas webm recorder contract assertions passed");
