export const CAMERA_CONSTRAINTS = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
  audio: false,
};

function localHost() {
  const host = globalThis.location?.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function cameraError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

export async function openCameraStream(constraints = CAMERA_CONSTRAINTS) {
  if (globalThis.isSecureContext === false && !localHost()) {
    throw cameraError("InsecureContextError", "Camera requires HTTPS or localhost.");
  }
  if (typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw cameraError("MediaDevicesUnavailable", "navigator.mediaDevices.getUserMedia is unavailable.");
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

export function describeCameraError(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      reason: "permission_denied",
      message: "摄像头权限被拒，请在地址栏左侧重新允许后重试。",
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      reason: "camera_busy",
      message: "摄像头可能被其他程序占用，请关闭会议软件或系统相机后重试。",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      reason: "no_device",
      message: "没有找到可用摄像头，请连接摄像头或检查系统权限。",
    };
  }
  if (name === "InsecureContextError" || name === "MediaDevicesUnavailable") {
    return {
      reason: "insecure_context",
      message: "请用 HTTPS 或 localhost 打开页面后再使用摄像头。",
    };
  }
  return {
    reason: "unknown",
    message: `无法开启摄像头：${error?.message || "未知错误"}。请检查浏览器权限后重试。`,
  };
}
