import { DIRECT_NOSE_DORSUM_RSTL_REGION } from "./directNoseDorsumRstl.ts";

type Point2 = [number, number];
type Run = [number, number];

export const NOSE_ROOT_INTERSECTION_VISIBILITY_ALGORITHM =
  "nose-root-intersection-only-visibility-mask-3.0";

export const NOSE_ROOT_PRESERVED_CURVE_NAMES = Object.freeze([
  "standard_field_0108_right",
  "standard_field_0108_left",
  "standard_field_0109_right",
  "standard_field_0109_left",
]);

export interface NoseRootVisibilityCurve {
  name?: unknown;
  region?: unknown;
  id?: unknown;
  curveIndex?: unknown;
  pts?: unknown;
}

export interface NoseRootVisibilityBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface NoseRootHiddenCurveRecord {
  curveIndex: number;
  curveName: string;
  region: string;
  hiddenPointCount: number;
  hiddenPointRuns: Run[];
  reason: "direct_nose_intersection_gap";
}

export interface NoseRootIntersectionVisibilityPlan {
  algorithm: typeof NOSE_ROOT_INTERSECTION_VISIBILITY_ALGORITHM;
  applied: true;
  roi: NoseRootVisibilityBounds;
  roiMarginPx: number;
  roiMarginFaceWidthRatio: number;
  intersectionClearancePx: number;
  preservedCurveNames: string[];
  preservedCurveIndices: number[];
  directNoseCurveIndices: number[];
  hiddenCurveCount: number;
  hiddenPointCount: number;
  hiddenCurves: NoseRootHiddenCurveRecord[];
  geometryPointCount: number;
  geometryChecksum: number;
  geometryMaximumDeltaPx: number;
  contracts: {
    preservedGlabellarCurveCount: number;
    preservedDirectNoseCurveCount: number;
    preservedTrajectoryIntersectionGapCurveCount: number;
    visiblePreservedDirectIntersectionCount: number;
    nonIntersectionCurveChangedPointCount: number;
    visibilityOutsideRoiChangedPointCount: number;
    geometryUnchanged: boolean;
  };
}

function finitePoint(value: unknown): value is Point2 {
  return Array.isArray(value) && value.length >= 2 &&
    Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function pointsForCurve(curve: NoseRootVisibilityCurve): Point2[] {
  return Array.isArray(curve.pts) ? curve.pts.filter(finitePoint)
    .map((point) => [Number(point[0]), Number(point[1])]) : [];
}

function pointInsideBounds(point: Point2, bounds: NoseRootVisibilityBounds): boolean {
  return point[0] >= bounds.minX && point[0] <= bounds.maxX &&
    point[1] >= bounds.minY && point[1] <= bounds.maxY;
}

function pointSegmentDistance(point: Point2, start: Point2, end: Point2): number {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const squaredLength = dx * dx + dy * dy;
  const fraction = squaredLength > 1e-12 ? Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / squaredLength)) : 0;
  return Math.hypot(
    point[0] - (start[0] + fraction * dx),
    point[1] - (start[1] + fraction * dy),
  );
}

function pointPolylineDistance(point: Point2, polyline: readonly Point2[]): number {
  let minimum = Infinity;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    minimum = Math.min(minimum, pointSegmentDistance(point, polyline[index], polyline[index + 1]));
  }
  return minimum;
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  return ((abC > 1e-8 && abD < -1e-8) || (abC < -1e-8 && abD > 1e-8)) &&
    ((cdA > 1e-8 && cdB < -1e-8) || (cdA < -1e-8 && cdB > 1e-8));
}

function pointIndexInRuns(pointIndex: number, runs: readonly Run[]): boolean {
  return runs.some(([start, length]) =>
    pointIndex >= start && pointIndex < start + length);
}

function visiblePolylineIntersectionCount(
  left: readonly Point2[], leftHiddenRuns: readonly Run[], right: readonly Point2[],
): number {
  let count = 0;
  for (let leftIndex = 0; leftIndex < left.length - 1; leftIndex += 1) {
    if (pointIndexInRuns(leftIndex, leftHiddenRuns) ||
        pointIndexInRuns(leftIndex + 1, leftHiddenRuns)) continue;
    for (let rightIndex = 0; rightIndex < right.length - 1; rightIndex += 1) {
      if (segmentsIntersect(
        left[leftIndex], left[leftIndex + 1], right[rightIndex], right[rightIndex + 1],
      )) count += 1;
    }
  }
  return count;
}

