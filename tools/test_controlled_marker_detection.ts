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

function horizontalGradientImage(width: number, height: number, left: number, right: number) {
  const target = image(width, height, left);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(left + (right - left) * x / Math.max(1, width - 1));
      const index = (y * width + x) * 4;
      target.data[index] = value;
      target.data[index + 1] = value;
      target.data[index + 2] = value;
    }
  }
  return target;
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

function ring(target: ReturnType<typeof image>, cx: number, cy: number, radius: number, thickness = 3, value = 20) {
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (Math.abs(distance - radius) > thickness / 2) continue;
      const index = (y * target.width + x) * 4;
      target.data[index] = value;
      target.data[index + 1] = value;
      target.data[index + 2] = value;
    }
  }
}

function ellipseRing(
  target: ReturnType<typeof image>,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  thickness = 3,
  value = 35,
) {
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const dx = (x - cx) / radiusX;
      const dy = (y - cy) / radiusY;
      const normalizedDistance = Math.hypot(dx, dy);
      if (Math.abs(normalizedDistance - 1) > thickness / Math.min(radiusX, radiusY)) continue;
      const index = (y * target.width + x) * 4;
      target.data[index] = value;
      target.data[index + 1] = value;
      target.data[index + 2] = value;
    }
  }
}

function relativeEllipseRing(
  target: ReturnType<typeof image>,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  contrast: number,
  thickness = 3,
  gapRadians = 0,
) {
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const dx = (x - cx) / radiusX;
      const dy = (y - cy) / radiusY;
      if (Math.abs(Math.hypot(dx, dy) - 1) > thickness / Math.min(radiusX, radiusY)) continue;
      if (gapRadians > 0 && Math.abs(Math.atan2(dy, dx)) < gapRadians / 2) continue;
      const index = (y * target.width + x) * 4;
      const background = Number(target.data[index]);
      const value = Math.max(0, background - contrast);
      target.data[index] = value;
      target.data[index + 1] = value;
      target.data[index + 2] = value;
    }
  }
}

function irregularRing(target: ReturnType<typeof image>, cx: number, cy: number, thickness = 4, value = 20) {
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const angle = Math.atan2(dy, dx);
      const radius = 19 + 2.5 * Math.sin(angle * 3) + 1.5 * Math.cos(angle * 5);
      if (Math.abs(Math.hypot(dx, dy) - radius) > thickness / 2) continue;
      const index = (y * target.width + x) * 4;
      target.data[index] = value;
      target.data[index + 1] = value;
      target.data[index + 2] = value;
    }
  }
}

function ringWithGap(target: ReturnType<typeof image>, cx: number, cy: number, gapRadians: number, thickness = 4, value = 20) {
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      if (Math.abs(distance - 18) > thickness / 2) continue;
      const angle = Math.atan2(dy, dx);
      if (Math.abs(angle) < gapRadians / 2) continue;
      const index = (y * target.width + x) * 4;
      target.data[index] = value;
      target.data[index + 1] = value;
      target.data[index + 2] = value;
    }
  }
}

function fragmentedRing(target: ReturnType<typeof image>, cx: number, cy: number, radius = 18, thickness = 1, value = 20) {
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      if (Math.abs(distance - radius) > thickness / 2) continue;
      const angle = Math.atan2(dy, dx);
      const sector = Math.floor((angle + Math.PI) / 0.12);
      if (sector % 2 === 0) continue;
      const index = (y * target.width + x) * 4;
      target.data[index] = value;
      target.data[index + 1] = value;
      target.data[index + 2] = value;
    }
  }
}

function rectangle(target: ReturnType<typeof image>, x0: number, y0: number, x1: number, y1: number, value: number) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
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
  assert.equal(result.geometry_mode, "dark_component");
  assert.equal(result.seed_relation, "on_marker");
  assert.ok(result.center && Math.hypot(result.center.x - 48, result.center.y - 46) < 0.5);
  assert.ok(result.boundary.length >= 6);
  assert.ok(result.confidence > 0.8);
  assert.deepEqual(result.audit, { local_only: true, raw_media_retained: false, network_request_made: false });
  assert.equal("data" in result, false, "detector result must not retain raw pixels");
}

