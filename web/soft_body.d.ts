export type Vec3 = [number, number, number];
export type Triangle = [number, number, number];

export interface SoftBody {
  N: number;
  springs: Array<{
    a: number;
    b: number;
    rest: number;
    k: number;
  }>;
  rest0: Vec3[];
  pos: Vec3[];
  vel: Vec3[];
  anchored: Uint8Array;
  removed: Uint8Array;
  tetherMask: Float32Array;
  stiffness: number;
  tether: number;
  damping: number;
  dt: number;
}

export function buildSoftBody(
  verts: Vec3[],
  faces: Triangle[],
  dirField?: Vec3[] | null,
  opts?: {
    pretension?: number;
    aniso?: number;
    anchored?: Uint8Array;
    stiffness?: number;
    tether?: number;
    damping?: number;
    dt?: number;
  },
): SoftBody;

export function stepSoftBody(sb: SoftBody, iters?: number): void;

export function boundaryVerts(faces: Triangle[], N: number): Uint8Array;

export function excise(
  sb: SoftBody,
  verts: Vec3[],
  center: Vec3,
  axis: Vec3,
  la: number,
  lb: number,
  release?: number,
): number;

export function vertexTension(sb: SoftBody, closureAxis?: Vec3 | null): Float64Array;
