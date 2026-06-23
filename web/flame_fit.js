// 浏览器内 FLAME：身份拟合 + 表情拟合 + 前向（含 jaw 张合蒙皮）。纯 JS、几毫秒、每帧可跑。
// 算法与 src/langerface/flame.py 同源（线性形状/表情最小二乘 + Umeyama）；jaw 为单关节简化 LBS。
// 基 flame_basis.bin 源自 FLAME 2023 Open(CC-BY-4.0)。Node 对拍见 tools/test_flame_fit_js.mjs。
import { applySim, umeyama } from "./geometry.js";

const NV = 5023, NS = 60, NE = 50, NF = 9976, NL = 105;
// jaw 调参（这边看不到渲染，留旋钮）：jawOpen(0~1) → 绕 x 轴旋转 sign*scale*open 弧度。
export const JAW = { sign: 1, scale: 0.5 };

export function basisFromBuffer(buf) {
  let off = 0;
  const f32 = (c) => { const a = new Float32Array(buf, off, c); off += c * 4; return a; };
  const i32 = (c) => { const a = new Int32Array(buf, off, c); off += c * 4; return a; };
  return {
    NV, NS, NE, NF, NL,
    vTemplate: f32(NV * 3), shapeDirs: f32(NV * 3 * NS), exprDirs: f32(NV * 3 * NE),
    faces: i32(NF * 3), lmkFaceIdx: i32(NL), lmkBCoords: f32(NL * 3), landmarkIndices: i32(NL),
    jawReg: f32(NV), jawW: f32(NV),
  };
}

