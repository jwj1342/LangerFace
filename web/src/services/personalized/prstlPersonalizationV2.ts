/**
 * Browser-ready RSTL personalization v2.
 *
 * Method:
 *   1. Build a photometrically robust neutral-face line consensus.
 *   2. Use repeated expressions only to validate neutral candidates.
 *   3. Convert candidate offsets around the original 132 curves into one
 *      smooth facial displacement field rather than moving points independently.
 *   4. Apply that field only inside a smooth, evidence-backed support envelope;
 *      unsupported and forbidden points remain exactly on the atlas prior.
 *   5. Reject scale levels that introduce curve kinks, folds, or intersections.
 *
 * This module has no DOM, camera, Node, or framework dependency. It can be
 * imported by the browser demo and by the offline JavaScript regression tests.
 */

import {
  axialDiffDeg, normalizeQ, staticTextureEvidence,
} from "./prstlPipeline.ts";

export const PERSONALIZATION_V2_VERSION = "prstl-consensus-localized-diffeomorphic-field-0.2.0";

type NumericField = ArrayLike<number>;
type Point2 = [number, number];

interface EvidenceField {
  q: NumericField;
  confidence: NumericField;
  ridge: NumericField;
  coh?: NumericField;
  deformation?: NumericField;
}

interface PersonalizationOptions {
  visibleConfidence?: number;
  visibleRidge?: number;
  repeatability?: number;
  temporalPersistence?: number;
  expressionAmplitudeQuality?: number;
  returnConsistency?: number;
  dynamicValidation?: NumericField | null;
  minEvidence?: number;
  distancePriorBase?: number;
  distancePriorUncertainty?: number;
  staticOnlyEvidence?: number;
  minDynamicValidation?: number;
  minRidge?: number;
  minDirectionFit?: number;
  minImprovement?: number;
  smoothness?: number;
  anchor?: number;
  boundaryAnchor?: number;
  iterations?: number;
  supportReferencePercentile?: number;
  supportFloorRatio?: number;
  supportFullRatio?: number;
  supportSmoothingPasses?: number;
  minimumAppliedSupport?: number;
  fullAppliedSupport?: number;
  displacementSmoothingPasses?: number;
  maxCurvatureChangeDeg?: number;
  maxDisplacementSecondDifferencePx?: number;
  gridSize?: number;
  minJacobian?: number;
}

interface DisplacementGrid {
  size: number;
  gridSize: number;
  step: number;
  targetX: Float32Array;
  targetY: Float32Array;
  dataWeight: Float32Array;
  u: Float32Array;
  v: Float32Array;
  supportReference: number;
  supportFloor: number;
  supportFull: number;
}

interface CurveSeed {
  name?: string;
  id?: string | number;
  pts?: Point2[];
}

interface EvidenceTarget {
  offset: number;
  vector: Point2;
  weight: number;
  accepted: boolean;
  blocked?: boolean;
  confidence?: number;
  ridge?: number;
  directionFit?: number;
  dynamicValidation?: number;
  improvement?: number;
}

interface CurveAudit {
  kind: string;
  evidence: number;
  target_offset_px: number;
  target_weight: number;
  support: number;
  final_offset_px: number;
  field_scale: number;
  curve_continuity_scale: number;
}

interface OptimizedCurve {
  name?: string;
  id?: string | number;
  pts: Point2[];
  priorPts: Point2[];
  kinds: string[];
  audit: CurveAudit[];
  optimizedOk: boolean;
  refinedFrac: number;
  meanEvidence: number;
  maxDirectionChangeDeg: number;
  maxCurvatureChangeDeg: number;
  maxDisplacementSecondDifferencePx: number;
  continuitySmoothingIterations: number;
  continuityScale: number;
  rollbackReason: string | null;
  topologyScale: number;
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

const clamp = (value: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, value));

function scalarAt(field: NumericField | null | undefined, x: number, y: number, size: number): number {
  if (!field) return 0;
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(y)));
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const tx = clamp(x - x0), ty = clamp(y - y0);
  const a = field[y0 * size + x0] || 0, b = field[y0 * size + x1] || 0;
  const c = field[y1 * size + x0] || 0, d = field[y1 * size + x1] || 0;
  return (1 - ty) * ((1 - tx) * a + tx * b) + ty * ((1 - tx) * c + tx * d);
}

function qAt(field: NumericField | null | undefined, x: number, y: number, size: number): Point2 {
  if (!field) return [0, 0];
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(y)));
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const tx = clamp(x - x0), ty = clamp(y - y0);
  let sx = 0, sy = 0;
  const samples: Array<[number, number, number]> = [
    [x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)],
    [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty],
  ];
  for (const [ix, iy, weight] of samples) {
    const index = iy * size + ix;
    sx += (field[index * 2] || 0) * weight;
    sy += (field[index * 2 + 1] || 0) * weight;
  }
  return normalizeQ([sx, sy]) as Point2;
}

