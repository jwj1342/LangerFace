// 几何核心：Python 端 mapping/occlusion/smoothing 的忠实 JS 移植。
// 纯函数、无 DOM，可同时在浏览器与 Node 下运行（Node 用于离线对拍验证）。

import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.js";

export const NOSE_TIP = 1; // MediaPipe 鼻尖关键点索引

// 关键点（归一化 x,y in [0,1], z）→ 图像像素 (x*W, y*H, z*W)
export function toPixels(landmarks, W, H) {
  const out = new Array(landmarks.length);
  for (let i = 0; i < landmarks.length; i++) {
    const l = landmarks[i];
    out[i] = [l.x * W, l.y * H, l.z * W];
  }
  return out;
}

// 图谱 → 图像空间（分片仿射 / 重心插值变形）。与 Python map_atlas 一致。
// lines: [{name, points:[[tri,u,v],...]}], landmarksPx:[[x,y,z]...], triangles:[[i0,i1,i2]...]
export function mapAtlas(lines, landmarksPx, triangles) {
  const result = [];
  if (!Array.isArray(lines)) return result;   // 注入空/坏图谱时不让 for...of 抛错崩掉整帧
  for (const ln of lines) {
    const pts = [];
    const tris = [];
    for (const p of ln.points) {
      const tri = p[0], u = p[1], v = p[2], w = 1 - u - v;
      const t = triangles[tri];
      if (!t) continue;                          // 越界三角面：跳过该点而非崩溃整帧
      const a = landmarksPx[t[0]], b = landmarksPx[t[1]], c = landmarksPx[t[2]];
      if (!a || !b || !c) continue;              // 关键点缺失：跳过该点
      pts.push([
        u * a[0] + v * b[0] + w * c[0],
        u * a[1] + v * b[1] + w * c[1],
        u * a[2] + v * b[2] + w * c[2],
      ]);
      tris.push(tri);
    }
    result.push({ name: ln.name, pts, tris });
  }
  return result;
}

// 注入预览前的最小边界校验：判断一份图谱线集合能否安全喂给 mapAtlas，
// 避免医生画的内存图谱里出现越界三角面 / 非法重心坐标而让渲染循环抛错黑屏。
// 要求：非空数组；每条线 points 为数组；每点 [tri,u,v] 的 tri 为 triangles 内合法整数、u/v 有限。
export function validateAtlasLines(atlasOrLines, triangles, { expectedTopologyId, expectedTopologyVersion } = {}) {
  const atlas = atlasOrLines && typeof atlasOrLines === "object" && !Array.isArray(atlasOrLines)
    ? atlasOrLines
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
  for (const ln of lines) {
    if (!ln || !Array.isArray(ln.points)) return false;
    for (const p of ln.points) {
      if (!Array.isArray(p) || p.length < 3) return false;
      const tri = p[0], u = p[1], v = p[2];
      if (!Number.isInteger(tri) || tri < 0 || tri >= triCount) return false;
      if (!Number.isFinite(u) || !Number.isFinite(v)) return false;
    }
  }
  return true;
}

// 预计算包含鼻尖的三角面索引
export function noseTriangles(triangles) {
  const out = [];
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    if (t[0] === NOSE_TIP || t[1] === NOSE_TIP || t[2] === NOSE_TIP) out.push(i);
  }
  return out;
}

// 内唇关键点集合（上唇下缘 + 下唇上缘 + 口角）。三个顶点全在此集合内的三角面
// 横跨口裂：闭口时近乎退化、张嘴时拉开横跨口腔空洞，落在其上的图谱点会跳进口内/牙齿。
// 单一事实来源：与 Python src/langerface/config/constants.py 的 INNER_LIP 一致（见 #38）。
export const INNER_LIP = new Set([78, 80, 88, 95, 191, 308, 310, 318, 324, 415]);

// 预计算「≥2 个顶点属于 INNER_LIP」的口裂三角面索引集合（渲染期据此排除）。
// 按 triangles 数组引用 memoize：拓扑全程不变，故只在首帧计算一次，不必每帧重算。
const _innerMouthCache = new WeakMap();
export function innerMouthTriangles(triangles) {
  let s = _innerMouthCache.get(triangles);
  if (s) return s;
  s = new Set();
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    let n = 0;
    if (INNER_LIP.has(t[0])) n++;
    if (INNER_LIP.has(t[1])) n++;
    if (INNER_LIP.has(t[2])) n++;
    if (n >= 2) s.add(i);
  }
  _innerMouthCache.set(triangles, s);
  return s;
}

