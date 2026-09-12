import type { V6Seed } from "./v6RstlRefinementV9.ts";

type Point2 = [number, number];

export interface ScopedYoloGuidedCurve {
  name?: string;
  region?: string;
  pts: ArrayLike<number>[];
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
