import type { Vec3 } from "./soft_body.js";

export interface ParsedSlicerCurve {
  name: string;
  region: string;
  points: Vec3[];
}

export function parseSlicerCurveFile(file: File, options?: { spacing?: number }): Promise<ParsedSlicerCurve[]>;
