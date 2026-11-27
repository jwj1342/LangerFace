import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { detectControlledMarker } from "../web/src/services/controlledMarkerDetectionColorV035.ts";
import type { MarkerPoint } from "../web/src/services/controlledMarkerDetection.ts";

const ref = JSON.parse(fs.readFileSync(new URL("./fixtures/controlled_marker_light_skin_10_incomplete.json", import.meta.url), "utf8"));
const raw = zlib.gunzipSync(Buffer.from(fs.readFileSync(new URL("./fixtures/controlled_marker_light_skin_10_incomplete.rgba.gz.b64", import.meta.url), "utf8"), "base64"));
assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), ref.fixtureHash);
assert.equal(raw.length, 112 * 112 * 4);
const result = detectControlledMarker({ width: 112, height: 112, data: new Uint8ClampedArray(raw) },
  { x: ref.seed.x - ref.sourceCropOrigin.x, y: ref.seed.y - ref.sourceCropOrigin.y }, ref.options);
assert.equal(result.ok, true);
assert.ok(result.warnings.includes("color_difference_completeness_recovered"));
const boundary = result.boundary.map((p) => ({ x: p.x + ref.sourceCropOrigin.x, y: p.y + ref.sourceCropOrigin.y }));
function inside(x: number, y: number, poly: MarkerPoint[]) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
}
function metrics(poly: MarkerPoint[]) {
  let intersection = 0, union = 0, predicted = 0, truth = 0, upperLeft = 0, coveredUpperLeft = 0;
  for (let y = 569; y < 681; y += 1) for (let x = 726; x < 838; x += 1) {
    const a = inside(x + 0.5, y + 0.5, ref.boundary), p = inside(x + 0.5, y + 0.5, poly);
    intersection += Number(a && p); union += Number(a || p); predicted += Number(p); truth += Number(a);
    if (a && x + 0.5 < ref.upperLeftRegion.xLessThan && y + 0.5 < ref.upperLeftRegion.yLessThan) {
      upperLeft += 1; coveredUpperLeft += Number(p);
    }
  }
  return { iou: intersection / union, coverage: intersection / truth, precision: intersection / predicted,
    upperLeftCoverage: coveredUpperLeft / upperLeft };
}
const before = metrics(ref.baselineBoundary), after = metrics(boundary);
assert.ok(after.iou >= 0.80 && after.coverage >= 0.84 && after.precision >= 0.84, JSON.stringify(after));
assert.ok(after.upperLeftCoverage >= 0.90, JSON.stringify(after));
assert.ok(after.precision >= before.precision, "restoring the missing arc must not reduce precision");
console.log("image10 provisional-reference regression passed (full polygon, uncertainty band included)", { before, after });
