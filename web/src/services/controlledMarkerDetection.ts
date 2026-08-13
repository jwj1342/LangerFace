export const CONTROLLED_MARKER_DETECTOR_VERSION = "0.2";

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
  | "low_contrast";

export interface ControlledMarkerDetection {
  ok: boolean;
  failure_code: ControlledMarkerFailureCode | null;
  center: MarkerPoint | null;
  boundary: MarkerPoint[];
  area_px: number;
  bbox: { x: number; y: number; width: number; height: number } | null;
  confidence: number;
  candidate_count: number;
  warnings: string[];
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

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const luma = (data: ArrayLike<number>, index: number): number => (
  0.2126 * Number(data[index]) + 0.7152 * Number(data[index + 1]) + 0.0722 * Number(data[index + 2])
);

function failure(code: ControlledMarkerFailureCode): ControlledMarkerDetection {
  return {
    ok: false,
    failure_code: code,
    center: null,
    boundary: [],
    area_px: 0,
    bbox: null,
    confidence: 0,
    candidate_count: 0,
    warnings: [code],
    audit: { local_only: true, raw_media_retained: false, network_request_made: false },
  };
}

function convexHull(points: MarkerPoint[]): MarkerPoint[] {
  if (points.length <= 3) return points.map((point) => ({ ...point }));
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: MarkerPoint, a: MarkerPoint, b: MarkerPoint) => (
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  );
  const lower: MarkerPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: MarkerPoint[] = [];
  for (const point of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function sampleBoundary(points: MarkerPoint[], maxPoints = 24): MarkerPoint[] {
  const hull = convexHull(points);
  if (hull.length <= maxPoints) return hull;
  return Array.from({ length: maxPoints }, (_, index) => hull[Math.floor(index * hull.length / maxPoints)]);
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

export function detectControlledMarker(
  image: MarkerImageData,
  seed: MarkerPoint,
  {
    roiRadius = 56,
    seedSnapRadius = 10,
    minAreaPx = 9,
    maxAreaFraction = 0.25,
    minContrast = 18,
  }: {
    roiRadius?: number;
    seedSnapRadius?: number;
    minAreaPx?: number;
    maxAreaFraction?: number;
    minContrast?: number;
  } = {},
): ControlledMarkerDetection {
  const width = Math.floor(image.width);
  const height = Math.floor(image.height);
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
  const backgroundLuma = roiLumas.reduce((sum, value) => sum + value, 0) / roiLumas.length;
  const darkThreshold = Math.min(120, backgroundLuma - minContrast);
  const dark = new Uint8Array(roiWidth * roiHeight);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (luma(image.data, (y * width + x) * 4) <= darkThreshold) dark[(y - y0) * roiWidth + x - x0] = 1;
    }
  }

  const visited = new Uint8Array(dark.length);
  const components: PixelComponent[] = [];
  for (let localY = 0; localY < roiHeight; localY += 1) {
    for (let localX = 0; localX < roiWidth; localX += 1) {
      const start = localY * roiWidth + localX;
      if (!dark[start] || visited[start]) continue;
      const queue = [start];
      const pixels: MarkerPoint[] = [];
      let totalLuma = 0;
      visited[start] = 1;
      for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head];
        const cx = current % roiWidth;
        const cy = Math.floor(current / roiWidth);
        const x = x0 + cx;
        const y = y0 + cy;
        pixels.push({ x, y });
        totalLuma += luma(image.data, (y * width + x) * 4);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= roiWidth || ny < 0 || ny >= roiHeight) continue;
            const next = ny * roiWidth + nx;
            if (dark[next] && !visited[next]) {
              visited[next] = 1;
              queue.push(next);
            }
          }
        }
      }
      components.push({ pixels, meanLuma: totalLuma / pixels.length });
    }
  }

  const candidates = components.filter((component) => component.pixels.length >= minAreaPx);
  const selected = candidates
    .map((component) => ({
      component,
      containsSeed: pointInPolygon(seed, convexHull(component.pixels)),
      distance: Math.min(...component.pixels.map((point) => Math.hypot(point.x - seed.x, point.y - seed.y))),
    }))
    .filter((entry) => entry.containsSeed || entry.distance <= seedSnapRadius)
    .sort((a, b) => Number(b.containsSeed) - Number(a.containsSeed)
      || a.distance - b.distance
      || b.component.pixels.length - a.component.pixels.length)[0]?.component;
  if (!selected) return failure(components.length ? "component_too_small" : "no_dark_component");
  const maxArea = roiWidth * roiHeight * maxAreaFraction;
  if (selected.pixels.length > maxArea) return failure("component_too_large");
  const contrast = backgroundLuma - selected.meanLuma;
  if (contrast < minContrast) return failure("low_contrast");

  const xs = selected.pixels.map((point) => point.x);
  const ys = selected.pixels.map((point) => point.y);
  const center = {
    x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
  };
  const warnings = candidates.length > 1 ? ["multiple_candidates_in_roi"] : [];
  return {
    ok: true,
    failure_code: null,
    center,
    boundary: sampleBoundary(selected.pixels),
    area_px: selected.pixels.length,
    bbox: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs) + 1,
      height: Math.max(...ys) - Math.min(...ys) + 1,
    },
    confidence: clamp(contrast / 96, 0, 1),
    candidate_count: candidates.length,
    warnings,
    audit: { local_only: true, raw_media_retained: false, network_request_made: false },
  };
}
