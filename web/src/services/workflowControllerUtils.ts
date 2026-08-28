import { inspectPathPolygonRelation, segmentsIntersect2d, type Point2 } from "./incisionPathGeometry.ts";
import { buildMediaPipeEngineeringExclusionZones, cross, norm } from "./incisionToolCore.ts";
import {
  PHOTO_VISIBILITY_LIMITED_MIN_VISIBLE_FRACTION,
  type IncisionPhotoGeometry,
  type SurfaceProjectedFusiformFit,
} from "./incisionPhotoPlanning.ts";
import type { Vec3 } from "./softBody";

export interface WorkflowPointerIntent {
  pointerId: number;
  startX: number;
  startY: number;
  dragged: boolean;
}

const CLICK_DRAG_THRESHOLD_PX = 5;

export function workflowFocusViewportPoint(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
  crop: { sx: number; sy: number; sw: number; sh: number } | null | undefined,
): { x: number; y: number } {
  if (!crop) return { x: point.x, y: point.y };
  return {
    x: (point.x - crop.sx) * viewport.width / Math.max(1, crop.sw),
    y: (point.y - crop.sy) * viewport.height / Math.max(1, crop.sh),
  };
}

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

export function workflowFusiformPlaneNormal(
  candidate: { axis?: ArrayLike<number>; width_axis?: ArrayLike<number> } | null | undefined,
  fallback: ArrayLike<number> = [0, 0, 1],
): Vec3 {
  const axis = candidate?.axis;
  const widthAxis = candidate?.width_axis;
  if (axis?.length === 3 && widthAxis?.length === 3) {
    const planeNormal = cross(axis, widthAxis);
    if (Math.hypot(...planeNormal) > 1e-9) return norm(planeNormal);
  }
  const fallbackNormal = norm(fallback);
  return Math.hypot(...fallbackNormal) > 1e-9 ? fallbackNormal : [0, 0, 1];
}

export function workflowCandidateDisplayAllowed(
  result: { candidate_display_blocked?: boolean } | null | undefined,
  projectionValid: boolean,
): boolean {
  return projectionValid && result?.candidate_display_blocked !== true;
}

export function workflowDiagnosticCandidateVisible(
  result: Record<string, any> | null | undefined,
  projectionValid: boolean,
  candidatePointCount: number,
  photoOpeningIntersection?: string | null,
): boolean {
  return candidatePointCount >= 2
    && (result?.candidate_display_blocked === true || !projectionValid)
    && workflowSensitiveOpeningDiagnosticEligible(result, photoOpeningIntersection);
}

function displayedCandidateHardViolationCodes(result: Record<string, any> | null | undefined): string[] {
  const displayedViolations = Array.isArray(result?.candidate?.hard_violations)
    ? result.candidate.hard_violations
    : [];
  const codes = displayedViolations
    .map((item: Record<string, any>) => String(item?.code || ""))
    .filter(Boolean);
  return [...new Set<string>(codes)];
}

export function workflowSensitiveOpeningDiagnosticEligible(
  result: Record<string, any> | null | undefined,
  photoOpeningIntersection?: string | null,
): boolean {
  const candidateCodes = displayedCandidateHardViolationCodes(result);
  const tumorCodes = Array.isArray(result?.tumor_engineering_validation?.violations)
    ? result.tumor_engineering_validation.violations
      .map((item: Record<string, any>) => String(item?.code || ""))
      .filter(Boolean)
    : [];
  const photoOpening = String(photoOpeningIntersection || "");
  return candidateCodes.concat(tumorCodes).some((code) => code.includes("non_skin_opening"))
    || /(?:eye|oral|mouth|nostril)-opening/.test(photoOpening);
}

export function workflowPhotoSurfaceReferenceRecoveryEligible(
  result: Record<string, any> | null | undefined,
): boolean {
  const codes = displayedCandidateHardViolationCodes(result);
  return result?.candidate_display_blocked === true
    && result?.tumor_engineering_validation?.passed !== false
    && codes.length > 0
    && codes.every((code) => code === "candidate_outside_canonical_surface");
}

