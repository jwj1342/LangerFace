import assert from "node:assert/strict";

import {
  isCrowFeetWrinkleLine,
  keepFaceRegionWrinkleLines,
  keepTargetWrinkleLines,
  removeCrowFeetWrinkleLines,
  selectNoseDorsumWrinkleLines,
} from "../web/src/services/personalized/crowFeetFilter.ts";

const landmarks = Array.from({ length: 468 }, () => [0.5, 0.5] as [number, number]);
landmarks[33] = [0.30, 0.40];
landmarks[263] = [0.70, 0.40];
landmarks[234] = [0.10, 0.50];
landmarks[454] = [0.90, 0.50];
landmarks[168] = [0.50, 0.35];
landmarks[6] = [0.50, 0.41];
landmarks[195] = [0.50, 0.49];
landmarks[5] = [0.50, 0.57];

const lines = [
  { id: "left-crow", class: "wrinkle", points: [[0.20, 0.37], [0.24, 0.40], [0.20, 0.43]] as [number, number][] },
  { id: "right-crow", class: "wrinkle", points: [[0.80, 0.37], [0.76, 0.40], [0.80, 0.43]] as [number, number][] },
  { id: "nose", class: "wrinkle", points: Array.from({ length: 9 }, (_, index) =>
    [0.46 + index * 0.01, 0.44 + Math.abs(index - 4) * 0.001] as [number, number]) },
  { id: "right-eye-bag", class: "wrinkle", points: Array.from({ length: 9 }, (_, index) =>
    [0.61 + index * 0.01, 0.47] as [number, number]) },
  { id: "left-eye-bag", class: "wrinkle", points: Array.from({ length: 9 }, (_, index) =>
    [0.32 + index * 0.01, 0.47] as [number, number]) },
  { id: "crosses-bridge", class: "wrinkle", points: Array.from({ length: 12 }, (_, index) =>
    [0.43 + index * 0.015, 0.47] as [number, number]) },
  { id: "bows-outside-bridge", class: "wrinkle", points: Array.from({ length: 11 }, (_, index) =>
    [0.46 + index * 0.008 + (index === 5 ? 0.08 : 0), 0.47] as [number, number]) },
  { id: "cheek", class: "wrinkle", points: Array.from({ length: 9 }, (_, index) =>
    [0.54 + index * 0.01, 0.68] as [number, number]) },
  { id: "forehead", class: "forehead", points: [[0.20, 0.40], [0.24, 0.40]] as [number, number][] },
  { id: "frown", class: "frown", points: [[0.48, 0.30], [0.52, 0.40]] as [number, number][] },
  { id: "explicit-crow", class: "wrinkle", anatomicalClass: "crow_feet", points: [[0.5, 0.5]] as [number, number][] },
];

assert.equal(isCrowFeetWrinkleLine(lines[0], landmarks), true);
assert.equal(isCrowFeetWrinkleLine(lines[1], landmarks), true);
assert.equal(isCrowFeetWrinkleLine(lines[2], landmarks), false);
assert.deepEqual(
  removeCrowFeetWrinkleLines(lines, landmarks).map((line) => line.id),
  ["nose", "right-eye-bag", "left-eye-bag", "crosses-bridge", "bows-outside-bridge", "cheek", "forehead", "frown"],
);
assert.deepEqual(selectNoseDorsumWrinkleLines(lines, landmarks).map((line) => line.id), ["nose"]);
assert.deepEqual(keepTargetWrinkleLines(lines, landmarks).map((line) => line.id),
  ["nose", "forehead", "frown"],
  "only generic wrinkles outside the nose bridge are removed");
const shiftedLandmarks = landmarks.map((point) => [...point] as [number, number]);
for (const index of [168, 6, 195, 5]) shiftedLandmarks[index][0] += 0.04;
const shiftedNose = { id: "shifted-nose", class: "wrinkle", points:
  lines[2].points.map(([x, y]) => [x + 0.04, y] as [number, number]) };
assert.deepEqual(selectNoseDorsumWrinkleLines([shiftedNose], shiftedLandmarks)
  .map((line) => line.id), ["shifted-nose"],
  "the nose corridor follows the face landmarks when the nose is off-center");
assert.deepEqual(keepTargetWrinkleLines(lines, []).map((line) => line.id),
  ["forehead", "frown"], "missing nose landmarks do not admit generic wrinkles");

