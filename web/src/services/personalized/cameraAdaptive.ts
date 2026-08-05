/** Camera-resolution quality metrics shared by capture and optimizers. */
const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

export interface CameraDimensions {
  width?: number;
}

export interface AdaptiveFaceResolutionContext {
  cameraWidth?: number;
  camera?: CameraDimensions;
  sourceFaceWidth?: number;
  targetFaceWidth?: number;
}

export interface AdaptiveFaceResolutionMetrics {
  quality: number;
  detailQuality: number;
  framingQuality: number;
  sourceFaceWidth: number;
  cameraWidth: number;
  faceFrameRatio: number;
  targetFaceWidth: number;
  softMinimumFaceWidth: number;
  belowSoftMinimum: boolean;
  tooClose: boolean;
  hardBlocking: false;
}

export function adaptiveFaceResolutionMetrics(
  context: AdaptiveFaceResolutionContext = {},
): AdaptiveFaceResolutionMetrics {
  const cameraWidth = Math.max(1, Number(context.cameraWidth || context.camera?.width) || 1280);
  const sourceFaceWidth = Math.max(0, Number(context.sourceFaceWidth) || 0);
  const targetFaceWidth = Math.round(clamp(
    Number(context.targetFaceWidth) || cameraWidth * 0.28,
    240,
    480,
  ));
  const softMinimumFaceWidth = Math.round(clamp(cameraWidth * 0.16, 140, 300));
  const faceFrameRatio = sourceFaceWidth / cameraWidth;
  const detailQuality = sourceFaceWidth > 0 ? clamp(sourceFaceWidth / targetFaceWidth, 0, 1) : 0;
  const tooClose = faceFrameRatio > 0.72;
  const framingQuality = tooClose ? clamp((0.92 - faceFrameRatio) / 0.20, 0.25, 1) : 1;
  const quality = sourceFaceWidth > 0 ? clamp(detailQuality * framingQuality, 0, 1) : 0;
  return {
    quality,
    detailQuality,
    framingQuality,
    sourceFaceWidth,
    cameraWidth,
    faceFrameRatio,
    targetFaceWidth,
    softMinimumFaceWidth,
    belowSoftMinimum: sourceFaceWidth > 0 && sourceFaceWidth < softMinimumFaceWidth,
    tooClose,
    hardBlocking: false,
  };
}
