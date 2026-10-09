import assert from "node:assert/strict";

import { extractFineWrinkleLines } from
  "../web/src/services/personalized/fineWrinkleLines.ts";

function paintRect(mask, width, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    mask[y * width + x] = 1;
  }
}

function solidRgba(width, height, value = 180) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    rgba[index * 4] = value;
    rgba[index * 4 + 1] = value;
    rgba[index * 4 + 2] = value;
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
}

function paintRgbaPixel(rgba, width, x, y, value) {
  const index = (y * width + x) * 4;
  rgba[index] = value;
  rgba[index + 1] = value;
  rgba[index + 2] = value;
}

function countRenderedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = [];
  let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    count++;
    visited[start] = 1;
    queue.length = 0;
    queue.push(start);
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head];
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const neighbor = yy * width + xx;
        if (mask[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
  }
  return count;
}

{
  const width = 72;
  const height = 48;
  const forehead = new Uint8Array(width * height);
  const wrinkle = new Uint8Array(width * height);
  paintRect(forehead, width, 5, 9, 48, 13);
  paintRect(wrinkle, width, 10, 29, 62, 33);
  paintRect(wrinkle, width, 2, 42, 3, 43);
  const beforeForehead = forehead.slice();
  const beforeWrinkle = wrinkle.slice();
  const first = extractFineWrinkleLines(
    { forehead, frown: new Uint8Array(width * height), wrinkle },
    width,
    height,
  );
  const second = extractFineWrinkleLines(
    { forehead, frown: new Uint8Array(width * height), wrinkle },
    width,
    height,
  );
  const summaryOnly = extractFineWrinkleLines(
    { forehead, frown: new Uint8Array(width * height), wrinkle },
    width,
    height,
    { outputMode: "summary" },
  );
  const { mask, confidence, directionQ, classMasks, ...expectedSummary } = first;
  assert.deepStrictEqual(summaryOnly, expectedSummary,
    "summary-only extraction must preserve every line, validation, and summary field");
  assert.deepStrictEqual(Object.keys(first).slice(-5),
    ["mask", "confidence", "directionQ", "classMasks", "rasterPixelCount"],
    "default extraction must retain its serialized field order");
  assert.equal(first.schemaVersion, "langerface.wrinkle-fine-lines.v2");
  assert.equal(first.summary.sourceConnectedComponents, 3);
  assert.equal(first.summary.fineLineCount, 2);
  assert.equal(first.summary.rejectedShortComponentCount, 1);
  assert.deepEqual(first.summary.lineCountByClass, { forehead: 1, frown: 0, wrinkle: 1 });
  assert.equal(first.validation.passed, true);
  assert.equal(first.validation.filledTwoByTwoPixelBlocks, 0);
  assert.equal(first.validation.renderedConnectedComponents, 2);
  assert.ok(first.lines.every((line) => line.lengthPx >= 20));
  assert.ok(first.lines.every((line) => line.points.length > 20));
  assert.deepEqual(first.lines, second.lines, "automatic extraction must be deterministic");
  assert.deepEqual(forehead, beforeForehead, "source class masks must not be mutated");
  assert.deepEqual(wrinkle, beforeWrinkle, "source class masks must not be mutated");
}

// The sparse rendered-pixel path must agree with a full-frame 8-neighbor
// reference for empty, edge-touching, overlapping, and dense input masks.
{
  let seed = 72897;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let sample = 0; sample < 24; sample++) {
    const width = 40 + Math.floor(random() * 40);
    const height = 32 + Math.floor(random() * 32);
    const masks = Object.fromEntries(["forehead", "frown", "wrinkle"].map((name) =>
      [name, new Uint8Array(width * height)]));
    if (sample > 0) {
      for (const mask of Object.values(masks)) {
        for (let region = 0; region < (sample % 6) + 1; region++) {
          const x = Math.floor(random() * width);
          const y = Math.floor(random() * height);
          const length = 1 + Math.floor(random() * 45);
          const thickness = sample % 4 === 0 ? 9 : 1 + Math.floor(random() * 5);
          paintRect(mask, width, x, y,
            Math.min(width - 1, x + length), Math.min(height - 1, y + thickness));
        }
      }
    }
    const full = extractFineWrinkleLines(masks, width, height);
    const summaryOnly = extractFineWrinkleLines(masks, width, height,
      { outputMode: "summary" });
    assert.equal(full.validation.renderedConnectedComponents,
      countRenderedComponents(full.mask, width, height),
      `rendered component count must match a full-frame scan for sample ${sample}`);
    assert.deepStrictEqual(summaryOnly.validation, full.validation,
      `summary mode must preserve validation for sample ${sample}`);
  }
}

