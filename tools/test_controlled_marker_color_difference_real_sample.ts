import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";

import { detectControlledMarker } from "../web/src/services/controlledMarkerDetectionColorV035.ts";
import { detectControlledMarker as detectWithLegacyCore } from "../web/src/services/controlledMarkerDetectionLegacyV023.ts";
import type { MarkerPoint } from "../web/src/services/controlledMarkerDetection.ts";

const width = 112;
const height = 112;
const options = { roiRadius: 48, expectedDiameterPx: 38.43, scanDiameterMm: 20 };

interface ReviewedTruth {
  center: MarkerPoint;
  radiusX: number;
  radiusY: number;
  rotationRad: number;
}

interface ReviewedSample {
  name: string;
  fixtureName: string;
  fixtureHash: string;
  sourceHash: string;
  sourceCropOrigin: MarkerPoint;
  seed: MarkerPoint;
  truth: ReviewedTruth;
  expectedPath: "legacy" | "color_difference";
}

function fixture(name: string, expectedHash: string) {
  const encoded = fs.readFileSync(new URL(`./fixtures/${name}.rgba.gz.b64`, import.meta.url), "utf8");
  const raw = zlib.gunzipSync(Buffer.from(encoded.replace(/\s/g, ""), "base64"));
  assert.equal(raw.byteLength, width * height * 4, `${name} RGBA byte length changed`);
  assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), expectedHash,
    `${name} pixel fingerprint changed`);
  return { width, height, data: new Uint8ClampedArray(raw) };
}

// These local crops are exact pixels from the user-provided 01.png, 06.png,
// 08.png and 11-15.png sources. The ellipses below are visually reviewed approximations of
// the complete pen rings, independent of detector output. They are engineering
// regression truth, not medical ground truth.
const reviewedSamples: ReviewedSample[] = JSON.parse(fs.readFileSync(
  new URL("./fixtures/controlled_marker_reviewed_samples.local.json", import.meta.url), "utf8",
));
assert.equal(reviewedSamples.length, 8, "local reviewed sample manifest must contain all 8 cases");

const mediumSkinReviewedSample = reviewedSamples.find((sample) => sample.name === "08-medium-skin");
const darkSkinReviewedSample = reviewedSamples.find((sample) => sample.name === "11-dark-skin");
assert.ok(mediumSkinReviewedSample, "08 medium-skin reviewed sample must exist");
assert.ok(darkSkinReviewedSample, "11 dark-skin reviewed sample must exist");

function pointInPolygon(point: MarkerPoint, polygon: MarkerPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)
        / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function truthContains(point: MarkerPoint, truth: ReviewedTruth): boolean {
  const dx = point.x - truth.center.x;
  const dy = point.y - truth.center.y;
  const cosine = Math.cos(truth.rotationRad);
  const sine = Math.sin(truth.rotationRad);
  const rotatedX = dx * cosine + dy * sine;
  const rotatedY = -dx * sine + dy * cosine;
  return (rotatedX / truth.radiusX) ** 2 + (rotatedY / truth.radiusY) ** 2 <= 1;
}

function overlap(boundary: MarkerPoint[], truth: ReviewedTruth) {
  let intersection = 0;
  let union = 0;
  let prediction = 0;
  let expected = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = { x: x + 0.5, y: y + 0.5 };
      const predicted = pointInPolygon(point, boundary);
      const actual = truthContains(point, truth);
      if (predicted) prediction += 1;
      if (actual) expected += 1;
      if (predicted && actual) intersection += 1;
      if (predicted || actual) union += 1;
    }
  }
  return {
    iou: intersection / Math.max(1, union),
    truthCoverage: intersection / Math.max(1, expected),
    predictionPrecision: intersection / Math.max(1, prediction),
  };
}

const summaries = [];
for (const sample of reviewedSamples) {
  const image = fixture(sample.fixtureName, sample.fixtureHash);
  const result = detectControlledMarker(image, sample.seed, options);
  assert.equal(result.ok, true, `${sample.name} marker must not be missed: ${JSON.stringify(result)}`);
  assert.ok(result.center && result.bbox, `${sample.name} result must include center and bbox`);
  const centerError = Math.hypot(
    result.center.x - sample.truth.center.x,
    result.center.y - sample.truth.center.y,
  );
  const metrics = overlap(result.boundary, sample.truth);
  assert.ok(centerError <= 5, `${sample.name} center error ${centerError.toFixed(2)}px exceeds reviewed truth`);
  assert.ok(metrics.iou >= 0.80,
    `${sample.name} boundary IoU ${metrics.iou.toFixed(3)} misses reviewed marker`);
  assert.ok(metrics.truthCoverage >= 0.84,
    `${sample.name} truth coverage ${metrics.truthCoverage.toFixed(3)} leaves marker outside`);
  assert.ok(metrics.predictionPrecision >= 0.84,
    `${sample.name} precision ${metrics.predictionPrecision.toFixed(3)} absorbs normal skin`);

  if (sample.expectedPath === "legacy") {
    const legacy = detectWithLegacyCore(image, sample.seed, options);
    assert.equal(legacy.ok, true, `${sample.name} must remain valid in the frozen legacy core`);
    assert.deepEqual(result, legacy,
      `${sample.name} must preserve the already-correct legacy geometry instead of replacing it`);
  } else {
    assert.ok(result.warnings.some((warning) => warning.startsWith("color_difference")),
      `${sample.name} must record that color-difference recovery was used`);
  }

  summaries.push({
    sample: sample.name,
    sourceHash: sample.sourceHash,
    sourceCropOrigin: sample.sourceCropOrigin,
    centerError: Number(centerError.toFixed(3)),
    iou: Number(metrics.iou.toFixed(3)),
    truthCoverage: Number(metrics.truthCoverage.toFixed(3)),
    predictionPrecision: Number(metrics.predictionPrecision.toFixed(3)),
    bbox: result.bbox,
  });
}

