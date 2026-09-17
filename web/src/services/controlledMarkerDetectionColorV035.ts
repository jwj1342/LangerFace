import {
  __controlledMarkerForTests,
  CONTROLLED_MARKER_DETECTOR_VERSION as LEGACY_DETECTOR_VERSION,
  detectControlledMarker as detectWithLegacyCore,
} from "./controlledMarkerDetectionLegacyV023.ts";
import type {
  ControlledMarkerDetection,
  ControlledMarkerOptions,
  MarkerImageData,
  MarkerPoint,
} from "./controlledMarkerDetection.ts";

// Candidate identity remains stable across tuning rounds until the operator
// explicitly accepts a completed version iteration.
export const CONTROLLED_MARKER_DETECTOR_VERSION = "task1-candidate";
export const COLOR_DIFFERENCE_BASELINE_VERSION = LEGACY_DETECTOR_VERSION;

interface LabColor {
  l: number;
  a: number;
  b: number;
}

const DENOISED_EVIDENCE_KERNEL = [1, 4, 6, 4, 1] as const;
const DENOISED_EVIDENCE_KERNEL_SUM = 16;
const DENOISED_EVIDENCE_GAIN = 2;

const clamp = (value: number, low: number, high: number): number => (
  Math.max(low, Math.min(high, value))
);

function srgbToLinear(value: number): number {
  const normalized = clamp(value, 0, 255) / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function xyzPivot(value: number): number {
  return value > 216 / 24389
    ? Math.cbrt(value)
    : (24389 / 27 * value + 16) / 116;
}

function rgbToLab(red: number, green: number, blue: number): LabColor {
  const r = srgbToLinear(red);
  const g = srgbToLinear(green);
  const b = srgbToLinear(blue);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fx = xyzPivot(x);
  const fy = xyzPivot(y);
  const fz = xyzPivot(z);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function fallbackRoiRadius(image: MarkerImageData): number {
  const shortSide = Math.min(Math.floor(image.width), Math.floor(image.height));
  return clamp(Math.round(shortSide * 0.30), 128, 320);
}

function integralMean(
  integral: Float64Array,
  stride: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number {
  const total = integral[(bottom + 1) * stride + right + 1]
    - integral[top * stride + right + 1]
    - integral[(bottom + 1) * stride + left]
    + integral[top * stride + left];
  return total / ((right - left + 1) * (bottom - top + 1));
}

function colorDifferenceEvidenceImage(
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions,
): MarkerImageData {
  const width = Math.floor(image.width);
  const height = Math.floor(image.height);
  const roiRadius = clamp(
    Math.round(options.roiRadius ?? fallbackRoiRadius(image)),
    1,
    Math.max(width, height),
  );
  const x0 = clamp(Math.floor(seed.x - roiRadius), 0, Math.max(0, width - 1));
  const y0 = clamp(Math.floor(seed.y - roiRadius), 0, Math.max(0, height - 1));
  const x1 = clamp(Math.ceil(seed.x + roiRadius), 0, Math.max(0, width - 1));
  const y1 = clamp(Math.ceil(seed.y + roiRadius), 0, Math.max(0, height - 1));
  const roiWidth = x1 - x0 + 1;
  const roiHeight = y1 - y0 + 1;
  const labL = new Float32Array(roiWidth * roiHeight);
  const labA = new Float32Array(roiWidth * roiHeight);
  const labB = new Float32Array(roiWidth * roiHeight);
  const stride = roiWidth + 1;
  const integralL = new Float64Array((roiWidth + 1) * (roiHeight + 1));
  const integralA = new Float64Array((roiWidth + 1) * (roiHeight + 1));
  const integralB = new Float64Array((roiWidth + 1) * (roiHeight + 1));

  for (let y = 0; y < roiHeight; y += 1) {
    let rowL = 0;
    let rowA = 0;
    let rowB = 0;
    for (let x = 0; x < roiWidth; x += 1) {
      const sourceIndex = ((y0 + y) * width + x0 + x) * 4;
      const lab = rgbToLab(
        Number(image.data[sourceIndex]),
        Number(image.data[sourceIndex + 1]),
        Number(image.data[sourceIndex + 2]),
      );
      const localIndex = y * roiWidth + x;
      labL[localIndex] = lab.l;
      labA[localIndex] = lab.a;
      labB[localIndex] = lab.b;
      rowL += lab.l;
      rowA += lab.a;
      rowB += lab.b;
      const integralIndex = (y + 1) * stride + x + 1;
      integralL[integralIndex] = integralL[y * stride + x + 1] + rowL;
      integralA[integralIndex] = integralA[y * stride + x + 1] + rowA;
      integralB[integralIndex] = integralB[y * stride + x + 1] + rowB;
    }
  }

  const expectedDiameter = Number(options.expectedDiameterPx || 0);
  const referenceRadius = clamp(
    Math.round(expectedDiameter > 0 ? expectedDiameter * 0.14 : roiRadius * 0.075),
    5,
    18,
  );
  const output = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    output[index * 4] = 255;
    output[index * 4 + 1] = 255;
    output[index * 4 + 2] = 255;
    output[index * 4 + 3] = 255;
  }

  for (let y = 0; y < roiHeight; y += 1) {
    const top = Math.max(0, y - referenceRadius);
    const bottom = Math.min(roiHeight - 1, y + referenceRadius);
    for (let x = 0; x < roiWidth; x += 1) {
      if ((x0 + x - seed.x) ** 2 + (y0 + y - seed.y) ** 2 > roiRadius ** 2) continue;
      const left = Math.max(0, x - referenceRadius);
      const right = Math.min(roiWidth - 1, x + referenceRadius);
      const localIndex = y * roiWidth + x;
      const deltaL = labL[localIndex] - integralMean(integralL, stride, left, top, right, bottom);
      const deltaA = labA[localIndex] - integralMean(integralA, stride, left, top, right, bottom);
      const deltaB = labB[localIndex] - integralMean(integralB, stride, left, top, right, bottom);
      const deltaE = Math.hypot(deltaL, deltaA, deltaB);
      const evidence = clamp(Math.round(deltaE * 5), 0, 255);
      const value = 255 - evidence;
      const outputIndex = ((y0 + y) * width + x0 + x) * 4;
      output[outputIndex] = value;
      output[outputIndex + 1] = value;
      output[outputIndex + 2] = value;
    }
  }
  return { width, height, data: output };
}

function denoisedColorDifferenceEvidenceImage(
  evidenceImage: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions,
): MarkerImageData {
  const width = Math.floor(evidenceImage.width);
  const height = Math.floor(evidenceImage.height);
  const roiRadius = clamp(
    Math.round(options.roiRadius ?? fallbackRoiRadius(evidenceImage)),
    1,
    Math.max(width, height),
  );
  const kernelRadius = Math.floor(DENOISED_EVIDENCE_KERNEL.length / 2);
  const x0 = clamp(Math.floor(seed.x - roiRadius) - kernelRadius, 0, Math.max(0, width - 1));
  const y0 = clamp(Math.floor(seed.y - roiRadius) - kernelRadius, 0, Math.max(0, height - 1));
  const x1 = clamp(Math.ceil(seed.x + roiRadius) + kernelRadius, 0, Math.max(0, width - 1));
  const y1 = clamp(Math.ceil(seed.y + roiRadius) + kernelRadius, 0, Math.max(0, height - 1));
  const horizontal = new Float32Array(width * height);
  const output = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    output[index * 4] = 255;
    output[index * 4 + 1] = 255;
    output[index * 4 + 2] = 255;
    output[index * 4 + 3] = 255;
  }

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      let weightedEvidence = 0;
      for (let offset = -kernelRadius; offset <= kernelRadius; offset += 1) {
        const sourceX = clamp(x + offset, 0, width - 1);
        const sourceIndex = (y * width + sourceX) * 4;
        weightedEvidence += (255 - Number(evidenceImage.data[sourceIndex]))
          * DENOISED_EVIDENCE_KERNEL[offset + kernelRadius];
      }
      horizontal[y * width + x] = weightedEvidence / DENOISED_EVIDENCE_KERNEL_SUM;
    }
  }

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if ((x - seed.x) ** 2 + (y - seed.y) ** 2 > roiRadius ** 2) continue;
      let weightedEvidence = 0;
      for (let offset = -kernelRadius; offset <= kernelRadius; offset += 1) {
        const sourceY = clamp(y + offset, 0, height - 1);
        weightedEvidence += horizontal[sourceY * width + x]
          * DENOISED_EVIDENCE_KERNEL[offset + kernelRadius];
      }
      const evidence = clamp(Math.round(
        weightedEvidence / DENOISED_EVIDENCE_KERNEL_SUM * DENOISED_EVIDENCE_GAIN,
      ), 0, 255);
      const value = 255 - evidence;
      const outputIndex = (y * width + x) * 4;
      output[outputIndex] = value;
      output[outputIndex + 1] = value;
      output[outputIndex + 2] = value;
    }
  }
  return { width, height, data: output };
}

