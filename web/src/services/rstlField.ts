import type { Triangle, Vec3 } from "./softBody";

export interface RstlAtlasLine {
  points?: Array<[number, number, number]>;
  points3d?: Vec3[];
}

export interface RstlAtlas {
  lines?: RstlAtlasLine[];
}

function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function barycentricPoint(verts: Vec3[], tris: Triangle[], [tri, u, v]: [number, number, number]): Vec3 {
  const t = tris[tri] || [0, 0, 0];
  const w = 1 - u - v;
  const a = verts[t[0]];
  const b = verts[t[1]];
  const c = verts[t[2]];
  return [
    u * a[0] + v * b[0] + w * c[0],
    u * a[1] + v * b[1] + w * c[1],
    u * a[2] + v * b[2] + w * c[2],
  ];
}

export function rstlDirField(verts: Vec3[], tris: Triangle[], atlas: RstlAtlas): Vec3[] {
  const points: Vec3[] = [];
  const tangents: Vec3[] = [];
  for (const line of atlas.lines || []) {
    const linePoints = (line.points || []).map((point) => barycentricPoint(verts, tris, point));
    for (let i = 0; i < linePoints.length; i++) {
      const a = linePoints[Math.max(0, i - 1)];
      const b = linePoints[Math.min(linePoints.length - 1, i + 1)];
      points.push(linePoints[i]);
      tangents.push(normalizeVec3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
    }
  }
  const field = new Array<Vec3>(verts.length);
  for (let i = 0; i < verts.length; i++) {
    let best = 0;
    let bestDistance = Infinity;
    for (let j = 0; j < points.length; j++) {
      const dx = verts[i][0] - points[j][0];
      const dy = verts[i][1] - points[j][1];
      const dz = verts[i][2] - points[j][2];
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = j;
      }
    }
    field[i] = points.length ? tangents[best] : [1, 0, 0];
  }
  return field;
}
