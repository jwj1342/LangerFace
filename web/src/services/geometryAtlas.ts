import {
  DEFAULT_OCCLUSION_THRESHOLD,
  INNER_LIP as INNER_LIP_IDX,
  NOSE_TIP,
  TOPOLOGY_ID,
  TOPOLOGY_VERSION,
} from "./constantsGenerated.ts";
import type { Triangle, Vec3 } from "./softBody";

type Vec2 = [number, number];

export { NOSE_TIP };

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

export type AtlasPoint = [number, number, number];

export interface AtlasLine {
  name?: string;
  region?: string;
  disableRuntimeExpansion?: boolean;
  postExpansionOffsetsFaceRatioSparse?: Array<[number, number, number]>;
  postMapSmoothingPasses?: number;
  postMapCubicFairing?: boolean;
  postMapTemporalCubicFaceRatio?: [number, Vec2, Vec2, Vec2];
  postMapTemporalAbsoluteEndpoint?: boolean;
  postMapTemporalBoundaryMarginFaceRatio?: number;
  points?: AtlasPoint[];
}

export interface AtlasPayload {
  topologyId?: string;
  topologyVersion?: string;
  lines?: AtlasLine[];
}

export interface MappedAtlasLine {
  name: string;
  /** 显示期需要按 region 决定后处理（额头外推线要额外裁剪，见 #141）。 */
  region: string;
  pts: Vec3[];
  tris: number[];
}

export interface VisibleTriangleOptions {
  minTriangleAreaPx2?: number;
}

export interface MapAtlasOptions {
  expandForehead?: boolean;
  /** Limit the display-only forehead bridge stack without changing the source atlas. */
  foreheadBridgeLineCount?: number;
  /** Move the bottom of the display-only bridge stack down by a face-height ratio. */
  foreheadBridgeBottomShiftFaceRatio?: number;
  /** Add display-only clearance below the bridge for medial upward extensions. */
  medialUpwardVisibleGapFaceRatio?: number;
}

const FOREHEAD_LOWER_LONG_ARC_REGION = "forehead_lower_long_arc_v13";
const FOREHEAD_BRIDGE_ARC_REGION = "forehead_bridge_arc_v15";
const SUPRAORBITAL_SHORT_ARC_REGIONS_V67 = new Set([
  "supraorbital_lateral_short_arc_v67",
  "supraorbital_medial_short_arc_v67",
]);
const SUPRAORBITAL_UPWARD_SHIFT_FACE_HEIGHT_V67 = 0.080;
const SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V68 = "supraorbital_medial_short_arc_v68";
const SUPRAORBITAL_MEDIAL_UPWARD_SHIFT_FACE_HEIGHT_V68 = 0.040;
const SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V69 = "supraorbital_medial_short_arc_v69";
const SHORT_BROW_TIP_NAMES = new Set(
  [170, 171, 172, 173, 174].flatMap(id =>
    ["left", "right"].map(side => `standard_field_${String(id).padStart(4, "0")}_${side}`)),
);


/** Retract only the forehead-facing end of the ten short brow arcs. */
function shortenShortBrowTips(lines: MappedAtlasLine[], landmarks: Vec3[]): void {
  if (!landmarks.length) return;
  const height = Math.max(...landmarks.map(p => p[1])) - Math.min(...landmarks.map(p => p[1]));
  for (const line of lines) {
    if (line.region !== SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V69 || !SHORT_BROW_TIP_NAMES.has(line.name)) continue;
    if (line.pts.length < 3) continue;
    const reverse = line.pts[0][1] > line.pts.at(-1)![1];
    const points = reverse ? [...line.pts].reverse() : [...line.pts];
    const tris = reverse ? [...line.tris].reverse() : [...line.tris];
    const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
    let remaining = Math.min(height * 0.008, length * 0.20);
    // On some face shapes the original seed already intersects the bridge;
    // shortening only its added extension cannot resolve that intersection.
    const bridges = lines.filter(candidate => candidate.region === FOREHEAD_BRIDGE_ARC_REGION);
    let walked = 0;
    for (let i = 1; i < points.length; i++) {
      walked += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      if (bridges.some(bridge => lineSegments(bridge.pts).some(segment =>
        segmentsConflict([points[i - 1], points[i]], segment, height * 0.002)))) {
        remaining = Math.max(remaining, walked);
      }
    }
    remaining = Math.min(remaining, length * 0.95);
    let start = 0;
    while (start < points.length - 2) {
      const a = points[start], b = points[start + 1];
      const segment = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (segment > remaining) break;
      remaining -= segment; start++;
    }
    const a = points[start], b = points[start + 1];
    const fraction = Math.min(1, remaining / Math.max(1e-12, Math.hypot(b[0] - a[0], b[1] - a[1])));
    const endpoint: Vec3 = [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1]), a[2] + fraction * (b[2] - a[2])];
    line.pts = [endpoint, ...points.slice(start + 1)];
    line.tris = tris.slice(start);
    if (reverse) { line.pts.reverse(); line.tris.reverse(); }
  }
}

const GLABELLA_BROW_UPTURN_REGION_V11 = "orbital_brow_upturn_v11";
const MEDIAL_UPWARD_EXTENSION_REGIONS = new Set([
  SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V69,
  GLABELLA_BROW_UPTURN_REGION_V11,
]);