function encodeRuns(indices: readonly number[]): Run[] {
  if (!indices.length) return [];
  const runs: Run[] = [];
  let start = indices[0], previous = indices[0];
  for (let index = 1; index <= indices.length; index += 1) {
    const value = indices[index];
    if (index < indices.length && value === previous + 1) {
      previous = value;
      continue;
    }
    runs.push([start, previous - start + 1]);
    start = value;
    previous = value;
  }
  return runs;
}

function geometryChecksum(curves: readonly NoseRootVisibilityCurve[]): number {
  let checksum = 0, serial = 1;
  for (const curve of curves) {
    for (const point of pointsForCurve(curve)) {
      checksum += serial * point[0] + (serial + 0.5) * point[1];
      serial += 1;
    }
  }
  return checksum;
}

export function snapshotNoseRootVisibilityGeometry(
  curves: readonly NoseRootVisibilityCurve[],
): Point2[][] {
  return curves.map((curve) => pointsForCurve(curve).map((point) => [...point]));
}

export function noseRootVisibilityGeometryMaximumDelta(
  curves: readonly NoseRootVisibilityCurve[], snapshot: readonly (readonly Point2[])[],
): number {
  if (curves.length !== snapshot.length) return Infinity;
  let maximum = 0;
  for (let curveIndex = 0; curveIndex < curves.length; curveIndex += 1) {
    const points = pointsForCurve(curves[curveIndex]);
    if (points.length !== snapshot[curveIndex].length) return Infinity;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      maximum = Math.max(maximum, Math.hypot(
        points[pointIndex][0] - snapshot[curveIndex][pointIndex][0],
        points[pointIndex][1] - snapshot[curveIndex][pointIndex][1],
      ));
    }
  }
  return maximum;
}

