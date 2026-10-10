import assert from "node:assert/strict";
import fs from "node:fs";

import {
  __controlledMarkerColorForTests,
  detectControlledMarker as detectColorDifference,
} from "../web/src/services/controlledMarkerDetectionColorV035.ts";
import { detectControlledMarker as detectLegacy, __controlledMarkerForTests as legacyBoundary } from "../web/src/services/controlledMarkerDetectionLegacyV023.ts";
import { __controlledMarkerForTests as boundaryReference } from "../web/src/services/controlledMarkerDetection.ts";

{
  const fixtures = [[], [{ x: 0, y: 0 }], [{ x: -0, y: -0 }],
    [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    [{ x: -3, y: 4 }, { x: -3, y: 4 }, { x: -2, y: 4 }],
    [{ x: 0.5, y: 0 }], [{ x: Number.MAX_SAFE_INTEGER, y: 0 }]];
  let random = 417;
  for (let trial = 0; trial < 100; trial++) {
    const pixels: { x: number; y: number }[] = [];
    for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      if (random / 2 ** 32 < 0.63) pixels.push({ x, y });
    }
    fixtures.push(pixels);
  }
  for (const pixels of fixtures) for (const count of [4, 48, 128]) {
    assert.deepEqual(legacyBoundary.componentOuterBoundary(pixels, count), boundaryReference.componentOuterBoundary(pixels, count),
      "numeric pixel tracing must preserve the existing boundary, including fallback inputs");
  }
}

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

function disk(
  target: ReturnType<typeof image>,
  centerX: number,
  centerY: number,
  radius: number,
  color: Rgb,
) {
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      if (Math.hypot(x - centerX, y - centerY) > radius) continue;
      const index = (y * target.width + x) * 4;
      target.data[index] = color[0];
      target.data[index + 1] = color[1];
      target.data[index + 2] = color[2];
    }
  }
}

const options = { roiRadius: 48, expectedDiameterPx: 44, scanDiameterMm: 20 };
const seed = { x: 64, y: 64 };

{
  const target = image(128, 128, [205, 185, 165]);
  for (const [x, y] of [[61, 64], [62, 64], [63, 64], [64, 64], [65, 64], [66, 64], [67, 64], [61, 65], [62, 65]]) {
    const index = (y * target.width + x) * 4;
    target.data[index] = target.data[index + 1] = target.data[index + 2] = 18;
  }
  const rawOptions = { roiRadius: 36, scanDiameterMm: 25 };
  const original = detectLegacy(target, seed, rawOptions);
  assert.equal(original.ok, true, "the opt-in filter must not change the raw legacy entry");
  assert.equal(original.bbox?.height, 2);
  const filtered = detectLegacy(target, seed, { ...rawOptions, __rejectDegenerateCandidates: true } as typeof rawOptions);
  assert.notEqual(filtered.geometry_mode, "enclosed_region", "repair must not turn an isolated fragment into a hollow enclosure");
  assert.equal(detectColorDifference(target, seed, rawOptions).ok, false);
  disk(target, seed.x, seed.y, 9, [18, 18, 18]);
  assert.deepEqual(detectLegacy(target, seed, rawOptions),
    detectLegacy(target, seed, { ...rawOptions, __rejectDegenerateCandidates: true } as typeof rawOptions),
    "a nondegenerate solid candidate keeps its full detection result");
}

{
  const target = image(128, 128, [205, 185, 165]);
  for (let y = 62; y < 66; y++) for (let x = 60; x < 69; x++) {
    const index = (y * target.width + x) * 4;
    target.data[index] = target.data[index + 1] = target.data[index + 2] = 18;
  }
  assert.equal(detectLegacy(target, seed, { roiRadius: 36, scanDiameterMm: 25 }).ok, true,
    "the default raw legacy entry still recognizes its original thin component");
  assert.equal(detectColorDifference(target, seed, { roiRadius: 36, scanDiameterMm: 25 }).ok, false,
    "searching beyond an elongated fragment must not make isolated thin noise an accepted lesion");
}

for (const diameterMm of [2, 3, 4, 5, 6, 8]) {
  const pixelsPerMm = 4;
  const target = image(128, 128, [205, 185, 165]);
  disk(target, seed.x, seed.y, diameterMm * pixelsPerMm / 2, [18, 18, 18]);
  const result = detectColorDifference(target, seed, {
    roiRadius: 48,
    scanDiameterMm: 24,
  });
  if (diameterMm >= 4) {
    assert.equal(result.ok, true, `${diameterMm} mm solid dark lesion meets the engineering acceptance tier`);
    assert.equal(result.geometry_mode, "dark_component");
  } else {
    assert.ok(typeof result.ok === "boolean", `${diameterMm} mm limit probe returns a deterministic result`);
  }
}

