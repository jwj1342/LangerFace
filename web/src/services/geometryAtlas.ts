import {
  DEFAULT_OCCLUSION_THRESHOLD,
  INNER_LIP as INNER_LIP_IDX,
  NOSE_TIP,
  TOPOLOGY_ID,
  TOPOLOGY_VERSION,
} from "./constantsGenerated.ts";
import type { Triangle, Vec3 } from "./softBody";

type Vec2 = [number, number];

export { NOSE_TIP };

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

export type AtlasPoint = [number, number, number];

export interface AtlasLine {
  name?: string;
  region?: string;
  disableRuntimeExpansion?: boolean;
  postExpansionOffsetsFaceRatioSparse?: Array<[number, number, number]>;
  postMapSmoothingPasses?: number;
  postMapCubicFairing?: boolean;
  postMapTemporalCubicFaceRatio?: [number, Vec2, Vec2, Vec2];
  postMapTemporalAbsoluteEndpoint?: boolean;
  postMapTemporalBoundaryMarginFaceRatio?: number;
  points?: AtlasPoint[];
}

export interface AtlasPayload {
  topologyId?: string;
  topologyVersion?: string;
  lines?: AtlasLine[];
}

export interface MappedAtlasLine {
  name: string;
  /** 显示期需要按 region 决定后处理（额头外推线要额外裁剪，见 #141）。 */
  region: string;
  pts: Vec3[];
  tris: number[];
}

export interface VisibleTriangleOptions {
  minTriangleAreaPx2?: number;
}

export interface MapAtlasOptions {
  expandForehead?: boolean;
}

const FOREHEAD_LOWER_LONG_ARC_REGION = "forehead_lower_long_arc_v13";
const FOREHEAD_BRIDGE_ARC_REGION = "forehead_bridge_arc_v15";
const SUPRAORBITAL_SHORT_ARC_REGIONS_V67 = new Set([
  "supraorbital_lateral_short_arc_v67",
  "supraorbital_medial_short_arc_v67",
]);
const SUPRAORBITAL_UPWARD_SHIFT_FACE_HEIGHT_V67 = 0.080;
const SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V68 = "supraorbital_medial_short_arc_v68";
const SUPRAORBITAL_MEDIAL_UPWARD_SHIFT_FACE_HEIGHT_V68 = 0.040;

function raiseSupraorbitalShortArc(
  points: Vec3[], landmarksPx: Vec3[], shiftFaceHeight: number,
): Vec3[] {
  if (points.length === 0 || landmarksPx.length <= 10) return points;
  const anchor = landmarksPx[9];
  const top = landmarksPx[10];
  const axisX = top[0] - anchor[0];
  const axisY = top[1] - anchor[1];
  const axisNorm = Math.hypot(axisX, axisY);
  const landmarkYs = landmarksPx.map((point) => point[1]);
  const faceHeight = Math.max(...landmarkYs) - Math.min(...landmarkYs);
  if (axisNorm <= 1e-9 || faceHeight <= 1e-9) return points;
  const shift = shiftFaceHeight * faceHeight;
  const unitX = axisX / axisNorm;
  const unitY = axisY / axisNorm;
  return points.map((point) => [
    point[0] + shift * unitX,
    point[1] + shift * unitY,
    point[2],
  ]);
}

function smoothMappedCurve(points: Vec3[], passes: number): Vec3[] {
  let out = points.map((point) => [...point] as Vec3);
  const count = Math.max(0, Math.min(32, Math.trunc(Number(passes) || 0)));
  for (let pass = 0; pass < count && out.length >= 3; pass += 1) {
    const smoothed = out.map((point) => [...point] as Vec3);
    for (let index = 1; index < out.length - 1; index += 1) {
      smoothed[index][0] = 0.25 * out[index - 1][0] + 0.5 * out[index][0] + 0.25 * out[index + 1][0];
      smoothed[index][1] = 0.25 * out[index - 1][1] + 0.5 * out[index][1] + 0.25 * out[index + 1][1];
    }
    out = smoothed;
  }
  return out;
}