interface CandidateGate {
  valid: boolean;
  reasons: string[];
}

const MAXIMUM_RETRY_SCALE = 1.45;
const STROKE_RECONCILIATION_SCALES = [1.08, 1.15, 1.2] as const;
const MINIMUM_REQUESTED_DIAMETER_RATIO = 0.65;
const MAXIMUM_REQUESTED_DIAMETER_RATIO = 1.65 * MAXIMUM_RETRY_SCALE;
const MINIMUM_SOLID_DIAMETER_MM = 3;

function boundaryCompactness(boundary: MarkerPoint[]): number {
  if (boundary.length < 3) return 0;
  let twiceArea = 0;
  let perimeter = 0;
  for (let index = 0; index < boundary.length; index += 1) {
    const point = boundary[index];
    const next = boundary[(index + 1) % boundary.length];
    twiceArea += point.x * next.y - next.x * point.y;
    perimeter += Math.hypot(next.x - point.x, next.y - point.y);
  }
  const area = Math.abs(twiceArea) / 2;
  return perimeter > 0 ? 4 * Math.PI * area / (perimeter * perimeter) : 0;
}

function boundaryGeometry(boundary: MarkerPoint[]): {
  area: number;
  center: MarkerPoint;
  bbox: { x: number; y: number; width: number; height: number };
} | null {
  if (boundary.length < 3) return null;
  let twiceSignedArea = 0;
  let centroidXNumerator = 0;
  let centroidYNumerator = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < boundary.length; index += 1) {
    const point = boundary[index];
    const next = boundary[(index + 1) % boundary.length];
    const cross = point.x * next.y - next.x * point.y;
    twiceSignedArea += cross;
    centroidXNumerator += (point.x + next.x) * cross;
    centroidYNumerator += (point.y + next.y) * cross;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (Math.abs(twiceSignedArea) <= 1e-6) return null;
  return {
    area: Math.abs(twiceSignedArea) / 2,
    center: {
      x: centroidXNumerator / (3 * twiceSignedArea),
      y: centroidYNumerator / (3 * twiceSignedArea),
    },
    bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

function candidateShapeCompactness(result: ControlledMarkerDetection): number {
  const rawCompactness = Number.isFinite(result.diagnostics?.shape_compactness)
    ? Number(result.diagnostics?.shape_compactness)
    : boundaryCompactness(result.boundary);
  const emittedCompactness = boundaryCompactness(result.boundary);
  const diagnostics = result.diagnostics;
  const tightlyBoundedRegularization = diagnostics?.boundary_smoothing === "periodic_constrained"
    && diagnostics.boundary_regularization === "convex_hull"
    && rawCompactness >= 0.50
    && Number(diagnostics.boundary_regularization_area_ratio) <= 1.15
    && Number(diagnostics.boundary_regularization_solidity) >= 0.85
    && Number(diagnostics.boundary_regularization_p90_displacement_ratio) <= 0.10
    && Number(diagnostics.boundary_regularization_max_displacement_ratio) <= 0.25;
  const tightlyBoundedStrokeEnvelope = diagnostics?.boundary_smoothing === "periodic_constrained"
    && diagnostics.boundary_stroke_reconciliation === "normal_stroke_band"
    && rawCompactness >= 0.45
    && Number(diagnostics.boundary_smoothing_area_ratio) <= 1.13
    && Number(diagnostics.boundary_smoothing_outside_ratio) <= 0.18
    && Number(diagnostics.boundary_smoothing_max_miss_ratio) <= 0.08
    && Number(diagnostics.boundary_support_ratio) >= 0.95
    && Number(diagnostics.repair_fraction) <= 0.05;
  const supportedNarrowSpurTrim = diagnostics?.boundary_smoothing === "periodic_constrained"
    && diagnostics.boundary_regularization === "supported_radial_bridge"
    && rawCompactness >= 0.45
    && Number(diagnostics.boundary_regularization_area_ratio) >= 0.97
    && Number(diagnostics.boundary_regularization_area_ratio) <= 1
    && Number(diagnostics.boundary_regularization_arc_fraction) <= 0.10
    && Number(diagnostics.boundary_regularization_max_displacement_ratio) <= 0.30
    && Number(diagnostics.boundary_regularization_replacement_support_ratio) >= 0.80
    && Number(diagnostics.boundary_regularization_replacement_support_p20) >= 45
    && Number(diagnostics.boundary_support_ratio) >= 0.95
    && Number(diagnostics.repair_fraction) <= 0.05;
  const boundedSolidRegularization = result.geometry_mode === "dark_component"
    && diagnostics?.solid_boundary_regularization === "periodic_constrained"
    && Number(diagnostics.solid_boundary_area_ratio) >= 0.97
    && Number(diagnostics.solid_boundary_area_ratio) <= 1.03
    && Number(diagnostics.solid_boundary_max_displacement_ratio) <= 0.22;

  // shape_compactness describes the noisy pre-regularization raster outline.
  // Only when the frozen legacy core proves that its bounded regularization was
  // local and conservative should the color profile judge the emitted boundary
  // rather than reject an otherwise well-supported thin pen ring.
  return tightlyBoundedRegularization || tightlyBoundedStrokeEnvelope || supportedNarrowSpurTrim
    || boundedSolidRegularization
    ? emittedCompactness
    : rawCompactness;
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function otsuThreshold(values: number[]): number {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[clamp(Math.round(value), 0, 255)] += 1;
  const total = values.length;
  const weightedTotal = histogram.reduce((sum, count, value) => sum + count * value, 0);
  let backgroundWeight = 0;
  let backgroundWeighted = 0;
  let bestVariance = -1;
  let bestThreshold = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundWeighted += value * histogram[value];
    const backgroundMean = backgroundWeighted / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundWeighted) / foregroundWeight;
    const betweenVariance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (betweenVariance > bestVariance) {
      bestVariance = betweenVariance;
      bestThreshold = value;
    }
  }
  return bestThreshold;
}

function resampleClosedBoundary(points: MarkerPoint[], count = 48): MarkerPoint[] {
  if (points.length < 3) return [];
  const lengths = points.map((point, index) => Math.hypot(
    points[(index + 1) % points.length].x - point.x,
    points[(index + 1) % points.length].y - point.y,
  ));
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  if (!(perimeter > 1e-6)) return [];
  const output: MarkerPoint[] = [];
  let segment = 0;
  let segmentStart = 0;
  for (let sample = 0; sample < count; sample += 1) {
    const target = perimeter * sample / count;
    while (segment < lengths.length - 1 && segmentStart + lengths[segment] < target) {
      segmentStart += lengths[segment];
      segment += 1;
    }
    const start = points[segment];
    const end = points[(segment + 1) % points.length];
    const t = lengths[segment] > 1e-9 ? (target - segmentStart) / lengths[segment] : 0;
    output.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
  }
  return output;
}

function regularizeSolidBoundary(result: ControlledMarkerDetection): ControlledMarkerDetection {
  if (!result.ok || result.geometry_mode !== "dark_component" || result.boundary.length < 8) return result;
  const sourceGeometry = boundaryGeometry(result.boundary);
  const resampled = resampleClosedBoundary(result.boundary);
  if (!sourceGeometry || resampled.length < 8) return result;
  let smoothed = resampled;
  for (let pass = 0; pass < 5; pass += 1) {
    smoothed = smoothed.map((point, index, source) => {
      const previous = source[(index - 1 + source.length) % source.length];
      const next = source[(index + 1) % source.length];
      return {
        x: previous.x * 0.25 + point.x * 0.5 + next.x * 0.25,
        y: previous.y * 0.25 + point.y * 0.5 + next.y * 0.25,
      };
    });
  }
  const smoothGeometry = boundaryGeometry(smoothed);
  if (!smoothGeometry) return result;
  const areaScale = Math.sqrt(sourceGeometry.area / Math.max(1e-6, smoothGeometry.area));
  const boundary = smoothed.map((point) => ({
    x: sourceGeometry.center.x + (point.x - smoothGeometry.center.x) * areaScale,
    y: sourceGeometry.center.y + (point.y - smoothGeometry.center.y) * areaScale,
  }));
  const finalGeometry = boundaryGeometry(boundary);
  if (!finalGeometry || __controlledMarkerForTests.boundarySelfIntersects(boundary)) return result;
  const equivalentRadius = Math.sqrt(sourceGeometry.area / Math.PI);
  const displacements = boundary.map((point) => boundaryDistance(point, result.boundary));
  const maximumDisplacementRatio = Math.max(...displacements) / Math.max(1, equivalentRadius);
  const areaRatio = finalGeometry.area / sourceGeometry.area;
  if (areaRatio < 0.97 || areaRatio > 1.03 || maximumDisplacementRatio > 0.22) return result;
  return {
    ...result,
    boundary,
    center: finalGeometry.center,
    area_px: Math.round(finalGeometry.area),
    bbox: finalGeometry.bbox,
    warnings: [...new Set([...result.warnings, "solid_boundary_periodic_regularized"])],
    diagnostics: {
      ...(result.diagnostics || {}),
      solid_boundary_regularization: "periodic_constrained",
      solid_boundary_area_ratio: Number(areaRatio.toFixed(3)),
      solid_boundary_max_displacement_ratio: Number(maximumDisplacementRatio.toFixed(3)),
    },
  };
}

function recoverSolidComponentNearSeed(
  image: MarkerImageData,
  seed: MarkerPoint,
  witness: ControlledMarkerDetection,
  options: ControlledMarkerOptions,
): ControlledMarkerDetection | null {
  const width = Math.floor(image.width);
  const height = Math.floor(image.height);
  const roiRadius = clamp(Math.round(options.roiRadius ?? fallbackRoiRadius(image)), 1, Math.max(width, height));
  const scanDiameterMm = Number(options.scanDiameterMm || 0);
  const pixelsPerMm = scanDiameterMm > 0 ? roiRadius * 2 / scanDiameterMm : 0;
  const minimumDiameterPx = pixelsPerMm > 0 ? MINIMUM_SOLID_DIAMETER_MM * pixelsPerMm * 0.65 : 8;
  const maximumDiameterPx = Math.min(roiRadius * 1.35, pixelsPerMm > 0 ? pixelsPerMm * 9 : roiRadius * 1.35);
  const x0 = clamp(Math.floor(seed.x - roiRadius), 0, width - 1);
  const y0 = clamp(Math.floor(seed.y - roiRadius), 0, height - 1);
  const x1 = clamp(Math.ceil(seed.x + roiRadius), 0, width - 1);
  const y1 = clamp(Math.ceil(seed.y + roiRadius), 0, height - 1);
  const localWidth = x1 - x0 + 1;
  const localHeight = y1 - y0 + 1;
  const lumas = new Float32Array(localWidth * localHeight);
  const roiLumas: number[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if ((x - seed.x) ** 2 + (y - seed.y) ** 2 > roiRadius ** 2) continue;
      const index = (y * width + x) * 4;
      const value = 0.2126 * Number(image.data[index])
        + 0.7152 * Number(image.data[index + 1])
        + 0.0722 * Number(image.data[index + 2]);
      lumas[(y - y0) * localWidth + x - x0] = value;
      roiLumas.push(value);
    }
  }
  if (roiLumas.length < 32) return null;
  const backgroundLuma = percentile(roiLumas, 0.70);
  const candidates: Array<{
    pixels: MarkerPoint[];
    boundary: MarkerPoint[];
    score: number;
    fill: number;
    contrast: number;
    coreDarkRatio: number;
    coreMeanLuma: number;
  }> = [];
  const thresholdCandidates = [...new Set([
    otsuThreshold(roiLumas),
    Math.round(percentile(roiLumas, 0.08)),
    Math.round(percentile(roiLumas, 0.12)),
    Math.round(percentile(roiLumas, 0.18)),
    Math.round(percentile(roiLumas, 0.25)),
    Math.round(backgroundLuma - Math.max(8, backgroundLuma * 0.16)),
  ].map((value) => clamp(value, 0, 255)))].sort((left, right) => left - right);
  for (const threshold of thresholdCandidates) {
    const dark = new Uint8Array(localWidth * localHeight);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if ((x - seed.x) ** 2 + (y - seed.y) ** 2 > roiRadius ** 2) continue;
        const local = (y - y0) * localWidth + x - x0;
        dark[local] = Number(lumas[local] <= threshold);
      }
    }
    const visited = new Uint8Array(dark.length);
    for (let start = 0; start < dark.length; start += 1) {
      if (!dark[start] || visited[start]) continue;
      const queue = [start];
      const pixels: MarkerPoint[] = [];
      visited[start] = 1;
      for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head];
        const cx = current % localWidth;
        const cy = Math.floor(current / localWidth);
        pixels.push({ x: x0 + cx, y: y0 + cy });
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= localWidth || ny < 0 || ny >= localHeight) continue;
            const next = ny * localWidth + nx;
            if (dark[next] && !visited[next]) {
              visited[next] = 1;
              queue.push(next);
            }
          }
        }
      }
      if (pixels.length < 12) continue;
      const boundary = __controlledMarkerForTests.componentOuterBoundary(pixels);
      const geometry = boundaryGeometry(boundary);
      if (!geometry || boundary.length < 8) continue;
      const diameter = Math.max(geometry.bbox.width, geometry.bbox.height);
      const aspectRatio = Math.min(geometry.bbox.width, geometry.bbox.height) / Math.max(1, diameter);
      const fill = pixels.length / Math.max(1, geometry.bbox.width * geometry.bbox.height);
      const compactness = boundaryCompactness(boundary);
      const distance = pixels.reduce((closest, point) => Math.min(closest, Math.hypot(point.x - seed.x, point.y - seed.y)), Infinity);
      const meanLuma = pixels.reduce((sum, point) => sum + lumas[(point.y - y0) * localWidth + point.x - x0], 0) / pixels.length;
      const contrast = backgroundLuma - meanLuma;
      const coreRadius = Math.min(geometry.bbox.width, geometry.bbox.height) * 0.24;
      const coreLumas: number[] = [];
      for (let y = Math.floor(geometry.center.y - coreRadius); y <= Math.ceil(geometry.center.y + coreRadius); y += 1) {
        for (let x = Math.floor(geometry.center.x - coreRadius); x <= Math.ceil(geometry.center.x + coreRadius); x += 1) {
          if (x < x0 || x > x1 || y < y0 || y > y1
            || Math.hypot(x - geometry.center.x, y - geometry.center.y) > coreRadius) continue;
          coreLumas.push(lumas[(y - y0) * localWidth + x - x0]);
        }
      }
      const coreDarkRatio = coreLumas.filter((value) => value <= threshold).length / Math.max(1, coreLumas.length);
      const coreMeanLuma = coreLumas.reduce((sum, value) => sum + value, 0) / Math.max(1, coreLumas.length);
      if (diameter < minimumDiameterPx || diameter > maximumDiameterPx || aspectRatio < 0.55
        || fill < 0.30 || compactness < 0.35 || contrast < Math.max(6, backgroundLuma * 0.08)
        // A pen ring can produce a dense dark connected component, but its
        // central disk remains skin-coloured. A filled lesion must therefore
        // keep at least half of its central disk on the selected dark side.
        || coreDarkRatio < 0.50
        || distance > Math.max(5, diameter * 0.55)) continue;
      const requestedCenterDistance = Math.hypot(geometry.center.x - seed.x, geometry.center.y - seed.y);
      const score = requestedCenterDistance * 2 + distance * 2 + Math.abs(1 - aspectRatio) * 24
        + Math.max(0, 0.62 - fill) * 24 + Math.abs(diameter - minimumDiameterPx * 1.45) * 0.25
        - contrast * 0.25 - Math.min(pixels.length, 700) * 0.015;
      candidates.push({ pixels, boundary, score, fill, contrast, coreDarkRatio, coreMeanLuma });
    }
  }
  const selected = candidates.sort((left, right) => left.score - right.score)[0];
  if (!selected) return null;
  const boundary = selected.boundary;
  const geometry = boundaryGeometry(boundary);
  if (!geometry) return null;
  return regularizeSolidBoundary({
    ...witness,
    ok: true,
    failure_code: null,
    center: geometry.center,
    boundary,
    area_px: Math.round(geometry.area),
    bbox: geometry.bbox,
    geometry_mode: "dark_component",
    seed_relation: boundaryContains(seed, boundary) ? "enclosed" : "on_marker",
    marker_area_px: selected.pixels.length,
    marker_bbox: geometry.bbox,
    confidence: clamp(selected.contrast / Math.max(24, backgroundLuma * 0.35), 0, 1),
    warnings: [...new Set([
      ...witness.warnings,
      "solid_component_outer_boundary_recovered",
      "solid_component_local_background_recovered",
    ])],
    diagnostics: {
      ...(witness.diagnostics || {}),
      solid_background_luma: Number(backgroundLuma.toFixed(2)),
      solid_threshold_luma: Number((backgroundLuma - selected.contrast).toFixed(2)),
      solid_component_fill_ratio: Number(selected.fill.toFixed(3)),
      solid_component_contrast: Number(selected.contrast.toFixed(2)),
      solid_component_core_dark_ratio: Number(selected.coreDarkRatio.toFixed(3)),
      solid_component_core_mean_luma: Number(selected.coreMeanLuma.toFixed(2)),
    },
  });
}

