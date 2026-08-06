/**
 * Browser-ready wrinkle-guided RSTL V6 refinement.
 *
 * The module is deliberately data-only: no DOM, camera, network, or Node APIs.
 * It consumes a binary wrinkle mask in the same canonical 2D coordinate space
 * as the supplied curves and returns a fixed-connectivity curve set.
 */

export const V6_RSTL_ALGORITHM =
  "interval-guarded-continuous-polyline-rstl-refinement-6.1";

const SOFT_LINK_FACE_RATIO = 0.013;
const PARALLEL_DEDUP_FACE_RATIO = 0.006;
// Keep P90 protection local to each affected curve interval, but avoid
// collapsing valid wrinkle-driven offsets on small canonical faces.
const P90_FACE_RATIO = 0.010;
const SEARCH_FACE_RATIO = 0.030;
const TRANSITION_FACE_RATIO = 0.020;
const MAX_DISPLACEMENT_FACE_RATIO = 0.020;
const DIRECTION_TOLERANCE_DEGREES = 40;
const SOFT_LINK_TURN_DEGREES = 35;
const EPSILON = 1e-8;

type Point2 = [number, number];
type NumericField = ArrayLike<number>;
type Interval = [number, number];

export interface V6Seed {
  name?: string;
  region?: string;
  pts?: unknown;
  points_xy?: unknown;
  priorPts?: unknown;
  [key: string]: unknown;
}

export interface V6RefinementOptions {
  [key: string]: any;
  parallelDedupRadiusPx?: number;
  softLinkDistancePx?: number;
  tangentWindowPx?: number;
  searchRadiusPx?: number;
  directionToleranceDegrees?: number;
  minimumMatchScore?: number;
  transitionLengthPx?: number;
  maxDisplacementPx?: number;
  p90LimitPx?: number;
  smoothingPasses?: number;
  maxCurvatureChangeDegrees?: number;
}

interface PolylineMetrics {
  arc: Float64Array;
  directArc: Float64Array;
  tangents: Point2[];
  length: number;
  directLength: number;
}

interface Trend {
  points: Point2[];
  sourcePathCount: number;
  softLinkCount: number;
  metrics: PolylineMetrics;
}

interface CurveSegment {
  index: number;
  start: Point2;
  dx: number;
  dy: number;
  length: number;
  lengthSquared: number;
  tangent: Point2;
  normal: Point2;
  arcStart: number;
}

interface CurveGeometry {
  seed: V6Seed;
  prior: Point2[];
  normals: Point2[];
  vertexArc: Float64Array;
  segments: CurveSegment[];
}

interface MatchRecord {
  trendIndex: number;
  pointOrder: number;
  curveIndex: number;
  score: number;
  alignment: number;
  distance: number;
  confidence: number;
  normalOffset: number;
  projectionArc: number;
  directArc: number;
}

interface MatchGroup {
  trendIndex: number;
  curveIndex: number;
  records: MatchRecord[];
  directLength: number;
  coverage: number;
  influence: number;
  meanDistance: number;
  projectionArcStart: number;
  projectionArcEnd: number;
  summary: Record<string, any>;
}

interface MatchingResult {
  acceptedGroups: MatchGroup[];
  supportedGroups: MatchGroup[];
  curveSupportRecords: Array<Record<string, number | boolean | string>>;
  groupRecords: Array<Record<string, any>>;
  bandRadius: number;
  candidatePairCount: number;
  directionRejectedPairCount: number;
}

interface CurveRefineResult {
  curve: CurveGeometry;
  offsets: Float64Array;
  intervals: Interval[];
  points: Point2[];
  supportScore: number;
  rollbackReason: string | null;
}

interface RefinedState {
  [key: string]: any;
  results: any[];
  guardEvents: any[];
  anchorGuardEvents: any[];
  bundleRecords: any[];
  bundleSpacingGuardEvents: any[];
  bundleSpacingFailedAnchorPairs: Set<string>;
}

export interface RefineV6Input {
  seeds: V6Seed[];
  wrinkleMask: NumericField;
  confidenceMap?: NumericField | null;
  directionQ?: NumericField | null;
  size: number;
  faceWidthPx: number;
  options?: V6RefinementOptions;
}

const clamp = (value: number, lower = 0, upper = 1): number =>
  Math.max(lower, Math.min(upper, value));

const finitePoint = (point: unknown): point is Point2 => Array.isArray(point) && point.length >= 2 &&
  Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));

function normalize2(x: number, y: number): Point2 {
  const length = Math.hypot(x, y);
  return length > EPSILON ? [x / length, y / length] : [0, 0];
}

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(fraction) * (sorted.length - 1);
  const lower = Math.floor(position), upper = Math.ceil(position);
  const mix = position - lower;
  return sorted[lower] * (1 - mix) + sorted[upper] * mix;
}

function fieldLength(field: NumericField | null | undefined): number {
  return field && Number.isFinite(field.length) ? field.length : 0;
}

function normalizeScalarField(
  field: NumericField | null | undefined,
  length: number,
  fallback = 0,
): Float32Array {
  const output = new Float32Array(length);
  if (!field || fieldLength(field) !== length) {
    if (fallback !== 0) output.fill(fallback);
    return output;
  }
  let maximum = 0;
  for (let index = 0; index < length; index += 1) {
    const value = Number(field[index]);
    if (Number.isFinite(value)) maximum = Math.max(maximum, value);
  }
  const scale = maximum > 1.5 ? 1 / 255 : 1;
  for (let index = 0; index < length; index += 1) {
    const value = Number(field[index]);
    output[index] = Number.isFinite(value) ? clamp(value * scale) : fallback;
  }
  return output;
}

function normalizeMask(mask: NumericField | null | undefined, length: number): Uint8Array {
  if (!mask || fieldLength(mask) !== length) {
    throw new Error(`wrinkleMask length must be ${length}`);
  }
  const output = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = Number(mask[index]) > 0 ? 1 : 0;
  }
  return output;
}

function maskNeedsThinning(mask: Uint8Array, size: number): boolean {
  for (let y = 0; y < size - 1; y += 1) {
    const row = y * size;
    for (let x = 0; x < size - 1; x += 1) {
      const index = row + x;
      if (mask[index] && mask[index + 1] &&
          mask[index + size] && mask[index + size + 1]) return true;
    }
  }
  return false;
}

function neighbourBits(mask: Uint8Array, x: number, y: number, size: number): number[] {
  const index = y * size + x;
  return [
    mask[index - size], mask[index - size + 1], mask[index + 1],
    mask[index + size + 1], mask[index + size], mask[index + size - 1],
    mask[index - 1], mask[index - size - 1],
  ];
}

/** Zhang-Suen thinning. Called only for masks containing a true 2x2 interior. */
function skeletonize(mask: Uint8Array, size: number): Uint8Array {
  let current = new Uint8Array(mask);
  const remove = new Uint8Array(mask.length);
  let changed = true, iteration = 0;
  const maximumIterations = Math.max(32, size * 2);
  while (changed && iteration < maximumIterations) {
    changed = false;
    iteration += 1;
    for (let phase = 0; phase < 2; phase += 1) {
      remove.fill(0);
      for (let y = 1; y < size - 1; y += 1) {
        for (let x = 1; x < size - 1; x += 1) {
          const index = y * size + x;
          if (!current[index]) continue;
          const p = neighbourBits(current, x, y, size);
          const neighbours = p.reduce((sum, value) => sum + value, 0);
          if (neighbours < 2 || neighbours > 6) continue;
          let transitions = 0;
          for (let k = 0; k < 8; k += 1) {
            if (!p[k] && p[(k + 1) % 8]) transitions += 1;
          }
          if (transitions !== 1) continue;
          const first = phase === 0 ? p[0] * p[2] * p[4] : p[0] * p[2] * p[6];
          const second = phase === 0 ? p[2] * p[4] * p[6] : p[0] * p[4] * p[6];
          if (first || second) continue;
          remove[index] = 1;
        }
      }
      for (let index = 0; index < current.length; index += 1) {
        if (!remove[index]) continue;
        current[index] = 0;
        changed = true;
      }
    }
  }
  return current;
}

function pixelNeighbours(index: number, mask: Uint8Array, size: number): number[] {
  const x = index % size, y = Math.floor(index / size);
  const neighbours: number[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if ((!dx && !dy) || x + dx < 0 || y + dy < 0 ||
          x + dx >= size || y + dy >= size) continue;
      const next = (y + dy) * size + x + dx;
      if (!mask[next]) continue;
      // Suppress diagonal graph edges when an orthogonal route already exists.
      if (dx && dy && (mask[y * size + x + dx] || mask[(y + dy) * size + x])) continue;
      neighbours.push(next);
    }
  }
  return neighbours;
}

const edgeKey = (first: number, second: number): string => first < second
  ? `${first}:${second}` : `${second}:${first}`;

function orderedSkeletonPaths(skeleton: Uint8Array, size: number): Point2[][] {
  const adjacency = new Map<number, number[]>();
  for (let index = 0; index < skeleton.length; index += 1) {
    if (skeleton[index]) adjacency.set(index, pixelNeighbours(index, skeleton, size));
  }
  const visited = new Set<string>(), paths: Point2[][] = [];
  const trace = (start: number, next: number): Point2[] => {
    const indices = [start];
    let previous = start, current = next;
    visited.add(edgeKey(previous, current));
    while (true) {
      indices.push(current);
      const candidates = (adjacency.get(current) || []).filter((item) => item !== previous);
      if ((adjacency.get(current) || []).length !== 2 || !candidates.length) break;
      const following = candidates[0];
      const key = edgeKey(current, following);
      if (visited.has(key)) break;
      visited.add(key);
      previous = current;
      current = following;
    }
    return indices.map((index) => [index % size, Math.floor(index / size)] as Point2);
  };

  for (const [index, neighbours] of adjacency) {
    if (neighbours.length === 2) continue;
    for (const next of neighbours) {
      if (!visited.has(edgeKey(index, next))) paths.push(trace(index, next));
    }
  }
  for (const [index, neighbours] of adjacency) {
    for (const next of neighbours) {
      if (!visited.has(edgeKey(index, next))) paths.push(trace(index, next));
    }
  }
  return paths.filter((path) => path.length >= 2);
}

function endpointDirection(path: Point2[], endpoint: number, sampleSpan = 4): Point2 {
  if (endpoint === 0) {
    const inside = path[Math.min(path.length - 1, sampleSpan)];
    return normalize2(path[0][0] - inside[0], path[0][1] - inside[1]);
  }
  const last = path.length - 1;
  const inside = path[Math.max(0, last - sampleSpan)];
  return normalize2(path[last][0] - inside[0], path[last][1] - inside[1]);
}

