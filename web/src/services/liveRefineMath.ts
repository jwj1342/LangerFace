export type RefinePoint = [number, number, ...number[]];

export interface RefineLine {
  name?: string;
  pts: RefinePoint[];
  region?: string;
  symmetryRole?: string;
  symmetryPairId?: string;
  tris?: number[];
  hidden?: boolean;
  hiddenPointRuns?: Array<[number, number]>;
}

export interface CurveRefinementTransportLine {
  name: string;
  hidden: boolean;
  hiddenPointRuns?: Array<[number, number]>;
  offsets: Array<[number, number]>;
}

export interface CurveRefinementTransportAddedPoint {
  anchorLineName: string;
  anchorPosition: number;
  tangentOffset: number;
  normalOffset: number;
}

export interface CurveRefinementTransportAddedLine {
  name: string;
  region: string;
  symmetryRole: string;
  symmetryPairId: string;
  hidden: boolean;
  hiddenPointRuns: Array<[number, number]>;
  points: CurveRefinementTransportAddedPoint[];
}

export interface CurveRefinementTransport {
  baseScale: number;
  lines: CurveRefinementTransportLine[];
  addedLines?: CurveRefinementTransportAddedLine[];
  system?: string;
  committedAt?: string;
}

export interface RefineBounds {
  width?: number;
  height?: number;
  globalFollow?: number;
  spread?: number;
  maxDisplacement?: number;
  maxSegmentStrain?: number;
}

export interface RefineViewportCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export type RefineQualityWarningCode =
  | "invalid_coordinate"
  | "new_self_intersection"
  | "new_curve_intersection"
  | "new_dense_spacing";

export interface RefineQualityWarning {
  code: RefineQualityWarningCode;
  lineNames: string[];
  minimumDistancePx?: number;
}

export interface RefineQualityReport {
  ok: boolean;
  checkedLineCount: number;
  minimumSpacingPx: number;
  warnings: RefineQualityWarning[];
}

export interface RefineQualityOptions {
  minimumSpacingPx?: number;
}

/** Map a point from the visible focused canvas back into full-frame coordinates. */
export function mapRefineViewportPoint(
  point: readonly [number, number],
  viewport: { width: number; height: number },
  crop: RefineViewportCrop | null | undefined,
): [number, number] {
  if (!crop) return [point[0], point[1]];
  return [
    crop.sx + point[0] * crop.sw / Math.max(1, viewport.width),
    crop.sy + point[1] * crop.sh / Math.max(1, viewport.height),
  ];
}

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

type Segment = { a: RefinePoint; b: RefinePoint };

function lineLabel(line: RefineLine, index: number): string {
  return line.name || `curve_${index + 1}`;
}

function lineSegments(line: RefineLine): Segment[] {
  const segments: Segment[] = [];
  for (let index = 1; index < (line.pts || []).length; index++) {
    segments.push({ a: line.pts[index - 1], b: line.pts[index] });
  }
  return segments;
}

function orientation(a: RefinePoint, b: RefinePoint, c: RefinePoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point: RefinePoint, segment: Segment): boolean {
  const epsilon = 1e-7;
  return Math.abs(orientation(segment.a, segment.b, point)) <= epsilon
    && point[0] >= Math.min(segment.a[0], segment.b[0]) - epsilon
    && point[0] <= Math.max(segment.a[0], segment.b[0]) + epsilon
    && point[1] >= Math.min(segment.a[1], segment.b[1]) - epsilon
    && point[1] <= Math.max(segment.a[1], segment.b[1]) + epsilon;
}

function segmentsIntersect(first: Segment, second: Segment): boolean {
  const o1 = orientation(first.a, first.b, second.a);
  const o2 = orientation(first.a, first.b, second.b);
  const o3 = orientation(second.a, second.b, first.a);
  const o4 = orientation(second.a, second.b, first.b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))
      && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return pointOnSegment(second.a, first) || pointOnSegment(second.b, first)
    || pointOnSegment(first.a, second) || pointOnSegment(first.b, second);
}

