import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../web/compat/personalized/personalized.js", import.meta.url), "utf8");
const paintStart = source.indexOf("function paint()");
const paintEnd = source.indexOf("/** 统计一条曲线", paintStart);
assert.ok(paintStart >= 0 && paintEnd > paintStart, "camera-only paint function must exist");

const paintBody = source.slice(paintStart, paintEnd);
assert.ok(paintBody.includes("ctx.drawImage(els.video"), "preview must draw the camera frame");
for (const forbidden of ["mapAtlas(", "renderCompareImage(", "strokeFull(", "baryToPoint("]) {
  assert.ok(!paintBody.includes(forbidden), `capture preview must not draw ${forbidden}`);
}
assert.ok(!source.includes("noseTris = noseTriangles"), "capture must not prepare live RSTL visibility");

console.log("personalized capture preview test passed: camera frame only");