const faceRegionLandmarks = Array.from({ length: 468 }, () => [0, 0] as [number, number]);
const faceOvalIndices = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
];
for (const [index, landmarkIndex] of faceOvalIndices.entries()) {
  const angle = -Math.PI / 2 + (index / faceOvalIndices.length) * Math.PI * 2;
  faceRegionLandmarks[landmarkIndex] = [55 + 50 * Math.cos(angle), 55 + 50 * Math.sin(angle)];
}
const faceLines = [
  { id: "inside-face", class: "forehead", points: [[40, 50], [50, 50], [60, 50]] as [number, number][] },
  { id: "shirt", class: "forehead", points: [[20, 115], [40, 115], [60, 115]] as [number, number][] },
];
assert.deepEqual(keepFaceRegionWrinkleLines(faceLines, faceRegionLandmarks).map((line) => line.id),
  ["inside-face"], "centerlines outside the face silhouette are removed");

const photoLandmarks = Array.from({ length: 468 }, () => [0, 0] as [number, number]);
for (const [index, x, y] of [
  [33, 153.8644, 547.7607], [263, 670.5616, 530.0320],
  [234, 240.9903, 655.9760], [454, 1022.0141, 636.4110],
  [168, 328.2700, 506.4746], [6, 314.6311, 566.8254],
  [195, 285.3141, 655.3733], [5, 268.7801, 700.2815],
]) photoLandmarks[index] = [x, y];
const photoLines = [
  { id: "nose-root-boundary", class: "wrinkle", points: Array.from({ length: 88 }, (_, i) =>
    [314 + i * 85 / 87, 477 + i * 2 / 87] as [number, number]) },
  { id: "eye", class: "wrinkle", points: Array.from({ length: 88 }, (_, i) =>
    [722 + i * 101 / 87, 473 + i * 59 / 87] as [number, number]) },
  { id: "hairline", class: "wrinkle", points: Array.from({ length: 88 }, (_, i) =>
    [547 + i * 111 / 87, 28 + i * 21 / 87] as [number, number]) },
];
for (const scale of [0.5, 1, 2]) {
  const scaledLandmarks = photoLandmarks.map(([x, y]) => [x * scale, y * scale]);
  const scaledLines = photoLines.map((line) => ({ ...line,
    points: line.points.map(([x, y]) => [x * scale, y * scale] as [number, number]),
  }));
  assert.deepEqual(keepTargetWrinkleLines(scaledLines, scaledLandmarks).map((line) => line.id),
    ["nose-root-boundary"], "small nose-root boundary differences are tolerated at every scale");
}
const outsideTolerance = { ...photoLines[0], points: photoLines[0].points.map(([x]) =>
  [x, 445] as [number, number]) };
assert.deepEqual(selectNoseDorsumWrinkleLines([outsideTolerance], photoLandmarks), [],
  "lines well above the nose root remain excluded");

const noseRootLandmarks = Array.from({ length: 468 }, () => [0, 0] as [number, number]);
for (const [index, x, y] of [
  [33, 60, 550], [263, 510, 550], [234, 0, 650], [454, 754.23, 650],
  [168, 283.85, 595.65], [6, 290, 675], [195, 290, 745], [5, 290, 800],
]) noseRootLandmarks[index] = [x, y];
const noseRootLines = [
  { id: "detected-nose-root", class: "wrinkle", points: Array.from({ length: 42 }, (_, i) =>
    [267.2 + i * 93.6 / 41, 544.8 + i * 7.2 / 41] as [number, number]) },
  { id: "eye-region", class: "wrinkle", points: Array.from({ length: 42 }, (_, i) =>
    [430 + i * 93.6 / 41, 544.8 + i * 7.2 / 41] as [number, number]) },
  { id: "nose-root-too-high", class: "wrinkle", points: Array.from({ length: 42 }, (_, i) =>
    [267.2 + i * 93.6 / 41, 520 + i * 7.2 / 41] as [number, number]) },
];
for (const scale of [0.5, 1, 2]) {
  const scaledLandmarks = noseRootLandmarks.map(([x, y]) => [x * scale, y * scale]);
  const scaledLines = noseRootLines.map((line) => ({ ...line,
    points: line.points.map(([x, y]) => [x * scale, y * scale] as [number, number]),
  }));
  assert.deepEqual(selectNoseDorsumWrinkleLines(scaledLines, scaledLandmarks)
    .map((line) => line.id), ["detected-nose-root"],
  "the detected nose-root line survives at every scale without admitting eye-region lines");
}

console.log("crow-feet wrinkle filtering tests passed");