function pointSegmentDistance(point: RefinePoint, segment: Segment): number {
  const dx = segment.b[0] - segment.a[0];
  const dy = segment.b[1] - segment.a[1];
  const denominator = dx * dx + dy * dy;
  if (denominator < 1e-12) return Math.hypot(point[0] - segment.a[0], point[1] - segment.a[1]);
  const position = clamp(
    ((point[0] - segment.a[0]) * dx + (point[1] - segment.a[1]) * dy) / denominator,
    0,
    1,
  );
  return Math.hypot(
    point[0] - (segment.a[0] + position * dx),
    point[1] - (segment.a[1] + position * dy),
  );
}

function segmentDistance(first: Segment, second: Segment): number {
  if (segmentsIntersect(first, second)) return 0;
  return Math.min(
    pointSegmentDistance(first.a, second),
    pointSegmentDistance(first.b, second),
    pointSegmentDistance(second.a, first),
    pointSegmentDistance(second.b, first),
  );
}

function hasSelfIntersection(line: RefineLine): boolean {
  const segments = lineSegments(line);
  for (let first = 0; first < segments.length; first++) {
    for (let second = first + 2; second < segments.length; second++) {
      if (segmentsIntersect(segments[first], segments[second])) return true;
    }
  }
  return false;
}

function linePairDistance(first: RefineLine, second: RefineLine): number {
  const firstSegments = lineSegments(first);
  const secondSegments = lineSegments(second);
  let minimum = Infinity;
  for (const a of firstSegments) for (const b of secondSegments) {
    minimum = Math.min(minimum, segmentDistance(a, b));
    if (minimum === 0) return 0;
  }
  return minimum;
}

