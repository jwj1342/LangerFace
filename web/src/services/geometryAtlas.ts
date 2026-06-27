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
  points?: AtlasPoint[];
}

export interface AtlasPayload {
  topologyId?: string;
  topologyVersion?: string;
  lines?: AtlasLine[];
}

export interface MappedAtlasLine {
  name?: string;
  pts: Vec3[];
  tris: number[];
}

export interface VisibleTriangleOptions {
  minTriangleAreaPx2?: number;
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
    result.push({ name: line.name, pts, tris });
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
