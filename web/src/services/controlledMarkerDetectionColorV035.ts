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
import { CONTROLLED_MARKER_RELEASE } from "./controlledMarkerRelease.ts";

// The stable profile identifies this algorithm family. Each behavior-changing
// iteration receives a new release version and a descriptive release name.
export const CONTROLLED_MARKER_DETECTOR_VERSION = CONTROLLED_MARKER_RELEASE.version;
export const COLOR_DIFFERENCE_BASELINE_VERSION = LEGACY_DETECTOR_VERSION;

interface LabColor {
  l: number;
  a: number;
  b: number;
}

const DENOISED_EVIDENCE_KERNEL = [1, 4, 6, 4, 1] as const;
const DENOISED_EVIDENCE_KERNEL_SUM = 16;
const DENOISED_EVIDENCE_GAIN = 2;
const MIN_STABLE_ANALYSIS_ROI_RADIUS = 36;
const MIN_SOLID_COMPONENT_CORE_DARK_RATIO = 0.70;

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

function localLuma(data: ArrayLike<number>, index: number): number {
  return 0.2126 * Number(data[index]) + 0.7152 * Number(data[index + 1]) + 0.0722 * Number(data[index + 2]);
}

function hollowPolygonGeometry(points: MarkerPoint[]) {
  let twiceArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const cross = point.x * next.y - next.x * point.y;
    twiceArea += cross;
    weightedX += (point.x + next.x) * cross;
    weightedY += (point.y + next.y) * cross;
  }
  const area = Math.abs(twiceArea) / 2;
  if (!(area > 1e-6) || !Number.isFinite(area)) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    area,
    center: { x: weightedX / (3 * twiceArea), y: weightedY / (3 * twiceArea) },
    bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

function hollowPointInPolygon(point: MarkerPoint, polygon: MarkerPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    if ((current.y > point.y) !== (prior.y > point.y)
      && point.x < (prior.x - current.x) * (point.y - current.y) / (prior.y - current.y) + current.x) inside = !inside;
  }
  return inside;
}

function normalizeBrightnessImage(image: MarkerImageData): MarkerImageData {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    sum += Number(image.data[index]) + Number(image.data[index + 1]) + Number(image.data[index + 2]);
    count += 3;
  }
  const mean = sum / Math.max(1, count);
  const gain = 128 / Math.max(1, mean);
  const data = new Uint8ClampedArray(image.data);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = clamp(Math.round(Number(data[index]) * gain), 0, 255);
    data[index + 1] = clamp(Math.round(Number(data[index + 1]) * gain), 0, 255);
    data[index + 2] = clamp(Math.round(Number(data[index + 2]) * gain), 0, 255);
  }
  return { width: image.width, height: image.height, data };
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
// The detector analyses a fixed pixel area. The scan circle is only a
// coverage constraint; it must not rescale the same image object into a
// different candidate class when the operator changes the displayed mm.
const MINIMUM_SOLID_DIAMETER_RATIO = 0.26;
const MAXIMUM_SOLID_DIAMETER_RATIO = 1.35;
// Keep tiny raster pockets from passing as hollow candidates. The bound is
// tied to the fixed analysis radius so changing the scan circle cannot make
// the same speck eligible.
const MINIMUM_ENCLOSED_DIAMETER_RATIO = 0.40;
// A larger displayed scan circle is a coverage contract, not extra evidence
// that a dark component farther from the operator's pointer is the lesion.
// Keep recovery-center selection inside the fixed analysis region so changing
// scan diameter cannot turn a nearby pigment/skin component into a new class.
const MAX_EXPANDED_SCAN_SOLID_CENTER_RATIO = 0.65;
const EXPANDED_SCAN_SOLID_CENTER_GUARD_RATIO = 1.50;

function hasExplicitSolidRecoveryEvidence(result: ControlledMarkerDetection): boolean {
  if (result.geometry_mode !== "dark_component") return true;
  const diagnostics = result.diagnostics || {};
  const coreDarkRatio = Number(diagnostics.solid_component_core_dark_ratio);
  const contrast = Number(diagnostics.solid_component_contrast);
  const fillRatio = Number(diagnostics.solid_component_fill_ratio);
  return Number.isFinite(coreDarkRatio)
    && coreDarkRatio >= MIN_SOLID_COMPONENT_CORE_DARK_RATIO
    && Number.isFinite(contrast)
    && contrast >= 18
    && Number.isFinite(fillRatio)
    && fillRatio >= 0.35
    && fillRatio <= 0.95;
}

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

// 对已经通过候选门禁的紧凑轮廓做有限的低频修正，不参与选肿物。
// 等弧长采样避免像素点疏密决定平滑强度；一、二阶周期分量保留
// 整体位置、长短轴与缓慢形变，去掉局部折角。不是把所有病灶强制画圆：
// 深凹陷、明显不规则形状或双向位移超过等面积半径22%时保留原轮廓。
// 面积保持及后续原扫描/颜色支持门禁仍必需，光滑不代表医学正确。
function regularizeAcceptedBoundary(result: ControlledMarkerDetection): ControlledMarkerDetection {
  if (!result.ok || !["dark_component", "enclosed_region"].includes(result.geometry_mode || "")
    || result.boundary.length < 24
    || result.boundary.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return result;
  const original = boundaryGeometry(result.boundary);
  if (!original || original.area < 30
    || Math.min(original.bbox.width, original.bbox.height) / Math.max(original.bbox.width, original.bbox.height) < 0.62
    || boundaryCompactness(result.boundary) < 0.60) return result;
  const sampled = resampleClosedBoundary(result.boundary, 64);
  const mean = sampled.reduce((sum, point) => ({ x: sum.x + point.x / 64, y: sum.y + point.y / 64 }), { x: 0, y: 0 });
  const coefficients = [1, 2].map((harmonic) => sampled.reduce((sum, point, index) => {
    const angle = 2 * Math.PI * harmonic * index / sampled.length;
    return {
      xc: sum.xc + (point.x - mean.x) * Math.cos(angle) * 2 / sampled.length,
      xs: sum.xs + (point.x - mean.x) * Math.sin(angle) * 2 / sampled.length,
      yc: sum.yc + (point.y - mean.y) * Math.cos(angle) * 2 / sampled.length,
      ys: sum.ys + (point.y - mean.y) * Math.sin(angle) * 2 / sampled.length,
    };
  }, { xc: 0, xs: 0, yc: 0, ys: 0 }));
  const lowFrequency = sampled.map((_, index) => coefficients.reduce((point, c, harmonic) => {
    const angle = 2 * Math.PI * (harmonic + 1) * index / sampled.length;
    return { x: point.x + c.xc * Math.cos(angle) + c.xs * Math.sin(angle),
      y: point.y + c.yc * Math.cos(angle) + c.ys * Math.sin(angle) };
  }, { ...mean }));
  const smooth = boundaryGeometry(lowFrequency);
  if (!smooth || __controlledMarkerForTests.boundarySelfIntersects(lowFrequency)) return result;
  const areaScale = Math.sqrt(original.area / smooth.area);
  let boundary = lowFrequency.map((point) => ({
    x: original.center.x + (point.x - smooth.center.x) * areaScale,
    y: original.center.y + (point.y - smooth.center.y) * areaScale,
  }));
  let geometry = boundaryGeometry(boundary);
  if (!geometry || __controlledMarkerForTests.boundarySelfIntersects(boundary)) return result;
  const radius = Math.sqrt(original.area / Math.PI);
  let displacement = Math.max(...boundary.map((point) => boundaryDistance(point, result.boundary)),
    ...sampled.map((point) => boundaryDistance(point, boundary)));
  let areaRatio = geometry.area / original.area;
  let blend = 1;
  // 完整平滑略超位移预算时，尝试部分平滑，而不是整条退回。
  // 只处理0.22—0.25的窄边界带；深凹陷仍直接保留。每个试案
  // 重新核验实际位移≤0.22、面积及非自交，不放宽最终几何门禁。
  if (displacement > radius * 0.22 && displacement <= radius * 0.25) {
    for (const weight of [0.9, 0.8, 0.7]) {
      const trial = boundary.map((point, index) => ({
        x: sampled[index].x * (1 - weight) + point.x * weight,
        y: sampled[index].y * (1 - weight) + point.y * weight,
      }));
      const trialGeometry = boundaryGeometry(trial);
      if (!trialGeometry || __controlledMarkerForTests.boundarySelfIntersects(trial)) continue;
      const trialDisplacement = Math.max(...trial.map(point => boundaryDistance(point, result.boundary)),
        ...sampled.map(point => boundaryDistance(point, trial)));
      const trialAreaRatio = trialGeometry.area / original.area;
      if (trialDisplacement > radius * 0.22 || trialAreaRatio < 0.97 || trialAreaRatio > 1.03) continue;
      boundary = trial; geometry = trialGeometry; displacement = trialDisplacement;
      areaRatio = trialAreaRatio; blend = weight; break;
    }
  }
  if (displacement > radius * 0.22 || areaRatio < 0.97 || areaRatio > 1.03) return result;
  return { ...result, boundary, center: geometry.center, area_px: Math.round(geometry.area), bbox: geometry.bbox,
    warnings: [...new Set([...result.warnings, "accepted_boundary_low_frequency_regularized"])],
    diagnostics: { ...result.diagnostics, accepted_boundary_regularization: "bounded_periodic_low_frequency",
      accepted_boundary_harmonics: 2, accepted_boundary_area_ratio: Number(areaRatio.toFixed(3)),
      accepted_boundary_blend: blend,
      accepted_boundary_max_displacement_ratio: Number((displacement / radius).toFixed(3)) } as ControlledMarkerDetection["diagnostics"] };
}

function smoothSolidEnvelopeBoundary(
  boundary: MarkerPoint[],
  radius = 2,
  blend = 0.75,
): MarkerPoint[] {
  if (boundary.length < radius * 2 + 1) return boundary;
  const denominator = radius * 2 + 1;
  return boundary.map((point, index) => {
    let averageX = 0;
    let averageY = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const neighbor = boundary[(index + offset + boundary.length) % boundary.length];
      averageX += neighbor.x;
      averageY += neighbor.y;
    }
    averageX /= denominator;
    averageY /= denominator;
    return {
      x: point.x * (1 - blend) + averageX * blend,
      y: point.y * (1 - blend) + averageY * blend,
    };
  });
}

