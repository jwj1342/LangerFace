import assert from "node:assert/strict";

import {
  buildIncisionPhotoGeometry,
  pointsToSurfaceRefs,
  surfaceRefToModelPoint,
  validateIncisionPhotoFile,
} from "../web/src/services/incisionPhotoPlanning.ts";
import type { Triangle, Vec3 } from "../web/src/services/softBody.ts";

const vertices: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
];
const landmarks: Vec3[] = [
  [100, 100, 0],
  [500, 100, 0],
  [100, 500, 0],
  [500, 500, 0],
];
const triangles: Triangle[] = [[0, 1, 2], [1, 3, 2]];
const refs = pointsToSurfaceRefs([[0.25, 0.25, 0], [0.75, 0.75, 0]], vertices, triangles);
assert.equal(refs.length, 2);
const firstModelPoint = surfaceRefToModelPoint(refs[0], vertices, triangles);
assert.ok(firstModelPoint);
assert.ok(Math.abs(firstModelPoint[0] - 0.25) < 1e-8);
assert.ok(Math.abs(firstModelPoint[1] - 0.25) < 1e-8);

const geometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [{ name: "bilateral", region: "cheek", points: [[0, 0.5, 0.25], [1, 0.25, 0.5]] }],
  centerRef: refs[0],
  boundaryRefs: refs,
  candidateRefs: refs,
});
assert.equal(geometry.rstl.length, 1);
assert.equal(geometry.rstl[0].pts.length, 2);
assert.ok(geometry.center);
assert.equal(geometry.boundary.length, 2);
assert.equal(geometry.candidate.length, 2);
assert.ok(Math.abs(geometry.center[0] - 200) < 1e-6);
assert.ok(Math.abs(geometry.center[1] - 200) < 1e-6);

assert.equal(validateIncisionPhotoFile({ type: "image/jpeg", size: 1024 }), null);
assert.equal(validateIncisionPhotoFile({ type: "image/png", size: 1024 }), null);
assert.match(validateIncisionPhotoFile({ type: "image/webp", size: 1024 }) || "", /JPEG.*PNG/);
assert.match(validateIncisionPhotoFile({ type: "image/jpeg", size: 0 }) || "", /为空/);
assert.match(validateIncisionPhotoFile({ type: "image/jpeg", size: 21 * 1024 * 1024 }) || "", /20 MB/);

console.log("test_incision_photo_planning: file gate and surface-ref projection passed");
