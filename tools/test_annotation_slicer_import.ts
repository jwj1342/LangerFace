import assert from "node:assert/strict";

import { prepareAnnotationSlicerImport } from "../web/src/services/annotationSlicerImport.ts";
import type { AnnotationPoint } from "../web/src/services/annotationModel.ts";
import type { ParsedSlicerCurve } from "../web/src/services/slicerCurve.ts";
import type { Vec3 } from "../web/src/services/softBody.ts";

const point = (x: number): Vec3 => [x, 0, 0];
const curves: ParsedSlicerCurve[] = [
  {
    name: "forehead",
    region: "upper-face",
    coordinateSystem: "LPS",
    controlPoints: [point(0), point(1), point(2)],
    points: [point(0), point(1), point(2)],
  },
  {
    name: "too-short-after-snap",
    region: "cheek",
    coordinateSystem: "LPS",
    controlPoints: [point(-1), point(3)],
    points: [point(-1), point(3)],
  },
];
let receivedSpacing = 0;
const result = await prepareAnnotationSlicerImport(
  { name: "curves.mrk.json" } as File,
  {
    spacing: 1.25,
    exportable: true,
    parseFile: async (_file, options) => {
      receivedSpacing = options.spacing ?? 0;
      return curves;
    },
    snapToSurface: (xyz): AnnotationPoint | null => xyz[0] < 0
      ? null
      : { xyz, tri: 0, bary: [1, 0, 0], exportable: false },
  },
);

assert.equal(receivedSpacing, 1.25, "the requested resampling spacing reaches the Slicer parser");
assert.equal(result.lines.length, 1, "curves with fewer than two snapped points are omitted");
assert.equal(result.pointCount, 3);
assert.deepEqual(result.lines[0], {
  name: "forehead",
  region: "upper-face",
  controls: [
    { xyz: point(0), tri: 0, bary: [1, 0, 0], exportable: true },
    { xyz: point(1), tri: 0, bary: [1, 0, 0], exportable: true },
    { xyz: point(2), tri: 0, bary: [1, 0, 0], exportable: true },
  ],
});

const customMesh = await prepareAnnotationSlicerImport(
  { name: "custom.mrk.json" } as File,
  {
    spacing: 2,
    exportable: false,
    parseFile: async () => [curves[0]],
    snapToSurface: (xyz) => ({ xyz }),
  },
);
assert.ok(customMesh.lines[0].controls.every((control) => control.exportable === false));

await assert.rejects(
  prepareAnnotationSlicerImport(
    { name: "invalid.mrk.json" } as File,
    {
      spacing: 2,
      exportable: true,
      parseFile: async () => { throw new Error("invalid Slicer payload"); },
      snapToSurface: () => null,
    },
  ),
  /invalid Slicer payload/,
  "parse failures remain visible to the runtime error presenter",
);

let meshIsCurrent = true;
let staleSnapCalls = 0;
await assert.rejects(
  prepareAnnotationSlicerImport(
    { name: "stale.mrk.json" } as File,
    {
      spacing: 2,
      exportable: true,
      parseFile: async () => {
        meshIsCurrent = false;
        return [curves[0]];
      },
      isCurrent: () => meshIsCurrent,
      snapToSurface: (xyz) => {
        staleSnapCalls += 1;
        return { xyz };
      },
    },
  ),
  /头模已变化/,
  "an import parsed against a replaced mesh is rejected",
);
assert.equal(staleSnapCalls, 0, "stale imports stop before snapping points to the replacement mesh");

console.log("test_annotation_slicer_import OK");
