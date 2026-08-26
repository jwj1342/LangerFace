/**
 * Single source of truth for the released single-frame wrinkle pipeline.
 * Keep these identifiers stable so a local checkout can be verified before
 * running an experiment or deploying the web app.
 */
export const WRINKLE_PIPELINE_VERSION = Object.freeze({
  rstlAtlas: "8.1.96",
  wrinkleDetection: "v10",
  refinementProfile: "v9-regional-smooth-7.2",
  refinementMode: "v10_three_region_guided_direct_nose_v7_2",
  schemaVersion: "langerface.wrinkle-pipeline.v1",
});

export const WRINKLE_PIPELINE_DISPLAY =
  `RSTL v${WRINKLE_PIPELINE_VERSION.rstlAtlas} · ` +
  `${WRINKLE_PIPELINE_VERSION.wrinkleDetection} 皱纹检测 · ` +
  `V9 7.2 平滑微调`;
