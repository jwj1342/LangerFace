export interface TemporalWrinkleLine {
  id: string;
  className: string;
  points: Array<[number, number]>;
}

export interface TemporalWrinkleStabilizerOptions {
  previousShapeWeight?: number;
  maximumMatchDistanceFraction?: number;
}

function centroid(points: readonly [number, number][]): [number, number] {
  if (!points.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / points.length, y / points.length];
}

function pointAtFraction(
  points: readonly [number, number][],
  fraction: number,
): [number, number] {
  if (!points.length) return [0, 0];
  if (points.length === 1) return [...points[0]];
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    ));
  }
  const total = lengths.at(-1) || 0;
  if (total <= 1e-6) return [...points[0]];
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let right = 1;
  while (right < lengths.length - 1 && lengths[right] < target) right += 1;
  const left = right - 1;
  const segment = Math.max(1e-6, lengths[right] - lengths[left]);
  const amount = (target - lengths[left]) / segment;
  return [
    points[left][0] + (points[right][0] - points[left][0]) * amount,
    points[left][1] + (points[right][1] - points[left][1]) * amount,
  ];
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Stabilizes only the local shape of fresh detections. The current detection
 * owns line presence and global position, so history cannot resurrect a line
 * or make coherent head motion lag behind.
 */
export class TemporalWrinkleStabilizer {
  private previous: TemporalWrinkleLine[] = [];
  private readonly previousShapeWeight: number;
  private readonly maximumMatchDistanceFraction: number;

  constructor(options: TemporalWrinkleStabilizerOptions = {}) {
    this.previousShapeWeight = options.previousShapeWeight ?? 0.35;
    this.maximumMatchDistanceFraction = options.maximumMatchDistanceFraction ?? 0.12;
  }

  reset(): void {
    this.previous = [];
  }

  update(
    current: readonly TemporalWrinkleLine[],
    faceWidthPx: number,
  ): TemporalWrinkleLine[] {
    const maximumDistance = Math.max(6, faceWidthPx * this.maximumMatchDistanceFraction);
    const available = new Set(this.previous.map((_line, index) => index));
    const output = current.map((line) => {
      const currentCenter = centroid(line.points);
      let matchIndex = -1;
      let matchDistance = Number.POSITIVE_INFINITY;
      for (const index of available) {
        const candidate = this.previous[index];
        if (candidate.className !== line.className) continue;
        const candidateDistance = distance(currentCenter, centroid(candidate.points));
        if (candidateDistance < matchDistance) {
          matchIndex = index;
          matchDistance = candidateDistance;
        }
      }
      if (matchIndex < 0 || matchDistance > maximumDistance || line.points.length < 2) {
        return {
          ...line,
          points: line.points.map((point) => [point[0], point[1]] as [number, number]),
        };
      }

      available.delete(matchIndex);
      const previous = this.previous[matchIndex];
      const previousCenter = centroid(previous.points);
      const lastPoint = Math.max(1, line.points.length - 1);
      const points = line.points.map((point, index) => {
        const oldPoint = pointAtFraction(previous.points, index / lastPoint);
        const oldLocalX = oldPoint[0] - previousCenter[0];
        const oldLocalY = oldPoint[1] - previousCenter[1];
        const currentLocalX = point[0] - currentCenter[0];
        const currentLocalY = point[1] - currentCenter[1];
        return [
          currentCenter[0] + currentLocalX * (1 - this.previousShapeWeight)
            + oldLocalX * this.previousShapeWeight,
          currentCenter[1] + currentLocalY * (1 - this.previousShapeWeight)
            + oldLocalY * this.previousShapeWeight,
        ] as [number, number];
      });
      return { ...line, id: previous.id, points };
    });
    this.previous = output.map((line) => ({
      ...line,
      points: line.points.map((point) => [point[0], point[1]] as [number, number]),
    }));
    return output;
  }
}
