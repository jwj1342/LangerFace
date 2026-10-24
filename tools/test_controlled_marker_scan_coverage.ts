import assert from "node:assert/strict";
import { detectControlledMarkerWithProfileAsync } from "../web/src/services/controlledMarkerDetectionProfile.ts";

const width = 192, height = 192, data = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const target = Math.hypot(x - 96, y - 96) <= 18;
  const highlight = Math.hypot(x - 101, y - 91) < 6;
  const color = target ? highlight ? [198, 190, 178] : [70, 45, 35] : [211, 174, 150];
  data.set([...color, 255], (y * width + x) * 4);
}
function contains(p: {x: number; y: number}, b: {x: number; y: number}[]) {
  let yes = false;
  for (let i = 0, j = b.length - 1; i < b.length; j = i++) {
    const a = b[i], c = b[j];
    if ((a.y > p.y) !== (c.y > p.y) && p.x < (c.x - a.x) * (p.y - a.y) / (c.y - a.y) + a.x) yes = !yes;
  }
  return yes;
}
let calls = 0;
for (const [mm, radius] of [[15, 36], [20, 48], [25, 60]]) {
  for (let position = 0; position < 9; position++) {
    const angle = (position - 1) * Math.PI / 4, offset = position === 0 ? 0 : radius * .94 - 22;
    const seed = {x: 96 + Math.cos(angle) * offset, y: 96 + Math.sin(angle) * offset};
    const signatures = [];
    for (let trial = 0; trial < 3; trial++) {
      const result = await detectControlledMarkerWithProfileAsync("small-lesion-boundary-candidate",
        {width, height, data}, seed, {roiRadius: radius, analysisRoiRadius: 36, scanDiameterMm: mm});
      calls++;
      assert(result.ok, `${mm}mm position ${position} rejected a covered object`);
      for (const p of [{x: 84, y: 96}, {x: 108, y: 96}, {x: 96, y: 84}, {x: 96, y: 108}])
        assert(contains(p, result.boundary), `${mm}mm position ${position} lost an interior probe`);
      assert(result.boundary.every(p => Math.hypot(p.x - seed.x, p.y - seed.y) <= radius), "operator scan escaped");
      signatures.push(JSON.stringify(result.boundary));
    }
    assert.equal(new Set(signatures).size, 1, `${mm}mm position ${position} is not repeatable`);
  }
}
console.log(`scan coverage passed: 3 diameters × 9 positions × 3 repetitions = ${calls}; synthetic engineering input, not clinical truth`);