{
  const target = image();
  ring(target, 48, 46, 18, 4);
  const results = [
    detectControlledMarker(target, { x: 48, y: 46 }),
    detectControlledMarker(target, { x: 40, y: 42 }),
    detectControlledMarker(target, { x: 55, y: 51 }),
  ];
  for (const result of results) {
    assert.equal(result.ok, true, "any click inside a hollow marker selects the enclosing component");
    assert.equal(result.geometry_mode, "enclosed_region", "a hollow marker returns the region it encloses, not the pen stroke");
    assert.equal(result.seed_relation, "enclosed");
    assert.ok(result.center && Math.hypot(result.center.x - 48, result.center.y - 46) < 0.5);
    assert.ok((result.marker_bbox?.width || 0) >= 35 && (result.marker_bbox?.height || 0) >= 35,
      "hollow marker extraction keeps the complete pen outline instead of a nearby arc");
    assert.ok((result.bbox?.width || 0) < (result.marker_bbox?.width || 0),
      "lesion geometry follows the enclosed region instead of wrapping the black pen stroke");
  }
  assert.deepEqual(results.map((result) => result.bbox), [results[0].bbox, results[0].bbox, results[0].bbox],
    "seed position inside one closed marker does not change the detected extent");
  assert.deepEqual(results.map((result) => result.center), [results[0].center, results[0].center, results[0].center],
    "canonical centre refinement makes the planning centre independent from the initial click");
  assert.deepEqual(results.map((result) => result.boundary), [results[0].boundary, results[0].boundary, results[0].boundary],
    "canonical centre refinement makes the full planning boundary independent from the initial click");
}

{
  const target = image();
  ring(target, 48, 46, 18, 1);
  const result = detectControlledMarker(target, { x: 48, y: 46 });
  assert.equal(result.ok, true, "a thin black hand-drawn contour is not eroded before detection");
  assert.equal(result.geometry_mode, "enclosed_region");
  assert.ok(result.marker_bbox && result.marker_bbox.width >= 35 && result.marker_bbox.height >= 35,
    "thin contour detection keeps the complete enclosing extent");
}

{
  const target = image(128, 96, 170);
  rectangle(target, 0, 0, 48, 95, 60);
  ring(target, 72, 48, 18, 3, 115);
  const result = detectControlledMarker(target, { x: 72, y: 48 });
  assert.equal(result.ok, true,
    "dark hair or background inside the ROI does not suppress a lower-contrast marker on skin");
  assert.equal(result.geometry_mode, "enclosed_region");
  assert.ok(result.marker_bbox && result.marker_bbox.width >= 35 && result.marker_bbox.height >= 35);
}

{
  const target = image();
  irregularRing(target, 47, 49);
  const result = detectControlledMarker(target, { x: 47, y: 49 });
  assert.equal(result.ok, true, "a click inside an irregular hollow marker selects the enclosing component");
  assert.equal(result.geometry_mode, "enclosed_region");
  assert.ok((result.marker_bbox?.width || 0) >= 38 && (result.marker_bbox?.height || 0) >= 38,
    "irregular hollow marker extraction keeps the complete outline");
  assert.ok(result.boundary.length >= 8, "irregular hollow marker retains a usable enclosing boundary");
}

{
  const target = image(1024, 768, 190);
  ellipseRing(target, 560, 400, 120, 105, 3, 45);
  const results = [
    detectControlledMarker(target, { x: 560, y: 400 }),
    detectControlledMarker(target, { x: 515, y: 425 }),
    detectControlledMarker(target, { x: 600, y: 370 }),
  ];
  for (const result of results) {
    assert.equal(result.ok, true,
      "a large real-photo-scale contour remains detectable from multiple interior clicks");
    assert.equal(result.geometry_mode, "enclosed_region");
    assert.ok((result.marker_bbox?.width || 0) >= 235 && (result.marker_bbox?.height || 0) >= 205);
  }
  assert.deepEqual(results.map((result) => result.bbox), [results[0].bbox, results[0].bbox, results[0].bbox],
    "large contour extraction is seed-invariant instead of being clipped by a fixed small ROI");
}

