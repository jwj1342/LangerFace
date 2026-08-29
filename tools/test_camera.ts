import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CAMERA_CONSTRAINT_CANDIDATES,
  cameraFacingModeFromStream,
  describeCameraError,
  isCameraSelectionFallbackError,
  openPreferredCameraStream,
  stopCameraStream,
} from "../web/src/services/cameraSource.ts";

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

function fakeCameraStream(facingMode?: string, settingsError?: Error): MediaStream {
  return {
    getVideoTracks: () => [{
      getSettings: () => {
        if (settingsError) throw settingsError;
        return facingMode ? { facingMode } : {};
      },
    }],
  } as unknown as MediaStream;
}

assert.equal(CAMERA_CONSTRAINT_CANDIDATES.length, 3, "camera selection has three bounded attempts");
assert.deepEqual(CAMERA_CONSTRAINT_CANDIDATES[0], {
  constraintLevel: "environment_exact",
  constraints: {
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { exact: "environment" } },
    audio: false,
  },
});
assert.deepEqual(CAMERA_CONSTRAINT_CANDIDATES[1], {
  constraintLevel: "environment_ideal",
  constraints: {
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: "environment" } },
    audio: false,
  },
});
assert.deepEqual(CAMERA_CONSTRAINT_CANDIDATES[2], {
  constraintLevel: "generic",
  constraints: { video: true, audio: false },
});

for (const name of ["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError", "DevicesNotFoundError"]) {
  assert.equal(isCameraSelectionFallbackError(namedError(name)), true, `${name} permits the next camera constraint`);
}
for (const name of ["NotAllowedError", "SecurityError", "NotReadableError", "TrackStartError", "AbortError"]) {
  assert.equal(isCameraSelectionFallbackError(namedError(name)), false, `${name} must not trigger another permission/device request`);
}

assert.equal(cameraFacingModeFromStream(fakeCameraStream("environment")), "environment");
assert.equal(cameraFacingModeFromStream(fakeCameraStream("user")), "user");
assert.equal(cameraFacingModeFromStream(fakeCameraStream("left")), "unknown");
assert.equal(cameraFacingModeFromStream(fakeCameraStream()), "unknown");
assert.equal(cameraFacingModeFromStream(fakeCameraStream(undefined, namedError("SettingsError"))), "unknown");

let exactAttempts = 0;
const exactStream = fakeCameraStream("environment");
const exactResult = await openPreferredCameraStream(async () => {
  exactAttempts += 1;
  return exactStream;
});
assert.equal(exactAttempts, 1, "rear-camera success does not issue unnecessary fallback requests");
assert.equal(exactResult.stream, exactStream);
assert.equal(exactResult.facingMode, "environment");
assert.equal(exactResult.constraintLevel, "environment_exact");

const fallbackAttempts: MediaStreamConstraints[] = [];
const fallbackStream = fakeCameraStream("user");
const fallbackResult = await openPreferredCameraStream(async (constraints) => {
  fallbackAttempts.push(constraints);
  if (fallbackAttempts.length === 1) throw namedError("OverconstrainedError");
  if (fallbackAttempts.length === 2) throw namedError("NotFoundError");
  return fallbackStream;
});
assert.deepEqual(fallbackAttempts, CAMERA_CONSTRAINT_CANDIDATES.map((candidate) => candidate.constraints));
assert.equal(fallbackResult.stream, fallbackStream);
assert.equal(fallbackResult.facingMode, "user", "fallback reports the front camera that the browser actually opened");
assert.equal(fallbackResult.constraintLevel, "generic");

let permissionAttempts = 0;
await assert.rejects(
  openPreferredCameraStream(async () => {
    permissionAttempts += 1;
    throw namedError("NotAllowedError");
  }),
  { name: "NotAllowedError" },
);
assert.equal(permissionAttempts, 1, "permission denial is reported without retrying");

let repeatedPermissionAttempts = 0;
const rejectPermissionRequest = async () => {
  repeatedPermissionAttempts += 1;
  throw namedError("NotAllowedError");
};
await assert.rejects(openPreferredCameraStream(rejectPermissionRequest), { name: "NotAllowedError" });
await assert.rejects(openPreferredCameraStream(rejectPermissionRequest), { name: "NotAllowedError" });
assert.equal(
  repeatedPermissionAttempts,
  2,
  "two separate camera actions make two fresh permission requests after one-time denials",
);

