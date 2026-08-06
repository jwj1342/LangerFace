import type { AnnotationPoint } from "./annotationModel.ts";
import { parseSlicerCurveFile, type ParsedSlicerCurve } from "./slicerCurve.ts";

export interface PreparedAnnotationCurve {
  name: string;
  region: string;
  controls: AnnotationPoint[];
}

export interface AnnotationSlicerImportResult {
  lines: PreparedAnnotationCurve[];
  pointCount: number;
}

export interface PrepareAnnotationSlicerImportOptions {
  spacing: number;
  exportable: boolean;
  snapToSurface: (point: ParsedSlicerCurve["points"][number]) => AnnotationPoint | null;
  parseFile?: typeof parseSlicerCurveFile;
}

export async function prepareAnnotationSlicerImport(
  file: File,
  {
    spacing,
    exportable,
    snapToSurface,
    parseFile = parseSlicerCurveFile,
  }: PrepareAnnotationSlicerImportOptions,
): Promise<AnnotationSlicerImportResult> {
  const curves = await parseFile(file, { spacing });
  const lines: PreparedAnnotationCurve[] = [];
  let pointCount = 0;

  for (const curve of curves) {
    const controls = curve.points
      .map(snapToSurface)
      .filter((point): point is AnnotationPoint => point !== null)
      .map((point) => ({ ...point, exportable }));
    if (controls.length < 2) continue;
    lines.push({ name: curve.name, region: curve.region, controls });
    pointCount += controls.length;
  }

  return { lines, pointCount };
}
