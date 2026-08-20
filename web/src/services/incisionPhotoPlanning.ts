import {
  innerMouthTriangles,
  mapAtlas,
  type AtlasLine,
  type MappedAtlasLine,
} from "./geometryAtlas.ts";
import {
  buildForeheadSkinVisibility,
  buildHeadVisibility,
  type VisibilityPredicate,
} from "./foreheadVisibility.ts";
import { mapSurfaceRefs, pointToSurfaceRef, polylineToSurfaceRefs, type SurfaceRef } from "./incisionOverlay.ts";
import { buildRstlRenderPlan } from "./rstlRenderPlan.ts";
import { incisionOverlayStyle } from "./incisionOverlayStyle.ts";
import { pointInPolygon2d, segmentsIntersect2d, type Point2 } from "./incisionPathGeometry.ts";
import type { Triangle, Vec3 } from "./softBody.ts";

export const INCISION_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const INCISION_PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);

export function incisionPhotoStrokeWidths(sourceWidth: number) {
  const style = incisionOverlayStyle(sourceWidth);
  const rstl = style.rstlLineWidth;
  const candidate = style.candidate.lineWidth;
  const boundary = style.boundary.lineWidth;
  return {
    rstl,
    candidate,
    candidateHalo: style.candidate.haloWidth,
    boundary,
    boundaryHalo: style.boundary.haloWidth,
  };
}

export const incisionPhotoEndpointRadius = (_candidateStrokeWidth: number): number => 3;

export function incisionPhotoLayerContract(tumorKind: string, candidateType?: string) {
  const expectedCandidateType = tumorKind === "cutaneous" ? "fusiform" : "linear";
  return {
    expectedCandidateType,
    candidateTypeMatches: candidateType == null || candidateType === expectedCandidateType,
    showDiameterEstimate: tumorKind === "subcutaneous",
  };
}

export type IncisionPhotoStatusTone = "idle" | "ready" | "warning";
export type IncisionPhotoSmoothingMode = "photoCanonical" | "limitedVisibility" | "constrainedReference"
  | "globalBezier" | "segmentedBezier" | "sourceFallback" | "notApplicable";

export function incisionPhotoStatusPresentation({
  rstlLineCount,
  candidateDisplayBlocked,
  engineeringBlockMessage,
  candidateProjectionValid,
  candidatePointCount,
  candidateSmoothingMode = "notApplicable",
  candidateReferenceAspectRatio = null,
  projectedRstlDeviationDeg = null,
}: {
  rstlLineCount: number;
  candidateDisplayBlocked: boolean;
  engineeringBlockMessage: string;
  candidateProjectionValid: boolean;
  candidatePointCount: number;
  candidateSmoothingMode?: IncisionPhotoSmoothingMode;
  candidateReferenceAspectRatio?: number | null;
  projectedRstlDeviationDeg?: number | null;
}): { message: string; tone: IncisionPhotoStatusTone } {
  const projectedDirectionNeedsReview = projectedRstlDeviationDeg != null
    && Number.isFinite(projectedRstlDeviationDeg)
    && projectedRstlDeviationDeg > 15;
  const limitedVisibilityRatio = Number(candidateReferenceAspectRatio || 0);
  const limitedVisibilityIsStandard = Math.abs(limitedVisibilityRatio - 3) <= 0.05;
  const detail = candidateDisplayBlocked
    ? engineeringBlockMessage || "候选未显示：工程门禁未通过。"
    : !candidateProjectionValid
      ? "候选未显示：当前位置无法形成平滑、完整的梭形切口；请移动病灶或调整范围后重试。"
      : candidatePointCount > 0
        ? candidateSmoothingMode === "limitedVisibility"
          ? limitedVisibilityIsStandard
            ? "已识别肿物边界。当前为视野受限参考，不能确认完整长度及不可见区域，请结合另一视角复核"
            : `已识别肿物边界。当前为视野受限的非标准比例参考（${limitedVisibilityRatio.toFixed(2)}:1），不能确认完整长度及不可见区域，请结合另一视角复核`
          : candidateSmoothingMode === "constrainedReference"
          ? `受限参考候选已显示：原定 3:1 梭形超出可用面部区域，当前按 ${Number(candidateReferenceAspectRatio || 0).toFixed(2)}:1 显示；该结果不满足项目原定比例，只供医生评估约束原因`
          : candidateSmoothingMode === "sourceFallback"
          ? "候选已显示，但当前照片位置未完成平滑校正，请复核梭形轮廓"
          : projectedDirectionNeedsReview
          ? `候选已叠加 · 照片投影方向偏差 ${projectedRstlDeviationDeg.toFixed(1)}°，需复核`
          : "候选已叠加"
        : "点击面部设置病灶";
  return {
    message: `照片规划 · RSTL ${rstlLineCount} 条 · ${detail}`,
    tone: candidateDisplayBlocked
      || !candidateProjectionValid
      || projectedDirectionNeedsReview
      || candidateSmoothingMode === "limitedVisibility"
      || candidateSmoothingMode === "constrainedReference"
      || candidateSmoothingMode === "sourceFallback"
      ? "warning"
      : candidatePointCount > 0 ? "ready" : "idle",
  };
}

export interface IncisionPhotoGeometry {
  rstl: MappedAtlasLine[];
  center: Vec3 | null;
  planningCenter: Vec3 | null;
  lesionToPlanningCenterPx: number | null;
  diameterEstimate: Vec3[];
  boundary: Vec3[];
  candidate: Vec3[];
  endpoints: Vec3[];
  candidateProjection: {
    valid: boolean;
    reasonCodes: string[];
    surfaceConstrained?: boolean;
    sourceReasonCodes?: string[];
    smoothingMode?: IncisionPhotoSmoothingMode;
    smoothingDiagnostics?: FusiformFitDiagnostics | null;
    referenceAspectRatio?: number | null;
    referenceLengthScale?: number | null;
    referenceAttempts?: PhotoReferenceAttemptDiagnostics[];
    visibilityLimited?: boolean;
    visibleFraction?: number | null;
    hiddenPointCount?: number;
  };
  fusiformRendering?: SurfaceProjectedFusiformFit | null;
  projectedRstlDeviationDeg: number | null;
}

export type FusiformRenderMode = "raw" | "globalBezierDirect" | "segmentedBezierDirect"
  | "sampledPolyline" | "sampledLocalCubic";
export type IncisionPhotoCubic = [Vec3, Vec3, Vec3, Vec3];

export interface SurfaceProjectedFusiformFit {
  outline: Vec3[];
  sourceOutline: Vec3[];
  upperCurve: IncisionPhotoCubic;
  lowerCurve: IncisionPhotoCubic;
  upperCurves: IncisionPhotoCubic[];
  lowerCurves: IncisionPhotoCubic[];
  visibleSegments?: Vec3[][];
  strategy: "global_cubic" | "segmented_c1";
  blend: number;
  medianSegment: number;
}

export type FusiformFitFailureReason =
  | "insufficient_points"
  | "invalid_topology"
  | "invalid_sampling"
  | "center_shift_exceeded"
  | "corridor_exceeded"
  | "envelope_exceeded"
  | "photo_boundary_not_enclosed"
  | "photo_surface_exit";

export interface FusiformFitDiagnostics {
  ok: boolean;
  reason: FusiformFitFailureReason | null;
  inputPointCount: number;
  candidateLength: number;
  maxWidth: number;
  centerShift: number;
  centerShiftLimit: number;
  corridor: number;
  maxCorridorError: number;
  envelopeOverflow: number;
  segmentCount: number;
  maxTangentDiscontinuityDeg: number;
  maxEndpointTangentErrorDeg: number;
  strategy: "centerline_halfwidth_global_cubic" | "centerline_halfwidth_segmented_c1" | "photo_space_canonical_surface_contained";
  photoCanonicalReason?: FusiformFitFailureReason | null;
  photoCanonicalScale?: number;
  photoBoundaryOutsideCount?: number;
  photoSurfaceOutsideCount?: number;
  photoSurfaceMeshOutsideCount?: number;
  photoHeadOutsideCount?: number;
  photoSkinOutsideCount?: number;
  photoCanonicalAxisSource?: "nearest_projected_rstl" | "source_endpoints";
  photoCanonicalAspectRatio?: number;
  photoCanonicalStandardAspectRatio?: number;
  photoCanonicalReference?: boolean;
  photoCanonicalLengthScale?: number;
  photoVisibilityLimitedEligible?: boolean;
  photoVisibleFraction?: number;
  photoVisibleSegmentCount?: number;
}

export interface PhotoReferenceAttemptDiagnostics {
  aspectRatio: number;
  ok: boolean;
  reason: FusiformFitFailureReason | null;
  boundaryOutsideCount: number;
  surfaceOutsideCount: number;
  meshOutsideCount: number;
  headOutsideCount: number;
  skinOutsideCount: number;
}

export interface PhotoSurfaceCanonicalFusiformAttempt {
  fit: SurfaceProjectedFusiformFit | null;
  visibilityLimitedFit: SurfaceProjectedFusiformFit | null;
  endpoints: Vec3[];
  diagnostics: FusiformFitDiagnostics;
}

export interface SurfaceProjectedFusiformFitAttempt {
  fit: SurfaceProjectedFusiformFit | null;
  diagnostics: FusiformFitDiagnostics;
}

export interface IncisionPhotoRenderInput {
  context: CanvasRenderingContext2D;
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  devicePixelRatio: number;
  landmarks: Vec3[];
  surfaceLandmarks?: Vec3[];
  triangles: Triangle[];
  atlasLines: AtlasLine[] | unknown;
  centerRef: SurfaceRef | null;
  diameterEstimateRefs?: SurfaceRef[];
  photoDiameterEstimateMm?: number;
  photoPixelsPerMm?: number;
  candidateLengthMm?: number;
  boundaryRefs: SurfaceRef[];
  photoBoundary?: Vec3[];
  candidateRefs: SurfaceRef[];
  endpointRefs: SurfaceRef[];
  endpointRadius?: number;
  tumorInputInvalid?: boolean;
  candidateType?: string;
  candidateAspectRatio?: number;
  candidateAxisCoverageRatio?: number;
  candidateTipAngleDeg?: number;
  candidateSkinVisible?: VisibilityPredicate;
  displayScale?: number;
  fusiformRenderMode?: FusiformRenderMode;
  drawCandidate?: boolean;
}

function photoCubicPoint(curve: IncisionPhotoCubic, t: number): Vec3 {
  const inverse = 1 - t;
  const weights = [inverse ** 3, 3 * inverse ** 2 * t, 3 * inverse * t ** 2, t ** 3];
  return [0, 1, 2].map((axis) => curve.reduce(
    (sum, point, index) => sum + point[axis] * weights[index],
    0,
  )) as Vec3;
}

function pointInsidePhotoTriangle(point: Vec3, first: Vec3, second: Vec3, third: Vec3): boolean {
  const cross = (a: Vec3, b: Vec3, c: Vec3) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const area = cross(first, second, third);
  if (Math.abs(area) <= 1e-6) return false;
  const firstWeight = cross(point, second, third) / area;
  const secondWeight = cross(first, point, third) / area;
  const thirdWeight = 1 - firstWeight - secondWeight;
  const tolerance = -1e-5;
  return firstWeight >= tolerance && secondWeight >= tolerance && thirdWeight >= tolerance;
}

function validatePhotoSurfacePoints(
  points: readonly Vec3[],
  landmarks: Vec3[],
  triangles: Triangle[],
  skinVisible?: VisibilityPredicate,
): {
  meshOutsideCount: number;
  headOutsideCount: number;
  skinOutsideCount: number;
  outsideCount: number;
  visibleMask: boolean[];
} {
  const innerMouth = innerMouthTriangles(triangles);
  const visibleSurface = triangles.flatMap((triangle, triangleIndex) => {
    if (innerMouth.has(triangleIndex)) return [];
    const points = triangle.map((index) => landmarks[index]) as [Vec3, Vec3, Vec3];
    const twiceArea = points.every(Boolean)
      ? Math.abs((points[1][0] - points[0][0]) * (points[2][1] - points[0][1])
        - (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]))
      : 0;
    return twiceArea >= 1 ? [points] : [];
  });
  // MediaPipe's face triangles end before parts of the visible upper forehead.
  // Only that known upper-forehead gap may use the conservative head envelope;
  // mesh gaps around the eyes, nostrils and mouth remain rejected. Only points
  // above the forehead floor may use a conservative 3-of-5 source-photo skin
  // vote to extend beyond the fixed head envelope; lower-face gaps never gain
  // that fallback because they may be non-skin openings.
  const headVisible = buildHeadVisibility(landmarks);
  const xs = landmarks.map((point) => point?.[0]).filter(Number.isFinite) as number[];
  const ys = landmarks.map((point) => point?.[1]).filter(Number.isFinite) as number[];
  const faceWidth = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const faceHeight = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const browYs = [9, 8, 107, 336]
    .map((index) => landmarks[index]?.[1])
    .filter(Number.isFinite) as number[];
  const browLine = browYs.length
    ? browYs.reduce((sum, value) => sum + value, 0) / browYs.length
    : (ys.length ? Math.min(...ys) + faceHeight * 0.4 : -Infinity);
  const foreheadFloor = browLine + Math.max(8, faceHeight * 0.018);
  // The controlled-marker stroke itself is intentionally dark and may sit only
  // a few pixels inside the enclosing incision. Probe beyond that thin stroke;
  // a genuine hair/background point still fails the 3-of-5 neighbourhood vote.
  const skinProbeRadius = Math.max(8, Math.min(20, faceWidth * 0.018));
  const neighborhoodSkinVisible = (point: Vec3) => {
    if (!skinVisible) return false;
    const offsets = [[0, 0], [skinProbeRadius, 0], [-skinProbeRadius, 0],
      [0, skinProbeRadius], [0, -skinProbeRadius]] as const;
    return offsets.filter(([dx, dy]) => skinVisible([
      point[0] + dx, point[1] + dy, point[2],
    ])).length >= 3;
  };
  const classifications = points.map((point) => {
    const meshVisible = visibleSurface.some(([first, second, third]) =>
      pointInsidePhotoTriangle(point, first, second, third));
    const headEnvelopeVisible = headVisible(point);
    const photoSkinVisible = neighborhoodSkinVisible(point);
    const acceptedUpperForeheadGap = !meshVisible
      && point[1] <= foreheadFloor
      && (headEnvelopeVisible || photoSkinVisible);
    return {
      point,
      meshVisible,
      headEnvelopeVisible,
      visible: meshVisible || acceptedUpperForeheadGap,
    };
  });
  const meshOutside = classifications.filter((entry) => !entry.meshVisible);
  const headOutsideCount = meshOutside.filter((entry) => !entry.headEnvelopeVisible).length;
  const skinOutsideCount = skinVisible
    ? meshOutside.filter((entry) => !neighborhoodSkinVisible(entry.point)).length
    : meshOutside.length;
  const visibleMask = classifications.map((entry) => entry.visible);
  const outsideCount = visibleMask.filter((visible) => !visible).length;
  return {
    meshOutsideCount: meshOutside.length,
    headOutsideCount,
    skinOutsideCount,
    outsideCount,
    visibleMask,
  };
}

