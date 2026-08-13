import {
  innerMouthTriangles,
  noseTriangles,
  visibleRuns,
  visibleTriangles,
  type MappedAtlasLine,
} from "./geometryAtlas.ts";
import { pointInHandMasks, type HandMask, type Point2 } from "./geometryOccluders.ts";
import {
  buildHeadVisibility,
  EXTENDED_FOREHEAD_REGIONS,
  stabilizeForeheadMask,
  type VisibilityPredicate,
} from "./foreheadVisibility.ts";
import { lineIndicesForDensity } from "./lineDensity.ts";
import type { Triangle, Vec3 } from "./softBody.ts";

export interface RstlRenderLine extends MappedAtlasLine {
  hidden?: boolean;
}

export interface RstlRenderPlanEntry {
  lineIndex: number;
  line: RstlRenderLine;
  runs: Vec3[][];
}

export interface RstlRenderPlanInput {
  lines: RstlRenderLine[];
  landmarks: Vec3[];
  triangles: Triangle[];
  clip?: boolean;
  densityFraction?: number;
  handMasks?: HandMask[];
  skinVisible?: VisibilityPredicate;
  minTriangleAreaPx2?: number;
  pointVisible?: (point: Vec3) => boolean;
  triangleVisibility?: Uint8Array | null;
  innerMouthTriangleIndices?: Set<number>;
}

const toPoint2 = (point: Vec3): Point2 => [Number(point[0]), Number(point[1])];

export function standardRstlStrokeWidth(canvasWidth: number): number {
  return Math.max(2, Number(canvasWidth) / 1300);
}

export function buildRstlRenderPlan({
  lines,
  landmarks,
  triangles,
  clip = true,
  densityFraction = 1,
  handMasks = [],
  skinVisible = () => true,
  minTriangleAreaPx2 = 1,
  pointVisible = () => true,
  triangleVisibility: suppliedTriangleVisibility,
  innerMouthTriangleIndices,
}: RstlRenderPlanInput): RstlRenderPlanEntry[] {
  const triangleVisibility = suppliedTriangleVisibility !== undefined
    ? suppliedTriangleVisibility
    : clip
      ? visibleTriangles(landmarks, triangles, noseTriangles(triangles), undefined, { minTriangleAreaPx2 })
      : null;
  const innerMouth = innerMouthTriangleIndices || innerMouthTriangles(triangles);
  const headVisible = buildHeadVisibility(landmarks);
  const visibleLineIndices = lineIndicesForDensity(lines, densityFraction);
  const hasHandMasks = handMasks.length > 0;
  const plan: RstlRenderPlanEntry[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!visibleLineIndices.has(lineIndex)) continue;
    const line = lines[lineIndex];
    if (line.hidden || line.pts.length < 2) continue;
    const extendedForehead = EXTENDED_FOREHEAD_REGIONS.has(line.region);
    const foreheadMask = extendedForehead
      ? stabilizeForeheadMask(line.pts.map((point) => headVisible(point) && skinVisible(point)))
      : line.pts.map(() => true);
    const mask = line.pts.map((point, pointIndex) => {
      const triangleIndex = line.tris[pointIndex];
      if (innerMouth.has(triangleIndex)) return 0;
      if (!foreheadMask[pointIndex] || !pointVisible(point)) return 0;
      if (triangleVisibility && !triangleVisibility[triangleIndex]) return 0;
      if (hasHandMasks && pointInHandMasks(toPoint2(point), handMasks)) return 0;
      return 1;
    });
    const runs = visibleRuns(line.pts, mask);
    plan.push({ lineIndex, line, runs });
  }
  return plan;
}
