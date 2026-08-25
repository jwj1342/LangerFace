export const DIRECT_NOSE_DORSUM_RSTL_ALGORITHM =
  "direct-nose-dorsum-wrinkle-rstl-generation-1.0";

export const DIRECT_NOSE_DORSUM_RSTL_REGION =
  "personalized_nose_dorsum_wrinkle_v1";

export const DIRECT_NOSE_DORSUM_FINE_LINE_IDS = Object.freeze([
  "paired-edge-v10-022",
  "paired-edge-v10-023",
  "paired-edge-v10-024",
]);

type Point2 = [number, number];

export interface NoseDorsumFineLine {
  id?: string;
  points?: unknown;
}

export interface ExistingRstlCurve {
  name?: unknown;
  pts?: unknown;
}

export interface DirectNoseDorsumCurve {
  name: string;
  region: typeof DIRECT_NOSE_DORSUM_RSTL_REGION;
  sourceFineLineId: string;
  generatedFromWrinkle: true;
  pts: Point2[];
  priorPts: Point2[];
  normalOffsetsPx: number[];
  affectedIntervals: number[][];
  rollbackReason: null;
}

export interface DirectNoseDorsumResult {
  curves: DirectNoseDorsumCurve[];
  diagnostics: Record<string, unknown>;
}

const EPSILON = 1e-8;

function finitePoint(value: unknown): value is Point2 {
  return Array.isArray(value) && value.length >= 2 &&
    Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function normalizePoints(value: unknown): Point2[] {
  return Array.isArray(value) ? value.filter(finitePoint)
    .map((point) => [Number(point[0]), Number(point[1])]) : [];
}

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1,
    Math.floor(Math.max(0, Math.min(1, fraction)) * (sorted.length - 1)))];
}

function gaussianSmooth(points: readonly Point2[], sigma: number): Point2[] {
  const radius = Math.ceil(3 * sigma);
  return points.map((_, index) => {
    let x = 0, y = 0, weightSum = 0;
    for (let neighbor = Math.max(0, index - radius);
      neighbor <= Math.min(points.length - 1, index + radius); neighbor += 1) {
      const normalized = (neighbor - index) / sigma;
      const weight = Math.exp(-0.5 * normalized * normalized);
      x += weight * points[neighbor][0];
      y += weight * points[neighbor][1];
      weightSum += weight;
    }
    return [x / weightSum, y / weightSum];
  });
}

function maximumTurnDegrees(points: readonly Point2[]): number {
  let maximum = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1], current = points[index], next = points[index + 1];
    const ax = current[0] - previous[0], ay = current[1] - previous[1];
    const bx = next[0] - current[0], by = next[1] - current[1];
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (denominator <= EPSILON) continue;
    const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator));
    maximum = Math.max(maximum, Math.acos(cosine) * 180 / Math.PI);
  }
  return maximum;
}

function pointSegmentDistance(point: Point2, start: Point2, end: Point2): number {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const squared = dx * dx + dy * dy;
  const t = squared > EPSILON ? Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / squared)) : 0;
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function pointPolylineDistance(point: Point2, polyline: readonly Point2[]): number {
  let minimum = Infinity;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    minimum = Math.min(minimum, pointSegmentDistance(point, polyline[index], polyline[index + 1]));
  }
  return minimum;
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1;
    index < polygon.length; previous = index++) {
    const current = polygon[index], prior = polygon[previous];
    const crosses = (current[1] > point[1]) !== (prior[1] > point[1]);
    if (crosses && point[0] < (prior[0] - current[0]) *
      (point[1] - current[1]) / (prior[1] - current[1]) + current[0]) inside = !inside;
  }
  return inside;
}

function pointPolygonDistance(point: Point2, polygon: readonly Point2[]): number {
  if (polygon.length < 3) return Infinity;
  if (pointInPolygon(point, polygon)) return 0;
  let minimum = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    minimum = Math.min(minimum, pointSegmentDistance(
      point, polygon[index], polygon[(index + 1) % polygon.length],
    ));
  }
  return minimum;
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  return Math.abs(orientation(start, end, point)) <= EPSILON &&
    point[0] >= Math.min(start[0], end[0]) - EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + EPSILON;
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  const proper = ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON));
  return proper || pointOnSegment(c, a, b) || pointOnSegment(d, a, b) ||
    pointOnSegment(a, c, d) || pointOnSegment(b, c, d);
}

function polylineIntersectionCount(
  left: readonly Point2[], right: readonly Point2[], sameCurve = false,
): number {
  let count = 0;
  for (let leftIndex = 0; leftIndex < left.length - 1; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length - 1; rightIndex += 1) {
      if (sameCurve && Math.abs(leftIndex - rightIndex) <= 1) continue;
      if (segmentsIntersect(
        left[leftIndex], left[leftIndex + 1], right[rightIndex], right[rightIndex + 1],
      )) count += 1;
    }
  }
  return count;
}

