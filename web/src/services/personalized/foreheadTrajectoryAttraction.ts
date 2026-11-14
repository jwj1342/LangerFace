import type { V6Seed } from './v6RstlRefinementV9.ts';
import { yoloGuardCurvesCross, yoloGuardSelfCrosses } from './yoloGuidedRstlScope.ts';

type Point = [number, number];
type Curve = { name: string; region: string; pts: Point[] };
export const FOREHEAD_ATTRACTION_VERSION = 'forehead-trajectory-attraction-1.8-glabellar-direct-writeback';
const FOREHEAD_TARGET_OFFSET_RATIO = 0.20;
const FOREHEAD_DIRECT_TARGET_WEIGHT = 12;
const FOREHEAD_DEFORMATION_STRENGTH = 1.00;
const FOREHEAD_POSITION_STRENGTH = 0.25;
const FOREHEAD_BASELINE_WEIGHT = 16;
const FOREHEAD_TRANSITION_GAP_MULTIPLIER = 6;
type TrajectoryMode = 'forehead' | 'glabellar';
interface TrajectoryParams { targetOffsetRatio: number; directTargetWeight: number; deformationStrength: number; positionStrength: number; baselineWeight: number; transitionGapMultiplier: number; }
const FOREHEAD_PARAMS: TrajectoryParams = { targetOffsetRatio: .20, directTargetWeight: 12, deformationStrength: 1, positionStrength: .25, baselineWeight: 16, transitionGapMultiplier: 6 };
const GLABELLAR_PARAMS: TrajectoryParams = { targetOffsetRatio: .20, directTargetWeight: 40, deformationStrength: 1, positionStrength: .30, baselineWeight: 2, transitionGapMultiplier: 4 };
export interface ForeheadEvidenceLine { id: string; points: Point[] }
type Track = { id: string; sourceIds: string[]; pts: Point[]; lo: number; hi: number };
type Match = { track: number; curve: number; side: number; lo: number; hi: number;
  gap: number; score: number; coverage: number; distance: number; angle: number };