function mergeTrendPaths(
  paths: Point2[][],
  maximumGap: number,
  maximumTurnDegrees = SOFT_LINK_TURN_DEGREES,
  endpointSampleSpan = 4,
): Array<Omit<Trend, "metrics">> {
  interface EndpointInfo {
    pathIndex: number;
    endpoint: number;
    point: Point2;
    outward: Point2;
    soft?: boolean;
    gap?: number;
  }
  const endpointInfo = new Map<string, EndpointInfo>();
  paths.forEach((path, pathIndex) => {
    endpointInfo.set(`${pathIndex}:0`, { pathIndex, endpoint: 0,
      point: path[0], outward: endpointDirection(path, 0, endpointSampleSpan) });
    endpointInfo.set(`${pathIndex}:1`, { pathIndex, endpoint: 1,
      point: path[path.length - 1], outward: endpointDirection(path, 1, endpointSampleSpan) });
  });
  const cosine = Math.cos(maximumTurnDegrees * Math.PI / 180);
  const endpoints = [...endpointInfo.values()];
  const candidates: Array<{
    score: number; first: EndpointInfo; second: EndpointInfo; gap: number; soft: boolean;
  }> = [];
  for (let firstIndex = 0; firstIndex < endpoints.length; firstIndex += 1) {
    const first = endpoints[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < endpoints.length; secondIndex += 1) {
      const second = endpoints[secondIndex];
      if (first.pathIndex === second.pathIndex) continue;
      const dx = second.point[0] - first.point[0];
      const dy = second.point[1] - first.point[1];
      const gap = Math.hypot(dx, dy);
      if (gap > maximumGap || gap < EPSILON) continue;
      const gx = dx / gap, gy = dy / gap;
      const continuity = -(first.outward[0] * second.outward[0] +
        first.outward[1] * second.outward[1]);
      const firstAlignment = first.outward[0] * gx + first.outward[1] * gy;
      const secondAlignment = -(second.outward[0] * gx + second.outward[1] * gy);
      if (continuity < cosine || firstAlignment < cosine || secondAlignment < cosine) continue;
      const score = continuity + firstAlignment + secondAlignment - 0.25 * gap / maximumGap;
      candidates.push({ score, first, second, gap, soft: gap > 1.5 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const links = new Map<string, EndpointInfo>();
  for (const candidate of candidates) {
    const firstKey = `${candidate.first.pathIndex}:${candidate.first.endpoint}`;
    const secondKey = `${candidate.second.pathIndex}:${candidate.second.endpoint}`;
    if (links.has(firstKey) || links.has(secondKey)) continue;
    links.set(firstKey, { ...candidate.second, soft: candidate.soft, gap: candidate.gap });
    links.set(secondKey, { ...candidate.first, soft: candidate.soft, gap: candidate.gap });
  }

  const merged: Array<Omit<Trend, "metrics">> = [];
  const visitedPaths = new Set<number>();
  for (let seed = 0; seed < paths.length; seed += 1) {
    if (visitedPaths.has(seed)) continue;
    let entry = links.has(`${seed}:0`) && !links.has(`${seed}:1`) ? 1 : 0;
    let current = seed, points: Point2[] = [], sourcePathCount = 0, softLinkCount = 0;
    while (!visitedPaths.has(current)) {
      visitedPaths.add(current);
      sourcePathCount += 1;
      const oriented = entry === 0 ? paths[current] : [...paths[current]].reverse();
      if (points.length && Math.hypot(
        points[points.length - 1][0] - oriented[0][0],
        points[points.length - 1][1] - oriented[0][1],
      ) < 0.25) points.push(...oriented.slice(1));
      else points.push(...oriented);
      const exit = 1 - entry;
      const following = links.get(`${current}:${exit}`);
      if (!following || visitedPaths.has(following.pathIndex)) break;
      if (following.soft) softLinkCount += 1;
      current = following.pathIndex;
      entry = following.endpoint;
    }
    if (points.length >= 2) merged.push({ points, sourcePathCount, softLinkCount });
  }
  return merged;
}

function qDirectionAt(
  directionQ: NumericField | null | undefined,
  point: Point2,
  size: number,
): Point2 {
  if (!directionQ || fieldLength(directionQ) !== size * size * 2) return [0, 0];
  const x = clamp(Math.round(point[0]), 0, size - 1);
  const y = clamp(Math.round(point[1]), 0, size - 1);
  const index = (y * size + x) * 2;
  const qx = Number(directionQ[index]) || 0, qy = Number(directionQ[index + 1]) || 0;
  if (Math.hypot(qx, qy) < 1e-6) return [0, 0];
  const angle = 0.5 * Math.atan2(qy, qx);
  return [Math.cos(angle), Math.sin(angle)];
}

function suppressParallelDuplicateSkeleton(
  skeleton: Uint8Array,
  confidence: NumericField,
  directionQ: NumericField | null | undefined,
  size: number,
  radiusPixels: number,
): { skeleton: Uint8Array; removed: number } {
  const output = new Uint8Array(skeleton);
  const radius = Math.max(1, Math.round(radiusPixels));
  const cosine = Math.cos(22 * Math.PI / 180);
  let removed = 0;
  for (let index = 0; index < skeleton.length; index += 1) {
    if (!skeleton[index] || !output[index]) continue;
    const x = index % size, y = Math.floor(index / size);
    const tangent = qDirectionAt(directionQ, [x, y], size);
    if (!(tangent[0] || tangent[1])) continue;
    const normal = [-tangent[1], tangent[0]];
    const score = Number(confidence?.[index] || 0);
    let suppress = false;
    for (let sign = -1; sign <= 1 && !suppress; sign += 2) {
      for (let distance = 1; distance <= radius; distance += 1) {
        const xx = Math.round(x + sign * normal[0] * distance);
        const yy = Math.round(y + sign * normal[1] * distance);
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const candidate = yy * size + xx;
        if (candidate === index || !skeleton[candidate]) continue;
        const other = qDirectionAt(directionQ, [xx, yy], size);
        if (!(other[0] || other[1]) || Math.abs(tangent[0] * other[0] + tangent[1] * other[1]) < cosine) continue;
        const otherScore = Number(confidence?.[candidate] || 0);
        if (otherScore > score + 1e-6 || (Math.abs(otherScore - score) <= 1e-6 && candidate < index)) {
          suppress = true;
          break;
        }
      }
    }
    if (suppress) {
      output[index] = 0;
      removed += 1;
    }
  }
  return { skeleton: output, removed };
}

function polylineMetrics(
  points: Point2[],
  tangentWindowPixels: number,
  directionQ: NumericField | null = null,
  size = 0,
): PolylineMetrics {
  const steps: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    steps.push(Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    ));
  }
  const arc = new Float64Array(points.length), directArc = new Float64Array(points.length);
  for (let index = 1; index < points.length; index += 1) {
    arc[index] = arc[index - 1] + steps[index - 1];
    directArc[index] = directArc[index - 1] + (steps[index - 1] <= 1.5 ? steps[index - 1] : 0);
  }
  const tangents: Point2[] = Array.from({ length: points.length }, () => [0, 0]);
  const halfWindow = Math.max(1, tangentWindowPixels * 0.5);
  for (let index = 0; index < points.length; index += 1) {
    let before = index, after = index;
    while (before > 0 && arc[index] - arc[before] < halfWindow) before -= 1;
    while (after < points.length - 1 && arc[after] - arc[index] < halfWindow) after += 1;
    let tangent = normalize2(
      points[after][0] - points[before][0], points[after][1] - points[before][1],
    );
    const field = qDirectionAt(directionQ, points[index], size);
    if (field[0] || field[1]) {
      if (field[0] * tangent[0] + field[1] * tangent[1] < 0) {
        field[0] *= -1; field[1] *= -1;
      }
      tangent = normalize2(0.4 * tangent[0] + 0.6 * field[0],
        0.4 * tangent[1] + 0.6 * field[1]);
    }
    tangents[index] = tangent;
  }
  return {
    arc, directArc, tangents,
    length: arc[arc.length - 1] || 0,
    directLength: directArc[directArc.length - 1] || 0,
  };
}

function confidenceAt(confidence: NumericField, point: Point2, size: number): number {
  const x = clamp(Math.round(point[0]), 0, size - 1);
  const y = clamp(Math.round(point[1]), 0, size - 1);
  return confidence[y * size + x] || 0;
}

function curvePriorPoints(seed: V6Seed): Point2[] {
  const source = seed?.pts || seed?.points_xy || seed?.priorPts || [];
  if (!Array.isArray(source) || source.length < 2 || !source.every(finitePoint)) {
    throw new Error("Every seed must contain at least two finite pts");
  }
  return source.map((point) => [Number(point[0]), Number(point[1])]);
}

function buildCurveGeometry(seed: V6Seed, tangentWindowPixels: number): CurveGeometry {
  const prior = curvePriorPoints(seed);
  const metrics = polylineMetrics(prior, tangentWindowPixels);
  const normals: Point2[] = metrics.tangents.map((tangent) => [-tangent[1], tangent[0]]);
  const segments: CurveSegment[] = [];
  for (let index = 0; index < prior.length - 1; index += 1) {
    const dx = prior[index + 1][0] - prior[index][0];
    const dy = prior[index + 1][1] - prior[index][1];
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) continue;
    const tangent: Point2 = [dx / length, dy / length];
    segments.push({
      index, start: prior[index], dx, dy, length, lengthSquared: length * length,
      tangent, normal: [-tangent[1], tangent[0]], arcStart: metrics.arc[index],
    });
  }
  return { seed, prior, normals, vertexArc: metrics.arc, segments };
}

function matchTrendsToCurves(
  trends: Trend[],
  curves: CurveGeometry[],
  confidence: NumericField,
  size: number,
  faceWidth: number,
  options: V6RefinementOptions,
): MatchingResult {
  const bandRadius = options.searchRadiusPx ?? Math.max(3, SEARCH_FACE_RATIO * faceWidth);
  const normalScale = Math.max(2, bandRadius * 0.45);
  const directionCosine = Math.cos(
    (options.directionToleranceDegrees ?? DIRECTION_TOLERANCE_DEGREES) * Math.PI / 180,
  );
  const groups = new Map<string, MatchRecord[]>();
  let candidatePairCount = 0, directionRejectedPairCount = 0;
  for (let trendIndex = 0; trendIndex < trends.length; trendIndex += 1) {
    const trend = trends[trendIndex];
    const metrics = trend.metrics;
    for (let pointOrder = 0; pointOrder < trend.points.length; pointOrder += 1) {
      const point = trend.points[pointOrder], wrinkleTangent = metrics.tangents[pointOrder];
      const wrinkleConfidence = confidenceAt(confidence, point, size);
      if (!(wrinkleConfidence > 0) || !(wrinkleTangent[0] || wrinkleTangent[1])) continue;
      for (let curveIndex = 0; curveIndex < curves.length; curveIndex += 1) {
        let best: MatchRecord | null = null;
        for (const segment of curves[curveIndex].segments) {
          const fromX = point[0] - segment.start[0];
          const fromY = point[1] - segment.start[1];
          const fraction = clamp((fromX * segment.dx + fromY * segment.dy) /
            segment.lengthSquared);
          const projection = [segment.start[0] + fraction * segment.dx,
            segment.start[1] + fraction * segment.dy];
          const deltaX = point[0] - projection[0], deltaY = point[1] - projection[1];
          const distance = Math.hypot(deltaX, deltaY);
          if (distance > bandRadius) continue;
          candidatePairCount += 1;
          const alignment = Math.abs(segment.tangent[0] * wrinkleTangent[0] +
            segment.tangent[1] * wrinkleTangent[1]);
          if (alignment < directionCosine) {
            directionRejectedPairCount += 1;
            continue;
          }
          const score = wrinkleConfidence * alignment * alignment *
            Math.exp(-0.5 * (distance / normalScale) ** 2);
          if (!best || score > best.score) {
            best = {
              trendIndex, pointOrder, curveIndex, score, alignment, distance,
              confidence: wrinkleConfidence,
              normalOffset: deltaX * segment.normal[0] + deltaY * segment.normal[1],
              projectionArc: segment.arcStart + fraction * segment.length,
              directArc: metrics.directArc[pointOrder],
            };
          }
        }
        if (!best || best.score < (options.minimumMatchScore ?? 0.025)) continue;
        const key = `${trendIndex}:${curveIndex}`;
        const records = groups.get(key) || [];
        records.push(best);
        groups.set(key, records);
      }
    }
  }

  const acceptedGroups: MatchGroup[] = [];
  const groupRecords: Array<Record<string, any>> = [];
  for (const [key, records] of groups) {
    records.sort((a, b) => a.pointOrder - b.pointOrder);
    const [trendIndexText, curveIndexText] = key.split(":");
    const trendIndex = Number(trendIndexText), curveIndex = Number(curveIndexText);
    const trend = trends[trendIndex];
    const uniqueOrders = new Set(records.map((record) => record.pointOrder));
    const directArcs = records.map((record) => record.directArc);
    const directLength = records.length > 1 ? Math.max(...directArcs) - Math.min(...directArcs) : 0;
    const coverage = uniqueOrders.size / Math.max(1, trend.points.length);
    const continuity = records.length > 1
      ? records.slice(1).filter((record, index) =>
        record.pointOrder - records[index].pointOrder <= 2).length / (records.length - 1)
      : 1;
    const direction = records.reduce((sum, record) => sum + record.alignment ** 2, 0) /
      records.length;
    const meanDistance = records.reduce((sum, record) => sum + record.distance, 0) / records.length;
    const projectionArcStart = Math.min(...records.map((record) => record.projectionArc));
    const projectionArcEnd = Math.max(...records.map((record) => record.projectionArc));
    const distanceWeight = Math.exp(-0.5 * (meanDistance / Math.max(2, bandRadius * 0.55)) ** 2);
    const coverageWeight = (1 - Math.exp(-directLength / Math.max(2, 0.010 * faceWidth))) *
      Math.sqrt(clamp(coverage));
    const influence = distanceWeight * direction * Math.sqrt(Math.max(0, coverageWeight * continuity));
    const accepted = records.length >= 2 && directLength >= 0.75 && influence >= 0.025;
    const summary: Record<string, any> = {
      wrinkle_segment_id: trendIndex,
      rstl_curve_index: curveIndex,
      direct_match_point_count: records.length,
      direct_evidence_arc_length_px: directLength,
      normalized_direct_evidence_arc_length: directLength / faceWidth,
      sample_coverage: coverage,
      continuity,
      curve_influence: influence,
      mean_match_distance_px: meanDistance,
      accepted,
    };
    if (options.globalLengthAwareMatching === true) {
      const baseAssignmentScore = influence /
        (1 + meanDistance / Math.max(1, bandRadius));
      const evidenceLengthWeight = Math.sqrt(clamp(directLength / faceWidth));
      summary.base_assignment_score = baseAssignmentScore;
      summary.evidence_length_weight = evidenceLengthWeight;
      summary.assignment_score = baseAssignmentScore * evidenceLengthWeight;
      if (options.intervalAwareAnchorSharing === true) {
        summary.projection_arc_interval_px = [projectionArcStart, projectionArcEnd];
      }
    }
    groupRecords.push(summary);
    if (accepted) acceptedGroups.push({ trendIndex, curveIndex, records, directLength,
      coverage, influence, meanDistance, projectionArcStart, projectionArcEnd, summary });
  }

  const byCurve = new Map<number, MatchGroup[]>();
  for (const group of acceptedGroups) {
    const curveGroups = byCurve.get(group.curveIndex) || [];
    curveGroups.push(group);
    byCurve.set(group.curveIndex, curveGroups);
  }
  const curveSupportRecords: Array<Record<string, number | boolean | string>> = [];
  const acceptedCurves = new Set<number>();
  for (const [curveIndex, curveGroups] of byCurve) {
    const directLength = curveGroups.reduce((sum, group) => sum + group.directLength, 0);
    const coverage = curveGroups.reduce((sum, group) => sum + group.coverage, 0) /
      curveGroups.length;
    const pointCount = curveGroups.reduce((sum, group) => sum + group.records.length, 0);
    const normalizedLength = directLength / faceWidth;
    const accepted = (normalizedLength >= 0.010 && coverage >= 0.25) ||
      (normalizedLength >= 0.006 && coverage >= 0.50 && pointCount >= 3);
    if (accepted) acceptedCurves.add(curveIndex);
    const allRecords = curveGroups.flatMap((group) => group.records);
    curveSupportRecords.push({
      curve_index: curveIndex,
      supporting_wrinkle_segment_count: curveGroups.length,
      direct_evidence_arc_length_px: directLength,
      normalized_direct_evidence_arc_length: normalizedLength,
      mean_segment_coverage: coverage,
      direct_match_point_count: pointCount,
      mean_match_confidence: allRecords.reduce((sum, record) => sum + record.confidence, 0) /
        Math.max(1, allRecords.length),
      minimum_support_passed: accepted,
      minimum_support_rule: "L/face_width>=0.010 and coverage>=0.25, or " +
        "L/face_width>=0.006 and coverage>=0.50 and points>=3",
    });
  }
  const excludedTrendCurvePairs = new Set(options.excludedTrendCurvePairs || []);
  const excludedTrendCurvePairReasons = options.excludedTrendCurvePairReasons || {};
  const curveEligibleGroups = acceptedGroups.filter((group) =>
    acceptedCurves.has(group.curveIndex) &&
    !excludedTrendCurvePairs.has(`${group.trendIndex}:${group.curveIndex}`));
  let selectedGroups = curveEligibleGroups;
  if (options.oneToOneTrendCurveMatching === true) {
    if (options.globalLengthAwareMatching === true) {
      selectedGroups = maximumWeightTrendCurveAssignment(curveEligibleGroups);
      if (options.intervalAwareAnchorSharing === true) {
        selectedGroups = expandIntervalCompatibleAssignments(
          selectedGroups, curveEligibleGroups,
          options.anchorIntervalPaddingPx ?? Math.max(2, 0.010 * faceWidth),
        );
      }
    } else {
      const ranked = curveEligibleGroups.map((group) => ({
        group,
        score: group.influence / (1 + group.meanDistance / Math.max(1, bandRadius)),
      })).sort((left, right) => right.score - left.score ||
        left.group.meanDistance - right.group.meanDistance ||
        left.group.trendIndex - right.group.trendIndex ||
        left.group.curveIndex - right.group.curveIndex);
      const usedTrends = new Set(), usedCurves = new Set();
      selectedGroups = [];
      for (const candidate of ranked) {
        const group = candidate.group;
        if (usedTrends.has(group.trendIndex) || usedCurves.has(group.curveIndex)) continue;
        usedTrends.add(group.trendIndex);
        usedCurves.add(group.curveIndex);
        selectedGroups.push(group);
      }
    }
  } else if (options.exclusiveTrendMatching === true) {
    const groupsByTrend = new Map();
    for (const group of curveEligibleGroups) {
      if (!groupsByTrend.has(group.trendIndex)) groupsByTrend.set(group.trendIndex, []);
      groupsByTrend.get(group.trendIndex).push(group);
    }
    selectedGroups = [...groupsByTrend.values()].map((groupsForTrend) =>
      [...groupsForTrend].sort((left, right) => {
        const leftScore = left.influence /
          (1 + left.meanDistance / Math.max(1, bandRadius));
        const rightScore = right.influence /
          (1 + right.meanDistance / Math.max(1, bandRadius));
        return rightScore - leftScore || left.meanDistance - right.meanDistance ||
          left.curveIndex - right.curveIndex;
      })[0]);
  }
  const selectedRecords = new Set(selectedGroups.map((group) => group.summary));
  const selectedCountByCurve = new Map();
  for (const group of selectedGroups) {
    selectedCountByCurve.set(group.curveIndex,
      (selectedCountByCurve.get(group.curveIndex) || 0) + 1);
  }
  for (const record of groupRecords) {
    const curveSupportPassed = acceptedCurves.has(record.rstl_curve_index);
    record.segment_support_passed = record.accepted;
    record.curve_support_passed = curveSupportPassed;
    record.selected_for_wrinkle = selectedRecords.has(record);
    record.provisional_accepted = record.accepted && curveSupportPassed && record.selected_for_wrinkle;
    record.final_accepted = record.provisional_accepted;
    record.final_status = record.final_accepted ? "accepted" : "rejected_before_refinement";
    if (options.intervalAwareAnchorSharing === true && record.selected_for_wrinkle) {
      record.anchor_interval_shared = (selectedCountByCurve.get(record.rstl_curve_index) || 0) > 1;
    }
    const candidateGroup = acceptedGroups.find((group) => group.summary === record);
    const selectedCurveElsewhere = options.oneToOneTrendCurveMatching === true &&
      selectedGroups.some((group) => group.curveIndex === record.rstl_curve_index &&
        group.trendIndex !== record.wrinkle_segment_id &&
        (!options.intervalAwareAnchorSharing || !candidateGroup ||
          anchorIntervalsConflict(group, candidateGroup,
            options.anchorIntervalPaddingPx ?? Math.max(2, 0.010 * faceWidth))));
    const candidateRetryExcluded = excludedTrendCurvePairs.has(
      `${record.wrinkle_segment_id}:${record.rstl_curve_index}`,
    );
    const candidateRetryReason = excludedTrendCurvePairReasons[
      `${record.wrinkle_segment_id}:${record.rstl_curve_index}`
    ] || "topology_retry_excluded";
    record.rejection_reason = record.final_accepted ? null :
      !record.segment_support_passed ? "insufficient_segment_support" :
        !record.curve_support_passed ? "insufficient_curve_support" :
          candidateRetryExcluded ? candidateRetryReason :
          selectedCurveElsewhere ? "curve_reserved_for_better_wrinkle" :
            "better_curve_match_selected";
  }
  return {
    acceptedGroups: selectedGroups,
    supportedGroups: acceptedGroups.filter((group) => acceptedCurves.has(group.curveIndex)),
    curveSupportRecords, groupRecords, bandRadius,
    candidatePairCount, directionRejectedPairCount,
  };
}

function anchorIntervalsConflict(first: MatchGroup, second: MatchGroup, padding: number): boolean {
  return first.projectionArcStart - padding <= second.projectionArcEnd + padding &&
    second.projectionArcStart - padding <= first.projectionArcEnd + padding;
}

function groupAssignmentScore(group: MatchGroup): number {
  return Number(group.summary.assignment_score) || 0;
}

function expandIntervalCompatibleAssignments(
  initial: MatchGroup[], eligibleGroups: MatchGroup[], padding: number,
): MatchGroup[] {
  let selected = [...initial];
  const ranked = [...eligibleGroups].sort((left, right) =>
    groupAssignmentScore(right) - groupAssignmentScore(left) ||
    left.meanDistance - right.meanDistance ||
    left.trendIndex - right.trendIndex ||
    left.curveIndex - right.curveIndex);
  let changed = true, pass = 0;
  while (changed && pass < ranked.length) {
    changed = false;
    pass += 1;
    for (const candidate of ranked) {
      const existingIndex = selected.findIndex((group) =>
        group.trendIndex === candidate.trendIndex);
      const existing = existingIndex >= 0 ? selected[existingIndex] : null;
      if (existing && groupAssignmentScore(candidate) <= groupAssignmentScore(existing) + EPSILON) {
        continue;
      }
      const conflicts = selected.some((group, index) =>
        index !== existingIndex && group.curveIndex === candidate.curveIndex &&
        anchorIntervalsConflict(group, candidate, padding));
      if (conflicts) continue;
      if (existingIndex >= 0) selected[existingIndex] = candidate;
      else selected.push(candidate);
      changed = true;
    }
  }
  return selected.sort((left, right) => left.trendIndex - right.trendIndex ||
    left.curveIndex - right.curveIndex);
}

function maximumWeightTrendCurveAssignment(groups: MatchGroup[]): MatchGroup[] {
  if (!groups.length) return [];
  const trendIndices = [...new Set(groups.map((group) => group.trendIndex))]
    .sort((left, right) => left - right);
  const curveIndices = [...new Set(groups.map((group) => group.curveIndex))]
    .sort((left, right) => left - right);
  const groupByPair = new Map(groups.map((group) => [
    `${group.trendIndex}:${group.curveIndex}`, group,
  ]));
  const rowCount = trendIndices.length;
  const columnCount = curveIndices.length + rowCount;
  const forbiddenCost = 1e6;
  const costs = trendIndices.map((trendIndex) => [
    ...curveIndices.map((curveIndex) => {
      const group = groupByPair.get(`${trendIndex}:${curveIndex}`);
      return group ? -group.summary.assignment_score : forbiddenCost;
    }),
    ...Array(rowCount).fill(0),
  ]);

  // Rectangular Hungarian algorithm. One private zero-weight dummy column per
  // trend permits leaving a wrinkle unmatched when no eligible pair exists.
  const u = new Float64Array(rowCount + 1);
  const v = new Float64Array(columnCount + 1);
  const p = new Int32Array(columnCount + 1);
  const way = new Int32Array(columnCount + 1);
  for (let row = 1; row <= rowCount; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minimum = new Float64Array(columnCount + 1);
    minimum.fill(Infinity);
    const used = new Uint8Array(columnCount + 1);
    do {
      used[column0] = 1;
      const row0 = p[column0];
      let delta = Infinity, column1 = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const reduced = costs[row0 - 1][column - 1] - u[row0] - v[column];
        if (reduced < minimum[column]) {
          minimum[column] = reduced;
          way[column] = column0;
        }
        if (minimum[column] < delta) {
          delta = minimum[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          u[p[column]] += delta;
          v[column] -= delta;
        } else {
          minimum[column] -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);
    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }

  const selected: MatchGroup[] = [];
  for (let column = 1; column <= curveIndices.length; column += 1) {
    if (!p[column]) continue;
    const group = groupByPair.get(
      `${trendIndices[p[column] - 1]}:${curveIndices[column - 1]}`,
    );
    if (group) selected.push(group);
  }
  return selected.sort((left, right) => left.trendIndex - right.trendIndex ||
    left.curveIndex - right.curveIndex);
}

function intervalIndices(
  directSupport: NumericField,
  vertexArc: NumericField,
  transitionLength: number,
): Interval[] {
  const maximum = directSupport.length ? Math.max(...Array.from(directSupport)) : 0;
  if (!(maximum > 0)) return [];
  const active: number[] = [];
  for (let index = 0; index < directSupport.length; index += 1) {
    if (directSupport[index] >= Math.max(1e-8, maximum * 0.03)) active.push(index);
  }
  if (!active.length) return [];
  const groups: Interval[] = [];
  let start = active[0], end = active[0];
  for (const index of active.slice(1)) {
    if (index <= end + 1) end = index;
    else { groups.push([start, end + 1]); start = index; end = index; }
  }
  groups.push([start, end + 1]);
  return groups.map(([first, exclusiveEnd]) => {
    let left = first, right = exclusiveEnd;
    while (left > 0 && vertexArc[first] - vertexArc[left] < transitionLength) left -= 1;
    while (right < vertexArc.length &&
      vertexArc[right - 1] - vertexArc[exclusiveEnd - 1] < transitionLength) right += 1;
    return [left, right] as Interval;
  }).reduce<Interval[]>((merged, interval) => {
    const previous = merged[merged.length - 1];
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push(interval);
    return merged;
  }, []);
}

function solveInterval(
  raw: NumericField,
  support: NumericField,
  start: number,
  end: number,
  passes = 48,
  dataAttractionStrength = 4.5,
): Float64Array {
  const length = end - start;
  const output = new Float64Array(length);
  let maximumSupport = 0;
  for (let local = 0; local < length; local += 1) {
    output[local] = raw[start + local];
    maximumSupport = Math.max(maximumSupport, support[start + local]);
  }
  const normalizedSupport = new Float64Array(length);
  for (let local = 0; local < length; local += 1) {
    normalizedSupport[local] = maximumSupport > 0 ? support[start + local] / maximumSupport : 0;
  }
  if (length > 0) output[0] = 0;
  if (length > 1) output[length - 1] = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float64Array(output);
    for (let local = 1; local < length - 1; local += 1) {
      const data = dataAttractionStrength * normalizedSupport[local];
      next[local] = (data * raw[start + local] + 1.2 * output[local] +
        1.1 * (output[local - 1] + output[local + 1])) / (data + 3.4);
    }
    output.set(next);
    if (length > 0) output[0] = 0;
    if (length > 1) output[length - 1] = 0;
  }
  return output;
}

function turnAngles(points: Point2[]): Float64Array {
  const output = new Float64Array(points.length);
  for (let index = 1; index < points.length - 1; index += 1) {
    const first = normalize2(points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1]);
    const second = normalize2(points[index + 1][0] - points[index][0],
      points[index + 1][1] - points[index][1]);
    output[index] = Math.acos(clamp(first[0] * second[0] + first[1] * second[1], -1, 1));
  }
  return output;
}

function pointsFromOffsets(curve: CurveGeometry, offsets: NumericField): Point2[] {
  return curve.prior.map((point, index) => [
    point[0] + curve.normals[index][0] * offsets[index],
    point[1] + curve.normals[index][1] * offsets[index],
  ]);
}

function axialDirectionDifferenceDegrees(first: Point2, second: Point2): number {
  if (!(first?.[0] || first?.[1]) || !(second?.[0] || second?.[1])) return 90;
  const cosine = clamp(Math.abs(first[0] * second[0] + first[1] * second[1]), -1, 1);
  return Math.acos(cosine) * 180 / Math.PI;
}

function pointToPolylineMatch(
  point: Point2, polyline: Point2[],
): { distance: number; tangent: Point2 } {
  let best = { distance: Infinity, tangent: [0, 0] as Point2 };
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index], end = polyline[index + 1];
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared > EPSILON ? clamp(
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
    ) : 0;
    const projectionX = start[0] + fraction * dx;
    const projectionY = start[1] + fraction * dy;
    const distance = Math.hypot(point[0] - projectionX, point[1] - projectionY);
    if (distance < best.distance) {
      best = { distance, tangent: normalize2(dx, dy) };
    }
  }
  return Number.isFinite(best.distance) ? best : { distance: 0, tangent: [0, 0] };
}

