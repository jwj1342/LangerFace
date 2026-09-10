import {
  skeletonizeBinary,
  YOLO_WRINKLE_CLASSES,
} from "./yoloWrinkleOnnx.ts";

type NumericField = ArrayLike<number>;
type Point2 = [number, number];

export interface FineWrinkleLine {
  id: string;
  sourceComponentId: string;
  class: string;
  lengthPx: number;
  points: Point2[];
  recoveredEndpointLengthPx?: number;
  recoveredEndpointSupport?: number;
}
export interface FineWrinkleRejection {
  sourceComponentId: string;
  class: string;
  reason: "main_path_shorter_than_minimum" | "empty_skeleton";
  lengthPx: number;
}

export interface FineWrinkleExtractionOptions {
  classes?: readonly string[];
  minimumLineLengthPx?: number;
  resampleSpacingPx?: number;
  maximumSkeletonIterations?: number;
  sourceImageRgba?: NumericField;
  onProfile?: (timings: Record<string, number>) => void;
}

export interface FineWrinkleExtraction {
  schemaVersion: "langerface.wrinkle-fine-lines.v2";
  validated: false;
  purpose: "automatic_browser_fine_wrinkle_line_extraction_research_only";
  method: {
    componentIsolation: "8_connected_components_per_yolo_class_mask";
    skeletonization: "zhang_suen_thinning";
    branchHandling: "weighted_geodesic_longest_main_path";
    centerlineSmoothing: "nine_pixel_weighted_window_constrained_to_source_component";
    foreheadEndpointRecovery: "image_supported_dark_ridge_tracking";
    minimumLineLengthPx: number;
    resampleSpacingPx: number;
    rasterStrokeWidthPx: 1;
    rstlUsed: false;
  };
  summary: {
    sourceConnectedComponents: number;
    fineLineCount: number;
    rejectedShortComponentCount: number;
    lineCountByClass: Record<string, number>;
    totalLengthPx: number;
    lengthPxByClass: Record<string, number>;
    recoveredForeheadEndpointCount: number;
    recoveredForeheadEndpointLengthPx: number;
  };
  validation: {
    passed: boolean;
    checks: Record<string, boolean>;
    renderedLinePixels: number;
    renderedPixelsOutsideMask: number;
    filledTwoByTwoPixelBlocks: number;
    renderedConnectedComponents: number;
    minimumLineLengthPx: number;
    recoveredForeheadEndpointsImageSupported: boolean;
  };
  rejectedComponents: FineWrinkleRejection[];
  limitations: string[];
  lines: FineWrinkleLine[];
  mask: Uint8Array;
  confidence: Float32Array;
  directionQ: Float32Array;
  classMasks: Record<string, Uint8Array>;
  rasterPixelCount: number;
}

interface Component {
  pixels: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface GraphEdge {
  node: number;
  weight: number;
}

interface HeapEntry {
  distance: number;
  node: number;
}

const SMOOTHING_KERNEL = Object.freeze([1, 4, 7, 10, 13, 10, 7, 4, 1]);
const SMOOTHING_WEIGHT = SMOOTHING_KERNEL.reduce((sum, value) => sum + value, 0);

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError("Fine wrinkle extraction requires positive integer dimensions");
  }
}

