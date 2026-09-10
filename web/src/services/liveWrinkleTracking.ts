import type { SurfaceRef } from "./incisionOverlay.ts";
import { RIGID3D } from "./constantsGenerated.ts";
import { sourcePointToSurfaceRef, surfaceRefToSourcePoint } from "./photoPlanningController.ts";
import type { Triangle, Vec3 } from "./softBody.ts";

export interface TrackableWrinkleLine {
  id: string;
  className: string;
  points: Array<[number, number]>;
}

interface WeightedLandmark {
  index: number;
  weight: number;
  reference: [number, number];
}

interface TrackedPoint {
  source: [number, number];
  surfaceRef: SurfaceRef | null;
  fallback: WeightedLandmark[];
  fallbackOffset: [number, number];
}

export interface TrackedWrinkleLine {
  id: string;
  className: string;
  points: TrackedPoint[];
}

const FALLBACK_LANDMARK_COUNT = 4;
const FACE_MESH_LANDMARK_COUNT = 468;

function finiteVec3(point: Vec3 | undefined): point is Vec3 {
  return Boolean(point
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
    && Number.isFinite(point[2] ?? 0));
}

/**
 * Remove smoothing delay from rigid head motion and coherent local expression
 * changes. Tiny raw/smoothed differences stay inside a face-relative deadband,
 * while isolated mesh spikes are rejected through triangle adjacency.
 */