// 背面剔除：返回 Uint8Array(每个三角面是否朝向相机)。与 Python BackfaceCuller 一致。
export function visibleTriangles(landmarksPx, triangles, noseTris, threshold = -0.05) {
  const M = triangles.length;
  const nz = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const t = triangles[i];
    const a = landmarksPx[t[0]], b = landmarksPx[t[1]], c = landmarksPx[t[2]];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    nz[i] = e1x * e2y - e1y * e2x; // cross(e1,e2).z
  }
  let ref = 0;
  if (noseTris.length) {
    for (const i of noseTris) ref += nz[i];
    ref /= noseTris.length;
  }
  const sign = ref >= 0 ? 1 : -1;
  const vis = new Uint8Array(M);
  for (let i = 0; i < M; i++) vis[i] = sign * nz[i] >= threshold ? 1 : 0;
  return vis;
}

// One-Euro 时间平滑（与 Python LandmarkSmoother 等价）。对 [[x,y,z]...] 逐元素滤波。
export class OneEuro {
  constructor({ minCutoff = 1.5, beta = 0.05, dcutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }
  reset() { this.xPrev = this.dxPrev = this.tPrev = null; }
  _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, t) {
    const N = x.length;
    if (this.xPrev === null) {
      this.xPrev = x.map((p) => p.slice());
      this.dxPrev = x.map(() => [0, 0, 0]);
      this.tPrev = t;
      return x;
    }
    let dt = t - this.tPrev;
    if (dt <= 0) dt = 1e-3;
    this.tPrev = t;
    const aD = this._alpha(this.dcutoff, dt);
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
      out[i] = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const dx = (x[i][k] - this.xPrev[i][k]) / dt;
        const dxHat = aD * dx + (1 - aD) * this.dxPrev[i][k];
        this.dxPrev[i][k] = dxHat;
        const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
        const a = 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
        const xHat = a * x[i][k] + (1 - a) * this.xPrev[i][k];
        this.xPrev[i][k] = xHat;
        out[i][k] = xHat;
      }
    }
    return out;
  }
}

// ── 外物遮挡（手/器械）：凸包掩膜 ──────────────────────────────────────────────
// 在前方的手/器械会被 MediaPipe 当作"看不见的脸"继续预测关键点，导致线画到手上。
// 对策：用遮挡物的关键点求凸包，落在凸包内的脸部线点一律剔除。

// Andrew 单调链求凸包，返回逆时针顶点 [[x,y],...]
export function convexHull(pts) {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]]);
  const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// 沿质心方向把凸包向外扩张 margin 像素（覆盖手边缘/模糊/运动）
export function expandHull(hull, margin) {
  if (hull.length < 3 || margin <= 0) return hull;
  let cx = 0, cy = 0;
  for (const v of hull) { cx += v[0]; cy += v[1]; }
  cx /= hull.length; cy /= hull.length;
  return hull.map((v) => {
    const dx = v[0] - cx, dy = v[1] - cy, d = Math.hypot(dx, dy) || 1;
    return [v[0] + margin * dx / d, v[1] + margin * dy / d];
  });
}

// 点是否在逆时针凸包内（含边界）
export function pointInConvex(p, hull) {
  const n = hull.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false;
  }
  return true;
}

export function pointInHulls(p, hulls) {
  for (const h of hulls) if (pointInConvex(p, h)) return true;
  return false;
}

// 点到线段距离
function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
const _d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// MediaPipe 手部拓扑：手掌点 + 各指骨段
const PALM_IDX = [0, 1, 2, 5, 9, 13, 17];
const HAND_BONES = [
  [1, 2], [2, 3], [3, 4],          // 拇指
  [5, 6], [6, 7], [7, 8],          // 食指
  [9, 10], [10, 11], [11, 12],     // 中指
  [13, 14], [14, 15], [15, 16],    // 无名指
  [17, 18], [18, 19], [19, 20],    // 小指
  [0, 1], [0, 5], [0, 17],         // 掌根连接
];

// 用 21 个手部关键点构造**贴合手形**的掩膜（手掌凸包 + 各手指胶囊），
// 而非整只手的大凸包——这样张开的手指之间的缝隙不会被遮挡。
export function buildHandMasks(hands_px, scaleR = 0.16, margin = 4) {
  const masks = [];
  for (const h of hands_px) {
    if (!h || h.length < 21) continue;
    const palm = expandHull(convexHull(PALM_IDX.map((i) => h[i])), margin);
    const r = _d(h[5], h[17]) * scaleR + margin;   // 单指半径 ≈ 掌宽的一定比例
    const bones = HAND_BONES.map(([a, b]) => [h[a][0], h[a][1], h[b][0], h[b][1]]);
    masks.push({ palm, bones, r });
  }
  return masks;
}

