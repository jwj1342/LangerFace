export interface WrinkleTextureLine {
  id: string;
  className: string;
  points: Array<[number, number]>;
}

export interface WrinkleTextureFrame {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  gray: Uint8Array;
}

interface Match {
  dx: number;
  dy: number;
  score: number;
}

interface Control {
  index: number;
  dx: number;
  dy: number;
}

export interface WrinkleTextureTrackingDiagnostics {
  totalLineCount: number;
  correctedLineCount: number;
  totalControlCount: number;
  acceptedControlCount: number;
  meanCorrectionPx: number;
  maxCorrectionPx: number;
}

export interface WrinkleRidgeSnapDiagnostics {
  totalLineCount: number;
  snappedLineCount: number;
  totalPointCount: number;
  snappedPointCount: number;
  meanDisplacementPx: number;
  maxDisplacementPx: number;
}

export interface WrinkleRidgeSnapOptions {
  phase?: "initial" | "maintenance";
}

const EMPTY_DIAGNOSTICS: WrinkleTextureTrackingDiagnostics = {
  totalLineCount: 0,
  correctedLineCount: 0,
  totalControlCount: 0,
  acceptedControlCount: 0,
  meanCorrectionPx: 0,
  maxCorrectionPx: 0,
};

const MAX_TRACKING_WIDTH = 480;
const PATCH_RADIUS = 3;
const SEARCH_RADIUS = 4;
const MAX_CONTROLS_PER_LINE = 8;
const MIN_PATCH_STDDEV = 2.5;
const MIN_MATCH_SCORE = 0.68;
const MAX_FORWARD_BACKWARD_ERROR = 1.35;
const MAX_CONTROL_RESIDUAL = 2.75;
const RIDGE_SEARCH_RADIUS_BY_CLASS: Record<string, number> = {
  forehead: 8,
  frown: 7,
  wrinkle: 5,
};
const RIDGE_SHOULDER_DISTANCE = 2.25;
const MIN_RIDGE_RESPONSE = 1.8;
const MIN_RIDGE_IMPROVEMENT = 0.9;
// The tracking frame is capped at 480 px wide, so six pixels here correspond
// to roughly 16 source pixels on a 1280 px video. MediaPipe follows the face
// well, but fine forehead skin can still slide this far relative to its coarse
// mesh during expression changes.
const MAINTENANCE_RIDGE_SEARCH_RADIUS = 6;
const MAINTENANCE_MIN_RIDGE_IMPROVEMENT = 0.3;
const MIN_SNAPPED_POINT_FRACTION = 0.25;
const MAX_RIDGE_CONTROLS_PER_LINE = 28;

function cloneLines(lines: readonly WrinkleTextureLine[]): WrinkleTextureLine[] {
  return lines.map((line) => ({
    id: line.id,
    className: line.className,
    points: line.points.map(([x, y]) => [x, y]),
  }));
}

function lineNormal(
  points: readonly [number, number][],
  index: number,
  scaleX: number,
  scaleY: number,
): [number, number] | null {
  const span = Math.max(2, Math.round(points.length / MAX_RIDGE_CONTROLS_PER_LINE));
  const before = points[Math.max(0, index - span)];
  const after = points[Math.min(points.length - 1, index + span)];
  const dx = (after[0] - before[0]) * scaleX;
  const dy = (after[1] - before[1]) * scaleY;
  const length = Math.hypot(dx, dy);
  return length > 1e-4 ? [-dy / length, dx / length] : null;
}

function ridgeControlIndices(pointCount: number): number[] {
  if (pointCount <= MAX_RIDGE_CONTROLS_PER_LINE) {
    return Array.from({ length: pointCount }, (_item, index) => index);
  }
  return Array.from({ length: MAX_RIDGE_CONTROLS_PER_LINE }, (_item, index) => (
    Math.round(index * (pointCount - 1) / (MAX_RIDGE_CONTROLS_PER_LINE - 1))
  ));
}