/** Aggregate line orientation, ridge strength, and persistence across neutral frames. */
export function buildNeutralConsensusEvidence(
  frames: readonly NumericField[] | null | undefined,
  width: number,
  height: number,
  skin: NumericField | null | undefined,
  options: PersonalizationOptions = {},
) {
  const valid = (frames || []).filter((frame) => frame?.length === width * height);
  const n = width * height;
  const q = new Float32Array(n * 2);
  const confidence = new Float32Array(n);
  const ridge = new Float32Array(n);
  const orientationConsistency = new Float32Array(n);
  const persistence = new Float32Array(n);
  if (!valid.length) return { q, confidence, ridge, orientationConsistency, persistence, frameCount: 0 };

  const analyses = valid.map((frame) => staticTextureEvidence(frame, width, height, skin));
  const visibleConfidence = options.visibleConfidence ?? 0.30;
  const visibleRidge = options.visibleRidge ?? 0.07;
  for (let i = 0; i < n; i++) {
    if (skin && !skin[i]) continue;
    let mx = 0, my = 0, weight = 0, confidenceSum = 0, ridgeSum = 0, visible = 0;
    for (const analysis of analyses) {
      const c = clamp(analysis.confidence[i] || 0);
      const r = clamp(analysis.ridge[i] || 0);
      const w = c * (0.30 + 0.70 * r);
      mx += (analysis.q[i * 2] || 0) * w;
      my += (analysis.q[i * 2 + 1] || 0) * w;
      weight += w; confidenceSum += c; ridgeSum += r;
      if (c >= visibleConfidence && r >= visibleRidge) visible++;
    }
    const direction = normalizeQ([mx, my]);
    q[i * 2] = direction[0]; q[i * 2 + 1] = direction[1];
    const consistency = weight > 1e-8 ? clamp(Math.hypot(mx, my) / weight) : 0;
    const repeat = visible / analyses.length;
    const meanConfidence = confidenceSum / analyses.length;
    const meanRidge = ridgeSum / analyses.length;
    orientationConsistency[i] = consistency;
    persistence[i] = repeat;
    ridge[i] = clamp(meanRidge * consistency * (0.45 + 0.55 * repeat));
    const lineStrength = clamp((meanConfidence - 0.12) / 0.68);
    confidence[i] = clamp(
      lineStrength * consistency * consistency *
      (0.38 + 0.62 * repeat) * (0.35 + 0.65 * clamp(meanRidge * 2.2))
    );
  }
  return { q, confidence, ridge, orientationConsistency, persistence, frameCount: valid.length };
}

export function createDynamicValidationV2(length: number): Float32Array {
  return new Float32Array(length);
}

/** Expressions validate neutral candidates; they never contribute a new final direction. */
export function accumulateDynamicValidationV2(
  neutral: EvidenceField,
  action: EvidenceField,
  regionWeight: NumericField | null | undefined,
  state: Float32Array | null | undefined,
  options: PersonalizationOptions = {},
): Float32Array {
  const n = neutral.confidence.length;
  const validation = state?.length === n ? state : new Float32Array(n);
  const repeatability = clamp(options.repeatability ?? 0);
  const temporalPersistence = clamp(options.temporalPersistence ?? 0);
  const amplitudeQuality = clamp(options.expressionAmplitudeQuality ?? 0.7);
  const returnFactor = typeof options.returnConsistency === "number"
      && Number.isFinite(options.returnConsistency)
    ? 0.55 + 0.45 * clamp(options.returnConsistency)
    : 0.72; // Dataset mode: useful but explicitly capped without a real return sequence.
  for (let i = 0; i < n; i++) {
    const staticConfidence = clamp(neutral.confidence[i] || 0);
    const region = clamp(regionWeight?.[i] ?? 1);
    if (staticConfidence < 0.035 || region <= 0) continue;
    const dynamicQ = [action.q?.[i * 2] || 0, action.q?.[i * 2 + 1] || 0];
    const neutralQ = [neutral.q?.[i * 2] || 0, neutral.q?.[i * 2 + 1] || 0];
    if (!(dynamicQ[0] || dynamicQ[1]) || !(neutralQ[0] || neutralQ[1])) continue;
    const directionAgreement = Math.exp(-0.5 * (axialDiffDeg(dynamicQ, neutralQ) / 34) ** 2);
    const visibility = clamp(
      0.55 * Math.min(1, (action.coh?.[i] || 0) / 0.40) +
      0.45 * Math.min(1, (action.ridge?.[i] || 0) / 0.28)
    );
    const deformation = clamp(action.deformation?.[i] || 0);
    const observation = region * repeatability * temporalPersistence * amplitudeQuality *
      directionAgreement * (0.35 + 0.65 * visibility) *
      (0.42 + 0.58 * deformation) * returnFactor;
    if (observation <= 0.015) continue;
    validation[i] = 1 - (1 - validation[i]) * Math.exp(-0.72 * observation);
  }
  return validation;
}

