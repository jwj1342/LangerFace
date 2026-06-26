import type { Triangle, Vec3 } from "./soft_body.js";

export interface FlameBasis {
  NV: number;
  NS: number;
  NE: number;
  NF: number;
  NL: number;
  vTemplate: Float32Array;
  shapeDirs: Float32Array;
  exprDirs: Float32Array;
  faces: Int32Array;
  lmkFaceIdx: Int32Array;
  lmkBCoords: Float32Array;
  landmarkIndices: Int32Array;
  jawReg: Float32Array;
  jawW: Float32Array;
}

export function loadFlameBasis(url: string): Promise<FlameBasis>;
export function flameForward(
  basis: FlameBasis,
  beta: ArrayLike<number>,
  psi: ArrayLike<number>,
  jawOpen?: number,
): Vec3[];
export function facesArray(basis: FlameBasis): Triangle[];
