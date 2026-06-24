// 表面质点-弹簧软体：手术「切除 → 闭合」demo 的物理核心。纯函数、可 Node 单测。
// 模型（demo 级，非 FEM）：全局**预张力**让皮肤收缩（切出的洞会自动合）；**各向异性刚度** ——
// 沿 RSTL 方向硬（皮肤沿松弛线张力高、延展性低），垂直 RSTL 方向软。于是切口长轴**沿线**时，闭合
// 是把"垂直 RSTL 的软皮肤"拉过来 → 残余张力低（平和）；长轴**逆线**时要拉"沿 RSTL 的硬皮肤"→ 张力高（绷紧）。
// 这正是临床「切口顺皮纹」的力学根据。严谨性后置（真实软组织要体网格 FEM）；这里只为"跑通 + 演出 RSTL 张力差异"。

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// dirField: 每顶点的 RSTL 单位切向（rstl_field.js 产出）；anchored: Uint8Array 标记固定顶点。
export function buildSoftBody(verts, faces, dirField, opts = {}) {
  const PRE = opts.pretension ?? 0.12;   // 预张力：弹簧 rest = (1-PRE)·L0 → 皮肤整体收缩
  const ANISO = opts.aniso ?? 8;         // 沿 RSTL 的刚度倍数（沿线=ANISO 硬，垂直=1 软）
  const N = verts.length;
  const seen = new Set(), springs = [];
  const addEdge = (a, b) => {
    const k = a < b ? a * N + b : b * N + a;
    if (seen.has(k)) return; seen.add(k);
    const L0 = len(sub(verts[a], verts[b]));
    if (L0 < 1e-9) return;
    const dir = norm(sub(verts[b], verts[a]));
    const rd = dirField ? dirField[a] : null;
    const align = rd ? Math.abs(dir[0] * rd[0] + dir[1] * rd[1] + dir[2] * rd[2]) : 0;  // 1 沿线 / 0 垂直
    springs.push({ a, b, rest: L0 * (1 - PRE), k: 1 + (ANISO - 1) * align });
  };
  for (const f of faces) { addEdge(f[0], f[1]); addEdge(f[1], f[2]); addEdge(f[2], f[0]); }
  return {
    N, springs,
    rest0: verts.map((p) => p.slice()),                 // 静息位（皮肤系于深层组织）
    pos: verts.map((p) => p.slice()), vel: verts.map(() => [0, 0, 0]),
    anchored: opts.anchored || new Uint8Array(N), removed: new Uint8Array(N),
    tetherMask: new Float32Array(N).fill(1),            // 系泊强度倍率：切除时在伤口周围"游离"(置0)→ 才能闭合
    stiffness: opts.stiffness ?? 0.2, tether: opts.tether ?? 0.15,
    damping: opts.damping ?? 0.9, dt: opts.dt ?? 0.5,
  };
}

export function stepSoftBody(sb, iters = 1) {
  const dt = sb.dt;
  for (let it = 0; it < iters; it++) {
    const force = sb.pos.map(() => [0, 0, 0]);
    for (const s of sb.springs) {
      if (sb.removed[s.a] || sb.removed[s.b]) continue;
      const pa = sb.pos[s.a], pb = sb.pos[s.b];
      const d = sub(pb, pa), L = len(d) || 1e-9;
      const f = sb.stiffness * s.k * (L - s.rest) / L;  // L>rest → 拉近（收缩）
      for (let x = 0; x < 3; x++) { const fx = f * d[x]; force[s.a][x] += fx; force[s.b][x] -= fx; }
    }
    for (let i = 0; i < sb.N; i++) {                     // 系泊力：把皮肤拉回静息位 → 全局稳定、仅游离区形变
      const t = sb.tether * sb.tetherMask[i];
      if (t === 0) continue;
      const r = sb.rest0[i], p = sb.pos[i];
      force[i][0] += t * (r[0] - p[0]); force[i][1] += t * (r[1] - p[1]); force[i][2] += t * (r[2] - p[2]);
    }
    for (let i = 0; i < sb.N; i++) {
      if (sb.anchored[i] || sb.removed[i]) { sb.vel[i][0] = sb.vel[i][1] = sb.vel[i][2] = 0; continue; }
      for (let x = 0; x < 3; x++) { sb.vel[i][x] = (sb.vel[i][x] + force[i][x] * dt) * sb.damping; sb.pos[i][x] += sb.vel[i][x] * dt; }
    }
  }
}

// 网格边界顶点（只属于 1 个三角形的边的端点）——固定它们，让面壳不整体漂移、只伤口区域形变。
export function boundaryVerts(faces, N) {
  const count = new Map();
  const key = (a, b) => (a < b ? a * N + b : b * N + a);
  for (const f of faces) for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
    const k = key(a, b); count.set(k, (count.get(k) || 0) + 1);
  }
  const anchored = new Uint8Array(N);
  for (const f of faces) for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
    if (count.get(key(a, b)) === 1) { anchored[a] = 1; anchored[b] = 1; }
  }
  return anchored;
}

// 椭圆切除：移除中心 center、沿 axis(单位)半长 la / 垂直半宽 lb 的椭圆内顶点；并在半径 release 内
// "游离"皮肤（降低系泊）使其能被预张力拉合。返回移除数。
export function excise(sb, verts, center, axis, la, lb, release = la * 3) {
  const ax = norm(axis);
  let n = 0;
  for (let i = 0; i < sb.N; i++) {
    const d = sub(verts[i], center);
    const along = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
    const perp = len([d[0] - along * ax[0], d[1] - along * ax[1], d[2] - along * ax[2]]);
    if ((along * along) / (la * la) + (perp * perp) / (lb * lb) <= 1) { sb.removed[i] = 1; n++; }
    else { // 游离带：中心附近系泊→0，到 release 处恢复为 1（平滑过渡）
      const r = len(d) / release;
      sb.tetherMask[i] = Math.min(sb.tetherMask[i], Math.max(0, Math.min(1, (r - 0.4) / 0.6)));
    }
  }
  return n;
}

// 每顶点张力，度量的是**弹力**（force ∝ 刚度 k × 应变），不是单纯应变——闭合位移是几何决定的，
// 同样的应变下，软弹簧出的力远小于硬弹簧。这样"跨伤口瘢痕张力"才能稳健区分：
// 顺皮纹闭合拉的是垂直 RSTL 的软皮肤（k≈1）→ 力低；逆皮纹拉的是沿 RSTL 的硬皮肤（k≈ANISO）→ 力高。
// 传 closureAxis（伤口短轴/闭合方向）时，只统计与该轴对齐的弹簧（真正承担闭合张力的那些）。
export function vertexTension(sb, closureAxis = null) {
  const t = new Float64Array(sb.N), c = new Float64Array(sb.N);
  for (const s of sb.springs) {
    if (sb.removed[s.a] || sb.removed[s.b]) continue;
    const d = sub(sb.pos[s.b], sb.pos[s.a]), L = len(d) || 1e-9;
    const force = s.k * Math.abs(L - s.rest) / s.rest;   // 弹力 ∝ k×应变
    let w = 1;
    if (closureAxis) {
      const al = Math.abs((d[0] * closureAxis[0] + d[1] * closureAxis[1] + d[2] * closureAxis[2]) / L);
      w = al * al;                                        // 方向权重不含 k → 输出随 k 增大（保留力的量纲）
    }
    t[s.a] += force * w; c[s.a] += w; t[s.b] += force * w; c[s.b] += w;
  }
  for (let i = 0; i < sb.N; i++) t[i] = c[i] ? t[i] / c[i] : 0;
  return t;
}
