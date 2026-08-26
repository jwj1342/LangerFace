import {
  extractFineWrinkleLines,
  type FineWrinkleExtraction,
} from "./fineWrinkleLines.ts";
import {
  refineV6,
  type V6Seed,
} from "./v6RstlRefinementV9.ts";
import {
  latestV9RstlRefinementOptions,
  LATEST_WRINKLE_REFINEMENT_PROFILE,
} from "./v9RstlRefinementProfile.ts";
import {
  YOLO_WRINKLE_CONFIDENCE,
  YOLO_WRINKLE_ONNX_VERSION,
} from "./yoloWrinkleOnnx.ts";

export interface LiveWrinkleModelProgress {
  loadedChunks: number;
  totalChunks: number;
  loadedBytes: number;
  persistentCacheHits: number;
  source: "persistent-cache" | "network";
}

export interface GeneralLiveWrinkleDetection {
  version: string;
  classMasks: Record<string, ArrayLike<number>>;
  diagnostics?: Record<string, unknown>;
}

export interface GeneralLiveWrinkleDetector {
  load(onProgress?: (progress: LiveWrinkleModelProgress) => void): Promise<unknown>;
  detect(
    imageData: ImageData,
    options?: { confidenceThreshold?: number },
  ): Promise<GeneralLiveWrinkleDetection>;
}

export interface GeneralLiveWrinklePipelineInput {
  detector: GeneralLiveWrinkleDetector;
  imageData: ImageData;
  seeds: V6Seed[];
  size: number;
  faceWidthPx: number;
  onModelProgress?: (progress: LiveWrinkleModelProgress) => void;
  onEvidence?: (evidence: FineWrinkleExtraction) => void;
  assertCurrent?: () => void;
}

/**
 * The released single-frame path for every input image. Controlled precomputed
 * evidence belongs to the compatibility experiment and is intentionally not
 * accepted by this API.
 */
export async function runGeneralLiveWrinklePipeline({
  detector,
  imageData,
  seeds,
  size,
  faceWidthPx,
  onModelProgress,
  onEvidence,
  assertCurrent,
}: GeneralLiveWrinklePipelineInput) {
  await detector.load(onModelProgress);
  assertCurrent?.();

  const detection = await detector.detect(imageData, {
    confidenceThreshold: YOLO_WRINKLE_CONFIDENCE,
  });
  assertCurrent?.();
  if (detection.version !== YOLO_WRINKLE_ONNX_VERSION) {
    throw new Error(`皱纹检测器版本不匹配：${detection.version}`);
  }

  const evidence = extractFineWrinkleLines(
    detection.classMasks,
    size,
    size,
    { minimumLineLengthPx: 20, resampleSpacingPx: 1, maximumSkeletonIterations: 96 },
  );
  if (!evidence.lines.length || !evidence.validation.passed) {
    throw new Error("未提取到通过质量门禁的细皱纹线");
  }
  onEvidence?.(evidence);
  assertCurrent?.();

  const refined = refineV6({
    seeds,
    wrinkleMask: evidence.mask,
    confidenceMap: evidence.confidence,
    directionQ: evidence.directionQ,
    size,
    faceWidthPx,
    options: latestV9RstlRefinementOptions(faceWidthPx),
  });
  assertCurrent?.();

  return {
    detectorVersion: detection.version,
    refinementProfile: LATEST_WRINKLE_REFINEMENT_PROFILE,
    evidence,
    refined,
  };
}