export function workflowVisibilityLimitedReferenceDisplayActive({
  canonicalSurfaceOnly,
  projectionValid,
  smoothingMode,
  visibilityLimited,
  hiddenPointCount,
  visibleFraction,
  openingIntersection,
}: {
  canonicalSurfaceOnly: boolean;
  projectionValid: boolean;
  smoothingMode?: string | null;
  visibilityLimited?: boolean | null;
  hiddenPointCount?: number | null;
  visibleFraction?: number | null;
  openingIntersection?: string | null;
}): boolean {
  const hidden = Number(hiddenPointCount);
  const visible = Number(visibleFraction);
  return canonicalSurfaceOnly
    && projectionValid
    && smoothingMode === "limitedVisibility"
    && visibilityLimited === true
    && Number.isFinite(hidden)
    && hidden > 0
    && Number.isFinite(visible)
    && visible >= PHOTO_VISIBILITY_LIMITED_MIN_VISIBLE_FRACTION
    && !openingIntersection
    && visible < 1;
}

export function workflowUpperForeheadSurfaceRecoveryActive({
  canonicalSurfaceOnly,
  projectionValid,
  smoothingMode,
  meshOutsideCount,
  surfaceOutsideCount,
  rstlSupportedMeshOutsideCount,
  upperForeheadPointCount,
  pointCount,
}: {
  canonicalSurfaceOnly: boolean;
  projectionValid: boolean;
  smoothingMode?: string | null;
  meshOutsideCount?: number | null;
  surfaceOutsideCount?: number | null;
  rstlSupportedMeshOutsideCount?: number | null;
  upperForeheadPointCount?: number | null;
  pointCount?: number | null;
}): boolean {
  const meshOutside = Number(meshOutsideCount);
  const surfaceOutside = Number(surfaceOutsideCount);
  const rstlSupported = Number(rstlSupportedMeshOutsideCount);
  const upperForehead = Number(upperForeheadPointCount);
  const total = Number(pointCount);
  const hasRstlSupportedGap = meshOutside > 0 && rstlSupported === meshOutside;
  const fullyContainedUpperForehead = meshOutside === 0
    && Number.isFinite(total)
    && total > 0
    && upperForehead === total;
  return canonicalSurfaceOnly
    && projectionValid
    && smoothingMode === "photoCanonical"
    && Number.isFinite(meshOutside)
    && surfaceOutside === 0
    && (hasRstlSupportedGap || fullyContainedUpperForehead);
}

const WORKFLOW_PROJECTION_STATUS_REASONS = new Set([
  "candidate_result",
  "candidate_loaded",
  "workflow_photo_readiness_changed",
]);

export function workflowProjectionStatusMayOverride(
  reason: string,
  currentStatus: string,
): boolean {
  return WORKFLOW_PROJECTION_STATUS_REASONS.has(reason)
    || /候选已生成|候选生成并等待审阅/.test(currentStatus);
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

export interface WorkflowControlledMarkerCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  seed: SvgPoint;
}

export function workflowControlledMarkerCrop({
  frameWidth,
  frameHeight,
  seed,
  roiRadius,
  padding = 4,
}: {
  frameWidth: number;
  frameHeight: number;
  seed: SvgPoint;
  roiRadius: number;
  padding?: number;
}): WorkflowControlledMarkerCrop {
  const width = Math.max(1, Math.floor(frameWidth));
  const height = Math.max(1, Math.floor(frameHeight));
  const radius = Math.max(1, Math.ceil(roiRadius));
  const safePadding = Math.max(0, Math.ceil(padding));
  const left = Math.max(0, Math.floor(seed.x - radius - safePadding));
  const top = Math.max(0, Math.floor(seed.y - radius - safePadding));
  const right = Math.min(width, Math.ceil(seed.x + radius + safePadding + 1));
  const bottom = Math.min(height, Math.ceil(seed.y + radius + safePadding + 1));
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    seed: { x: seed.x - left, y: seed.y - top },
  };
}

export interface WorkflowFreehandSample {
  source: SvgPoint;
  display: SvgPoint;
}

export type WorkflowBoundaryMode = "ellipse" | "freehand";

export function workflowBoundaryModeTransition(
  mode: WorkflowBoundaryMode,
  action: "select" | "clear",
): { boundaryActive: boolean; clearCenter: boolean; mayGenerateCandidate: boolean } {
  if (mode === "freehand") {
    return { boundaryActive: true, clearCenter: true, mayGenerateCandidate: false };
  }
  return {
    boundaryActive: false,
    clearCenter: action === "clear",
    mayGenerateCandidate: action === "select",
  };
}