function fairMappedCurveCubic(points: Vec3[]): Vec3[] {
  const out = points.map((point) => [...point] as Vec3);
  if (out.length < 4) return out;
  const cumulative = new Array<number>(out.length).fill(0);
  for (let index = 1; index < out.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + Math.hypot(
      out[index][0] - out[index - 1][0],
      out[index][1] - out[index - 1][1],
    );
  }
  const length = cumulative.at(-1) ?? 0;
  if (!(length > 1e-9)) return out;
  const source = out.map((point) => [point[0], point[1]]);
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  const r1 = [0, 0];
  const r2 = [0, 0];
  const basis = cumulative.map((distance, index) => {
    const t = distance / length;
    const oneMinusT = 1 - t;
    const b0 = oneMinusT ** 3;
    const b1 = 3 * oneMinusT ** 2 * t;
    const b2 = 3 * oneMinusT * t ** 2;
    const b3 = t ** 3;
    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    for (let axis = 0; axis < 2; axis += 1) {
      const residual = out[index][axis] - b0 * out[0][axis] - b3 * out.at(-1)![axis];
      r1[axis] += b1 * residual;
      r2[axis] += b2 * residual;
    }
    return [b0, b1, b2, b3];
  });
  const determinant = a11 * a22 - a12 * a12;
  if (Math.abs(determinant) <= 1e-12) return out;
  const control1 = r1.map((value, axis) => (
    (a22 * value - a12 * r2[axis]) / determinant
  ));
  const control2 = r2.map((value, axis) => (
    (a11 * value - a12 * r1[axis]) / determinant
  ));
  for (let index = 1; index < out.length - 1; index += 1) {
    const [b0, b1, b2, b3] = basis[index];
    for (let axis = 0; axis < 2; axis += 1) {
      out[index][axis] = b0 * out[0][axis] + b1 * control1[axis]
        + b2 * control2[axis] + b3 * out.at(-1)![axis];
    }
  }
  let hasClockwiseTurn = false;
  let hasCounterclockwiseTurn = false;
  for (let index = 0; index < out.length - 2; index += 1) {
    const firstX = out[index + 1][0] - out[index][0];
    const firstY = out[index + 1][1] - out[index][1];
    const secondX = out[index + 2][0] - out[index + 1][0];
    const secondY = out[index + 2][1] - out[index + 1][1];
    const scale = Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY);
    const turnSine = scale > 1e-12
      ? (firstX * secondY - firstY * secondX) / scale
      : 0;
    hasClockwiseTurn ||= turnSine < -1e-6;
    hasCounterclockwiseTurn ||= turnSine > 1e-6;
  }
  if (hasClockwiseTurn && hasCounterclockwiseTurn) {
    let denominator = 0;
    const numerator = [0, 0];
    const quadraticBasis = cumulative.map((distance, index) => {
      const t = distance / length;
      const oneMinusT = 1 - t;
      const q0 = oneMinusT ** 2;
      const q1 = 2 * oneMinusT * t;
      const q2 = t ** 2;
      denominator += q1 * q1;
      for (let axis = 0; axis < 2; axis += 1) {
        const residual = source[index][axis]
          - q0 * source[0][axis] - q2 * source.at(-1)![axis];
        numerator[axis] += q1 * residual;
      }
      return [q0, q1, q2];
    });
    if (denominator > 1e-12) {
      const control = numerator.map((value) => value / denominator);
      for (let index = 1; index < out.length - 1; index += 1) {
        const [q0, q1, q2] = quadraticBasis[index];
        for (let axis = 0; axis < 2; axis += 1) {
          out[index][axis] = q0 * source[0][axis] + q1 * control[axis]
            + q2 * source.at(-1)![axis];
        }
      }
    }
  }
  return out;
}