function circularRunCount(mask: readonly boolean[], value: boolean): number {
  if (!mask.length || !mask.some((entry) => entry === value)) return 0;
  if (mask.every((entry) => entry === value)) return 1;
  return mask.reduce((count, entry, index) => {
    const previous = mask[(index - 1 + mask.length) % mask.length];
    return count + (entry === value && previous !== value ? 1 : 0);
  }, 0);
}

function circularVisibleSegments(points: readonly Vec3[], visibleMask: readonly boolean[]): Vec3[][] {
  if (points.length !== visibleMask.length || points.length < 2) return [];
  if (visibleMask.every(Boolean)) return [[...points.map((point) => [...point] as Vec3)]];
  const start = visibleMask.findIndex((visible, index) => visible
    && !visibleMask[(index - 1 + visibleMask.length) % visibleMask.length]);
  if (start < 0) return [];
  const segment: Vec3[] = [];
  for (let offset = 0; offset < points.length; offset += 1) {
    const index = (start + offset) % points.length;
    if (!visibleMask[index]) break;
    segment.push([...points[index]] as Vec3);
  }
  return segment.length >= 2 ? [segment] : [];
}

function canonicalHalfWidthFactor(axisFraction: number, shapeSlope: number): number {
  const u = Math.max(0, Math.min(1, 1 - Math.abs(axisFraction)));
  // Keep the requested tip tangent, then move curvature away from the widest
  // crown. The third-order centre contact prevents the upper/lower crown from
  // looking like a pointed diamond while remaining monotone from tip to centre.
  const crownControl = Math.max(0, 3 - shapeSlope);
  return 1 - (1 - u) ** 3 * (1 + crownControl * u);
}

function canonicalHalfWidthProfile(shapeSlope: number) {
  const knots = [-1, -0.5, 0, 0.5, 1];
  const widths = knots.map((axisFraction) => canonicalHalfWidthFactor(axisFraction, shapeSlope));
  const derivatives = [shapeSlope, 0, 0, 0, -shapeSlope];
  const interiorCount = knots.length - 2;
  const lower = Array(interiorCount).fill(0);
  const diagonal = Array(interiorCount).fill(0);
  const upper = Array(interiorCount).fill(0);
  const rightHandSide = Array(interiorCount).fill(0);
  for (let row = 0; row < interiorCount; row += 1) {
    const index = row + 1;
    const previousSpan = knots[index] - knots[index - 1];
    const nextSpan = knots[index + 1] - knots[index];
    lower[row] = nextSpan;
    diagonal[row] = 2 * (previousSpan + nextSpan);
    upper[row] = previousSpan;
    rightHandSide[row] = 3 * (
      nextSpan * (widths[index] - widths[index - 1]) / previousSpan
      + previousSpan * (widths[index + 1] - widths[index]) / nextSpan
    );
  }
  rightHandSide[0] -= lower[0] * derivatives[0];
  lower[0] = 0;
  rightHandSide[interiorCount - 1] -= upper[interiorCount - 1] * derivatives.at(-1)!;
  upper[interiorCount - 1] = 0;
  for (let row = 1; row < interiorCount; row += 1) {
    const factor = lower[row] / diagonal[row - 1];
    diagonal[row] -= factor * upper[row - 1];
    rightHandSide[row] -= factor * rightHandSide[row - 1];
  }
  for (let row = interiorCount - 1; row >= 0; row -= 1) {
    const nextDerivative = row + 1 < interiorCount ? upper[row] * derivatives[row + 2] : 0;
    derivatives[row + 1] = (rightHandSide[row] - nextDerivative) / diagonal[row];
  }
  const factor = (axisFraction: number) => {
    const clamped = Math.max(-1, Math.min(1, axisFraction));
    const segment = Math.min(knots.length - 2, Math.floor((clamped + 1) / 0.5));
    const span = knots[segment + 1] - knots[segment];
    const t = (clamped - knots[segment]) / span;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * widths[segment]
      + (t3 - 2 * t2 + t) * span * derivatives[segment]
      + (-2 * t3 + 3 * t2) * widths[segment + 1]
      + (t3 - t2) * span * derivatives[segment + 1];
  };
  return { knots, widths, derivatives, factor };
}

export function buildPhotoSurfaceCanonicalFusiform({
  sourceCandidate,
  sourceEndpoints,
  center,
  boundary,
  aspectRatio,
  tipAngleDeg,
  landmarks,
  triangles,
  skinVisible,
  axisHint,
  referenceAspectRatio,
  minimumLengthScale = 0,
}: {
  sourceCandidate: Vec3[];
  sourceEndpoints: Vec3[];
  center: Vec3 | null;
  boundary: Vec3[];
  aspectRatio: number | null | undefined;
  tipAngleDeg: number | null | undefined;
  landmarks: Vec3[];
  triangles: Triangle[];
  skinVisible?: VisibilityPredicate;
  axisHint?: readonly [number, number] | null;
  referenceAspectRatio?: number | null;
  minimumLengthScale?: number;
}): PhotoSurfaceCanonicalFusiformAttempt {
  const diagnostics: FusiformFitDiagnostics = {
    ok: false,
    reason: "invalid_sampling",
    inputPointCount: sourceCandidate.length,
    candidateLength: 0,
    maxWidth: 0,
    centerShift: 0,
    centerShiftLimit: 0,
    corridor: 0,
    maxCorridorError: 0,
    envelopeOverflow: 0,
    segmentCount: 4,
    maxTangentDiscontinuityDeg: 0,
    maxEndpointTangentErrorDeg: 0,
    strategy: "photo_space_canonical_surface_contained",
    photoCanonicalReason: "invalid_sampling",
    photoCanonicalScale: 1,
    photoBoundaryOutsideCount: boundary.length,
    photoSurfaceOutsideCount: 0,
    photoSurfaceMeshOutsideCount: 0,
    photoHeadOutsideCount: 0,
    photoSkinOutsideCount: 0,
    photoCanonicalAxisSource: axisHint ? "nearest_projected_rstl" : "source_endpoints",
    photoCanonicalReference: referenceAspectRatio != null,
  };
  const fail = (reason: FusiformFitFailureReason) => ({
    fit: null,
    visibilityLimitedFit: null,
    endpoints: sourceEndpoints,
    diagnostics: { ...diagnostics, reason, photoCanonicalReason: reason },
  });
  if (!center || sourceCandidate.length < 8 || sourceEndpoints.length < 2
    || !(Number(aspectRatio) > 1) || !(triangles.length && landmarks.length)) {
    return fail("invalid_sampling");
  }
  const endpointAxis = [
    sourceEndpoints[1][0] - sourceEndpoints[0][0],
    sourceEndpoints[1][1] - sourceEndpoints[0][1],
  ];
  const endpointLength = Math.hypot(...endpointAxis);
  if (!(endpointLength > 1e-6)) return fail("invalid_sampling");
  const hintedLength = axisHint ? Math.hypot(axisHint[0], axisHint[1]) : 0;
  let axis = hintedLength > 1e-6
    ? [axisHint![0] / hintedLength, axisHint![1] / hintedLength] as [number, number]
    : [endpointAxis[0] / endpointLength, endpointAxis[1] / endpointLength] as [number, number];
  if (axis[0] * endpointAxis[0] + axis[1] * endpointAxis[1] < 0) axis = [-axis[0], -axis[1]];
  const perpendicular = [-axis[1], axis[0]] as const;
  const project = (point: Vec3) => {
    const delta = [point[0] - center[0], point[1] - center[1]];
    return [delta[0] * axis[0] + delta[1] * axis[1],
      delta[0] * perpendicular[0] + delta[1] * perpendicular[1]] as const;
  };
  const endpointCoordinates = sourceEndpoints.map(project);
  const sourceHalfLength = Math.max(1, ...endpointCoordinates.map(([value]) => Math.abs(value)));
  const standardRatio = Math.max(1.8, Math.min(6, Number(aspectRatio)));
  const requestedReferenceRatio = referenceAspectRatio == null
    ? standardRatio
    : Math.max(2.2, Math.min(standardRatio, Number(referenceAspectRatio)));
  const referenceScale = referenceAspectRatio == null
    ? 1
    : Math.max(requestedReferenceRatio / standardRatio, Math.max(0, Math.min(1, minimumLengthScale)));
  const baseHalfLength = sourceHalfLength * referenceScale;
  const baseHalfWidth = sourceHalfLength / standardRatio;
  const ratio = baseHalfLength / baseHalfWidth;
  diagnostics.photoCanonicalAspectRatio = ratio;
  diagnostics.photoCanonicalStandardAspectRatio = standardRatio;
  diagnostics.photoCanonicalLengthScale = referenceScale;
  const targetTipAngle = Math.max(8, Math.min(75, Number(tipAngleDeg || 30)));
  const shapeSlope = Math.min(ratio * Math.tan(targetTipAngle * Math.PI / 360), 2.95);
  const halfWidthProfile = canonicalHalfWidthProfile(shapeSlope);
  const projectedBoundary = boundary.map(project);
  const boundaryPaddingPx = 1.5;
  const outsideBoundary = (scale: number) => projectedBoundary.filter(([axisDistance, perpendicularDistance]) => {
    const halfLength = baseHalfLength * scale;
    const halfWidth = baseHalfWidth * scale;
    const factor = halfWidthProfile.factor(axisDistance / halfLength);
    return Math.abs(axisDistance) + boundaryPaddingPx > halfLength
      || Math.abs(perpendicularDistance) + boundaryPaddingPx > factor * halfWidth + 1e-6;
  }).length;
  let scale = 1;
  let boundaryOutsideCount = outsideBoundary(scale);
  while (boundaryOutsideCount > 0 && scale < 1.75 - 1e-9) {
    scale = Math.min(1.75, scale * 1.035);
    boundaryOutsideCount = outsideBoundary(scale);
  }
  diagnostics.photoCanonicalScale = scale;
  diagnostics.photoBoundaryOutsideCount = boundaryOutsideCount;
  if (boundaryOutsideCount > 0) return fail("photo_boundary_not_enclosed");

  const halfLength = baseHalfLength * scale;
  const halfWidth = baseHalfWidth * scale;
  const localPoint = (axisDistance: number, perpendicularDistance: number): Vec3 => [
    center[0] + axis[0] * axisDistance + perpendicular[0] * perpendicularDistance,
    center[1] + axis[1] * axisDistance + perpendicular[1] * perpendicularDistance,
    center[2],
  ];
  const start = localPoint(-halfLength, 0);
  const end = localPoint(halfLength, 0);
  const curveSide = (side: 1 | -1): IncisionPhotoCubic[] => {
    const { knots, widths, derivatives } = halfWidthProfile;
    return knots.slice(0, -1).map((axisFraction, index) => {
      const nextAxisFraction = knots[index + 1];
      const span = nextAxisFraction - axisFraction;
      const width = widths[index];
      const nextWidth = widths[index + 1];
      const derivative = derivatives[index];
      const nextDerivative = derivatives[index + 1];
      return [
        localPoint(axisFraction * halfLength, side * width * halfWidth),
        localPoint(
          (axisFraction + span / 3) * halfLength,
          side * (width + derivative * span / 3) * halfWidth,
        ),
        localPoint(
          (nextAxisFraction - span / 3) * halfLength,
          side * (nextWidth - nextDerivative * span / 3) * halfWidth,
        ),
        localPoint(nextAxisFraction * halfLength, side * nextWidth * halfWidth),
      ];
    });
  };
  const upperCurves = curveSide(1);
  const lowerCurves = curveSide(-1);
  const sampleChain = (curves: IncisionPhotoCubic[]) => curves.flatMap((curve, curveIndex) =>
    Array.from({ length: 9 }, (_, index) => photoCubicPoint(curve, index / 8))
      .slice(curveIndex === 0 ? 0 : 1));
  const upper = sampleChain(upperCurves);
  const lower = sampleChain(lowerCurves);
  const outline = upper.concat(lower.slice(1, -1).reverse(), [[...upper[0]] as Vec3]);
  const projection = inspectPhotoCandidateProjection(outline, "fusiform");
  if (!projection.valid) return fail("invalid_sampling");
  const segmentLengths = outline.slice(0, -1).map((point, index) => {
    const next = outline[index + 1];
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  }).filter((value) => value > 1e-6).sort((a, b) => a - b);
  const fullFit: SurfaceProjectedFusiformFit = {
    outline,
    sourceOutline: sourceCandidate,
    upperCurve: upperCurves[0],
    lowerCurve: lowerCurves[0],
    upperCurves,
    lowerCurves,
    strategy: "segmented_c1",
    blend: 1,
    medianSegment: segmentLengths[Math.floor(segmentLengths.length / 2)] || 0,
  };
  const surfaceValidation = validatePhotoSurfacePoints(
    outline.slice(0, -1), landmarks, triangles, skinVisible,
  );
  const boundarySurfaceValidation = validatePhotoSurfacePoints(
    boundary, landmarks, triangles, skinVisible,
  );
  diagnostics.photoSurfaceMeshOutsideCount = surfaceValidation.meshOutsideCount;
  diagnostics.photoHeadOutsideCount = surfaceValidation.headOutsideCount;
  diagnostics.photoSkinOutsideCount = surfaceValidation.skinOutsideCount;
  diagnostics.photoSurfaceOutsideCount = surfaceValidation.outsideCount;
  diagnostics.candidateLength = halfLength * 2;
  diagnostics.maxWidth = halfWidth * 2;
  const visibleCount = surfaceValidation.visibleMask.filter(Boolean).length;
  const visibleFraction = visibleCount / Math.max(1, surfaceValidation.visibleMask.length);
  const visibleSegmentCount = circularRunCount(surfaceValidation.visibleMask, true);
  const hiddenSegmentCount = circularRunCount(surfaceValidation.visibleMask, false);
  const visibleSegments = circularVisibleSegments(outline.slice(0, -1), surfaceValidation.visibleMask);
  const visibilityLimitedEligible = referenceAspectRatio == null
    && ratio >= 2.2 - 1e-6
    && surfaceValidation.outsideCount > 0
    && surfaceValidation.headOutsideCount === surfaceValidation.outsideCount
    && boundarySurfaceValidation.outsideCount === 0
    && hiddenSegmentCount === 1
    && visibleSegmentCount === 1
    && visibleFraction >= 0.55
    && visibleSegments.length === 1
    && visibleSegments[0].length >= 8;
  diagnostics.photoVisibleFraction = visibleFraction;
  diagnostics.photoVisibleSegmentCount = visibleSegmentCount;
  diagnostics.photoVisibilityLimitedEligible = visibilityLimitedEligible;
  if (surfaceValidation.outsideCount > 0) {
    return {
      fit: null,
      visibilityLimitedFit: visibilityLimitedEligible
        ? { ...fullFit, visibleSegments }
        : null,
      endpoints: [start, end],
      diagnostics: {
        ...diagnostics,
        reason: "photo_surface_exit",
        photoCanonicalReason: "photo_surface_exit",
      },
    };
  }
  diagnostics.ok = true;
  diagnostics.reason = null;
  diagnostics.photoCanonicalReason = null;
  return {
    endpoints: [start, end],
    diagnostics,
    fit: fullFit,
    visibilityLimitedFit: null,
  };
}

