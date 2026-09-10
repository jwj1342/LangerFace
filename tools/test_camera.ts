import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { describeCameraError, stopCameraStream } from "../web/src/services/cameraSource.ts";
import { loadVideoFirstFrame } from "../web/src/services/videoSource.ts";

class FakeVideo extends EventTarget {
  readyState = 0;
  currentTime = 0;
  autoplay = true;
  preload = "none";
  srcObject = {};
  src = "";
  paused = false;
  loadCount = 0;
  pause() { this.paused = true; }
  load() { this.loadCount += 1; }
}

const video = new FakeVideo();
let decoded = false;
const firstFrame = loadVideoFirstFrame(video as unknown as HTMLVideoElement, "blob:first")
  .then(() => { decoded = true; });
await Promise.resolve();
assert.equal(decoded, false, "initialization waits for decoded pixels");
assert.equal(video.paused, true);
assert.equal(video.autoplay, false);
assert.equal(video.loadCount, 1);
video.dispatchEvent(new Event("loadeddata"));
await firstFrame;
assert.equal(video.currentTime, 0, "decoding does not advance playback");
assert.equal(video.paused, true, "playback waits for first-frame extraction");
const brokenVideo = new FakeVideo();
const failedFrame = loadVideoFirstFrame(brokenVideo as unknown as HTMLVideoElement, "blob:bad");
brokenVideo.dispatchEvent(new Event("error"));
await assert.rejects(failedFrame, /first video frame/);

assert.deepEqual(describeCameraError({ name: "NotAllowedError" }), {
  reason: "permission_denied",
  message: "摄像头权限被拒，请在地址栏左侧重新允许后重试。",
});
assert.deepEqual(describeCameraError({ name: "NotReadableError" }), {
  reason: "camera_busy",
  message: "摄像头可能被其他程序占用，请关闭会议软件或系统相机后重试。",
});
assert.deepEqual(describeCameraError({ name: "NotFoundError" }), {
  reason: "no_device",
  message: "没有找到可用摄像头，请连接摄像头或检查系统权限。",
});
assert.deepEqual(describeCameraError({ name: "MediaDevicesUnavailable" }), {
  reason: "insecure_context",
  message: "请用 HTTPS 或 localhost 打开页面后再使用摄像头。",
});
assert.equal(describeCameraError({ name: "OtherError", message: "boom" }).reason, "unknown");

let stoppedTracks = 0;
stopCameraStream({
  getTracks: () => [
    { stop: () => { stoppedTracks += 1; } },
    { stop: () => { stoppedTracks += 1; } },
  ] as unknown as MediaStreamTrack[],
});
assert.equal(stoppedTracks, 2, "camera stream cleanup stops every acquired track");
stopCameraStream(null);

const pipelineSource = readFileSync(new URL("../web/src/services/pipelineSource.ts", import.meta.url), "utf8");
assert.match(pipelineSource,
  /await loadVideoFirstFrame[\s\S]*loop\(\);\s*cancelFrame\(\);\s*await waitForLiveWrinkleAnalysis\(\);\s*if \(operationId !== sourceOperationId\) return;\s*await els\.video\.play\(\)/,
  "uploaded video extracts the first frame before playback and ignores replaced sources");
assert.match(pipelineSource,
  /VITE_SERVER_COMPUTE[\s\S]*fetch\("\/api\/gpu\/media\/video"[\s\S]*preparedVideo\.release/,
  "server builds upload videos for browser-compatible playback and release them with the source");
assert.match(pipelineSource, /await els\.video\.play\(\);\s*if \(operationId !== sourceOperationId\)/,
  "camera startup rechecks operation ownership after asynchronous video playback");
assert.match(pipelineSource, /catch \(error\) \{\s*releasePendingStream\(\);/,
  "camera startup failures release streams before reporting or ignoring stale operations");

console.log("ok: camera errors and stream startup cleanup are safe");