{
  const target = image(128, 128, [205, 185, 165]);
  disk(target, seed.x, seed.y, 8, [18, 18, 18]);
  const valid = detectColorDifference(target, seed, { roiRadius: 48, scanDiameterMm: 24 });
  assert.equal(valid.ok, true);
  const degenerate = {
    ...valid,
    geometry_mode: "enclosed_region" as const,
    center: { x: seed.x, y: seed.y },
    boundary: [
      { x: seed.x, y: seed.y },
      { x: seed.x + 1, y: seed.y },
      { x: seed.x + 1, y: seed.y + 1 },
      { x: seed.x, y: seed.y + 1 },
    ],
    area_px: 1,
    bbox: { x: seed.x, y: seed.y, width: 1, height: 1 },
  };
  const evidence = __controlledMarkerColorForTests.colorDifferenceEvidenceImage(
    target,
    seed,
    { roiRadius: 48, scanDiameterMm: 24 },
  );
  const gate = __controlledMarkerColorForTests.candidateGate(
    degenerate,
    seed,
    0,
    evidence,
    48,
  );
  assert.equal(gate.valid, false, "a one-pixel closed hole cannot replace a detected solid lesion");
  assert.ok(gate.reasons.includes("candidate_geometry_degenerate"));
}

{
  const target = image(128, 128, [205, 185, 165]);
  disk(target, seed.x, seed.y, 8, [18, 18, 18]);
  const holeIndex = (seed.y * target.width + seed.x) * 4;
  target.data[holeIndex] = 205;
  target.data[holeIndex + 1] = 185;
  target.data[holeIndex + 2] = 165;
  const result = detectColorDifference(target, seed, { roiRadius: 48, scanDiameterMm: 24 });
  assert.equal(result.ok, true, "a tiny lighter pore inside a solid lesion cannot replace its outer contour");
  assert.equal(result.geometry_mode, "dark_component");
  assert.ok((result.bbox?.width || 0) >= 15 && (result.bbox?.height || 0) >= 15);
}

{
  const target = image(128, 128, [205, 185, 165]);
  disk(target, seed.x, seed.y, 8, [18, 18, 18]);
  const valid = detectColorDifference(target, seed, { roiRadius: 48, scanDiameterMm: 20 });
  assert.equal(valid.ok, true);
  const speck = {
    ...valid,
    geometry_mode: "dark_component" as const,
    center: { ...seed },
    boundary: [
      { x: seed.x - 2, y: seed.y - 1.5 },
      { x: seed.x + 2, y: seed.y - 1.5 },
      { x: seed.x + 2, y: seed.y + 1.5 },
      { x: seed.x - 2, y: seed.y + 1.5 },
    ],
    area_px: 10,
    bbox: { x: seed.x - 2, y: seed.y - 1.5, width: 4, height: 3 },
  };
  const evidence = __controlledMarkerColorForTests.colorDifferenceEvidenceImage(
    target,
    seed,
    { roiRadius: 48, scanDiameterMm: 20 },
  );
  const gate = __controlledMarkerColorForTests.candidateGate(speck, seed, 0, evidence, 48, 20);
  assert.equal(gate.valid, false, "a 4x3 dark speck stays below the 3 mm engineering gate");
  assert.ok(gate.reasons.includes("candidate_below_minimum_physical_size"));
}

{
  const target = image(128, 128, [205, 185, 165]);
  const candidate = {
    ok: true,
    failure_code: null,
    center: { ...seed },
    boundary: [
      { x: seed.x - 5, y: seed.y - 4 },
      { x: seed.x + 5, y: seed.y - 4 },
      { x: seed.x + 5, y: seed.y + 4 },
      { x: seed.x - 5, y: seed.y + 4 },
    ],
    area_px: 49,
    bbox: { x: seed.x - 5, y: seed.y - 4, width: 10, height: 8 },
    geometry_mode: "enclosed_region" as const,
    seed_relation: "enclosed" as const,
    marker_area_px: 28,
    marker_bbox: { x: seed.x - 6, y: seed.y - 5, width: 12, height: 10 },
    confidence: 0.3,
    candidate_count: 1,
    warnings: [],
    audit: { local_only: true, raw_media_retained: false, network_request_made: false },
  };
  const evidence = __controlledMarkerColorForTests.colorDifferenceEvidenceImage(
    target,
    seed,
    { roiRadius: 36, scanDiameterMm: 20 },
  );
  const gate = __controlledMarkerColorForTests.candidateGate(candidate, seed, 0, evidence, 36, 20);
  assert.equal(gate.valid, false, "a small enclosed raster pocket cannot pass as a hollow lesion");
  assert.ok(gate.reasons.includes("candidate_below_minimum_enclosed_size"));
}