export function attemptConstrainedPhotoReferences({
  input,
  standardAttempt,
  standardAspectRatio,
  minimumLengthScale,
}: {
  input: Parameters<typeof buildPhotoSurfaceCanonicalFusiform>[0];
  standardAttempt: ReturnType<typeof buildPhotoSurfaceCanonicalFusiform> | null;
  standardAspectRatio: number;
  minimumLengthScale?: number;
}): {
  fitAttempt: ReturnType<typeof buildPhotoSurfaceCanonicalFusiform> | null;
  attempts: PhotoReferenceAttemptDiagnostics[];
} {
  let fitAttempt: ReturnType<typeof buildPhotoSurfaceCanonicalFusiform> | null = null;
  const attempts: PhotoReferenceAttemptDiagnostics[] = [];
  if (!standardAttempt || standardAttempt.fit || standardAttempt.visibilityLimitedFit
    || standardAttempt.diagnostics.reason !== "photo_surface_exit"
    || !(standardAspectRatio > 2.2)) {
    return { fitAttempt, attempts };
  }
  const ratios = [2.8, 2.6, 2.4, 2.2]
    .filter((ratio) => ratio < standardAspectRatio - 1e-6);
  for (const referenceAspectRatio of ratios) {
    const attempt = buildPhotoSurfaceCanonicalFusiform({
      ...input,
      referenceAspectRatio,
      minimumLengthScale,
    });
    attempts.push({
      aspectRatio: referenceAspectRatio,
      ok: Boolean(attempt.fit),
      reason: attempt.diagnostics.reason,
      boundaryOutsideCount: Number(attempt.diagnostics.photoBoundaryOutsideCount || 0),
      surfaceOutsideCount: Number(attempt.diagnostics.photoSurfaceOutsideCount || 0),
      meshOutsideCount: Number(attempt.diagnostics.photoSurfaceMeshOutsideCount || 0),
      headOutsideCount: Number(attempt.diagnostics.photoHeadOutsideCount || 0),
      skinOutsideCount: Number(attempt.diagnostics.photoSkinOutsideCount || 0),
    });
    if (attempt.fit) {
      fitAttempt = attempt;
      break;
    }
  }
  return { fitAttempt, attempts };
}

