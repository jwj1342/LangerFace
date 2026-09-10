import assert from "node:assert/strict";
import fs from "node:fs";

import {
  __controlledMarkerForTests as controlledMarkerInternals,
  detectControlledMarker,
  translateControlledMarkerDetection,
} from "../web/src/services/controlledMarkerDetection.ts";
import { controlledMarkerFailureMessage } from "../web/src/services/incisionClinicalCopy.ts";
import { workflowControlledMarkerCrop } from "../web/src/services/workflowControllerUtils.ts";

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

{
  const translated = translateControlledMarkerDetection({
    ok: true,
    failure_code: null,
    center: { x: 12, y: 14 },
    boundary: [{ x: 8, y: 9 }, { x: 16, y: 9 }, { x: 16, y: 17 }],
    area_px: 32,
    bbox: { x: 8, y: 9, width: 9, height: 9 },
    geometry_mode: "enclosed_region",
    seed_relation: "enclosed",
    marker_area_px: 40,
    marker_bbox: { x: 7, y: 8, width: 11, height: 11 },
    confidence: 0.9,
    candidate_count: 1,
    warnings: [],
    audit: { local_only: true, raw_media_retained: false, network_request_made: false },
  }, { x: 100, y: 50 });
  assert.deepEqual(translated.center, { x: 112, y: 64 });
  assert.deepEqual(translated.boundary[0], { x: 108, y: 59 });
  assert.deepEqual(translated.bbox, { x: 108, y: 59, width: 9, height: 9 });
  assert.deepEqual(translated.marker_bbox, { x: 107, y: 58, width: 11, height: 11 });
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

function texturedGradientImage(width: number, height: number, left: number, right: number) {
  const target = horizontalGradientImage(width, height, left, right);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const texture = Math.round(1.7 * Math.sin(x * 0.43 + y * 0.17)
        + 1.2 * Math.cos(x * 0.11 - y * 0.37));
      for (let channel = 0; channel < 3; channel += 1) {
        target.data[index + channel] = Math.max(0, Math.min(255, target.data[index + channel] + texture));
      }
    }
  }
  return target;
}

function broadAnnularShadow(
  target: ReturnType<typeof image>,
  cx: number,
  cy: number,
  radius: number,
  halfWidth: number,
  depth: number,
) {
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const distance = Math.abs(Math.hypot(x - cx, y - cy) - radius);
      if (distance > halfWidth) continue;
      const attenuation = depth * (1 - distance / halfWidth);
      const index = (y * target.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        target.data[index + channel] = Math.max(0, Math.round(target.data[index + channel] - attenuation));
      }
    }
  }
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

{
  const target = image(160, 140);
  ring(target, 80, 70, 22, 3, 20);
  const options = { roiRadius: 40, expectedDiameterPx: 44, scanDiameterMm: 30 };
  const full = detectControlledMarker(target, { x: 80, y: 70 }, options);
  const crop = workflowControlledMarkerCrop({
    frameWidth: target.width,
    frameHeight: target.height,
    seed: { x: 80, y: 70 },
    roiRadius: options.roiRadius,
  });
  const cropped = image(crop.width, crop.height, 0);
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const sourceIndex = ((crop.y + y) * target.width + crop.x + x) * 4;
      const targetIndex = (y * crop.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        cropped.data[targetIndex + channel] = target.data[sourceIndex + channel];
      }
    }
  }
  const translated = translateControlledMarkerDetection(
    detectControlledMarker(cropped, crop.seed, options),
    { x: crop.x, y: crop.y },
  );
  assert.equal(translated.ok, full.ok, "ROI cropping preserves controlled-marker success state");
  assert.ok(full.center && translated.center
    && Math.hypot(full.center.x - translated.center.x, full.center.y - translated.center.y) < 0.01,
  "ROI cropping preserves the detected source-space centre");
  assert.ok(full.bbox && translated.bbox
    && ["x", "y", "width", "height"].every((key) => Math.abs(
      translated.bbox?.[key as keyof typeof translated.bbox] as number
      - (full.bbox?.[key as keyof typeof full.bbox] as number),
    ) < 1e-6),
  "ROI cropping preserves the detected source-space bounds");
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

function rotatedEllipseRing(
  target: ReturnType<typeof image>,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
  thickness = 2,
  value = 35,
) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const localX = (dx * cosine + dy * sine) / radiusX;
      const localY = (-dx * sine + dy * cosine) / radiusY;
      if (Math.abs(Math.hypot(localX, localY) - 1) > thickness / Math.min(radiusX, radiusY)) continue;
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

function angularSampledIrregularRing(target: ReturnType<typeof image>, cx: number, cy: number, value = 20) {
  for (let index = 0; index < 96; index += 1) {
    if (index % 19 === 0) continue;
    const angle = index * Math.PI * 2 / 96;
    const radius = 32 + 4 * Math.sin(angle * 3) + 2 * Math.cos(angle * 5);
    disk(target, Math.round(cx + Math.cos(angle) * radius), Math.round(cy + Math.sin(angle) * radius), 0.55, value);
  }
}

