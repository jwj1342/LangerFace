import type { Triangle, Vec3 } from "./soft_body.js";

export interface RstlAtlasLine {
  points?: Array<[number, number, number]>;
  points3d?: Vec3[];
}

export interface RstlAtlas {
  lines?: RstlAtlasLine[];
}

export function rstlDirField(verts: Vec3[], tris: Triangle[], atlas: RstlAtlas): Vec3[];
