import { ONEEURO_BETA, ONEEURO_DCUTOFF, ONEEURO_MIN_CUTOFF, RIGID3D } from "./constantsGenerated.ts";
import type { Vec3 } from "./softBody";

export interface OneEuroOptions {
  minCutoff?: number;
  beta?: number;
  dcutoff?: number;
}

export interface MotionStabilizedOneEuroOptions extends OneEuroOptions {
  globalMinCutoff?: number;
  globalBeta?: number;
  globalDcutoff?: number;
  anchorIndices?: number[];
}

export class OneEuro {
  minCutoff: number;
  beta: number;
  dcutoff: number;
  private xPrev: Vec3[] | null;
  private dxPrev: Vec3[] | null;
  private tPrev: number | null;

  constructor({ minCutoff = ONEEURO_MIN_CUTOFF, beta = ONEEURO_BETA, dcutoff = ONEEURO_DCUTOFF }: OneEuroOptions = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: Vec3[], t: number): Vec3[] {
    const count = x.length;
    if (this.xPrev === null || this.dxPrev === null || this.tPrev === null) {
      this.xPrev = x.map((point) => point.slice() as Vec3);
      this.dxPrev = x.map(() => [0, 0, 0] as Vec3);
      this.tPrev = t;
      return x;
    }
    let dt = t - this.tPrev;
    if (dt <= 0) dt = 1e-3;
    this.tPrev = t;
    const aD = this.alpha(this.dcutoff, dt);
    const out = new Array<Vec3>(count);
    for (let i = 0; i < count; i++) {
      out[i] = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) {
        const dx = (x[i][axis] - this.xPrev[i][axis]) / dt;
        const dxHat = aD * dx + (1 - aD) * this.dxPrev[i][axis];
        this.dxPrev[i][axis] = dxHat;
        const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
        const a = 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
        const xHat = a * x[i][axis] + (1 - a) * this.xPrev[i][axis];
        this.xPrev[i][axis] = xHat;
        out[i][axis] = xHat;
      }
    }
    return out;
  }
}

function finitePoint(point: unknown): point is Vec3 {
  return Array.isArray(point)
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
    && Number.isFinite(point[2] ?? 0);
}

function meanAnchorPoint(points: Vec3[], anchorIndices: number[] = RIGID3D): Vec3 | null {
  const center: Vec3 = [0, 0, 0];
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
  return center.map((value) => value / count) as Vec3;
}

function centeredLandmarks(points: Vec3[], center: Vec3): Vec3[] {
  return points.map((point) => [
    point[0] - center[0],
    point[1] - center[1],
    (point[2] ?? 0) - center[2],
  ]);
}

function restoreCenter(points: Vec3[], center: Vec3): Vec3[] {
  return points.map((point) => [
    point[0] + center[0],
    point[1] + center[1],
    (point[2] ?? 0) + center[2],
  ]);
}

export class MotionStabilizedOneEuro {
  private local: OneEuro;
  private global: OneEuro;
  private anchorIndices: number[];

  constructor({
    minCutoff = ONEEURO_MIN_CUTOFF,
    beta = ONEEURO_BETA,
    dcutoff = ONEEURO_DCUTOFF,
    globalMinCutoff = 1.25,
    globalBeta = 0.012,
    globalDcutoff = ONEEURO_DCUTOFF,
    anchorIndices = RIGID3D,
  }: MotionStabilizedOneEuroOptions = {}) {
    this.local = new OneEuro({ minCutoff, beta, dcutoff });
    this.global = new OneEuro({
      minCutoff: globalMinCutoff,
      beta: globalBeta,
      dcutoff: globalDcutoff,
    });
    this.anchorIndices = anchorIndices;
  }

  get minCutoff(): number { return this.local.minCutoff; }
  set minCutoff(value: number) { this.local.minCutoff = value; }
  get beta(): number { return this.local.beta; }
  set beta(value: number) { this.local.beta = value; }
  get dcutoff(): number { return this.local.dcutoff; }
  set dcutoff(value: number) { this.local.dcutoff = value; }
  get globalMinCutoff(): number { return this.global.minCutoff; }
  set globalMinCutoff(value: number) { this.global.minCutoff = value; }
  get globalBeta(): number { return this.global.beta; }
  set globalBeta(value: number) { this.global.beta = value; }
  get globalDcutoff(): number { return this.global.dcutoff; }
  set globalDcutoff(value: number) { this.global.dcutoff = value; }

  configureForSmoothLevel(smoothLevel: number): void {
    const level = Math.max(0, Math.min(1, Number(smoothLevel) || 0));
    this.globalMinCutoff = 3.0 - 2.25 * level;
    this.globalBeta = 0.004 + 0.014 * level;
  }

  reset(): void {
    this.local.reset();
    this.global.reset();
  }

  filter(points: Vec3[], t: number): Vec3[] {
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