interface SupportedNarrowSpurTrial {
  boundary: MarkerPoint[];
  indices: number[];
  areaRatio: number;
  compactnessGain: number;
  maximumDisplacementRatio: number;
  replacementSupport: { p20: number; supportRatio: number };
}

function trimSupportedNarrowBoundarySpur(
  result: ControlledMarkerDetection,
  evidenceImage: MarkerImageData,
): ControlledMarkerDetection {
  if (!result.ok || !result.center || !result.bbox || result.geometry_mode !== "enclosed_region"
    || result.boundary.length < 24 || result.diagnostics?.boundary_smoothing !== "periodic_constrained"
    || result.boundary.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return result;
  }
  const geometry = boundaryGeometry(result.boundary);
  if (!geometry) return result;
  const equivalentRadius = Math.sqrt(geometry.area / Math.PI);
  const minimumDisplacement = Math.max(1.25, equivalentRadius * 0.10);
  const minimumPeakDisplacement = Math.max(2.5, equivalentRadius * 0.21);
  const maximumInteriorPoints = Math.max(2, Math.floor(result.boundary.length * 0.10));
  const winding = result.boundary.reduce((sum, point, index) => {
    const next = result.boundary[(index + 1) % result.boundary.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) >= 0 ? 1 : -1;
  const polar = (point: MarkerPoint) => ({
    angle: Math.atan2(point.y - geometry.center.y, point.x - geometry.center.x),
    radius: Math.hypot(point.x - geometry.center.x, point.y - geometry.center.y),
  });
  const trials: SupportedNarrowSpurTrial[] = [];
  for (let interiorCount = 2; interiorCount <= maximumInteriorPoints; interiorCount += 1) {
    for (let start = 0; start < result.boundary.length; start += 1) {
      const indices = Array.from({ length: interiorCount }, (_, offset) => (
        (start + offset + 1) % result.boundary.length
      ));
      const end = (start + interiorCount + 1) % result.boundary.length;
      const sequence = [start, ...indices, end].map((index) => polar(result.boundary[index]));
      const angles = [sequence[0].angle];
      let monotonic = true;
      for (let index = 1; index < sequence.length; index += 1) {
        let delta = sequence[index].angle - sequence[index - 1].angle;
        while (delta <= -Math.PI) delta += Math.PI * 2;
        while (delta > Math.PI) delta -= Math.PI * 2;
        if (delta * winding <= 0 || Math.abs(delta) > Math.PI / 3) monotonic = false;
        angles.push(angles[index - 1] + delta);
      }
      const totalAngle = angles[angles.length - 1] - angles[0];
      if (!monotonic || totalAngle * winding <= 0 || Math.abs(totalAngle) > Math.PI * 0.45) continue;
      const boundary = result.boundary.map((point) => ({ ...point }));
      const displacements: number[] = [];
      for (let offset = 0; offset < interiorCount; offset += 1) {
        const sequenceIndex = offset + 1;
        const t = (angles[sequenceIndex] - angles[0]) / totalAngle;
        const radius = sequence[0].radius + (sequence[sequence.length - 1].radius - sequence[0].radius) * t;
        const displacement = sequence[sequenceIndex].radius - radius;
        displacements.push(displacement);
        boundary[indices[offset]] = {
          x: geometry.center.x + Math.cos(angles[sequenceIndex]) * radius,
          y: geometry.center.y + Math.sin(angles[sequenceIndex]) * radius,
        };
      }
      if (Math.min(...displacements) < minimumDisplacement
        || Math.max(...displacements) < minimumPeakDisplacement
        || !isSimpleBoundary(boundary, evidenceImage)) continue;
      const updatedGeometry = boundaryGeometry(boundary);
      if (!updatedGeometry) continue;
      const areaRatio = updatedGeometry.area / geometry.area;
      const compactnessGain = boundaryCompactness(boundary) - boundaryCompactness(result.boundary);
      const replacementSupport = boundaryColorSupport(evidenceImage, indices.map((index) => boundary[index]));
      if (areaRatio < 0.97 || areaRatio > 1
        || compactnessGain < 0.03
        || Math.max(...displacements) / equivalentRadius > 0.30
        || replacementSupport.p20 < 45 || replacementSupport.supportRatio < 0.80) continue;
      trials.push({
        boundary,
        indices,
        areaRatio,
        compactnessGain,
        maximumDisplacementRatio: Math.max(...displacements) / equivalentRadius,
        replacementSupport,
      });
    }
    if (trials.length) break;
  }
  if (!trials.length) return result;
  const best = [...trials].sort((left, right) => right.compactnessGain - left.compactnessGain)[0];
  const bestIndices = new Set(best.indices);
  if (trials.some((trial) => !trial.indices.some((index) => bestIndices.has(index)))) return result;
  const updatedGeometry = boundaryGeometry(best.boundary);
  if (!updatedGeometry) return result;
  return {
    ...result,
    center: updatedGeometry.center,
    boundary: best.boundary,
    area_px: Math.round(updatedGeometry.area),
    bbox: updatedGeometry.bbox,
    warnings: [...new Set([...result.warnings, "boundary_supported_narrow_spur_trimmed"])],
    diagnostics: {
      ...(result.diagnostics || {}),
      boundary_regularization: "supported_radial_bridge",
      boundary_regularization_area_ratio: Number(best.areaRatio.toFixed(3)),
      boundary_regularization_p90_displacement_ratio: Number(best.maximumDisplacementRatio.toFixed(3)),
      boundary_regularization_max_displacement_ratio: Number(best.maximumDisplacementRatio.toFixed(3)),
      boundary_regularization_arc_fraction: Number((best.indices.length / result.boundary.length).toFixed(3)),
      boundary_regularization_replacement_support_ratio: Number(best.replacementSupport.supportRatio.toFixed(3)),
      boundary_regularization_replacement_support_p20: best.replacementSupport.p20,
    },
  };
}

function reconcileDenoisedStrokeEnvelope(
  result: ControlledMarkerDetection,
  seed: MarkerPoint,
  requestedExpectedDiameter: number,
  evidenceImage: MarkerImageData,
  roiRadius: number,
): ControlledMarkerDetection {
  const initialGate = candidateGate(
    result,
    seed,
    requestedExpectedDiameter,
    evidenceImage,
    roiRadius,
  );
  if (!result.ok || !result.center || !result.bbox || !result.marker_bbox
    || result.geometry_mode !== "enclosed_region" || result.boundary.length < 8
    || initialGate.reasons.length !== 1 || initialGate.reasons[0] !== "candidate_not_compact") {
    return result;
  }
  const diagnostics = result.diagnostics;
  const probeSuccesses = Number(diagnostics?.scan_probe_success_count || 0);
  const probeConsensus = Number(diagnostics?.scan_probe_consensus_count || 0);
  if (diagnostics?.boundary_smoothing !== "periodic_constrained"
    || Number(diagnostics.shape_compactness) < 0.45
    || Number(diagnostics.boundary_smoothing_area_ratio) > 1.13
    || Number(diagnostics.boundary_smoothing_outside_ratio) > 0.18
    || Number(diagnostics.boundary_smoothing_max_miss_ratio) > 0.08
    || Number(diagnostics.boundary_support_ratio) < 0.95
    || Number(diagnostics.repair_fraction) > 0.05
    || probeSuccesses < 8
    || probeConsensus / Math.max(1, probeSuccesses) < 0.75) {
    return result;
  }

  const trimmed = trimSupportedNarrowBoundarySpur(result, evidenceImage);
  if (trimmed !== result
    && candidateGate(trimmed, seed, requestedExpectedDiameter, evidenceImage, roiRadius).valid) {
    return trimmed;
  }

  const sourceGeometry = boundaryGeometry(result.boundary);
  if (!sourceGeometry) return result;
  const padding = clamp(requestedExpectedDiameter * 0.015, 0.75, 1.5);
  const markerBbox = result.marker_bbox;
  const targetLeft = markerBbox.x - padding;
  const targetTop = markerBbox.y - padding;
  const targetRight = markerBbox.x + markerBbox.width - 1 + padding;
  const targetBottom = markerBbox.y + markerBbox.height - 1 + padding;
  const targetCenter = {
    x: (targetLeft + targetRight) / 2,
    y: (targetTop + targetBottom) / 2,
  };
  const sourceLeft = Math.max(sourceGeometry.center.x - sourceGeometry.bbox.x, 1e-6);
  const sourceRight = Math.max(
    sourceGeometry.bbox.x + sourceGeometry.bbox.width - sourceGeometry.center.x,
    1e-6,
  );
  const sourceTop = Math.max(sourceGeometry.center.y - sourceGeometry.bbox.y, 1e-6);
  const sourceBottom = Math.max(
    sourceGeometry.bbox.y + sourceGeometry.bbox.height - sourceGeometry.center.y,
    1e-6,
  );
  const scaleX = Math.max(
    1,
    (targetCenter.x - targetLeft) / sourceLeft,
    (targetRight - targetCenter.x) / sourceRight,
  );
  const scaleY = Math.max(
    1,
    (targetCenter.y - targetTop) / sourceTop,
    (targetBottom - targetCenter.y) / sourceBottom,
  );
  if (scaleX > 1.14 || scaleY > 1.14) return result;

  const boundary = result.boundary.map((point) => ({
    x: targetCenter.x + (point.x - sourceGeometry.center.x) * scaleX,
    y: targetCenter.y + (point.y - sourceGeometry.center.y) * scaleY,
  }));
  if (boundary.some((point) => (
    point.x < 0 || point.x >= evidenceImage.width || point.y < 0 || point.y >= evidenceImage.height
      || Math.hypot(point.x - seed.x, point.y - seed.y) > roiRadius - 1
  ))) return result;
  const geometry = boundaryGeometry(boundary);
  if (!geometry || geometry.area / sourceGeometry.area > 1.30) return result;

  return {
    ...result,
    center: geometry.center,
    boundary,
    area_px: Math.round(geometry.area),
    bbox: geometry.bbox,
    diagnostics: {
      ...(diagnostics || {}),
      boundary_stroke_reconciliation: "normal_stroke_band",
      boundary_stroke_scale: Number(Math.max(scaleX, scaleY).toFixed(3)),
      boundary_stroke_scale_x: Number(scaleX.toFixed(3)),
      boundary_stroke_scale_y: Number(scaleY.toFixed(3)),
      boundary_stroke_area_ratio: Number((geometry.area / sourceGeometry.area).toFixed(3)),
      boundary_stroke_center_shift_ratio: Number((Math.hypot(
        geometry.center.x - result.center.x,
        geometry.center.y - result.center.y,
      ) / Math.max(1, Math.sqrt(sourceGeometry.area / Math.PI))).toFixed(3)),
    },
  };
}

function boundaryColorSupport(
  evidenceImage: MarkerImageData,
  boundary: MarkerPoint[],
): { p20: number; supportRatio: number } {
  if (!boundary.length) return { p20: 0, supportRatio: 0 };
  const samples = boundary.map((point) => {
    let maximum = 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = clamp(Math.round(point.x) + dx, 0, evidenceImage.width - 1);
        const y = clamp(Math.round(point.y) + dy, 0, evidenceImage.height - 1);
        const index = (y * evidenceImage.width + x) * 4;
        maximum = Math.max(maximum, 255 - Number(evidenceImage.data[index]));
      }
    }
    return maximum;
  }).sort((left, right) => left - right);
  return {
    p20: samples[Math.floor(samples.length * 0.2)] ?? 0,
    supportRatio: samples.filter((value) => value >= 50).length / samples.length,
  };
}