function expandSolidBoundaryEnvelope(
  result: ControlledMarkerDetection,
  image: MarkerImageData,
  evidenceImage: MarkerImageData,
  seed: MarkerPoint,
  roiRadius: number,
  requestedExpectedDiameter: number,
  scanDiameterMm: number,
  coverageRadius: number,
): ControlledMarkerDetection {
  if (!result.ok || result.geometry_mode !== "dark_component" || !result.center
    || result.boundary.length < 8) return result;
  const source = boundaryGeometry(result.boundary);
  if (!source) return result;
  const diagnosticRecord = result.diagnostics as Record<string, unknown> | undefined;
  const proposalSupportCount = Number(diagnosticRecord?.scan_solid_proposal_count || 0);
  const strongProposalConsensus = proposalSupportCount >= 3
    && Number(result.diagnostics?.solid_component_core_dark_ratio || 0) >= 0.88;
  // Only a multi-window, high-core-darkness consensus may use the larger
  // envelope. A single local proposal keeps the 1.30 bound from absorbing
  // nearby pigment or skin texture.
  const envelopeScales = strongProposalConsensus
    ? [1.42, 1.36, 1.30, 1.28, 1.26, 1.24, 1.22, 1.20, 1.18, 1.16, 1.14, 1.12, 1.10]
    : [1.30, 1.28, 1.26, 1.24, 1.22, 1.20, 1.18, 1.16, 1.14, 1.12, 1.10];
  const maximumEnvelopeAreaRatio = strongProposalConsensus ? 2.10 : 1.70;
  // Keep the luma-supported envelope conservative. The previous 1.30-first
  // policy enlarged the emitted area by up to 1.69x on the fourth-edition
  // dark-skin samples, absorbing surrounding skin texture into the boundary.
  // The remaining bounded scales still allow a small outer-luma margin while
  // keeping the candidate close to the detected component.
  for (const scale of envelopeScales) {
    const boundary = result.boundary.map((point) => ({
      x: result.center!.x + (point.x - result.center!.x) * scale,
      y: result.center!.y + (point.y - result.center!.y) * scale,
    }));
    if (boundary.some((point) => (
      point.x < 0 || point.x >= image.width || point.y < 0 || point.y >= image.height
        || Math.hypot(point.x - seed.x, point.y - seed.y) > coverageRadius + 1
    )) || __controlledMarkerForTests.boundarySelfIntersects(boundary)) continue;
    const smoothedBoundary = smoothSolidEnvelopeBoundary(boundary);
    const expanded = boundaryGeometry(smoothedBoundary);
    if (!expanded || expanded.area / Math.max(1, source.area) > maximumEnvelopeAreaRatio) continue;
    const support = boundaryColorSupport(image, boundary);
    if (support.p20 < 40 || support.supportRatio < 0.65) continue;
    const candidate: ControlledMarkerDetection = {
      ...result,
      center: expanded.center,
      boundary: smoothedBoundary,
      area_px: Math.round(expanded.area),
      bbox: expanded.bbox,
      warnings: [...new Set([...result.warnings, "solid_boundary_envelope_recovered"])],
      diagnostics: {
        ...(result.diagnostics || {}),
        solid_boundary_envelope: "bounded_raw_luma_support",
        solid_boundary_envelope_scale: scale,
        solid_boundary_envelope_area_ratio: Number((expanded.area / Math.max(1, source.area)).toFixed(3)),
        solid_boundary_envelope_support_p20: support.p20,
        solid_boundary_envelope_support_ratio: Number(support.supportRatio.toFixed(3)),
      },
    };
    const gate = candidateGate(
      candidate,
      seed,
      requestedExpectedDiameter,
      evidenceImage,
      roiRadius,
      scanDiameterMm,
      coverageRadius,
    );
    if (gate.valid) return candidate;
  }
  return result;
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
  const sizeRadius = Number((options as ControlledMarkerOptions & { __solidAnalysisRadius?: number }).__solidAnalysisRadius
    || roiRadius);
  const minimumDiameterPx = Math.max(8, sizeRadius * MINIMUM_SOLID_DIAMETER_RATIO);
  const maximumDiameterPx = sizeRadius * MAXIMUM_SOLID_DIAMETER_RATIO;
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
    threshold: number;
    diameter: number;
    aspectRatio: number;
    compactness: number;
    requestedCenterDistance: number;
    seedDistance: number;
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
      if ((options as ControlledMarkerOptions & { __requireUnclippedSolidProposal?: boolean }).__requireUnclippedSolidProposal
        && pixels.some((point) => Math.hypot(point.x - seed.x, point.y - seed.y) >= roiRadius - 1)) continue;
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
        || coreDarkRatio < MIN_SOLID_COMPONENT_CORE_DARK_RATIO
        // The marker tap may land near the visible edge of a filled lesion.
        // Keep the component inside the scan ROI, but allow a bounded gap to
        // the component so edge taps can still converge on the same object.
        || distance > Math.max(5, diameter * 1.20)) continue;
      const requestedCenterDistance = Math.hypot(geometry.center.x - seed.x, geometry.center.y - seed.y);
      // Do not reward a larger threshold component merely because it contains
      // more dark pixels. That made a lower-contrast skin-connected component
      // outrank the smaller, higher-contrast lesion on the same image.
      const targetDiameter = minimumDiameterPx * 3.10;
      const score = requestedCenterDistance * 2 + distance * 2 + Math.abs(1 - aspectRatio) * 12
        + Math.abs(0.62 - fill) * 24 + Math.abs(diameter - targetDiameter) * 3.00
        + Math.max(0, diameter - targetDiameter) * 1.20
        - contrast * 0.35;
      candidates.push({
        pixels,
        boundary,
        score,
        threshold,
        diameter,
        aspectRatio,
        compactness,
        requestedCenterDistance,
        seedDistance: distance,
        fill,
        contrast,
        coreDarkRatio,
        coreMeanLuma,
      });
    }
  }
  // Keep the existing evidence score primary. When threshold candidates are
  // effectively tied, resolve the tie from geometry/evidence rather than the
  // order in which thresholds happened to be visited.
  const rankedCandidates = candidates.slice().sort((left, right) => (
    left.score - right.score
    || Math.abs(left.fill - 0.62) - Math.abs(right.fill - 0.62)
    || Math.abs(1 - left.aspectRatio) - Math.abs(1 - right.aspectRatio)
    || right.compactness - left.compactness
    || right.coreDarkRatio - left.coreDarkRatio
    || right.contrast - left.contrast
    || left.requestedCenterDistance - right.requestedCenterDistance
    || left.seedDistance - right.seedDistance
    || right.pixels.length - left.pixels.length
    || left.threshold - right.threshold
  ));
  const toDetection = (selected: typeof candidates[number]): ControlledMarkerDetection | null => {
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
    candidate_count: rankedCandidates.length,
    confidence: clamp(selected.contrast / Math.max(24, backgroundLuma * 0.35), 0, 1),
    warnings: [...new Set([
      ...witness.warnings,
      "solid_component_outer_boundary_recovered",
      "solid_component_local_background_recovered",
      "solid_component_selection_deterministic",
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
  };
  const collector = (options as ControlledMarkerOptions & {
    __solidProposalCollector?: ControlledMarkerDetection[];
  }).__solidProposalCollector;
  if (collector) {
    for (const proposal of rankedCandidates) {
      const detected = toDetection(proposal);
      if (!detected?.center || collector.some((prior) => prior.center
        && Math.hypot(prior.center.x - detected.center!.x, prior.center.y - detected.center!.y) < 3)) continue;
      collector.push(detected);
      if (collector.length >= 8) break;
    }
  }
  return rankedCandidates[0] ? toDetection(rankedCandidates[0]) : null;
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
  coverageRadius = roiRadius,
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
  const minimumEnclosedDiameterPx = Math.max(10, roiRadius * MINIMUM_ENCLOSED_DIAMETER_RATIO);
  if (result.geometry_mode === "enclosed_region" && detectedDiameter < minimumEnclosedDiameterPx) {
    reasons.push("candidate_below_minimum_enclosed_size");
  }
  const minimumPhysicalDiameterPx = Math.max(8, roiRadius * MINIMUM_SOLID_DIAMETER_RATIO);
  if (result.geometry_mode === "dark_component"
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
    Math.hypot(point.x - seed.x, point.y - seed.y) > coverageRadius + 1
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

function reconcileEnclosedMarkerEnvelope(
  result: ControlledMarkerDetection,
  seed: MarkerPoint,
  requestedExpectedDiameter: number,
  evidenceImage: MarkerImageData,
  roiRadius: number,
): ControlledMarkerDetection {
  if (!result.ok || result.geometry_mode !== "enclosed_region" || result.boundary.length < 8
    || !result.bbox || !result.marker_bbox) return result;
  const geometry = boundaryGeometry(result.boundary);
  if (!geometry) return result;
  const gate = candidateGate(
    result,
    seed,
    requestedExpectedDiameter,
    evidenceImage,
    roiRadius,
  );
  const allowedReasons = new Set([
    "candidate_below_minimum_enclosed_size",
    "candidate_not_compact",
    "candidate_color_ring_incomplete",
  ]);
  if (gate.valid || !gate.reasons.includes("candidate_below_minimum_enclosed_size")
    || gate.reasons.some((reason) => !allowedReasons.has(reason))) return result;
  const marker = result.marker_bbox;
  const sourceLeft = Math.max(geometry.center.x - geometry.bbox.x, 1e-6);
  const sourceRight = Math.max(geometry.bbox.x + geometry.bbox.width - geometry.center.x, 1e-6);
  const sourceTop = Math.max(geometry.center.y - geometry.bbox.y, 1e-6);
  const sourceBottom = Math.max(geometry.bbox.y + geometry.bbox.height - geometry.center.y, 1e-6);
  const markerLeft = marker.x;
  const markerTop = marker.y;
  const markerRight = marker.x + marker.width - 1;
  const markerBottom = marker.y + marker.height - 1;
  const targetCenter = { x: (markerLeft + markerRight) / 2, y: (markerTop + markerBottom) / 2 };
  const scaleX = Math.max(
    1,
    (targetCenter.x - markerLeft) / sourceLeft,
    (markerRight - targetCenter.x) / sourceRight,
  );
  const scaleY = Math.max(
    1,
    (targetCenter.y - markerTop) / sourceTop,
    (markerBottom - targetCenter.y) / sourceBottom,
  );
  if (scaleX > 1.55 || scaleY > 1.55) return result;
  const boundary = result.boundary.map((point) => ({
    x: targetCenter.x + (point.x - geometry.center.x) * scaleX,
    y: targetCenter.y + (point.y - geometry.center.y) * scaleY,
  }));
  if (boundary.some((point) => (
    point.x < 0 || point.x >= evidenceImage.width || point.y < 0 || point.y >= evidenceImage.height
      || Math.hypot(point.x - seed.x, point.y - seed.y) > roiRadius + 1
  ))) return result;
  const expanded = boundaryGeometry(boundary);
  if (!expanded || expanded.area / Math.max(1, geometry.area) > 2.50) return result;
  const reconciled: ControlledMarkerDetection = {
    ...result,
    center: expanded.center,
    boundary,
    area_px: Math.round(expanded.area),
    bbox: expanded.bbox,
    warnings: [...new Set([...result.warnings, "color_difference_marker_envelope_recovered"])],
    diagnostics: {
      ...(result.diagnostics || {}),
      boundary_marker_envelope_scale_x: Number(scaleX.toFixed(3)),
      boundary_marker_envelope_scale_y: Number(scaleY.toFixed(3)),
      boundary_marker_envelope_area_ratio: Number((expanded.area / Math.max(1, geometry.area)).toFixed(3)),
    },
  };
  return candidateGate(
    reconciled,
    seed,
    requestedExpectedDiameter,
    evidenceImage,
    roiRadius,
  ).valid ? reconciled : result;
}

function canonicalizeSolidRecovery(
  image: MarkerImageData,
  result: ControlledMarkerDetection,
  witness: ControlledMarkerDetection,
  requestedSeed: MarkerPoint,
  options: ControlledMarkerOptions,
  evidenceImage: MarkerImageData,
  roiRadius: number,
  requestedExpectedDiameter: number,
): ControlledMarkerDetection {
  if (!result.center || !result.bbox || result.geometry_mode !== "dark_component") return result;
  const canonical = recoverSolidComponentNearSeed(image, result.center, witness, options);
  if (!canonical?.center || !canonical.bbox) return result;
  const canonicalGate = candidateGate(
    canonical,
    requestedSeed,
    requestedExpectedDiameter,
    evidenceImage,
    roiRadius,
    Number(options.scanDiameterMm || 0),
    Number((options as ControlledMarkerOptions & { __scanCoverageRadius?: number }).__scanCoverageRadius || roiRadius),
  );
  if (!canonicalGate.valid) return result;
  const areaRatio = Math.max(result.area_px, canonical.area_px) / Math.max(1, Math.min(result.area_px, canonical.area_px));
  const referenceDiameter = Math.max(1, Math.max(result.bbox.width, result.bbox.height));
  // A displaced tap can change the local luminance background enough to make
  // the first solid component materially larger or smaller. When the
  // canonical center is close and the candidate still passes the full gate,
  // allow that bounded area change so the result converges to one component
  // instead of freezing a seed-dependent contour.
  if (areaRatio > 1.75
    || Math.hypot(result.center.x - canonical.center.x, result.center.y - canonical.center.y)
      > Math.max(3, referenceDiameter * 0.20)) return result;
  const sameBoundary = result.boundary.length === canonical.boundary.length
    && result.boundary.every((point, index) => (
      Math.hypot(point.x - canonical.boundary[index].x, point.y - canonical.boundary[index].y) <= 1e-9
    ));
  if (sameBoundary && Math.abs(result.area_px - canonical.area_px) <= 1e-9
    && Math.hypot(result.center.x - canonical.center.x, result.center.y - canonical.center.y) <= 1e-9) return result;
  canonical.warnings = [...new Set([...canonical.warnings, "solid_component_center_canonicalized"])];
  return canonical;
}

function compatibleNeighborhoodRecovery(
  first: ControlledMarkerDetection,
  second: ControlledMarkerDetection,
): boolean {
  if (!first.center || !second.center || !first.bbox || !second.bbox
    || first.geometry_mode !== second.geometry_mode) return false;
  const areaRatio = Math.max(first.area_px, second.area_px) / Math.max(1, Math.min(first.area_px, second.area_px));
  const referenceDiameter = Math.max(1, Math.min(
    Math.max(first.bbox.width, first.bbox.height),
    Math.max(second.bbox.width, second.bbox.height),
  ));
  return areaRatio <= 1.15
    && Math.hypot(first.center.x - second.center.x, first.center.y - second.center.y)
      <= Math.max(2, referenceDiameter * 0.12);
}

function sameCandidateGeometry(first: ControlledMarkerDetection, second: ControlledMarkerDetection): boolean {
  return !!first.center && !!second.center
    && first.geometry_mode === second.geometry_mode
    && Math.abs(first.area_px - second.area_px) <= 1e-9
    && Math.hypot(first.center.x - second.center.x, first.center.y - second.center.y) <= 1e-9
    && first.boundary.length === second.boundary.length
    && first.boundary.every((point, index) => (
      Math.hypot(point.x - second.boundary[index].x, point.y - second.boundary[index].y) <= 1e-9
    ));
}

function canonicalizeSolidCycle(
  result: ControlledMarkerDetection,
  recenter: (candidate: ControlledMarkerDetection) => ControlledMarkerDetection,
): ControlledMarkerDetection {
  if (!result.ok || !result.center || result.geometry_mode !== "dark_component") return result;
  let canonical = result;
  let firstStep: ControlledMarkerDetection | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = recenter(canonical);
    if (next === canonical) break;
    if (attempt === 0) firstStep = next;
    canonical = next;
  }
  if (!firstStep?.center || !sameCandidateGeometry(canonical, result)
    || sameCandidateGeometry(firstStep, result)
    || !compatibleNeighborhoodRecovery(result, firstStep)) return canonical;

  // Resolve only an observed two-cycle; the midpoint is a sampling input,
  // never an output centre if the existing gated recovery cannot replace it.
  const midpointInput = { ...canonical, center: {
    x: (result.center.x + firstStep.center.x) / 2,
    y: (result.center.y + firstStep.center.y) / 2,
  } };
  const anchored = recenter(midpointInput);
  if (anchored === midpointInput || !anchored.ok
    || !compatibleNeighborhoodRecovery(result, anchored)
    || !compatibleNeighborhoodRecovery(firstStep, anchored)) return canonical;
  return anchored;
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
  const internalOptions = allowCandidateCenterRetry
    ? options
    : {
      ...options,
      __skipSeedNeighborhoodConsensus: true,
    } as ControlledMarkerOptions & { __skipSeedNeighborhoodConsensus: boolean };
  const legacyOptions = {
    ...internalOptions,
    acceptBoundaryWithinFullScan: true,
  };
  const legacy = detectWithLegacyCore(image, seed, legacyOptions) as unknown as ControlledMarkerDetection;
  if (legacy.failure_code === "invalid_image" || legacy.failure_code === "seed_outside_image") {
    return legacy;
  }
  const evidenceImage = colorDifferenceEvidenceImage(image, seed, internalOptions);
  const roiRadius = clamp(
    Math.round(options.roiRadius ?? fallbackRoiRadius(image)),
    1,
    Math.max(image.width, image.height),
  );
  const scanCoverageRadius = Number((options as ControlledMarkerOptions & {
    __scanCoverageRadius?: number;
  }).__scanCoverageRadius || roiRadius);
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
  const colorAtRequested = detectWithLegacyCore(
    evidenceImage,
    seed,
    { ...legacyOptions, __rejectDegenerateCandidates: true } as ControlledMarkerOptions,
  ) as unknown as ControlledMarkerDetection;
  const colorRequestedGate = candidateGate(
    colorAtRequested,
    seed,
    requestedExpectedDiameter,
    evidenceImage,
    roiRadius,
    Number(options.scanDiameterMm || 0),
    scanCoverageRadius,
  );
  const preliminarySolid = legacy.geometry_mode === "dark_component"
    ? recoverSolidComponentNearSeed(image, seed, legacy, options)
    : null;
  const legacySupportsSolid = Number(preliminarySolid?.diagnostics?.solid_component_core_dark_ratio)
    >= MIN_SOLID_COMPONENT_CORE_DARK_RATIO;
  // Hollow color evidence must not be silently replaced by a nearby dark
  // component. The solid fallback remains available when the color evidence
  // is absent or geometrically compatible with the solid candidate.
  const colorSuggestsHollow = !legacySupportsSolid
    && colorAtRequested.geometry_mode === "enclosed_region"
    && colorAtRequested.center
    && colorAtRequested.bbox
    && (colorRequestedGate.reasons.includes("candidate_not_compact")
      || colorRequestedGate.reasons.includes("candidate_color_ring_incomplete")
      || colorRequestedGate.reasons.includes("candidate_below_minimum_enclosed_size")
      || Number(colorAtRequested.diagnostics?.shape_compactness) < 0.55);
  const colorCenterX = colorAtRequested.center?.x ?? Number.NaN;
  const colorCenterY = colorAtRequested.center?.y ?? Number.NaN;
  const colorExtent = colorAtRequested.bbox
    ? Math.max(colorAtRequested.bbox.width, colorAtRequested.bbox.height)
    : 0;
  if (!legacyGate.valid) {
    // A geometrically valid enclosed color candidate is stronger evidence for
    // a hollow marker than any nearby dark component recovered from the raw
    // luminance image. Prefer it before entering the solid fallback path.
    if (colorRequestedGate.valid
      && colorAtRequested.ok
      && colorAtRequested.geometry_mode === "enclosed_region") {
      return acceptRecovered(colorAtRequested, [
        "color_difference_recovered",
        "color_difference_enclosed_candidate_preferred",
        `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
      ]);
    }
    const solid = preliminarySolid ?? recoverSolidComponentNearSeed(image, seed, legacy, options);
    const solidCoreDarkRatio = Number(solid?.diagnostics?.solid_component_core_dark_ratio);
    const solidCenterDistance = solid?.center
      ? Math.hypot(solid.center.x - seed.x, solid.center.y - seed.y)
      : Number.POSITIVE_INFINITY;
    const strongSolidRecovery = Boolean(solid?.center)
      && solidCoreDarkRatio >= 0.85
      && Number(solid?.area_px) >= Math.max(100, roiRadius * roiRadius * 0.18)
      && solidCenterDistance <= roiRadius * 0.55;
    const farStrongSolidRecovery = Boolean(solid?.center)
      && solidCoreDarkRatio >= 0.70
      && Number(solid?.diagnostics?.solid_component_contrast || 0) >= 40
      && Number(solid?.area_px) >= Math.max(100, roiRadius * roiRadius * 0.18)
      && solidCenterDistance <= roiRadius * 0.80
      && legacy.geometry_mode === "enclosed_region"
      && Number(legacy.area_px) <= 16
      && Number(colorAtRequested.area_px) <= 16;
    const solidCenterTolerance = solidCoreDarkRatio >= MIN_SOLID_COMPONENT_CORE_DARK_RATIO
      ? Math.max(10, colorExtent * 0.75)
      : Math.max(6, colorExtent * 0.35);
    const solidCenterDistanceWithinAnalysis = !solid?.center
      || scanCoverageRadius <= roiRadius * EXPANDED_SCAN_SOLID_CENTER_GUARD_RATIO
      || solidCenterDistance <= roiRadius * MAX_EXPANDED_SCAN_SOLID_CENTER_RATIO;
    const solidCenterCompatible = solidCenterDistanceWithinAnalysis
      && (!colorSuggestsHollow
        || strongSolidRecovery
        || farStrongSolidRecovery
        || !solid?.center
        || Math.hypot(solid.center.x - colorCenterX, solid.center.y - colorCenterY)
          <= solidCenterTolerance);
    if (solid && solidCenterCompatible
      && candidateGate(solid, seed, requestedExpectedDiameter, evidenceImage, roiRadius, Number(options.scanDiameterMm || 0), scanCoverageRadius).valid) {
      return acceptRecovered(canonicalizeSolidRecovery(
        image, solid, legacy, seed, options, evidenceImage, roiRadius, requestedExpectedDiameter,
      ), ["color_difference_solid_component_recovered"]);
    }
    if (allowCandidateCenterRetry) {
      const step = clamp(Math.round(roiRadius * 0.28), 6, 12);
      const shortStep = clamp(Math.round(roiRadius * 0.14), 6, 8);
      const maximumRecoveryCenterDistance = scanCoverageRadius > roiRadius * EXPANDED_SCAN_SOLID_CENTER_GUARD_RATIO
        ? roiRadius * MAX_EXPANDED_SCAN_SOLID_CENTER_RATIO
        : scanCoverageRadius * 0.80;
      const nearbySeeds: MarkerPoint[] = [
        { x: seed.x + step, y: seed.y }, { x: seed.x - step, y: seed.y },
        { x: seed.x, y: seed.y + step }, { x: seed.x, y: seed.y - step },
        { x: seed.x + step, y: seed.y + step }, { x: seed.x - step, y: seed.y - step },
        { x: seed.x + step, y: seed.y - step }, { x: seed.x - step, y: seed.y + step },
        { x: seed.x + shortStep, y: seed.y }, { x: seed.x - shortStep, y: seed.y },
        { x: seed.x, y: seed.y + shortStep }, { x: seed.x, y: seed.y - shortStep },
      ];
      for (const nearbySeed of nearbySeeds) {
        if (nearbySeed.x < 0 || nearbySeed.x >= image.width || nearbySeed.y < 0 || nearbySeed.y >= image.height) continue;
        const nearbyLegacy = legacy.failure_code === "ambiguous_candidates"
          ? detectWithLegacyCore(image, nearbySeed, legacyOptions) as unknown as ControlledMarkerDetection
          : legacy;
        const nearbySolid = recoverSolidComponentNearSeed(image, nearbySeed, nearbyLegacy, options);
        if (!nearbySolid?.center || !nearbySolid.bbox
          || Math.hypot(nearbySolid.center.x - seed.x, nearbySolid.center.y - seed.y) > maximumRecoveryCenterDistance) continue;
        const nearbySolidCoreDarkRatio = Number(nearbySolid.diagnostics?.solid_component_core_dark_ratio);
        const nearbySolidContrast = Number(nearbySolid.diagnostics?.solid_component_contrast || 0);
        const nearbySolidDistance = Math.hypot(nearbySolid.center.x - seed.x, nearbySolid.center.y - seed.y);
        const nearbyStrongSolidRecovery = legacy.failure_code === "ambiguous_candidates"
          && nearbySolidCoreDarkRatio >= 0.80
          && nearbySolidContrast >= 30
          && Number(nearbySolid.area_px) >= Math.max(100, roiRadius * roiRadius * 0.18)
          && nearbySolidDistance <= maximumRecoveryCenterDistance;
        const nearbySolidCenterCompatible = !colorSuggestsHollow
          || nearbyStrongSolidRecovery
          || Math.hypot(nearbySolid.center.x - colorCenterX, nearbySolid.center.y - colorCenterY)
            <= Math.max(6, colorExtent * 0.35);
        if (!nearbySolidCenterCompatible) continue;
        const nearbyGate = candidateGate(
          nearbySolid,
          seed,
          requestedExpectedDiameter,
          evidenceImage,
          roiRadius,
          Number(options.scanDiameterMm || 0),
          scanCoverageRadius,
        );
        if (nearbyGate.valid) {
          return acceptRecovered(canonicalizeSolidRecovery(
            image, nearbySolid, legacy, seed, options, evidenceImage, roiRadius, requestedExpectedDiameter,
          ), [
            "color_difference_solid_component_recovered",
            "solid_component_nearby_seed_recovered",
          ]);
        }
        if (legacy.failure_code === "ambiguous_candidates") {
          const nearbyRecovery = detectControlledMarkerInternal(image, nearbySeed, options, false, false);
          if (nearbyRecovery.ok && nearbyRecovery.geometry_mode === "dark_component"
            && candidateGate(
              nearbyRecovery,
              seed,
              requestedExpectedDiameter,
              evidenceImage,
              roiRadius,
              Number(options.scanDiameterMm || 0),
              scanCoverageRadius,
            ).valid) {
            return acceptRecovered(nearbyRecovery, [
              "color_difference_solid_component_recovered",
              "solid_component_nearby_seed_recovered",
              "ambiguous_candidate_nearby_recovered",
            ]);
          }
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

  // The legacy core may already have a complete enclosed boundary, but its
  // first smoothing pass can leave a shallow raster pocket just below the
  // color profile's compactness gate. Re-run the existing bounded
  // regularizer once on a clone; do not relax the gate or synthesize an arc.
  if (legacy.ok && legacy.center && legacy.geometry_mode === "enclosed_region"
    && legacyGate.reasons.length === 1 && legacyGate.reasons[0] === "candidate_not_compact"
    && legacy.bbox
    && Math.max(legacy.bbox.width, legacy.bbox.height) >= 12
    && Math.max(legacy.bbox.width, legacy.bbox.height) <= roiRadius * 1.5
    && Number(legacy.diagnostics?.shape_compactness) >= 0.45) {
    const refinalize = __controlledMarkerForTests.finalizeControlledMarkerBoundary as unknown as (
      candidate: ControlledMarkerDetection,
    ) => ControlledMarkerDetection;
    const refinalized = refinalize({
      ...legacy,
      boundary: legacy.boundary.map((point) => ({ ...point })),
      warnings: [...legacy.warnings],
    } as ControlledMarkerDetection);
    const refinalizedGate = candidateGate(
      refinalized,
      seed,
      requestedExpectedDiameter,
      evidenceImage,
      roiRadius,
      Number(options.scanDiameterMm || 0),
    );
    if (refinalized !== legacy && refinalizedGate.valid
      && compatibleNeighborhoodRecovery(legacy, refinalized)) {
      return acceptRecovered(refinalized, [
        "color_difference_boundary_refinalized",
        `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
      ]);
    }
  }

  let refinalizedColorCandidate: ControlledMarkerDetection | null = null;
  let refinalizedColorCandidateCanEmit = false;
  if (colorRequestedGate.valid && hasExplicitSolidRecoveryEvidence(colorAtRequested)) {
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

  // A supported, near-circular color candidate can also stop one smoothing
  // pass short. Only retry when the candidate already has strong boundary
  // support and a lesion-sized extent; elongated or fragmentary candidates
  // remain rejected.
  if (colorAtRequested.ok && colorAtRequested.center
    && colorAtRequested.geometry_mode === "enclosed_region"
    && colorRequestedGate.reasons.length === 1
    && colorRequestedGate.reasons[0] === "candidate_not_compact"
    && colorAtRequested.bbox
    && Math.max(colorAtRequested.bbox.width, colorAtRequested.bbox.height) >= roiRadius * 0.50
    && Number(colorAtRequested.diagnostics?.boundary_support_ratio) >= 0.95
    && Number(colorAtRequested.diagnostics?.repair_fraction) <= 0.05) {
    const refinalize = __controlledMarkerForTests.finalizeControlledMarkerBoundary as unknown as (
      candidate: ControlledMarkerDetection,
    ) => ControlledMarkerDetection;
    const refinalized = refinalize({
      ...colorAtRequested,
      boundary: colorAtRequested.boundary.map((point) => ({ ...point })),
      warnings: [...colorAtRequested.warnings],
    } as ControlledMarkerDetection);
    const refinalizedGate = candidateGate(
      refinalized,
      seed,
      requestedExpectedDiameter,
      evidenceImage,
      roiRadius,
      Number(options.scanDiameterMm || 0),
    );
    const refinalizedDiameter = refinalized.bbox
      ? Math.max(refinalized.bbox.width, refinalized.bbox.height)
      : 0;
    const refinalizedAspect = refinalized.bbox
      ? Math.min(refinalized.bbox.width, refinalized.bbox.height) / Math.max(1, refinalizedDiameter)
      : 0;
    if (refinalized !== colorAtRequested && refinalizedGate.valid
      && compatibleNeighborhoodRecovery(colorAtRequested, refinalized)) {
      refinalizedColorCandidate = refinalized;
      if (refinalizedDiameter >= roiRadius * 0.65 && refinalizedAspect >= 0.85) {
        refinalizedColorCandidateCanEmit = true;
        return acceptRecovered(refinalized, [
          "color_difference_color_candidate_refinalized",
          `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
        ]);
      }
    }
  }

  // A compact but undersized anchor is not emitted directly. It may still
  // guide a bounded four-direction retry when two nearby seeds independently
  // converge on the same full-sized candidate.
  if (refinalizedColorCandidate && allowCandidateCenterRetry) {
    const step = clamp(Math.round(roiRadius * 0.28), 6, 12);
    const nearbySeeds: MarkerPoint[] = [
      { x: seed.x + step, y: seed.y }, { x: seed.x - step, y: seed.y },
      { x: seed.x, y: seed.y + step }, { x: seed.x, y: seed.y - step },
    ];
    const recoveries: ControlledMarkerDetection[] = [];
    for (const nearbySeed of nearbySeeds) {
      if (nearbySeed.x < 0 || nearbySeed.x >= evidenceImage.width
        || nearbySeed.y < 0 || nearbySeed.y >= evidenceImage.height) continue;
      const recovery = detectControlledMarkerInternal(image, nearbySeed, options, false);
      if (!candidateGate(recovery, seed, requestedExpectedDiameter, evidenceImage, roiRadius,
        Number(options.scanDiameterMm || 0)).valid) continue;
      const consensus = recoveries.find((candidate) => compatibleNeighborhoodRecovery(candidate, recovery));
      if (consensus) {
        return acceptRecovered(consensus, [
          "color_difference_refinalized_neighborhood_consensus",
          `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
        ]);
      }
      recoveries.push(recovery);
    }
  }
  if (refinalizedColorCandidate && refinalizedColorCandidateCanEmit) {
    return acceptRecovered(refinalizedColorCandidate, [
      "color_difference_color_candidate_refinalized",
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
    if (scaledColorGate.valid && hasExplicitSolidRecoveryEvidence(scaledColor)) {
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
  if (denoisedColorGate.valid && hasExplicitSolidRecoveryEvidence(denoisedColor)) {
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
  const markerEnvelope = reconcileEnclosedMarkerEnvelope(
    legacy,
    seed,
    requestedExpectedDiameter,
    evidenceImage,
    roiRadius,
  );
  if (markerEnvelope !== legacy) {
    return acceptRecovered(markerEnvelope, [
      "color_difference_marker_envelope_recovered",
      `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
    ]);
  }
  const legacyDiameter = legacy.bbox
    ? Math.max(legacy.bbox.width, legacy.bbox.height)
    : 0;
  if (!requestedExpectedDiameter && legacy.ok && legacy.center
    && legacy.geometry_mode === "enclosed_region"
    && legacyGate.reasons.length === 1 && legacyGate.reasons[0] === "candidate_not_compact"
    && legacyDiameter >= 12 && legacyDiameter <= roiRadius * 1.5
    && Number(legacy.diagnostics?.shape_compactness) >= 0.45) {
    const retry = detectWithLegacyCore(
      image, seed, trialOptions(legacyOptions, legacyDiameter + 1, 1),
    ) as unknown as ControlledMarkerDetection;
    if (retry.diagnostics?.boundary_regularization === "convex_hull"
      && compatibleNeighborhoodRecovery(legacy, retry)
      && candidateGate(retry, seed, 0, evidenceImage, roiRadius,
        Number(options.scanDiameterMm || 0)).valid) {
      return acceptRecovered(retry, ["color_difference_candidate_size_regularized"]);
    }
  }
  const neighborhoodRecoveryReasons = new Set([
    "candidate_geometry_degenerate",
    "candidate_not_compact",
    "not_supported_boundary",
  ]);
  const neighborhoodWitness = denoisedColor.ok ? denoisedColor : colorAtRequested;
  const neighborhoodWitnessGate = denoisedColor.ok ? denoisedColorGate : colorRequestedGate;
  const neighborhoodDepth = Number((options as ControlledMarkerOptions & {
    __neighborhoodDepth?: number;
  }).__neighborhoodDepth || 0);
  const neighborhoodRecoveryEligible = allowCandidateCenterRetry
    && neighborhoodWitness.ok
    && neighborhoodWitness.center
    && neighborhoodWitness.geometry_mode === "enclosed_region"
    && neighborhoodWitnessGate.reasons.length > 0
    && neighborhoodWitnessGate.reasons.every((reason) => neighborhoodRecoveryReasons.has(reason))
    && Number(neighborhoodWitness.diagnostics?.boundary_support_ratio) >= 0.95
    && Number(neighborhoodWitness.diagnostics?.repair_fraction) <= 0.05
    && candidateShapeCompactness(neighborhoodWitness) >= 0.45;
  if (neighborhoodRecoveryEligible) {
    const step = clamp(Math.round(roiRadius * 0.28), 6, 12);
    const nearbySeeds: MarkerPoint[] = [
      { x: seed.x + step, y: seed.y }, { x: seed.x - step, y: seed.y },
      { x: seed.x, y: seed.y + step }, { x: seed.x, y: seed.y - step },
    ];
    const recoveries: ControlledMarkerDetection[] = [];
    for (const nearbySeed of nearbySeeds) {
      if (nearbySeed.x < 0 || nearbySeed.x >= image.width || nearbySeed.y < 0 || nearbySeed.y >= image.height) continue;
      const recovery = detectControlledMarkerInternal(image, nearbySeed, options, false);
      if (candidateGate(recovery, seed, requestedExpectedDiameter, evidenceImage, roiRadius,
        Number(options.scanDiameterMm || 0)).valid) {
        const consensus = recoveries.find((candidate) => compatibleNeighborhoodRecovery(candidate, recovery));
        if (consensus) {
          return acceptRecovered(consensus, [
            "color_difference_neighborhood_consensus_recovered",
            `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
          ]);
        }
        recoveries.push(recovery);
      }
    }
  }

  // When the click is well inside the scan circle but far from the lesion,
  // a tiny color fragment can still point toward the true object. Probe only
  // three seeds along that evidence direction. Each returned boundary must be
  // a large, compact enclosed candidate and two probes must agree before it is
  // emitted. Nested probes cannot start another directional search.
  const legacyExtent = legacy.bbox ? Math.max(legacy.bbox.width, legacy.bbox.height) : 0;
  const colorExtentForDirection = colorAtRequested.bbox
    ? Math.max(colorAtRequested.bbox.width, colorAtRequested.bbox.height)
    : 0;
  const preferLegacyDirectionalWitness = Boolean(legacy.ok && legacy.center && legacy.bbox)
    && legacyExtent >= Math.max(12, colorExtentForDirection * 1.35);
  const directionalWitness = preferLegacyDirectionalWitness
    ? legacy
    : colorAtRequested.ok && colorAtRequested.center
      ? colorAtRequested
      : legacy.ok && legacy.center
        ? legacy
        : null;
  const directionalReasons = new Set([
    "candidate_geometry_degenerate",
    "candidate_below_minimum_enclosed_size",
    "candidate_not_compact",
    "candidate_color_ring_incomplete",
    "not_supported_boundary",
  ]);
  const directionalGate = directionalWitness === colorAtRequested
    ? colorRequestedGate
    : legacyGate;
  const directionalRecoveryEligible = neighborhoodDepth === 0
    && allowCandidateCenterRetry
    && directionalWitness?.center
    && directionalWitness.bbox
    && directionalGate.reasons.length > 0
    && directionalGate.reasons.every((reason) => directionalReasons.has(reason));
  if (directionalRecoveryEligible && directionalWitness?.center) {
    const scanCoverageRadius = Number((options as ControlledMarkerOptions & {
      __scanCoverageRadius?: number;
    }).__scanCoverageRadius || roiRadius);
    const vx = directionalWitness.center.x - seed.x;
    const vy = directionalWitness.center.y - seed.y;
    const length = Math.hypot(vx, vy);
    if (length >= 2) {
      const ux = vx / length;
      const uy = vy / length;
      const recoveries: ControlledMarkerDetection[] = [];
      for (const radius of [16, 24]) {
        const nearbySeed = { x: seed.x + Math.round(ux * radius), y: seed.y + Math.round(uy * radius) };
        if (nearbySeed.x < 0 || nearbySeed.x >= image.width || nearbySeed.y < 0 || nearbySeed.y >= image.height) continue;
        const recovery = detectControlledMarkerInternal(image, nearbySeed, options, false, false);
        if (!recovery.ok || recovery.geometry_mode !== "enclosed_region" || !recovery.bbox
          || Math.max(recovery.bbox.width, recovery.bbox.height) < roiRadius * 0.65
          || candidateShapeCompactness(recovery) < 0.55) continue;
        const recoveryEvidence = colorDifferenceEvidenceImage(image, nearbySeed, options);
        const recoveryGate = candidateGate(
          recovery,
          nearbySeed,
          requestedExpectedDiameter,
          recoveryEvidence,
          roiRadius,
          Number(options.scanDiameterMm || 0),
          scanCoverageRadius,
        );
        if (!recoveryGate.valid || recovery.boundary.some((point) => (
          Math.hypot(point.x - seed.x, point.y - seed.y) > scanCoverageRadius + 1
        ))) continue;
        const consensus = recoveries.find((candidate) => compatibleNeighborhoodRecovery(candidate, recovery));
        if (consensus) {
          return acceptRecovered(recovery, [
            "color_difference_directional_neighborhood_consensus_recovered",
            `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
          ]);
        }
        recoveries.push(recovery);
      }
    }
  }

  // A hollow lesion can leave only a small, incomplete color ring at the
  // operator's click. Do not accept that fragment or lower the candidate
  // gates. Instead, sample two bounded neighbourhood radii and require two
  // independent seeds to converge on the same full-sized enclosed boundary.
  // This keeps the recovery tied to the original scan circle and prevents a
  // single nearby texture pocket from becoming a lesion.
  const fragmentaryWitness = colorAtRequested;
  const fragmentaryReasons = new Set([
    "candidate_below_minimum_enclosed_size",
    "candidate_too_elongated",
    "candidate_not_compact",
    "candidate_color_ring_incomplete",
  ]);
  const fragmentaryRecoveryEligible = allowCandidateCenterRetry
    && fragmentaryWitness.ok
    && fragmentaryWitness.center
    && fragmentaryWitness.bbox
    && fragmentaryWitness.geometry_mode === "enclosed_region"
    && colorRequestedGate.reasons.length > 0
    && colorRequestedGate.reasons.includes("candidate_color_ring_incomplete")
    && colorRequestedGate.reasons.every((reason) => fragmentaryReasons.has(reason))
    && Math.max(fragmentaryWitness.bbox.width, fragmentaryWitness.bbox.height) >= 6
    && Number(fragmentaryWitness.diagnostics?.boundary_support_ratio) >= 0.70
    && (Number(fragmentaryWitness.diagnostics?.boundary_support_ratio) < 0.99
      || Number(fragmentaryWitness.diagnostics?.repair_fraction) > 0.01
      || candidateShapeCompactness(fragmentaryWitness) < 0.45)
    && Number(fragmentaryWitness.diagnostics?.repair_fraction) <= 0.30;
  if (fragmentaryRecoveryEligible) {
    const scanCoverageRadius = Number((options as ControlledMarkerOptions & {
      __scanCoverageRadius?: number;
    }).__scanCoverageRadius || roiRadius);
    const directSeed = fragmentaryWitness.center as MarkerPoint;
    const directRecovery = detectControlledMarkerInternal(image, directSeed, options, false, false);
    const directEvidence = colorDifferenceEvidenceImage(image, directSeed, options);
    const directGate = candidateGate(
      directRecovery,
      directSeed,
      requestedExpectedDiameter,
      directEvidence,
      roiRadius,
      Number(options.scanDiameterMm || 0),
      scanCoverageRadius,
    );
    if (directRecovery.ok
      && directRecovery.geometry_mode === "enclosed_region"
      && directRecovery.bbox
      && directGate.valid
      && Math.max(directRecovery.bbox.width, directRecovery.bbox.height) >= roiRadius * 0.65
      && candidateShapeCompactness(directRecovery) >= 0.75
      && directRecovery.boundary.every((point) => (
        Math.hypot(point.x - seed.x, point.y - seed.y) <= scanCoverageRadius + 1
      ))) {
      return acceptRecovered(directRecovery, [
        "color_difference_fragment_center_recovered",
        `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
      ]);
    }
    const steps = [
      clamp(Math.round(roiRadius * 0.11), 4, 8),
      clamp(Math.round(roiRadius * 0.22), 4, 10),
    ];
    const recoveries: ControlledMarkerDetection[] = [];
    for (const step of steps) {
      const nearbySeeds: MarkerPoint[] = [
        { x: seed.x - step, y: seed.y }, { x: seed.x + step, y: seed.y },
        { x: seed.x, y: seed.y - step }, { x: seed.x, y: seed.y + step },
      ];
      for (const nearbySeed of nearbySeeds) {
        if (nearbySeed.x < 0 || nearbySeed.x >= image.width
          || nearbySeed.y < 0 || nearbySeed.y >= image.height) continue;
        let recovery = detectControlledMarkerInternal(image, nearbySeed, options, false);
        if (recovery.ok && recovery.center && recovery.geometry_mode === "enclosed_region") {
          const canonical = detectControlledMarkerInternal(image, recovery.center, options, false);
          const canonicalExpansionAllowed = Number(
            fragmentaryWitness.diagnostics?.boundary_support_ratio,
          ) < 0.95;
          if (canonical.ok && canonical.center && canonical.bbox
            && canonical.geometry_mode === "enclosed_region"
            && (compatibleNeighborhoodRecovery(recovery, canonical)
              || (canonicalExpansionAllowed
                && Math.max(canonical.bbox.width, canonical.bbox.height) >= roiRadius * 0.65
                && candidateShapeCompactness(canonical) >= 0.75))) {
            recovery = canonical;
          }
        }
        const recoveryEvidence = colorDifferenceEvidenceImage(image, nearbySeed, options);
        const recoveryGate = candidateGate(
          recovery,
          nearbySeed,
          requestedExpectedDiameter,
          recoveryEvidence,
          roiRadius,
          Number(options.scanDiameterMm || 0),
          scanCoverageRadius,
        );
        const recoveryCanWitnessIncompleteRing = recoveryGate.reasons.length === 1
          && recoveryGate.reasons[0] === "candidate_color_ring_incomplete"
          && recovery.bbox
          && Math.max(recovery.bbox.width, recovery.bbox.height) >= roiRadius * 0.65
          && candidateShapeCompactness(recovery) >= 0.75;
        if ((!recoveryGate.valid && !recoveryCanWitnessIncompleteRing) || recovery.boundary.some((point) => (
          Math.hypot(point.x - seed.x, point.y - seed.y) > scanCoverageRadius + 1
        ))) continue;
        const consensus = recoveries.find((candidate) => compatibleNeighborhoodRecovery(candidate, recovery));
        if (consensus) {
          return acceptRecovered(recovery, [
            "color_difference_fragment_neighborhood_consensus_recovered",
            `legacy_failure:${legacy.failure_code || "invalid_candidate"}`,
          ]);
        }
        recoveries.push(recovery);
      }
    }
  }
  return rejectCandidate(
    colorAtRequested.ok ? colorAtRequested : legacy,
    legacy.failure_code,
    [...new Set(rejectedReasons)],
  );
}

function adjustHollowEnvelope(
  candidate: ControlledMarkerDetection,
  image: MarkerImageData,
  seed: MarkerPoint,
  scanRadius: number,
): ControlledMarkerDetection {
    const colorPreferred = candidate.warnings.includes("color_difference_enclosed_candidate_preferred");
    if (!candidate.ok || candidate.geometry_mode !== "enclosed_region"
      || !candidate.center || candidate.boundary.length < 8
      || candidate.warnings.includes("hollow_boundary_contracted")) return candidate;
    const sourceGeometry = hollowPolygonGeometry(candidate.boundary);
    if (!sourceGeometry || !hollowPointInPolygon(sourceGeometry.center, candidate.boundary)) return candidate;
    const anchor = sourceGeometry.center;
    // The accepted outline determines its own correction. The pointer still
    // limits scan coverage, but cannot toggle the correction at the ring edge.
    let lumaSum = 0;
    let lumaCount = 0;
    for (let dy = -12; dy <= 12; dy += 1) {
      for (let dx = -12; dx <= 12; dx += 1) {
        const x = clamp(Math.round(anchor.x + dx), 0, image.width - 1);
        const y = clamp(Math.round(anchor.y + dy), 0, image.height - 1);
        lumaSum += localLuma(image.data, (y * image.width + x) * 4);
        lumaCount += 1;
      }
    }
    const meanLuma = lumaSum / Math.max(1, lumaCount);
    const hasPeriodicBoundarySmoothing = candidate.warnings.includes("boundary_periodic_smoothed");
    if (meanLuma >= 110 && !colorPreferred && !hasPeriodicBoundarySmoothing) return candidate;
    const scale = colorPreferred || meanLuma >= 110 ? 0.94 : 1;
    if (scale === 1) {
      return {
        ...candidate,
        diagnostics: {
          ...(candidate.diagnostics || {}),
          hollow_boundary_contraction: "low_luma_enclosed_margin_preserved",
          hollow_boundary_contraction_scale: 1,
          hollow_boundary_contraction_area_ratio: 1,
          hollow_boundary_contraction_luma: Number(meanLuma.toFixed(2)),
        },
      };
    }
    const boundary = candidate.boundary.map((point) => ({
      x: anchor.x + (point.x - anchor.x) * scale,
      y: anchor.y + (point.y - anchor.y) * scale,
    }));
    const geometry = hollowPolygonGeometry(boundary);
    if (!geometry || !hollowPointInPolygon(anchor, boundary)
      || __controlledMarkerForTests.boundarySelfIntersects(boundary)
      || boundary.some((point) => Math.hypot(point.x - seed.x, point.y - seed.y) > scanRadius + 1)) return candidate;
    return {
      ...candidate,
      center: geometry.center,
      boundary,
      area_px: Math.round(geometry.area),
      bbox: geometry.bbox,
      warnings: [...new Set([...candidate.warnings, "hollow_boundary_contracted", "hollow_boundary_center_anchored"])],
      diagnostics: {
        ...(candidate.diagnostics || {}),
        hollow_boundary_contraction: colorPreferred || meanLuma >= 110
          ? "stable_enclosed_margin"
          : "low_luma_enclosed_margin",
        hollow_boundary_contraction_scale: scale,
        hollow_boundary_contraction_area_ratio: Number((geometry.area / Math.max(1, sourceGeometry.area)).toFixed(3)),
        hollow_boundary_contraction_luma: Number(meanLuma.toFixed(2)),
      },
    };
}

// Discover closed interiors across the pointer's covered surface before a
// seed-local skin component can terminate selection. These are anchors only:
// emitted geometry still comes from the existing fixed-scale detector/gates.
function scanEnclosedAnchors(image: MarkerImageData, seed: MarkerPoint, radius: number, minContrast: number, localContrastOnly = false) {
  const x0 = Math.max(0, Math.floor(seed.x - radius));
  const y0 = Math.max(0, Math.floor(seed.y - radius));
  const x1 = Math.min(image.width - 1, Math.ceil(seed.x + radius));
  const y1 = Math.min(image.height - 1, Math.ceil(seed.y + radius));
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  if (width <= 0 || height <= 0 || width * height > 450000) return [];
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    if (Math.hypot(x - seed.x, y - seed.y) > radius) continue;
    histogram[Math.round(localLuma(image.data, (y * image.width + x) * 4))] += 1;
    count += 1;
  }
  let sum = 0, background = 255;
  for (let value = 0; value < 256; value += 1) {
    sum += histogram[value];
    if (sum >= Math.ceil(count * 0.7)) { background = value; break; }
  }
  const { mask } = __controlledMarkerForTests.adaptiveDarkBarrier(
    image, x0, y0, width, height, localContrastOnly ? 255 : background,
    localContrastOnly ? -1 : Math.min(160, background - minContrast), minContrast,
  );
  const covered = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    covered[y * width + x] = Number(Math.hypot(x0 + x - seed.x, y0 + y - seed.y) <= radius);
  }
  const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  const anchors: Array<{ center: MarkerPoint; area: number }> = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || seen[start] || !covered[start]) continue;
    let head = 0, tail = 0, sx = 0, sy = 0, open = false;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const current = queue[head++], x = current % width, y = Math.floor(current / width);
      sx += x0 + x; sy += y0 + y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !covered[ny * width + nx]) { open = true; continue; }
        const next = ny * width + nx;
        if (mask[next] || seen[next]) continue;
        seen[next] = 1; queue[tail++] = next;
      }
    }
    if (!open && tail >= 25) anchors.push({ center: { x: sx / tail, y: sy / tail }, area: tail });
  }
  return anchors.sort((a, b) => b.area - a.area).slice(0, 8);
}

function recoverScanEnclosedCandidate(
  image: MarkerImageData, seed: MarkerPoint, options: ControlledMarkerOptions,
  analysisRadius: number, scanRadius: number,
): ControlledMarkerDetection | null {
  // The scan may include a shadow or hair. A scan-wide brightness percentile
  // can otherwise erase a faint ring even when every ring pixel is covered.
  // The second proposal mask uses local contrast alone; both masks must still
  // pass the same fixed-scale detector and full-colour boundary gate.
  const anchors = [
    ...scanEnclosedAnchors(image, seed, scanRadius, Number(options.minContrast ?? 24)),
    ...scanEnclosedAnchors(image, seed, scanRadius, Number(options.minContrast ?? 24), true),
  ].sort((a, b) => b.area - a.area).filter((anchor, index, all) => (
    !all.slice(0, index).some((prior) => Math.hypot(prior.center.x - anchor.center.x,
      prior.center.y - anchor.center.y) < 3)
  )).slice(0, 8);
  if (!anchors.length) return null;
  // Evidence extent may cover the scan, while the local colour calibration
  // remains at the analysis scale (expectedDiameter fixes its neighbourhood).
  const evidence = colorDifferenceEvidenceImage(image, seed, {
    ...options, roiRadius: scanRadius,
    expectedDiameterPx: Number(options.expectedDiameterPx) > 0 ? options.expectedDiameterPx : analysisRadius * 0.075 / 0.14,
  });
  const accepted: ControlledMarkerDetection[] = [];
  for (const anchor of anchors) {
    const candidate = detectControlledMarkerInternal(image, anchor.center, {
      ...options, roiRadius: analysisRadius, __scanCoverageRadius: scanRadius,
    } as ControlledMarkerOptions, false, false);
    if (!candidate.ok || candidate.geometry_mode !== "enclosed_region" || !candidate.center
      || !candidateGate(candidate, seed, Number(options.expectedDiameterPx || 0), evidence,
        analysisRadius, Number(options.scanDiameterMm || 0), scanRadius).valid) continue;
    if (accepted.some((prior) => prior.center && Math.hypot(prior.center.x - candidate.center!.x,
      prior.center.y - candidate.center!.y) < 3)) continue;
    accepted.push(candidate);
  }
  accepted.sort((a, b) => b.area_px - a.area_px);
  if (!accepted.length) return null;
  const best = accepted[0];
  // Comparable disjoint rings remain ambiguous; neither seed proximity nor
  // a first successful fallback is sufficient ownership evidence.
  if (accepted.slice(1).some((other) => other.area_px >= best.area_px * 0.65
    && other.center && !boundaryContains(other.center, best.boundary))) return null;
  return acceptRecovered({ ...best, boundary: best.boundary.map((p) => ({ ...p })) }, ["scan_closed_ring_anchor_recovered"]);
}

// Large filled pigment can contain enough texture to fragment a luminance
// threshold into tiny rings. Recover only a seed-connected, colour-consistent
// object; do not enlarge the existing small-object thresholds globally.
function recoverLargeChromaticSolidAtAnchor(
  image: MarkerImageData, seed: MarkerPoint, analysisRadius: number, scanRadius: number,
): ControlledMarkerDetection | null {
  const radius = Math.min(scanRadius, analysisRadius * 4);
  if (!Number.isFinite(radius) || radius <= analysisRadius * 1.5) return null;
  const sx = clamp(Math.round(seed.x), 0, image.width - 1);
  const sy = clamp(Math.round(seed.y), 0, image.height - 1);
  const x0 = Math.max(0, sx - radius), y0 = Math.max(0, sy - radius);
  const x1 = Math.min(image.width - 1, sx + radius), y1 = Math.min(image.height - 1, sy + radius);
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  const labs: LabColor[] = [];
  const lumas: number[] = [];
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    const channels: number[][] = [[], [], []];
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const i = (clamp(y + dy, 0, image.height - 1) * image.width
        + clamp(x + dx, 0, image.width - 1)) * 4;
      for (let c = 0; c < 3; c += 1) channels[c].push(Number(image.data[i + c]));
    }
    const rgb = channels.map(values => values.sort((a, b) => a - b)[4]);
    labs.push(rgbToLab(rgb[0], rgb[1], rgb[2]));
    lumas.push(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
  }
  const reference: LabColor = { l: 0, a: 0, b: 0 };
  for (const channel of ["l", "a", "b"] as const) {
    const samples: number[] = [];
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
      const x = sx + dx - x0, y = sy + dy - y0;
      if (x >= 0 && x < width && y >= 0 && y < height) samples.push(labs[y * width + x][channel]);
    }
    reference[channel] = percentile(samples, 0.5);
  }
  const background = percentile(lumas, 0.70);
  const start = (sy - y0) * width + sx - x0;
  let previous: Set<number> | null = null;
  let selected: ControlledMarkerDetection | null = null;
  // Require stability at neighbouring colour distances, not one favourable
  // threshold. The bound prevents merging pigment into a nearby shadow.
  for (const tolerance of [10, 12, 14]) {
    const supported = (i: number) => Math.hypot(labs[i].l - reference.l,
      labs[i].a - reference.a, labs[i].b - reference.b) <= tolerance;
    if (!supported(start)) continue;
    const visited = new Set<number>([start]), queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
      const i = queue[head], x = i % width, y = Math.floor(i / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited.has(next)
          || Math.hypot(x0 + nx - seed.x, y0 + ny - seed.y) >= radius - 1 || !supported(next)) continue;
        visited.add(next); queue.push(next);
      }
    }
    const stable = previous && queue.length / previous.size <= 1.5;
    previous = visited;
    if (!stable || queue.length < 32) continue;
    const pixels = queue.map(i => ({ x: x0 + i % width, y: y0 + Math.floor(i / width) }));
    if (pixels.some(p => p.x <= x0 || p.x >= x1 || p.y <= y0 || p.y >= y1
      || Math.hypot(p.x - seed.x, p.y - seed.y) >= radius - 2)) continue;
    const boundary = __controlledMarkerForTests.componentOuterBoundary(pixels, 128);
    const geometry = boundaryGeometry(boundary);
    if (!geometry || !boundaryContains(seed, boundary)) continue;
    const diameter = Math.max(geometry.bbox.width, geometry.bbox.height);
    const fill = pixels.length / Math.max(1, geometry.bbox.width * geometry.bbox.height);
    const contrast = background - queue.reduce((sum, i) => sum + lumas[i], 0) / queue.length;
    const coreRadius = Math.min(geometry.bbox.width, geometry.bbox.height) * 0.24;
    let coreTotal = 0, coreSupported = 0;
    for (let y = Math.floor(geometry.center.y - coreRadius); y <= geometry.center.y + coreRadius; y += 1) {
      for (let x = Math.floor(geometry.center.x - coreRadius); x <= geometry.center.x + coreRadius; x += 1) {
        if (Math.hypot(x - geometry.center.x, y - geometry.center.y) > coreRadius) continue;
        coreTotal += 1;
        if (visited.has((y - y0) * width + x - x0)) coreSupported += 1;
      }
    }
    const coreRatio = coreSupported / Math.max(1, coreTotal);
    if (diameter <= analysisRadius * MAXIMUM_SOLID_DIAMETER_RATIO
      || Math.min(geometry.bbox.width, geometry.bbox.height) / diameter < 0.55
      || fill < 0.45 || fill > 0.95 || contrast < Math.max(18, background * 0.12)
      || coreRatio < 0.85 || Math.hypot(geometry.center.x - seed.x, geometry.center.y - seed.y)
        > analysisRadius * MAX_EXPANDED_SCAN_SOLID_CENTER_RATIO) continue;
    const candidate = regularizeSolidBoundary({
      ok: true, failure_code: null, center: geometry.center, boundary,
      bbox: geometry.bbox, area_px: Math.round(geometry.area), geometry_mode: "dark_component",
      seed_relation: "enclosed", marker_area_px: pixels.length, marker_bbox: geometry.bbox,
      confidence: clamp(contrast / background, 0, 1), candidate_count: 1,
      warnings: ["large_seed_connected_chromatic_solid_recovered"],
      audit: { local_only: true, raw_media_retained: false, network_request_made: false },
      diagnostics: { method: "seed_connected_chromatic_component", roi_radius: analysisRadius,
        solid_component_contrast: contrast, solid_component_fill_ratio: fill,
        solid_component_core_dark_ratio: coreRatio },
    } as ControlledMarkerDetection);
    if (candidateShapeCompactness(candidate) < 0.55
      || !isSimpleBoundary(candidate.boundary, image)
      || candidate.boundary.some(p => Math.hypot(p.x - seed.x, p.y - seed.y) > scanRadius + 1)) continue;
    selected = candidate;
  }
  return selected;
}