/** Compare an edited curve set with its automatic baseline and report only newly introduced risks. */
export function assessRefineLineQuality(
  automaticLines: readonly RefineLine[] | null | undefined,
  editedLines: readonly RefineLine[] | null | undefined,
  options: RefineQualityOptions = {},
): RefineQualityReport {
  const minimumSpacingPx = Math.max(0.5, Number(options.minimumSpacingPx) || 6);
  const visible = (editedLines || []).filter((line) => !line.hidden);
  const baselineByName = new Map((automaticLines || []).map((line, index) => [lineLabel(line, index), line]));
  const warnings: RefineQualityWarning[] = [];

  visible.forEach((line, index) => {
    const name = lineLabel(line, index);
    if ((line.pts || []).some((point) => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) {
      warnings.push({ code: "invalid_coordinate", lineNames: [name] });
      return;
    }
    const baseline = baselineByName.get(name);
    if (hasSelfIntersection(line) && !hasSelfIntersection(baseline || { pts: [] })) {
      warnings.push({ code: "new_self_intersection", lineNames: [name] });
    }
  });

  for (let first = 0; first < visible.length; first++) {
    const firstName = lineLabel(visible[first], first);
    const baselineFirst = baselineByName.get(firstName);
    if (!baselineFirst) continue;
    for (let second = first + 1; second < visible.length; second++) {
      const secondName = lineLabel(visible[second], second);
      const baselineSecond = baselineByName.get(secondName);
      if (!baselineSecond) continue;
      const currentDistance = linePairDistance(visible[first], visible[second]);
      const baselineDistance = linePairDistance(baselineFirst, baselineSecond);
      if (currentDistance === 0 && baselineDistance > 0) {
        warnings.push({ code: "new_curve_intersection", lineNames: [firstName, secondName] });
      } else if (currentDistance > 0 && currentDistance < minimumSpacingPx
          && baselineDistance >= minimumSpacingPx * 1.5) {
        warnings.push({
          code: "new_dense_spacing",
          lineNames: [firstName, secondName],
          minimumDistancePx: Math.round(currentDistance * 100) / 100,
        });
      }
    }
  }
  return { ok: warnings.length === 0, checkedLineCount: visible.length, minimumSpacingPx, warnings };
}

function normalizedArcPositions(points: readonly RefinePoint[]): number[] {
  if (!points?.length) return [];
  const positions = new Array(points.length).fill(0);
  for (let index = 1; index < points.length; index++) {
    positions[index] = positions[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
  }
  const total = positions[positions.length - 1];
  if (total < 1e-6) return positions.map((_, index) => index / Math.max(1, points.length - 1));
  return positions.map((value) => value / total);
}

function pointTangent(points: readonly RefinePoint[], index: number): [number, number] {
  const previous = points[Math.max(0, index - 1)] || points[index];
  const next = points[Math.min(points.length - 1, index + 1)] || points[index];
  const dx = (next?.[0] || 0) - (previous?.[0] || 0);
  const dy = (next?.[1] || 0) - (previous?.[1] || 0);
  const length = Math.hypot(dx, dy);
  return length > 1e-8 ? [dx / length, dy / length] : [1, 0];
}

function curveSpatialScale(points: readonly RefinePoint[]): number {
  let arcLength = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
    if (index > 0) arcLength += Math.hypot(
      point[0] - points[index - 1][0],
      point[1] - points[index - 1][1],
    );
  }
  return Math.max(1, arcLength, Math.hypot(maxX - minX, maxY - minY));
}

function softLimitOffset(
  dx: number,
  dy: number,
  maxDisplacement: number,
): { dx: number; dy: number; pressure: number } {
  const magnitude = Math.hypot(dx, dy);
  const maximum = Math.max(1, maxDisplacement);
  const softStart = maximum * 0.65;
  if (magnitude <= softStart) return { dx, dy, pressure: 0 };
  const softRange = Math.max(1, maximum - softStart);
  const limitedMagnitude = softStart + softRange * (1 - Math.exp(-(magnitude - softStart) / softRange));
  const scale = limitedMagnitude / Math.max(1e-9, magnitude);
  return {
    dx: dx * scale,
    dy: dy * scale,
    pressure: clamp((limitedMagnitude - softStart) / softRange, 0, 1),
  };
}

function curveDisplacementLimit(points: readonly RefinePoint[], bounds: RefineBounds): number {
  const width = typeof bounds.width === "number" && Number.isFinite(bounds.width) ? bounds.width : Infinity;
  const height = typeof bounds.height === "number" && Number.isFinite(bounds.height) ? bounds.height : Infinity;
  const frameMinimum = Number.isFinite(width) && Number.isFinite(height) ? Math.min(width, height) : Infinity;
  const derived = Math.min(
    Math.max(14, curveSpatialScale(points) * 0.22),
    Number.isFinite(frameMinimum) ? Math.max(18, frameMinimum * 0.055) : Infinity,
  );
  return Math.max(4, bounds.maxDisplacement ?? derived);
}

function constrainDisplacementField(
  reference: readonly RefinePoint[],
  candidate: readonly RefinePoint[],
  anchorIndex: number,
  maxSegmentStrain: number,
): Array<[number, number]> {
  const displacement = reference.map((point, index) => [
    (candidate[index]?.[0] ?? point[0]) - point[0],
    (candidate[index]?.[1] ?? point[1]) - point[1],
  ] as [number, number]);
  const anchor = clamp(Math.round(anchorIndex), 0, Math.max(0, displacement.length - 1));
  const strain = clamp(maxSegmentStrain, 0.05, 0.45);

  const constrainFromNeighbour = (index: number, neighbourIndex: number): void => {
    const edgeLength = Math.hypot(
      reference[index][0] - reference[neighbourIndex][0],
      reference[index][1] - reference[neighbourIndex][1],
    );
    const maximumGradient = edgeLength * strain;
    const dx = displacement[index][0] - displacement[neighbourIndex][0];
    const dy = displacement[index][1] - displacement[neighbourIndex][1];
    const magnitude = Math.hypot(dx, dy);
    if (magnitude <= maximumGradient || magnitude < 1e-9) return;
    const scale = maximumGradient / magnitude;
    displacement[index] = [
      displacement[neighbourIndex][0] + dx * scale,
      displacement[neighbourIndex][1] + dy * scale,
    ];
  };

  // Keep the grabbed point fixed and propagate a Lipschitz-continuous offset
  // field towards both ends. This mathematically bounds every segment's
  // stretch and prevents a large pointer jump from creating a spike.
  for (let index = anchor + 1; index < displacement.length; index++) {
    constrainFromNeighbour(index, index - 1);
  }
  for (let index = anchor - 1; index >= 0; index--) {
    constrainFromNeighbour(index, index + 1);
  }
  return displacement;
}

function fitDisplacedCurveToBounds(
  reference: readonly RefinePoint[],
  displacement: readonly [number, number][],
  bounds: RefineBounds,
): RefinePoint[] {
  const width = typeof bounds.width === "number" && Number.isFinite(bounds.width) ? bounds.width : Infinity;
  const height = typeof bounds.height === "number" && Number.isFinite(bounds.height) ? bounds.height : Infinity;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  reference.forEach((point, index) => {
    const offset = displacement[index] || [0, 0];
    const x = point[0] + offset[0], y = point[1] + offset[1];
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  });
  let shiftX = minX < 0 ? -minX : 0;
  let shiftY = minY < 0 ? -minY : 0;
  if (Number.isFinite(width) && maxX + shiftX > width) shiftX += width - (maxX + shiftX);
  if (Number.isFinite(height) && maxY + shiftY > height) shiftY += height - (maxY + shiftY);
  return reference.map((point, index) => {
    const offset = displacement[index] || [0, 0];
    return [point[0] + offset[0] + shiftX, point[1] + offset[1] + shiftY, ...point.slice(2)];
  });
}

function lineSetScale(lines: readonly RefineLine[] | null | undefined): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of lines || []) for (const point of line.pts || []) {
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
  }
  return Number.isFinite(minX) ? Math.max(1, Math.hypot(maxX - minX, maxY - minY)) : 1;
}

