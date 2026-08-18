export const CONTROLLED_MARKER_DETECTOR_VERSION = "0.23";

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
  | "scan_range_too_small"
  | "edge_discontinuous"
  | "unstable_enclosure"
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
  scan?: {
    diameter_mm: number | null;
    radius_px: number;
    expected_diameter_px: number | null;
  };
  diagnostics?: {
    method?: "seed_first_barrier" | "radial_seed_boundary" | "low_contrast_near_circular";
    roi_radius?: number;
    local_window_radius?: number;
    repair_radius?: number;
    boundary_support_ratio?: number;
    repair_fraction?: number;
    seed_relocated_px?: number;
    failure_stage?: string;
    angular_support_ratio?: number;
    maximum_gap_degrees?: number;
    detected_diameter_px?: number;
    expected_diameter_px?: number;
    detected_to_expected_diameter_ratio?: number;
    scan_probe_count?: number;
    scan_probe_success_count?: number;
    scan_probe_consensus_count?: number;
    scan_probe_group_sizes?: number[];
    ridge_contrast?: number;
    radial_variation_ratio?: number;
    shape_compactness?: number;
    boundary_smoothing?: "periodic_constrained" | "raw_fallback";
    boundary_smoothing_scale?: number;
    boundary_smoothing_area_ratio?: number;
    boundary_smoothing_passes?: number;
    boundary_smoothing_outside_ratio?: number;
    boundary_smoothing_max_miss_ratio?: number;
    boundary_regularization?: "convex_hull";
    boundary_regularization_area_ratio?: number;
    boundary_regularization_solidity?: number;
    boundary_regularization_p90_displacement_ratio?: number;
    boundary_regularization_max_displacement_ratio?: number;
    boundary_stroke_reconciliation?: "radial_ridge" | "bounded_marker_bbox";
    boundary_stroke_scale?: number;
    boundary_stroke_scale_x?: number;
    boundary_stroke_scale_y?: number;
    boundary_stroke_area_ratio?: number;
    boundary_stroke_center_shift_ratio?: number;
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

function insideScanCircle(x: number, y: number, centerX: number, centerY: number, radius: number): boolean {
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}

function clearOutsideScanCircle(
  mask: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
): Uint8Array {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!insideScanCircle(x, y, centerX, centerY, radius)) mask[y * width + x] = 0;
    }
  }
  return mask;
}

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

const STROKE_DIRECTIONS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

function skeletonNeighbours(
  skeleton: Uint8Array,
  width: number,
  height: number,
  index: number,
): number[] {
  const x = index % width;
  const y = Math.floor(index / width);
  return STROKE_DIRECTIONS.flatMap(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) return [];
    const next = ny * width + nx;
    return skeleton[next] ? [next] : [];
  });
}

function thinStrokeMask(stroke: Uint8Array, width: number, height: number): Uint8Array {
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
          for (let neighbour = 0; neighbour < 8; neighbour += 1) {
            if (!neighbours[neighbour] && neighbours[(neighbour + 1) % 8]) transitions += 1;
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
  return skeleton;
}

function principalSkeletonPath(
  skeleton: Uint8Array,
  width: number,
  height: number,
): { pixels: number[]; first: number; second: number; firstInward: number; secondInward: number } | null {
  const pixels = Array.from(skeleton.keys()).filter((index) => skeleton[index]);
  const endpoints = pixels.filter((index) => skeletonNeighbours(skeleton, width, height, index).length === 1);
  if (endpoints.length < 2 || endpoints.length > 12) return null;
  if (endpoints.length === 2) {
    const firstInward = endpointInwardIndex(skeleton, width, height, endpoints[0]);
    const secondInward = endpointInwardIndex(skeleton, width, height, endpoints[1]);
    return firstInward === null || secondInward === null ? null : {
      pixels,
      first: endpoints[0],
      second: endpoints[1],
      firstInward,
      secondInward,
    };
  }

  let bestPath: number[] = [];
  for (const start of endpoints) {
    const distance = new Int32Array(skeleton.length);
    distance.fill(-1);
    const previous = new Int32Array(skeleton.length);
    previous.fill(-1);
    const queue = new Int32Array(pixels.length);
    let head = 0;
    let tail = 0;
    distance[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const current = queue[head++];
      for (const next of skeletonNeighbours(skeleton, width, height, current)) {
        if (distance[next] >= 0) continue;
        distance[next] = distance[current] + 1;
        previous[next] = current;
        queue[tail++] = next;
      }
    }
    for (const end of endpoints) {
      if (distance[end] < 0 || distance[end] + 1 <= bestPath.length) continue;
      const path: number[] = [];
      for (let current = end; current >= 0; current = previous[current]) {
        path.push(current);
        if (current === start) break;
      }
      if (path[path.length - 1] === start) bestPath = path.reverse();
    }
  }
  // A noisy fork may be ignored only when one observed path explains most of
  // the component. Comparable branches are genuinely ambiguous continuations.
  if (bestPath.length < 8 || bestPath.length / Math.max(1, pixels.length) < 0.5) return null;
  return {
    pixels: bestPath,
    first: bestPath[0],
    second: bestPath[bestPath.length - 1],
    firstInward: bestPath[Math.min(5, bestPath.length - 1)],
    secondInward: bestPath[Math.max(0, bestPath.length - 6)],
  };
}

function endpointInwardIndex(
  skeleton: Uint8Array,
  width: number,
  height: number,
  endpoint: number,
): number | null {
  let previous = -1;
  let current = endpoint;
  for (let step = 0; step < 6; step += 1) {
    const next = skeletonNeighbours(skeleton, width, height, current)
      .filter((index) => index !== previous);
    if (next.length !== 1) break;
    previous = current;
    current = next[0];
  }
  return current === endpoint ? null : current;
}

function drawStrokeBridge(
  mask: Uint8Array,
  width: number,
  height: number,
  first: MarkerPoint,
  second: MarkerPoint,
): void {
  const gapX = second.x - first.x;
  const gapY = second.y - first.y;
  const steps = Math.max(Math.abs(gapX), Math.abs(gapY));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(first.x + gapX * step / Math.max(1, steps));
    const y = Math.round(first.y + gapY * step / Math.max(1, steps));
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) mask[ny * width + nx] = 1;
      }
    }
  }
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
      for (const [dx, dy] of STROKE_DIRECTIONS) {
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
  const skeleton = thinStrokeMask(stroke, width, height);
  const principal = principalSkeletonPath(skeleton, width, height);
  if (!principal) return null;
  const skeletonPixels = principal.pixels;
  const first = principal.first;
  const second = principal.second;
  const firstPoint = { x: first % width, y: Math.floor(first / width) };
  const secondPoint = { x: second % width, y: Math.floor(second / width) };
  const gap = Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y);
  // A bridge is only a bounded pen interruption, not permission to invent a
  // missing side of the lesion. Relative path length keeps the limit meaningful
  // for both small and large outlines even when the absolute scan is 60 mm.
  if (gap < 2 || gap > maxGapPx || gap / Math.max(1, skeletonPixels.length) > 0.12) return null;

  const firstInner = {
    x: principal.firstInward % width,
    y: Math.floor(principal.firstInward / width),
  };
  const secondInner = {
    x: principal.secondInward % width,
    y: Math.floor(principal.secondInward / width),
  };
  const unitDot = (ax: number, ay: number, bx: number, by: number) => (
    (ax * bx + ay * by) / Math.max(1e-9, Math.hypot(ax, ay) * Math.hypot(bx, by))
  );
  const gapX = secondPoint.x - firstPoint.x, gapY = secondPoint.y - firstPoint.y;
  // Smooth curves normally continue almost directly across a gap, while a
  // polygon corner legitimately turns. Allow a bounded corner turn here; the
  // enclosure and observed-boundary support gates below still reject a bridge
  // that invents most of a missing side.
  if (unitDot(firstInner.x - firstPoint.x, firstInner.y - firstPoint.y, gapX, gapY) > 0.35
    || unitDot(secondInner.x - secondPoint.x, secondInner.y - secondPoint.y, -gapX, -gapY) > 0.35) {
    return null;
  }

  const repaired = mask.slice();
  drawStrokeBridge(repaired, width, height, firstPoint, secondPoint);
  return repaired;
}

interface OpenStrokeEndpoint {
  fragment: number;
  index: number;
  point: MarkerPoint;
  inward: MarkerPoint;
}

