// One-Euro 时间平滑（移植自 Python detection/smoothing.py 的 LandmarkSmoother）。
// 纯逻辑、无 DOM。拆分自原 web/geometry.js（见 #49）。
// 默认参数来自 constants.py 的 ONEEURO_*（跨语言单一真源，生成，见 #30）。

import { ONEEURO_BETA, ONEEURO_DCUTOFF, ONEEURO_MIN_CUTOFF, RIGID3D } from "../constants_generated.js";

// One-Euro 时间平滑。对 [[x,y,z]...] 逐元素滤波。
export class OneEuro {
  constructor({ minCutoff = ONEEURO_MIN_CUTOFF, beta = ONEEURO_BETA, dcutoff = ONEEURO_DCUTOFF } = {}) {
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

function finitePoint(point) {
  return Array.isArray(point)
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
    && Number.isFinite(point[2] ?? 0);
}

function meanAnchorPoint(points, anchorIndices = RIGID3D) {
  const center = [0, 0, 0];
  let count = 0;
  for (const index of anchorIndices) {
    const point = points[index];
    if (!finitePoint(point)) continue;
    center[0] += point[0];
    center[1] += point[1];
    center[2] += point[2] ?? 0;
    count += 1;
  }
  if (!count) return null;
  return center.map((value) => value / count);
}

function centeredLandmarks(points, center) {
  return points.map((point) => [
    point[0] - center[0],
    point[1] - center[1],
    (point[2] ?? 0) - center[2],
  ]);
}

function restoreCenter(points, center) {
  return points.map((point) => [
    point[0] + center[0],
    point[1] + center[1],
    (point[2] ?? 0) + center[2],
  ]);
}

// 实时人脸用组合滤波：
// 1) 先用稳定锚点估计整脸平移中心，并对该中心做更保守的 One-Euro；
// 2) 再把 landmarks 转成以中心为原点的局部形状，用原有 One-Euro 处理局部形变。
// 这样快速整脸移动时，全局平移的高频噪声不会被逐点速度项直接放大，同时保留局部表情平滑。
export class MotionStabilizedOneEuro {
  constructor({
    minCutoff = ONEEURO_MIN_CUTOFF,
    beta = ONEEURO_BETA,
    dcutoff = ONEEURO_DCUTOFF,
    globalMinCutoff = 1.25,
    globalBeta = 0.012,
    globalDcutoff = ONEEURO_DCUTOFF,
    anchorIndices = RIGID3D,
  } = {}) {
    this.local = new OneEuro({ minCutoff, beta, dcutoff });
    this.global = new OneEuro({
      minCutoff: globalMinCutoff,
      beta: globalBeta,
      dcutoff: globalDcutoff,
    });
    this.anchorIndices = anchorIndices;
  }

  get minCutoff() { return this.local.minCutoff; }
  set minCutoff(value) { this.local.minCutoff = value; }
  get beta() { return this.local.beta; }
  set beta(value) { this.local.beta = value; }
  get dcutoff() { return this.local.dcutoff; }
  set dcutoff(value) { this.local.dcutoff = value; }
  get globalMinCutoff() { return this.global.minCutoff; }
  set globalMinCutoff(value) { this.global.minCutoff = value; }
  get globalBeta() { return this.global.beta; }
  set globalBeta(value) { this.global.beta = value; }
  get globalDcutoff() { return this.global.dcutoff; }
  set globalDcutoff(value) { this.global.dcutoff = value; }

  configureForSmoothLevel(smoothLevel) {
    const level = Math.max(0, Math.min(1, Number(smoothLevel) || 0));
    this.globalMinCutoff = 3.0 - 2.25 * level;
    this.globalBeta = 0.004 + 0.014 * level;
  }

  reset() {
    this.local.reset();
    this.global.reset();
  }

  filter(points, t) {
    const center = meanAnchorPoint(points, this.anchorIndices);
    if (!center) return this.local.filter(points, t);
    const smoothedCenter = this.global.filter([center], t)[0];
    const localPoints = centeredLandmarks(points, center);
    const smoothedLocalPoints = this.local.filter(localPoints, t);
    return restoreCenter(smoothedLocalPoints, smoothedCenter);
  }
}

export const __smoothingForTests = {
  centeredLandmarks,
  meanAnchorPoint,
  restoreCenter,
};
