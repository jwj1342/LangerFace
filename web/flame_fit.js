// 浏览器内 FLAME 线性形状拟合（与 src/langerface/flame.py / web/api/fit.py 同算法）。
// 纯 JS：重心采样 + 复用 geometry.js 的 umeyama + 一个 nShape×nShape 最小二乘解。
// 几毫秒级、零网络往返 —— 实时每帧可跑。基（flame_basis.bin）源自 FLAME 2023 Open(CC-BY-4.0)。
import { applySim, umeyama } from "./geometry.js";

// 紧凑基固定布局（与 tools/build_flame_basis.py 一致，小端）：
const N_VERTS = 5023, N_FACES = 9976, N_LMK = 105, N_SHAPE = 60;

// ArrayBuffer → basis（typed arrays，零拷贝切片）。
export function basisFromBuffer(buf) {
  let off = 0;
  const f32 = (count) => { const a = new Float32Array(buf, off, count); off += count * 4; return a; };
  const i32 = (count) => { const a = new Int32Array(buf, off, count); off += count * 4; return a; };
  const vTemplate = f32(N_VERTS * 3);
  const shapedirs = f32(N_VERTS * 3 * N_SHAPE);
  const faces = i32(N_FACES * 3);
  const lmkFaceIdx = i32(N_LMK);
  const lmkBCoords = f32(N_LMK * 3);
  const landmarkIndices = i32(N_LMK);
  return {
    nVerts: N_VERTS, nFaces: N_FACES, nLmk: N_LMK, nShape: N_SHAPE,
    vTemplate, shapedirs, faces, lmkFaceIdx, lmkBCoords, landmarkIndices,
  };
}

// 浏览器加载：fetch flame_basis.bin → basis。
export async function loadFlameBasis(url) {
  const buf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`FLAME 基加载失败：HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  return basisFromBuffer(buf);
}

// 解对称正定线性方程组 A x = b（高斯消元 + 部分主元）。A: n×n（Float64Array[]），b: Float64Array。
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
      const f = A[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / (A[r][r] || 1e-12);
  }
  return x;
}

// 把 FLAME 拟合到一组观测关键点 landmarks（[[x,y,z],...]，按 landmarkIndices 取用）。
// 返回 { verts:[[x,y,z]×5023], faces:[[a,b,c]×9976], residual, nLandmarks }。
export function fitFlame(landmarks, basis, opts = {}) {
  const reg = opts.reg ?? 1e-4, iters = opts.iters ?? 4;
  const { vTemplate, shapedirs, faces, lmkFaceIdx, lmkBCoords, landmarkIndices, nVerts, nFaces, nLmk, nShape } = basis;
  const N = nShape;

  const keep = [];
  for (let i = 0; i < nLmk; i++) if (landmarkIndices[i] < landmarks.length) keep.push(i);
  if (keep.length < 4) throw new Error("可用关键点不足（embedding 与观测点不匹配）");
  const L = keep.length;
  const target = keep.map((i) => landmarks[landmarkIndices[i]]);  // L×3

  const L0 = [];                 // L×3：模板关键点
  const A = new Array(L * 3);    // 3L 行 × N：shapedirs 在关键点处的雅可比
  for (let r = 0; r < L; r++) {
    const i = keep[r], f = lmkFaceIdx[i];
    const va = faces[f * 3], vb = faces[f * 3 + 1], vc = faces[f * 3 + 2];
    const w0 = lmkBCoords[i * 3], w1 = lmkBCoords[i * 3 + 1], w2 = lmkBCoords[i * 3 + 2];
    const p = [0, 0, 0];
    for (let x = 0; x < 3; x++) {
      p[x] = w0 * vTemplate[va * 3 + x] + w1 * vTemplate[vb * 3 + x] + w2 * vTemplate[vc * 3 + x];
      const row = new Float64Array(N);
      const ba = (va * 3 + x) * N, bb = (vb * 3 + x) * N, bc = (vc * 3 + x) * N;
      for (let d = 0; d < N; d++) row[d] = w0 * shapedirs[ba + d] + w1 * shapedirs[bb + d] + w2 * shapedirs[bc + d];
      A[r * 3 + x] = row;
    }
    L0.push(p);
  }

  // AtA = AᵀA + reg·I（N×N，固定不变）
  const ata = [];
  for (let d = 0; d < N; d++) ata.push(new Float64Array(N));
  for (let row = 0; row < L * 3; row++) {
    const ar = A[row];
    for (let d = 0; d < N; d++) { const ad = ar[d]; if (ad === 0) continue; const ad_row = ata[d]; for (let e = 0; e < N; e++) ad_row[e] += ad * ar[e]; }
  }
  for (let d = 0; d < N; d++) ata[d][d] += reg;

  let beta = new Float64Array(N);
  let sim = { c: 1, R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] };
  for (let it = 0; it < iters; it++) {
    const lmodel = [];
    for (let r = 0; r < L; r++) {
      const p = [0, 0, 0];
      for (let x = 0; x < 3; x++) { let s = L0[r][x]; const ar = A[r * 3 + x]; for (let d = 0; d < N; d++) s += ar[d] * beta[d]; p[x] = s; }
      lmodel.push(p);
    }
    sim = umeyama(target, lmodel);          // 观测 → FLAME 系
    const tgt = applySim(sim, target);
    const atb = new Float64Array(N);
    for (let r = 0; r < L; r++) for (let x = 0; x < 3; x++) {
      const resid = tgt[r][x] - L0[r][x], ar = A[r * 3 + x];
      for (let d = 0; d < N; d++) atb[d] += ar[d] * resid;
    }
    beta = solveLinear(ata, atb);
  }

  // verts = vTemplate + shapedirs @ beta
  const verts = new Array(nVerts);
  for (let v = 0; v < nVerts; v++) {
    const p = [0, 0, 0];
    for (let x = 0; x < 3; x++) {
      let s = vTemplate[v * 3 + x]; const base = (v * 3 + x) * N;
      for (let d = 0; d < N; d++) s += shapedirs[base + d] * beta[d];
      p[x] = s;
    }
    verts[v] = p;
  }
  const facesArr = new Array(nFaces);
  for (let f = 0; f < nFaces; f++) facesArr[f] = [faces[f * 3], faces[f * 3 + 1], faces[f * 3 + 2]];

  // 残差（关键点 RMS，FLAME 系）
  const tgtFinal = applySim(sim, target);
  let se = 0;
  for (let r = 0; r < L; r++) {
    const i = keep[r], f = lmkFaceIdx[i];
    const va = faces[f * 3], vb = faces[f * 3 + 1], vc = faces[f * 3 + 2];
    const w0 = lmkBCoords[i * 3], w1 = lmkBCoords[i * 3 + 1], w2 = lmkBCoords[i * 3 + 2];
    for (let x = 0; x < 3; x++) {
      const pv = w0 * verts[va][x] + w1 * verts[vb][x] + w2 * verts[vc][x];
      const dd = pv - tgtFinal[r][x]; se += dd * dd;
    }
  }
  return { verts, faces: facesArr, residual: Math.sqrt(se / (L * 3)), nLandmarks: L };
}
