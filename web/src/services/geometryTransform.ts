import type { Vec3 } from "./softBody";

type Mat3 = [Vec3, Vec3, Vec3];

export interface SimilarityTransform {
  c: number;
  R: Mat3;
  t: Vec3;
}

interface Eig3Result {
  values: Vec3;
  vectors: Mat3;
}

function matmul(A: Mat3, B: Mat3): Mat3 {
  const C: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += A[i][k] * B[k][j];
      C[i][j] = sum;
    }
  }
  return C;
}

function transpose(A: Mat3): Mat3 {
  return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
}

function det3(A: Mat3): number {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
       - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
       + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}

function eig3(A: Mat3): Eig3Result {
  let a = A.map((row) => row.slice() as Vec3) as Mat3;
  let V: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 50; iter++) {
    let p = 0;
    let q = 1;
    let max = Math.abs(a[0][1]);
    const pairs: Array<[number, number]> = [[0, 1], [0, 2], [1, 2]];
    for (const [i, j] of pairs) {
      if (Math.abs(a[i][j]) >= max) {
        max = Math.abs(a[i][j]);
        p = i;
        q = j;
      }
    }
    if (max < 1e-12) break;
    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const R: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    R[p][p] = c;
    R[q][q] = c;
    R[p][q] = s;
    R[q][p] = -s;
    a = matmul(transpose(R), matmul(a, R));
    V = matmul(V, R);
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: V };
}

export function umeyama(sourcePts: Vec3[], targetPts: Vec3[]): SimilarityTransform {
  const n = sourcePts.length;
  const mS: Vec3 = [0, 0, 0];
  const mT: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let axis = 0; axis < 3; axis++) {
      mS[axis] += sourcePts[i][axis] / n;
      mT[axis] += targetPts[i][axis] / n;
    }
  }
  const cov: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let varS = 0;
  for (let i = 0; i < n; i++) {
    const sc: Vec3 = [sourcePts[i][0] - mS[0], sourcePts[i][1] - mS[1], sourcePts[i][2] - mS[2]];
    const tc: Vec3 = [targetPts[i][0] - mT[0], targetPts[i][1] - mT[1], targetPts[i][2] - mT[2]];
    for (let r = 0; r < 3; r++) {
      for (let cIdx = 0; cIdx < 3; cIdx++) cov[r][cIdx] += tc[r] * sc[cIdx] / n;
    }
    varS += (sc[0] * sc[0] + sc[1] * sc[1] + sc[2] * sc[2]) / n;
  }
  const CtC = matmul(transpose(cov), cov);
  const { values, vectors } = eig3(CtC);
  const order = [0, 1, 2].sort((i, j) => values[j] - values[i]);
  const V = order.map((o) => [vectors[0][o], vectors[1][o], vectors[2][o]] as Vec3) as Mat3;
  const sv = order.map((o) => Math.sqrt(Math.max(0, values[o])));
  const U = V.map((vi, idx) => {
    const u: Vec3 = [0, 0, 0];
    for (let r = 0; r < 3; r++) u[r] = (cov[r][0] * vi[0] + cov[r][1] * vi[1] + cov[r][2] * vi[2]) / (sv[idx] || 1);
    return u;
  }) as Mat3;
  const Umat = transpose(U);
  const Vmat = transpose(V);
  const Vt = transpose(Vmat);
  let R = matmul(Umat, Vt);
  let d = 1;
  if (det3(R) < 0) {
    d = -1;
    const Uf = Umat.map((row) => [row[0], row[1], -row[2]] as Vec3) as Mat3;
    R = matmul(Uf, Vt);
  }
  const c = (sv[0] + sv[1] + d * sv[2]) / (varS || 1);
  const t: Vec3 = [0, 0, 0];
  for (let r = 0; r < 3; r++) t[r] = mT[r] - c * (R[r][0] * mS[0] + R[r][1] * mS[1] + R[r][2] * mS[2]);
  return { c, R, t };
}

export function applySim({ c, R, t }: SimilarityTransform, P: Vec3[]): Vec3[] {
  return P.map((p) => [
    c * (R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2]) + t[0],
    c * (R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2]) + t[1],
    c * (R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2]) + t[2],
  ]);
}