function minimumPolylineDistance(first: Point2[], second: Point2[]): number {
  let minimum = Infinity;
  for (const point of first) minimum = Math.min(minimum, pointToPolylineMatch(point, second).distance);
  for (const point of second) minimum = Math.min(minimum, pointToPolylineMatch(point, first).distance);
  return Number.isFinite(minimum) ? minimum : 0;
}

function trajectoryAdherence(
  trends: Trend[], matching: MatchingResult, curves: CurveGeometry[], outputCurves: any[],
  faceWidth: number, options: V6RefinementOptions, applyGate = false,
) {
  const records = [], finalDistances = [], priorDistances = [];
  const rejectedCurveIndices = new Set<number>(), alreadyAlignedCurveIndices = new Set<number>();
  const rejectedTrendCurvePairs = new Set<string>();
  const meanThreshold = options.adherenceMeanThresholdPx ?? Math.max(2, 0.0035 * faceWidth);
  const baseP90Threshold = options.adherenceP90ThresholdPx ?? Math.max(4, 0.0065 * faceWidth);
  const directionSoftThreshold = options.adherenceDirectionSoftDegrees ??
    (options.shortWrinkleQuantizationTolerance === true ? 25 :
      (options.adherenceDirectionP90Degrees ?? 25));
  const directionThreshold = options.adherenceDirectionHardDegrees ??
    (options.adherenceDirectionP90Degrees ?? 25);
  const minimumImprovement = options.minimumAdherenceImprovementPx ??
    Math.max(0.10, 0.0005 * faceWidth);
  for (const group of matching.acceptedGroups) {
    const pointOrders = [...new Set(group.records.map((record) => record.pointOrder))];
    const points = pointOrders.map((pointOrder) => trends[group.trendIndex].points[pointOrder]);
    const wrinkleTangents = pointOrders.map((pointOrder) =>
      trends[group.trendIndex].metrics.tangents[pointOrder]);
    const prior = curves[group.curveIndex].prior;
    const final = outputCurves[group.curveIndex].pts;
    const beforeMatches = points.map((point) => pointToPolylineMatch(point, prior));
    const afterMatches = points.map((point) => pointToPolylineMatch(point, final));
    const before = beforeMatches.map((match) => match.distance);
    const after = afterMatches.map((match) => match.distance);
    const beforeDirections = beforeMatches.map((match, index) =>
      axialDirectionDifferenceDegrees(match.tangent, wrinkleTangents[index]));
    const afterDirections = afterMatches.map((match, index) =>
      axialDirectionDifferenceDegrees(match.tangent, wrinkleTangents[index]));
    const priorMean = before.reduce((sum, value) => sum + value, 0) / Math.max(1, before.length);
    const finalMean = after.reduce((sum, value) => sum + value, 0) / Math.max(1, after.length);
    const priorP90 = percentile(before, 0.9), finalP90 = percentile(after, 0.9);
    const priorDirectionP90 = percentile(beforeDirections, 0.9);
    const finalDirectionP90 = percentile(afterDirections, 0.9);
    const shortTrend = options.shortWrinkleQuantizationTolerance === true &&
      group.directLength / faceWidth < (options.shortWrinkleMaximumLengthRatio ?? 0.12);
    const quantizationTolerance = shortTrend ?
      (options.shortWrinkleP90TolerancePx ?? Math.max(0.5, 0.001 * faceWidth)) : 0;
    const p90Threshold = baseP90Threshold + quantizationTolerance;
    const moved = outputCurves[group.curveIndex].normalOffsetsPx
      .some((value: number) => Math.abs(value) > 0.05);
    if (applyGate && options.postAdherenceGate === true) {
      const alreadyAligned = priorMean <= meanThreshold && priorP90 <= p90Threshold &&
        priorDirectionP90 <= directionThreshold;
      const improved = priorMean - finalMean >= minimumImprovement;
      const passedDistance = finalMean <= meanThreshold && finalP90 <= p90Threshold;
      const passedDirection = finalDirectionP90 <= directionThreshold;
      let status = "accepted", rejectionReason = null;
      if (alreadyAligned) {
        status = "already_aligned";
        alreadyAlignedCurveIndices.add(group.curveIndex);
      } else if (outputCurves[group.curveIndex].rollbackReason || !moved) {
        status = "rejected_after_guard";
        rejectionReason = outputCurves[group.curveIndex].rollbackReason || "no_effect_after_guard";
      } else if (!improved) {
        status = "rejected_no_improvement";
        rejectionReason = "minimum_adherence_improvement_not_met";
      } else if (!passedDistance) {
        status = finalMean > meanThreshold ? "rejected_mean_distance" : "rejected_p90_distance";
        rejectionReason = status;
      } else if (!passedDirection) {
        status = "rejected_direction_adherence";
        rejectionReason = status;
      }
      const accepted = status === "accepted" || status === "already_aligned";
      group.summary.final_status = status;
      group.summary.final_accepted = accepted;
      group.summary.rejection_reason = rejectionReason;
      group.summary.candidate_prior_mean_distance_px = priorMean;
      group.summary.candidate_final_mean_distance_px = finalMean;
      group.summary.candidate_final_p90_distance_px = finalP90;
      group.summary.candidate_final_direction_p90_degrees = finalDirectionP90;
      if (accepted && finalDirectionP90 > directionSoftThreshold) {
        group.summary.direction_soft_zone = true;
        group.summary.direction_soft_penalty = clamp(
          (directionThreshold - finalDirectionP90) /
          Math.max(EPSILON, directionThreshold - directionSoftThreshold),
        );
      }
      if (options.shortWrinkleQuantizationTolerance === true) {
        group.summary.short_wrinkle_quantization_tolerance_px = quantizationTolerance;
      }
      if (!accepted) {
        rejectedCurveIndices.add(group.curveIndex);
        rejectedTrendCurvePairs.add(`${group.trendIndex}:${group.curveIndex}`);
      }
    }
    const status = group.summary.final_status ||
      (group.summary.final_accepted ? "accepted" : "rejected_before_refinement");
    const accepted = status === "accepted" || status === "already_aligned";
    if (accepted) {
      priorDistances.push(...before);
      finalDistances.push(...after);
    }
    records.push({
      wrinkle_segment_id: group.trendIndex,
      rstl_curve_index: group.curveIndex,
      sample_count: points.length,
      final_status: status,
      final_accepted: accepted,
      prior_mean_distance_px: priorMean,
      prior_p90_distance_px: priorP90,
      final_mean_distance_px: finalMean,
      final_median_distance_px: percentile(after, 0.5),
      final_p90_distance_px: finalP90,
      prior_direction_p90_degrees: priorDirectionP90,
      final_direction_p90_degrees: finalDirectionP90,
      mean_distance_threshold_px: meanThreshold,
      p90_distance_threshold_px: p90Threshold,
      direction_p90_threshold_degrees: directionThreshold,
      ...(options.shortWrinkleQuantizationTolerance === true ? {
        base_p90_distance_threshold_px: baseP90Threshold,
        short_wrinkle_quantization_tolerance_px: quantizationTolerance,
        short_wrinkle_gate_applied: shortTrend,
        direction_soft_threshold_degrees: directionSoftThreshold,
        direction_soft_zone: finalDirectionP90 > directionSoftThreshold &&
          finalDirectionP90 <= directionThreshold,
      } : {}),
      minimum_improvement_px: minimumImprovement,
      candidate_prior_mean_distance_px:
        group.summary.candidate_prior_mean_distance_px ?? priorMean,
      candidate_final_mean_distance_px:
        group.summary.candidate_final_mean_distance_px ?? finalMean,
      candidate_final_p90_distance_px:
        group.summary.candidate_final_p90_distance_px ?? finalP90,
      candidate_final_direction_p90_degrees:
        group.summary.candidate_final_direction_p90_degrees ?? finalDirectionP90,
    });
  }
  return {
    records,
    rejectedCurveIndices,
    rejectedTrendCurvePairs,
    alreadyAlignedCurveIndices,
    priorMean: priorDistances.reduce((sum, value) => sum + value, 0) /
      Math.max(1, priorDistances.length),
    finalMean: finalDistances.reduce((sum, value) => sum + value, 0) /
      Math.max(1, finalDistances.length),
    finalP90: percentile(finalDistances, 0.9),
    acceptedCount: records.filter((record) => record.final_status === "accepted").length,
    alreadyAlignedCount: records.filter((record) => record.final_status === "already_aligned").length,
    rejectedCount: records.filter((record) => !record.final_accepted).length,
    meanThreshold,
    p90Threshold: baseP90Threshold,
    directionThreshold,
    directionSoftThreshold,
  };
}