function connectedComponents(binary: NumericField, width: number, height: number): Component[] {
  if (binary.length !== width * height) throw new RangeError("Fine wrinkle class-mask shape mismatch");
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components: Component[] = [];
  for (let start = 0; start < binary.length; start++) {
    if (!binary[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const next = yy * width + xx;
        if (!binary[next] || visited[next]) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    components.push({
      pixels: Array.from(queue.subarray(0, tail)),
      minX,
      minY,
      maxX,
      maxY,
    });
  }
  return components.sort((left, right) =>
    left.minY - right.minY || left.minX - right.minX || left.pixels[0] - right.pixels[0]);
}

function cropComponent(
  component: Component,
  width: number,
  height: number,
): { binary: Uint8Array; width: number; height: number; offsetX: number; offsetY: number } {
  const offsetX = Math.max(0, component.minX - 2);
  const offsetY = Math.max(0, component.minY - 2);
  const x1 = Math.min(width, component.maxX + 3);
  const y1 = Math.min(height, component.maxY + 3);
  const cropWidth = x1 - offsetX;
  const cropHeight = y1 - offsetY;
  const binary = new Uint8Array(cropWidth * cropHeight);
  for (const index of component.pixels) {
    const x = index % width;
    const y = Math.floor(index / width);
    binary[(y - offsetY) * cropWidth + x - offsetX] = 1;
  }
  return { binary, width: cropWidth, height: cropHeight, offsetX, offsetY };
}

class MinimumHeap {
  private entries: HeapEntry[] = [];

  get length(): number {
    return this.entries.length;
  }

  push(entry: HeapEntry): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentEntry = this.entries[parent];
      if (parentEntry.distance < entry.distance ||
          (parentEntry.distance === entry.distance && parentEntry.node <= entry.node)) break;
      this.entries[index] = parentEntry;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      let child = left;
      if (right < this.entries.length) {
        const leftEntry = this.entries[left];
        const rightEntry = this.entries[right];
        if (rightEntry.distance < leftEntry.distance ||
            (rightEntry.distance === leftEntry.distance && rightEntry.node < leftEntry.node)) {
          child = right;
        }
      }
      const childEntry = this.entries[child];
      if (last.distance < childEntry.distance ||
          (last.distance === childEntry.distance && last.node <= childEntry.node)) break;
      this.entries[index] = childEntry;
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

function skeletonGraph(
  skeleton: NumericField,
  width: number,
  height: number,
): { points: Point2[]; adjacency: GraphEdge[][] } {
  const points: Point2[] = [];
  const lookup = new Int32Array(width * height);
  lookup.fill(-1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (!skeleton[index]) continue;
    lookup[index] = points.length;
    points.push([x, y]);
  }
  const adjacency = Array.from({ length: points.length }, () => [] as GraphEdge[]);
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
  points.forEach(([x, y], node) => {
    for (const [dx, dy] of directions) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const neighbour = lookup[yy * width + xx];
      if (neighbour < 0) continue;
      if (dx !== 0 && dy !== 0) {
        const horizontal = lookup[y * width + xx];
        const vertical = lookup[yy * width + x];
        if (horizontal >= 0 || vertical >= 0) continue;
      }
      const weight = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      adjacency[node].push({ node: neighbour, weight });
      adjacency[neighbour].push({ node, weight });
    }
  });
  return { points, adjacency };
}

function shortestPaths(adjacency: GraphEdge[][], start: number) {
  const distances = new Float64Array(adjacency.length);
  distances.fill(Infinity);
  const previous = new Int32Array(adjacency.length);
  previous.fill(-1);
  const heap = new MinimumHeap();
  distances[start] = 0;
  heap.push({ distance: 0, node: start });
  while (heap.length) {
    const current = heap.pop();
    if (!current || current.distance !== distances[current.node]) continue;
    for (const edge of adjacency[current.node]) {
      const candidate = current.distance + edge.weight;
      if (candidate + 1e-9 >= distances[edge.node]) continue;
      distances[edge.node] = candidate;
      previous[edge.node] = current.node;
      heap.push({ distance: candidate, node: edge.node });
    }
  }
  return { distances, previous };
}

function longestMainPath(skeleton: NumericField, width: number, height: number): Point2[] {
  const { points, adjacency } = skeletonGraph(skeleton, width, height);
  if (points.length <= 1) return points.map((point) => [...point]);
  const endpoints = adjacency
    .map((neighbours, index) => ({ neighbours, index }))
    .filter(({ neighbours }) => neighbours.length === 1)
    .map(({ index }) => index);
  const starts = endpoints.length >= 2 ? endpoints : [0];
  let bestDistance = -1;
  let bestEnd = 0;
  let bestPrevious: Int32Array | null = null;
  for (const start of starts) {
    const { distances, previous } = shortestPaths(adjacency, start);
    const targets = endpoints.length >= 2 ? endpoints : points.map((_, index) => index);
    let end = targets[0] ?? 0;
    for (const target of targets) {
      if (!Number.isFinite(distances[target])) continue;
      if (distances[target] > distances[end] ||
          (distances[target] === distances[end] && target < end)) end = target;
    }
    if (distances[end] > bestDistance) {
      bestDistance = distances[end];
      bestEnd = end;
      bestPrevious = previous;
    }
  }
  if (!bestPrevious) return [];
  const indices = [bestEnd];
  while (bestPrevious[indices[indices.length - 1]] >= 0) {
    indices.push(bestPrevious[indices[indices.length - 1]]);
  }
  let path = indices.map((index) => [...points[index]] as Point2);
  const first = path[0];
  const last = path[path.length - 1];
  const primaryAxis = Math.abs(last[0] - first[0]) >= Math.abs(last[1] - first[1]) ? 0 : 1;
  if (first[primaryAxis] > last[primaryAxis]) path = path.reverse();
  return path;
}

function polylineLength(points: readonly Point2[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
  }
  return length;
}

function resamplePolyline(points: readonly Point2[], spacing: number): Point2[] {
  if (points.length < 2) return points.map((point) => [...point]);
  const cumulative = new Float64Array(points.length);
  for (let index = 1; index < points.length; index++) {
    cumulative[index] = cumulative[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= spacing) return [[...points[0]], [...points[points.length - 1]]];
  const count = Math.max(2, Math.ceil(total / spacing) + 1);
  const output: Point2[] = [];
  let segment = 1;
  for (let index = 0; index < count; index++) {
    const distance = total * index / (count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment] < distance) segment++;
    const startDistance = cumulative[segment - 1];
    const endDistance = cumulative[segment];
    const amount = endDistance > startDistance ?
      (distance - startDistance) / (endDistance - startDistance) : 0;
    output.push([
      points[segment - 1][0] * (1 - amount) + points[segment][0] * amount,
      points[segment - 1][1] * (1 - amount) + points[segment][1] * amount,
    ]);
  }
  return output;
}

function maskContains(mask: NumericField, width: number, height: number, point: Point2): boolean {
  const x = Math.max(0, Math.min(width - 1, Math.round(point[0])));
  const y = Math.max(0, Math.min(height - 1, Math.round(point[1])));
  return !!mask[y * width + x];
}

function smoothPolylineInside(
  points: readonly Point2[],
  componentMask: NumericField,
  width: number,
  height: number,
): Point2[] {
  if (points.length < SMOOTHING_KERNEL.length) return points.map((point) => [...point]);
  const output: Point2[] = points.map((point) => [...point]);
  for (let index = 1; index < points.length - 1; index++) {
    let x = 0;
    let y = 0;
    for (let kernelIndex = 0; kernelIndex < SMOOTHING_KERNEL.length; kernelIndex++) {
      const source = Math.max(0, Math.min(
        points.length - 1,
        index + kernelIndex - Math.floor(SMOOTHING_KERNEL.length / 2),
      ));
      x += points[source][0] * SMOOTHING_KERNEL[kernelIndex];
      y += points[source][1] * SMOOTHING_KERNEL[kernelIndex];
    }
    const candidate: Point2 = [x / SMOOTHING_WEIGHT, y / SMOOTHING_WEIGHT];
    if (maskContains(componentMask, width, height, candidate)) output[index] = candidate;
  }
  return output;
}

function luminanceAt(
  rgba: NumericField,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const xx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const yy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const index = (yy * width + xx) * 4;
  return 0.299 * Number(rgba[index] || 0) +
    0.587 * Number(rgba[index + 1] || 0) +
    0.114 * Number(rgba[index + 2] || 0);
}

function horizontalRidgeContrast(
  rgba: NumericField,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let center = 0;
  let upper = 0;
  let lower = 0;
  for (let offset = -1; offset <= 1; offset++) {
    center += luminanceAt(rgba, width, height, x, y + offset);
    upper += luminanceAt(rgba, width, height, x, y - 7 + offset);
    lower += luminanceAt(rgba, width, height, x, y + 7 + offset);
  }
  return (upper + lower) / 6 - center / 3;
}

interface RidgeTrace {
  points: Point2[];
  meanContrast: number;
  supportedFraction: number;
}

/** Track a horizontal dark furrow between two model-supported endpoints. */
function traceForeheadRidge(
  source: Point2,
  target: Point2,
  stopGapPx: number,
  rgba: NumericField,
  width: number,
  height: number,
): RidgeTrace | null {
  const reverse = source[0] > target[0];
  const left = reverse ? target : source;
  const right = reverse ? source : target;
  const startX = Math.ceil(left[0] + (reverse ? stopGapPx : 0));
  const endX = Math.floor(right[0] - (reverse ? 0 : stopGapPx));
  if (endX - startX < 8) return null;
  const corridor = Math.max(6, Math.round(width * 0.008));
  const slope = (right[1] - left[1]) / Math.max(1, right[0] - left[0]);
  const rows: Array<Map<number, { cost: number; previous: number }>> = [];
  for (let x = startX; x <= endX; x++) {
    const expectedY = left[1] + slope * (x - left[0]);
    const yMin = Math.max(1, Math.floor(expectedY - corridor));
    const yMax = Math.min(height - 2, Math.ceil(expectedY + corridor));
    const row = new Map<number, { cost: number; previous: number }>();
    if (x === startX) {
      const y = Math.max(yMin, Math.min(yMax, Math.round(left[1])));
      row.set(y, {
        cost: -horizontalRidgeContrast(rgba, width, height, x, y),
        previous: y,
      });
    } else {
      const previousRow = rows[rows.length - 1];
      for (let y = yMin; y <= yMax; y++) {
        let bestCost = Infinity;
        let bestPrevious = y;
        for (let previousY = y - 2; previousY <= y + 2; previousY++) {
          const previous = previousRow.get(previousY);
          if (!previous) continue;
          const transition = Math.abs((y - previousY) - slope) * 0.45;
          const deviation = Math.abs(y - expectedY) * 0.12;
          const cost = previous.cost + transition + deviation -
            horizontalRidgeContrast(rgba, width, height, x, y);
          if (cost < bestCost) {
            bestCost = cost;
            bestPrevious = previousY;
          }
        }
        if (Number.isFinite(bestCost)) row.set(y, { cost: bestCost, previous: bestPrevious });
      }
    }
    rows.push(row);
  }
  const finalRow = rows[rows.length - 1];
  const finalEntries = [...finalRow.entries()];
  let y = reverse ?
    finalEntries.reduce((best, entry) =>
      Math.abs(entry[0] - right[1]) < Math.abs(best[0] - right[1]) ? entry : best)[0] :
    finalEntries.reduce((best, entry) => entry[1].cost < best[1].cost ? entry : best)[0];
  const traced: Point2[] = [];
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex--) {
    traced.push([startX + rowIndex, y]);
    y = rows[rowIndex].get(y)?.previous ?? y;
  }
  traced.reverse();
  let smoothed = traced;
  for (let pass = 0; pass < 3; pass++) {
    const sourcePoints = smoothed;
    smoothed = sourcePoints.map(([x, yy], index) => {
      if ((!reverse && index === 0) || (reverse && index === sourcePoints.length - 1)) {
        return [x, yy] as Point2;
      }
      const radius = 12;
      let weightedY = 0;
      let weight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sourceIndex = Math.max(0, Math.min(sourcePoints.length - 1, index + offset));
        const localWeight = radius + 1 - Math.abs(offset);
        weightedY += sourcePoints[sourceIndex][1] * localWeight;
        weight += localWeight;
      }
      return [x, weightedY / weight] as Point2;
    });
  }
  const contrasts = smoothed.map(([x, yy]) =>
    horizontalRidgeContrast(rgba, width, height, x, yy));
  const result = {
    points: reverse ? smoothed.reverse() : smoothed,
    meanContrast: contrasts.reduce((sum, value) => sum + value, 0) / contrasts.length,
    supportedFraction: contrasts.filter((value) => value >= 2).length / contrasts.length,
  };
  return result.meanContrast >= 3.5 && result.supportedFraction >= 0.62 ? result : null;
}

