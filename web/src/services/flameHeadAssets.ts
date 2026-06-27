import { loadArrayBufferAsset, type AssetLoadOptions } from "./assetLoader.ts";
import { basisFromBuffer, facesArray, flameForward, type FlameBasis } from "./flameFit.ts";
import { applySim, umeyama } from "./geometryTransform.ts";
import type { AtlasPayload, HeadMeshPayload } from "./dataSource.ts";
import type { Triangle, Vec3 } from "./softBody.ts";

type AnyRecord = Record<string, any>;

type FlameAtlasLine = {
  name?: string;
  region?: string;
  points3d: Vec3[];
  source_topology_id?: string;
  source_topology_version?: string;
};

interface TriangleGrid {
  buckets: Map<string, number[]>;
  cell: number;
  lo: Vec3;
  center: Vec3;
  eps: number;
  key: (ix: number, iy: number, iz: number) => string;
  idx: (p: Vec3) => [number, number, number];
}

let flameBasisPromise: Promise<FlameBasis> | null = null;

export function loadFlameBasisAsset(options: AssetLoadOptions = {}): Promise<FlameBasis> {
  if (!flameBasisPromise) {
    flameBasisPromise = loadArrayBufferAsset("flameBasis", {
      label: options.label || "FLAME basis",
      onProgress: options.onProgress,
    })
      .then((buffer) => basisFromBuffer(buffer))
      .catch((error) => {
        flameBasisPromise = null;
        throw error;
      });
  }
  return flameBasisPromise;
}

export function flameNeutralVertices(basis: FlameBasis): Vec3[] {
  return flameForward(basis, new Float64Array(basis.NS), new Float64Array(basis.NE), 0);
}

export function flameHeadMeshFromBasis(basis: FlameBasis): Pick<HeadMeshPayload, "vertices" | "verts" | "triangles" | "tris" | "topology"> {
  const vertices = flameNeutralVertices(basis);
  const triangles = facesArray(basis);
  const topology = {
    topologyId: "flame-2023",
    topologyVersion: "flame-2023-v1",
    vertexCount: basis.NV,
    triangleCount: basis.NF,
    source: "flame_basis.bin",
    triangles,
  };
  return {
    topology,
    vertices,
    verts: vertices,
    triangles,
    tris: triangles,
  };
}

function sampleFlameLandmarkPairs(verts: Vec3[], basis: FlameBasis, canonical: Vec3[]): { src: Vec3[]; dst: Vec3[] } {
  const src: Vec3[] = [];
  const dst: Vec3[] = [];
  for (let i = 0; i < basis.NL; i += 1) {
    const idx = basis.landmarkIndices[i];
    if (idx >= canonical.length) continue;
    const face = basis.lmkFaceIdx[i];
    const a = basis.faces[face * 3];
    const b = basis.faces[face * 3 + 1];
    const c = basis.faces[face * 3 + 2];
    const w0 = basis.lmkBCoords[i * 3];
    const w1 = basis.lmkBCoords[i * 3 + 1];
    const w2 = basis.lmkBCoords[i * 3 + 2];
    src.push(canonical[idx]);
    dst.push([
      w0 * verts[a][0] + w1 * verts[b][0] + w2 * verts[c][0],
      w0 * verts[a][1] + w1 * verts[b][1] + w2 * verts[c][1],
      w0 * verts[a][2] + w1 * verts[b][2] + w2 * verts[c][2],
    ]);
  }
  return { src, dst };
}

const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vscale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vnorm = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const dist2 = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
};

function closestPointOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = vsub(b, a);
  const ac = vsub(c, a);
  const ap = vsub(p, a);
  const d1 = vdot(ab, ap);
  const d2 = vdot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;

  const bp = vsub(p, b);
  const d3 = vdot(ab, bp);
  const d4 = vdot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return vadd(a, vscale(ab, d1 / (d1 - d3)));

  const cp = vsub(p, c);
  const d5 = vdot(ab, cp);
  const d6 = vdot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return vadd(a, vscale(ac, d2 / (d2 - d6)));

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    return vadd(b, vscale(vsub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return vadd(a, vadd(vscale(ab, v), vscale(ac, w)));
}

function buildTriangleGrid(verts: Vec3[], faces: Triangle[]): TriangleGrid {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const center: Vec3 = [0, 0, 0];
  for (const point of verts) {
    for (let axis = 0; axis < 3; axis += 1) {
      lo[axis] = Math.min(lo[axis], point[axis]);
      hi[axis] = Math.max(hi[axis], point[axis]);
      center[axis] += point[axis] / verts.length;
    }
  }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const cell = size / 28;
  const key = (ix: number, iy: number, iz: number): string => `${ix},${iy},${iz}`;
  const idx = (p: Vec3): [number, number, number] => [
    Math.floor((p[0] - lo[0]) / cell),
    Math.floor((p[1] - lo[1]) / cell),
    Math.floor((p[2] - lo[2]) / cell),
  ];
  const buckets = new Map<string, number[]>();
  faces.forEach((face, faceIndex) => {
    const a = verts[face[0]];
    const b = verts[face[1]];
    const c = verts[face[2]];
    const min: Vec3 = [
      Math.min(a[0], b[0], c[0]),
      Math.min(a[1], b[1], c[1]),
      Math.min(a[2], b[2], c[2]),
    ];
    const max: Vec3 = [
      Math.max(a[0], b[0], c[0]),
      Math.max(a[1], b[1], c[1]),
      Math.max(a[2], b[2], c[2]),
    ];
    const start = idx(min);
    const end = idx(max);
    for (let x = start[0]; x <= end[0]; x += 1) {
      for (let y = start[1]; y <= end[1]; y += 1) {
        for (let z = start[2]; z <= end[2]; z += 1) {
          const bucketKey = key(x, y, z);
          if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
          buckets.get(bucketKey)!.push(faceIndex);
        }
      }
    }
  });
  return { buckets, cell, lo, center, eps: size * 0.003, key, idx };
}

function snapPointToMesh(point: Vec3, verts: Vec3[], faces: Triangle[], grid: TriangleGrid): Vec3 {
  const base = grid.idx(point);
  let candidates: number[] = [];
  for (let radius = 0; radius <= 3 && candidates.length === 0; radius += 1) {
    const seen = new Set<number>();
    for (let x = base[0] - radius; x <= base[0] + radius; x += 1) {
      for (let y = base[1] - radius; y <= base[1] + radius; y += 1) {
        for (let z = base[2] - radius; z <= base[2] + radius; z += 1) {
          for (const faceIndex of grid.buckets.get(grid.key(x, y, z)) || []) {
            if (!seen.has(faceIndex)) {
              seen.add(faceIndex);
              candidates.push(faceIndex);
            }
          }
        }
      }
    }
  }
  if (!candidates.length) candidates = faces.map((_face, index) => index);

  let best: Vec3 = point;
  let bestNormal: Vec3 = [0, 0, 1];
  let bestDistance = Infinity;
  for (const faceIndex of candidates) {
    const face = faces[faceIndex];
    const a = verts[face[0]];
    const b = verts[face[1]];
    const c = verts[face[2]];
    const projected = closestPointOnTriangle(point, a, b, c);
    const distance = dist2(point, projected);
    if (distance < bestDistance) {
      best = projected;
      bestNormal = vnorm(vcross(vsub(b, a), vsub(c, a)));
      bestDistance = distance;
    }
  }
  if (vdot(bestNormal, vsub(best, grid.center)) < 0) bestNormal = vscale(bestNormal, -1);
  return vadd(best, vscale(bestNormal, grid.eps));
}

function mediaPipeAtlasPointToPoint3d(
  raw: [number, number, number],
  verts: Vec3[],
  triangles: Triangle[],
): Vec3 | null {
  const [tri, u, v] = raw;
  const triangle = triangles[Math.round(tri)];
  if (!triangle) return null;
  const w = 1 - u - v;
  const a = verts[triangle[0]];
  const b = verts[triangle[1]];
  const c = verts[triangle[2]];
  if (!a || !b || !c) return null;
  return [
    u * a[0] + v * b[0] + w * c[0],
    u * a[1] + v * b[1] + w * c[1],
    u * a[2] + v * b[2] + w * c[2],
  ];
}

export function mediaPipeAtlasToFlamePreviewAtlas({
  atlas,
  mediaPipeHead,
  flameHead,
  basis,
}: {
  atlas: AtlasPayload;
  mediaPipeHead: HeadMeshPayload;
  flameHead: HeadMeshPayload;
  basis: FlameBasis;
}): AtlasPayload {
  const { src, dst } = sampleFlameLandmarkPairs(flameHead.vertices, basis, mediaPipeHead.vertices);
  if (src.length < 3 || dst.length < 3) throw new Error("FLAME 预览图谱转换缺少足够的 MediaPipe/FLAME landmark 对");
  const sim = umeyama(src, dst);
  const grid = buildTriangleGrid(flameHead.vertices, flameHead.triangles);
  const sourceLines = Array.isArray(atlas.lines) ? atlas.lines as AnyRecord[] : [];
  const lines: FlameAtlasLine[] = sourceLines.map((line) => {
    const rawPoints = (line.points || [])
      .map((raw: [number, number, number]) => mediaPipeAtlasPointToPoint3d(raw, mediaPipeHead.vertices, mediaPipeHead.triangles))
      .filter((point: Vec3 | null): point is Vec3 => Boolean(point));
    const points3d = applySim(sim, rawPoints).map((point) => snapPointToMesh(point, flameHead.vertices, flameHead.triangles, grid));
    return {
      name: line.name,
      region: line.region,
      points3d,
      source_topology_id: mediaPipeHead.topologyId,
      source_topology_version: mediaPipeHead.topologyVersion,
    };
  });
  return {
    ...atlas,
    schema_version: "rstl-flame-preview-atlas/v0.1",
    system: atlas.system || "rstl",
    topologyId: flameHead.topologyId,
    topologyVersion: flameHead.topologyVersion,
    sourceTopologyId: mediaPipeHead.topologyId,
    sourceTopologyVersion: mediaPipeHead.topologyVersion,
    validated: false,
    review_status: "draft_not_clinically_validated",
    mapping_mode: "mediapipe_468_rstl_to_flame_neutral_nearest_surface_preview",
    clinical_boundary: "FLAME RSTL lines are a research preview derived from the MediaPipe RSTL draft, not a clinically validated FLAME atlas.",
    lines,
  };
}
