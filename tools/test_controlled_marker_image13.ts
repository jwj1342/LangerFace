import assert from "node:assert/strict";
import fs from "node:fs";
import { __controlledMarkerColorForTests as helpers } from "../web/src/services/controlledMarkerDetectionColorV035.ts";
import type { ControlledMarkerDetection, MarkerImageData, MarkerPoint } from "../web/src/services/controlledMarkerDetection.ts";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/controlled_marker_image13_spur.json", import.meta.url), "utf8"));
assert.equal(fixture.provenance.sourceSha256, "4484520ade7d94ddf43f57636f0b00733ad062f3a620a5a50b585e43a124cf35");
const evidence: MarkerImageData = {
  width: fixture.image.width,
  height: fixture.image.height,
  data: new Uint8ClampedArray(Buffer.from(fixture.image.dataBase64, "base64")),
};
const source = fixture.result as ControlledMarkerDetection;
const sourceSnapshot = JSON.stringify(source);
const top = (boundary: MarkerPoint[]) => Math.min(...boundary.map((point) => point.y));
const bottom = (boundary: MarkerPoint[]) => Math.max(...boundary.map((point) => point.y));
const area = (boundary: MarkerPoint[]) => Math.abs(boundary.reduce((sum, point, index) => {
  const next = boundary[(index + 1) % boundary.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0)) / 2;

const repaired = helpers.reconcileDenoisedStrokeEnvelope(
  source,
  fixture.seed,
  fixture.options.expectedDiameterPx,
  evidence,
  fixture.options.roiRadius,
);
assert.notEqual(repaired, source);
assert.equal(JSON.stringify(source), sourceSnapshot, "the frozen detector output remains immutable");
assert.equal(repaired.diagnostics?.boundary_regularization, "supported_radial_bridge");
assert.ok(repaired.warnings.includes("boundary_supported_narrow_spur_trimmed"));
assert.equal(repaired.boundary.length, source.boundary.length);
assert.ok(top(repaired.boundary) - top(source.boundary) >= 4,
  "the narrow top spur is shortened by at least four source pixels");
assert.ok(Math.abs(bottom(repaired.boundary) - bottom(source.boundary)) < 1e-9,
  "the opposite lesion edge is untouched");
assert.ok(area(repaired.boundary) / area(source.boundary) >= 0.97,
  "the repair retains at least 97 percent of the detected region");
assert.ok((repaired.diagnostics?.boundary_regularization_arc_fraction ?? 1) <= 0.10);
assert.ok((repaired.diagnostics?.boundary_regularization_replacement_support_ratio ?? 0) >= 0.80);
assert.equal(helpers.candidateGate(
  repaired,
  fixture.seed,
  fixture.options.expectedDiameterPx,
  evidence,
  fixture.options.roiRadius,
).valid, true, "the repaired image13 candidate passes the unchanged product gate");

const unsupported: MarkerImageData = {
  ...evidence,
  data: new Uint8ClampedArray(evidence.width * evidence.height * 4).fill(255),
};
const fullySupported: MarkerImageData = {
  ...evidence,
  data: new Uint8ClampedArray(evidence.width * evidence.height * 4),
};
assert.equal(helpers.trimSupportedNarrowBoundarySpur(source, unsupported), source,
  "geometry alone cannot erase a protrusion without pixel evidence for the replacement arc");

function syntheticResult(boundary: MarkerPoint[]): ControlledMarkerDetection {
  return {
    ...source,
    center: { x: 36, y: 42 },
    boundary,
    bbox: { x: 10, y: 16, width: 52, height: 52 },
    marker_bbox: { x: 9, y: 15, width: 54, height: 54 },
    diagnostics: { ...source.diagnostics, boundary_smoothing: "periodic_constrained" },
  };
}
const broadLobe = Array.from({ length: 48 }, (_, index) => {
  const angle = index / 48 * Math.PI * 2;
  const radius = index <= 11 ? 29 : 24;
  return { x: 36 + Math.cos(angle) * radius, y: 42 + Math.sin(angle) * radius };
});
assert.equal(helpers.trimSupportedNarrowBoundarySpur(syntheticResult(broadLobe), fullySupported).diagnostics?.boundary_regularization,
  source.diagnostics?.boundary_regularization,
  "a broad lobe is preserved rather than classified as a narrow raster spur");

const smallRoughness = Array.from({ length: 48 }, (_, index) => {
  const angle = index / 48 * Math.PI * 2;
  const radius = 24 + (index >= 3 && index <= 6 ? 1.5 : 0);
  return { x: 36 + Math.cos(angle) * radius, y: 42 + Math.sin(angle) * radius };
});
assert.equal(helpers.trimSupportedNarrowBoundarySpur(syntheticResult(smallRoughness), fullySupported).diagnostics?.boundary_regularization,
  source.diagnostics?.boundary_regularization,
  "minor local roughness remains under the scale-relative trigger");

const isolatedPoint = Array.from({ length: 48 }, (_, index) => {
  const angle = index / 48 * Math.PI * 2;
  const radius = index === 4 ? 34 : 24;
  return { x: 36 + Math.cos(angle) * radius, y: 42 + Math.sin(angle) * radius };
});
assert.equal(helpers.trimSupportedNarrowBoundarySpur(syntheticResult(isolatedPoint), fullySupported).diagnostics?.boundary_regularization,
  source.diagnostics?.boundary_regularization,
  "an isolated large point is not silently erased as a multi-point narrow spur");

const twoSpurs = Array.from({ length: 48 }, (_, index) => {
  const angle = index / 48 * Math.PI * 2;
  const radius = (index >= 2 && index <= 5) || (index >= 26 && index <= 29) ? 30 : 24;
  return { x: 36 + Math.cos(angle) * radius, y: 42 + Math.sin(angle) * radius };
});
assert.equal(helpers.trimSupportedNarrowBoundarySpur(syntheticResult(twoSpurs), fullySupported).diagnostics?.boundary_regularization,
  source.diagnostics?.boundary_regularization,
  "two independent protrusions are ambiguous and fail closed");

for (const malformed of [[], source.boundary.slice(0, 4), source.boundary.map((point, index) => (
  index === 2 ? { x: Number.NaN, y: point.y } : point
))]) {
  const input = syntheticResult(malformed);
  assert.equal(helpers.trimSupportedNarrowBoundarySpur(input, evidence), input,
    "missing or non-finite boundaries fail closed");
}
console.log("test_controlled_marker_image13: frozen spur repair, evidence gate, preservation and malformed inputs passed");