function orientation2d(a: Vec3, b: Vec3, c: Vec3): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointSegmentDistance2d(point: Vec3, segment: [Vec3, Vec3]): number {
  const [a, b] = segment;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  if (length2 <= 1e-12) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1,
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function segmentsConflict(a: [Vec3, Vec3], b: [Vec3, Vec3], clearance: number): boolean {
  const minAx = Math.min(a[0][0], a[1][0]) - clearance;
  const maxAx = Math.max(a[0][0], a[1][0]) + clearance;
  const minAy = Math.min(a[0][1], a[1][1]) - clearance;
  const maxAy = Math.max(a[0][1], a[1][1]) + clearance;
  const minBx = Math.min(b[0][0], b[1][0]) - clearance;
  const maxBx = Math.max(b[0][0], b[1][0]) + clearance;
  const minBy = Math.min(b[0][1], b[1][1]) - clearance;
  const maxBy = Math.max(b[0][1], b[1][1]) + clearance;
  if (maxAx < minBx || maxBx < minAx || maxAy < minBy || maxBy < minAy) return false;

  const ab = orientation2d(a[0], a[1], b[0]);
  const ac = orientation2d(a[0], a[1], b[1]);
  const ba = orientation2d(b[0], b[1], a[0]);
  const bb = orientation2d(b[0], b[1], a[1]);
  const intersects = ((ab >= 0 && ac <= 0) || (ab <= 0 && ac >= 0))
    && ((ba >= 0 && bb <= 0) || (ba <= 0 && bb >= 0));
  if (intersects) return true;
  return Math.min(
    pointSegmentDistance2d(a[0], b),
    pointSegmentDistance2d(a[1], b),
    pointSegmentDistance2d(b[0], a),
    pointSegmentDistance2d(b[1], a),
  ) <= clearance;
}

function lineSegments(points: Vec3[]): Array<[Vec3, Vec3]> {
  return points.slice(1).map((point, index) => [points[index], point]);
}

function extendMedialUpwardArc(
  points: Vec3[],
  landmarksPx: Vec3[],
  otherLines: MappedAtlasLine[],
  visibleGapFaceRatio = 0.008,
): Vec3[] {
  if (points.length < 3 || landmarksPx.length <= 10) return points;
  // These are vertical glabellar seed arcs. Select their upper endpoint from
  // the line itself; a landmark-derived axis can tilt with pose and choose the
  // wrong end on side views.
  const topAtStart = points[0][1] <= points.at(-1)![1];
  const endpointIndex = topAtStart ? 0 : points.length - 1;
  const neighbourIndex = topAtStart ? 1 : points.length - 2;
  const endpoint = points[endpointIndex];
  const neighbour = points[neighbourIndex];
  let dx = endpoint[0] - neighbour[0];
  let dy = endpoint[1] - neighbour[1];
  const norm = Math.hypot(dx, dy);
  if (!(norm > 1e-6)) return points;
  dx /= norm; dy /= norm;
  if (dy > 0) { dx = -dx; dy = -dy; }
  const faceHeight = Math.max(...landmarksPx.map((point) => point[1]))
    - Math.min(...landmarksPx.map((point) => point[1]));
  // Use a fine step here. The medial verticals often end only a few pixels
  // below the forehead bridge; a coarse step can jump directly into that
  // neighbouring curve and incorrectly reject the whole extension.
  const step = Math.max(2, Math.min(8, norm));
  // The seed arcs can stop well below the forehead bridge on taller faces.
  // Search far enough to reach that bridge; the collision/clearance test below
  // remains the actual stopping condition for every image and face shape.
  const maxLength = Math.max(step, faceHeight * 0.18);
  // Keep a sub-pixel geometric gap from neighbouring atlas curves. The
  // renderer's stroke width supplies the visible separation; a multi-pixel
  // geometry clearance leaves an avoidable blank band under the bridge arcs.
  // Stroke separation is handled by the renderer. Keep only a small geometric
  // exclusion band so a near-touching endpoint can still fill the visible gap
  // without allowing an actual segment intersection.
  const clearance = Math.max(3.0, faceHeight * 0.001);
  const candidateAt = (length: number): Vec3[] => {
    const count = Math.max(1, Math.ceil(length / step));
    const extension: Vec3[] = [];
    for (let index = count; index >= 1; index--) {
      const distance = length * index / count;
      extension.push([endpoint[0] + dx * distance, endpoint[1] + dy * distance, endpoint[2]]);
    }
    return topAtStart ? extension.concat(points) : points.concat(extension.reverse());
  };
  const conflictsExisting = (candidate: Vec3[]): boolean => {
    // Only test segments introduced by this extension. Including the first
    // original segment made a valid continuation inherit unrelated atlas
    // contacts and could reject the extension at length zero.
    const addedCount = candidate.length - points.length;
    const addedSegments = topAtStart
      ? lineSegments(candidate).slice(0, addedCount)
      : lineSegments(candidate).slice(points.length - 1, points.length - 1 + addedCount);
    return otherLines.some((line) => lineSegments(line.pts).some((segment) =>
      addedSegments.some((added) => segmentsConflict(added, segment, clearance))));
  };

  // Find the first unsafe length before refining it. A single binary search
  // would be unsafe if a ray crossed a neighbouring curve and then exited it.
  let lo = 0;
  let hi = maxLength;
  for (let length = step; length <= maxLength; length += step) {
    if (conflictsExisting(candidateAt(length))) {
      hi = length;
      break;
    }
    lo = length;
  }
  for (let iteration = 0; iteration < 12; iteration++) {
    const mid = (lo + hi) * 0.5;
    if (conflictsExisting(candidateAt(mid))) hi = mid; else lo = mid;
  }
  // Keep a visible gap below the forehead bridge. The collision clearance is
  // a geometric guard, but it can still leave the rendered strokes touching
  // because the canvas line has nonzero width. Pull every medial upward arc
  // back by the same face-relative amount after the safe endpoint is found.
  const visibleGap = faceHeight * Math.max(0, visibleGapFaceRatio);
  return lo >= step ? candidateAt(Math.max(0, lo - visibleGap)) : points;
}

function raiseSupraorbitalShortArc(
  points: Vec3[], landmarksPx: Vec3[], shiftFaceHeight: number,
): Vec3[] {
  if (points.length === 0 || landmarksPx.length <= 10) return points;
  const anchor = landmarksPx[9];
  const top = landmarksPx[10];
  const axisX = top[0] - anchor[0];
  const axisY = top[1] - anchor[1];
  const axisNorm = Math.hypot(axisX, axisY);
  const landmarkYs = landmarksPx.map((point) => point[1]);
  const faceHeight = Math.max(...landmarkYs) - Math.min(...landmarkYs);
  if (axisNorm <= 1e-9 || faceHeight <= 1e-9) return points;
  const shift = shiftFaceHeight * faceHeight;
  const unitX = axisX / axisNorm;
  const unitY = axisY / axisNorm;
  return points.map((point) => [
    point[0] + shift * unitX,
    point[1] + shift * unitY,
    point[2],
  ]);
}

/** Keep forehead arcs centered on the observed face midline.
 *
 * The bridge expansion is anchored at landmark 9 for its local vertical axis.
 * That anchor can be horizontally biased by landmark noise or uneven facial
 * texture, which otherwise shifts every expanded forehead line to one side.
 */
function recenterForeheadCurve(
  points: Vec3[],
  landmarksPx: Vec3[],
  anchor: Vec3,
  lateralX: number,
  lateralY: number,
): Vec3[] {
  if (points.length < 2) return points;
  const pairCenters: number[] = [];
  for (const [leftIndex, rightIndex] of [[33, 263], [234, 454]] as const) {
    const left = landmarksPx[leftIndex];
    const right = landmarksPx[rightIndex];
    if (!left || !right) continue;
    const centerX = (left[0] + right[0]) * 0.5;
    const centerY = (left[1] + right[1]) * 0.5;
    pairCenters.push(
      (centerX - anchor[0]) * lateralX + (centerY - anchor[1]) * lateralY,
    );
  }
  if (!pairCenters.length) return points;
  const sortedCenters = pairCenters.sort((a, b) => a - b);
  const middle = Math.floor(sortedCenters.length / 2);
  const target = sortedCenters.length % 2
    ? sortedCenters[middle]
    : 0.5 * (sortedCenters[middle - 1] + sortedCenters[middle]);
  const lateral = points.map((point) => (
    (point[0] - anchor[0]) * lateralX + (point[1] - anchor[1]) * lateralY
  ));
  const current = 0.5 * (Math.min(...lateral) + Math.max(...lateral));
  const shift = target - current;
  if (!Number.isFinite(shift) || Math.abs(shift) <= 1e-6) return points;
  return points.map((point) => [
    point[0] + shift * lateralX,
    point[1] + shift * lateralY,
    point[2],
  ]);
}

function smoothMappedCurve(points: Vec3[], passes: number): Vec3[] {
  let out = points.map((point) => [...point] as Vec3);
  const count = Math.max(0, Math.min(32, Math.trunc(Number(passes) || 0)));
  for (let pass = 0; pass < count && out.length >= 3; pass += 1) {
    const smoothed = out.map((point) => [...point] as Vec3);
    for (let index = 1; index < out.length - 1; index += 1) {
      smoothed[index][0] = 0.25 * out[index - 1][0] + 0.5 * out[index][0] + 0.25 * out[index + 1][0];
      smoothed[index][1] = 0.25 * out[index - 1][1] + 0.5 * out[index][1] + 0.25 * out[index + 1][1];
    }
    out = smoothed;
  }
  return out;
}

/** Reject mapping-stage fits that introduce a local fold or a sharp corner. */
function hasSharpMappedTurn(points: Vec3[], maxTurnRadians = Math.PI * 0.36): boolean {
  if (points.length < 5) return false;
  for (let index = 1; index < points.length - 2; index += 1) {
    const firstX = points[index][0] - points[index - 1][0];
    const firstY = points[index][1] - points[index - 1][1];
    const secondX = points[index + 1][0] - points[index][0];
    const secondY = points[index + 1][1] - points[index][1];
    const firstLength = Math.hypot(firstX, firstY);
    const secondLength = Math.hypot(secondX, secondY);
    if (firstLength <= 1e-6 || secondLength <= 1e-6) continue;
    const cosine = (firstX * secondX + firstY * secondY) / (firstLength * secondLength);
    const turn = Math.abs(Math.atan2(
      firstX * secondY - firstY * secondX,
      firstX * secondX + firstY * secondY,
    ));
    if (cosine < 0 || turn > maxTurnRadians) return true;
  }
  return false;
}

function resampleCurve(points: Vec3[], count: number): Vec3[] {
  if (points.length === 0 || count <= 0) return [];
  if (points.length === 1 || count === 1) return [points[0].slice() as Vec3];
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    ));
  }
  const total = cumulative.at(-1) ?? 0;
  if (!(total > 1e-9)) return Array.from({ length: count }, () => points[0].slice() as Vec3);
  const out: Vec3[] = [];
  for (let sample = 0; sample < count; sample += 1) {
    const target = total * sample / (count - 1);
    let upper = 1;
    while (upper < cumulative.length - 1 && cumulative[upper] < target) upper += 1;
    const lower = upper - 1;
    const span = cumulative[upper] - cumulative[lower];
    const t = span > 1e-9 ? (target - cumulative[lower]) / span : 0;
    out.push([
      points[lower][0] + t * (points[upper][0] - points[lower][0]),
      points[lower][1] + t * (points[upper][1] - points[lower][1]),
      points[lower][2] + t * (points[upper][2] - points[lower][2]),
    ]);
  }
  return out;
}

/** Continue the lower brow arcs as nested offsets of the intact upper arc.
 * Normal offsets preserve the arch and the medial turn; translating a curve
 * vertically does not, and trimming collisions can cut off its lateral tail.
 */
function separateBrowTails(lines: MappedAtlasLine[], landmarks: Vec3[]): void {
  for (const side of ["right", "left"]) {
    const reference = lines.find(line => line.name === `standard_field_0107_${side}`);
    const upper = lines.find(line => line.name === `standard_field_0154_${side}`);
    if (!reference || !upper || reference.pts.length < 3) continue;
    const sample = resampleCurve(reference.pts, 160);
    const upperSample = resampleCurve(upper.pts, 160);
    // Estimate local spacing from the two intact neighboring brow curves.
    const distances = sample.slice(30, 80).map((point, index) =>
      Math.hypot(point[0] - upperSample[index + 30][0], point[1] - upperSample[index + 30][1]));
    distances.sort((a, b) => a - b);
    const faceHeight = Math.max(...landmarks.map(p => p[1])) - Math.min(...landmarks.map(p => p[1]));
    const gap = Math.max(faceHeight * 0.006, Math.min(faceHeight * 0.014, distances[Math.floor(distances.length / 2)]));
    for (const [rank, id] of ["0155", "0108", "0109"].entries()) {
      const line = lines.find(item => item.name === `standard_field_${id}_${side}`);
      if (!line) continue;
      const template = resampleCurve(reference.pts, line.pts.length);
      line.pts = template.map((point, index) => {
        const before = template[Math.max(0, index - 2)];
        const after = template[Math.min(template.length - 1, index + 2)];
        const dx = after[0] - before[0], dy = after[1] - before[1];
        const norm = Math.hypot(dx, dy) || 1;
        const sign = side === "right" ? 1 : -1;
        const distance = gap * (rank + 1);
        return [point[0] - sign * dy / norm * distance,
          point[1] + sign * dx / norm * distance, line.pts[index][2]];
      });
    }
  }
}

/** Move the medial brow turns inward with a shared, order-preserving warp.
 * Its displacement and first derivative vanish at the lateral boundary; the
 * centre itself remains fixed, so opposing bundles cannot cross the midline.
 */
