import {
  CONTROLLED_MARKER_DETECTOR_VERSION as LEGACY_DETECTOR_VERSION,
  detectControlledMarker as detectWithLegacyCore,
} from "./controlledMarkerDetectionLegacyV023.ts";
import type {
  ControlledMarkerDetection,
  ControlledMarkerOptions,
  MarkerImageData,
  MarkerPoint,
} from "./controlledMarkerDetection.ts";

export const CONTROLLED_MARKER_DETECTOR_VERSION = "0.35";
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

  // shape_compactness describes the noisy pre-regularization raster outline.
  // Only when the frozen legacy core proves that its bounded regularization was
  // local and conservative should the color profile judge the emitted boundary
  // rather than reject an otherwise well-supported thin pen ring.
  return tightlyBoundedRegularization || tightlyBoundedStrokeEnvelope || supportedNarrowSpurTrim
    ? emittedCompactness
    : rawCompactness;
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
): CandidateGate {
  const reasons: string[] = [];
  if (!result.ok || !result.center || !result.bbox || result.boundary.length < 3
    || result.geometry_mode !== "enclosed_region") {
    return { valid: false, reasons: ["not_enclosed_region"] };
  }
  const detectedDiameter = Math.max(result.bbox.width, result.bbox.height);
  const aspectRatio = Math.min(result.bbox.width, result.bbox.height) / Math.max(1, detectedDiameter);
  const compactness = candidateShapeCompactness(result);
  const requestedRatio = requestedExpectedDiameter > 0
    ? detectedDiameter / requestedExpectedDiameter
    : 1;
  const colorSupport = boundaryColorSupport(evidenceImage, result.boundary);

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
  if (requestedRatio < MINIMUM_REQUESTED_DIAMETER_RATIO
    || requestedRatio > MAXIMUM_REQUESTED_DIAMETER_RATIO) {
    reasons.push("candidate_size_mismatch");
  }
  if (colorSupport.p20 < 45 || colorSupport.supportRatio < 0.65) {
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
  );
  if (legacyGate.valid) {
    if (!allowAcceptedCandidateComparison) return legacy;
    try {
      // One original-scale comparison only. Never enter scale/denoise/retry recovery here.
      const alternative = detectWithLegacyCore(evidenceImage, seed, legacyOptions) as unknown as ControlledMarkerDetection;
      if (candidateGate(alternative, seed, requestedExpectedDiameter, evidenceImage, roiRadius).valid
        && compareAcceptedCandidateCompleteness(legacy.boundary, alternative.boundary, evidenceImage).preferCandidate
        && candidateGate(alternative, seed, requestedExpectedDiameter, evidenceImage, roiRadius).valid) {
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
  compareAcceptedCandidateCompleteness,
  boundaryColorSupport,
  candidateGate,
  candidateShapeCompactness,
  colorDifferenceEvidenceImage,
  denoisedColorDifferenceEvidenceImage,
  reconcileDenoisedStrokeEnvelope,
  trimSupportedNarrowBoundarySpur,
  rgbToLab,
};
