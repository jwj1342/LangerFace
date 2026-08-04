export const STATIC_IMAGE_MAX_ATTEMPTS = 3;

export interface StaticNormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

export interface StaticFaceResult {
  faceLandmarks?: StaticNormalizedLandmark[][];
  faceBlendshapes?: Array<{ categories?: Array<{ categoryName?: string; score?: number }> }>;
}

export interface StaticImageDetector {
  detect: (source: unknown) => StaticFaceResult;
}

export interface StaticImageDetectionOutcome {
  result: StaticFaceResult | null;
  attempts: number;
  error: unknown;
}

function hasFaceLandmarks(result: StaticFaceResult | null): boolean {
  return Boolean(result?.faceLandmarks?.[0]?.length);
}

export function detectStaticImageWithRetries(
  detector: StaticImageDetector | null,
  source: unknown,
  maxAttempts = STATIC_IMAGE_MAX_ATTEMPTS,
): StaticImageDetectionOutcome {
  const attemptLimit = Math.max(1, Math.floor(maxAttempts));
  let result: StaticFaceResult | null = null;
  let error: unknown = null;

  if (!detector) {
    return { result, attempts: 0, error: new Error("静态图片检测器尚未就绪") };
  }

  for (let attempts = 1; attempts <= attemptLimit; attempts += 1) {
    try {
      result = detector.detect(source);
      error = null;
      if (hasFaceLandmarks(result)) return { result, attempts, error };
    } catch (caught) {
      result = null;
      error = caught;
    }
  }

  return { result, attempts: attemptLimit, error };
}