{
  const target = image(1600, 1200, 185);
  ellipseRing(target, 800, 600, 210, 145, 4, 50);
  const results = [
    detectControlledMarker(target, { x: 800, y: 600 }),
    detectControlledMarker(target, { x: 720, y: 630 }),
    detectControlledMarker(target, { x: 875, y: 560 }),
  ];
  for (const result of results) {
    assert.equal(result.ok, true,
      "a screenshot-scale contour expands beyond the first two local search windows when needed");
    assert.equal(result.geometry_mode, "enclosed_region");
    assert.ok((result.marker_bbox?.width || 0) >= 415 && (result.marker_bbox?.height || 0) >= 285);
  }
  assert.deepEqual(results.map((result) => result.bbox), [results[0].bbox, results[0].bbox, results[0].bbox],
    "screenshot-scale extraction is stable for visibly off-centre interior clicks");
}

{
  const target = horizontalGradientImage(640, 480, 170, 230);
  relativeEllipseRing(target, 340, 250, 95, 70, 45, 3);
  disk(target, 370, 250, 5, 45);
  const legacy = detectControlledMarker(target, { x: 340, y: 250 }, { enableSeedFirstBarrier: false });
  assert.equal(legacy.ok, false,
    "the v0.8-style global-threshold path must fail this gradient fixture before v0.9 recovery is credited");
  const results = [
    detectControlledMarker(target, { x: 340, y: 250 }),
    detectControlledMarker(target, { x: 305, y: 265 }),
  ];
  for (const result of results) {
    assert.equal(result.ok, true,
      `a locally dark pen enclosure survives a face-like illumination gradient: ${JSON.stringify(result)}`);
    assert.equal(result.geometry_mode, "enclosed_region");
    assert.ok((result.bbox?.width || 0) >= 180 && (result.bbox?.height || 0) >= 130);
    assert.equal(result.diagnostics?.method, "seed_first_barrier");
    assert.ok((result.diagnostics?.boundary_support_ratio || 0) >= 0.55,
      "v0.9 success reports enough original dark-line support instead of an invented enclosure");
  }
  assert.deepEqual(results.map((result) => result.bbox), [results[0].bbox, results[0].bbox],
    "local-contrast enclosure remains stable for off-centre interior seeds");
}

{
  const target = horizontalGradientImage(640, 480, 170, 230);
  relativeEllipseRing(target, 340, 250, 95, 70, 45, 3, 0.9);
  const result = detectControlledMarker(target, { x: 340, y: 250 });
  assert.equal(result.ok, false,
    "v0.9 rejects a large open contour under the same illumination gradient instead of forcing closure");
}

{
  const target = horizontalGradientImage(640, 480, 170, 230);
  const result = detectControlledMarker(target, { x: 340, y: 250 });
  assert.equal(result.ok, false, "a smooth skin-like illumination gradient alone cannot form a barrier");
}

{
  const target = image();
  ringWithGap(target, 48, 48, 0.18);
  const results = [
    detectControlledMarker(target, { x: 48, y: 48 }),
    detectControlledMarker(target, { x: 43, y: 45 }),
  ];
  for (const result of results) {
    assert.equal(result.ok, true, "a small hand-drawn gap is closed within the bounded contour repair radius");
    assert.equal(result.geometry_mode, "enclosed_region");
    assert.ok(result.marker_bbox && result.marker_bbox.width >= 34 && result.marker_bbox.height >= 34,
      "small-gap repair returns the enclosing region rather than a stroke fragment");
  }
  assert.deepEqual(results.map((result) => result.bbox), [results[0].bbox, results[0].bbox],
    "small-gap contour remains seed-invariant");
}

