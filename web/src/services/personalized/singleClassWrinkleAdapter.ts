import type { FineWrinkleLine } from "./fineWrinkleLines.ts";

type Point = readonly [number, number];
type Landmark = readonly number[];

export type AnatomicalWrinkleClass = "forehead" | "frown" | "wrinkle";

export interface SingleClassWrinkleAdapterOptions {
  minimumCoverage?: number;
  noseHalfWidthRatio?: number;
}

export interface SingleClassWrinkleAdapterResult {
  lines: Array<FineWrinkleLine & { class: AnatomicalWrinkleClass }>;
  rejectedLineCount: number;
  lineCountByClass: Record<AnatomicalWrinkleClass, number>;
}

interface ClassifiedWrinkleLine {
  class: string;
  points: readonly Point[];
}

const LEFT_FACE_EDGE = 234;
const RIGHT_FACE_EDGE = 454;
const FOREHEAD_TOP = 10;
const FOREHEAD_BROW_INDICES = [9, 8, 107, 336, 55, 65, 285, 295];
const NOSE_ROOT = 168;
const NOSE_BRIDGE = 6;
const NOSE_LOWER_BRIDGE = 195;
const NOSE_TIP = 5;

function point(landmarks: readonly Landmark[], index: number): Point | null {
  const value = landmarks[index];
  return value && Number.isFinite(value[0]) && Number.isFinite(value[1])
    ? [Number(value[0]), Number(value[1])] : null;
}

