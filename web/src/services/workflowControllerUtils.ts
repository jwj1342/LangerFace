import { inspectPathPolygonRelation, type Point2 } from "./incisionPathGeometry.ts";
import { buildMediaPipeEngineeringExclusionZones } from "./incisionToolCore.ts";
import type { IncisionPhotoGeometry, SurfaceProjectedFusiformFit } from "./incisionPhotoPlanning";
import type { Vec3 } from "./softBody";

export interface WorkflowPointerIntent {
  pointerId: number;
  startX: number;
  startY: number;
  dragged: boolean;
}

const CLICK_DRAG_THRESHOLD_PX = 5;

export function beginWorkflowPointerIntent(
  pointerId: number,
  button: number,
  clientX: number,
  clientY: number,
): WorkflowPointerIntent | null {
  if (button !== 0) return null;
  return { pointerId, startX: clientX, startY: clientY, dragged: false };
}

export function updateWorkflowPointerIntent(
  intent: WorkflowPointerIntent | null,
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  if (!intent || intent.pointerId !== pointerId || intent.dragged) return;
  intent.dragged = Math.hypot(clientX - intent.startX, clientY - intent.startY) >= CLICK_DRAG_THRESHOLD_PX;
}

export function completesWorkflowCanvasClick(
  intent: WorkflowPointerIntent | null,
  pointerId: number,
): boolean {
  return Boolean(intent && intent.pointerId === pointerId && !intent.dragged);
}

export function workflowLiveOverlayChanged(
  current: { loaded: boolean; qaLabel: string | null } | null | undefined,
  loaded: boolean,
  qaLabel: string | null,
): boolean {
  return !current || current.loaded !== loaded || current.qaLabel !== qaLabel;
}

export function workflowInvalidationNeedsLiveFrame(hadActiveOverlay: boolean): boolean {
  return hadActiveOverlay;
}

export function workflowCandidateDisplayAllowed(
  result: { candidate_display_blocked?: boolean } | null | undefined,
  projectionValid: boolean,
): boolean {
  return projectionValid && result?.candidate_display_blocked !== true;
}

export function minimumWorkflowMarkerScanDiameterMm(diameterMm: number): number {
  const normalizedDiameter = Number.isFinite(diameterMm) ? Math.max(0, diameterMm) : 0;
  const roundedCoverage = Math.ceil(Math.max(10, normalizedDiameter * 1.2) / 5) * 5;
  return Math.max(10, Math.min(60, roundedCoverage));
}

export function workflowMarkerScanDiameterForTumor(
  scanDiameterMm: number,
  tumorDiameterMm: number,
): number {
  const normalizedScan = Number.isFinite(scanDiameterMm)
    ? Math.max(10, Math.min(60, Math.round(scanDiameterMm / 5) * 5))
    : 10;
  return Math.max(normalizedScan, minimumWorkflowMarkerScanDiameterMm(tumorDiameterMm));
}

export function workflowCenteredLinearPath(
  points: readonly Vec3[],
  center: Vec3 | null | undefined,
): Vec3[] {
  const cloned = points.map((point) => [...point] as Vec3);
  if (!center || cloned.length < 2 || !center.every(Number.isFinite)) return cloned;
  return [cloned[0], [...center] as Vec3, cloned[cloned.length - 1]];
}

export function workflowSubcutaneousLengthLimit(
  candidate: {
    type?: unknown;
    length_mm?: unknown;
    metrics?: { diameter_coverage_deficit_mm?: unknown; length_clamped_by_max?: unknown };
  } | null | undefined,
  tumorDiameterMm: number,
): { lengthMm: number; diameterMm: number; deficitMm: number } | null {
  const lengthMm = Number(candidate?.length_mm);
  const diameterMm = Number(tumorDiameterMm);
  const deficitMm = Math.max(0, Number(candidate?.metrics?.diameter_coverage_deficit_mm) || 0);
  if (candidate?.type !== "linear" || !Number.isFinite(lengthMm) || !Number.isFinite(diameterMm)) return null;
  if (deficitMm <= 0 && candidate?.metrics?.length_clamped_by_max !== true) return null;
  return { lengthMm, diameterMm, deficitMm };
}

export interface WorkflowMarkerRequestSnapshot {
  kind: "cutaneous" | "subcutaneous";
  diameterMm: number;
  depthMm: number;
  marginMm: number;
  scanDiameterMm: number;
  author: string;
}

export function workflowMarkerRequestStillCurrent(
  started: WorkflowMarkerRequestSnapshot,
  current: WorkflowMarkerRequestSnapshot,
): boolean {
  return started.kind === current.kind
    && started.diameterMm === current.diameterMm
    && started.depthMm === current.depthMm
    && started.marginMm === current.marginMm
    && started.scanDiameterMm === current.scanDiameterMm
    && started.author === current.author;
}