function ridgeResponse(
  frame: WrinkleTextureFrame,
  x: number,
  y: number,
  normalX: number,
  normalY: number,
): number {
  const tangentX = -normalY;
  const tangentY = normalX;
  let center = 0;
  let negative = 0;
  let positive = 0;
  let count = 0;
  for (const tangentOffset of [-1, 0, 1]) {
    const tx = tangentX * tangentOffset;
    const ty = tangentY * tangentOffset;
    center += sampleGray(frame, x + tx, y + ty);
    negative += sampleGray(
      frame,
      x + tx - normalX * RIDGE_SHOULDER_DISTANCE,
      y + ty - normalY * RIDGE_SHOULDER_DISTANCE,
    );
    positive += sampleGray(
      frame,
      x + tx + normalX * RIDGE_SHOULDER_DISTANCE,
      y + ty + normalY * RIDGE_SHOULDER_DISTANCE,
    );
    count += 1;
  }
  center /= count;
  negative /= count;
  positive /= count;
  const negativeContrast = negative - center;
  const positiveContrast = positive - center;
  // A true dark crease has support on both sides; the asymmetry penalty keeps
  // the display line away from single edges such as eyebrows and eyelids.
  return Math.min(negativeContrast, positiveContrast)
    - Math.abs(negativeContrast - positiveContrast) * 0.2;
}

/**
 * Move only the display copy of a YOLO centerline onto a nearby dark crease.
 * Search is constrained to the local normal, requires bilateral bright
 * shoulders, and preserves every source line and point.
 */
