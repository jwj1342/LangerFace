import {
  mapAtlas,
  type AtlasLine,
  type MappedAtlasLine,
} from "./geometryAtlas.ts";
import {
  buildForeheadSkinVisibility,
  type VisibilityPredicate,
} from "./foreheadVisibility.ts";
import { mapSurfaceRefs, pointToSurfaceRef, polylineToSurfaceRefs, type SurfaceRef } from "./incisionOverlay.ts";
import { buildRstlRenderPlan } from "./rstlRenderPlan.ts";
import { incisionOverlayStyle } from "./incisionOverlayStyle.ts";
import { segmentsIntersect2d, type Point2 } from "./incisionPathGeometry.ts";
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

export function incisionPhotoStatusPresentation({
  rstlLineCount,
  candidateDisplayBlocked,
  engineeringBlockMessage,
  candidateProjectionValid,
  candidatePointCount,
  candidateSmoothingMode = "notApplicable",
  projectedRstlDeviationDeg = null,
}: {
  rstlLineCount: number;
  candidateDisplayBlocked: boolean;
  engineeringBlockMessage: string;
  candidateProjectionValid: boolean;
  candidatePointCount: number;
  candidateSmoothingMode?: "globalBezier" | "segmentedBezier" | "sourceFallback" | "notApplicable";
  projectedRstlDeviationDeg?: number | null;
}): { message: string; tone: IncisionPhotoStatusTone } {
  const projectedDirectionNeedsReview = projectedRstlDeviationDeg != null
    && Number.isFinite(projectedRstlDeviationDeg)
    && projectedRstlDeviationDeg > 15;
  const detail = candidateDisplayBlocked
    ? engineeringBlockMessage || "候选未显示：工程门禁未通过。"
    : !candidateProjectionValid
      ? "候选未显示：当前位置无法形成平滑、完整的梭形切口；请移动病灶或调整范围后重试。"
      : candidatePointCount > 0
        ? candidateSmoothingMode === "sourceFallback"
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
      || candidateSmoothingMode === "sourceFallback"
      ? "warning"
      : candidatePointCount > 0 ? "ready" : "idle",
  };
}