{
  const target = image();
  ringWithGap(target, 48, 48, 0.32);
  const result = detectControlledMarker(target, { x: 48, y: 48 });
  assert.equal(result.ok, true, "a bounded five-to-six pixel pen gap is repaired");
}

{
  const target = image(160, 140);
  ringWithGap(target, 80, 70, 0.5, 4);
  const results = [
    detectControlledMarker(target, { x: 80, y: 70 }),
    detectControlledMarker(target, { x: 72, y: 66 }),
    detectControlledMarker(target, { x: 86, y: 75 }),
  ];
  for (const result of results) {
    assert.equal(result.ok, true,
      `one moderate gap with one clear continuation is repaired: ${JSON.stringify(result)}`);
    assert.equal(result.geometry_mode, "enclosed_region");
  }
  assert.deepEqual(results.map((result) => result.bbox), [results[0].bbox, results[0].bbox, results[0].bbox],
    "canonical centre refinement makes a repaired contour independent from the initial interior click");

  const nearStroke = detectControlledMarker(target, { x: 63, y: 70 });
  assert.equal(nearStroke.ok, true,
    `a click on the inner edge recovers the enclosed region instead of returning the pen stroke: ${JSON.stringify(nearStroke)}`);
  assert.equal(nearStroke.geometry_mode, "enclosed_region");
  assert.ok(nearStroke.center && Math.hypot(nearStroke.center.x - 80, nearStroke.center.y - 70) < 1,
    "near-stroke recovery keeps the lesion centre inside the simulated lesion");
}

{
  const target = image();
  fragmentedRing(target, 48, 48);
  const result = detectControlledMarker(target, { x: 48, y: 48 });
  assert.equal(result.ok, true,
    `fragmented short arcs around the click are bridged when their aggregate evidence is sufficient: ${JSON.stringify(result)}`);
  assert.equal(result.geometry_mode, "enclosed_region");
  assert.ok(result.marker_bbox && result.marker_bbox.width >= 34 && result.marker_bbox.height >= 34);
}

{
  const target = image();
  ringWithGap(target, 48, 48, 0.9);
  const result = detectControlledMarker(target, { x: 48, y: 48 });
  assert.equal(result.ok, false, "a large open contour is rejected instead of being invented closed");
  assert.equal(result.failure_code, "component_too_small");
}

{
  const target = image();
  disk(target, 34, 40, 6);
  disk(target, 68, 40, 5);
  const result = detectControlledMarker(target, { x: 34, y: 40 });
  assert.equal(result.ok, true, "unrelated dark components elsewhere in the ROI do not make the clicked marker ambiguous");
  assert.equal(result.candidate_count, 1, "only click-relevant candidates contribute to ambiguity diagnostics");
  assert.deepEqual(result.warnings, []);
}

{
  const target = image(160, 140);
  ring(target, 80, 70, 38, 3);
  disk(target, 86, 70, 5);
  const result = detectControlledMarker(target, { x: 80, y: 70 });
  assert.equal(result.ok, true,
    "one contour enclosing the click outranks an unrelated compact dark feature inside the outline");
  assert.equal(result.geometry_mode, "enclosed_region");
  assert.ok((result.bbox?.width || 0) >= 70,
    "the selected lesion region follows the enclosing outline rather than the internal dark feature");
}

{
  const target = image(400, 400);
  ring(target, 200, 200, 100, 3);
  disk(target, 200, 200, 5);
  const result = detectControlledMarker(target, { x: 200, y: 200 });
  assert.equal(result.ok, true,
    "a local compact feature is not accepted before larger ROIs can recover the enclosing marker");
  assert.equal(result.geometry_mode, "enclosed_region");
  assert.ok((result.bbox?.width || 0) >= 190,
    "adaptive ROI reconciliation returns the complete outer marked region");
}