// The retained line represents one physical wrinkle. A short fork in a thick
// component must not become a second line or replace the longer main path.
{
  const width = 72;
  const height = 48;
  const wrinkle = new Uint8Array(width * height);
  paintRect(wrinkle, width, 8, 17, 63, 21);
  paintRect(wrinkle, width, 34, 20, 38, 31);
  const result = extractFineWrinkleLines(
    { forehead: new Uint8Array(width * height), frown: new Uint8Array(width * height), wrinkle },
    width,
    height,
  );
  assert.equal(result.lines.length, 1);
  const xs = result.lines[0].points.map((point) => point[0]);
  const ys = result.lines[0].points.map((point) => point[1]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 48,
    "weighted geodesic main path must keep the long horizontal wrinkle");
  assert.ok(Math.max(...ys) - Math.min(...ys) < 8,
    "the short fork must not control the retained centerline");
  assert.equal(result.validation.passed, true);
}

// A segmentation dropout may shorten a forehead wrinkle after an otherwise
// harmless re-encode. Recover only the endpoint path supported by a continuous
// dark ridge in the source pixels, while leaving the companion component
// separate.
{
  const width = 160;
  const height = 80;
  const forehead = new Uint8Array(width * height);
  paintRect(forehead, width, 18, 28, 60, 32);
  paintRect(forehead, width, 84, 30, 132, 34);
  const rgba = solidRgba(width, height);
  for (let x = 18; x <= 132; x++) {
    const y = Math.round(30 + 2 * (x - 18) / (132 - 18));
    for (let offset = -1; offset <= 1; offset++) {
      paintRgbaPixel(rgba, width, x, y + offset, 85);
    }
  }
  const beforeForehead = forehead.slice();
  const result = extractFineWrinkleLines(
    { forehead, frown: new Uint8Array(width * height), wrinkle: new Uint8Array(width * height) },
    width,
    height,
    { sourceImageRgba: rgba },
  );
  const summaryOnly = extractFineWrinkleLines(
    { forehead, frown: new Uint8Array(width * height), wrinkle: new Uint8Array(width * height) },
    width,
    height,
    { sourceImageRgba: rgba, outputMode: "summary" },
  );
  const { mask, confidence, directionQ, classMasks, ...expectedSummary } = result;
  assert.deepStrictEqual(summaryOnly, expectedSummary,
    "endpoint recovery must preserve summary and validation without raster output maps");
  assert.deepStrictEqual(forehead, beforeForehead,
    "endpoint recovery must write only to private copies, never the source mask");
  assert.equal(result.summary.recoveredForeheadEndpointCount, 1);
  assert.ok(result.summary.recoveredForeheadEndpointLengthPx > 15);
  assert.equal(result.validation.recoveredForeheadEndpointsImageSupported, true);
  assert.equal(result.validation.passed, true);
  assert.equal(result.lines.length, 2, "endpoint recovery must not collapse two source IDs");
}

// Geometric alignment alone is insufficient: without a dark image ridge the
// same gap must remain untouched.
{
  const width = 160;
  const height = 80;
  const forehead = new Uint8Array(width * height);
  paintRect(forehead, width, 18, 28, 60, 32);
  paintRect(forehead, width, 84, 30, 132, 34);
  const result = extractFineWrinkleLines(
    { forehead, frown: new Uint8Array(width * height), wrinkle: new Uint8Array(width * height) },
    width,
    height,
    { sourceImageRgba: solidRgba(width, height) },
  );
  assert.equal(result.summary.recoveredForeheadEndpointCount, 0);
  assert.equal(result.summary.recoveredForeheadEndpointLengthPx, 0);
  assert.equal(result.validation.passed, true);
}

console.log("automatic fine wrinkle line extraction tests passed");