export function snapWrinkleLinesToRidges(
  frame: WrinkleTextureFrame,
  lines: readonly WrinkleTextureLine[],
  options: WrinkleRidgeSnapOptions = {},
): {
  lines: WrinkleTextureLine[];
  diagnostics: WrinkleRidgeSnapDiagnostics;
  snappedLineIds: string[];
} {
  const maintenance = options.phase === "maintenance";
  const scaleX = frame.width / frame.sourceWidth;
  const scaleY = frame.height / frame.sourceHeight;
  let snappedLineCount = 0;
  let totalPointCount = 0;
  let snappedPointCount = 0;
  let displacementSum = 0;
  let maxDisplacementPx = 0;
  const snappedLineIds: string[] = [];

  const snapped = lines.map((line) => {
    totalPointCount += line.points.length;
    if (line.points.length < 2) return cloneLines([line])[0];
    const broadSearchRadius = RIDGE_SEARCH_RADIUS_BY_CLASS[line.className] ?? 5;
    const searchRadius = maintenance
      ? Math.min(broadSearchRadius, MAINTENANCE_RIDGE_SEARCH_RADIUS)
      : broadSearchRadius;
    const minimumImprovement = maintenance
      ? MAINTENANCE_MIN_RIDGE_IMPROVEMENT
      : MIN_RIDGE_IMPROVEMENT;
    const controlIndices = ridgeControlIndices(line.points.length);
    const rawControls = controlIndices.map((pointIndex): Control | null => {
      const point = line.points[pointIndex];
      const normal = lineNormal(line.points, pointIndex, scaleX, scaleY);
      if (!normal) return null;
      const x = point[0] * scaleX;
      const y = point[1] * scaleY;
      if (!inside(frame, x, y, searchRadius + RIDGE_SHOULDER_DISTANCE)) return null;
      const baseResponse = ridgeResponse(frame, x, y, normal[0], normal[1]);
      let bestOffset = 0;
      let bestResponse = baseResponse;
      for (let offset = -searchRadius; offset <= searchRadius; offset += 0.5) {
        const response = ridgeResponse(
          frame,
          x + normal[0] * offset,
          y + normal[1] * offset,
          normal[0],
          normal[1],
        );
        if (response > bestResponse) {
          bestResponse = response;
          bestOffset = offset;
        }
      }
      if (bestResponse < MIN_RIDGE_RESPONSE
          || bestResponse - baseResponse < minimumImprovement
          || Math.abs(bestOffset) < 0.4) {
        return null;
      }
      return { index: pointIndex, dx: bestOffset, dy: bestResponse };
    });
    const validControls = rawControls.filter((control): control is Control => control != null);
    const required = Math.max(2, Math.ceil(controlIndices.length * MIN_SNAPPED_POINT_FRACTION));
    if (validControls.length < required) return cloneLines([line])[0];

    const medianOffset = median(validControls.map((control) => control.dx));
    const coherentTolerance = maintenance ? 2.25 : 3.5;
    const coherentControls = validControls.filter((control) => (
      Math.abs(control.dx - medianOffset) <= coherentTolerance
    ));
    if (coherentControls.length < required) return cloneLines([line])[0];
    const stableLineOffset = maintenance
      ? median(coherentControls.map((control) => control.dx))
      : null;
    const smoothedControls = coherentControls.map((control, controlIndex) => {
      if (stableLineOffset != null) {
        return { index: control.index, dx: stableLineOffset, dy: 0 };
      }
      const local = coherentControls.slice(
        Math.max(0, controlIndex - 2),
        Math.min(coherentControls.length, controlIndex + 3),
      );
      return {
        index: control.index,
        dx: median(local.map((item) => item.dx)),
        dy: 0,
      };
    });
    const interpolated = interpolateControls(line.points.length, smoothedControls);
    const points = line.points.map(([x, y], index) => {
      const offset = interpolated[index]?.[0];
      const normal = lineNormal(line.points, index, scaleX, scaleY);
      if (offset == null || !normal) return [x, y] as [number, number];
      const dx = normal[0] * offset / scaleX;
      const dy = normal[1] * offset / scaleY;
      const displacement = Math.hypot(dx, dy);
      snappedPointCount += 1;
      displacementSum += displacement;
      maxDisplacementPx = Math.max(maxDisplacementPx, displacement);
      return [x + dx, y + dy] as [number, number];
    });
    snappedLineCount += 1;
    snappedLineIds.push(line.id);
    return { id: line.id, className: line.className, points };
  });

  return {
    lines: snapped,
    diagnostics: {
      totalLineCount: lines.length,
      snappedLineCount,
      totalPointCount,
      snappedPointCount,
      meanDisplacementPx: snappedPointCount ? displacementSum / snappedPointCount : 0,
      maxDisplacementPx,
    },
    snappedLineIds,
  };
}

function sampleIndices(pointCount: number): number[] {
  if (pointCount <= MAX_CONTROLS_PER_LINE) {
    return Array.from({ length: pointCount }, (_item, index) => index);
  }
  return Array.from({ length: MAX_CONTROLS_PER_LINE }, (_item, index) => (
    Math.round(index * (pointCount - 1) / (MAX_CONTROLS_PER_LINE - 1))
  ));
}

function inside(frame: WrinkleTextureFrame, x: number, y: number, margin = 0): boolean {
  const radius = PATCH_RADIUS + margin + 1;
  return x >= radius && y >= radius
    && x < frame.width - radius && y < frame.height - radius;
}