{
  const target = image(1024, 768, 190);
  ellipseRing(target, 512, 384, 120, 100, 3, 45);
  disk(target, 523, 384, 5, 35);
  const result = detectControlledMarker(target, { x: 512, y: 384 });
  assert.equal(result.ok, true,
    "a nearby mole or shadow must not make a small-ROI seed miss abort the larger enclosing-contour search");
  assert.equal(result.geometry_mode, "enclosed_region");
  assert.ok((result.marker_bbox?.width || 0) >= 235 && (result.marker_bbox?.height || 0) >= 195,
    "multi-scale retry returns the enclosing pen outline instead of the nearby compact feature");
}

{
  const target = image(400, 400);
  ring(target, 200, 200, 40, 4);
  rectangle(target, 140, 144, 165, 256, 20);
  const results = [
    detectControlledMarker(target, { x: 200, y: 200 }),
    detectControlledMarker(target, { x: 184, y: 188 }),
    detectControlledMarker(target, { x: 216, y: 212 }),
  ];
  for (const result of results) {
    assert.equal(result.ok, true,
      "a marker joined to a local shadow remains selectable from different points inside the marked region");
    assert.equal(result.geometry_mode, "enclosed_region");
    assert.ok((result.bbox?.width || 0) >= 70,
      "the enclosed lesion region is kept without treating the entire attached shadow as marker area");
  }
  assert.deepEqual(results.map((result) => result.bbox), [results[0].bbox, results[0].bbox, results[0].bbox],
    "an attached dark region does not make the detected lesion extent depend on the click position");
}

{
  const target = image(400, 400);
  ring(target, 200, 200, 40, 4);
  rectangle(target, 0, 0, 162, 399, 20);
  const results = [
    detectControlledMarker(target, { x: 200, y: 200 }),
    detectControlledMarker(target, { x: 184, y: 188 }),
    detectControlledMarker(target, { x: 216, y: 212 }),
  ];
  for (const result of results) {
    assert.equal(result.ok, true,
      `a pen outline touching a long facial shadow keeps its enclosed region: ${JSON.stringify(result)}`);
    assert.equal(result.geometry_mode, "enclosed_region");
  }
  assert.deepEqual(results.map((result) => result.bbox), [results[0].bbox, results[0].bbox, results[0].bbox],
    "the long attached shadow is excluded from marker-size validation for every interior click");
}

{
  const target = image();
  ring(target, 48, 48, 10, 2);
  ring(target, 48, 48, 18, 2);
  const result = detectControlledMarker(target, { x: 48, y: 48 });
  assert.equal(result.ok, false, "two closed marker contours enclosing the same click are rejected as ambiguous");
  assert.equal(result.failure_code, "ambiguous_candidates");
  assert.equal(result.candidate_count, 2);
}

{
  const target = image();
  ring(target, 48, 48, 18, 3);
  const result = detectControlledMarker(target, { x: 20, y: 48 });
  assert.equal(result.ok, false,
    "a closed feature near the click is not accepted when it neither encloses nor directly touches the seed");
  assert.equal(result.failure_code, "seed_not_enclosed");
}