export function finalizePersonalizationEvidenceV2(
  q0: NumericField | null | undefined,
  neutral: EvidenceField,
  dynamicValidation: NumericField | null | undefined,
  skin: NumericField | null | undefined,
) {
  const n = neutral.confidence.length;
  const q = new Float32Array(n * 2);
  const confidence = new Float32Array(n);
  const ridge = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (skin && !skin[i]) continue;
    const staticConfidence = clamp(neutral.confidence[i] || 0);
    const dynamic = clamp(dynamicValidation?.[i] || 0);
    confidence[i] = clamp(staticConfidence * (0.72 + 0.58 * dynamic));
    ridge[i] = clamp((neutral.ridge[i] || 0) * (0.82 + 0.38 * dynamic));
    const personal = [neutral.q[i * 2] || 0, neutral.q[i * 2 + 1] || 0];
    const prior = [q0?.[i * 2] || 0, q0?.[i * 2 + 1] || 0];
    const directionWeight = clamp(0.22 + 0.70 * confidence[i]);
    const mixed = (personal[0] || personal[1])
      ? normalizeQ([(1 - directionWeight) * prior[0] + directionWeight * personal[0],
        (1 - directionWeight) * prior[1] + directionWeight * personal[1]])
      : prior;
    q[i * 2] = mixed[0]; q[i * 2 + 1] = mixed[1];
  }
  return { q, confidence, ridge, dynamicValidation };
}

function tangentAt(points: Point2[], index: number): Point2 {
  const before = points[Math.max(0, index - 1)], after = points[Math.min(points.length - 1, index + 1)];
  const length = Math.hypot(after[0] - before[0], after[1] - before[1]) || 1;
  return [(after[0] - before[0]) / length, (after[1] - before[1]) / length];
}

function huber(value: number): number {
  const absolute = Math.abs(value);
  return absolute <= 1 ? 0.5 * absolute * absolute : absolute - 0.5;
}

function scanAnatomicalDistance(
  point: Point2,
  normal: Point2,
  sign: number,
  skin: NumericField,
  forbidden: NumericField | null | undefined,
  size: number,
): number {
  let last = 0;
  for (let distance = 0.75; distance <= size * Math.SQRT2; distance += 0.75) {
    const x = point[0] + sign * normal[0] * distance;
    const y = point[1] + sign * normal[1] * distance;
    if (x < 0 || y < 0 || x >= size || y >= size) break;
    const index = Math.round(y) * size + Math.round(x);
    if (!skin[index] || forbidden?.[index]) break;
    last = distance;
  }
  return last;
}

function findEvidenceTarget(
  point: Point2,
  tangent: Point2,
  fields: EvidenceField,
  skin: NumericField,
  forbidden: NumericField | null | undefined,
  size: number,
  scale: number,
  options: PersonalizationOptions,
): EvidenceTarget {
  const normal: Point2 = [-tangent[1], tangent[0]];
  const negative = scanAnatomicalDistance(point, normal, -1, skin, forbidden, size);
  const positive = scanAnatomicalDistance(point, normal, 1, skin, forbidden, size);
  const priorQ = normalizeQ([tangent[0] * tangent[0] - tangent[1] * tangent[1], 2 * tangent[0] * tangent[1]]);
  const minEvidence = options.minEvidence ?? 0.07;
  const scoreAt = (distance: number) => {
    const x = point[0] + normal[0] * distance, y = point[1] + normal[1] * distance;
    const confidence = scalarAt(fields.confidence, x, y, size);
    const ridge = scalarAt(fields.ridge, x, y, size);
    const dynamicValidation = scalarAt(options.dynamicValidation, x, y, size);
    const observedQ = qAt(fields.q, x, y, size);
    const directionFit = (observedQ[0] || observedQ[1])
      ? Math.exp(-0.5 * (axialDiffDeg(observedQ, priorQ) / 52) ** 2) : 0;
    const support = confidence * (0.30 + 0.70 * ridge) * (0.42 + 0.58 * directionFit) *
      (0.70 + 0.30 * dynamicValidation);
    const normalizedOffset = Math.abs(distance) / Math.max(1.5, scale);
    // This is deliberately a soft statistical prior, not a pixel cap. A far
    // target may still win, but only when its evidence gain grows accordingly.
    const distancePriorBase = options.distancePriorBase ?? 0.060;
    const distancePriorUncertainty = options.distancePriorUncertainty ?? 0.180;
    const softPrior = (distancePriorBase + distancePriorUncertainty * (1 - confidence)) * huber(normalizedOffset);
    return { score: support - softPrior, confidence, ridge, directionFit, dynamicValidation, support };
  };
  let bestDistance = 0, best = scoreAt(0);
  const origin = best;
  for (let distance = -negative; distance <= positive + 1e-6; distance += 0.75) {
    const candidate = scoreAt(distance);
    if (candidate.score > best.score) { best = candidate; bestDistance = distance; }
  }
  const improvement = best.score - origin.score;
  const sourceValidated = best.confidence >= (options.staticOnlyEvidence ?? 0.45) ||
    best.dynamicValidation >= (options.minDynamicValidation ?? 0.08);
  const accepted = best.confidence >= minEvidence && best.ridge >= (options.minRidge ?? 0.07) &&
    best.directionFit >= (options.minDirectionFit ?? 0.28) && sourceValidated &&
    improvement >= (options.minImprovement ?? 0.008);
  const weight = accepted
    ? clamp((best.confidence - minEvidence) / Math.max(1e-6, 1 - minEvidence)) *
      (0.35 + 0.65 * best.ridge) * (0.45 + 0.55 * best.directionFit) *
      clamp(improvement / 0.12)
    : 0;
  return {
    offset: accepted ? bestDistance : 0,
    vector: accepted
      ? [normal[0] * bestDistance, normal[1] * bestDistance] as Point2
      : [0, 0] as Point2,
    weight, accepted, confidence: best.confidence, ridge: best.ridge,
    directionFit: best.directionFit, dynamicValidation: best.dynamicValidation, improvement,
  };
}