function candidateGate(
  result: ControlledMarkerDetection,
  seed: MarkerPoint,
  requestedExpectedDiameter: number,
  evidenceImage: MarkerImageData,
  roiRadius: number,
  scanDiameterMm = 0,
): CandidateGate {
  const reasons: string[] = [];
  if (!result.ok || !result.center || !result.bbox || result.boundary.length < 3
    || !["enclosed_region", "dark_component"].includes(result.geometry_mode || "")) {
    return { valid: false, reasons: ["not_supported_boundary"] };
  }
  const detectedDiameter = Math.max(result.bbox.width, result.bbox.height);
  const aspectRatio = Math.min(result.bbox.width, result.bbox.height) / Math.max(1, detectedDiameter);
  const compactness = candidateShapeCompactness(result);
  const requestedRatio = requestedExpectedDiameter > 0
    ? detectedDiameter / requestedExpectedDiameter
    : 1;
  const colorSupport = boundaryColorSupport(evidenceImage, result.boundary);

  // A one-pixel hole or speck can look perfectly compact and dark, but it is
  // not a usable lesion boundary. Reject raster-degenerate geometry before it
  // can outrank the already detected enclosing dark component.
  if (result.bbox.width < 3 || result.bbox.height < 3 || result.area_px < 4) {
    reasons.push("candidate_geometry_degenerate");
  }
  const pixelsPerMm = scanDiameterMm > 0 ? roiRadius * 2 / scanDiameterMm : 0;
  const minimumPhysicalDiameterPx = pixelsPerMm * MINIMUM_SOLID_DIAMETER_MM * 0.65;
  if (result.geometry_mode === "dark_component" && minimumPhysicalDiameterPx > 0
    && (detectedDiameter < minimumPhysicalDiameterPx
      || result.area_px < Math.PI * (minimumPhysicalDiameterPx / 2) ** 2 * 0.35)) {
    reasons.push("candidate_below_minimum_physical_size");
  }
  if (aspectRatio < 0.52) reasons.push("candidate_too_elongated");
  if (compactness < 0.55) reasons.push("candidate_not_compact");
  // The pointer selects a scan surface; it is not the lesion's geometric
  // centre. Keep the spatial safety boundary, but express it as the product
  // contract actually shown to the operator: the emitted outline must remain
  // fully covered by the original scan circle. One pixel covers raster and
  // smoothing quantisation at the circle edge.
  if (result.boundary.some((point) => (
    Math.hypot(point.x - seed.x, point.y - seed.y) > roiRadius + 1
  ))) reasons.push("candidate_outside_scan_roi");
  if (requestedExpectedDiameter > 0 && (requestedRatio < MINIMUM_REQUESTED_DIAMETER_RATIO
    || requestedRatio > MAXIMUM_REQUESTED_DIAMETER_RATIO)) {
    reasons.push("candidate_size_mismatch");
  }
  if (result.geometry_mode === "enclosed_region"
    && (colorSupport.p20 < 45 || colorSupport.supportRatio < 0.65)) {
    reasons.push("candidate_color_ring_incomplete");
  }
  return { valid: reasons.length === 0, reasons };
}