function sampleGray(frame: WrinkleTextureFrame, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const offset = y0 * frame.width + x0;
  const top = frame.gray[offset] * (1 - fx) + frame.gray[offset + 1] * fx;
  const bottom = frame.gray[offset + frame.width] * (1 - fx)
    + frame.gray[offset + frame.width + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function patchStats(frame: WrinkleTextureFrame, x: number, y: number): {
  mean: number;
  variance: number;
} {
  let sum = 0;
  let sumSquared = 0;
  let count = 0;
  for (let oy = -PATCH_RADIUS; oy <= PATCH_RADIUS; oy += 1) {
    for (let ox = -PATCH_RADIUS; ox <= PATCH_RADIUS; ox += 1) {
      const value = sampleGray(frame, x + ox, y + oy);
      sum += value;
      sumSquared += value * value;
      count += 1;
    }
  }
  const mean = sum / count;
  return { mean, variance: Math.max(0, sumSquared / count - mean * mean) };
}

function patchCorrelation(
  previous: WrinkleTextureFrame,
  current: WrinkleTextureFrame,
  previousX: number,
  previousY: number,
  currentX: number,
  currentY: number,
  previousMean: number,
  previousVariance: number,
): number {
  let currentSum = 0;
  let currentSquared = 0;
  let cross = 0;
  let count = 0;
  for (let oy = -PATCH_RADIUS; oy <= PATCH_RADIUS; oy += 1) {
    for (let ox = -PATCH_RADIUS; ox <= PATCH_RADIUS; ox += 1) {
      const a = sampleGray(previous, previousX + ox, previousY + oy) - previousMean;
      const b = sampleGray(current, currentX + ox, currentY + oy);
      currentSum += b;
      currentSquared += b * b;
      cross += a * b;
      count += 1;
    }
  }
  const currentVariance = Math.max(0,
    currentSquared / count - (currentSum / count) ** 2,
  );
  const denominator = count * Math.sqrt(previousVariance * currentVariance);
  return denominator > 1e-6 ? cross / denominator : -1;
}

function refineSubpixel(
  center: number,
  negative: number,
  positive: number,
): number {
  const denominator = negative - 2 * center + positive;
  if (Math.abs(denominator) < 1e-6) return 0;
  return Math.max(-0.5, Math.min(0.5, 0.5 * (negative - positive) / denominator));
}

function findMatch(
  previous: WrinkleTextureFrame,
  current: WrinkleTextureFrame,
  previousPoint: [number, number],
  expectedPoint: [number, number],
): Match | null {
  if (!inside(previous, previousPoint[0], previousPoint[1])
      || !inside(current, expectedPoint[0], expectedPoint[1], SEARCH_RADIUS)) {
    return null;
  }
  const stats = patchStats(previous, previousPoint[0], previousPoint[1]);
  if (Math.sqrt(stats.variance) < MIN_PATCH_STDDEV) return null;

  let bestDx = 0;
  let bestDy = 0;
  let bestScore = -1;
  for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy += 1) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx += 1) {
      const score = patchCorrelation(
        previous,
        current,
        previousPoint[0],
        previousPoint[1],
        expectedPoint[0] + dx,
        expectedPoint[1] + dy,
        stats.mean,
        stats.variance,
      );
      if (score > bestScore) {
        bestScore = score;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  if (bestScore < MIN_MATCH_SCORE) return null;

  let subpixelX = 0;
  let subpixelY = 0;
  if (bestDx > -SEARCH_RADIUS && bestDx < SEARCH_RADIUS) {
    const negative = patchCorrelation(
      previous, current, previousPoint[0], previousPoint[1],
      expectedPoint[0] + bestDx - 1, expectedPoint[1] + bestDy,
      stats.mean, stats.variance,
    );
    const positive = patchCorrelation(
      previous, current, previousPoint[0], previousPoint[1],
      expectedPoint[0] + bestDx + 1, expectedPoint[1] + bestDy,
      stats.mean, stats.variance,
    );
    subpixelX = refineSubpixel(bestScore, negative, positive);
  }
  if (bestDy > -SEARCH_RADIUS && bestDy < SEARCH_RADIUS) {
    const negative = patchCorrelation(
      previous, current, previousPoint[0], previousPoint[1],
      expectedPoint[0] + bestDx, expectedPoint[1] + bestDy - 1,
      stats.mean, stats.variance,
    );
    const positive = patchCorrelation(
      previous, current, previousPoint[0], previousPoint[1],
      expectedPoint[0] + bestDx, expectedPoint[1] + bestDy + 1,
      stats.mean, stats.variance,
    );
    subpixelY = refineSubpixel(bestScore, negative, positive);
  }
  return { dx: bestDx + subpixelX, dy: bestDy + subpixelY, score: bestScore };
}

function forwardBackwardMatch(
  previous: WrinkleTextureFrame,
  current: WrinkleTextureFrame,
  previousPoint: [number, number],
  expectedPoint: [number, number],
): Match | null {
  const forward = findMatch(previous, current, previousPoint, expectedPoint);
  if (!forward) return null;
  const currentPoint: [number, number] = [
    expectedPoint[0] + forward.dx,
    expectedPoint[1] + forward.dy,
  ];
  const backward = findMatch(current, previous, currentPoint, previousPoint);
  if (!backward || Math.hypot(backward.dx, backward.dy) > MAX_FORWARD_BACKWARD_ERROR) {
    return null;
  }
  return forward;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stableControls(controls: Control[], required: number): Control[] {
  if (controls.length < required) return [];
  const medianDx = median(controls.map((control) => control.dx));
  const medianDy = median(controls.map((control) => control.dy));
  const stable = controls.filter((control) => Math.hypot(
    control.dx - medianDx,
    control.dy - medianDy,
  ) <= MAX_CONTROL_RESIDUAL);
  return stable.length >= required ? stable : [];
}

function interpolateControls(pointCount: number, controls: readonly Control[]): Array<[number, number]> {
  const output: Array<[number, number]> = [];
  let right = 0;
  for (let index = 0; index < pointCount; index += 1) {
    while (right < controls.length - 1 && controls[right].index < index) right += 1;
    const after = controls[right];
    const before = right > 0 ? controls[right - 1] : after;
    if (before.index === after.index) {
      output.push([before.dx, before.dy]);
      continue;
    }
    const weight = Math.max(0, Math.min(1,
      (index - before.index) / (after.index - before.index),
    ));
    output.push([
      before.dx + (after.dx - before.dx) * weight,
      before.dy + (after.dy - before.dy) * weight,
    ]);
  }
  return output;
}

export class WrinkleTextureTracker {
  private previousFrame: WrinkleTextureFrame | null = null;
  private previousLines: WrinkleTextureLine[] = [];
  private revision = -1;
  private lastDiagnostics: WrinkleTextureTrackingDiagnostics = { ...EMPTY_DIAGNOSTICS };

  reset(): void {
    this.previousFrame = null;
    this.previousLines = [];
    this.revision = -1;
    this.lastDiagnostics = { ...EMPTY_DIAGNOSTICS };
  }

  seed(
    frame: WrinkleTextureFrame,
    detectedLines: readonly WrinkleTextureLine[],
    revision: number,
  ): void {
    this.previousFrame = frame;
    this.previousLines = cloneLines(detectedLines);
    this.revision = revision;
    this.lastDiagnostics = {
      ...EMPTY_DIAGNOSTICS,
      totalLineCount: detectedLines.length,
    };
  }

  diagnostics(): WrinkleTextureTrackingDiagnostics {
    return { ...this.lastDiagnostics };
  }

  commitDisplayFrame(
    frame: WrinkleTextureFrame,
    displayLines: readonly WrinkleTextureLine[],
    revision: number,
  ): void {
    this.previousFrame = frame;
    this.previousLines = cloneLines(displayLines);
    this.revision = revision;
  }

  update(
    frame: WrinkleTextureFrame,
    meshLines: readonly WrinkleTextureLine[],
    revision: number,
  ): WrinkleTextureLine[] {
    const base = cloneLines(meshLines);
    const compatible = revision === this.revision
      && this.previousFrame?.width === frame.width
      && this.previousFrame?.height === frame.height
      && this.previousLines.length === base.length
      && this.previousLines.every((line, index) => (
        line.id === base[index].id && line.points.length === base[index].points.length
      ));
    if (!compatible || !this.previousFrame) {
      this.seed(frame, base, revision);
      return base;
    }

    let correctedLineCount = 0;
    let totalControlCount = 0;
    let acceptedControlCount = 0;
    let correctionSum = 0;
    let correctionCount = 0;
    let maxCorrectionPx = 0;
    const currentScaleX = frame.width / frame.sourceWidth;
    const currentScaleY = frame.height / frame.sourceHeight;
    const previousScaleX = this.previousFrame.width / this.previousFrame.sourceWidth;
    const previousScaleY = this.previousFrame.height / this.previousFrame.sourceHeight;
    const tracked = base.map((line, lineIndex) => {
      const indices = sampleIndices(line.points.length);
      totalControlCount += indices.length;
      const controls = indices.flatMap((pointIndex) => {
        const previousPoint = this.previousLines[lineIndex].points[pointIndex];
        const meshPoint = line.points[pointIndex];
        const match = forwardBackwardMatch(
          this.previousFrame as WrinkleTextureFrame,
          frame,
          [previousPoint[0] * previousScaleX, previousPoint[1] * previousScaleY],
          [meshPoint[0] * currentScaleX, meshPoint[1] * currentScaleY],
        );
        if (!match) return [];
        return [{
          index: pointIndex,
          dx: match.dx / currentScaleX,
          dy: match.dy / currentScaleY,
        }];
      });
      const required = Math.min(indices.length, Math.max(2, Math.ceil(indices.length * 0.35)));
      const stable = stableControls(controls, required);
      if (!stable.length) return line;
      correctedLineCount += 1;
      acceptedControlCount += stable.length;
      const corrections = interpolateControls(line.points.length, stable);
      for (const [dx, dy] of corrections) {
        const magnitude = Math.hypot(dx, dy);
        correctionSum += magnitude;
        correctionCount += 1;
        maxCorrectionPx = Math.max(maxCorrectionPx, magnitude);
      }
      return {
        id: line.id,
        className: line.className,
        points: line.points.map(([x, y], pointIndex) => [
          x + corrections[pointIndex][0],
          y + corrections[pointIndex][1],
        ] as [number, number]),
      };
    });
    this.previousFrame = frame;
    this.previousLines = tracked;
    this.lastDiagnostics = {
      totalLineCount: base.length,
      correctedLineCount,
      totalControlCount,
      acceptedControlCount,
      meanCorrectionPx: correctionCount ? correctionSum / correctionCount : 0,
      maxCorrectionPx,
    };
    return tracked;
  }
}

export function buildWrinkleTextureFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  sourceWidth = width,
  sourceHeight = height,
  destination?: Uint8Array,
): WrinkleTextureFrame {
  const gray = destination?.length === width * height ? destination : new Uint8Array(width * height);
  for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
    // Byte inputs give a nonnegative sum <=255; exhaustive RGB parity covers rounding boundaries.
    gray[pixel] = (rgba[index] * 0.299 + rgba[index + 1] * 0.587 + rgba[index + 2] * 0.114 + 0.5) | 0;
  }
  return { width, height, sourceWidth, sourceHeight, gray };
}

export function captureWrinkleTextureFrame(
  source: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
  maximumWidth = MAX_TRACKING_WIDTH,
  timings?: Record<string, number>,
  destination?: Uint8Array,
): WrinkleTextureFrame | null {
  if (!source.width || !source.height) return null;
  const scale = Math.min(1, maximumWidth / source.width);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  try {
    const start = timings ? performance.now() : 0;
    context.drawImage(source, 0, 0, width, height);
    const readStart = timings ? performance.now() : 0;
    const image = context.getImageData(0, 0, width, height);
    const grayStart = timings ? performance.now() : 0;
    const frame = buildWrinkleTextureFrame(image.data, width, height, source.width, source.height, destination);
    if (timings) {
      timings.textureDraw = readStart - start;
      timings.textureRead = grayStart - readStart;
      timings.textureGray = performance.now() - grayStart;
    }
    return frame;
  } catch {
    return null;
  }
}