export function diagnoseSurfaceProjectedFusiformFit(
  points: readonly Vec3[],
  center: Vec3 | null = null,
  _passes = 5,
  _strength = 0.7,
): SurfaceProjectedFusiformFitAttempt {
  const diagnostics: FusiformFitDiagnostics = {
    ok: false,
    reason: null,
    inputPointCount: points.length,
    candidateLength: 0,
    maxWidth: 0,
    centerShift: 0,
    centerShiftLimit: 0,
    corridor: 0,
    maxCorridorError: 0,
    envelopeOverflow: 0,
    segmentCount: 0,
    maxTangentDiscontinuityDeg: 0,
    maxEndpointTangentErrorDeg: 0,
    strategy: "centerline_halfwidth_global_cubic",
  };
  const fail = (reason: FusiformFitFailureReason): SurfaceProjectedFusiformFitAttempt => ({
    fit: null,
    diagnostics: { ...diagnostics, reason },
  });
  if (points.length < 9) return fail("insufficient_points");
  const polygon = points.map((point) => [...point] as Vec3);
  if (Math.hypot(
    polygon[0][0] - polygon.at(-1)![0],
    polygon[0][1] - polygon.at(-1)![1],
  ) < 1e-6) polygon.pop();
  if (polygon.length < 8 || polygon.length % 2 !== 0) return fail("invalid_topology");

  const farTipIndex = polygon.length / 2;
  const upper = polygon.slice(0, farTipIndex + 1);
  const lower = [polygon[0], ...polygon.slice(farTipIndex + 1).reverse(), polygon[farTipIndex]];
  if (upper.length !== lower.length) return fail("invalid_topology");

  const segmentLengths = [upper, lower].flatMap((side) => side.slice(0, -1).map((point, index) => {
    const next = side[index + 1];
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  })).filter((value) => value > 1e-6).sort((a, b) => a - b);
  const medianSegment = segmentLengths[Math.floor(segmentLengths.length / 2)] || 0;
  if (!(medianSegment > 0)) return fail("invalid_sampling");
  diagnostics.candidateLength = Math.hypot(
    upper.at(-1)![0] - upper[0][0],
    upper.at(-1)![1] - upper[0][1],
  );
  diagnostics.maxWidth = upper.reduce((maximum, point, index) => Math.max(
    maximum,
    Math.hypot(point[0] - lower[index][0], point[1] - lower[index][1]),
  ), 0);
  if (!(diagnostics.candidateLength > 0) || !(diagnostics.maxWidth > 0)) {
    return fail("invalid_sampling");
  }
  const bounds = polygon.reduce((result, point) => ({
    minX: Math.min(result.minX, point[0]),
    maxX: Math.max(result.maxX, point[0]),
    minY: Math.min(result.minY, point[1]),
    maxY: Math.max(result.maxY, point[1]),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

  const cubicPoint = (curve: IncisionPhotoCubic, t: number): Vec3 => {
    const inverse = 1 - t;
    const weights = [inverse ** 3, 3 * inverse ** 2 * t, 3 * inverse * t ** 2, t ** 3];
    return [0, 1, 2].map((axis) => curve.reduce(
      (sum, point, index) => sum + point[axis] * weights[index],
      0,
    )) as Vec3;
  };
  const chordParameters = (side: Vec3[]) => {
    const cumulative = [0];
    for (let index = 1; index < side.length; index += 1) {
      cumulative.push(cumulative.at(-1)! + Math.hypot(
        side[index][0] - side[index - 1][0],
        side[index][1] - side[index - 1][1],
      ));
    }
    const total = cumulative.at(-1) || 0;
    return total > 1e-6 ? cumulative.map((value) => value / total) : null;
  };
  const fitCubic = (side: Vec3[]): IncisionPhotoCubic | null => {
    const parameters = chordParameters(side);
    if (!parameters) return null;
    const start = side[0], end = side.at(-1)!;
    let a11 = 0, a12 = 0, a22 = 0;
    const b1 = [0, 0], b2 = [0, 0];
    side.forEach((point, index) => {
      const t = parameters[index], inverse = 1 - t;
      const w0 = inverse ** 3, w1 = 3 * inverse ** 2 * t;
      const w2 = 3 * inverse * t ** 2, w3 = t ** 3;
      a11 += w1 * w1;
      a12 += w1 * w2;
      a22 += w2 * w2;
      for (let axis = 0; axis < 2; axis += 1) {
        const residual = point[axis] - start[axis] * w0 - end[axis] * w3;
        b1[axis] += w1 * residual;
        b2[axis] += w2 * residual;
      }
    });
    const determinant = a11 * a22 - a12 * a12;
    const firstControl: Vec3 = [0, 0, start[2] * 2 / 3 + end[2] / 3];
    const secondControl: Vec3 = [0, 0, start[2] / 3 + end[2] * 2 / 3];
    for (let axis = 0; axis < 2; axis += 1) {
      if (Math.abs(determinant) <= 1e-9) {
        firstControl[axis] = start[axis] * 2 / 3 + end[axis] / 3;
        secondControl[axis] = start[axis] / 3 + end[axis] * 2 / 3;
      } else {
        firstControl[axis] = (b1[axis] * a22 - b2[axis] * a12) / determinant;
        secondControl[axis] = (a11 * b2[axis] - a12 * b1[axis]) / determinant;
      }
    }
    return [[...start] as Vec3, firstControl, secondControl, [...end] as Vec3];
  };
  const sourceDistance = (point: Vec3, side: Vec3[]) => {
    let minimum = Infinity;
    for (let index = 0; index < side.length - 1; index += 1) {
      const start = side[index], end = side[index + 1];
      const dx = end[0] - start[0], dy = end[1] - start[1];
      const denominator = dx * dx + dy * dy;
      const t = denominator <= 1e-9 ? 0 : Math.max(0, Math.min(1,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator,
      ));
      minimum = Math.min(minimum, Math.hypot(
        point[0] - (start[0] + dx * t),
        point[1] - (start[1] + dy * t),
      ));
    }
    return minimum;
  };

  const resamplePairedSides = (firstSide: Vec3[], secondSide: Vec3[], count: number) => {
    const cumulative = [0];
    for (let index = 1; index < firstSide.length; index += 1) {
      const previousCenter = [
        (firstSide[index - 1][0] + secondSide[index - 1][0]) * 0.5,
        (firstSide[index - 1][1] + secondSide[index - 1][1]) * 0.5,
      ];
      const center = [
        (firstSide[index][0] + secondSide[index][0]) * 0.5,
        (firstSide[index][1] + secondSide[index][1]) * 0.5,
      ];
      cumulative.push(cumulative.at(-1)! + Math.hypot(
        center[0] - previousCenter[0],
        center[1] - previousCenter[1],
      ));
    }
    const total = cumulative.at(-1) || 0;
    if (!(total > 1e-6)) return null;
    const outputFirst: Vec3[] = [];
    const outputSecond: Vec3[] = [];
    Array.from({ length: count }, (_, outputIndex) => {
      const target = total * outputIndex / (count - 1);
      let segment = 0;
      while (segment < cumulative.length - 2 && cumulative[segment + 1] < target) segment += 1;
      const span = cumulative[segment + 1] - cumulative[segment];
      const ratio = span > 1e-9 ? (target - cumulative[segment]) / span : 0;
      outputFirst.push([0, 1, 2].map((axis) => firstSide[segment][axis]
        + (firstSide[segment + 1][axis] - firstSide[segment][axis]) * ratio) as Vec3);
      outputSecond.push([0, 1, 2].map((axis) => secondSide[segment][axis]
        + (secondSide[segment + 1][axis] - secondSide[segment][axis]) * ratio) as Vec3);
    });
    return { first: outputFirst, second: outputSecond };
  };

  const profileSampleCount = 33;
  const pairedSamples = resamplePairedSides(upper, lower, profileSampleCount);
  if (!pairedSamples) return fail("invalid_sampling");
  const sampledSourceUpper = pairedSamples.first;
  const sampledSourceLower = pairedSamples.second;

  let centerline = sampledSourceUpper.map((point, index) => [
    (point[0] + sampledSourceLower[index][0]) * 0.5,
    (point[1] + sampledSourceLower[index][1]) * 0.5,
    (point[2] + sampledSourceLower[index][2]) * 0.5,
  ] as Vec3);
  const smoothStrength = Math.max(0, Math.min(0.8, _strength));
  for (let pass = 0; pass < Math.max(1, Math.min(8, _passes)); pass += 1) {
    centerline = centerline.map((point, index) => {
      if (index === 0 || index === centerline.length - 1) return [...point] as Vec3;
      const previous = centerline[index - 1];
      const next = centerline[index + 1];
      return [0, 1, 2].map((axis) => {
        const lowFrequency = (previous[axis] + point[axis] * 2 + next[axis]) * 0.25;
        return point[axis] + (lowFrequency - point[axis]) * smoothStrength;
      }) as Vec3;
    });
  }

  const middleIndex = Math.floor(profileSampleCount / 2);
  const centerShift = center && Number.isFinite(center[0]) && Number.isFinite(center[1])
    ? [center[0] - centerline[middleIndex][0], center[1] - centerline[middleIndex][1]] as const
    : [0, 0] as const;
  diagnostics.centerShift = Math.hypot(...centerShift);
  diagnostics.centerShiftLimit = Math.max(
    2,
    diagnostics.maxWidth * 0.75,
    diagnostics.candidateLength * 0.08,
  );
  if (diagnostics.centerShift > diagnostics.centerShiftLimit) {
    return fail("center_shift_exceeded");
  }
  centerline = centerline.map((point, index) => {
    const t = index / (profileSampleCount - 1);
    const weight = Math.sin(Math.PI * t) ** 2;
    return [
      point[0] + centerShift[0] * weight,
      point[1] + centerShift[1] * weight,
      point[2],
    ];
  });

  const observedHalfWidths = sampledSourceUpper.map((point, index) => Math.hypot(
    point[0] - sampledSourceLower[index][0],
    point[1] - sampledSourceLower[index][1],
  ) * 0.5);
  const centralHalfWidths = observedHalfWidths.slice(3, -3).sort((a, b) => a - b);
  const robustMaxHalfWidth = centralHalfWidths[
    Math.min(centralHalfWidths.length - 1, Math.floor(centralHalfWidths.length * 0.9))
  ] || diagnostics.maxWidth * 0.5;
  const standardizeSide = (upperSide: boolean): Vec3[] => centerline.map((point, index) => {
    const previous = centerline[Math.max(0, index - 1)];
    const next = centerline[Math.min(centerline.length - 1, index + 1)];
    const tangentX = next[0] - previous[0];
    const tangentY = next[1] - previous[1];
    const tangentLength = Math.max(1e-9, Math.hypot(tangentX, tangentY));
    let normalX = -tangentY / tangentLength;
    let normalY = tangentX / tangentLength;
    const rawHalfX = (sampledSourceUpper[index][0] - sampledSourceLower[index][0]) * 0.5;
    const rawHalfY = (sampledSourceUpper[index][1] - sampledSourceLower[index][1]) * 0.5;
    if (normalX * rawHalfX + normalY * rawHalfY < 0) {
      normalX *= -1;
      normalY *= -1;
    }
    const t = index / (profileSampleCount - 1);
    const taper = Math.sin(Math.PI * t) ** 0.82;
    const idealHalfWidth = robustMaxHalfWidth * taper;
    const halfWidth = index === 0 || index === profileSampleCount - 1
      ? 0
      : observedHalfWidths[index] * 0.3 + idealHalfWidth * 0.7;
    const side = upperSide ? 1 : -1;
    return [
      point[0] + normalX * halfWidth * side,
      point[1] + normalY * halfWidth * side,
      upperSide ? sampledSourceUpper[index][2] : sampledSourceLower[index][2],
    ];
  });
  const standardizedUpper = standardizeSide(true);
  const standardizedLower = standardizeSide(false);
  standardizedUpper[0] = [...upper[0]] as Vec3;
  standardizedUpper[profileSampleCount - 1] = [...upper.at(-1)!] as Vec3;
  standardizedLower[0] = [...lower[0]] as Vec3;
  standardizedLower[profileSampleCount - 1] = [...lower.at(-1)!] as Vec3;

  const fittedUpper = fitCubic(standardizedUpper), fittedLower = fitCubic(standardizedLower);
  if (!fittedUpper || !fittedLower) return fail("invalid_sampling");
  const upperMiddle = cubicPoint(fittedUpper, 0.5);
  const lowerMiddle = cubicPoint(fittedLower, 0.5);
  const fittedCenter: Vec3 = [
    (upperMiddle[0] + lowerMiddle[0]) * 0.5,
    (upperMiddle[1] + lowerMiddle[1]) * 0.5,
    (upperMiddle[2] + lowerMiddle[2]) * 0.5,
  ];
  const fittedCenterShift = center && Number.isFinite(center[0]) && Number.isFinite(center[1])
    ? [center[0] - fittedCenter[0], center[1] - fittedCenter[1]] as const
    : [0, 0] as const;
  if (Math.hypot(...fittedCenterShift) > diagnostics.centerShiftLimit) {
    return fail("center_shift_exceeded");
  }
  // A cubic's two internal controls contribute 0.75 of their shared shift at
  // t=0.5. Moving both controls by this amount aligns the fitted fusiform with
  // the selected lesion center while leaving both projected tips unchanged.
  const controlShift = [fittedCenterShift[0] / 0.75, fittedCenterShift[1] / 0.75] as const;
  const linearControls = (curve: IncisionPhotoCubic): IncisionPhotoCubic => {
    const [start, , , end] = curve;
    return [start, [
      start[0] * 2 / 3 + end[0] / 3,
      start[1] * 2 / 3 + end[1] / 3,
      start[2] * 2 / 3 + end[2] / 3,
    ], [
      start[0] / 3 + end[0] * 2 / 3,
      start[1] / 3 + end[1] * 2 / 3,
      start[2] / 3 + end[2] * 2 / 3,
    ], end];
  };
  const shiftedCurve = (fitted: IncisionPhotoCubic, blend: number): IncisionPhotoCubic => {
    const linear = linearControls(fitted);
    return [fitted[0], [
      linear[1][0] + (fitted[1][0] - linear[1][0]) * blend + controlShift[0],
      linear[1][1] + (fitted[1][1] - linear[1][1]) * blend + controlShift[1],
      fitted[1][2],
    ], [
      linear[2][0] + (fitted[2][0] - linear[2][0]) * blend + controlShift[0],
      linear[2][1] + (fitted[2][1] - linear[2][1]) * blend + controlShift[1],
      fitted[2][2],
    ], fitted[3]];
  };
  const sampleCount = 32;
  const angleBetweenDeg = (first: readonly number[], second: readonly number[]) => {
    const firstLength = Math.hypot(first[0], first[1]);
    const secondLength = Math.hypot(second[0], second[1]);
    if (firstLength <= 1e-9 || secondLength <= 1e-9) return 180;
    const cosine = Math.max(-1, Math.min(1,
      (first[0] * second[0] + first[1] * second[1]) / (firstLength * secondLength),
    ));
    return Math.acos(cosine) * 180 / Math.PI;
  };
  const endpointReferenceTangents = (side: Vec3[]) => {
    const window = Math.min(4, side.length - 1);
    return {
      start: [
        side[window][0] - side[0][0],
        side[window][1] - side[0][1],
      ] as const,
      end: [
        side.at(-1)![0] - side[side.length - 1 - window][0],
        side.at(-1)![1] - side[side.length - 1 - window][1],
      ] as const,
    };
  };
  const endpointTangentError = (curves: IncisionPhotoCubic[], sourceSide: Vec3[]) => {
    const reference = endpointReferenceTangents(sourceSide);
    const first = curves[0];
    const last = curves.at(-1)!;
    return Math.max(
      angleBetweenDeg(
        [first[1][0] - first[0][0], first[1][1] - first[0][1]],
        reference.start,
      ),
      angleBetweenDeg(
        [last[3][0] - last[2][0], last[3][1] - last[2][1]],
        reference.end,
      ),
    );
  };
  const sampleCurveChain = (curves: IncisionPhotoCubic[], samplesPerCurve: number) => {
    const sampled: Vec3[] = [];
    curves.forEach((curve, curveIndex) => {
      const firstSample = curveIndex === 0 ? 0 : 1;
      for (let sampleIndex = firstSample; sampleIndex <= samplesPerCurve; sampleIndex += 1) {
        sampled.push(cubicPoint(curve, sampleIndex / samplesPerCurve));
      }
    });
    return sampled;
  };
  const maxChainTangentDiscontinuity = (curves: IncisionPhotoCubic[]) => curves.slice(0, -1)
    .reduce((maximum, curve, index) => Math.max(maximum, angleBetweenDeg(
      [curve[3][0] - curve[2][0], curve[3][1] - curve[2][1]],
      [curves[index + 1][1][0] - curves[index + 1][0][0],
        curves[index + 1][1][1] - curves[index + 1][0][1]],
    )), 0);
  const buildSegmentedChain = (
    side: Vec3[],
    sourceSide: Vec3[],
    tangentScale: number,
  ): IncisionPhotoCubic[] => {
    const knotIndices = [0, 8, 16, 24, profileSampleCount - 1];
    const knots = knotIndices.map((index) => [...side[index]] as Vec3);
    const reference = endpointReferenceTangents(sourceSide);
    const derivatives = knots.map((point, index): Vec3 => {
      const previous = knots[Math.max(0, index - 1)];
      const next = knots[Math.min(knots.length - 1, index + 1)];
      const previousChord = index > 0
        ? Math.hypot(point[0] - previous[0], point[1] - previous[1])
        : Math.hypot(next[0] - point[0], next[1] - point[1]);
      const nextChord = index < knots.length - 1
        ? Math.hypot(next[0] - point[0], next[1] - point[1])
        : previousChord;
      const targetMagnitude = Math.max(1e-6, Math.min(previousChord, nextChord) * tangentScale);
      const direction = index === 0
        ? reference.start
        : index === knots.length - 1
          ? reference.end
          : [next[0] - previous[0], next[1] - previous[1]] as const;
      const directionLength = Math.max(1e-9, Math.hypot(direction[0], direction[1]));
      const zDerivative = index === 0
        ? next[2] - point[2]
        : index === knots.length - 1
          ? point[2] - previous[2]
          : (next[2] - previous[2]) * 0.5;
      return [
        direction[0] / directionLength * targetMagnitude,
        direction[1] / directionLength * targetMagnitude,
        zDerivative * tangentScale,
      ];
    });
    return knots.slice(0, -1).map((start, index) => {
      const end = knots[index + 1];
      const startDerivative = derivatives[index];
      const endDerivative = derivatives[index + 1];
      return [
        [...start] as Vec3,
        [
          start[0] + startDerivative[0] / 3,
          start[1] + startDerivative[1] / 3,
          start[2] + startDerivative[2] / 3,
        ],
        [
          end[0] - endDerivative[0] / 3,
          end[1] - endDerivative[1] / 3,
          end[2] - endDerivative[2] / 3,
        ],
        [...end] as Vec3,
      ];
    });
  };
  // A tolerance based on adjacent sample spacing changes when the same curve
  // is sampled more densely. Bind the safety corridor to the physical shape
  // instead: its width and tip-to-tip length.
  const corridor = Math.max(
    2,
    diagnostics.maxWidth * 0.22,
    diagnostics.candidateLength * 0.025,
  );
  const envelopeMargin = Math.max(1, diagnostics.maxWidth * 0.05);
  diagnostics.corridor = corridor;
  let sawCorridorFailure = false;
  let sawEnvelopeFailure = false;
  const validateCurves = (upperCurves: IncisionPhotoCubic[], lowerCurves: IncisionPhotoCubic[]) => {
    const samplesPerCurve = Math.max(8, Math.floor(sampleCount / upperCurves.length));
    const sampledUpper = sampleCurveChain(upperCurves, samplesPerCurve);
    const sampledLower = sampleCurveChain(lowerCurves, samplesPerCurve);
    const maxCorridorError = Math.max(
      ...sampledUpper.map((point) => sourceDistance(point, upper)),
      ...sampledLower.map((point) => sourceDistance(point, lower)),
    );
    const envelopeOverflow = sampledUpper.concat(sampledLower).reduce((maximum, point) => Math.max(
      maximum,
      bounds.minX - point[0],
      point[0] - bounds.maxX,
      bounds.minY - point[1],
      point[1] - bounds.maxY,
      0,
    ), 0);
    return {
      sampledUpper,
      sampledLower,
      maxCorridorError,
      envelopeOverflow,
      valid: maxCorridorError <= corridor && envelopeOverflow <= envelopeMargin,
    };
  };
  const acceptedFit = (
    upperCurves: IncisionPhotoCubic[],
    lowerCurves: IncisionPhotoCubic[],
    validation: ReturnType<typeof validateCurves>,
    strategy: SurfaceProjectedFusiformFit["strategy"],
    blend: number,
  ): SurfaceProjectedFusiformFitAttempt => {
    const sampledUpper = validation.sampledUpper;
    const sampledLower = validation.sampledLower;
    sampledUpper[0] = [...upper[0]] as Vec3;
    sampledUpper[sampledUpper.length - 1] = [...upper.at(-1)!] as Vec3;
    sampledLower[0] = [...lower[0]] as Vec3;
    sampledLower[sampledLower.length - 1] = [...lower.at(-1)!] as Vec3;
    diagnostics.maxCorridorError = validation.maxCorridorError;
    diagnostics.envelopeOverflow = validation.envelopeOverflow;
    diagnostics.segmentCount = upperCurves.length;
    diagnostics.maxTangentDiscontinuityDeg = Math.max(
      maxChainTangentDiscontinuity(upperCurves),
      maxChainTangentDiscontinuity(lowerCurves),
    );
    diagnostics.maxEndpointTangentErrorDeg = Math.max(
      endpointTangentError(upperCurves, sampledSourceUpper),
      endpointTangentError(lowerCurves, sampledSourceLower),
    );
    diagnostics.strategy = strategy === "segmented_c1"
      ? "centerline_halfwidth_segmented_c1"
      : "centerline_halfwidth_global_cubic";
    return {
      fit: {
        outline: sampledUpper.concat(sampledLower.slice(1, -1).reverse(), [sampledUpper[0]]),
        sourceOutline: polygon.concat([[...polygon[0]] as Vec3]),
        upperCurve: strategy === "global_cubic" ? upperCurves[0] : shiftedCurve(fittedUpper, 1),
        lowerCurve: strategy === "global_cubic" ? lowerCurves[0] : shiftedCurve(fittedLower, 1),
        upperCurves,
        lowerCurves,
        strategy,
        blend,
        medianSegment,
      },
      diagnostics: { ...diagnostics, ok: true, reason: null },
    };
  };

  // A single cubic remains the lowest-complexity path for a short, gently
  // curved candidate. It is accepted only when it also preserves the source
  // surface projection's tip directions; otherwise the segmented path below
  // handles the extra low-frequency curvature without following mesh noise.
  for (const blend of [1, 0.85, 0.7, 0.55]) {
    const upperCurve = shiftedCurve(fittedUpper, blend);
    const lowerCurve = shiftedCurve(fittedLower, blend);
    const validation = validateCurves([upperCurve], [lowerCurve]);
    const endpointError = Math.max(
      endpointTangentError([upperCurve], sampledSourceUpper),
      endpointTangentError([lowerCurve], sampledSourceLower),
    );
    sawCorridorFailure ||= validation.maxCorridorError > corridor;
    sawEnvelopeFailure ||= validation.envelopeOverflow > envelopeMargin;
    if (!validation.valid || endpointError > 8) {
      diagnostics.maxCorridorError = Math.max(
        diagnostics.maxCorridorError,
        validation.maxCorridorError,
      );
      diagnostics.envelopeOverflow = Math.max(
        diagnostics.envelopeOverflow,
        validation.envelopeOverflow,
      );
      diagnostics.maxEndpointTangentErrorDeg = Math.max(
        diagnostics.maxEndpointTangentErrorDeg,
        endpointError,
      );
      continue;
    }
    return acceptedFit([upperCurve], [lowerCurve], validation, "global_cubic", blend);
  }

  const blendTowardSource = (standardized: Vec3[], source: Vec3[], blend: number) => {
    return standardized.map((point, index) => [0, 1, 2].map((axis) =>
      source[index][axis] + (point[axis] - source[index][axis]) * blend) as Vec3);
  };
  for (const shapeBlend of [1, 0.85, 0.7, 0.55]) {
    let segmentedUpper = blendTowardSource(standardizedUpper, sampledSourceUpper, shapeBlend);
    let segmentedLower = blendTowardSource(standardizedLower, sampledSourceLower, shapeBlend);
    if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      const midpoint = [
        (segmentedUpper[middleIndex][0] + segmentedLower[middleIndex][0]) * 0.5,
        (segmentedUpper[middleIndex][1] + segmentedLower[middleIndex][1]) * 0.5,
      ] as const;
      const correction = [center[0] - midpoint[0], center[1] - midpoint[1]] as const;
      const recenter = (side: Vec3[]) => side.map((point, index) => {
        const t = index / (profileSampleCount - 1);
        const weight = Math.sin(Math.PI * t) ** 2;
        return [point[0] + correction[0] * weight, point[1] + correction[1] * weight, point[2]] as Vec3;
      });
      segmentedUpper = recenter(segmentedUpper);
      segmentedLower = recenter(segmentedLower);
    }
    for (const tangentScale of [0.9, 0.72, 0.55]) {
      const upperCurves = buildSegmentedChain(segmentedUpper, sampledSourceUpper, tangentScale);
      const lowerCurves = buildSegmentedChain(segmentedLower, sampledSourceLower, tangentScale);
      const validation = validateCurves(upperCurves, lowerCurves);
      sawCorridorFailure ||= validation.maxCorridorError > corridor;
      sawEnvelopeFailure ||= validation.envelopeOverflow > envelopeMargin;
      if (!validation.valid) {
        diagnostics.maxCorridorError = Math.max(
          diagnostics.maxCorridorError,
          validation.maxCorridorError,
        );
        diagnostics.envelopeOverflow = Math.max(
          diagnostics.envelopeOverflow,
          validation.envelopeOverflow,
        );
        continue;
      }
      return acceptedFit(
        upperCurves,
        lowerCurves,
        validation,
        "segmented_c1",
        shapeBlend * tangentScale,
      );
    }
  }
  return fail(sawCorridorFailure ? "corridor_exceeded" : sawEnvelopeFailure
    ? "envelope_exceeded"
    : "invalid_sampling");
}

export function fitSurfaceProjectedFusiform(
  points: readonly Vec3[],
  center: Vec3 | null = null,
  passes = 5,
  strength = 0.7,
): SurfaceProjectedFusiformFit | null {
  return diagnoseSurfaceProjectedFusiformFit(points, center, passes, strength).fit;
}

export function smoothSurfaceProjectedFusiform(
  points: readonly Vec3[],
  center: Vec3 | null = null,
  passes = 5,
  strength = 0.7,
): Vec3[] | null {
  return fitSurfaceProjectedFusiform(points, center, passes, strength)?.outline || null;
}

export function inspectPhotoCandidateProjection(
  points: readonly Vec3[],
  candidateType?: string,
): { valid: boolean; reasonCodes: string[] } {
  if (candidateType !== "fusiform" || points.length === 0) return { valid: true, reasonCodes: [] };
  const polygon = points.map((point) => [point[0], point[1]] as Point2);
  if (polygon.length > 1 && Math.hypot(
    polygon[0][0] - polygon.at(-1)![0],
    polygon[0][1] - polygon.at(-1)![1],
  ) < 1e-6) polygon.pop();
  const reasonCodes: string[] = [];
  const unique = new Set(polygon.map((point) => `${point[0].toFixed(4)}:${point[1].toFixed(4)}`));
  if (unique.size < 6) reasonCodes.push("candidate_projection_collapsed");
  const area = Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
  if (!(area >= 1)) reasonCodes.push("candidate_projection_degenerate_area");
  const segmentLengths = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  }).filter((length) => length > 1e-6).sort((a, b) => a - b);
  const median = segmentLengths[Math.floor(segmentLengths.length / 2)] || 0;
  if (median > 0 && (segmentLengths.at(-1) || 0) > median * 12) {
    reasonCodes.push("candidate_projection_discontinuous");
  }
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect2d(polygon[first], polygon[firstNext], polygon[second], polygon[secondNext])) {
        reasonCodes.push("candidate_projection_self_intersection");
        first = polygon.length;
        break;
      }
    }
  }

  // A generated fusiform has two corresponding sides between the same tips.
  // Validate those sides separately so pinches and local reversals that stop
  // just short of a literal self-intersection are still rejected.
  if (polygon.length >= 8 && polygon.length % 2 === 0) {
    const farTipIndex = polygon.length / 2;
    const upper = polygon.slice(0, farTipIndex + 1);
    const lower = [polygon[0], ...polygon.slice(farTipIndex + 1).reverse(), polygon[farTipIndex]];
    const widths = upper.map((point, index) => Math.hypot(
      point[0] - lower[index][0],
      point[1] - lower[index][1],
    ));
    const maxWidth = Math.max(...widths);
    const centralWidths = widths.slice(
      Math.max(1, Math.floor(widths.length * 0.25)),
      Math.min(widths.length - 1, Math.ceil(widths.length * 0.75)),
    );
    if (maxWidth > 1 && centralWidths.length && Math.min(...centralWidths) < maxWidth * 0.12) {
      reasonCodes.push("candidate_projection_pinched");
    }

    const tipAxis = [
      polygon[farTipIndex][0] - polygon[0][0],
      polygon[farTipIndex][1] - polygon[0][1],
    ];
    const tipAxisLength2 = tipAxis[0] ** 2 + tipAxis[1] ** 2;
    if (tipAxisLength2 > 1) {
      const centerlineProgress = upper.map((point, index) => {
        const midpoint = [(point[0] + lower[index][0]) / 2, (point[1] + lower[index][1]) / 2];
        return ((midpoint[0] - polygon[0][0]) * tipAxis[0]
          + (midpoint[1] - polygon[0][1]) * tipAxis[1]) / tipAxisLength2;
      });
      if (centerlineProgress.some((value, index) => index > 0
        && index < centerlineProgress.length - 1
        && value < centerlineProgress[index - 1] - 0.04)) {
        reasonCodes.push("candidate_projection_local_fold");
      }
    }

    const cross2 = (a: [number, number], b: [number, number]) => a[0] * b[1] - a[1] * b[0];
    const checkTip = (tip: Point2, first: Point2, second: Point2, inward: [number, number]) => {
      const firstVector: [number, number] = [first[0] - tip[0], first[1] - tip[1]];
      const secondVector: [number, number] = [second[0] - tip[0], second[1] - tip[1]];
      const inwardLength = Math.hypot(...inward);
      const firstLength = Math.hypot(...firstVector);
      const secondLength = Math.hypot(...secondVector);
      if (inwardLength <= 1e-6 || firstLength <= 1e-6 || secondLength <= 1e-6) {
        reasonCodes.push("candidate_projection_tip_degenerate");
        return;
      }
      const firstProgress = (firstVector[0] * inward[0] + firstVector[1] * inward[1]) / (firstLength * inwardLength);
      const secondProgress = (secondVector[0] * inward[0] + secondVector[1] * inward[1]) / (secondLength * inwardLength);
      const firstSide = cross2(inward, firstVector);
      const secondSide = cross2(inward, secondVector);
      if (firstProgress <= 0 || secondProgress <= 0 || Math.abs(firstSide) <= 1e-6 || Math.abs(secondSide) <= 1e-6
        || firstSide * secondSide >= 0) {
        reasonCodes.push("candidate_projection_tip_fold");
      }
    };
    checkTip(
      polygon[0],
      upper[1],
      lower[1],
      [polygon[farTipIndex][0] - polygon[0][0], polygon[farTipIndex][1] - polygon[0][1]],
    );
    checkTip(
      polygon[farTipIndex],
      upper[farTipIndex - 1],
      lower[farTipIndex - 1],
      [polygon[0][0] - polygon[farTipIndex][0], polygon[0][1] - polygon[farTipIndex][1]],
    );

    for (const side of [upper, lower]) {
      for (let index = 1; index < side.length - 2; index += 1) {
        const before = [side[index][0] - side[index - 1][0], side[index][1] - side[index - 1][1]];
        const after = [side[index + 1][0] - side[index][0], side[index + 1][1] - side[index][1]];
        const denom = Math.hypot(...before) * Math.hypot(...after);
        if (denom > 1e-6 && (before[0] * after[0] + before[1] * after[1]) / denom < -0.2) {
          reasonCodes.push("candidate_projection_local_fold");
          break;
        }
      }
    }
  }
  return { valid: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

export function validateIncisionPhotoFile(file: Pick<File, "type" | "size">): string | null {
  if (!INCISION_PHOTO_TYPES.has(file.type)) return "仅支持 JPEG 或 PNG 照片。";
  if (!Number.isFinite(file.size) || file.size <= 0) return "照片文件为空或无法读取。";
  if (file.size > INCISION_PHOTO_MAX_BYTES) return "照片超过 20 MB，请先压缩后重试。";
  return null;
}

export function pointsToSurfaceRefs(
  points: readonly Vec3[] | null | undefined,
  vertices: Vec3[],
  triangles: Triangle[],
): SurfaceRef[] {
  return polylineToSurfaceRefs(points, vertices, triangles);
}

export function candidateEndpointSurfaceRefs(
  candidatePoints: readonly Vec3[],
  candidateRefs: readonly SurfaceRef[],
  endpoints: readonly Vec3[],
  vertices: Vec3[],
  triangles: Triangle[],
): SurfaceRef[] {
  const span = candidatePoints.reduce((maximum, point, index) => {
    const next = candidatePoints[(index + 1) % Math.max(candidatePoints.length, 1)] || point;
    return Math.max(maximum, Math.hypot(next[0] - point[0], next[1] - point[1], next[2] - point[2]));
  }, 0);
  return endpoints.flatMap((endpoint) => {
    if (candidatePoints.length === candidateRefs.length && candidatePoints.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      candidatePoints.forEach((point, index) => {
        const distance = Math.hypot(
          point[0] - endpoint[0],
          point[1] - endpoint[1],
          point[2] - endpoint[2],
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      const tolerance = Math.max(1e-6, span * 2.5);
      return nearestDistance <= tolerance ? [candidateRefs[nearestIndex]] : [];
    }
    return [];
  });
}

const FOREHEAD_SURFACE_CONTOUR = [
  127, 162, 21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 356,
] as const;

export function buildForeheadSurfaceLandmarks(landmarks: readonly Vec3[]): Vec3[] {
  const projected = landmarks.map((point) => [...point] as Vec3);
  const anchor = landmarks[9];
  const top = landmarks[10];
  if (!anchor || !top) return projected;
  const axis = [top[0] - anchor[0], top[1] - anchor[1]];
  const axisLength = Math.hypot(...axis);
  if (axisLength <= 1e-6) return projected;
  const unit = [axis[0] / axisLength, axis[1] / axisLength];
  const denominator = FOREHEAD_SURFACE_CONTOUR.length - 1;
  FOREHEAD_SURFACE_CONTOUR.forEach((landmarkIndex, contourIndex) => {
    const point = landmarks[landmarkIndex];
    if (!point) return;
    const taper = Math.sin(Math.PI * contourIndex / denominator) ** 0.75;
    const parallel = (point[0] - anchor[0]) * unit[0] + (point[1] - anchor[1]) * unit[1];
    const extension = Math.max(0, parallel) * 0.86 * taper;
    projected[landmarkIndex] = [
      point[0] + extension * unit[0],
      point[1] + extension * unit[1],
      point[2],
    ];
  });
  return projected;
}

export function surfaceRefToModelPoint(
  ref: SurfaceRef,
  vertices: Vec3[],
  triangles: Triangle[],
): Vec3 | null {
  return mapSurfaceRefs([ref], vertices, triangles).pts[0] || null;
}

const addPoint = (first: Vec3, second: Vec3): Vec3 => [
  first[0] + second[0],
  first[1] + second[1],
  first[2] + second[2],
];
const scalePoint = (point: Vec3, scale: number): Vec3 => [
  point[0] * scale,
  point[1] * scale,
  point[2] * scale,
];
const crossPoint = (first: Vec3, second: Vec3): Vec3 => [
  first[1] * second[2] - first[2] * second[1],
  first[2] * second[0] - first[0] * second[2],
  first[0] * second[1] - first[1] * second[0],
];
const normalizePoint = (point: Vec3): Vec3 => {
  const length = Math.hypot(...point);
  return length > 1e-9 ? scalePoint(point, 1 / length) : [1, 0, 0];
};

function alignPhotoCandidateToCenterAndAxis({
  candidate,
  endpoints,
  center,
  axisHint,
}: {
  candidate: Vec3[];
  endpoints: Vec3[];
  center: Vec3 | null;
  axisHint?: readonly [number, number] | null;
}): { candidate: Vec3[]; endpoints: Vec3[] } | null {
  if (!center || candidate.length < 8 || endpoints.length < 2) return null;
  const sourceCenter: Vec3 = [
    (endpoints[0][0] + endpoints[1][0]) * 0.5,
    (endpoints[0][1] + endpoints[1][1]) * 0.5,
    (endpoints[0][2] + endpoints[1][2]) * 0.5,
  ];
  const sourceVector = [
    endpoints[1][0] - endpoints[0][0],
    endpoints[1][1] - endpoints[0][1],
  ] as const;
  const sourceLength = Math.hypot(...sourceVector);
  if (!(sourceLength > 1e-6)) return null;
  const sourceAxis = [sourceVector[0] / sourceLength, sourceVector[1] / sourceLength] as const;
  const hintedLength = axisHint ? Math.hypot(axisHint[0], axisHint[1]) : 0;
  let targetAxis = hintedLength > 1e-6
    ? [axisHint![0] / hintedLength, axisHint![1] / hintedLength] as [number, number]
    : [sourceAxis[0], sourceAxis[1]] as [number, number];
  if (sourceAxis[0] * targetAxis[0] + sourceAxis[1] * targetAxis[1] < 0) {
    targetAxis = [-targetAxis[0], -targetAxis[1]];
  }
  const cosine = sourceAxis[0] * targetAxis[0] + sourceAxis[1] * targetAxis[1];
  const sine = sourceAxis[0] * targetAxis[1] - sourceAxis[1] * targetAxis[0];
  const transform = (point: Vec3): Vec3 => {
    const dx = point[0] - sourceCenter[0];
    const dy = point[1] - sourceCenter[1];
    return [
      center[0] + dx * cosine - dy * sine,
      center[1] + dx * sine + dy * cosine,
      center[2] + point[2] - sourceCenter[2],
    ];
  };
  return {
    candidate: candidate.map(transform),
    endpoints: endpoints.slice(0, 2).map(transform),
  };
}

export function buildSubcutaneousDiameterEstimateRefs({
  centerRef,
  lesionIndex,
  diameterMm,
  unitsPerMm,
  vertices,
  normals,
  triangles,
  samples = 48,
}: {
  centerRef: SurfaceRef | null;
  lesionIndex: number;
  diameterMm: number;
  unitsPerMm: number;
  vertices: Vec3[];
  normals: Vec3[];
  triangles: Triangle[];
  samples?: number;
}): SurfaceRef[] {
  const center = centerRef ? surfaceRefToModelPoint(centerRef, vertices, triangles) : vertices[lesionIndex];
  const normal = normals[lesionIndex];
  const radius = Number(diameterMm) * Number(unitsPerMm) / 2;
  if (!center || !normal || !(radius > 0) || samples < 8) return [];
  const u = normalizePoint(crossPoint(normal, [0, 1, 0]));
  const v = normalizePoint(crossPoint(normal, u));
  const points: Vec3[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const angle = index / samples * Math.PI * 2;
    points.push(addPoint(
      addPoint(center, scalePoint(u, Math.cos(angle) * radius)),
      scalePoint(v, Math.sin(angle) * radius),
    ));
  }
  return pointsToSurfaceRefs(points, vertices, triangles);
}

export function buildPhotoSpaceDiameterEstimate(
  center: Vec3 | null,
  diameterMm: number,
  pixelsPerMm: number,
  samples = 48,
): Vec3[] {
  const radiusPx = Number(diameterMm) * Number(pixelsPerMm) / 2;
  if (!center || !(radiusPx > 0) || !Number.isFinite(radiusPx) || samples < 8) return [];
  return Array.from({ length: samples + 1 }, (_, index) => {
    const angle = index / samples * Math.PI * 2;
    return [
      center[0] + Math.cos(angle) * radiusPx,
      center[1] + Math.sin(angle) * radiusPx,
      center[2],
    ] as Vec3;
  });
}

export function buildPhotoSpaceLinearCandidate({
  center,
  lengthMm,
  pixelsPerMm,
  axisHint,
  sourceEndpoints = [],
}: {
  center: Vec3 | null;
  lengthMm: number;
  pixelsPerMm: number;
  axisHint?: readonly number[] | null;
  sourceEndpoints?: readonly Vec3[];
}): { candidate: Vec3[]; endpoints: [Vec3, Vec3] } | null {
  const lengthPx = Number(lengthMm) * Number(pixelsPerMm);
  if (!center || !(lengthPx > 0) || !Number.isFinite(lengthPx)) return null;
  const sourceAxis = sourceEndpoints.length >= 2
    ? [
      sourceEndpoints[1][0] - sourceEndpoints[0][0],
      sourceEndpoints[1][1] - sourceEndpoints[0][1],
    ]
    : null;
  const requestedAxis = axisHint && axisHint.length >= 2
    ? [Number(axisHint[0]), Number(axisHint[1])]
    : sourceAxis;
  const axisLength = requestedAxis ? Math.hypot(requestedAxis[0], requestedAxis[1]) : 0;
  if (!(axisLength > 1e-9) || !Number.isFinite(axisLength)) return null;
  const halfAxis = [
    requestedAxis![0] / axisLength * lengthPx * 0.5,
    requestedAxis![1] / axisLength * lengthPx * 0.5,
  ];
  const first: Vec3 = [center[0] - halfAxis[0], center[1] - halfAxis[1], center[2]];
  const second: Vec3 = [center[0] + halfAxis[0], center[1] + halfAxis[1], center[2]];
  return {
    candidate: [first, [...center] as Vec3, second],
    endpoints: [first, second],
  };
}

export function buildIncisionPhotoGeometry({
  landmarks,
  surfaceLandmarks,
  triangles,
  atlasLines,
  centerRef,
  diameterEstimateRefs = [],
  photoDiameterEstimateMm,
  photoPixelsPerMm,
  candidateLengthMm,
  boundaryRefs,
  photoBoundary,
  candidateRefs,
  endpointRefs,
  candidateType,
  candidateAspectRatio,
  candidateAxisCoverageRatio,
  candidateTipAngleDeg,
  candidateSkinVisible,
}: Omit<IncisionPhotoRenderInput, "context" | "source" | "sourceWidth" | "sourceHeight" | "devicePixelRatio">): IncisionPhotoGeometry {
  const photoLandmarks = surfaceLandmarks || landmarks;
  const sourceCandidateMapping = mapSurfaceRefs(candidateRefs, photoLandmarks, triangles);
  const sourceCandidate = sourceCandidateMapping.pts;
  // RSTL is a shared team-owned layer. Keep its source mapping identical to
  // the live 2D renderer; the extended surface is only for incision picking
  // and candidate/lesion projection.
  const rstl = mapAtlas(atlasLines, landmarks, triangles);
  const directionReferenceRstl = visibleProjectedRstlLines(rstl, landmarks, triangles);
  const sourceEndpoints = mapSurfaceRefs(endpointRefs, photoLandmarks, triangles).pts;
  const detectedCenter = centerRef ? mapSurfaceRefs([centerRef], photoLandmarks, triangles).pts[0] || null : null;
  const photoDiameterEstimate = buildPhotoSpaceDiameterEstimate(
    detectedCenter,
    Number(photoDiameterEstimateMm),
    Number(photoPixelsPerMm),
  );
  const planningCenter = candidateType === "fusiform" && sourceEndpoints.length >= 2
    ? [
      (sourceEndpoints[0][0] + sourceEndpoints[1][0]) * 0.5,
      (sourceEndpoints[0][1] + sourceEndpoints[1][1]) * 0.5,
      (sourceEndpoints[0][2] + sourceEndpoints[1][2]) * 0.5,
    ] as Vec3
    : detectedCenter;
  // Rendering is not allowed to redefine the lesion center. The candidate
  // generator must remain centered on the detector-confirmed center; if an old
  // or imported candidate does not, keep that offset auditable instead of
  // moving the red point after the async workflow finishes.
  const candidateSmoothingCenter = detectedCenter || planningCenter;
  const boundary = photoBoundary?.length
    ? photoBoundary.map((point) => [...point] as Vec3)
    : mapSurfaceRefs(boundaryRefs, photoLandmarks, triangles).pts;
  const sourceProjection = inspectPhotoCandidateProjection(sourceCandidate, candidateType);
  const nearestPhotoRstl = candidateSmoothingCenter
    ? nearestProjectedRstlSegment(candidateSmoothingCenter, directionReferenceRstl)
    : null;
  const photoLinearCandidate = candidateType === "linear"
    ? buildPhotoSpaceLinearCandidate({
      center: candidateSmoothingCenter,
      lengthMm: Number(candidateLengthMm),
      pixelsPerMm: Number(photoPixelsPerMm),
      axisHint: nearestPhotoRstl?.axis || null,
      sourceEndpoints,
    })
    : null;
  const photoCanonicalInput = {
    sourceCandidate,
    sourceEndpoints,
    center: candidateSmoothingCenter,
    boundary,
    aspectRatio: candidateAspectRatio,
    tipAngleDeg: candidateTipAngleDeg,
    landmarks: photoLandmarks,
    triangles,
    skinVisible: candidateSkinVisible,
    axisHint: nearestPhotoRstl?.axis || null,
  };
  const standardPhotoCanonicalAttempt = candidateType === "fusiform" && candidateAspectRatio != null
    ? buildPhotoSurfaceCanonicalFusiform(photoCanonicalInput)
    : null;
  const constrainedReference = attemptConstrainedPhotoReferences({
    input: photoCanonicalInput,
    standardAttempt: standardPhotoCanonicalAttempt,
    standardAspectRatio: Number(candidateAspectRatio),
    minimumLengthScale: candidateAxisCoverageRatio,
  });
  const constrainedReferenceAttempt = constrainedReference.fitAttempt;
  const referenceAttempts = constrainedReference.attempts;
  const visibilityLimitedStandardFit = standardPhotoCanonicalAttempt?.visibilityLimitedFit || null;
  const useVisibilityLimitedStandard = Boolean(visibilityLimitedStandardFit);
  const useConstrainedReference = Boolean(constrainedReferenceAttempt?.fit);
  const selectedPhotoCanonicalAttempt = standardPhotoCanonicalAttempt?.fit
    || visibilityLimitedStandardFit
    ? standardPhotoCanonicalAttempt
    : constrainedReferenceAttempt?.fit
      ? constrainedReferenceAttempt
      : standardPhotoCanonicalAttempt;
  const selectedPhotoCanonicalFit = standardPhotoCanonicalAttempt?.fit
    || visibilityLimitedStandardFit
    || constrainedReferenceAttempt?.fit
    || null;
  const usePhotoCanonical = Boolean(selectedPhotoCanonicalFit);
  // The legacy photo fallback kept the original projected tips and only pulled
  // the middle of the curve toward the detected lesion. That could leave the
  // endpoint midpoint off-center and make one half visibly longer. Before the
  // fallback is fitted, rigidly align the whole source candidate to the lesion
  // center and the nearest projected RSTL direction. It is accepted only after
  // coverage and visible-surface gates are rerun below.
  const alignedFallbackSource = candidateType === "fusiform" && !usePhotoCanonical
    ? alignPhotoCandidateToCenterAndAxis({
      candidate: sourceCandidate,
      endpoints: sourceEndpoints,
      center: candidateSmoothingCenter,
      axisHint: nearestPhotoRstl?.axis || null,
    })
    : null;
  const rawFusiformFitAttempt = alignedFallbackSource
    ? diagnoseSurfaceProjectedFusiformFit(alignedFallbackSource.candidate, candidateSmoothingCenter)
    : null;
  const fallbackOutline = rawFusiformFitAttempt?.fit?.outline || null;
  const fallbackSurfaceValidation = fallbackOutline
    ? validatePhotoSurfacePoints(
      fallbackOutline.slice(0, -1), photoLandmarks, triangles, candidateSkinVisible,
    )
    : null;
  const fallbackBoundaryOutsideCount = fallbackOutline
    ? boundary.filter((point) => !pointInPolygon2d(
      [point[0], point[1]],
      fallbackOutline.slice(0, -1).map((candidatePoint) => [
        candidatePoint[0], candidatePoint[1],
      ] as Point2),
    )).length
    : boundary.length;
  const fallbackEndpoints = alignedFallbackSource?.endpoints || [];
  const fallbackEndpointMidpointError = candidateSmoothingCenter && fallbackEndpoints.length >= 2
    ? Math.hypot(
      (fallbackEndpoints[0][0] + fallbackEndpoints[1][0]) * 0.5 - candidateSmoothingCenter[0],
      (fallbackEndpoints[0][1] + fallbackEndpoints[1][1]) * 0.5 - candidateSmoothingCenter[1],
    )
    : Infinity;
  const fallbackRstlDeviation = projectedRstlDeviation(
    candidateSmoothingCenter, fallbackEndpoints, directionReferenceRstl,
  );
  const fallbackGateReason: FusiformFitFailureReason | null = !rawFusiformFitAttempt?.fit
    ? rawFusiformFitAttempt?.diagnostics.reason || "invalid_sampling"
    : fallbackBoundaryOutsideCount > 0
      ? "photo_boundary_not_enclosed"
      : (fallbackSurfaceValidation?.outsideCount || 0) > 0
        ? "photo_surface_exit"
        : fallbackEndpointMidpointError > 1e-6
          || (fallbackRstlDeviation != null && fallbackRstlDeviation > 1e-3)
          ? "invalid_sampling"
          : null;
  const useCenteredFallback = !usePhotoCanonical && fallbackGateReason == null;
  const fusiformFitAttempt = rawFusiformFitAttempt
    ? {
      fit: useCenteredFallback ? rawFusiformFitAttempt.fit : null,
      diagnostics: {
        ...rawFusiformFitAttempt.diagnostics,
        ok: useCenteredFallback,
        reason: fallbackGateReason,
        photoCanonicalReason: standardPhotoCanonicalAttempt?.diagnostics.reason ?? null,
        photoBoundaryOutsideCount: fallbackBoundaryOutsideCount,
        photoSurfaceOutsideCount: fallbackSurfaceValidation?.outsideCount ?? 0,
        photoSurfaceMeshOutsideCount: fallbackSurfaceValidation?.meshOutsideCount ?? 0,
        photoHeadOutsideCount: fallbackSurfaceValidation?.headOutsideCount ?? 0,
        photoSkinOutsideCount: fallbackSurfaceValidation?.skinOutsideCount ?? 0,
        photoCanonicalAxisSource: nearestPhotoRstl ? "nearest_projected_rstl" : "source_endpoints",
      },
    } satisfies SurfaceProjectedFusiformFitAttempt
    : null;
  const fusiformRendering = selectedPhotoCanonicalFit || fusiformFitAttempt?.fit || null;
  const surfaceSmoothedCandidate = fusiformRendering?.outline || null;
  const surfaceSmoothedProjection = surfaceSmoothedCandidate
    ? inspectPhotoCandidateProjection(surfaceSmoothedCandidate, candidateType)
    : null;
  const useSurfaceSmoothedCandidate = Boolean(surfaceSmoothedCandidate && surfaceSmoothedProjection?.valid);
  const candidate = photoLinearCandidate?.candidate
    || (useSurfaceSmoothedCandidate ? surfaceSmoothedCandidate! : sourceCandidate);
  const endpoints = usePhotoCanonical
    ? selectedPhotoCanonicalAttempt!.endpoints
    : useCenteredFallback
      ? fallbackEndpoints
      : candidateType === "fusiform" ? [] : photoLinearCandidate?.endpoints || sourceEndpoints;
  // The bounded global fit is an optional visual improvement. If it cannot be
  // produced, keep a medically gated source candidate visible instead of
  // turning a valid plan into an empty overlay.
  const candidateProjection = useSurfaceSmoothedCandidate
    ? surfaceSmoothedProjection!
    : candidateType === "fusiform"
      ? {
        valid: false,
        reasonCodes: [...new Set([
          ...sourceProjection.reasonCodes,
          fallbackGateReason === "photo_boundary_not_enclosed"
            ? "candidate_boundary_not_enclosed"
            : fallbackGateReason === "photo_surface_exit"
              ? "candidate_surface_exit"
              : "candidate_center_or_direction_unresolved",
        ])],
      }
      : photoLinearCandidate
        ? inspectPhotoCandidateProjection(photoLinearCandidate.candidate, candidateType)
        : sourceProjection;
  const renderedPlanningCenter = endpoints.length >= 2
    ? [
      (endpoints[0][0] + endpoints[1][0]) * 0.5,
      (endpoints[0][1] + endpoints[1][1]) * 0.5,
      (endpoints[0][2] + endpoints[1][2]) * 0.5,
    ] as Vec3
    : null;
  return {
    rstl,
    center: detectedCenter,
    planningCenter: renderedPlanningCenter,
    lesionToPlanningCenterPx: detectedCenter && renderedPlanningCenter
      ? Math.hypot(
        detectedCenter[0] - renderedPlanningCenter[0],
        detectedCenter[1] - renderedPlanningCenter[1],
      )
      : null,
    diameterEstimate: photoDiameterEstimate.length
      ? photoDiameterEstimate
      : mapSurfaceRefs(diameterEstimateRefs, photoLandmarks, triangles).pts,
    boundary,
    candidate,
    endpoints,
    candidateProjection: {
      ...candidateProjection,
      surfaceConstrained: useSurfaceSmoothedCandidate,
      sourceReasonCodes: sourceProjection.reasonCodes,
      smoothingMode: candidateType !== "fusiform"
        ? "notApplicable"
        : useVisibilityLimitedStandard
          ? "limitedVisibility"
          : useConstrainedReference
            ? "constrainedReference"
            : usePhotoCanonical
              ? "photoCanonical"
              : useSurfaceSmoothedCandidate
                ? fusiformRendering?.strategy === "segmented_c1" ? "segmentedBezier" : "globalBezier"
                : "sourceFallback",
      smoothingDiagnostics: usePhotoCanonical
        ? selectedPhotoCanonicalAttempt!.diagnostics
        : selectedPhotoCanonicalAttempt && fusiformFitAttempt?.diagnostics
          ? {
            ...fusiformFitAttempt.diagnostics,
            photoCanonicalReason: selectedPhotoCanonicalAttempt.diagnostics.reason,
            photoCanonicalScale: selectedPhotoCanonicalAttempt.diagnostics.photoCanonicalScale,
            photoBoundaryOutsideCount: selectedPhotoCanonicalAttempt.diagnostics.photoBoundaryOutsideCount,
            photoSurfaceOutsideCount: selectedPhotoCanonicalAttempt.diagnostics.photoSurfaceOutsideCount,
            photoSurfaceMeshOutsideCount: selectedPhotoCanonicalAttempt.diagnostics.photoSurfaceMeshOutsideCount,
            photoHeadOutsideCount: selectedPhotoCanonicalAttempt.diagnostics.photoHeadOutsideCount,
            photoSkinOutsideCount: selectedPhotoCanonicalAttempt.diagnostics.photoSkinOutsideCount,
            photoCanonicalAxisSource: selectedPhotoCanonicalAttempt.diagnostics.photoCanonicalAxisSource,
          }
          : fusiformFitAttempt?.diagnostics || null,
      referenceAspectRatio: useConstrainedReference
        ? selectedPhotoCanonicalAttempt?.diagnostics.photoCanonicalAspectRatio ?? null
        : useVisibilityLimitedStandard
          ? selectedPhotoCanonicalAttempt?.diagnostics.photoCanonicalAspectRatio ?? null
          : null,
      referenceLengthScale: useConstrainedReference
        ? selectedPhotoCanonicalAttempt?.diagnostics.photoCanonicalLengthScale ?? null
        : null,
      referenceAttempts,
      visibilityLimited: useVisibilityLimitedStandard,
      visibleFraction: useVisibilityLimitedStandard
        ? selectedPhotoCanonicalAttempt?.diagnostics.photoVisibleFraction ?? null
        : null,
      hiddenPointCount: useVisibilityLimitedStandard
        ? Number(selectedPhotoCanonicalAttempt?.diagnostics.photoSurfaceOutsideCount || 0)
        : 0,
    },
    fusiformRendering: useSurfaceSmoothedCandidate ? fusiformRendering : null,
    projectedRstlDeviationDeg: projectedRstlDeviation(detectedCenter, endpoints, directionReferenceRstl),
  };
}

export function projectedRstlDeviation(
  center: Vec3 | null,
  endpoints: readonly Vec3[],
  rstl: readonly MappedAtlasLine[],
): number | null {
  if (endpoints.length < 2) return null;
  const origin = center || [
    (endpoints[0][0] + endpoints[1][0]) / 2,
    (endpoints[0][1] + endpoints[1][1]) / 2,
    0,
  ] as Vec3;
  const candidateAxis = [endpoints[1][0] - endpoints[0][0], endpoints[1][1] - endpoints[0][1]];
  const candidateLength = Math.hypot(...candidateAxis);
  if (candidateLength <= 1e-6) return null;
  const nearest = nearestProjectedRstlSegment(origin, rstl);
  if (!nearest) return null;
  const cosine = Math.abs(candidateAxis[0] * nearest.axis[0] + candidateAxis[1] * nearest.axis[1])
    / (candidateLength * Math.hypot(...nearest.axis));
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

export interface NearestProjectedRstlSegment {
  lineIndex: number;
  segmentIndex: number;
  lineName: string;
  distance: number;
  axis: [number, number];
  nearestPoint: [number, number];
}

type VisibleProjectedRstlLine = MappedAtlasLine & { sourceLineIndex: number };

function visibleProjectedRstlLines(
  rstl: MappedAtlasLine[],
  landmarks: Vec3[],
  triangles: Triangle[],
): VisibleProjectedRstlLine[] {
  return buildRstlRenderPlan({
    lines: rstl,
    landmarks,
    triangles,
    clip: true,
    densityFraction: 1,
  }).flatMap((entry) => entry.runs.map((run) => ({
    ...entry.line,
    pts: run,
    tris: [],
    sourceLineIndex: entry.lineIndex,
  })));
}

export function nearestProjectedRstlSegment(
  origin: readonly number[],
  rstl: readonly MappedAtlasLine[],
): NearestProjectedRstlSegment | null {
  let nearest: NearestProjectedRstlSegment | null = null;
  for (let lineIndex = 0; lineIndex < rstl.length; lineIndex += 1) {
    const line = rstl[lineIndex];
    for (let index = 0; index < line.pts.length - 1; index += 1) {
      const first = line.pts[index], second = line.pts[index + 1];
      const axis: [number, number] = [second[0] - first[0], second[1] - first[1]];
      if (Math.hypot(...axis) <= 1e-6) continue;
      const axisLength2 = axis[0] ** 2 + axis[1] ** 2;
      const projection = Math.max(0, Math.min(1, (
        (origin[0] - first[0]) * axis[0] + (origin[1] - first[1]) * axis[1]
      ) / axisLength2));
      const nearestPoint: [number, number] = [first[0] + projection * axis[0], first[1] + projection * axis[1]];
      const distance = Math.hypot(nearestPoint[0] - origin[0], nearestPoint[1] - origin[1]);
      if (!nearest || distance < nearest.distance) {
        nearest = {
          lineIndex,
          segmentIndex: index,
          lineName: line.name,
          distance,
          axis,
          nearestPoint,
        };
      }
    }
  }
  return nearest;
}

function canonicalPhotoModelAxis(vector: Vec3): Vec3 {
  for (const component of vector) {
    if (Math.abs(component) <= 1e-12) continue;
    return component < 0 ? vector.map((value) => -value) as Vec3 : vector;
  }
  return vector;
}

export interface IncisionPhotoRstlDirection {
  point: Vec3;
  vector: Vec3;
  angle_deg: number;
  confidence: number;
  source: string;
  nearest_distance: number | null;
  support_count: number;
  angular_spread_deg: number;
  confidence_reasons: string[];
  [key: string]: unknown;
}

export function queryIncisionPhotoRstlDirection({
  centerRef,
  vertices,
  landmarks,
  surfaceLandmarks,
  triangles,
  atlasLines,
}: {
  centerRef: SurfaceRef | null;
  vertices: Vec3[];
  landmarks: readonly Vec3[];
  surfaceLandmarks?: readonly Vec3[] | null;
  triangles: Triangle[];
  atlasLines: AtlasLine[] | unknown;
}): IncisionPhotoRstlDirection | null {
  if (!centerRef) return null;
  const triangle = triangles[centerRef.tri];
  if (!triangle) return null;
  const photoVertices = [...(surfaceLandmarks || landmarks)] as Vec3[];
  const center = mapSurfaceRefs([centerRef], photoVertices, triangles).pts[0];
  const modelCenter = mapSurfaceRefs([centerRef], vertices, triangles).pts[0];
  if (!center || !modelCenter) return null;
  const sourceLandmarks = [...landmarks] as Vec3[];
  const mappedRstl = mapAtlas(atlasLines, sourceLandmarks, triangles);
  const visibleRstl = visibleProjectedRstlLines(mappedRstl, sourceLandmarks, triangles);
  const nearest = nearestProjectedRstlSegment(center, visibleRstl);
  if (!nearest) return null;
  const selectedVisibleLine = visibleRstl[nearest.lineIndex];

  const [aIndex, bIndex, cIndex] = triangle;
  const photoA = photoVertices[aIndex], photoB = photoVertices[bIndex], photoC = photoVertices[cIndex];
  const modelA = vertices[aIndex], modelB = vertices[bIndex], modelC = vertices[cIndex];
  if (!photoA || !photoB || !photoC || !modelA || !modelB || !modelC) return null;
  const photoAB = [photoB[0] - photoA[0], photoB[1] - photoA[1]];
  const photoAC = [photoC[0] - photoA[0], photoC[1] - photoA[1]];
  const determinant = photoAB[0] * photoAC[1] - photoAB[1] * photoAC[0];
  if (Math.abs(determinant) <= 1e-9) return null;
  const targetLength = Math.hypot(...nearest.axis);
  if (targetLength <= 1e-9) return null;
  const target = [nearest.axis[0] / targetLength, nearest.axis[1] / targetLength];
  const coefficientB = (target[0] * photoAC[1] - target[1] * photoAC[0]) / determinant;
  const coefficientC = (photoAB[0] * target[1] - photoAB[1] * target[0]) / determinant;
  const modelDirection: Vec3 = [
    coefficientB * (modelB[0] - modelA[0]) + coefficientC * (modelC[0] - modelA[0]),
    coefficientB * (modelB[1] - modelA[1]) + coefficientC * (modelC[1] - modelA[1]),
    coefficientB * (modelB[2] - modelA[2]) + coefficientC * (modelC[2] - modelA[2]),
  ];
  const modelLength = Math.hypot(...modelDirection);
  if (modelLength <= 1e-9) return null;
  const vector = canonicalPhotoModelAxis(modelDirection.map((value) => value / modelLength) as Vec3);
  const xs = landmarks.map((point) => point[0]);
  const ys = landmarks.map((point) => point[1]);
  const photoDiagonal = xs.length && ys.length
    ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    : 0;
  const maxDistance = Math.max(photoDiagonal * 0.18, 1e-9);
  const confidence = Math.max(0, Math.min(1, 1 - nearest.distance / maxDistance));
  const confidenceReasons = confidence < 0.35 ? ["photo_projected_rstl_support_far"] : [];
  return {
    schema: "incision-photo-rstl-direction/v0.1",
    point: modelCenter,
    vector,
    angle_deg: Math.atan2(vector[1], vector[0]) * 180 / Math.PI,
    confidence,
    source: "photo_projected_rstl_nearest_segment",
    nearest_distance: null,
    support_count: 1,
    angular_spread_deg: 0,
    confidence_reasons: confidenceReasons,
    line_id: nearest.lineName,
    line_index: selectedVisibleLine?.sourceLineIndex ?? nearest.lineIndex,
    segment_index: nearest.segmentIndex,
    nearest_point: nearest.nearestPoint,
    projected_axis: target,
    projected_nearest_distance_px: nearest.distance,
    inverse_surface_triangle: centerRef.tri,
  };
}

export function nearestPhotoEndpointHandle(
  point: { x: number; y: number },
  endpoints: readonly { x: number; y: number }[],
  radiusCssPx = 12,
): number | null {
  let nearest: { index: number; distance: number } | null = null;
  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const distance = Math.hypot(point.x - endpoint.x, point.y - endpoint.y);
    if (distance <= radiusCssPx && (!nearest || distance < nearest.distance)) nearest = { index, distance };
  }
  return nearest?.index ?? null;
}

function canvasForeheadSkinVisibility(
  context: CanvasRenderingContext2D,
  sourceWidth: number,
  sourceHeight: number,
  landmarks: Vec3[],
): VisibilityPredicate {
  try {
    const pixelWidth = context.canvas.width;
    const pixelHeight = context.canvas.height;
    if (pixelWidth <= 0 || pixelHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) return () => true;
    const scaleX = pixelWidth / sourceWidth;
    const scaleY = pixelHeight / sourceHeight;
    const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight);
    const scaledLandmarks = landmarks.map((point) => [
      point[0] * scaleX,
      point[1] * scaleY,
      point[2],
    ] as Vec3);
    const visible = buildForeheadSkinVisibility(pixels, pixelWidth, pixelHeight, scaledLandmarks);
    return (point) => point
      ? visible([point[0] * scaleX, point[1] * scaleY, point[2]])
      : false;
  } catch {
    return () => true;
  }
}

export function incisionPhotoSkinVisibility(
  context: CanvasRenderingContext2D,
  sourceWidth: number,
  sourceHeight: number,
  landmarks: Vec3[],
): VisibilityPredicate {
  return canvasForeheadSkinVisibility(context, sourceWidth, sourceHeight, landmarks);
}

function drawPath(
  context: CanvasRenderingContext2D,
  points: readonly Vec3[],
  strokeStyle: string,
  lineWidth: number,
  closed = false,
) {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index][0], points[index][1]);
  }
  if (closed) context.closePath();
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();
}

