export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { exact: "environment" } },
  audio: false,
};

export type CameraFacingMode = "environment" | "user" | "unknown";
export type CameraConstraintLevel = "environment_exact" | "environment_ideal" | "generic";

export interface CameraConstraintCandidate {
  constraintLevel: CameraConstraintLevel;
  constraints: MediaStreamConstraints;
}

export interface CameraOpenResult {
  stream: MediaStream;
  facingMode: CameraFacingMode;
  constraintLevel: CameraConstraintLevel;
}

export type CameraStreamRequest = (constraints: MediaStreamConstraints) => Promise<MediaStream>;
export type CameraRetryGuard = () => boolean;

export const CAMERA_CONSTRAINT_CANDIDATES: readonly CameraConstraintCandidate[] = [
  {
    constraintLevel: "environment_exact",
    constraints: CAMERA_CONSTRAINTS,
  },
  {
    constraintLevel: "environment_ideal",
    constraints: {
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: "environment" } },
      audio: false,
    },
  },
  {
    constraintLevel: "generic",
    constraints: { video: true, audio: false },
  },
];

export interface CameraErrorDescription {
  reason: "permission_denied" | "camera_busy" | "no_device" | "insecure_context" | "unknown";
  message: string;
}

function localHost(): boolean {
  const host = globalThis.location?.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function cameraError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

export async function openCameraStream(constraints: MediaStreamConstraints = CAMERA_CONSTRAINTS): Promise<MediaStream> {
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

export function isCameraSelectionFallbackError(error: unknown): boolean {
  const name = (error as { name?: string } | null | undefined)?.name || "";
  return name === "OverconstrainedError"
    || name === "ConstraintNotSatisfiedError"
    || name === "NotFoundError"
    || name === "DevicesNotFoundError";
}

export function cameraFacingModeFromStream(
  stream: Pick<MediaStream, "getVideoTracks">,
): CameraFacingMode {
  try {
    const facingMode = stream.getVideoTracks()[0]?.getSettings().facingMode;
    return facingMode === "environment" || facingMode === "user" ? facingMode : "unknown";
  } catch {
    return "unknown";
  }
}

export async function openPreferredCameraStream(
  request: CameraStreamRequest = openCameraStream,
  canRetry: CameraRetryGuard = () => true,
): Promise<CameraOpenResult> {
  for (let index = 0; index < CAMERA_CONSTRAINT_CANDIDATES.length; index += 1) {
    const candidate = CAMERA_CONSTRAINT_CANDIDATES[index];
    try {
      const stream = await request(candidate.constraints);
      return {
        stream,
        facingMode: cameraFacingModeFromStream(stream),
        constraintLevel: candidate.constraintLevel,
      };
    } catch (error) {
      const hasNextCandidate = index < CAMERA_CONSTRAINT_CANDIDATES.length - 1;
      if (!hasNextCandidate || !isCameraSelectionFallbackError(error) || !canRetry()) throw error;
    }
  }
  throw cameraError("NotFoundError", "No camera constraint candidate succeeded.");
}

export function stopCameraStream(stream: Pick<MediaStream, "getTracks"> | null | undefined): void {
  for (const track of stream?.getTracks() || []) track.stop();
}

export function describeCameraError(error: unknown): CameraErrorDescription {
  const err = error as { name?: string; message?: string } | null | undefined;
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      reason: "permission_denied",
      message: "本次摄像头权限未获允许。可再次点击“开启后置摄像头”重新申请；若手机不再弹出授权框，请到手机系统设置或浏览器的网站权限中允许本网站使用摄像头后重试。",
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
    message: `无法开启摄像头：${err?.message || "未知错误"}。请检查浏览器权限后重试。`,
  };
}
