import { applySim, umeyama, type SimilarityTransform } from "../../geometry.js";
import type { Triangle, Vec3 } from "./softBody";

const NV = 5023;
const NS = 60;
const NE = 50;
const NF = 9976;
const NL = 105;

export const JAW = { sign: 1, scale: 0.5 };

export interface FlameBasis {
  NV: number;
  NS: number;
  NE: number;
  NF: number;
  NL: number;
  vTemplate: Float32Array;
  shapeDirs: Float32Array;
  exprDirs: Float32Array;
  faces: Int32Array;
  lmkFaceIdx: Int32Array;
  lmkBCoords: Float32Array;
  landmarkIndices: Int32Array;
  jawReg: Float32Array;
  jawW: Float32Array;
}

export interface FitCoefficientsResult {
  coeffs: Float64Array;
  sim: SimilarityTransform;
  residual: number;
}

export interface FitOptions {
  reg?: number;
  iters?: number;
}

export interface FitShapeResult {
  beta: Float64Array;
  residual: number;
  nLandmarks: number;
}

export interface FitExpressionResult {
  psi: Float64Array;
  residual: number;
}

export function basisFromBuffer(buf: ArrayBuffer): FlameBasis {
  let offset = 0;
  const f32 = (count: number) => {
    const array = new Float32Array(buf, offset, count);
    offset += count * 4;
    return array;
  };
  const i32 = (count: number) => {
    const array = new Int32Array(buf, offset, count);
    offset += count * 4;
    return array;
  };
  return {
    NV,
    NS,
    NE,
    NF,
    NL,
    vTemplate: f32(NV * 3),
    shapeDirs: f32(NV * 3 * NS),
    exprDirs: f32(NV * 3 * NE),
    faces: i32(NF * 3),
    lmkFaceIdx: i32(NL),
    lmkBCoords: f32(NL * 3),
    landmarkIndices: i32(NL),
    jawReg: f32(NV),
    jawW: f32(NV),
  };
}