function faintIrregularRingWithGap(target: ReturnType<typeof image>, cx: number, cy: number) {
  const background = Number(target.data[0]);
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const angle = Math.atan2(dy, dx);
      const radius = 32 + 4 * Math.sin(angle * 3) + 2 * Math.cos(angle * 5);
      if (Math.abs(Math.hypot(dx, dy) - radius) > 2) continue;
      if (Math.abs(angle) < 0.09) continue;
      const value = angle > -2.4 && angle < -0.35 ? background - 20 : 24;
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

function strokeLine(
  target: ReturnType<typeof image>,
  first: [number, number],
  second: [number, number],
  thickness = 3,
  value = 20,
) {
  const steps = Math.max(Math.abs(second[0] - first[0]), Math.abs(second[1] - first[1]));
  for (let step = 0; step <= steps; step += 1) {
    disk(
      target,
      Math.round(first[0] + (second[0] - first[0]) * step / Math.max(1, steps)),
      Math.round(first[1] + (second[1] - first[1]) * step / Math.max(1, steps)),
      thickness / 2,
      value,
    );
  }
}

function openTriangle(target: ReturnType<typeof image>) {
  strokeLine(target, [18, 92], [60, 18], 4);
  strokeLine(target, [18, 92], [102, 92], 4);
  strokeLine(target, [60, 18], [88, 68], 4);
}

function fragmentedOpenTriangle(target: ReturnType<typeof image>) {
  strokeLine(target, [76, 32], [38, 116], 3);
  strokeLine(target, [86, 35], [122, 116], 3);
  strokeLine(target, [45, 125], [116, 125], 3);
  strokeLine(target, [89, 42], [93, 39], 2);
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
  const target = texturedGradientImage(220, 190, 145, 218);
  // The operator's outer loop is complete and wholly inside the scan. A
  // connected retrace across its interior must not make one internal pocket
  // look like the complete lesion boundary.
  ellipseRing(target, 122, 98, 43, 36, 4, 28);
  strokeLine(target, [91, 74], [151, 124], 4, 28);
  rectangle(target, 0, 0, 42, 189, 28);
  const options = { roiRadius: 72, expectedDiameterPx: 58, scanDiameterMm: 20 };
  const results = [
    detectControlledMarker(target, { x: 122, y: 98 }, options),
    detectControlledMarker(target, { x: 114, y: 105 }, options),
  ];
  for (const result of results) {
    assert.equal(result.ok, true,
      `a complete scan-contained outer loop wins over its connected interior retrace: ${JSON.stringify(result)}`);
    assert.equal(result.geometry_mode, "enclosed_region");
    assert.ok((result.bbox?.width || 0) >= 80 && (result.bbox?.height || 0) >= 66,
      `the recovered lesion follows the complete outer loop instead of one divided pocket: ${JSON.stringify(result)}`);
  }
}

{
  const target = texturedGradientImage(220, 190, 145, 218);
  // Face-edge regression: an internal retrace divides the real closed lesion,
  // while an attached wrinkle/shadow continues outside it. Recover both inner
  // pockets without promoting the open external attachment into the lesion.
  ellipseRing(target, 122, 98, 43, 36, 4, 28);
  strokeLine(target, [91, 74], [151, 124], 4, 28);
  strokeLine(target, [164, 102], [185, 119], 4, 28);
  rectangle(target, 0, 0, 42, 189, 28);
  const result = detectControlledMarker(
    target,
    { x: 122, y: 98 },
    { roiRadius: 76, expectedDiameterPx: 58, scanDiameterMm: 20 },
  );
  assert.equal(result.ok, true,
    `a complete divided lesion remains detectable beside a connected face-edge attachment: ${JSON.stringify(result)}`);
  assert.ok(Math.max(...result.boundary.map((point) => point.x)) <= 168,
    `the open attachment is excluded from the recovered lesion boundary: ${JSON.stringify(result)}`);
  assert.ok((result.bbox?.width || 0) <= 92,
    `face-edge attachment cannot inflate the lesion extent: ${JSON.stringify(result)}`);
}

{
  const cx = 122;
  const cy = 98;
  const lesionPoints: Array<{ x: number; y: number }> = [];
  const leftPixels: Array<{ x: number; y: number }> = [];
  const rightPixels: Array<{ x: number; y: number }> = [];
  const remotePocketPixels: Array<{ x: number; y: number }> = [];
  for (let y = 62; y <= 134; y += 1) {
    for (let x = 79; x <= 165; x += 1) {
      if (((x - cx) / 42) ** 2 + ((y - cy) / 35) ** 2 > 0.92) continue;
      lesionPoints.push({ x, y });
      if (x <= cx - 2) leftPixels.push({ x, y });
      if (x >= cx + 2) rightPixels.push({ x, y });
    }
  }
  for (let y = 89; y <= 107; y += 1) {
    for (let x = 173; x <= 184; x += 1) remotePocketPixels.push({ x, y });
  }
  const region = (pixels: Array<{ x: number; y: number }>, containsSeed: boolean) => {
    const xs = pixels.map((point) => point.x);
    const ys = pixels.map((point) => point.y);
    return {
      pixels,
      boundary: controlledMarkerInternals.componentOuterBoundary(pixels),
      bbox: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
      },
      containsSeed,
      distance: containsSeed
        ? 0
        : Math.hypot(
          cx < Math.min(...xs) ? Math.min(...xs) - cx : cx > Math.max(...xs) ? cx - Math.max(...xs) : 0,
          cy < Math.min(...ys) ? Math.min(...ys) - cy : cy > Math.max(...ys) ? cy - Math.max(...ys) : 0,
        ),
    };
  };
  const candidateBoundary = Array.from({ length: 48 }, (_value, index) => {
    const angle = index * Math.PI * 2 / 48;
    const radiusX = index === 0 ? 64 : 43;
    return {
      x: cx + Math.cos(angle) * radiusX,
      y: cy + Math.sin(angle) * 36,
    };
  });
  const recovered = controlledMarkerInternals.recoverDividedMarkerEnvelope(
    {
      component: { pixels: lesionPoints, meanLuma: 28 },
      boundary: candidateBoundary,
      bbox: { x: 79, y: 62, width: 108, height: 73 },
      containsSeed: true,
      distance: 0,
      enclosed: true,
      compact: true,
    },
    [region(leftPixels, true), region(rightPixels, false), region(remotePocketPixels, false)],
    { x: cx, y: cy },
    76,
    9,
  );
  assert.ok(recovered, "two substantial inner pockets reconstruct one complete lesion envelope");
  assert.ok(Math.max(...recovered.boundary.map((point) => point.x)) <= 166,
    `an exterior connected spur is excluded from the merged inner envelope: ${JSON.stringify(recovered)}`);
  assert.ok(recovered.bbox.width <= 88,
    `the merged bbox follows the enclosed lesion rather than the attached face-edge spur: ${JSON.stringify(recovered)}`);
}

{
  const seed = { x: 122, y: 96 };
  const lesionBoundary = [
    { x: 82, y: 72 }, { x: 102, y: 64 }, { x: 142, y: 64 },
    { x: 162, y: 72 }, { x: 166, y: 116 }, { x: 144, y: 136 },
    { x: 122, y: 116 }, { x: 100, y: 136 }, { x: 78, y: 116 },
  ];
  const inside = (point: { x: number; y: number }) => {
    let value = false;
    for (let current = 0, previous = lesionBoundary.length - 1;
      current < lesionBoundary.length; previous = current++) {
      const a = lesionBoundary[current];
      const b = lesionBoundary[previous];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) value = !value;
    }
    return value;
  };
  const leftPixels: Array<{ x: number; y: number }> = [];
  const rightPixels: Array<{ x: number; y: number }> = [];
  for (let y = 64; y <= 136; y += 1) {
    for (let x = 78; x <= 166; x += 1) {
      if (!inside({ x, y })) continue;
      if (x <= 120) leftPixels.push({ x, y });
      if (x >= 124) rightPixels.push({ x, y });
    }
  }
  const region = (pixels: Array<{ x: number; y: number }>, containsSeed: boolean) => {
    const xs = pixels.map((point) => point.x);
    const ys = pixels.map((point) => point.y);
    return {
      pixels,
      boundary: controlledMarkerInternals.componentOuterBoundary(pixels),
      bbox: {
        x: Math.min(...xs), y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
      },
      containsSeed,
      distance: containsSeed ? 0 : 3,
    };
  };
  const recovered = controlledMarkerInternals.recoverDividedMarkerEnvelope(
    {
      component: { pixels: [...leftPixels, ...rightPixels], meanLuma: 28 },
      boundary: lesionBoundary,
      bbox: { x: 78, y: 64, width: 89, height: 73 },
      containsSeed: true,
      distance: 0,
      enclosed: true,
      compact: true,
    },
    [region(leftPixels, true), region(rightPixels, false)],
    seed,
    76,
    9,
  );
  assert.ok(recovered, "two divided pockets recover one complete concave lesion");
  const notch = { x: 122, y: 116 };
  const notchDistance = recovered.boundary.reduce((closest, start, index) => {
    const end = recovered.boundary[(index + 1) % recovered.boundary.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((notch.x - start.x) * dx + (notch.y - start.y) * dy) / lengthSquared))
      : 0;
    return Math.min(closest, Math.hypot(
      notch.x - (start.x + dx * t),
      notch.y - (start.y + dy * t),
    ));
  }, Number.POSITIVE_INFINITY);
  assert.ok(notchDistance <= 5,
    `divided recovery preserves the drawn inward contour instead of convexly adding tissue: ${JSON.stringify(recovered)}`);
}

function relativeStrokeLine(
  target: ReturnType<typeof image>,
  first: [number, number],
  second: [number, number],
  contrast: number,
  thickness = 3,
) {
  const steps = Math.max(Math.abs(second[0] - first[0]), Math.abs(second[1] - first[1]));
  for (let step = 0; step <= steps; step += 1) {
    const cx = Math.round(first[0] + (second[0] - first[0]) * step / Math.max(1, steps));
    const cy = Math.round(first[1] + (second[1] - first[1]) * step / Math.max(1, steps));
    for (let y = Math.max(0, Math.floor(cy - thickness)); y <= Math.min(target.height - 1, Math.ceil(cy + thickness)); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - thickness)); x <= Math.min(target.width - 1, Math.ceil(cx + thickness)); x += 1) {
        if (Math.hypot(x - cx, y - cy) > thickness / 2) continue;
        const index = (y * target.width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          target.data[index + channel] = Math.max(0, target.data[index + channel] - contrast);
        }
      }
    }
  }
}