function bringBrowTurnsMedially(lines: MappedAtlasLine[], landmarks: Vec3[]): void {
  if (landmarks.length <= 454) return;
  const center = landmarks[168];
  const faceWidth = Math.hypot(landmarks[454][0] - landmarks[234][0], landmarks[454][1] - landmarks[234][1]);
  const radius = faceWidth * 0.28;
  // Keep the warp derivative above 0.27, preserving central line order.
  const amount = faceWidth * 0.030;
  if (!(radius > 0)) return;
  const names = new Set([105, 106, 107, 108, 109, 154, 155].flatMap(id =>
    ["left", "right"].map(side => `standard_field_${String(id).padStart(4, "0")}_${side}`)));
  const obstacles = lines.filter(line => !names.has(line.name));
  const selected = lines.filter(line => names.has(line.name) && line.region === GLABELLA_BROW_UPTURN_REGION_V11);
  const prior = selected.map(line => line.pts);
  // Lower the middle of the turn while keeping its top and bottom fixed.
  // This flattens the approach before the upright segment, without narrowing
  // the spacing between upright tips.
  const top = Math.min(...prior.flatMap(points => points.map(p => p[1])));
  const bottoms = prior.map(points => Math.max(...points.map(p => p[1]))).sort((a, b) => a - b);
  const turnHeight = (bottoms[Math.floor(bottoms.length / 2)] ?? top) - top;
  const conflict = (a: Vec3[], b: Vec3[]) => lineSegments(a).some(segment =>
    lineSegments(b).some(other => segmentsConflict(segment, other, 0.25)));
  // Validate the whole group at the same strength; never deform lines one by
  // one against already-moved neighbours or silently truncate their tails.
  for (const scale of [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0]) {
    const candidate = prior.map(points => points.map((p): Vec3 => {
      const distance = Math.abs(p[0] - center[0]), t = distance / radius;
      const displacement = t < 1 ? scale * amount * (27 / 4) * t * (1 - t) ** 2 : 0;
      const x = p[0] - Math.sign(p[0] - center[0]) * displacement;
      const heightT = turnHeight > 0 ? Math.max(0, Math.min(1, (p[1] - top) / turnHeight)) : 0;
      const turnT = Math.min(1, Math.abs(x - center[0]) / (faceWidth * 0.20));
      const medialWeight = 1 - turnT ** 3 * (10 - 15 * turnT + 6 * turnT ** 2);
      const lowerTurn = scale * 0.22 * turnHeight * Math.sin(Math.PI * heightT) ** 2 * medialWeight;
      return [x, p[1] + lowerTurn, p[2]];
    }));
    const unsafe = candidate.some((points, i) =>
      obstacles.some(obstacle => conflict(points, obstacle.pts) && !conflict(prior[i], obstacle.pts)) ||
      candidate.slice(0, i).some((other, j) => conflict(points, other) && !conflict(prior[i], prior[j])));
    if (unsafe) continue;
    selected.forEach((line, i) => { line.pts = candidate[i]; });
    return;
  }
}

/** One independent lower brow arc, crossing the glabella without turning up. */
function addLowerBrowBridgeSeed(lines: MappedAtlasLine[], landmarks: Vec3[]): void {
  if (landmarks.length <= 454) return;
  const sources = ["left", "right"].map(side => lines.find(line =>
    line.name === `standard_field_0109_${side}`));
  if (sources.some(line => !line || line.pts.length < 4)) return;
  const width = Math.hypot(landmarks[454][0] - landmarks[234][0], landmarks[454][1] - landmarks[234][1]);
  if (!(width > 0)) return;
  const center = landmarks[168][0];
  const ordered = sources.map(line => line!).sort((a, b) => a.pts[0][0] - b.pts[0][0]);
  // Evaluate the lower envelope, excluding the upright medial tails.
  const at = (line: MappedAtlasLine, x: number): Vec3 => {
    const hits: Vec3[] = [];
    for (let i = 1; i < line.pts.length; i++) {
      const a = line.pts[i - 1], b = line.pts[i];
      if (x < Math.min(a[0], b[0]) || x > Math.max(a[0], b[0]) || Math.abs(b[0] - a[0]) < 1e-9) continue;
      const t = (x - a[0]) / (b[0] - a[0]);
      hits.push([x, a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
    }
    return hits.sort((a, b) => b[1] - a[1])[0]
      ?? line.pts.reduce((a, b) => Math.abs(a[0] - x) < Math.abs(b[0] - x) ? a : b);
  };
  const lo = Math.min(...ordered[0].pts.map(p => p[0]));
  const hi = Math.max(...ordered[1].pts.map(p => p[0]));
  const left = center - width * 0.09, right = center + width * 0.09;
  if (!(lo < left && right < hi)) return;
  const a = at(ordered[0], left), b = at(ordered[1], right);
  const slope = (line: MappedAtlasLine, x: number) => {
    const step = width * 0.012;
    return Math.max(-0.3, Math.min(0.3, (at(line, x + step)[1] - at(line, x - step)[1]) / (2 * step)));
  };
  const ma = slope(ordered[0], left), mb = slope(ordered[1], right);
  for (const offset of [0.014, 0.011, 0.008, 0.005]) {
    let pts: Vec3[] = Array.from({ length: 201 }, (_, i) => {
      const x = lo + (hi - lo) * i / 200;
      if (x <= left || x >= right) {
        const p = at(x <= left ? ordered[0] : ordered[1], x);
        return [x, p[1] + offset * width, p[2]];
      }
      const t = (x - left) / (right - left), t2 = t * t, t3 = t2 * t;
      return [x, (2 * t3 - 3 * t2 + 1) * a[1] + (t3 - 2 * t2 + t) * (right - left) * ma
        + (-2 * t3 + 3 * t2) * b[1] + (t3 - t2) * (right - left) * mb + offset * width,
      a[2] + t * (b[2] - a[2])];
    });
    pts = smoothMappedCurve(pts, 3);
    const obstacles = lines.flatMap(line => lineSegments(line.pts));
    const blocked = lineSegments(pts).map(segment =>
      obstacles.some(other => segmentsConflict(segment, other, 0.75)));
    // Endpoints may stop before lateral eye arcs, but never remove the middle
    // or split the requested continuous bridge into unrelated fragments.
    let start = 0, end = pts.length - 1;
    for (let i = 0; i < blocked.length; i++) if (blocked[i]) {
      if (i < blocked.length * 0.2) start = Math.max(start, i + 2);
      else if (i > blocked.length * 0.8) end = Math.min(end, i - 1);
      else { start = end; break; }
    }
    if (end - start < pts.length * 0.6) continue;
    pts = pts.slice(start, end + 1);
    const tris = pts.map(p => {
      let best = Infinity, tri = -1;
      for (const source of ordered) source.pts.forEach((q, i) => {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < best) { best = d; tri = source.tris[i] ?? -1; }
      });
      return tri;
    });
    lines.push({ name: "standard_brow_lower_bridge_0001", region: "brow_lower_bridge", pts, tris });
    return;
  }
}

function addLowerBrowBridge(lines: MappedAtlasLine[], landmarks: Vec3[], count = 3): void {
  if (landmarks.length <= 454) return;
  const sources = ["left", "right"].map(side => lines.find(line =>
    line.name === `standard_field_0109_${side}`));
  if (sources.some(line => !line || line.pts.length < 4)) return;
  const width = Math.hypot(landmarks[454][0] - landmarks[234][0], landmarks[454][1] - landmarks[234][1]);
  if (!(width > 0)) return;
  const center = landmarks[168][0];
  const ordered = sources.map(line => line!).sort((a, b) => a.pts[0][0] - b.pts[0][0]);
  // Evaluate the lower envelope, excluding the upright medial tails.
  const at = (line: MappedAtlasLine, x: number): Vec3 => {
    const hits: Vec3[] = [];
    const side = line.name.endsWith("_left") ? "_left" : "_right";
    for (const member of lines.filter(l => l.region === GLABELLA_BROW_UPTURN_REGION_V11 && l.name.endsWith(side))) {
    for (let i = 1; i < member.pts.length; i++) {
      const a = member.pts[i - 1], b = member.pts[i];
      if (x < Math.min(a[0], b[0]) || x > Math.max(a[0], b[0]) || Math.abs(b[0] - a[0]) < 1e-9) continue;
      const t = (x - a[0]) / (b[0] - a[0]);
      hits.push([x, a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
    }
    }
    return hits.sort((a, b) => b[1] - a[1])[0]
      ?? line.pts.reduce((a, b) => Math.abs(a[0] - x) < Math.abs(b[0] - x) ? a : b);
  };
  const lo = Math.min(...ordered[0].pts.map(p => p[0]));
  const hi = Math.max(...ordered[1].pts.map(p => p[0]));
  const left = center - width * 0.09, right = center + width * 0.09;
  if (!(lo < left && right < hi)) return;
  const a = at(ordered[0], left), b = at(ordered[1], right);
  const slope = (line: MappedAtlasLine, x: number) => {
    const step = width * 0.012;
    return Math.max(-0.3, Math.min(0.3, (at(line, x + step)[1] - at(line, x - step)[1]) / (2 * step)));
  };
  const ma = slope(ordered[0], left), mb = slope(ordered[1], right);
  for (const offset of Array.from({ length: 33 }, (_, i) => 0.012 - i * 0.00025)) {
    let pts: Vec3[] = Array.from({ length: 201 }, (_, i) => {
      const x = lo + (hi - lo) * i / 200;
      if (x <= left || x >= right) {
        const p = at(x <= left ? ordered[0] : ordered[1], x);
        return [x, p[1] + offset * width, p[2]];
      }
      const t = (x - left) / (right - left), t2 = t * t, t3 = t2 * t;
      return [x, (2 * t3 - 3 * t2 + 1) * a[1] + (t3 - 2 * t2 + t) * (right - left) * ma
        + (-2 * t3 + 3 * t2) * b[1] + (t3 - t2) * (right - left) * mb + offset * width,
      a[2] + t * (b[2] - a[2])];
    });
    // Keep source-envelope samples intact until the corridor is solved.
    // Fit three full-length curves into the available corridor. Never shorten
    // one side to hide a collision with the lateral canthus arcs.
    const corridor = pts.map(p => {
      let clearance = width * offset * 3;
      const baseY = p[1] - offset * width;
      for (const line of lines.filter(l => l.region !== "brow_lower_bridge")) for (let i = 1; i < line.pts.length; i++) {
        const a = line.pts[i - 1], b = line.pts[i];
        if (p[0] < Math.min(a[0], b[0]) || p[0] > Math.max(a[0], b[0]) || Math.abs(b[0] - a[0]) < 1e-9) continue;
        const y = a[1] + (p[0] - a[0]) / (b[0] - a[0]) * (b[1] - a[1]);
        if (!ordered.includes(line) && y > baseY + 0.75) clearance = Math.min(clearance, y - baseY);
      }
      return clearance;
    });
    for (const fractions of count === 3
      ? [[0.25, 0.45, 0.65], [0.30, 0.48, 0.66], [0.25, 0.50, 0.75], [0.20, 0.40, 0.60], [0.30, 0.50, 0.70]]
      : [[0.375, 0.625]]) {
    const pair = fractions.map(fraction => {
      const raw = pts.map((p, i): Vec3 =>
        [p[0], p[1] - offset * width + corridor[i] * fraction, p[2]]);
      // The nearest obstacle can change at its endpoint, creating a step in
      // clearance. Smooth the final trajectory, not just the source curve.
      // Linear extrapolation at either end preserves the full horizontal span.
      const sigma = 2;
      return raw.map((p, i): Vec3 => {
        let total = 0, weight = 0;
        for (let k = -6; k <= 6; k++) {
          const j = i + k, w = Math.exp(-0.5 * (k / sigma) ** 2);
          const y = j < 0 ? raw[0][1] + j * (raw[1][1] - raw[0][1])
            : j >= raw.length ? raw.at(-1)![1] + (j - raw.length + 1) * (raw.at(-1)![1] - raw.at(-2)![1])
            : raw[j][1];
          total += w * y;
          weight += w;
        }
        return [p[0], total / weight, p[2]];
      });
    });
    const conflicts = (a: Vec3[], b: Vec3[]) => lineSegments(a).some(segment =>
      lineSegments(b).some(other => segmentsConflict(segment, other, 0.75)));
    if (pair.some((points, i) => lines.some(line => line.region !== "brow_lower_bridge" && conflicts(points, line.pts))
      || pair.slice(0, i).some(other => conflicts(points, other)))) continue;

    const tris = pts.map(p => {
      let best = Infinity, tri = -1;
      for (const source of ordered) source.pts.forEach((q, i) => {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < best) { best = d; tri = source.tris[i] ?? -1; }
      });
      return tri;
    });
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].region === "brow_lower_bridge") lines.splice(i, 1);
    pair.forEach((points, i) => lines.push({ name: `standard_brow_lower_bridge_000${i + 1}`,
      region: "brow_lower_bridge", pts: points, tris: [...tris] }));
    return;
    }
  }
  if (count === 3) addLowerBrowBridge(lines, landmarks, 2);
}