function extendForeheadLowerLongArc(points: Vec3[], landmarksPx: Vec3[]): Vec3[] {
  if (points.length === 0 || landmarksPx.length <= 10) return points;
  const anchor = landmarksPx[9];
  const top = landmarksPx[10];
  const axisX = top[0] - anchor[0];
  const axisY = top[1] - anchor[1];
  const axisNorm = Math.hypot(axisX, axisY);
  if (axisNorm <= 1e-9) return points;
  const unitX = axisX / axisNorm;
  const unitY = axisY / axisNorm;
  const lateralX = -unitY;
  const lateralY = unitX;
  const out = points.map((point) => [...point] as Vec3);
  const lateralCoordinates = out.map((point) => (
    (point[0] - anchor[0]) * lateralX + (point[1] - anchor[1]) * lateralY
  ));

  for (const point of out) {
    const parallel = (point[0] - anchor[0]) * unitX + (point[1] - anchor[1]) * unitY;
    point[0] += 0.86 * parallel * unitX;
    point[1] += 0.86 * parallel * unitY;
  }

  const currentHalfWidth = Math.max(...lateralCoordinates.map((value) => Math.abs(value)));
  const landmarkXs = landmarksPx.map((point) => point[0]);
  const faceWidth = Math.max(...landmarkXs) - Math.min(...landmarkXs);
  if (currentHalfWidth > 1e-9 && faceWidth > 1e-9) {
    const factor = 0.82 * faceWidth / currentHalfWidth;
    for (let index = 0; index < out.length; index++) {
      out[index][0] += (factor - 1) * lateralCoordinates[index] * lateralX;
      out[index][1] += (factor - 1) * lateralCoordinates[index] * lateralY;
    }
  }

  for (let iteration = 0; iteration < 5; iteration++) {
    const smoothed = out.map((point) => [...point] as Vec3);
    for (let index = 1; index < out.length - 1; index++) {
      smoothed[index][0] = 0.25 * out[index - 1][0] + 0.5 * out[index][0] + 0.25 * out[index + 1][0];
      smoothed[index][1] = 0.25 * out[index - 1][1] + 0.5 * out[index][1] + 0.25 * out[index + 1][1];
    }
    for (let index = 0; index < out.length; index++) out[index] = smoothed[index];
  }

  const laterals = out.map((point) => (
    (point[0] - anchor[0]) * lateralX + (point[1] - anchor[1]) * lateralY
  ));
  const halfWidth = Math.max(...laterals.map((value) => Math.abs(value)));
  const landmarkYs = landmarksPx.map((point) => point[1]);
  const faceHeight = Math.max(...landmarkYs) - Math.min(...landmarkYs);
  if (halfWidth > 1e-9 && faceHeight > 1e-9) {
    for (let index = 0; index < out.length; index++) {
      const normalized = Math.min(1, Math.abs(laterals[index]) / halfWidth);
      const arch = 0.055 * faceHeight * (1 - normalized ** 2.4);
      out[index][0] += arch * unitX;
      out[index][1] += arch * unitY;
    }
  }
  return out;
}

function foreheadBridgeRanks(
  lines: AtlasLine[],
  landmarksPx: Vec3[],
  triangles: Triangle[],
): Map<AtlasLine, number> {
  const bridgeLines = lines.filter((line) => line.region === FOREHEAD_BRIDGE_ARC_REGION);
  if (bridgeLines.length === 0) return new Map();
  if (landmarksPx.length > 10) {
    const anchor = landmarksPx[9];
    const top = landmarksPx[10];
    const axisX = top[0] - anchor[0];
    const axisY = top[1] - anchor[1];
    const axisNorm = Math.hypot(axisX, axisY);
    if (axisNorm > 1e-9) {
      const unitX = axisX / axisNorm;
      const unitY = axisY / axisNorm;
      const meanHeight = (line: AtlasLine): number => {
        let total = 0;
        let count = 0;
        for (const [tri, u, v] of line.points || []) {
          const triangle = triangles[tri];
          if (!triangle) continue;
          const a = landmarksPx[triangle[0]];
          const b = landmarksPx[triangle[1]];
          const c = landmarksPx[triangle[2]];
          if (!a || !b || !c) continue;
          const w = 1 - u - v;
          const x = u * a[0] + v * b[0] + w * c[0];
          const y = u * a[1] + v * b[1] + w * c[1];
          total += (x - anchor[0]) * unitX + (y - anchor[1]) * unitY;
          count++;
        }
        return count > 0 ? total / count : 0;
      };
      bridgeLines.sort((left, right) => meanHeight(right) - meanHeight(left));
    }
  }
  const denominator = Math.max(bridgeLines.length - 1, 1);
  return new Map(bridgeLines.map((line, index) => [line, index / denominator]));
}