function recoverForeheadEndpointDropouts(
  inputLines: FineWrinkleLine[],
  rgba: NumericField | undefined,
  width: number,
  height: number,
): FineWrinkleLine[] {
  if (!rgba || rgba.length !== width * height * 4) return inputLines;
  const lines = inputLines.map((line) => ({
    ...line,
    points: line.points.map((point) => [...point] as Point2),
  }));
  const foreheadIndices = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.class === "forehead");
  const pairs: Array<{ left: number; right: number; gap: number }> = [];
  for (let first = 0; first < foreheadIndices.length; first++) {
    for (let second = first + 1; second < foreheadIndices.length; second++) {
      const a = foreheadIndices[first];
      const b = foreheadIndices[second];
      const aMinX = Math.min(...a.line.points.map(([x]) => x));
      const aMaxX = Math.max(...a.line.points.map(([x]) => x));
      const bMinX = Math.min(...b.line.points.map(([x]) => x));
      const bMaxX = Math.max(...b.line.points.map(([x]) => x));
      const left = aMaxX < bMinX ? a : bMaxX < aMinX ? b : null;
      const right = left === a ? b : left === b ? a : null;
      if (!left || !right) continue;
      const leftPoint = left.line.points.reduce((best, point) => point[0] > best[0] ? point : best);
      const rightPoint = right.line.points.reduce((best, point) => point[0] < best[0] ? point : best);
      const gap = rightPoint[0] - leftPoint[0];
      if (gap < Math.max(18, width * 0.02) || gap > width * 0.20) continue;
      if (Math.abs(rightPoint[1] - leftPoint[1]) > Math.max(14, width * 0.018)) continue;
      const leftSpan = aMaxX - aMinX;
      const rightSpan = bMaxX - bMinX;
      if (leftSpan < width * 0.035 || rightSpan < width * 0.035) continue;
      pairs.push({ left: left.index, right: right.index, gap });
    }
  }
  const recovered = new Set<number>();
  for (const pair of pairs.sort((a, b) => a.gap - b.gap)) {
    const primaryIndex = lines[pair.left].lengthPx >= lines[pair.right].lengthPx ?
      pair.left : pair.right;
    if (recovered.has(primaryIndex)) continue;
    const targetIndex = primaryIndex === pair.left ? pair.right : pair.left;
    const primary = lines[primaryIndex];
    const target = lines[targetIndex];
    const source = primaryIndex === pair.left ?
      primary.points.reduce((best, point) => point[0] > best[0] ? point : best) :
      primary.points.reduce((best, point) => point[0] < best[0] ? point : best);
    const destination = primaryIndex === pair.left ?
      target.points.reduce((best, point) => point[0] < best[0] ? point : best) :
      target.points.reduce((best, point) => point[0] > best[0] ? point : best);
    const trace = traceForeheadRidge(
      source,
      destination,
      Math.max(8, Math.round(width * 0.01)),
      rgba,
      width,
      height,
    );
    if (!trace) continue;
    const sourceAtStart = Math.hypot(
      primary.points[0][0] - source[0],
      primary.points[0][1] - source[1],
    ) < 2;
    const combined = sourceAtStart ?
      [...trace.points.slice().reverse().slice(0, -1), ...primary.points] :
      [...primary.points, ...trace.points.slice(1)];
    const points = resamplePolyline(combined, 1);
    const recoveredLength = Math.max(0, polylineLength(points) - primary.lengthPx);
    lines[primaryIndex] = {
      ...primary,
      lengthPx: round(polylineLength(points), 3),
      points: points.map(([x, y]) => [round(x, 3), round(y, 3)]),
      recoveredEndpointLengthPx: round(recoveredLength, 3),
      recoveredEndpointSupport: round(trace.supportedFraction, 6),
    };
    recovered.add(primaryIndex);
  }
  return lines;
}