function recoverLargeChromaticSolid(
  image: MarkerImageData, seed: MarkerPoint, analysisRadius: number, scanRadius: number,
): ControlledMarkerDetection | null {
  // The pointer expresses ownership, not the lesion's colour or centre. A
  // bounded set of distinct anchors proposes the same complete object; its
  // own centre then supplies the final colour reference. Original scan and
  // pointer ownership are checked again after that recentering.
  if (scanRadius <= analysisRadius * 1.5) return null;
  const step = Math.max(1, Math.round(analysisRadius / 2));
  const offsets = [-2, -1, 0, 1, 2].flatMap(y => [-2, -1, 0, 1, 2]
    .map(x => ({ x: x * step, y: y * step })))
    .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const candidates: ControlledMarkerDetection[] = [];
  const owned = (candidate: ControlledMarkerDetection) => {
    if (!candidate.ok || !candidate.center || !candidate.bbox) return false;
    const edgeTolerance = Math.min(analysisRadius * 0.12,
      Math.min(candidate.bbox.width, candidate.bbox.height) * 0.06);
    return (boundaryContains(seed, candidate.boundary)
      || boundaryDistance(seed, candidate.boundary) <= edgeTolerance)
      && candidate.boundary.every(p => Math.hypot(p.x - seed.x, p.y - seed.y) <= scanRadius + 1);
  };
  for (const offset of offsets) {
    const anchor = { x: seed.x + offset.x, y: seed.y + offset.y };
    if (anchor.x < 0 || anchor.y < 0 || anchor.x >= image.width || anchor.y >= image.height
      || Math.hypot(offset.x, offset.y) >= scanRadius) continue;
    const proposal = recoverLargeChromaticSolidAtAnchor(image, anchor, analysisRadius, scanRadius);
    if (!proposal || !owned(proposal)) continue;
    const canonical = recoverLargeChromaticSolidAtAnchor(image, proposal.center!, analysisRadius, scanRadius);
    // A failed centre verification is not repaired by retaining a favourable
    // peripheral colour sample. Each anchor contributes at most one vote.
    if (!canonical || !owned(canonical)) continue;
    candidates.push(canonical);
  }
  const groups = candidates.map(candidate => ({ candidate, support: candidates.filter(other => (
    Math.hypot(other.center!.x - candidate.center!.x, other.center!.y - candidate.center!.y)
      <= analysisRadius * 0.22
    && Math.max(other.area_px, candidate.area_px) / Math.max(1, Math.min(other.area_px, candidate.area_px)) <= 1.25
  )) })).filter(group => group.support.length >= 2)
    .sort((a, b) => b.support.length - a.support.length);
  if (!groups.length) return null;
  const group = groups[0];
  const selected = [...group.support].sort((a, b) => a.area_px - b.area_px)[Math.floor(group.support.length / 2)];
  if (groups.some(other => other.candidate.center && !boundaryContains(other.candidate.center, selected.boundary)
    && other.candidate.area_px >= selected.area_px * 0.65)) return null;
  return { ...selected,
    warnings: [...selected.warnings, "large_chromatic_distinct_anchor_consensus"],
    diagnostics: { ...selected.diagnostics, chromatic_anchor_count: candidates.length,
      chromatic_anchor_consensus_count: group.support.length } as ControlledMarkerDetection["diagnostics"],
  };
}

