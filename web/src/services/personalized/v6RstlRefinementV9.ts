/**
 * Browser-ready wrinkle-guided RSTL V6 refinement.
 *
 * The module is deliberately data-only: no DOM, camera, network, or Node APIs.
 * It consumes a binary wrinkle mask in the same canonical 2D coordinate space
 * as the supplied curves and returns a fixed-connectivity curve set.
 */

export const V6_RSTL_ALGORITHM =
  "regional-wrinkle-guided-smooth-rstl-refinement-7.2";

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
  twoSidedNearestMatching?: boolean;
  foreheadNearestSingleCurveMatching?: boolean;
  regionalNearestSingleCurveMatching?: boolean;
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
  curvatureFairing?: boolean;
  curvatureFairingPasses?: number;
  curvatureFairingMaximumTurnDegrees?: number;
  curvatureFairingStrictMaximumTurnDegrees?: number;
  curvatureFairingBaselineSlackDegrees?: number;
  curvatureFairingMaterialTurnDegrees?: number;
  curvatureFairingMaximumAddedSignChanges?: number;
  curvatureFairingForeheadMaximumAddedSignChanges?: number;
  curvatureFairingEndpointTangentChangeDegrees?: number;
  curvatureFairingStrictRegion?: string;
  curvatureFairingMaximumMeanAdherencePx?: number;
  curvatureFairingMaximumP90AdherencePx?: number;
  curvatureFairingForeheadMaximumTurnDegrees?: number;
  curvatureFairingForeheadMaximumMeanAdherencePx?: number;
  curvatureFairingForeheadMaximumP90AdherencePx?: number;
  curvatureFairingGlabellarMaximumTurnDegrees?: number;
  curvatureFairingGlabellarMaximumAddedSignChanges?: number;
  curvatureFairingGlabellarMaximumMeanAdherencePx?: number;
  curvatureFairingGlabellarMaximumP90AdherencePx?: number;
  curvatureFairingGlabellarMinimumReversalSpacingPx?: number;
  curvatureFairingNoseBridgeMaximumTurnDegrees?: number;
  curvatureFairingNoseBridgeMaximumAddedSignChanges?: number;
  curvatureFairingNoseBridgeMaximumMeanAdherencePx?: number;
  curvatureFairingNoseBridgeMaximumP90AdherencePx?: number;
  curvatureFairingNoseBridgeMinimumReversalSpacingPx?: number;
  curvatureFairingCrowsFeetMaximumTurnDegrees?: number;
  curvatureFairingCrowsFeetMaximumAddedSignChanges?: number;
  curvatureFairingCrowsFeetMaximumMeanAdherencePx?: number;
  curvatureFairingCrowsFeetMaximumP90AdherencePx?: number;
  curvatureFairingCrowsFeetMinimumReversalSpacingPx?: number;
  foreheadAdherenceMeanThresholdPx?: number;
  foreheadAdherenceP90ThresholdPx?: number;
  glabellarAdherenceMeanThresholdPx?: number;
  glabellarAdherenceP90ThresholdPx?: number;
  glabellarMaximumDisplacementPx?: number;
  glabellarTransitionLengthPx?: number;
  noseBridgeAdherenceMeanThresholdPx?: number;
  noseBridgeAdherenceP90ThresholdPx?: number;
  crowsFeetAdherenceMeanThresholdPx?: number;
  crowsFeetAdherenceP90ThresholdPx?: number;
  crowsFeetMaximumDisplacementPx?: number;
  crowsFeetTransitionLengthPx?: number;
  regionalCandidateFamilyFiltering?: boolean;
  foreheadBundleCoherence?: boolean;
  foreheadBundleMinimumSpacingRatio?: number;
  foreheadBundleMaximumSpacingRatio?: number;
  foreheadBundleMaximumTurnDegrees?: number;
  foreheadBundleMaximumAddedSignChanges?: number;
  foreheadBundleMinimumReversalSpacingPx?: number;
  noseBridgeMaximumDisplacementPx?: number;
  noseBridgeP90LimitPx?: number;
  noseBridgeTransitionLengthPx?: number;
  noseBridgePlanarWarpTransitionPx?: number;
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
  wrinklePoint: Point2;
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
  meanSignedNormalOffset: number;
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
              normalOffset: (deltaX * segment.normal[0] + deltaY * segment.normal[1]) *
                (segment.normal[1] > EPSILON ||
                 (Math.abs(segment.normal[1]) <= EPSILON && segment.normal[0] >= 0) ? 1 : -1),
              wrinklePoint: [...point],
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
    const meanSignedNormalOffset = records.reduce(
      (sum, record) => sum + record.normalOffset, 0,
    ) / records.length;
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
      mean_signed_normal_offset_px: meanSignedNormalOffset,
      wrinkle_side: meanSignedNormalOffset >= 0 ? "upper" : "lower",
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
      coverage, influence, meanDistance, meanSignedNormalOffset,
      projectionArcStart, projectionArcEnd, summary });
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
  const twoSidedCompleteTrends = new Set<number>();
  if (options.twoSidedNearestMatching === true) {
    const foreheadTrendIndices = new Set<number>();
    if (options.foreheadNearestSingleCurveMatching === true) {
      for (const group of curveEligibleGroups) {
        if (String(curves[group.curveIndex].seed.region || "").includes("forehead")) {
          foreheadTrendIndices.add(group.trendIndex);
        }
      }
    }
    const foreheadAssignments = new Map<number, MatchGroup>();
    const foreheadOwnerByCurve = new Map<number, MatchGroup>();
    const foreheadCandidates = new Map<number, MatchGroup[]>();
    for (const trendIndex of foreheadTrendIndices) {
      const candidates = curveEligibleGroups.filter((group) =>
        group.trendIndex === trendIndex &&
        String(curves[group.curveIndex].seed.region || "").includes("forehead"))
        .sort((left, right) => left.meanDistance - right.meanDistance ||
          right.influence - left.influence || left.curveIndex - right.curveIndex);
      if (candidates.length) foreheadCandidates.set(trendIndex, candidates);
    }
    const nextForeheadCandidate = new Map<number, number>();
    const foreheadQueue = [...foreheadCandidates.keys()].sort((left, right) => left - right);
    while (foreheadQueue.length) {
      const trendIndex = foreheadQueue.shift() as number;
      if (foreheadAssignments.has(trendIndex)) continue;
      const candidates = foreheadCandidates.get(trendIndex) || [];
      let candidateIndex = nextForeheadCandidate.get(trendIndex) || 0;
      while (candidateIndex < candidates.length) {
        const candidate = candidates[candidateIndex];
        nextForeheadCandidate.set(trendIndex, candidateIndex + 1);
        candidateIndex += 1;
        const owner = foreheadOwnerByCurve.get(candidate.curveIndex);
        const candidateWins = !owner || candidate.meanDistance < owner.meanDistance - EPSILON ||
          (Math.abs(candidate.meanDistance - owner.meanDistance) <= EPSILON &&
           (candidate.influence > owner.influence + EPSILON ||
            (Math.abs(candidate.influence - owner.influence) <= EPSILON &&
             candidate.trendIndex < owner.trendIndex)));
        if (!candidateWins) continue;
        if (owner) {
          foreheadAssignments.delete(owner.trendIndex);
          foreheadQueue.push(owner.trendIndex);
        }
        foreheadOwnerByCurve.set(candidate.curveIndex, candidate);
        foreheadAssignments.set(trendIndex, candidate);
        break;
      }
    }
    for (const group of foreheadAssignments.values()) {
      group.summary.forehead_single_curve_selected = true;
    }
    const reservedForeheadCurves = new Set([...foreheadAssignments.values()]
      .map((group) => group.curveIndex));
    const regionalTrendRegions = new Map<number, GuidedWrinkleRegion>();
    if (options.regionalNearestSingleCurveMatching === true) {
      for (let trendIndex = 0; trendIndex < trends.length; trendIndex += 1) {
        if (foreheadTrendIndices.has(trendIndex)) continue;
        const region = classifyGuidedWrinkleRegion(trends[trendIndex], size, faceWidth);
        if (region) regionalTrendRegions.set(trendIndex, region);
      }
    }
    type RegionalSlot = {
      key: string;
      trendIndex: number;
      guidedRegion: GuidedWrinkleRegion;
      imageSide: "left" | "right" | null;
    };
    const regionalSlots = new Map<string, RegionalSlot>();
    const regionalAssignments = new Map<string, MatchGroup>();
    const regionalOwnerByCurve = new Map<number, { slotKey: string; group: MatchGroup }>();
    const regionalCandidates = new Map<string, MatchGroup[]>();
    for (const [trendIndex, guidedRegion] of regionalTrendRegions) {
      const baseCandidates = curveEligibleGroups.filter((group) =>
        group.trendIndex === trendIndex &&
        !reservedForeheadCurves.has(group.curveIndex) &&
        !String(curves[group.curveIndex].seed.region || "").includes("forehead") &&
        (options.regionalCandidateFamilyFiltering !== true ||
          guidedRegionCandidateCompatible(guidedRegion, curves[group.curveIndex])) &&
        guidedRegionSideCompatible(
          guidedRegion, trends[trendIndex], curves[group.curveIndex], size,
        ));
      const imageSides: Array<"left" | "right" | null> = [null];
      for (const imageSide of imageSides) {
        const key = `${trendIndex}:${imageSide || "single"}`;
        const candidates = baseCandidates.filter((group) => {
          if (imageSide === null) return true;
          const meanEvidenceX = group.records.reduce((sum, record) =>
            sum + record.wrinklePoint[0], 0) / Math.max(1, group.records.length);
          return imageSide === "left" ? meanEvidenceX < size * 0.5 :
            meanEvidenceX >= size * 0.5;
        }).sort((left, right) => left.meanDistance - right.meanDistance ||
          right.influence - left.influence || left.curveIndex - right.curveIndex);
        if (!candidates.length) continue;
        regionalSlots.set(key, { key, trendIndex, guidedRegion, imageSide });
        regionalCandidates.set(key, candidates);
      }
    }
    const noseTrendOrder = [...regionalTrendRegions.entries()]
      .filter(([, region]) => region === "nose_bridge")
      .map(([trendIndex]) => trendIndex)
      .sort((left, right) => {
        const leftY = trends[left].points.reduce((sum, point) => sum + point[1], 0) /
          Math.max(1, trends[left].points.length);
        const rightY = trends[right].points.reduce((sum, point) => sum + point[1], 0) /
          Math.max(1, trends[right].points.length);
        return leftY - rightY;
      });
    const noseCurveOrder = curves.map((curve, curveIndex) => ({ curve, curveIndex }))
      .filter(({ curve }) => String(curve.seed.region || "") === "nose_root_cross_v9")
      .sort((left, right) => {
        const leftPoint = [...left.curve.prior].sort((first, second) =>
          Math.abs(first[0] - size * 0.5) - Math.abs(second[0] - size * 0.5))[0];
        const rightPoint = [...right.curve.prior].sort((first, second) =>
          Math.abs(first[0] - size * 0.5) - Math.abs(second[0] - size * 0.5))[0];
        return leftPoint[1] - rightPoint[1];
      }).map(({ curveIndex }) => curveIndex);
    const regionalPriority = (slotKey: string): number => {
      const region = regionalSlots.get(slotKey)?.guidedRegion;
      return region === "glabellar" ? 0 : region === "nose_bridge" ? 1 : 2;
    };
    const regionalCandidateCost = (slotKey: string, group: MatchGroup): number => {
      const slot = regionalSlots.get(slotKey) as RegionalSlot;
      if (slot.guidedRegion !== "nose_bridge") return group.meanDistance;
      const trendRank = noseTrendOrder.indexOf(slot.trendIndex);
      const curveRank = noseCurveOrder.indexOf(group.curveIndex);
      return 1000 * Math.abs(trendRank - curveRank) + group.meanDistance;
    };
    for (const [slotKey, candidates] of regionalCandidates) {
      candidates.sort((left, right) =>
        regionalCandidateCost(slotKey, left) - regionalCandidateCost(slotKey, right) ||
        left.meanDistance - right.meanDistance || right.influence - left.influence ||
        left.curveIndex - right.curveIndex);
    }
    const nextRegionalCandidate = new Map<string, number>();
    const regionalQueue = [...regionalCandidates.keys()].sort();
    while (regionalQueue.length) {
      const slotKey = regionalQueue.shift() as string;
      if (regionalAssignments.has(slotKey)) continue;
      const candidates = regionalCandidates.get(slotKey) || [];
      let candidateIndex = nextRegionalCandidate.get(slotKey) || 0;
      while (candidateIndex < candidates.length) {
        const candidate = candidates[candidateIndex];
        nextRegionalCandidate.set(slotKey, candidateIndex + 1);
        candidateIndex += 1;
        const owner = regionalOwnerByCurve.get(candidate.curveIndex);
        const candidatePriority = regionalPriority(slotKey);
        const ownerPriority = owner ? regionalPriority(owner.slotKey) : Infinity;
        const candidateCost = regionalCandidateCost(slotKey, candidate);
        const ownerCost = owner ? regionalCandidateCost(owner.slotKey, owner.group) : Infinity;
        const candidateWins = !owner ||
          candidatePriority < ownerPriority ||
          (candidatePriority === ownerPriority &&
           (candidateCost < ownerCost - EPSILON ||
            (Math.abs(candidateCost - ownerCost) <= EPSILON &&
             (candidate.influence > owner.group.influence + EPSILON ||
              (Math.abs(candidate.influence - owner.group.influence) <= EPSILON &&
               slotKey < owner.slotKey)))));
        if (!candidateWins) continue;
        if (owner) {
          regionalAssignments.delete(owner.slotKey);
          regionalQueue.push(owner.slotKey);
        }
        regionalOwnerByCurve.set(candidate.curveIndex, { slotKey, group: candidate });
        regionalAssignments.set(slotKey, candidate);
        break;
      }
    }
    const completeNoseBridgeTrends = new Set<number>();
    for (const [trendIndex, guidedRegion] of regionalTrendRegions) {
      if (guidedRegion !== "nose_bridge") continue;
      if (regionalAssignments.has(`${trendIndex}:single`)) {
        completeNoseBridgeTrends.add(trendIndex);
      }
    }
    const finalRegionalAssignments = [...regionalAssignments.entries()].filter(([slotKey]) => {
      const slot = regionalSlots.get(slotKey) as RegionalSlot;
      return slot.guidedRegion !== "nose_bridge" ||
        completeNoseBridgeTrends.has(slot.trendIndex);
    });
    for (const [slotKey, group] of finalRegionalAssignments) {
      const slot = regionalSlots.get(slotKey) as RegionalSlot;
      group.summary.regional_curve_selected = true;
      group.summary.guided_region = slot.guidedRegion;
      group.summary.guided_image_side = slot.imageSide;
      if (slot.guidedRegion === "nose_bridge") {
        group.summary.regional_ordered_cross_curve_selected = true;
      }
      group.summary.regional_single_curve_selected = true;
    }
    const regionalSelectedGroups = finalRegionalAssignments.map(([, group]) => group);
    const reservedRegionalCurves = new Set(regionalSelectedGroups.map((group) => group.curveIndex));
    const pairedEligibleGroups = curveEligibleGroups.filter((group) =>
      !foreheadTrendIndices.has(group.trendIndex) &&
      !regionalTrendRegions.has(group.trendIndex) &&
      !reservedForeheadCurves.has(group.curveIndex) &&
      !reservedRegionalCurves.has(group.curveIndex));
    const candidatesBySlot = new Map<string, MatchGroup[]>();
    for (const group of pairedEligibleGroups) {
      const side = group.meanSignedNormalOffset >= 0 ? "upper" : "lower";
      const key = `${group.trendIndex}:${side}`;
      const candidates = candidatesBySlot.get(key) || [];
      candidates.push(group);
      candidatesBySlot.set(key, candidates);
    }
    for (const candidates of candidatesBySlot.values()) {
      candidates.sort((left, right) => left.meanDistance - right.meanDistance ||
        right.influence - left.influence || left.curveIndex - right.curveIndex);
    }

    type PairProposal = {
      trendIndex: number;
      upper: MatchGroup;
      lower: MatchGroup;
      rankPenalty: number;
      maximumRank: number;
      totalDistance: number;
      influence: number;
    };
    const proposalsByTrend = new Map<number, PairProposal[]>();
    const trendIndices = [...new Set(pairedEligibleGroups.map((group) => group.trendIndex))]
      .sort((left, right) => left - right);
    for (const trendIndex of trendIndices) {
      const upper = candidatesBySlot.get(`${trendIndex}:upper`) || [];
      const lower = candidatesBySlot.get(`${trendIndex}:lower`) || [];
      const proposals: PairProposal[] = [];
      for (let upperRank = 0; upperRank < upper.length; upperRank += 1) {
        for (let lowerRank = 0; lowerRank < lower.length; lowerRank += 1) {
          if (upper[upperRank].curveIndex === lower[lowerRank].curveIndex) continue;
          proposals.push({
            trendIndex,
            upper: upper[upperRank],
            lower: lower[lowerRank],
            rankPenalty: upperRank + lowerRank,
            maximumRank: Math.max(upperRank, lowerRank),
            totalDistance: upper[upperRank].meanDistance + lower[lowerRank].meanDistance,
            influence: upper[upperRank].influence + lower[lowerRank].influence,
          });
        }
      }
      proposals.sort((left, right) => left.rankPenalty - right.rankPenalty ||
        left.maximumRank - right.maximumRank || left.totalDistance - right.totalDistance ||
        right.influence - left.influence ||
        left.upper.curveIndex - right.upper.curveIndex ||
        left.lower.curveIndex - right.lower.curveIndex);
      if (proposals.length) proposalsByTrend.set(trendIndex, proposals);
    }

    const pairByTrend = new Map<number, PairProposal>();
    const ownerByCurve = new Map<number, { proposal: PairProposal; group: MatchGroup }>();
    const nextProposalIndex = new Map<number, number>();
    const queue = [...proposalsByTrend.keys()];
    const candidateWinsCurve = (candidate: MatchGroup, owner: MatchGroup): boolean =>
      candidate.meanDistance < owner.meanDistance - EPSILON ||
      (Math.abs(candidate.meanDistance - owner.meanDistance) <= EPSILON &&
       (candidate.influence > owner.influence + EPSILON ||
        (Math.abs(candidate.influence - owner.influence) <= EPSILON &&
         candidate.trendIndex < owner.trendIndex)));
    while (queue.length) {
      const trendIndex = queue.shift() as number;
      if (pairByTrend.has(trendIndex)) continue;
      const proposals = proposalsByTrend.get(trendIndex) || [];
      let proposalIndex = nextProposalIndex.get(trendIndex) || 0;
      while (proposalIndex < proposals.length) {
        const proposal = proposals[proposalIndex];
        nextProposalIndex.set(trendIndex, proposalIndex + 1);
        proposalIndex += 1;
        const claims = [proposal.upper, proposal.lower];
        const conflicts = claims.map((group) => ({
          group,
          owner: ownerByCurve.get(group.curveIndex),
        })).filter((claim) => claim.owner &&
          claim.owner.proposal.trendIndex !== trendIndex);
        if (conflicts.some((claim) =>
          !candidateWinsCurve(claim.group, claim.owner!.group))) continue;

        const displacedTrends = new Set(conflicts.map((claim) =>
          claim.owner!.proposal.trendIndex));
        for (const displacedTrend of displacedTrends) {
          const displaced = pairByTrend.get(displacedTrend);
          if (!displaced) continue;
          pairByTrend.delete(displacedTrend);
          for (const group of [displaced.upper, displaced.lower]) {
            if (ownerByCurve.get(group.curveIndex)?.proposal.trendIndex === displacedTrend) {
              ownerByCurve.delete(group.curveIndex);
            }
          }
          queue.push(displacedTrend);
        }
        pairByTrend.set(trendIndex, proposal);
        for (const group of claims) {
          ownerByCurve.set(group.curveIndex, { proposal, group });
        }
        break;
      }
    }
    for (const trendIndex of pairByTrend.keys()) twoSidedCompleteTrends.add(trendIndex);
    selectedGroups = [...foreheadAssignments.values(), ...regionalSelectedGroups,
      ...[...pairByTrend.values()].flatMap((proposal) =>
        [proposal.upper, proposal.lower])].sort((left, right) =>
      left.trendIndex - right.trendIndex ||
      left.meanSignedNormalOffset - right.meanSignedNormalOffset ||
      left.curveIndex - right.curveIndex);
  } else if (options.oneToOneTrendCurveMatching === true) {
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
    if (options.twoSidedNearestMatching === true) {
      record.two_sided_pair_complete = twoSidedCompleteTrends.has(
        record.wrinkle_segment_id,
      );
    }
    record.provisional_accepted = record.accepted && curveSupportPassed && record.selected_for_wrinkle;
    record.final_accepted = record.provisional_accepted;
    record.final_status = record.final_accepted ? "accepted" : "rejected_before_refinement";
    if (options.intervalAwareAnchorSharing === true && record.selected_for_wrinkle) {
      record.anchor_interval_shared = (selectedCountByCurve.get(record.rstl_curve_index) || 0) > 1;
    }
    const candidateGroup = acceptedGroups.find((group) => group.summary === record);
    const selectedCurveElsewhere = (options.twoSidedNearestMatching === true ||
      options.oneToOneTrendCurveMatching === true) &&
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
            options.twoSidedNearestMatching === true &&
              !record.two_sided_pair_complete ? "missing_opposite_side_candidate" :
            options.twoSidedNearestMatching === true ?
              "nearer_curve_on_same_wrinkle_side_selected" : "better_curve_match_selected";
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
  allowOpenCurveEnds = false,
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
  const pinStart = start > 0 || !allowOpenCurveEnds;
  const pinEnd = end < raw.length || !allowOpenCurveEnds;
  if (pinStart && length > 0) output[0] = 0;
  if (pinEnd && length > 1) output[length - 1] = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float64Array(output);
    for (let local = 1; local < length - 1; local += 1) {
      const data = dataAttractionStrength * normalizedSupport[local];
      next[local] = (data * raw[start + local] + 1.2 * output[local] +
        1.1 * (output[local - 1] + output[local + 1])) / (data + 3.4);
    }
    output.set(next);
    if (pinStart && length > 0) output[0] = 0;
    if (pinEnd && length > 1) output[length - 1] = 0;
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
interface CurvatureMetrics {
  maximumTurnDegrees: number;
  materialSignChanges: number;
  materialSignChangeArcPositionsPx: number[];
  minimumMaterialSignChangeSpacingPx: number | null;
  turnVariationDegrees: number;
}

type GuidedWrinkleRegion = "glabellar" | "nose_bridge" | "crows_feet";
type FairingRegion = "forehead" | GuidedWrinkleRegion;

function classifyGuidedWrinkleRegion(
  trend: Trend, size: number, faceWidth: number,
): GuidedWrinkleRegion | null {
  if (!trend.points.length) return null;
  const xs = trend.points.map((point) => point[0]);
  const ys = trend.points.map((point) => point[1]);
  const centerX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const centerY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const centerDistance = Math.abs(centerX - size * 0.5);
  const central = centerDistance <= faceWidth * 0.16;
  if (central && spanY >= Math.max(20, spanX * 1.5) && centerY < size * 0.39) {
    return "glabellar";
  }
  if (central && spanX >= Math.max(20, spanY * 2) &&
      centerY >= size * 0.36 && centerY <= size * 0.44) {
    return "nose_bridge";
  }
  if (centerDistance >= faceWidth * 0.25 &&
      centerY >= size * 0.38 && centerY <= size * 0.52) {
    return "crows_feet";
  }
  return null;
}

function guidedRegionForResult(result: any): FairingRegion | null {
  const guidedRegions = [...new Set<GuidedWrinkleRegion>((result.matchGroups || [])
    .map((group: MatchGroup) => group.summary.guided_region)
    .filter((region: unknown): region is GuidedWrinkleRegion =>
      region === "glabellar" || region === "nose_bridge" || region === "crows_feet"))];
  if (guidedRegions.length === 1) return guidedRegions[0];
  return String(result.curve.seed.region || "").includes("forehead") ? "forehead" : null;
}

function explicitPositive(value: unknown, fallback: number, minimum: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.max(minimum, numeric) : fallback;
}

function guidedRegionCandidateCompatible(
  guidedRegion: GuidedWrinkleRegion, curve: CurveGeometry,
): boolean {
  const seedRegion = String(curve.seed.region || "");
  if (guidedRegion === "glabellar") return seedRegion === "orbital_brow_upturn_v11";
  if (guidedRegion === "nose_bridge") return seedRegion === "nose_root_cross_v9";
  return seedRegion === "lateral_canthus_short_arc_v65" ||
    seedRegion === "cheek_gap_density_v53";
}

function guidedRegionSideCompatible(
  guidedRegion: GuidedWrinkleRegion, trend: Trend, curve: CurveGeometry, size: number,
): boolean {
  if (guidedRegion === "nose_bridge") return true;
  const trendX = trend.points.reduce((sum, point) => sum + point[0], 0) /
    Math.max(1, trend.points.length);
  const xs = curve.prior.map((point) => point[0]);
  const minimumX = Math.min(...xs), maximumX = Math.max(...xs);
  if (minimumX < size * 0.48 && maximumX > size * 0.52) return true;
  const curveX = xs.reduce((sum, value) => sum + value, 0) / Math.max(1, xs.length);
  return (trendX < size * 0.5) === (curveX < size * 0.5);
}

function signedTurnAnglesDegrees(points: Point2[]): Float64Array {
  const output = new Float64Array(points.length);
  for (let index = 1; index < points.length - 1; index += 1) {
    const first = normalize2(points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1]);
    const second = normalize2(points[index + 1][0] - points[index][0],
      points[index + 1][1] - points[index][1]);
    output[index] = Math.atan2(
      first[0] * second[1] - first[1] * second[0],
      clamp(first[0] * second[0] + first[1] * second[1], -1, 1),
    ) * 180 / Math.PI;
  }
  return output;
}

