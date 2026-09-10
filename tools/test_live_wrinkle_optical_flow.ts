import assert from "node:assert/strict";
import { WrinkleOpticalFlowTracker } from "../web/src/services/liveWrinkleOpticalFlow.ts";
import type { WrinkleTextureFrame } from "../web/src/services/liveWrinkleTextureTracking.ts";

const width = 240;
const height = 180;
const noise = new Float32Array(width * height);
let random = 42;
for (let i = 0; i < noise.length; i += 1) {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  noise[i] = random / 0xffffffff;
}
const texture = new Float32Array(width * height);
for (let y = 1; y < height - 1; y += 1) {
  for (let x = 1; x < width - 1; x += 1) {
    let value = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) value += noise[(y + dy) * width + x + dx];
    }
    texture[y * width + x] = 50 + 160 * value / 9 - 35 * Math.exp(-((y - 80) ** 2) / 3);
  }
}
function frame(dx = 0, dy = 0, deform = false): WrinkleTextureFrame {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - dx;
      const sy = y - dy - (deform ? 3 * Math.sin(sx / 30) : 0);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= width - 1 || y0 >= height - 1) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      gray[y * width + x] = Math.round(
        (1 - fy) * ((1 - fx) * texture[y0 * width + x0] + fx * texture[y0 * width + x0 + 1])
        + fy * ((1 - fx) * texture[(y0 + 1) * width + x0] + fx * texture[(y0 + 1) * width + x0 + 1]),
      );
    }
  }
  return { width, height, sourceWidth: width, sourceHeight: height, gray };
}
const line = {
  id: "forehead", className: "forehead",
  points: Array.from({ length: 101 }, (_, i) => [60 + i, 80] as [number, number]),
};
const reference = frame();
const tracker = await WrinkleOpticalFlowTracker.create();
try {
  tracker.seed(reference, [line], 0);
  const mesh = [{ ...line, points: line.points.map(([x, y]) => [x + 3, y + 2] as [number, number]) }];
  const tracked = tracker.update(frame(4, 6, true), mesh, 1 / 24);
  const points = tracked.flatMap((item) => item.points);
  assert.ok(points.length >= 80, "textured skin must retain at least 80% of the original curve");
  const meanError = points.reduce((sum, [x, y]) => (
    sum + Math.abs(y - (86 + 3 * Math.sin((x - 4) / 30)))
  ), 0) / points.length;
  assert.ok(meanError < 0.7, `local skin deformation must bypass mesh lag (${meanError.toFixed(3)} px)`);
  assert.ok(tracker.diagnostics().meanMeshCorrectionPx > 2);
  assert.equal(tracker.hasFrame(1 / 24), true, "duplicate render ticks do not advance tracking");
  assert.deepEqual(tracker.update(frame(4, 6, true), mesh, 1 / 24), tracked);

  const returned = tracker.update(reference, [line], 0);
  assert.equal(tracker.diagnostics().mode, "reference", "video loops match the original first frame");
  assert.ok(returned.flatMap((item) => item.points).every(([, y]) => Math.abs(y - 80) < 0.1));

  tracker.suspend();
  assert.equal(tracker.hasFrame(0), false);
  assert.ok(tracker.update(reference, [line], 1).length,
    "reacquisition uses saved first-frame patches without extracting new lines");

  const blank = { ...reference, gray: new Uint8Array(width * height).fill(128) };
  assert.deepEqual(tracker.update(blank, [line], 1.04), [],
    "lost skin patches must be hidden, never replaced by drifting mesh-only curves");
  assert.equal(tracker.diagnostics().acceptedCount, 0);
  tracker.suspend();
  assert.ok(tracker.update(reference, [line], 2).length);
  console.log(`ok: OpenCV skin tracking, local deformation ${meanError.toFixed(3)} px, loop, loss and reacquisition`);
} finally {
  tracker.dispose();
}