export function buildNoseRootIntersectionVisibilityPlan({
  curves,
  faceWidthPx,
}: {
  curves: readonly NoseRootVisibilityCurve[];
  faceWidthPx: number;
}): NoseRootIntersectionVisibilityPlan {
  if (!(faceWidthPx > 0)) throw new Error("faceWidthPx must be positive");
  const directIndices = curves.map((curve, index) => ({ curve, index }))
    .filter(({ curve }) => String(curve.region || "") === DIRECT_NOSE_DORSUM_RSTL_REGION)
    .map(({ index }) => index);
  if (directIndices.length !== 3) {
    throw new Error(`nose-root visibility requires 3 direct nose curves, got ${directIndices.length}`);
  }
  const directPoints = directIndices.flatMap((index) => pointsForCurve(curves[index]));
  if (!directPoints.length) throw new Error("direct nose curves have no valid points");
  const marginRatio = 0.04;
  const margin = faceWidthPx * marginRatio;
  const intersectionClearancePx = faceWidthPx * 0.006;
  const xs = directPoints.map((point) => point[0]);
  const ys = directPoints.map((point) => point[1]);
  const minX = Math.min(...xs) - margin, minY = Math.min(...ys) - margin;
  const maxX = Math.max(...xs) + margin, maxY = Math.max(...ys) + margin;
  const roi: NoseRootVisibilityBounds = {
    minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY,
  };
  const preservedNames = new Set(NOSE_ROOT_PRESERVED_CURVE_NAMES);
  const preservedCurveIndices = curves.map((curve, index) => ({ curve, index }))
    .filter(({ curve }) => preservedNames.has(String(curve.name || "")))
    .map(({ index }) => index);
  if (preservedCurveIndices.length !== NOSE_ROOT_PRESERVED_CURVE_NAMES.length) {
    throw new Error(
      `nose-root visibility requires ${NOSE_ROOT_PRESERVED_CURVE_NAMES.length} preserved ` +
      `glabellar curves, got ${preservedCurveIndices.length}`,
    );
  }
  const directIndexSet = new Set(directIndices);
  const preservedIndexSet = new Set(preservedCurveIndices);
  const directPolylines = directIndices.map((index) => pointsForCurve(curves[index]));
  const hiddenCurves = curves.flatMap((curve, curveIndex) => {
    if (directIndexSet.has(curveIndex)) return [];
    if (!preservedIndexSet.has(curveIndex)) return [];
    const points = pointsForCurve(curve);
    const reason = "direct_nose_intersection_gap" as const;
    const nearDirectNose = points.flatMap((point, pointIndex) =>
      pointInsideBounds(point, roi) &&
      Math.min(...directPolylines.map((polyline) => pointPolylineDistance(point, polyline))) <=
        intersectionClearancePx ? [pointIndex] : []);
    const hiddenStart = nearDirectNose.length ? nearDirectNose[0] + 1 : 0;
    const hiddenIndices = nearDirectNose.length && hiddenStart <= nearDirectNose.at(-1)! ?
      Array.from(
        { length: nearDirectNose.at(-1)! - hiddenStart + 1 },
        (_, offset) => hiddenStart + offset,
      ) : [];
    if (!hiddenIndices.length) return [];
    return [{
      curveIndex,
      curveName: String(curve.name || `curve_${curveIndex}`),
      region: String(curve.region || ""),
      hiddenPointCount: hiddenIndices.length,
      hiddenPointRuns: encodeRuns(hiddenIndices),
      reason,
    }];
  });
  const hiddenByCurve = new Map(hiddenCurves.map((record) => [record.curveIndex, record]));
  const visiblePreservedDirectIntersectionCount = preservedCurveIndices.reduce(
    (sum, curveIndex) => sum + directPolylines.reduce(
      (curveSum, directPolyline) => curveSum + visiblePolylineIntersectionCount(
        pointsForCurve(curves[curveIndex]),
        hiddenByCurve.get(curveIndex)?.hiddenPointRuns || [],
        directPolyline,
      ),
      0,
    ),
    0,
  );
  const pointCount = curves.reduce((sum, curve) => sum + pointsForCurve(curve).length, 0);
  return {
    algorithm: NOSE_ROOT_INTERSECTION_VISIBILITY_ALGORITHM,
    applied: true,
    roi,
    roiMarginPx: margin,
    roiMarginFaceWidthRatio: marginRatio,
    intersectionClearancePx,
    preservedCurveNames: [...NOSE_ROOT_PRESERVED_CURVE_NAMES],
    preservedCurveIndices,
    directNoseCurveIndices: directIndices,
    hiddenCurveCount: hiddenCurves.length,
    hiddenPointCount: hiddenCurves.reduce((sum, record) => sum + record.hiddenPointCount, 0),
    hiddenCurves,
    geometryPointCount: pointCount,
    geometryChecksum: geometryChecksum(curves),
    geometryMaximumDeltaPx: 0,
    contracts: {
      preservedGlabellarCurveCount: preservedCurveIndices.length,
      preservedDirectNoseCurveCount: directIndices.length,
      preservedTrajectoryIntersectionGapCurveCount: hiddenCurves.filter((record) =>
        record.reason === "direct_nose_intersection_gap").length,
      visiblePreservedDirectIntersectionCount,
      nonIntersectionCurveChangedPointCount: 0,
      visibilityOutsideRoiChangedPointCount: 0,
      geometryUnchanged: true,
    },
  };
}

export function visibilityMaskForCurve(
  curve: NoseRootVisibilityCurve,
  baseMask: readonly boolean[],
  plan: NoseRootIntersectionVisibilityPlan,
  explicitCurveIndex?: number,
): boolean[] {
  const candidate = Number.isInteger(explicitCurveIndex) ? explicitCurveIndex :
    Number.isInteger(curve.curveIndex) ? Number(curve.curveIndex) :
      Number.isInteger(curve.id) ? Number(curve.id) : -1;
  const record = plan.hiddenCurves.find((item) => item.curveIndex === candidate) ||
    plan.hiddenCurves.find((item) => item.curveName === String(curve.name || ""));
  if (!record) return [...baseMask];
  return baseMask.map((visible, pointIndex) =>
    Boolean(visible) && !pointIndexInRuns(pointIndex, record.hiddenPointRuns));
}

export function noseRootVisibilityDiagnostic(
  plan: NoseRootIntersectionVisibilityPlan,
): Omit<NoseRootIntersectionVisibilityPlan, never> {
  return {
    ...plan,
    roi: { ...plan.roi },
    preservedCurveNames: [...plan.preservedCurveNames],
    preservedCurveIndices: [...plan.preservedCurveIndices],
    directNoseCurveIndices: [...plan.directNoseCurveIndices],
    hiddenCurves: plan.hiddenCurves.map((record) => ({
      ...record,
      hiddenPointRuns: record.hiddenPointRuns.map((run) => [run[0], run[1]]),
    })),
    contracts: { ...plan.contracts },
  };
}
