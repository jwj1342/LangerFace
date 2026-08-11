import assert from "node:assert/strict";
import fs from "node:fs";

import { detectControlledMarker } from "../web/src/services/controlledMarkerDetection.ts";

function image(width = 96, height = 96, value = 210) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
}

function disk(target: ReturnType<typeof image>, cx: number, cy: number, radius: number, value = 20) {
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      const index = (y * target.width + x) * 4;
      target.data[index] = value;
      target.data[index + 1] = value;
      target.data[index + 2] = value;
    }
  }
}

{
  const target = image();
  disk(target, 48, 46, 8);
  const result = detectControlledMarker(target, { x: 50, y: 47 });
  assert.equal(result.ok, true);
  assert.ok(result.center && Math.hypot(result.center.x - 48, result.center.y - 46) < 0.5);
  assert.ok(result.boundary.length >= 6);
  assert.ok(result.confidence > 0.8);
  assert.deepEqual(result.audit, { local_only: true, raw_media_retained: false, network_request_made: false });
  assert.equal("data" in result, false, "detector result must not retain raw pixels");
}

{
  const target = image();
  disk(target, 34, 40, 6);
  disk(target, 68, 40, 5);
  const result = detectControlledMarker(target, { x: 34, y: 40 });
  assert.equal(result.ok, true);
  assert.equal(result.candidate_count, 2);
  assert.ok(result.warnings.includes("multiple_candidates_in_roi"));
}

{
  const target = image();
  const none = detectControlledMarker(target, { x: 48, y: 48 });
  assert.equal(none.ok, false);
  assert.equal(none.failure_code, "no_dark_component");

  disk(target, 48, 48, 1);
  const tiny = detectControlledMarker(target, { x: 48, y: 48 });
  assert.equal(tiny.ok, false);
  assert.equal(tiny.failure_code, "component_too_small");
}

{
  const target = image(96, 96, 140);
  disk(target, 48, 48, 8, 128);
  const result = detectControlledMarker(target, { x: 48, y: 48 });
  assert.equal(result.ok, false);
  assert.ok(["no_dark_component", "low_contrast"].includes(result.failure_code || ""));
}

const source = fs.readFileSync("src/services/controlledMarkerDetection.ts", "utf8");
assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|\bfetch\s*\(|axios|onnxruntime|mediapipe/i,
  "controlled marker detector must stay pure, local, and SDK-independent");

console.log("test_controlled_marker_detection: seeded ROI, multiple, empty, tiny, and low-contrast cases passed");
