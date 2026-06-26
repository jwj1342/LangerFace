export type Point2 = [number, number];
export type HandBone = [number, number, number, number];

export interface HandMask {
  palm: Point2[];
  bones: HandBone[];
  r: number;
}

export function convexHull(pts: Point2[]): Point2[] {
  if (pts.length < 3) return pts.map((point) => [point[0], point[1]]);
  const points = pts.map((point) => [point[0], point[1]] as Point2).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point2[] = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point2[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function expandHull(hull: Point2[], margin: number): Point2[] {
  if (hull.length < 3 || margin <= 0) return hull;
  let cx = 0;
  let cy = 0;
  for (const point of hull) {
    cx += point[0];
    cy += point[1];
  }
  cx /= hull.length;
  cy /= hull.length;
  return hull.map((point) => {
    const dx = point[0] - cx;
    const dy = point[1] - cy;
    const d = Math.hypot(dx, dy) || 1;
    return [point[0] + margin * dx / d, point[1] + margin * dy / d];
  });
}

export function pointInConvex(point: Point2, hull: Point2[]): boolean {
  const count = hull.length;
  if (count < 3) return false;
  for (let i = 0; i < count; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % count];
    if ((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) < 0) return false;
  }
  return true;
}

export function pointInHulls(point: Point2, hulls: Point2[][]): boolean {
  for (const hull of hulls) if (pointInConvex(point, hull)) return true;
  return false;
}

function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

const distance = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const PALM_IDX = [0, 1, 2, 5, 9, 13, 17];
const HAND_BONES: Array<[number, number]> = [
  [1, 2], [2, 3], [3, 4],
  [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [17, 18], [18, 19], [19, 20],
  [0, 1], [0, 5], [0, 17],
];

export function buildHandMasks(handsPx: Point2[][], scaleR = 0.16, margin = 4): HandMask[] {
  const masks: HandMask[] = [];
  for (const hand of handsPx) {
    if (!hand || hand.length < 21) continue;
    const palm = expandHull(convexHull(PALM_IDX.map((index) => hand[index])), margin);
    const r = distance(hand[5], hand[17]) * scaleR + margin;
    const bones = HAND_BONES.map(([a, b]) => [hand[a][0], hand[a][1], hand[b][0], hand[b][1]] as HandBone);
    masks.push({ palm, bones, r });
  }
  return masks;
}

export function pointInHandMasks(point: Point2, masks: HandMask[]): boolean {
  for (const mask of masks) {
    if (pointInConvex(point, mask.palm)) return true;
    for (const segment of mask.bones) {
      if (distPointSeg(point[0], point[1], segment[0], segment[1], segment[2], segment[3]) <= mask.r) return true;
    }
  }
  return false;
}

export function buildOccluderHulls(occludersPx: Point2[][], margin: number): Point2[][] {
  const hulls: Point2[][] = [];
  for (const pts of occludersPx) {
    if (pts && pts.length >= 3) hulls.push(expandHull(convexHull(pts), margin));
  }
  return hulls;
}