function workflowPointDistance(first: SvgPoint, second: SvgPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function workflowBoundaryArea(points: readonly SvgPoint[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

export function workflowBoundaryCentroid(points: readonly SvgPoint[]): SvgPoint | null {
  if (points.length < 3) return null;
  let twiceArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    weightedX += (current.x + next.x) * cross;
    weightedY += (current.y + next.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    const average = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    return { x: average.x / points.length, y: average.y / points.length };
  }
  return {
    x: weightedX / (3 * twiceArea),
    y: weightedY / (3 * twiceArea),
  };
}

function workflowBoundarySelfIntersects(points: readonly SvgPoint[]): boolean {
  if (points.length < 4) return false;
  const source = points.map((point) => [point.x, point.y] as Point2);
  for (let first = 0; first < source.length; first += 1) {
    const firstNext = (first + 1) % source.length;
    for (let second = first + 1; second < source.length; second += 1) {
      const secondNext = (second + 1) % source.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect2d(source[first], source[firstNext], source[second], source[secondNext])) return true;
    }
  }
  return false;
}

function workflowBoundaryHasNonAdjacentTouch(points: readonly SvgPoint[], tolerancePx = 1e-6): boolean {
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const adjacent = second === first + 1 || (first === 0 && second === points.length - 1);
      if (!adjacent && workflowPointDistance(points[first], points[second]) <= tolerancePx) return true;
    }
  }
  return false;
}

export function workflowFreehandBoundaryClosed(
  displayPoints: readonly SvgPoint[],
  closureThresholdPx = 16,
): boolean {
  return displayPoints.length >= 8
    && workflowPointDistance(displayPoints[0], displayPoints[displayPoints.length - 1]) <= closureThresholdPx;
}

export function workflowFreehandContinuationAllowed(
  displayPoints: readonly SvgPoint[],
  nextStart: SvgPoint,
  continuationThresholdPx = 20,
): boolean {
  return !displayPoints.length
    || workflowPointDistance(displayPoints[displayPoints.length - 1], nextStart) <= continuationThresholdPx;
}

function workflowSegmentIntersection(
  firstStart: SvgPoint,
  firstEnd: SvgPoint,
  secondStart: SvgPoint,
  secondEnd: SvgPoint,
): { point: SvgPoint; firstRatio: number; secondRatio: number } | null {
  const firstX = firstEnd.x - firstStart.x;
  const firstY = firstEnd.y - firstStart.y;
  const secondX = secondEnd.x - secondStart.x;
  const secondY = secondEnd.y - secondStart.y;
  const denominator = firstX * secondY - firstY * secondX;
  if (Math.abs(denominator) < 1e-9) return null;
  const offsetX = secondStart.x - firstStart.x;
  const offsetY = secondStart.y - firstStart.y;
  const firstRatio = (offsetX * secondY - offsetY * secondX) / denominator;
  const secondRatio = (offsetX * firstY - offsetY * firstX) / denominator;
  if (firstRatio < -1e-9 || firstRatio > 1 + 1e-9 || secondRatio < -1e-9 || secondRatio > 1 + 1e-9) return null;
  return {
    point: {
      x: firstStart.x + firstX * firstRatio,
      y: firstStart.y + firstY * firstRatio,
    },
    firstRatio,
    secondRatio,
  };
}

function workflowInterpolatePoint(first: SvgPoint, second: SvgPoint, ratio: number): SvgPoint {
  return {
    x: first.x + (second.x - first.x) * ratio,
    y: first.y + (second.y - first.y) * ratio,
  };
}

function workflowBoundaryPerimeter(points: readonly SvgPoint[]): number {
  return points.reduce((perimeter, point, index) => (
    perimeter + workflowPointDistance(point, points[(index + 1) % points.length])
  ), 0);
}

