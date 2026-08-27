import { LATEST_WRINKLE_REFINEMENT_PROFILE } from "./personalized/v9RstlRefinementProfile.ts";
import { YOLO_WRINKLE_ONNX_VERSION } from "./personalized/yoloWrinkleOnnx.ts";

/**
 * Single source of truth for the released single-frame wrinkle pipeline.
 * Keep these identifiers stable so a local checkout can be verified before
 * running an experiment or deploying the web app.
 */
export const WRINKLE_PIPELINE_VERSION = Object.freeze({
  rstlAtlas: "8.1.96",
  wrinkleDetection: "paired-edge-v10-dynamic-four-region-1.0",
  baselineDetection: YOLO_WRINKLE_ONNX_VERSION,
  refinementProfile: LATEST_WRINKLE_REFINEMENT_PROFILE,
  refinementMode: "v10_four_region_guided_direct_nose_v9_7_2",
  executionThread: "web_worker",
  localDetectorProcess: "python_background_process",
  controlledExperimentEvidence: "compat_only_not_used_by_live",
  schemaVersion: "langerface.wrinkle-pipeline.v1",
});

export const WRINKLE_PIPELINE_DISPLAY =
  `RSTL v${WRINKLE_PIPELINE_VERSION.rstlAtlas} · ` +
  `${WRINKLE_PIPELINE_VERSION.wrinkleDetection} 皱纹检测 · ` +
  `V9 7.2 平滑微调`;