function strokeCurrentPath(
  context: CanvasRenderingContext2D,
  strokeStyle: string,
  lineWidth: number,
) {
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();
}

function traceSampledLocalCubic(context: CanvasRenderingContext2D, points: readonly Vec3[]) {
  const polygon = points.map((point) => [...point] as Vec3);
  if (polygon.length > 1 && Math.hypot(
    polygon[0][0] - polygon.at(-1)![0],
    polygon[0][1] - polygon.at(-1)![1],
  ) < 1e-6) polygon.pop();
  if (polygon.length < 8 || polygon.length % 2 !== 0) {
    context.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach((point) => context.lineTo(point[0], point[1]));
    context.closePath();
    return;
  }
  const farTipIndex = polygon.length / 2;
  const upper = polygon.slice(0, farTipIndex + 1);
  const lowerReturn = polygon.slice(farTipIndex).concat([polygon[0]]);
  const traceSide = (side: Vec3[], moveToStart: boolean) => {
    if (moveToStart) context.moveTo(side[0][0], side[0][1]);
    for (let index = 0; index < side.length - 1; index += 1) {
      const previous = side[Math.max(0, index - 1)];
      const start = side[index];
      const end = side[index + 1];
      const following = side[Math.min(side.length - 1, index + 2)];
      const segmentLength = Math.max(1e-9, Math.hypot(end[0] - start[0], end[1] - start[1]));
      const maxHandle = segmentLength * 0.32;
      const boundedHandle = (x: number, y: number) => {
        const length = Math.hypot(x, y);
        const scale = length > maxHandle ? maxHandle / length : 1;
        return [x * scale, y * scale] as const;
      };
      const startHandle = boundedHandle((end[0] - previous[0]) / 6, (end[1] - previous[1]) / 6);
      const endHandle = boundedHandle((following[0] - start[0]) / 6, (following[1] - start[1]) / 6);
      context.bezierCurveTo(
        start[0] + startHandle[0],
        start[1] + startHandle[1],
        end[0] - endHandle[0],
        end[1] - endHandle[1],
        end[0],
        end[1],
      );
    }
  };
  traceSide(upper, true);
  traceSide(lowerReturn, false);
  context.closePath();
}