function createGrid(size: number, gridSize: number): DisplacementGrid {
  const count = gridSize * gridSize;
  return {
    size, gridSize, step: (size - 1) / (gridSize - 1),
    targetX: new Float32Array(count), targetY: new Float32Array(count),
    dataWeight: new Float32Array(count), u: new Float32Array(count), v: new Float32Array(count),
    supportReference: 0, supportFloor: 0, supportFull: 0,
  };
}

function pointMaskIndex(point: Point2, size: number): number {
  const x = Math.max(0, Math.min(size - 1, Math.round(point[0])));
  const y = Math.max(0, Math.min(size - 1, Math.round(point[1])));
  return y * size + x;
}

function pointIsBlocked(
  point: Point2,
  skin: NumericField | null | undefined,
  forbidden: NumericField | null | undefined,
  size: number,
): boolean {
  if (point[0] < 0 || point[1] < 0 || point[0] >= size || point[1] >= size) return true;
  const index = pointMaskIndex(point, size);
  return !!((skin && !skin[index]) || forbidden?.[index]);
}

function splatConstraint(grid: DisplacementGrid, point: Point2, vector: Point2, weight: number): void {
  if (!(weight > 0)) return;
  const gx = point[0] / grid.step, gy = point[1] / grid.step;
  const radius = 1.65, sigma2 = 0.72 * 0.72;
  const minX = Math.max(0, Math.floor(gx - radius)), maxX = Math.min(grid.gridSize - 1, Math.ceil(gx + radius));
  const minY = Math.max(0, Math.floor(gy - radius)), maxY = Math.min(grid.gridSize - 1, Math.ceil(gy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const distance2 = (x - gx) ** 2 + (y - gy) ** 2;
      const w = weight * Math.exp(-0.5 * distance2 / sigma2);
      const index = y * grid.gridSize + x;
      grid.dataWeight[index] += w;
      grid.targetX[index] += w * vector[0];
      grid.targetY[index] += w * vector[1];
    }
  }
}

function solveGrid(grid: DisplacementGrid, options: PersonalizationOptions = {}) {
  const smoothness = options.smoothness ?? 2.4;
  const anchor = options.anchor ?? 0.10;
  const boundaryAnchor = options.boundaryAnchor ?? 4.0;
  const iterations = options.iterations ?? 220;
  const count = grid.gridSize * grid.gridSize;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const nextU = grid.u.slice(), nextV = grid.v.slice();
    for (let y = 0; y < grid.gridSize; y++) {
      for (let x = 0; x < grid.gridSize; x++) {
        const index = y * grid.gridSize + x;
        let sumU = 0, sumV = 0, neighbours = 0;
        const neighbours4: Point2[] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dx, dy] of neighbours4) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= grid.gridSize || yy >= grid.gridSize) continue;
          const neighbour = yy * grid.gridSize + xx;
          sumU += grid.u[neighbour]; sumV += grid.v[neighbour]; neighbours++;
        }
        const edge = x === 0 || y === 0 || x === grid.gridSize - 1 || y === grid.gridSize - 1;
        const anchorWeight = anchor + (edge ? boundaryAnchor : 0);
        const denominator = grid.dataWeight[index] + smoothness * neighbours + anchorWeight;
        nextU[index] = (grid.targetX[index] + smoothness * sumU) / Math.max(1e-6, denominator);
        nextV[index] = (grid.targetY[index] + smoothness * sumV) / Math.max(1e-6, denominator);
      }
    }
    grid.u = nextU; grid.v = nextV;
  }
  let supportedControls = 0, constraintWeight = 0;
  for (let i = 0; i < count; i++) {
    if (grid.dataWeight[i] > 0.02) supportedControls++;
    constraintWeight += grid.dataWeight[i];
  }
  return { supportedControls, constraintWeight };
}

