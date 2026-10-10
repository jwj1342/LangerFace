import assert from "node:assert/strict";

import {
  isCrowFeetWrinkleLine,
  removeCrowFeetWrinkleLines,
  selectNoseDorsumWrinkleLines,
} from "../web/src/services/personalized/crowFeetFilter.ts";

const landmarks = Array.from({ length: 468 }, () => [0.5, 0.5] as [number, number]);
landmarks[33] = [0.30, 0.40];
landmarks[263] = [0.70, 0.40];
landmarks[234] = [0.10, 0.50];
landmarks[454] = [0.90, 0.50];

const lines = [
  { id: "left-crow", class: "wrinkle", points: [[0.20, 0.37], [0.24, 0.40], [0.20, 0.43]] as [number, number][] },
  { id: "right-crow", class: "wrinkle", points: [[0.80, 0.37], [0.76, 0.40], [0.80, 0.43]] as [number, number][] },
  { id: "nose", class: "wrinkle", points: Array.from({ length: 9 }, (_, index) =>
    [0.46 + index * 0.01, 0.44 + Math.abs(index - 4) * 0.001] as [number, number]) },
  { id: "forehead", class: "forehead", points: [[0.20, 0.40], [0.24, 0.40]] as [number, number][] },
  { id: "frown", class: "frown", points: [[0.48, 0.30], [0.52, 0.40]] as [number, number][] },
  { id: "explicit-crow", class: "wrinkle", anatomicalClass: "crow_feet", points: [[0.5, 0.5]] as [number, number][] },
];

assert.equal(isCrowFeetWrinkleLine(lines[0], landmarks), true);
assert.equal(isCrowFeetWrinkleLine(lines[1], landmarks), true);
assert.equal(isCrowFeetWrinkleLine(lines[2], landmarks), false);
assert.deepEqual(
  removeCrowFeetWrinkleLines(lines, landmarks).map((line) => line.id),
  ["nose", "forehead", "frown"],
);
assert.deepEqual(selectNoseDorsumWrinkleLines(lines, landmarks).map((line) => line.id), ["nose"]);

console.log("crow-feet wrinkle filtering tests passed");