{
  const target = image(96, 96, 180);
  ring(target, 48, 48, 18, 3, 158);
  const result = detectControlledMarker(target, { x: 48, y: 48 });
  assert.equal(result.ok, false,
    "a low-contrast natural shadow cannot produce the former 22-percent false success");
  assert.ok(["no_dark_component", "low_contrast"].includes(result.failure_code || ""));
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

const runtimeSource = fs.readFileSync("src/services/incisionPhotoRuntime.ts", "utf8");
const domBindingsSource = fs.readFileSync("src/services/incisionDomBindings.ts", "utf8");
const workerSource = fs.readFileSync("src/workers/workflow.worker.ts", "utf8");
const stylesSource = fs.readFileSync("src/styles.css", "utf8");
const clinicalCopySource = fs.readFileSync("src/services/incisionClinicalCopy.ts", "utf8");
assert.ok(runtimeSource.includes('publishState("controlled_marker_cancelled")'), "marker action supports explicit cancellation");
assert.ok(runtimeSource.includes("resetControlledMarker({ restoreSelection: true })"), "cancel and exit restore the confirmed selection");
assert.ok(runtimeSource.includes("candidateDisplayBlocked ? [] : endpointRefs"),
  "blocked candidates hide stale candidate handles");
assert.ok(runtimeSource.includes("keepControlledMarkerRetry"),
  "failed marker clicks retain marker mode so the user can retry directly");
assert.ok(runtimeSource.includes("projectedCandidate !== state.result?.candidate"),
  "endpoint visibility is bound to the candidate whose photo projection was validated");
assert.ok(runtimeSource.includes('publishState("controlled_marker_applied")'),
  "a successful marker click immediately applies the detected lesion and candidate");
assert.ok(runtimeSource.includes("Comlink.transfer")
  && workerSource.includes("detectControlledMarker(image, seed)"),
"controlled-marker pixel analysis runs in the existing local workflow worker instead of blocking pointer release");
assert.ok(runtimeSource.includes("candidateVisible")
  && runtimeSource.includes('publishState("controlled_marker_candidate_hidden")'),
"success feedback requires an actually visible projected candidate");
assert.ok(runtimeSource.includes("controlled marker planning audit")
  && runtimeSource.includes("geometry.candidateProjection.reasonCodes")
  && runtimeSource.includes("raw_media_retained: false"),
"controlled-marker planning records privacy-safe geometry, direction, candidate, and projection diagnostics");
assert.ok(runtimeSource.includes("controlled marker stroke-only result rejected")
  && runtimeSource.includes("当前点击处只识别到黑色笔画"),
"cutaneous controlled-marker mode cannot report a local pen stroke as a lesion boundary");
assert.ok(stylesSource.includes('#incisionPhotoCanvas[data-controlled-marker="true"]')
  && stylesSource.includes('#incisionPhotoCanvas[aria-busy="true"]'),
"controlled-marker and processing cursors override the photo drag hand cursor");
assert.ok(runtimeSource.includes("state.controlledBoundaryActive = kind === \"cutaneous\""),
  "controlled cutaneous boundaries are independent from the manual boundary-mode dropdown");
assert.ok(domBindingsSource.includes('getAttribute("aria-pressed") === "true"')
  && domBindingsSource.includes("photoDrag.pickOnly")
  && runtimeSource.includes("controlledMarkerSeedMode) return null")
  && runtimeSource.includes("!state.photoView.active || controlledMarkerSeedMode"),
"controlled-marker picking suppresses photo panning and endpoint hit-testing while the toggle is active");
assert.ok(runtimeSource.includes("黄色线表示识别范围")
  && runtimeSource.includes("切口大小已根据识别结果自动调整"),
"successful controlled-marker feedback explains the visible result in doctor-readable language");
assert.ok(clinicalCopySource.includes("当前点击区域未识别到肿物")
  && clinicalCopySource.includes("模拟肿物曲线可能较浅或留有较大开口")
  && !runtimeSource.includes("ROI ${"),
"failure feedback keeps engineering diagnostics out of the clinician-facing status area");
assert.doesNotMatch(runtimeSource, /confirmControlledMarkerDetection|controlledMarkerDraft/,
  "controlled marker no longer requires a second confirmation action");

const incisionRuntimeSource = fs.readFileSync("src/services/incisionRuntime.ts", "utf8");
const tumorInputSource = fs.readFileSync("src/services/tumorInput.ts", "utf8");
assert.ok(tumorInputSource.includes('boundary_mode: "controlled_marker"')
  && tumorInputSource.includes('boundary_source: "controlled_marker_confirmed"')
  && incisionRuntimeSource.includes("withControlledMarkerProvenance"),
"the workflow input preserves controlled-marker provenance instead of rebuilding it as manual freehand");
assert.ok(incisionRuntimeSource.includes("applyNormalizedLesionCenterState(S, result)"),
  "the displayed lesion center is synchronized to the normalized center used by candidate planning");

console.log("test_controlled_marker_detection: seed-invariant contour detection and persistent toggle contracts passed");