function gridScalarAt(grid: DisplacementGrid, field: NumericField, point: Point2): number {
  const gx = clamp(point[0] / grid.step, 0, grid.gridSize - 1);
  const gy = clamp(point[1] / grid.step, 0, grid.gridSize - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(grid.gridSize - 1, x0 + 1), y1 = Math.min(grid.gridSize - 1, y0 + 1);
  const tx = gx - x0, ty = gy - y0;
  return (1 - ty) * ((1 - tx) * field[y0 * grid.gridSize + x0] + tx * field[y0 * grid.gridSize + x1]) +
    ty * ((1 - tx) * field[y1 * grid.gridSize + x0] + tx * field[y1 * grid.gridSize + x1]);
}

function positivePercentile(values: NumericField | null | undefined, percentile: number): number {
  const positive = Array.from(values || []).filter((value) => value > 1e-8).sort((a, b) => a - b);
  if (!positive.length) return 0;
  const position = clamp(percentile, 0, 1) * (positive.length - 1);
  const lower = Math.floor(position), upper = Math.ceil(position), fraction = position - lower;
  return positive[lower] * (1 - fraction) + positive[upper] * fraction;
}

function calibrateConstraintSupport(grid: DisplacementGrid, options: PersonalizationOptions = {}) {
  const reference = positivePercentile(grid.dataWeight, options.supportReferencePercentile ?? 0.60);
  const floorRatio = options.supportFloorRatio ?? 0.035;
  const fullRatio = Math.max(floorRatio + 0.02, options.supportFullRatio ?? 0.30);
  grid.supportReference = reference;
  grid.supportFloor = reference * floorRatio;
  grid.supportFull = reference * fullRatio;
  return { reference, floor: grid.supportFloor, full: grid.supportFull };
}

function constraintSupportAt(grid: DisplacementGrid, point: Point2): number {
  if (!(grid.supportReference > 0)) return 0;
  const weight = gridScalarAt(grid, grid.dataWeight, point);
  const normalized = clamp((weight - grid.supportFloor) /
    Math.max(1e-8, grid.supportFull - grid.supportFloor));
  return normalized * normalized * (3 - 2 * normalized);
}

function displacementAt(grid: DisplacementGrid, point: Point2, scale = 1): Point2 {
  return [scale * gridScalarAt(grid, grid.u, point), scale * gridScalarAt(grid, grid.v, point)];
}

function jacobianStats(grid: DisplacementGrid, scale: number) {
  let min = Infinity, sum = 0, count = 0, folds = 0;
  for (let y = 0; y < grid.gridSize - 1; y++) {
    for (let x = 0; x < grid.gridSize - 1; x++) {
      const i = y * grid.gridSize + x, ix = i + 1, iy = i + grid.gridSize;
      const ixy = iy + 1;
      // A bilinear cell can be valid at its lower-left corner and still fold
      // elsewhere. Evaluate the analytic derivative at all corners and centre.
      const samples: Point2[] = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]];
      for (const [tx, ty] of samples) {
        const duDx = scale * ((1 - ty) * (grid.u[ix] - grid.u[i]) +
          ty * (grid.u[ixy] - grid.u[iy])) / grid.step;
        const duDy = scale * ((1 - tx) * (grid.u[iy] - grid.u[i]) +
          tx * (grid.u[ixy] - grid.u[ix])) / grid.step;
        const dvDx = scale * ((1 - ty) * (grid.v[ix] - grid.v[i]) +
          ty * (grid.v[ixy] - grid.v[iy])) / grid.step;
        const dvDy = scale * ((1 - tx) * (grid.v[iy] - grid.v[i]) +
          tx * (grid.v[ixy] - grid.v[ix])) / grid.step;
        const determinant = (1 + duDx) * (1 + dvDy) - duDy * dvDx;
        min = Math.min(min, determinant); sum += determinant; count++;
        if (determinant <= 0) folds++;
      }
    }
  }
  return { min: count ? min : 1, mean: count ? sum / count : 1, folds };
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a), o4 = orientation(c, d, b);
  const eps = 1e-6;
  return o1 * o2 < -eps && o3 * o4 < -eps;
}

function bbox(points: Point2[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
  }
  return { minX, minY, maxX, maxY };
}

function boxesOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function polylinesCross(first: Point2[], second: Point2[]): boolean {
  for (let i = 0; i < first.length - 1; i++) {
    const a = first[i], b = first[i + 1];
    const ab = { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
    for (let j = 0; j < second.length - 1; j++) {
      const c = second[j], d = second[j + 1];
      const cd = { minX: Math.min(c[0], d[0]), minY: Math.min(c[1], d[1]), maxX: Math.max(c[0], d[0]), maxY: Math.max(c[1], d[1]) };
      if (boxesOverlap(ab, cd) && segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

function intersectionPairs(curves: Point2[][]): Set<string> {
  const boxes = curves.map((curve) => bbox(curve));
  const pairs = new Set<string>();
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      if (!boxesOverlap(boxes[i], boxes[j])) continue;
      if (polylinesCross(curves[i], curves[j])) pairs.add(`${i}:${j}`);
    }
  }
  return pairs;
}

function turnAngle(points: Point2[], index: number): number {
  if (index <= 0 || index >= points.length - 1) return 0;
  const a = points[index - 1], b = points[index], c = points[index + 1];
  return Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]),
    (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]));
}

function angularDifferenceDegrees(a: number, b: number): number {
  let difference = a - b;
  while (difference > Math.PI) difference -= 2 * Math.PI;
  while (difference < -Math.PI) difference += 2 * Math.PI;
  return Math.abs(difference) * 180 / Math.PI;
}