function recoverScanSolidCandidate(
  image: MarkerImageData, seed: MarkerPoint, options: ControlledMarkerOptions,
  analysisRadius: number, scanRadius: number, witness: ControlledMarkerDetection,
): ControlledMarkerDetection | null {
  const proposals: ControlledMarkerDetection[] = [];
  recoverSolidComponentNearSeed(image, seed, witness, {
    ...options, roiRadius: scanRadius,
    __solidAnalysisRadius: analysisRadius, __solidProposalCollector: proposals,
  } as ControlledMarkerOptions);
  // A scan-wide threshold can merge a lesion into a shadow or wrinkle. Use
  // overlapping fixed-scale regions only to propose centres; clipped dark
  // components cannot provide complete-object evidence.
  const step = Math.max(8, Math.round(analysisRadius * 0.65));
  for (const dy of [-step, 0, step]) for (const dx of [-step, 0, step]) {
    // 提案窗口固定在原图网格上，避免轻微移动点击点就同时移动
    // 所有阈值窗口、漏掉完整暗色主体。原扫描圈仍决定最终归属。
    const localSeed = {
      x: Math.round(seed.x / step) * step + dx,
      y: Math.round(seed.y / step) * step + dy,
    };
    if (localSeed.x < 0 || localSeed.y < 0 || localSeed.x >= image.width || localSeed.y >= image.height
      || Math.hypot(dx, dy) > scanRadius) continue;
    const local: ControlledMarkerDetection[] = [];
    recoverSolidComponentNearSeed(image, localSeed, witness, {
      ...options, roiRadius: analysisRadius,
      // The analysis window may clip the same lesion when the pointer is
      // offset. Keep those proposals, then require cross-window consensus
      // below instead of discarding them at the first local window.
      __solidProposalCollector: local, __requireUnclippedSolidProposal: false,
    } as ControlledMarkerOptions);
    for (const candidate of local) {
      if (!candidate.center || proposals.some((prior) => prior.center
        && Math.hypot(prior.center.x - candidate.center!.x, prior.center.y - candidate.center!.y) < 1)) continue;
      proposals.push(candidate);
    }
  }
  proposals.sort((a, b) => b.area_px - a.area_px);
  const accepted: ControlledMarkerDetection[] = [];
  const evidence = colorDifferenceEvidenceImage(image, seed, {
    ...options, roiRadius: scanRadius,
    expectedDiameterPx: Number(options.expectedDiameterPx) > 0
      ? options.expectedDiameterPx : analysisRadius * 0.075 / 0.14,
  });
  for (const proposal of proposals.slice(0, 16)) {
    if (!proposal.center || Number(proposal.diagnostics?.solid_component_core_dark_ratio || 0)
      < MIN_SOLID_COMPONENT_CORE_DARK_RATIO) continue;
    const proposalConsensusCount = proposals.filter((other) => other.center
      && Math.hypot(other.center.x - proposal.center!.x, other.center.y - proposal.center!.y) <= 8).length;
    if (proposalConsensusCount < 2) continue;
    const localOptions = { ...options, roiRadius: analysisRadius, __scanCoverageRadius: scanRadius };
    const local = detectControlledMarkerInternal(image, proposal.center, localOptions, false, true);
    if (!local.ok || local.geometry_mode !== "dark_component" || !local.center) continue;
    const expected = Number(options.expectedDiameterPx || 0);
    const canonical = canonicalizeSolidCycle(local, (candidate) => canonicalizeSolidRecovery(
      image, candidate, local, seed, localOptions, evidence, analysisRadius, expected,
    ));
    // Envelope growth is evaluated against the operator's original scan,
    // rather than growing around the proposal and rejecting it afterwards.
    const canonicalWithSupport = {
      ...canonical,
      diagnostics: {
        ...(canonical.diagnostics || {}),
        scan_solid_proposal_count: proposals.length,
        scan_solid_proposal_consensus_count: proposalConsensusCount,
      },
    };
    const centered = expandSolidBoundaryEnvelope(canonicalWithSupport, image, evidence, seed,
      analysisRadius, expected, Number(options.scanDiameterMm || 0), scanRadius);
    if (!candidateGate(centered, seed, expected, evidence,
      analysisRadius, Number(options.scanDiameterMm || 0), scanRadius).valid) continue;
    accepted.push(acceptRecovered({
      ...centered,
      diagnostics: { ...centered.diagnostics,
        scan_solid_proposal_core_dark_ratio: proposal.diagnostics?.solid_component_core_dark_ratio,
        scan_solid_proposal_area_px: proposal.area_px,
        scan_solid_analysis_radius: analysisRadius,
        scan_solid_proposal_count: proposals.length,
        scan_solid_proposal_consensus_count: proposalConsensusCount,
      } as ControlledMarkerDetection["diagnostics"],
    }, ["scan_solid_core_anchor_recovered", "fixed_scale_unclipped_solid_anchor_recovered"]));
  }
  return accepted.sort((a, b) => b.area_px - a.area_px)[0] || null;
}