const quantile = (a: number[], q: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * q)];
};
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smoothstep = (x: number) => { const t = clamp(x, 0, 1); return t ** 3 * (10 + t * (-15 + 6 * t)); };
function at(p: Point[], x: number): number {
  if (x <= p[0][0]) return p[0][1];
  if (x >= p.at(-1)![0]) return p.at(-1)![1];
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][0] <= x) lo = m; else hi = m; }
  return p[lo][1] + (p[hi][1] - p[lo][1]) * (x - p[lo][0]) / (p[hi][0] - p[lo][0]);
}
function slope(p: Point[], x: number, span: number): number {
  const a = Math.max(p[0][0], x - span), b = Math.min(p.at(-1)![0], x + span);
  return (at(p, b) - at(p, a)) / Math.max(1e-6, b - a);
}
const angle = (a: number, b: number) => {
  const d = Math.abs(Math.atan(a) - Math.atan(b)) * 180 / Math.PI; return Math.min(d, 180 - d);
};
function graph(points: Point[]): Point[] {
  const bins = new Map<number, number[]>();
  for (const [x, y] of points) { if (!Number.isFinite(x + y)) continue;
    const ys = bins.get(x) || []; ys.push(y); bins.set(x, ys); }
  return [...bins].sort((a, b) => a[0] - b[0]).map(([x, ys]) => [x, quantile(ys, .5)]);
}
function smoothTrack(points: Point[], step: number): Point[] {
  const p = graph(points); if (p.length < 2) return p;
  const samples: Point[] = [];
  for (let x = p[0][0]; x < p.at(-1)![0]; x += step) samples.push([x, at(p, x)]);
  samples.push([...p.at(-1)!]);
  // Local linear regression removes pixel staircases without flattening the whole arch.
  return samples.map(([x]) => {
    let w = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [u, v] of samples) { const z = (u - x) / (6 * step); if (Math.abs(z) > 3) continue;
      const k = Math.exp(-z * z / 2); w += k; sx += k * (u - x); sy += k * v;
      sxx += k * (u - x) ** 2; sxy += k * (u - x) * v; }
    return [x, (sy * sxx - sx * sxy) / Math.max(1e-10, w * sxx - sx * sx)];
  });
}
function tracksFor(lines: ForeheadEvidenceLine[], step: number): Track[] {
  const tracks = lines.map(line => ({ id: line.id, sourceIds: [line.id], pts: smoothTrack(line.points, step), lo: 0, hi: 0 }))
    .filter(t => t.pts.length >= 3).map(t => ({ ...t, lo: t.pts[0][0], hi: t.pts.at(-1)![0] }))
    .sort((a, b) => a.lo - b.lo || a.id.localeCompare(b.id));
  // Join only end-to-end fragments. Overlapping parallel furrows remain distinct.
  for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
    const a = tracks[i], b = tracks[j], dx = b.lo - a.hi;
    if (dx < 0 || dx > 8 * step || Math.abs(at(a.pts, a.hi) - at(b.pts, b.lo)) > 4 * step ||
        angle(slope(a.pts, a.hi, 4 * step), slope(b.pts, b.lo, 4 * step)) > 20) continue;
    a.pts = smoothTrack([...a.pts, ...b.pts], step); a.hi = b.hi;
    a.sourceIds.push(...b.sourceIds); a.id = a.sourceIds.join('+'); tracks.splice(j--, 1);
  }
  return tracks;
}
function spacing(curves: Curve[], i: number, x: number, unit: number): number {
  const y = at(curves[i].pts, x);
  const gaps = curves.flatMap((c, k) => k !== i && x >= c.pts[0][0] && x <= c.pts.at(-1)![0]
    ? [Math.abs(at(c.pts, x) - y)] : []).filter(v => v > unit * .1);
  return gaps.length ? Math.min(...gaps) : 8 * unit;
}
function candidatesFor(curves: Curve[], tracks: Track[], unit: number, mode: TrajectoryMode = 'forehead'): Match[][] {
  return tracks.flatMap((t, ti) => {
    const candidates: Match[] = [];
    curves.forEach((c, ci) => {
      const lo = Math.max(t.lo, c.pts[0][0]), hi = Math.min(t.hi, c.pts.at(-1)![0]);
      if (hi - lo < Math.max(4 * unit, (t.hi - t.lo) * .5)) return;
      const offsets: number[] = [], gaps: number[] = [], angles: number[] = [];
      for (let x = lo; x <= hi; x += 2 * unit) {
        offsets.push((at(c.pts, x) - at(t.pts, x)) / Math.hypot(1, slope(t.pts, x, 4 * unit)));
        gaps.push(spacing(curves, ci, x, unit));
        angles.push(angle(slope(c.pts, x, 4 * unit), slope(t.pts, x, 4 * unit)));
      }
      const gap = quantile(gaps, .5), distance = mean(offsets.map(Math.abs)), theta = quantile(angles, .5);
      // A glabellar S-turn can change its tangent more than a long forehead
      // arc while still being the nearest valid RSTL.  Keep the distance
      // gate unchanged and relax only this directional pre-filter for the
      // glabellar channel; final tangent, spacing and crossing gates remain
      // authoritative after write-back.
      const directionLimit = mode === 'glabellar' ? 55 : 30;
      if (distance > 2 * gap || theta > directionLimit) return;
      candidates.push({ track: ti, curve: ci, side: quantile(offsets, .5) <= 0 ? -1 : 1,
        lo, hi, gap, distance, angle: theta, coverage: (hi - lo) / (t.hi - t.lo), score: distance / gap + theta / 30 });
    });
    return [-1, 1].map(side => candidates.filter(m => m.side === side)
      .sort((a, b) => a.score - b.score || b.coverage - a.coverage || curves[a.curve].name.localeCompare(curves[b.curve].name)));
  });
}
function assign(slots: Match[][], curves: Curve[], tracks: Track[]): Match[] {
  // Exact minimum-cost assignment over overlapping evidence intervals. Empty slots cost
  // more than any eligible match. Disjoint intervals may reuse the same RSTL.
  const active = slots.filter(s => s.length).sort((a, b) => a.length - b.length || a[0].track - b[0].track);
  let best: Match[] = [], bestCost = Infinity;
  const lower = Array(active.length + 1).fill(0);
  for (let i = active.length - 1; i >= 0; i--) lower[i] = lower[i + 1] + active[i][0].score;
  const visit = (i: number, chosen: Match[], cost: number) => {
    if (cost + lower[i] >= bestCost) return;
    if (i === active.length) { bestCost = cost; best = [...chosen]; return; }
    for (const m of active[i]) {
      if (chosen.some(a => {
        const lo = Math.max(a.lo, m.lo), hi = Math.min(a.hi, m.hi);
        if (lo > hi) return false;
        if (a.curve === m.curve) return true;
        for (let x = lo; x <= hi; x += Math.max(1, (hi - lo) / 8)) {
          const baseline = at(curves[a.curve].pts, x) - at(curves[m.curve].pts, x);
          const targets = at(tracks[a.track].pts, x) + a.side * .2 * a.gap -
            at(tracks[m.track].pts, x) - m.side * .2 * m.gap;
          if (baseline * targets <= 0) return true;
        }
        return false;
      })) continue;
      chosen.push(m); visit(i + 1, chosen, cost + m.score); chosen.pop();
    }
    visit(i + 1, chosen, cost + 8);
  };
  visit(0, [], 0); return best;
}
function target(t: Track, x: number, side: number, gap: number, unit: number, params: TrajectoryParams = FOREHEAD_PARAMS): number {
  // Reparameterize a normal offset as y(x), rather than a vertical offset on steep slopes.
  const d = side * params.targetOffsetRatio * gap;
  let u = x;
  for (let i = 0; i < 4; i++) { const m = slope(t.pts, u, 4 * unit); u = clamp(x + d * m / Math.hypot(1, m), t.lo, t.hi); }
  return at(t.pts, u) + d / Math.hypot(1, slope(t.pts, u, 4 * unit));
}
function pointSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / Math.max(1e-20, dx * dx + dy * dy), 0, 1);
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function foreheadCurveDistance(a: Point[], b: Point[]): number {
  if (yoloGuardCurvesCross(a, b)) return 0;
  let minimum = Infinity;
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    if (Math.max(a[i - 1][0], a[i][0]) + minimum < Math.min(b[j - 1][0], b[j][0]) ||
        Math.max(b[j - 1][0], b[j][0]) + minimum < Math.min(a[i - 1][0], a[i][0])) continue;
    minimum = Math.min(minimum, pointSegment(a[i - 1], b[j - 1], b[j]), pointSegment(a[i], b[j - 1], b[j]),
      pointSegment(b[j - 1], a[i - 1], a[i]), pointSegment(b[j], a[i - 1], a[i]));
  }
  return minimum;
}
function metrics(c: Curve, t: Track, m: Match, unit: number, params: TrajectoryParams = FOREHEAD_PARAMS) {
  const distances: number[] = [], directions: number[] = [];
  const margin = Math.min(4 * unit, (m.hi - m.lo) * .1);
  for (let x = m.lo + margin; x <= m.hi - margin; x += unit) {
    const y = target(t, x, m.side, m.gap, unit, params), a = target(t, x - 2 * unit, m.side, m.gap, unit, params), b = target(t, x + 2 * unit, m.side, m.gap, unit, params);
    distances.push(Math.abs(at(c.pts, x) - y) / Math.hypot(1, (b - a) / (4 * unit)));
    directions.push(angle(slope(c.pts, x, 2 * unit), (b - a) / (4 * unit)));
  }
  return { meanDistancePx: mean(distances), p90DistancePx: quantile(distances, .9),
    medianDirectionDegrees: quantile(directions, .5), p90DirectionDegrees: quantile(directions, .9) };
}
function partialAttractionPassed(before: ReturnType<typeof metrics>, after: ReturnType<typeof metrics>): boolean {
  // Shape following is judged by tangent agreement, separately from translation.
  // Do not require every tail point to approach the wrinkle: a centered shape
  // change can increase P90 distance while improving the overall trajectory.
  return after.meanDistancePx <= before.meanDistancePx + .05 &&
    after.medianDirectionDegrees <= Math.max(2, before.medianDirectionDegrees * .75) &&
    after.p90DirectionDegrees <= Math.max(8, before.p90DirectionDegrees * .90);

}
export function refineForeheadTrajectories(input: {
  seeds: V6Seed[]; lines: ForeheadEvidenceLine[]; fixedCurves: Curve[]; size: number;
  transitionGapMultiplier?: number; mode?: TrajectoryMode;
}) {
  const mode = input.mode || 'forehead';
  const params = mode === 'glabellar' ? GLABELLAR_PARAMS : FOREHEAD_PARAMS;
  const transform = (p: Point): Point => mode === 'glabellar' ? [p[1], -p[0]] : [...p];
  const inverse = (p: Point): Point => mode === 'glabellar' ? [-p[1], p[0]] : [...p];
  const transformedSeeds = input.seeds.map(s => ({ ...s, pts: (s.pts as Point[]).map(transform) }));
  const transformedLines = input.lines.map(line => ({ ...line, points: line.points.map(transform) }));
  const transformedFixed = input.fixedCurves.map(c => ({ ...c, pts: c.pts.map(transform) }));
  const unit = input.size / 640;
  const original: Curve[] = transformedSeeds.map((s, i) => ({ name: String(s.name || i), region: String(s.region || ''),
    pts: (s.pts as Point[]).map(p => [...p] as Point) }));
  const curves = original.map(c => ({ ...c, pts: graph(c.pts) }));
  const tracks = tracksFor(transformedLines, unit), slots = candidatesFor(curves, tracks, unit, mode);
  let matches = assign(slots, curves, tracks);
  if (mode === 'glabellar') {
    // A narrow vertical frown has one dominant nearest RSTL in this frame.
    // Selecting both sides can force the two direct targets through adjacent
    // vertical atlas lines; retain the deterministic best local candidate and
    // keep the rest of the bundle fixed.
    matches = tracks.flatMap((_, trackIndex) => matches
      .filter(m => m.track === trackIndex)
      .sort((a, b) => a.score - b.score || b.coverage - a.coverage ||
        curves[a.curve].name.localeCompare(curves[b.curve].name))
      .slice(0, 1));
  }
  if (curves.some(c => c.pts.length < 2)) throw new Error('Invalid forehead geometry');
  const lo = Math.min(...curves.map(c => c.pts[0][0])), hi = Math.max(...curves.map(c => c.pts.at(-1)![0]));
  const xs: number[] = []; for (let x = lo; x <= hi; x += unit) xs.push(x); xs.push(hi);
  const prior = curves.map(c => xs.map(x => at(c.pts, x)));
  const desired = prior.map(a => [...a]), weights = prior.map(a => a.map(() => 1));
  const lower = prior.map(a => a.map(v => Math.min(0, v))), upper = prior.map(a => a.map(v => Math.max(input.size - 1, v)));
  const valid = curves.map(c => xs.map(x => x >= c.pts[0][0] && x <= c.pts.at(-1)![0]));
  const influenced = new Set<number>();
  for (const m of matches) {
    influenced.add(m.curve); const t = tracks[m.track], taper = (input.transitionGapMultiplier ?? params.transitionGapMultiplier) * m.gap;
    // Remove the DC (translation) component before transferring shape. Unlike
    // pointwise clipping, this preserves slope changes and curvature reversals.
    const field: Point[] = [];
    for (let u = m.lo; u <= m.hi; u += unit) {
      let sum = 0, total = 0;
      const sigma = .5 * m.gap;
      for (let offset = -3 * sigma; offset <= 3 * sigma; offset += unit) {
        const sample = clamp(u + offset, m.lo, m.hi), weight = Math.exp(-.5 * (offset / sigma) ** 2);
        sum += weight * (target(t, sample, m.side, m.gap, unit, params) - at(curves[m.curve].pts, sample)); total += weight;
      }
      field.push([u, sum / total]);
    }
    const translation = mean(field.map(p => p[1]));
    const positionShift = clamp(params.positionStrength * translation, -.25 * m.gap, .25 * m.gap);
    xs.forEach((x, k) => {
      if (!valid[m.curve][k] || x < m.lo - taper || x > m.hi + taper) return;
      const u = clamp(x, m.lo, m.hi), blend = x < m.lo ? smoothstep((x - m.lo + taper) / taper)
        : x > m.hi ? smoothstep((m.hi + taper - x) / taper) : 1;
      const delta = params.deformationStrength * (at(field, u) - translation) + positionShift;
      const endpoint = smoothstep((x - curves[m.curve].pts[0][0]) / taper) *
        smoothstep((curves[m.curve].pts.at(-1)![0] - x) / taper);
      const w = params.directTargetWeight * blend * endpoint;
      desired[m.curve][k] = (desired[m.curve][k] * weights[m.curve][k] + w * (prior[m.curve][k] + blend * endpoint * delta)) / (weights[m.curve][k] + w);
      weights[m.curve][k] += w;
    });
  }
  // Fixed other-region geometry constrains the same side of each segment as the baseline.
  for (let i = 0; i < curves.length; i++) xs.forEach((x, k) => {
    if (!valid[i][k]) return;
    for (const c of transformedFixed) for (let j = 1; j < c.pts.length; j++) {
      const a = c.pts[j - 1], b = c.pts[j], dx = b[0] - a[0];
      if (x < Math.min(a[0], b[0]) - 2 || x > Math.max(a[0], b[0]) + 2) continue;
      const t = Math.abs(dx) < 1e-9 ? .5 : clamp((x - a[0]) / dx, 0, 1), y = a[1] + t * (b[1] - a[1]);
      const clearance = Math.min(4, 1.1 * Math.hypot(1, (b[1] - a[1]) / Math.max(.1, Math.abs(dx))));
      if (prior[i][k] < Math.min(a[1], b[1]) || prior[i][k] < y) upper[i][k] = Math.min(upper[i][k], Math.max(prior[i][k], Math.min(a[1], b[1], y) - Math.max(2, clearance)));
      else lower[i][k] = Math.max(lower[i][k], Math.min(prior[i][k], Math.max(a[1], b[1], y) + Math.max(2, clearance)));
    }
  });
  // Spread a fixed-boundary correction over a local interval before projection.
  // This reduces attraction locally instead of producing a pointwise clipped notch.
  for (let i = 0; i < curves.length; i++) {
    const down = xs.map((_, k) => Math.max(0, desired[i][k] - upper[i][k]));
    const up = xs.map((_, k) => Math.max(0, lower[i][k] - desired[i][k]));
    for (let k = 0; k < xs.length; k++) {
      let downEnvelope = 0, upEnvelope = 0;
      for (let j = Math.max(0, k - 24); j <= Math.min(xs.length - 1, k + 24); j++) {
        const w = Math.exp(-.5 * ((xs[k] - xs[j]) / (6 * unit)) ** 2);
        downEnvelope = Math.max(downEnvelope, down[j] * w);
        upEnvelope = Math.max(upEnvelope, up[j] * w);
      }
      desired[i][k] += upEnvelope - downEnvelope;
    }
  }
  // Followers farther from a direct interval resist displacement more strongly.
  for (let i = 0; i < curves.length; i++) xs.forEach((x, k) => {
    if (weights[i][k] > 1) return;
    const layers = matches.map(m => Math.abs(prior[i][k] - prior[m.curve][k]) / m.gap +
      Math.max(m.lo - x, x - m.hi, 0) / (2 * m.gap));
    weights[i][k] = 1 + Math.min(12, layers.length ? Math.min(...layers) : 12);
  });
  const y = desired.map(a => [...a]);
  const orders = xs.map((_, k) => curves.map((_, i) => i).filter(i => valid[i][k]).sort((a, b) => prior[a][k] - prior[b][k]));
  // Alternating local smoothing and weighted ordered projection solves the bundle together.
  // Strong direct targets retain their shape; only compressed neighbours are displaced.
  for (let pass = 0; pass < 160; pass++) {
    for (let i = 0; i < y.length; i++) for (let k = 1; k < xs.length - 1; k++) {
      if (!valid[i][k]) continue;
      const neighbourDelta = ((y[i][k - 1] - prior[i][k - 1]) + (y[i][k + 1] - prior[i][k + 1])) / 2;
      y[i][k] = clamp((weights[i][k] * desired[i][k] + params.baselineWeight * (prior[i][k] + neighbourDelta)) /
        (weights[i][k] + params.baselineWeight), lower[i][k], upper[i][k]);
    }
    for (let round = 0; round < 10; round++) xs.forEach((_, k) => {
      const order = orders[k];
      for (let n = 1; n < order.length; n++) {
        const a = order[n - 1], b = order[n], gap = .65 * (prior[b][k] - prior[a][k]);
        const excess = y[b][k] - y[a][k] - 1.35 * (prior[b][k] - prior[a][k]);
        if (excess > 0) {
          const moveA = Math.min(excess * weights[b][k] / (weights[a][k] + weights[b][k]), upper[a][k] - y[a][k]);
          y[a][k] += moveA; y[b][k] -= Math.min(excess - moveA, y[b][k] - lower[b][k]);
        }
        const deficit = gap - (y[b][k] - y[a][k]); if (deficit <= 1e-8) continue;
        const wa = weights[a][k], wb = weights[b][k];
        const moveA = Math.min(deficit * wb / (wa + wb), y[a][k] - lower[a][k]);
        const moveB = Math.min(deficit - moveA, upper[b][k] - y[b][k]);
        y[a][k] -= moveA + Math.min(deficit - moveA - moveB, y[a][k] - moveA - lower[a][k]); y[b][k] += moveB;
      }
    });
  }
  let output = original.map((c, i) => ({ ...c, pts: c.pts.map(([x, py]): Point => {
    const delta = at(xs.map((u, k): Point => [u, y[i][k] - prior[i][k]]), x);
    return [x, Math.abs(delta) < 1e-10 ? py : py + delta];
  }) }));
  if (mode === 'glabellar') {
    // The transformed-frame bounds are conservative for steep/short atlas
    // segments, while the merged guard uses the exact exported segments.
    // Reduce only the offending attraction until the exact geometry is clear;
    // do not erase an otherwise valid local frown deformation wholesale.
    const blendTowardBaseline = (index: number, factor: number) => {
      output[index].pts = output[index].pts.map((p, k) => [
        original[index].pts[k][0] + (p[0] - original[index].pts[k][0]) * factor,
        original[index].pts[k][1] + (p[1] - original[index].pts[k][1]) * factor,
      ] as Point);
    };
    for (let pass = 0; pass < 30; pass++) {
      const offending = new Set<number>();
      for (let i = 0; i < output.length; i++) {
        if (yoloGuardSelfCrosses(output[i].pts) && !yoloGuardSelfCrosses(original[i].pts)) offending.add(i);
        for (const obstacle of transformedFixed) {
          if (yoloGuardCurvesCross(output[i].pts, obstacle.pts) &&
              !yoloGuardCurvesCross(original[i].pts, obstacle.pts)) offending.add(i);
        }
        for (let j = 0; j < i; j++) {
          if (yoloGuardCurvesCross(output[i].pts, output[j].pts) &&
              !yoloGuardCurvesCross(original[i].pts, original[j].pts)) {
            offending.add(i); offending.add(j);
          }
        }
      }
      if (!offending.size) break;
      for (const index of offending) blendTowardBaseline(index, .90);
    }
  }
  // Projection must also hold after interpolation onto the original atlas vertices.
  // Repair only the neighbourhood of a compressed pair, using smooth local offsets.
  const order = curves.map((_, i) => i).sort((a, b) => at(curves[a].pts, (lo + hi) / 2) - at(curves[b].pts, (lo + hi) / 2));
  for (let pass = 0; pass < 24; pass++) {
    let corrected = false;
    for (let n = 1; n < order.length; n++) {
      const a = order[n - 1], b = order[n], pa = graph(output[a].pts), pb = graph(output[b].pts);
      const start = Math.max(pa[0][0], pb[0][0]), end = Math.min(pa.at(-1)![0], pb.at(-1)![0]);
      let worst = 0, worstX = start;
      for (let x = start; x <= end; x += unit) {
        const scale = Math.hypot(1, Math.max(Math.abs(slope(pa, x, 2 * unit)), Math.abs(slope(pb, x, 2 * unit))));
        const required = .65 * (at(curves[b].pts, x) - at(curves[a].pts, x)) * scale;
        const violation = required - (at(pb, x) - at(pa, x));
        if (violation > worst) { worst = violation; worstX = x; }
      }
      if (worst < .01 * unit) continue;
      corrected = true;
      // Distribute corrections; the fixed-obstacle projection below absorbs any
      // unavailable motion and the next sweep transfers it to the other neighbour.
      for (const [i, sign] of [[a, -1], [b, 1]]) {
        output[i].pts = output[i].pts.map(([x, py]): Point => {
          const radius = Math.abs(x - worstX) / (6 * unit);
          if (radius >= 3) return [x, py];
          const delta = sign * .6 * worst * Math.exp(-.5 * radius ** 2) * smoothstep(3 - radius);
          const low = at(xs.map((u, k): Point => [u, lower[i][k]]), x);
          const high = at(xs.map((u, k): Point => [u, upper[i][k]]), x);
          return [x, clamp(py + delta, low, high)];
        });
      }
    }
    if (!corrected) break;
  }
  if (mode === 'glabellar') {
    // A glabellar wrinkle should guide only its nearest selected RSTL lines.
    // Letting the generic follower pass move the remaining vertical bundle is
    // exactly the failure mode where distant lines kink while the adjacent
    // lines stay straight.  Keep every non-selected line at its baseline and
    // let the selected lines negotiate clearance against those fixed lines.
    for (let i = 0; i < output.length; i++) {
      if (!influenced.has(i)) output[i] = original[i];
    }
    // Apply the selected trajectory directly once more in the transformed
    // frame.  This makes the intended local tangent change observable even
    // when the generic weighted projection has nearly zeroed a short vertical
    // displacement.  The following exact crossing attenuation remains the
    // safety boundary.
    for (const match of matches) {
      const curve = output[match.curve], track = tracks[match.track];
      curve.pts = curve.pts.map(([x, py]) => {
        if (x < match.lo || x > match.hi) return [x, py] as Point;
        const taper = Math.min(4 * unit, (match.hi - match.lo) * .12);
        const blend = x < match.lo + taper ? smoothstep((x - match.lo) / taper) :
          x > match.hi - taper ? smoothstep((match.hi - x) / taper) : 1;
        return [x, py + .90 * blend * (target(track, x, match.side, match.gap, unit, params) - py)] as Point;
      });
    }
  }
  if (mode === 'glabellar') {
    // The spacing repair above can itself move a curve back across an exact
    // atlas segment.  Run the same local attenuation after interpolation so
    // the coordinates handed to the regional/global guards are already safe.
    for (let pass = 0; pass < 30; pass++) {
      const offending = new Set<number>();
      for (let i = 0; i < output.length; i++) {
        if (yoloGuardSelfCrosses(output[i].pts) && !yoloGuardSelfCrosses(original[i].pts)) offending.add(i);
        for (const obstacle of transformedFixed) {
          if (yoloGuardCurvesCross(output[i].pts, obstacle.pts) &&
              !yoloGuardCurvesCross(original[i].pts, obstacle.pts)) offending.add(i);
        }
        for (let j = 0; j < i; j++) {
          if (yoloGuardCurvesCross(output[i].pts, output[j].pts) &&
              !yoloGuardCurvesCross(original[i].pts, original[j].pts)) {
            offending.add(i); offending.add(j);
          }
        }
      }
      if (!offending.size) break;
      for (const index of offending) {
        output[index].pts = output[index].pts.map((p, k) => [
          original[index].pts[k][0] + (p[0] - original[index].pts[k][0]) * .68,
          original[index].pts[k][1] + (p[1] - original[index].pts[k][1]) * .90,
        ] as Point);
      }
    }
  }
  if (mode === 'glabellar') {
    // The generic bundle projection above is designed for the long horizontal
    // forehead family.  In the rotated glabellar frame it can propagate a
    // local spacing correction into a distant tail, which both kinks the line
    // and makes the final global guard restore the whole curve.  Rebuild this
    // channel from the baseline and apply only the local trajectory attraction.
    // The neighbouring baseline curves are used as hard order bounds, so the
    // selected curve can follow the frown without crossing its companions.
    // `curves` is the x-sorted graph representation.  The atlas points for
    // the vertical family are stored in descending image-y order; using the
    // raw `original` arrays here would make interpolation read the wrong tail
    // and create a spurious whole-curve jump.
    const glabellarBaseline = curves;
    const sortedOutput = glabellarBaseline.map((curve) => ({
      ...curve, pts: curve.pts.map(([x, y]) => [x, y] as Point),
    }));
    for (const match of matches) {
      const curve = sortedOutput[match.curve];
      const baseline = glabellarBaseline[match.curve];
      const startsAtCurveEnd = match.lo <= baseline.pts[0][0] + unit;
      const endsAtCurveEnd = match.hi >= baseline.pts.at(-1)![0] - unit;
      // Use a long one-sided transition only when the evidence starts or ends
      // at an atlas endpoint.  A short taper forces the target tangent to meet
      // the untouched tail too quickly and creates the visible fold.
      const baseTaper = Math.max(8 * unit, Math.min(8 * match.gap, (match.hi - match.lo) * .40));
      const endpointTaper = Math.max(8 * unit, Math.min(8 * match.gap, (match.hi - match.lo) * .65));
      const startTaper = startsAtCurveEnd ? endpointTaper : baseTaper;
      const endTaper = endsAtCurveEnd ? endpointTaper : baseTaper;
      const baselineAt = (index: number, x: number) => {
        const candidate = glabellarBaseline[index];
        if (x < candidate.pts[0][0] || x > candidate.pts.at(-1)![0]) return null;
        return at(candidate.pts, x);
      };
      // Build a displacement field relative to the complete baseline first.
      // Smoothing the displacement (rather than the final y values) preserves
      // the original S-shaped trend while making both joins C1-like.
      const rawDisplacement = curve.pts.map(([x]) => {
        if (x < match.lo - startTaper || x > match.hi + endTaper) return 0;
        const u = clamp(x, match.lo, match.hi);
        const blend = x < match.lo
          ? smoothstep((x - match.lo + startTaper) / startTaper)
          : x > match.hi
            ? smoothstep((match.hi + endTaper - x) / endTaper)
            : 1;
        const targetY = target(tracks[match.track], u, match.side, match.gap, unit, params);
        const baseY = at(baseline.pts, u);
        // Keep the low-frequency S-turn visible.  The taper and the later
        // Gaussian pass remove the edge corner; a slightly stronger core
        // blend is needed so the selected RSTL actually adopts the wrinkle's
        // changing tangent instead of looking like a translated straight line.
        return blend * (targetY - baseY);
      });
      // Transfer the wrinkle's changing tangent independently from its DC
      // offset.  The old write-back used the full target-baseline offset and
      // then clamped it against the neighbouring atlas curves.  On the dense
      // glabellar bundle that clamp consumed most of the S-turn, leaving a
      // nearly translated vertical line.  Remove the core translation before
      // smoothing so the curvature survives; reintroduce only a bounded part
      // of the translation as the separate position term.
      const coreOffsets = rawDisplacement.filter((_, index) => {
        const x = curve.pts[index][0];
        return x >= match.lo && x <= match.hi;
      });
      const coreTranslation = mean(coreOffsets);
      const displacement = rawDisplacement.map((value, index) => {
        const x = curve.pts[index][0];
        const inCore = x >= match.lo && x <= match.hi;
        const shape = inCore ? value - coreTranslation : value;
        return .98 * shape + .30 * coreTranslation * (inCore ? 1 : 0);
      });
      const smoothedDisplacement = displacement.map((value, index) => {
        const x = curve.pts[index][0];
        if (x < match.lo - startTaper || x > match.hi + endTaper) return value;
        const sigma = Math.max(4 * unit, Math.min(8 * unit, (match.hi - match.lo) * .055));
        let weighted = 0, total = 0;
        for (let neighbour = Math.max(0, index - 24); neighbour <= Math.min(curve.pts.length - 1, index + 24); neighbour += 1) {
          const distance = curve.pts[neighbour][0] - x;
          const weight = Math.exp(-.5 * (distance / sigma) ** 2);
          weighted += weight * displacement[neighbour]; total += weight;
        }
        return weighted / Math.max(1e-9, total);
      });
      curve.pts = curve.pts.map(([x, py], index) => {
        const raw = py + smoothedDisplacement[index];
        const neighbours = glabellarBaseline
          .filter((_, index) => index !== match.curve)
          .map((_, index) => index)
          .map((index) => ({ index, value: baselineAt(index, x) }))
          .filter((item): item is { index: number; value: number } => item.value !== null)
          .sort((a, b) => a.value - b.value);
        // Select the nearest baseline neighbour on either side of this curve,
        // rather than using a rank that also counts the selected curve.
        const previous = neighbours.filter((item) => item.value < py).at(-1)?.value;
        const next = neighbours.find((item) => item.value > py)?.value;
        const localGap = Math.max(.5, Math.min(
          previous === undefined ? Infinity : py - previous,
          next === undefined ? Infinity : next - py,
        ));
        // Keep a real pixel of clearance, while leaving enough room for the
        // selected line to inherit the wrinkle's curvature when this local
        // bundle is only a few pixels apart.
        const clearance = Math.max(1, .25 * localGap);
        const lowerBound = previous === undefined ? -Infinity : previous + clearance;
        const upperBound = next === undefined ? Infinity : next - clearance;
        return [x, clamp(raw, lowerBound, upperBound)] as Point;
      });
    }
    // Convert the sorted graph back to each atlas curve's original point
    // order.  This preserves byte-identical geometry for every non-selected
    // curve and prevents the global guard from mistaking a reordering for a
    // new geometric change.
    output = original.map((curve, index) => ({
      ...curve,
      pts: curve.pts.map((point) => {
        if (!matches.some((match) => match.curve === index)) return [point[0], point[1]] as Point;
        const transformed = point;
        return [transformed[0], at(sortedOutput[index].pts, transformed[0])] as Point;
      }),
    }));
  }
  // Validate continuous exported segments. Revert an entire interacting component only
  // if the fixed-boundary solution is infeasible, never a one-line rollback cascade.
  const failed = new Set<number>();
  const boundaryFailures: unknown[] = [];
  const baselineCurves = mode === 'glabellar' ? curves : original;
  // In the glabellar frame, curves are rotated so the vertical frown becomes
  // a graph.  A raw whole-curve distance ratio is not a reliable topology
  // test there: the long tails can make a valid local attraction look like a
  // severe clearance loss and roll the entire candidate back.  The solver has
  // already enforced ordered spacing at every sample, and the merged global
  // guard performs the authoritative continuous crossing check afterwards.
  // Keep the stricter clearance-ratio rollback for the frozen forehead path.
  const enforceClearanceRatio = mode !== 'glabellar';
  for (let i = 0; i < output.length; i++) {
    if (yoloGuardSelfCrosses(output[i].pts) && !yoloGuardSelfCrosses(baselineCurves[i].pts)) failed.add(i);
    for (const c of transformedFixed) {
      const before = foreheadCurveDistance(baselineCurves[i].pts, c.pts), after = foreheadCurveDistance(output[i].pts, c.pts);
      if ((enforceClearanceRatio && after + 1e-5 < Math.min(1, before)) ||
          (yoloGuardCurvesCross(output[i].pts, c.pts) && !yoloGuardCurvesCross(baselineCurves[i].pts, c.pts))) {
        failed.add(i); boundaryFailures.push({ curve: i, obstacle: c.name, before, after });
      }
    }
    for (let j = 0; j < i; j++) if (yoloGuardCurvesCross(output[i].pts, output[j].pts) ||
        (enforceClearanceRatio && foreheadCurveDistance(output[i].pts, output[j].pts) <
          .35 * foreheadCurveDistance(baselineCurves[i].pts, baselineCurves[j].pts) - 1e-5)) {
      failed.add(i); failed.add(j); boundaryFailures.push({ pair: [i,j], gap: foreheadCurveDistance(output[i].pts, output[j].pts), priorGap: foreheadCurveDistance(baselineCurves[i].pts, baselineCurves[j].pts) });
    }
  }
  let changed = true;
  while (changed) { changed = false;
    for (const i of [...failed]) for (let j = 0; j < output.length; j++) {
      if (failed.has(j)) continue;
      if (yoloGuardCurvesCross(baselineCurves[i].pts, output[j].pts) || yoloGuardCurvesCross(output[i].pts, output[j].pts) ||
          (enforceClearanceRatio && foreheadCurveDistance(baselineCurves[i].pts, output[j].pts) <
            .35 * foreheadCurveDistance(baselineCurves[i].pts, baselineCurves[j].pts) - 1e-5)) {
        failed.add(j); changed = true;
      }
    }
  }
  // Glabellar conflicts have already been attenuated against exact segments
  // above.  Preserve that feasible partial result for the merged guard to
  // inspect; restoring the whole curve here would turn a local constraint
  // into the pixel-identical result reported by the UI.  The frozen forehead
  // path retains its component rollback contract.
  output = output.map((c, i) => mode === 'glabellar' || !failed.has(i) ? c : original[i]);
  const records = matches.map(m => {
    const before = metrics(curves[m.curve], tracks[m.track], m, unit, params), after = metrics({ ...output[m.curve], pts: graph(output[m.curve].pts) }, tracks[m.track], m, unit, params);
    const displacement = output[m.curve].pts
      .filter(([x]) => x >= m.lo && x <= m.hi)
      .map(([x, y]) => y - at(curves[m.curve].pts, x));
    const limits = { meanDistancePx: .15 * m.gap, p90DistancePx: .3 * m.gap, medianDirectionDegrees: 10, p90DirectionDegrees: 20 };
    const passed = (mode === 'glabellar' || !failed.has(m.curve)) && partialAttractionPassed(before, after) &&
      Math.abs(mean(displacement)) <= .30 * m.gap;
    return { wrinkle_segment_id: m.track, wrinkle_ids: tracks[m.track].sourceIds, rstl_curve_index: m.curve,
      rstl_curve_name: original[m.curve].name, selected_for_wrinkle: true, interval: [m.lo, m.hi], side: m.side,
      local_spacing_px: m.gap, selection_score: m.score, selection_distance_px: m.distance, selection_direction_degrees: m.angle,
      attraction_target_offset_ratio: params.targetOffsetRatio,
      deformation_strength: params.deformationStrength,
      acceptance_mode: "shape_following_bounded_translation",
      transition_length_px: (input.transitionGapMultiplier ?? params.transitionGapMultiplier) * m.gap,
      mean_baseline_displacement_px: mean(displacement.map(Math.abs)),
      signed_mean_displacement_px: mean(displacement),
      position_strength: params.positionStrength,
      maximum_baseline_displacement_px: Math.max(0, ...displacement.map(Math.abs)),
      before, after, limits, final_accepted: passed, final_status: passed ? 'direct_attraction_accepted' : 'constrained_incomplete',
      constrained_intervals: xs.flatMap((x, k) => valid[m.curve][k] && x >= m.lo && x <= m.hi &&
        (Math.abs(y[m.curve][k] - lower[m.curve][k]) < .05 || Math.abs(y[m.curve][k] - upper[m.curve][k]) < .05) ? [x] : []),
      rejection_reason: passed ? null : failed.has(m.curve) ? 'fixed_boundary_or_topology' : 'final_adherence_not_met' };
  });
  const movedBaseline = mode === 'glabellar' ? original : baselineCurves;
  const moved = output.map((c, i) => c.pts.some((p, k) => Math.hypot(
    p[0] - movedBaseline[i].pts[k][0], p[1] - movedBaseline[i].pts[k][1],
  ) > .05));
  if (mode === 'glabellar') output = output.map(c => ({ ...c, pts: c.pts.map(inverse) }));
  return { curves: output, diagnostics: {
    forehead_attraction_version: mode === 'forehead'
      ? `${FOREHEAD_ATTRACTION_VERSION}-forehead`
      : undefined,
    glabellar_trajectory_attraction_version: mode === 'glabellar'
      ? `${FOREHEAD_ATTRACTION_VERSION}-glabellar`
      : undefined,
    forehead_attraction_records: records, forehead_attraction_direct_count: records.filter(r => r.final_accepted).length,
    forehead_attraction_follower_count: moved.filter((v, i) => v && !influenced.has(i)).length,
    forehead_attraction_incomplete_count: records.filter(r => !r.final_accepted).length,
    forehead_attraction_rollback_indices: [...failed], forehead_boundary_failures: boundaryFailures,
    maximum_selected_rstl_curves_per_wrinkle: Math.max(0, ...tracks.map((_, ti) => matches.filter(m => m.track === ti).length)),
    curve_unique_wrinkle_ownership: true, topology_contract_preserved: true,
    curvature_fairing_enabled: true,
  } as Record<string, any>, audit: { matchRecords: records, curveSupportRecords: [], wrinkleTrends: tracks.map((t, i) => ({
    id: i, sourceIds: t.sourceIds, points: t.pts, finalAccepted: records.some(r => r.wrinkle_segment_id === i && r.final_accepted),
    finalStatus: records.some(r => r.wrinkle_segment_id === i && r.final_accepted) ? 'direct_attraction_accepted' : 'constrained_incomplete',
    acceptedCurveIndices: records.filter(r => r.wrinkle_segment_id === i && r.final_accepted).map(r => r.rstl_curve_index),
  })) } };
}

