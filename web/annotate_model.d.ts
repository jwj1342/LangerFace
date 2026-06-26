import type { Triangle, Vec3 } from "./soft_body.js";

export interface AnnotationPoint {
  xyz: Vec3;
  tri?: number | null;
  bary?: [number, number, number] | null;
  exportable?: boolean;
  fallback?: boolean;
}

export interface AnnotationLine {
  name: string;
  region: string;
  points: AnnotationPoint[];
  controls?: AnnotationPoint[];
  fallback?: boolean;
}

export class AnnotationModel {
  system: string;
  topologyId: string;
  topologyVersion: string;
  lines: AnnotationLine[];
  current: AnnotationLine | null;
  constructor(system?: string, options?: { topologyId?: string; topologyVersion?: string });
  setTopology(topology?: { topologyId?: string; topologyVersion?: string }): void;
  setSurface(verts: Vec3[], tris: Triangle[]): void;
  startLine(options?: { name?: string; region?: string }): void;
  addPoint(point: AnnotationPoint): { fallback: boolean };
  addLine(options: { name?: string; region?: string; points?: AnnotationPoint[]; controls?: AnnotationPoint[] }): AnnotationLine | null;
  undoPoint(): void;
  finishLine(): AnnotationLine | null;
  cancelLine(): void;
  deleteLine(index: number): void;
  clear(): void;
  hasBarycentric(): boolean;
  toAtlasJSON(options?: { version?: string; provenance?: string; topologyId?: string; topologyVersion?: string }): unknown;
  toXyzJSON(): unknown;
}

export function barycentric(p: Vec3, a: Vec3, b: Vec3, c: Vec3): [number, number, number];
