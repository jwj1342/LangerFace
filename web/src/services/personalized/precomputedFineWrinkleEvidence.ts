import { YOLO_WRINKLE_CLASSES } from "./yoloWrinkleOnnx.ts";

type Point2 = [number, number];

export interface PrecomputedFineWrinkleLine {
  id: string;
  class: string;
  points: Point2[];
}

export interface PrecomputedFineWrinklePayload {
  schemaVersion?: unknown;
  source?: {
    imageSha256?: unknown;
    width?: unknown;
    height?: unknown;
  };
  summary?: Record<string, unknown>;
  lines?: unknown[];
}

export interface PrecomputedFineWrinkleEvidence {
  mask: Uint8Array;
  confidence: Float32Array;
  directionQ: Float32Array;
  classMasks: Record<string, Uint8Array>;
  lines: PrecomputedFineWrinkleLine[];
  summary: Record<string, unknown>;
  rasterPixelCount: number;
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
    const doubled = 2 * error;
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

function parseLines(lines: unknown[]): PrecomputedFineWrinkleLine[] {
  return lines.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const line = value as { id?: unknown; class?: unknown; points?: unknown };
    if (typeof line.class !== "string" || !YOLO_WRINKLE_CLASSES.includes(line.class)) return [];
    if (!Array.isArray(line.points) || line.points.length < 2) return [];
    const points = line.points.flatMap((point) => (
      Array.isArray(point) && point.length >= 2
        && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
        ? [[Number(point[0]), Number(point[1])] as Point2]
        : []
    ));
    if (points.length < 2) return [];
    return [{
      id: typeof line.id === "string" ? line.id : `precomputed-${index + 1}`,
      class: line.class,
      points,
    }];
  });
}

export function buildPrecomputedFineWrinkleEvidence(
  payload: PrecomputedFineWrinklePayload,
  size: number,
  expectedImageSha256: string,
): PrecomputedFineWrinkleEvidence {
  if (!Number.isInteger(size) || size <= 0) throw new TypeError("Fine wrinkle evidence size must be positive");
  if (payload?.schemaVersion !== "langerface.wrinkle-fine-lines.v1" || !Array.isArray(payload.lines)) {
    throw new Error("Precomputed fine wrinkle evidence has an invalid schema");
  }
  if (String(payload.source?.imageSha256 || "").toLowerCase() !== expectedImageSha256.toLowerCase()) {
    throw new Error("Precomputed fine wrinkle evidence belongs to a different image");
  }
  if (Number(payload.source?.width) !== size || Number(payload.source?.height) !== size) {
    throw new Error("Precomputed fine wrinkle evidence uses a different working coordinate size");
  }
  const lines = parseLines(payload.lines);
  if (!lines.length || lines.length !== payload.lines.length) {
    throw new Error("Precomputed fine wrinkle evidence contains invalid lines");
  }

  const pixels = size * size;
  const mask = new Uint8Array(pixels);
  const confidence = new Float32Array(pixels);
  const directionQ = new Float32Array(pixels * 2);
  const directionWeight = new Float32Array(pixels);
  const classMasks = Object.fromEntries(
    YOLO_WRINKLE_CLASSES.map((name) => [name, new Uint8Array(pixels)]),
  );
  for (const line of lines) {
    for (let pointIndex = 0; pointIndex < line.points.length - 1; pointIndex += 1) {
      const start = line.points[pointIndex];
      const end = line.points[pointIndex + 1];
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const squared = dx * dx + dy * dy;
      if (!(squared > 1e-8)) continue;
      const q0 = (dx * dx - dy * dy) / squared;
      const q1 = 2 * dx * dy / squared;
      rasterSegment(start, end, (x, y) => {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        const pixelIndex = y * size + x;
        mask[pixelIndex] = 1;
        confidence[pixelIndex] = 1;
        classMasks[line.class][pixelIndex] = 1;
        directionQ[pixelIndex * 2] += q0;
        directionQ[pixelIndex * 2 + 1] += q1;
        directionWeight[pixelIndex] += 1;
      });
    }
  }
  for (let pixelIndex = 0; pixelIndex < pixels; pixelIndex += 1) {
    if (!(directionWeight[pixelIndex] > 0)) continue;
    const q0 = directionQ[pixelIndex * 2];
    const q1 = directionQ[pixelIndex * 2 + 1];
    const length = Math.hypot(q0, q1);
    if (!(length > 1e-8)) continue;
    directionQ[pixelIndex * 2] = q0 / length;
    directionQ[pixelIndex * 2 + 1] = q1 / length;
  }
  return {
    mask,
    confidence,
    directionQ,
    classMasks,
    lines,
    summary: payload.summary || {},
    rasterPixelCount: mask.reduce((sum, value) => sum + (value ? 1 : 0), 0),
  };
}