/** Tighten the five brow-tail arcs without changing their lengths or curvature. */
function tightenBrowTemporalSpacing(lines: MappedAtlasLine[]): void {
  for (const side of ["left", "right"]) {
    const group = [201, 202, 203, 204, 205].map(id => lines.find(line =>
      line.name === `standard_field_${String(id).padStart(4, "0")}_${side}`
      && line.region === "brow_temporal_fan_v94"));
    if (group.some(line => !line || line.pts.length < 2)) continue;
    const selected = group.map(line => line!);
    // Measure in the shared horizontal span, so unequal tail lengths do not
    // bias the spacing. Translate whole curves, keeping the middle one fixed.
    const lo = Math.max(...selected.map(line => Math.min(...line.pts.map(p => p[0]))));
    const hi = Math.min(...selected.map(line => Math.max(...line.pts.map(p => p[0]))));
    if (!(hi > lo)) continue;
    const heightAt = (points: Vec3[], x: number): number => {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (x < Math.min(a[0], b[0]) || x > Math.max(a[0], b[0]) || Math.abs(b[0] - a[0]) < 1e-9) continue;
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
      return NaN;
    };
    const heights = selected.map(line => Array.from({ length: 21 }, (_, i) =>
      heightAt(line.pts, lo + (hi - lo) * i / 20)).reduce((a, b) => a + b, 0) / 21);
    if (!heights.every(Number.isFinite)) continue;
    const candidate = selected.map((line, rank) => line.pts.map((p): Vec3 =>
      [p[0], p[1] + (heights[2] - heights[rank]) * 0.15, p[2]]));
    const conflicts = (a: Vec3[], b: Vec3[]) => lineSegments(a).some(segment =>
      lineSegments(b).some(other => segmentsConflict(segment, other, 0.75)));
    const obstacles = lines.filter(line => !selected.includes(line));
    if (candidate.some((points, i) => obstacles.some(other =>
      conflicts(points, other.pts) && !conflicts(selected[i].pts, other.pts))
      || candidate.slice(0, i).some((other, j) =>
        conflicts(points, other) && !conflicts(selected[i].pts, selected[j].pts)))) continue;
    selected.forEach((line, i) => { line.pts = candidate[i]; });
  }
}

/** Move the accepted brow-tail bundles down without changing their spacing. */
function lowerBrowTemporalBundles(lines: MappedAtlasLine[], landmarks: Vec3[]): void {
  if (!landmarks.length) return;
  const shift = (Math.max(...landmarks.map(p => p[1])) - Math.min(...landmarks.map(p => p[1]))) * 0.003;
  if (!(shift > 0)) return;
  for (const side of ["left", "right"]) {
    const group = [201, 202, 203, 204, 205].map(id => lines.find(line =>
      line.name === `standard_field_${String(id).padStart(4, "0")}_${side}`
      && line.region === "brow_temporal_fan_v94"));
    if (group.some(line => !line || line.pts.length < 2)) continue;
    const selected = group.map(line => line!);
    const candidate = selected.map(line => line.pts.map((p): Vec3 => [p[0], p[1] + shift, p[2]]));
    const obstacles = lines.filter(line => !selected.includes(line));
    const conflicts = (a: Vec3[], b: Vec3[]) => lineSegments(a).some(segment =>
      lineSegments(b).some(other => segmentsConflict(segment, other, 0.75)));
    if (candidate.some((points, i) => obstacles.some(other =>
      conflicts(points, other.pts) && !conflicts(selected[i].pts, other.pts)))) continue;
    selected.forEach((line, i) => { line.pts = candidate[i]; });
  }
}