function smoothScalarAlongCurve(values: number[], blocked: boolean[], passes: number): number[] {
  let current = values.slice();
  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice();
    for (let index = 0; index < current.length; index++) {
      if (blocked[index]) { next[index] = 0; continue; }
      let sum = 2 * current[index], weight = 2;
      if (index > 0) { sum += blocked[index - 1] ? 0 : current[index - 1]; weight++; }
      if (index + 1 < current.length) { sum += blocked[index + 1] ? 0 : current[index + 1]; weight++; }
      next[index] = sum / weight;
    }
    current = next;
  }
  return current;
}

function smoothDisplacementAlongCurve(
  displacements: Point2[],
  support: number[],
  blocked: boolean[],
  passes: number,
): Point2[] {
  let current: Point2[] = displacements.map((value) => [...value]);
  for (let pass = 0; pass < passes; pass++) {
    const next: Point2[] = current.map((value) => [...value]);
    for (let index = 0; index < current.length; index++) {
      // Keep the application threshold identical to the audit threshold. A
      // smoothing tail below 0.01 is not evidence-backed propagation and must
      // remain exactly on the atlas prior instead of failing the whole result.
      if (blocked[index] || support[index] <= 0.01) { next[index] = [0, 0]; continue; }
      let sx = 2 * current[index][0], sy = 2 * current[index][1], weight = 2;
      for (const neighbour of [index - 1, index + 1]) {
        if (neighbour < 0 || neighbour >= current.length) continue;
        sx += blocked[neighbour] ? 0 : current[neighbour][0];
        sy += blocked[neighbour] ? 0 : current[neighbour][1];
        weight++;
      }
      next[index] = [sx / weight, sy / weight];
    }
    current = next;
  }
  return current;
}

function measureCurveContinuity(priorPts: Point2[], displacements: Point2[]) {
  const pts: Point2[] = priorPts.map((point, index) => [
    point[0] + displacements[index][0], point[1] + displacements[index][1],
  ]);
  let maxCurvatureChangeDeg = 0, maxDisplacementSecondDifferencePx = 0;
  for (let index = 1; index < pts.length - 1; index++) {
    maxCurvatureChangeDeg = Math.max(maxCurvatureChangeDeg,
      angularDifferenceDegrees(turnAngle(pts, index), turnAngle(priorPts, index)));
    const secondX = displacements[index - 1][0] - 2 * displacements[index][0] + displacements[index + 1][0];
    const secondY = displacements[index - 1][1] - 2 * displacements[index][1] + displacements[index + 1][1];
    maxDisplacementSecondDifferencePx = Math.max(
      maxDisplacementSecondDifferencePx, Math.hypot(secondX, secondY),
    );
  }
  return { pts, maxCurvatureChangeDeg, maxDisplacementSecondDifferencePx };
}

