import assert from "node:assert/strict";
import { refineFilledCandidate } from "../web/src/services/controlledMarkerFilledCandidate.ts";
import type {
  ControlledMarkerDetection,
  MarkerImageData,
  MarkerPoint,
} from "../web/src/services/controlledMarkerDetection.ts";

const center = { x: 48, y: 48 };
const boundary: MarkerPoint[] = Array.from({ length: 32 }, (_, index) => {
  const angle = (index / 32) * Math.PI * 2;
  return { x: center.x + Math.cos(angle) * 8, y: center.y + Math.sin(angle) * 8 };
});
const image: MarkerImageData = {
  width: 96,
  height: 96,
  data: new Uint8ClampedArray(96 * 96 * 4).fill(180),
};
for (let index = 3; index < image.data.length; index += 4) image.data[index] = 255;

// This models the 062 failure contract: strong dark-core/scan consensus, but
// the actual radial boundary support is only 23% and most of the contour was
// reconstructed. Those recovery flags alone must not make it a trusted result.
const weaklySupportedRecovered: ControlledMarkerDetection = {
  ok: true,
  failure_code: null,
  center,
  boundary,
  area_px: 201,
  bbox: { x: 40, y: 40, width: 16, height: 16 },
  geometry_mode: "dark_component",
  seed_relation: "on_marker",
  confidence: 0.8,
  candidate_count: 1,
  warnings: [
    "solid_component_outer_boundary_recovered",
    "solid_boundary_envelope_recovered",
    "scan_solid_core_anchor_recovered",
    "fixed_scale_unclipped_solid_anchor_recovered",
  ],
  scan: { radius_px: 39 },
  diagnostics: {
    boundary_support_ratio: 0.229,
    repair_fraction: 0.771,
    solid_component_contrast: 52.77,
    solid_component_core_dark_ratio: 0.955,
    scan_solid_proposal_consensus_count: 3,
    solid_boundary_envelope_support_ratio: 1,
    solid_boundary_envelope_area_ratio: 1.95,
    scan_solid_proposal_area_px: 1032,
  },
};

const result = await refineFilledCandidate(
  image,
  center,
  { roiRadius: 39, analysisRoiRadius: 36, scanDiameterMm: 10 },
  weaklySupportedRecovered,
);

assert.notEqual(
  result.diagnostics?.filled_candidate_route,
  "preserved_supported_baseline_boundary",
  "weak radial support must not preserve the baseline as a trusted boundary",
);
assert.equal(result.ok, false, "the unsupported baseline must remain rejected when no local image proposal validates");

// A slightly wider weak recovery must not bypass the same validation merely
// because it crosses the local-analysis diameter (the fourth 062 nose click).
const wideBoundary = boundary.map((point) => ({
  x: center.x + (point.x - center.x) * 4.25,
  y: center.y + (point.y - center.y) * 4.25,
}));
const wideResult = await refineFilledCandidate(
  image,
  center,
  { roiRadius: 46, analysisRoiRadius: 36, scanDiameterMm: 15 },
  {
    ...weaklySupportedRecovered,
    boundary: wideBoundary,
    area_px: 3610,
    bbox: { x: 14, y: 14, width: 68, height: 68 },
    scan: { radius_px: 46 },
  },
);
assert.equal(wideResult.ok, false, "an oversized recovered contour without image evidence must not skip validation");