function extendForeheadBridge(points: Vec3[], landmarksPx: Vec3[], layerRank: number): Vec3[] {
  if (points.length === 0 || landmarksPx.length <= 10) return points;
  const anchor = landmarksPx[9];
  const top = landmarksPx[10];
  const axisX = top[0] - anchor[0];
  const axisY = top[1] - anchor[1];
  const axisNorm = Math.hypot(axisX, axisY);
  if (axisNorm <= 1e-9) return points;
  const unitX = axisX / axisNorm;
  const unitY = axisY / axisNorm;
  const lateralX = -unitY;
  const lateralY = unitX;
  const out = points.map((point) => [...point] as Vec3);
  const lateral = out.map((point) => (
    (point[0] - anchor[0]) * lateralX + (point[1] - anchor[1]) * lateralY
  ));

  for (const point of out) {
    const parallel = (point[0] - anchor[0]) * unitX + (point[1] - anchor[1]) * unitY;
    point[0] += 0.86 * parallel * unitX;
    point[1] += 0.86 * parallel * unitY;
  }

  const currentHalfWidth = Math.max(...lateral.map((value) => Math.abs(value)));
  const landmarkXs = landmarksPx.map((point) => point[0]);
  const faceWidth = Math.max(...landmarkXs) - Math.min(...landmarkXs);
  if (currentHalfWidth > 1e-9 && faceWidth > 1e-9) {
    const widthFactor = 0.82 * faceWidth / currentHalfWidth;
    for (let index = 0; index < out.length; index++) {
      out[index][0] += (widthFactor - 1) * lateral[index] * lateralX;
      out[index][1] += (widthFactor - 1) * lateral[index] * lateralY;
    }
  }

  for (let iteration = 0; iteration < 5; iteration++) {
    const smoothed = out.map((point) => [...point] as Vec3);
    for (let index = 1; index < out.length - 1; index++) {
      smoothed[index][0] = 0.25 * out[index - 1][0] + 0.5 * out[index][0] + 0.25 * out[index + 1][0];
      smoothed[index][1] = 0.25 * out[index - 1][1] + 0.5 * out[index][1] + 0.25 * out[index + 1][1];
    }
    for (let index = 0; index < out.length; index++) out[index] = smoothed[index];
  }

  const smoothedLateral = out.map((point) => (
    (point[0] - anchor[0]) * lateralX + (point[1] - anchor[1]) * lateralY
  ));
  const halfWidth = Math.max(...smoothedLateral.map((value) => Math.abs(value)));
  const landmarkYs = landmarksPx.map((point) => point[1]);
  const faceHeight = Math.max(...landmarkYs) - Math.min(...landmarkYs);
  if (halfWidth > 1e-9 && faceHeight > 1e-9) {
    for (let index = 0; index < out.length; index++) {
      const normalized = Math.min(1, Math.abs(smoothedLateral[index]) / halfWidth);
      const arch = 0.140 * faceHeight * (1 - normalized ** 2.0);
      out[index][0] += arch * unitX;
      out[index][1] += arch * unitY;
    }
  }
  if (faceHeight > 1e-9) {
    for (const point of out) {
      point[0] -= 0.100 * layerRank * faceHeight * unitX;
      point[1] -= 0.100 * layerRank * faceHeight * unitY;
    }
  }
  return out;
}

function applyPostExpansionOffsets(
  points: Vec3[], line: AtlasLine, landmarksPx: Vec3[],
): Vec3[] {
  const offsets = line.postExpansionOffsetsFaceRatioSparse;
  if (!offsets?.length || landmarksPx.length === 0) return points;
  const xs = landmarksPx.map((point) => point[0]).filter(Number.isFinite);
  const faceWidth = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  if (!(faceWidth > 0)) return points;
  const out = points.map((point) => [...point] as Vec3);
  for (const [pointIndex, dxRatio, dyRatio] of offsets) {
    if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= out.length ||
        !Number.isFinite(dxRatio) || !Number.isFinite(dyRatio)) continue;
    out[pointIndex][0] += dxRatio * faceWidth;
    out[pointIndex][1] += dyRatio * faceWidth;
  }
  return out;
}

function sampleXyByArclength(points: Vec2[], count: number): Vec2[] {
  if (count <= 1) return points.slice(0, 1);
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) {
    cumulative.push(cumulative[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    ));
  }
  const total = cumulative[cumulative.length - 1];
  if (!(total > 1e-9)) return Array.from({ length: count }, () => [...points[0]] as Vec2);
  const result: Vec2[] = [];
  let segment = 0;
  for (let index = 0; index < count; index++) {
    const target = total * index / (count - 1);
    while (segment + 1 < cumulative.length - 1 && cumulative[segment + 1] < target) {
      segment += 1;
    }
    const span = cumulative[segment + 1] - cumulative[segment];
    const ratio = span > 1e-12 ? (target - cumulative[segment]) / span : 0;
    result.push([
      points[segment][0] + ratio * (points[segment + 1][0] - points[segment][0]),
      points[segment][1] + ratio * (points[segment + 1][1] - points[segment][1]),
    ]);
  }
  return result;
}

