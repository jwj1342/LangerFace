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

function finitePoint(point: readonly number[] | undefined): point is readonly [number, number] {
  return Boolean(point) && Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]);
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

/** Select central, predominantly horizontal generic wrinkle lines on the nose dorsum. */
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
  const centerX = (leftCanthus[0] + rightCanthus[0]) / 2;
  const eyeY = (leftCanthus[1] + rightCanthus[1]) / 2;
  return lines.filter((line) => {
    if (line.class !== "wrinkle" || line.points.length < 8) return false;
    const xs = line.points.map((point) => point[0]);
    const ys = line.points.map((point) => point[1]);
    const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    return Math.abs(meanX - centerX) <= faceWidth * 0.16
      && meanY >= eyeY - faceWidth * 0.08
      && meanY <= eyeY + faceWidth * 0.18
      && spanX >= Math.max(faceWidth * 0.025, spanY * 1.5);
  }).sort((left, right) => {
    const meanY = (line: T) => line.points.reduce((sum, point) => sum + point[1], 0)
      / line.points.length;
    return meanY(left) - meanY(right);
  });
}
