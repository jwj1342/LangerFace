import assert from "node:assert/strict";

import { describeCameraError } from "../web/src/services/cameraSource.ts";

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

console.log("ok: camera errors have actionable messages");