function applyTemporalCubicFaceRatio(
  points: Vec3[], landmarksPx: Vec3[], lineName: string,
  specification?: [number, Vec2, Vec2, Vec2],
  absoluteEndpoint = false,
  boundaryMarginFaceRatio = 0.02,
): Vec3[] {
  if (!specification || points.length < 5 || landmarksPx.length === 0) return points;
  const [joinIndex, firstOffset, secondOffset, tangentHandleOffset] = specification;
  if (!Number.isInteger(joinIndex) || joinIndex < 2 || joinIndex >= points.length - 2) return points;
  const xs = landmarksPx.map((point) => point[0]).filter(Number.isFinite);
  const faceWidth = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  if (!(faceWidth > 1e-9)) return points;

  const out = points.map((point) => [...point] as Vec3);
  const join: Vec2 = [out[joinIndex][0], out[joinIndex][1]];
  let rightAxis: Vec2 = [1, 0];
  if (landmarksPx.length > 263) {
    rightAxis = [
      landmarksPx[263][0] - landmarksPx[33][0],
      landmarksPx[263][1] - landmarksPx[33][1],
    ];
  }
  const rightNorm = Math.hypot(rightAxis[0], rightAxis[1]);
  if (!(rightNorm > 1e-9)) return points;
  rightAxis = [rightAxis[0] / rightNorm, rightAxis[1] / rightNorm];
  let downAxis: Vec2 = landmarksPx.length > 152
    ? [
        landmarksPx[152][0] - landmarksPx[10][0],
        landmarksPx[152][1] - landmarksPx[10][1],
      ]
    : [0, 1];
  const downProjection = downAxis[0] * rightAxis[0] + downAxis[1] * rightAxis[1];
  downAxis = [
    downAxis[0] - downProjection * rightAxis[0],
    downAxis[1] - downProjection * rightAxis[1],
  ];
  const downNorm = Math.hypot(downAxis[0], downAxis[1]);
  if (!(downNorm > 1e-9)) return points;
  downAxis = [downAxis[0] / downNorm, downAxis[1] / downNorm];
  const outwardAxis: Vec2 = lineName.endsWith("_left")
    ? rightAxis
    : [-rightAxis[0], -rightAxis[1]];
  const oldOutwardDistance = (
    (out[0][0] - join[0]) * outwardAxis[0]
    + (out[0][1] - join[1]) * outwardAxis[1]
  ) / faceWidth;
  const requestedOutwardDistance = absoluteEndpoint
    ? Math.min(0.22, Math.max(0, firstOffset[0]))
    : Math.min(0.22, Math.max(firstOffset[0], oldOutwardDistance + 0.03));
  let targetOutwardDistance = requestedOutwardDistance;
  if (absoluteEndpoint && landmarksPx.length > 389) {
    const boundaryIndices = lineName.endsWith("_left")
      ? [356, 389, 251, 284, 332, 297, 338, 10]
      : [127, 162, 21, 54, 103, 67, 109, 10];
    const boundaryDown = boundaryIndices.map((index) => (
      landmarksPx[index][0] * downAxis[0] + landmarksPx[index][1] * downAxis[1]
    ));
    const boundaryOutward = boundaryIndices.map((index) => (
      landmarksPx[index][0] * outwardAxis[0] + landmarksPx[index][1] * outwardAxis[1]
    ));
    const endpointDown = join[0] * downAxis[0] + join[1] * downAxis[1]
      + faceWidth * firstOffset[1];
    const outwardCandidates: number[] = [];
    for (let index = 0; index < boundaryIndices.length - 1; index++) {
      const down0 = boundaryDown[index];
      const down1 = boundaryDown[index + 1];
      if (endpointDown < Math.min(down0, down1) || endpointDown > Math.max(down0, down1)) {
        continue;
      }
      const ratio = Math.abs(down1 - down0) > 1e-9
        ? (endpointDown - down0) / (down1 - down0)
        : 0.5;
      outwardCandidates.push(
        boundaryOutward[index]
        + ratio * (boundaryOutward[index + 1] - boundaryOutward[index]),
      );
    }
    let boundaryOutwardAtEndpoint: number;
    if (outwardCandidates.length) {
      boundaryOutwardAtEndpoint = Math.max(...outwardCandidates);
    } else {
      let nearestIndex = 0;
      for (let index = 1; index < boundaryDown.length; index++) {
        if (Math.abs(boundaryDown[index] - endpointDown)
          < Math.abs(boundaryDown[nearestIndex] - endpointDown)) {
          nearestIndex = index;
        }
      }
      boundaryOutwardAtEndpoint = boundaryOutward[nearestIndex];
    }
    const boundaryMargin = Math.min(0.1, Math.max(-0.05, boundaryMarginFaceRatio));
    const boundaryLimit = (
      boundaryOutwardAtEndpoint
      - boundaryMargin * faceWidth
      - join[0] * outwardAxis[0]
      - join[1] * outwardAxis[1]
    ) / faceWidth;
    targetOutwardDistance = Math.min(targetOutwardDistance, Math.max(0, boundaryLimit));
  }
  const outwardExtra = Math.max(0, targetOutwardDistance - firstOffset[0]);
  const localOffset = (offset: Vec2, extraScale: number): Vec2 => [
    faceWidth * (
      (offset[0] + extraScale * outwardExtra) * outwardAxis[0]
      + offset[1] * downAxis[0]
    ),
    faceWidth * (
      (offset[0] + extraScale * outwardExtra) * outwardAxis[1]
      + offset[1] * downAxis[1]
    ),
  ];
  const firstDelta: Vec2 = absoluteEndpoint
    ? [
        faceWidth * (
          targetOutwardDistance * outwardAxis[0] + firstOffset[1] * downAxis[0]
        ),
        faceWidth * (
          targetOutwardDistance * outwardAxis[1] + firstOffset[1] * downAxis[1]
        ),
      ]
    : localOffset(firstOffset, 1);
  let secondOutwardDistance = secondOffset[0] + 0.55 * outwardExtra;
  const boundaryClamped = absoluteEndpoint
    && targetOutwardDistance < requestedOutwardDistance - 1e-9;
  if (boundaryClamped) {
    secondOutwardDistance = Math.min(secondOutwardDistance, 0.70 * targetOutwardDistance);
  }
  const secondDelta: Vec2 = [
    faceWidth * (
      secondOutwardDistance * outwardAxis[0] + secondOffset[1] * downAxis[0]
    ),
    faceWidth * (
      secondOutwardDistance * outwardAxis[1] + secondOffset[1] * downAxis[1]
    ),
  ];
  let first: Vec2 = [join[0] + firstDelta[0], join[1] + firstDelta[1]];
  let second: Vec2 = [join[0] + secondDelta[0], join[1] + secondDelta[1]];
  const endpointDelta: Vec2 = [first[0] - out[0][0], first[1] - out[0][1]];
  const outwardExtension = endpointDelta[0] * outwardAxis[0] + endpointDelta[1] * outwardAxis[1];
  const outwardCorrection = absoluteEndpoint
    ? 0
    : Math.max(0, 0.03 * faceWidth - outwardExtension);
  const upwardShift = endpointDelta[0] * downAxis[0] + endpointDelta[1] * downAxis[1];
  const downCorrection = !absoluteEndpoint && upwardShift < -0.02 * faceWidth
    ? -0.02 * faceWidth - upwardShift
    : 0;
  const correction: Vec2 = [
    outwardCorrection * outwardAxis[0] + downCorrection * downAxis[0],
    outwardCorrection * outwardAxis[1] + downCorrection * downAxis[1],
  ];
  first = [first[0] + correction[0], first[1] + correction[1]];
  second = [second[0] + 0.55 * correction[0], second[1] + 0.55 * correction[1]];
  let outgoing: Vec2 = [
    out[joinIndex + 1][0] - join[0],
    out[joinIndex + 1][1] - join[1],
  ];
  const outgoingNorm = Math.hypot(outgoing[0], outgoing[1]);
  if (!(outgoingNorm > 1e-9)) return points;
  outgoing = [outgoing[0] / outgoingNorm, outgoing[1] / outgoingNorm];
  const controlTangent: Vec2 = [
    out[joinIndex + 1][0] - out[joinIndex - 1][0],
    out[joinIndex + 1][1] - out[joinIndex - 1][1],
  ];
  const controlTangentNorm = Math.hypot(controlTangent[0], controlTangent[1]);
  if (!(controlTangentNorm > 1e-9)) return points;
  const handleLength = faceWidth * Math.hypot(tangentHandleOffset[0], tangentHandleOffset[1]);
  const third: Vec2 = [
    join[0] - handleLength * controlTangent[0] / controlTangentNorm,
    join[1] - handleLength * controlTangent[1] / controlTangentNorm,
  ];
  if (boundaryClamped) {
    const thirdOutwardDistance = (
      (third[0] - join[0]) * outwardAxis[0]
      + (third[1] - join[1]) * outwardAxis[1]
    ) / faceWidth;
    const clampedThirdOutwardDistance = Math.min(
      Math.max(0, thirdOutwardDistance),
      0.70 * secondOutwardDistance,
    );
    const thirdCorrection = faceWidth
      * (clampedThirdOutwardDistance - thirdOutwardDistance);
    third[0] += thirdCorrection * outwardAxis[0];
    third[1] += thirdCorrection * outwardAxis[1];
  }
  const dense: Vec2[] = [];
  for (let index = 0; index < 192; index++) {
    const t = index / 191;
    const oneMinus = 1 - t;
    dense.push([
      oneMinus ** 3 * first[0] + 3 * oneMinus ** 2 * t * second[0]
        + 3 * oneMinus * t ** 2 * third[0] + t ** 3 * join[0],
      oneMinus ** 3 * first[1] + 3 * oneMinus ** 2 * t * second[1]
        + 3 * oneMinus * t ** 2 * third[1] + t ** 3 * join[1],
    ]);
  }
  const prefix = sampleXyByArclength(dense, joinIndex + 1);
  const terminalSegmentLength = Math.hypot(
    prefix[prefix.length - 1][0] - prefix[prefix.length - 2][0],
    prefix[prefix.length - 1][1] - prefix[prefix.length - 2][1],
  );
  prefix[prefix.length - 2] = [
    join[0] - terminalSegmentLength * outgoing[0],
    join[1] - terminalSegmentLength * outgoing[1],
  ];
  for (let index = 0; index <= joinIndex; index++) {
    out[index][0] = prefix[index][0];
    out[index][1] = prefix[index][1];
  }
  return out;
}