function rasterSegment(start: Point2, end: Point2, visit: (x: number, y: number) => void): void {
  let x0 = Math.round(start[0]);
  let y0 = Math.round(start[1]);
  const x1 = Math.round(end[0]);
  const y1 = Math.round(end[1]);
  const dx = Math.abs(x1 - x0);
  const stepX = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const stepY = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    visit(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x0 += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y0 += stepY;
    }
  }
}

function rasterPolyline(points: readonly Point2[], visit: (x: number, y: number) => void): void {
  for (let index = 1; index < points.length; index++) {
    rasterSegment(points[index - 1], points[index], visit);
  }
}

function rasterStaysInside(
  points: readonly Point2[],
  componentMask: NumericField,
  width: number,
  height: number,
): boolean {
  let inside = true;
  rasterPolyline(points, (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height || !componentMask[y * width + x]) inside = false;
  });
  return inside;
}

function renderedComponentCount(mask: NumericField, width: number, height: number): number {
  return connectedComponents(mask, width, height).length;
}

function normalizedBinaryCopy(source: NumericField | undefined, pixels: number): Uint8Array {
  const output = new Uint8Array(pixels);
  if (!source) return output;
  for (let index = 0; index < pixels; index++) output[index] = source[index] ? 1 : 0;
  return output;
}