interface OpenStrokeFragment {
  component: number[];
  skeleton: Uint8Array;
  skeletonPixels: number[];
  endpoints: OpenStrokeEndpoint[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

function bridgeStrokeFragments(
  mask: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  maxGapPx: number,
): Uint8Array | null {
  const visited = new Uint8Array(mask.length);
  const rawComponents: Array<{ pixels: number[]; bbox: OpenStrokeFragment["bbox"] }> = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    const pixels: number[] = [];
    visited[start] = 1;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      pixels.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const [dx, dy] of STROKE_DIRECTIONS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (pixels.length >= 12) rawComponents.push({ pixels, bbox: { minX, minY, maxX, maxY } });
  }

  const fragments: OpenStrokeFragment[] = [];
  for (const raw of rawComponents) {
    const stroke = new Uint8Array(mask.length);
    raw.pixels.forEach((index) => { stroke[index] = 1; });
    const skeleton = thinStrokeMask(stroke, width, height);
    const principal = principalSkeletonPath(skeleton, width, height);
    if (!principal) continue;
    const skeletonPixels = principal.pixels;
    const endpointIndices = [principal.first, principal.second];
    const inwardIndices = [principal.firstInward, principal.secondInward];
    const fragmentIndex = fragments.length;
    const endpoints = endpointIndices.map((index, endpointIndex): OpenStrokeEndpoint => {
      const inwardIndex = inwardIndices[endpointIndex];
      return {
        fragment: fragmentIndex,
        index,
        point: { x: index % width, y: Math.floor(index / width) },
        inward: { x: inwardIndex % width, y: Math.floor(inwardIndex / width) },
      };
    });
    fragments.push({ component: raw.pixels, skeleton, skeletonPixels, endpoints, bbox: raw.bbox });
  }
  if (fragments.length < 2) return null;

  // Facial texture can create many tiny open components. Keep only a bounded
  // set of substantial strokes; closure is attempted on two or three pieces,
  // never by globally joining every dark fragment in the scan area.
  const largestSkeleton = Math.max(...fragments.map((fragment) => fragment.skeletonPixels.length));
  const ranked = fragments
    .filter((fragment) => fragment.skeletonPixels.length >= Math.max(8, largestSkeleton * 0.16))
    .sort((first, second) => second.skeletonPixels.length - first.skeletonPixels.length)
    .slice(0, 6);

  const subsets: OpenStrokeFragment[][] = [];
  const choose = (start: number, size: number, selected: OpenStrokeFragment[]) => {
    if (selected.length === size) {
      subsets.push([...selected]);
      return;
    }
    for (let index = start; index < ranked.length; index += 1) {
      selected.push(ranked[index]);
      choose(index + 1, size, selected);
      selected.pop();
    }
  };
  choose(0, 2, []);
  choose(0, 3, []);

  const dot = (ax: number, ay: number, bx: number, by: number) => (
    (ax * bx + ay * by) / Math.max(1e-9, Math.hypot(ax, ay) * Math.hypot(bx, by))
  );
  interface Pair { first: OpenStrokeEndpoint; second: OpenStrokeEndpoint; gap: number; alignment: number }
  interface Candidate {
    repaired: Uint8Array;
    score: number;
    regionCount: number;
    regionBbox: { minX: number; minY: number; maxX: number; maxY: number };
  }
  const candidates: Candidate[] = [];

  for (const subset of subsets) {
    const minX = Math.min(...subset.map((fragment) => fragment.bbox.minX));
    const minY = Math.min(...subset.map((fragment) => fragment.bbox.minY));
    const maxX = Math.max(...subset.map((fragment) => fragment.bbox.maxX));
    const maxY = Math.max(...subset.map((fragment) => fragment.bbox.maxY));
    if (seedX < minX || seedX > maxX || seedY < minY || seedY > maxY) continue;

    // Endpoint fragment ids are rebuilt for the selected subset so that every
    // accepted pair necessarily joins two different observed stroke pieces.
    const endpoints = subset.flatMap((fragment, fragmentIndex) => fragment.endpoints.map((endpoint) => ({
      ...endpoint,
      fragment: fragmentIndex,
    })));
    const matchings: Pair[][] = [];
    const pairRemaining = (remaining: OpenStrokeEndpoint[], pairs: Pair[]) => {
      if (!remaining.length) {
        matchings.push([...pairs]);
        return;
      }
      const first = remaining[0];
      for (let index = 1; index < remaining.length; index += 1) {
        const second = remaining[index];
        if (first.fragment === second.fragment) continue;
        const gapX = second.point.x - first.point.x;
        const gapY = second.point.y - first.point.y;
        const gap = Math.hypot(gapX, gapY);
        if (gap < 2 || gap > maxGapPx) continue;
        const firstAlignment = dot(
          first.inward.x - first.point.x,
          first.inward.y - first.point.y,
          gapX,
          gapY,
        );
        const secondAlignment = dot(
          second.inward.x - second.point.x,
          second.inward.y - second.point.y,
          -gapX,
          -gapY,
        );
        if (firstAlignment > 0.35 || secondAlignment > 0.35) continue;
        pairs.push({
          first,
          second,
          gap,
          alignment: (firstAlignment + secondAlignment + 2) / 4,
        });
        pairRemaining(
          remaining.filter((_endpoint, remainingIndex) => remainingIndex !== 0 && remainingIndex !== index),
          pairs,
        );
        pairs.pop();
      }
    };
    pairRemaining(endpoints, []);

    const totalSkeleton = subset.reduce((sum, fragment) => sum + fragment.skeletonPixels.length, 0);
    for (const matching of matchings) {
      const totalGap = matching.reduce((sum, pair) => sum + pair.gap, 0);
      if (totalGap / Math.max(1, totalSkeleton) > 0.28) continue;
      const repaired = new Uint8Array(mask.length);
      subset.forEach((fragment) => fragment.component.forEach((index) => { repaired[index] = 1; }));
      matching.forEach((pair) => drawStrokeBridge(repaired, width, height, pair.first.point, pair.second.point));
      const enclosed = enclosedRegionNearSeed(
        repaired,
        width,
        height,
        seedY * width + seedX,
        16,
        width * height * 0.65,
        4,
      );
      if (!enclosed) continue;
      const alignmentPenalty = matching.reduce((sum, pair) => sum + pair.alignment, 0)
        / Math.max(1, matching.length);
      let regionMinX = width, regionMinY = height, regionMaxX = 0, regionMaxY = 0;
      for (let index = 0; index < enclosed.mask.length; index += 1) {
        if (!enclosed.mask[index]) continue;
        const x = index % width;
        const y = Math.floor(index / width);
        regionMinX = Math.min(regionMinX, x); regionMinY = Math.min(regionMinY, y);
        regionMaxX = Math.max(regionMaxX, x); regionMaxY = Math.max(regionMaxY, y);
      }
      candidates.push({
        repaired,
        score: totalGap / Math.max(1, totalSkeleton) + alignmentPenalty * 0.08 + subset.length * 0.005,
        regionCount: enclosed.count,
        regionBbox: { minX: regionMinX, minY: regionMinY, maxX: regionMaxX, maxY: regionMaxY },
      });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((first, second) => first.score - second.score || second.regionCount - first.regionCount);
  const best = candidates[0];
  const bboxOverlap = (first: Candidate["regionBbox"], second: Candidate["regionBbox"]): number => {
    const intersectionWidth = Math.max(0, Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX) + 1);
    const intersectionHeight = Math.max(0, Math.min(first.maxY, second.maxY) - Math.max(first.minY, second.minY) + 1);
    const intersection = intersectionWidth * intersectionHeight;
    const firstArea = (first.maxX - first.minX + 1) * (first.maxY - first.minY + 1);
    const secondArea = (second.maxX - second.minX + 1) * (second.maxY - second.minY + 1);
    return intersection / Math.max(1, firstArea + secondArea - intersection);
  };
  const competing = candidates.find((candidate, index) => index > 0 && (
    Math.abs(candidate.regionCount - best.regionCount) / Math.max(1, best.regionCount) > 0.12
    || bboxOverlap(candidate.regionBbox, best.regionBbox) < 0.72
  ));
  if (competing && competing.score <= best.score * 1.12 + 0.015) return null;
  return best.repaired;
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
): { mask: Uint8Array; localWindowRadius: number; strongMask: Uint8Array; weakMask: Uint8Array } {
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
  // Preserve a faint continuation when it is physically connected to a
  // clearly dark marker response. Real pen strokes can vary substantially in
  // pressure and lighting across one outline; the strong-mask hysteresis below
  // still prevents an isolated low-contrast skin texture from entering the
  // barrier on its own.
  const weakContrast = Math.max(3.5, minContrast * 0.15);
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
        && value <= backgroundLuma - Math.max(3, weakContrast * 0.4)
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
  const strongNeighborhood = binaryWindow(strong, width, height, 4, false);
  for (let index = 0; index < strong.length; index += 1) {
    // JPEG ringing and uneven pen pressure can leave a one-pixel break exactly
    // where a dark stroke becomes faint. Seed a weak component when it lies
    // within four pixels of strong evidence, then keep following only weak-mask
    // pixels. Isolated facial texture still has no strong anchor.
    if (!weak[index] || !strongNeighborhood[index]) continue;
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
  return { mask: retained, localWindowRadius, strongMask: strong, weakMask: weak };
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function maximumCircularMissingRun(values: readonly (number | null)[]): number {
  if (!values.length || values.every((value) => value !== null)) return 0;
  if (values.every((value) => value === null)) return values.length;
  const doubled = [...values, ...values];
  let longest = 0;
  let current = 0;
  for (const value of doubled) {
    current = value === null ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return Math.min(values.length, longest);
}

function polygonCentroid(points: readonly MarkerPoint[]): MarkerPoint {
  let twiceArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    weightedX += (current.x + next.x) * cross;
    weightedY += (current.y + next.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    return points.reduce((total, point) => ({
      x: total.x + point.x / points.length,
      y: total.y + point.y / points.length,
    }), { x: 0, y: 0 });
  }
  return { x: weightedX / (3 * twiceArea), y: weightedY / (3 * twiceArea) };
}

function sampledLuma(image: MarkerImageData, x: number, y: number): number {
  const width = Math.floor(image.width);
  const height = Math.floor(image.height);
  const clampedX = clamp(x, 0, width - 1);
  const clampedY = clamp(y, 0, height - 1);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  const value = (px: number, py: number) => luma(image.data, (py * width + px) * 4);
  return value(x0, y0) * (1 - fx) * (1 - fy)
    + value(x1, y0) * fx * (1 - fy)
    + value(x0, y1) * (1 - fx) * fy
    + value(x1, y1) * fx * fy;
}

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((first, second) => first - second);
  return ordered[clamp(Math.round((ordered.length - 1) * fraction), 0, ordered.length - 1)];
}

function weakNearCircularBoundaryRecovery(
  image: MarkerImageData,
  seed: MarkerPoint,
  roiRadius: number,
  expectedDiameterPx: number,
  minAreaPx: number,
  minContrast: number,
): ControlledMarkerDetection | null {
  // This path is intentionally unavailable without the explicit controlled-
  // scan size prior. A permissive whole-photo weak-edge search would promote
  // wrinkles, pigmentation and illumination boundaries to lesion contours.
  if (!(expectedDiameterPx >= 8) || roiRadius < 8) return null;

  const rayCount = 96;
  const maximumRadius = Math.floor(roiRadius * 0.82);
  const expectedRadius = clamp(expectedDiameterPx / 2, 4, maximumRadius);
  const minimumSearchRadius = clamp(
    Math.floor(expectedRadius * 0.55),
    3,
    Math.max(3, maximumRadius - 3),
  );
  const maximumSearchRadius = clamp(
    Math.ceil(expectedRadius * 1.65),
    minimumSearchRadius + 3,
    maximumRadius,
  );
  if (maximumSearchRadius <= minimumSearchRadius) return null;

  const normalOffset = clamp(expectedRadius * 0.13, 2.5, 5);
  const samplingMargin = maximumSearchRadius + normalOffset + 3;
  if (seed.x < samplingMargin || seed.y < samplingMargin
    || seed.x > Math.floor(image.width) - 1 - samplingMargin
    || seed.y > Math.floor(image.height) - 1 - samplingMargin) {
    return null;
  }
  const minimumRidgeContrast = Math.max(4, minContrast * 0.18);
  interface RidgeSample { radius: number; contrast: number; score: number }
  const raySamples: RidgeSample[][] = [];
  for (let ray = 0; ray < rayCount; ray += 1) {
    const angle = ray * Math.PI * 2 / rayCount;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tangentX = -sin;
    const tangentY = cos;
    const sample = (radius: number, tangentOffset: number): number => sampledLuma(
      image,
      seed.x + cos * radius + tangentX * tangentOffset,
      seed.y + sin * radius + tangentY * tangentOffset,
    );
    const ridgeAt = (radius: number, tangentOffset: number) => {
      const stroke = sample(radius, tangentOffset);
      const inner = median([
        sample(radius - normalOffset - 0.75, tangentOffset),
        sample(radius - normalOffset + 0.75, tangentOffset),
      ]);
      const outer = median([
        sample(radius + normalOffset - 0.75, tangentOffset),
        sample(radius + normalOffset + 0.75, tangentOffset),
      ]);
      return { innerContrast: inner - stroke, outerContrast: outer - stroke };
    };
    const tangentSpan = clamp(expectedRadius * 0.055, 1.4, 2.25);
    const samples: RidgeSample[] = [];
    for (let radius = minimumSearchRadius; radius <= maximumSearchRadius; radius += 1) {
      const centerRidge = ridgeAt(radius, 0);
      const previousRidge = ridgeAt(radius, -tangentSpan);
      const nextRidge = ridgeAt(radius, tangentSpan);
      // A pen line is a thin dark ridge with brighter skin on both sides. Using
      // the weaker side rejects broad shadows and one-sided illumination steps.
      // Requiring the same response immediately along the tangent prevents a
      // circular arrangement of disconnected pores or compression speckles
      // from masquerading as one drawn outline.
      const ridgeContrast = Math.min(
        centerRidge.innerContrast,
        centerRidge.outerContrast,
        previousRidge.innerContrast,
        previousRidge.outerContrast,
        nextRidge.innerContrast,
        nextRidge.outerContrast,
      );
      if (ridgeContrast < minimumRidgeContrast) continue;
      const asymmetryPenalty = Math.abs(centerRidge.innerContrast - centerRidge.outerContrast) * 0.12;
      samples.push({
        radius,
        contrast: ridgeContrast,
        score: ridgeContrast - asymmetryPenalty,
      });
    }
    raySamples.push(samples);
  }

  const shapeBand = Math.max(3, expectedRadius * 0.24);
  let dominantRadius = 0;
  let dominantSupport = -1;
  let dominantScore = Number.NEGATIVE_INFINITY;
  for (let radius = minimumSearchRadius; radius <= maximumSearchRadius; radius += 1) {
    const selected = raySamples.map((samples) => samples
      .filter((sample) => Math.abs(sample.radius - radius) <= shapeBand)
      .sort((first, second) => second.score - first.score)[0] || null);
    const supported = selected.filter((sample): sample is RidgeSample => sample !== null);
    const score = supported.reduce((total, sample) => total + sample.score, 0)
      - Math.abs(radius - expectedRadius) / Math.max(1, expectedRadius) * rayCount * 0.15;
    if (supported.length > dominantSupport || (supported.length === dominantSupport && score > dominantScore)) {
      dominantRadius = radius;
      dominantSupport = supported.length;
      dominantScore = score;
    }
  }
  if (dominantSupport < rayCount * 0.8) return null;

  const selectedRadii: Array<number | null> = [];
  const selectedContrasts: number[] = [];
  for (const samples of raySamples) {
    const selected = samples
      .filter((sample) => Math.abs(sample.radius - dominantRadius) <= shapeBand)
      .sort((first, second) => second.score - first.score)[0] || null;
    selectedRadii.push(selected?.radius ?? null);
    if (selected) selectedContrasts.push(selected.contrast);
  }
  const observedRadii = selectedRadii.filter((radius): radius is number => radius !== null);
  const radiusMedian = median(observedRadii);
  const maximumRadialDeviation = Math.max(3, radiusMedian * 0.27);
  for (let index = 0; index < selectedRadii.length; index += 1) {
    const radius = selectedRadii[index];
    if (radius !== null && Math.abs(radius - radiusMedian) > maximumRadialDeviation) selectedRadii[index] = null;
  }
  const supportedCount = selectedRadii.filter((radius) => radius !== null).length;
  const supportRatio = supportedCount / rayCount;
  const maximumMissingRun = maximumCircularMissingRun(selectedRadii);
  if (supportRatio < 0.8 || maximumMissingRun > 4) return null;

  const radialDeviations = selectedRadii
    .filter((radius): radius is number => radius !== null)
    .map((radius) => Math.abs(radius - radiusMedian));
  const radialVariationRatio = median(radialDeviations) / Math.max(1, radiusMedian);
  if (radialVariationRatio > 0.16) return null;
  const neighbourJumps: number[] = [];
  for (let index = 0; index < selectedRadii.length; index += 1) {
    const current = selectedRadii[index];
    const next = selectedRadii[(index + 1) % rayCount];
    if (current !== null && next !== null) neighbourJumps.push(Math.abs(current - next) / Math.max(1, radiusMedian));
  }
  if (percentile(neighbourJumps, 0.9) > 0.2) return null;

  const filled = [...selectedRadii];
  for (let index = 0; index < filled.length; index += 1) {
    if (filled[index] !== null) continue;
    let previous = (index - 1 + rayCount) % rayCount;
    let next = (index + 1) % rayCount;
    while (selectedRadii[previous] === null) previous = (previous - 1 + rayCount) % rayCount;
    while (selectedRadii[next] === null) next = (next + 1) % rayCount;
    const span = (next - previous + rayCount) % rayCount;
    const offset = (index - previous + rayCount) % rayCount;
    filled[index] = Number(selectedRadii[previous])
      + (Number(selectedRadii[next]) - Number(selectedRadii[previous])) * offset / Math.max(1, span);
  }
  const complete = filled.map((radius) => Number(radius));
  const smoothed = complete.map((_radius, index) => median([
    complete[(index - 2 + rayCount) % rayCount],
    complete[(index - 1 + rayCount) % rayCount],
    complete[index],
    complete[(index + 1) % rayCount],
    complete[(index + 2) % rayCount],
  ]));
  const boundary = smoothed.map((radius, ray) => {
    const angle = ray * Math.PI * 2 / rayCount;
    return { x: seed.x + Math.cos(angle) * radius, y: seed.y + Math.sin(angle) * radius };
  });
  const area = Math.abs(polygonArea(boundary));
  const perimeter = boundary.reduce((total, point, index) => {
    const next = boundary[(index + 1) % boundary.length];
    return total + Math.hypot(next.x - point.x, next.y - point.y);
  }, 0);
  const compactness = 4 * Math.PI * area / Math.max(1, perimeter ** 2);
  const bbox = pixelExtent(boundary, seed).bbox;
  const aspectRatio = Math.max(bbox.width, bbox.height) / Math.max(1, Math.min(bbox.width, bbox.height));
  const detectedDiameterPx = Math.max(bbox.width, bbox.height);
  const medianRidgeContrast = median(selectedContrasts);
  if (area < Math.max(minAreaPx * 4, 16)
    || !pointInPolygon(seed, boundary)
    || compactness < 0.72
    || aspectRatio > 1.45
    || detectedDiameterPx < expectedDiameterPx * 0.6
    || detectedDiameterPx > expectedDiameterPx * 1.7
    || medianRidgeContrast < minimumRidgeContrast * 1.15) {
    return null;
  }

  const center = polygonCentroid(boundary);
  return {
    ok: true,
    failure_code: null,
    center,
    boundary,
    area_px: Math.round(area),
    bbox,
    geometry_mode: "enclosed_region",
    seed_relation: "enclosed",
    marker_area_px: supportedCount,
    marker_bbox: bbox,
    // Keep the result deliberately below a high-confidence direct enclosure;
    // the runtime surfaces it as a yellow candidate that must be checked.
    confidence: clamp(supportRatio * medianRidgeContrast / Math.max(36, minContrast * 1.5), 0, 0.58),
    candidate_count: 1,
    warnings: ["low_contrast_near_circular_recovered"],
    diagnostics: {
      method: "low_contrast_near_circular",
      roi_radius: roiRadius,
      boundary_support_ratio: supportRatio,
      repair_fraction: 1 - supportRatio,
      angular_support_ratio: supportRatio,
      maximum_gap_degrees: maximumMissingRun * 360 / rayCount,
      detected_diameter_px: detectedDiameterPx,
      expected_diameter_px: expectedDiameterPx,
      detected_to_expected_diameter_ratio: detectedDiameterPx / expectedDiameterPx,
      ridge_contrast: medianRidgeContrast,
      radial_variation_ratio: radialVariationRatio,
      shape_compactness: compactness,
    },
    audit: { local_only: true, raw_media_retained: false, network_request_made: false },
  };
}

function radialBoundaryRecovery(
  image: MarkerImageData,
  seed: MarkerPoint,
  roiRadius: number,
  x0: number,
  y0: number,
  roiWidth: number,
  roiHeight: number,
  adaptiveMask: Uint8Array,
  backgroundLuma: number,
  minContrast: number,
  expectedDiameterPx: number,
  minAreaPx: number,
  localWindowRadius: number,
): { detection: ControlledMarkerDetection | null; supportRatio: number; maximumGapDegrees: number } {
  const rayCount = 96;
  const maximumRadius = Math.max(4, Math.floor(roiRadius * 0.86));
  const expectedRadius = expectedDiameterPx > 0
    ? clamp(expectedDiameterPx / 2, 4, maximumRadius)
    : maximumRadius * 0.45;
  const minimumRadius = clamp(Math.round(expectedRadius * 0.2), 2, Math.max(2, maximumRadius - 2));
  const maximumStrokeRun = Math.max(10, Math.round(expectedRadius * 0.55));
  const localSeedX = seed.x - x0;
  const localSeedY = seed.y - y0;
  const radii: Array<number | null> = [];
  const contrasts: number[] = [];
  const isDarkNearby = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < roiWidth && ny >= 0 && ny < roiHeight
          && adaptiveMask[ny * roiWidth + nx]) return true;
      }
    }
    return false;
  };

