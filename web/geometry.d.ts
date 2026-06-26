export type Vec3 = [number, number, number];
export type Triangle = [number, number, number];

export interface AtlasLine {
  name?: string;
  points?: Array<[number, number, number]>;
}

export interface AtlasPayload {
  topologyId?: string;
  topologyVersion?: string;
  lines?: AtlasLine[];
}

export interface SimilarityTransform {
  c: number;
  R: [Vec3, Vec3, Vec3];
  t: Vec3;
}

export function validateAtlasLines(
  atlasOrLines: AtlasPayload | AtlasLine[] | unknown,
  triangles: Triangle[],
  options?: { expectedTopologyId?: string; expectedTopologyVersion?: string },
): boolean;

export function umeyama(sourcePts: Vec3[], targetPts: Vec3[]): SimilarityTransform;
export function applySim(transform: SimilarityTransform, points: Vec3[]): Vec3[];

export interface OneEuroOptions {
  minCutoff?: number;
  beta?: number;
  dcutoff?: number;
}

export class OneEuro {
  minCutoff: number;
  beta: number;
  dcutoff: number;
  constructor(options?: OneEuroOptions);
  reset(): void;
  filter(points: Vec3[], t: number): Vec3[];
}

export interface MotionStabilizedOneEuroOptions extends OneEuroOptions {
  globalMinCutoff?: number;
  globalBeta?: number;
  globalDcutoff?: number;
  anchorIndices?: number[];
}

export class MotionStabilizedOneEuro {
  minCutoff: number;
  beta: number;
  dcutoff: number;
  globalMinCutoff: number;
  globalBeta: number;
  globalDcutoff: number;
  constructor(options?: MotionStabilizedOneEuroOptions);
  configureForSmoothLevel(smoothLevel: number): void;
  reset(): void;
  filter(points: Vec3[], t: number): Vec3[];
}