/** Flatten and evenly space only the five lateral canthus arcs on each side. */
function regularizeCanthusArcs(lines: MappedAtlasLine[], tighten = 0.75): void {
  for (const side of ["left", "right"]) {
    const group = [162, 163, 189, 164, 165].map(id => lines.find(line =>
      line.name === `standard_field_${String(id).padStart(4, "0")}_${side}`
      && line.region === "lateral_canthus_short_arc_v65"));
    if (group.some(line => !line || line.pts.length < 2)) continue;
    const selected = group.map(line => line!);
    const original = selected.map(line => line.pts);
    const cumulative = original.map(points => {
      const distances = [0];
      for (let i = 1; i < points.length; i++) distances.push(distances[i - 1]
        + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
      return distances;
    });
    const sample = (index: number, t: number): Vec3 => {
      const points = original[index], distances = cumulative[index];
      const target = Math.max(0, Math.min(1, t)) * distances.at(-1)!;
      let i = 1;
      while (i < distances.length - 1 && distances[i] < target) i++;
      const u = (target - distances[i - 1]) / Math.max(1e-9, distances[i] - distances[i - 1]);
      return points[i - 1].map((v, axis) => v + u * (points[i][axis] - v)) as Vec3;
    };
    const mean = (t: number): Vec3 => [0, 1, 2].map(axis =>
      original.reduce((sum, _, i) => sum + sample(i, t)[axis], 0) / 5) as Vec3;
    const outer = mean(0)[1];
    // Use the existing group's width; split it into four equal normal gaps.
    let gap = 0;
    for (let k = 0; k <= 20; k++) {
      const t = k / 20, a = mean(t - 0.01), b = mean(t + 0.01);
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      const low = sample(4, t), high = sample(0, t);
      gap += Math.abs((low[0] - high[0]) * -dy + (low[1] - high[1]) * dx) / Math.max(1e-9, len) / 4;
    }
    gap /= 21;
    if (!(gap > 0)) continue;
    const obstacles = lines.filter(line => !selected.includes(line));
    const conflicts = (a: Vec3[], b: Vec3[]) => lineSegments(a).some(segment =>
      lineSegments(b).some(other => segmentsConflict(segment, other, 0.75)));
    for (const flatten of [0.28, 0.20, 0.12, 0]) {
      const centerAt = (t: number): Vec3 => {
        const p = mean(t);
        return [p[0], outer + (p[1] - outer) * (1 - flatten), p[2]];
      };
      const candidate = original.map((pts, rank) => pts.map((_, i): Vec3 => {
        const t = i / (pts.length - 1), p = centerAt(t);
        const a = centerAt(t - 0.005), b = centerAt(t + 0.005);
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.max(1e-9, Math.hypot(dx, dy));
        const sign = dx < 0 ? -1 : 1, offset = (rank - 2) * gap;
        return [p[0] - sign * dy / len * offset, p[1] + sign * dx / len * offset, sample(rank, t)[2]];
      }));
      const unsafe = candidate.some((pts, i) => obstacles.some(other =>
        conflicts(pts, other.pts) && (other.region === "brow_lower_bridge" || !conflicts(original[i], other.pts)))
        || candidate.slice(0, i).some(other => conflicts(pts, other)));
      if (unsafe) continue;
      selected.forEach((line, i) => { line.pts = candidate[i]; });
      break;
    }
    // Translate the complete five-line bundle; preserve its shape and spacing.
    const spaced = selected.map(line => line.pts);
    for (const fraction of [0.30, 0.20, 0.10]) {
      const lifted = spaced.map(points => points.map((p): Vec3 => [p[0], p[1] - gap * fraction, p[2]]));
      if (lifted.some((points, i) => obstacles.some(other =>
        conflicts(points, other.pts) && (other.region === "brow_lower_bridge" || !conflicts(spaced[i], other.pts))))) continue;
      selected.forEach((line, i) => { line.pts = lifted[i]; });
      break;
    }
    // Tighten around the accepted middle curve after solving and lifting,
    // so spacing changes cannot select a different shape or vertical position.
    const baseline = selected.map(line => line.pts);
    const middle = baseline[2];
    const tightened = baseline.map((points, rank) => points.map((p, i): Vec3 => {
      if (rank === 2) return [...p];
      const u = i / (points.length - 1) * (middle.length - 1);
      const k = Math.min(middle.length - 2, Math.floor(u)), t = u - k;
      const center = [0, 1].map(axis => middle[k][axis] + t * (middle[k + 1][axis] - middle[k][axis]));
      return [center[0] + (p[0] - center[0]) * tighten, center[1] + (p[1] - center[1]) * tighten, p[2]];
    }));
    if (!tightened.some((points, i) => obstacles.some(other =>
      conflicts(points, other.pts) && !conflicts(baseline[i], other.pts))
      || tightened.slice(0, i).some(other => conflicts(points, other)))) {
      selected.forEach((line, i) => { line.pts = tightened[i]; });
    }
  }
}

function fairMappedCurveCubic(points: Vec3[]): Vec3[] {
  const out = points.map((point) => [...point] as Vec3);
  if (out.length < 4) return out;
  const cumulative = new Array<number>(out.length).fill(0);
  for (let index = 1; index < out.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + Math.hypot(
      out[index][0] - out[index - 1][0],
      out[index][1] - out[index - 1][1],
    );
  }
  const length = cumulative.at(-1) ?? 0;
  if (!(length > 1e-9)) return out;
  const source = out.map((point) => [point[0], point[1]]);
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  const r1 = [0, 0];
  const r2 = [0, 0];
  const basis = cumulative.map((distance, index) => {
    const t = distance / length;
    const oneMinusT = 1 - t;
    const b0 = oneMinusT ** 3;
    const b1 = 3 * oneMinusT ** 2 * t;
    const b2 = 3 * oneMinusT * t ** 2;
    const b3 = t ** 3;
    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    for (let axis = 0; axis < 2; axis += 1) {
      const residual = out[index][axis] - b0 * out[0][axis] - b3 * out.at(-1)![axis];
      r1[axis] += b1 * residual;
      r2[axis] += b2 * residual;
    }
    return [b0, b1, b2, b3];
  });
  const determinant = a11 * a22 - a12 * a12;
  if (Math.abs(determinant) <= 1e-12) return out;
  const control1 = r1.map((value, axis) => (
    (a22 * value - a12 * r2[axis]) / determinant
  ));
  const control2 = r2.map((value, axis) => (
    (a11 * value - a12 * r1[axis]) / determinant
  ));
  for (let index = 1; index < out.length - 1; index += 1) {
    const [b0, b1, b2, b3] = basis[index];
    for (let axis = 0; axis < 2; axis += 1) {
      out[index][axis] = b0 * out[0][axis] + b1 * control1[axis]
        + b2 * control2[axis] + b3 * out.at(-1)![axis];
    }
  }
  let hasClockwiseTurn = false;
  let hasCounterclockwiseTurn = false;
  for (let index = 0; index < out.length - 2; index += 1) {
    const firstX = out[index + 1][0] - out[index][0];
    const firstY = out[index + 1][1] - out[index][1];
    const secondX = out[index + 2][0] - out[index + 1][0];
    const secondY = out[index + 2][1] - out[index + 1][1];
    const scale = Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY);
    const turnSine = scale > 1e-12
      ? (firstX * secondY - firstY * secondX) / scale
      : 0;
    hasClockwiseTurn ||= turnSine < -1e-6;
    hasCounterclockwiseTurn ||= turnSine > 1e-6;
  }
  if (hasClockwiseTurn && hasCounterclockwiseTurn) {
    let denominator = 0;
    const numerator = [0, 0];
    const quadraticBasis = cumulative.map((distance, index) => {
      const t = distance / length;
      const oneMinusT = 1 - t;
      const q0 = oneMinusT ** 2;
      const q1 = 2 * oneMinusT * t;
      const q2 = t ** 2;
      denominator += q1 * q1;
      for (let axis = 0; axis < 2; axis += 1) {
        const residual = source[index][axis]
          - q0 * source[0][axis] - q2 * source.at(-1)![axis];
        numerator[axis] += q1 * residual;
      }
      return [q0, q1, q2];
    });
    if (denominator > 1e-12) {
      const control = numerator.map((value) => value / denominator);
      for (let index = 1; index < out.length - 1; index += 1) {
        const [q0, q1, q2] = quadraticBasis[index];
        for (let axis = 0; axis < 2; axis += 1) {
          out[index][axis] = q0 * source[0][axis] + q1 * control[axis]
            + q2 * source.at(-1)![axis];
        }
      }
    }
  }
  return hasSharpMappedTurn(out) ? points : out;
}

function extendForeheadLowerLongArc(points: Vec3[], landmarksPx: Vec3[]): Vec3[] {
  if (points.length === 0 || landmarksPx.length <= 10) return points;
  const anchor = landmarksPx[9];
  const top = landmarksPx[10];
  const axisX = top[0] - anchor[0];
  const axisY = top[1] - anchor[1];
  const axisNorm = Math.hypot(axisX, axisY);
  if (axisNorm <= 1e-9) return points;
  const unitX = axisX / axisNorm;
  const unitY = axisY / axisNorm;
  const lateralX = -unitY;
  const lateralY = unitX;
  const out = points.map((point) => [...point] as Vec3);
  const lateralCoordinates = out.map((point) => (
    (point[0] - anchor[0]) * lateralX + (point[1] - anchor[1]) * lateralY
  ));

  for (const point of out) {
    const parallel = (point[0] - anchor[0]) * unitX + (point[1] - anchor[1]) * unitY;
    point[0] += 0.86 * parallel * unitX;
    point[1] += 0.86 * parallel * unitY;
  }

  const currentHalfWidth = Math.max(...lateralCoordinates.map((value) => Math.abs(value)));
  const landmarkXs = landmarksPx.map((point) => point[0]);
  const faceWidth = Math.max(...landmarkXs) - Math.min(...landmarkXs);
  if (currentHalfWidth > 1e-9 && faceWidth > 1e-9) {
    const factor = 0.82 * faceWidth / currentHalfWidth;
    for (let index = 0; index < out.length; index++) {
      out[index][0] += (factor - 1) * lateralCoordinates[index] * lateralX;
      out[index][1] += (factor - 1) * lateralCoordinates[index] * lateralY;
    }
  }

  for (let iteration = 0; iteration < 5; iteration++) {
    const smoothed = out.map((point) => [...point] as Vec3);
    for (let index = 1; index < out.length - 1; index++) {
      smoothed[index][0] = 0.25 * out[index - 1][0] + 0.5 * out[index][0] + 0.25 * out[index + 1][0];
      smoothed[index][1] = 0.25 * out[index - 1][1] + 0.5 * out[index][1] + 0.25 * out[index + 1][1];
    }
    for (let index = 0; index < out.length; index++) out[index] = smoothed[index];
  }

  const laterals = out.map((point) => (
    (point[0] - anchor[0]) * lateralX + (point[1] - anchor[1]) * lateralY
  ));
  const halfWidth = Math.max(...laterals.map((value) => Math.abs(value)));
  const landmarkYs = landmarksPx.map((point) => point[1]);
  const faceHeight = Math.max(...landmarkYs) - Math.min(...landmarkYs);
  if (halfWidth > 1e-9 && faceHeight > 1e-9) {
    for (let index = 0; index < out.length; index++) {
      const normalized = Math.min(1, Math.abs(laterals[index]) / halfWidth);
      const arch = 0.055 * faceHeight * (1 - normalized ** 2.4);
      out[index][0] += arch * unitX;
      out[index][1] += arch * unitY;
    }
  }
  return recenterForeheadCurve(out, landmarksPx, anchor, lateralX, lateralY);
}

function foreheadBridgeRanks(
  lines: AtlasLine[],
  landmarksPx: Vec3[],
  triangles: Triangle[],
  requestedCount?: number,
): Map<AtlasLine, number> {
  const bridgeLines = lines.filter((line) => line.region === FOREHEAD_BRIDGE_ARC_REGION);
  if (bridgeLines.length === 0) return new Map();
  if (landmarksPx.length > 10) {
    const anchor = landmarksPx[9];
    const top = landmarksPx[10];
    const axisX = top[0] - anchor[0];
    const axisY = top[1] - anchor[1];
    const axisNorm = Math.hypot(axisX, axisY);
    if (axisNorm > 1e-9) {
      const unitX = axisX / axisNorm;
      const unitY = axisY / axisNorm;
      const meanHeight = (line: AtlasLine): number => {
        let total = 0;
        let count = 0;
        for (const [tri, u, v] of line.points || []) {
          const triangle = triangles[tri];
          if (!triangle) continue;
          const a = landmarksPx[triangle[0]];
          const b = landmarksPx[triangle[1]];
          const c = landmarksPx[triangle[2]];
          if (!a || !b || !c) continue;
          const w = 1 - u - v;
          const x = u * a[0] + v * b[0] + w * c[0];
          const y = u * a[1] + v * b[1] + w * c[1];
          total += (x - anchor[0]) * unitX + (y - anchor[1]) * unitY;
          count++;
        }
        return count > 0 ? total / count : 0;
      };
      bridgeLines.sort((left, right) => meanHeight(right) - meanHeight(left));
    }
  }
  const selectedLines = Number.isFinite(requestedCount)
    ? bridgeLines.slice(0, Math.max(1, Math.min(bridgeLines.length, Math.floor(requestedCount as number))))
    : bridgeLines;
  const denominator = Math.max(selectedLines.length - 1, 1);
  return new Map(selectedLines.map((line, index) => [line, index / denominator]));
}

