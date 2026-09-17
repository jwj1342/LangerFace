import assert from "node:assert/strict";
import { refineV6 } from "../web/src/services/personalized/v6RstlRefinementV9.ts";
import { yoloGuidedV9RstlRefinementOptions } from
  "../web/src/services/personalized/v9RstlRefinementProfile.ts";
import { guardMergedYoloGuidedRstlCurves } from
  "../web/src/services/personalized/yoloGuidedRstlScope.ts";
import { refinementOutputHashes, stableRefinementSerialization } from
  "../web/src/services/personalized/refinementOutputHash.ts";

assert.equal(stableRefinementSerialization({ b: 2, a: 1 }),
  stableRefinementSerialization({ a: 1, b: 2 }));
for (const [first, second] of [[Infinity, null], [NaN, null], [-0, 0], [undefined, null]]) {
  assert.notEqual(stableRefinementSerialization(first), stableRefinementSerialization(second));
}
assert.notEqual(stableRefinementSerialization(new Float32Array([1])),
  stableRefinementSerialization(new Float64Array([1])));

const size = 96;
for (const region of ["forehead_bridge_arc_v15", "orbital_brow_upturn_v11"]) {
  const forehead = region.includes("forehead");
  const seeds = (forehead ? [18, 28, 38, 48, 58, 68, 78] : [44, 54]).map((offset, index) => ({
    name: `${region}-${index}`, region,
    pts: Array.from({ length: 80 }, (_, i) => forehead ? [8 + i, offset] : [offset, 8 + i]),
  }));
  const mask = new Uint8Array(size * size);
  const confidence = new Float32Array(size * size);
  const directionQ = new Float32Array(size * size * 2);
  for (let i = 20; i <= 74; i += 1) {
    const [x, y] = forehead ? [i, 64] : [50, i];
    mask[y * size + x] = 1;
    confidence[y * size + x] = 1;
    directionQ[(y * size + x) * 2] = forehead ? 1 : -1;
  }
  const input = {
    seeds, wrinkleMask: mask, confidenceMap: confidence, directionQ, size,
    faceWidthPx: 75, options: yoloGuidedV9RstlRefinementOptions(75),
  };
  const snapshot = structuredClone(input);
  const baseline = refineV6({ ...input, cacheGeometry: false });
  const cached = refineV6({ ...input, cacheGeometry: true, performance: {} });
  assert.deepStrictEqual(cached, baseline, `${region}: all output fields must be identical`);
  assert.deepStrictEqual(refineV6(input), baseline, "default cache path must also be identical");
  assert.deepStrictEqual(input, snapshot, "refinement must not mutate its input");
  assert.deepStrictEqual(await refinementOutputHashes(cached), await refinementOutputHashes(baseline));
}

let state = 0x12345678;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2 ** 32;
};
let rollbackCases = 0;
for (let trial = 0; trial < 80; trial += 1) {
  const seeds = Array.from({ length: 8 }, (_, curve) => ({
    name: `curve-${curve}`, region: "forehead_bridge_arc_v15",
    pts: Array.from({ length: 10 }, (_, i) => [i * 5, curve * 8 + random() * 3]),
  }));
  const merged = seeds.map(seed => ({ ...seed,
    pts: seed.pts.map(([x, y]) => [x, y + (random() - 0.5) * 30]),
  }));
  const snapshot = structuredClone({ seeds, merged });
  const baseline = guardMergedYoloGuidedRstlCurves(seeds, merged, { cacheGeometry: false });
  const cached = guardMergedYoloGuidedRstlCurves(seeds, merged, { cacheGeometry: true });
  assert.deepStrictEqual(cached, baseline, `global guard trial ${trial}`);
  assert.deepStrictEqual({ seeds, merged }, snapshot);
  if (cached.rolledBackCurveIndices.length) rollbackCases += 1;
}
assert.ok(rollbackCases > 0, "randomized tests must exercise rollback invalidation");

// Touching boxes, zero-length segments and self-crossing paths retain the exact predicate.
const boundarySeeds = [
  [[0, 0], [10, 10]], [[10, 10], [20, 0]], [[0, 10], [10, 0]],
  [[5, 5], [5, 5]], [[0, 0], [10, 10], [0, 10], [10, 0]], [],
].map((pts, i) => ({ name: `boundary-${i}`, region: "test", pts }));
assert.deepStrictEqual(
  guardMergedYoloGuidedRstlCurves(boundarySeeds, boundarySeeds, { cacheGeometry: true }),
  guardMergedYoloGuidedRstlCurves(boundarySeeds, boundarySeeds, { cacheGeometry: false }),
);
console.log(`refinement cache and lossless hash tests passed (${rollbackCases} rollback cases)`);
