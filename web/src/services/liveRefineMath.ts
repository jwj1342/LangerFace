export type RefinePoint = [number, number, ...number[]];

export interface RefineLine {
  name?: string;
  pts: RefinePoint[];
  region?: string;
  symmetryRole?: string;
  symmetryPairId?: string;
  tris?: number[];
  hidden?: boolean;
}

export interface CurveRefinementTransportLine {
  name: string;
  hidden: boolean;
  offsets: Array<[number, number]>;
}

export interface CurveRefinementTransport {
  baseScale: number;
  lines: CurveRefinementTransportLine[];
  system?: string;
  committedAt?: string;
}

export interface RefineBounds {
  width?: number;
  height?: number;
  globalFollow?: number;
  spread?: number;
}

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

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
    lines.push({ name: automatic.name || "", hidden: Boolean(refined.hidden), offsets });
  }
  return { baseScale: lineSetScale(autoLines), lines };
}

/** Apply a frozen-frame refinement to the corresponding curves on a live frame. */
export function applyCurveRefinementTransport<T extends RefineLine>(
  mappedLines: readonly T[],
  transport: CurveRefinementTransport | null | undefined,
  bounds: RefineBounds = {},
): T[] {
  if (!transport?.lines?.length) return [...mappedLines];
  const byName = new Map(transport.lines.map((line) => [line.name, line]));
  const scale = clamp(lineSetScale(mappedLines) / Math.max(1, transport.baseScale || 1), 0.45, 2.4);
  const width = typeof bounds.width === "number" && Number.isFinite(bounds.width) ? bounds.width : Infinity;
  const height = typeof bounds.height === "number" && Number.isFinite(bounds.height) ? bounds.height : Infinity;
  return (mappedLines || []).map((line) => {
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
    return { ...line, hidden: template.hidden, pts: points } as T;
  });
}

/**
 * Curve-wide deformation for the manual 2D editor.
 * The grabbed point follows the pointer exactly while every other point receives
 * a smooth arc-length falloff. A small global component prevents a rigid kink.
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
  const width = typeof bounds.width === "number" && Number.isFinite(bounds.width) ? bounds.width : Infinity;
  const height = typeof bounds.height === "number" && Number.isFinite(bounds.height) ? bounds.height : Infinity;
  const globalFollow = clamp(bounds.globalFollow ?? 0.14, 0, 0.5);
  const spread = clamp(bounds.spread ?? 0.28, 0.12, 0.6);
  const positions = normalizedArcPositions(points);
  const anchor = points[anchorIndex];
  const anchorPosition = positions[anchorIndex] ?? 0;
  const dx = target[0] - anchor[0];
  const dy = target[1] - anchor[1];

  return points.map((point, index) => {
    const distance = Math.abs((positions[index] ?? 0) - anchorPosition);
    const local = Math.exp(-0.5 * (distance / spread) ** 2);
    const weight = globalFollow + (1 - globalFollow) * local;
    const nextPoint: RefinePoint = [
      clamp(point[0] + dx * weight, 0, width),
      clamp(point[1] + dy * weight, 0, height),
      ...point.slice(2),
    ];
    return nextPoint;
  });
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