export async function loadFlameBasis(url) {
  const buf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`FLAME 基加载失败：HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  return basisFromBuffer(buf);
}

export function facesArray(basis) {
  const f = basis.faces, out = new Array(basis.NF);
  for (let i = 0; i < basis.NF; i++) out[i] = [f[i * 3], f[i * 3 + 1], f[i * 3 + 2]];
  return out;
}

function solveLinear(Ain, b0) {
  const n = b0.length;
  const A = Ain.map((row) => Float64Array.from(row));
  const b = Float64Array.from(b0);
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) { const v = Math.abs(A[r][col]); if (v > best) { best = v; piv = r; } }
    if (piv !== col) { const ta = A[piv]; A[piv] = A[col]; A[col] = ta; const tb = b[piv]; b[piv] = b[col]; b[col] = tb; }
    const d = A[col][col] || 1e-12;
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / d; if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c]; x[r] = s / (A[r][r] || 1e-12); }
  return x;
}

function keepLmk(landmarks, basis) {
  const keep = [];
  for (let i = 0; i < basis.NL; i++) if (basis.landmarkIndices[i] < landmarks.length) keep.push(i);
  return keep;
}

// 通用线性系数拟合：把 (baseFlat + dirsFlat·coeffs) 的关键点对齐到观测 → coeffs。
// baseFlat: NV*3 基础顶点；dirsFlat: NV*3*ND 基方向；返回 {coeffs, residual}。
function fitCoeffs(target, baseFlat, dirsFlat, ND, basis, keep, reg, iters) {
  const { faces, lmkFaceIdx, lmkBCoords } = basis, L = keep.length;
  const L0 = [], A = new Array(L * 3);
  for (let r = 0; r < L; r++) {
    const i = keep[r], f = lmkFaceIdx[i];
    const va = faces[f * 3], vb = faces[f * 3 + 1], vc = faces[f * 3 + 2];
    const w0 = lmkBCoords[i * 3], w1 = lmkBCoords[i * 3 + 1], w2 = lmkBCoords[i * 3 + 2];
    const p = [0, 0, 0];
    for (let x = 0; x < 3; x++) {
      p[x] = w0 * baseFlat[va * 3 + x] + w1 * baseFlat[vb * 3 + x] + w2 * baseFlat[vc * 3 + x];
      const row = new Float64Array(ND), ba = (va * 3 + x) * ND, bb = (vb * 3 + x) * ND, bcc = (vc * 3 + x) * ND;
      for (let d = 0; d < ND; d++) row[d] = w0 * dirsFlat[ba + d] + w1 * dirsFlat[bb + d] + w2 * dirsFlat[bcc + d];
      A[r * 3 + x] = row;
    }
    L0.push(p);
  }
  const ata = []; for (let d = 0; d < ND; d++) ata.push(new Float64Array(ND));
  for (let row = 0; row < L * 3; row++) { const ar = A[row]; for (let d = 0; d < ND; d++) { const ad = ar[d]; if (!ad) continue; const o = ata[d]; for (let e = 0; e < ND; e++) o[e] += ad * ar[e]; } }
  for (let d = 0; d < ND; d++) ata[d][d] += reg;
  let coeffs = new Float64Array(ND), sim = null;
  for (let it = 0; it < iters; it++) {
    const lm = [];
    for (let r = 0; r < L; r++) { const p = [0, 0, 0]; for (let x = 0; x < 3; x++) { let s = L0[r][x]; const ar = A[r * 3 + x]; for (let d = 0; d < ND; d++) s += ar[d] * coeffs[d]; p[x] = s; } lm.push(p); }
    sim = umeyama(target, lm); const tgt = applySim(sim, target);
    const atb = new Float64Array(ND);
    for (let r = 0; r < L; r++) for (let x = 0; x < 3; x++) { const resid = tgt[r][x] - L0[r][x], ar = A[r * 3 + x]; for (let d = 0; d < ND; d++) atb[d] += ar[d] * resid; }
    coeffs = solveLinear(ata, atb);
  }
  const tgtF = applySim(sim, target); let se = 0;
  for (let r = 0; r < L; r++) for (let x = 0; x < 3; x++) { let pv = L0[r][x]; const ar = A[r * 3 + x]; for (let d = 0; d < ND; d++) pv += ar[d] * coeffs[d]; const dd = pv - tgtF[r][x]; se += dd * dd; }
  return { coeffs, sim, residual: Math.sqrt(se / (L * 3)) };
}

// 身份拟合（解一次即可）：→ { beta(NS), residual, nLandmarks }。
export function fitShape(landmarks, basis, opts = {}) {
  const keep = keepLmk(landmarks, basis);
  if (keep.length < 4) throw new Error("可用关键点不足");
  const target = keep.map((i) => landmarks[basis.landmarkIndices[i]]);
  const r = fitCoeffs(target, basis.vTemplate, basis.shapeDirs, basis.NS, basis, keep, opts.reg ?? 1e-4, opts.iters ?? 4);
  return { beta: r.coeffs, residual: r.residual, nLandmarks: keep.length };
}

// 表情拟合（每帧）：身份 beta 固定 → 解 psi(NE)。base = vTemplate + shapeDirs·beta。
export function fitExpression(landmarks, basis, beta, opts = {}) {
  const keep = keepLmk(landmarks, basis);
  if (keep.length < 4) throw new Error("可用关键点不足");
  const target = keep.map((i) => landmarks[basis.landmarkIndices[i]]);
  const base = new Float64Array(basis.NV * 3);
  for (let k = 0; k < basis.NV * 3; k++) { let s = basis.vTemplate[k]; const b = k * basis.NS; for (let d = 0; d < basis.NS; d++) s += basis.shapeDirs[b + d] * beta[d]; base[k] = s; }
  const r = fitCoeffs(target, base, basis.exprDirs, basis.NE, basis, keep, opts.reg ?? 2e-3, opts.iters ?? 2);
  return { psi: r.coeffs, residual: r.residual };
}

// FLAME 前向：v = vTemplate + shapeDirs·beta + exprDirs·psi，再对 jaw 蒙皮顶点绕 jaw 关节旋转 jawOpen。
export function flameForward(basis, beta, psi, jawOpen = 0) {
  const { vTemplate, shapeDirs, exprDirs, jawReg, jawW, NV, NS, NE } = basis;
  const v = new Float64Array(NV * 3);
  for (let k = 0; k < NV * 3; k++) {
    let s = vTemplate[k];
    const bs = k * NS; for (let d = 0; d < NS; d++) s += shapeDirs[bs + d] * beta[d];
    const be = k * NE; for (let d = 0; d < NE; d++) s += exprDirs[be + d] * psi[d];
    v[k] = s;
  }
  const J = [0, 0, 0];
  for (let i = 0; i < NV; i++) { const w = jawReg[i]; if (w) { J[0] += w * v[i * 3]; J[1] += w * v[i * 3 + 1]; J[2] += w * v[i * 3 + 2]; } }
  const a = jawOpen * JAW.sign * JAW.scale, ca = Math.cos(a), sa = Math.sin(a);
  const out = new Array(NV);
  for (let i = 0; i < NV; i++) {
    let x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    const w = jawW[i];
    if (w > 1e-3 && a !== 0) {           // 绕 jaw 关节、绕 x 轴旋转（张嘴：下巴下/后），按蒙皮权重混合
      const dy = y - J[1], dz = z - J[2];
      const ny = J[1] + (ca * dy - sa * dz), nz = J[2] + (sa * dy + ca * dz);
      y = (1 - w) * y + w * ny; z = (1 - w) * z + w * nz;
    }
    out[i] = [x, y, z];
  }
  return out;
}