let retryOwnerActive = true;
let staleAttempts = 0;
await assert.rejects(
  openPreferredCameraStream(async () => {
    staleAttempts += 1;
    retryOwnerActive = false;
    throw namedError("OverconstrainedError");
  }, () => retryOwnerActive),
  { name: "OverconstrainedError" },
);
assert.equal(staleAttempts, 1, "a stale camera operation stops before requesting another fallback constraint");

assert.deepEqual(describeCameraError({ name: "NotAllowedError" }), {
  reason: "permission_denied",
  message: "本次摄像头权限未获允许。可再次点击“开启后置摄像头”重新申请；若手机不再弹出授权框，请到手机系统设置或浏览器的网站权限中允许本网站使用摄像头后重试。",
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
assert.match(
  pipelineSource,
  /const openedCamera = await openPreferredCameraStream\(\s*undefined,\s*\(\) => operationId === sourceOperationId,\s*\);/,
  "pipeline uses the bounded rear-camera preference helper with an operation-ownership retry guard",
);
assert.match(
  pipelineSource,
  /await els\.video\.play\(\);[\s\S]*?if \(operationId !== sourceOperationId\)[\s\S]*?options\.onFacingMode\?\.\(openedCamera\.facingMode\);[\s\S]*?setSource\(/,
  "mirror synchronization happens only after successful playback and ownership checks, before the first source frame",
);
assert.match(
  pipelineSource,
  /captureCurrentStaticSource\(\);[\s\S]*?stopSource\(\{ preserveOperation: true, preserveRefinementForLive, preserveStaticResume: true \}\)[\s\S]*?renderState\.incisionOverlay = activeIncisionOverlay/,
  "opening the camera snapshots the static session and restores the already-approved incision overlay after source replacement",
);
assert.match(
  pipelineSource,
  /if \(currentLiveSourceKind\(\) === "camera"\) \{\s*restoreStaticSourceOrPlaceholder\(renderState\.incisionOverlay\)/,
  "the camera command is a real toggle whose off path restores the previous static source when available",
);
assert.match(
  pipelineSource,
  /restoreRefineDisplayState\(resume\.refinement\);\s*restoreWrinkleDisplayState\(resume\.wrinkle\);\s*renderState\.incisionOverlay = activeIncisionOverlay/,
  "closing the camera restores static display-only RSTL, wrinkle, and incision state without rerunning their algorithms",
);
assert.match(
  pipelineSource,
  /if \(!resume\) \{[\s\S]*?showCameraPlaceholder\(\);[\s\S]*?setLive\(false, "待机"\)/,
  "closing a camera without an earlier photo returns to the default dark standby canvas",
);

const liveRuntime = readFileSync(new URL("../web/src/services/liveRuntime.ts", import.meta.url), "utf8");
const mobileControls = readFileSync(new URL("../web/src/components/MobileWorkflowControls.tsx", import.meta.url), "utf8");
const desktopControls = readFileSync(new URL("../web/src/components/LiveSourceControlsPanel.tsx", import.meta.url), "utf8");
assert.match(mobileControls, /cameraActive \? "关闭后置摄像头" : "开启后置摄像头"/,
  "mobile camera control exposes an explicit on/off state");
assert.match(desktopControls, /cameraActive \? "■ 关闭摄像头" : "◉ 开启摄像头"/,
  "desktop camera control exposes an explicit on/off state");
assert.match(liveRuntime, /renderState\.mirror = eventChecked\(e\);\s*els\.mirror\.checked = renderState\.mirror;/,
  "programmatic camera mirror changes keep the visible mirror control synchronized");
assert.match(
  liveRuntime,
  /cameraToggle: \(\) => startCamera\(\{\s*onFacingMode\(\) \{\s*handleMirrorChange\(checkedEvent\(false\)\);\s*\},\s*\}\)/,
  "every successfully opened camera disables automatic display mirroring before the first source frame",
);
assert.doesNotMatch(
  liveRuntime,
  /onFacingMode[\s\S]{0,180}checkedEvent\(true\)/,
  "front-camera fallback must not enable automatic mirroring",
);

console.log("ok: rear-camera preference, unmirrored fallback, errors, and stream startup cleanup are safe");