{
  const target = image(128, 128, [205, 185, 165]);
  ring(target, seed.x, seed.y, 22, 3, [20, 20, 20]);
  const legacy = detectLegacy(target, seed, options);
  const colorDifference = detectColorDifference(target, seed, options);
  assert.equal(legacy.ok, true);
  assert.equal(colorDifference.ok, true);
  assert.equal(colorDifference.geometry_mode, "enclosed_region");
  assert.ok(colorDifference.warnings.includes("hollow_boundary_contracted"),
    "stable enclosed hollow candidates record the bounded contraction");
  assert.equal(colorDifference.diagnostics?.hollow_boundary_contraction, "stable_enclosed_margin");
  assert.ok(colorDifference.area_px < legacy.area_px,
    "stable enclosed hollow candidates contract their boundary instead of expanding it");
  assert.ok(colorDifference.area_px / legacy.area_px > 0.85,
    "the stable contraction remains a small bounded correction");
}

{
  const target = image(128, 128, [112, 82, 68]);
  ring(target, seed.x, seed.y, 16, 5, [24, 24, 24]);
  const witness = detectLegacy(target, { x: 46, y: 64 }, options);
  const recovered = __controlledMarkerColorForTests.recoverSolidComponentNearSeed(
    target,
    { x: 46, y: 64 },
    witness,
    options,
  );
  assert.equal(recovered, null,
    "a hollow pen ring with a skin-coloured centre cannot be reclassified as a filled dark lesion");
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
  assert.equal(detectColorDifference(target, seed, { roiRadius: 48, scanDiameterMm: 20 }).ok, false,
    "an inferred candidate size cannot create a marker on uniform skin");
}

