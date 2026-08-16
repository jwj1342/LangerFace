export const CONTROLLED_MARKER_DETECTOR_VERSION = "0.12";

export interface MarkerImageData {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface MarkerPoint {
  x: number;
  y: number;
}

export type ControlledMarkerFailureCode =
  | "invalid_image"
  | "seed_outside_image"
  | "no_dark_component"
  | "component_too_small"
  | "component_too_large"
  | "ambiguous_candidates"
  | "seed_not_enclosed"
  | "low_contrast";

export type ControlledMarkerSeedRelation = "enclosed" | "on_marker" | "near_marker";

export interface ControlledMarkerDetection {
  ok: boolean;
  failure_code: ControlledMarkerFailureCode | null;
  center: MarkerPoint | null;
  boundary: MarkerPoint[];
  area_px: number;
  bbox: { x: number; y: number; width: number; height: number } | null;
  geometry_mode: "enclosed_region" | "dark_component" | null;
  seed_relation: ControlledMarkerSeedRelation | null;
  marker_area_px: number;
  marker_bbox: { x: number; y: number; width: number; height: number } | null;
  confidence: number;
  candidate_count: number;
  warnings: string[];
  diagnostics?: {
    method: "seed_first_barrier";
    roi_radius: number;
    local_window_radius: number;
    repair_radius: number;
    boundary_support_ratio: number;
    repair_fraction: number;
    seed_relocated_px?: number;
    failure_stage?: string;
  };
  audit: {
    local_only: true;
    raw_media_retained: false;
    network_request_made: false;
  };
}

interface PixelComponent {
  pixels: MarkerPoint[];
  meanLuma: number;
}

interface MarkerCandidate {
  component: PixelComponent;
  boundary: MarkerPoint[];
  bbox: { x: number; y: number; width: number; height: number };
  containsSeed: boolean;
  distance: number;
  enclosed: boolean;
  compact: boolean;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const luma = (data: ArrayLike<number>, index: number): number => (
  0.2126 * Number(data[index]) + 0.7152 * Number(data[index + 1]) + 0.0722 * Number(data[index + 2])
);

function robustBackgroundLuma(values: readonly number[]): number {
  if (!values.length) return 0;
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[clamp(Math.round(value), 0, 255)] += 1;
  const target = Math.ceil(values.length * 0.7);
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= target) return value;
  }
  return 255;
}

function failure(code: ControlledMarkerFailureCode, candidateCount = 0): ControlledMarkerDetection {
  return {
    ok: false,
    failure_code: code,
    center: null,
    boundary: [],
    area_px: 0,
    bbox: null,
    geometry_mode: null,
    seed_relation: null,
    marker_area_px: 0,
    marker_bbox: null,
    confidence: 0,
    candidate_count: candidateCount,
    warnings: [code],
    audit: { local_only: true, raw_media_retained: false, network_request_made: false },
  };
}

const pointKey = (point: MarkerPoint): string => `${point.x},${point.y}`;

function pixelExtent(points: readonly MarkerPoint[], seed?: MarkerPoint) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
    if (seed) distance = Math.min(distance, Math.hypot(point.x - seed.x, point.y - seed.y));
  }
  return {
    bbox: {
      x: Number.isFinite(minX) ? minX : 0,
      y: Number.isFinite(minY) ? minY : 0,
      width: Number.isFinite(minX) ? maxX - minX + 1 : 0,
      height: Number.isFinite(minY) ? maxY - minY + 1 : 0,
    },
    distance,
  };
}

function polygonArea(points: MarkerPoint[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function binaryWindow(mask: Uint8Array, width: number, height: number, radius: number, erode: boolean): Uint8Array {
  const r = Math.max(1, Math.min(4, Math.trunc(radius)));
  const stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += mask[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }
  const output = new Uint8Array(mask.length);
  const fullArea = (r * 2 + 1) ** 2;
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - r);
    const bottom = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - r);
      const right = Math.min(width - 1, x + r);
      const sum = integral[(bottom + 1) * stride + right + 1]
        - integral[top * stride + right + 1]
        - integral[(bottom + 1) * stride + left]
        + integral[top * stride + left];
      output[y * width + x] = erode ? Number(sum === fullArea) : Number(sum > 0);
    }
  }
  return output;
}

function binaryClose(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return binaryWindow(binaryWindow(mask, width, height, radius, false), width, height, radius, true);
}

function repairBarrier(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const repaired = binaryClose(mask, width, height, radius);
  const searchRadius = Math.min(5, Math.max(2, radius + 1));
  const offsets: Array<{ dx: number; dy: number; sector: number }> = [];
  for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
    for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
      if ((!dx && !dy) || dx * dx + dy * dy > searchRadius * searchRadius) continue;
      const sector = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
      offsets.push({ dx, dy, sector });
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (repaired[index]) continue;
      let directions = 0;
      for (const offset of offsets) {
        const nx = x + offset.dx;
        const ny = y + offset.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[ny * width + nx]) continue;
        directions |= 1 << offset.sector;
      }
      let opposed = false;
      for (let sector = 0; sector < 8 && !opposed; sector += 1) {
        if (!(directions & (1 << sector))) continue;
        const opposite = (sector + 4) % 8;
        opposed = Boolean(directions & (
          (1 << opposite)
          | (1 << ((opposite + 7) % 8))
          | (1 << ((opposite + 1) % 8))
        ));
      }
      if (opposed) repaired[index] = 1;
    }
  }
  return repaired;
}