function sampleOffset(offsets: readonly [number, number][], position: number): [number, number] {
  if (!offsets?.length) return [0, 0];
  if (offsets.length === 1) return offsets[0];
  const cursor = clamp(position, 0, 1) * (offsets.length - 1);
  const lower = Math.floor(cursor), upper = Math.min(offsets.length - 1, lower + 1);
  const fraction = cursor - lower;
  return [
    offsets[lower][0] * (1 - fraction) + offsets[upper][0] * fraction,
    offsets[lower][1] * (1 - fraction) + offsets[upper][1] * fraction,
  ];
}

interface CurveAnchorProjection extends CurveRefinementTransportAddedPoint {
  distanceSquared: number;
}

function nearestCurveAnchor(
  lines: readonly RefineLine[],
  target: RefinePoint,
): CurveAnchorProjection | null {
  let best: CurveAnchorProjection | null = null;
  for (const line of lines) {
    if (!line.name || !line.pts?.length) continue;
    if (line.pts.length === 1) {
      const point = line.pts[0];
      const dx = target[0] - point[0], dy = target[1] - point[1];
      const tangent = pointTangent(line.pts, 0);
      const normal: [number, number] = [-tangent[1], tangent[0]];
      const candidate: CurveAnchorProjection = {
        anchorLineName: line.name,
        anchorPosition: 0,
        tangentOffset: dx * tangent[0] + dy * tangent[1],
        normalOffset: dx * normal[0] + dy * normal[1],
        distanceSquared: dx * dx + dy * dy,
      };
      if (!best || candidate.distanceSquared < best.distanceSquared) best = candidate;
      continue;
    }
    for (let index = 0; index < line.pts.length - 1; index += 1) {
      const a = line.pts[index], b = line.pts[index + 1];
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const lengthSquared = vx * vx + vy * vy;
      const fraction = lengthSquared > 1e-9
        ? clamp(((target[0] - a[0]) * vx + (target[1] - a[1]) * vy) / lengthSquared, 0, 1)
        : 0;
      const anchorX = a[0] + vx * fraction, anchorY = a[1] + vy * fraction;
      const dx = target[0] - anchorX, dy = target[1] - anchorY;
      const length = Math.hypot(vx, vy) || 1;
      const tangent: [number, number] = [vx / length, vy / length];
      const normal: [number, number] = [-tangent[1], tangent[0]];
      const candidate: CurveAnchorProjection = {
        anchorLineName: line.name,
        anchorPosition: (index + fraction) / (line.pts.length - 1),
        tangentOffset: dx * tangent[0] + dy * tangent[1],
        normalOffset: dx * normal[0] + dy * normal[1],
        distanceSquared: dx * dx + dy * dy,
      };
      if (!best || candidate.distanceSquared < best.distanceSquared) best = candidate;
    }
  }
  return best;
}