function curvatureMetrics(points: Point2[], materialTurnDegrees: number): CurvatureMetrics {
  const turns = signedTurnAnglesDegrees(points);
  const vertexArc = new Float64Array(points.length);
  for (let index = 1; index < points.length; index += 1) {
    vertexArc[index] = vertexArc[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
  }
  let maximumTurnDegrees = 0, materialSignChanges = 0, turnVariationDegrees = 0;
  let priorMaterialSign = 0, previousTurn = 0, hasPreviousTurn = false;
  const materialSignChangeArcPositionsPx = [];
  for (let index = 1; index < turns.length - 1; index += 1) {
    const turn = turns[index];
    maximumTurnDegrees = Math.max(maximumTurnDegrees, Math.abs(turn));
    if (hasPreviousTurn) turnVariationDegrees += Math.abs(turn - previousTurn);
    previousTurn = turn;
    hasPreviousTurn = true;
    if (Math.abs(turn) < materialTurnDegrees) continue;
    const sign = Math.sign(turn);
    if (priorMaterialSign && sign !== priorMaterialSign) {
      materialSignChanges += 1;
      materialSignChangeArcPositionsPx.push(vertexArc[index]);
    }
    priorMaterialSign = sign;
  }
  let minimumMaterialSignChangeSpacingPx: number | null = null;
  for (let index = 1; index < materialSignChangeArcPositionsPx.length; index += 1) {
    const spacing = materialSignChangeArcPositionsPx[index] -
      materialSignChangeArcPositionsPx[index - 1];
    minimumMaterialSignChangeSpacingPx = minimumMaterialSignChangeSpacingPx === null ?
      spacing : Math.min(minimumMaterialSignChangeSpacingPx, spacing);
  }
  return {
    maximumTurnDegrees,
    materialSignChanges,
    materialSignChangeArcPositionsPx,
    minimumMaterialSignChangeSpacingPx,
    turnVariationDegrees,
  };
}

function directedAngleDegrees(first: Point2, second: Point2): number {
  if (!(first[0] || first[1]) || !(second[0] || second[1])) return 0;
  return Math.acos(clamp(first[0] * second[0] + first[1] * second[1], -1, 1)) *
    180 / Math.PI;
}

function endpointTangentChangeDegrees(prior: Point2[], candidate: Point2[]): number {
  if (prior.length < 2 || candidate.length < 2) return 0;
  const priorStart = normalize2(prior[1][0] - prior[0][0], prior[1][1] - prior[0][1]);
  const finalStart = normalize2(candidate[1][0] - candidate[0][0],
    candidate[1][1] - candidate[0][1]);
  const last = prior.length - 1;
  const priorEnd = normalize2(prior[last][0] - prior[last - 1][0],
    prior[last][1] - prior[last - 1][1]);
  const finalEnd = normalize2(candidate[last][0] - candidate[last - 1][0],
    candidate[last][1] - candidate[last - 1][1]);
  return Math.max(
    directedAngleDegrees(priorStart, finalStart),
    directedAngleDegrees(priorEnd, finalEnd),
  );
}

function curvatureContinuousEnvelope(parameter: number): number {
  const value = clamp(parameter);
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function fairNormalOffsets(
  curve: CurveGeometry,
  source: Float64Array,
  intervals: Interval[],
  passes: number,
  dataWeight: number,
  allowOpenCurveEnds = false,
): Float64Array {
  const output = new Float64Array(source);
  for (const [start, end] of intervals) {
    if (end - start < 3) continue;
    const pinStart = start > 0 || !allowOpenCurveEnds;
    const pinEnd = end < source.length || !allowOpenCurveEnds;
    const intervalArc = Math.max(EPSILON,
      curve.vertexArc[end - 1] - curve.vertexArc[start]);
    const sampleSpans = [];
    for (let index = start + 1; index < end; index += 1) {
      sampleSpans.push(curve.vertexArc[index] - curve.vertexArc[index - 1]);
    }
    const taperArc = Math.max(EPSILON, Math.min(
      intervalArc * 0.30,
      percentile(sampleSpans, 0.5) * 6,
    ));
    const original = new Float64Array(end - start);
    for (let index = start; index < end; index += 1) {
      const edgeDistance = Math.min(
        pinStart ? curve.vertexArc[index] - curve.vertexArc[start] : Infinity,
        pinEnd ? curve.vertexArc[end - 1] - curve.vertexArc[index] : Infinity,
      );
      const parameter = clamp(edgeDistance / taperArc);
      const envelope = curvatureContinuousEnvelope(parameter);
      original[index - start] = source[index] * envelope;
      output[index] = original[index - start];
    }
    for (let pass = 0; pass < passes; pass += 1) {
      const next = new Float64Array(output);
      for (let index = start + 1; index < end - 1; index += 1) {
        const previousSpan = Math.max(EPSILON,
          curve.vertexArc[index] - curve.vertexArc[index - 1]);
        const nextSpan = Math.max(EPSILON,
          curve.vertexArc[index + 1] - curve.vertexArc[index]);
        const arcLinear = (
          nextSpan * output[index - 1] + previousSpan * output[index + 1]
        ) / (previousSpan + nextSpan);
        next[index] = dataWeight * original[index - start] + (1 - dataWeight) * arcLinear;
      }
      if (!pinStart) {
        next[start] = dataWeight * original[0] + (1 - dataWeight) * output[start + 1];
      }
      if (!pinEnd) {
        next[end - 1] = dataWeight * original[end - start - 1] +
          (1 - dataWeight) * output[end - 2];
      }
      output.set(next);
      if (pinStart) output[start] = 0;
      if (pinEnd) output[end - 1] = 0;
    }
  }
  return output;
}

function gaussianFairNormalOffsets(
  curve: CurveGeometry,
  source: Float64Array,
  intervals: Interval[],
  sigmaArc: number,
  allowOpenCurveEnds = false,
): Float64Array {
  const output = new Float64Array(source);
  const radius = Math.max(EPSILON, sigmaArc * 3);
  for (const [start, end] of intervals) {
    if (end - start < 3) continue;
    const pinStart = start > 0 || !allowOpenCurveEnds;
    const pinEnd = end < source.length || !allowOpenCurveEnds;
    const intervalArc = Math.max(EPSILON,
      curve.vertexArc[end - 1] - curve.vertexArc[start]);
    const sampleSpans = [];
    for (let index = start + 1; index < end; index += 1) {
      sampleSpans.push(curve.vertexArc[index] - curve.vertexArc[index - 1]);
    }
    const taperArc = Math.max(EPSILON, Math.min(
      intervalArc * 0.30,
      percentile(sampleSpans, 0.5) * 6,
    ));
    const original = new Float64Array(end - start);
    for (let index = start; index < end; index += 1) {
      const edgeDistance = Math.min(
        pinStart ? curve.vertexArc[index] - curve.vertexArc[start] : Infinity,
        pinEnd ? curve.vertexArc[end - 1] - curve.vertexArc[index] : Infinity,
      );
      const parameter = clamp(edgeDistance / taperArc);
      original[index - start] = source[index] * curvatureContinuousEnvelope(parameter);
    }
    const firstIndex = pinStart ? start + 1 : start;
    const lastIndex = pinEnd ? end - 1 : end;
    for (let index = firstIndex; index < lastIndex; index += 1) {
      let numerator = 0, denominator = 0;
      for (let neighbor = start; neighbor < end; neighbor += 1) {
        const distance = Math.abs(curve.vertexArc[neighbor] - curve.vertexArc[index]);
        if (distance > radius) continue;
        const weight = Math.exp(-0.5 * (distance / sigmaArc) ** 2);
        numerator += weight * original[neighbor - start];
        denominator += weight;
      }
      output[index] = denominator > EPSILON ? numerator / denominator : original[index - start];
    }
    if (pinStart) output[start] = 0;
    if (pinEnd) output[end - 1] = 0;
  }
  return output;
}

function solveDenseLinearSystem(matrix: number[][], rightHandSide: number[]): number[] {
  const size = rightHandSide.length;
  const augmented = matrix.map((row, index) => [...row, rightHandSide[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (pivot !== column) [augmented[column], augmented[pivot]] =
      [augmented[pivot], augmented[column]];
    const diagonal = augmented[column][column];
    if (Math.abs(diagonal) <= EPSILON) continue;
    for (let entry = column; entry <= size; entry += 1) augmented[column][entry] /= diagonal;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (Math.abs(factor) <= EPSILON) continue;
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }
  return augmented.map((row) => Number.isFinite(row[size]) ? row[size] : 0);
}

function sineSeriesFairNormalOffsets(
  curve: CurveGeometry,
  source: Float64Array,
  intervals: Interval[],
  modeCount: number,
): Float64Array {
  const output = new Float64Array(source.length);
  for (const [start, end] of intervals) {
    if (end - start < 3) continue;
    const arcStart = curve.vertexArc[start];
    const arcSpan = Math.max(EPSILON, curve.vertexArc[end - 1] - arcStart);
    const count = Math.min(modeCount, end - start - 2);
    const gram = Array.from({ length: count }, () => Array(count).fill(0));
    const rhs = Array(count).fill(0);
    for (let index = start + 1; index < end - 1; index += 1) {
      const t = (curve.vertexArc[index] - arcStart) / arcSpan;
      const basis = Array.from({ length: count }, (_, mode) =>
        Math.sin(Math.PI * (mode + 1) * t));
      for (let row = 0; row < count; row += 1) {
        rhs[row] += basis[row] * source[index];
        for (let column = 0; column < count; column += 1) {
          gram[row][column] += basis[row] * basis[column];
        }
      }
    }
    for (let mode = 0; mode < count; mode += 1) {
      gram[mode][mode] += 1e-6 * (mode + 1) ** 4;
    }
    const coefficients = solveDenseLinearSystem(gram, rhs);
    for (let index = start + 1; index < end - 1; index += 1) {
      const t = (curve.vertexArc[index] - arcStart) / arcSpan;
      let value = 0;
      for (let mode = 0; mode < count; mode += 1) {
        value += coefficients[mode] * Math.sin(Math.PI * (mode + 1) * t);
      }
      output[index] = value;
    }
  }
  return output;
}

function guidedPolynomialOffsets(
  curve: CurveGeometry,
  records: MatchRecord[],
  degree: number,
  taperArcPx: number,
  maximumDisplacementPx: number,
  targetGapPx: number,
): Float64Array {
  const output = new Float64Array(curve.prior.length);
  if (!records.length) return output;
  const minimumArc = Math.min(...records.map((record) => record.projectionArc));
  const maximumArc = Math.max(...records.map((record) => record.projectionArc));
  const centerArc = 0.5 * (minimumArc + maximumArc);
  const arcScale = Math.max(10, 0.5 * (maximumArc - minimumArc));
  const coefficientCount = Math.max(1, Math.min(4, degree + 1));
  const gram = Array.from({ length: coefficientCount }, () =>
    Array(coefficientCount).fill(0));
  const rhs = Array(coefficientCount).fill(0);
  for (const record of records) {
    const parameter = clamp((record.projectionArc - centerArc) / arcScale, -2, 2);
    const basis = Array.from({ length: coefficientCount }, (_, power) => parameter ** power);
    const target = Math.sign(record.normalOffset) *
      Math.max(0, Math.abs(record.normalOffset) - targetGapPx);
    const weight = Math.max(EPSILON, record.score * record.confidence);
    for (let row = 0; row < coefficientCount; row += 1) {
      rhs[row] += weight * basis[row] * target;
      for (let column = 0; column < coefficientCount; column += 1) {
        gram[row][column] += weight * basis[row] * basis[column];
      }
    }
  }
  for (let index = 0; index < coefficientCount; index += 1) {
    gram[index][index] += 1e-5 * (index + 1) ** 4;
  }
  const coefficients = solveDenseLinearSystem(gram, rhs);
  const taper = Math.max(1, taperArcPx);
  for (let index = 0; index < output.length; index += 1) {
    const arc = curve.vertexArc[index];
    let envelope = 1;
    if (arc < minimumArc) {
      envelope = curvatureContinuousEnvelope((arc - (minimumArc - taper)) / taper);
    } else if (arc > maximumArc) {
      envelope = curvatureContinuousEnvelope(((maximumArc + taper) - arc) / taper);
    }
    const parameter = clamp((arc - centerArc) / arcScale, -3, 3);
    let value = 0;
    for (let power = 0; power < coefficients.length; power += 1) {
      value += coefficients[power] * parameter ** power;
    }
    output[index] = clamp(value * envelope,
      -maximumDisplacementPx, maximumDisplacementPx);
  }
  return output;
}

function pointAtCurveArc(curve: CurveGeometry, arc: number): Point2 {
  if (arc <= 0) return [...curve.prior[0]];
  const last = curve.prior.length - 1;
  if (arc >= curve.vertexArc[last]) return [...curve.prior[last]];
  let index = 1;
  while (index < curve.vertexArc.length && curve.vertexArc[index] < arc) index += 1;
  const startArc = curve.vertexArc[index - 1];
  const span = Math.max(EPSILON, curve.vertexArc[index] - startArc);
  const fraction = clamp((arc - startArc) / span);
  return [
    curve.prior[index - 1][0] + fraction *
      (curve.prior[index][0] - curve.prior[index - 1][0]),
    curve.prior[index - 1][1] + fraction *
      (curve.prior[index][1] - curve.prior[index - 1][1]),
  ];
}

function guidedVerticalTrajectory(
  curve: CurveGeometry,
  records: MatchRecord[],
  degree: number,
  taperArcPx: number,
  maximumDisplacementPx: number,
  targetGapPx: number,
): { points: Point2[]; normalOffsets: Float64Array } {
  const normalOffsets = new Float64Array(curve.prior.length);
  if (!records.length) {
    return { points: curve.prior.map((point) => [...point]), normalOffsets };
  }
  const minimumArc = Math.min(...records.map((record) => record.projectionArc));
  const maximumArc = Math.max(...records.map((record) => record.projectionArc));
  const centerArc = 0.5 * (minimumArc + maximumArc);
  const arcScale = Math.max(10, 0.5 * (maximumArc - minimumArc));
  const coefficientCount = Math.max(1, Math.min(3, degree + 1));
  const gram = Array.from({ length: coefficientCount }, () =>
    Array(coefficientCount).fill(0));
  const rhs = Array(coefficientCount).fill(0);
  for (const record of records) {
    const parameter = clamp((record.projectionArc - centerArc) / arcScale, -2, 2);
    const basis = Array.from({ length: coefficientCount }, (_, power) => parameter ** power);
    const projection = pointAtCurveArc(curve, record.projectionArc);
    const deltaY = record.wrinklePoint[1] - projection[1];
    const target = Math.sign(deltaY) * Math.max(0, Math.abs(deltaY) - targetGapPx);
    const weight = Math.max(EPSILON, record.score * record.confidence);
    for (let row = 0; row < coefficientCount; row += 1) {
      rhs[row] += weight * basis[row] * target;
      for (let column = 0; column < coefficientCount; column += 1) {
        gram[row][column] += weight * basis[row] * basis[column];
      }
    }
  }
  for (let index = 0; index < coefficientCount; index += 1) {
    gram[index][index] += 1e-4 * (index + 1) ** 4;
  }
  const coefficients = solveDenseLinearSystem(gram, rhs);
  const taper = Math.max(1, taperArcPx);
  const points = curve.prior.map((point, index): Point2 => {
    const arc = curve.vertexArc[index];
    let envelope = 1;
    if (arc < minimumArc) {
      envelope = curvatureContinuousEnvelope((arc - (minimumArc - taper)) / taper);
    } else if (arc > maximumArc) {
      envelope = curvatureContinuousEnvelope(((maximumArc + taper) - arc) / taper);
    }
    const parameter = clamp((arc - centerArc) / arcScale, -3, 3);
    let deltaY = 0;
    for (let power = 0; power < coefficients.length; power += 1) {
      deltaY += coefficients[power] * parameter ** power;
    }
    deltaY = clamp(deltaY * envelope,
      -maximumDisplacementPx, maximumDisplacementPx);
    normalOffsets[index] = deltaY * curve.normals[index][1];
    return [point[0], point[1] + deltaY];
  });
  return { points, normalOffsets };
}

function guidedRigidEnvelopeTrajectory(
  curve: CurveGeometry,
  records: MatchRecord[],
  taperArcPx: number,
  maximumDisplacementPx: number,
  maximumRotationDegrees: number,
  maximumScaleChange: number,
): { points: Point2[]; normalOffsets: Float64Array; rotationDegrees: number;
  fittedScale: number } {
  const normalOffsets = new Float64Array(curve.prior.length);
  if (!records.length) {
    return { points: curve.prior.map((point) => [...point]), normalOffsets,
      rotationDegrees: 0, fittedScale: 1 };
  }
  let weightSum = 0, sourceX = 0, sourceY = 0, targetX = 0, targetY = 0;
  const pairs = records.map((record) => {
    const source = pointAtCurveArc(curve, record.projectionArc);
    const weight = Math.max(EPSILON, record.score * record.confidence);
    weightSum += weight;
    sourceX += weight * source[0];
    sourceY += weight * source[1];
    targetX += weight * record.wrinklePoint[0];
    targetY += weight * record.wrinklePoint[1];
    return { source, target: record.wrinklePoint, weight };
  });
  sourceX /= Math.max(EPSILON, weightSum);
  sourceY /= Math.max(EPSILON, weightSum);
  targetX /= Math.max(EPSILON, weightSum);
  targetY /= Math.max(EPSILON, weightSum);
  let cosineTerm = 0, sineTerm = 0, sourceVariance = 0;
  for (const pair of pairs) {
    const sx = pair.source[0] - sourceX, sy = pair.source[1] - sourceY;
    const tx = pair.target[0] - targetX, ty = pair.target[1] - targetY;
    cosineTerm += pair.weight * (sx * tx + sy * ty);
    sineTerm += pair.weight * (sx * ty - sy * tx);
    sourceVariance += pair.weight * (sx * sx + sy * sy);
  }
  const maximumRotation = Math.max(0, maximumRotationDegrees) * Math.PI / 180;
  const rotation = clamp(Math.atan2(sineTerm, cosineTerm),
    -maximumRotation, maximumRotation);
  const cosine = Math.cos(rotation), sine = Math.sin(rotation);
  const fittedScale = clamp(
    Math.hypot(cosineTerm, sineTerm) / Math.max(EPSILON, sourceVariance),
    Math.max(0.25, 1 - maximumScaleChange), 1 + maximumScaleChange,
  );
  const minimumArc = Math.min(...records.map((record) => record.projectionArc));
  const maximumArc = Math.max(...records.map((record) => record.projectionArc));
  const taper = Math.max(1, taperArcPx);
  const points = curve.prior.map((point, index): Point2 => {
    const transformed: Point2 = [
      targetX + fittedScale *
        (cosine * (point[0] - sourceX) - sine * (point[1] - sourceY)),
      targetY + fittedScale *
        (sine * (point[0] - sourceX) + cosine * (point[1] - sourceY)),
    ];
    let envelope = 1;
    const arc = curve.vertexArc[index];
    if (arc < minimumArc) {
      envelope = curvatureContinuousEnvelope((arc - (minimumArc - taper)) / taper);
    } else if (arc > maximumArc) {
      envelope = curvatureContinuousEnvelope(((maximumArc + taper) - arc) / taper);
    }
    let dx = envelope * (transformed[0] - point[0]);
    let dy = envelope * (transformed[1] - point[1]);
    const displacement = Math.hypot(dx, dy);
    if (displacement > maximumDisplacementPx) {
      const scale = maximumDisplacementPx / displacement;
      dx *= scale;
      dy *= scale;
    }
    normalOffsets[index] = dx * curve.normals[index][0] + dy * curve.normals[index][1];
    return [point[0] + dx, point[1] + dy];
  });
  return { points, normalOffsets, rotationDegrees: rotation * 180 / Math.PI,
    fittedScale };
}

function suppressShortCurvatureReversals(
  curve: CurveGeometry,
  source: Float64Array,
  materialTurnDegrees: number,
  minimumReversalSpacingPx: number,
): Float64Array {
  const output = new Float64Array(source);
  for (let repair = 0; repair < 4; repair += 1) {
    const points = pointsFromOffsets(curve, output);
    const turns = signedTurnAnglesDegrees(points);
    const signChangeIndices = [];
    let priorMaterialSign = 0;
    for (let index = 1; index < turns.length - 1; index += 1) {
      if (Math.abs(turns[index]) < materialTurnDegrees) continue;
      const sign = Math.sign(turns[index]);
      if (priorMaterialSign && sign !== priorMaterialSign) signChangeIndices.push(index);
      priorMaterialSign = sign;
    }
    let shortPair: [number, number] | null = null;
    for (let index = 1; index < signChangeIndices.length; index += 1) {
      const first = signChangeIndices[index - 1], second = signChangeIndices[index];
      if (curve.vertexArc[second] - curve.vertexArc[first] < minimumReversalSpacingPx) {
        shortPair = [first, second];
        break;
      }
    }
    if (!shortPair) break;
    const start = Math.max(0, shortPair[0] - 6);
    const end = Math.min(output.length - 1, shortPair[1] + 6);
    for (let pass = 0; pass < 32; pass += 1) {
      const next = new Float64Array(output);
      for (let index = start + 1; index < end; index += 1) {
        const previousSpan = Math.max(EPSILON,
          curve.vertexArc[index] - curve.vertexArc[index - 1]);
        const nextSpan = Math.max(EPSILON,
          curve.vertexArc[index + 1] - curve.vertexArc[index]);
        const arcLinear = (
          nextSpan * output[index - 1] + previousSpan * output[index + 1]
        ) / (previousSpan + nextSpan);
        const local = (index - start) / Math.max(1, end - start);
        const window = Math.sin(Math.PI * local) ** 2;
        next[index] = output[index] + 0.65 * window * (arcLinear - output[index]);
      }
      output.set(next);
    }
  }
  return output;
}

function applyCurvatureFairing(
  results: any[], size: number, options: V6RefinementOptions,
) {
  const events: any[] = [];
  if (options.curvatureFairing !== true) {
    return { events, appliedCurveCount: 0, rollbackCurveCount: 0 };
  }
  const passes = Math.max(1, Math.min(96, Number(options.curvatureFairingPasses) || 32));
  const materialTurn = Math.max(0.1,
    Number(options.curvatureFairingMaterialTurnDegrees) || 0.5);
  const standardMaximumTurn = Math.max(1,
    Number(options.curvatureFairingMaximumTurnDegrees) || 8);
  const strictMaximumTurn = Math.max(1,
    Number(options.curvatureFairingStrictMaximumTurnDegrees) || 6);
  const baselineSlack = Math.max(0,
    Number(options.curvatureFairingBaselineSlackDegrees) || 2);
  const maximumAddedSignChanges = Math.max(0,
    Math.round(Number(options.curvatureFairingMaximumAddedSignChanges ?? 2)));
  const maximumEndpointTangentChange = Math.max(0.1,
    Number(options.curvatureFairingEndpointTangentChangeDegrees) || 45);
  const strictRegion = String(options.curvatureFairingStrictRegion ||
    "lateral_canthus_short_arc_v65");
  const defaultMaximumMeanAdherence = Math.max(0.25,
    Number(options.curvatureFairingMaximumMeanAdherencePx) || Infinity);
  const defaultMaximumP90Adherence = Math.max(0.5,
    Number(options.curvatureFairingMaximumP90AdherencePx) || Infinity);
  let appliedCurveCount = 0, rollbackCurveCount = 0;

  for (let curveIndex = 0; curveIndex < results.length; curveIndex += 1) {
    const result = results[curveIndex];
    const seedRegion = String(result.curve.seed.region || "");
    const guidedRegion = guidedRegionForResult(result);
    const regionalRecords = (result.matchGroups || []).flatMap((group: MatchGroup) =>
      group.records);
    const moved = result.offsets.some((value: number) => Math.abs(value) > 0.05);
    if ((!moved || result.rollbackReason || !result.intervals.length) && guidedRegion === null) {
      continue;
    }
    if (guidedRegion !== null && regionalRecords.length &&
        (!moved || result.rollbackReason || !result.intervals.length)) {
      const minimumArc = Math.min(...regionalRecords.map((record: MatchRecord) =>
        record.projectionArc));
      const maximumArc = Math.max(...regionalRecords.map((record: MatchRecord) =>
        record.projectionArc));
      const transition = guidedRegion === "nose_bridge" ?
        explicitPositive(options.noseBridgeTransitionLengthPx, size * 0.12, 12) :
        guidedRegion === "glabellar" ?
          explicitPositive(options.glabellarTransitionLengthPx, size * 0.06, 8) :
          explicitPositive(options.crowsFeetTransitionLengthPx, size * 0.04, 6);
      let start = 0, end = result.curve.vertexArc.length;
      while (start < end - 1 &&
             result.curve.vertexArc[start] < minimumArc - transition) start += 1;
      while (end > start + 1 &&
             result.curve.vertexArc[end - 1] > maximumArc + transition) end -= 1;
      start = Math.max(0, start - 1);
      end = Math.min(result.curve.vertexArc.length, end + 1);
      result.offsets = new Float64Array(result.curve.prior.length);
      result.points = result.curve.prior.map((point: Point2) => [...point]);
      result.intervals = end - start >= 3 ? [[start, end]] : [];
      result.rollbackReason = null;
    }
    if (!regionalRecords.length || !result.intervals.length) continue;
    const strict = seedRegion === strictRegion && guidedRegion === null;
    const forehead = guidedRegion === "forehead";
    const priorMetrics = curvatureMetrics(result.curve.prior, materialTurn);
    const beforeMetrics = curvatureMetrics(result.points, materialTurn);
    const regionMaximumTurn = guidedRegion === "glabellar" ?
      explicitPositive(options.curvatureFairingGlabellarMaximumTurnDegrees,
        standardMaximumTurn, 1) : guidedRegion === "nose_bridge" ?
        explicitPositive(options.curvatureFairingNoseBridgeMaximumTurnDegrees,
          standardMaximumTurn, 1) : guidedRegion === "crows_feet" ?
          explicitPositive(options.curvatureFairingCrowsFeetMaximumTurnDegrees,
            strictMaximumTurn, 1) : forehead ?
            explicitPositive(options.curvatureFairingForeheadMaximumTurnDegrees,
              standardMaximumTurn, 1) : strict ? strictMaximumTurn : standardMaximumTurn;
    const maximumTurn = Math.max(
      regionMaximumTurn,
      priorMetrics.maximumTurnDegrees + baselineSlack,
    );
    const maximumMeanAdherence = guidedRegion === "glabellar" ?
      explicitPositive(options.curvatureFairingGlabellarMaximumMeanAdherencePx,
        defaultMaximumMeanAdherence, 0.25) : guidedRegion === "nose_bridge" ?
        explicitPositive(options.curvatureFairingNoseBridgeMaximumMeanAdherencePx,
          defaultMaximumMeanAdherence, 0.25) : guidedRegion === "crows_feet" ?
          explicitPositive(options.curvatureFairingCrowsFeetMaximumMeanAdherencePx,
            defaultMaximumMeanAdherence, 0.25) : forehead ?
            explicitPositive(options.curvatureFairingForeheadMaximumMeanAdherencePx,
              defaultMaximumMeanAdherence, 0.25) : defaultMaximumMeanAdherence;
    const maximumP90Adherence = guidedRegion === "glabellar" ?
      explicitPositive(options.curvatureFairingGlabellarMaximumP90AdherencePx,
        defaultMaximumP90Adherence, 0.5) : guidedRegion === "nose_bridge" ?
        explicitPositive(options.curvatureFairingNoseBridgeMaximumP90AdherencePx,
          defaultMaximumP90Adherence, 0.5) : guidedRegion === "crows_feet" ?
          explicitPositive(options.curvatureFairingCrowsFeetMaximumP90AdherencePx,
            defaultMaximumP90Adherence, 0.5) : forehead ?
            explicitPositive(options.curvatureFairingForeheadMaximumP90AdherencePx,
              defaultMaximumP90Adherence, 0.5) : defaultMaximumP90Adherence;
    const regionMaximumAddedSignChanges = Math.max(0, Math.round(Number(
      guidedRegion === "glabellar" ?
        options.curvatureFairingGlabellarMaximumAddedSignChanges :
        guidedRegion === "nose_bridge" ?
          options.curvatureFairingNoseBridgeMaximumAddedSignChanges :
          guidedRegion === "crows_feet" ?
            options.curvatureFairingCrowsFeetMaximumAddedSignChanges : forehead ?
              options.curvatureFairingForeheadMaximumAddedSignChanges :
              maximumAddedSignChanges,
    ) || 0));
    const maximumSignChanges = priorMetrics.materialSignChanges +
      regionMaximumAddedSignChanges;
    const minimumReversalSpacingPx = guidedRegion === "glabellar" ?
      explicitPositive(options.curvatureFairingGlabellarMinimumReversalSpacingPx,
        Math.max(12, size * 0.012), 6) : guidedRegion === "nose_bridge" ?
        explicitPositive(options.curvatureFairingNoseBridgeMinimumReversalSpacingPx,
          Math.max(12, size * 0.012), 6) : guidedRegion === "crows_feet" ?
          explicitPositive(options.curvatureFairingCrowsFeetMinimumReversalSpacingPx,
            Math.max(8, size * 0.008), 5) : Math.max(12, size * 0.020);
    const enforceShortReversalGate = guidedRegion !== null;
    const allowOpenCurveEnds = guidedRegion !== null;
    const regionalMaximumEndpointTangentChange = guidedRegion === "crows_feet" ?
      Math.max(maximumEndpointTangentChange, 45) : guidedRegion === "glabellar" ?
        Math.max(maximumEndpointTangentChange, 30) : maximumEndpointTangentChange;
    const priorHasShortReversal = enforceShortReversalGate &&
      priorMetrics.minimumMaterialSignChangeSpacingPx !== null &&
      priorMetrics.minimumMaterialSignChangeSpacingPx < minimumReversalSpacingPx;
    const originalOffsets = new Float64Array(result.offsets);
    let selected: Float64Array | null = null;
    let selectedMetrics: CurvatureMetrics | null = null;
    let selectedDataWeight: number | null = null;
    let selectedScale: number | null = null;
    let selectedPasses: number | null = null;
    let selectedSmoothingMethod: string | null = null;
    let selectedSigmaArc: number | null = null;
    let selectedModeCount: number | null = null;
    let selectedEndpointChange = 0;
    let selectedAdherence: { mean: number; p90: number } | null = null;
    let selectedPoints: Point2[] | null = null;
    let selectedRegionalCartesianDisplacement = false;
    let selectedScore = Infinity;
    let bestAttempt: any = null;

    const targetPoints = (result.matchGroups || []).flatMap((group: MatchGroup) =>
      group.records.map((record) => record.wrinklePoint));
    const adherenceFor = (points: Point2[]) => {
      const distances = targetPoints.map((point: Point2) =>
        pointToPolylineMatch(point, points).distance);
      return {
        mean: distances.reduce((sum: number, value: number) => sum + value, 0) /
          Math.max(1, distances.length),
        p90: percentile(distances, 0.9),
      };
    };
    const beforeAdherence = adherenceFor(result.points);
    const passCounts = [...new Set([2, 4, 8, 12, 16, 24, 32, 48, passes]
      .filter((candidate) => candidate <= passes))].sort((left, right) => left - right);
    const dataWeights = [0.90, 0.78, 0.65, 0.55, 0.48, 0.40, 0.34, 0.28,
      0.22, 0.16, 0.13, 0.10, 0.07, 0.05, 0.03, 0.015, 0.008];
    const scales = [1, 0.95, 0.90, 0.85, 0.80, 0.70, 0.60, 0.50,
      0.40, 0.30, 0.20, 0.10];
    const evaluateCandidate = (
      candidateOffsets: Float64Array, metadata: any, candidatePointOverride?: Point2[],
    ) => {
      const candidatePoints = candidatePointOverride ||
        pointsFromOffsets(result.curve, candidateOffsets);
      const metrics = curvatureMetrics(candidatePoints, materialTurn);
      const endpointChange = endpointTangentChangeDegrees(result.curve.prior, candidatePoints);
      const insideCanvas = candidatePoints.every((point) =>
        point[0] >= 0 && point[1] >= 0 && point[0] < size && point[1] < size);
      const candidateAdherence = adherenceFor(candidatePoints);
      const adherencePassed = candidateAdherence.mean <= maximumMeanAdherence + 1e-6 &&
        candidateAdherence.p90 <= maximumP90Adherence + 1e-6;
      const newShortCurvatureReversal = enforceShortReversalGate && !priorHasShortReversal &&
        metrics.minimumMaterialSignChangeSpacingPx !== null &&
        metrics.minimumMaterialSignChangeSpacingPx < minimumReversalSpacingPx;
      const attempt = {
        ...metadata,
        inside_canvas: insideCanvas,
        endpoint_tangent_change_degrees: endpointChange,
        adherence: candidateAdherence,
        metrics,
        new_short_curvature_reversal: newShortCurvatureReversal,
      };
      const violation = (insideCanvas ? 0 : 1000) +
        Math.max(0, metrics.maximumTurnDegrees - maximumTurn) +
        2 * Math.max(0, metrics.materialSignChanges - maximumSignChanges) +
        (newShortCurvatureReversal ? 4 : 0) +
        Math.max(0, endpointChange - regionalMaximumEndpointTangentChange) +
        4 * Math.max(0, candidateAdherence.mean - maximumMeanAdherence) +
        Math.max(0, candidateAdherence.p90 - maximumP90Adherence);
      if (!bestAttempt || violation < bestAttempt.violation) {
        bestAttempt = { ...attempt, violation };
      }
      if (!metadata.short_curvature_repair && !metadata.regional_cartesian_displacement &&
          enforceShortReversalGate && insideCanvas &&
          adherencePassed &&
          metrics.maximumTurnDegrees <= maximumTurn + 1e-6 &&
          (metrics.materialSignChanges > maximumSignChanges || newShortCurvatureReversal) &&
          endpointChange <= regionalMaximumEndpointTangentChange + 1e-6) {
        const repairedOffsets = suppressShortCurvatureReversals(
          result.curve, candidateOffsets, materialTurn, minimumReversalSpacingPx,
        );
        evaluateCandidate(repairedOffsets, {
          ...metadata,
          method: `${metadata.method}+short_curvature_repair`,
          short_curvature_repair: true,
          minimum_reversal_spacing_px: minimumReversalSpacingPx,
        });
      }
      if (!insideCanvas || metrics.maximumTurnDegrees > maximumTurn + 1e-6 ||
          metrics.materialSignChanges > maximumSignChanges ||
          newShortCurvatureReversal ||
          endpointChange > regionalMaximumEndpointTangentChange + 1e-6 ||
          !adherencePassed) return;
      let squaredOffsetError = 0;
      for (let index = 0; index < originalOffsets.length; index += 1) {
        squaredOffsetError += (candidateOffsets[index] - originalOffsets[index]) ** 2;
      }
      const offsetRmsError = Math.sqrt(squaredOffsetError /
        Math.max(1, originalOffsets.length));
      const score = candidateAdherence.mean + 0.15 * candidateAdherence.p90 +
        0.01 * offsetRmsError;
      if (score >= selectedScore - 1e-9) return;
      selected = candidateOffsets;
      selectedMetrics = metrics;
      selectedDataWeight = metadata.data_weight ?? null;
      selectedScale = metadata.displacement_scale;
      selectedPasses = metadata.passes ?? null;
      selectedSmoothingMethod = metadata.method;
      selectedSigmaArc = metadata.sigma_arc_px ?? null;
      selectedModeCount = metadata.mode_count ?? null;
      selectedEndpointChange = endpointChange;
      selectedAdherence = candidateAdherence;
      selectedPoints = candidatePoints;
      selectedRegionalCartesianDisplacement = metadata.regional_cartesian_displacement === true;
      selectedScore = score;
    };
    if (guidedRegion !== null) {
      const directRecords = regionalRecords;
      const maximumRegionalDisplacement = guidedRegion === "nose_bridge" ?
        explicitPositive(options.noseBridgeMaximumDisplacementPx, size * 0.10, 1) :
        guidedRegion === "glabellar" ?
          explicitPositive(options.glabellarMaximumDisplacementPx, size * 0.06, 1) :
          explicitPositive(options.crowsFeetMaximumDisplacementPx, size * 0.05, 1);
      const baseTaperArc = guidedRegion === "nose_bridge" ?
        explicitPositive(options.noseBridgeTransitionLengthPx, size * 0.12, 12) :
        guidedRegion === "glabellar" ?
          explicitPositive(options.glabellarTransitionLengthPx, size * 0.06, 8) :
          explicitPositive(options.crowsFeetTransitionLengthPx, size * 0.04, 6);
      const targetGap = Math.max(0, Number(options.targetGapPx) || 0);
      for (const degree of [0, 1, 2, 3]) {
        for (const taperScale of [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5]) {
          const guidedOffsets = guidedPolynomialOffsets(
            result.curve, directRecords, degree, baseTaperArc * taperScale,
            maximumRegionalDisplacement, targetGap,
          );
          for (const scale of [1, 0.98, 0.95, 0.90, 0.85, 0.80, 0.70, 0.60]) {
            evaluateCandidate(Float64Array.from(guidedOffsets, (value) => value * scale), {
              method: "regional_guided_polynomial_envelope",
              polynomial_degree: degree,
              taper_arc_px: baseTaperArc * taperScale,
              displacement_scale: scale,
            });
          }
        }
      }
      if (guidedRegion === "glabellar" || guidedRegion === "crows_feet") {
        for (const taperScale of [1, 2, 4]) {
          for (const maximumRotationDegrees of [12, 24]) {
            for (const maximumScaleChange of [0, 0.20, 0.50, 0.70]) {
              const trajectory = guidedRigidEnvelopeTrajectory(
                result.curve, directRecords, baseTaperArc * taperScale,
                maximumRegionalDisplacement, maximumRotationDegrees, maximumScaleChange,
              );
              for (const scale of [1, 0.90, 0.70]) {
                const points = trajectory.points.map((point: Point2, index: number): Point2 => [
                  result.curve.prior[index][0] +
                    scale * (point[0] - result.curve.prior[index][0]),
                  result.curve.prior[index][1] +
                    scale * (point[1] - result.curve.prior[index][1]),
                ]);
                evaluateCandidate(
                  Float64Array.from(trajectory.normalOffsets, (value) => value * scale),
                  {
                    method: "regional_guided_similarity_envelope",
                    taper_arc_px: baseTaperArc * taperScale,
                    maximum_rotation_degrees: maximumRotationDegrees,
                    fitted_rotation_degrees: trajectory.rotationDegrees,
                    maximum_scale_change: maximumScaleChange,
                    fitted_similarity_scale: trajectory.fittedScale,
                    displacement_scale: scale,
                    regional_cartesian_displacement: true,
                  },
                  points,
                );
              }
            }
          }
        }
      }
      if (guidedRegion === "nose_bridge") for (const degree of [0, 1, 2]) {
        for (const taperScale of [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5]) {
          const trajectory = guidedVerticalTrajectory(
            result.curve, directRecords, degree, baseTaperArc * taperScale,
            maximumRegionalDisplacement, targetGap,
          );
          for (const scale of [1, 0.98, 0.95, 0.90, 0.85, 0.80, 0.70, 0.60]) {
            const points = trajectory.points.map((point: Point2, index: number): Point2 => [
              result.curve.prior[index][0] +
                scale * (point[0] - result.curve.prior[index][0]),
              result.curve.prior[index][1] +
                scale * (point[1] - result.curve.prior[index][1]),
            ]);
            evaluateCandidate(
              Float64Array.from(trajectory.normalOffsets, (value) => value * scale),
              {
                method: "regional_guided_vertical_trajectory",
                polynomial_degree: degree,
                taper_arc_px: baseTaperArc * taperScale,
                displacement_scale: scale,
                regional_cartesian_displacement: true,
              },
              points,
            );
          }
        }
      }
    }
    for (const passCount of passCounts) {
      for (const scale of scales) {
        for (const dataWeight of dataWeights) {
          const fairedOffsets = fairNormalOffsets(
            result.curve, originalOffsets, result.intervals, passCount, dataWeight,
            allowOpenCurveEnds,
          );
          evaluateCandidate(Float64Array.from(fairedOffsets, (value) => value * scale), {
            method: "iterative_arc_laplacian",
            passes: passCount,
            data_weight: dataWeight,
            displacement_scale: scale,
          });
        }
      }
    }
    const sigmaArcs = guidedRegion === "nose_bridge" ?
      [1.5, 2.5, 3.5, 5, 7, 9, 12, 16, 20, 24, 32, 48, 64, 96, 128] :
      [1.5, 2.5, 3.5, 5, 7, 9, 12, 16, 20, 24, 32];
    for (const sigmaArc of sigmaArcs) {
      const fairedOffsets = gaussianFairNormalOffsets(
        result.curve, originalOffsets, result.intervals, sigmaArc, allowOpenCurveEnds,
      );
      for (const scale of scales) {
        evaluateCandidate(Float64Array.from(fairedOffsets, (value) => value * scale), {
          method: "gaussian_arc_low_pass",
          sigma_arc_px: sigmaArc,
          displacement_scale: scale,
        });
      }
    }
    for (const modeCount of [2, 3, 4, 5, 6, 8, 10, 12, 16, 20]) {
      const fairedOffsets = sineSeriesFairNormalOffsets(
        result.curve, originalOffsets, result.intervals, modeCount,
      );
      for (const scale of scales) {
        evaluateCandidate(Float64Array.from(fairedOffsets, (value) => value * scale), {
          method: "sine_series_low_pass",
          mode_count: modeCount,
          displacement_scale: scale,
        });
      }
    }

    if (selected && selectedMetrics) {
      result.offsets = selected;
      result.points = selectedPoints || pointsFromOffsets(result.curve, selected);
      result.regionalGuidedTrajectoryApplied = guidedRegion !== null;
      appliedCurveCount += 1;
      events.push({
        curve_index: curveIndex,
        curve_name: result.curve.seed.name,
        region: result.curve.seed.region,
        guided_region: guidedRegion,
        status: "faired",
        strict_region_gate: strict,
        smoothing_method: selectedSmoothingMethod,
        passes: selectedPasses,
        sigma_arc_px: selectedSigmaArc,
        mode_count: selectedModeCount,
        data_weight: selectedDataWeight,
        displacement_scale: selectedScale,
        regional_cartesian_displacement: selectedRegionalCartesianDisplacement,
        maximum_turn_limit_degrees: maximumTurn,
        maximum_sign_changes: maximumSignChanges,
        minimum_reversal_spacing_px: minimumReversalSpacingPx,
        endpoint_tangent_change_degrees: selectedEndpointChange,
        adherence_before_fairing: beforeAdherence,
        adherence_after_fairing: selectedAdherence,
        maximum_mean_adherence_px: maximumMeanAdherence,
        maximum_p90_adherence_px: maximumP90Adherence,
        prior: priorMetrics,
        before: beforeMetrics,
        after: selectedMetrics,
      });
      continue;
    }

    result.offsets.fill(0);
    result.points = result.curve.prior.map((point: Point2) => [...point]);
    result.rollbackReason = "curvature_fairing_gate_rejected";
    rollbackCurveCount += 1;
    events.push({
      curve_index: curveIndex,
      curve_name: result.curve.seed.name,
      region: result.curve.seed.region,
      guided_region: guidedRegion,
      status: "rolled_back",
      strict_region_gate: strict,
      passes,
      maximum_turn_limit_degrees: maximumTurn,
      maximum_sign_changes: maximumSignChanges,
      minimum_reversal_spacing_px: minimumReversalSpacingPx,
      adherence_before_fairing: beforeAdherence,
      maximum_mean_adherence_px: maximumMeanAdherence,
      maximum_p90_adherence_px: maximumP90Adherence,
      prior: priorMetrics,
      before: beforeMetrics,
      best_attempt: bestAttempt,
    });
  }
  return { events, appliedCurveCount, rollbackCurveCount };
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
    const forehead = String(curves[group.curveIndex].seed.region || "").includes("forehead");
    const guidedRegion = group.summary.guided_region as GuidedWrinkleRegion | undefined;
    const groupMeanThreshold = guidedRegion === "glabellar" ?
      explicitPositive(options.glabellarAdherenceMeanThresholdPx, meanThreshold, 0.25) :
      guidedRegion === "nose_bridge" ?
        explicitPositive(options.noseBridgeAdherenceMeanThresholdPx, meanThreshold, 0.25) :
        guidedRegion === "crows_feet" ?
          explicitPositive(options.crowsFeetAdherenceMeanThresholdPx, meanThreshold, 0.25) :
          forehead ? explicitPositive(options.foreheadAdherenceMeanThresholdPx,
            meanThreshold, 0.25) : meanThreshold;
    const groupBaseP90Threshold = guidedRegion === "glabellar" ?
      explicitPositive(options.glabellarAdherenceP90ThresholdPx, baseP90Threshold, 0.5) :
      guidedRegion === "nose_bridge" ?
        explicitPositive(options.noseBridgeAdherenceP90ThresholdPx,
          baseP90Threshold, 0.5) : guidedRegion === "crows_feet" ?
          explicitPositive(options.crowsFeetAdherenceP90ThresholdPx,
            baseP90Threshold, 0.5) : forehead ?
            explicitPositive(options.foreheadAdherenceP90ThresholdPx,
              baseP90Threshold, 0.5) : baseP90Threshold;
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
    const p90Threshold = groupBaseP90Threshold + quantizationTolerance;
    const moved = outputCurves[group.curveIndex].normalOffsetsPx
      .some((value: number) => Math.abs(value) > 0.05);
    if (applyGate && options.postAdherenceGate === true) {
      const alreadyAligned = priorMean <= groupMeanThreshold && priorP90 <= p90Threshold &&
        priorDirectionP90 <= directionThreshold;
      const improved = priorMean - finalMean >= minimumImprovement;
      const passedDistance = finalMean <= groupMeanThreshold && finalP90 <= p90Threshold;
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
        status = finalMean > groupMeanThreshold ? "rejected_mean_distance" :
          "rejected_p90_distance";
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
      guided_region: guidedRegion || (forehead ? "forehead" : null),
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
      mean_distance_threshold_px: groupMeanThreshold,
      p90_distance_threshold_px: p90Threshold,
      direction_p90_threshold_degrees: directionThreshold,
      ...(options.shortWrinkleQuantizationTolerance === true ? {
        base_p90_distance_threshold_px: groupBaseP90Threshold,
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

function applyNoseBridgePlanarWarp(
  results: any[], matching: MatchingResult, curves: CurveGeometry[],
  faceWidth: number, options: V6RefinementOptions,
) {
  const noseGroups = matching.acceptedGroups.filter((group) =>
    group.summary.guided_region === "nose_bridge" &&
    group.summary.regional_ordered_cross_curve_selected === true);
  const trendIndices = [...new Set(noseGroups.map((group) => group.trendIndex))];
  const guidedCurveIndices = [...new Set(noseGroups.map((group) => group.curveIndex))];
  if (trendIndices.length < 3) {
    return { applied: false, reason: "incomplete_nose_bridge_ordered_cross_matching",
      movedCurveCount: 0, movedPointCount: 0, maximumDisplacementPx: 0, anchors: [] };
  }
  const anchors = trendIndices.map((trendIndex) => {
    const groups = noseGroups.filter((group) => group.trendIndex === trendIndex);
    const records = groups.flatMap((group) => group.records.map((record) => ({
      record, curve: curves[group.curveIndex],
    })));
    const weightSum = records.reduce((sum, item) => sum + Math.max(EPSILON,
      item.record.score * item.record.confidence), 0);
    const sourceY = records.reduce((sum, item) => sum + Math.max(EPSILON,
      item.record.score * item.record.confidence) *
      pointAtCurveArc(item.curve, item.record.projectionArc)[1], 0) / Math.max(EPSILON, weightSum);
    const targetY = records.reduce((sum, item) => sum + Math.max(EPSILON,
      item.record.score * item.record.confidence) * item.record.wrinklePoint[1], 0) /
      Math.max(EPSILON, weightSum);
    return { trendIndex, sourceY, targetY, recordCount: records.length };
  }).sort((left, right) => left.targetY - right.targetY);
  const ordered = anchors.every((anchor, index) => index === 0 ||
    anchor.sourceY > anchors[index - 1].sourceY + 1);
  if (!ordered) {
    return { applied: false, reason: "non_monotone_nose_bridge_source_layers",
      movedCurveCount: 0, movedPointCount: 0, maximumDisplacementPx: 0, anchors };
  }
  const allRecords = noseGroups.flatMap((group) => group.records);
  const evidenceMinX = Math.min(...allRecords.map((record) => record.wrinklePoint[0]));
  const evidenceMaxX = Math.max(...allRecords.map((record) => record.wrinklePoint[0]));
  const transition = explicitPositive(options.noseBridgePlanarWarpTransitionPx,
    Math.max(24, faceWidth * 0.12), 12);
  const verticalMargin = Math.max(48, faceWidth * 0.08);
  const mapping = [
    { sourceY: Math.min(anchors[0].sourceY, anchors[0].targetY) - verticalMargin,
      targetY: Math.min(anchors[0].sourceY, anchors[0].targetY) - verticalMargin },
    ...anchors,
    { sourceY: Math.max(anchors.at(-1)!.sourceY, anchors.at(-1)!.targetY) + verticalMargin,
      targetY: Math.max(anchors.at(-1)!.sourceY, anchors.at(-1)!.targetY) + verticalMargin },
  ];
  const spans = mapping.slice(1).map((point, index) =>
    point.sourceY - mapping[index].sourceY);
  const secants = mapping.slice(1).map((point, index) =>
    (point.targetY - mapping[index].targetY) / Math.max(EPSILON, spans[index]));
  const slopes = Array(mapping.length).fill(0);
  slopes[0] = Math.min(1, 3 * secants[0]);
  slopes[slopes.length - 1] = Math.min(1, 3 * secants.at(-1)!);
  for (let index = 1; index < mapping.length - 1; index += 1) {
    const previous = secants[index - 1], next = secants[index];
    if (!(previous > 0) || !(next > 0)) {
      slopes[index] = 0;
      continue;
    }
    const previousWeight = 2 * spans[index] + spans[index - 1];
    const nextWeight = spans[index] + 2 * spans[index - 1];
    slopes[index] = (previousWeight + nextWeight) /
      (previousWeight / previous + nextWeight / next);
  }
  const mapY = (value: number): number => {
    if (value <= mapping[0].sourceY || value >= mapping.at(-1)!.sourceY) return value;
    let index = 1;
    while (index < mapping.length && mapping[index].sourceY < value) index += 1;
    const lower = mapping[index - 1], upper = mapping[index];
    const span = Math.max(EPSILON, upper.sourceY - lower.sourceY);
    const fraction = clamp((value - lower.sourceY) / span);
    const fractionSquared = fraction * fraction;
    const fractionCubed = fractionSquared * fraction;
    return (2 * fractionCubed - 3 * fractionSquared + 1) * lower.targetY +
      (fractionCubed - 2 * fractionSquared + fraction) * span * slopes[index - 1] +
      (-2 * fractionCubed + 3 * fractionSquared) * upper.targetY +
      (fractionCubed - fractionSquared) * span * slopes[index];
  };
  const materialTurn = Math.max(0.1,
    Number(options.curvatureFairingMaterialTurnDegrees) || 0.5);
  for (const curveIndex of guidedCurveIndices) {
    results[curveIndex].points = curves[curveIndex].prior.map((point: Point2) => [...point]);
    results[curveIndex].offsets = new Float64Array(curves[curveIndex].prior.length);
    results[curveIndex].rollbackReason = null;
    results[curveIndex].regionalGuidedTrajectoryApplied = false;
  }
  const snapshots: Array<{ points: Point2[]; offsets: Float64Array;
    metrics: CurvatureMetrics }> = results.map((result) => ({
    points: result.points.map((point: Point2) => [...point] as Point2),
    offsets: new Float64Array(result.offsets),
    metrics: curvatureMetrics(result.points, materialTurn),
  }));
  const rawDisplacements = snapshots.map((snapshot) =>
    Float64Array.from(snapshot.points.map((point: Point2) => {
      let horizontalWeight = 1;
      if (point[0] < evidenceMinX) {
        horizontalWeight = curvatureContinuousEnvelope(
          (point[0] - (evidenceMinX - transition)) / transition,
        );
      } else if (point[0] > evidenceMaxX) {
        horizontalWeight = curvatureContinuousEnvelope(
          ((evidenceMaxX + transition) - point[0]) / transition,
        );
      }
      return horizontalWeight * (mapY(point[1]) - point[1]);
    })));
  const smoothDisplacements = (curveIndex: number, sigmaArc: number): Float64Array => {
    const source = rawDisplacements[curveIndex];
    if (!(sigmaArc > 0)) return new Float64Array(source);
    const output = new Float64Array(source.length);
    const arc = results[curveIndex].curve.vertexArc;
    const radius = 3 * sigmaArc;
    for (let index = 0; index < source.length; index += 1) {
      let numerator = 0, denominator = 0;
      for (let neighbor = 0; neighbor < source.length; neighbor += 1) {
        const distance = Math.abs(arc[neighbor] - arc[index]);
        if (distance > radius) continue;
        const weight = Math.exp(-0.5 * (distance / sigmaArc) ** 2);
        numerator += weight * source[neighbor];
        denominator += weight;
      }
      output[index] = denominator > EPSILON ? numerator / denominator : source[index];
    }
    return output;
  };
  const priorPairs = intersectionPairs(curves.map((curve) => curve.prior));
  const priorSelf = curves.map((curve) => selfCrosses(curve.prior));
  const meanThreshold = explicitPositive(options.noseBridgeAdherenceMeanThresholdPx,
    Math.max(2, faceWidth * 0.0035), 0.25);
  const p90Threshold = explicitPositive(options.noseBridgeAdherenceP90ThresholdPx,
    Math.max(4, faceWidth * 0.0065), 0.5);
  let selected: any = null, bestAttempt: any = null;
  for (const sigmaArc of [12, 16, 24]) {
    for (const backgroundSigmaArc of [48, 64, 96, 128]) {
      const smoothed = results.map((_, curveIndex) => smoothDisplacements(
        curveIndex, guidedCurveIndices.includes(curveIndex) ? sigmaArc : backgroundSigmaArc,
      ));
      for (const scale of [1, 0.98, 0.95]) {
      let movedCurveCount = 0, movedPointCount = 0, maximumDisplacementPx = 0;
      const candidatePoints = snapshots.map((snapshot, curveIndex) => {
        let curveMoved = false;
        const points = snapshot.points.map((point: Point2, pointIndex: number): Point2 => {
          const displacementY = scale * smoothed[curveIndex][pointIndex];
          if (Math.abs(displacementY) > 0.05) {
            curveMoved = true;
            movedPointCount += 1;
            maximumDisplacementPx = Math.max(maximumDisplacementPx, Math.abs(displacementY));
          }
          return [point[0], point[1] + displacementY];
        });
        if (curveMoved) movedCurveCount += 1;
        return points;
      });
      const curvatureViolations: any[] = [];
      let maximumTurnIncreaseDegrees = 0, maximumAddedSignChanges = 0;
      for (let index = 0; index < candidatePoints.length; index += 1) {
        const after = curvatureMetrics(candidatePoints[index], materialTurn);
        const before = snapshots[index].metrics;
        const turnIncrease = after.maximumTurnDegrees - before.maximumTurnDegrees;
        const addedSignChanges = after.materialSignChanges - before.materialSignChanges;
        maximumTurnIncreaseDegrees = Math.max(maximumTurnIncreaseDegrees, turnIncrease);
        maximumAddedSignChanges = Math.max(maximumAddedSignChanges, addedSignChanges);
        if (turnIncrease > 2 + 1e-6 || addedSignChanges > 4) {
          curvatureViolations.push({ curveIndex: index, before, after });
        }
      }
      const candidatePairs = intersectionPairs(candidatePoints);
      const newPairs = [...candidatePairs].filter((pair) => !priorPairs.has(pair));
      const newSelf = candidatePoints.reduce((count, points, index) => count +
        (!priorSelf[index] && selfCrosses(points) ? 1 : 0), 0);
      const groupAdherence = noseGroups.map((group) => {
        const distances = group.records.map((record) =>
          pointToPolylineMatch(record.wrinklePoint, candidatePoints[group.curveIndex]).distance);
        return { trendIndex: group.trendIndex, curveIndex: group.curveIndex,
          mean: distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length),
          p90: percentile(distances, 0.9) };
      });
      const adherenceViolation = groupAdherence.reduce((sum, item) => sum +
        Math.max(0, item.mean - meanThreshold) * 4 +
        Math.max(0, item.p90 - p90Threshold), 0);
      const violation = curvatureViolations.length * 100 + newPairs.length * 1000 +
        newSelf * 1000 + adherenceViolation;
      const attempt = { sigmaArcPx: sigmaArc, backgroundSigmaArcPx: backgroundSigmaArc,
        scale, movedCurveCount, movedPointCount,
        maximumDisplacementPx, maximumTurnIncreaseDegrees, maximumAddedSignChanges,
        curvatureViolations, newIntersectionPairs: newPairs, newSelfCrossCurveCount: newSelf,
        groupAdherence, violation };
      if (!bestAttempt || violation < bestAttempt.violation) bestAttempt = attempt;
      if (curvatureViolations.length || newPairs.length || newSelf || adherenceViolation > 1e-6) {
        continue;
      }
      const score = groupAdherence.reduce((sum, item) => sum + item.mean + 0.15 * item.p90, 0);
      if (!selected || score < selected.score) selected = { ...attempt, score,
        points: candidatePoints, displacements: smoothed.map((values) =>
          Float64Array.from(values, (value) => scale * value)) };
      }
    }
  }
  if (!selected) {
    for (let index = 0; index < results.length; index += 1) {
      results[index].points = snapshots[index].points;
      results[index].offsets = snapshots[index].offsets;
      results[index].noseBridgePlanarWarpApplied = false;
    }
    return { applied: false, reason: "planar_warp_smooth_topology_search_rejected",
      movedCurveCount: 0, movedPointCount: 0, maximumDisplacementPx: 0, anchors,
      evidenceMinX, evidenceMaxX, transitionPx: transition, bestAttempt };
  }
  for (let curveIndex = 0; curveIndex < results.length; curveIndex += 1) {
    results[curveIndex].points = selected.points[curveIndex];
    for (let pointIndex = 0; pointIndex < results[curveIndex].offsets.length; pointIndex += 1) {
      const displacementY = selected.displacements[curveIndex][pointIndex];
      results[curveIndex].offsets[pointIndex] = snapshots[curveIndex].offsets[pointIndex] +
        displacementY * results[curveIndex].curve.normals[pointIndex][1];
    }
    results[curveIndex].noseBridgePlanarWarpApplied =
      selected.displacements[curveIndex].some((value: number) => Math.abs(value) > 0.05);
  }
  return { applied: true, reason: null, movedCurveCount: selected.movedCurveCount,
    movedPointCount: selected.movedPointCount,
    maximumDisplacementPx: selected.maximumDisplacementPx, anchors,
    evidenceMinX, evidenceMaxX, transitionPx: transition,
    selectedSigmaArcPx: selected.sigmaArcPx,
    selectedBackgroundSigmaArcPx: selected.backgroundSigmaArcPx,
    selectedScale: selected.scale,
    maximumTurnIncreaseDegrees: selected.maximumTurnIncreaseDegrees,
    maximumAddedSignChanges: selected.maximumAddedSignChanges,
    groupAdherence: selected.groupAdherence, curvatureViolations: [] };
}

function applyNoseBridgeSpatialWarp(
  results: any[], matching: MatchingResult, curves: CurveGeometry[],
  faceWidth: number, size: number, options: V6RefinementOptions,
) {
  const noseGroups = matching.acceptedGroups.filter((group) =>
    group.summary.guided_region === "nose_bridge" &&
    group.summary.regional_bilateral_pair_complete === true);
  const trendIndices = [...new Set(noseGroups.map((group) => group.trendIndex))];
  if (trendIndices.length < 3) {
    return { applied: false, reason: "incomplete_nose_bridge_bilateral_matching",
      movedCurveCount: 0, movedPointCount: 0, maximumDisplacementPx: 0,
      selectedSigmaPx: null, selectedScale: null, groupAdherence: [] };
  }
  const targetGap = Math.max(0, Number(options.targetGapPx) || 0);
  const controls: Array<{ source: Point2; displacement: Point2; weight: number }> = [];
  for (const group of noseGroups) {
    const sorted = [...group.records].sort((left, right) => left.pointOrder - right.pointOrder);
    const sampleCount = Math.min(15, sorted.length);
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const record = sorted[Math.round(sample * (sorted.length - 1) /
        Math.max(1, sampleCount - 1))];
      const source = pointAtCurveArc(curves[group.curveIndex], record.projectionArc);
      const dx = record.wrinklePoint[0] - source[0];
      const dy = record.wrinklePoint[1] - source[1];
      const distance = Math.hypot(dx, dy);
      const scale = distance > EPSILON ? Math.max(0, distance - targetGap) / distance : 0;
      controls.push({
        source,
        displacement: [dx * scale, dy * scale],
        weight: Math.max(0.05, record.score * record.confidence),
      });
    }
  }
  const materialTurn = Math.max(0.1,
    Number(options.curvatureFairingMaterialTurnDegrees) || 0.5);
  const snapshots = results.map((result) => ({
    points: result.points.map((point: Point2) => [...point] as Point2),
    offsets: new Float64Array(result.offsets),
    metrics: curvatureMetrics(result.points, materialTurn),
  }));
  const snapshotPairs = intersectionPairs(snapshots.map((snapshot) => snapshot.points));
  const snapshotSelf = snapshots.map((snapshot) => selfCrosses(snapshot.points));
  const maximumMeanAdherence = explicitPositive(
    options.noseBridgeAdherenceMeanThresholdPx, Math.max(2, faceWidth * 0.0035), 0.25,
  );
  const maximumP90Adherence = explicitPositive(
    options.noseBridgeAdherenceP90ThresholdPx, Math.max(4, faceWidth * 0.0065), 0.5,
  ) + (options.shortWrinkleQuantizationTolerance === true ?
    (options.shortWrinkleP90TolerancePx ?? Math.max(0.5, faceWidth * 0.001)) : 0);
  let selected: any = null;
  let bestRejected: any = null;
  const sigmaValues = [0.025, 0.035, 0.05, 0.07, 0.10, 0.14, 0.18]
    .map((ratio) => Math.max(12, faceWidth * ratio));
  for (const sigma of sigmaValues) {
    const radius = sigma * 4;
    for (const scale of [1, 0.95, 0.90, 0.85, 0.80, 0.70]) {
      const candidatePoints: Point2[][] = snapshots.map((snapshot) =>
        snapshot.points.map((point: Point2): Point2 => {
        let numeratorX = 0, numeratorY = 0, denominator = 0, support = 0;
        for (const control of controls) {
          const distance = Math.hypot(point[0] - control.source[0],
            point[1] - control.source[1]);
          if (distance > radius) continue;
          const kernel = Math.exp(-0.5 * (distance / sigma) ** 2);
          const weight = kernel * control.weight;
          numeratorX += weight * control.displacement[0];
          numeratorY += weight * control.displacement[1];
          denominator += weight;
          support += kernel;
        }
        if (!(denominator > EPSILON)) return [point[0], point[1]];
        const envelope = 1 - Math.exp(-3 * support);
        return [
          point[0] + scale * envelope * numeratorX / denominator,
          point[1] + scale * envelope * numeratorY / denominator,
        ];
        }));
      const groupAdherence = noseGroups.map((group) => {
        const distances = group.records.map((record) =>
          pointToPolylineMatch(record.wrinklePoint,
            candidatePoints[group.curveIndex]).distance);
        return {
          trendIndex: group.trendIndex,
          curveIndex: group.curveIndex,
          mean: distances.reduce((sum, value) => sum + value, 0) /
            Math.max(1, distances.length),
          p90: percentile(distances, 0.9),
        };
      });
      const distancePassed = groupAdherence.every((record) =>
        record.mean <= maximumMeanAdherence + 1e-6 &&
        record.p90 <= maximumP90Adherence + 1e-6);
      let maximumTurnIncreaseDegrees = 0, maximumAddedSignChanges = 0;
      const curvatureViolations = [];
      for (let index = 0; index < candidatePoints.length; index += 1) {
        const after = curvatureMetrics(candidatePoints[index], materialTurn);
        const before = snapshots[index].metrics;
        const turnIncrease = after.maximumTurnDegrees - before.maximumTurnDegrees;
        const addedSignChanges = after.materialSignChanges - before.materialSignChanges;
        maximumTurnIncreaseDegrees = Math.max(maximumTurnIncreaseDegrees, turnIncrease);
        maximumAddedSignChanges = Math.max(maximumAddedSignChanges, addedSignChanges);
        if (turnIncrease > 2 + 1e-6 || addedSignChanges > 4) {
          curvatureViolations.push({ curveIndex: index, before, after });
        }
      }
      const score = groupAdherence.reduce((sum, record) =>
        sum + record.mean + 0.15 * record.p90, 0) / Math.max(1, groupAdherence.length);
      const attempt = { sigmaPx: sigma, scale, score, groupAdherence, distancePassed,
        maximumTurnIncreaseDegrees, maximumAddedSignChanges,
        curvatureViolationCount: curvatureViolations.length };
      if (!bestRejected || score < bestRejected.score) bestRejected = attempt;
      if (!distancePassed || curvatureViolations.length) continue;
      if (candidatePoints.some((points: Point2[]) => points.some((point: Point2) =>
        point[0] < 0 || point[1] < 0 || point[0] >= size || point[1] >= size))) {
        continue;
      }
      const candidatePairs = intersectionPairs(candidatePoints);
      const newPairs = [...candidatePairs].filter((pair) => !snapshotPairs.has(pair));
      const newSelf = candidatePoints.filter((points, index) =>
        !snapshotSelf[index] && selfCrosses(points)).length;
      if (newPairs.length || newSelf) continue;
      if (!selected || score < selected.score) {
        selected = { ...attempt, candidatePoints, newPairs, newSelf };
      }
    }
  }
  if (!selected) {
    return { applied: false, reason: "spatial_warp_candidate_gate_rejected",
      movedCurveCount: 0, movedPointCount: 0, maximumDisplacementPx: 0,
      selectedSigmaPx: null, selectedScale: null, groupAdherence: [], bestRejected };
  }
  let movedCurveCount = 0, movedPointCount = 0, maximumDisplacementPx = 0;
  for (let curveIndex = 0; curveIndex < results.length; curveIndex += 1) {
    let curveMoved = false;
    for (let index = 0; index < results[curveIndex].points.length; index += 1) {
      const before = results[curveIndex].points[index];
      const after = selected.candidatePoints[curveIndex][index];
      const dx = after[0] - before[0], dy = after[1] - before[1];
      const displacement = Math.hypot(dx, dy);
      if (displacement <= 0.01) continue;
      results[curveIndex].points[index] = [...after];
      results[curveIndex].offsets[index] +=
        dx * results[curveIndex].curve.normals[index][0] +
        dy * results[curveIndex].curve.normals[index][1];
      movedPointCount += 1;
      maximumDisplacementPx = Math.max(maximumDisplacementPx, displacement);
      curveMoved = true;
    }
    if (curveMoved) {
      results[curveIndex].noseBridgePlanarWarpApplied = true;
      movedCurveCount += 1;
    }
  }
  return { applied: true, reason: null, movedCurveCount, movedPointCount,
    maximumDisplacementPx, selectedSigmaPx: selected.sigmaPx,
    selectedScale: selected.scale, groupAdherence: selected.groupAdherence,
    maximumTurnIncreaseDegrees: selected.maximumTurnIncreaseDegrees,
    maximumAddedSignChanges: selected.maximumAddedSignChanges,
    newIntersectionPairCount: 0, newSelfCrossCurveCount: 0 };
}

function applyNoseBridgeLayerWarp(
  results: any[], matching: MatchingResult, curves: CurveGeometry[],
  faceWidth: number, size: number, options: V6RefinementOptions,
) {
  const noseGroups = matching.acceptedGroups.filter((group) =>
    group.summary.guided_region === "nose_bridge" &&
    group.summary.regional_bilateral_pair_complete === true);
  const trendIndices = [...new Set(noseGroups.map((group) => group.trendIndex))];
  if (trendIndices.length < 3) {
    return { applied: false, reason: "incomplete_nose_bridge_bilateral_matching",
      movedCurveCount: 0, movedPointCount: 0, maximumDisplacementPx: 0,
      selectedDegree: null, selectedScale: null, groupAdherence: [] };
  }
  const sides = ["left", "right"] as const;
  const sideRanges = new Map<string, { minimumX: number; maximumX: number; centerX: number;
    scaleX: number }>();
  for (const side of sides) {
    const records = noseGroups.filter((group) => group.summary.guided_image_side === side)
      .flatMap((group) => group.records);
    if (!records.length) continue;
    const minimumX = Math.min(...records.map((record) => record.wrinklePoint[0]));
    const maximumX = Math.max(...records.map((record) => record.wrinklePoint[0]));
    sideRanges.set(side, { minimumX, maximumX, centerX: 0.5 * (minimumX + maximumX),
      scaleX: Math.max(8, 0.5 * (maximumX - minimumX)) });
  }
  if (sideRanges.size !== 2) {
    return { applied: false, reason: "incomplete_nose_bridge_side_ranges",
      movedCurveCount: 0, movedPointCount: 0, maximumDisplacementPx: 0,
      selectedDegree: null, selectedScale: null, groupAdherence: [] };
  }
  const fit = (
    group: MatchGroup, degree: number, source: boolean,
    range: { centerX: number; scaleX: number },
  ): number[] => {
    const count = degree + 1;
    const gram = Array.from({ length: count }, () => Array(count).fill(0));
    const rhs = Array(count).fill(0);
    for (const record of group.records) {
      const point = source ? pointAtCurveArc(curves[group.curveIndex], record.projectionArc) :
        record.wrinklePoint;
      const parameter = clamp((point[0] - range.centerX) / range.scaleX, -2, 2);
      const basis = Array.from({ length: count }, (_, power) => parameter ** power);
      const weight = Math.max(0.05, record.score * record.confidence);
      for (let row = 0; row < count; row += 1) {
        rhs[row] += weight * basis[row] * point[1];
        for (let column = 0; column < count; column += 1) {
          gram[row][column] += weight * basis[row] * basis[column];
        }
      }
    }
    for (let index = 0; index < count; index += 1) {
      gram[index][index] += 1e-5 * (index + 1) ** 4;
    }
    return solveDenseLinearSystem(gram, rhs);
  };
  const evaluate = (coefficients: number[], x: number,
    range: { centerX: number; scaleX: number }): number => {
    const parameter = clamp((x - range.centerX) / range.scaleX, -2, 2);
    return coefficients.reduce((sum, coefficient, power) =>
      sum + coefficient * parameter ** power, 0);
  };
  const materialTurn = Math.max(0.1,
    Number(options.curvatureFairingMaterialTurnDegrees) || 0.5);
  const snapshots = results.map((result) => ({
    points: result.points.map((point: Point2) => [...point] as Point2),
    offsets: new Float64Array(result.offsets),
    metrics: curvatureMetrics(result.points, materialTurn),
  }));
  const snapshotPairs = intersectionPairs(snapshots.map((snapshot) => snapshot.points));
  const snapshotSelf = snapshots.map((snapshot) => selfCrosses(snapshot.points));
  const transition = explicitPositive(options.noseBridgePlanarWarpTransitionPx,
    Math.max(24, faceWidth * 0.30), 12);
  const maximumMeanAdherence = explicitPositive(
    options.noseBridgeAdherenceMeanThresholdPx, Math.max(2, faceWidth * 0.0035), 0.25,
  );
  const maximumP90Adherence = explicitPositive(
    options.noseBridgeAdherenceP90ThresholdPx, Math.max(4, faceWidth * 0.0065), 0.5,
  ) + (options.shortWrinkleQuantizationTolerance === true ?
    (options.shortWrinkleP90TolerancePx ?? Math.max(0.5, faceWidth * 0.001)) : 0);
  let selected: any = null, bestRejected: any = null;
  for (const degree of [1, 2, 3]) {
    const models = new Map<string, Array<{ group: MatchGroup; source: number[];
      target: number[] }>>();
    for (const side of sides) {
      const range = sideRanges.get(side)!;
      const rows = noseGroups.filter((group) => group.summary.guided_image_side === side)
        .map((group) => ({ group, source: fit(group, degree, true, range),
          target: fit(group, degree, false, range) }))
        .sort((left, right) => left.group.trendIndex - right.group.trendIndex);
      models.set(side, rows);
    }
    const layerOrderValid = sides.every((side) => {
      const range = sideRanges.get(side)!;
      const rows = models.get(side)!;
      return Array.from({ length: 11 }, (_, index) =>
        range.minimumX + index * (range.maximumX - range.minimumX) / 10).every((x) => {
        const sourceLayers = rows.map((row) => evaluate(row.source, x, range));
        const targetLayers = rows.map((row) => evaluate(row.target, x, range));
        return sourceLayers.every((value, index) => index === 0 ||
          value > sourceLayers[index - 1] + 0.5) &&
          targetLayers.every((value, index) => index === 0 ||
            value > targetLayers[index - 1] + 0.5);
      });
    });
    if (!layerOrderValid) continue;
    for (const scale of [1, 0.95, 0.90, 0.85, 0.80]) {
      const candidatePoints: Point2[][] = snapshots.map((snapshot) =>
        snapshot.points.map((point: Point2): Point2 => {
          const side = point[0] < size * 0.5 ? "left" : "right";
          const range = sideRanges.get(side)!;
          let horizontalWeight = 1;
          if (point[0] < range.minimumX) {
            horizontalWeight = curvatureContinuousEnvelope(
              (point[0] - (range.minimumX - transition)) / transition);
          } else if (point[0] > range.maximumX) {
            horizontalWeight = curvatureContinuousEnvelope(
              ((range.maximumX + transition) - point[0]) / transition);
          }
          if (!(horizontalWeight > 0)) return [point[0], point[1]];
          const rows = models.get(side)!;
          const sourceLayers = rows.map((row) => evaluate(row.source, point[0], range));
          const targetLayers = rows.map((row) => evaluate(row.target, point[0], range));
          const margin = Math.max(24, faceWidth * 0.10);
          const source = [sourceLayers[0] - margin, ...sourceLayers,
            sourceLayers.at(-1)! + margin];
          const target = [source[0], ...targetLayers, source.at(-1)!];
          let mappedY = point[1];
          if (point[1] > source[0] && point[1] < source.at(-1)!) {
            let layer = 1;
            while (layer < source.length && source[layer] < point[1]) layer += 1;
            const fraction = clamp((point[1] - source[layer - 1]) /
              Math.max(EPSILON, source[layer] - source[layer - 1]));
            mappedY = target[layer - 1] + fraction * (target[layer] - target[layer - 1]);
          }
          return [point[0], point[1] + scale * horizontalWeight * (mappedY - point[1])];
        }));
      const groupAdherence = noseGroups.map((group) => {
        const distances = group.records.map((record) =>
          pointToPolylineMatch(record.wrinklePoint,
            candidatePoints[group.curveIndex]).distance);
        return { trendIndex: group.trendIndex, curveIndex: group.curveIndex,
          mean: distances.reduce((sum, value) => sum + value, 0) /
            Math.max(1, distances.length), p90: percentile(distances, 0.9) };
      });
      const distancePassed = groupAdherence.every((record) =>
        record.mean <= maximumMeanAdherence + 1e-6 &&
        record.p90 <= maximumP90Adherence + 1e-6);
      let maximumTurnIncreaseDegrees = 0, maximumAddedSignChanges = 0;
      const curvatureViolations = [];
      for (let index = 0; index < candidatePoints.length; index += 1) {
        const after = curvatureMetrics(candidatePoints[index], materialTurn);
        const before = snapshots[index].metrics;
        const turnIncrease = after.maximumTurnDegrees - before.maximumTurnDegrees;
        const addedSignChanges = after.materialSignChanges - before.materialSignChanges;
        maximumTurnIncreaseDegrees = Math.max(maximumTurnIncreaseDegrees, turnIncrease);
        maximumAddedSignChanges = Math.max(maximumAddedSignChanges, addedSignChanges);
        if (turnIncrease > 2 + 1e-6 || addedSignChanges > 4) {
          curvatureViolations.push({ curveIndex: index, before, after });
        }
      }
      const score = groupAdherence.reduce((sum, record) =>
        sum + record.mean + 0.15 * record.p90, 0) / Math.max(1, groupAdherence.length);
      const attempt = { degree, scale, score, groupAdherence, distancePassed,
        maximumTurnIncreaseDegrees, maximumAddedSignChanges,
        curvatureViolationCount: curvatureViolations.length };
      if (!bestRejected || score < bestRejected.score) bestRejected = attempt;
      if (!distancePassed || curvatureViolations.length || candidatePoints.some((points) =>
        points.some((point) => point[0] < 0 || point[1] < 0 ||
          point[0] >= size || point[1] >= size))) continue;
      const candidatePairs = intersectionPairs(candidatePoints);
      const newPairs = [...candidatePairs].filter((pair) => !snapshotPairs.has(pair));
      const newSelf = candidatePoints.filter((points, index) =>
        !snapshotSelf[index] && selfCrosses(points)).length;
      if (newPairs.length || newSelf) continue;
      if (!selected || score < selected.score) selected = { ...attempt, candidatePoints };
    }
  }
  if (!selected) {
    return { applied: false, reason: "layer_warp_candidate_gate_rejected",
      movedCurveCount: 0, movedPointCount: 0, maximumDisplacementPx: 0,
      selectedDegree: null, selectedScale: null, groupAdherence: [], bestRejected };
  }
  let movedCurveCount = 0, movedPointCount = 0, maximumDisplacementPx = 0;
  for (let curveIndex = 0; curveIndex < results.length; curveIndex += 1) {
    let curveMoved = false;
    for (let index = 0; index < results[curveIndex].points.length; index += 1) {
      const before = results[curveIndex].points[index];
      const after = selected.candidatePoints[curveIndex][index];
      const dx = after[0] - before[0], dy = after[1] - before[1];
      const displacement = Math.hypot(dx, dy);
      if (displacement <= 0.01) continue;
      results[curveIndex].points[index] = [...after];
      results[curveIndex].offsets[index] +=
        dx * results[curveIndex].curve.normals[index][0] +
        dy * results[curveIndex].curve.normals[index][1];
      movedPointCount += 1;
      maximumDisplacementPx = Math.max(maximumDisplacementPx, displacement);
      curveMoved = true;
    }
    if (curveMoved) {
      results[curveIndex].noseBridgePlanarWarpApplied = true;
      movedCurveCount += 1;
    }
  }
  return { applied: true, reason: null, movedCurveCount, movedPointCount,
    maximumDisplacementPx, selectedDegree: selected.degree,
    selectedScale: selected.scale, groupAdherence: selected.groupAdherence,
    maximumTurnIncreaseDegrees: selected.maximumTurnIncreaseDegrees,
    maximumAddedSignChanges: selected.maximumAddedSignChanges,
    newIntersectionPairCount: 0, newSelfCrossCurveCount: 0 };
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
  const noseBridgeMaximumDisplacement = explicitPositive(
    options.noseBridgeMaximumDisplacementPx, maximumDisplacement, maximumDisplacement,
  );
  const noseBridgeP90Limit = explicitPositive(
    options.noseBridgeP90LimitPx, p90Limit, p90Limit,
  );
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
    const guidedRegion = curveGroups.find((group) => group.summary.guided_region)
      ?.summary.guided_region as GuidedWrinkleRegion | undefined;
    const curveMaximumDisplacement = guidedRegion === "nose_bridge" ?
      noseBridgeMaximumDisplacement : maximumDisplacement;
    const curveP90Limit = guidedRegion === "nose_bridge" ? noseBridgeP90Limit : p90Limit;
    const curveTransitionLength = guidedRegion === "nose_bridge" ? explicitPositive(
      options.noseBridgeTransitionLengthPx, transitionLength, transitionLength,
    ) : transitionLength;
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
      raw[index] = clamp(raw[index], -curveMaximumDisplacement, curveMaximumDisplacement);
    }
    const intervals = intervalIndices(support, curve.vertexArc, curveTransitionLength);
    const offsets = new Float64Array(raw.length);
    for (const [start, end] of intervals) {
      const solved = solveInterval(
        raw, support, start, end, options.smoothingPasses ?? 48, dataAttractionStrength,
        guidedRegion === "nose_bridge",
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
      const scale = statistic > curveP90Limit ? curveP90Limit / statistic : 1;
      if (scale < 1) {
        for (let index = start; index < end; index += 1) offsets[index] *= scale;
        guardEvents.push({ curve_index: curveIndex, interval: [start, end],
          active_point_count: active.length,
          statistic: active.length < 8 ? "rms_for_small_interval" : "p90",
          before_limit_px: statistic, limit_px: curveP90Limit, scale,
          guided_region: guidedRegion || null });
      }
    }
    if (guidedRegion === "nose_bridge") offsets.fill(0);
    const geometry = geometryGuard(curve, offsets, intervals, size, options);
    geometryScaled += geometry.scaled;
    geometryRolledBack += geometry.rolledBack;
    return {
      curve, offsets, intervals,
      points: pointsFromOffsets(curve, offsets),
      supportScore: curveGroups.reduce((sum, group) => sum + group.influence, 0),
      matchGroups: curveGroups,
      geometryGuardEvents: geometry.events,
      rollbackReason: null,
    };
  });
  return { results, guardEvents,
    p90Limit: Math.max(p90Limit, noseBridgeP90Limit),
    maximumDisplacement: Math.max(maximumDisplacement, noseBridgeMaximumDisplacement),
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

interface SampledCurveLayer {
  prior: Point2;
  final: Point2;
  displacement: Point2;
}

function sampleCurveLayerAtX(
  prior: Point2[], final: Point2[], x: number,
): SampledCurveLayer | null {
  if (!prior.length || prior.length !== final.length) return null;
  if (prior.length === 1) {
    return {
      prior: [...prior[0]],
      final: [...final[0]],
      displacement: [final[0][0] - prior[0][0], final[0][1] - prior[0][1]],
    };
  }
  let selected: { index: number; fraction: number; xDistance: number } | null = null;
  for (let index = 0; index < prior.length - 1; index += 1) {
    const start = prior[index], end = prior[index + 1];
    const dx = end[0] - start[0];
    const fraction = Math.abs(dx) > EPSILON ? clamp((x - start[0]) / dx) : 0.5;
    const projectedX = start[0] + fraction * dx;
    const xDistance = Math.abs(projectedX - x);
    if (!selected || xDistance < selected.xDistance - EPSILON) {
      selected = { index, fraction, xDistance };
    }
  }
  if (!selected) return null;
  const { index, fraction } = selected;
  const priorPoint: Point2 = [
    prior[index][0] + fraction * (prior[index + 1][0] - prior[index][0]),
    prior[index][1] + fraction * (prior[index + 1][1] - prior[index][1]),
  ];
  const finalPoint: Point2 = [
    final[index][0] + fraction * (final[index + 1][0] - final[index][0]),
    final[index][1] + fraction * (final[index + 1][1] - final[index][1]),
  ];
  return {
    prior: priorPoint,
    final: finalPoint,
    displacement: [finalPoint[0] - priorPoint[0], finalPoint[1] - priorPoint[1]],
  };
}

function activeOffsetIntervals(offsets: Float64Array): Interval[] {
  const intervals: Interval[] = [];
  let start = -1;
  for (let index = 0; index <= offsets.length; index += 1) {
    const active = index < offsets.length && Math.abs(offsets[index]) > 0.05;
    if (active && start < 0) start = index;
    if (!active && start >= 0) {
      intervals.push([Math.max(0, start - 1), Math.min(offsets.length, index + 1)]);
      start = -1;
    }
  }
  return intervals;
}

function foreheadCurveIndices(curves: CurveGeometry[]): number[] {
  const meanY = (curve: CurveGeometry): number => curve.prior.reduce(
    (sum, point) => sum + point[1], 0,
  ) / Math.max(1, curve.prior.length);
  return curves.map((curve, index) => ({ curve, index }))
    .filter(({ curve }) => String(curve.seed.region || "") === "forehead_bridge_arc_v15")
    .sort((left, right) => meanY(left.curve) - meanY(right.curve) || left.index - right.index)
    .map(({ index }) => index);
}

function measureForeheadSpacing(
  curves: CurveGeometry[], points: Point2[][], orderedIndices: number[],
) {
  const ratios: number[] = [];
  const records: any[] = [];
  let orderPreserved = true;
  for (let order = 0; order < orderedIndices.length - 1; order += 1) {
    const upperIndex = orderedIndices[order], lowerIndex = orderedIndices[order + 1];
    const upperPrior = curves[upperIndex].prior, lowerPrior = curves[lowerIndex].prior;
    const minimumX = Math.max(
      Math.min(...upperPrior.map((point) => point[0])),
      Math.min(...lowerPrior.map((point) => point[0])),
    );
    const maximumX = Math.min(
      Math.max(...upperPrior.map((point) => point[0])),
      Math.max(...lowerPrior.map((point) => point[0])),
    );
    if (!(maximumX > minimumX + EPSILON)) continue;
    const inset = 0.06 * (maximumX - minimumX);
    for (let sample = 0; sample < 25; sample += 1) {
      const x = minimumX + inset + (maximumX - minimumX - 2 * inset) * sample / 24;
      const upperPriorSample = sampleCurveLayerAtX(upperPrior, upperPrior, x);
      const lowerPriorSample = sampleCurveLayerAtX(lowerPrior, lowerPrior, x);
      const upperFinalSample = sampleCurveLayerAtX(upperPrior, points[upperIndex], x);
      const lowerFinalSample = sampleCurveLayerAtX(lowerPrior, points[lowerIndex], x);
      if (!upperPriorSample || !lowerPriorSample || !upperFinalSample || !lowerFinalSample) continue;
      const priorSpacing = lowerPriorSample.prior[1] - upperPriorSample.prior[1];
      const finalSpacing = lowerFinalSample.final[1] - upperFinalSample.final[1];
      if (Math.abs(priorSpacing) < 2) continue;
      const ratio = finalSpacing / priorSpacing;
      if (!(ratio > 0)) orderPreserved = false;
      ratios.push(ratio);
      records.push({
        upper_curve_index: upperIndex,
        lower_curve_index: lowerIndex,
        x,
        prior_spacing_px: priorSpacing,
        final_spacing_px: finalSpacing,
        spacing_ratio: ratio,
      });
    }
  }
  const sorted = ratios.filter(Number.isFinite).sort((left, right) => left - right);
  const worst = records.reduce((selected, record) => {
    const deviation = Math.abs(Math.log(Math.max(EPSILON, record.spacing_ratio)));
    return !selected || deviation > selected.deviation ? { ...record, deviation } : selected;
  }, null as any);
  return {
    sampleCount: sorted.length,
    minimumRatio: sorted.length ? sorted[0] : 1,
    maximumRatio: sorted.length ? sorted.at(-1)! : 1,
    p05Ratio: percentile(sorted, 0.05),
    p95Ratio: percentile(sorted, 0.95),
    orderPreserved,
    worstRecord: worst ? Object.fromEntries(
      Object.entries(worst).filter(([key]) => key !== "deviation"),
    ) : null,
  };
}

function applyForeheadBundleCoherence(
  curves: CurveGeometry[], matching: MatchingResult, refined: RefinedState,
  size: number, options: V6RefinementOptions,
) {
  const disabled = {
    enabled: options.foreheadBundleCoherence === true,
    applied: false,
    reason: "disabled",
    anchorCurveIndices: [] as number[],
    followerCurveIndices: [] as number[],
  };
  if (options.foreheadBundleCoherence !== true) return disabled;
  const orderedIndices = foreheadCurveIndices(curves);
  const acceptedForeheadIndices = new Set(matching.acceptedGroups
    .filter((group) => group.summary.final_accepted === true &&
      String(curves[group.curveIndex].seed.region || "") === "forehead_bridge_arc_v15")
    .map((group) => group.curveIndex));
  const anchorCurveIndices = orderedIndices.filter((curveIndex) =>
    acceptedForeheadIndices.has(curveIndex) && !refined.results[curveIndex].rollbackReason &&
    refined.results[curveIndex].points.some((point: Point2, pointIndex: number) =>
      Math.hypot(
        point[0] - curves[curveIndex].prior[pointIndex][0],
        point[1] - curves[curveIndex].prior[pointIndex][1],
      ) > 0.05));
  const anchorSet = new Set(anchorCurveIndices);
  const followerCurveIndices = orderedIndices.filter((index) => !anchorSet.has(index));
  if (!anchorCurveIndices.length || orderedIndices.length < 3) {
    return { ...disabled, reason: "insufficient_forehead_anchors",
      anchorCurveIndices, followerCurveIndices };
  }

  const snapshotPoints: Point2[][] = refined.results.map((result: any) =>
    result.points.map((point: Point2) => [...point] as Point2));
  const priorPoints = curves.map((curve) => curve.prior);
  const priorPairs = intersectionPairs(priorPoints);
  const priorSelf = priorPoints.map(selfCrosses);
  const materialTurn = Math.max(0.1,
    Number(options.curvatureFairingMaterialTurnDegrees) || 0.5);
  const maximumTurn = explicitPositive(options.foreheadBundleMaximumTurnDegrees, 8, 1);
  const allowedAddedSignChanges = Math.max(0, Math.round(Number(
    options.foreheadBundleMaximumAddedSignChanges ?? 2,
  )));
  const minimumReversalSpacingPx = explicitPositive(
    options.foreheadBundleMinimumReversalSpacingPx, 12, 2,
  );
  const minimumSpacingRatio = explicitPositive(
    options.foreheadBundleMinimumSpacingRatio, 0.65, 0.1,
  );
  const maximumSpacingRatio = explicitPositive(
    options.foreheadBundleMaximumSpacingRatio, 1.45, minimumSpacingRatio + 0.05,
  );
  const topBoundaryIndex = orderedIndices[0], bottomBoundaryIndex = orderedIndices.at(-1)!;

  const candidateOffsetsForScale = (
    scale: number, sigmaArc: number, rawBlend: number,
  ): Map<number, Float64Array> => {
    const output = new Map<number, Float64Array>();
    for (const curveIndex of followerCurveIndices) {
      const follower = curves[curveIndex];
      const offsets = new Float64Array(follower.prior.length);
      for (let pointIndex = 0; pointIndex < follower.prior.length; pointIndex += 1) {
        const point = follower.prior[pointIndex];
        const controls = anchorCurveIndices.map((anchorIndex) => {
          const sample = sampleCurveLayerAtX(
            curves[anchorIndex].prior, snapshotPoints[anchorIndex], point[0],
          );
          return sample ? { y: sample.prior[1], displacement: sample.displacement } : null;
        }).filter((control): control is { y: number; displacement: Point2 } => control !== null);
        const top = sampleCurveLayerAtX(
          curves[topBoundaryIndex].prior, curves[topBoundaryIndex].prior, point[0],
        );
        const bottom = sampleCurveLayerAtX(
          curves[bottomBoundaryIndex].prior, curves[bottomBoundaryIndex].prior, point[0],
        );
        if (top && !anchorSet.has(topBoundaryIndex)) {
          controls.push({ y: top.prior[1], displacement: [0, 0] });
        }
        if (bottom && !anchorSet.has(bottomBoundaryIndex)) {
          controls.push({ y: bottom.prior[1], displacement: [0, 0] });
        }
        controls.sort((left, right) => left.y - right.y);
        if (!controls.length) continue;
        let lower = controls[0], upper = controls[0];
        if (point[1] >= controls.at(-1)!.y) {
          lower = upper = controls.at(-1)!;
        } else if (point[1] > controls[0].y) {
          for (let index = 1; index < controls.length; index += 1) {
            if (point[1] <= controls[index].y) {
              lower = controls[index - 1];
              upper = controls[index];
              break;
            }
          }
        }
        const fraction = upper.y > lower.y + EPSILON ?
          clamp((point[1] - lower.y) / (upper.y - lower.y)) : 0;
        const displacement: Point2 = [
          lower.displacement[0] + fraction * (upper.displacement[0] - lower.displacement[0]),
          lower.displacement[1] + fraction * (upper.displacement[1] - lower.displacement[1]),
        ];
        offsets[pointIndex] = scale * (
          displacement[0] * follower.normals[pointIndex][0] +
          displacement[1] * follower.normals[pointIndex][1]
        );
      }
      const smoothed = gaussianFairNormalOffsets(
        follower, offsets, [[0, offsets.length]], sigmaArc, true,
      );
      output.set(curveIndex, Float64Array.from(smoothed, (value, index) =>
        (1 - rawBlend) * value + rawBlend * offsets[index]));
    }
    return output;
  };

  const beforeSpacing = measureForeheadSpacing(curves, snapshotPoints, orderedIndices);
  let selected: any = null, bestAttempt: any = null;
  const sigmaArcCandidates = [0.012, 0.018, 0.024, 0.030, 0.040]
    .map((ratio) => Math.max(3, size * ratio));
  for (const sigmaArc of sigmaArcCandidates) {
  for (const scale of [1, 1.05, 1.10, 1.15, 1.20, 1.25, 0.95]) {
  for (const rawBlend of [0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60]) {
    const candidateOffsets = candidateOffsetsForScale(scale, sigmaArc, rawBlend);
    const candidatePoints: Point2[][] = snapshotPoints.map((points) =>
      points.map((point) => [...point] as Point2));
    for (const [curveIndex, offsets] of candidateOffsets) {
      candidatePoints[curveIndex] = pointsFromOffsets(curves[curveIndex], offsets);
    }
    const curvatureViolations = [];
    let observedMaximumTurnDegrees = 0, maximumTurnIncreaseDegrees = 0;
    let observedMaximumAddedSignChanges = 0;
    for (const curveIndex of followerCurveIndices) {
      const priorMetrics = curvatureMetrics(curves[curveIndex].prior, materialTurn);
      const afterMetrics = curvatureMetrics(candidatePoints[curveIndex], materialTurn);
      const turnIncrease = afterMetrics.maximumTurnDegrees - priorMetrics.maximumTurnDegrees;
      const addedSignChanges = afterMetrics.materialSignChanges - priorMetrics.materialSignChanges;
      const newShortCurvatureReversal =
        !(priorMetrics.minimumMaterialSignChangeSpacingPx !== null &&
          priorMetrics.minimumMaterialSignChangeSpacingPx < minimumReversalSpacingPx) &&
        afterMetrics.minimumMaterialSignChangeSpacingPx !== null &&
        afterMetrics.minimumMaterialSignChangeSpacingPx < minimumReversalSpacingPx - 1e-6;
      observedMaximumTurnDegrees = Math.max(
        observedMaximumTurnDegrees, afterMetrics.maximumTurnDegrees,
      );
      maximumTurnIncreaseDegrees = Math.max(maximumTurnIncreaseDegrees, turnIncrease);
      observedMaximumAddedSignChanges = Math.max(observedMaximumAddedSignChanges, addedSignChanges);
      if (afterMetrics.maximumTurnDegrees > Math.max(
        maximumTurn, priorMetrics.maximumTurnDegrees + 0.75,
      ) + 1e-6 || addedSignChanges > allowedAddedSignChanges ||
          newShortCurvatureReversal) {
        curvatureViolations.push({ curve_index: curveIndex, prior: priorMetrics,
          after: afterMetrics, new_short_curvature_reversal: newShortCurvatureReversal });
      }
    }
    const outOfBoundsPointCount = candidatePoints.reduce((count, points) => count +
      points.filter((point) => point[0] < 0 || point[1] < 0 ||
        point[0] >= size || point[1] >= size).length, 0);
    const spacing = measureForeheadSpacing(curves, candidatePoints, orderedIndices);
    const spacingViolation = Math.max(0, minimumSpacingRatio - spacing.minimumRatio) +
      Math.max(0, spacing.maximumRatio - maximumSpacingRatio);
    const fieldGatesPassed = !curvatureViolations.length && !outOfBoundsPointCount &&
      spacing.orderPreserved && spacing.minimumRatio >= minimumSpacingRatio - 1e-6 &&
      spacing.maximumRatio <= maximumSpacingRatio + 1e-6;
    const candidatePairs = fieldGatesPassed ? intersectionPairs(candidatePoints) : priorPairs;
    const newPairs = fieldGatesPassed ?
      [...candidatePairs].filter((pair) => !priorPairs.has(pair)) : [];
    const newSelf = fieldGatesPassed ? candidatePoints.reduce((count, points, index) => count +
      (!priorSelf[index] && selfCrosses(points) ? 1 : 0), 0) : 0;
    const accepted = fieldGatesPassed && !newPairs.length && !newSelf;
    const attempt = { scale, sigmaArcPx: sigmaArc, rawBlend, accepted,
      spacing, spacingViolation,
      curvatureViolationCount: curvatureViolations.length,
      newIntersectionPairs: newPairs, newSelfCrossCurveCount: newSelf,
      outOfBoundsPointCount,
      maximumTurnDegrees: observedMaximumTurnDegrees,
      maximumTurnIncreaseDegrees,
      maximumAddedSignChanges: observedMaximumAddedSignChanges };
    const score = spacingViolation * 1000 + curvatureViolations.length * 100 +
      newPairs.length * 1000 + newSelf * 1000 + outOfBoundsPointCount * 1000 +
      (spacing.orderPreserved ? 0 : 10000) +
      Math.abs(1 - scale);
    if (!bestAttempt || score < bestAttempt.score) bestAttempt = { ...attempt, score };
    if (accepted) {
      const quality = Math.abs(Math.log(Math.max(EPSILON, spacing.p05Ratio))) +
        Math.abs(Math.log(Math.max(EPSILON, spacing.p95Ratio))) +
        0.02 * observedMaximumTurnDegrees + 0.10 * Math.abs(1 - scale);
      if (!selected || quality < selected.quality) {
        selected = { ...attempt, quality, candidateOffsets, candidatePoints };
      }
    }
  }
  }
  }
  if (!selected) {
    return { enabled: true, applied: false, reason: "coherence_gate_rejected",
      anchorCurveIndices, followerCurveIndices, beforeSpacing, bestAttempt };
  }
  for (const curveIndex of followerCurveIndices) {
    const offsets = selected.candidateOffsets.get(curveIndex) as Float64Array;
    refined.results[curveIndex].offsets = offsets;
    refined.results[curveIndex].points = selected.candidatePoints[curveIndex];
    refined.results[curveIndex].intervals = activeOffsetIntervals(offsets);
    refined.results[curveIndex].rollbackReason = null;
    refined.results[curveIndex].supportScore = Math.max(
      refined.results[curveIndex].supportScore || 0, 0.20,
    );
  }
  const anchorReplayMaximumErrorPx = anchorCurveIndices.reduce((maximum, curveIndex) =>
    Math.max(maximum, ...snapshotPoints[curveIndex].map((point, pointIndex) => Math.hypot(
      point[0] - refined.results[curveIndex].points[pointIndex][0],
      point[1] - refined.results[curveIndex].points[pointIndex][1],
    ))), 0);
  return { enabled: true, applied: true, reason: null, anchorCurveIndices,
    followerCurveIndices, movedFollowerCurveCount: followerCurveIndices.filter((curveIndex) =>
      selected.candidateOffsets.get(curveIndex).some((value: number) => Math.abs(value) > 0.05)
    ).length,
    movedFollowerPointCount: followerCurveIndices.reduce((sum, curveIndex) => sum +
      selected.candidateOffsets.get(curveIndex).filter(
        (value: number) => Math.abs(value) > 0.05,
      ).length, 0),
    selectedScale: selected.scale,
    selectedSigmaArcPx: selected.sigmaArcPx,
    selectedRawBlend: selected.rawBlend,
    beforeSpacing,
    afterSpacing: selected.spacing,
    maximumTurnDegrees: selected.maximumTurnDegrees,
    maximumTurnIncreaseDegrees: selected.maximumTurnIncreaseDegrees,
    maximumAddedSignChanges: selected.maximumAddedSignChanges,
    minimumReversalSpacingPx,
    newIntersectionPairs: selected.newIntersectionPairs,
    newSelfCrossCurveCount: selected.newSelfCrossCurveCount,
    anchorReplayMaximumErrorPx,
  };
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
    noseBridgePlanarWarpApplied: result.noseBridgePlanarWarpApplied === true,
    bundleFollowerSources: (result.bundleFollowerSources || []).map((source: any) => ({ ...source })),
    curveIndex,
  }));
  let curvatureFairing = applyCurvatureFairing(refined.results, size, options);
  if (options.curvatureFairing === true) {
    intersection = rollbackNewIntersections(
      refined.results, curves.map((curve) => curve.prior),
    );
  }
  let noseBridgePlanarWarp = applyNoseBridgePlanarWarp(
    refined.results, matching, curves, faceWidth, options,
  );
  if (options.curvatureFairing === true) {
    intersection = rollbackNewIntersections(
      refined.results, curves.map((curve) => curve.prior),
    );
  }
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
      const fairingEvent = curvatureFairing.events.find((event: any) =>
        event.curve_index === (group?.curveIndex ?? Number(key.split(":")[1])));
      const adherenceRecord = candidateAdherence.records.find((record: any) =>
        record.wrinkle_segment_id === (group?.trendIndex ?? Number(key.split(":")[0])) &&
        record.rstl_curve_index === (group?.curveIndex ?? Number(key.split(":")[1])));
      excludedTrendCurvePairs.add(key);
      excludedTrendCurvePairReasons.set(key, "adherence_retry_excluded");
      adherenceRetryRecords.push({
        attempt,
        wrinkle_segment_id: group?.trendIndex ?? Number(key.split(":")[0]),
        excluded_rstl_curve_index: group?.curveIndex ?? Number(key.split(":")[1]),
        reason: spacingFailedPairs.has(key) ? "bundle_spacing_guard_failed" :
          group?.summary?.rejection_reason || "post_adherence_gate_rejected",
        curvature_fairing_event: fairingEvent ? { ...fairingEvent } : null,
        nose_bridge_planar_warp: { ...noseBridgePlanarWarp },
        trajectory_adherence_record: adherenceRecord ? { ...adherenceRecord } : null,
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
    curvatureFairing = applyCurvatureFairing(refined.results, size, options);
    intersection = rollbackNewIntersections(
      refined.results, curves.map((curve) => curve.prior),
    );
    noseBridgePlanarWarp = applyNoseBridgePlanarWarp(
      refined.results, matching, curves, faceWidth, options,
    );
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
      if (result.noseBridgePlanarWarpApplied === true) continue;
      result.offsets.fill(0);
      result.points = result.curve.prior.map((point: Point2) => [...point]);
      result.rollbackReason = result.rollbackReason || "post_adherence_gate_rejected";
      postAdherenceRollback.add(curveIndex);
    }
    for (const curveIndex of candidateAdherence.alreadyAlignedCurveIndices) {
      const result = refined.results[curveIndex];
      if (result.noseBridgePlanarWarpApplied === true) continue;
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
  const foreheadBundleCoherence = applyForeheadBundleCoherence(
    curves, matching, refined, size, options,
  );
  if (foreheadBundleCoherence.applied === true) {
    intersection = rollbackNewIntersections(
      refined.results, curves.map((curve) => curve.prior),
    );
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
  const finalAcceptedGroups = matching.acceptedGroups.filter((group) =>
    group.summary.final_accepted === true);
  const bothSidesSelectedTrends = new Set(finalAcceptedGroups
    .filter((group) => matching.acceptedGroups.some((candidate) =>
      candidate.summary.final_accepted === true && candidate.trendIndex === group.trendIndex &&
      Math.sign(candidate.meanSignedNormalOffset) !== Math.sign(group.meanSignedNormalOffset)))
    .map((group) => group.trendIndex));
  const foreheadSingleSelectedTrends = new Set(finalAcceptedGroups
    .filter((group) => group.summary.forehead_single_curve_selected === true)
    .map((group) => group.trendIndex));
  const regionalSingleSelectedTrends = new Set(finalAcceptedGroups
    .filter((group) => group.summary.regional_curve_selected === true)
    .map((group) => group.trendIndex));
  const completeFinalNoseBridgeTrends = new Set([...new Set(finalAcceptedGroups
    .filter((group) => group.summary.guided_region === "nose_bridge")
    .map((group) => group.trendIndex))].filter((trendIndex) =>
    finalAcceptedGroups.filter((group) => group.trendIndex === trendIndex &&
      group.summary.guided_region === "nose_bridge").length === 1));
  const regionalSelectedCounts = {
    glabellar: new Set(finalAcceptedGroups.filter((group) =>
      group.summary.guided_region === "glabellar").map((group) => group.trendIndex)).size,
    nose_bridge: completeFinalNoseBridgeTrends.size,
    crows_feet: new Set(finalAcceptedGroups.filter((group) =>
      group.summary.guided_region === "crows_feet").map((group) => group.trendIndex)).size,
  };
  const allSelectedTrends = new Set(finalAcceptedGroups.map((group) => group.trendIndex));
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
    two_sided_nearest_matching: options.twoSidedNearestMatching === true,
    maximum_selected_rstl_curves_per_wrinkle: matching.acceptedGroups.reduce(
      (maximum, group) => Math.max(maximum, matching.acceptedGroups.filter(
        (candidate) => candidate.trendIndex === group.trendIndex,
      ).length), 0,
    ),
    curve_unique_wrinkle_ownership: matching.acceptedGroups.every((group, index, groups) =>
      groups.findIndex((candidate) => candidate.curveIndex === group.curveIndex) === index),
    wrinkle_with_both_sides_selected_count: bothSidesSelectedTrends.size,
    forehead_nearest_single_curve_matching:
      options.foreheadNearestSingleCurveMatching === true,
    forehead_single_curve_selected_count: foreheadSingleSelectedTrends.size,
    regional_nearest_single_curve_matching:
      options.regionalNearestSingleCurveMatching === true,
    regional_single_curve_selected_count: regionalSingleSelectedTrends.size,
    nose_bridge_ordered_cross_selected_count: completeFinalNoseBridgeTrends.size,
    nose_bridge_planar_warp: noseBridgePlanarWarp,
    forehead_bundle_coherence: foreheadBundleCoherence,
    glabellar_single_curve_selected_count: regionalSelectedCounts.glabellar,
    nose_bridge_single_curve_selected_count: regionalSelectedCounts.nose_bridge,
    crows_feet_single_curve_selected_count: regionalSelectedCounts.crows_feet,
    wrinkle_with_single_side_selected_count: [...allSelectedTrends].filter((trendIndex) =>
      !bothSidesSelectedTrends.has(trendIndex) &&
      !foreheadSingleSelectedTrends.has(trendIndex) &&
      !regionalSingleSelectedTrends.has(trendIndex)).length,
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
    curvature_fairing_enabled: options.curvatureFairing === true,
    curvature_fairing_applied_curve_count: curvatureFairing.appliedCurveCount,
    curvature_fairing_rollback_curve_count: curvatureFairing.rollbackCurveCount,
    curvature_fairing_events: curvatureFairing.events,
    curvature_fairing_contract_preserved: curvatureFairing.events.every((event: any) =>
      event.status !== "faired" ||
      (event.after.maximumTurnDegrees <= event.maximum_turn_limit_degrees + 1e-6 &&
       event.after.materialSignChanges <= event.maximum_sign_changes &&
       (event.guided_region === null ||
        event.prior.minimumMaterialSignChangeSpacingPx <
          event.minimum_reversal_spacing_px ||
        event.after.minimumMaterialSignChangeSpacingPx === null ||
        event.after.minimumMaterialSignChangeSpacingPx >=
          event.minimum_reversal_spacing_px - 1e-6))),
    post_fairing_adherence_contract_preserved: adherence.records.every((record: any) =>
      !record.final_accepted || record.final_status === "already_aligned" ||
      (record.final_mean_distance_px <= record.mean_distance_threshold_px + 1e-6 &&
       record.final_p90_distance_px <= record.p90_distance_threshold_px + 1e-6 &&
       record.final_direction_p90_degrees <= record.direction_p90_threshold_degrees + 1e-6)),
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
    normal_displacement_only: noseBridgePlanarWarp.applied !== true &&
      !curvatureFairing.events.some((event: any) =>
        event.status === "faired" && event.regional_cartesian_displacement === true),
    regional_cartesian_displacement_used: curvatureFairing.events.some((event: any) =>
      event.status === "faired" && event.regional_cartesian_displacement === true) ||
      noseBridgePlanarWarp.applied === true,
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