function bridgeSingleStrokeGap(
  mask: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  maxGapPx = 14,
): Uint8Array | null {
  const visited = new Uint8Array(mask.length);
  const viable: number[][] = [];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    const component: number[] = [];
    visited[start] = 1;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      component.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const [dx, dy] of directions) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (component.length >= 12 && seedX >= minX && seedX <= maxX && seedY >= minY && seedY <= maxY) {
      viable.push(component);
    }
  }
  if (viable.length !== 1) return null;

  const stroke = new Uint8Array(mask.length);
  for (const index of viable[0]) stroke[index] = 1;
  const skeleton = stroke.slice();
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 96) {
    changed = false;
    iterations += 1;
    for (const phase of [0, 1]) {
      const remove: number[] = [];
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          if (!skeleton[index]) continue;
          const neighbours = [
            skeleton[(y - 1) * width + x], skeleton[(y - 1) * width + x + 1],
            skeleton[y * width + x + 1], skeleton[(y + 1) * width + x + 1],
            skeleton[(y + 1) * width + x], skeleton[(y + 1) * width + x - 1],
            skeleton[y * width + x - 1], skeleton[(y - 1) * width + x - 1],
          ];
          const count = neighbours.reduce((sum, value) => sum + value, 0);
          if (count < 2 || count > 6) continue;
          let transitions = 0;
          for (let n = 0; n < 8; n += 1) {
            if (!neighbours[n] && neighbours[(n + 1) % 8]) transitions += 1;
          }
          if (transitions !== 1) continue;
          const [p2, , p4, , p6, , p8] = neighbours;
          const preserveFirst = phase === 0 ? p2 * p4 * p6 : p2 * p4 * p8;
          const preserveSecond = phase === 0 ? p4 * p6 * p8 : p2 * p6 * p8;
          if (!preserveFirst && !preserveSecond) remove.push(index);
        }
      }
      if (remove.length) changed = true;
      for (const index of remove) skeleton[index] = 0;
    }
  }

  const skeletonNeighbours = (index: number): number[] => {
    const x = index % width, y = Math.floor(index / width);
    return directions.flatMap(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) return [];
      const next = ny * width + nx;
      return skeleton[next] ? [next] : [];
    });
  };
  const skeletonPixels = Array.from(skeleton.keys()).filter((index) => skeleton[index]);
  const endpoints = skeletonPixels.filter((index) => skeletonNeighbours(index).length === 1);
  if (endpoints.length !== 2) return null;
  const [first, second] = endpoints;
  const firstPoint = { x: first % width, y: Math.floor(first / width) };
  const secondPoint = { x: second % width, y: Math.floor(second / width) };
  const gap = Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y);
  if (gap < 2 || gap > maxGapPx || gap / Math.max(1, skeletonPixels.length) > 0.2) return null;

  const inwardPoint = (endpoint: number): MarkerPoint | null => {
    let previous = -1;
    let current = endpoint;
    for (let step = 0; step < 6; step += 1) {
      const next = skeletonNeighbours(current).find((index) => index !== previous);
      if (next === undefined) break;
      previous = current;
      current = next;
    }
    return current === endpoint ? null : { x: current % width, y: Math.floor(current / width) };
  };
  const firstInner = inwardPoint(first), secondInner = inwardPoint(second);
  if (!firstInner || !secondInner) return null;
  const unitDot = (ax: number, ay: number, bx: number, by: number) => (
    (ax * bx + ay * by) / Math.max(1e-9, Math.hypot(ax, ay) * Math.hypot(bx, by))
  );
  const gapX = secondPoint.x - firstPoint.x, gapY = secondPoint.y - firstPoint.y;
  if (unitDot(firstInner.x - firstPoint.x, firstInner.y - firstPoint.y, gapX, gapY) > -0.25
    || unitDot(secondInner.x - secondPoint.x, secondInner.y - secondPoint.y, -gapX, -gapY) > -0.25) {
    return null;
  }

  const repaired = mask.slice();
  const steps = Math.max(Math.abs(gapX), Math.abs(gapY));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(firstPoint.x + gapX * step / Math.max(1, steps));
    const y = Math.round(firstPoint.y + gapY * step / Math.max(1, steps));
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) repaired[ny * width + nx] = 1;
      }
    }
  }
  return repaired;
}

function adaptiveDarkBarrier(
  image: MarkerImageData,
  x0: number,
  y0: number,
  width: number,
  height: number,
  backgroundLuma: number,
  darkThreshold: number,
  minContrast: number,
): { mask: Uint8Array; localWindowRadius: number } {
  const imageWidth = Math.floor(image.width);
  const lumas = new Float32Array(width * height);
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const value = luma(image.data, ((y0 + y) * imageWidth + x0 + x) * 4);
      lumas[y * width + x] = value;
      rowSum += value;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }
  const localWindowRadius = clamp(Math.round(Math.min(width, height) * 0.025), 5, 13);
  const strong = new Uint8Array(width * height);
  const weak = new Uint8Array(width * height);
  const weakContrast = Math.max(10, minContrast * 0.45);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - localWindowRadius);
    const bottom = Math.min(height - 1, y + localWindowRadius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - localWindowRadius);
      const right = Math.min(width - 1, x + localWindowRadius);
      const area = (right - left + 1) * (bottom - top + 1);
      const localMean = (
        integral[(bottom + 1) * stride + right + 1]
        - integral[top * stride + right + 1]
        - integral[(bottom + 1) * stride + left]
        + integral[top * stride + left]
      ) / area;
      const index = y * width + x;
      const value = lumas[index];
      const localContrast = localMean - value;
      const isStrong = value <= darkThreshold || localContrast >= minContrast;
      strong[index] = Number(isStrong);
      weak[index] = Number(isStrong || (
        localContrast >= weakContrast
        && value <= backgroundLuma - Math.max(6, weakContrast * 0.5)
      ));
    }
  }

  // Hysteresis keeps faint continuations only when they connect to a clearly
  // dark pen response. A uniformly low-contrast shadow therefore cannot become
  // a marker merely because the weak threshold was permissive.
  const retained = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < strong.length; index += 1) {
    if (!strong[index]) continue;
    retained[index] = 1;
    queue[tail++] = index;
  }
  while (head < tail) {
    const current = queue[head++];
    const cx = current % width;
    const cy = Math.floor(current / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!weak[next] || retained[next]) continue;
        retained[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return { mask: retained, localWindowRadius };
}

function extractComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  image: MarkerImageData,
): PixelComponent[] {
  const imageWidth = Math.floor(image.width);
  const visited = new Uint8Array(mask.length);
  const components: PixelComponent[] = [];
  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const start = localY * width + localX;
      if (!mask[start] || visited[start]) continue;
      const queue = [start];
      const pixels: MarkerPoint[] = [];
      let totalLuma = 0;
      visited[start] = 1;
      for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head];
        const cx = current % width;
        const cy = Math.floor(current / width);
        const x = x0 + cx;
        const y = y0 + cy;
        pixels.push({ x, y });
        totalLuma += luma(image.data, (y * imageWidth + x) * 4);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const next = ny * width + nx;
            if (mask[next] && !visited[next]) {
              visited[next] = 1;
              queue.push(next);
            }
          }
        }
      }
      components.push({ pixels, meanLuma: totalLuma / pixels.length });
    }
  }
  return components;
}

