import assert from "node:assert/strict";
import { evaluateCandidate } from "../web/src/services/controlledMarkerFilledCandidate.ts";
import type { ControlledMarkerDetection } from "../web/src/services/controlledMarkerDetection.ts";

// Synthetic evidence: scan coverage owns the selection, not the click pixel.
const width = 192, height = 192;
const data = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  data.set(Math.hypot(x - 96, y - 96) <= 18 ? [67, 47, 39, 255] : [211, 174, 150, 255], (y * width + x) * 4);
}
const boundary = Array.from({ length: 64 }, (_, i) => ({ x: 96 + 18 * Math.cos(i * Math.PI / 32), y: 96 + 18 * Math.sin(i * Math.PI / 32) }));
const baseline = {
  ok: true, boundary, area_px: Math.PI * 324, center: { x: 96, y: 96 },
  bbox: { x: 78, y: 78, width: 36, height: 36 }, geometry_mode: "dark_component",
  seed_relation: "enclosed", warnings: [], diagnostics: {},
} as unknown as ControlledMarkerDetection;
const proposal = { ok: false, boundary: [], area_px: 0 };
const center = evaluateCandidate({ width, height, data }, { x: 96, y: 96 }, 48, 36, baseline, proposal);
assert.equal(center.result.ok, true, "supported interior must remain accepted");
for (const x of [112, 116, 122]) {
  const supported = evaluateCandidate({ width, height, data }, { x, y: 96 }, 48, 36, baseline, proposal);
  assert.equal(supported.result.ok, true, "a supported fully contained boundary survives edge/outside clicks");
}
for (const x of [132, 136]) {
  const rejected = evaluateCandidate({ width, height, data }, { x, y: 96 }, 48, 36, baseline, proposal);
  assert.equal(rejected.route, "reject_unverified_filled_fallback");
  assert.equal(rejected.result.ok, false);
  assert.equal(rejected.result.area_px, 0);
  assert.deepEqual(rejected.result.boundary, []);
  assert((rejected.result.rejected_boundary?.length || 0) >= 3);
  assert(rejected.result.rejected_reasons?.includes("not_enclosed_within_scan"));
}
console.log("scan coverage: supported edge/outside clicks accepted; clipped candidates remain rejected");