function geometryGuard(
  curve: CurveGeometry, offsets: Float64Array, intervals: Interval[], size: number,
  options: V6RefinementOptions,
) {
  const priorTurns = turnAngles(curve.prior);
  const maximumChange = (options.maxCurvatureChangeDegrees ?? 18) * Math.PI / 180;
  let scaled = 0, rolledBack = 0;
  const events = [];
  for (const [start, end] of intervals) {
    const original = offsets.slice(start, end);
    let scale = 1, accepted = false;
    while (scale >= 0.20 - EPSILON) {
      for (let index = start; index < end; index += 1) {
        offsets[index] = original[index - start] * scale;
      }
      const points = pointsFromOffsets(curve, offsets);
      const turns = turnAngles(points);
      let valid = true;
      for (let index = start; index < end; index += 1) {
        if (points[index][0] < 0 || points[index][1] < 0 ||
            points[index][0] >= size || points[index][1] >= size ||
            Math.abs(turns[index] - priorTurns[index]) > maximumChange) {
          valid = false; break;
        }
      }
      if (valid) { accepted = true; break; }
      scale *= 0.8;
    }
    if (!accepted) {
      for (let index = start; index < end; index += 1) offsets[index] = 0;
      rolledBack += 1;
      events.push({ interval: [start, end], status: "rolled_back", scale: 0 });
    } else if (scale < 0.999) {
      scaled += 1;
      events.push({ interval: [start, end], status: "scaled", scale });
    } else {
      events.push({ interval: [start, end], status: "accepted", scale: 1 });
    }
  }
  return { scaled, rolledBack, events };
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  if (Math.max(a[0], b[0]) <= Math.min(c[0], d[0]) + 1e-7 ||
      Math.max(c[0], d[0]) <= Math.min(a[0], b[0]) + 1e-7 ||
      Math.max(a[1], b[1]) <= Math.min(c[1], d[1]) + 1e-7 ||
      Math.max(c[1], d[1]) <= Math.min(a[1], b[1]) + 1e-7) return false;
  const first = orientation(a, b, c), second = orientation(a, b, d);
  const third = orientation(c, d, a), fourth = orientation(c, d, b);
  return first * second < -1e-7 && third * fourth < -1e-7;
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

function curveBounds(points: Point2[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(first: Bounds, second: Bounds): boolean {
  return first.maxX > second.minX + 1e-7 && second.maxX > first.minX + 1e-7 &&
    first.maxY > second.minY + 1e-7 && second.maxY > first.minY + 1e-7;
}

function selfCrosses(points: Point2[]): boolean {
  for (let first = 0; first < points.length - 1; first += 1) {
    for (let second = first + 2; second < points.length - 1; second += 1) {
      if (segmentsCross(points[first], points[first + 1],
        points[second], points[second + 1])) return true;
    }
  }
  return false;
}

function curvesCross(first: Point2[], second: Point2[]): boolean {
  if (!boundsOverlap(curveBounds(first), curveBounds(second))) return false;
  for (let a = 0; a < first.length - 1; a += 1) {
    for (let b = 0; b < second.length - 1; b += 1) {
      if (segmentsCross(first[a], first[a + 1], second[b], second[b + 1])) return true;
    }
  }
  return false;
}

function intersectionPairs(curves: Point2[][]): Set<string> {
  const pairs = new Set<string>();
  const bounds = curves.map(curveBounds);
  for (let first = 0; first < curves.length; first += 1) {
    for (let second = first + 1; second < curves.length; second += 1) {
      if (!boundsOverlap(bounds[first], bounds[second])) continue;
      if (curvesCross(curves[first], curves[second])) pairs.add(`${first}:${second}`);
    }
  }
  return pairs;
}

function rollbackNewIntersections(results: CurveRefineResult[], priorCurves: Point2[][]) {
  const priorPairs = intersectionPairs(priorCurves);
  const priorSelf = priorCurves.map(selfCrosses);
  const rolledBack = new Set<number>();
  const rollback = (index: number, reason: string): void => {
    const result = results[index];
    result.offsets.fill(0);
    result.points = result.curve.prior.map((point) => [...point]);
    result.rollbackReason = reason;
    rolledBack.add(index);
  };
  for (let index = 0; index < results.length; index += 1) {
    if (!priorSelf[index] && selfCrosses(results[index].points)) rollback(index, "new_self_intersection");
  }
  let changed = true;
  while (changed) {
    changed = false;
    const currentPairs = intersectionPairs(results.map((result) => result.points));
    for (const pair of currentPairs) {
      if (priorPairs.has(pair)) continue;
      const [first, second] = pair.split(":").map(Number);
      const firstMoved = results[first].offsets.some((value) => Math.abs(value) > 0.05);
      const secondMoved = results[second].offsets.some((value) => Math.abs(value) > 0.05);
      if (!firstMoved && !secondMoved) continue;
      const target = firstMoved && !secondMoved ? first : !firstMoved && secondMoved ? second :
        results[first].supportScore <= results[second].supportScore ? first : second;
      rollback(target, `new_curve_intersection:${pair}`);
      changed = true;
      break;
    }
  }
  const finalPairs = intersectionPairs(results.map((result) => result.points));
  const newPairs = [...finalPairs].filter((pair) => !priorPairs.has(pair));
  const newSelf = results.filter((result, index) =>
    !priorSelf[index] && selfCrosses(result.points)).length;
  return { rolledBack, newPairs, newSelf };
}

function refineCurves(
  curves: CurveGeometry[],
  matching: MatchingResult,
  faceWidth: number,
  size: number,
  options: V6RefinementOptions,
) {
  const grouped = new Map<number, MatchGroup[]>();
  for (const group of matching.acceptedGroups) {
    const curveGroups = grouped.get(group.curveIndex) || [];
    curveGroups.push(group);
    grouped.set(group.curveIndex, curveGroups);
  }
  const spreadSigma = Math.max(2, matching.bandRadius * 0.30);
  const spreadRadius = Math.max(6, matching.bandRadius * 0.70);
  const transitionLength = options.transitionLengthPx ?? TRANSITION_FACE_RATIO * faceWidth;
  const maximumDisplacement = options.maxDisplacementPx ?? MAX_DISPLACEMENT_FACE_RATIO * faceWidth;
  const p90Limit = options.p90LimitPx ?? P90_FACE_RATIO * faceWidth;
  const targetGap = Math.max(0, Number(options.targetGapPx) || 0);
  const dataAttractionStrength = Math.max(
    0.1, Number(options.dataAttractionStrength) || 4.5,
  );
  const wrinkleDominantCoreStrength = clamp(
    Number(options.wrinkleDominantCoreStrength) || 0,
  );
  const wrinkleDominantCoreSupportRatio = clamp(
    Number(options.wrinkleDominantCoreSupportRatio) || 0.16, 0.02, 0.80,
  );
  const guardEvents: any[] = [];
  let geometryScaled = 0, geometryRolledBack = 0;

  const results = curves.map((curve, curveIndex) => {
    const positiveNumerator = new Float64Array(curve.prior.length);
    const positiveSupport = new Float64Array(curve.prior.length);
    const negativeNumerator = new Float64Array(curve.prior.length);
    const negativeSupport = new Float64Array(curve.prior.length);
    const curveGroups = grouped.get(curveIndex) || [];
    for (const group of curveGroups) {
      for (const evidence of group.records) {
        for (let index = 0; index < curve.prior.length; index += 1) {
          const distance = Math.abs(curve.vertexArc[index] - evidence.projectionArc);
          if (distance > spreadRadius) continue;
          const kernel = Math.exp(-0.5 * (distance / spreadSigma) ** 2);
          const support = evidence.score * group.influence * kernel;
          const targetOffset = Math.sign(evidence.normalOffset) *
            Math.max(0, Math.abs(evidence.normalOffset) - targetGap);
          if (targetOffset >= 0) {
            positiveNumerator[index] += support * targetOffset;
            positiveSupport[index] += support;
          } else {
            negativeNumerator[index] += support * Math.abs(targetOffset);
            negativeSupport[index] += support;
          }
        }
      }
    }
    const raw = new Float64Array(curve.prior.length);
    const support = new Float64Array(curve.prior.length);
    for (let index = 0; index < raw.length; index += 1) {
      if (positiveSupport[index] >= negativeSupport[index] && positiveSupport[index] > 0) {
        raw[index] = positiveNumerator[index] / positiveSupport[index];
        support[index] = positiveSupport[index];
      } else if (negativeSupport[index] > 0) {
        raw[index] = -negativeNumerator[index] / negativeSupport[index];
        support[index] = negativeSupport[index];
      }
      raw[index] = clamp(raw[index], -maximumDisplacement, maximumDisplacement);
    }
    const intervals = intervalIndices(support, curve.vertexArc, transitionLength);
    const offsets = new Float64Array(raw.length);
    for (const [start, end] of intervals) {
      const solved = solveInterval(
        raw, support, start, end, options.smoothingPasses ?? 48, dataAttractionStrength,
      );
      offsets.set(solved, start);
      if (wrinkleDominantCoreStrength > 0) {
        let maximumSupport = 0;
        for (let index = start; index < end; index += 1) {
          maximumSupport = Math.max(maximumSupport, support[index]);
        }
        const coreThreshold = maximumSupport * wrinkleDominantCoreSupportRatio;
        for (let index = start + 1; index < end - 1; index += 1) {
          if (!(support[index] >= coreThreshold) || Math.abs(raw[index]) <= 0.05) continue;
          offsets[index] = (1 - wrinkleDominantCoreStrength) * offsets[index] +
            wrinkleDominantCoreStrength * raw[index];
        }
      }
      const active = [];
      for (let index = start; index < end; index += 1) {
        if (Math.abs(offsets[index]) > 0.05) active.push(Math.abs(offsets[index]));
      }
      const statistic = active.length < 8 ?
        Math.sqrt(active.reduce((sum, value) => sum + value * value, 0) /
          Math.max(1, active.length)) : percentile(active, 0.9);
      const scale = statistic > p90Limit ? p90Limit / statistic : 1;
      if (scale < 1) {
        for (let index = start; index < end; index += 1) offsets[index] *= scale;
        guardEvents.push({ curve_index: curveIndex, interval: [start, end],
          active_point_count: active.length,
          statistic: active.length < 8 ? "rms_for_small_interval" : "p90",
          before_limit_px: statistic, limit_px: p90Limit, scale });
      }
    }
    const geometry = geometryGuard(curve, offsets, intervals, size, options);
    geometryScaled += geometry.scaled;
    geometryRolledBack += geometry.rolledBack;
    return {
      curve, offsets, intervals,
      points: pointsFromOffsets(curve, offsets),
      supportScore: curveGroups.reduce((sum, group) => sum + group.influence, 0),
      geometryGuardEvents: geometry.events,
      rollbackReason: null,
    };
  });
  return { results, guardEvents, p90Limit, maximumDisplacement,
    geometryScaled, geometryRolledBack, wrinkleDominantCoreStrength,
    wrinkleDominantCoreSupportRatio,
    anchorGuardEvents: [...guardEvents],
    anchorGeometryScaled: geometryScaled,
    anchorGeometryRolledBack: geometryRolledBack,
    bundleRecords: [],
  };
}

function nearestCurveVertex(point: Point2, curve: CurveGeometry) {
  let bestIndex = 0, bestDistance = Infinity;
  for (let index = 0; index < curve.prior.length; index += 1) {
    const distance = Math.hypot(
      point[0] - curve.prior[index][0], point[1] - curve.prior[index][1],
    );
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return { index: bestIndex, distance: bestDistance };
}

function meanSignedCurveSeparation(anchor: CurveGeometry, follower: CurveGeometry) {
  let signed = 0, absolute = 0, count = 0;
  const first = Math.floor(follower.prior.length * 0.12);
  const last = Math.max(first + 1, Math.ceil(follower.prior.length * 0.88));
  const step = Math.max(1, Math.floor((last - first) / 18));
  for (let index = first; index < last; index += step) {
    const point = follower.prior[index];
    const nearest = nearestCurveVertex(point, anchor);
    const anchorPoint = anchor.prior[nearest.index];
    const anchorNormal = anchor.normals[nearest.index];
    const value = (point[0] - anchorPoint[0]) * anchorNormal[0] +
      (point[1] - anchorPoint[1]) * anchorNormal[1];
    signed += value;
    absolute += Math.abs(value);
    count += 1;
  }
  return {
    signed: count ? signed / count : 0,
    absolute: count ? absolute / count : Infinity,
  };
}

function selectBundleFollowerContributions(
  curves: CurveGeometry[], matching: MatchingResult, faceWidth: number,
  options: V6RefinementOptions,
) {
  const primaryCurveIndices = new Set(matching.acceptedGroups.map((group) => group.curveIndex));
  const radius = options.bundlePropagationRadiusPx ?? Math.max(4, 0.050 * faceWidth);
  const countPerSide = Math.max(
    0, Math.min(3, Number(options.bundleFollowerCountPerSide) || 1),
  );
  const denseRegion = String(options.bundleDenseFollowerRegion || "");
  const denseCountPerSide = Math.max(
    countPerSide,
    Math.min(3, Number(options.bundleDenseFollowerCountPerSide) || countPerSide),
  );
  const contributions = [];
  for (const primary of matching.acceptedGroups) {
    const anchor = curves[primary.curveIndex];
    const candidates = [];
    for (const group of matching.supportedGroups || []) {
      if (group.trendIndex !== primary.trendIndex || group.curveIndex === primary.curveIndex ||
          primaryCurveIndices.has(group.curveIndex)) continue;
      const follower = curves[group.curveIndex];
      if ((follower.seed.region || "") !== (anchor.seed.region || "")) continue;
      const separation = meanSignedCurveSeparation(anchor, follower);
      if (!(separation.absolute <= radius)) continue;
      candidates.push({
        trendIndex: primary.trendIndex,
        anchorCurveIndex: primary.curveIndex,
        followerCurveIndex: group.curveIndex,
        influence: group.influence,
        meanMatchDistance: group.meanDistance,
        separationPx: separation.absolute,
        side: separation.signed < 0 ? -1 : 1,
      });
    }
    for (const side of [-1, 1]) {
      const selectedCount = (anchor.seed.region || "") === denseRegion ?
        denseCountPerSide : countPerSide;
      const selected = candidates.filter((candidate) => candidate.side === side)
        .sort((left, right) => left.separationPx - right.separationPx ||
          right.influence - left.influence ||
          left.followerCurveIndex - right.followerCurveIndex)
        .slice(0, selectedCount);
      contributions.push(...selected);
    }
  }
  return { contributions, primaryCurveIndices, radius, countPerSide,
    denseRegion, denseCountPerSide };
}

export function resolveBundleContributions(
  candidates: any[], conflictDegrees = 25, dominanceRatio = 1.5,
) {
  let conflict = false;
  for (let first = 0; first < candidates.length && !conflict; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      if (axialDirectionDifferenceDegrees(
        candidates[first].tangent, candidates[second].tangent,
      ) > conflictDegrees) {
        conflict = true;
        break;
      }
    }
  }
  if (!conflict) return { active: candidates, status: "compatible" };
  const ranked = [...candidates].sort((left, right) => right.weight - left.weight ||
    left.trendIndex - right.trendIndex);
  if (ranked.length > 1 && ranked[0].weight >= ranked[1].weight * dominanceRatio) {
    return { active: [ranked[0]], status: "dominant_source" };
  }
  return { active: [], status: "ambiguous_prior" };
}

function applyBundlePropagation(
  curves: CurveGeometry[], matching: MatchingResult, refined: RefinedState, faceWidth: number,
  size: number, options: V6RefinementOptions,
) {
  refined.guardEvents = [...refined.anchorGuardEvents];
  refined.geometryScaled = refined.anchorGeometryScaled;
  refined.geometryRolledBack = refined.anchorGeometryRolledBack;
  refined.bundleRecords = [];
  refined.bundleSpacingGuardEvents = [];
  refined.bundleSpacingFailedAnchorPairs = new Set();
  if (options.bundlePropagation !== true) return refined;

  const selection = selectBundleFollowerContributions(curves, matching, faceWidth, options);
  const grouped = new Map<number, any[]>();
  for (const contribution of selection.contributions) {
    if (!grouped.has(contribution.followerCurveIndex)) {
      grouped.set(contribution.followerCurveIndex, []);
    }
    grouped.get(contribution.followerCurveIndex)!.push(contribution);
  }
  for (let curveIndex = 0; curveIndex < refined.results.length; curveIndex += 1) {
    if (selection.primaryCurveIndices.has(curveIndex)) continue;
    const result = refined.results[curveIndex];
    result.offsets.fill(0);
    result.points = result.curve.prior.map((point: Point2) => [...point]);
    result.intervals = [];
    result.geometryGuardEvents = [];
    result.rollbackReason = null;
    result.supportScore = 0;
    result.bundleFollowerSources = [];
  }

  const strength = clamp(Number(options.bundleFollowerStrength) || 0.85, 0, 1);
  const conflictDegrees = Math.max(
    0, Math.min(90, Number(options.bundleDirectionConflictDegrees) || 25),
  );
  const dominanceRatio = Math.max(1, Number(options.bundleConflictDominanceRatio) || 1.5);
  const transitionLength = options.bundleTransitionLengthPx ??
    options.transitionLengthPx ?? TRANSITION_FACE_RATIO * faceWidth;
  const dataStrength = Math.max(0.1, Number(options.bundleDataAttractionStrength) || 8);
  const smoothingPasses = Math.max(
    1, Math.min(64, Number(options.bundleSmoothingPasses) || 16),
  );
  const topologyPriority = clamp(Number(options.bundleFollowerTopologyPriority) || 0.25, 0.01, 0.9);

  for (const [curveIndex, contributions] of grouped) {
    const result = refined.results[curveIndex];
    const follower = curves[curveIndex];
    const raw = new Float64Array(follower.prior.length);
    const support = new Float64Array(follower.prior.length);
    let conflictPointCount = 0, dominatedConflictPointCount = 0;
    const sourceWeightTotals = new Map<number, number>();
    for (let pointIndex = 0; pointIndex < follower.prior.length; pointIndex += 1) {
      const point = follower.prior[pointIndex];
      const followerNormal = follower.normals[pointIndex];
      const candidates = [];
      for (const contribution of contributions) {
        const anchorResult = refined.results[contribution.anchorCurveIndex];
        if (anchorResult.rollbackReason) continue;
        const anchor = curves[contribution.anchorCurveIndex];
        const nearest = nearestCurveVertex(point, anchor);
        const anchorOffset = anchorResult.offsets[nearest.index];
        if (Math.abs(anchorOffset) <= 0.05) continue;
        const anchorNormal = anchor.normals[nearest.index];
        const projectedOffset = anchorOffset * (
          anchorNormal[0] * followerNormal[0] + anchorNormal[1] * followerNormal[1]
        );
        const weight = contribution.influence * Math.exp(
          -0.5 * (nearest.distance / selection.radius) ** 2,
        );
        if (!(weight > 1e-6) || !Number.isFinite(projectedOffset)) continue;
        candidates.push({
          ...contribution,
          weight,
          projectedOffset,
          tangent: [-anchorNormal[1], anchorNormal[0]],
        });
      }
      const resolution = resolveBundleContributions(
        candidates, conflictDegrees, dominanceRatio,
      );
      const active = resolution.active;
      if (resolution.status === "dominant_source") dominatedConflictPointCount += 1;
      if (resolution.status === "ambiguous_prior") {
        conflictPointCount += 1;
        continue;
      }
      const totalWeight = active.reduce((sum, candidate) => sum + candidate.weight, 0);
      if (!(totalWeight > 0)) continue;
      const normalizedOffset = active.reduce((sum, candidate) =>
        sum + candidate.weight * candidate.projectedOffset, 0) / totalWeight;
      raw[pointIndex] = clamp(
        strength * normalizedOffset,
        -refined.maximumDisplacement,
        refined.maximumDisplacement,
      );
      if (Math.abs(raw[pointIndex]) > 0.05) support[pointIndex] = totalWeight;
      for (const candidate of active) {
        sourceWeightTotals.set(candidate.trendIndex,
          (sourceWeightTotals.get(candidate.trendIndex) || 0) + candidate.weight / totalWeight);
      }
    }

    const intervals = intervalIndices(support, follower.vertexArc, transitionLength);
    const offsets = new Float64Array(follower.prior.length);
    for (const [start, end] of intervals) {
      offsets.set(solveInterval(
        raw, support, start, end, smoothingPasses, dataStrength,
      ), start);
      const activeOffsets = [];
      for (let index = start; index < end; index += 1) {
        if (Math.abs(offsets[index]) > 0.05) activeOffsets.push(Math.abs(offsets[index]));
      }
      const statistic = activeOffsets.length < 8 ?
        Math.sqrt(activeOffsets.reduce((sum, value) => sum + value * value, 0) /
          Math.max(1, activeOffsets.length)) : percentile(activeOffsets, 0.9);
      const scale = statistic > refined.p90Limit ? refined.p90Limit / statistic : 1;
      if (scale < 1) {
        for (let index = start; index < end; index += 1) offsets[index] *= scale;
        refined.guardEvents.push({
          curve_index: curveIndex,
          interval: [start, end],
          source: "bundle_follower",
          active_point_count: activeOffsets.length,
          statistic: activeOffsets.length < 8 ? "rms_for_small_interval" : "p90",
          before_limit_px: statistic,
          limit_px: refined.p90Limit,
          scale,
        });
      }
    }
    let geometry = geometryGuard(follower, offsets, intervals, size, options);
    const activeTrendIndices = [...sourceWeightTotals.keys()].map(Number);
    const activeTrendSet = new Set<number>(activeTrendIndices);
    const activeAnchorCurveIndices = [...new Set(contributions
      .filter((item) => activeTrendSet.has(item.trendIndex))
      .map((item) => item.anchorCurveIndex))];
    let spacingGuardScale = 1;
    let spacingGuardMode = "none";
    const minimumSpacingRatio = Number(options.bundleMinimumSpacingRatio) || 0;
    if (minimumSpacingRatio > 0 && activeAnchorCurveIndices.length) {
      const spacingForOffsets = (candidateOffsets: NumericField): number => {
        const points = pointsFromOffsets(follower, candidateOffsets);
        return Math.min(...activeAnchorCurveIndices.map((anchorCurveIndex) => {
          const anchor = curves[anchorCurveIndex];
          const anchorResult = refined.results[anchorCurveIndex];
          const priorMinimum = minimumPolylineDistance(follower.prior, anchor.prior);
          const finalMinimum = minimumPolylineDistance(points, anchorResult.points);
          return finalMinimum / Math.max(EPSILON, priorMinimum);
        }));
      };
      const originalOffsets = new Float64Array(offsets);
      const spacingAtScale = (scale: number): number => spacingForOffsets(
        Float64Array.from(originalOffsets, (value) => value * scale),
      );
      const beforeRatio = spacingAtScale(1);
      if (beforeRatio < minimumSpacingRatio) {
        spacingGuardScale = 0;
        let guardedSpacingRatio = spacingAtScale(0);
        let selectedOffsets = new Float64Array(offsets.length);
        const activeOffsets = [...originalOffsets].map(Math.abs).filter((value) => value > 0.05);
        const offsetStatistic = activeOffsets.length < 8 ?
          Math.sqrt(activeOffsets.reduce((sum, value) => sum + value * value, 0) /
            Math.max(1, activeOffsets.length)) : percentile(activeOffsets, 0.9);
        const maximumOffset = activeOffsets.length ? Math.max(...activeOffsets) : 0;
        const maximumScale = Math.min(
          1.5,
          maximumOffset > EPSILON ? refined.maximumDisplacement / maximumOffset : 1.5,
          offsetStatistic > EPSILON ? refined.p90Limit / offsetStatistic : 1.5,
        );
        const scales = [];
        for (let step = 1; step <= 20; step += 1) {
          scales.push(1 - step / 20);
          if (1 + step / 20 <= maximumScale + EPSILON) scales.push(1 + step / 20);
        }
        for (const scale of scales) {
          const ratio = spacingAtScale(scale);
          if (ratio < minimumSpacingRatio) continue;
          spacingGuardScale = scale;
          guardedSpacingRatio = ratio;
          selectedOffsets = Float64Array.from(originalOffsets, (value) => value * scale);
          spacingGuardMode = "uniform_scale";
          break;
        }
        if (spacingGuardMode === "none") {
          const coherentOffsets = new Float64Array(follower.prior.length);
          for (let pointIndex = 0; pointIndex < follower.prior.length; pointIndex += 1) {
            const point = follower.prior[pointIndex];
            const followerNormal = follower.normals[pointIndex];
            let numerator = 0, denominator = 0;
            for (const anchorCurveIndex of activeAnchorCurveIndices) {
              const anchor = curves[anchorCurveIndex];
              const anchorResult = refined.results[anchorCurveIndex];
              const nearest = nearestCurveVertex(point, anchor);
              const anchorNormal = anchor.normals[nearest.index];
              const projected = anchorResult.offsets[nearest.index] *
                (anchorNormal[0] * followerNormal[0] + anchorNormal[1] * followerNormal[1]);
              const weight = Math.exp(-0.5 * (nearest.distance / selection.radius) ** 2);
              numerator += weight * projected;
              denominator += weight;
            }
            coherentOffsets[pointIndex] = denominator > EPSILON ? clamp(
              numerator / denominator,
              -refined.maximumDisplacement,
              refined.maximumDisplacement,
            ) : 0;
          }
          for (const blend of [0.25, 0.50, 0.75, 1]) {
            const candidate = Float64Array.from(originalOffsets, (value, index) =>
              (1 - blend) * value + blend * coherentOffsets[index]);
            const candidateActive = [...candidate].map(Math.abs)
              .filter((value) => value > 0.05);
            const candidateStatistic = candidateActive.length < 8 ?
              Math.sqrt(candidateActive.reduce((sum, value) => sum + value * value, 0) /
                Math.max(1, candidateActive.length)) : percentile(candidateActive, 0.9);
            if (candidateStatistic > refined.p90Limit + EPSILON) continue;
            const candidateGeometry = geometryGuard(follower, candidate, intervals, size, options);
            const ratio = spacingForOffsets(candidate);
            if (ratio < minimumSpacingRatio) continue;
            selectedOffsets = candidate;
            guardedSpacingRatio = ratio;
            spacingGuardScale = 1;
            spacingGuardMode = "coherent_anchor_field";
            geometry = candidateGeometry;
            break;
          }
        }
        offsets.set(selectedOffsets);
        if (spacingGuardMode === "none" && guardedSpacingRatio < minimumSpacingRatio) {
          for (const contribution of contributions) {
            if (!activeTrendSet.has(contribution.trendIndex)) continue;
            refined.bundleSpacingFailedAnchorPairs.add(
              `${contribution.trendIndex}:${contribution.anchorCurveIndex}`,
            );
          }
        }
        refined.bundleSpacingGuardEvents.push({
          curve_index: curveIndex,
          source_anchor_curve_indices: activeAnchorCurveIndices,
          before_spacing_ratio: beforeRatio,
          minimum_spacing_ratio: minimumSpacingRatio,
          applied_scale: spacingGuardScale,
          mode: spacingGuardMode,
          final_spacing_ratio: guardedSpacingRatio,
        });
      }
    }
    refined.geometryScaled += geometry.scaled;
    refined.geometryRolledBack += geometry.rolledBack;
    result.offsets = offsets;
    result.intervals = intervals;
    result.points = pointsFromOffsets(follower, offsets);
    result.supportScore = topologyPriority * Math.min(
      1, contributions.reduce((sum, contribution) => sum + contribution.influence, 0),
    );
    result.geometryGuardEvents = geometry.events;
    result.bundleFollowerSources = contributions.map((contribution) => ({ ...contribution }));
    refined.bundleRecords.push({
      rstl_curve_index: curveIndex,
      source_wrinkle_segment_ids: activeTrendIndices,
      source_anchor_curve_indices: [...new Set(contributions
        .filter((item) => activeTrendSet.has(item.trendIndex))
        .map((item) => item.anchorCurveIndex))],
      candidate_source_wrinkle_segment_ids: [...new Set(
        contributions.map((item) => item.trendIndex),
      )],
      candidate_source_anchor_curve_indices: [...new Set(
        contributions.map((item) => item.anchorCurveIndex),
      )],
      selected_neighbor_records: contributions.map((item) => ({ ...item })),
      normalized_multi_source_weights: true,
      conflict_point_count: conflictPointCount,
      dominant_source_conflict_point_count: dominatedConflictPointCount,
      source_normalized_weight_totals: Object.fromEntries(sourceWeightTotals),
      ...(minimumSpacingRatio > 0 ? {
        spacing_guard_scale: spacingGuardScale,
        spacing_guard_mode: spacingGuardMode,
      } : {}),
    });
  }
  return refined;
}

function refineAnchorsAndBundle(
  curves: CurveGeometry[], matching: MatchingResult, faceWidth: number, size: number,
  options: V6RefinementOptions,
): RefinedState {
  const refined = refineCurves(curves, matching, faceWidth, size, options);
  return applyBundlePropagation(
    curves, matching, refined as unknown as RefinedState, faceWidth, size, options,
  );
}

/**
 * Refine fixed-connectivity RSTL curves from one fused wrinkle evidence map.
 *
 * `seeds` use the established browser shape `{name, region, pts:[[x,y],...]}`.
 * The returned `curves` retain the same array order and point order. Every
 * changed point is represented as a scalar displacement along its prior normal.
 */
export function refineV6({
  seeds, wrinkleMask, confidenceMap = null, directionQ = null,
  size, faceWidthPx, options = {},
}: RefineV6Input) {
  if (!Number.isInteger(size) || size < 4) throw new Error("size must be an integer >= 4");
  if (!Array.isArray(seeds)) throw new Error("seeds must be an array");
  if (!(Number(faceWidthPx) > 0)) throw new Error("faceWidthPx must be positive");
  const faceWidth = Number(faceWidthPx), length = size * size;
  const binary = normalizeMask(wrinkleMask, length);
  const confidence = normalizeScalarField(confidenceMap, length, 1);
  const wasSkeletonized = maskNeedsThinning(binary, size);
  const rawSkeleton = wasSkeletonized ? skeletonize(binary, size) : new Uint8Array(binary);
  const duplicateRadius = options.parallelDedupRadiusPx ??
    PARALLEL_DEDUP_FACE_RATIO * faceWidth;
  const deduplicated = suppressParallelDuplicateSkeleton(
    rawSkeleton, confidence, directionQ, size, duplicateRadius,
  );
  const skeleton = deduplicated.skeleton;
  const logicalGrouping = options.logicalTrendGrouping === true;
  const softLinkDistance = options.softLinkDistancePx ??
    (logicalGrouping ? 0.030 : SOFT_LINK_FACE_RATIO) * faceWidth;
  const softLinkTurnDegrees = options.softLinkTurnDegrees ??
    (logicalGrouping ? 18 : SOFT_LINK_TURN_DEGREES);
  const softLinkTangentSpan = options.softLinkTangentSpanPx ??
    (logicalGrouping ? Math.max(4, Math.round(0.020 * faceWidth)) : 4);
  const tangentWindow = options.tangentWindowPx ?? SOFT_LINK_FACE_RATIO * faceWidth;
  const rawPaths = orderedSkeletonPaths(skeleton, size);
  const trends = mergeTrendPaths(
    rawPaths, softLinkDistance, softLinkTurnDegrees, softLinkTangentSpan,
  ).map((trend) => ({
    ...trend,
    metrics: polylineMetrics(trend.points, tangentWindow, directionQ, size),
  }));
  const curves = seeds.map((seed) => buildCurveGeometry(seed, tangentWindow));
  let matching = matchTrendsToCurves(
    trends, curves, confidence, size, faceWidth, options,
  );
  let refined = refineAnchorsAndBundle(curves, matching, faceWidth, size, options);
  let intersection = rollbackNewIntersections(
    refined.results, curves.map((curve) => curve.prior),
  );
  const topologyRetryRecords = [];
  const excludedTrendCurvePairs = new Set();
  const excludedTrendCurvePairReasons = new Map();
  const topologyRetryAttempts = Math.max(
    0, Math.min(6, Number(options.topologyRetryAttempts) || 0),
  );
  for (let attempt = 1; attempt <= topologyRetryAttempts; attempt += 1) {
    const failedGroups = matching.acceptedGroups.filter((group) =>
      intersection.rolledBack.has(group.curveIndex) &&
      String(refined.results[group.curveIndex]?.rollbackReason || "").startsWith(
        "new_curve_intersection:",
      ));
    if (!failedGroups.length) break;
    let added = 0;
    for (const group of failedGroups) {
      const key = `${group.trendIndex}:${group.curveIndex}`;
      if (excludedTrendCurvePairs.has(key)) continue;
      excludedTrendCurvePairs.add(key);
      excludedTrendCurvePairReasons.set(key, "topology_retry_excluded");
      topologyRetryRecords.push({
        attempt,
        wrinkle_segment_id: group.trendIndex,
        excluded_rstl_curve_index: group.curveIndex,
        reason: refined.results[group.curveIndex].rollbackReason,
      });
      added += 1;
    }
    if (!added) break;
    matching = matchTrendsToCurves(
      trends, curves, confidence, size, faceWidth,
      { ...options, excludedTrendCurvePairs: [...excludedTrendCurvePairs],
        excludedTrendCurvePairReasons: Object.fromEntries(excludedTrendCurvePairReasons) },
    );
    refined = refineAnchorsAndBundle(curves, matching, faceWidth, size, options);
    intersection = rollbackNewIntersections(
      refined.results, curves.map((curve) => curve.prior),
    );
  }

  const makeOutputCurves = (): any[] => refined.results.map((result: any, curveIndex: number) => ({
    ...result.curve.seed,
    pts: result.points.map((point: Point2) => [...point]),
    priorPts: result.curve.prior.map((point: Point2) => [...point]),
    normalOffsetsPx: Array.from(result.offsets),
    affectedIntervals: result.intervals.map((interval: Interval) => [...interval]),
    geometryGuardEvents: result.geometryGuardEvents.map((event: any) => ({ ...event })),
    rollbackReason: result.rollbackReason,
    bundleFollowerSources: (result.bundleFollowerSources || []).map((source: any) => ({ ...source })),
    curveIndex,
  }));
  let outputCurves = makeOutputCurves();
  let candidateAdherence = trajectoryAdherence(
    trends, matching, curves, outputCurves, faceWidth, options, true,
  );
  const adherenceRetryRecords = [];
  const adherenceRetryAttempts = Math.max(
    0, Math.min(12, Number(options.adherenceRetryAttempts) || 0),
  );
  for (let attempt = 1; attempt <= adherenceRetryAttempts; attempt += 1) {
    const spacingFailedPairs = refined.bundleSpacingFailedAnchorPairs || new Set();
    const failedPairs = [...new Set([
      ...candidateAdherence.rejectedTrendCurvePairs,
      ...spacingFailedPairs,
    ])];
    if (!failedPairs.length) break;
    let added = 0;
    for (const key of failedPairs) {
      if (excludedTrendCurvePairs.has(key)) continue;
      const group = matching.acceptedGroups.find((candidate) =>
        `${candidate.trendIndex}:${candidate.curveIndex}` === key);
      excludedTrendCurvePairs.add(key);
      excludedTrendCurvePairReasons.set(key, "adherence_retry_excluded");
      adherenceRetryRecords.push({
        attempt,
        wrinkle_segment_id: group?.trendIndex ?? Number(key.split(":")[0]),
        excluded_rstl_curve_index: group?.curveIndex ?? Number(key.split(":")[1]),
        reason: spacingFailedPairs.has(key) ? "bundle_spacing_guard_failed" :
          group?.summary?.rejection_reason || "post_adherence_gate_rejected",
      });
      added += 1;
    }
    if (!added) break;
    matching = matchTrendsToCurves(
      trends, curves, confidence, size, faceWidth,
      { ...options, excludedTrendCurvePairs: [...excludedTrendCurvePairs],
        excludedTrendCurvePairReasons: Object.fromEntries(excludedTrendCurvePairReasons) },
    );
    refined = refineAnchorsAndBundle(curves, matching, faceWidth, size, options);
    intersection = rollbackNewIntersections(
      refined.results, curves.map((curve) => curve.prior),
    );
    outputCurves = makeOutputCurves();
    candidateAdherence = trajectoryAdherence(
      trends, matching, curves, outputCurves, faceWidth, options, true,
    );
  }
  const postAdherenceRollback = new Set();
  if (options.postAdherenceGate === true) {
    for (const curveIndex of candidateAdherence.rejectedCurveIndices) {
      const result = refined.results[curveIndex];
      result.offsets.fill(0);
      result.points = result.curve.prior.map((point: Point2) => [...point]);
      result.rollbackReason = result.rollbackReason || "post_adherence_gate_rejected";
      postAdherenceRollback.add(curveIndex);
    }
    for (const curveIndex of candidateAdherence.alreadyAlignedCurveIndices) {
      const result = refined.results[curveIndex];
      result.offsets.fill(0);
      result.points = result.curve.prior.map((point: Point2) => [...point]);
    }
    if (options.bundlePropagation === true) {
      applyBundlePropagation(curves, matching, refined, faceWidth, size, options);
      intersection = rollbackNewIntersections(
        refined.results, curves.map((curve) => curve.prior),
      );
    }
    outputCurves = makeOutputCurves();
  }
  const adherence = trajectoryAdherence(
    trends, matching, curves, outputCurves, faceWidth, options, false,
  );
  const outputLines = outputCurves.map((curve) => ({
    name: curve.name,
    region: curve.region,
    points_prior_xy: curve.priorPts.map((point: Point2) => [...point]),
    points_xy: curve.pts.map((point: Point2) => [...point]),
    normal_offsets_px: [...curve.normalOffsetsPx],
    affected_intervals: curve.affectedIntervals.map((interval: Interval) => [...interval]),
    rollback_reason: curve.rollbackReason,
    ...(curve.bundleFollowerSources.length ? {
      bundle_follower_sources: curve.bundleFollowerSources.map((source: any) => ({ ...source })),
    } : {}),
  }));
  const movedPointCount = outputCurves.reduce((sum, curve) => sum +
    curve.normalOffsetsPx.filter((value: number) => Math.abs(value) > 0.05).length, 0);
  const movedCurveCount = outputCurves.filter((curve) =>
    curve.normalOffsetsPx.some((value: number) => Math.abs(value) > 0.05)).length;
  const pointCount = outputCurves.reduce((sum, curve) => sum + curve.pts.length, 0);
  const bundleFollowerRecords = (refined.bundleRecords || []).map((record) => {
    const curve = outputCurves[record.rstl_curve_index];
    const movedPoints = curve.normalOffsetsPx.filter((value: number) => Math.abs(value) > 0.05);
    const spacingRecords = record.source_anchor_curve_indices.map((anchorCurveIndex: number) => {
      const anchor = outputCurves[anchorCurveIndex];
      const priorMinimum = minimumPolylineDistance(curve.priorPts, anchor.priorPts);
      const finalMinimum = minimumPolylineDistance(curve.pts, anchor.pts);
      return {
        anchor_curve_index: anchorCurveIndex,
        prior_minimum_spacing_px: priorMinimum,
        final_minimum_spacing_px: finalMinimum,
        final_to_prior_spacing_ratio: finalMinimum / Math.max(EPSILON, priorMinimum),
      };
    });
    return {
      ...record,
      spacing_records: spacingRecords,
      minimum_spacing_ratio: spacingRecords.length ? Math.min(
        ...spacingRecords.map((item: any) => item.final_to_prior_spacing_ratio),
      ) : 1,
      final_moved_point_count: movedPoints.length,
      final_maximum_displacement_px: movedPoints.length ? Math.max(...movedPoints.map(Math.abs)) : 0,
      final_status: curve.rollbackReason ? "rolled_back" :
        movedPoints.length ? "propagated" : "no_effect",
      rollback_reason: curve.rollbackReason,
    };
  });
  const diagnostics = {
    algorithm: V6_RSTL_ALGORITHM,
    parameter_mode: "soft_linked_curve_supported_interval_guarded_browser",
    coordinate_space: "canonical_2d",
    curve_count: outputCurves.length,
    point_count: pointCount,
    moved_curve_count: movedCurveCount,
    moved_point_count: movedPointCount,
    moved_point_ratio: movedPointCount / Math.max(1, pointCount),
    face_width_px: faceWidth,
    input_mask_was_skeletonized: wasSkeletonized,
    wrinkle_segment_count: trends.length,
    raw_skeleton_path_count: rawPaths.length,
    parallel_duplicate_skeleton_pixels_removed: deduplicated.removed,
    parallel_duplicate_suppression_radius_ratio_face_width: PARALLEL_DEDUP_FACE_RATIO,
    parallel_duplicate_suppression_radius_px: duplicateRadius,
    soft_link_count: trends.reduce((sum, trend) => sum + trend.softLinkCount, 0),
    soft_link_distance_ratio_face_width: logicalGrouping ?
      softLinkDistance / faceWidth : SOFT_LINK_FACE_RATIO,
    soft_link_max_gap_px: softLinkDistance,
    wrinkle_tangent_window_ratio_face_width: SOFT_LINK_FACE_RATIO,
    wrinkle_tangent_window_px: tangentWindow,
    search_radius_px: matching.bandRadius,
    band_candidate_pair_count: matching.candidatePairCount,
    direction_rejected_pair_count: matching.directionRejectedPairCount,
    curve_influence_records: matching.groupRecords,
    curve_support_records: matching.curveSupportRecords,
    exclusive_trend_matching: options.exclusiveTrendMatching === true,
    one_to_one_trend_curve_matching: options.oneToOneTrendCurveMatching === true,
    ...(logicalGrouping ? {
      logical_wrinkle_grouping_enabled: true,
      logical_wrinkle_fragment_max_gap_ratio_face_width: softLinkDistance / faceWidth,
      logical_wrinkle_fragment_max_gap_px: softLinkDistance,
      logical_wrinkle_fragment_max_turn_degrees: softLinkTurnDegrees,
      logical_wrinkle_endpoint_tangent_span_px: softLinkTangentSpan,
      logical_wrinkle_composite_count: trends.filter((trend) => trend.sourcePathCount > 1).length,
      logical_wrinkle_grouped_fragment_count: trends.reduce(
        (sum, trend) => sum + Math.max(0, trend.sourcePathCount - 1), 0,
      ),
      global_length_aware_matching: options.globalLengthAwareMatching === true,
    } : {}),
    ...(options.intervalAwareAnchorSharing === true ? {
      interval_aware_anchor_sharing: true,
      anchor_interval_padding_px: options.anchorIntervalPaddingPx ??
        Math.max(2, 0.010 * faceWidth),
      shared_primary_anchor_curve_count: [...new Set(matching.acceptedGroups
        .filter((group) => group.summary.final_accepted &&
          matching.acceptedGroups.some((other) => other !== group &&
            other.summary.final_accepted && other.curveIndex === group.curveIndex))
        .map((group) => group.curveIndex))].length,
    } : {}),
    post_adherence_gate: options.postAdherenceGate === true,
    target_wrinkle_gap_px: Math.max(0, Number(options.targetGapPx) || 0),
    trajectory_data_attraction_strength: Math.max(
      0.1, Number(options.dataAttractionStrength) || 4.5,
    ),
    trajectory_adherence_prior_mean_distance_px: adherence.priorMean,
    trajectory_adherence_final_mean_distance_px: adherence.finalMean,
    trajectory_adherence_final_p90_distance_px: adherence.finalP90,
    trajectory_adherence_records: adherence.records,
    trajectory_adherence_accepted_count: adherence.acceptedCount,
    trajectory_adherence_already_aligned_count: adherence.alreadyAlignedCount,
    trajectory_adherence_rejected_count: adherence.rejectedCount,
    trajectory_adherence_mean_threshold_px: adherence.meanThreshold,
    trajectory_adherence_p90_threshold_px: adherence.p90Threshold,
    trajectory_adherence_direction_p90_threshold_degrees: adherence.directionThreshold,
    ...(options.shortWrinkleQuantizationTolerance === true ? {
      trajectory_adherence_direction_soft_threshold_degrees:
        adherence.directionSoftThreshold,
      short_wrinkle_quantization_tolerance_enabled: true,
    } : {}),
    post_adherence_rollback_curve_count: postAdherenceRollback.size,
    wrinkle_dominant_core_strength: refined.wrinkleDominantCoreStrength,
    wrinkle_dominant_core_support_ratio: refined.wrinkleDominantCoreSupportRatio,
    displacement_p90_guard_scope: "curve_affected_interval",
    displacement_p90_limit_ratio_face_width: refined.p90Limit / faceWidth,
    displacement_p90_limit_px: refined.p90Limit,
    displacement_p90_scaled_interval_count: refined.guardEvents.length,
    displacement_p90_interval_events: refined.guardEvents,
    maximum_displacement_px: refined.maximumDisplacement,
    maximum_displacement_ratio_face_width: refined.maximumDisplacement / faceWidth,
    geometry_guard_scaled_interval_count: refined.geometryScaled,
    geometry_guard_rollback_interval_count: refined.geometryRolledBack,
    intersection_rollback_curve_count: intersection.rolledBack.size,
    topology_candidate_retry_enabled: topologyRetryAttempts > 0,
    topology_candidate_retry_max_attempts: topologyRetryAttempts,
    topology_candidate_retry_count: topologyRetryRecords.length,
    topology_candidate_retry_records: topologyRetryRecords,
    ...(adherenceRetryAttempts > 0 ? {
      adherence_candidate_retry_enabled: true,
      adherence_candidate_retry_max_attempts: adherenceRetryAttempts,
      adherence_candidate_retry_count: adherenceRetryRecords.length,
      adherence_candidate_retry_records: adherenceRetryRecords,
    } : {}),
    post_export_new_intersection_pair_count: intersection.newPairs.length,
    post_export_new_self_cross_curve_count: intersection.newSelf,
    topology_contract_preserved: outputCurves.length === seeds.length &&
      outputCurves.every((curve, index) => curve.pts.length === curvePriorPoints(seeds[index]).length),
    normal_displacement_only: true,
    ...(options.bundlePropagation === true ? {
      bundle_propagation_enabled: true,
      bundle_primary_anchor_curve_indices: matching.acceptedGroups
        .filter((group) => group.summary.final_accepted)
        .map((group) => group.curveIndex),
      bundle_candidate_anchor_curve_indices: matching.acceptedGroups
        .map((group) => group.curveIndex),
      bundle_follower_strength: clamp(Number(options.bundleFollowerStrength) || 0.85, 0, 1),
      bundle_propagation_radius_px: options.bundlePropagationRadiusPx ??
        Math.max(4, 0.050 * faceWidth),
      bundle_follower_count_per_side: Math.max(
        0, Math.min(3, Number(options.bundleFollowerCountPerSide) || 1),
      ),
      ...(options.bundleDenseFollowerRegion ? {
        bundle_dense_follower_region: String(options.bundleDenseFollowerRegion),
        bundle_dense_follower_count_per_side: Math.max(
          1, Math.min(3, Number(options.bundleDenseFollowerCountPerSide) || 1),
        ),
      } : {}),
      bundle_multi_source_weights_normalized: true,
      bundle_follower_records: bundleFollowerRecords,
      bundle_follower_candidate_curve_count: bundleFollowerRecords.length,
      bundle_follower_moved_curve_count: bundleFollowerRecords
        .filter((record) => record.final_status === "propagated").length,
      bundle_follower_rollback_curve_count: bundleFollowerRecords
        .filter((record) => record.final_status === "rolled_back").length,
      bundle_multi_source_follower_curve_count: bundleFollowerRecords
        .filter((record) => record.source_wrinkle_segment_ids.length > 1).length,
      bundle_ambiguous_conflict_point_count: bundleFollowerRecords.reduce(
        (sum, record) => sum + record.conflict_point_count, 0,
      ),
      bundle_dominant_source_conflict_point_count: bundleFollowerRecords.reduce(
        (sum, record) => sum + record.dominant_source_conflict_point_count, 0,
      ),
      bundle_minimum_spacing_ratio: bundleFollowerRecords.length ? Math.min(
        ...bundleFollowerRecords.map((record) => record.minimum_spacing_ratio),
      ) : 1,
      ...(Number(options.bundleMinimumSpacingRatio) > 0 ? {
        bundle_spacing_guard_minimum_ratio: Number(options.bundleMinimumSpacingRatio),
        bundle_spacing_guard_event_count: refined.bundleSpacingGuardEvents.length,
        bundle_spacing_guard_events: refined.bundleSpacingGuardEvents.map((event) => ({
          ...event,
        })),
      } : {}),
    } : {}),
  };
  const recordsByTrend = new Map();
  for (const record of matching.groupRecords) {
    const trendIndex = Number(record.wrinkle_segment_id);
    if (!recordsByTrend.has(trendIndex)) recordsByTrend.set(trendIndex, []);
    recordsByTrend.get(trendIndex).push(record);
  }
  const audit = {
    wrinkleTrends: trends.map((trend, trendIndex) => {
      const records = recordsByTrend.get(trendIndex) || [];
      const accepted = records.filter((record: any) => record.final_accepted);
      const provisional = records.filter((record: any) => record.provisional_accepted);
      const finalStatus = accepted[0]?.final_status || provisional[0]?.final_status ||
        "rejected_before_refinement";
      return {
        id: trendIndex,
        points: trend.points.map((point) => [...point]),
        sourcePathCount: trend.sourcePathCount,
        softLinkCount: trend.softLinkCount,
        arcLengthPx: trend.metrics.length,
        directArcLengthPx: trend.metrics.directLength,
        finalAccepted: accepted.length > 0,
        finalStatus,
        acceptedCurveIndices: accepted.map((record: any) => record.rstl_curve_index),
        candidateCurveIndices: provisional.map((record: any) => record.rstl_curve_index),
        rejectionReason: accepted.length ? null : provisional[0]?.rejection_reason ||
          (records.length ? records.some((record: any) => record.segment_support_passed)
            ? "insufficient_curve_support" : "insufficient_segment_support"
            : "no_nearby_direction_compatible_curve"),
      };
    }),
    matchRecords: matching.groupRecords.map((record) => ({ ...record })),
    curveSupportRecords: matching.curveSupportRecords.map((record) => ({ ...record })),
    ...(options.bundlePropagation === true ? {
      bundleFollowerRecords: bundleFollowerRecords.map((record) => ({ ...record })),
    } : {}),
  };
  return { curves: outputCurves, lines: outputLines, diagnostics, audit, wrinkleSkeleton: skeleton };
}
