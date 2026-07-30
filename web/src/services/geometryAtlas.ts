import {
  DEFAULT_OCCLUSION_THRESHOLD,
  INNER_LIP as INNER_LIP_IDX,
  NOSE_TIP,
  TOPOLOGY_ID,
  TOPOLOGY_VERSION,
} from "./constantsGenerated.ts";
import type { Triangle, Vec3 } from "./softBody";

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
  points?: AtlasPoint[];
}

export interface AtlasPayload {
  topologyId?: string;
  topologyVersion?: string;
  lines?: AtlasLine[];
}

export interface MappedAtlasLine {
  name?: string;
  /** 显示期需要按 region 决定后处理（额头外推线要额外裁剪，见 #141）。 */
  region: string;
  pts: Vec3[];
  tris: number[];
}

export interface VisibleTriangleOptions {
  minTriangleAreaPx2?: number;
}

const FOREHEAD_BRIDGE_ARC_REGION = "forehead_bridge_arc_v15";

function foreheadBridgeRanks(
  lines: AtlasLine[],
  landmarksPx: Vec3[],
  triangles: Triangle[],
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
  const denominator = Math.max(bridgeLines.length - 1, 1);
  return new Map(bridgeLines.map((line, index) => [line, index / denominator]));
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
  return out;
}

export function toPixels(landmarks: NormalizedLandmark[], width: number, height: number): Vec3[] {
  const out = new Array<Vec3>(landmarks.length);
  for (let i = 0; i < landmarks.length; i++) {
    const landmark = landmarks[i];
    out[i] = [landmark.x * width, landmark.y * height, landmark.z * width];
  }
  return out;
}

export function mapAtlas(lines: AtlasLine[] | unknown, landmarksPx: Vec3[], triangles: Triangle[]): MappedAtlasLine[] {
  const result: MappedAtlasLine[] = [];
  if (!Array.isArray(lines)) return result;
  const bridgeRanks = foreheadBridgeRanks(lines, landmarksPx, triangles);
  for (const line of lines) {
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
    const mappedPoints = line.region === FOREHEAD_BRIDGE_ARC_REGION
      ? extendForeheadBridge(pts, landmarksPx, bridgeRanks.get(line) ?? 0)
      : pts;
    result.push({ name: line.name, region: line.region || "", pts: mappedPoints, tris });
  }
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
