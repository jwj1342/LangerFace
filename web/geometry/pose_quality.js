// Compatibility facade for legacy JS imports.
// The React SPA-owned implementation lives under src/services/geometryPoseQuality.ts.
export {
  INCISION_OVERLAY_POSE_GATE,
  LOCAL_REGION_QUALITY_GATE,
  LOCAL_REGION_QUALITY_REGIONS,
  POSE_MOTION_ANCHORS,
  estimateFacePoseQuality,
  estimateLocalRegionQuality,
  faceBBox,
  frameMotionNorm,
  normalizeFaceExpression,
  regionMotionNorm,
} from "../src/services/geometryPoseQuality.ts";