function sampleCurveFrame(
  line: RefineLine,
  position: number,
): { point: RefinePoint; tangent: [number, number]; tri: number | null } | null {
  if (!line.pts?.length) return null;
  const cursor = clamp(position, 0, 1) * Math.max(0, line.pts.length - 1);
  const lower = Math.floor(cursor), upper = Math.min(line.pts.length - 1, lower + 1);
  const fraction = cursor - lower;
  const a = line.pts[lower], b = line.pts[upper] || a;
  const point: RefinePoint = [
    a[0] * (1 - fraction) + b[0] * fraction,
    a[1] * (1 - fraction) + b[1] * fraction,
    (Number(a[2]) || 0) * (1 - fraction) + (Number(b[2]) || 0) * fraction,
  ];
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const length = Math.hypot(vx, vy);
  const tangent = length > 1e-9
    ? [vx / length, vy / length] as [number, number]
    : pointTangent(line.pts, lower);
  const triIndex = fraction < 0.5 ? lower : upper;
  const tri = Number.isInteger(line.tris?.[triIndex]) ? Number(line.tris?.[triIndex]) : null;
  return { point, tangent, tri };
}

/**
 * Store manual edits in each automatic curve's tangent/normal frame. This is
 * independent of the frozen camera's absolute pixels, so it can be transported
 * to the same named curves on later live frames.
 */
export function buildCurveRefinementTransport(
  autoLines: readonly RefineLine[] | null | undefined,
  refinedLines: readonly RefineLine[] | null | undefined,
): CurveRefinementTransport {
  const refinedByName = new Map((refinedLines || []).map((line) => [line.name, line]));
  const automaticNames = new Set((autoLines || []).map((line) => line.name).filter(Boolean));
  const lines: CurveRefinementTransportLine[] = [];
  for (const automatic of autoLines || []) {
    const refined = refinedByName.get(automatic.name);
    if (!refined?.pts?.length || !automatic.pts?.length) continue;
    const offsets: Array<[number, number]> = automatic.pts.map((point, index) => {
      const refinedIndex = automatic.pts.length <= 1
        ? 0
        : Math.round(index * (refined.pts.length - 1) / (automatic.pts.length - 1));
      const target = refined.pts[refinedIndex] || point;
      const tangent = pointTangent(automatic.pts, index);
      const normal: [number, number] = [-tangent[1], tangent[0]];
      const dx = target[0] - point[0], dy = target[1] - point[1];
      return [dx * tangent[0] + dy * tangent[1], dx * normal[0] + dy * normal[1]];
    });
    lines.push({
      name: automatic.name || "",
      hidden: Boolean(refined.hidden),
      hiddenPointRuns: (refined.hiddenPointRuns || []).map((run) => [run[0], run[1]]),
      offsets,
    });
  }
  const addedLines: CurveRefinementTransportAddedLine[] = [];
  for (const refined of refinedLines || []) {
    if (!refined.name || automaticNames.has(refined.name) || !refined.pts?.length) continue;
    const points = refined.pts.map((point) => nearestCurveAnchor(autoLines || [], point));
    if (points.some((point) => !point)) continue;
    addedLines.push({
      name: refined.name,
      region: refined.region || "",
      symmetryRole: refined.symmetryRole || "",
      symmetryPairId: refined.symmetryPairId || "",
      hidden: Boolean(refined.hidden),
      hiddenPointRuns: (refined.hiddenPointRuns || []).map((run) => [run[0], run[1]]),
      points: points.map((point) => ({
        anchorLineName: point!.anchorLineName,
        anchorPosition: point!.anchorPosition,
        tangentOffset: point!.tangentOffset,
        normalOffset: point!.normalOffset,
      })),
    });
  }
  return { baseScale: lineSetScale(autoLines), lines, addedLines };
}

