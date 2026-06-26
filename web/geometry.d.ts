export type Vec3 = [number, number, number];
export type Triangle = [number, number, number];
export type Point2 = [number, number];
export type HandBone = [number, number, number, number];

export interface HandMask {
  palm: Point2[];
  bones: HandBone[];
  r: number;
}

export interface AtlasLine {
  name?: string;
  points?: Array<[number, number, number]>;
}

export interface AtlasPayload {
  topologyId?: string;
  topologyVersion?: string;
  lines?: AtlasLine[];
}

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

export interface MappedAtlasLine {
  name?: string;
  pts: Vec3[];
  tris: number[];
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

export const NOSE_TIP: number;
export const INNER_LIP: Set<number>;
export function toPixels(landmarks: NormalizedLandmark[], width: number, height: number): Vec3[];
export function mapAtlas(lines: AtlasLine[] | unknown, landmarksPx: Vec3[], triangles: Triangle[]): MappedAtlasLine[];
export function noseTriangles(triangles: Triangle[]): number[];
export function innerMouthTriangles(triangles: Triangle[]): Set<number>;
export function visibleTriangles(
  landmarksPx: Vec3[],
  triangles: Triangle[],
  noseTris: number[],
  threshold?: number,
  options?: { minTriangleAreaPx2?: number },
): Uint8Array;
export function visibleRuns(points: Vec3[], visMask: ArrayLike<number>): Vec3[][];

export function convexHull(points: Point2[]): Point2[];
export function expandHull(hull: Point2[], margin: number): Point2[];
export function pointInConvex(point: Point2, hull: Point2[]): boolean;
export function pointInHulls(point: Point2, hulls: Point2[][]): boolean;
export function buildHandMasks(handsPx: Point2[][], scaleR?: number, margin?: number): HandMask[];
export function pointInHandMasks(point: Point2, masks: HandMask[]): boolean;
export function buildOccluderHulls(occludersPx: Point2[][], margin: number): Point2[][];

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