function componentHasEnclosedBackground(points: MarkerPoint[], bbox: { x: number; y: number; width: number; height: number }): boolean {
  const filled = new Set(points.map(pointKey));
  const visited = new Set<string>();
  const queue: MarkerPoint[] = [];
  const enqueue = (point: MarkerPoint) => {
    const key = pointKey(point);
    if (filled.has(key) || visited.has(key)) return;
    visited.add(key);
    queue.push(point);
  };
  for (let x = bbox.x; x < bbox.x + bbox.width; x += 1) {
    enqueue({ x, y: bbox.y });
    enqueue({ x, y: bbox.y + bbox.height - 1 });
  }
  for (let y = bbox.y; y < bbox.y + bbox.height; y += 1) {
    enqueue({ x: bbox.x, y });
    enqueue({ x: bbox.x + bbox.width - 1, y });
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (next.x < bbox.x || next.x >= bbox.x + bbox.width || next.y < bbox.y || next.y >= bbox.y + bbox.height) continue;
      enqueue(next);
    }
  }
  for (let y = bbox.y + 1; y < bbox.y + bbox.height - 1; y += 1) {
    for (let x = bbox.x + 1; x < bbox.x + bbox.width - 1; x += 1) {
      const key = `${x},${y}`;
      if (!filled.has(key) && !visited.has(key)) return true;
    }
  }
  return false;
}

interface EnclosedRegion {
  pixels: MarkerPoint[];
  boundary: MarkerPoint[];
  bbox: { x: number; y: number; width: number; height: number };
  containsSeed: boolean;
  distance: number;
}

function enclosedBackgroundRegions(
  points: MarkerPoint[],
  bbox: { x: number; y: number; width: number; height: number },
  seed: MarkerPoint,
): EnclosedRegion[] {
  const filled = new Set(points.map(pointKey));
  const outside = new Set<string>();
  const queue: MarkerPoint[] = [];
  const enqueueOutside = (point: MarkerPoint) => {
    const key = pointKey(point);
    if (filled.has(key) || outside.has(key)) return;
    outside.add(key);
    queue.push(point);
  };
  for (let x = bbox.x; x < bbox.x + bbox.width; x += 1) {
    enqueueOutside({ x, y: bbox.y });
    enqueueOutside({ x, y: bbox.y + bbox.height - 1 });
  }
  for (let y = bbox.y; y < bbox.y + bbox.height; y += 1) {
    enqueueOutside({ x: bbox.x, y });
    enqueueOutside({ x: bbox.x + bbox.width - 1, y });
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (next.x < bbox.x || next.x >= bbox.x + bbox.width
        || next.y < bbox.y || next.y >= bbox.y + bbox.height) continue;
      enqueueOutside(next);
    }
  }

  const visited = new Set<string>();
  const regions: EnclosedRegion[] = [];
  for (let y = bbox.y + 1; y < bbox.y + bbox.height - 1; y += 1) {
    for (let x = bbox.x + 1; x < bbox.x + bbox.width - 1; x += 1) {
      const start = { x, y };
      const startKey = pointKey(start);
      if (filled.has(startKey) || outside.has(startKey) || visited.has(startKey)) continue;
      const regionQueue = [start];
      const pixels: MarkerPoint[] = [];
      visited.add(startKey);
      for (let head = 0; head < regionQueue.length; head += 1) {
        const current = regionQueue[head];
        pixels.push(current);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const next = { x: current.x + dx, y: current.y + dy };
          if (next.x <= bbox.x || next.x >= bbox.x + bbox.width - 1
            || next.y <= bbox.y || next.y >= bbox.y + bbox.height - 1) continue;
          const key = pointKey(next);
          if (filled.has(key) || outside.has(key) || visited.has(key)) continue;
          visited.add(key);
          regionQueue.push(next);
        }
      }
      if (!pixels.length) continue;
      const extent = pixelExtent(pixels, seed);
      const boundary = componentOuterBoundary(pixels);
      if (boundary.length < 3) continue;
      regions.push({
        pixels,
        boundary,
        bbox: extent.bbox,
        containsSeed: pointInPolygon(seed, boundary),
        distance: extent.distance,
      });
    }
  }
  return regions;
}

