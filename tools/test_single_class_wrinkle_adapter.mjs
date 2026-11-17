import assert from "node:assert/strict";

import {
  classifySingleClassWrinkleLines,
  normalizeHorizontalForeheadGuidanceLines,
  routeGenericWrinkleLines,
} from
  "../web/src/services/personalized/singleClassWrinkleAdapter.ts";

const landmarks = Array.from({ length: 455 }, () => [0, 0, 0]);
landmarks[234] = [0, 100, 0];
landmarks[454] = [100, 100, 0];
landmarks[10] = [50, 10, 0];
landmarks[9] = [50, 50, 0];
landmarks[8] = [50, 50, 0];
landmarks[107] = [45, 50, 0];
landmarks[336] = [55, 50, 0];
landmarks[55] = [45, 50, 0];
landmarks[65] = [45, 50, 0];
landmarks[285] = [55, 50, 0];
landmarks[295] = [55, 50, 0];
landmarks[168] = [50, 65, 0];
landmarks[6] = [50, 70, 0];
landmarks[195] = [50, 80, 0];
landmarks[5] = [50, 90, 0];

const horizontalLowerForehead = Array.from({ length: 61 }, (_, index) => [20 + index, 51]);
const verticalFrown = Array.from({ length: 31 }, (_, index) => [50, 51 + index]);
const result = classifySingleClassWrinkleLines([
  { id: "lower-forehead", class: "wrinkled", points: horizontalLowerForehead },
  { id: "frown", class: "wrinkled", points: verticalFrown },
], landmarks);

assert.deepEqual(result.lines.map((line) => [line.id, line.class]), [
  ["lower-forehead", "forehead"],
  ["frown", "frown"],
]);
const multiClass = normalizeHorizontalForeheadGuidanceLines([
  { id: "model-horizontal-frown", class: "frown", points: horizontalLowerForehead },
  { id: "model-vertical-frown", class: "frown", points: verticalFrown },
], landmarks);
assert.deepEqual(multiClass.map((line) => [line.id, line.class]), [
  ["model-horizontal-frown", "forehead"],
  ["model-vertical-frown", "frown"],
]);
const genericRoute = routeGenericWrinkleLines([
  { id: "generic-vertical-frown", class: "wrinkle", points: verticalFrown },
  { id: "generic-nose", class: "wrinkle", points: Array.from({ length: 31 }, (_, index) => [50, 65 + index]) },
], landmarks);
assert.equal(genericRoute.lines.find((line) => line.id === "generic-vertical-frown")?.class, "frown");
assert.equal(genericRoute.lines.find((line) => line.id === "generic-nose")?.class, "wrinkle");
assert.equal(genericRoute.reclassifiedFrownCount, 1);
console.log("single-class wrinkle adapter tests passed");