function mean(points: readonly Point[]): Point | null {
  if (!points.length) return null;
  return [
    points.reduce((sum, value) => sum + value[0], 0) / points.length,
    points.reduce((sum, value) => sum + value[1], 0) / points.length,
  ];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function segmentPoint(y: number, axis: readonly Point[]): Point {
  if (y <= axis[0][1]) return axis[0];
  for (let index = 1; index < axis.length; index += 1) {
    const before = axis[index - 1];
    const after = axis[index];
    if (y > after[1] && index < axis.length - 1) continue;
    const span = after[1] - before[1];
    const fraction = span > 0 ? Math.max(0, Math.min(1, (y - before[1]) / span)) : 0;
    return [before[0] + (after[0] - before[0]) * fraction, y];
  }
  return axis[axis.length - 1];
}

function lineCoverage(points: readonly Point[], predicate: (point: Point) => boolean): number {
  return points.length ? points.filter(predicate).length / points.length : 0;
}

function classifyLine(
  points: readonly Point[],
  landmarks: readonly Landmark[],
  options: Required<SingleClassWrinkleAdapterOptions>,
): AnatomicalWrinkleClass | null {
  if (points.length < 2) return null;
  const leftEdge = point(landmarks, LEFT_FACE_EDGE);
  const rightEdge = point(landmarks, RIGHT_FACE_EDGE);
  const top = point(landmarks, FOREHEAD_TOP);
  const brow = mean(FOREHEAD_BROW_INDICES
    .map((index) => point(landmarks, index))
    .filter((value): value is Point => Boolean(value)));
  const root = point(landmarks, NOSE_ROOT);
  const bridge = [NOSE_ROOT, NOSE_BRIDGE, NOSE_LOWER_BRIDGE, NOSE_TIP]
    .map((index) => point(landmarks, index)).filter((value): value is Point => Boolean(value))
    .sort((a, b) => a[1] - b[1]);
  if (!leftEdge || !rightEdge || !top || !brow || !root || bridge.length < 3) return null;
  const faceWidth = Math.abs(rightEdge[0] - leftEdge[0]);
  if (!(faceWidth > 0)) return null;
  const faceMinX = Math.min(leftEdge[0], rightEdge[0]);
  const faceMaxX = Math.max(leftEdge[0], rightEdge[0]);
  const center = mean(points)!;

  // Nose dorsum is deliberately strict: every retained line point must stay
  // in the narrow center band around the landmark-defined bridge polyline.
  const noseUpper = bridge[0][1] - faceWidth * 0.035;
  const noseLower = bridge[bridge.length - 1][1] + faceWidth * 0.02;
  const noseHalfWidth = faceWidth * options.noseHalfWidthRatio;
  const inNose = (value: Point): boolean => {
    if (value[1] < noseUpper || value[1] > noseLower) return false;
    const axisPoint = segmentPoint(value[1], bridge);
    return Math.abs(value[0] - axisPoint[0]) <= noseHalfWidth;
  };
  if (lineCoverage(points, inNose) >= options.minimumCoverage) return "wrinkle";

  // Glabellar lines sit below the brows and above the nasal root, close to the
  // face centre. This excludes the lateral eye and cheek regions.
  const glabellarTop = brow[1] - faceWidth * 0.015;
  const glabellarBottom = root[1] + faceWidth * 0.12;
  const glabellarHalfWidth = faceWidth * 0.19;
  const inFrown = (value: Point): boolean =>
    value[1] >= glabellarTop && value[1] <= glabellarBottom
      && Math.abs(value[0] - root[0]) <= glabellarHalfWidth;
  const spanX = Math.max(...points.map((value) => value[0]))
    - Math.min(...points.map((value) => value[0]));
  const spanY = Math.max(...points.map((value) => value[1]))
    - Math.min(...points.map((value) => value[1]));
  // The lower forehead can overlap the landmark-defined glabellar band after
  // runtime RSTL spacing changes. Keep horizontal furrows in the forehead
  // channel; only predominantly vertical lines belong to the frown channel.
  const predominantlyVertical = spanY > Math.max(4, spanX * 0.75);
  if (predominantlyVertical && lineCoverage(points, inFrown) >= options.minimumCoverage) {
    return "frown";
  }

  // Forehead lines are above the brow anchor and inside the face outline. Use
  // a slightly wider vertical margin to tolerate bangs and side poses.
  const foreheadTop = top[1] - faceWidth * 0.04;
  const foreheadBottom = brow[1] + faceWidth * 0.015;
  const inForehead = (value: Point): boolean =>
    value[1] >= foreheadTop && value[1] <= foreheadBottom
      && value[0] >= faceMinX - faceWidth * 0.03
      && value[0] <= faceMaxX + faceWidth * 0.03;
  if (lineCoverage(points, inForehead) >= options.minimumCoverage) return "forehead";

  // A line whose centre is in the nose band but has too many points outside it
  // is intentionally rejected rather than being treated as a nose wrinkle.
  if (center[1] >= noseUpper && center[1] <= noseLower && inNose(center)) return null;
  return null;
}

/**
 * Route generic YOLO `wrinkle` centerlines into the anatomical channels when
 * their geometry is sufficiently distinctive.  Multi-class checkpoints can
 * emit a generic wrinkle label for a central vertical frown line; leaving that
 * label untouched makes the line visible in the preview but excludes it from
 * the glabellar guidance channel.  Explicit forehead/frown labels are kept
 * unchanged by the caller.
 */
export function routeGenericWrinkleLines<T extends FineWrinkleLine>(
  lines: readonly T[],
  landmarks: readonly Landmark[] | null | undefined,
  options: SingleClassWrinkleAdapterOptions = {},
): { lines: T[]; reclassifiedForeheadCount: number; reclassifiedFrownCount: number } {
  const minimumCoverage = Math.max(0.5, Math.min(1, options.minimumCoverage ?? 0.65));
  const noseHalfWidthRatio = Math.max(0.04, Math.min(0.2, options.noseHalfWidthRatio ?? 0.105));
  if (!landmarks?.length) {
    return { lines: [...lines], reclassifiedForeheadCount: 0, reclassifiedFrownCount: 0 };
  }
  let reclassifiedForeheadCount = 0;
  let reclassifiedFrownCount = 0;
  const routed = lines.map((line) => {
    if (line.class !== "wrinkle") return line;
    let anatomicalClass: AnatomicalWrinkleClass | null = null;
    try {
      anatomicalClass = classifyLine(line.points, landmarks, {
        minimumCoverage,
        noseHalfWidthRatio,
      });
    } catch {
      // A malformed component must remain visible as a generic wrinkle and
      // must never terminate the worker's entire detection request.
      return line;
    }
    if (anatomicalClass === "forehead") {
      reclassifiedForeheadCount += 1;
      return { ...line, class: anatomicalClass };
    }
    if (anatomicalClass === "frown") {
      reclassifiedFrownCount += 1;
      return { ...line, class: anatomicalClass };
    }
    return line;
  });
  return { lines: routed, reclassifiedForeheadCount, reclassifiedFrownCount };
}

export function classifySingleClassWrinkleLines<T extends FineWrinkleLine>(
  lines: readonly T[],
  landmarks: readonly Landmark[] | null | undefined,
  options: SingleClassWrinkleAdapterOptions = {},
): SingleClassWrinkleAdapterResult {
  const output: Array<T & { class: AnatomicalWrinkleClass }> = [];
  const counts: Record<AnatomicalWrinkleClass, number> = { forehead: 0, frown: 0, wrinkle: 0 };
  const minimumCoverage = Math.max(0.5, Math.min(1, options.minimumCoverage ?? 0.65));
  const noseHalfWidthRatio = Math.max(0.04, Math.min(0.2, options.noseHalfWidthRatio ?? 0.105));
  if (!landmarks?.length) return { lines: [], rejectedLineCount: lines.length, lineCountByClass: counts };
  for (const line of lines) {
    const anatomicalClass = classifyLine(line.points, landmarks, {
      minimumCoverage,
      noseHalfWidthRatio,
    });
    if (!anatomicalClass) continue;
    output.push({ ...line, class: anatomicalClass });
    counts[anatomicalClass] += 1;
  }
  return {
    lines: output,
    rejectedLineCount: lines.length - output.length,
    lineCountByClass: counts,
  };
}

/**
 * Keep horizontal lower-forehead furrows out of the glabellar guidance channel
 * even when a multi-class detector labels them as frown lines.
 */
export function normalizeHorizontalForeheadGuidanceLines<T extends ClassifiedWrinkleLine>(
  lines: readonly T[],
  landmarks?: readonly Landmark[] | null,
): T[] {
  const leftEdge = landmarks?.[LEFT_FACE_EDGE];
  const rightEdge = landmarks?.[RIGHT_FACE_EDGE];
  const top = landmarks?.[FOREHEAD_TOP];
  const brow = landmarks ? mean(FOREHEAD_BROW_INDICES
    .map((index) => point(landmarks, index))
    .filter((value): value is Point => Boolean(value))) : null;
  const faceWidth = leftEdge && rightEdge ? Math.abs(
    Number(rightEdge![0]) - Number(leftEdge![0]),
  ) : 0;
  const foreheadBand = faceWidth > 0 && top && brow ? {
    top: Number(top[1]) - faceWidth * 0.04,
    bottom: Number(brow[1]) + faceWidth * 0.02,
    minX: Math.min(Number(leftEdge![0]), Number(rightEdge![0])) - faceWidth * 0.03,
    maxX: Math.max(Number(leftEdge![0]), Number(rightEdge![0])) + faceWidth * 0.03,
  } : null;
  return lines.map((line) => {
    if (line.class !== "frown" || line.points.length < 2) return line;
    const spanX = Math.max(...line.points.map((point) => point[0]))
      - Math.min(...line.points.map((point) => point[0]));
    const spanY = Math.max(...line.points.map((point) => point[1]))
      - Math.min(...line.points.map((point) => point[1]));
    const horizontalEnough = spanX >= Math.max(8, spanY * 0.55);
    const foreheadCoverage = foreheadBand ? line.points.filter((value) =>
      value[1] >= foreheadBand.top && value[1] <= foreheadBand.bottom &&
      value[0] >= foreheadBand.minX && value[0] <= foreheadBand.maxX,
    ).length / line.points.length : 0;
    // Multi-class models occasionally call a curved lower forehead furrow
    // "frown". Only a line with a horizontal trend can be moved to the
    // forehead channel; a predominantly vertical frown must stay glabellar
    // even when its upper portion overlaps the forehead landmark band.
    if (!horizontalEnough) return line;
    // Landmark-relative coverage is the tie-breaker for horizontal lines;
    // shape alone is too brittle after the forehead RSTL spacing changes.
    if (foreheadCoverage < 0.55) return line;
    return { ...line, class: "forehead" };
  });
}

export function hasSingleClassWrinkleMask(classMasks: Record<string, ArrayLike<number>> | null | undefined): boolean {
  return Boolean(classMasks?.wrinkled && !classMasks.forehead && !classMasks.frown && !classMasks.wrinkle);
}