export function drawFusiformRenderMode(
  context: CanvasRenderingContext2D,
  candidate: readonly Vec3[],
  fit: SurfaceProjectedFusiformFit | null | undefined,
  mode: FusiformRenderMode,
  strokeStyle: string,
  lineWidth: number,
) {
  const points = mode === "raw" && fit ? fit.sourceOutline : candidate;
  if (points.length < 2) return;
  if (fit?.visibleSegments?.length) {
    context.beginPath();
    for (const segment of fit.visibleSegments) {
      if (segment.length < 2) continue;
      context.moveTo(segment[0][0], segment[0][1]);
      segment.slice(1).forEach((point) => context.lineTo(point[0], point[1]));
    }
    strokeCurrentPath(context, strokeStyle, lineWidth);
    return;
  }
  context.beginPath();
  if (mode === "segmentedBezierDirect" && fit) {
    const upper = fit.upperCurves;
    const lower = fit.lowerCurves;
    context.moveTo(upper[0][0][0], upper[0][0][1]);
    upper.forEach((curve) => context.bezierCurveTo(
      curve[1][0], curve[1][1], curve[2][0], curve[2][1], curve[3][0], curve[3][1],
    ));
    lower.slice().reverse().forEach((curve) => context.bezierCurveTo(
      curve[2][0], curve[2][1], curve[1][0], curve[1][1], curve[0][0], curve[0][1],
    ));
    context.closePath();
  } else if (mode === "globalBezierDirect" && fit) {
    const upper = fit.upperCurve;
    const lower = fit.lowerCurve;
    context.moveTo(upper[0][0], upper[0][1]);
    context.bezierCurveTo(
      upper[1][0], upper[1][1], upper[2][0], upper[2][1], upper[3][0], upper[3][1],
    );
    context.bezierCurveTo(
      lower[2][0], lower[2][1], lower[1][0], lower[1][1], lower[0][0], lower[0][1],
    );
    context.closePath();
  } else if (mode === "sampledLocalCubic") {
    traceSampledLocalCubic(context, points);
  } else {
    context.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach((point) => context.lineTo(point[0], point[1]));
    context.closePath();
  }
  strokeCurrentPath(context, strokeStyle, lineWidth);
}

