type AnyRecord = Record<string, any>;
type PointLike = number[];

export const INCISION_OVERLAY_POSE_GATE = {
  schema_version: "incision-overlay-pose-gate/v0.2",
  min_presence: 0.45,
  max_abs_yaw_norm: 0.42,
  max_frame_motion_norm: 0.045,
  max_jaw_open: 0.5,
  max_eye_blink: 0.7,
};

export const POSE_MOTION_ANCHORS = [1, 33, 263, 61, 291, 199, 234, 454];

export const LOCAL_REGION_QUALITY_GATE = {
  schema_version: "rstl-local-region-quality-gate/v0.1",
  dim_region_motion_norm: 0.025,
  freeze_region_motion_norm: 0.045,
  dim_eye_blink: 0.45,
  freeze_eye_blink: 0.7,
  dim_jaw_open: 0.3,
  freeze_jaw_open: 0.5,
  dim_opacity_scale: 0.36,
};

export interface LocalQualityRegionConfig {
  id: string;
  label: string;
  landmarks: number[];
  expressionMetric: string;
  dimExpression: string;
  freezeExpression: string;
  expressionReason: string;
}

export const LOCAL_REGION_QUALITY_REGIONS: LocalQualityRegionConfig[] = [
  {
    id: "brow_eye",
    label: "眼眉区",
    landmarks: [10, 151, 9, 8, 107, 336, 69, 299, 33, 133, 159, 145, 153, 246, 7, 163, 362, 263, 386, 374, 380, 466, 249, 390],
    expressionMetric: "eye_blink_max",
    dimExpression: "dim_eye_blink",
    freezeExpression: "freeze_eye_blink",
    expressionReason: "eye_blink_local_expression",
  },
  {
    id: "mouth",
    label: "口周",
    landmarks: [61, 291, 0, 17, 13, 14, 40, 270, 78, 308, 82, 312, 87, 317],
    expressionMetric: "jaw_open",
    dimExpression: "dim_jaw_open",
    freezeExpression: "freeze_jaw_open",
    expressionReason: "jaw_open_local_expression",
  },
];

function finitePoint(point: unknown): point is PointLike {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function roundOrNull(value: unknown, digits = 4): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Number(numberValue.toFixed(digits)) : null;
}