/** Apply a frozen-frame refinement to the corresponding curves on a live frame. */
export function applyCurveRefinementTransport<T extends RefineLine>(
  mappedLines: readonly T[],
  transport: CurveRefinementTransport | null | undefined,
  bounds: RefineBounds = {},
): T[] {
  if (!transport?.lines?.length && !transport?.addedLines?.length) return [...mappedLines];
  const byName = new Map(transport.lines.map((line) => [line.name, line]));
  const scale = clamp(lineSetScale(mappedLines) / Math.max(1, transport.baseScale || 1), 0.45, 2.4);
  const width = typeof bounds.width === "number" && Number.isFinite(bounds.width) ? bounds.width : Infinity;
  const height = typeof bounds.height === "number" && Number.isFinite(bounds.height) ? bounds.height : Infinity;
  const transported = (mappedLines || []).map((line) => {
    const template = byName.get(line.name || "");
    if (!template) return line;
    const points = (line.pts || []).map((point, index) => {
      const position = line.pts.length <= 1 ? 0 : index / (line.pts.length - 1);
      const [tangentOffset, normalOffset] = sampleOffset(template.offsets, position);
      const tangent = pointTangent(line.pts, index);
      const normal: [number, number] = [-tangent[1], tangent[0]];
      const nextPoint: RefinePoint = [
        clamp(point[0] + scale * (tangentOffset * tangent[0] + normalOffset * normal[0]), 0, width),
        clamp(point[1] + scale * (tangentOffset * tangent[1] + normalOffset * normal[1]), 0, height),
        ...point.slice(2),
      ];
      return nextPoint;
    });
    return {
      ...line,
      hidden: template.hidden,
      hiddenPointRuns: (template.hiddenPointRuns || []).map((run) => [run[0], run[1]]),
      pts: points,
    } as T;
  });
  const mappedByName = new Map((mappedLines || []).map((line) => [line.name || "", line]));
  const existingNames = new Set(transported.map((line) => line.name || ""));
  for (const added of transport.addedLines || []) {
    if (!added.name || existingNames.has(added.name)) continue;
    const points: RefinePoint[] = [];
    const tris: number[] = [];
    let complete = true;
    for (const anchor of added.points) {
      const anchorLine = mappedByName.get(anchor.anchorLineName);
      const frame = anchorLine ? sampleCurveFrame(anchorLine, anchor.anchorPosition) : null;
      if (!frame || frame.tri === null) {
        complete = false;
        break;
      }
      const normal: [number, number] = [-frame.tangent[1], frame.tangent[0]];
      points.push([
        clamp(frame.point[0] + scale * (
          anchor.tangentOffset * frame.tangent[0] + anchor.normalOffset * normal[0]
        ), 0, width),
        clamp(frame.point[1] + scale * (
          anchor.tangentOffset * frame.tangent[1] + anchor.normalOffset * normal[1]
        ), 0, height),
        Number(frame.point[2]) || 0,
      ]);
      tris.push(frame.tri);
    }
    if (!complete || points.length < 2) continue;
    transported.push({
      name: added.name,
      region: added.region,
      symmetryRole: added.symmetryRole,
      symmetryPairId: added.symmetryPairId,
      hidden: added.hidden,
      hiddenPointRuns: added.hiddenPointRuns.map((run) => [run[0], run[1]]),
      pts: points,
      tris,
    } as T);
    existingNames.add(added.name);
  }
  return transported;
}

/**
 * Curve-wide deformation for the manual 2D editor.
 * Small edits follow the pointer exactly. Large edits are softly limited and
 * broaden their falloff so a single drag cannot pull a curve into a long spike.
 */
export function deformCurveWide(
  points: readonly RefinePoint[] | null | undefined,
  anchorIndex: number,
  target: readonly [number, number] | null | undefined,
  bounds: RefineBounds = {},
): RefinePoint[] {
  if (!points?.length || !points[anchorIndex] || !target) {
    return (points || []).map((point) => [...point]);
  }
  const globalFollow = clamp(bounds.globalFollow ?? 0.14, 0, 0.5);
  const spread = clamp(bounds.spread ?? 0.28, 0.12, 0.6);
  const positions = normalizedArcPositions(points);
  const anchor = points[anchorIndex];
  const anchorPosition = positions[anchorIndex] ?? 0;
  const maximum = curveDisplacementLimit(points, bounds);
  const limited = softLimitOffset(target[0] - anchor[0], target[1] - anchor[1], maximum);
  const stableSpread = clamp(spread + limited.pressure * 0.18, 0.12, 0.6);
  const stableGlobalFollow = globalFollow + limited.pressure * (1 - globalFollow);

  const candidate = points.map((point, index) => {
    const distance = Math.abs((positions[index] ?? 0) - anchorPosition);
    const local = Math.exp(-0.5 * (distance / stableSpread) ** 2);
    const weight = stableGlobalFollow + (1 - stableGlobalFollow) * local;
    const nextPoint: RefinePoint = [
      point[0] + limited.dx * weight,
      point[1] + limited.dy * weight,
      ...point.slice(2),
    ];
    return nextPoint;
  });
  const displacement = constrainDisplacementField(
    points,
    candidate,
    anchorIndex,
    bounds.maxSegmentStrain ?? 0.28,
  );
  return fitDisplacedCurveToBounds(points, displacement, bounds);
}