export interface IncisionPhotoGeometry {
  rstl: MappedAtlasLine[];
  center: Vec3 | null;
  diameterEstimate: Vec3[];
  boundary: Vec3[];
  candidate: Vec3[];
  endpoints: Vec3[];
  candidateProjection: {
    valid: boolean;
    reasonCodes: string[];
    surfaceConstrained?: boolean;
    sourceReasonCodes?: string[];
    smoothingMode?: "globalBezier" | "segmentedBezier" | "sourceFallback" | "notApplicable";
    smoothingDiagnostics?: FusiformFitDiagnostics | null;
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
  | "envelope_exceeded";

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
  strategy: "centerline_halfwidth_global_cubic" | "centerline_halfwidth_segmented_c1";
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
  boundaryRefs: SurfaceRef[];
  candidateRefs: SurfaceRef[];
  endpointRefs: SurfaceRef[];
  endpointRadius?: number;
  tumorInputInvalid?: boolean;
  candidateType?: string;
  displayScale?: number;
  fusiformRenderMode?: FusiformRenderMode;
  drawCandidate?: boolean;
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

export function buildIncisionPhotoGeometry({
  landmarks,
  surfaceLandmarks,
  triangles,
  atlasLines,
  centerRef,
  diameterEstimateRefs = [],
  boundaryRefs,
  candidateRefs,
  endpointRefs,
  candidateType,
}: Omit<IncisionPhotoRenderInput, "context" | "source" | "sourceWidth" | "sourceHeight" | "devicePixelRatio">): IncisionPhotoGeometry {
  const photoLandmarks = surfaceLandmarks || landmarks;
  const sourceCandidateMapping = mapSurfaceRefs(candidateRefs, photoLandmarks, triangles);
  const sourceCandidate = sourceCandidateMapping.pts;
  // RSTL is a shared team-owned layer. Keep its source mapping identical to
  // the live 2D renderer; the extended surface is only for incision picking
  // and candidate/lesion projection.
  const rstl = mapAtlas(atlasLines, landmarks, triangles);
  const endpoints = mapSurfaceRefs(endpointRefs, photoLandmarks, triangles).pts;
  const center = centerRef ? mapSurfaceRefs([centerRef], photoLandmarks, triangles).pts[0] || null : null;
  const sourceProjection = inspectPhotoCandidateProjection(sourceCandidate, candidateType);
  const fusiformFitAttempt = candidateType === "fusiform"
    ? diagnoseSurfaceProjectedFusiformFit(sourceCandidate, center)
    : null;
  const fusiformRendering = fusiformFitAttempt?.fit || null;
  const surfaceSmoothedCandidate = fusiformRendering?.outline || null;
  const surfaceSmoothedProjection = surfaceSmoothedCandidate
    ? inspectPhotoCandidateProjection(surfaceSmoothedCandidate, candidateType)
    : null;
  const useSurfaceSmoothedCandidate = Boolean(surfaceSmoothedCandidate && surfaceSmoothedProjection?.valid);
  const candidate = useSurfaceSmoothedCandidate ? surfaceSmoothedCandidate! : sourceCandidate;
  // The bounded global fit is an optional visual improvement. If it cannot be
  // produced, keep a medically gated source candidate visible instead of
  // turning a valid plan into an empty overlay.
  const candidateProjection = useSurfaceSmoothedCandidate
    ? surfaceSmoothedProjection!
    : sourceProjection;
  return {
    rstl,
    center,
    diameterEstimate: mapSurfaceRefs(diameterEstimateRefs, photoLandmarks, triangles).pts,
    boundary: mapSurfaceRefs(boundaryRefs, photoLandmarks, triangles).pts,
    candidate,
    endpoints,
    candidateProjection: {
      ...candidateProjection,
      surfaceConstrained: useSurfaceSmoothedCandidate,
      sourceReasonCodes: sourceProjection.reasonCodes,
      smoothingMode: candidateType !== "fusiform"
        ? "notApplicable"
        : useSurfaceSmoothedCandidate
          ? fusiformRendering?.strategy === "segmented_c1" ? "segmentedBezier" : "globalBezier"
          : "sourceFallback",
      smoothingDiagnostics: fusiformFitAttempt?.diagnostics || null,
    },
    fusiformRendering: useSurfaceSmoothedCandidate ? fusiformRendering : null,
    projectedRstlDeviationDeg: projectedRstlDeviation(center, endpoints, rstl),
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
  let nearest: { distance: number; axis: [number, number] } | null = null;
  for (const line of rstl) {
    for (let index = 0; index < line.pts.length - 1; index += 1) {
      const first = line.pts[index], second = line.pts[index + 1];
      const axis: [number, number] = [second[0] - first[0], second[1] - first[1]];
      if (Math.hypot(...axis) <= 1e-6) continue;
      const axisLength2 = axis[0] ** 2 + axis[1] ** 2;
      const projection = Math.max(0, Math.min(1, (
        (origin[0] - first[0]) * axis[0] + (origin[1] - first[1]) * axis[1]
      ) / axisLength2));
      const nearestPoint = [first[0] + projection * axis[0], first[1] + projection * axis[1]];
      const distance = Math.hypot(nearestPoint[0] - origin[0], nearestPoint[1] - origin[1]);
      if (!nearest || distance < nearest.distance) nearest = { distance, axis };
    }
  }
  if (!nearest) return null;
  const cosine = Math.abs(candidateAxis[0] * nearest.axis[0] + candidateAxis[1] * nearest.axis[1])
    / (candidateLength * Math.hypot(...nearest.axis));
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
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
  const geometry = buildIncisionPhotoGeometry(input);
  const strokeWidths = incisionPhotoStrokeWidths(sourceWidth);
  const overlayStyle = incisionOverlayStyle(sourceWidth, input.candidateType, {
    displayScale: input.displayScale,
  });

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, sourceWidth, sourceHeight);
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const skinVisible = canvasForeheadSkinVisibility(context, sourceWidth, sourceHeight, input.landmarks);

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
