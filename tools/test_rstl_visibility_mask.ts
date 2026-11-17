import assert from "node:assert/strict";
import { fillShortVisibilityGaps } from "../web/src/services/rstlVisibilityMask.ts";

assert.deepEqual(
  fillShortVisibilityGaps([1, 1, 0, 1, 1]),
  [1, 1, 1, 1, 1],
  "ordinary two-point visibility jitter is filled",
);
for (const gapLength of [1, 2, 3]) {
  const mask = [1, 1, ...Array(gapLength).fill(0), 1, 1];
  const hard = [false, false, ...Array(gapLength).fill(true), false, false];
  assert.deepEqual(
    fillShortVisibilityGaps(mask, hard),
    mask,
    `hard exclusions remain hidden for a ${gapLength}-point gap`,
  );
}
assert.deepEqual(
  fillShortVisibilityGaps([1, 0, 1], [false, true, false]),
  [1, 0, 1],
  "a hard excluded middle point is never restored",
);
console.log("rstl visibility mask: soft gaps fill, hard exclusions remain hidden");
