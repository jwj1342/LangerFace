export type Point2 = [number, number];

const EPSILON = 1e-9;

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function pointSegmentDistance(point: Point2, a: Point2, b: Point2): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const denominator = abx * abx + aby * aby;
  if (denominator <= EPSILON) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / denominator));
  return distance(point, [a[0] + t * abx, a[1] + t * aby]);
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point: Point2, a: Point2, b: Point2): boolean {
  return Math.abs(orientation(a, b, point)) <= EPSILON
    && point[0] >= Math.min(a[0], b[0]) - EPSILON
    && point[0] <= Math.max(a[0], b[0]) + EPSILON
    && point[1] >= Math.min(a[1], b[1]) - EPSILON
    && point[1] <= Math.max(a[1], b[1]) + EPSILON;
}

export function segmentsIntersect2d(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return pointOnSegment(c, a, b) || pointOnSegment(d, a, b)
    || pointOnSegment(a, c, d) || pointOnSegment(b, c, d);
}

function segmentDistance(a: Point2, b: Point2, c: Point2, d: Point2): number {
  if (segmentsIntersect2d(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function segments(points: Point2[], closed: boolean): Array<[Point2, Point2]> {
  const result: Array<[Point2, Point2]> = [];
  for (let index = 1; index < points.length; index++) result.push([points[index - 1], points[index]]);
  if (closed && points.length > 2 && distance(points[0], points.at(-1) as Point2) > EPSILON) {
    result.push([points.at(-1) as Point2, points[0]]);
  }
  return result;
}

export function resamplePolyline2d(points: Point2[], maxStep = 0.005, closed = false): Point2[] {
  if (!points.length) return [];
  const source = closed && points.length > 2 && distance(points[0], points.at(-1) as Point2) > EPSILON
    ? points.concat([points[0]])
    : points;
  const sampled: Point2[] = [source[0]];
  for (let index = 1; index < source.length; index++) {
    const a = source[index - 1];
    const b = source[index];
    const count = Math.max(1, Math.ceil(distance(a, b) / Math.max(maxStep, EPSILON)));
    for (let step = 1; step <= count; step++) {
      const t = step / count;
      sampled.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return sampled;
}

export function pointInPolygon2d(point: Point2, polygon: Point2[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[previous];
    const b = polygon[current];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]);
    if (crosses && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function inspectPathPolygonRelation(
  path: Point2[],
  polygon: Point2[],
  { closedPath = false }: { closedPath?: boolean } = {},
) {
  const pathSegments = segments(path, closedPath);
  const polygonSegments = segments(polygon, true);
  const boundaryIntersects = pathSegments.some(([a, b]) =>
    polygonSegments.some(([c, d]) => segmentsIntersect2d(a, b, c, d)));
  const pathInside = path.some((point) => pointInPolygon2d(point, polygon));
  const polygonInsidePath = closedPath && polygon.some((point) => pointInPolygon2d(point, path));
  let minimumDistance = Infinity;
  for (const [a, b] of pathSegments) {
    for (const [c, d] of polygonSegments) minimumDistance = Math.min(minimumDistance, segmentDistance(a, b, c, d));
  }
  return {
    intersects: boundaryIntersects || pathInside || polygonInsidePath,
    boundary_intersects: boundaryIntersects,
    path_enters_polygon: pathInside,
    path_contains_polygon: polygonInsidePath,
    minimum_distance: Number.isFinite(minimumDistance) ? minimumDistance : null,
  };
}