function componentOuterBoundary(points: MarkerPoint[], maxPoints = 48): MarkerPoint[] {
  const filled = new Set(points.map(pointKey));
  const outgoing = new Map<string, MarkerPoint[]>();
  const addEdge = (start: MarkerPoint, end: MarkerPoint) => {
    const key = pointKey(start);
    const targets = outgoing.get(key) || [];
    targets.push(end);
    outgoing.set(key, targets);
  };
  for (const { x, y } of points) {
    if (!filled.has(`${x},${y - 1}`)) addEdge({ x, y }, { x: x + 1, y });
    if (!filled.has(`${x + 1},${y}`)) addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 });
    if (!filled.has(`${x},${y + 1}`)) addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
    if (!filled.has(`${x - 1},${y}`)) addEdge({ x, y: y + 1 }, { x, y });
  }
  const loops: MarkerPoint[][] = [];
  const edgeSeen = new Set<string>();
  for (const [startKey, targets] of outgoing) {
    const [sx, sy] = startKey.split(",").map(Number);
    for (const initialTarget of targets) {
      const initialEdge = `${startKey}>${pointKey(initialTarget)}`;
      if (edgeSeen.has(initialEdge)) continue;
      const loop: MarkerPoint[] = [{ x: sx, y: sy }];
      let current = { x: sx, y: sy };
      let next = initialTarget;
      for (let guard = 0; guard <= points.length * 8; guard += 1) {
        edgeSeen.add(`${pointKey(current)}>${pointKey(next)}`);
        current = next;
        if (pointKey(current) === startKey) break;
        loop.push(current);
        const nextTarget = (outgoing.get(pointKey(current)) || [])
          .find((candidate) => !edgeSeen.has(`${pointKey(current)}>${pointKey(candidate)}`));
        if (!nextTarget) break;
        next = nextTarget;
      }
      if (loop.length >= 3 && pointKey(current) === startKey) loops.push(loop);
    }
  }
  const outer = loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0] || [];
  if (outer.length <= maxPoints) return outer;
  return Array.from({ length: maxPoints }, (_, index) => outer[Math.floor(index * outer.length / maxPoints)]);
}