export function buildLowLatencyWrinkleLandmarks(
  smoothedLandmarks: readonly Vec3[],
  currentLandmarks: readonly Vec3[],
  triangles: readonly Triangle[] = [],
  anchorIndices: readonly number[] = RIGID3D,
): Vec3[] {
  if (!smoothedLandmarks.length || smoothedLandmarks.length !== currentLandmarks.length) {
    return smoothedLandmarks.map((point) => [...point] as Vec3);
  }
  const pairs = anchorIndices
    .map((index) => ({
      source: smoothedLandmarks[index],
      target: currentLandmarks[index],
    }))
    .filter((pair): pair is { source: Vec3; target: Vec3 } => (
      finiteVec3(pair.source) && finiteVec3(pair.target)
    ));
  if (pairs.length < 3) return smoothedLandmarks.map((point) => [...point] as Vec3);

  const sourceCenter: [number, number] = [0, 0];
  const targetCenter: [number, number] = [0, 0];
  for (const pair of pairs) {
    sourceCenter[0] += pair.source[0] / pairs.length;
    sourceCenter[1] += pair.source[1] / pairs.length;
    targetCenter[0] += pair.target[0] / pairs.length;
    targetCenter[1] += pair.target[1] / pairs.length;
  }

  let dot = 0;
  let cross = 0;
  let denominator = 0;
  let motionSquared = 0;
  let faceRadiusSquared = 0;
  for (const pair of pairs) {
    const sx = pair.source[0] - sourceCenter[0];
    const sy = pair.source[1] - sourceCenter[1];
    const tx = pair.target[0] - targetCenter[0];
    const ty = pair.target[1] - targetCenter[1];
    dot += sx * tx + sy * ty;
    cross += sx * ty - sy * tx;
    denominator += sx * sx + sy * sy;
    const dx = pair.target[0] - pair.source[0];
    const dy = pair.target[1] - pair.source[1];
    motionSquared += dx * dx + dy * dy;
    faceRadiusSquared += sx * sx + sy * sy;
  }
  if (denominator < 1e-8) return smoothedLandmarks.map((point) => [...point] as Vec3);

  let a = dot / denominator;
  let b = cross / denominator;
  const scale = Math.hypot(a, b);
  const rotation = Math.abs(Math.atan2(b, a));
  // A large one-frame scale/rotation discrepancy is an unstable landmark fit.
  // Translation remains useful and safe, so only suppress those two components.
  if (scale < 0.92 || scale > 1.08 || rotation > 12 * Math.PI / 180) {
    a = 1;
    b = 0;
  }

  const motionRms = Math.sqrt(motionSquared / pairs.length);
  const faceRadius = Math.sqrt(faceRadiusSquared / pairs.length);
  const deadband = Math.max(0.45, faceRadius * 0.004);
  const fullCorrection = Math.max(deadband + 1e-6, faceRadius * 0.035);
  const correctionWeight = Math.max(0, Math.min(
    1,
    (motionRms - deadband) / (fullCorrection - deadband),
  ));
  const blendedA = 1 + (a - 1) * correctionWeight;
  const blendedB = b * correctionWeight;
  const centerX = sourceCenter[0]
    + (targetCenter[0] - sourceCenter[0]) * correctionWeight;
  const centerY = sourceCenter[1]
    + (targetCenter[1] - sourceCenter[1]) * correctionWeight;
  const rigidCorrected = smoothedLandmarks.map((point) => {
    const x = point[0] - sourceCenter[0];
    const y = point[1] - sourceCenter[1];
    return [
      centerX + blendedA * x - blendedB * y,
      centerY + blendedB * x + blendedA * y,
      point[2] ?? 0,
    ] as Vec3;
  });

  // Rigid compensation fixes head motion, but eyebrow, eyelid and cheek
  // deformation can still visibly trail because it remains in the smoothed
  // local coordinates. Pass coherent local motion through to the current
  // frame, retaining a subpixel deadband and rejecting isolated mesh spikes.
  const residuals = rigidCorrected.map((point, index) => [
    currentLandmarks[index][0] - point[0],
    currentLandmarks[index][1] - point[1],
  ] as [number, number]);
  const neighbours = Array.from({ length: smoothedLandmarks.length }, () => [] as number[]);
  for (const triangle of triangles) {
    const [aIndex, bIndex, cIndex] = triangle;
    if (aIndex < 0 || bIndex < 0 || cIndex < 0
        || aIndex >= neighbours.length || bIndex >= neighbours.length
        || cIndex >= neighbours.length) {
      continue;
    }
    neighbours[aIndex].push(bIndex, cIndex);
    neighbours[bIndex].push(aIndex, cIndex);
    neighbours[cIndex].push(aIndex, bIndex);
  }
  const median = (values: number[]): number => {
    const sorted = values.sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const localDeadband = Math.max(0.25, faceRadius * 0.0015);
  const fullLocalCorrection = Math.max(localDeadband + 1e-6, faceRadius * 0.007);

  return rigidCorrected.map((point, index) => {
    let [dx, dy] = residuals[index];
    const adjacent = neighbours[index];
    if (adjacent.length) {
      const unique = [...new Set(adjacent)];
      const local = [index, ...unique]
        .map((landmarkIndex) => residuals[landmarkIndex])
        .filter((residual): residual is [number, number] => Boolean(residual));
      const medianDx = median(local.map((residual) => residual[0]));
      const medianDy = median(local.map((residual) => residual[1]));
      const disagreement = Math.hypot(dx - medianDx, dy - medianDy);
      const localMotion = Math.hypot(medianDx, medianDy);
      const isolatedSpikeThreshold = Math.max(
        2.5,
        faceRadius * 0.015,
        localMotion * 2.5 + localDeadband,
      );
      if (disagreement > isolatedSpikeThreshold) {
        dx = medianDx;
        dy = medianDy;
      }
    }

    const residualMagnitude = Math.hypot(dx, dy);
    const normalized = Math.max(0, Math.min(
      1,
      (residualMagnitude - localDeadband) / (fullLocalCorrection - localDeadband),
    ));
    const localWeight = normalized * normalized * (3 - 2 * normalized);
    return [
      point[0] + dx * localWeight,
      point[1] + dy * localWeight,
      point[2] ?? 0,
    ] as Vec3;
  });
}

function nearestLandmarkWeights(
  point: [number, number],
  landmarks: readonly Vec3[],
): WeightedLandmark[] {
  const nearest: Array<{ index: number; distanceSquared: number }> = [];
  const limit = Math.min(FACE_MESH_LANDMARK_COUNT, landmarks.length);
  for (let index = 0; index < limit; index += 1) {
    const landmark = landmarks[index];
    if (!landmark) continue;
    const dx = point[0] - landmark[0];
    const dy = point[1] - landmark[1];
    const distanceSquared = dx * dx + dy * dy;
    nearest.push({ index, distanceSquared });
  }
  nearest.sort((a, b) => a.distanceSquared - b.distanceSquared);
  const selected = nearest.slice(0, FALLBACK_LANDMARK_COUNT);
  if (!selected.length) return [];
  if (selected[0].distanceSquared < 1e-8) {
    const landmark = landmarks[selected[0].index];
    return [{ index: selected[0].index, weight: 1, reference: [landmark[0], landmark[1]] }];
  }
  const inverse = selected.map((item) => 1 / Math.max(1, item.distanceSquared));
  const total = inverse.reduce((sum, value) => sum + value, 0);
  return selected.map((item, index) => ({
    index: item.index,
    weight: inverse[index] / total,
    reference: [landmarks[item.index][0], landmarks[item.index][1]],
  }));
}

function weightedLandmarkPoint(
  anchors: readonly WeightedLandmark[],
  landmarks: readonly Vec3[],
): [number, number] | null {
  let x = 0;
  let y = 0;
  let total = 0;
  for (const anchor of anchors) {
    const landmark = landmarks[anchor.index];
    if (!landmark) continue;
    x += landmark[0] * anchor.weight;
    y += landmark[1] * anchor.weight;
    total += anchor.weight;
  }
  return total > 0 ? [x / total, y / total] : null;
}

/**
 * Capture wrinkle coordinates in the same facial reference frame as the
 * detector input. Points inside the mesh use barycentric surface references;
 * forehead/temple points outside it follow their nearest facial landmarks.
 */
export function bindWrinkleLinesToFace(
  lines: readonly TrackableWrinkleLine[],
  landmarks: readonly Vec3[],
  triangles: readonly Triangle[],
): TrackedWrinkleLine[] {
  return lines.map((line) => ({
    id: line.id,
    className: line.className,
    points: line.points.map((point) => {
      const fallback = nearestLandmarkWeights(point, landmarks);
      const anchor = weightedLandmarkPoint(fallback, landmarks) || point;
      return {
        source: [point[0], point[1]],
        surfaceRef: sourcePointToSurfaceRef(
          { x: point[0], y: point[1] },
          landmarks,
          triangles,
        ),
        fallback,
        fallbackOffset: [point[0] - anchor[0], point[1] - anchor[1]],
      };
    }),
  }));
}

function mapFallbackPoint(
  point: TrackedPoint,
  landmarks: readonly Vec3[],
): [number, number] {
  const anchor = weightedLandmarkPoint(point.fallback, landmarks);
  if (!anchor) return point.source;
  const referenceCenter = point.fallback.reduce(
    (center, item) => [
      center[0] + item.reference[0] * item.weight,
      center[1] + item.reference[1] * item.weight,
    ],
    [0, 0],
  );
  let dot = 0;
  let cross = 0;
  let denominator = 0;
  for (const item of point.fallback) {
    const current = landmarks[item.index];
    if (!current) continue;
    const sx = item.reference[0] - referenceCenter[0];
    const sy = item.reference[1] - referenceCenter[1];
    const tx = current[0] - anchor[0];
    const ty = current[1] - anchor[1];
    dot += item.weight * (sx * tx + sy * ty);
    cross += item.weight * (sx * ty - sy * tx);
    denominator += item.weight * (sx * sx + sy * sy);
  }
  if (denominator < 1e-8) {
    return [anchor[0] + point.fallbackOffset[0], anchor[1] + point.fallbackOffset[1]];
  }
  const dx = (dot * point.fallbackOffset[0] - cross * point.fallbackOffset[1]) / denominator;
  const dy = (cross * point.fallbackOffset[0] + dot * point.fallbackOffset[1]) / denominator;
  return [anchor[0] + dx, anchor[1] + dy];
}

export function mapTrackedWrinkleLines(
  lines: readonly TrackedWrinkleLine[],
  landmarks: readonly Vec3[],
  triangles: readonly Triangle[],
): TrackableWrinkleLine[] {
  return lines.map((line) => ({
    id: line.id,
    className: line.className,
    points: line.points.map((point) => {
      if (point.surfaceRef) {
        const mapped = surfaceRefToSourcePoint(point.surfaceRef, landmarks, triangles);
        if (mapped) return [mapped.x, mapped.y];
      }
      return mapFallbackPoint(point, landmarks);
    }),
  }));
}