  for (let ray = 0; ray < rayCount; ray += 1) {
    const angle = ray * Math.PI * 2 / rayCount;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const runs: Array<{ start: number; end: number; contrast: number }> = [];
    let runStart = -1;
    let runContrast = 0;
    for (let radius = minimumRadius; radius <= maximumRadius; radius += 1) {
      const x = Math.round(localSeedX + cos * radius);
      const y = Math.round(localSeedY + sin * radius);
      const dark = x >= 0 && x < roiWidth && y >= 0 && y < roiHeight && isDarkNearby(x, y);
      if (dark) {
        if (runStart < 0) runStart = radius;
        const imageX = clamp(x0 + x, 0, Math.floor(image.width) - 1);
        const imageY = clamp(y0 + y, 0, Math.floor(image.height) - 1);
        runContrast = Math.max(
          runContrast,
          backgroundLuma - luma(image.data, (imageY * Math.floor(image.width) + imageX) * 4),
        );
      }
      if ((!dark || radius === maximumRadius) && runStart >= 0) {
        const runEnd = dark && radius === maximumRadius ? radius : radius - 1;
        runs.push({ start: runStart, end: runEnd, contrast: runContrast });
        runStart = -1;
        runContrast = 0;
      }
    }
    const selected = runs
      .filter((run) => run.end - run.start + 1 <= maximumStrokeRun && run.contrast >= minContrast * 0.7)
      .sort((first, second) => first.start - second.start || second.contrast - first.contrast)[0];
    radii.push(selected ? (selected.start + selected.end) / 2 : null);
    if (selected) contrasts.push(selected.contrast);
  }