function buildCurves(
  seeds: CurveSeed[],
  grid: DisplacementGrid,
  scale: number,
  fields: EvidenceField,
  skin: NumericField,
  forbidden: NumericField | null | undefined,
  size: number,
  targets: EvidenceTarget[][],
  options: PersonalizationOptions = {},
): OptimizedCurve[] {
  return seeds.map((seed, curveIndex) => {
    const priorPts: Point2[] = (seed.pts || []).map((point) => [point[0], point[1]]);
    const blocked = priorPts.map((point) => pointIsBlocked(point, skin, forbidden, size));
    let support = priorPts.map((point, index) => blocked[index] ? 0 : constraintSupportAt(grid, point));
    support = smoothScalarAlongCurve(support, blocked, options.supportSmoothingPasses ?? 4);
    const minimumSupport = options.minimumAppliedSupport ?? 0.035;
    const fullSupport = Math.max(minimumSupport + 0.02, options.fullAppliedSupport ?? 0.28);
    support = support.map((value, index) => {
      if (blocked[index] || value <= minimumSupport) return 0;
      const normalized = clamp((value - minimumSupport) / (fullSupport - minimumSupport));
      return normalized * normalized * (3 - 2 * normalized);
    });
    let displacements: Point2[] = priorPts.map((point, index) => {
      if (blocked[index] || support[index] <= 0) return [0, 0];
      const displacement = displacementAt(grid, point, scale);
      return [displacement[0] * support[index], displacement[1] * support[index]];
    });
    displacements = smoothDisplacementAlongCurve(
      displacements, support, blocked, options.displacementSmoothingPasses ?? 3,
    );
    const curvatureLimit = options.maxCurvatureChangeDeg ?? 22;
    const secondDifferenceLimit = options.maxDisplacementSecondDifferencePx ?? 0.85;
    let continuity = measureCurveContinuity(priorPts, displacements);
    let continuitySmoothingIterations = 0;
    while ((continuity.maxCurvatureChangeDeg > curvatureLimit ||
            continuity.maxDisplacementSecondDifferencePx > secondDifferenceLimit) &&
           continuitySmoothingIterations < 6) {
      displacements = smoothDisplacementAlongCurve(displacements, support, blocked, 1);
      continuity = measureCurveContinuity(priorPts, displacements);
      continuitySmoothingIterations++;
    }
    let continuityScale = 1;
    while ((continuity.maxCurvatureChangeDeg > curvatureLimit ||
            continuity.maxDisplacementSecondDifferencePx > secondDifferenceLimit) &&
           continuityScale > 0.01) {
      continuityScale *= 0.84;
      displacements = displacements.map((value) => [value[0] * 0.84, value[1] * 0.84]);
      continuity = measureCurveContinuity(priorPts, displacements);
    }
    const pts = continuity.pts;
    let evidenceSum = 0, maxDirectionChangeDeg = 0;
    const maxCurvatureChangeDeg = continuity.maxCurvatureChangeDeg;
    const maxDisplacementSecondDifferencePx = continuity.maxDisplacementSecondDifferencePx;
    let directlySupported = 0;
    const kinds: string[] = [], audit: CurveAudit[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prior = priorPts[i], point = pts[i];
      const offset = Math.hypot(point[0] - prior[0], point[1] - prior[1]);
      const localEvidence = scalarAt(fields.confidence, prior[0], prior[1], size);
      const direct = !!targets[curveIndex]?.[i]?.accepted;
      if (direct) directlySupported++;
      evidenceSum += localEvidence;
      kinds.push(blocked[i] ? "occluded" : offset > 0.05 ? (direct ? "refined" : "propagated") : "prior");
      audit.push({
        kind: kinds[i], evidence: localEvidence,
        target_offset_px: targets[curveIndex]?.[i]?.offset || 0,
        target_weight: targets[curveIndex]?.[i]?.weight || 0,
        support: support[i], final_offset_px: offset, field_scale: scale,
        curve_continuity_scale: continuityScale,
      });
      if (i < pts.length - 1) {
        const priorAngle = Math.atan2(priorPts[i + 1][1] - prior[1], priorPts[i + 1][0] - prior[0]);
        const finalAngle = Math.atan2(pts[i + 1][1] - point[1], pts[i + 1][0] - point[0]);
        maxDirectionChangeDeg = Math.max(maxDirectionChangeDeg, angularDifferenceDegrees(finalAngle, priorAngle));
      }
    }
    const moved = audit.filter((item) => item.final_offset_px > 0.05).length;
    return {
      name: seed.name, id: seed.id, pts, priorPts, kinds, audit,
      optimizedOk: moved > 0, refinedFrac: pts.length ? directlySupported / pts.length : 0,
      meanEvidence: pts.length ? evidenceSum / pts.length : 0,
      maxDirectionChangeDeg, maxCurvatureChangeDeg, maxDisplacementSecondDifferencePx,
      continuitySmoothingIterations, continuityScale,
      rollbackReason: null, topologyScale: scale,
    };
  });
}

function curveContinuityStats(curves: OptimizedCurve[]) {
  let maxCurvatureChangeDeg = 0, maxDisplacementSecondDifferencePx = 0;
  for (const curve of curves) {
    maxCurvatureChangeDeg = Math.max(maxCurvatureChangeDeg, curve.maxCurvatureChangeDeg || 0);
    maxDisplacementSecondDifferencePx = Math.max(
      maxDisplacementSecondDifferencePx, curve.maxDisplacementSecondDifferencePx || 0,
    );
  }
  return { maxCurvatureChangeDeg, maxDisplacementSecondDifferencePx };
}

export function smoothProjectedCurveV2(points: Point2[] | null | undefined, passes = 2): Point2[] {
  let current: Point2[] = (points || []).map((point) => [point[0], point[1]]);
  if (current.length < 3) return current;
  for (let pass = 0; pass < Math.max(0, passes); pass++) {
    const next: Point2[] = current.map((point) => [...point]);
    for (let index = 1; index < current.length - 1; index++) {
      next[index][0] = 0.20 * current[index - 1][0] + 0.60 * current[index][0] + 0.20 * current[index + 1][0];
      next[index][1] = 0.20 * current[index - 1][1] + 0.60 * current[index][1] + 0.20 * current[index + 1][1];
    }
    current = next;
  }
  return current;
}

/**
 * Fit one smooth displacement field from evidence around all original curves.
 * There is no fixed displacement cap; the hard constraints are the skin domain,
 * positive field Jacobian, and preservation of the atlas' existing topology.
 */