function pointInPolygon(point: MarkerPoint, polygon: MarkerPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function findRelevantCandidates(
  components: PixelComponent[],
  seed: MarkerPoint,
  seedSnapRadius: number,
  minAreaPx: number,
): MarkerCandidate[] {
  return components
    .filter((component) => component.pixels.length >= minAreaPx)
    .map((component) => {
      const boundary = componentOuterBoundary(component.pixels);
      const extent = pixelExtent(component.pixels, seed);
      const bbox = extent.bbox;
      const compactness = component.pixels.length / Math.max(1, bbox.width * bbox.height);
      return {
        component,
        boundary,
        bbox,
        containsSeed: pointInPolygon(seed, boundary),
        distance: extent.distance,
        enclosed: componentHasEnclosedBackground(component.pixels, bbox),
        compact: compactness >= 0.42,
      };
    })
    .filter((entry) => (entry.containsSeed || entry.distance <= seedSnapRadius)
      && (entry.enclosed || entry.compact)
      && entry.boundary.length >= 3);
}

function enclosedRegionNearSeed(
  barrier: Uint8Array,
  width: number,
  height: number,
  seedIndex: number,
  minimumArea: number,
  maximumArea: number,
  searchRadius = 10,
): { mask: Uint8Array; count: number; relocatedPx: number } | null {
  const labels = new Int32Array(barrier.length);
  const regions: Array<{ mask: Uint8Array; count: number; touchesBorder: boolean }> = [];
  const classify = (start: number) => {
    if (barrier[start]) return null;
    const knownLabel = labels[start];
    if (knownLabel > 0) return regions[knownLabel - 1];
    const label = regions.length + 1;
    const mask = new Uint8Array(barrier.length);
    const queue = new Int32Array(barrier.length);
    let head = 0, tail = 0;
    let touchesBorder = false;
    labels[start] = label;
    mask[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width, y = Math.floor(current / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (barrier[next] || labels[next]) continue;
        labels[next] = label;
        mask[next] = 1;
        queue[tail++] = next;
      }
    }
    const region = { mask, count: tail, touchesBorder };
    regions.push(region);
    return region;
  };
  const valid = (region: ReturnType<typeof classify>) => Boolean(
    region && !region.touchesBorder && region.count >= minimumArea && region.count <= maximumArea,
  );
  const original = classify(seedIndex);
  if (valid(original) && original) return { mask: original.mask, count: original.count, relocatedPx: 0 };

  const seedX = seedIndex % width, seedY = Math.floor(seedIndex / width);
  const matches = new Map<number, { mask: Uint8Array; count: number; relocatedPx: number }>();
  for (let radius = 1; radius <= searchRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = seedX + dx, y = seedY + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const index = y * width + x;
        const region = classify(index);
        if (!valid(region) || !region) continue;
        const label = labels[index];
        if (!matches.has(label)) {
          matches.set(label, { mask: region.mask, count: region.count, relocatedPx: Math.hypot(dx, dy) });
        }
      }
    }
    if (matches.size > 1) return null;
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

function seedFirstBarrierDetection(
  image: MarkerImageData,
  seed: MarkerPoint,
  roiRadius: number,
  x0: number,
  y0: number,
  roiWidth: number,
  roiHeight: number,
  backgroundLuma: number,
  darkThreshold: number,
  minContrast: number,
  minAreaPx: number,
  maxAreaFraction: number,
): ControlledMarkerDetection | null {
  const adaptive = adaptiveDarkBarrier(
    image,
    x0,
    y0,
    roiWidth,
    roiHeight,
    backgroundLuma,
    darkThreshold,
    minContrast,
  );
  const seedX = clamp(Math.round(seed.x) - x0, 0, roiWidth - 1);
  const seedY = clamp(Math.round(seed.y) - y0, 0, roiHeight - 1);
  const seedIndex = seedY * roiWidth + seedX;
  const regionLimit = roiWidth * roiHeight * 0.65;
  const markerLimit = roiWidth * roiHeight * maxAreaFraction;
  let bestFailure = {
    priority: -1,
    stage: "no_enclosure",
    repairRadius: 0,
    boundarySupportRatio: 0,
  };
  const noteFailure = (priority: number, stage: string, repairRadius: number, boundarySupportRatio = 0) => {
    if (priority < bestFailure.priority) return;
    bestFailure = { priority, stage, repairRadius, boundarySupportRatio };
  };

  const repairAttempts: Array<{ repairRadius: number; build(): Uint8Array | null }> = [
    { repairRadius: 0, build: () => adaptive.mask },
    { repairRadius: 1, build: () => repairBarrier(adaptive.mask, roiWidth, roiHeight, 1) },
    { repairRadius: 2, build: () => repairBarrier(adaptive.mask, roiWidth, roiHeight, 2) },
    { repairRadius: 3, build: () => repairBarrier(adaptive.mask, roiWidth, roiHeight, 3) },
    {
      repairRadius: 5,
      build: () => bridgeSingleStrokeGap(
        adaptive.mask,
        roiWidth,
        roiHeight,
        seedX,
        seedY,
        clamp(Math.round(Math.min(roiWidth, roiHeight) * 0.06), 14, 24),
      ),
    },
  ];
  for (const { repairRadius, build } of repairAttempts) {
    const repaired = build();
    if (!repaired) continue;
    const selectedRegion = enclosedRegionNearSeed(
      repaired,
      roiWidth,
      roiHeight,
      seedIndex,
      Math.max(minAreaPx * 4, 16),
      regionLimit,
    );
    if (!selectedRegion) {
      noteFailure(1, repaired[seedIndex] ? "seed_on_barrier" : "seed_region_leaks_to_roi_border", repairRadius);
      continue;
    }
    const regionMask = selectedRegion.mask;
    const tail = selectedRegion.count;

    const regionPixels: MarkerPoint[] = [];
    for (let index = 0; index < regionMask.length; index += 1) {
      if (!regionMask[index]) continue;
      regionPixels.push({ x: x0 + index % roiWidth, y: y0 + Math.floor(index / roiWidth) });
    }
    const boundary = componentOuterBoundary(regionPixels);
    if (boundary.length < 3) {
      noteFailure(2, "region_boundary_invalid", repairRadius);
      continue;
    }

    const supportMask = new Uint8Array(repaired.length);
    let supportCount = 0;
    let originalSupportCount = 0;
    for (let index = 0; index < repaired.length; index += 1) {
      if (!repaired[index]) continue;
      const cx = index % roiWidth;
      const cy = Math.floor(index / roiWidth);
      let adjacentToRegion = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < roiWidth && ny >= 0 && ny < roiHeight
          && regionMask[ny * roiWidth + nx]) adjacentToRegion = true;
      }
      if (!adjacentToRegion) continue;
      supportMask[index] = 1;
      supportCount += 1;
      let originalNearby = false;
      for (let dy = -1; dy <= 1 && !originalNearby; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < roiWidth && ny >= 0 && ny < roiHeight
            && adaptive.mask[ny * roiWidth + nx]) {
            originalNearby = true;
            break;
          }
        }
      }
      if (originalNearby) originalSupportCount += 1;
    }
    if (supportCount < Math.max(minAreaPx, 8)) {
      noteFailure(3, "boundary_support_missing", repairRadius);
      continue;
    }
    const boundarySupportRatio = originalSupportCount / supportCount;
    const minimumBoundarySupport = repairRadius > 3 ? 0.72 : 0.55;
    if (boundarySupportRatio < minimumBoundarySupport) {
      noteFailure(4, "boundary_support_low", repairRadius, boundarySupportRatio);
      continue;
    }

    // Only the dark pixels immediately supporting the enclosed region belong
    // to the marker-size check. Pulling the complete connected component here
    // makes a valid pen outline fail whenever it touches hair, a wrinkle or a
    // broad facial shadow.
    const supportingComponents = extractComponents(supportMask, roiWidth, roiHeight, x0, y0, image);
    const markerPixels = supportingComponents.flatMap((component) => component.pixels);
    if (markerPixels.length < minAreaPx || markerPixels.length > markerLimit) {
      noteFailure(5, "marker_area_invalid", repairRadius, boundarySupportRatio);
      continue;
    }
    const originalMarkerLumas = markerPixels
      .filter((point) => adaptive.mask[(point.y - y0) * roiWidth + point.x - x0])
      .map((point) => luma(image.data, (point.y * Math.floor(image.width) + point.x) * 4));
    if (!originalMarkerLumas.length) {
      noteFailure(6, "original_marker_support_missing", repairRadius, boundarySupportRatio);
      continue;
    }
    const markerLuma = originalMarkerLumas.reduce((sum, value) => sum + value, 0) / originalMarkerLumas.length;
    const contrast = backgroundLuma - markerLuma;
    if (contrast < minContrast) {
      noteFailure(7, "marker_contrast_low", repairRadius, boundarySupportRatio);
      continue;
    }

    const geometryExtent = pixelExtent(regionPixels, seed);
    const markerExtent = pixelExtent(markerPixels, seed);
    const center = regionPixels.reduce((total, point) => ({
      x: total.x + point.x / regionPixels.length,
      y: total.y + point.y / regionPixels.length,
    }), { x: 0, y: 0 });
    return {
      ok: true,
      failure_code: null,
      center,
      boundary,
      area_px: regionPixels.length,
      bbox: geometryExtent.bbox,
      geometry_mode: "enclosed_region",
      seed_relation: "enclosed",
      marker_area_px: markerPixels.length,
      marker_bbox: markerExtent.bbox,
      confidence: clamp(contrast / 96 * boundarySupportRatio, 0, 1),
      candidate_count: supportingComponents.length,
      warnings: [
        ...(repairRadius > 3
          ? ["barrier_repaired", "single_gap_trend_repaired"]
          : repairRadius ? ["barrier_repaired"] : []),
        ...(selectedRegion.relocatedPx > 0 ? ["seed_relocated_from_marker_stroke"] : []),
      ],
      diagnostics: {
        method: "seed_first_barrier",
        roi_radius: roiRadius,
        local_window_radius: adaptive.localWindowRadius,
        repair_radius: repairRadius,
        boundary_support_ratio: boundarySupportRatio,
        repair_fraction: 1 - boundarySupportRatio,
        seed_relocated_px: selectedRegion.relocatedPx,
      },
      audit: { local_only: true, raw_media_retained: false, network_request_made: false },
    };
  }
  const rejected = failure("seed_not_enclosed");
  rejected.warnings = [`seed_not_enclosed:${bestFailure.stage}`];
  rejected.diagnostics = {
    method: "seed_first_barrier",
    roi_radius: roiRadius,
    local_window_radius: adaptive.localWindowRadius,
    repair_radius: bestFailure.repairRadius,
    boundary_support_ratio: bestFailure.boundarySupportRatio,
    repair_fraction: 1 - bestFailure.boundarySupportRatio,
    failure_stage: bestFailure.stage,
  };
  return rejected;
}

