import assert from "node:assert/strict";
import { __controlledMarkerColorForTests as helpers } from "../web/src/services/controlledMarkerDetectionColorV035.ts";
import type { MarkerPoint } from "../web/src/services/controlledMarkerDetection.ts";

const point = (x: number, y: number) => ({ x, y });
const current = [point(20, 40), point(60, 40), point(60, 70), point(20, 70)];
const candidate = [point(20, 40), point(40, 20), point(60, 40), point(60, 70), point(20, 70)];
function evidence() {
  return { width: 96, height: 96, data: new Uint8ClampedArray(96 * 96 * 4).fill(255) };
}
function stroke(image: ReturnType<typeof evidence>, boundary: MarkerPoint[]) {
  for (let i = 0; i < boundary.length; i += 1) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    const count = Math.ceil(Math.hypot(a.x - b.x, a.y - b.y));
    for (let n = 0; n <= count; n += 1) {
      const x = Math.round(a.x + (b.x - a.x) * n / count);
      const y = Math.round(a.y + (b.y - a.y) * n / count);
      for (let channel = 0; channel < 3; channel += 1) image.data[(y * image.width + x) * 4 + channel] = 0;
    }
  }
}
const image = evidence();
stroke(image, candidate);
const compare = (a: MarkerPoint[], b: MarkerPoint[], input = image) => (
  helpers.compareAcceptedCandidateCompleteness(a, b, input)
);
assert.equal(compare(current, candidate).preferCandidate, true, "supported outer arc may replace a weak internal chord");
assert.equal(compare(current, candidate.slice().reverse()).preferCandidate, true, "winding must not decide the result");
assert.equal(compare([...current.slice(2), ...current.slice(0, 2)], candidate).preferCandidate, true,
  "an arc wrapping the array boundary is still one arc");
assert.equal(compare(candidate, candidate).preferCandidate, false, "already identical candidates are retained");
assert.equal(compare(current, candidate, evidence()).preferCandidate, false, "larger unsupported shape is not preferred");
const equalSupport = evidence();
stroke(equalSupport, candidate);
stroke(equalSupport, current);
assert.equal(compare(current, candidate, equalSupport).preferCandidate, false, "equal support is not stronger evidence");
assert.equal(compare(current, [point(20, 20), point(60, 20), point(60, 70), point(20, 70)]).preferCandidate, false,
  "an abrupt right-angle addition without matching arc endpoints is conservatively retained");
assert.equal(compare(current, [point(20, 20), point(60, 20), point(60, 90), point(20, 90)]).preferCandidate, false,
  "two separately expanded arcs cannot establish one missing segment");
assert.equal(compare(current, [point(20, 20), point(60, 20), point(60, 60), point(20, 60)]).preferCandidate, false,
  "a candidate cannot trade away an existing part of the region");
assert.equal(compare(current, [point(10, 10), point(80, 10), point(80, 85), point(10, 85)]).preferCandidate, false,
  "whole-outline inflation is not a missing-arc repair");
for (const bad of [[], [point(0, 0)], [point(10, 10), point(30, 30), point(50, 50)],
  [point(20, 20), point(60, 65), point(60, 20), point(20, 70)],
  [point(NaN, 20), ...candidate.slice(1)], [point(Infinity, 20), ...candidate.slice(1)],
  [point(-1, 20), ...candidate.slice(1)], [candidate[0], candidate[0], ...candidate.slice(1)]]) {
  assert.equal(compare(current, bad).preferCandidate, false, "invalid or self-intersecting geometry fails closed");
}
console.log("candidate completeness geometry and adversarial controls passed");
