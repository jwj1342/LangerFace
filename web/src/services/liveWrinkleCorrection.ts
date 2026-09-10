export interface WrinkleCorrectionLine {
  className: string;
  points: ReadonlyArray<readonly [number, number]>;
}

export interface WrinkleCorrectionGateInput {
  current: readonly WrinkleCorrectionLine[];
  candidate: readonly WrinkleCorrectionLine[];
  faceWidthPx: number;
  yoloScores: readonly number[];
  yoloConfidenceThreshold: number;
}

export interface WrinkleCorrectionGateResult {
  accepted: boolean;
  reason: "accepted" | "empty" | "count-change" | "low-yolo-confidence" |
    "class-mismatch" | "spatial-mismatch" | "low-combined-confidence";
  confidence: number;
  yoloConfidence: number;
  countSimilarity: number;
  classAgreement: number;
  spatialAgreement: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function sampledPoints(line: WrinkleCorrectionLine): ReadonlyArray<readonly [number, number]> {
  if (line.points.length <= 16) return line.points;
  return Array.from({ length: 16 }, (_, index) => (
    line.points[Math.round(index * (line.points.length - 1) / 15)]
  ));
}

function directedLineDistance(a: WrinkleCorrectionLine, b: WrinkleCorrectionLine): number {
  const from = sampledPoints(a);
  const to = sampledPoints(b);
  if (!from.length || !to.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (const [x, y] of from) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const [xx, yy] of to) nearest = Math.min(nearest, Math.hypot(x - xx, y - yy));
    total += nearest;
  }
  return total / from.length;
}

function lineDistance(a: WrinkleCorrectionLine, b: WrinkleCorrectionLine): number {
  return Math.max(directedLineDistance(a, b), directedLineDistance(b, a));
}

function matchingFraction(
  from: readonly WrinkleCorrectionLine[],
  to: readonly WrinkleCorrectionLine[],
  maximumDistance: number,
): number {
  let matched = 0;
  for (const line of from) {
    const nearest = to.reduce((distance, candidate) => (
      candidate.className === line.className
        ? Math.min(distance, lineDistance(line, candidate))
        : distance
    ), Number.POSITIVE_INFINITY);
    if (nearest <= maximumDistance) matched += 1;
  }
  return matched / Math.max(1, from.length);
}

function classAgreement(
  current: readonly WrinkleCorrectionLine[],
  candidate: readonly WrinkleCorrectionLine[],
): number {
  const counts = (lines: readonly WrinkleCorrectionLine[]) => {
    const result = new Map<string, number>();
    for (const line of lines) result.set(line.className, (result.get(line.className) || 0) + 1);
    return result;
  };
  const a = counts(current);
  const b = counts(candidate);
  const shared = [...new Set([...a.keys(), ...b.keys()])]
    .reduce((sum, name) => sum + Math.min(a.get(name) || 0, b.get(name) || 0), 0);
  return shared / Math.max(current.length, candidate.length, 1);
}

export function evaluateWrinkleCorrection(
  input: WrinkleCorrectionGateInput,
): WrinkleCorrectionGateResult {
  const { current, candidate } = input;
  const empty = !current.length || !candidate.length
    || current.some((line) => line.points.length < 2)
    || candidate.some((line) => line.points.length < 2);
  const countSimilarity = Math.min(current.length, candidate.length)
    / Math.max(current.length, candidate.length, 1);
  const classes = classAgreement(current, candidate);
  const maximumDistance = Math.max(8, input.faceWidthPx * 0.075);
  const spatial = empty ? 0 : Math.min(
    matchingFraction(current, candidate, maximumDistance),
    matchingFraction(candidate, current, maximumDistance),
  );
  const scores = input.yoloScores.filter((score) => Number.isFinite(score));
  const meanScore = scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length);
  const threshold = Math.max(0, input.yoloConfidenceThreshold);
  const yoloConfidence = scores.length
    ? clamp01((meanScore - threshold) / Math.max(0.08, 0.30 - threshold))
    : 0;
  const confidence = clamp01(
    0.48 * spatial + 0.22 * countSimilarity + 0.18 * classes + 0.12 * yoloConfidence,
  );

  let reason: WrinkleCorrectionGateResult["reason"] = "accepted";
  if (empty) reason = "empty";
  else if (countSimilarity < 0.45) reason = "count-change";
  else if (!scores.length || meanScore < threshold + 0.005) reason = "low-yolo-confidence";
  else if (classes < 0.45) reason = "class-mismatch";
  else if (spatial < 0.45) reason = "spatial-mismatch";
  else if (confidence < 0.58) reason = "low-combined-confidence";

  return {
    accepted: reason === "accepted",
    reason,
    confidence,
    yoloConfidence,
    countSimilarity,
    classAgreement: classes,
    spatialAgreement: spatial,
  };
}
