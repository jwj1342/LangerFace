export type Vec3 = [number, number, number];
export type Triangle = [number, number, number];

export interface SoftBodySpring {
  a: number;
  b: number;
  rest: number;
  k: number;
}

export interface SoftBody {
  N: number;
  springs: SoftBodySpring[];
  rest0: Vec3[];
  pos: Vec3[];
  vel: Vec3[];
  anchored: Uint8Array;
  removed: Uint8Array;
  tetherMask: Float32Array;
  stiffness: number;
  tether: number;
  damping: number;
  dt: number;
}

export interface BuildSoftBodyOptions {
  pretension?: number;
  aniso?: number;
  anchored?: Uint8Array;
  stiffness?: number;
  tether?: number;
  damping?: number;
  dt?: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const norm = (v: Vec3): Vec3 => {
  const length = len(v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

export function buildSoftBody(
  verts: Vec3[],
  faces: Triangle[],
  dirField?: Vec3[] | null,
  opts: BuildSoftBodyOptions = {},
): SoftBody {
  const pretension = opts.pretension ?? 0.12;
  const aniso = opts.aniso ?? 8;
  const count = verts.length;
  const seen = new Set<number>();
  const springs: SoftBodySpring[] = [];
  const addEdge = (a: number, b: number) => {
    const key = a < b ? a * count + b : b * count + a;
    if (seen.has(key)) return;
    seen.add(key);
    const L0 = len(sub(verts[a], verts[b]));
    if (L0 < 1e-9) return;
    const dir = norm(sub(verts[b], verts[a]));
    const rstlDir = dirField ? dirField[a] : null;
    const align = rstlDir ? Math.abs(dir[0] * rstlDir[0] + dir[1] * rstlDir[1] + dir[2] * rstlDir[2]) : 0;
    springs.push({ a, b, rest: L0 * (1 - pretension), k: 1 + (aniso - 1) * align });
  };
  for (const face of faces) {
    addEdge(face[0], face[1]);
    addEdge(face[1], face[2]);
    addEdge(face[2], face[0]);
  }
  return {
    N: count,
    springs,
    rest0: verts.map((point) => point.slice() as Vec3),
    pos: verts.map((point) => point.slice() as Vec3),
    vel: verts.map(() => [0, 0, 0] as Vec3),
    anchored: opts.anchored || new Uint8Array(count),
    removed: new Uint8Array(count),
    tetherMask: new Float32Array(count).fill(1),
    stiffness: opts.stiffness ?? 0.2,
    tether: opts.tether ?? 0.15,
    damping: opts.damping ?? 0.9,
    dt: opts.dt ?? 0.5,
  };
}

export function stepSoftBody(sb: SoftBody, iters = 1): void {
  const dt = sb.dt;
  for (let iter = 0; iter < iters; iter++) {
    const force = sb.pos.map(() => [0, 0, 0] as Vec3);
    for (const spring of sb.springs) {
      if (sb.removed[spring.a] || sb.removed[spring.b]) continue;
      const pa = sb.pos[spring.a];
      const pb = sb.pos[spring.b];
      const delta = sub(pb, pa);
      const length = len(delta) || 1e-9;
      const f = sb.stiffness * spring.k * (length - spring.rest) / length;
      for (let x = 0; x < 3; x++) {
        const fx = f * delta[x];
        force[spring.a][x] += fx;
        force[spring.b][x] -= fx;
      }
    }
    for (let i = 0; i < sb.N; i++) {
      const tether = sb.tether * sb.tetherMask[i];
      if (tether === 0) continue;
      const rest = sb.rest0[i];
      const point = sb.pos[i];
      force[i][0] += tether * (rest[0] - point[0]);
      force[i][1] += tether * (rest[1] - point[1]);
      force[i][2] += tether * (rest[2] - point[2]);
    }
    for (let i = 0; i < sb.N; i++) {
      if (sb.anchored[i] || sb.removed[i]) {
        sb.vel[i][0] = 0;
        sb.vel[i][1] = 0;
        sb.vel[i][2] = 0;
        continue;
      }
      for (let x = 0; x < 3; x++) {
        sb.vel[i][x] = (sb.vel[i][x] + force[i][x] * dt) * sb.damping;
        sb.pos[i][x] += sb.vel[i][x] * dt;
      }
    }
  }
}

export function boundaryVerts(faces: Triangle[], count: number): Uint8Array {
  const edgeCounts = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * count + b : b * count + a);
  for (const face of faces) {
    for (const [a, b] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]] as Array<[number, number]>) {
      const edgeKey = key(a, b);
      edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) || 0) + 1);
    }
  }
  const anchored = new Uint8Array(count);
  for (const face of faces) {
    for (const [a, b] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]] as Array<[number, number]>) {
      if (edgeCounts.get(key(a, b)) === 1) {
        anchored[a] = 1;
        anchored[b] = 1;
      }
    }
  }
  return anchored;
}

export function excise(
  sb: SoftBody,
  verts: Vec3[],
  center: Vec3,
  axis: Vec3,
  la: number,
  lb: number,
  release = la * 3,
): number {
  const ax = norm(axis);
  let removed = 0;
  for (let i = 0; i < sb.N; i++) {
    const delta = sub(verts[i], center);
    const along = delta[0] * ax[0] + delta[1] * ax[1] + delta[2] * ax[2];
    const perp = len([
      delta[0] - along * ax[0],
      delta[1] - along * ax[1],
      delta[2] - along * ax[2],
    ]);
    if ((along * along) / (la * la) + (perp * perp) / (lb * lb) <= 1) {
      sb.removed[i] = 1;
      removed++;
    } else {
      const r = len(delta) / release;
      sb.tetherMask[i] = Math.min(sb.tetherMask[i], Math.max(0, Math.min(1, (r - 0.4) / 0.6)));
    }
  }
  return removed;
}

export function vertexTension(sb: SoftBody, closureAxis: Vec3 | null = null): Float64Array {
  const tension = new Float64Array(sb.N);
  const weights = new Float64Array(sb.N);
  for (const spring of sb.springs) {
    if (sb.removed[spring.a] || sb.removed[spring.b]) continue;
    const delta = sub(sb.pos[spring.b], sb.pos[spring.a]);
    const length = len(delta) || 1e-9;
    const force = spring.k * Math.abs(length - spring.rest) / spring.rest;
    let weight = 1;
    if (closureAxis) {
      const align = Math.abs((delta[0] * closureAxis[0] + delta[1] * closureAxis[1] + delta[2] * closureAxis[2]) / length);
      weight = align * align;
    }
    tension[spring.a] += force * weight;
    weights[spring.a] += weight;
    tension[spring.b] += force * weight;
    weights[spring.b] += weight;
  }
  for (let i = 0; i < sb.N; i++) tension[i] = weights[i] ? tension[i] / weights[i] : 0;
  return tension;
}