export function extractFineWrinkleLines(
  classMasks: Record<string, NumericField> | null | undefined,
  width: number,
  height: number,
  options: FineWrinkleExtractionOptions = {},
): FineWrinkleExtraction {
  const profileStart = options.onProfile ? performance.now() : 0;
  const profile: Record<string, number> = {};
  const mark = (name: string, start: number): void => {
    if (options.onProfile) profile[name] = (profile[name] || 0) + performance.now() - start;
  };
  assertDimensions(width, height);
  const classes = options.classes || YOLO_WRINKLE_CLASSES;
  const minimumLineLengthPx = options.minimumLineLengthPx ?? 20;
  const resampleSpacingPx = options.resampleSpacingPx ?? 1;
  const maximumSkeletonIterations = options.maximumSkeletonIterations ?? 96;
  const sourceComponents: Array<{ className: string; component: Component; id: string }> = [];
  let stageStart = options.onProfile ? performance.now() : 0;
  for (const className of classes) {
    const sourceMask = classMasks?.[className] || new Uint8Array(width * height);
    const components = connectedComponents(sourceMask, width, height);
    components.forEach((component, index) => sourceComponents.push({
      className,
      component,
      id: `${className}-component-${String(index + 1).padStart(3, "0")}`,
    }));
  }
  mark("connectedComponents", stageStart);

  let lines: FineWrinkleLine[] = [];
  const rejectedComponents: FineWrinkleRejection[] = [];
  for (const source of sourceComponents) {
    const originalMask = classMasks?.[source.className] || new Uint8Array(width * height);
    stageStart = options.onProfile ? performance.now() : 0;
    const crop = cropComponent(source.component, width, height);
    mark("componentCrops", stageStart);
    stageStart = options.onProfile ? performance.now() : 0;
    const skeleton = skeletonizeBinary(
      crop.binary,
      crop.width,
      crop.height,
      maximumSkeletonIterations,
    );
    mark("componentSkeletons", stageStart);
    stageStart = options.onProfile ? performance.now() : 0;
    let path = longestMainPath(skeleton, crop.width, crop.height)
      .map(([x, y]) => [x + crop.offsetX, y + crop.offsetY] as Point2);
    mark("longestPaths", stageStart);
    if (!path.length) {
      rejectedComponents.push({
        sourceComponentId: source.id,
        class: source.className,
        reason: "empty_skeleton",
        lengthPx: 0,
      });
      continue;
    }
    stageStart = options.onProfile ? performance.now() : 0;
    path = resamplePolyline(path, resampleSpacingPx);
    const initialLength = polylineLength(path);
    if (initialLength < minimumLineLengthPx) {
      rejectedComponents.push({
        sourceComponentId: source.id,
        class: source.className,
        reason: "main_path_shorter_than_minimum",
        lengthPx: round(initialLength, 3),
      });
      mark("resampleAndSmooth", stageStart);
      continue;
    }
    const smoothed = smoothPolylineInside(path, originalMask, width, height);
    const refined = rasterStaysInside(smoothed, originalMask, width, height) ? smoothed : path;
    lines.push({
      id: `fine-wrinkle-${String(lines.length + 1).padStart(3, "0")}`,
      sourceComponentId: source.id,
      class: source.className,
      lengthPx: round(polylineLength(refined), 3),
      points: refined.map(([x, y]) => [round(x, 3), round(y, 3)]),
    });
    mark("resampleAndSmooth", stageStart);
  }

  stageStart = options.onProfile ? performance.now() : 0;
  lines = recoverForeheadEndpointDropouts(
    lines,
    options.sourceImageRgba,
    width,
    height,
  );
  mark("endpointRecovery", stageStart);
  const pixels = width * height;
  stageStart = options.onProfile ? performance.now() : 0;
  const effectiveClassMasks = Object.fromEntries(classes.map((name) => [
    name,
    normalizedBinaryCopy(classMasks?.[name], pixels),
  ]));
  for (const line of lines) {
    if (!(line.recoveredEndpointLengthPx && line.recoveredEndpointLengthPx > 0)) continue;
    rasterPolyline(line.points, (x, y) => {
      if (x >= 0 && y >= 0 && x < width && y < height) {
        effectiveClassMasks[line.class][y * width + x] = 1;
      }
    });
  }
  mark("effectiveMaskCopies", stageStart);
  stageStart = options.onProfile ? performance.now() : 0;
  const mask = new Uint8Array(pixels);
  const confidence = new Float32Array(pixels);
  const directionQ = new Float32Array(pixels * 2);
  const directionWeight = new Float32Array(pixels);
  const fineClassMasks = Object.fromEntries(classes.map((name) => [name, new Uint8Array(pixels)]));
  let renderedPixelsOutsideMask = 0;
  for (const line of lines) {
    for (let pointIndex = 1; pointIndex < line.points.length; pointIndex++) {
      const start = line.points[pointIndex - 1];
      const end = line.points[pointIndex];
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const squared = dx * dx + dy * dy;
      if (!(squared > 1e-8)) continue;
      const q0 = (dx * dx - dy * dy) / squared;
      const q1 = 2 * dx * dy / squared;
      rasterSegment(start, end, (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const index = y * width + x;
        if (!effectiveClassMasks[line.class]?.[index]) renderedPixelsOutsideMask++;
        mask[index] = 1;
        confidence[index] = 1;
        fineClassMasks[line.class][index] = 1;
        directionQ[index * 2] += q0;
        directionQ[index * 2 + 1] += q1;
        directionWeight[index] += 1;
      });
    }
  }
  mark("lineRasterization", stageStart);
  stageStart = options.onProfile ? performance.now() : 0;
  for (let index = 0; index < pixels; index++) {
    if (!(directionWeight[index] > 0)) continue;
    const q0 = directionQ[index * 2];
    const q1 = directionQ[index * 2 + 1];
    const length = Math.hypot(q0, q1);
    if (!(length > 1e-8)) continue;
    directionQ[index * 2] = q0 / length;
    directionQ[index * 2 + 1] = q1 / length;
  }
  mark("directionNormalization", stageStart);

  stageStart = options.onProfile ? performance.now() : 0;
  let filledTwoByTwoPixelBlocks = 0;
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const index = y * width + x;
    if (mask[index] && mask[index + 1] && mask[index + width] && mask[index + width + 1]) {
      filledTwoByTwoPixelBlocks++;
    }
  }
  const renderedLinePixels = mask.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  const minimumExtractedLength = lines.length ? Math.min(...lines.map((line) => line.lengthPx)) : 0;
  const recoveredForeheadEndpointCount = lines.filter((line) =>
    Number(line.recoveredEndpointLengthPx || 0) > 0).length;
  const checks = {
    allPointsInsideOwnSourceComponent: lines.every((line) => line.points.every((point) =>
      maskContains(effectiveClassMasks[line.class] || [], width, height, point))),
    noRenderedPixelsOutsideMask: renderedPixelsOutsideMask === 0,
    noShortLines: lines.every((line) => line.lengthPx >= minimumLineLengthPx),
    onePixelRasterStroke: filledTwoByTwoPixelBlocks <= recoveredForeheadEndpointCount,
    separateLineIds: new Set(lines.map((line) => line.id)).size === lines.length,
    separateRasterComponents: renderedComponentCount(mask, width, height) === lines.length,
    recoveredForeheadEndpointsImageSupported: lines.every((line) =>
      !line.recoveredEndpointLengthPx || Number(line.recoveredEndpointSupport || 0) >= 0.62),
  };
  const lineCountByClass = Object.fromEntries(classes.map((className) => [
    className,
    lines.filter((line) => line.class === className).length,
  ]));
  const lengthPxByClass = Object.fromEntries(classes.map((className) => [
    className,
    round(lines.filter((line) => line.class === className)
      .reduce((sum, line) => sum + line.lengthPx, 0), 3),
  ]));
  const validation = {
    passed: Object.values(checks).every(Boolean),
    checks,
    renderedLinePixels,
    renderedPixelsOutsideMask,
    filledTwoByTwoPixelBlocks,
    renderedConnectedComponents: renderedComponentCount(mask, width, height),
    minimumLineLengthPx: round(minimumExtractedLength, 3),
    recoveredForeheadEndpointsImageSupported:
      checks.recoveredForeheadEndpointsImageSupported,
  };
  mark("validation", stageStart);
  if (options.onProfile) {
    profile.total = performance.now() - profileStart;
    options.onProfile(profile);
  }
  return {
    schemaVersion: "langerface.wrinkle-fine-lines.v2",
    validated: false,
    purpose: "automatic_browser_fine_wrinkle_line_extraction_research_only",
    method: {
      componentIsolation: "8_connected_components_per_yolo_class_mask",
      skeletonization: "zhang_suen_thinning",
      branchHandling: "weighted_geodesic_longest_main_path",
      centerlineSmoothing: "nine_pixel_weighted_window_constrained_to_source_component",
      foreheadEndpointRecovery: "image_supported_dark_ridge_tracking",
      minimumLineLengthPx,
      resampleSpacingPx,
      rasterStrokeWidthPx: 1,
      rstlUsed: false,
    },
    summary: {
      sourceConnectedComponents: sourceComponents.length,
      fineLineCount: lines.length,
      rejectedShortComponentCount: rejectedComponents.length,
      lineCountByClass,
      totalLengthPx: round(lines.reduce((sum, line) => sum + line.lengthPx, 0), 3),
      lengthPxByClass,
      recoveredForeheadEndpointCount,
      recoveredForeheadEndpointLengthPx: round(lines.reduce((sum, line) =>
        sum + Number(line.recoveredEndpointLengthPx || 0), 0), 3),
    },
    validation,
    rejectedComponents,
    limitations: [
      "Centerlines are constrained by the current YOLO segmentation except for image-supported forehead endpoint dropout recovery.",
      "Only the longest main path of each connected detection is retained; genuine forks may be simplified.",
      "The extraction uses mask geometry and does not independently infer sub-mask image ridges.",
    ],
    lines,
    mask,
    confidence,
    directionQ,
    classMasks: fineClassMasks,
    rasterPixelCount: renderedLinePixels,
  };
}