{
  const target = texturedGradientImage(220, 190, 165, 218);
  // Attachment-shaped regression: the complete low-contrast outer loop is
  // wholly inside the controlled scan, while one faint internal stroke divides
  // its interior. The detector must keep the outer lesion envelope.
  relativeEllipseRing(target, 122, 98, 43, 36, 12, 4);
  relativeStrokeLine(target, [93, 75], [150, 122], 12, 4);
  rectangle(target, 0, 0, 42, 189, 55);
  const options = { roiRadius: 72, expectedDiameterPx: 58, scanDiameterMm: 20 };
  const results = [
    detectControlledMarker(target, { x: 122, y: 98 }, options),
    detectControlledMarker(target, { x: 114, y: 105 }, options),
  ];
  for (const result of results) {
    assert.equal(result.ok, true,
      `a scan-contained low-contrast outer loop wins over its internal dark stroke: ${JSON.stringify(result)}`);
    assert.equal(result.geometry_mode, "enclosed_region");
    assert.ok((result.bbox?.width || 0) >= 80 && (result.bbox?.height || 0) >= 66,
      `low contrast does not collapse the complete lesion to one internal pocket: ${JSON.stringify(result)}`);
  }
}

{
  const target = image(120, 120);
  ringWithGap(target, 60, 60, 1.1, 4);
  strokeLine(target, [51, 45], [51, 75], 4);
  strokeLine(target, [61, 42], [61, 78], 4);
  const result = detectControlledMarker(
    target,
    { x: 56, y: 60 },
    { roiRadius: 45, expectedDiameterPx: 36, scanDiameterMm: 20 },
  );
  assert.equal(result.ok, false,
    "two local pockets inside a visibly open outer loop cannot be promoted to a complete lesion envelope");
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
  assert.deepEqual(results.map((result) => result.bbox), results.map(() => results[0].bbox),
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
  const target = image(160, 160);
  fragmentedOpenTriangle(target);
  const results = [
    detectControlledMarker(
      target,
      { x: 80, y: 88 },
      { roiRadius: 70, expectedDiameterPx: 100, scanDiameterMm: 50 },
    ),
    detectControlledMarker(
      target,
      { x: 72, y: 92 },
      { roiRadius: 70, expectedDiameterPx: 100, scanDiameterMm: 50 },
    ),
    detectControlledMarker(
      target,
      { x: 88, y: 92 },
      { roiRadius: 70, expectedDiameterPx: 100, scanDiameterMm: 50 },
    ),
  ];
  for (const result of results) {
    assert.equal(result.ok, true,
      `two bounded gaps across three observed stroke fragments are joined by endpoint evidence: ${JSON.stringify(result)}`);
    assert.equal(result.geometry_mode, "enclosed_region");
    assert.ok(result.warnings.includes("multi_fragment_endpoint_repaired"));
    assert.ok((result.diagnostics?.boundary_support_ratio || 0) >= 0.72,
      "multi-fragment closure remains mostly supported by observed stroke pixels");
  }
  assert.deepEqual(results.map((result) => result.bbox), results.map(() => results[0].bbox),
    "bounded multi-fragment closure is independent from the initial interior click");
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
  const target = image(120, 120);
  openTriangle(target);
  ring(target, 48, 58, 4, 2);
  ring(target, 70, 58, 4, 2);
  const options = { roiRadius: 52, expectedDiameterPx: 58, scanDiameterMm: 30 };
  const first = detectControlledMarker(target, { x: 48, y: 58 }, options);
  const second = detectControlledMarker(target, { x: 70, y: 58 }, options);
  for (const result of [first, second]) {
    assert.ok(!result.ok || (result.bbox && Math.max(result.bbox.width, result.bbox.height) >= 58 * 0.35),
      "an open outer triangle can be recovered, but a click-local enclosed artifact cannot be promoted as the lesion");
    if (result.ok) assert.equal(result.geometry_mode, "enclosed_region");
    else assert.equal(result.failure_code, "unstable_enclosure");
    assert.equal(result.scan?.diameter_mm, 30);
  }
}

{
  const target = image(120, 120);
  ring(target, 60, 60, 24, 3);
  const result = detectControlledMarker(
    target,
    { x: 60, y: 60 },
    { roiRadius: 26, expectedDiameterPx: 48, scanDiameterMm: 20 },
  );
  assert.equal(result.ok, false, "a contour reaching the circular scan edge asks for a larger scan area");
  assert.equal(result.failure_code, "scan_range_too_small");
}

{
  const target = image(120, 120);
  ring(target, 70, 60, 12, 3);
  const result = detectControlledMarker(
    target,
    { x: 45, y: 60 },
    { roiRadius: 50, expectedDiameterPx: 24, scanDiameterMm: 35 },
  );
  assert.equal(result.ok, true,
    `a complete closed contour inside the circular scan surface is found even when the click is outside it: ${JSON.stringify(result)}`);
  assert.equal(result.geometry_mode, "enclosed_region");
  assert.ok(result.center && Math.abs(result.center.x - 70) < 2,
    "scan-surface selection recenters on the enclosed contour instead of the pointer seed");
}

{
  const target = image(120, 120);
  ringWithGap(target, 60, 60, 0.9);
  const result = detectControlledMarker(
    target,
    { x: 60, y: 60 },
    { roiRadius: 40, expectedDiameterPx: 36, scanDiameterMm: 30 },
  );
  assert.equal(result.ok, false, "an internal large gap remains rejected after the scan covers the complete stroke");
  assert.equal(result.failure_code, "edge_discontinuous");
}

{
  const target = image(120, 120);
  ring(target, 60, 60, 18, 3);
  const result = detectControlledMarker(
    target,
    { x: 60, y: 60 },
    { roiRadius: 30, expectedDiameterPx: 36, scanDiameterMm: 25 },
  );
  assert.equal(result.ok, true, "a complete contour comfortably inside the circular scan remains accepted");
  assert.equal(result.geometry_mode, "enclosed_region");
}

{
  const target = image(120, 120);
  ring(target, 60, 60, 11, 3);
  const result = detectControlledMarker(
    target,
    { x: 60, y: 60 },
    { roiRadius: 40, expectedDiameterPx: 36, scanDiameterMm: 30 },
  );
  assert.equal(result.ok, true,
    "a complete observed enclosure is not rejected by the disabled operator-diameter value");
  assert.equal(result.geometry_mode, "enclosed_region");
}

{
  const target = image(120, 120);
  ring(target, 60, 60, 6, 2);
  const result = detectControlledMarker(
    target,
    { x: 60, y: 60 },
    { roiRadius: 40, expectedDiameterPx: 32, scanDiameterMm: 20 },
  );
  assert.equal(result.ok, true,
    "a complete small marker remains valid when the disabled operator diameter is larger than the observed boundary");
  assert.equal(result.geometry_mode, "enclosed_region");
}

{
  const target = image(120, 120);
  ring(target, 60, 60, 18, 3);
  const result = detectControlledMarker(
    target,
    { x: 60, y: 60 },
    { roiRadius: 40, expectedDiameterPx: 36, scanDiameterMm: 30 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics?.boundary_stroke_reconciliation, "radial_ridge",
    "a supported near-circular dark ridge upgrades an inner enclosure to the marker stroke extent");
  const xs = result.boundary.map((point) => point.x);
  const ys = result.boundary.map((point) => point.y);
  assert.ok(result.marker_bbox
    && Math.min(...xs) <= result.marker_bbox.x + 0.25
    && Math.max(...xs) >= result.marker_bbox.x + result.marker_bbox.width - 1.25
    && Math.min(...ys) <= result.marker_bbox.y + 0.25
    && Math.max(...ys) >= result.marker_bbox.y + result.marker_bbox.height - 1.25,
  "the displayed lesion range reaches the outermost supported marker pixels instead of stopping at the inner skin region");
  assert.equal(controlledMarkerInternals.boundarySelfIntersects(result.boundary), false);
}

{
  const target = image(120, 120);
  const innerBoundary = Array.from({ length: 48 }, (_value, index) => {
    const angle = index * Math.PI * 2 / 48;
    return { x: 60 + Math.cos(angle) * 20, y: 60 + Math.sin(angle) * 17 };
  });
  const result = controlledMarkerInternals.reconcileMarkerStrokeCoverage(
    target,
    { x: 60, y: 60 },
    { roiRadius: 40, expectedDiameterPx: 44, scanDiameterMm: 30 },
    40,
    {
      ok: true,
      failure_code: null,
      center: { x: 60, y: 60 },
      boundary: innerBoundary,
      area_px: 1068,
      bbox: { x: 40, y: 43, width: 41, height: 35 },
      geometry_mode: "enclosed_region",
      seed_relation: "enclosed",
      marker_area_px: 140,
      marker_bbox: { x: 38, y: 41, width: 45, height: 39 },
      confidence: 0.9,
      candidate_count: 1,
      warnings: [],
      audit: { local_only: true, raw_media_retained: false, network_request_made: false },
    },
  );
  assert.equal(result.diagnostics?.boundary_stroke_reconciliation, "bounded_marker_bbox",
    "when a ridge witness is unavailable, only a small scale-bounded marker extent correction is permitted");
  assert.equal(result.diagnostics?.boundary_smoothing, "periodic_constrained",
    "stroke reconciliation cannot bypass the bounded final smoothing stage");
  const extentX = result.boundary.map((point) => point.x);
  const extentY = result.boundary.map((point) => point.y);
  assert.ok(Math.min(...extentX) <= 38.25 && Math.max(...extentX) >= 81.75
    && Math.min(...extentY) <= 41.25 && Math.max(...extentY) >= 78.75,
  "bounded extent correction covers the measured marker sides");
  assert.ok((result.diagnostics?.boundary_stroke_scale_x ?? 2) <= 1.18
    && (result.diagnostics?.boundary_stroke_scale_y ?? 2) <= 1.18,
  "marker extent fallback cannot grow either axis beyond the compatibility cap");
  assert.equal(result.diagnostics?.boundary_stroke_padding_px, 0,
    "a blank image cannot invent outer-stroke evidence or a fixed expansion margin");
  assert.deepEqual(result.center, { x: 60, y: 60 },
    "display-boundary reconciliation does not move the accepted lesion centre");

  const oversizedMarker = controlledMarkerInternals.reconcileMarkerStrokeCoverage(
    target,
    { x: 60, y: 60 },
    { roiRadius: 55, expectedDiameterPx: 44, scanDiameterMm: 40 },
    55,
    {
      ok: true,
      failure_code: null,
      center: { x: 60, y: 60 },
      boundary: innerBoundary.map((point) => ({ ...point })),
      area_px: 1068,
      bbox: { x: 40, y: 43, width: 41, height: 35 },
      geometry_mode: "enclosed_region",
      seed_relation: "enclosed",
      marker_area_px: 400,
      marker_bbox: { x: 15, y: 15, width: 91, height: 91 },
      confidence: 0.9,
      candidate_count: 1,
      warnings: [],
      audit: { local_only: true, raw_media_retained: false, network_request_made: false },
    },
  );
  assert.equal(oversizedMarker.diagnostics?.boundary_stroke_reconciliation, undefined,
    "an oversized attached shadow or texture component cannot drive lesion-boundary expansion");
  assert.deepEqual(oversizedMarker.boundary, innerBoundary,
    "rejecting an untrustworthy marker extent preserves the previously accepted boundary exactly");
}

{
  const target = image(140, 140, 205);
  const rotation = 25 * Math.PI / 180;
  rotatedEllipseRing(target, 60, 60, 22, 18, rotation, 1, 35);
  // A connected facial wrinkle may extend away from a short section of the
  // marker. It must not become the lesion's outer extent.
  for (let x = 81; x <= 91; x += 1) {
    for (let y = 62; y <= 64; y += 1) {
      const index = (y * target.width + x) * 4;
      target.data[index] = 55;
      target.data[index + 1] = 55;
      target.data[index + 2] = 55;
    }
  }
  const innerBoundary = Array.from({ length: 48 }, (_value, index) => {
    const angle = index * Math.PI * 2 / 48;
    const localX = Math.cos(angle) * 20.7;
    const localY = Math.sin(angle) * 17;
    return {
      x: 60 + localX * Math.cos(rotation) - localY * Math.sin(rotation),
      y: 60 + localX * Math.sin(rotation) + localY * Math.cos(rotation),
    };
  });
  const result = controlledMarkerInternals.reconcileMarkerStrokeCoverage(
    target,
    { x: 60, y: 60 },
    { roiRadius: 45, expectedDiameterPx: 44, scanDiameterMm: 30 },
    45,
    {
      ok: true,
      failure_code: null,
      center: { x: 60, y: 60 },
      boundary: innerBoundary,
      area_px: 985,
      bbox: { x: 41, y: 43, width: 39, height: 35 },
      geometry_mode: "enclosed_region",
      seed_relation: "enclosed",
      marker_area_px: 150,
      marker_bbox: { x: 40, y: 42, width: 41, height: 37 },
      confidence: 0.9,
      candidate_count: 1,
      warnings: [],
      audit: { local_only: true, raw_media_retained: false, network_request_made: false },
    },
  );
  assert.equal(result.diagnostics?.boundary_stroke_reconciliation, "normal_stroke_band",
    "a tilted near-circular marker uses its local curve normals instead of centroid rays");
  assert.ok((result.diagnostics?.boundary_stroke_support_ratio ?? 0) >= 0.48
    && (result.diagnostics?.boundary_stroke_coverage_ratio ?? 0) >= 0.78,
  "the fitted outer boundary is backed by continuous stroke support");
  assert.ok((result.diagnostics?.boundary_stroke_reverse_p90_px ?? 99) <= 1.1,
    "the fitted boundary does not sit materially outside the observed stroke");
  assert.ok(Math.max(...result.boundary.map((point) => point.x)) < 86,
    "a locally connected wrinkle cannot drag the full lesion boundary outward");
  assert.deepEqual(result.center, { x: 60, y: 60 },
    "normal-band fitting preserves the lesion centre used by incision planning");
  assert.equal(controlledMarkerInternals.boundarySelfIntersects(result.boundary), false);
}

{
  const target = image(160, 160, 205);
  faintIrregularRingWithGap(target, 80, 80);
  const adaptive = controlledMarkerInternals.adaptiveDarkBarrier(target, 22, 22, 117, 117, 205, 160, 24);
  const faintSamples = Array.from({ length: 36 }, (_value, index) => -2.35 + index * 1.9 / 35);
  const sampleMaskSupport = (mask: Uint8Array) => faintSamples.filter((angle) => {
      const radius = 32 + 4 * Math.sin(angle * 3) + 2 * Math.cos(angle * 5);
      const x = Math.round(80 + Math.cos(angle) * radius) - 22;
      const y = Math.round(80 + Math.sin(angle) * radius) - 22;
      return mask[y * 117 + x] === 1;
    }).length;
  const faintSupport = sampleMaskSupport(adaptive.mask);
  const faintWeakSupport = sampleMaskSupport(adaptive.weakMask);
  assert.ok(faintSupport >= 28,
    `faint stroke continuation remains anchored to its dark neighbours: retained=${faintSupport}/36 weak=${faintWeakSupport}/36`);
  const result = detectControlledMarker(
    target,
    { x: 80, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 64, scanDiameterMm: 40 },
  );
  assert.equal(result.ok, true,
    `a visually closed irregular edge with compression-sized pixel gaps is recovered: ${JSON.stringify(result)}`);
  assert.equal(result.geometry_mode, "enclosed_region");
  assert.ok(result.bbox && result.bbox.width >= 58 && result.bbox.width <= 76,
    "recovered boundary stays near the clicked target instead of expanding to the scan circle");
  assert.equal(result.diagnostics?.method, "seed_first_barrier");
  assert.ok(Number(result.diagnostics?.repair_radius || 0) > 0,
    "the real-like faint fixture requires a bounded barrier repair");
  assert.ok(!result.warnings.includes("radial_boundary_recovered"),
    "the real-like faint fixture is never recovered by angular interpolation");
  const shiftedResults = [76, 84].map((x) => detectControlledMarker(
    target,
    { x, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 64, scanDiameterMm: 40 },
  ));
  for (const shifted of shiftedResults) {
    assert.equal(shifted.ok, true,
      "small pointer movement inside one scan surface keeps the faint irregular outline detectable");
    assert.ok(shifted.bbox && shifted.bbox.width >= 58 && shifted.bbox.width <= 76,
      "neighboring scan seeds keep the complete irregular outline instead of a local pocket");
  }
}

{
  const target = texturedGradientImage(180, 160, 195, 218);
  relativeEllipseRing(target, 90, 80, 28, 24, 10, 2);
  const results = [
    { x: 90, y: 80 },
    { x: 86, y: 83 },
    { x: 94, y: 78 },
  ].map((seed) => detectControlledMarker(
    target,
    seed,
    { roiRadius: 58, expectedDiameterPx: 56, scanDiameterMm: 30 },
  ));
  for (const result of results) {
    assert.equal(result.ok, true,
      `a complete faint near-circular pen ridge is recoverable with an explicit controlled-scan size prior: ${JSON.stringify(result)}`);
    assert.equal(result.geometry_mode, "enclosed_region");
    assert.ok(result.warnings.includes("low_contrast_near_circular_recovered"),
      "weak-outline recovery remains explicit instead of being reported as a direct high-confidence enclosure");
    assert.equal(result.diagnostics?.method, "low_contrast_near_circular");
    assert.ok((result.diagnostics?.boundary_support_ratio || 0) >= 0.8);
    assert.ok((result.diagnostics?.shape_compactness || 0) >= 0.72);
    assert.ok(result.bbox && result.bbox.width >= 50 && result.bbox.width <= 66
      && result.bbox.height >= 42 && result.bbox.height <= 58,
      "the inferred boundary stays on the faint pen ridge rather than expanding to the scan circle");
  }
  assert.ok(results.every((result) => result.center
    && Math.hypot(result.center.x - 90, result.center.y - 80) <= 5),
    "small pointer movement keeps the weak recovered center near the same visible outline");
}

{
  const target = texturedGradientImage(180, 160, 195, 218);
  relativeEllipseRing(target, 90, 80, 28, 24, 10, 2, Math.PI / 10);
  const result = detectControlledMarker(
    target,
    { x: 90, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 56, scanDiameterMm: 30 },
  );
  assert.equal(result.ok, true,
    "a texture-obscured short arc remains recoverable under the bounded near-circular prior");
  assert.ok(result.warnings.includes("low_contrast_near_circular_recovered"),
    "the bounded weak recovery remains explicit for clinician review");
  assert.ok((result.diagnostics?.maximum_gap_degrees || 0) <= 22.5,
    "weak recovery never interpolates beyond the reviewed angular gap bound");
}

{
  const target = texturedGradientImage(180, 160, 195, 218);
  relativeEllipseRing(target, 90, 80, 28, 24, 10, 2, Math.PI / 10);
  const result = detectControlledMarker(
    target,
    { x: 90, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 16, scanDiameterMm: 20 },
  );
  assert.equal(result.ok, true,
    "a complete marker inside the scan stays recoverable when its actual size exceeds the disabled diameter value");
  assert.ok(result.bbox && result.bbox.width >= 50,
    "recovery follows the observed outer marker instead of the stale diameter prior");
}

{
  const target = texturedGradientImage(180, 160, 195, 218);
  broadAnnularShadow(target, 90, 80, 28, 12, 12);
  const result = detectControlledMarker(
    target,
    { x: 90, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 56, scanDiameterMm: 30 },
  );
  assert.equal(result.ok, false,
    "a broad low-contrast illumination band is not promoted by the thin-ridge recovery path");
}

{
  const target = texturedGradientImage(180, 160, 195, 218);
  const flatBoundary = Array.from({ length: 48 }, (_value, index) => {
    const angle = index * Math.PI * 2 / 48;
    return { x: 90 + Math.cos(angle) * 30, y: 80 + Math.sin(angle) * 10 };
  });
  const result = controlledMarkerInternals.reconcileMarkerStrokeCoverage(
    target,
    { x: 90, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 60, scanDiameterMm: 30 },
    58,
    {
      ok: true,
      failure_code: null,
      center: { x: 90, y: 80 },
      boundary: flatBoundary,
      area_px: 940,
      bbox: { x: 60, y: 70, width: 61, height: 21 },
      geometry_mode: "enclosed_region",
      seed_relation: "enclosed",
      marker_area_px: 140,
      marker_bbox: { x: 50, y: 40, width: 81, height: 81 },
      confidence: 0.8,
      candidate_count: 1,
      warnings: [],
      audit: { local_only: true, raw_media_retained: false, network_request_made: false },
    },
  );
  assert.equal(result.ok, false,
    "a very flat inner skin enclosure cannot be returned as a successful near-circular controlled marker");
  assert.equal(result.failure_code, "unstable_enclosure");
}

{
  const target = texturedGradientImage(180, 160, 195, 218);
  for (let x = 36; x <= 144; x += 1) {
    for (const offset of [-18, -5, 11, 24]) {
      const y = Math.round(80 + offset + 2 * Math.sin(x * 0.12 + offset));
      const index = (y * target.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) target.data[index + channel] -= 10;
    }
  }
  const result = detectControlledMarker(
    target,
    { x: 90, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 56, scanDiameterMm: 30 },
  );
  assert.equal(result.ok, false,
    "several faint wrinkle-like ridges cannot collectively imitate a near-circular enclosure");
}

{
  const target = texturedGradientImage(180, 160, 195, 218);
  relativeEllipseRing(target, 90, 80, 28, 24, 10, 2, 0.55);
  const result = detectControlledMarker(
    target,
    { x: 90, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 56, scanDiameterMm: 30 },
  );
  assert.equal(result.ok, false,
    "a genuinely open faint outline remains rejected instead of being completed by the near-circular prior");
  assert.ok([
    "edge_discontinuous",
    "unstable_enclosure",
    "seed_not_enclosed",
    "component_too_small",
    "no_dark_component",
    "low_contrast",
  ].includes(result.failure_code || ""));
}

{
  const target = image(160, 160, 205);
  angularSampledIrregularRing(target, 80, 80, 24);
  const result = detectControlledMarker(
    target,
    { x: 80, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 64, scanDiameterMm: 40 },
  );
  assert.equal(result.ok, false,
    "angular samples without traceable stroke endpoints cannot be promoted to a planning boundary");
  assert.ok(["edge_discontinuous", "unstable_enclosure"].includes(result.failure_code || ""),
    "endpoint-less angular samples remain rejected by continuity or enclosure stability checks");
}

{
  const target = texturedGradientImage(180, 160, 195, 218);
  ring(target, 90, 80, 28, 3, 32);
  disk(target, 90, 80, 5, 28);
  const recovered = controlledMarkerInternals.recoverBySeedNeighborhoodConsensus(
    target,
    { x: 90, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 56, scanDiameterMm: 30 },
    58,
    {
      ok: false,
      failure_code: "unstable_enclosure",
      center: null,
      boundary: [],
      area_px: 0,
      bbox: null,
      geometry_mode: null,
      seed_relation: null,
      marker_area_px: 0,
      marker_bbox: null,
      confidence: 0,
      candidate_count: 2,
      warnings: ["unstable_enclosure"],
      diagnostics: {
        method: "seed_first_barrier",
        failure_stage: "enclosure_disproportionate_to_marker_extent",
      },
      audit: { local_only: true, raw_media_retained: false, network_request_made: false },
    },
  );
  assert.equal(recovered.ok, true,
    `multi-seed recovery continues past a tiny inner feature to the traceable outer stroke: ${JSON.stringify(recovered)}`);
  assert.ok(recovered.bbox && recovered.bbox.width >= 52 && recovered.bbox.height >= 52,
    "the recovered geometry describes the outer marker instead of the inner dot");
  assert.ok(recovered.warnings.includes("radial_outer_boundary_consensus"),
    "radial recovery is auditable and requires neighborhood consensus");
  assert.ok((recovered.diagnostics?.scan_probe_consensus_count || 0) >= 3,
    "at least three neighboring radial probes support the promoted boundary");
  assert.equal(recovered.diagnostics?.traceable_stroke_quadrant_count, 4,
    "the promoted outer stroke is backed by all four quadrants");
}

{
  const target = texturedGradientImage(180, 160, 195, 218);
  disk(target, 90, 80, 5, 28);
  const rejected = controlledMarkerInternals.recoverBySeedNeighborhoodConsensus(
    target,
    { x: 90, y: 80 },
    { roiRadius: 58, expectedDiameterPx: 56, scanDiameterMm: 30 },
    58,
    {
      ok: false,
      failure_code: "unstable_enclosure",
      center: null,
      boundary: [],
      area_px: 0,
      bbox: null,
      geometry_mode: null,
      seed_relation: null,
      marker_area_px: 0,
      marker_bbox: null,
      confidence: 0,
      candidate_count: 1,
      warnings: ["unstable_enclosure"],
      diagnostics: {
        method: "seed_first_barrier",
        failure_stage: "enclosure_disproportionate_to_marker_extent",
      },
      audit: { local_only: true, raw_media_retained: false, network_request_made: false },
    },
  );
  assert.equal(rejected.ok, false,
    "an isolated inner dot cannot be expanded into an expected-size boundary without outer stroke pixels");
  assert.equal(rejected.failure_code, "unstable_enclosure");
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

const tangledRegionPixels: { x: number; y: number }[] = [];
for (let y = 10; y <= 34; y += 1) {
  for (let x = 10; x <= 38; x += 1) {
    const internalLoop = x >= 18 && x <= 24 && y >= 18 && y <= 26;
    if (!internalLoop) tangledRegionPixels.push({ x, y });
  }
}
const tangledOuterBoundary = controlledMarkerInternals.componentOuterBoundary(tangledRegionPixels, 128);
const tangledBoundaryKeys = new Set(tangledOuterBoundary.map((point) => `${point.x},${point.y}`));
assert.ok(tangledOuterBoundary.length >= 4 && tangledBoundaryKeys.size === tangledOuterBoundary.length,
  "overlapping/tangled repair raster unions yield one de-duplicated outer boundary instead of internal loops");

const roughNearCircularBoundary = Array.from({ length: 64 }, (_, index) => {
  const angle = index / 64 * Math.PI * 2;
  const radius = index % 2 ? 20 : 22;
  return { x: 48 + Math.cos(angle) * radius, y: 48 + Math.sin(angle) * radius };
});
const normalizedRadialRoughness = (
  points: Array<{ x: number; y: number }>,
  center: { x: number; y: number },
) => {
  const radii = points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const meanRadius = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
  return radii.reduce((sum, radius, index) => sum + Math.abs(
    radii[(index - 1 + radii.length) % radii.length] - 2 * radius + radii[(index + 1) % radii.length],
  ), 0) / radii.length / meanRadius;
};
const finalizedNearCircular = controlledMarkerInternals.finalizeControlledMarkerBoundary({
  ok: true,
  failure_code: null,
  center: { x: 48, y: 48 },
  boundary: roughNearCircularBoundary,
  area_px: 1300,
  bbox: { x: 26, y: 26, width: 45, height: 45 },
  geometry_mode: "enclosed_region",
  seed_relation: "enclosed",
  marker_area_px: 200,
  marker_bbox: { x: 25, y: 25, width: 47, height: 47 },
  confidence: 0.9,
  candidate_count: 1,
  warnings: [],
  audit: { local_only: true, raw_media_retained: false, network_request_made: false },
});
assert.equal(finalizedNearCircular.diagnostics?.boundary_smoothing, "periodic_constrained");
assert.equal(finalizedNearCircular.boundary.length, 48,
  "a near-circular final boundary is arc-length resampled and periodically smoothed");
assert.ok((finalizedNearCircular.diagnostics?.boundary_smoothing_area_ratio || 0) >= 0.98
  && (finalizedNearCircular.diagnostics?.boundary_smoothing_area_ratio || 0) <= 1.13,
"final smoothing cannot shrink away the detected range or expand it without a bound");
assert.ok((finalizedNearCircular.diagnostics?.boundary_smoothing_passes || 0) >= 3,
  "the finalizer records the strongest safe periodic smoothing pass for audit");
assert.ok((finalizedNearCircular.diagnostics?.boundary_smoothing_max_miss_ratio ?? 1) <= 0.07,
  "pixel-scale roughness can be removed only while the maximum normalized miss stays bounded");
assert.ok(normalizedRadialRoughness(finalizedNearCircular.boundary, { x: 48, y: 48 })
  < normalizedRadialRoughness(roughNearCircularBoundary, { x: 48, y: 48 }) * 0.35,
"accepted smoothing materially reduces high-frequency radial jaggedness");
assert.equal(controlledMarkerInternals.boundarySelfIntersects(finalizedNearCircular.boundary), false,
  "accepted smoothing cannot create a self-intersecting boundary");

const localizedRasterRoughness = Array.from({ length: 64 }, (_, index) => {
  const angle = index / 64 * Math.PI * 2;
  const shortLobe = index >= 5 && index <= 8 ? 1.6 : 0;
  const shallowNotch = index >= 30 && index <= 32 ? -1.2 : 0;
  const radius = 22 + (index % 2 ? 0.8 : -0.6) + shortLobe + shallowNotch;
  return { x: 52 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
});
const finalizedLocalizedRoughness = controlledMarkerInternals.finalizeControlledMarkerBoundary({
  ok: true,
  failure_code: null,
  center: { x: 52, y: 50 },
  boundary: localizedRasterRoughness,
  area_px: 1500,
  bbox: { x: 28, y: 27, width: 49, height: 47 },
  geometry_mode: "enclosed_region",
  seed_relation: "enclosed",
  marker_area_px: 220,
  marker_bbox: { x: 27, y: 26, width: 51, height: 49 },
  confidence: 0.9,
  candidate_count: 1,
  warnings: [],
  audit: { local_only: true, raw_media_retained: false, network_request_made: false },
});
assert.equal(finalizedLocalizedRoughness.diagnostics?.boundary_smoothing, "periodic_constrained",
  "one-sided pixel lobes and shallow notches use the same scale-independent cleanup as other near-circular outlines");
assert.equal(finalizedLocalizedRoughness.boundary.length, 48);
assert.equal(controlledMarkerInternals.boundarySelfIntersects(finalizedLocalizedRoughness.boundary), false,
  "localized roughness cleanup remains a single non-intersecting loop");

const genuineLargeProtrusion = Array.from({ length: 64 }, (_, index) => {
  const angle = index / 64 * Math.PI * 2;
  const radius = index === 7 ? 34 : 22;
  return { x: 52 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
});
const preservedLargeProtrusion = controlledMarkerInternals.finalizeControlledMarkerBoundary({
  ok: true,
  failure_code: null,
  center: { x: 52, y: 50 },
  boundary: genuineLargeProtrusion,
  area_px: 1500,
  bbox: { x: 28, y: 27, width: 59, height: 47 },
  geometry_mode: "enclosed_region",
  seed_relation: "enclosed",
  marker_area_px: 220,
  marker_bbox: { x: 27, y: 26, width: 61, height: 49 },
  confidence: 0.9,
  candidate_count: 1,
  warnings: [],
  audit: { local_only: true, raw_media_retained: false, network_request_made: false },
});
assert.ok(Math.max(...preservedLargeProtrusion.boundary.map((point) => Math.hypot(point.x - 52, point.y - 50))) >= 31.5,
  "a large localized protrusion remains geometrically present instead of being erased as if it were raster noise");
assert.ok(preservedLargeProtrusion.diagnostics?.boundary_smoothing === "raw_fallback"
  || (preservedLargeProtrusion.diagnostics?.boundary_smoothing_max_miss_ratio ?? 1) <= 0.07,
"a preserved protrusion may be smoothed only when its scale-normalized displacement remains bounded");

const falseInnerPocketBoundary = Array.from({ length: 48 }, (_, index) => {
  const angle = index / 48 * Math.PI * 2;
  // Five isolated inward raster pockets model an extracted inner retrace. The
  // outer support still describes one near-circular lesion boundary.
  const radius = index % 10 === 0 ? 14 : 24;
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
});
const regularizedFalseInnerPockets = controlledMarkerInternals.finalizeControlledMarkerBoundary({
  ok: true,
  failure_code: null,
  center: { x: 50, y: 50 },
  boundary: falseInnerPocketBoundary,
  area_px: 1600,
  bbox: { x: 26, y: 26, width: 49, height: 49 },
  geometry_mode: "enclosed_region",
  seed_relation: "enclosed",
  marker_area_px: 240,
  marker_bbox: { x: 25, y: 25, width: 51, height: 51 },
  confidence: 0.9,
  candidate_count: 1,
  warnings: [],
  audit: { local_only: true, raw_media_retained: false, network_request_made: false },
});
assert.equal(regularizedFalseInnerPockets.diagnostics?.boundary_regularization, "convex_hull",
  "isolated false inner retraces may use the gated near-circular convex regularizer");
assert.ok((regularizedFalseInnerPockets.diagnostics?.boundary_regularization_p90_displacement_ratio ?? 1) <= 0.12,
  "accepted convex regularization keeps distributed scale-normalized displacement below the compatibility gate");
assert.ok((regularizedFalseInnerPockets.diagnostics?.boundary_regularization_area_ratio ?? 2) <= 1.45,
  "convex regularization cannot expand the detected lesion range without a bounded audit ratio");
assert.equal(controlledMarkerInternals.boundarySelfIntersects(regularizedFalseInnerPockets.boundary), false,
  "regularizing an extraction retrace still yields one non-intersecting loop");

const repeatedDeepConcavities = Array.from({ length: 48 }, (_, index) => {
  const angle = index / 48 * Math.PI * 2;
  const radius = index % 4 === 0 ? 15 : 24;
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
});
const preservedDeepConcavities = controlledMarkerInternals.finalizeControlledMarkerBoundary({
  ok: true,
  failure_code: null,
  center: { x: 50, y: 50 },
  boundary: repeatedDeepConcavities,
  area_px: 1400,
  bbox: { x: 26, y: 26, width: 49, height: 49 },
  geometry_mode: "enclosed_region",
  seed_relation: "enclosed",
  marker_area_px: 240,
  marker_bbox: { x: 25, y: 25, width: 51, height: 51 },
  confidence: 0.9,
  candidate_count: 1,
  warnings: [],
  audit: { local_only: true, raw_media_retained: false, network_request_made: false },
});
assert.equal(preservedDeepConcavities.diagnostics?.boundary_regularization, undefined,
  "distributed deep concavities are not silently replaced by a plausible-looking convex outline");
assert.equal(preservedDeepConcavities.diagnostics?.boundary_smoothing, "raw_fallback",
  "when both direct smoothing and shape-preserving convex gating fail, the original outline is retained");
assert.ok(Math.min(...preservedDeepConcavities.boundary.map((point) => Math.hypot(point.x - 50, point.y - 50))) <= 15.1,
  "the compatibility gate preserves genuine deep concavities instead of erasing them");

const source = fs.readFileSync("src/services/controlledMarkerDetection.ts", "utf8");
assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|\bfetch\s*\(|axios|onnxruntime|mediapipe/i,
  "controlled marker detector must stay pure, local, and SDK-independent");

const runtimeSource = fs.readFileSync("src/services/incisionPhotoRuntime.ts", "utf8");
const domBindingsSource = fs.readFileSync("src/services/incisionDomBindings.ts", "utf8");
const workerSource = fs.readFileSync("src/workers/workflow.worker.ts", "utf8");
const stylesSource = fs.readFileSync("src/styles.css", "utf8");
const clinicalCopySource = fs.readFileSync("src/services/incisionClinicalCopy.ts", "utf8");
const stagePanelSource = fs.readFileSync("src/components/IncisionStagePanel.tsx", "utf8");
assert.match(controlledMarkerFailureMessage({ failure_code: "edge_discontinuous", diagnostics: {} }),
  /扩大扫描范围或补线/);
assert.match(controlledMarkerFailureMessage({ failure_code: "ambiguous_candidates", diagnostics: {} }),
  /适当缩小扫描范围.*只保留一个肿物边界/);
assert.ok(runtimeSource.includes('publishState("controlled_marker_cancelled")'), "marker action supports explicit cancellation");
assert.ok(runtimeSource.includes("resetControlledMarker({ restoreSelection: true })"), "cancel and exit restore the confirmed selection");
assert.ok(runtimeSource.includes("candidateDisplayBlocked && !surfaceReferenceRecoveryEligible ? [] : endpointRefs"),
  "blocked candidates hide stale handles unless the only block is eligible for a constrained photo reference");
assert.ok(runtimeSource.includes("keepControlledMarkerRetry"),
  "failed marker clicks retain marker mode so the user can retry directly");
assert.ok(runtimeSource.includes("projectedCandidate !== state.result?.candidate"),
  "endpoint visibility is bound to the candidate whose photo projection was validated");
assert.ok(runtimeSource.includes('publishState("controlled_marker_applied")'),
  "a successful marker click immediately applies the detected lesion and candidate");
assert.ok(runtimeSource.includes("Comlink.transfer")
  && workerSource.includes("detectControlledMarker(image, seed, options)"),
"controlled-marker pixel analysis runs in the existing local workflow worker instead of blocking pointer release");
assert.ok(stagePanelSource.includes('id="controlledMarkerScanDiameter"')
  && stagePanelSource.includes('id="controlledMarkerScanOverlay"')
  && stagePanelSource.includes('max="60"')
  && runtimeSource.includes("stablePhotoPixelsPerMm")
  && runtimeSource.includes("expectedDiameterPx")
  && stylesSource.includes("controlled-marker-scan-overlay"),
"controlled mode exposes a millimetre-labelled circular scan area backed by a stable photo scale");
assert.ok(stagePanelSource.includes('min="0"')
  && stagePanelSource.includes('max="60"')
  && stagePanelSource.includes('aria-valuemin={10}')
  && runtimeSource.includes("controlledMarkerScanDiameterMm")
  && runtimeSource.includes("Number.isFinite(rawDiameterMm)")
  && runtimeSource.includes("const presentationProgress = diameterMm / 60")
  && runtimeSource.includes('"--scan-thumb-offset"')
  && stylesSource.includes("#controlledMarkerScanDiameter::-webkit-slider-thumb")
  && stylesSource.includes("background: #0f62fe"),
"the scan control preserves the established blue track style, maps 10 mm to 1/6, reaches the right endpoint at 60 mm, and retains a 10 mm operational minimum");
assert.ok(clinicalCopySource.includes('detection.failure_code === "scan_range_too_small"')
  && clinicalCopySource.includes('detection.failure_code === "edge_discontinuous"')
  && clinicalCopySource.includes('detection.failure_code === "unstable_enclosure"'),
"scan coverage, discontinuous edges, and click-local false enclosures have separate clinician-facing recovery messages");
assert.ok(stagePanelSource.includes('id="controlledMarkerRepairBtn"')
  && stagePanelSource.includes('id="controlledMarkerRepairUndoBtn"')
  && stagePanelSource.includes('id="controlledMarkerRepairClearBtn"')
  && runtimeSource.includes("controlledMarkerFailureCanBeRepaired")
  && runtimeSource.includes('"scan_range_too_small", "edge_discontinuous", "unstable_enclosure"'),
"persistent manual repair controls become usable for scan-coverage or boundary-completion failures");
assert.ok(runtimeSource.includes("drawControlledMarkerRepairs")
  && runtimeSource.includes('"manual_boundary_repair"')
  && runtimeSource.includes("controlled_marker_repair_applied")
  && domBindingsSource.includes("repairStroke"),
"left-drag repair strokes are composited into local detection and retain explicit provenance");
assert.ok(runtimeSource.includes("analysisDisplayWidth * 0.25")
  && runtimeSource.includes("controlledMarkerRepairOverlayVisible = false")
  && runtimeSource.includes("蓝色补线已隐藏；如需继续可再次点击“补线”")
  && runtimeSource.includes("if (usedManualRepair) drawControlledMarkerRepairs(context)"),
"manual repair keeps its analysis width, renders at one quarter visual width, and hides the blue overlay after successful recognition");
assert.ok(runtimeSource.includes("enforceControlledMarkerTumorKind")
  && runtimeSource.includes("!state.photoView.active || !cutaneous")
  && runtimeSource.includes("syncTumorKindGuard(kind)")
  && runtimeSource.includes("resetControlledMarker({ restoreSelection: true, kind })")
  && runtimeSource.includes("受控标记仅适用于皮表肿物；皮下肿物按术前测量直径与 RSTL 方向规划。")
  && runtimeSource.includes("subcutaneous_controlled_marker_cancelled"),
"subcutaneous tumors disable controlled marking, cancel an active mode, and retain a program-level hard gate");
const repairPointerEntry = runtimeSource.indexOf("beginControlledMarkerRepairStroke(event) {");
const repairPointerBody = runtimeSource.slice(repairPointerEntry, repairPointerEntry + 500);
assert.ok(repairPointerEntry >= 0
  && repairPointerBody.indexOf("if (!controlledMarkerRepairMode) return false;")
    < repairPointerBody.indexOf("if (enforceControlledMarkerTumorKind()) return true;"),
"inactive repair mode passes photo pointer events through before the subcutaneous marker gate, allowing linear planning clicks");
assert.ok(runtimeSource.includes("photoDiameterEstimateMm")
  && runtimeSource.includes("photoPixelsPerMm")
  && !runtimeSource.includes("buildSubcutaneousDiameterEstimateRefs({"),
"subcutaneous photo rendering uses a stable screen-space diameter indicator instead of a tangent-plane projection");
assert.ok(runtimeSource.includes("controlledMarkerRepairStrokes.pop()")
  && runtimeSource.includes("controlledMarkerRepairStrokes = []")
  && runtimeSource.includes("runControlledMarkerDetection(retryContext.seed, { preserveRepair: true })")
  && runtimeSource.includes("strokeLength < Math.max")
  && runtimeSource.includes("sourceRevision"),
"repair undo/clear both recalculate from remaining strokes, reject accidental clicks, and cannot cross photo revisions");
assert.ok(stylesSource.includes("controlled-marker-recovery-attention")
  && stylesSource.includes("1s ease-in-out 2")
  && runtimeSource.includes("promptControlledMarkerRecovery")
  && runtimeSource.includes("elements.controlledMarkerScanControl")
  && runtimeSource.includes("elements.controlledMarkerRepair"),
"the scan-range and repair controls both give a bounded two-pulse visual prompt when recovery is ambiguous");
assert.ok(runtimeSource.includes("candidateVisible")
  && runtimeSource.includes('publishState("controlled_marker_candidate_hidden")'),
"success feedback requires an actually visible projected candidate");
assert.ok(runtimeSource.includes("low_contrast_near_circular_recovered")
  && runtimeSource.includes('publishState("controlled_marker_weak_boundary_candidate")')
  && runtimeSource.includes("部分边界由局部明暗和形状连续性推断"),
"a weak near-circular recovery stays yellow and explicitly asks the operator to verify the inferred boundary");
assert.ok(runtimeSource.includes('smoothingMode === "sourceFallback"')
  && runtimeSource.includes('publishState("controlled_marker_candidate_needs_review")'),
"a fallback-shaped candidate remains yellow instead of reporting green success");
assert.ok(runtimeSource.includes('smoothingMode === "constrainedReference"')
  && runtimeSource.includes('publishState("controlled_marker_reference_candidate")')
  && runtimeSource.includes("该结果不满足项目原定比例")
  && runtimeSource.includes("workflowPhotoSurfaceReferenceRecoveryEligible")
  && runtimeSource.includes("referenceAttemptFailureDetail"),
"surface-only blocks may attempt an auditable non-3:1 reference while all failures remain explicit and yellow");
assert.ok(runtimeSource.includes('smoothingMode === "limitedVisibility"')
  && runtimeSource.includes('publishState("controlled_marker_visibility_limited_candidate")')
  && runtimeSource.includes("不能确认完整长度及不可见区域，请结合另一视角复核")
  && runtimeSource.includes("photoProjectionFailureDetail"),
"a geometrically valid standard candidate may show only its visible run, stays yellow, and failures expose structured details");
assert.ok(stagePanelSource.includes('id="incisionPhotoUploadLabel"')
  && runtimeSource.includes("当前已上传照片")
  && runtimeSource.includes("file.name"),
"the photo upload tooltip reports the current detailed file name or none");
assert.ok(runtimeSource.includes('const diameterAdjusted = kind === "cutaneous"')
  && runtimeSource.includes("识别范围与填写直径有差异，切口已按黄色识别范围自动调整")
  && !runtimeSource.includes('publishState("controlled_marker_diameter_needs_review")'),
"a visible valid candidate stays green when only the operator-entered diameter differs");
assert.ok(runtimeSource.includes("state.planning2d?.setSelection({ centerRef: null, boundaryRefs: [] })")
  && runtimeSource.includes('keepControlledMarkerRetry("")'),
"a fresh scan hides the last accepted yellow boundary and candidate until the new result is known");
assert.ok(runtimeSource.includes("controlled marker planning audit")
  && runtimeSource.includes("geometry.candidateProjection.reasonCodes")
  && runtimeSource.includes("raw_media_retained: false"),
"controlled-marker planning records privacy-safe geometry, direction, candidate, and projection diagnostics");
assert.ok(runtimeSource.includes("controlled marker stroke-only result rejected")
  && runtimeSource.includes("当前点击处只识别到黑色笔画"),
"cutaneous controlled-marker mode cannot report a local pen stroke as a lesion boundary");
assert.ok(stylesSource.includes('#incisionPhotoCanvas[data-controlled-marker="true"]')
  && stylesSource.includes('#incisionPhotoCanvas[aria-busy="true"]')
  && stylesSource.includes('~ .incision-photo-endpoint-layer .incision-photo-endpoint-handle'),
"controlled-marker mode owns the full scan surface instead of leaving stale endpoint hit targets above it");
assert.ok(runtimeSource.includes("state.controlledBoundaryActive = kind === \"cutaneous\""),
  "controlled cutaneous boundaries are independent from the manual boundary-mode dropdown");
assert.ok(domBindingsSource.includes('getAttribute("aria-pressed") === "true"')
  && domBindingsSource.includes("photoDrag.pickOnly")
  && runtimeSource.includes("controlledMarkerSeedMode) return null")
  && runtimeSource.includes("!state.photoView.active || controlledMarkerSeedMode"),
"controlled-marker picking suppresses photo panning and endpoint hit-testing while the toggle is active");
assert.ok(runtimeSource.includes("黄色线表示识别范围")
  && runtimeSource.includes("切口大小已根据识别结果自动调整")
  && runtimeSource.includes('"ready");'),
"successful controlled-marker feedback explains the visible result in doctor-readable language");
assert.ok(clinicalCopySource.includes("当前点击区域未识别到肿物")
  && clinicalCopySource.includes("肿物边界可能较浅或留有较大开口")
  && !runtimeSource.includes("ROI ${"),
"failure feedback keeps engineering diagnostics out of the clinician-facing status area");
assert.doesNotMatch(`${runtimeSource}\n${clinicalCopySource}`, /模拟/,
  "controlled-marker clinician-facing prompts do not expose simulation wording");
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