function extendForeheadBridge(points: Vec3[], landmarksPx: Vec3[], layerRank: number): Vec3[] {
  if (points.length === 0 || landmarksPx.length <= 10) return points;
  const anchor = landmarksPx[9];
  const top = landmarksPx[10];
  const axisX = top[0] - anchor[0];
  const axisY = top[1] - anchor[1];
  const axisNorm = Math.hypot(axisX, axisY);
  if (axisNorm <= 1e-9) return points;
  const unitX = axisX / axisNorm;
  const unitY = axisY / axisNorm;
  const lateralX = -unitY;
  const lateralY = unitX;
  const out = points.map((point) => [...point] as Vec3);
  const lateral = out.map((point) => (
    (point[0] - anchor[0]) * lateralX + (point[1] - anchor[1]) * lateralY
  ));

  for (const point of out) {
    const parallel = (point[0] - anchor[0]) * unitX + (point[1] - anchor[1]) * unitY;
    point[0] += 0.86 * parallel * unitX;
    point[1] += 0.86 * parallel * unitY;
  }

  const currentHalfWidth = Math.max(...lateral.map((value) => Math.abs(value)));
  const landmarkXs = landmarksPx.map((point) => point[0]);
  const faceWidth = Math.max(...landmarkXs) - Math.min(...landmarkXs);
  if (currentHalfWidth > 1e-9 && faceWidth > 1e-9) {
    const widthFactor = 0.82 * faceWidth / currentHalfWidth;
    for (let index = 0; index < out.length; index++) {
      out[index][0] += (widthFactor - 1) * lateral[index] * lateralX;
      out[index][1] += (widthFactor - 1) * lateral[index] * lateralY;
    }
  }

  for (let iteration = 0; iteration < 5; iteration++) {
    const smoothed = out.map((point) => [...point] as Vec3);
    for (let index = 1; index < out.length - 1; index++) {
      smoothed[index][0] = 0.25 * out[index - 1][0] + 0.5 * out[index][0] + 0.25 * out[index + 1][0];
      smoothed[index][1] = 0.25 * out[index - 1][1] + 0.5 * out[index][1] + 0.25 * out[index + 1][1];
    }
    for (let index = 0; index < out.length; index++) out[index] = smoothed[index];
  }

  const smoothedLateral = out.map((point) => (
    (point[0] - anchor[0]) * lateralX + (point[1] - anchor[1]) * lateralY
  ));
  const halfWidth = Math.max(...smoothedLateral.map((value) => Math.abs(value)));
  const landmarkYs = landmarksPx.map((point) => point[1]);
  const faceHeight = Math.max(...landmarkYs) - Math.min(...landmarkYs);
  if (halfWidth > 1e-9 && faceHeight > 1e-9) {
    for (let index = 0; index < out.length; index++) {
      const normalized = Math.min(1, Math.abs(smoothedLateral[index]) / halfWidth);
      const arch = 0.140 * faceHeight * (1 - normalized ** 2.0);
      out[index][0] += arch * unitX;
      out[index][1] += arch * unitY;
    }
  }
  if (faceHeight > 1e-9) {
    for (const point of out) {
      point[0] -= 0.100 * layerRank * faceHeight * unitX;
      point[1] -= 0.100 * layerRank * faceHeight * unitY;
    }
  }
  return recenterForeheadCurve(out, landmarksPx, anchor, lateralX, lateralY);
}

function equalizeForeheadBridgeSpacing(
  lines: MappedAtlasLine[],
  landmarksPx: Vec3[],
  bottomShiftFaceRatio = 0,
): void {
  if (lines.length < 2 || landmarksPx.length <= 10) return;
  const anchor = landmarksPx[9];
  const top = landmarksPx[10];
  const axisX = top[0] - anchor[0];
  const axisY = top[1] - anchor[1];
  const axisNorm = Math.hypot(axisX, axisY);
  if (!(axisNorm > 1e-9)) return;
  const unitX = axisX / axisNorm;
  const unitY = axisY / axisNorm;
  const meanProjection = (line: MappedAtlasLine): number => {
    if (line.pts.length === 0) return 0;
    return line.pts.reduce((sum, point) => (
      sum + (point[0] - anchor[0]) * unitX + (point[1] - anchor[1]) * unitY
    ), 0) / line.pts.length;
  };
  const ordered = [...lines].sort((left, right) => meanProjection(right) - meanProjection(left));
  const topProjection = meanProjection(ordered[0]);
  const faceHeight = Math.max(...landmarksPx.map((point) => point[1]))
    - Math.min(...landmarksPx.map((point) => point[1]));
  const bottomProjection = meanProjection(ordered.at(-1)!)
    - (Number.isFinite(bottomShiftFaceRatio) && faceHeight > 0
      ? Math.max(0, bottomShiftFaceRatio) * faceHeight
      : 0);
  const step = (topProjection - bottomProjection) / Math.max(ordered.length - 1, 1);
  for (let index = 0; index < ordered.length; index++) {
    const line = ordered[index];
    const delta = topProjection - step * index - meanProjection(line);
    for (const point of line.pts) {
      point[0] += delta * unitX;
      point[1] += delta * unitY;
    }
  }
}

function applyPostExpansionOffsets(
  points: Vec3[], line: AtlasLine, landmarksPx: Vec3[],
): Vec3[] {
  const offsets = line.postExpansionOffsetsFaceRatioSparse;
  if (!offsets?.length || landmarksPx.length === 0) return points;
  const xs = landmarksPx.map((point) => point[0]).filter(Number.isFinite);
  const faceWidth = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  if (!(faceWidth > 0)) return points;
  const out = points.map((point) => [...point] as Vec3);
  for (const [pointIndex, dxRatio, dyRatio] of offsets) {
    if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= out.length ||
        !Number.isFinite(dxRatio) || !Number.isFinite(dyRatio)) continue;
    out[pointIndex][0] += dxRatio * faceWidth;
    out[pointIndex][1] += dyRatio * faceWidth;
  }
  return out;
}

function sampleXyByArclength(points: Vec2[], count: number): Vec2[] {
  if (count <= 1) return points.slice(0, 1);
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) {
    cumulative.push(cumulative[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    ));
  }
  const total = cumulative[cumulative.length - 1];
  if (!(total > 1e-9)) return Array.from({ length: count }, () => [...points[0]] as Vec2);
  const result: Vec2[] = [];
  let segment = 0;
  for (let index = 0; index < count; index++) {
    const target = total * index / (count - 1);
    while (segment + 1 < cumulative.length - 1 && cumulative[segment + 1] < target) {
      segment += 1;
    }
    const span = cumulative[segment + 1] - cumulative[segment];
    const ratio = span > 1e-12 ? (target - cumulative[segment]) / span : 0;
    result.push([
      points[segment][0] + ratio * (points[segment + 1][0] - points[segment][0]),
      points[segment][1] + ratio * (points[segment + 1][1] - points[segment][1]),
    ]);
  }
  return result;
}