interface ControlledMarkerOptions {
  roiRadius?: number;
  seedSnapRadius?: number;
  minAreaPx?: number;
  maxAreaFraction?: number;
  minContrast?: number;
  enableSeedFirstBarrier?: boolean;
  canonicalizeFromDetectedCenter?: boolean;
}

function detectControlledMarkerInRoi(
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions,
  roiRadius: number,
): ControlledMarkerDetection {
  const {
    minAreaPx = 9,
    maxAreaFraction = 0.25,
    minContrast = 24,
    enableSeedFirstBarrier = true,
  } = options;
  const width = Math.floor(image.width);
  const height = Math.floor(image.height);
  const seedSnapRadius = options.seedSnapRadius ?? Math.max(10, Math.round(roiRadius * 0.08));
  if (width <= 0 || height <= 0 || image.data.length < width * height * 4) return failure("invalid_image");
  if (!Number.isFinite(seed.x) || !Number.isFinite(seed.y) || seed.x < 0 || seed.x >= width || seed.y < 0 || seed.y >= height) {
    return failure("seed_outside_image");
  }

  const x0 = clamp(Math.floor(seed.x - roiRadius), 0, width - 1);
  const y0 = clamp(Math.floor(seed.y - roiRadius), 0, height - 1);
  const x1 = clamp(Math.ceil(seed.x + roiRadius), 0, width - 1);
  const y1 = clamp(Math.ceil(seed.y + roiRadius), 0, height - 1);
  const roiWidth = x1 - x0 + 1;
  const roiHeight = y1 - y0 + 1;
  const roiLumas: number[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) roiLumas.push(luma(image.data, (y * width + x) * 4));
  }
  // A marker near the face edge shares its ROI with hair, ears, clothing or
  // background. The upper local percentile represents the skin field without
  // letting those dark areas suppress the marker threshold.
  const backgroundLuma = robustBackgroundLuma(roiLumas);
  const darkThreshold = Math.min(160, backgroundLuma - minContrast);
  const dark = new Uint8Array(roiWidth * roiHeight);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (luma(image.data, (y * width + x) * 4) <= darkThreshold) dark[(y - y0) * roiWidth + x - x0] = 1;
    }
  }
  let seedFirstResult: ControlledMarkerDetection | null | undefined;
  const seedFirstFallback = (): ControlledMarkerDetection | null => {
    if (!enableSeedFirstBarrier) return null;
    if (seedFirstResult === undefined) {
      seedFirstResult = seedFirstBarrierDetection(
        image,
        seed,
        roiRadius,
        x0,
        y0,
        roiWidth,
        roiHeight,
        backgroundLuma,
        darkThreshold,
        minContrast,
        minAreaPx,
        maxAreaFraction,
      );
    }
    return seedFirstResult;
  };
  const fallbackOrFailure = (code: ControlledMarkerFailureCode, candidateCount = 0): ControlledMarkerDetection => {
    const fallback = seedFirstFallback();
    if (fallback?.ok) return fallback;
    const rejected = failure(code, candidateCount);
    if (fallback?.diagnostics) {
      rejected.diagnostics = fallback.diagnostics;
      rejected.warnings = [`${code}:${fallback.diagnostics.failure_stage || "barrier_rejected"}`];
    }
    return rejected;
  };

  // Prefer the original dark pixels so a thin hand-drawn line is never
  // eroded away before it can be recognised. Only fall back to a small,
  // bounded strict closing pass when the original contour cannot form a candidate.
  const rawComponents = extractComponents(dark, roiWidth, roiHeight, x0, y0, image);
  const rawCandidates = findRelevantCandidates(rawComponents, seed, seedSnapRadius, minAreaPx);
  let repairedComponents: PixelComponent[] = [];
  let repairedCandidates: MarkerCandidate[] = [];
  const hasSeedSizedComponent = rawComponents.some((component) => {
    if (component.pixels.length < minAreaPx) return false;
    const extent = pixelExtent(component.pixels, seed);
    const insideBounds = seed.x >= extent.bbox.x && seed.x < extent.bbox.x + extent.bbox.width
      && seed.y >= extent.bbox.y && seed.y < extent.bbox.y + extent.bbox.height;
    return insideBounds || extent.distance <= seedSnapRadius;
  });
  // A low-contrast hand-drawn ring can be split into several short arcs. In
  // that case no single arc contains the seed or falls within the snap radius,
  // even though the aggregate dark pixels clearly surround the click. Permit
  // the same bounded bridge pass when the click neighbourhood has enough dark
  // evidence; candidate filtering below still rejects isolated noise.
  const seedNeighborhoodRadius = Math.min(
    roiRadius,
    Math.max(seedSnapRadius * 2, Math.round(roiRadius * 0.7)),
  );
  let seedNeighborhoodDarkPixels = 0;
  for (let y = Math.max(y0, Math.floor(seed.y - seedNeighborhoodRadius));
    y <= Math.min(y1, Math.ceil(seed.y + seedNeighborhoodRadius)); y += 1) {
    for (let x = Math.max(x0, Math.floor(seed.x - seedNeighborhoodRadius));
      x <= Math.min(x1, Math.ceil(seed.x + seedNeighborhoodRadius)); x += 1) {
      if (dark[(y - y0) * roiWidth + x - x0]) seedNeighborhoodDarkPixels += 1;
    }
  }
  const hasSeedNeighborhoodEvidence = seedNeighborhoodDarkPixels >= Math.max(minAreaPx * 2, 12);
  if (hasSeedSizedComponent || hasSeedNeighborhoodEvidence) {
    repairedComponents = extractComponents(
      repairBarrier(dark, roiWidth, roiHeight, 1),
      roiWidth,
      roiHeight,
      x0,
      y0,
      image,
    );
    repairedCandidates = findRelevantCandidates(repairedComponents, seed, seedSnapRadius, minAreaPx);
    if (!repairedCandidates.length) {
      repairedComponents = extractComponents(
        repairBarrier(dark, roiWidth, roiHeight, 2),
        roiWidth,
        roiHeight,
        x0,
        y0,
        image,
      );
      repairedCandidates = findRelevantCandidates(repairedComponents, seed, seedSnapRadius, minAreaPx);
    }
    if (!repairedCandidates.length) {
      repairedComponents = extractComponents(
        repairBarrier(dark, roiWidth, roiHeight, 3),
        roiWidth,
        roiHeight,
        x0,
        y0,
        image,
      );
      repairedCandidates = findRelevantCandidates(repairedComponents, seed, seedSnapRadius, minAreaPx);
    }
  }
  const relevantCandidates = rawCandidates.length ? rawCandidates : repairedCandidates;
  const components = rawCandidates.length ? rawComponents : (repairedComponents.length ? repairedComponents : rawComponents);
  const seedEnclosingCandidates = relevantCandidates
    .map((candidate) => ({
      candidate,
      region: candidate.enclosed
        ? enclosedBackgroundRegions(candidate.component.pixels, candidate.bbox, seed)
          .filter((region) => region.containsSeed)
          .sort((a, b) => b.pixels.length - a.pixels.length)[0] || null
        : null,
    }))
    .filter((entry) => entry.region !== null);
  if (seedEnclosingCandidates.length > 1) {
    return failure("ambiguous_candidates", seedEnclosingCandidates.length);
  }
  // A closed contour that actually encloses the click is stronger evidence
  // than a compact dark feature merely lying near the click. This prevents a
  // mole, wrinkle or short pen fragment inside the intended outline from
  // turning an otherwise unique marked region into a false ambiguity.
  const selectedSeedEnclosure = seedEnclosingCandidates[0] || null;
  if (!selectedSeedEnclosure && relevantCandidates.length > 1) {
    return failure("ambiguous_candidates", relevantCandidates.length);
  }
  const selected = selectedSeedEnclosure?.candidate || relevantCandidates
    .sort((a, b) => Number(b.containsSeed) - Number(a.containsSeed)
      || a.distance - b.distance
      || b.component.pixels.length - a.component.pixels.length)[0];
  if (!selected) return fallbackOrFailure(components.length ? "component_too_small" : "no_dark_component");
  // An interior click must resolve to a contour that encloses it. Only allow a
  // very small miss outside a closed pen line, or a click directly on a filled
  // marker. The previous ROI-scaled snap radius could accept an unrelated mole
  // or shadow several dozen pixels away and then report a false success.
  const permittedMiss = selected.enclosed ? Math.min(seedSnapRadius, 6) : 2;
  if (!selectedSeedEnclosure && selected.distance > permittedMiss) {
    return fallbackOrFailure("seed_not_enclosed", relevantCandidates.length);
  }
  const maxArea = roiWidth * roiHeight * maxAreaFraction;
  if (selected.component.pixels.length > maxArea) return fallbackOrFailure("component_too_large");
  const selectedOriginalDarkLumas = selected.component.pixels
    .filter((point) => dark[(point.y - y0) * roiWidth + point.x - x0])
    .map((point) => luma(image.data, (point.y * width + point.x) * 4));
  const markerLuma = selectedOriginalDarkLumas.length
    ? selectedOriginalDarkLumas.reduce((sum, value) => sum + value, 0) / selectedOriginalDarkLumas.length
    : selected.component.meanLuma;
  const contrast = backgroundLuma - markerLuma;
  if (contrast < minContrast) return fallbackOrFailure("low_contrast");

  const enclosedRegions = selected.enclosed
    ? enclosedBackgroundRegions(selected.component.pixels, selected.bbox, seed)
      .sort((a, b) => Number(b.containsSeed) - Number(a.containsSeed)
        || a.distance - b.distance
        || b.pixels.length - a.pixels.length)
    : [];
  const enclosedRegion = selectedSeedEnclosure?.region || enclosedRegions[0] || null;
  if (selected.enclosed && !enclosedRegion) {
    return fallbackOrFailure("component_too_small", relevantCandidates.length);
  }
  const geometryPixels = enclosedRegion?.pixels || selected.component.pixels;
  const geometryBoundary = enclosedRegion?.boundary || selected.boundary;
  const geometryBbox = enclosedRegion?.bbox || selected.bbox;
  const xs = geometryPixels.map((point) => point.x);
  const ys = geometryPixels.map((point) => point.y);
  const center = {
    x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
  };
  const warnings: string[] = [];
  return {
    ok: true,
    failure_code: null,
    center,
    boundary: geometryBoundary,
    area_px: geometryPixels.length,
    bbox: geometryBbox,
    geometry_mode: enclosedRegion ? "enclosed_region" : "dark_component",
    seed_relation: enclosedRegion?.containsSeed
      ? "enclosed"
      : selected.distance <= 2
        ? "on_marker"
        : "near_marker",
    marker_area_px: selected.component.pixels.length,
    marker_bbox: selected.bbox,
    confidence: clamp(contrast / 96, 0, 1),
    candidate_count: relevantCandidates.length,
    warnings,
    audit: { local_only: true, raw_media_retained: false, network_request_made: false },
  };
}