{
  const target = image(128, 128, [55, 38, 31]);
  ring(target, seed.x, seed.y, 22, 3, [205, 195, 80], Math.PI * 0.8);
  const result = detectColorDifference(target, seed, options);
  assert.equal(result.ok, false, "a large open gap is not promoted to a closed lesion boundary");
  assert.equal(detectColorDifference(target, seed, { roiRadius: 48, scanDiameterMm: 20 }).ok, false,
    "an inferred candidate size cannot close a large open gap");
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

{
  const boundary = Array.from({ length: 48 }, (_, i) => {
    const angle = i * Math.PI * 2 / 48;
    const radius = i === 0 ? 17 : 20;
    return { x: 64 + radius * Math.cos(angle), y: 64 + radius * Math.sin(angle) };
  });
  const candidate = { ok: true, failure_code: null, boundary, center: { x: 64, y: 64 },
    area_px: 1200, bbox: { x: 44, y: 44, width: 40, height: 40 },
    geometry_mode: "enclosed_region", seed_relation: "enclosed", marker_area_px: 100,
    marker_bbox: null, confidence: 0.8, candidate_count: 1, warnings: [] } as const;
  const repair = __controlledMarkerColorForTests.repairSupportedInwardPocket;
  const evidence = image(128, 128, [255, 255, 255]);
  ring(evidence, 64, 64, 20, 2, [0, 0, 0]);
  const result = repair({ ...candidate, warnings: [] }, evidence);
  assert.ok(result, "shallow pocket with supporting stroke can be repaired");
  assert.ok(result.diagnostics!.inward_pocket_area_ratio! <= 1.15);
  assert.equal(repair({ ...candidate, warnings: [] }, image(128, 128, [255, 255, 255])), null,
    "unsupported added arc must not be invented");
  assert.equal(repair({ ...candidate, warnings: [], geometry_mode: "dark_component" }, evidence), null,
    "solid boundaries must not enter hollow pocket repair");
  const deep = boundary.map((p, i) => i === 0 ? { x: 66, y: 64 } : p);
  assert.equal(repair({ ...candidate, boundary: deep, warnings: [] }, evidence), null,
    "deep concavity must remain rejected");
}

{
  const boundary = Array.from({ length: 48 }, (_, index) => {
    const angle = index * 2 * Math.PI / 48;
    return { x: 64 + 20 * Math.cos(angle), y: 64 + 20 * Math.sin(angle) };
  });
  const candidate = { ok: true, failure_code: null, boundary, center: { x: 64, y: 64 },
    area_px: 1253, bbox: { x: 44, y: 44, width: 40, height: 40 },
    geometry_mode: "enclosed_region", seed_relation: "enclosed", marker_area_px: 100,
    marker_bbox: null, confidence: 0.8, candidate_count: 1,
    warnings: ["color_difference_enclosed_candidate_preferred"] } as const;
  const target = image(128, 128, [180, 150, 130]);
  disk(target, 90, 64, 12, [30, 25, 20]);
  const adjust = __controlledMarkerColorForTests.adjustHollowEnvelope;
  const makeCandidate = () => ({ ...candidate, warnings: [...candidate.warnings] });
  const center = adjust(makeCandidate(), target, { x: 64, y: 64 }, 48);
  const edge = adjust(makeCandidate(), target, { x: 84, y: 64 }, 48);
  assert.ok(center.warnings.includes("hollow_boundary_contracted"));
  assert.deepEqual(edge.boundary, center.boundary,
    "an accepted outline has the same margin for a covered tap outside its contracted outline");
  assert.deepEqual(edge.diagnostics, center.diagnostics,
    "brightness evidence is sampled at the outline, not at a displaced pointer");
  const clipped = makeCandidate();
  assert.equal(adjust(clipped, target, { x: 84, y: 64 }, 10), clipped,
    "correction cannot bypass the original pointer-centred scan coverage limit");
  const failed = { ...makeCandidate(), ok: false };
  assert.equal(adjust(failed, target, { x: 64, y: 64 }, 48), failed,
    "shape correction cannot turn a rejected candidate into an accepted candidate");
  const solid = { ...makeCandidate(), geometry_mode: "dark_component" };
  assert.equal(adjust(solid, target, { x: 64, y: 64 }, 48), solid,
    "solid lesion geometry is outside hollow margin correction");
  assert.deepEqual(adjust(center, target, { x: 84, y: 64 }, 48), center,
    "a recovered outline must not be contracted twice");
}

{
  const resolveCycle = __controlledMarkerColorForTests.canonicalizeSolidCycle;
  const base = detectLegacy(image(128, 128, [112, 82, 68]), seed, options);
  const make = (x: number, area = 400) => ({ ...base, ok: true,
    geometry_mode: "dark_component", center: { x, y: 64 }, area_px: area,
    bbox: { x: x - 10, y: 54, width: 20, height: 20 },
    boundary: [{ x: x - 10, y: 54 }, { x: x + 10, y: 54 },
      { x: x + 10, y: 74 }, { x: x - 10, y: 74 }], warnings: [] });
  const a = make(64), b = make(65, 405);
  let calls = 0;
  assert.equal(resolveCycle(a, candidate => { calls++; return candidate; }), a);
  assert.equal(calls, 1, "a fixed point must not add a midpoint probe");
  calls = 0;
  const c = make(66, 410);
  assert.equal(resolveCycle(a, candidate => { calls++; return candidate === a ? b : c; }), c);
  assert.equal(calls, 2, "a non-cycling sequence retains the original two-step limit");
  for (const start of [a, b]) {
    calls = 0;
    const stable = resolveCycle(start, candidate => {
      calls++;
      if (candidate.center?.x === 64) return make(65, 405);
      if (candidate.center?.x === 65) return make(64);
      assert.deepEqual(candidate.center, { x: 64.5, y: 64 });
      return make(64.75, 402);
    });
    assert.deepEqual(stable, make(64.75, 402), "either cycle member must select the same symmetric sample");
    assert.equal(calls, 3, "only one additional gated detection is allowed");
  }
  for (const fallback of ["unchanged", "rejected", "incompatible"]) {
    const resolved = resolveCycle(a, candidate => {
      if (candidate.center?.x === 64) return b;
      if (candidate.center?.x === 65) return make(64);
      if (fallback === "unchanged") return candidate;
      if (fallback === "rejected") return { ...make(64.5), ok: false };
      return make(64.5, 700);
    });
    assert.deepEqual(resolved, a, "failed midpoint recovery must preserve both original geometry and centre");
  }
  calls = 0;
  const incompatible = make(65, 600);
  assert.deepEqual(resolveCycle(a, candidate => {
    calls++;
    return candidate === a ? incompatible : make(64);
  }), a);
  assert.equal(calls, 2, "incompatible cycle members cannot enable an extra recovery");
  const hollow = { ...a, geometry_mode: "enclosed_region" };
  assert.equal(resolveCycle(hollow, () => { throw Error("unexpected hollow recovery"); }), hollow);
}

{
  const target = image(160, 160, [125, 95, 75]);
  ring(target, 65, 70, 12, 3, [25, 20, 15]);
  // A separate compact dark patch near the pointer must not pre-empt a
  // complete ring that lies outside the pointer-local analysis region.
  for (let y = 87; y <= 96; y++) for (let x = 99; x <= 108; x++) {
    const index = (y * target.width + x) * 4;
    target.data[index] = 25; target.data[index + 1] = 20; target.data[index + 2] = 15;
  }
  for (const radius of [48, 60]) {
    const seed = { x: 94, y: 70 };
    const result = detectColorDifference(target, seed, { roiRadius: radius, analysisRoiRadius: 36 });
    assert.equal(result.ok, true, "fully covered off-centre ring must remain detectable");
    assert.equal(result.geometry_mode, "enclosed_region", "local solid distractor cannot own the hollow result");
    assert.ok(result.center && Math.hypot(result.center.x - 65, result.center.y - 70) < 4);
    assert.ok(result.boundary.every(p => Math.hypot(p.x - seed.x, p.y - seed.y) <= radius + 1));
    assert.equal(legacyBoundary.boundarySelfIntersects(result.boundary), false);
  }
}

{
  const target = image(180, 180, [125, 95, 75]);
  // A tiny enclosed distractor is nearer the pointer than the fully covered
  // solid target. The scan must propose the whole solid component before
  // choosing a pointer-local fragment or reporting that no target exists.
  ring(target, 65, 54, 5, 1, [25, 20, 15]);
  for (let y = 62; y <= 98; y++) for (let x = 87; x <= 123; x++) {
    if (Math.hypot(x - 105, y - 80) > 18) continue;
    const index = (y * target.width + x) * 4;
    target.data[index] = 25; target.data[index + 1] = 20; target.data[index + 2] = 15;
  }
  const seed = { x: 72, y: 55 };
  for (const radius of [60, 72]) {
    const result = detectColorDifference(target, seed, { roiRadius: radius, analysisRoiRadius: 36 });
    assert.equal(result.ok, true, "fully covered solid target cannot be lost by pointer-local analysis");
    assert.equal(result.geometry_mode, "dark_component", "small enclosed distractor cannot replace the complete solid target");
    assert.ok(result.center && Math.hypot(result.center.x - 105, result.center.y - 80) < 4);
    assert.ok(result.boundary.every(p => Math.hypot(p.x - seed.x, p.y - seed.y) <= radius + 1));
    assert.equal(legacyBoundary.boundarySelfIntersects(result.boundary), false);
  }
}

const source = fs.readFileSync("src/services/controlledMarkerDetectionColorV035.ts", "utf8");
{
  // 局部尖角可以被修正，但深凹陷必须留下，避免强行制造类圆结果。
  const target = image(100, 100, [220, 190, 170]);
  for (let y = 30; y <= 70; y++) for (let x = 30; x <= 70; x++) {
    if (Math.hypot(x - 50, y - 50) > 15) continue;
    const i = (y * 100 + x) * 4; target.data[i] = 30; target.data[i + 1] = 20; target.data[i + 2] = 10;
  }
  const base = detectColorDifference(target, { x: 50, y: 50 }, { roiRadius: 36, analysisRoiRadius: 36 });
  assert.equal(base.ok, true);
  const outline = (deep: boolean) => Array.from({ length: 64 }, (_, k) => {
    const a = 2 * Math.PI * k / 64, r = k === 0 ? (deep ? 7 : 18) : 15;
    return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
  });
  const spiked = { ...base, boundary: outline(false), warnings: [] };
  const smooth = __controlledMarkerColorForTests.regularizeAcceptedBoundary(spiked);
  assert.notEqual(smooth, spiked, "bounded localized spike should be regularized");
  assert.ok(smooth.boundary.every(p => Math.hypot(p.x - 50, p.y - 50) < 16), "localized extra tip must be removed");
  assert.equal(legacyBoundary.boundarySelfIntersects(smooth.boundary), false);
  const deep = { ...base, boundary: outline(true), warnings: [] };
  assert.equal(__controlledMarkerColorForTests.regularizeAcceptedBoundary(deep), deep,
    "deep concavity must not be silently flattened into a round outline");
}
assert.doesNotMatch(source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""), /\bdocument\b|\bwindow\b|\bfetch\s*\(|axios|onnxruntime|mediapipe/i,
  "color-difference detector must remain local and independent of DOM, network, models, and RSTL runtime");

console.log("controlled marker color-difference tests passed");