export function renderIncisionPhotoPlanning(input: IncisionPhotoRenderInput): IncisionPhotoGeometry {
  const {
    context,
    source,
    sourceWidth,
    sourceHeight,
    devicePixelRatio,
  } = input;
  const dpr = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
  const strokeWidths = incisionPhotoStrokeWidths(sourceWidth);
  const overlayStyle = incisionOverlayStyle(sourceWidth, input.candidateType, {
    displayScale: input.displayScale,
  });

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, sourceWidth, sourceHeight);
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const skinVisible = canvasForeheadSkinVisibility(context, sourceWidth, sourceHeight, input.landmarks);
  const geometry = buildIncisionPhotoGeometry({ ...input, candidateSkinVisible: skinVisible });

  const rstlRenderPlan = buildRstlRenderPlan({
    lines: geometry.rstl,
    landmarks: input.landmarks,
    triangles: input.triangles,
    clip: true,
    densityFraction: 1,
    skinVisible,
  });
  for (const entry of rstlRenderPlan) {
    for (const run of entry.runs) {
      drawPath(context, run, "rgba(255, 0, 200, 0.95)", strokeWidths.rstl);
    }
  }
  if (geometry.diameterEstimate.length >= 2) {
    context.setLineDash([8, 6]);
    drawPath(context, geometry.diameterEstimate, "rgba(3, 7, 18, 0.88)", strokeWidths.boundaryHalo, true);
    drawPath(context, geometry.diameterEstimate, input.tumorInputInvalid ? "#ef4444" : "#facc15", strokeWidths.boundary, true);
    context.setLineDash([]);
  }
  if (geometry.boundary.length >= 2) {
    drawPath(context, geometry.boundary, "rgba(3, 7, 18, 0.88)", strokeWidths.boundaryHalo, geometry.boundary.length >= 6);
    drawPath(context, geometry.boundary, input.tumorInputInvalid ? "#ef4444" : "#facc15", strokeWidths.boundary, geometry.boundary.length >= 6);
  }
  if (input.drawCandidate !== false && geometry.candidate.length >= 2 && geometry.candidateProjection.valid) {
    if (input.candidateType === "fusiform") {
      drawFusiformRenderMode(
        context,
        geometry.candidate,
        geometry.fusiformRendering,
        input.fusiformRenderMode || (geometry.fusiformRendering
          ? geometry.fusiformRendering.strategy === "segmented_c1"
            ? "segmentedBezierDirect"
            : "globalBezierDirect"
          : "raw"),
        overlayStyle.candidate.color,
        overlayStyle.candidate.lineWidth,
      );
    } else {
      drawPath(context, geometry.candidate, overlayStyle.candidate.haloColor, overlayStyle.candidate.haloWidth);
      drawPath(context, geometry.candidate, overlayStyle.candidate.color, overlayStyle.candidate.lineWidth);
    }
  }
  if (geometry.center) {
    context.beginPath();
    context.arc(geometry.center[0], geometry.center[1], 7, 0, Math.PI * 2);
    context.fillStyle = "#f43f5e";
    context.strokeStyle = "rgba(3, 7, 18, 0.95)";
    context.lineWidth = 3;
    context.fill();
    context.stroke();
  }
  // Endpoint controls are fixed-size HTML handles layered over the canvas.
  // Keeping them out of source-pixel rendering prevents zoom and source size
  // from making the controls disappear or become visually dominant.
  context.setTransform(1, 0, 0, 1, 0, 0);
  return geometry;
}