/**
 * Keep cumulative edits bounded relative to the automatic curve baseline.
 * Besides limiting each point, constrain adjacent displacement gradients so
 * repeated drags cannot progressively stretch or reverse individual segments.
 */
export function stabilizeCurveToReference(
  reference: readonly RefinePoint[] | null | undefined,
  current: readonly RefinePoint[] | null | undefined,
  bounds: RefineBounds = {},
  anchorIndex = 0,
): RefinePoint[] {
  if (!reference?.length || !current?.length || reference.length !== current.length) {
    return (current || []).map((point) => [...point]);
  }
  const maximum = curveDisplacementLimit(reference, bounds);
  const limitedCandidate: RefinePoint[] = current.map((point, index) => {
    const base = reference[index];
    const limited = softLimitOffset(point[0] - base[0], point[1] - base[1], maximum);
    return [
      base[0] + limited.dx,
      base[1] + limited.dy,
      ...point.slice(2),
    ] as RefinePoint;
  });
  const displacement = constrainDisplacementField(
    reference,
    limitedCandidate,
    anchorIndex,
    bounds.maxSegmentStrain ?? 0.28,
  );
  return fitDisplacedCurveToBounds(reference, displacement, bounds);
}

export interface CurvePointWindow {
  start: number;
  end: number;
}

export function curvePointWindow(pointLength: number, pointIndex: number, pointCount = 1): CurvePointWindow {
  const length = Math.max(0, Math.floor(Number(pointLength) || 0));
  if (!length) return { start: 0, end: -1 };
  const anchor = clamp(Math.round(Number(pointIndex) || 0), 0, length - 1);
  const count = clamp(Math.round(Number(pointCount) || 1), 1, length);
  let start = anchor - Math.floor((count - 1) / 2);
  start = clamp(start, 0, length - count);
  return { start, end: start + count - 1 };
}

/** Move a contiguous point window with smooth falloff from the grabbed point. */
export function moveCurvePoints(
  points: readonly RefinePoint[],
  pointIndex: number,
  pointCount: number,
  offset: readonly [number, number],
  bounds: RefineBounds = {},
): RefinePoint[] {
  if (!points?.length || !points[pointIndex]) return points.map((point) => [...point]);
  const width = typeof bounds.width === "number" && Number.isFinite(bounds.width) ? bounds.width : Infinity;
  const height = typeof bounds.height === "number" && Number.isFinite(bounds.height) ? bounds.height : Infinity;
  const window = curvePointWindow(points.length, pointIndex, pointCount);
  const maxDistance = Math.max(pointIndex - window.start, window.end - pointIndex, 0);
  return points.map((point, index) => {
    if (index < window.start || index > window.end) return [...point];
    const distance = Math.abs(index - pointIndex);
    const weight = maxDistance === 0
      ? 1
      : Math.cos((distance / (maxDistance + 1)) * Math.PI / 2) ** 2;
    return [
      clamp(point[0] + offset[0] * weight, 0, width),
      clamp(point[1] + offset[1] * weight, 0, height),
      ...point.slice(2),
    ];
  });
}

function mirroredCurveOrderIsReversed(
  sourcePoints: readonly RefinePoint[],
  targetPoints: readonly RefinePoint[],
  axisX: number,
): boolean {
  if (!sourcePoints.length || !targetPoints.length) return false;
  const sourceEnds = [sourcePoints[0]!, sourcePoints[sourcePoints.length - 1]!];
  const directTargets = [targetPoints[0]!, targetPoints[targetPoints.length - 1]!];
  const reverseTargets = [targetPoints[targetPoints.length - 1]!, targetPoints[0]!];
  const score = (targets: readonly RefinePoint[]) => sourceEnds.reduce((sum, point, index) => {
    const target = targets[index]!;
    return sum + Math.hypot(2 * axisX - point[0] - target[0], point[1] - target[1]);
  }, 0);
  return score(reverseTargets) < score(directTargets);
}