function trialOptions(
  options: ControlledMarkerOptions,
  requestedExpectedDiameter: number,
  scale: number,
): ControlledMarkerOptions {
  return {
    ...options,
    expectedDiameterPx: Math.max(1, requestedExpectedDiameter * scale),
  };
}

function boundaryDistance(point: MarkerPoint, polygon: MarkerPoint[]): number {
  let minimum = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy)
      / (dx * dx + dy * dy || 1), 0, 1);
    minimum = Math.min(minimum, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return minimum;
}

function boundaryContains(point: MarkerPoint, polygon: MarkerPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function isSimpleBoundary(polygon: MarkerPoint[], image: MarkerImageData): boolean {
  if (polygon.length < 3 || polygon.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || p.x < 0 || p.y < 0 || p.x >= image.width || p.y >= image.height)
    || !boundaryGeometry(polygon)) return false;
  const cross = (a: MarkerPoint, b: MarkerPoint, c: MarkerPoint) => (
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  );
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-8) return false;
    for (let j = i + 2; j < polygon.length; j += 1) {
      if (i === 0 && j === polygon.length - 1) continue;
      const c = polygon[j];
      const d = polygon[(j + 1) % polygon.length];
      if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)
        || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) continue;
      if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return false;
    }
  }
  return true;
}