function applyTemporalCubicFaceRatio(
  points: Vec3[], landmarksPx: Vec3[], lineName: string,
  specification?: [number, Vec2, Vec2, Vec2],
  absoluteEndpoint = false,
  boundaryMarginFaceRatio = 0.02,
): Vec3[] {
  if (!specification || points.length < 5 || landmarksPx.length === 0) return points;
  const [joinIndex, firstOffset, secondOffset, tangentHandleOffset] = specification;
  if (!Number.isInteger(joinIndex) || joinIndex < 2 || joinIndex >= points.length - 2) return points;
  const xs = landmarksPx.map((point) => point[0]).filter(Number.isFinite);
  const faceWidth = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  if (!(faceWidth > 1e-9)) return points;

  const out = points.map((point) => [...point] as Vec3);
  const join: Vec2 = [out[joinIndex][0], out[joinIndex][1]];
  let rightAxis: Vec2 = [1, 0];
  if (landmarksPx.length > 263) {
    rightAxis = [
      landmarksPx[263][0] - landmarksPx[33][0],
      landmarksPx[263][1] - landmarksPx[33][1],
    ];
  }
  const rightNorm = Math.hypot(rightAxis[0], rightAxis[1]);
  if (!(rightNorm > 1e-9)) return points;
  rightAxis = [rightAxis[0] / rightNorm, rightAxis[1] / rightNorm];
  let downAxis: Vec2 = landmarksPx.length > 152
    ? [
        landmarksPx[152][0] - landmarksPx[10][0],
        landmarksPx[152][1] - landmarksPx[10][1],
      ]
    : [0, 1];
  const downProjection = downAxis[0] * rightAxis[0] + downAxis[1] * rightAxis[1];
  downAxis = [
    downAxis[0] - downProjection * rightAxis[0],
    downAxis[1] - downProjection * rightAxis[1],
  ];
  const downNorm = Math.hypot(downAxis[0], downAxis[1]);
  if (!(downNorm > 1e-9)) return points;
  downAxis = [downAxis[0] / downNorm, downAxis[1] / downNorm];
  const outwardAxis: Vec2 = lineName.endsWith("_left")
    ? rightAxis
    : [-rightAxis[0], -rightAxis[1]];
  const oldOutwardDistance = (
    (out[0][0] - join[0]) * outwardAxis[0]
    + (out[0][1] - join[1]) * outwardAxis[1]
  ) / faceWidth;
  const requestedOutwardDistance = absoluteEndpoint
    ? Math.min(0.22, Math.max(0, firstOffset[0]))
    : Math.min(0.22, Math.max(firstOffset[0], oldOutwardDistance + 0.03));
  let targetOutwardDistance = requestedOutwardDistance;
  if (absoluteEndpoint && landmarksPx.length > 389) {
    const boundaryIndices = lineName.endsWith("_left")
      ? [356, 389, 251, 284, 332, 297, 338, 10]
      : [127, 162, 21, 54, 103, 67, 109, 10];
    const boundaryDown = boundaryIndices.map((index) => (
      landmarksPx[index][0] * downAxis[0] + landmarksPx[index][1] * downAxis[1]
    ));
    const boundaryOutward = boundaryIndices.map((index) => (
      landmarksPx[index][0] * outwardAxis[0] + landmarksPx[index][1] * outwardAxis[1]
    ));
    const endpointDown = join[0] * downAxis[0] + join[1] * downAxis[1]
      + faceWidth * firstOffset[1];
    const outwardCandidates: number[] = [];
    for (let index = 0; index < boundaryIndices.length - 1; index++) {
      const down0 = boundaryDown[index];
      const down1 = boundaryDown[index + 1];
      if (endpointDown < Math.min(down0, down1) || endpointDown > Math.max(down0, down1)) {
        continue;
      }
      const ratio = Math.abs(down1 - down0) > 1e-9
        ? (endpointDown - down0) / (down1 - down0)
        : 0.5;
      outwardCandidates.push(
        boundaryOutward[index]
        + ratio * (boundaryOutward[index + 1] - boundaryOutward[index]),
      );
    }
    let boundaryOutwardAtEndpoint: number;
    if (outwardCandidates.length) {
      boundaryOutwardAtEndpoint = Math.max(...outwardCandidates);
    } else {
      let nearestIndex = 0;
      for (let index = 1; index < boundaryDown.length; index++) {
        if (Math.abs(boundaryDown[index] - endpointDown)
          < Math.abs(boundaryDown[nearestIndex] - endpointDown)) {
          nearestIndex = index;
        }
      }
      boundaryOutwardAtEndpoint = boundaryOutward[nearestIndex];
    }
    const boundaryMargin = Math.min(0.1, Math.max(-0.05, boundaryMarginFaceRatio));
    const boundaryLimit = (
      boundaryOutwardAtEndpoint
      - boundaryMargin * faceWidth
      - join[0] * outwardAxis[0]
      - join[1] * outwardAxis[1]
    ) / faceWidth;
    targetOutwardDistance = Math.min(targetOutwardDistance, Math.max(0, boundaryLimit));
  }
  const outwardExtra = Math.max(0, targetOutwardDistance - firstOffset[0]);
  const localOffset = (offset: Vec2, extraScale: number): Vec2 => [
    faceWidth * (
      (offset[0] + extraScale * outwardExtra) * outwardAxis[0]
      + offset[1] * downAxis[0]
    ),
    faceWidth * (
      (offset[0] + extraScale * outwardExtra) * outwardAxis[1]
      + offset[1] * downAxis[1]
    ),
  ];
  const firstDelta: Vec2 = absoluteEndpoint
    ? [
        faceWidth * (
          targetOutwardDistance * outwardAxis[0] + firstOffset[1] * downAxis[0]
        ),
        faceWidth * (
          targetOutwardDistance * outwardAxis[1] + firstOffset[1] * downAxis[1]
        ),
      ]
    : localOffset(firstOffset, 1);
  let secondOutwardDistance = secondOffset[0] + 0.55 * outwardExtra;
  const boundaryClamped = absoluteEndpoint
    && targetOutwardDistance < requestedOutwardDistance - 1e-9;
  if (boundaryClamped) {
    secondOutwardDistance = Math.min(secondOutwardDistance, 0.70 * targetOutwardDistance);
  }
  const secondDelta: Vec2 = [
    faceWidth * (
      secondOutwardDistance * outwardAxis[0] + secondOffset[1] * downAxis[0]
    ),
    faceWidth * (
      secondOutwardDistance * outwardAxis[1] + secondOffset[1] * downAxis[1]
    ),
  ];
  let first: Vec2 = [join[0] + firstDelta[0], join[1] + firstDelta[1]];
  let second: Vec2 = [join[0] + secondDelta[0], join[1] + secondDelta[1]];
  const endpointDelta: Vec2 = [first[0] - out[0][0], first[1] - out[0][1]];
  const outwardExtension = endpointDelta[0] * outwardAxis[0] + endpointDelta[1] * outwardAxis[1];
  const outwardCorrection = absoluteEndpoint
    ? 0
    : Math.max(0, 0.03 * faceWidth - outwardExtension);
  const upwardShift = endpointDelta[0] * downAxis[0] + endpointDelta[1] * downAxis[1];
  const downCorrection = !absoluteEndpoint && upwardShift < -0.02 * faceWidth
    ? -0.02 * faceWidth - upwardShift
    : 0;
  const correction: Vec2 = [
    outwardCorrection * outwardAxis[0] + downCorrection * downAxis[0],
    outwardCorrection * outwardAxis[1] + downCorrection * downAxis[1],
  ];
  first = [first[0] + correction[0], first[1] + correction[1]];
  second = [second[0] + 0.55 * correction[0], second[1] + 0.55 * correction[1]];
  let outgoing: Vec2 = [
    out[joinIndex + 1][0] - join[0],
    out[joinIndex + 1][1] - join[1],
  ];
  const outgoingNorm = Math.hypot(outgoing[0], outgoing[1]);
  if (!(outgoingNorm > 1e-9)) return points;
  outgoing = [outgoing[0] / outgoingNorm, outgoing[1] / outgoingNorm];
  const controlTangent: Vec2 = [
    out[joinIndex + 1][0] - out[joinIndex - 1][0],
    out[joinIndex + 1][1] - out[joinIndex - 1][1],
  ];
  const controlTangentNorm = Math.hypot(controlTangent[0], controlTangent[1]);
  if (!(controlTangentNorm > 1e-9)) return points;
  const handleLength = faceWidth * Math.hypot(tangentHandleOffset[0], tangentHandleOffset[1]);
  const third: Vec2 = [
    join[0] - handleLength * controlTangent[0] / controlTangentNorm,
    join[1] - handleLength * controlTangent[1] / controlTangentNorm,
  ];
  if (boundaryClamped) {
    const thirdOutwardDistance = (
      (third[0] - join[0]) * outwardAxis[0]
      + (third[1] - join[1]) * outwardAxis[1]
    ) / faceWidth;
    const clampedThirdOutwardDistance = Math.min(
      Math.max(0, thirdOutwardDistance),
      0.70 * secondOutwardDistance,
    );
    const thirdCorrection = faceWidth
      * (clampedThirdOutwardDistance - thirdOutwardDistance);
    third[0] += thirdCorrection * outwardAxis[0];
    third[1] += thirdCorrection * outwardAxis[1];
  }
  const dense: Vec2[] = [];
  for (let index = 0; index < 192; index++) {
    const t = index / 191;
    const oneMinus = 1 - t;
    dense.push([
      oneMinus ** 3 * first[0] + 3 * oneMinus ** 2 * t * second[0]
        + 3 * oneMinus * t ** 2 * third[0] + t ** 3 * join[0],
      oneMinus ** 3 * first[1] + 3 * oneMinus ** 2 * t * second[1]
        + 3 * oneMinus * t ** 2 * third[1] + t ** 3 * join[1],
    ]);
  }
  const prefix = sampleXyByArclength(dense, joinIndex + 1);
  const terminalSegmentLength = Math.hypot(
    prefix[prefix.length - 1][0] - prefix[prefix.length - 2][0],
    prefix[prefix.length - 1][1] - prefix[prefix.length - 2][1],
  );
  prefix[prefix.length - 2] = [
    join[0] - terminalSegmentLength * outgoing[0],
    join[1] - terminalSegmentLength * outgoing[1],
  ];
  for (let index = 0; index <= joinIndex; index++) {
    out[index][0] = prefix[index][0];
    out[index][1] = prefix[index][1];
  }
  return hasSharpMappedTurn(out) ? points : out;
}

export function toPixels(landmarks: NormalizedLandmark[], width: number, height: number): Vec3[] {
  const out = new Array<Vec3>(landmarks.length);
  for (let i = 0; i < landmarks.length; i++) {
    const landmark = landmarks[i];
    out[i] = [landmark.x * width, landmark.y * height, landmark.z * width];
  }
  return out;
}