export function toPixels(landmarks: NormalizedLandmark[], width: number, height: number): Vec3[] {
  const out = new Array<Vec3>(landmarks.length);
  for (let i = 0; i < landmarks.length; i++) {
    const landmark = landmarks[i];
    out[i] = [landmark.x * width, landmark.y * height, landmark.z * width];
  }
  return out;
}

export function mapAtlas(
  lines: AtlasLine[] | unknown,
  landmarksPx: Vec3[],
  triangles: Triangle[],
  options: MapAtlasOptions = {},
): MappedAtlasLine[] {
  const result: MappedAtlasLine[] = [];
  if (!Array.isArray(lines)) return result;
  const bridgeRanks = foreheadBridgeRanks(lines, landmarksPx, triangles);
  for (const line of lines) {
    const pts: Vec3[] = [];
    const tris: number[] = [];
    for (const point of line.points || []) {
      const tri = point[0];
      const u = point[1];
      const v = point[2];
      const w = 1 - u - v;
      const triangle = triangles[tri];
      if (!triangle) continue;
      const a = landmarksPx[triangle[0]];
      const b = landmarksPx[triangle[1]];
      const c = landmarksPx[triangle[2]];
      if (!a || !b || !c) continue;
      pts.push([
        u * a[0] + v * b[0] + w * c[0],
        u * a[1] + v * b[1] + w * c[1],
        u * a[2] + v * b[2] + w * c[2],
      ]);
      tris.push(tri);
    }
    const useLegacyForeheadExpansion = options.expandForehead !== false
      && line.region === FOREHEAD_LOWER_LONG_ARC_REGION
      && line.disableRuntimeExpansion !== true;
    const useBridgeExpansion = options.expandForehead !== false
      && line.region === FOREHEAD_BRIDGE_ARC_REGION
      && line.disableRuntimeExpansion !== true;
    let mappedPoints = pts;
    if (useLegacyForeheadExpansion) {
      mappedPoints = extendForeheadLowerLongArc(pts, landmarksPx);
    } else if (useBridgeExpansion) {
      mappedPoints = extendForeheadBridge(pts, landmarksPx, bridgeRanks.get(line) ?? 0);
    } else if (SUPRAORBITAL_SHORT_ARC_REGIONS_V67.has(line.region || "")) {
      mappedPoints = raiseSupraorbitalShortArc(
        pts,
        landmarksPx,
        SUPRAORBITAL_UPWARD_SHIFT_FACE_HEIGHT_V67,
      );
    } else if (line.region === SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V68) {
      mappedPoints = raiseSupraorbitalShortArc(
        pts,
        landmarksPx,
        SUPRAORBITAL_MEDIAL_UPWARD_SHIFT_FACE_HEIGHT_V68,
      );
    }
    mappedPoints = applyTemporalCubicFaceRatio(
      mappedPoints,
      landmarksPx,
      line.name || "",
      line.postMapTemporalCubicFaceRatio,
      line.postMapTemporalAbsoluteEndpoint === true,
      line.postMapTemporalBoundaryMarginFaceRatio ?? 0.02,
    );
    mappedPoints = applyPostExpansionOffsets(mappedPoints, line, landmarksPx);
    mappedPoints = smoothMappedCurve(mappedPoints, line.postMapSmoothingPasses ?? 0);
    if (line.postMapCubicFairing === true) {
      mappedPoints = fairMappedCurveCubic(mappedPoints);
    }
    result.push({ name: line.name || "unnamed_curve", region: line.region || "", pts: mappedPoints, tris });
  }
  return result;
}