function sampleBoundaryByLength(polygon: MarkerPoint[]): MarkerPoint[] {
  const lengths = polygon.map((p, i) => (
    Math.hypot(p.x - polygon[(i + 1) % polygon.length].x, p.y - polygon[(i + 1) % polygon.length].y)
  ));
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  const count = Math.ceil(perimeter);
  const points: MarkerPoint[] = [];
  let segment = 0;
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const distance = index * perimeter / count;
    while (segment < polygon.length - 1 && offset + lengths[segment] < distance) {
      offset += lengths[segment++];
    }
    const a = polygon[segment];
    const b = polygon[(segment + 1) % polygon.length];
    const t = (distance - offset) / lengths[segment];
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return points;
}

function singleChangedArc(points: MarkerPoint[], match: (point: MarkerPoint) => boolean): MarkerPoint[] | null {
  const selected = points.map(match);
  const starts = selected.flatMap((yes, i) => (
    yes && !selected[(i + selected.length - 1) % selected.length] ? [i] : []
  ));
  // No shared arc, no change, or multiple changes cannot establish one missing segment.
  if (starts.length !== 1) return null;
  const arc: MarkerPoint[] = [];
  for (let offset = 0; offset < points.length && selected[(starts[0] + offset) % points.length]; offset += 1) {
    arc.push(points[(starts[0] + offset) % points.length]);
  }
  return arc.length >= 5 ? arc : null;
}

function compareAcceptedCandidateCompleteness(
  current: MarkerPoint[],
  candidate: MarkerPoint[],
  evidenceImage: MarkerImageData,
): { preferCandidate: boolean; reason: string } {
  const keep = (reason: string) => ({ preferCandidate: false, reason });
  if (!isSimpleBoundary(current, evidenceImage) || !isSimpleBoundary(candidate, evidenceImage)) {
    return keep("invalid_geometry");
  }
  const newArc = singleChangedArc(sampleBoundaryByLength(candidate), (p) => (
    !boundaryContains(p, current) && boundaryDistance(p, current) > 2
  ));
  const oldArc = singleChangedArc(sampleBoundaryByLength(current), (p) => (
    boundaryContains(p, candidate) && boundaryDistance(p, candidate) > 2
  ));
  if (!newArc || !oldArc) return keep("no_single_missing_arc");
  const distance = (a: MarkerPoint, b: MarkerPoint) => Math.hypot(a.x - b.x, a.y - b.y);
  const a = newArc[0];
  const b = newArc[newArc.length - 1];
  const c = oldArc[0];
  const d = oldArc[oldArc.length - 1];
  if (Math.min(Math.max(distance(a, c), distance(b, d)), Math.max(distance(a, d), distance(b, c))) > 4) {
    return keep("arc_endpoints_disagree");
  }
  // Compare like-for-like pixel centres. The tolerance never expands the emitted outline.
  const geometry = boundaryGeometry(current)!;
  for (let y = Math.floor(geometry.bbox.y); y <= Math.ceil(geometry.bbox.y + geometry.bbox.height); y += 1) {
    for (let x = Math.floor(geometry.bbox.x); x <= Math.ceil(geometry.bbox.x + geometry.bbox.width); x += 1) {
      const p = { x: x + 0.5, y: y + 0.5 };
      if (boundaryContains(p, current) && !boundaryContains(p, candidate)
        && boundaryDistance(p, candidate) > 2) return keep("current_region_lost");
    }
  }
  const oldSupport = boundaryColorSupport(evidenceImage, oldArc);
  const newSupport = boundaryColorSupport(evidenceImage, newArc);
  if (newSupport.p20 < 45 || newSupport.supportRatio < 0.65
    || newSupport.supportRatio < oldSupport.supportRatio || newSupport.p20 < oldSupport.p20 + 1) {
    return keep("missing_arc_not_better_supported");
  }
  return { preferCandidate: true, reason: "supported_missing_arc" };
}