export function mapAtlas(
  lines: AtlasLine[] | unknown,
  landmarksPx: Vec3[],
  triangles: Triangle[],
  options: MapAtlasOptions = {},
): MappedAtlasLine[] {
  const result: MappedAtlasLine[] = [];
  if (!Array.isArray(lines)) return result;
  const bridgeRanks = foreheadBridgeRanks(
    lines,
    landmarksPx,
    triangles,
    options.foreheadBridgeLineCount,
  );
  for (const line of lines) {
    if (line.region === FOREHEAD_BRIDGE_ARC_REGION
        && Number.isFinite(options.foreheadBridgeLineCount)
        && !bridgeRanks.has(line)) continue;
    const pts: Vec3[] = [];
    const tris: number[] = [];
    for (const point of line.points || []) {
      const tri = point[0];
      const u = point[1];
      const v = point[2];
      const w = 1 - u - v;
      const triangle = triangles[tri];
      if (!triangle) continue;
      const a = landmarksPx[triangle[0]];
      const b = landmarksPx[triangle[1]];
      const c = landmarksPx[triangle[2]];
      if (!a || !b || !c) continue;
      pts.push([
        u * a[0] + v * b[0] + w * c[0],
        u * a[1] + v * b[1] + w * c[1],
        u * a[2] + v * b[2] + w * c[2],
      ]);
      tris.push(tri);
    }
    const useLegacyForeheadExpansion = options.expandForehead !== false
      && line.region === FOREHEAD_LOWER_LONG_ARC_REGION
      && line.disableRuntimeExpansion !== true;
    const useBridgeExpansion = options.expandForehead !== false
      && line.region === FOREHEAD_BRIDGE_ARC_REGION
      && line.disableRuntimeExpansion !== true;
    let mappedPoints = pts;
    if (useLegacyForeheadExpansion) {
      mappedPoints = extendForeheadLowerLongArc(pts, landmarksPx);
    } else if (useBridgeExpansion) {
      mappedPoints = extendForeheadBridge(pts, landmarksPx, bridgeRanks.get(line) ?? 0);
    } else if (SUPRAORBITAL_SHORT_ARC_REGIONS_V67.has(line.region || "")) {
      mappedPoints = raiseSupraorbitalShortArc(
        pts,
        landmarksPx,
        SUPRAORBITAL_UPWARD_SHIFT_FACE_HEIGHT_V67,
      );
    } else if (line.region === SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V68) {
      mappedPoints = raiseSupraorbitalShortArc(
        pts,
        landmarksPx,
        SUPRAORBITAL_MEDIAL_UPWARD_SHIFT_FACE_HEIGHT_V68,
      );
    }
    mappedPoints = applyTemporalCubicFaceRatio(
      mappedPoints,
      landmarksPx,
      line.name || "",
      line.postMapTemporalCubicFaceRatio,
      line.postMapTemporalAbsoluteEndpoint === true,
      line.postMapTemporalBoundaryMarginFaceRatio ?? 0.02,
    );
    mappedPoints = applyPostExpansionOffsets(mappedPoints, line, landmarksPx);
    mappedPoints = smoothMappedCurve(mappedPoints, line.postMapSmoothingPasses ?? 0);
    if (line.postMapCubicFairing === true) {
      mappedPoints = fairMappedCurveCubic(mappedPoints);
    }
    result.push({ name: line.name || "unnamed_curve", region: line.region || "", pts: mappedPoints, tris });
  }
  if (Number.isFinite(options.foreheadBridgeLineCount)) {
    equalizeForeheadBridgeSpacing(
      result.filter((line) => line.region === FOREHEAD_BRIDGE_ARC_REGION),
      landmarksPx,
      options.foreheadBridgeBottomShiftFaceRatio,
    );
  }
  separateBrowTails(result, landmarksPx);
  // Extend the medial glabellar seed arcs only after every atlas line has
  // been mapped. This lets each candidate stop before the existing forehead
  // bridge or another RSTL line without changing the atlas source itself.
  for (let index = 0; index < result.length; index++) {
    const line = result[index];
    if (!MEDIAL_UPWARD_EXTENSION_REGIONS.has(line.region)) continue;
    const others = result.filter((_, otherIndex) => otherIndex !== index);
    const originalPoints = line.pts;
    const extendedPoints = extendMedialUpwardArc(
      originalPoints,
      landmarksPx,
      others,
      options.medialUpwardVisibleGapFaceRatio,
    );
    if (extendedPoints.length === originalPoints.length) continue;
    const firstTri = line.tris[0] ?? -1;
    const lastTri = line.tris.at(-1) ?? firstTri;
    const prepend = extendedPoints[0][0] !== originalPoints[0][0]
      || extendedPoints[0][1] !== originalPoints[0][1];
    const added = extendedPoints.length - originalPoints.length;
    line.tris = prepend
      ? Array.from({ length: added }, () => firstTri).concat(line.tris)
      : line.tris.concat(Array.from({ length: added }, () => lastTri));
    line.pts = extendedPoints;
  }
  // Apply after every extension so other lines retain exactly their old geometry.
  shortenShortBrowTips(result, landmarksPx);
  bringBrowTurnsMedially(result, landmarksPx);
  addLowerBrowBridgeSeed(result, landmarksPx);
  // Preserve the accepted bridge corridor while reducing the canthus spacing.
  const beforeCanthus = result.map(line => ({ ...line, pts: line.pts.map(p => [...p] as Vec3), tris: [...line.tris] }));
  regularizeCanthusArcs(result, 0.80);
  addLowerBrowBridge(result, landmarksPx);
  // Reduce the accepted 75% spacing by another 15%, keeping the middle arc fixed.
  regularizeCanthusArcs(beforeCanthus, 0.75 * 0.85);
  for (const side of ["left", "right"]) {
    const group = result.filter(line => line.region === "lateral_canthus_short_arc_v65" && line.name.endsWith(`_${side}`));
    const candidates = group.map(line => beforeCanthus.find(other => other.name === line.name)!);
    const blocked = candidates.some(candidate => result.filter(other => other.region === "brow_lower_bridge").some(other =>
      lineSegments(candidate.pts).some(segment => lineSegments(other.pts).some(edge => segmentsConflict(segment, edge, 0.75)))));
    if (!blocked) group.forEach((line, i) => { line.pts = candidates[i].pts; });
  }
  tightenBrowTemporalSpacing(result);
  lowerBrowTemporalBundles(result, landmarksPx);
  return result;
}

export function validateAtlasLines(
  atlasOrLines: AtlasPayload | AtlasLine[] | unknown,
  triangles: Triangle[],
  { expectedTopologyId, expectedTopologyVersion }: { expectedTopologyId?: string; expectedTopologyVersion?: string } = {},
): boolean {
  const atlas = atlasOrLines && typeof atlasOrLines === "object" && !Array.isArray(atlasOrLines)
    ? atlasOrLines as AtlasPayload
    : null;
  if (expectedTopologyId && atlas && (atlas.topologyId ?? TOPOLOGY_ID) !== expectedTopologyId) {
    return false;
  }
  if (expectedTopologyVersion && atlas && (atlas.topologyVersion ?? TOPOLOGY_VERSION) !== expectedTopologyVersion) {
    return false;
  }
  const lines = atlas ? atlas.lines : atlasOrLines;
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const triCount = Array.isArray(triangles) ? triangles.length : 0;
  for (const line of lines) {
    if (!line || !Array.isArray(line.points)) return false;
    for (const point of line.points) {
      if (!Array.isArray(point) || point.length < 3) return false;
      const tri = point[0];
      const u = point[1];
      const v = point[2];
      if (!Number.isInteger(tri) || tri < 0 || tri >= triCount) return false;
      if (!Number.isFinite(u) || !Number.isFinite(v)) return false;
    }
  }
  return true;
}

export function noseTriangles(triangles: Triangle[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < triangles.length; i++) {
    const triangle = triangles[i];
    if (triangle[0] === NOSE_TIP || triangle[1] === NOSE_TIP || triangle[2] === NOSE_TIP) out.push(i);
  }
  return out;
}

export const INNER_LIP = new Set<number>(INNER_LIP_IDX);

const innerMouthCache = new WeakMap<Triangle[], Set<number>>();

export function innerMouthTriangles(triangles: Triangle[]): Set<number> {
  let set = innerMouthCache.get(triangles);
  if (set) return set;
  set = new Set<number>();
  for (let i = 0; i < triangles.length; i++) {
    const triangle = triangles[i];
    let count = 0;
    if (INNER_LIP.has(triangle[0])) count++;
    if (INNER_LIP.has(triangle[1])) count++;
    if (INNER_LIP.has(triangle[2])) count++;
    if (count >= 2) set.add(i);
  }
  innerMouthCache.set(triangles, set);
  return set;
}

export function visibleTriangles(
  landmarksPx: Vec3[],
  triangles: Triangle[],
  noseTris: number[],
  threshold = DEFAULT_OCCLUSION_THRESHOLD,
  { minTriangleAreaPx2 = 0 }: VisibleTriangleOptions = {},
): Uint8Array {
  const count = triangles.length;
  const nz = new Float64Array(count);
  const degenerate = minTriangleAreaPx2 > 0 ? new Uint8Array(count) : null;
  for (let i = 0; i < count; i++) {
    const triangle = triangles[i];
    const a = landmarksPx[triangle[0]];
    const b = landmarksPx[triangle[1]];
    const c = landmarksPx[triangle[2]];
    if (!a || !b || !c) {
      if (degenerate) degenerate[i] = 1;
      continue;
    }
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    nz[i] = e1x * e2y - e1y * e2x;
    if (degenerate && Math.abs(nz[i]) < minTriangleAreaPx2) degenerate[i] = 1;
  }
  let ref = 0;
  if (noseTris.length) {
    for (const index of noseTris) ref += nz[index];
    ref /= noseTris.length;
  }
  const sign = ref >= 0 ? 1 : -1;
  const vis = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    vis[i] = (!degenerate || !degenerate[i]) && sign * nz[i] >= threshold ? 1 : 0;
  }
  return vis;
}

export function visibleRuns(pts: Vec3[], visMask: ArrayLike<number>): Vec3[][] {
  const runs: Vec3[][] = [];
  let cur: Vec3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const point = pts[i];
    if (visMask[i] && isFinite(point[0]) && isFinite(point[1])) {
      cur.push(point);
    } else {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}