export function workflowScanCircleGeometry({
  sourcePoint,
  scanDiameterMm,
  pixelsPerMm,
  project,
}: {
  sourcePoint: SvgPoint;
  scanDiameterMm: number;
  pixelsPerMm: number;
  project: (point: SvgPoint) => SvgPoint | null;
}): { center: SvgPoint; radius: number } | null {
  if (!(scanDiameterMm > 0) || !(pixelsPerMm > 0)) return null;
  const sourceRadius = scanDiameterMm * pixelsPerMm / 2;
  const center = project(sourcePoint);
  const horizontalEdge = project({ x: sourcePoint.x + sourceRadius, y: sourcePoint.y });
  const verticalEdge = project({ x: sourcePoint.x, y: sourcePoint.y + sourceRadius });
  if (!center || (!horizontalEdge && !verticalEdge)) return null;
  const radii = [horizontalEdge, verticalEdge]
    .filter((point): point is SvgPoint => Boolean(point))
    .map((point) => Math.hypot(point.x - center.x, point.y - center.y))
    .filter((radius) => Number.isFinite(radius) && radius > 0);
  if (!radii.length) return null;
  return { center, radius: radii.reduce((sum, radius) => sum + radius, 0) / radii.length };
}

export interface SvgPoint {
  x: number;
  y: number;
}

export function workflowPhotoEllipseBoundary({
  center,
  diameterMm,
  ellipseRatio,
  pixelsPerMm,
  samples = 32,
}: {
  center: SvgPoint;
  diameterMm: number;
  ellipseRatio: number;
  pixelsPerMm: number;
  samples?: number;
}): SvgPoint[] {
  const radiusX = Number(diameterMm) * Number(pixelsPerMm) / 2;
  const radiusY = radiusX * Number(ellipseRatio) / 100;
  if (![center.x, center.y, radiusX, radiusY].every(Number.isFinite)
    || !(radiusX > 0)
    || !(radiusY > 0)
    || samples < 8) return [];
  return Array.from({ length: samples }, (_, index) => {
    const angle = index / samples * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    };
  });
}

export function workflowPhotoCircleFootprint(
  center: SvgPoint,
  radiusPx: number,
  samples = 48,
): SvgPoint[] {
  if (![center.x, center.y, radiusPx].every(Number.isFinite) || !(radiusPx > 0) || samples < 8) return [];
  return Array.from({ length: samples }, (_, index) => {
    const angle = index / samples * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radiusPx,
      y: center.y + Math.sin(angle) * radiusPx,
    };
  });
}

export function workflowPhotoOpeningIntersection(
  footprint: readonly SvgPoint[],
  photoLandmarks: readonly Vec3[],
): string | null {
  if (footprint.length < 3 || photoLandmarks.length < 468) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of photoLandmarks) {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 1e-9) || !(height > 1e-9)) return null;
  const normalizedFootprint = footprint.map((point) => [
    (point.x - minX) / width,
    (point.y - minY) / height,
  ] as Point2);
  for (const zone of buildMediaPipeEngineeringExclusionZones([...photoLandmarks])) {
    if (zone.applies_to_tumor === false || !Array.isArray(zone.polygon)) continue;
    const relation = inspectPathPolygonRelation(normalizedFootprint, zone.polygon as Point2[], { closedPath: true });
    if (relation.intersects) return String(zone.id || "non-skin-opening");
  }
  const upperInnerLip = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308] as const;
  const lowerInnerLip = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308] as const;
  const mouthPairs = upperInnerLip.map((upperIndex, index) => {
    const upper = photoLandmarks[upperIndex];
    const lower = photoLandmarks[lowerInnerLip[index]];
    if (!upper || !lower) return null;
    const normalizedUpper: Point2 = [(upper[0] - minX) / width, (upper[1] - minY) / height];
    const normalizedLower: Point2 = [(lower[0] - minX) / width, (lower[1] - minY) / height];
    if (![...normalizedUpper, ...normalizedLower].every(Number.isFinite)) return null;
    return { upper: normalizedUpper, lower: normalizedLower };
  }).filter((pair): pair is { upper: Point2; lower: Point2 } => Boolean(pair));
  if (mouthPairs.length === upperInnerLip.length) {
    const firstCenter: Point2 = [
      (mouthPairs[0].upper[0] + mouthPairs[0].lower[0]) / 2,
      (mouthPairs[0].upper[1] + mouthPairs[0].lower[1]) / 2,
    ];
    const lastPair = mouthPairs.at(-1)!;
    const lastCenter: Point2 = [
      (lastPair.upper[0] + lastPair.lower[0]) / 2,
      (lastPair.upper[1] + lastPair.lower[1]) / 2,
    ];
    const axisX = lastCenter[0] - firstCenter[0];
    const axisY = lastCenter[1] - firstCenter[1];
    const axisLength = Math.hypot(axisX, axisY);
    if (axisLength > 1e-9) {
      const normal: Point2 = [-axisY / axisLength, axisX / axisLength];
      // Closed lips can collapse the inner-lip loop into a near-zero-area
      // polygon. Keep a small photo-space uncertainty corridor around the
      // actual mouth seam. This is an engineering exclusion only, not a
      // medical safety margin, and deliberately remains inside the vermilion.
      const minimumHalfWidth = 0.006;
      const firstSide: Point2[] = [];
      const secondSide: Point2[] = [];
      for (const pair of mouthPairs) {
        const center: Point2 = [
          (pair.upper[0] + pair.lower[0]) / 2,
          (pair.upper[1] + pair.lower[1]) / 2,
        ];
        const openingHalfWidth = Math.abs(
          (pair.lower[0] - pair.upper[0]) * normal[0]
          + (pair.lower[1] - pair.upper[1]) * normal[1],
        ) / 2;
        const halfWidth = Math.max(minimumHalfWidth, openingHalfWidth);
        firstSide.push([center[0] + normal[0] * halfWidth, center[1] + normal[1] * halfWidth]);
        secondSide.push([center[0] - normal[0] * halfWidth, center[1] - normal[1] * halfWidth]);
      }
      const mouthSeamCorridor = [...firstSide, ...secondSide.reverse()];
      if (inspectPathPolygonRelation(normalizedFootprint, mouthSeamCorridor, { closedPath: true }).intersects) {
        return "oral-opening";
      }
    }
  }
  return null;
}

