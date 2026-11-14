import assert from "node:assert/strict";

import {
  buildRstlPhotoHairMask,
  clipRstlRunToPhotoHair,
  rstlPointOverHair,
} from "../web/src/services/rstlPhotoHairOcclusion.ts";
import { buildChinAppearanceVisibility, buildFaceHullVisibility } from "../web/src/services/foreheadVisibility.ts";

const hair = Float32Array.from([0.9, 0.15, 0.5, 0.72, 0.1, 0.1]);
const skin = Float32Array.from([0.05, 0.8, 0.48, 0.1, 0.75, 0.8]);
const mask = buildRstlPhotoHairMask(
  ["background", "hair", "body-skin", "face-skin"],
  [new Float32Array(6), hair, new Float32Array(6), skin],
  3, 2, 300, 200,
);

assert.deepEqual([...mask.hair], [1, 1, 0, 1, 1, 0]);
assert.equal(rstlPointOverHair(mask, 0, 0), true);
assert.equal(rstlPointOverHair(mask, 200, 0), false);
assert.equal(rstlPointOverHair(mask, 200, 100), false);
assert.equal(rstlPointOverHair(mask, 100, 0, 100), true);
assert.throws(() => buildRstlPhotoHairMask(["hair"], [hair], 3, 2, 300, 200));

const crossingMask = {
  width: 11, height: 1, sourceWidth: 11, sourceHeight: 1,
  hair: Uint8Array.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]),
  faceSkin: Uint8Array.from([1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1]),
};
const clipped = clipRstlRunToPhotoHair([[0, 0, 0], [10, 0, 0]], crossingMask, 0);
assert.equal(clipped.length, 2);
assert.ok(clipped[0].every((point) => point[0] < 5));
assert.ok(clipped[1].every((point) => point[0] > 5));

const faceHullVisible = buildFaceHullVisibility([
  [0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0],
], 8);
assert.equal(faceHullVisible([50, 90, 0]), true);
assert.equal(faceHullVisible([50, 95, 0]), false);
assert.equal(faceHullVisible([50, 100, 0]), false);

const geometryMask = {
  width: 11, height: 1, sourceWidth: 11, sourceHeight: 1,
  hair: new Uint8Array(11), faceSkin: new Uint8Array(11).fill(1),
};
const geometryClipped = clipRstlRunToPhotoHair(
  [[0, 0, 0], [10, 0, 0]], geometryMask, 0,
  (point) => point[0] < 4 || point[0] > 6,
);
assert.equal(geometryClipped.length, 2);
assert.ok(geometryClipped[0].every((point) => point[0] < 4));
assert.ok(geometryClipped[1].every((point) => point[0] > 6));

const pixels = new Uint8ClampedArray(20 * 20 * 4);
for (let y = 0; y < 20; y++) {
  for (let x = 0; x < 20; x++) {
    const offset = (y * 20 + x) * 4;
    pixels.set(y >= 16 ? [235, 235, 230, 255] : [150, 105, 85, 255], offset);
  }
}
const landmarks = Array.from({ length: 153 }, () => [10, 10, 0] as [number, number, number]);
landmarks[17] = [10, 4, 0];
landmarks[152] = [10, 19, 0];
const chinVisible = buildChinAppearanceVisibility(
  { width: 20, height: 20, data: pixels } as ImageData, landmarks,
);
assert.equal(chinVisible([10, 13, 0]), true);
assert.equal(chinVisible([10, 18, 0]), false);

for (let index = 0; index < pixels.length; index += 4) {
  if (Math.floor(index / 4 / 20) >= 16) continue;
  pixels.set([75, 49, 41, 255], index);
}
const darkChinVisible = buildChinAppearanceVisibility(
  { width: 20, height: 20, data: pixels } as ImageData, landmarks,
);
assert.equal(darkChinVisible([10, 13, 0]), true);
assert.equal(darkChinVisible([10, 18, 0]), false);

console.log("RSTL photo clipping: semantic, geometric and chin appearance checks passed");