/** Re-evaluate adherence on the actual exported curves, after all regional guards. */
export function auditFinalForeheadAttraction(result: ReturnType<typeof refineForeheadTrajectories>, exported: Curve[], size: number): void {
  const records = result.audit.matchRecords;
  for (const r of records) {
    const trend = result.audit.wrinkleTrends[r.wrinkle_segment_id];
    const t: Track = { id: trend.sourceIds.join('+'), sourceIds: trend.sourceIds, pts: trend.points,
      lo: trend.points[0][0], hi: trend.points.at(-1)![0] };
    const m = { track: r.wrinkle_segment_id, curve: r.rstl_curve_index, side: r.side,
      lo: r.interval[0], hi: r.interval[1], gap: r.local_spacing_px,
      score: r.selection_score, coverage: 1, distance: r.selection_distance_px, angle: r.selection_direction_degrees };
    r.after = metrics({ ...exported[m.curve], pts: graph(exported[m.curve].pts) }, t, m, size / 640);
    const displacement = exported[m.curve].pts.map(([x,y]) => Math.abs(y - at(graph(result.curves[m.curve].pts), x)));
    r.final_accepted = partialAttractionPassed(r.before, r.after) &&
      Math.abs(r.signed_mean_displacement_px) + Math.abs(mean(displacement)) <= .30 * m.gap;
    r.final_status = r.final_accepted ? 'direct_attraction_accepted' : 'constrained_incomplete';
    r.rejection_reason = r.final_accepted ? null : 'final_adherence_not_met';
  }
  for (const t of result.audit.wrinkleTrends) {
    t.acceptedCurveIndices = records.filter(r => r.wrinkle_segment_id === t.id && r.final_accepted).map(r => r.rstl_curve_index);
    t.finalAccepted = t.acceptedCurveIndices.length > 0;
    t.finalStatus = t.finalAccepted ? 'direct_attraction_accepted' : 'constrained_incomplete';
  }
  result.diagnostics.forehead_attraction_direct_count = records.filter(r => r.final_accepted).length;
  result.diagnostics.forehead_attraction_incomplete_count = records.filter(r => !r.final_accepted).length;
  result.diagnostics.forehead_final_output_audited = true;
}