  const initialMedian = median(radii.filter((radius): radius is number => radius !== null));
  for (let index = 0; index < radii.length; index += 1) {
    const radius = radii[index];
    if (radius !== null && (radius < initialMedian * 0.25 || radius > initialMedian * 2.2)) radii[index] = null;
  }
  const supported = radii.filter((radius) => radius !== null).length;
  const supportRatio = supported / rayCount;
  const maximumMissingRun = maximumCircularMissingRun(radii);
  const maximumGapDegrees = maximumMissingRun * 360 / rayCount;
  if (supportRatio < 0.82 || maximumMissingRun > 6) {
    return { detection: null, supportRatio, maximumGapDegrees };
  }

  const filled: Array<number | null> = [...radii];
  for (let index = 0; index < filled.length; index += 1) {
    if (filled[index] !== null) continue;
    let previous = (index - 1 + rayCount) % rayCount;
    let next = (index + 1) % rayCount;
    while (radii[previous] === null) previous = (previous - 1 + rayCount) % rayCount;
    while (radii[next] === null) next = (next + 1) % rayCount;
    const span = (next - previous + rayCount) % rayCount;
    const offset = (index - previous + rayCount) % rayCount;
    filled[index] = Number(radii[previous])
      + (Number(radii[next]) - Number(radii[previous])) * offset / Math.max(1, span);
  }
  const complete = filled.map((radius) => Number(radius));
  const smoothed = complete.map((_radius, index) => median([
    complete[(index - 1 + rayCount) % rayCount],
    complete[index],
    complete[(index + 1) % rayCount],
  ]));
  const boundary = smoothed.map((radius, ray) => {
    const angle = ray * Math.PI * 2 / rayCount;
    return { x: seed.x + Math.cos(angle) * radius, y: seed.y + Math.sin(angle) * radius };
  });
  const area = Math.abs(polygonArea(boundary));
  if (area < Math.max(minAreaPx * 4, 16) || !pointInPolygon(seed, boundary)) {
    return { detection: null, supportRatio, maximumGapDegrees };
  }
  const bbox = pixelExtent(boundary, seed).bbox;
  const center = polygonCentroid(boundary);
  return {
    detection: {
      ok: true,
      failure_code: null,
      center,
      boundary,
      area_px: Math.round(area),
      bbox,
      geometry_mode: "enclosed_region",
      seed_relation: "enclosed",
      marker_area_px: supported,
      marker_bbox: bbox,
      confidence: clamp(supportRatio * median(contrasts) / 96, 0, 1),
      candidate_count: 1,
      warnings: ["radial_boundary_recovered"],
      diagnostics: {
        method: "radial_seed_boundary",
        roi_radius: roiRadius,
        local_window_radius: localWindowRadius,
        repair_radius: 0,
        boundary_support_ratio: supportRatio,
        repair_fraction: 1 - supportRatio,
        angular_support_ratio: supportRatio,
        maximum_gap_degrees: maximumGapDegrees,
      },
      audit: { local_only: true, raw_media_retained: false, network_request_made: false },
    },
    supportRatio,
    maximumGapDegrees,
  };
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

function pointToSegmentDistance(point: MarkerPoint, start: MarkerPoint, end: MarkerPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function resampleClosedBoundary(points: MarkerPoint[], count: number): MarkerPoint[] {
  const unique: MarkerPoint[] = [];
  const seen = new Set<string>();
  for (const point of points) {
    const key = `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  if (unique.length < 3 || count < 8) return [];
  const lengths = unique.map((point, index) => Math.hypot(
    unique[(index + 1) % unique.length].x - point.x,
    unique[(index + 1) % unique.length].y - point.y,
  ));
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  if (!(perimeter > 1e-6)) return [];
  const output: MarkerPoint[] = [];
  let segment = 0;
  let segmentStartDistance = 0;
  for (let sample = 0; sample < count; sample += 1) {
    const targetDistance = perimeter * sample / count;
    while (segment < lengths.length - 1
      && segmentStartDistance + lengths[segment] < targetDistance) {
      segmentStartDistance += lengths[segment];
      segment += 1;
    }
    const start = unique[segment];
    const end = unique[(segment + 1) % unique.length];
    const t = lengths[segment] > 1e-9
      ? (targetDistance - segmentStartDistance) / lengths[segment]
      : 0;
    output.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    });
  }
  return output;
}

function periodicBoundarySmooth(points: MarkerPoint[], passes = 3): MarkerPoint[] {
  let smoothed = points.map((point) => ({ ...point }));
  for (let pass = 0; pass < passes; pass += 1) {
    smoothed = smoothed.map((point, index, source) => {
      const previous = source[(index - 1 + source.length) % source.length];
      const next = source[(index + 1) % source.length];
      return {
        x: previous.x * 0.25 + point.x * 0.5 + next.x * 0.25,
        y: previous.y * 0.25 + point.y * 0.5 + next.y * 0.25,
      };
    });
  }
  return smoothed;
}

function boundarySelfIntersects(points: MarkerPoint[]): boolean {
  const epsilon = 1e-8;
  const orient = (a: MarkerPoint, b: MarkerPoint, c: MarkerPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (point: MarkerPoint, start: MarkerPoint, end: MarkerPoint) =>
    point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon;
  const intersects = (a: MarkerPoint, b: MarkerPoint, c: MarkerPoint, d: MarkerPoint) => {
    const abC = orient(a, b, c);
    const abD = orient(a, b, d);
    const cdA = orient(c, d, a);
    const cdB = orient(c, d, b);
    if (abC * abD < -epsilon && cdA * cdB < -epsilon) return true;
    return (Math.abs(abC) <= epsilon && onSegment(c, a, b))
      || (Math.abs(abD) <= epsilon && onSegment(d, a, b))
      || (Math.abs(cdA) <= epsilon && onSegment(a, c, d))
      || (Math.abs(cdB) <= epsilon && onSegment(b, c, d));
  };
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (intersects(points[first], points[firstNext], points[second], points[secondNext])) return true;
    }
  }
  return false;
}

function boundaryMissDistances(candidate: MarkerPoint[], original: MarkerPoint[]): number[] {
  return original.map((point) => {
    if (pointInPolygon(point, candidate)) return 0;
    const distance = candidate.reduce((closest, start, index) => Math.min(
      closest,
      pointToSegmentDistance(point, start, candidate[(index + 1) % candidate.length]),
    ), Number.POSITIVE_INFINITY);
    return distance <= 0.35 ? 0 : distance;
  });
}

function boundaryNearestDistances(candidate: MarkerPoint[], reference: MarkerPoint[]): number[] {
  return candidate.map((point) => reference.reduce((closest, start, index) => Math.min(
    closest,
    pointToSegmentDistance(point, start, reference[(index + 1) % reference.length]),
  ), Number.POSITIVE_INFINITY));
}

function convexBoundaryHull(points: MarkerPoint[]): MarkerPoint[] {
  const ordered = [...new Map(points.map((point) => [`${point.x},${point.y}`, point])).values()]
    .sort((first, second) => first.x - second.x || first.y - second.y);
  if (ordered.length < 3) return ordered;
  const cross = (origin: MarkerPoint, first: MarkerPoint, second: MarkerPoint) =>
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);
  const buildHalf = (source: MarkerPoint[]) => {
    const half: MarkerPoint[] = [];
    for (const point of source) {
      while (half.length >= 2 && cross(half[half.length - 2], half[half.length - 1], point) <= 0) half.pop();
      half.push(point);
    }
    return half;
  };
  const lower = buildHalf(ordered);
  const upper = buildHalf([...ordered].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

interface BoundarySmoothingAttempt {
  boundary: MarkerPoint[];
  scale: number;
  passes: number;
  misses: number[];
  sourceArea: number;
}

function attemptPeriodicBoundarySmoothing(
  source: MarkerPoint[],
  coverageReference: MarkerPoint[],
  equivalentRadius: number,
): BoundarySmoothingAttempt | null {
  const sourceArea = Math.abs(polygonArea(source));
  const resampled = resampleClosedBoundary(source, 48);
  if (!(sourceArea > 1e-6) || resampled.length < 8) return null;
  const center = polygonCentroid(source);
  const typicalMissLimit = Math.max(0.6, equivalentRadius * 0.025);
  const maximumMissLimit = Math.max(1.5, equivalentRadius * 0.07);
  for (const passes of [8, 7, 6, 5, 4, 3]) {
    const smoothed = periodicBoundarySmooth(resampled, passes);
    const smoothedArea = Math.abs(polygonArea(smoothed));
    if (!(smoothedArea > 1e-6)) continue;
    const areaPreservingScale = Math.sqrt(sourceArea / smoothedArea);
    for (let padding = 1; padding <= 1.06 + 1e-9; padding += 0.005) {
      const scale = areaPreservingScale * padding;
      const expanded = smoothed.map((point) => ({
        x: center.x + (point.x - center.x) * scale,
        y: center.y + (point.y - center.y) * scale,
      }));
      const misses = boundaryMissDistances(expanded, coverageReference);
      const outsideRatio = misses.filter((distance) => distance > 0).length / misses.length;
      const areaRatio = Math.abs(polygonArea(expanded)) / sourceArea;
      if (outsideRatio <= 0.22
        && percentile(misses, 0.9) <= typicalMissLimit
        && Math.max(...misses) <= maximumMissLimit
        && areaRatio >= 0.98
        && areaRatio <= 1.13
        && !boundarySelfIntersects(expanded)
        && pointInPolygon(center, expanded)) {
        return { boundary: expanded, scale, passes, misses, sourceArea };
      }
    }
  }
  return null;
}

function finalizeControlledMarkerBoundary(result: ControlledMarkerDetection): ControlledMarkerDetection {
  if (!result.ok || result.geometry_mode !== "enclosed_region" || result.boundary.length < 8) return result;
  const original = result.boundary;
  const originalArea = Math.abs(polygonArea(original));
  const perimeter = original.reduce((sum, point, index) => sum + Math.hypot(
    original[(index + 1) % original.length].x - point.x,
    original[(index + 1) % original.length].y - point.y,
  ), 0);
  const extent = pixelExtent(original).bbox;
  const aspectRatio = Math.max(extent.width, extent.height) / Math.max(1, Math.min(extent.width, extent.height));
  const compactness = perimeter > 0 ? 4 * Math.PI * originalArea / (perimeter * perimeter) : 0;
  const extentFillRatio = originalArea / Math.max(1, extent.width * extent.height);
  // Compactness falls sharply precisely when a raster outline contains short
  // pixel-scale spikes. Use the filled extent plus aspect ratio to keep this
  // cleanup limited to the current near-circular scope without excluding the
  // rough boundaries it is intended to repair.
  if (!(originalArea > 0) || aspectRatio > 1.8 || extentFillRatio < 0.42) return result;

  const equivalentRadius = Math.sqrt(originalArea / Math.PI);
  let attempt = attemptPeriodicBoundarySmoothing(original, original, equivalentRadius);
  let regularization: "convex_hull" | null = null;
  let regularizationAreaRatio = 1;
  let solidity = 1;
  let regularizationDisplacements: number[] = [];
  if (!attempt) {
    const hull = convexBoundaryHull(original);
    const hullArea = Math.abs(polygonArea(hull));
    const hullPerimeter = hull.reduce((sum, point, index) => sum + Math.hypot(
      hull[(index + 1) % hull.length].x - point.x,
      hull[(index + 1) % hull.length].y - point.y,
    ), 0);
    const hullCompactness = hullPerimeter > 0 ? 4 * Math.PI * hullArea / (hullPerimeter * hullPerimeter) : 0;
    const hullExtent = pixelExtent(hull).bbox;
    const hullAspectRatio = Math.max(hullExtent.width, hullExtent.height)
      / Math.max(1, Math.min(hullExtent.width, hullExtent.height));
    const originalCenter = polygonCentroid(original);
    const hullCenter = polygonCentroid(hull);
    regularizationAreaRatio = hullArea / originalArea;
    solidity = originalArea / Math.max(1e-6, hullArea);
    // This fallback is limited to the current near-circular scope. It fills
    // short inward raster pockets, but cannot expand beyond the detected bbox,
    // move the region centre materially, or turn a deeply concave shape into a
    // plausible-looking circle.
    if (hull.length >= 8
      && hullAspectRatio <= 1.8
      && hullCompactness >= 0.75
      && regularizationAreaRatio <= 1.45
      && solidity >= 0.69
      && Math.hypot(hullCenter.x - originalCenter.x, hullCenter.y - originalCenter.y)
        <= Math.max(2, equivalentRadius * 0.25)) {
      attempt = attemptPeriodicBoundarySmoothing(hull, original, equivalentRadius);
      if (attempt && Math.abs(polygonArea(attempt.boundary)) / originalArea <= 1.45) {
        regularizationDisplacements = boundaryNearestDistances(attempt.boundary, original);
        // A few large displacements are expected when the raw raster contains
        // an internal retrace. Distributed displacements are different: they
        // indicate that the source itself is repeatedly concave, so replacing
        // it with its convex hull would alter the detected shape rather than
        // clean a local extraction defect.
        const p90DisplacementRatio = percentile(regularizationDisplacements, 0.9)
          / Math.max(1, equivalentRadius);
        if (p90DisplacementRatio <= 0.12) regularization = "convex_hull";
        else attempt = null;
      } else {
        attempt = null;
      }
    }
  }
  if (!attempt) {
    result.diagnostics = {
      ...(result.diagnostics || {}),
      boundary_smoothing: "raw_fallback",
      shape_compactness: Number(compactness.toFixed(3)),
    };
    return result;
  }
  const areaRatio = Math.abs(polygonArea(attempt.boundary)) / originalArea;
  const outsideRatio = attempt.misses.filter((distance) => distance > 0).length / attempt.misses.length;
  const maximumMissRatio = Math.max(...attempt.misses) / Math.max(1, equivalentRadius);
  result.boundary = attempt.boundary;
  result.warnings = [...new Set([
    ...result.warnings,
    "boundary_periodic_smoothed",
    ...(regularization ? ["boundary_near_circular_convex_regularized"] : []),
  ])];
  result.diagnostics = {
    ...(result.diagnostics || {}),
    boundary_smoothing: "periodic_constrained",
    boundary_smoothing_scale: Number(attempt.scale.toFixed(3)),
    boundary_smoothing_area_ratio: Number(areaRatio.toFixed(3)),
    boundary_smoothing_passes: attempt.passes,
    boundary_smoothing_outside_ratio: Number(outsideRatio.toFixed(3)),
    boundary_smoothing_max_miss_ratio: Number(maximumMissRatio.toFixed(3)),
    shape_compactness: Number(compactness.toFixed(3)),
    ...(regularization ? {
      boundary_regularization: regularization,
      boundary_regularization_area_ratio: Number(regularizationAreaRatio.toFixed(3)),
      boundary_regularization_solidity: Number(solidity.toFixed(3)),
      boundary_regularization_p90_displacement_ratio: Number(
        (percentile(regularizationDisplacements, 0.9) / Math.max(1, equivalentRadius)).toFixed(3),
      ),
      boundary_regularization_max_displacement_ratio: Number(
        (Math.max(...regularizationDisplacements) / Math.max(1, equivalentRadius)).toFixed(3),
      ),
    } : {}),
  };
  return result;
}

function boundaryCoordinateExtent(points: readonly MarkerPoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function scaleBoundaryToMarkerExtent(
  source: readonly MarkerPoint[],
  markerBbox: { x: number; y: number; width: number; height: number },
  maximumScale: number,
): { boundary: MarkerPoint[]; scaleX: number; scaleY: number } | null {
  if (source.length < 8 || markerBbox.width <= 0 || markerBbox.height <= 0) return null;
  const sourceCenter = polygonCentroid(source);
  const targetCenter = {
    x: markerBbox.x + (markerBbox.width - 1) / 2,
    y: markerBbox.y + (markerBbox.height - 1) / 2,
  };
  const extent = boundaryCoordinateExtent(source);
  const sourceLeft = Math.max(sourceCenter.x - extent.minX, 1e-6);
  const sourceRight = Math.max(extent.maxX - sourceCenter.x, 1e-6);
  const sourceTop = Math.max(sourceCenter.y - extent.minY, 1e-6);
  const sourceBottom = Math.max(extent.maxY - sourceCenter.y, 1e-6);
  const targetMaxX = markerBbox.x + markerBbox.width - 1;
  const targetMaxY = markerBbox.y + markerBbox.height - 1;
  // Match the centres of the outermost marker pixels on all four sides. Each
  // side is evaluated separately because a valid tilted outline need not be
  // symmetric about its polygon centroid.
  const scaleX = Math.max(
    1,
    (targetCenter.x - markerBbox.x) / sourceLeft,
    (targetMaxX - targetCenter.x) / sourceRight,
  );
  const scaleY = Math.max(
    1,
    (targetCenter.y - markerBbox.y) / sourceTop,
    (targetMaxY - targetCenter.y) / sourceBottom,
  );
  if (scaleX > maximumScale || scaleY > maximumScale) return null;
  return {
    scaleX,
    scaleY,
    boundary: source.map((point) => ({
      x: targetCenter.x + (point.x - sourceCenter.x) * scaleX,
      y: targetCenter.y + (point.y - sourceCenter.y) * scaleY,
    })),
  };
}

function reconcileMarkerStrokeCoverage(
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions,
  roiRadius: number,
  result: ControlledMarkerDetection,
): ControlledMarkerDetection {
  const expectedDiameterPx = Number(options.expectedDiameterPx || 0);
  if (!result.ok
    || result.geometry_mode !== "enclosed_region"
    || !result.center
    || !result.marker_bbox
    || result.boundary.length < 8
    || !(expectedDiameterPx >= 8)) return result;

  const originalBoundary = result.boundary;
  const originalArea = Math.abs(polygonArea(originalBoundary));
  if (!(originalArea > 1e-6)) return result;
  const equivalentRadius = Math.sqrt(originalArea / Math.PI);
  const markerBbox = result.marker_bbox;
  const markerDiameter = Math.max(markerBbox.width, markerBbox.height);
  const markerAspect = markerDiameter / Math.max(1, Math.min(markerBbox.width, markerBbox.height));
  const markerCenter = {
    x: markerBbox.x + (markerBbox.width - 1) / 2,
    y: markerBbox.y + (markerBbox.height - 1) / 2,
  };
  const markerCenterShiftRatio = Math.hypot(
    markerCenter.x - result.center.x,
    markerCenter.y - result.center.y,
  ) / Math.max(1, equivalentRadius);
  const originalExtent = boundaryCoordinateExtent(originalBoundary);
  const originalExtentArea = Math.max(
    1,
    (originalExtent.maxX - originalExtent.minX) * (originalExtent.maxY - originalExtent.minY),
  );
  const markerExtentAreaRatio = markerBbox.width * markerBbox.height / originalExtentArea;
  // A marker component much larger than the entered lesion scale usually
  // means that the pen line has touched a wrinkle, shadow or hair. Do not even
  // launch the more permissive ridge probes for that component.
  if (markerDiameter < expectedDiameterPx * 0.35
    || markerDiameter > expectedDiameterPx * 1.25
    || markerAspect > 1.8) return result;

  let reconciliation: "radial_ridge" | "bounded_marker_bbox" = "bounded_marker_bbox";
  // A close, centred marker component is the least ambiguous witness and is
  // also the cheapest path. This covers a smooth but slightly inset result
  // without launching the more permissive radial search.
  let scaled = markerExtentAreaRatio <= 1.3 && markerCenterShiftRatio <= 0.15
    ? scaleBoundaryToMarkerExtent(originalBoundary, markerBbox, 1.14)
    : null;
  if (!scaled) {
    reconciliation = "radial_ridge";
    const ridgeProbeStep = clamp(Math.round(expectedDiameterPx * 0.1), 3, 6);
    const ridgeSeeds: MarkerPoint[] = [
      result.center,
      { x: result.center.x, y: result.center.y - ridgeProbeStep },
      { x: result.center.x, y: result.center.y + ridgeProbeStep },
      { x: result.center.x - ridgeProbeStep, y: result.center.y },
      { x: result.center.x + ridgeProbeStep, y: result.center.y },
      seed,
    ];
    const compatibleRidges: Array<{
      boundary: MarkerPoint[];
      area: number;
      compactness: number;
      scaleX: number;
      scaleY: number;
    }> = [];
    for (const ridgeSeed of ridgeSeeds) {
      const ridge = weakNearCircularBoundaryRecovery(
        image,
        ridgeSeed,
        roiRadius,
        expectedDiameterPx,
        Number(options.minAreaPx ?? 9),
        Number(options.minContrast ?? 24),
      );
      if (!ridge?.ok || !ridge.center || ridge.boundary.length < 8) continue;
      const finalizedRidge = finalizeControlledMarkerBoundary(ridge);
      const ridgeCenter = polygonCentroid(finalizedRidge.boundary);
      const rawRidgeExtent = boundaryCoordinateExtent(finalizedRidge.boundary);
      // The radial sampler follows the darkest centre of a pen stroke. Judge
      // containment on the displayed, antialias-padded boundary instead of
      // rejecting a valid ridge because its centreline misses the old inner
      // enclosure by a sub-pixel amount.
      const ridgePaddingPx = clamp(expectedDiameterPx * 0.015, 0.75, 1.5);
      const scaleX = 1 + ridgePaddingPx * 2 / Math.max(
        1,
        rawRidgeExtent.maxX - rawRidgeExtent.minX,
      );
      const scaleY = 1 + ridgePaddingPx * 2 / Math.max(
        1,
        rawRidgeExtent.maxY - rawRidgeExtent.minY,
      );
      const paddedBoundary = finalizedRidge.boundary.map((point) => ({
        x: ridgeCenter.x + (point.x - ridgeCenter.x) * scaleX,
        y: ridgeCenter.y + (point.y - ridgeCenter.y) * scaleY,
      }));
      const ridgeArea = Math.abs(polygonArea(paddedBoundary));
      const ridgeExtent = boundaryCoordinateExtent(paddedBoundary);
      const ridgeAspect = Math.max(
        ridgeExtent.maxX - ridgeExtent.minX,
        ridgeExtent.maxY - ridgeExtent.minY,
      ) / Math.max(1, Math.min(
        ridgeExtent.maxX - ridgeExtent.minX,
        ridgeExtent.maxY - ridgeExtent.minY,
      ));
      const ridgePerimeter = paddedBoundary.reduce((sum, point, index) => sum + Math.hypot(
        paddedBoundary[(index + 1) % paddedBoundary.length].x - point.x,
        paddedBoundary[(index + 1) % paddedBoundary.length].y - point.y,
      ), 0);
      const ridgeCompactness = 4 * Math.PI * ridgeArea / Math.max(1, ridgePerimeter ** 2);
      const ridgeMisses = boundaryMissDistances(paddedBoundary, originalBoundary);
      const ridgeOutsideRatio = ridgeMisses.filter((distance) => distance > 0).length
        / ridgeMisses.length;
      const ridgeCenterShiftRatio = Math.hypot(
        ridgeCenter.x - result.center.x,
        ridgeCenter.y - result.center.y,
      ) / Math.max(1, equivalentRadius);
      if (ridgeArea / originalArea >= 1.02
        && ridgeArea / originalArea <= 1.75
        && ridgeAspect <= 1.6
        && ridgeCompactness >= 0.75
        && ridgeOutsideRatio <= 0.1
        && percentile(ridgeMisses, 0.9) <= Math.max(0.6, equivalentRadius * 0.025)
        && Math.max(...ridgeMisses) <= Math.max(1.5, equivalentRadius * 0.07)
        && ridgeCenterShiftRatio <= 0.4) {
        compatibleRidges.push({
          boundary: paddedBoundary,
          area: ridgeArea,
          compactness: ridgeCompactness,
          scaleX,
          scaleY,
        });
      }
    }

    compatibleRidges.sort((first, second) => second.compactness - first.compactness
      || second.area - first.area);
    if (compatibleRidges.length) {
      const selected = compatibleRidges[0];
      scaled = {
        boundary: selected.boundary,
        scaleX: selected.scaleX,
        scaleY: selected.scaleY,
      };
    }
  }
  if (!scaled) return result;
  const candidateArea = Math.abs(polygonArea(scaled.boundary));
  const candidateCenter = polygonCentroid(scaled.boundary);
  const candidateAreaRatio = candidateArea / originalArea;
  const originalMisses = boundaryMissDistances(scaled.boundary, originalBoundary);
  const outsideRatio = originalMisses.filter((distance) => distance > 0).length / originalMisses.length;
  if (candidateAreaRatio < 1.02
    || candidateAreaRatio > 1.75
    || outsideRatio > 0.1
    || percentile(originalMisses, 0.9) > Math.max(0.6, equivalentRadius * 0.025)
    || Math.max(...originalMisses) > Math.max(1.5, equivalentRadius * 0.07)
    || boundarySelfIntersects(scaled.boundary)
    || !pointInPolygon(candidateCenter, scaled.boundary)
    || scaled.boundary.some((point) => Math.hypot(point.x - seed.x, point.y - seed.y) > roiRadius - 1)) {
    return result;
  }

  const resultCenterBeforeReconciliation = result.center;
  result.boundary = scaled.boundary;
  result.center = candidateCenter;
  result.area_px = Math.round(candidateArea);
  result.bbox = pixelExtent(scaled.boundary).bbox;
  result.diagnostics = {
    ...(result.diagnostics || {}),
    boundary_stroke_reconciliation: reconciliation,
    boundary_stroke_scale: Number(Math.max(scaled.scaleX, scaled.scaleY).toFixed(3)),
    boundary_stroke_scale_x: Number(scaled.scaleX.toFixed(3)),
    boundary_stroke_scale_y: Number(scaled.scaleY.toFixed(3)),
    boundary_stroke_area_ratio: Number(candidateAreaRatio.toFixed(3)),
    boundary_stroke_center_shift_ratio: Number((Math.hypot(
      candidateCenter.x - resultCenterBeforeReconciliation.x,
      candidateCenter.y - resultCenterBeforeReconciliation.y,
    ) / Math.max(1, equivalentRadius)).toFixed(3)),
  };
  return result;
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
  expectedDiameterPx: number,
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
  clearOutsideScanCircle(adaptive.mask, roiWidth, roiHeight, seedX, seedY, roiRadius);
  const seedIndex = seedY * roiWidth + seedX;
  const regionLimit = roiWidth * roiHeight * 0.65;
  const markerLimit = roiWidth * roiHeight * maxAreaFraction;
  let bestFailure = {
    priority: -1,
    stage: "no_enclosure",
    repairRadius: 0,
    boundarySupportRatio: 0,
  };
  const acceptedEnclosures: ControlledMarkerDetection[] = [];
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
        clamp(
          Math.round(expectedDiameterPx > 0
            ? expectedDiameterPx * 0.55
            : Math.min(roiWidth, roiHeight) * 0.12),
          14,
          Math.min(40, Math.max(14, Math.round(roiRadius * 0.55))),
        ),
      ),
    },
    {
      repairRadius: 6,
      build: () => bridgeStrokeFragments(
        adaptive.mask,
        roiWidth,
        roiHeight,
        seedX,
        seedY,
        clamp(
          Math.round(expectedDiameterPx > 0
            ? expectedDiameterPx * 0.55
            : Math.min(roiWidth, roiHeight) * 0.12),
          14,
          Math.min(40, Math.max(14, Math.round(roiRadius * 0.55))),
        ),
      ),
    },
  ];
  for (const { repairRadius, build } of repairAttempts) {
    const repaired = build();
    if (!repaired) continue;
    clearOutsideScanCircle(repaired, roiWidth, roiHeight, seedX, seedY, roiRadius);
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
    const geometryExtent = pixelExtent(regionPixels, seed);
    const detectedDiameterPx = Math.max(geometryExtent.bbox.width, geometryExtent.bbox.height);
    // A tiny pore or hole in a thick pen stroke can be the first formally
    // enclosed region near the seed. Do not return it and prevent the later
    // endpoint-repair passes from finding the complete marked contour.
    if (expectedDiameterPx > 0 && detectedDiameterPx < expectedDiameterPx * 0.35) {
      noteFailure(3, "local_enclosure_too_small", repairRadius);
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

    const markerExtent = pixelExtent(markerPixels, seed);
    const center = regionPixels.reduce((total, point) => ({
      x: total.x + point.x / regionPixels.length,
      y: total.y + point.y / regionPixels.length,
    }), { x: 0, y: 0 });
    acceptedEnclosures.push({
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
        ...(repairRadius >= 6
          ? ["barrier_repaired", "multi_fragment_endpoint_repaired"]
          : repairRadius > 3
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
    });
  }
  if (acceptedEnclosures.length) {
    // A thick or uneven stroke can contain several small, formally closed
    // pockets before the endpoint-repair passes reconstruct the complete
    // outline. Returning the first pocket makes the result depend on a
    // one-pixel seed shift. Compare every safe enclosure produced by the
    // bounded repair attempts and prefer the largest supported region inside
    // the same scan surface.
    acceptedEnclosures.sort((first, second) => second.area_px - first.area_px);
    const selected = acceptedEnclosures[0];
    if (acceptedEnclosures.length > 1) {
      selected.warnings = [...new Set([...selected.warnings, "representative_enclosure_selected"])];
    }
    return selected;
  }
  const weakProbeStep = clamp(Math.round(expectedDiameterPx * 0.07), 3, 6);
  const weakProbeOffsets: Array<[number, number]> = [
    [0, 0],
    [-weakProbeStep, 0], [weakProbeStep, 0], [0, -weakProbeStep], [0, weakProbeStep],
  ];
  const weakNearCircularCandidates = weakProbeOffsets
    .map(([dx, dy]) => weakNearCircularBoundaryRecovery(
      image,
      { x: seed.x + dx, y: seed.y + dy },
      roiRadius,
      expectedDiameterPx,
      minAreaPx,
      minContrast,
    ))
    .filter((candidate): candidate is ControlledMarkerDetection => Boolean(
      candidate?.center
      && candidate.boundary.length
      && pointInPolygon(seed, candidate.boundary)
      && Math.max(...candidate.boundary.map((point) => Math.hypot(point.x - seed.x, point.y - seed.y))) < roiRadius * 0.88,
    ));
  if (weakNearCircularCandidates.length) {
    weakNearCircularCandidates.sort((first, second) => (
      Number(second.diagnostics?.boundary_support_ratio || 0)
        - Number(first.diagnostics?.boundary_support_ratio || 0)
      || Number(first.diagnostics?.radial_variation_ratio || 1)
        - Number(second.diagnostics?.radial_variation_ratio || 1)
      || Math.hypot(Number(first.center?.x) - seed.x, Number(first.center?.y) - seed.y)
        - Math.hypot(Number(second.center?.x) - seed.x, Number(second.center?.y) - seed.y)
    ));
    const selected = weakNearCircularCandidates[0];
    selected.candidate_count = weakNearCircularCandidates.length;
    if (Math.hypot(Number(selected.center?.x) - seed.x, Number(selected.center?.y) - seed.y) > 0.5) {
      selected.warnings = [...new Set([...selected.warnings, "weak_center_refined"])];
    }
    return selected;
  }
  const radial = radialBoundaryRecovery(
    image,
    seed,
    roiRadius,
    x0,
    y0,
    roiWidth,
    roiHeight,
    adaptive.mask,
    backgroundLuma,
    minContrast,
    expectedDiameterPx,
    minAreaPx,
    adaptive.localWindowRadius,
  );
  // The radial probe remains diagnostic-only. Angular interpolation cannot
  // prove that the two pixels surrounding a gap are the real stroke endpoints;
  // promoting it to a successful boundary produced plausible-looking but
  // incorrect closures on real photographs. Only the endpoint/barrier path
  // above is allowed to create a planning boundary.
  if (radial.detection) {
    noteFailure(8, "radial_boundary_requires_endpoint_confirmation", 0, radial.supportRatio);
  } else if (radial.supportRatio > 0) {
    noteFailure(8, "radial_boundary_incomplete", 0, radial.supportRatio);
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
    angular_support_ratio: radial.supportRatio,
    maximum_gap_degrees: radial.maximumGapDegrees,
  };
  return rejected;
}

export interface ControlledMarkerOptions {
  roiRadius?: number;
  seedSnapRadius?: number;
  minAreaPx?: number;
  maxAreaFraction?: number;
  minContrast?: number;
  enableSeedFirstBarrier?: boolean;
  canonicalizeFromDetectedCenter?: boolean;
  expectedDiameterPx?: number;
  scanDiameterMm?: number;
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
  // In controlled mode the pointer represents a circular search surface, not
  // a single-pixel seed. Keep the strict snap radius for direct clicks, but
  // allow a complete enclosed candidate whose boundary lies nearby inside the
  // scan surface to participate in selection.
  const scanCandidateRadius = options.roiRadius === undefined
    ? seedSnapRadius
    : Math.max(seedSnapRadius, Math.round(roiRadius * 0.6));
  const expectedDiameterPx = Number(options.expectedDiameterPx || 0);
  const isExpectedSizeCandidate = (candidate: MarkerCandidate) => expectedDiameterPx <= 0
    || Math.max(candidate.bbox.width, candidate.bbox.height) >= expectedDiameterPx * 0.35;
  const isScanSurfaceCandidate = (candidate: MarkerCandidate) => candidate.enclosed
    && isExpectedSizeCandidate(candidate);
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
  const localSeedX = seed.x - x0;
  const localSeedY = seed.y - y0;
  const roiLumas: number[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (insideScanCircle(x - x0, y - y0, localSeedX, localSeedY, roiRadius)) {
        roiLumas.push(luma(image.data, (y * width + x) * 4));
      }
    }
  }
  // A marker near the face edge shares its ROI with hair, ears, clothing or
  // background. The upper local percentile represents the skin field without
  // letting those dark areas suppress the marker threshold.
  const backgroundLuma = robustBackgroundLuma(roiLumas);
  const darkThreshold = Math.min(160, backgroundLuma - minContrast);
  const dark = new Uint8Array(roiWidth * roiHeight);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (insideScanCircle(x - x0, y - y0, localSeedX, localSeedY, roiRadius)
        && luma(image.data, (y * width + x) * 4) <= darkThreshold) {
        dark[(y - y0) * roiWidth + x - x0] = 1;
      }
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
        Number(options.expectedDiameterPx || 0),
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
  const rawDirectCandidates = findRelevantCandidates(rawComponents, seed, seedSnapRadius, minAreaPx);
  const rawExpectedCandidates = rawDirectCandidates.filter(isExpectedSizeCandidate);
  const rawCandidates = rawExpectedCandidates.length
    ? rawExpectedCandidates
    : findRelevantCandidates(rawComponents, seed, scanCandidateRadius, minAreaPx)
      .filter(isScanSurfaceCandidate);
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
    const directCandidates = findRelevantCandidates(repairedComponents, seed, seedSnapRadius, minAreaPx)
      .filter(isExpectedSizeCandidate);
    repairedCandidates = directCandidates.length
      ? directCandidates
      : findRelevantCandidates(repairedComponents, seed, scanCandidateRadius, minAreaPx)
        .filter(isScanSurfaceCandidate);
    if (!repairedCandidates.length) {
      repairedComponents = extractComponents(
        repairBarrier(dark, roiWidth, roiHeight, 2),
        roiWidth,
        roiHeight,
        x0,
        y0,
        image,
      );
      const directCandidates = findRelevantCandidates(repairedComponents, seed, seedSnapRadius, minAreaPx)
        .filter(isExpectedSizeCandidate);
      repairedCandidates = directCandidates.length
        ? directCandidates
        : findRelevantCandidates(repairedComponents, seed, scanCandidateRadius, minAreaPx)
          .filter(isScanSurfaceCandidate);
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
      const directCandidates = findRelevantCandidates(repairedComponents, seed, seedSnapRadius, minAreaPx)
        .filter(isExpectedSizeCandidate);
      repairedCandidates = directCandidates.length
        ? directCandidates
        : findRelevantCandidates(repairedComponents, seed, scanCandidateRadius, minAreaPx)
          .filter(isScanSurfaceCandidate);
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
  const permittedMiss = selected.enclosed
    ? options.roiRadius === undefined
      ? Math.min(seedSnapRadius, 6)
      : scanCandidateRadius
    : 2;
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
  const geometryDiameterPx = Math.max(geometryBbox.width, geometryBbox.height);
  if (expectedDiameterPx > 0 && geometryDiameterPx < expectedDiameterPx * 0.35) {
    return fallbackOrFailure("component_too_small", relevantCandidates.length);
  }
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

function rejectedScanResult(
  code: Extract<ControlledMarkerFailureCode, "scan_range_too_small" | "edge_discontinuous" | "unstable_enclosure">,
  source: ControlledMarkerDetection,
): ControlledMarkerDetection {
  const rejected = failure(code, source.candidate_count);
  rejected.diagnostics = source.diagnostics;
  rejected.warnings = [code, ...source.warnings.filter((warning) => warning !== code)];
  return rejected;
}

function classifyScanFailure(
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions,
  roiRadius: number,
  result: ControlledMarkerDetection,
): ControlledMarkerDetection {
  if (result.ok || !["no_dark_component", "component_too_small", "seed_not_enclosed"].includes(result.failure_code || "")) {
    return result;
  }
  const expectedDiameterPx = Number(options.expectedDiameterPx || 0);
  if (expectedDiameterPx > roiRadius * 1.7) return rejectedScanResult("scan_range_too_small", result);

  const width = Math.floor(image.width);
  const height = Math.floor(image.height);
  const x0 = clamp(Math.floor(seed.x - roiRadius), 0, width - 1);
  const y0 = clamp(Math.floor(seed.y - roiRadius), 0, height - 1);
  const x1 = clamp(Math.ceil(seed.x + roiRadius), 0, width - 1);
  const y1 = clamp(Math.ceil(seed.y + roiRadius), 0, height - 1);
  const localLumas: number[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (insideScanCircle(x, y, seed.x, seed.y, roiRadius)) {
        localLumas.push(luma(image.data, (y * width + x) * 4));
      }
    }
  }
  const threshold = Math.min(160, robustBackgroundLuma(localLumas) - Number(options.minContrast ?? 24));
  const darkPoints: MarkerPoint[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (insideScanCircle(x, y, seed.x, seed.y, roiRadius)
        && luma(image.data, (y * width + x) * 4) <= threshold) {
        darkPoints.push({ x, y });
      }
    }
  }
  if (darkPoints.length < Math.max(12, Number(options.minAreaPx ?? 9))) return result;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of darkPoints) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const surroundsSeed = seed.x >= minX && seed.x <= maxX && seed.y >= minY && seed.y <= maxY;
  if (!surroundsSeed) return result;
  // Once the configured scan already exceeds the operator-entered lesion
  // diameter, an unrelated wrinkle, nostril or hair at the circular edge must
  // not turn a broken target outline into the misleading "enlarge scan" result.
  // Coverage is decided from the explicit size prior above; remaining dark
  // evidence around the click is an internal continuity problem.
  return rejectedScanResult("edge_discontinuous", result);
}

function validateScanSuccess(
  result: ControlledMarkerDetection,
  seed: MarkerPoint,
  options: ControlledMarkerOptions,
  roiRadius: number,
): ControlledMarkerDetection {
  if (!result.ok || !result.bbox || !result.boundary.length) return result;
  const maximumBoundaryRadius = Math.max(
    ...result.boundary.map((point) => Math.hypot(point.x - seed.x, point.y - seed.y)),
  );
  if (maximumBoundaryRadius >= roiRadius * 0.88) {
    return rejectedScanResult("scan_range_too_small", result);
  }
  const expectedDiameterPx = Number(options.expectedDiameterPx || 0);
  const detectedDiameterPx = Math.max(result.bbox.width, result.bbox.height);
  if (expectedDiameterPx > 0) {
    result.diagnostics = {
      ...(result.diagnostics || {}),
      detected_diameter_px: detectedDiameterPx,
      expected_diameter_px: expectedDiameterPx,
      detected_to_expected_diameter_ratio: detectedDiameterPx / expectedDiameterPx,
    };
  }
  if (expectedDiameterPx > 0 && detectedDiameterPx < expectedDiameterPx * 0.35) {
    return rejectedScanResult("unstable_enclosure", result);
  }
  if (expectedDiameterPx > 0 && detectedDiameterPx > expectedDiameterPx * 2.75) {
    return rejectedScanResult("unstable_enclosure", result);
  }
  if (expectedDiameterPx > 0
    && (detectedDiameterPx < expectedDiameterPx * 0.6 || detectedDiameterPx > expectedDiameterPx * 1.8)) {
    result.warnings = [...new Set([...result.warnings, "operator_diameter_mismatch"])];
  }
  return result;
}

function recoverBySeedNeighborhoodConsensus(
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions,
  roiRadius: number,
  sourceResult: ControlledMarkerDetection,
): ControlledMarkerDetection {
  const expectedDiameterPx = Number(options.expectedDiameterPx || 0);
  const sourceDiameterPx = sourceResult.bbox
    ? Math.max(sourceResult.bbox.width, sourceResult.bbox.height)
    : 0;
  const sourceNeedsStabilityCheck = sourceResult.ok && (
    sourceResult.warnings.some((warning) => [
      "canonical_seed_unstable",
      "seed_relocated_from_marker_stroke",
      "operator_diameter_mismatch",
    ].includes(warning))
    || (expectedDiameterPx > 0 && sourceDiameterPx < expectedDiameterPx)
  );
  if (!sourceNeedsStabilityCheck && (sourceResult.ok || ![
    "component_too_small",
    "component_too_large",
    "seed_not_enclosed",
    "edge_discontinuous",
    "unstable_enclosure",
  ].includes(sourceResult.failure_code || ""))) return sourceResult;

  const step = clamp(Math.round(roiRadius * 0.0625), 4, 8);
  const probeDistances = [...new Set([
    step,
    step * 2,
    Math.round(roiRadius * 0.25),
    Math.round(roiRadius * 0.4),
  ].map((distance) => clamp(distance, 4, Math.max(4, Math.round(roiRadius * 0.45)))))];
  const directions: Array<[number, number]> = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];
  const offsets: Array<[number, number]> = probeDistances.flatMap((distance) => directions
    .map(([dx, dy]) => [dx * distance, dy * distance] as [number, number]));
  const width = Math.floor(image.width);
  const height = Math.floor(image.height);
  const successes: ControlledMarkerDetection[] = sourceResult.ok
    && sourceResult.geometry_mode === "enclosed_region"
    && sourceResult.boundary.length
    ? [sourceResult]
    : [];
  for (const [dx, dy] of offsets) {
    const neighbourSeed = { x: seed.x + dx, y: seed.y + dy };
    if (neighbourSeed.x < 0 || neighbourSeed.x >= width || neighbourSeed.y < 0 || neighbourSeed.y >= height) continue;
    let candidate = detectControlledMarkerInRoi(
      image,
      neighbourSeed,
      { ...options, canonicalizeFromDetectedCenter: false },
      roiRadius,
    );
    candidate = validateScanSuccess(candidate, seed, options, roiRadius);
    if (!candidate.ok || candidate.geometry_mode !== "enclosed_region" || !candidate.boundary.length) continue;
    successes.push(candidate);
  }
  if (successes.length < 2) {
    sourceResult.diagnostics = {
      ...(sourceResult.diagnostics || {}),
      scan_probe_count: offsets.length,
      scan_probe_success_count: successes.length,
    };
    return sourceNeedsStabilityCheck
      ? rejectedScanResult("unstable_enclosure", sourceResult)
      : sourceResult;
  }

  const groups: ControlledMarkerDetection[][] = [];
  for (const candidate of successes) {
    const group = groups.find((entries) => compatibleCanonicalRegion(entries[0], candidate));
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  groups.sort((first, second) => second.length - first.length);
  const supportedGroups = groups.filter((group) => group.length >= 2);
  if (!supportedGroups.length) {
    sourceResult.diagnostics = {
      ...(sourceResult.diagnostics || {}),
      scan_probe_count: offsets.length,
      scan_probe_success_count: successes.length,
      scan_probe_group_sizes: groups.map((group) => group.length),
    };
    return sourceNeedsStabilityCheck
      ? rejectedScanResult("unstable_enclosure", sourceResult)
      : sourceResult;
  }
  // Completeness is a property of the scan surface, not of the exact pointer
  // pixel. Among regions with meaningful probe support, prefer the group whose
  // median enclosed area is largest; this prevents a frequently sampled pore
  // or one-sided stroke pocket from defeating the complete outline.
  const medianArea = (group: ControlledMarkerDetection[]): number => {
    const areas = group.map((entry) => entry.area_px).sort((a, b) => a - b);
    return areas[Math.floor(areas.length / 2)] || 0;
  };
  supportedGroups.sort((first, second) => medianArea(second) - medianArea(first)
    || second.length - first.length);
  const selectedGroup = supportedGroups[0];
  const selected = selectedGroup
    .sort((first, second) => second.area_px - first.area_px)[0];
  selected.warnings = [...new Set([...selected.warnings, "seed_neighborhood_consensus"])];
  selected.diagnostics = {
    ...(selected.diagnostics || {}),
    scan_probe_count: offsets.length,
    scan_probe_success_count: successes.length,
    scan_probe_consensus_count: selectedGroup.length,
    scan_probe_group_sizes: groups.map((group) => group.length),
  };
  return selected;
}

function attachScanMetadata(
  result: ControlledMarkerDetection,
  options: ControlledMarkerOptions,
  roiRadius: number,
): ControlledMarkerDetection {
  result.scan = {
    diameter_mm: Number.isFinite(Number(options.scanDiameterMm)) ? Number(options.scanDiameterMm) : null,
    radius_px: roiRadius,
    expected_diameter_px: Number.isFinite(Number(options.expectedDiameterPx)) ? Number(options.expectedDiameterPx) : null,
  };
  return result;
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
    const roiRadius = clamp(Math.round(options.roiRadius), 1, Math.max(width, height));
    let result = detectControlledMarkerInRoi(
      image,
      seed,
      options,
      roiRadius,
    );
    if (result.ok
      && result.geometry_mode === "enclosed_region"
      && result.center
      && result.bbox
      && options.canonicalizeFromDetectedCenter !== false
      && Math.hypot(result.center.x - seed.x, result.center.y - seed.y) > 0.5) {
      const canonical = detectControlledMarkerInRoi(
        image,
        result.center,
        { ...options, canonicalizeFromDetectedCenter: false },
        roiRadius,
      );
      if (!compatibleCanonicalRegion(result, canonical)) {
        // A closed region already proven to be wholly inside the scan must not
        // be discarded only because re-seeding from its centroid follows a
        // different weak-stroke repair path. Preserve the first enclosure and
        // retain the disagreement as audit evidence; scan containment and size
        // validation still run below.
        result.warnings = [...new Set([...result.warnings, "canonical_seed_unstable"])];
      } else {
        canonical.warnings = [...new Set([...canonical.warnings, "canonical_seed_refined"])];
        result = canonical;
      }
    }
    result = classifyScanFailure(image, seed, options, roiRadius, result);
    result = validateScanSuccess(result, seed, options, roiRadius);
    result = recoverBySeedNeighborhoodConsensus(image, seed, options, roiRadius, result);
    result = finalizeControlledMarkerBoundary(result);
    result = reconcileMarkerStrokeCoverage(image, seed, options, roiRadius, result);
    return attachScanMetadata(result, options, roiRadius);
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
        return finalizeControlledMarkerBoundary(canonical);
      }
    }
    return finalizeControlledMarkerBoundary(selected);
  }
  return bestRetryableFailure || failure("no_dark_component");
}

export const __controlledMarkerForTests = {
  adaptiveDarkBarrier,
  boundarySelfIntersects,
  bridgeSingleStrokeGap,
  componentOuterBoundary,
  finalizeControlledMarkerBoundary,
  reconcileMarkerStrokeCoverage,
  weakNearCircularBoundaryRecovery,
};
