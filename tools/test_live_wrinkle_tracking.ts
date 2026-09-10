import assert from "node:assert/strict";

import {
  bindWrinkleLinesToFace,
  buildLowLatencyWrinkleLandmarks,
  mapTrackedWrinkleLines,
} from "../web/src/services/liveWrinkleTracking.ts";
import {
  buildWrinkleTextureFrame,
  snapWrinkleLinesToRidges,
  WrinkleTextureTracker,
} from "../web/src/services/liveWrinkleTextureTracking.ts";
import type { Triangle, Vec3 } from "../web/src/services/softBody.ts";

const reference: Vec3[] = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 10, 0],
];
const triangles: Triangle[] = [[0, 1, 2]];
const lines = [{
  id: "test-line",
  className: "wrinkle",
  points: [[2, 3], [15, 5]] as Array<[number, number]>,
}];
const tracked = bindWrinkleLinesToFace(lines, reference, triangles);
assert.ok(tracked[0].points[0].surfaceRef, "points inside the face use barycentric tracking");
assert.equal(tracked[0].points[1].surfaceRef, null, "points outside the mesh use landmark tracking");

const transformed: Vec3[] = reference.map(([x, y]) => [100 - 2 * y, 50 + 2 * x, 0]);
const mapped = mapTrackedWrinkleLines(tracked, transformed, triangles);
const expected = [[94, 54], [90, 80]];
for (let index = 0; index < expected.length; index += 1) {
  assert.ok(Math.abs(mapped[0].points[index][0] - expected[index][0]) < 1e-6);
  assert.ok(Math.abs(mapped[0].points[index][1] - expected[index][1]) < 1e-6);
}

const smoothedAfterFastMotion: Vec3[] = reference.map(([x, y, z]) => [x + 4, y + 2, z]);
const currentAfterFastMotion: Vec3[] = reference.map(([x, y, z]) => [x + 10, y + 5, z]);
const lowLatencyLandmarks = buildLowLatencyWrinkleLandmarks(
  smoothedAfterFastMotion,
  currentAfterFastMotion,
  triangles,
  [0, 1, 2],
);
for (let index = 0; index < currentAfterFastMotion.length; index += 1) {
  assert.ok(Math.hypot(
    lowLatencyLandmarks[index][0] - currentAfterFastMotion[index][0],
    lowLatencyLandmarks[index][1] - currentAfterFastMotion[index][1],
  ) < 1e-6, "fast coherent motion bypasses landmark smoothing delay for wrinkles");
}

for (let frame = 0; frame < 60; frame += 1) {
  const radians = frame * Math.PI / 360;
  const frameScale = 1 + frame * 0.001;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const frameLandmarks = reference.map(([x, y, z]) => [
    20 + frame * 0.8 + frameScale * (cos * x - sin * y),
    35 - frame * 0.3 + frameScale * (sin * x + cos * y),
    z,
  ] as Vec3);
  const frameLines = mapTrackedWrinkleLines(tracked, frameLandmarks, triangles);
  assert.equal(frameLines.length, lines.length, "same-frame mesh mapping preserves every YOLO line");
  assert.equal(frameLines[0].points.length, lines[0].points.length,
    "same-frame mesh mapping preserves every YOLO point");
  const x = 20 + frame * 0.8 + frameScale * (cos * 2 - sin * 3);
  const y = 35 - frame * 0.3 + frameScale * (sin * 2 + cos * 3);
  assert.ok(Math.hypot(
    frameLines[0].points[0][0] - x,
    frameLines[0].points[0][1] - y,
  ) < 1e-6, "wrinkle points use the current RSTL landmark frame without history lag");
}

