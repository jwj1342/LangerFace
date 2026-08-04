/** Camera-resolution quality metrics shared by capture and optimizers. */
// @ts-nocheck -- compatibility kernel typing is tracked by #95.
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export function adaptiveFaceResolutionMetrics(context = {}) {
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
