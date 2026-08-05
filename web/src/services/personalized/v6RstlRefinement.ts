/**
 * Browser-ready wrinkle-guided RSTL V6 refinement.
 *
 * The module is deliberately data-only: no DOM, camera, network, or Node APIs.
 * It consumes a binary wrinkle mask in the same canonical 2D coordinate space
 * as the supplied curves and returns a fixed-connectivity curve set.
 */

export const V6_RSTL_ALGORITHM =
  "interval-guarded-continuous-polyline-rstl-refinement-6.0";

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
  summary: Record<string, number | boolean>;
}

interface MatchingResult {
  acceptedGroups: MatchGroup[];
  curveSupportRecords: Array<Record<string, number | boolean | string>>;
  groupRecords: Array<Record<string, number | boolean>>;
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
      point: path[0], outward: endpointDirection(path, 0) });
    endpointInfo.set(`${pathIndex}:1`, { pathIndex, endpoint: 1,
      point: path[path.length - 1], outward: endpointDirection(path, 1) });
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
  const groupRecords: Array<Record<string, number | boolean>> = [];
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
    const distanceWeight = Math.exp(-0.5 * (meanDistance / Math.max(2, bandRadius * 0.55)) ** 2);
    const coverageWeight = (1 - Math.exp(-directLength / Math.max(2, 0.010 * faceWidth))) *
      Math.sqrt(clamp(coverage));
    const influence = distanceWeight * direction * Math.sqrt(Math.max(0, coverageWeight * continuity));
    const accepted = records.length >= 2 && directLength >= 0.75 && influence >= 0.025;
    const summary = {
      wrinkle_segment_id: trendIndex,
      rstl_curve_index: curveIndex,
      direct_match_point_count: records.length,
      direct_evidence_arc_length_px: directLength,
      normalized_direct_evidence_arc_length: directLength / faceWidth,
      sample_coverage: coverage,
      continuity,
      curve_influence: influence,
      accepted,
    };
    groupRecords.push(summary);
    if (accepted) acceptedGroups.push({ trendIndex, curveIndex, records, directLength,
      coverage, influence, summary });
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
  return {
    acceptedGroups: acceptedGroups.filter((group) => acceptedCurves.has(group.curveIndex)),
    curveSupportRecords, groupRecords, bandRadius,
    candidatePairCount, directionRejectedPairCount,
  };
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
      const data = 4.5 * normalizedSupport[local];
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

function geometryGuard(
  curve: CurveGeometry,
  offsets: Float64Array,
  intervals: Interval[],
  size: number,
  options: V6RefinementOptions,
): { scaled: number; rolledBack: number } {
  const priorTurns = turnAngles(curve.prior);
  const maximumChange = (options.maxCurvatureChangeDegrees ?? 18) * Math.PI / 180;
  let scaled = 0, rolledBack = 0;
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
    } else if (scale < 0.999) scaled += 1;
  }
  return { scaled, rolledBack };
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
  const guardEvents: Array<Record<string, number | string | Interval>> = [];
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
          if (evidence.normalOffset >= 0) {
            positiveNumerator[index] += support * evidence.normalOffset;
            positiveSupport[index] += support;
          } else {
            negativeNumerator[index] += support * Math.abs(evidence.normalOffset);
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
      offsets.set(solveInterval(raw, support, start, end, options.smoothingPasses ?? 48), start);
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
      rollbackReason: null,
    };
  });
  return { results, guardEvents, p90Limit, maximumDisplacement,
    geometryScaled, geometryRolledBack };
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
  const softLinkDistance = options.softLinkDistancePx ?? SOFT_LINK_FACE_RATIO * faceWidth;
  const tangentWindow = options.tangentWindowPx ?? SOFT_LINK_FACE_RATIO * faceWidth;
  const rawPaths = orderedSkeletonPaths(skeleton, size);
  const trends = mergeTrendPaths(rawPaths, softLinkDistance).map((trend) => ({
    ...trend,
    metrics: polylineMetrics(trend.points, tangentWindow, directionQ, size),
  }));
  const curves = seeds.map((seed) => buildCurveGeometry(seed, tangentWindow));
  const matching = matchTrendsToCurves(
    trends, curves, confidence, size, faceWidth, options,
  );
  const refined = refineCurves(curves, matching, faceWidth, size, options);
  const intersection = rollbackNewIntersections(
    refined.results, curves.map((curve) => curve.prior),
  );

  const outputCurves = refined.results.map((result, curveIndex) => ({
    ...result.curve.seed,
    pts: result.points.map((point) => [...point]),
    priorPts: result.curve.prior.map((point) => [...point]),
    normalOffsetsPx: Array.from(result.offsets),
    affectedIntervals: result.intervals.map((interval) => [...interval]),
    rollbackReason: result.rollbackReason,
    curveIndex,
  }));
  const outputLines = outputCurves.map((curve) => ({
    name: curve.name,
    region: curve.region,
    points_prior_xy: curve.priorPts.map((point) => [...point]),
    points_xy: curve.pts.map((point) => [...point]),
    normal_offsets_px: [...curve.normalOffsetsPx],
    affected_intervals: curve.affectedIntervals.map((interval) => [...interval]),
    rollback_reason: curve.rollbackReason,
  }));
  const movedPointCount = outputCurves.reduce((sum, curve) => sum +
    curve.normalOffsetsPx.filter((value) => Math.abs(value) > 0.05).length, 0);
  const movedCurveCount = outputCurves.filter((curve) =>
    curve.normalOffsetsPx.some((value) => Math.abs(value) > 0.05)).length;
  const pointCount = outputCurves.reduce((sum, curve) => sum + curve.pts.length, 0);
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
    soft_link_distance_ratio_face_width: SOFT_LINK_FACE_RATIO,
    soft_link_max_gap_px: softLinkDistance,
    wrinkle_tangent_window_ratio_face_width: SOFT_LINK_FACE_RATIO,
    wrinkle_tangent_window_px: tangentWindow,
    search_radius_px: matching.bandRadius,
    band_candidate_pair_count: matching.candidatePairCount,
    direction_rejected_pair_count: matching.directionRejectedPairCount,
    curve_influence_records: matching.groupRecords,
    curve_support_records: matching.curveSupportRecords,
    displacement_p90_guard_scope: "curve_affected_interval",
    displacement_p90_limit_ratio_face_width: P90_FACE_RATIO,
    displacement_p90_limit_px: refined.p90Limit,
    displacement_p90_scaled_interval_count: refined.guardEvents.length,
    displacement_p90_interval_events: refined.guardEvents,
    maximum_displacement_px: refined.maximumDisplacement,
    geometry_guard_scaled_interval_count: refined.geometryScaled,
    geometry_guard_rollback_interval_count: refined.geometryRolledBack,
    intersection_rollback_curve_count: intersection.rolledBack.size,
    post_export_new_intersection_pair_count: intersection.newPairs.length,
    post_export_new_self_cross_curve_count: intersection.newSelf,
    topology_contract_preserved: outputCurves.length === seeds.length &&
      outputCurves.every((curve, index) => curve.pts.length === curvePriorPoints(seeds[index]).length),
    normal_displacement_only: true,
  };
  return { curves: outputCurves, lines: outputLines, diagnostics, wrinkleSkeleton: skeleton };
}
