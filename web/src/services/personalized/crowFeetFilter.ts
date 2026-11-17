type Point2 = readonly [number, number];

export interface WrinkleLineForRegionFilter {
  class: string;
  anatomicalClass?: string;
  points: readonly Point2[];
}

const LEFT_OUTER_CANTHUS = 33;
const RIGHT_OUTER_CANTHUS = 263;
const LEFT_FACE_EDGE = 234;
const RIGHT_FACE_EDGE = 454;
const NOSE_ROOT = 168;
const NOSE_BRIDGE = 6;
const NOSE_LOWER_BRIDGE = 195;
const NOSE_TIP = 5;
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
] as const;

// The MediaPipe oval stops near the visible forehead skin on high-angle
// clinical photos. Keep a larger forehead-only margin so long horizontal
// forehead wrinkles are not rejected as outside-face lines.
const FOREHEAD_REGION_EXTENSION_RATIO = 0.08;

function finitePoint(point: readonly number[] | undefined): point is readonly [number, number] {
  return Boolean(point) && Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]);
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    const intersects = ((y > point[1]) !== (previousY > point[1]))
      && point[0] < (previousX - x) * (point[1] - y) / (previousY - y) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Keep a wrinkle only when its centerline is supported by the MediaPipe face silhouette. */
export function keepFaceRegionWrinkleLines<T extends WrinkleLineForRegionFilter>(
  lines: readonly T[],
  landmarks: readonly (readonly number[])[],
): T[] {
  const oval = FACE_OVAL
    .map((index) => landmarks[index])
    .filter((point): point is readonly [number, number] => finitePoint(point));
  if (oval.length !== FACE_OVAL.length) return [...lines];
  const minY = Math.min(...oval.map((point) => point[1]));
  const maxY = Math.max(...oval.map((point) => point[1]));
  const centerY = (minY + maxY) / 2;
  const foreheadExtension = (maxY - minY) * FOREHEAD_REGION_EXTENSION_RATIO;
  const polygon = oval.map(([x, y]) => [
    x,
    y < centerY ? y - foreheadExtension * (centerY - y) / Math.max(1, centerY - minY) : y,
  ] as Point2);
  return lines.filter((line) => {
    if (line.points.length === 0) return false;
    const insideCount = line.points.filter((point) => pointInPolygon(point, polygon)).length;
    const middle = line.points[Math.floor(line.points.length / 2)];
    return insideCount / line.points.length >= 0.8 && pointInPolygon(middle, polygon);
  });
}

/**
 * Fish-tail wrinkles are YOLO `wrinkle` lines whose centres lie in either
 * lateral-canthus field. Other `wrinkle` lines (for example the nose dorsum)
 * deliberately remain enabled.
 */
export function isCrowFeetWrinkleLine(
  line: WrinkleLineForRegionFilter,
  landmarks: readonly (readonly number[])[],
): boolean {
  if (line.anatomicalClass === "crow_feet") return true;
  if (line.class !== "wrinkle" || !line.points.length) return false;

  const leftCanthus = landmarks[LEFT_OUTER_CANTHUS];
  const rightCanthus = landmarks[RIGHT_OUTER_CANTHUS];
  if (!finitePoint(leftCanthus) || !finitePoint(rightCanthus)) return false;

  const leftEdge = landmarks[LEFT_FACE_EDGE];
  const rightEdge = landmarks[RIGHT_FACE_EDGE];
  const landmarkFaceWidth = finitePoint(leftEdge) && finitePoint(rightEdge)
    ? Math.abs(rightEdge[0] - leftEdge[0])
    : Math.abs(rightCanthus[0] - leftCanthus[0]) / 0.5;
  if (!Number.isFinite(landmarkFaceWidth) || landmarkFaceWidth <= 0) return false;

  const faceCenterX = (leftCanthus[0] + rightCanthus[0]) / 2;
  const inLateralCanthusField = ([x, y]: Point2, canthus: readonly [number, number]): boolean => {
    const outward = canthus[0] < faceCenterX ? -1 : 1;
    const centerX = canthus[0] + outward * landmarkFaceWidth * 0.07;
    const dx = (x - centerX) / (landmarkFaceWidth * 0.12);
    const dy = (y - canthus[1]) / (landmarkFaceWidth * 0.11);
    return dx * dx + dy * dy <= 1;
  };

  const center: Point2 = [
    line.points.reduce((sum, point) => sum + point[0], 0) / line.points.length,
    line.points.reduce((sum, point) => sum + point[1], 0) / line.points.length,
  ];
  if (inLateralCanthusField(center, leftCanthus)
      || inLateralCanthusField(center, rightCanthus)) return true;

  const pointsInCrowFeetField = line.points.filter((point) =>
    inLateralCanthusField(point, leftCanthus)
      || inLateralCanthusField(point, rightCanthus)).length;
  return pointsInCrowFeetField / line.points.length >= 0.5;
}

