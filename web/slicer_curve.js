const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Defensive caps so a malformed .mrk.json (e.g. two control points astronomically
// far apart with a tiny spacing) cannot spin an unbounded loop and freeze/OOM the tab.
const MAX_CONTROL_POINTS = 100000;
const MAX_STEPS_PER_SEGMENT = 4000;
const MAX_OUTPUT_POINTS = 500000;

function cleanPoint(p) {
  if (!Array.isArray(p) || p.length < 3) return null;
  const q = [Number(p[0]), Number(p[1]), Number(p[2])];
  return q.every(Number.isFinite) ? q : null;
}

function parseSlicerMarkups(text) {
  const data = JSON.parse(text);
  const markups = Array.isArray(data.markups) ? data.markups : [];
  return markups
    .filter((m) => !m.type || String(m.type).toLowerCase() === "curve")
    .map((m, i) => ({
      name: (typeof m.name === "string" && m.name) ? m.name : `slicer_curve_${i + 1}`,
      region: (typeof m.region === "string" && m.region) ? m.region : "slicer",
      coordinateSystem: data.coordinateSystem || m.coordinateSystem || "",
      controlPoints: (m.controlPoints || [])
        .map((cp) => cleanPoint(cp.position))
        .filter(Boolean),
    }))
    .filter((m) => m.controlPoints.length >= 2);
}

function catmullRomPoint(p0, p1, p2, p3, u, alpha = 0.5) {
  const eps = 1e-6;
  const tj = (ti, a, b) => ti + Math.max(eps, Math.pow(dist(a, b), alpha));
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;
  const A1 = lerp(p0, p1, (t - t0) / (t1 - t0));
  const A2 = lerp(p1, p2, (t - t1) / (t2 - t1));
  const A3 = lerp(p2, p3, (t - t2) / (t3 - t2));
  const B1 = lerp(A1, A2, (t - t0) / (t2 - t0));
  const B2 = lerp(A2, A3, (t - t1) / (t3 - t1));
  return lerp(B1, B2, (t - t1) / (t2 - t1));
}

function makeDenseCatmullRom(points, spacing, alpha = 0.5) {
  if (points.length <= 2) return points.slice();
  const dense = [points[0]];
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

function resampleByArcLength(points, spacing) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  let carry = spacing;
  let prev = points[0];
  for (let i = 1; i < points.length; i++) {
    let cur = points[i];
    let seg = dist(prev, cur);
    while (seg >= carry && seg > 1e-9) {
      const t = carry / seg;
      const p = lerp(prev, cur, t);
      out.push(p);
      if (out.length > MAX_OUTPUT_POINTS) {
        throw new Error(`Slicer 曲线重采样点数超过上限（${MAX_OUTPUT_POINTS}）：控制点坐标量级过大或重采样间距过小，请增大间距`);
      }
      prev = p;
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

export function smoothAndResample(points, { spacing = 2, alpha = 0.5 } = {}) {
  const clean = points.map(cleanPoint).filter(Boolean);
  if (clean.length < 2) return [];
  if (clean.length > MAX_CONTROL_POINTS) {
    throw new Error(`Slicer 曲线控制点过多（${clean.length} > ${MAX_CONTROL_POINTS}）`);
  }
  const step = Math.max(0.05, Number(spacing) || 2);
  if (clean.length === 2) return resampleByArcLength(clean, step);
  return resampleByArcLength(makeDenseCatmullRom(clean, step, alpha), step);
}

export async function parseSlicerCurveFile(file, { spacing = 2 } = {}) {
  const curves = parseSlicerMarkups(await file.text());
  if (!curves.length) throw new Error("没有找到 Slicer Curve controlPoints");
  return curves.map((curve) => ({
    ...curve,
    points: smoothAndResample(curve.controlPoints, { spacing }),
  })).filter((curve) => curve.points.length >= 2);
}

export const __slicerCurveForTests = { parseSlicerMarkups, smoothAndResample };