export async function loadFlameBasis(url: string): Promise<FlameBasis> {
  const buf = await fetch(url).then((response) => {
    if (!response.ok) throw new Error(`FLAME 基加载失败：HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  return basisFromBuffer(buf);
}

export function facesArray(basis: FlameBasis): Triangle[] {
  const faces = basis.faces;
  const out = new Array<Triangle>(basis.NF);
  for (let i = 0; i < basis.NF; i++) out[i] = [faces[i * 3], faces[i * 3 + 1], faces[i * 3 + 2]];
  return out;
}

function solveLinear(Ain: Float64Array[], b0: Float64Array): Float64Array {
  const n = b0.length;
  const A = Ain.map((row) => Float64Array.from(row));
  const b = Float64Array.from(b0);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      const value = Math.abs(A[row][col]);
      if (value > best) {
        best = value;
        pivot = row;
      }
    }
    if (pivot !== col) {
      const tempA = A[pivot];
      A[pivot] = A[col];
      A[col] = tempA;
      const tempB = b[pivot];
      b[pivot] = b[col];
      b[col] = tempB;
    }
    const denom = A[col][col] || 1e-12;
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / denom;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) A[row][c] -= factor * A[col][c];
      b[row] -= factor * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let c = row + 1; c < n; c++) sum -= A[row][c] * x[c];
    x[row] = sum / (A[row][row] || 1e-12);
  }
  return x;
}

function keepLmk(landmarks: Vec3[], basis: FlameBasis): number[] {
  const keep: number[] = [];
  for (let i = 0; i < basis.NL; i++) if (basis.landmarkIndices[i] < landmarks.length) keep.push(i);
  return keep;
}

function fitCoeffs(
  target: Vec3[],
  baseFlat: ArrayLike<number>,
  dirsFlat: ArrayLike<number>,
  dimension: number,
  basis: FlameBasis,
  keep: number[],
  reg: number,
  iters: number,
): FitCoefficientsResult {
  const { faces, lmkFaceIdx, lmkBCoords } = basis;
  const L = keep.length;
  const L0: Vec3[] = [];
  const A = new Array<Float64Array>(L * 3);
  for (let row = 0; row < L; row++) {
    const index = keep[row];
    const face = lmkFaceIdx[index];
    const va = faces[face * 3];
    const vb = faces[face * 3 + 1];
    const vc = faces[face * 3 + 2];
    const w0 = lmkBCoords[index * 3];
    const w1 = lmkBCoords[index * 3 + 1];
    const w2 = lmkBCoords[index * 3 + 2];
    const point: Vec3 = [0, 0, 0];
    for (let x = 0; x < 3; x++) {
      point[x] = w0 * baseFlat[va * 3 + x] + w1 * baseFlat[vb * 3 + x] + w2 * baseFlat[vc * 3 + x];
      const coeffRow = new Float64Array(dimension);
      const ba = (va * 3 + x) * dimension;
      const bb = (vb * 3 + x) * dimension;
      const bc = (vc * 3 + x) * dimension;
      for (let d = 0; d < dimension; d++) {
        coeffRow[d] = w0 * dirsFlat[ba + d] + w1 * dirsFlat[bb + d] + w2 * dirsFlat[bc + d];
      }
      A[row * 3 + x] = coeffRow;
    }
    L0.push(point);
  }
  const ata: Float64Array[] = [];
  for (let d = 0; d < dimension; d++) ata.push(new Float64Array(dimension));
  for (let row = 0; row < L * 3; row++) {
    const ar = A[row];
    for (let d = 0; d < dimension; d++) {
      const ad = ar[d];
      if (!ad) continue;
      const out = ata[d];
      for (let e = 0; e < dimension; e++) out[e] += ad * ar[e];
    }
  }
  for (let d = 0; d < dimension; d++) ata[d][d] += reg;
  let coeffs: Float64Array<ArrayBufferLike> = new Float64Array(dimension);
  let sim: SimilarityTransform | null = null;
  for (let iter = 0; iter < iters; iter++) {
    const landmarks: Vec3[] = [];
    for (let row = 0; row < L; row++) {
      const point: Vec3 = [0, 0, 0];
      for (let x = 0; x < 3; x++) {
        let value = L0[row][x];
        const ar = A[row * 3 + x];
        for (let d = 0; d < dimension; d++) value += ar[d] * coeffs[d];
        point[x] = value;
      }
      landmarks.push(point);
    }
    sim = umeyama(target, landmarks);
    const transformedTarget = applySim(sim, target);
    const atb = new Float64Array(dimension);
    for (let row = 0; row < L; row++) {
      for (let x = 0; x < 3; x++) {
        const residual = transformedTarget[row][x] - L0[row][x];
        const ar = A[row * 3 + x];
        for (let d = 0; d < dimension; d++) atb[d] += ar[d] * residual;
      }
    }
    coeffs = solveLinear(ata, atb);
  }
  const finalSim = sim ?? umeyama(target, L0);
  const transformedTarget = applySim(finalSim, target);
  let squaredError = 0;
  for (let row = 0; row < L; row++) {
    for (let x = 0; x < 3; x++) {
      let predicted = L0[row][x];
      const ar = A[row * 3 + x];
      for (let d = 0; d < dimension; d++) predicted += ar[d] * coeffs[d];
      const delta = predicted - transformedTarget[row][x];
      squaredError += delta * delta;
    }
  }
  return { coeffs, sim: finalSim, residual: Math.sqrt(squaredError / (L * 3)) };
}

export function fitShape(landmarks: Vec3[], basis: FlameBasis, opts: FitOptions = {}): FitShapeResult {
  const keep = keepLmk(landmarks, basis);
  if (keep.length < 4) throw new Error("可用关键点不足");
  const target = keep.map((index) => landmarks[basis.landmarkIndices[index]]);
  const result = fitCoeffs(
    target,
    basis.vTemplate,
    basis.shapeDirs,
    basis.NS,
    basis,
    keep,
    opts.reg ?? 1e-4,
    opts.iters ?? 4,
  );
  return { beta: result.coeffs, residual: result.residual, nLandmarks: keep.length };
}

export function fitExpression(
  landmarks: Vec3[],
  basis: FlameBasis,
  beta: ArrayLike<number>,
  opts: FitOptions = {},
): FitExpressionResult {
  const keep = keepLmk(landmarks, basis);
  if (keep.length < 4) throw new Error("可用关键点不足");
  const target = keep.map((index) => landmarks[basis.landmarkIndices[index]]);
  const base = new Float64Array(basis.NV * 3);
  for (let k = 0; k < basis.NV * 3; k++) {
    let value = basis.vTemplate[k];
    const baseOffset = k * basis.NS;
    for (let d = 0; d < basis.NS; d++) value += basis.shapeDirs[baseOffset + d] * beta[d];
    base[k] = value;
  }
  const result = fitCoeffs(
    target,
    base,
    basis.exprDirs,
    basis.NE,
    basis,
    keep,
    opts.reg ?? 8e-4,
    opts.iters ?? 2,
  );
  return { psi: result.coeffs, residual: result.residual };
}

export function flameForward(
  basis: FlameBasis,
  beta: ArrayLike<number>,
  psi: ArrayLike<number>,
  jawOpen = 0,
): Vec3[] {
  const { vTemplate, shapeDirs, exprDirs, jawReg, jawW } = basis;
  const { NV: vertexCount, NS: shapeCount, NE: expressionCount } = basis;
  const vertices = new Float64Array(vertexCount * 3);
  for (let k = 0; k < vertexCount * 3; k++) {
    let value = vTemplate[k];
    const shapeOffset = k * shapeCount;
    for (let d = 0; d < shapeCount; d++) value += shapeDirs[shapeOffset + d] * beta[d];
    const expressionOffset = k * expressionCount;
    for (let d = 0; d < expressionCount; d++) value += exprDirs[expressionOffset + d] * psi[d];
    vertices[k] = value;
  }
  const joint: Vec3 = [0, 0, 0];
  for (let i = 0; i < vertexCount; i++) {
    const weight = jawReg[i];
    if (weight) {
      joint[0] += weight * vertices[i * 3];
      joint[1] += weight * vertices[i * 3 + 1];
      joint[2] += weight * vertices[i * 3 + 2];
    }
  }
  const angle = jawOpen * JAW.sign * JAW.scale;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out = new Array<Vec3>(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    let x = vertices[i * 3];
    let y = vertices[i * 3 + 1];
    let z = vertices[i * 3 + 2];
    const weight = jawW[i];
    if (weight > 1e-3 && angle !== 0) {
      const dy = y - joint[1];
      const dz = z - joint[2];
      const nextY = joint[1] + (cos * dy - sin * dz);
      const nextZ = joint[2] + (sin * dy + cos * dz);
      y = (1 - weight) * y + weight * nextY;
      z = (1 - weight) * z + weight * nextZ;
    }
    out[i] = [x, y, z];
  }
  return out;
}