function shouldPreferExpandedStrokeBoundary(
  current: ControlledMarkerDetection,
  expanded: ControlledMarkerDetection,
): boolean {
  if (!current.bbox || !expanded.bbox) return false;
  const currentReconciliation = current.diagnostics?.boundary_stroke_reconciliation;
  const expandedReconciliation = expanded.diagnostics?.boundary_stroke_reconciliation;
  if (currentReconciliation || typeof expandedReconciliation !== "string") return false;
  const currentDiameter = Math.max(current.bbox.width, current.bbox.height);
  const expandedDiameter = Math.max(expanded.bbox.width, expanded.bbox.height);
  const growthRatio = expandedDiameter / Math.max(1, currentDiameter);
  return growthRatio >= 1.04 && growthRatio <= 1.30;
}

function acceptRecovered(
  result: ControlledMarkerDetection,
  warnings: string[],
): ControlledMarkerDetection {
  result.warnings = [...new Set([...result.warnings, ...warnings])];
  return result;
}

// Last-resort repair of a shallow inward pocket. Every added arc must still
// follow dark pixels; deep concavity, ambiguity and scan limits remain blocked.
function repairSupportedInwardPocket(
  result: ControlledMarkerDetection,
  evidence: MarkerImageData,
): ControlledMarkerDetection | null {
  if (!result.ok || result.geometry_mode !== "enclosed_region" || result.boundary.length < 8) return null;
  const original = boundaryGeometry(result.boundary);
  if (!original || original.area < 30 || !isSimpleBoundary(result.boundary, evidence)) return null;
  const sorted = [...result.boundary].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: MarkerPoint, b: MarkerPoint, c: MarkerPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (points: MarkerPoint[]) => {
    const hull: MarkerPoint[] = [];
    for (const p of points) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  const geometry = boundaryGeometry(hull);
  if (!geometry || hull.length < 8) return null;
  const ratio = geometry.area / original.area;
  const radius = Math.sqrt(original.area / Math.PI);
  const samples = sampleBoundaryByLength(hull);
  const distances = samples.map(p => boundaryDistance(p, result.boundary));
  const added = samples.filter((_, i) => distances[i] > 0.75);
  if (ratio <= 1.002 || ratio > 1.15 || added.length / samples.length > 0.25
    || Math.max(...distances) > radius * 0.30
    || Math.max(...result.boundary.map(p => boundaryDistance(p, hull))) > radius * 0.30
    || Math.hypot(geometry.center.x - original.center.x, geometry.center.y - original.center.y) > radius * 0.10
    || boundaryCompactness(hull) < 0.75 || !added.length) return null;
  const support = boundaryColorSupport(evidence, added);
  if (support.p20 < 50 || support.supportRatio < 0.90) return null;
  return {
    ...result, boundary: samples, center: geometry.center, bbox: geometry.bbox, area_px: geometry.area,
    warnings: [...result.warnings, "supported_inward_pocket_repaired"],
    diagnostics: { ...result.diagnostics, shape_compactness: boundaryCompactness(samples),
      inward_pocket_area_ratio: ratio, inward_pocket_added_arc_ratio: added.length / samples.length,
      inward_pocket_support_ratio: support.supportRatio },
  };
}

function rejectCandidate(
  result: ControlledMarkerDetection,
  legacyFailure: string | null,
  reasons: string[],
): ControlledMarkerDetection {
  return {
    ...result,
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
    ...(result.boundary.length >= 3 && result.bbox ? {
      rejected_boundary: result.boundary.map((point) => ({ ...point })),
      rejected_geometry_mode: result.geometry_mode,
      rejected_reasons: [...new Set(reasons)],
    } : {}),
    warnings: [...new Set([
      ...result.warnings,
      "color_difference_candidate_rejected",
      ...reasons,
      `legacy_failure:${legacyFailure || "invalid_candidate"}`,
    ])],
  };
}

function detectControlledMarkerInternal(
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions,
  allowCandidateCenterRetry: boolean,
  allowAcceptedCandidateComparison = false,
): ControlledMarkerDetection {
  const legacyOptions = {
    ...options,
    acceptBoundaryWithinFullScan: true,
  };
  const legacy = detectWithLegacyCore(image, seed, legacyOptions) as unknown as ControlledMarkerDetection;
  if (legacy.failure_code === "invalid_image" || legacy.failure_code === "seed_outside_image") {
    return legacy;
  }
  const evidenceImage = colorDifferenceEvidenceImage(image, seed, options);
  const roiRadius = clamp(
    Math.round(options.roiRadius ?? fallbackRoiRadius(image)),
    1,
    Math.max(image.width, image.height),
  );
  const configuredExpectedDiameter = Number(options.expectedDiameterPx || 0);
  const requestedExpectedDiameter = Number.isFinite(configuredExpectedDiameter)
    && configuredExpectedDiameter > 0
    ? configuredExpectedDiameter
    : 0;
  const legacyGate = candidateGate(
    legacy,
    seed,
    requestedExpectedDiameter,
    evidenceImage,
    roiRadius,
    Number(options.scanDiameterMm || 0),
  );
  if (!legacyGate.valid) {
    const solid = recoverSolidComponentNearSeed(image, seed, legacy, options);
    if (solid && candidateGate(solid, seed, requestedExpectedDiameter, evidenceImage, roiRadius, Number(options.scanDiameterMm || 0)).valid) {
      return acceptRecovered(solid, ["color_difference_solid_component_recovered"]);
    }
    if (allowCandidateCenterRetry) {
      const step = clamp(Math.round(roiRadius * 0.28), 6, 12);
      const nearbySeeds: MarkerPoint[] = [
        { x: seed.x + step, y: seed.y }, { x: seed.x - step, y: seed.y },
        { x: seed.x, y: seed.y + step }, { x: seed.x, y: seed.y - step },
        { x: seed.x + step, y: seed.y + step }, { x: seed.x - step, y: seed.y - step },
        { x: seed.x + step, y: seed.y - step }, { x: seed.x - step, y: seed.y + step },
      ];
      for (const nearbySeed of nearbySeeds) {
        if (nearbySeed.x < 0 || nearbySeed.x >= image.width || nearbySeed.y < 0 || nearbySeed.y >= image.height) continue;
        const nearbySolid = recoverSolidComponentNearSeed(image, nearbySeed, legacy, options);
        if (!nearbySolid?.center || !nearbySolid.bbox
          || Math.hypot(nearbySolid.center.x - seed.x, nearbySolid.center.y - seed.y) > roiRadius * 0.70) continue;
        const nearbyGate = candidateGate(
          nearbySolid,
          seed,
          requestedExpectedDiameter,
          evidenceImage,
          roiRadius,
          Number(options.scanDiameterMm || 0),
        );
        if (nearbyGate.valid) {
          return acceptRecovered(nearbySolid, [
            "color_difference_solid_component_recovered",
            "solid_component_nearby_seed_recovered",
          ]);
        }
      }
    }
  }
  if (legacyGate.valid) {
    if (!allowAcceptedCandidateComparison) return legacy;
    try {
      // One original-scale comparison only. Never enter scale/denoise/retry recovery here.
      const alternative = detectWithLegacyCore(evidenceImage, seed, legacyOptions) as unknown as ControlledMarkerDetection;
      if (candidateGate(alternative, seed, requestedExpectedDiameter, evidenceImage, roiRadius, Number(options.scanDiameterMm || 0)).valid
        && compareAcceptedCandidateCompleteness(legacy.boundary, alternative.boundary, evidenceImage).preferCandidate
        && candidateGate(alternative, seed, requestedExpectedDiameter, evidenceImage, roiRadius, Number(options.scanDiameterMm || 0)).valid) {
        return acceptRecovered(alternative, ["color_difference_completeness_recovered"]);
      }
    } catch {
      // The existing valid result remains usable if this optional comparison fails.
      console.warn("[LangerFace] accepted-candidate comparison failed; retaining original candidate");
    }
    return legacy;
  }

  const colorAtRequested = detectWithLegacyCore(
    evidenceImage,
    seed,
    legacyOptions,
  ) as unknown as ControlledMarkerDetection;
  const colorRequestedGate = candidateGate(
    colorAtRequested,
    seed,
    requestedExpectedDiameter,
    evidenceImage,
    roiRadius,
    Number(options.scanDiameterMm || 0),
  );
  if (colorRequestedGate.valid) {
    if (requestedExpectedDiameter > 0) {
      let preferredExpandedColor: ControlledMarkerDetection | null = null;
      let preferredExpandedArea = 0;
      for (const scale of STROKE_RECONCILIATION_SCALES) {
        const expandedColor = detectWithLegacyCore(
          evidenceImage,
          seed,
          trialOptions(legacyOptions, requestedExpectedDiameter, scale),
        ) as unknown as ControlledMarkerDetection;
        const expandedColorGate = candidateGate(
          expandedColor,
          seed,
          requestedExpectedDiameter,
          evidenceImage,
          roiRadius,
          Number(options.scanDiameterMm || 0),
        );
        if (!expandedColorGate.valid
          || !shouldPreferExpandedStrokeBoundary(colorAtRequested, expandedColor)
          || !expandedColor.bbox) continue;
        const expandedArea = expandedColor.bbox.width * expandedColor.bbox.height;
        if (expandedArea > preferredExpandedArea) {
          preferredExpandedColor = expandedColor;
          preferredExpandedArea = expandedArea;
        }
      }
      if (preferredExpandedColor) {
        return acceptRecovered(preferredExpandedColor, [
          "color_difference_recovered",
          "color_difference_stroke_boundary_recovered",
          `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
        ]);
      }
    }
    return acceptRecovered(colorAtRequested, [
      "color_difference_recovered",
      `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
    ]);
  }

  const rejectedReasons = [...legacyGate.reasons, ...colorRequestedGate.reasons];
  for (const scale of requestedExpectedDiameter > 0 ? [1.2, MAXIMUM_RETRY_SCALE, 0.8] : []) {
    const scaledOptions = trialOptions(legacyOptions, requestedExpectedDiameter, scale);
    const scaledLegacy = detectWithLegacyCore(
      image,
      seed,
      scaledOptions,
    ) as unknown as ControlledMarkerDetection;
    const scaledLegacyGate = candidateGate(
      scaledLegacy,
      seed,
      requestedExpectedDiameter,
      evidenceImage,
      roiRadius,
      Number(options.scanDiameterMm || 0),
    );
    if (scaledLegacyGate.valid) {
      return acceptRecovered(scaledLegacy, [
        "color_difference_scale_recovered",
        `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
      ]);
    }
    rejectedReasons.push(...scaledLegacyGate.reasons);

    const scaledColor = detectWithLegacyCore(
      evidenceImage,
      seed,
      scaledOptions,
    ) as unknown as ControlledMarkerDetection;
    const scaledColorGate = candidateGate(
      scaledColor,
      seed,
      requestedExpectedDiameter,
      evidenceImage,
      roiRadius,
      Number(options.scanDiameterMm || 0),
    );
    if (scaledColorGate.valid) {
      return acceptRecovered(scaledColor, [
        "color_difference_recovered",
        "color_difference_scale_recovered",
        `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
      ]);
    }
    rejectedReasons.push(...scaledColorGate.reasons);
  }

  const denoisedEvidence = denoisedColorDifferenceEvidenceImage(evidenceImage, seed, options);
  let denoisedColor = detectWithLegacyCore(
    denoisedEvidence,
    seed,
    legacyOptions,
  ) as unknown as ControlledMarkerDetection;
  denoisedColor = reconcileDenoisedStrokeEnvelope(
    denoisedColor,
    seed,
    requestedExpectedDiameter,
    evidenceImage,
    roiRadius,
  );
  const denoisedColorGate = candidateGate(
    denoisedColor,
    seed,
    requestedExpectedDiameter,
    evidenceImage,
    roiRadius,
    Number(options.scanDiameterMm || 0),
  );
  if (denoisedColorGate.valid) {
    return acceptRecovered(denoisedColor, [
      "color_difference_recovered",
      "color_difference_denoised_recovered",
      "color_difference_stroke_boundary_recovered",
      `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
    ]);
  }
  const denoisedDiagnostics = denoisedColor.diagnostics;
  const candidateCenterCanBeAnchor = allowCandidateCenterRetry
    && denoisedColor.ok
    && denoisedColor.center
    && denoisedColor.geometry_mode === "enclosed_region"
    && denoisedColorGate.reasons.length === 1
    && denoisedColorGate.reasons[0] === "candidate_not_compact"
    && Number(denoisedDiagnostics?.boundary_support_ratio) >= 0.95
    && Number(denoisedDiagnostics?.repair_fraction) <= 0.05;
  if (candidateCenterCanBeAnchor && denoisedColor.center) {
    const canonical = detectControlledMarkerInternal(
      image,
      denoisedColor.center,
      options,
      false,
    );
    const canonicalGate = candidateGate(
      canonical,
      seed,
      requestedExpectedDiameter,
      evidenceImage,
      roiRadius,
      Number(options.scanDiameterMm || 0),
    );
    if (canonicalGate.valid) {
      return acceptRecovered(canonical, [
        "color_difference_recovered",
        "color_difference_candidate_center_recovered",
        `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
      ]);
    }
    rejectedReasons.push(...canonicalGate.reasons);
  }
  rejectedReasons.push(...denoisedColorGate.reasons);
  for (const raw of [legacy, colorAtRequested, denoisedColor]) {
    const repaired = repairSupportedInwardPocket(raw, evidenceImage);
    if (repaired && candidateGate(repaired, seed, requestedExpectedDiameter, evidenceImage, roiRadius,
      Number(options.scanDiameterMm || 0)).valid) return repaired;
  }
  return rejectCandidate(
    colorAtRequested.ok ? colorAtRequested : legacy,
    legacy.failure_code,
    [...new Set(rejectedReasons)],
  );
}

export function detectControlledMarker(
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions = {},
): ControlledMarkerDetection {
  return detectControlledMarkerInternal(image, seed, options, true, true);
}

export const __controlledMarkerColorForTests = {
  repairSupportedInwardPocket,
  compareAcceptedCandidateCompleteness,
  boundaryColorSupport,
  candidateGate,
  candidateShapeCompactness,
  colorDifferenceEvidenceImage,
  denoisedColorDifferenceEvidenceImage,
  recoverSolidComponentNearSeed,
  reconcileDenoisedStrokeEnvelope,
  trimSupportedNarrowBoundarySpur,
  rgbToLab,
};