export function removeCrowFeetWrinkleLines<T extends WrinkleLineForRegionFilter>(
  lines: readonly T[],
  landmarks: readonly (readonly number[])[],
): T[] {
  return lines.filter((line) => !isCrowFeetWrinkleLine(line, landmarks));
}

/** Select generic wrinkle lines supported by the landmark-defined nose bridge. */
export function selectNoseDorsumWrinkleLines<T extends WrinkleLineForRegionFilter>(
  lines: readonly T[],
  landmarks: readonly (readonly number[])[],
): T[] {
  const leftCanthus = landmarks[LEFT_OUTER_CANTHUS];
  const rightCanthus = landmarks[RIGHT_OUTER_CANTHUS];
  if (!finitePoint(leftCanthus) || !finitePoint(rightCanthus)) return [];
  const leftEdge = landmarks[LEFT_FACE_EDGE];
  const rightEdge = landmarks[RIGHT_FACE_EDGE];
  const faceWidth = finitePoint(leftEdge) && finitePoint(rightEdge)
    ? Math.abs(rightEdge[0] - leftEdge[0])
    : Math.abs(rightCanthus[0] - leftCanthus[0]) / 0.5;
  if (!(faceWidth > 0)) return [];
  const bridge = [NOSE_ROOT, NOSE_BRIDGE, NOSE_LOWER_BRIDGE, NOSE_TIP]
    .map((index) => landmarks[index]);
  if (bridge.some((point) => !finitePoint(point))) return [];
  const axis: Point2[] = bridge.map((point): Point2 => [point[0], point[1]])
    .sort((left, right) => left[1] - right[1]);
  const upperY = Math.min(...axis.map((point) => point[1]));
  const lowerY = Math.max(...axis.map((point) => point[1]));
  if (lowerY - upperY < faceWidth * 0.06) return [];
  const halfWidth = faceWidth * 0.09;
  // Allow small landmark/decode differences without admitting eye-region lines.
  const boundaryTolerance = faceWidth * 0.005;
  const withinBridge = ([x, y]: Point2, extraWidth = 0): boolean => {
    if (y < upperY - faceWidth * 0.07 - boundaryTolerance
        || y > lowerY + faceWidth * 0.02 + boundaryTolerance) return false;
    let centerX = axis[0][0];
    for (let index = 1; index < axis.length; index += 1) {
      const previous = axis[index - 1];
      const next = axis[index];
      if (y > next[1] && index < axis.length - 1) continue;
      const span = next[1] - previous[1];
      const fraction = span > 0 ? Math.max(0, Math.min(1, (y - previous[1]) / span)) : 0;
      centerX = previous[0] + (next[0] - previous[0]) * fraction;
      break;
    }
    return Math.abs(x - centerX) <= halfWidth + boundaryTolerance + extraWidth;
  };
  return lines.filter((line) => {
    if (line.class !== "wrinkle" || line.anatomicalClass === "crow_feet"
        || line.points.length < 8) return false;
    const xs = line.points.map((point) => point[0]);
    const ys = line.points.map((point) => point[1]);
    const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    const endPointCount = Math.ceil(line.points.length * 0.1);
    const insideCount = line.points.filter((point) => withinBridge(point)).length;
    const tipsStayNearBridge = line.points.every((point, index) =>
      withinBridge(point)
        || ((index < endPointCount || index >= line.points.length - endPointCount)
          && withinBridge(point, faceWidth * 0.01)));
    return withinBridge([meanX, meanY])
      && insideCount / line.points.length >= 0.9
      && tipsStayNearBridge
      && spanX >= Math.max(faceWidth * 0.025, spanY * 1.5);
  }).sort((left, right) => {
    const meanY = (line: T) => line.points.reduce((sum, point) => sum + point[1], 0)
      / line.points.length;
    return meanY(left) - meanY(right);
  });
}

export function keepTargetWrinkleLines<T extends WrinkleLineForRegionFilter>(
  lines: readonly T[],
  landmarks: readonly (readonly number[])[],
): T[] {
  const noseIds = new Set(selectNoseDorsumWrinkleLines(lines, landmarks));
  return lines.filter((line) => line.class === "forehead" || line.class === "frown"
    || (line.class === "wrinkle" && noseIds.has(line)));
}
