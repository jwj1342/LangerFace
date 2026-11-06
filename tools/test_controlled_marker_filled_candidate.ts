import assert from "node:assert/strict";
import { detectControlledMarkerWithProfileAsync } from "../web/src/services/controlledMarkerDetectionProfile.ts";
import type { ControlledMarkerDetection, MarkerPoint } from "../web/src/services/controlledMarkerDetection.ts";
import { evaluateCandidate } from "../web/src/services/controlledMarkerFilledCandidate.ts";

// Controlled shape evidence isolates the surround check from candidate search.
for (const brightness of [.7, 1]) for (const angle of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
  for (const attached of [false, true]) {
    const width = 128, height = 128, data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dx = x - 64, dy = y - 64, r = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx) - angle;
      const inCrease = attached && Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) < .65;
      const shade = r <= 14 ? .55 : inCrease ? .4 : 1;
      data.set([...[211, 174, 150].map(v => Math.round(v * shade * brightness)), 255], (y * width + x) * 4);
    }
    const boundary = Array.from({ length: 64 }, (_, i) => ({
      x: 64 + 14 * Math.cos(i * 2 * Math.PI / 64), y: 64 + 14 * Math.sin(i * 2 * Math.PI / 64),
    }));
    const baseline = { ok: false, boundary: [], warnings: [], diagnostics: {} } as unknown as ControlledMarkerDetection;
    const evaluated = evaluateCandidate({ width, height, data }, { x: 64, y: 64 }, 48, 36, baseline,
      { ok: true, boundary, area_px: Math.PI * 14 ** 2 });
    assert.equal(evaluated.reasons.includes('achromatic_boundary_continues_into_surround'), attached,
      `attached=${attached}, brightness=${brightness}, rotation=${angle}`);
    if (!attached) assert.equal(evaluated.result.ok, true, 'closed neutral target remains eligible');
  }
}

// Mathematical engineering inputs, not clinical boundary references.
function contains(point: MarkerPoint, boundary: MarkerPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const a = boundary[i], b = boundary[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const cases = ["solid", "highlight", "weak", "soft", "neutral-solid", "neutral-soft", "pen", "pen-gradient", "blank", "noise", "shadow", "hair"] as const;
for (const name of cases) {
  const width = 192, height = 192, data = new Uint8ClampedArray(width * height * 4);
  const truth = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const d = Math.hypot(x - 96, y - 96), noise = (((x * 41 + y * 61 + x * y * 7) % 19) - 9) / 9;
    let rgb = [211, 174, 150];
    if (name === "solid" || name === "highlight") {
      if (d <= 18) { rgb = [67, 47, 39]; truth[y * width + x] = 1; }
      if (name === "highlight" && Math.hypot(x - 100, y - 91) <= 9) rgb = [205, 199, 190];
    } else if (name === "weak") {
      if (d <= 18) { rgb = [203, 171, 148]; truth[y * width + x] = 1; }
      rgb = rgb.map(v => v + noise * 3);
    } else if (name === "soft") {
      const alpha = 1 / (1 + Math.exp((d - 17) / 1.4));
      rgb = [220, 185, 160].map((v, k) => v + ([93, 64, 48][k] - v) * alpha + noise);
      truth[y * width + x] = Number(d <= 17);
    } else if (name === "neutral-solid" || name === "neutral-soft") {
      // Same chromaticity as skin: low colour change alone is not a veto.
      const alpha = name === "neutral-solid" ? Number(d <= 18) : 1 / (1 + Math.exp((d - 18) / 1.2));
      rgb = rgb.map(v => v * (1 - .45 * alpha));
      truth[y * width + x] = Number(d <= 18);
    } else if ((name === "pen" || name === "pen-gradient")) {
      if (name === "pen-gradient") rgb = rgb.map(v => v - 8 * Math.exp(-d * d / 800));
      if (d >= 15 && d <= 18) rgb = [40, 35, 32];
      truth[y * width + x] = Number(d < 15);
    } else if (name === "noise") rgb = rgb.map(v => v + noise * 7);
    else if (name === "shadow") rgb = rgb.map(v => v - 45 * Math.exp(-d * d / (2 * 22 * 22)));
    else if (name === "hair" && Math.abs(x - (96 + 8 * Math.sin(y / 25))) < 1.5) rgb = [50, 35, 30];
    data.set([...rgb.map(v => Math.round(v)), 255], (y * width + x) * 4);
  }
  const signatures: string[] = [];
  let first: ControlledMarkerDetection | null = null;
  for (let repeat = 0; repeat < 3; repeat++) {
    const result = await detectControlledMarkerWithProfileAsync("small-lesion-boundary-candidate",
      { width, height, data }, { x: 96, y: 96 }, { roiRadius: 48, analysisRoiRadius: 36, scanDiameterMm: 20 });
    first ||= result;
    signatures.push(JSON.stringify(result.boundary));
    if (["blank", "noise", "shadow", "hair"].includes(name)) assert.equal(result.ok, false, `${name}: false selection`);
    else {
      assert.equal(result.ok, true, `${name}: rejected target`);
      let intersection = 0, union = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const selected = contains({ x: x + .5, y: y + .5 }, result.boundary), actual = !!truth[y * width + x];
        intersection += Number(selected && actual); union += Number(selected || actual);
      }
      assert(intersection / union >= .8, `${name}: incomplete/oversized boundary ${intersection / union}`);
      assert(result.boundary.every(p => Math.hypot(p.x - 96, p.y - 96) <= 49), `${name}: scan exceeded`);
    }
  }
  assert.equal(new Set(signatures).size, 1, `${name}: non-deterministic`);
  if (name.startsWith("pen")) assert.equal(first!.geometry_mode, "enclosed_region", "pen path changed");
}
console.log("filled candidate tests passed: 12 inputs x 3, including neutral compact targets, highlight, weak/soft target, pen and negatives");