function syntheticTexture(width: number, height: number, dx = 0, dy = 0): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - dx;
      const sourceY = y - dy;
      const insideSource = sourceX >= 0 && sourceY >= 0
        && sourceX < width && sourceY < height;
      const value = insideSource
        ? 55 + ((sourceX * 17 + sourceY * 31 + sourceX * sourceY * 7) % 170)
        : 128;
      const offset = (y * width + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

const textureWidth = 96;
const textureHeight = 72;
const detectedTextureLines = [{
  id: "detected-wrinkle",
  className: "forehead",
  points: Array.from({ length: 12 }, (_item, index) => [24 + index * 3, 34] as [number, number]),
}];
const textureTracker = new WrinkleTextureTracker();

function horizontalDarkCrease(width: number, height: number, creaseY: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const distance = Math.abs(y - creaseY);
    const value = Math.round(190 - 58 * Math.exp(-(distance * distance) / 3.2));
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

const offCreaseLine = [{
  id: "off-crease",
  className: "forehead",
  points: Array.from({ length: 25 }, (_item, index) => [12 + index * 2.8, 28] as [number, number]),
}];
const snappedCrease = snapWrinkleLinesToRidges(
  buildWrinkleTextureFrame(
    horizontalDarkCrease(textureWidth, textureHeight, 34),
    textureWidth,
    textureHeight,
  ),
  offCreaseLine,
);
assert.equal(snappedCrease.lines.length, offCreaseLine.length,
  "ridge snapping preserves every YOLO line");
assert.equal(snappedCrease.lines[0].points.length, offCreaseLine[0].points.length,
  "ridge snapping preserves every YOLO point");
assert.ok(snappedCrease.lines[0].points.filter((point) => Math.abs(point[1] - 34) < 0.75).length
  >= Math.ceil(offCreaseLine[0].points.length * 0.8),
"a YOLO display line is snapped onto the nearby dark wrinkle center");
assert.equal(snappedCrease.diagnostics.snappedLineCount, 1,
  "ridge snapping reports an accepted display correction");

const maintenanceSnap = snapWrinkleLinesToRidges(
  buildWrinkleTextureFrame(
    horizontalDarkCrease(textureWidth, textureHeight, 31),
    textureWidth,
    textureHeight,
  ),
  offCreaseLine,
  { phase: "maintenance" },
);
assert.ok(maintenanceSnap.lines[0].points.filter((point) => Math.abs(point[1] - 31) < 0.75).length
  >= Math.ceil(offCreaseLine[0].points.length * 0.8),
"current-frame maintenance follows a nearby locally deforming wrinkle groove");

const furthestAllowedMaintenanceSnap = snapWrinkleLinesToRidges(
  buildWrinkleTextureFrame(
    horizontalDarkCrease(textureWidth, textureHeight, 34),
    textureWidth,
    textureHeight,
  ),
  offCreaseLine,
  { phase: "maintenance" },
);
assert.ok(furthestAllowedMaintenanceSnap.lines[0].points.every((point) =>
  Math.abs(point[1] - 34) < 0.75),
"current-frame ridge lock covers coarse-mesh drift without changing line shape");
const maintenanceOffsets = furthestAllowedMaintenanceSnap.lines[0].points.map(
  (point, index) => point[1] - offCreaseLine[0].points[index][1],
);
assert.ok(Math.max(...maintenanceOffsets) - Math.min(...maintenanceOffsets) < 1e-6,
  "maintenance correction moves a whole wrinkle coherently to prevent point jitter");

const distantMaintenanceSnap = snapWrinkleLinesToRidges(
  buildWrinkleTextureFrame(
    horizontalDarkCrease(textureWidth, textureHeight, 35),
    textureWidth,
    textureHeight,
  ),
  offCreaseLine,
  { phase: "maintenance" },
);
assert.deepEqual(distantMaintenanceSnap.lines, offCreaseLine,
  "current-frame maintenance cannot jump to a distant neighboring wrinkle");

const flatFrame = new Uint8ClampedArray(textureWidth * textureHeight * 4).fill(180);
for (let index = 3; index < flatFrame.length; index += 4) flatFrame[index] = 255;
const flatSnap = snapWrinkleLinesToRidges(
  buildWrinkleTextureFrame(flatFrame, textureWidth, textureHeight),
  offCreaseLine,
);
assert.deepEqual(flatSnap.lines, offCreaseLine,
  "flat skin cannot move the original YOLO display line");
assert.equal(flatSnap.diagnostics.snappedLineCount, 0);

textureTracker.seed(
  buildWrinkleTextureFrame(
    syntheticTexture(textureWidth, textureHeight),
    textureWidth,
    textureHeight,
  ),
  detectedTextureLines,
  1,
);
const textureTracked = textureTracker.update(
  buildWrinkleTextureFrame(
    syntheticTexture(textureWidth, textureHeight, 2, 1),
    textureWidth,
    textureHeight,
  ),
  detectedTextureLines,
  1,
);
assert.equal(textureTracked.length, detectedTextureLines.length,
  "texture tracking cannot add or remove YOLO lines");
assert.equal(textureTracked[0].points.length, detectedTextureLines[0].points.length,
  "texture tracking cannot add or remove YOLO points");
for (let index = 0; index < detectedTextureLines[0].points.length; index += 1) {
  assert.ok(Math.abs(
    textureTracked[0].points[index][0] - detectedTextureLines[0].points[index][0] - 2,
  ) < 0.6, "wrinkle texture follows current-frame horizontal motion");
  assert.ok(Math.abs(
    textureTracked[0].points[index][1] - detectedTextureLines[0].points[index][1] - 1,
  ) < 0.6, "wrinkle texture follows current-frame vertical motion");
}
assert.equal(textureTracker.diagnostics().correctedLineCount, 1,
  "accepted texture matches are reported as applied corrections");
assert.ok(textureTracker.diagnostics().acceptedControlCount >= 3,
  "a texture correction requires multi-point agreement");

const uniform = new Uint8ClampedArray(textureWidth * textureHeight * 4).fill(150);
for (let index = 3; index < uniform.length; index += 4) uniform[index] = 255;
textureTracker.seed(
  buildWrinkleTextureFrame(uniform, textureWidth, textureHeight),
  detectedTextureLines,
  2,
);
const lowTextureFallback = textureTracker.update(
  buildWrinkleTextureFrame(uniform, textureWidth, textureHeight),
  detectedTextureLines,
  2,
);
assert.deepEqual(lowTextureFallback, detectedTextureLines,
  "low-texture frames preserve the current mesh-mapped YOLO result exactly");
assert.equal(textureTracker.diagnostics().correctedLineCount, 0,
  "low-texture fallback reports that no texture correction was applied");

console.log("ok: YOLO wrinkles preserve current-frame RSTL geometry and guarded offline utilities");