export function optimizeCurvesWithFieldV2(
  fieldQ: NumericField,
  fieldC: NumericField,
  ridge: NumericField,
  q0: NumericField | null | undefined,
  seeds: CurveSeed[],
  skin: NumericField,
  forbidden: NumericField | null | undefined,
  size: number,
  options: PersonalizationOptions = {},
) {
  const fields = { q: fieldQ, confidence: fieldC, ridge };
  const grid = createGrid(size, options.gridSize ?? 17);
  const allX = seeds.flatMap((seed) => (seed.pts || []).map((point) => point[0]));
  const faceWidth = allX.length ? Math.max(...allX) - Math.min(...allX) : size;
  const targets: EvidenceTarget[][] = [];
  let acceptedTargets = 0, targetWeight = 0, targetOffsetSum = 0, maxTargetOffset = 0;
  for (const seed of seeds) {
    const points = seed.pts || [], curveTargets: EvidenceTarget[] = [];
    const sampleStride = Math.max(1, Math.floor(points.length / 28));
    for (let index = 0; index < points.length; index++) {
      const point = points[index], tangent = tangentAt(points, index);
      const localScale = Math.max(2.0, faceWidth * 0.018);
      const target = pointIsBlocked(point, skin, forbidden, size)
        ? { offset: 0, vector: [0, 0] as Point2, weight: 0, accepted: false, blocked: true }
        : findEvidenceTarget(point, tangent, fields, skin, forbidden, size, localScale, options);
      curveTargets.push(target);
      if (target.accepted && index % sampleStride === 0) {
        splatConstraint(grid, point, target.vector, target.weight);
        acceptedTargets++; targetWeight += target.weight;
        targetOffsetSum += Math.abs(target.offset); maxTargetOffset = Math.max(maxTargetOffset, Math.abs(target.offset));
      }
    }
    targets.push(curveTargets);
  }
  const supportCalibration = calibrateConstraintSupport(grid, options);
  const gridFit = solveGrid(grid, options);
  const baselinePoints: Point2[][] = seeds.map((seed) => (
    seed.pts || []).map((point) => [point[0], point[1]]));
  const baselineIntersections = intersectionPairs(baselinePoints);
  const minJacobian = options.minJacobian ?? 0.35;
  const maxCurvatureChangeDeg = options.maxCurvatureChangeDeg ?? 22;
  const maxDisplacementSecondDifferencePx = options.maxDisplacementSecondDifferencePx ?? 0.85;
  let scale = 1, topologyIterations = 0;
  let candidateCurves: OptimizedCurve[] | null = null;
  let newIntersections = new Set<string>();
  let continuity = { maxCurvatureChangeDeg: 0, maxDisplacementSecondDifferencePx: 0 };
  while (topologyIterations < 28) {
    const jacobian = jacobianStats(grid, scale);
    candidateCurves = buildCurves(seeds, grid, scale, fields, skin, forbidden, size, targets, options);
    const finalPairs = intersectionPairs(candidateCurves.map((curve) => curve.pts));
    newIntersections = new Set([...finalPairs].filter((pair) => !baselineIntersections.has(pair)));
    continuity = curveContinuityStats(candidateCurves);
    if (jacobian.min >= minJacobian && jacobian.folds === 0 && newIntersections.size === 0) break;
    scale *= 0.84;
    topologyIterations++;
  }
  const jacobian = jacobianStats(grid, scale);
  const curves = candidateCurves || buildCurves(seeds, grid, scale, fields, skin, forbidden, size, targets, options);
  continuity = curveContinuityStats(curves);
  let points = 0, movedPoints = 0, directlySupportedMovedPoints = 0;
  let propagatedMovedPoints = 0, unsupportedMovedPoints = 0, occludedMovedPoints = 0, movedOffsetSum = 0;
  for (const curve of curves) {
    for (const item of curve.audit || []) {
      points++;
      if ((item.final_offset_px || 0) <= 0.05) continue;
      movedPoints++; movedOffsetSum += item.final_offset_px;
      if (item.kind === "refined") directlySupportedMovedPoints++;
      else if (item.kind === "propagated") propagatedMovedPoints++;
      else if (item.kind === "occluded") occludedMovedPoints++;
      if ((item.support || 0) <= 0.01) unsupportedMovedPoints++;
    }
  }
  return {
    curves,
    diagnostics: {
      version: PERSONALIZATION_V2_VERSION,
      grid_size: grid.gridSize,
      accepted_targets: acceptedTargets,
      mean_target_offset_px: acceptedTargets ? targetOffsetSum / acceptedTargets : 0,
      max_target_offset_px: maxTargetOffset,
      target_weight: targetWeight,
      supported_controls: gridFit.supportedControls,
      constraint_weight: gridFit.constraintWeight,
      support_reference: supportCalibration.reference,
      support_floor: supportCalibration.floor,
      support_full: supportCalibration.full,
      field_scale: scale,
      topology_iterations: topologyIterations,
      baseline_intersection_pairs: baselineIntersections.size,
      new_intersection_pairs: newIntersections.size,
      jacobian,
      continuity: {
        max_curvature_change_deg: continuity.maxCurvatureChangeDeg,
        max_displacement_second_difference_px: continuity.maxDisplacementSecondDifferencePx,
        curvature_limit_deg: maxCurvatureChangeDeg,
        second_difference_limit_px: maxDisplacementSecondDifferencePx,
      },
      points,
      moved_points: movedPoints,
      moved_fraction: points ? movedPoints / points : 0,
      mean_moved_offset_px: movedPoints ? movedOffsetSum / movedPoints : 0,
      directly_supported_moved_points: directlySupportedMovedPoints,
      propagated_moved_points: propagatedMovedPoints,
      unsupported_moved_points: unsupportedMovedPoints,
      unsupported_moved_fraction: movedPoints ? unsupportedMovedPoints / movedPoints : 0,
      occluded_moved_points: occludedMovedPoints,
    },
  };
}