function compatibleCanonicalRegion(
  first: ControlledMarkerDetection,
  canonical: ControlledMarkerDetection,
): boolean {
  if (!first.ok || !canonical.ok || !first.center || !canonical.center || !first.bbox || !canonical.bbox) return false;
  if (first.geometry_mode !== canonical.geometry_mode) return false;
  const left = Math.max(first.bbox.x, canonical.bbox.x);
  const top = Math.max(first.bbox.y, canonical.bbox.y);
  const right = Math.min(first.bbox.x + first.bbox.width, canonical.bbox.x + canonical.bbox.width);
  const bottom = Math.min(first.bbox.y + first.bbox.height, canonical.bbox.y + canonical.bbox.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = first.bbox.width * first.bbox.height
    + canonical.bbox.width * canonical.bbox.height - intersection;
  const overlap = union > 0 ? intersection / union : 0;
  const referenceSize = Math.max(1, first.bbox.width, first.bbox.height);
  const centerDistance = Math.hypot(
    first.center.x - canonical.center.x,
    first.center.y - canonical.center.y,
  );
  const areaRatio = Math.max(first.area_px, canonical.area_px)
    / Math.max(1, Math.min(first.area_px, canonical.area_px));
  return overlap >= 0.55 && centerDistance <= referenceSize * 0.2 && areaRatio <= 1.6;
}

export function detectControlledMarker(
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions = {},
): ControlledMarkerDetection {
  const width = Math.floor(image.width);
  const height = Math.floor(image.height);
  if (width <= 0 || height <= 0 || image.data.length < width * height * 4) return failure("invalid_image");
  if (!Number.isFinite(seed.x) || !Number.isFinite(seed.y)
    || seed.x < 0 || seed.x >= width || seed.y < 0 || seed.y >= height) {
    return failure("seed_outside_image");
  }

  if (options.roiRadius !== undefined) {
    return detectControlledMarkerInRoi(
      image,
      seed,
      options,
      clamp(Math.round(options.roiRadius), 1, Math.max(width, height)),
    );
  }

  const shortSide = Math.min(width, height);
  const radii = [
    clamp(Math.round(shortSide * 0.12), 56, 180),
    clamp(Math.round(shortSide * 0.22), 96, 260),
    clamp(Math.round(shortSide * 0.30), 128, 320),
  ].filter((radius, index, all) => all.indexOf(radius) === index);
  let bestRetryableFailure: ControlledMarkerDetection | null = null;
  let lastResult: ControlledMarkerDetection | null = null;
  const successfulResults: ControlledMarkerDetection[] = [];
  for (const roiRadius of radii) {
    const result = detectControlledMarkerInRoi(image, seed, options, roiRadius);
    lastResult = result;
    if (result.ok) {
      successfulResults.push(result);
      continue;
    }
    if (result.failure_code !== "component_too_small"
      && result.failure_code !== "component_too_large"
      && result.failure_code !== "no_dark_component"
      && result.failure_code !== "ambiguous_candidates"
      && result.failure_code !== "seed_not_enclosed") {
      return result;
    }
    const retryPriority: Partial<Record<ControlledMarkerFailureCode, number>> = {
      no_dark_component: 0,
      component_too_small: 1,
      component_too_large: 2,
      seed_not_enclosed: 3,
      ambiguous_candidates: 4,
    };
    if (!bestRetryableFailure
      || (retryPriority[result.failure_code] ?? -1)
        >= (retryPriority[bestRetryableFailure.failure_code || "no_dark_component"] ?? -1)) {
      bestRetryableFailure = result;
    }
  }
  // Do not accept a small-ROI success when the largest available ROI reveals
  // multiple enclosing contours. Conversely, a larger ROI can resolve
  // fragmentary small-ROI candidates into one complete outline.
  if (lastResult?.failure_code === "ambiguous_candidates") return lastResult;
  if (successfulResults.length) {
    const selected = successfulResults
      .sort((a, b) => Number(b.seed_relation === "enclosed") - Number(a.seed_relation === "enclosed")
        || Number(b.geometry_mode === "enclosed_region") - Number(a.geometry_mode === "enclosed_region")
        || b.area_px - a.area_px)[0];
    if (options.canonicalizeFromDetectedCenter !== false
      && selected.geometry_mode === "enclosed_region"
      && selected.center
      && selected.bbox
      && Math.hypot(selected.center.x - seed.x, selected.center.y - seed.y) > 0.5) {
      const canonicalRadius = clamp(
        Math.ceil(Math.max(selected.bbox.width, selected.bbox.height) * 0.6 + 24),
        56,
        Math.max(width, height),
      );
      const canonical = detectControlledMarkerInRoi(
        image,
        selected.center,
        { ...options, canonicalizeFromDetectedCenter: false },
        canonicalRadius,
      );
      if (compatibleCanonicalRegion(selected, canonical)) {
        canonical.warnings = [...new Set([...canonical.warnings, "canonical_seed_refined"])];
        return canonical;
      }
    }
    return selected;
  }
  return bestRetryableFailure || failure("no_dark_component");
}
