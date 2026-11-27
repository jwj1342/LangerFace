import assert from 'node:assert/strict';
import { foreheadCurveDistance } from '../web/src/services/personalized/foreheadTrajectoryAttraction.ts';
import { yoloGuardCurvesCross } from '../web/src/services/personalized/yoloGuidedRstlScope.ts';

type Point = [number, number];
// Independent all-pairs oracle: no bounding-box pruning or cache. This catches
// a skipped closest segment even when no crossing or rollback is involved.
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy)
    / Math.max(1e-20, dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function exhaustive(a: Point[], b: Point[]): number {
  if (yoloGuardCurvesCross(a, b)) return 0;
  let result = Infinity;
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    result = Math.min(result, distanceToSegment(a[i - 1], b[j - 1], b[j]),
      distanceToSegment(a[i], b[j - 1], b[j]), distanceToSegment(b[j - 1], a[i - 1], a[i]),
      distanceToSegment(b[j], a[i - 1], a[i]));
  }
  return result;
}
let seed = 127;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
for (let trial = 0; trial < 120; trial++) {
  const points = (): Point[] => Array.from({ length: 2 + trial % 17 }, (_, i) =>
    [i * 3 + random(), random() * 8 + (trial % 3) * 20]);
  const a = points(), b = points();
  if (trial % 4 === 0) for (const p of b) p[1] += 80;
  if (trial % 4 === 1) for (const p of b) p[0] += 80;
  if (trial % 7 === 0) b.splice(1, 0, [...b[0]]);
  assert.equal(foreheadCurveDistance(a, b), exhaustive(a, b), `exact distance trial ${trial}`);
  b[0][0] += 2;
  assert.equal(foreheadCurveDistance(a, b), exhaustive(a, b), 'changed inputs must be recomputed');
}
console.log('forehead curve distance: 240 exact all-pairs comparisons passed');