export function validateAtlasLines(
  atlasOrLines: AtlasPayload | AtlasLine[] | unknown,
  triangles: Triangle[],
  { expectedTopologyId, expectedTopologyVersion }: { expectedTopologyId?: string; expectedTopologyVersion?: string } = {},
): boolean {
  const atlas = atlasOrLines && typeof atlasOrLines === "object" && !Array.isArray(atlasOrLines)
    ? atlasOrLines as AtlasPayload
    : null;
  if (expectedTopologyId && atlas && (atlas.topologyId ?? TOPOLOGY_ID) !== expectedTopologyId) {
    return false;
  }
  if (expectedTopologyVersion && atlas && (atlas.topologyVersion ?? TOPOLOGY_VERSION) !== expectedTopologyVersion) {
    return false;
  }
  const lines = atlas ? atlas.lines : atlasOrLines;
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const triCount = Array.isArray(triangles) ? triangles.length : 0;
  for (const line of lines) {
    if (!line || !Array.isArray(line.points)) return false;
    for (const point of line.points) {
      if (!Array.isArray(point) || point.length < 3) return false;
      const tri = point[0];
      const u = point[1];
      const v = point[2];
      if (!Number.isInteger(tri) || tri < 0 || tri >= triCount) return false;
      if (!Number.isFinite(u) || !Number.isFinite(v)) return false;
    }
  }
  return true;
}

