import { buildMediaPipeEngineeringExclusionZones } from "./incisionToolCore.ts";
import type { Vec3 } from "./softBody.ts";

export interface PhotoOpeningReference {
  vertices: readonly Vec3[];
  triangles: readonly (readonly number[])[];
}
type Binding = { indices: readonly number[]; weights: number[] };
type BoundZone = { id: string; bindings: Binding[] };
// 标准网格在本次加载期间不变。只缓存标准面上的绑定，不缓存照片坐标。
const referenceCache = new WeakMap<PhotoOpeningReference["vertices"], {
  triangles: PhotoOpeningReference["triangles"];
  zones: BoundZone[] | null;
}>();

function bindReference(reference: PhotoOpeningReference): BoundZone[] | null {
  const { vertices, triangles } = reference;
  if (vertices.length !== 468 || triangles.length === 0
    || vertices.some(p => p.length < 3 || !p.every(Number.isFinite))) return null;
  const low = [0, 1].map(k => Math.min(...vertices.map(p => p[k])));
  const span = [0, 1].map(k => Math.max(...vertices.map(p => p[k])) - low[k]);
  if (span.some(s => !(s > 1e-9))) return null;
  const masks = buildMediaPipeEngineeringExclusionZones([...vertices])
    .filter(z => String(z.id).includes("nostril-opening"));
  if (masks.length !== 2) return null;
  const zones: BoundZone[] = [];
  for (const mask of masks) {
    const bindings: Binding[] = [];
    for (const p of mask.polygon as number[][]) {
      // 原标准模型Y向上；这里保持原掩膜原样，不能套照片bbox或再次翻Y。
      const x = low[0] + p[0] * span[0], y = low[1] + p[1] * span[1];
      let best: (Binding & { depth: number }) | null = null;
      for (const indices of triangles) {
        if (indices.length !== 3 || indices.some(i => !Number.isInteger(i) || !vertices[i])) return null;
        const [a, b, c] = indices.map(i => vertices[i]);
        const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(denominator) < 1e-10) continue;
        const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
        const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
        const weights = [u, v, 1 - u - v];
        if (Math.min(...weights) < -1e-7) continue;
        const depth = weights.reduce((sum, weight, k) => sum + weight * vertices[indices[k]][2], 0);
        // XY投影可能重叠，选择Z最大的正面三角形，与原型验证一致。
        if (!best || depth > best.depth) best = { indices, weights, depth };
      }
      if (!best) return null;
      bindings.push({ indices: best.indices, weights: best.weights });
    }
    zones.push({ id: String(mask.id), bindings });
  }
  return zones;
}

/** 把标准鼻孔工程禁区随同编号的人脸三角形投到照片；不是鼻孔分割或医学安全距离。 */
export function projectPhotoNostrilZones(
  photoLandmarks: readonly Vec3[], reference: PhotoOpeningReference,
): { id: string; polygon: [number, number][] }[] | null {
  if (photoLandmarks.length < 468) return null;
  let cached = referenceCache.get(reference.vertices);
  if (!cached || cached.triangles !== reference.triangles) {
    cached = { triangles: reference.triangles, zones: bindReference(reference) };
    referenceCache.set(reference.vertices, cached);
  }
  if (!cached.zones) return null;
  const zones = [];
  for (const zone of cached.zones) {
    const polygon: [number, number][] = [];
    for (const binding of zone.bindings) {
      const points = binding.indices.map(i => photoLandmarks[i]);
      if (points.some(p => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
      polygon.push([0, 1].map(k => points.reduce((sum, p, j) => sum + p[k] * binding.weights[j], 0)) as [number, number]);
    }
    const area2 = polygon.reduce((sum, p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0);
    // 退化投影无法证明安全，交调用方保留阻断，不能以空禁区放行。
    if (!Number.isFinite(area2) || Math.abs(area2) < 1e-6) return null;
    zones.push({ id: zone.id, polygon });
  }
  return zones;
}