export function buildDirectNoseDorsumRstl({
  fineLines,
  faceWidthPx,
  eyePolygons = [],
  existingCurves = [],
  maximumTurnLimitDegrees = 8,
  auditExistingCurveIntersections = false,
}: {
  fineLines: readonly NoseDorsumFineLine[];
  faceWidthPx: number;
  eyePolygons?: readonly (readonly Point2[])[];
  existingCurves?: readonly ExistingRstlCurve[];
  maximumTurnLimitDegrees?: number;
  auditExistingCurveIntersections?: boolean;
}): DirectNoseDorsumResult {
  if (!(faceWidthPx > 0)) throw new Error("faceWidthPx must be positive");
  const byId = new Map(fineLines.map((line) => [String(line.id || ""), line]));
  const selected = DIRECT_NOSE_DORSUM_FINE_LINE_IDS.map((id) => {
    const source = byId.get(id);
    const points = normalizePoints(source?.points);
    if (points.length < 8) throw new Error(`missing valid nose-dorsum fine line ${id}`);
    return { id, points };
  }).sort((left, right) => {
    const meanY = (points: readonly Point2[]) =>
      points.reduce((sum, point) => sum + point[1], 0) / points.length;
    return meanY(left.points) - meanY(right.points);
  });

  const minimumEyeClearancePx = Math.max(3, faceWidthPx * 0.006);
  const maximumMeanAdherencePx = Math.max(0.75, faceWidthPx * 0.002);
  const records: Record<string, unknown>[] = [];
  const curves = selected.map((line, orderedIndex): DirectNoseDorsumCurve => {
    let points: Point2[] | null = null;
    let selectedSigma = 0;
    for (const sigma of [2.5, 2.75, 3, 3.25, 3.5, 4, 4.5]) {
      const candidate = gaussianSmooth(line.points, sigma);
      if (maximumTurnDegrees(candidate) <= maximumTurnLimitDegrees + EPSILON) {
        points = candidate;
        selectedSigma = sigma;
        break;
      }
    }
    if (!points) throw new Error(`${line.id} cannot satisfy the smooth-turn gate`);

    const adherence = points.map((point) => pointPolylineDistance(point, line.points));
    const meanAdherence = adherence.reduce((sum, value) => sum + value, 0) / adherence.length;
    const p90Adherence = percentile(adherence, 0.90);
    const turn = maximumTurnDegrees(points);
    const eyeClearance = eyePolygons.length ? Math.min(...points.flatMap((point) =>
      eyePolygons.map((polygon) => pointPolygonDistance(point, polygon)))) : Infinity;
    if (meanAdherence > maximumMeanAdherencePx) {
      throw new Error(`${line.id} exceeds the direct-wrinkle adherence gate`);
    }
    if (eyeClearance < minimumEyeClearancePx) {
      throw new Error(`${line.id} enters the eye safety exclusion zone`);
    }
    const selfIntersections = polylineIntersectionCount(points, points, true);
    if (selfIntersections !== 0) throw new Error(`${line.id} self-intersects after smoothing`);
    records.push({
      source_fine_line_id: line.id,
      ordered_nose_dorsum_index: orderedIndex,
      point_count: points.length,
      gaussian_sigma_points: selectedSigma,
      maximum_turn_degrees: turn,
      mean_adherence_px: meanAdherence,
      p90_adherence_px: p90Adherence,
      minimum_eye_clearance_px: Number.isFinite(eyeClearance) ? eyeClearance : null,
      self_intersection_count: selfIntersections,
    });
    return {
      name: `personalized_nose_dorsum_wrinkle_${orderedIndex + 1}`,
      region: DIRECT_NOSE_DORSUM_RSTL_REGION,
      sourceFineLineId: line.id,
      generatedFromWrinkle: true,
      pts: points.map((point) => [...point]),
      priorPts: points.map((point) => [...point]),
      normalOffsetsPx: points.map(() => 0),
      affectedIntervals: [],
      rollbackReason: null,
    };
  });

  let existingCurveIntersectionCount = 0;
  const existingIntersectionRecords: Record<string, unknown>[] = [];
  for (let generatedIndex = 0; generatedIndex < curves.length; generatedIndex += 1) {
    const generated = curves[generatedIndex];
    for (let existingIndex = 0; existingIndex < existingCurves.length; existingIndex += 1) {
      const existing = existingCurves[existingIndex];
      const points = normalizePoints(existing.pts);
      if (points.length >= 2) {
        const count = polylineIntersectionCount(generated.pts, points);
        existingCurveIntersectionCount += count;
        if (count) existingIntersectionRecords.push({
          generated_curve_index: generatedIndex,
          source_fine_line_id: generated.sourceFineLineId,
          existing_curve_index: existingIndex,
          existing_curve_name: String(existing.name || ""),
          intersection_count: count,
        });
      }
    }
  }
  let generatedCurveIntersectionCount = 0;
  for (let left = 0; left < curves.length; left += 1) {
    for (let right = left + 1; right < curves.length; right += 1) {
      generatedCurveIntersectionCount += polylineIntersectionCount(curves[left].pts, curves[right].pts);
    }
  }
  if ((!auditExistingCurveIntersections && existingCurveIntersectionCount) ||
      generatedCurveIntersectionCount) {
    throw new Error("direct nose-dorsum RSTL intersects an existing or generated RSTL curve: " +
      JSON.stringify({ existingCurveIntersectionCount, generatedCurveIntersectionCount,
        existingIntersectionRecords }));
  }

  return {
    curves,
    diagnostics: {
      algorithm: DIRECT_NOSE_DORSUM_RSTL_ALGORITHM,
      generated_curve_count: curves.length,
      source_fine_line_ids: curves.map((curve) => curve.sourceFineLineId),
      source_wrinkles_excluded_from_refinement: true,
      existing_rstl_curve_displacement_count: 0,
      maximum_turn_limit_degrees: maximumTurnLimitDegrees,
      minimum_eye_clearance_limit_px: minimumEyeClearancePx,
      maximum_mean_adherence_limit_px: maximumMeanAdherencePx,
      existing_curve_intersection_count: existingCurveIntersectionCount,
      existing_curve_intersection_records: existingIntersectionRecords,
      generated_curve_intersection_count: generatedCurveIntersectionCount,
      existing_curve_intersection_policy: auditExistingCurveIntersections ?
        "audited_direct_overlay_intersections" : "reject",
      records,
    },
  };
}
