import assert from "node:assert/strict";
import fs from "node:fs";

import { detectControlledMarker as detectColorDifference } from "../web/src/services/controlledMarkerDetectionColorV035.ts";
import { detectControlledMarker as detectLegacy } from "../web/src/services/controlledMarkerDetectionLegacyV023.ts";

type Rgb = readonly [number, number, number];

function image(width: number, height: number, color: Rgb) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = color[0];
    data[index * 4 + 1] = color[1];
    data[index * 4 + 2] = color[2];
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
}

function ring(
  target: ReturnType<typeof image>,
  centerX: number,
  centerY: number,
  radius: number,
  thickness: number,
  color: Rgb,
  gapRadians = 0,
) {
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (Math.abs(Math.hypot(dx, dy) - radius) > thickness / 2) continue;
      if (gapRadians > 0 && Math.abs(Math.atan2(dy, dx)) < gapRadians / 2) continue;
      const index = (y * target.width + x) * 4;
      target.data[index] = color[0];
      target.data[index + 1] = color[1];
      target.data[index + 2] = color[2];
    }
  }
}

function line(
  target: ReturnType<typeof image>,
  start: readonly [number, number],
  end: readonly [number, number],
  thickness: number,
  color: Rgb,
) {
  const steps = Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(start[0] + (end[0] - start[0]) * step / Math.max(1, steps));
    const y = Math.round(start[1] + (end[1] - start[1]) * step / Math.max(1, steps));
    for (let dy = -thickness; dy <= thickness; dy += 1) {
      for (let dx = -thickness; dx <= thickness; dx += 1) {
        if (dx * dx + dy * dy > thickness * thickness) continue;
        const index = ((y + dy) * target.width + x + dx) * 4;
        target.data[index] = color[0];
        target.data[index + 1] = color[1];
        target.data[index + 2] = color[2];
      }
    }
  }
}

const options = { roiRadius: 48, expectedDiameterPx: 44, scanDiameterMm: 20 };
const seed = { x: 64, y: 64 };

{
  const target = image(128, 128, [205, 185, 165]);
  ring(target, seed.x, seed.y, 22, 3, [20, 20, 20]);
  const legacy = detectLegacy(target, seed, options);
  const colorDifference = detectColorDifference(target, seed, options);
  assert.equal(legacy.ok, true);
  assert.deepEqual(colorDifference, legacy,
    "legacy-recognized markers keep byte-equivalent geometry and diagnostics");
}

{
  const target = image(128, 128, [70, 45, 35]);
  ring(target, seed.x, seed.y, 22, 3, [20, 55, 55]);
  const legacy = detectLegacy(target, seed, options);
  const colorDifference = detectColorDifference(target, seed, options);
  assert.equal(legacy.ok, false, "near-equal luma chroma marker is outside the dark-only baseline");
  assert.equal(colorDifference.ok, true,
    `local color difference recovers a chromatic enclosure: ${JSON.stringify(colorDifference)}`);
  assert.equal(colorDifference.geometry_mode, "enclosed_region");
  assert.ok(colorDifference.warnings.includes("color_difference_recovered"));
  assert.deepEqual(colorDifference.audit, {
    local_only: true,
    raw_media_retained: false,
    network_request_made: false,
  });
  assert.ok((colorDifference.bbox?.width || 0) >= 41 && (colorDifference.bbox?.height || 0) >= 41);
}

{
  const target = image(128, 128, [55, 38, 31]);
  ring(target, seed.x, seed.y, 22, 3, [205, 195, 80]);
  const result = detectColorDifference(target, seed, options);
  assert.equal(result.ok, true,
    `a lighter closed marker on dark skin is recovered without changing shape logic: ${JSON.stringify(result)}`);
  assert.equal(result.geometry_mode, "enclosed_region");
}

{
  const target = image(128, 128, [55, 38, 31]);
  const result = detectColorDifference(target, seed, options);
  assert.equal(result.ok, false, "uniform dark skin cannot become a marker by color normalization alone");
}

{
  const target = image(128, 128, [55, 38, 31]);
  ring(target, seed.x, seed.y, 22, 3, [205, 195, 80], Math.PI * 0.8);
  const result = detectColorDifference(target, seed, options);
  assert.equal(result.ok, false, "a large open gap is not promoted to a closed lesion boundary");
}

{
  const target = image(128, 128, [55, 38, 31]);
  line(target, [30, 64], [98, 64], 1, [205, 195, 80]);
  const result = detectColorDifference(target, seed, options);
  assert.notEqual(result.geometry_mode, "enclosed_region",
    "an isolated high-contrast facial line cannot become a workflow-eligible lesion enclosure");
}

{
  const target = image(128, 128, [55, 38, 31]);
  for (let y = 40; y <= 88; y += 8) {
    line(target, [18, y], [110, y + 3], 1, [150, 125, 95]);
  }
  const result = detectColorDifference(target, seed, options);
  assert.equal(result.ok, false,
    "parallel high-contrast wrinkle-like lines cannot become a closed marker");
}

{
  const target = image(128, 128, [55, 38, 31]);
  ring(target, seed.x, seed.y, 7, 3, [205, 195, 80]);
  const result = detectColorDifference(target, seed, options);
  assert.equal(result.ok, false,
    "a small internal highlight loop cannot replace the requested outer marker boundary");
}

const source = fs.readFileSync("src/services/controlledMarkerDetectionColorV035.ts", "utf8");
assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|\bfetch\s*\(|axios|onnxruntime|mediapipe/i,
  "color-difference detector must remain local and independent of DOM, network, models, and RSTL runtime");

console.log("controlled marker color-difference tests passed");