export function noseTriangles(triangles: Triangle[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < triangles.length; i++) {
    const triangle = triangles[i];
    if (triangle[0] === NOSE_TIP || triangle[1] === NOSE_TIP || triangle[2] === NOSE_TIP) out.push(i);
  }
  return out;
}

export const INNER_LIP = new Set<number>(INNER_LIP_IDX);

const innerMouthCache = new WeakMap<Triangle[], Set<number>>();

export function innerMouthTriangles(triangles: Triangle[]): Set<number> {
  let set = innerMouthCache.get(triangles);
  if (set) return set;
  set = new Set<number>();
  for (let i = 0; i < triangles.length; i++) {
    const triangle = triangles[i];
    let count = 0;
    if (INNER_LIP.has(triangle[0])) count++;
    if (INNER_LIP.has(triangle[1])) count++;
    if (INNER_LIP.has(triangle[2])) count++;
    if (count >= 2) set.add(i);
  }
  innerMouthCache.set(triangles, set);
  return set;
}

export function visibleTriangles(
  landmarksPx: Vec3[],
  triangles: Triangle[],
  noseTris: number[],
  threshold = DEFAULT_OCCLUSION_THRESHOLD,
  { minTriangleAreaPx2 = 0 }: VisibleTriangleOptions = {},
): Uint8Array {
  const count = triangles.length;
  const nz = new Float64Array(count);
  const degenerate = minTriangleAreaPx2 > 0 ? new Uint8Array(count) : null;
  for (let i = 0; i < count; i++) {
    const triangle = triangles[i];
    const a = landmarksPx[triangle[0]];
    const b = landmarksPx[triangle[1]];
    const c = landmarksPx[triangle[2]];
    if (!a || !b || !c) {
      if (degenerate) degenerate[i] = 1;
      continue;
    }
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    nz[i] = e1x * e2y - e1y * e2x;
    if (degenerate && Math.abs(nz[i]) < minTriangleAreaPx2) degenerate[i] = 1;
  }
  let ref = 0;
  if (noseTris.length) {
    for (const index of noseTris) ref += nz[index];
    ref /= noseTris.length;
  }
  const sign = ref >= 0 ? 1 : -1;
  const vis = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    vis[i] = (!degenerate || !degenerate[i]) && sign * nz[i] >= threshold ? 1 : 0;
  }
  return vis;
}

export function visibleRuns(pts: Vec3[], visMask: ArrayLike<number>): Vec3[][] {
  const runs: Vec3[][] = [];
  let cur: Vec3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const point = pts[i];
    if (visMask[i] && isFinite(point[0]) && isFinite(point[1])) {
      cur.push(point);
    } else {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}