// 点是否被任一手掩膜覆盖（手掌内 或 距某根指骨 < 半径）
export function pointInHandMasks(p, masks) {
  for (const m of masks) {
    if (pointInConvex(p, m.palm)) return true;
    for (const s of m.bones) if (distPointSeg(p[0], p[1], s[0], s[1], s[2], s[3]) <= m.r) return true;
  }
  return false;
}

// 把若干遮挡物的关键点列表转成扩张后的凸包列表
export function buildOccluderHulls(occluders_px, margin) {
  const hulls = [];
  for (const pts of occluders_px) {
    if (pts && pts.length >= 3) hulls.push(expandHull(convexHull(pts), margin));
  }
  return hulls;
}

// ── 相似变换 Umeyama（3D Beta 扫描重建用）──────────────────────────────────────
// 对称 3x3 特征分解（Jacobi），返回 {values, vectors(列为特征向量)}
function eig3(A) {
  let a = A.map((r) => r.slice());
  let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 50; iter++) {
    // 找最大非对角元
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    const pairs = [[0, 1], [0, 2], [1, 2]];
    for (const [i, j] of pairs) if (Math.abs(a[i][j]) >= max) { max = Math.abs(a[i][j]); p = i; q = j; }
    if (max < 1e-12) break;
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi), s = Math.sin(phi);
    const R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    R[p][p] = c; R[q][q] = c; R[p][q] = s; R[q][p] = -s;
    // a = R^T a R
    a = matmul(transpose(R), matmul(a, R));
    V = matmul(V, R);
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: V };
}
function matmul(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j]; C[i][j] = s; }
  return C;
}
function transpose(A) { return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]]; }
function det3(A) {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
       - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
       + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}

// 求相似变换 (scale c, 旋转 R, 平移 t) 使 c*R*sourcePts + t ≈ targetPts。
// sourcePts/targetPts: [[x,y,z]...]
export function umeyama(sourcePts, targetPts) {
  const n = sourcePts.length, mS = [0, 0, 0], mT = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mS[k] += sourcePts[i][k] / n; mT[k] += targetPts[i][k] / n; }
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let varS = 0;
  for (let i = 0; i < n; i++) {
    const sc = [sourcePts[i][0] - mS[0], sourcePts[i][1] - mS[1], sourcePts[i][2] - mS[2]];
    const tc = [targetPts[i][0] - mT[0], targetPts[i][1] - mT[1], targetPts[i][2] - mT[2]];
    for (let r = 0; r < 3; r++) for (let cIdx = 0; cIdx < 3; cIdx++) cov[r][cIdx] += tc[r] * sc[cIdx] / n;
    varS += (sc[0] * sc[0] + sc[1] * sc[1] + sc[2] * sc[2]) / n;
  }
  // SVD via eig of cov^T cov：cov = U S V^T，R = U*diag(1,1,d)*V^T
  const CtC = matmul(transpose(cov), cov);
  const { values, vectors } = eig3(CtC);
  // 按特征值降序
  const order = [0, 1, 2].sort((i, j) => values[j] - values[i]);
  const V = order.map((o) => [vectors[0][o], vectors[1][o], vectors[2][o]]); // 行=向量
  const sv = order.map((o) => Math.sqrt(Math.max(0, values[o])));
  // U_i = cov * V_i / sv_i
  const U = V.map((vi, idx) => {
    const u = [0, 0, 0];
    for (let r = 0; r < 3; r++) u[r] = (cov[r][0] * vi[0] + cov[r][1] * vi[1] + cov[r][2] * vi[2]) / (sv[idx] || 1);
    return u;
  });
  const Umat = transpose(U);   // 列 = U_i
  const Vmat = transpose(V);   // 列 = V_i
  const Vt = transpose(Vmat);  // 行 = V_i  (= V^T)
  let R = matmul(Umat, Vt);
  let d = 1;
  if (det3(R) < 0) {           // 避免反射
    d = -1;
    const Uf = Umat.map((row) => [row[0], row[1], -row[2]]);
    R = matmul(Uf, Vt);
  }
  const c = (sv[0] + sv[1] + d * sv[2]) / (varS || 1);
  const t = [0, 0, 0];
  for (let r = 0; r < 3; r++) t[r] = mT[r] - c * (R[r][0] * mS[0] + R[r][1] * mS[1] + R[r][2] * mS[2]);
  return { c, R, t };
}

export function applySim({ c, R, t }, P) {
  return P.map((p) => [
    c * (R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2]) + t[0],
    c * (R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2]) + t[1],
    c * (R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2]) + t[2],
  ]);
}

// 把折线按可见性切成连续可见子段（与 Python _visible_runs 一致）
export function visibleRuns(pts, visMask) {
  const runs = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (visMask[i] && isFinite(p[0]) && isFinite(p[1])) {
      cur.push(p);
    } else {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}
