import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { describeCameraError, stopCameraStream } from "../web/src/services/cameraSource.ts";

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
assert.match(pipelineSource, /await els\.video\.play\(\);\s*if \(operationId !== sourceOperationId\)/,
  "camera startup rechecks operation ownership after asynchronous video playback");
assert.match(pipelineSource, /catch \(error\) \{\s*releasePendingStream\(\);/,
  "camera startup failures release streams before reporting or ignoring stale operations");

console.log("ok: camera errors and stream startup cleanup are safe");