function workflowAdaptiveEndpointClosureThreshold(
  points: readonly SvgPoint[],
  minimumPx: number,
  maximumPx = 48,
): number {
  if (points.length < 3) return minimumPx;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minimumSpan = Math.min(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  const openPathLength = points.slice(1).reduce((length, point, index) => (
    length + workflowPointDistance(points[index], point)
  ), 0);
  return Math.max(minimumPx, Math.min(maximumPx, openPathLength * 0.18, minimumSpan * 0.7));
}

export function workflowPhotoBoundaryEnclosingDiameterMm(
  center: SvgPoint,
  boundary: readonly SvgPoint[],
  pixelsPerMm: number,
): number | null {
  if (![center.x, center.y, pixelsPerMm].every(Number.isFinite) || !(pixelsPerMm > 0)) return null;
  const distances = boundary
    .filter((point) => [point.x, point.y].every(Number.isFinite))
    .map((point) => workflowPointDistance(center, point));
  if (distances.length < 3) return null;
  const radiusPx = Math.max(...distances);
  return radiusPx > 0 ? radiusPx * 2 / pixelsPerMm : null;
}

export function recoverWorkflowFreehandBoundary(
  samples: readonly WorkflowFreehandSample[],
  closureThresholdPx = 24,
  outputSamples = 48,
): SvgPoint[] {
  const valid = samples.filter(({ source, display }) => (
    [source.x, source.y, display.x, display.y].every(Number.isFinite)
  ));
  if (valid.length < 8) return [];

  type LoopCandidate = { source: SvgPoint[]; display: SvgPoint[]; score: number };
  const candidates: LoopCandidate[] = [];
  const addCandidate = (
    source: SvgPoint[],
    display: SvgPoint[],
    closureGapPx: number,
    startIndex: number,
    acceptedClosureThresholdPx = closureThresholdPx,
  ) => {
    const normalized: Array<{ source: SvgPoint; display: SvgPoint }> = [];
    for (let index = 0; index < display.length; index += 1) {
      const previous = normalized.at(-1);
      if (!previous || workflowPointDistance(previous.display, display[index]) > 1e-6) {
        normalized.push({ source: source[index], display: display[index] });
      }
    }
    if (normalized.length > 2
      && workflowPointDistance(normalized[0].display, normalized[normalized.length - 1].display) <= 1e-6) {
      normalized.pop();
    }
    const normalizedDisplay = normalized.map((sample) => sample.display);
    const normalizedSource = normalized.map((sample) => sample.source);
    if (normalizedDisplay.length < 8
      || workflowBoundarySelfIntersects(normalizedDisplay)
      || workflowBoundaryHasNonAdjacentTouch(normalizedDisplay)) return;
    const area = Math.abs(workflowBoundaryArea(normalizedDisplay));
    const perimeter = workflowBoundaryPerimeter(normalizedDisplay);
    if (!(area > 16) || !(perimeter > acceptedClosureThresholdPx * 2)) return;
    const normalizedGap = Math.min(1, Math.max(0, closureGapPx) / acceptedClosureThresholdPx);
    const closureConfidence = 1 / (1 + 8 * normalizedGap * normalizedGap);
    const compactness = Math.min(1, 4 * Math.PI * area / (perimeter * perimeter));
    const shapeConfidence = 0.25 + compactness * 0.75;
    const temporalConfidence = 1 / Math.sqrt(1 + Math.max(0, startIndex));
    candidates.push({
      source: normalizedSource,
      display: normalizedDisplay,
      score: area * closureConfidence * shapeConfidence * temporalConfidence,
    });
  };

  for (let first = 0; first < valid.length - 2; first += 1) {
    for (let second = first + 2; second < valid.length - 1; second += 1) {
      const intersection = workflowSegmentIntersection(
        valid[first].display,
        valid[first + 1].display,
        valid[second].display,
        valid[second + 1].display,
      );
      if (!intersection || second - first + 2 < 8) continue;
      const displayIntersection = intersection.point;
      const firstSourceIntersection = workflowInterpolatePoint(
        valid[first].source,
        valid[first + 1].source,
        intersection.firstRatio,
      );
      const secondSourceIntersection = workflowInterpolatePoint(
        valid[second].source,
        valid[second + 1].source,
        intersection.secondRatio,
      );
      addCandidate(
        [firstSourceIntersection, ...valid.slice(first + 1, second + 1).map(({ source }) => source), secondSourceIntersection],
        [displayIntersection, ...valid.slice(first + 1, second + 1).map(({ display }) => display), displayIntersection],
        0,
        first,
      );
    }
  }

  for (let first = 0; first <= valid.length - 8; first += 1) {
    for (let second = first + 7; second < valid.length; second += 1) {
      const selectedDisplay = valid.slice(first, second + 1).map(({ display }) => display);
      const acceptedClosureThresholdPx = workflowAdaptiveEndpointClosureThreshold(
        selectedDisplay,
        closureThresholdPx,
      );
      const closureGap = workflowPointDistance(valid[first].display, valid[second].display);
      if (closureGap > acceptedClosureThresholdPx) continue;
      addCandidate(
        valid.slice(first, second + 1).map(({ source }) => source),
        selectedDisplay,
        closureGap,
        first,
        acceptedClosureThresholdPx,
      );
    }
  }

  const selected = candidates.sort((first, second) => second.score - first.score)[0];
  return selected ? smoothWorkflowClosedBoundary(selected.source, outputSamples) : [];
}

function resampleWorkflowClosedBoundary(points: readonly SvgPoint[], count: number): SvgPoint[] {
  const unique: SvgPoint[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (!previous || workflowPointDistance(previous, point) > 1e-6) unique.push({ ...point });
  }
  if (unique.length > 2 && workflowPointDistance(unique[0], unique[unique.length - 1]) <= 1e-6) unique.pop();
  if (unique.length < 3 || count < 8) return [];
  const lengths = unique.map((point, index) => workflowPointDistance(point, unique[(index + 1) % unique.length]));
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  if (!(perimeter > 1e-6)) return [];
  const result: SvgPoint[] = [];
  let segment = 0;
  let segmentStart = 0;
  for (let sample = 0; sample < count; sample += 1) {
    const target = perimeter * sample / count;
    while (segment < lengths.length - 1 && segmentStart + lengths[segment] < target) {
      segmentStart += lengths[segment];
      segment += 1;
    }
    const start = unique[segment];
    const end = unique[(segment + 1) % unique.length];
    const ratio = lengths[segment] > 1e-9 ? (target - segmentStart) / lengths[segment] : 0;
    result.push({
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    });
  }
  return result;
}

export function smoothWorkflowClosedBoundary(
  points: readonly SvgPoint[],
  samples = 48,
  passes = 3,
): SvgPoint[] {
  const resampled = resampleWorkflowClosedBoundary(points, samples);
  const sourceArea = Math.abs(workflowBoundaryArea(resampled));
  if (resampled.length < 8 || !(sourceArea > 1) || workflowBoundarySelfIntersects(resampled)) return [];
  let smoothed = resampled.map((point) => ({ ...point }));
  for (let pass = 0; pass < Math.max(0, passes); pass += 1) {
    smoothed = smoothed.map((point, index, source) => {
      const previous = source[(index - 1 + source.length) % source.length];
      const next = source[(index + 1) % source.length];
      return {
        x: previous.x * 0.25 + point.x * 0.5 + next.x * 0.25,
        y: previous.y * 0.25 + point.y * 0.5 + next.y * 0.25,
      };
    });
  }
  const smoothedArea = Math.abs(workflowBoundaryArea(smoothed));
  if (!(smoothedArea > 1)) return [];
  const center = resampled.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  center.x /= resampled.length;
  center.y /= resampled.length;
  const scale = Math.sqrt(sourceArea / smoothedArea);
  const areaPreserved = smoothed.map((point) => ({
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  }));
  return workflowBoundarySelfIntersects(areaPreserved) ? [] : areaPreserved;
}

export function workflowClosedBoundarySvgPath(points: readonly SvgPoint[]): string {
  if (points.length < 3) return "";
  const midpoint = (first: SvgPoint, second: SvgPoint): SvgPoint => ({
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  });
  const start = midpoint(points[points.length - 1], points[0]);
  const commands = points.map((point, index) => {
    const end = midpoint(point, points[(index + 1) % points.length]);
    return `Q ${svgPoint(point)} ${svgPoint(end)}`;
  });
  return `M ${svgPoint(start)} ${commands.join(" ")} Z`;
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
  for (const zone of buildMediaPipeEngineeringExclusionZones([...photoLandmarks], "image_y_down")) {
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
