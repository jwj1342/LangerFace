import type { V6Seed } from "./v6RstlRefinementV9.ts";

type Point2 = [number, number];

export interface ScopedYoloGuidedCurve {
  name?: string;
  region?: string;
  pts: ArrayLike<number>[];
}

export interface YoloGuidedGlobalGuardResult {
  curves: Array<{ name: string; region: string; pts: Point2[]; hiddenPointRuns: [] }>;
  rolledBackCurveIndices: number[];
  newIntersectionPairCount: number;
  newSelfCrossCurveCount: number;
}

export const YOLO_GUIDED_RSTL_SCOPE = "yolo_forehead_and_glabellar_only";

export function isYoloGuidedForeheadSeed(seed: Pick<V6Seed, "region">): boolean {
  return String(seed.region || "").includes("forehead");
}

export function isYoloGuidedGlabellarSeed(seed: Pick<V6Seed, "region">): boolean {
  return String(seed.region || "") === "orbital_brow_upturn_v11";
}

export function isYoloGuidedRstlSeed(seed: Pick<V6Seed, "region">): boolean {
  return isYoloGuidedForeheadSeed(seed) || isYoloGuidedGlabellarSeed(seed);
}

export function mergeYoloGuidedRstlCurves(
  seeds: V6Seed[],
  scopedCurves: ScopedYoloGuidedCurve[],
): Array<{ name: string; region: string; pts: Point2[]; hiddenPointRuns: [] }> {
  const eligibleIndices = seeds
    .map((seed, index) => isYoloGuidedRstlSeed(seed) ? index : -1)
    .filter((index) => index >= 0);
  if (scopedCurves.length !== eligibleIndices.length) {
    throw new Error("额头与眉间 RSTL 微调结果数量与输入不一致");
  }
  const refinedByOriginalIndex = new Map(eligibleIndices.map((index, scopedIndex) => [
    index,
    scopedCurves[scopedIndex],
  ]));
  return seeds.map((seed, index) => {
    const refined = refinedByOriginalIndex.get(index);
    const sourcePoints = Array.isArray(seed.pts) ? seed.pts : [];
    const points = refined?.pts || sourcePoints;
    return {
      name: String(seed.name || `rstl-${index + 1}`),
      region: String(seed.region || ""),
      pts: Array.from(points, (point) => [Number(point[0]), Number(point[1])] as Point2),
      hiddenPointRuns: [],
    };
  });
}

const orientation = (a: Point2, b: Point2, c: Point2): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const first = orientation(a, b, c), second = orientation(a, b, d);
  const third = orientation(c, d, a), fourth = orientation(c, d, b);
  return first * second < -1e-7 && third * fourth < -1e-7;
}

function curvesCross(first: Point2[], second: Point2[]): boolean {
  for (let firstIndex = 1; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 1; secondIndex < second.length; secondIndex += 1) {
      if (segmentsCross(
        first[firstIndex - 1], first[firstIndex],
        second[secondIndex - 1], second[secondIndex],
      )) return true;
    }
  }
  return false;
}

function selfCrosses(points: Point2[]): boolean {
  for (let first = 1; first < points.length; first += 1) {
    for (let second = first + 2; second < points.length; second += 1) {
      if (segmentsCross(
        points[first - 1], points[first], points[second - 1], points[second],
      )) return true;
    }
  }
  return false;
}

function intersectionPairs(curves: Array<{ pts: Point2[] }>): Set<string> {
  const pairs = new Set<string>();
  for (let first = 0; first < curves.length; first += 1) {
    for (let second = first + 1; second < curves.length; second += 1) {
      if (curvesCross(curves[first].pts, curves[second].pts)) {
        pairs.add(`${first}:${second}`);
      }
    }
  }
  return pairs;
}

/**
 * Recheck the merged result against every original RSTL curve. The per-channel
 * refiners cannot see crossings between forehead, glabellar and untouched
 * curves, so any changed curve involved in a newly introduced crossing is
 * conservatively restored to its baseline geometry.
 */
export function guardMergedYoloGuidedRstlCurves(
  seeds: V6Seed[],
  mergedCurves: ScopedYoloGuidedCurve[],
): YoloGuidedGlobalGuardResult {
  if (seeds.length !== mergedCurves.length) {
    throw new Error("全局交叉检查的 RSTL 数量与输入不一致");
  }
  const seedPoints = (seed: V6Seed): Point2[] => {
    const points = Array.isArray(seed.pts) ? seed.pts : [];
    return points.filter((point): point is ArrayLike<number> =>
      Array.isArray(point) || ArrayBuffer.isView(point)).map((point) =>
      [Number(point[0]), Number(point[1])]);
  };
  const baseline = seeds.map((seed) => ({
    name: String(seed.name || ""),
    region: String(seed.region || ""),
    pts: seedPoints(seed),
    hiddenPointRuns: [] as [],
  }));
  const curves = mergedCurves.map((curve, index) => ({
    name: String(curve.name || baseline[index].name),
    region: String(curve.region || baseline[index].region),
    pts: Array.from(curve.pts || [], (point) => [Number(point[0]), Number(point[1])] as Point2),
    hiddenPointRuns: [] as [],
  }));
  const changed = new Set(curves.map((curve, index) =>
    JSON.stringify(curve.pts) === JSON.stringify(baseline[index].pts) ? -1 : index)
    .filter((index) => index >= 0));
  const baselinePairs = intersectionPairs(baseline);
  const baselineSelf = baseline.map((curve) => selfCrosses(curve.pts));
  const rolledBack = new Set<number>();
  const rollback = (index: number): void => {
    curves[index] = {
      ...baseline[index],
      pts: baseline[index].pts.map((point) => [...point] as Point2),
    };
    changed.delete(index);
    rolledBack.add(index);
  };
  for (const index of [...changed]) {
    if (!baselineSelf[index] && selfCrosses(curves[index].pts)) rollback(index);
  }
  let repeat = true;
  while (repeat) {
    repeat = false;
    const newPairs = [...intersectionPairs(curves)].filter((pair) => !baselinePairs.has(pair));
    for (const pair of newPairs) {
      const [first, second] = pair.split(":").map(Number);
      const targets = [first, second].filter((index) => changed.has(index));
      if (!targets.length) continue;
      targets.forEach(rollback);
      repeat = true;
      break;
    }
  }
  const finalPairs = intersectionPairs(curves);
  return {
    curves,
    rolledBackCurveIndices: [...rolledBack].sort((left, right) => left - right),
    newIntersectionPairCount: [...finalPairs].filter((pair) => !baselinePairs.has(pair)).length,
    newSelfCrossCurveCount: curves.filter((curve, index) =>
      !baselineSelf[index] && selfCrosses(curve.pts)).length,
  };
}
