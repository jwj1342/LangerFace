import type { Vec3 } from "./softBody";

const MAX_CONTROL_POINTS = 100000;
const MAX_STEPS_PER_SEGMENT = 4000;
const MAX_OUTPUT_POINTS = 500000;

interface SlicerMarkupPoint {
  position?: unknown;
}

interface SlicerMarkup {
  type?: unknown;
  name?: unknown;
  region?: unknown;
  coordinateSystem?: unknown;
  controlPoints?: SlicerMarkupPoint[];
}

interface SlicerMarkupDocument {
  coordinateSystem?: unknown;
  markups?: SlicerMarkup[];
}

export interface ParsedSlicerCurve {
  name: string;
  region: string;
  coordinateSystem: unknown;
  controlPoints: Vec3[];
  points: Vec3[];
}

export interface ParseSlicerCurveOptions {
  spacing?: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function cleanPoint(point: unknown): Vec3 | null {
  if (!Array.isArray(point) || point.length < 3) return null;
  const out: Vec3 = [Number(point[0]), Number(point[1]), Number(point[2])];
  return out.every(Number.isFinite) ? out : null;
}

function parseSlicerMarkups(text: string): Array<Omit<ParsedSlicerCurve, "points">> {
  const data = JSON.parse(text) as SlicerMarkupDocument;
  const markups = Array.isArray(data.markups) ? data.markups : [];
  return markups
    .filter((markup) => !markup.type || String(markup.type).toLowerCase() === "curve")
    .map((markup, index) => ({
      name: (typeof markup.name === "string" && markup.name) ? markup.name : `slicer_curve_${index + 1}`,
      region: (typeof markup.region === "string" && markup.region) ? markup.region : "slicer",
      coordinateSystem: data.coordinateSystem || markup.coordinateSystem || "",
      controlPoints: (markup.controlPoints || [])
        .map((controlPoint) => cleanPoint(controlPoint.position))
        .filter((point): point is Vec3 => Boolean(point)),
    }))
    .filter((markup) => markup.controlPoints.length >= 2);
}

function catmullRomPoint(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number, alpha = 0.5): Vec3 {
  const eps = 1e-6;
  const tj = (ti: number, a: Vec3, b: Vec3) => ti + Math.max(eps, Math.pow(dist(a, b), alpha));
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;
  const a1 = lerp(p0, p1, (t - t0) / (t1 - t0));
  const a2 = lerp(p1, p2, (t - t1) / (t2 - t1));
  const a3 = lerp(p2, p3, (t - t2) / (t3 - t2));
  const b1 = lerp(a1, a2, (t - t0) / (t2 - t0));
  const b2 = lerp(a2, a3, (t - t1) / (t3 - t1));
  return lerp(b1, b2, (t - t1) / (t2 - t1));
}

function makeDenseCatmullRom(points: Vec3[], spacing: number, alpha = 0.5): Vec3[] {
  if (points.length <= 2) return points.slice();
  const dense: Vec3[] = [points[0]];
  for (let i = 0; i + 1 < points.length; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = i > 0 ? points[i - 1] : add(p1, sub(p1, p2));
    const p3 = i + 2 < points.length ? points[i + 2] : add(p2, sub(p2, p1));
    const steps = Math.min(
      MAX_STEPS_PER_SEGMENT,
      Math.max(8, Math.ceil((dist(p1, p2) / Math.max(0.001, spacing)) * 5)),
    );
    for (let j = 1; j <= steps; j++) dense.push(catmullRomPoint(p0, p1, p2, p3, j / steps, alpha));
    if (dense.length > MAX_OUTPUT_POINTS) {
      throw new Error(`Slicer 曲线加密点数超过上限（${MAX_OUTPUT_POINTS}）：控制点坐标量级过大或重采样间距过小，请增大间距`);
    }
  }
  return dense;
}

function resampleByArcLength(points: Vec3[], spacing: number): Vec3[] {
  if (points.length <= 2) return points.slice();
  const out: Vec3[] = [points[0]];
  let carry = spacing;
  let prev = points[0];
  for (let i = 1; i < points.length; i++) {
    const cur = points[i];
    let seg = dist(prev, cur);
    while (seg >= carry && seg > 1e-9) {
      const t = carry / seg;
      const point = lerp(prev, cur, t);
      out.push(point);
      if (out.length > MAX_OUTPUT_POINTS) {
        throw new Error(`Slicer 曲线重采样点数超过上限（${MAX_OUTPUT_POINTS}）：控制点坐标量级过大或重采样间距过小，请增大间距`);
      }
      prev = point;
      seg = dist(prev, cur);
      carry = spacing;
    }
    carry -= seg;
    prev = cur;
  }
  const last = points[points.length - 1];
  if (dist(out[out.length - 1], last) > spacing * 0.25) out.push(last);
  return out;
}

export function smoothAndResample(points: unknown[], { spacing = 2, alpha = 0.5 } = {}): Vec3[] {
  const clean = points.map(cleanPoint).filter((point): point is Vec3 => Boolean(point));
  if (clean.length < 2) return [];
  if (clean.length > MAX_CONTROL_POINTS) {
    throw new Error(`Slicer 曲线控制点过多（${clean.length} > ${MAX_CONTROL_POINTS}）`);
  }
  const step = Math.max(0.05, Number(spacing) || 2);
  if (clean.length === 2) return resampleByArcLength(clean, step);
  return resampleByArcLength(makeDenseCatmullRom(clean, step, alpha), step);
}

export async function parseSlicerCurveFile(
  file: File,
  { spacing = 2 }: ParseSlicerCurveOptions = {},
): Promise<ParsedSlicerCurve[]> {
  const curves = parseSlicerMarkups(await file.text());
  if (!curves.length) throw new Error("没有找到 Slicer Curve controlPoints");
  return curves.map((curve) => ({
    ...curve,
    points: smoothAndResample(curve.controlPoints, { spacing }),
  })).filter((curve) => curve.points.length >= 2);
}

export const __slicerCurveForTests = { parseSlicerMarkups, smoothAndResample };