const mediumSkinProductScale = detectControlledMarker(
  fixture(
    "controlled_marker_medium_skin_08_marker",
    "cbf0d04e5b120ae3b28e2bb56c28629b14c1f565e4c8bbe57dbf6dcf37c3ac01",
  ),
  { x: 56, y: 56 },
  { roiRadius: 46, expectedDiameterPx: 36.52791140632558, scanDiameterMm: 20 },
);
assert.equal(mediumSkinProductScale.ok, true,
  `medium-skin product-scale marker must not be missed: ${JSON.stringify(mediumSkinProductScale)}`);
assert.ok(mediumSkinProductScale.center,
  "medium-skin product-scale result must include a center");
const mediumSkinProductMetrics = overlap(mediumSkinProductScale.boundary, mediumSkinReviewedSample.truth);
assert.ok(mediumSkinProductMetrics.iou >= 0.80,
  `medium-skin product-scale IoU ${mediumSkinProductMetrics.iou.toFixed(3)} misses reviewed marker`);
assert.ok(mediumSkinProductMetrics.truthCoverage >= 0.84,
  `medium-skin product-scale coverage ${mediumSkinProductMetrics.truthCoverage.toFixed(3)} leaves marker outside`);
assert.ok(mediumSkinProductMetrics.predictionPrecision >= 0.84,
  `medium-skin product-scale precision ${mediumSkinProductMetrics.predictionPrecision.toFixed(3)} absorbs normal skin`);
assert.ok(mediumSkinProductScale.warnings.includes("color_difference_stroke_boundary_recovered"),
  "medium-skin product-scale recovery must record the bounded outer-stroke evidence path");

const darkSkinImage = fixture(
  "controlled_marker_dark_skin_11_marker",
  "15a71d167b9fcd32bd489ce1f7ac2c9bef7fdf3026b44cfe2cdb6d00e9e673c4",
);
const darkSkinTruth = darkSkinReviewedSample.truth;
for (const nearbySeed of [
  { x: 54.5, y: 56.5 },
  { x: 58.5, y: 56.5 },
  { x: 56.5, y: 53.5 },
  { x: 56.5, y: 59.5 },
]) {
  const nearby = detectControlledMarker(darkSkinImage, nearbySeed, options);
  assert.equal(nearby.ok, true, `nearby interior seed must recover the same marker: ${JSON.stringify(nearby)}`);
  assert.ok(nearby.center, "nearby interior seed result must include a center");
  const nearbyCenterError = Math.hypot(
    nearby.center.x - darkSkinTruth.center.x,
    nearby.center.y - darkSkinTruth.center.y,
  );
  const nearbyMetrics = overlap(nearby.boundary, darkSkinTruth);
  assert.ok(nearbyCenterError <= 5,
    `nearby seed center error ${nearbyCenterError.toFixed(2)}px exceeds reviewed truth`);
  assert.ok(nearbyMetrics.iou >= 0.78,
    `nearby seed boundary IoU ${nearbyMetrics.iou.toFixed(3)} misses reviewed marker`);
}

const unmarkedImage = fixture(
  "controlled_marker_dark_skin_11_unmarked_cheek",
  "006e14ffaf26ac56af3642554c418a07f6accdeb0f30a24656a2a68ac9d7f1bf",
);
const unmarkedCheek = detectControlledMarker(unmarkedImage, { x: 56, y: 56 }, options);
assert.equal(unmarkedCheek.ok, false,
  `unmarked cheek texture must fail closed: ${JSON.stringify(unmarkedCheek)}`);

for (const regression of [
  { sampleName: "01-light-skin", seed: { x: 72.66, y: 56.5 } },
  { sampleName: "11-dark-skin", seed: { x: 71.288, y: 56 } },
  { sampleName: "13-dark-skin-left-cheek", seed: { x: 71.288, y: 56 } },
  { sampleName: "14-dark-skin-right-jaw", seed: { x: 71.288, y: 56 } },
  { sampleName: "15-dark-skin-chin", seed: { x: 72, y: 56 } },
]) {
  const sample = reviewedSamples.find((entry) => entry.name === regression.sampleName);
  assert.ok(sample, `${regression.sampleName} reviewed sample must exist`);
  const image = fixture(sample.fixtureName, sample.fixtureHash);
  const result = detectControlledMarker(image, regression.seed, options);
  assert.equal(result.ok, true,
    `${regression.sampleName} fully covered marker must not depend on the scan-circle centre: ${JSON.stringify(result)}`);
  const metrics = overlap(result.boundary, sample.truth);
  assert.ok(metrics.iou >= 0.80,
    `${regression.sampleName} shifted-seed IoU ${metrics.iou.toFixed(3)} misses reviewed marker`);
  assert.ok(metrics.truthCoverage >= 0.84,
    `${regression.sampleName} shifted-seed coverage ${metrics.truthCoverage.toFixed(3)} leaves marker outside`);
  assert.ok(metrics.predictionPrecision >= 0.84,
    `${regression.sampleName} shifted-seed precision ${metrics.predictionPrecision.toFixed(3)} absorbs normal skin`);
}

console.log("controlled marker cross-skin reviewed truth tests passed", summaries);
