import assert from "node:assert/strict";

import { buildAnnotationExport } from "../web/src/services/annotationExport.ts";

const calls: string[] = [];
const source = {
  system: "rstl",
  toAtlasJSON() {
    calls.push("atlas");
    return { system: "rstl", validated: false, lines: [] };
  },
  toXyzJSON() {
    calls.push("xyz");
    return { system: "rstl", lines: [] };
  },
};

const atlas = buildAnnotationExport(source, "atlas");
assert.equal(atlas.filename, "atlas_rstl_annotated.json");
assert.equal(atlas.mimeType, "application/json");
assert.deepEqual(JSON.parse(atlas.text), {
  system: "rstl",
  validated: false,
  lines: [],
});
assert.deepEqual(calls, ["atlas"]);

const xyz = buildAnnotationExport(source, "xyz");
assert.equal(xyz.filename, "lines_rstl_xyz.json");
assert.deepEqual(JSON.parse(xyz.text), { system: "rstl", lines: [] });
assert.deepEqual(calls, ["atlas", "xyz"]);

assert.throws(
  () => buildAnnotationExport({
    ...source,
    toAtlasJSON() {
      throw new Error("missing barycentric coordinates");
    },
  }, "atlas"),
  /missing barycentric coordinates/,
);

console.log("test_annotation_export: format routing, filenames, and JSON artifacts passed");
