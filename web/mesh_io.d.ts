import type { Triangle, Vec3 } from "./soft_body.js";

export interface ParsedMesh {
  vertices: Vec3[];
  triangles: Triangle[];
  colors?: Array<[number, number, number]> | null;
}

export function parseMeshFile(file: File): Promise<ParsedMesh>;
