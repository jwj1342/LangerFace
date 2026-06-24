// 相似变换 Umeyama（仅 3D Beta 扫描重建路线使用）。纯线代、无 DOM。
// 拆分自原 web/geometry.js（见 #49）。

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