export function detectControlledMarker(
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions = {},
): ControlledMarkerDetection {
  const scanRadius = clamp(
    Math.round(options.roiRadius ?? fallbackRoiRadius(image)),
    1,
    Math.max(image.width, image.height),
  );
  const analysisRoiRadius = clamp(
    Math.round(options.analysisRoiRadius ?? scanRadius),
    1,
    Math.max(image.width, image.height),
  );
  const analysisOptions = { ...options, roiRadius: analysisRoiRadius, __scanCoverageRadius: scanRadius };
  const finish = (candidate: ControlledMarkerDetection): ControlledMarkerDetection => {
    const envelope = adjustHollowEnvelope(candidate, image, seed, scanRadius);
    const regularized = regularizeAcceptedBoundary(envelope);
    // 已选对象的光度证据绑定其中心；点击点只控制原扫描覆盖。
    // 不降低环颜色门槛，避免同一条轮廓因点击点背景不同而退回旧凹陷。
    const evidenceCenter = envelope.center || seed;
    const adjusted = regularized !== envelope && candidateGate(regularized, seed,
      Number(options.expectedDiameterPx || 0), colorDifferenceEvidenceImage(image, evidenceCenter, analysisOptions),
      analysisRoiRadius, Number(options.scanDiameterMm || 0), scanRadius).valid ? regularized : envelope;
    const outsideScan = adjusted.ok && adjusted.boundary.some((point) => (
      Math.hypot(point.x - seed.x, point.y - seed.y) > scanRadius + 1
    ));
    const finished = outsideScan
      ? rejectCandidate(adjusted, null, ["candidate_outside_scan_roi"])
      : adjusted;
    finished.scan = {
      ...(finished.scan || {}),
      radius_px: scanRadius,
      diameter_mm: Number.isFinite(Number(options.scanDiameterMm)) ? Number(options.scanDiameterMm) : null,
      expected_diameter_px: Number.isFinite(Number(options.expectedDiameterPx)) ? Number(options.expectedDiameterPx) : null,
    };
    if (options.analysisRoiRadius !== undefined) {
      finished.diagnostics = { ...finished.diagnostics, analysis_roi_radius: analysisRoiRadius };
    }
    return finished;
  };
  const result = detectControlledMarkerInternal(image, seed, analysisOptions, true, true);
  // 分析半径是候选判别的尺度，扫描半径是操作者允许的覆盖范围。
  // 15mm在部分照片上换算为34px，不能因它小于36px分析标尺而
  // 跳过完整候选搜索、退回对落点敏感的局部阈值分支。
  // 提案可以使用固定分析尺度；最终边界仍逐点受原扫描圈约束。
  if (options.analysisRoiRadius !== undefined
    && Number.isInteger(image.width) && Number.isInteger(image.height)
    && image.width > 0 && image.height > 0 && image.data.length >= image.width * image.height * 4
    && Number.isFinite(seed.x) && Number.isFinite(seed.y) && seed.x >= 0 && seed.y >= 0
    && seed.x < image.width && seed.y < image.height) {
    const enclosed = recoverScanEnclosedCandidate(image, seed, options, analysisRoiRadius, scanRadius);
    const solid = recoverScanSolidCandidate(image, seed, options, analysisRoiRadius, scanRadius, result);
    const hollow = enclosed || (result.ok && result.geometry_mode === "enclosed_region" ? result : null);
    const large = recoverLargeChromaticSolid(image, seed, analysisRoiRadius, scanRadius);
    if (large && (!hollow || large.area_px > hollow.area_px * 4)
      && (!solid || large.area_px > solid.area_px * 4)) return finish(large);
    // A complete ring remains primary beside a small dark distractor. A much
    // larger validated filled target can replace a tiny enclosed skin patch.
    if (solid && (!hollow || solid.area_px > hollow.area_px * 2)) return finish(solid);
    if (enclosed) return finish(enclosed);
  }
  if (!result.ok
    && !(options as ControlledMarkerOptions & { __skipBrightnessRecovery?: boolean }).__skipBrightnessRecovery
    && result.failure_code !== "invalid_image"
    && result.failure_code !== "seed_outside_image") {
    const normalized = normalizeBrightnessImage(image);
    const normalizedResult = detectControlledMarker(
      normalized,
      seed,
      { ...options, __skipBrightnessRecovery: true } as ControlledMarkerOptions,
    );
    if (normalizedResult.ok) {
      return finish({
        ...normalizedResult,
        warnings: [...new Set([
          ...normalizedResult.warnings,
          "brightness_normalized_recovery",
          `original_failure:${result.failure_code || "invalid_candidate"}`,
        ])],
      });
    }
  }
  if (result.ok && result.center && result.geometry_mode === "dark_component") {
    const evidenceImage = colorDifferenceEvidenceImage(image, seed, analysisOptions);
    const requestedExpectedDiameter = Number(options.expectedDiameterPx || 0) > 0
      ? Number(options.expectedDiameterPx)
      : 0;
    const canonical = canonicalizeSolidCycle(result, (candidate) => canonicalizeSolidRecovery(
      image, candidate, result, seed, analysisOptions, evidenceImage, analysisRoiRadius, requestedExpectedDiameter,
    ));
    const expanded = expandSolidBoundaryEnvelope(
      canonical,
      image,
      evidenceImage,
      seed,
      analysisRoiRadius,
      requestedExpectedDiameter,
      Number(options.scanDiameterMm || 0),
      Number((analysisOptions as ControlledMarkerOptions & { __scanCoverageRadius?: number }).__scanCoverageRadius
        || analysisRoiRadius),
    );
    const expandedCenterDistance = expanded.center
      ? Math.hypot(expanded.center.x - seed.x, expanded.center.y - seed.y)
      : Number.POSITIVE_INFINITY;
    if (scanRadius > analysisRoiRadius * EXPANDED_SCAN_SOLID_CENTER_GUARD_RATIO
      && expandedCenterDistance > analysisRoiRadius * MAX_EXPANDED_SCAN_SOLID_CENTER_RATIO) {
      const colorEvidence = colorDifferenceEvidenceImage(image, seed, analysisOptions);
      const requestedExpectedDiameter = Number(options.expectedDiameterPx || 0) > 0
        ? Number(options.expectedDiameterPx)
        : 0;
      const colorCandidate = detectWithLegacyCore(
        colorEvidence,
        seed,
        { ...analysisOptions, __rejectDegenerateCandidates: true } as ControlledMarkerOptions,
      ) as unknown as ControlledMarkerDetection;
      const colorGate = candidateGate(
        colorCandidate,
        seed,
        requestedExpectedDiameter,
        colorEvidence,
        analysisRoiRadius,
        Number(options.scanDiameterMm || 0),
        scanRadius,
      );
      if (colorCandidate.ok && colorCandidate.geometry_mode === "enclosed_region" && colorGate.valid) {
        return finish(acceptRecovered(colorCandidate, [
          "color_difference_enclosed_candidate_preferred",
          "solid_candidate_outside_analysis_roi",
        ]));
      }
      return finish(rejectCandidate(expanded, null, ["solid_candidate_outside_analysis_roi"]));
    }
    return finish(expanded);
  }
  if (!result.ok || !result.center || result.geometry_mode !== "enclosed_region") return finish(result);
  const canonical = detectControlledMarkerInternal(image, result.center, analysisOptions, false);
  const evidenceImage = colorDifferenceEvidenceImage(image, seed, analysisOptions);
  const requestedExpectedDiameter = Number(options.expectedDiameterPx || 0) > 0
    ? Number(options.expectedDiameterPx)
    : 0;
  if (!canonical.center || !candidateGate(canonical, seed, requestedExpectedDiameter, evidenceImage, analysisRoiRadius,
    Number(options.scanDiameterMm || 0)).valid || !compatibleNeighborhoodRecovery(result, canonical)) return finish(result);
  const sameBoundary = result.boundary.length === canonical.boundary.length
    && result.boundary.every((point, index) => (
      Math.hypot(point.x - canonical.boundary[index].x, point.y - canonical.boundary[index].y) <= 1e-9
    ));
  if (sameBoundary && Math.abs(result.area_px - canonical.area_px) <= 1e-9
    && Math.hypot(result.center.x - canonical.center.x, result.center.y - canonical.center.y) <= 1e-9) return finish(result);
  return finish(acceptRecovered(canonical, ["enclosed_region_center_canonicalized"]));
}

export const __controlledMarkerColorForTests = {
  regularizeAcceptedBoundary,
  scanEnclosedAnchors,
  canonicalizeSolidCycle,
  adjustHollowEnvelope,
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