/** Mirror only the edit delta, preserving the partner curve's original fit. */
export function applyMirroredCurveDelta(
  sourceOriginal: readonly RefinePoint[],
  sourceCurrent: readonly RefinePoint[],
  targetOriginal: readonly RefinePoint[],
  axisX: number,
  sourceWindow: CurvePointWindow | null = null,
  bounds: RefineBounds = {},
): RefinePoint[] {
  if (!sourceOriginal.length || !sourceCurrent.length || !targetOriginal.length) {
    return targetOriginal.map((point) => [...point]);
  }
  const width = typeof bounds.width === "number" && Number.isFinite(bounds.width) ? bounds.width : Infinity;
  const height = typeof bounds.height === "number" && Number.isFinite(bounds.height) ? bounds.height : Infinity;
  const reversed = mirroredCurveOrderIsReversed(sourceOriginal, targetOriginal, axisX);
  const start = clamp(Math.round(sourceWindow?.start ?? 0), 0, sourceOriginal.length - 1);
  const end = clamp(Math.round(sourceWindow?.end ?? sourceOriginal.length - 1), start, sourceOriginal.length - 1);
  const next: RefinePoint[] = targetOriginal.map((point) => [...point] as RefinePoint);
  for (let sourceIndex = start; sourceIndex <= end; sourceIndex++) {
    const original = sourceOriginal[sourceIndex];
    const current = sourceCurrent[sourceIndex];
    if (!original || !current) continue;
    const position = sourceIndex / Math.max(1, sourceOriginal.length - 1);
    const targetPosition = reversed ? 1 - position : position;
    const targetIndex = Math.round(targetPosition * Math.max(0, targetOriginal.length - 1));
    const target = targetOriginal[targetIndex];
    if (!target) continue;
    next[targetIndex] = [
      clamp(target[0] - (current[0] - original[0]), 0, width),
      clamp(target[1] + (current[1] - original[1]), 0, height),
      ...target.slice(2),
    ] as RefinePoint;
  }
  return next;
}

export function curveEraseTargets(
  lineIndex: number,
  partnerIndex: number | null | undefined,
  symmetryEnabled: boolean,
): number[] {
  const targets: number[] = [lineIndex];
  if (symmetryEnabled && typeof partnerIndex === "number"
      && Number.isInteger(partnerIndex) && partnerIndex !== lineIndex) {
    targets.push(partnerIndex);
  }
  return [...new Set(targets.filter(Number.isInteger))];
}

function mirroredRefineLineName(name = ""): string {
  if (name.includes("_left_")) return name.replace("_left_", "_right_");
  if (name.includes("_right_")) return name.replace("_right_", "_left_");
  if (name.endsWith("_l")) return `${name.slice(0, -2)}_r`;
  if (name.endsWith("_r")) return `${name.slice(0, -2)}_l`;
  if (name.includes("left")) return name.replace("left", "right");
  if (name.includes("right")) return name.replace("right", "left");
  return "";
}

/** Resolve only declared symmetry pairs; never guess from spatial proximity. */
export function explicitSymmetryPartnerIndex(
  lines: readonly RefineLine[] | null | undefined,
  lineIndex: number,
): number | null {
  const line = lines?.[lineIndex];
  if (!line || line.hidden || line.symmetryRole === "midline" || line.symmetryRole === "bilateral") {
    return null;
  }
  if (line.symmetryPairId) {
    const byPairId = lines?.findIndex((candidate, index) => (
      index !== lineIndex
      && !candidate.hidden
      && candidate.symmetryPairId === line.symmetryPairId
    ));
    if (typeof byPairId === "number" && byPairId >= 0) return byPairId;
  }
  const mirroredName = mirroredRefineLineName(line.name);
  if (!mirroredName) return null;
  const byName = lines?.findIndex((candidate, index) => (
    index !== lineIndex && !candidate.hidden && candidate.name === mirroredName
  ));
  return typeof byName === "number" && byName >= 0 ? byName : null;
}