export function workflowPhotoTumorOpeningIntersection({
  center,
  kind,
  diameterMm,
  ellipseRatio,
  pixelsPerMm,
  photoLandmarks,
}: {
  center: SvgPoint;
  kind: "cutaneous" | "subcutaneous";
  diameterMm: number;
  ellipseRatio: number;
  pixelsPerMm: number;
  photoLandmarks: readonly Vec3[];
}): string | null {
  const footprint = kind === "cutaneous"
    ? workflowPhotoEllipseBoundary({ center, diameterMm, ellipseRatio, pixelsPerMm })
    : workflowPhotoCircleFootprint(center, diameterMm * pixelsPerMm / 2);
  return workflowPhotoOpeningIntersection(footprint, photoLandmarks);
}

export function workflowPhotoTumorOutline(
  kind: "cutaneous" | "subcutaneous",
  geometry: Pick<IncisionPhotoGeometry, "boundary" | "diameterEstimate">,
): readonly Vec3[] {
  return kind === "subcutaneous" ? geometry.diameterEstimate : geometry.boundary;
}

const svgPoint = (point: SvgPoint): string => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`;

function projectCurve(
  curve: readonly Vec3[],
  project: (point: Vec3) => SvgPoint | null,
): SvgPoint[] | null {
  const points = curve.map((point) => project(point));
  return points.some((point) => point === null) ? null : points as SvgPoint[];
}

export function workflowFusiformSvgPath(
  fit: SurfaceProjectedFusiformFit | null | undefined,
  project: (point: Vec3) => SvgPoint | null,
): string {
  if (!fit) return "";
  if (fit.visibleSegments?.length) {
    return fit.visibleSegments.map((segment) => {
      const points = projectCurve(segment, project);
      return points && points.length >= 2
        ? `M ${svgPoint(points[0])} L ${points.slice(1).map(svgPoint).join(" L ")}`
        : "";
    }).filter(Boolean).join(" ");
  }
  if (fit.strategy === "segmented_c1" && fit.upperCurves.length && fit.lowerCurves.length) {
    const upper = fit.upperCurves.map((curve) => projectCurve(curve, project));
    const lower = fit.lowerCurves.map((curve) => projectCurve(curve, project));
    if ([...upper, ...lower].some((curve) => !curve || curve.length !== 4)) return "";
    const first = upper[0]![0];
    const upperCommands = upper.map((curve) => `C ${svgPoint(curve![1])} ${svgPoint(curve![2])} ${svgPoint(curve![3])}`);
    const lowerCommands = lower.slice().reverse().map((curve) => `C ${svgPoint(curve![2])} ${svgPoint(curve![1])} ${svgPoint(curve![0])}`);
    return `M ${svgPoint(first)} ${[...upperCommands, ...lowerCommands].join(" ")} Z`;
  }
  const upper = projectCurve(fit.upperCurve, project);
  const lower = projectCurve(fit.lowerCurve, project);
  if (!upper || !lower || upper.length !== 4 || lower.length !== 4) return "";
  return [
    `M ${svgPoint(upper[0])}`,
    `C ${svgPoint(upper[1])} ${svgPoint(upper[2])} ${svgPoint(upper[3])}`,
    `C ${svgPoint(lower[2])} ${svgPoint(lower[1])} ${svgPoint(lower[0])}`,
    "Z",
  ].join(" ");
}