export function faceBBox(lm: PointLike[] | null | undefined): AnyRecord {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (const point of lm || []) {
    if (!finitePoint(point)) continue;
    x0 = Math.min(x0, point[0]);
    y0 = Math.min(y0, point[1]);
    x1 = Math.max(x1, point[0]);
    y1 = Math.max(y1, point[1]);
  }
  if (x1 < x0) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function frameMotionNorm(
  lm: PointLike[] | null | undefined,
  previousLandmarks: PointLike[] | null | undefined,
  anchors: number[] = POSE_MOTION_ANCHORS,
): number | null {
  if (!Array.isArray(lm) || !Array.isArray(previousLandmarks)) return null;
  const bb = faceBBox(lm);
  const faceDiag = Math.hypot(bb.w, bb.h);
  if (!Number.isFinite(faceDiag) || faceDiag <= 0) return null;
  let sum = 0;
  let count = 0;
  for (const idx of anchors) {
    const p = lm[idx];
    const q = previousLandmarks[idx];
    if (!finitePoint(p) || !finitePoint(q)) continue;
    const dx = p[0] - q[0];
    const dy = p[1] - q[1];
    sum += dx * dx + dy * dy;
    count += 1;
  }
  if (!count) return null;
  return Math.sqrt(sum / count) / faceDiag;
}

export function regionMotionNorm(
  lm: PointLike[] | null | undefined,
  previousLandmarks: PointLike[] | null | undefined,
  landmarkIndices: number[],
): number | null {
  return frameMotionNorm(lm, previousLandmarks, landmarkIndices);
}

export function normalizeFaceExpression(expression: AnyRecord = {}): AnyRecord {
  const jawOpen = Number(expression.jawOpen ?? expression.jaw_open ?? 0);
  const eyeBlinkLeft = Number(expression.eyeBlinkLeft ?? expression.eye_blink_left ?? 0);
  const eyeBlinkRight = Number(expression.eyeBlinkRight ?? expression.eye_blink_right ?? 0);
  const eyeBlinkMax = Math.max(
    Number.isFinite(eyeBlinkLeft) ? eyeBlinkLeft : 0,
    Number.isFinite(eyeBlinkRight) ? eyeBlinkRight : 0,
  );
  return {
    jaw_open: Number.isFinite(jawOpen) ? roundOrNull(jawOpen, 3) : 0,
    eye_blink_left: Number.isFinite(eyeBlinkLeft) ? roundOrNull(eyeBlinkLeft, 3) : 0,
    eye_blink_right: Number.isFinite(eyeBlinkRight) ? roundOrNull(eyeBlinkRight, 3) : 0,
    eye_blink_max: roundOrNull(eyeBlinkMax, 3),
  };
}

function uniqueReasons(reasons: string[]): string[] {
  return [...new Set(reasons.filter(Boolean))];
}

function regionAction(
  reasons: string[],
  motionNorm: number | null,
  exprValue: number | null,
  region: LocalQualityRegionConfig,
  thresholds: AnyRecord,
): AnyRecord {
  let action = "normal";
  const outReasons = [...reasons];
  if (motionNorm != null && motionNorm > thresholds.freeze_region_motion_norm) {
    action = "freeze";
    outReasons.push(`${region.id}_rapid_local_motion`);
  } else if (motionNorm != null && motionNorm > thresholds.dim_region_motion_norm) {
    action = "dim";
    outReasons.push(`${region.id}_local_motion_review`);
  }
  if (exprValue != null && exprValue > thresholds[region.freezeExpression]) {
    action = "freeze";
    outReasons.push(region.expressionReason);
  } else if (exprValue != null && exprValue > thresholds[region.dimExpression] && action !== "freeze") {
    action = "dim";
    outReasons.push(region.expressionReason);
  }
  return { action, reasons: uniqueReasons(outReasons) };
}

export function estimateLocalRegionQuality(
  lm: PointLike[],
  _width: number,
  _height: number,
  {
    sourceKind = "unknown",
    previousLandmarks = null,
    expression = {},
    thresholds: overrides = {},
  }: AnyRecord = {},
): AnyRecord {
  const thresholds = { ...LOCAL_REGION_QUALITY_GATE, ...overrides };
  const expr = normalizeFaceExpression(expression);
  const regions: AnyRecord[] = [];
  const reasons: string[] = [];
  const liveSource = sourceKind !== "image";

  for (const region of LOCAL_REGION_QUALITY_REGIONS) {
    const motionNorm = liveSource ? regionMotionNorm(lm, previousLandmarks, region.landmarks) : null;
    const exprValue = expr[region.expressionMetric];
    const result = liveSource
      ? regionAction([], motionNorm, exprValue, region, thresholds)
      : { action: "normal", reasons: [] };
    regions.push({
      id: region.id,
      label: region.label,
      action: result.action,
      opacity_scale: result.action === "dim" ? thresholds.dim_opacity_scale : result.action === "freeze" ? 0 : 1,
      reasons: result.reasons,
      motion_norm: roundOrNull(motionNorm),
      expression_metric: region.expressionMetric,
      expression_value: roundOrNull(exprValue, 3),
    });
    reasons.push(...result.reasons);
  }

  const activeRegions = regions.filter((region) => region.action !== "normal");
  return {
    schema_version: thresholds.schema_version,
    passed: activeRegions.length === 0,
    reason: activeRegions[0]?.reasons?.[0] || "local_regions_passed",
    reasons: uniqueReasons(reasons),
    source_kind: sourceKind || "unknown",
    active_region_count: activeRegions.length,
    active_regions: activeRegions.map((region) => region.id),
    regions,
    thresholds: {
      dim_region_motion_norm: thresholds.dim_region_motion_norm,
      freeze_region_motion_norm: thresholds.freeze_region_motion_norm,
      dim_eye_blink: thresholds.dim_eye_blink,
      freeze_eye_blink: thresholds.freeze_eye_blink,
      dim_jaw_open: thresholds.dim_jaw_open,
      freeze_jaw_open: thresholds.freeze_jaw_open,
      dim_opacity_scale: thresholds.dim_opacity_scale,
    },
    clinical_boundary: "Local region quality is an engineering overlay confidence signal, not a clinical stability validation.",
  };
}

export function estimateFacePoseQuality(
  lm: PointLike[],
  width: number,
  height: number,
  {
    presence = 0,
    sourceKind = "unknown",
    previousLandmarks = null,
    expression = {},
    thresholds: overrides = {},
  }: AnyRecord = {},
): AnyRecord {
  const thresholds = { ...INCISION_OVERLAY_POSE_GATE, ...overrides };
  const reasons: string[] = [];
  let yawNorm: number | null = null;
  let absYawNorm: number | null = null;
  let faceFrameFraction: number | null = null;
  const presenceValue = Number(presence);
  const expr = normalizeFaceExpression(expression);
  const localRegionQuality = estimateLocalRegionQuality(lm, width, height, {
    sourceKind,
    previousLandmarks,
    expression,
    thresholds: overrides,
  });

  if (!Array.isArray(lm) || !finitePoint(lm[1]) || !finitePoint(lm[234]) || !finitePoint(lm[454])) {
    reasons.push("missing_pose_landmarks");
  } else {
    const bb = faceBBox(lm);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      faceFrameFraction = (bb.w * bb.h) / (width * height);
    }
    const nose = lm[1];
    const cheekL = lm[234];
    const cheekR = lm[454];
    const cx = (cheekL[0] + cheekR[0]) / 2;
    const fw = Math.abs(cheekR[0] - cheekL[0]);
    yawNorm = fw > 0 ? (nose[0] - cx) / fw : null;
    absYawNorm = Number.isFinite(yawNorm) ? Math.abs(yawNorm as number) : null;
    if (!Number.isFinite(absYawNorm)) reasons.push("invalid_pose_yaw");
    else if (absYawNorm !== null && absYawNorm > thresholds.max_abs_yaw_norm) reasons.push("side_pose_yaw_too_large");
  }

  if (!Number.isFinite(presenceValue) || presenceValue < thresholds.min_presence) {
    reasons.push("low_face_presence");
  }

  const motionNorm = sourceKind !== "image" ? frameMotionNorm(lm, previousLandmarks) : null;
  if (motionNorm != null && motionNorm > thresholds.max_frame_motion_norm) {
    reasons.push("rapid_frame_motion");
  }
  if (expr.jaw_open != null && expr.jaw_open > thresholds.max_jaw_open) {
    reasons.push("jaw_open_expression");
  }
  if (expr.eye_blink_max != null && expr.eye_blink_max > thresholds.max_eye_blink) {
    reasons.push("eye_blink_expression");
  }

  return {
    schema_version: thresholds.schema_version,
    passed: reasons.length === 0,
    reason: reasons[0] || "pose_gate_passed",
    reasons,
    source_kind: sourceKind || "unknown",
    presence: roundOrNull(presenceValue, 3),
    yaw_norm: roundOrNull(yawNorm),
    abs_yaw_norm: roundOrNull(absYawNorm),
    frame_motion_norm: roundOrNull(motionNorm),
    face_frame_fraction: roundOrNull(faceFrameFraction, 5),
    expression: expr,
    local_region_quality: localRegionQuality,
    thresholds: {
      min_presence: thresholds.min_presence,
      max_abs_yaw_norm: thresholds.max_abs_yaw_norm,
      max_frame_motion_norm: thresholds.max_frame_motion_norm,
      max_jaw_open: thresholds.max_jaw_open,
      max_eye_blink: thresholds.max_eye_blink,
    },
  };
}
