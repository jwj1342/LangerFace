import assert from "node:assert/strict";

import {
  buildSubcutaneousDiameterEstimateRefs,
  buildIncisionPhotoGeometry,
  nearestPhotoEndpointHandle,
  pointsToSurfaceRefs,
  surfaceRefToModelPoint,
  validateIncisionPhotoFile,
  visibleIncisionPhotoRstlRuns,
} from "../web/src/services/incisionPhotoPlanning.ts";
import type { Triangle, Vec3 } from "../web/src/services/softBody.ts";
import { mapAtlas } from "../web/src/services/geometryAtlas.ts";
import { buildRstlSourceContract, compareRstlSourceContracts } from "../web/src/services/rstlSourceContract.ts";

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
const diameterEstimateRefs = buildSubcutaneousDiameterEstimateRefs({
  centerRef: refs[0],
  lesionIndex: 0,
  diameterMm: 0.5,
  unitsPerMm: 1,
  vertices,
  normals: vertices.map(() => [0, 0, 1] as Vec3),
  triangles,
  samples: 16,
});
assert.equal(diameterEstimateRefs.length, 17, "subcutaneous diameter estimate is encoded as a closed surface-ref ring");

const geometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [{ name: "bilateral", region: "cheek", points: [[0, 0.5, 0.25], [1, 0.25, 0.5]] }],
  centerRef: refs[0],
  diameterEstimateRefs,
  boundaryRefs: refs,
  candidateRefs: refs,
  endpointRefs: refs,
});
assert.equal(geometry.rstl.length, 1);
assert.equal(geometry.rstl[0].pts.length, 2);
assert.ok(geometry.center);
assert.equal(geometry.diameterEstimate.length, 17);
assert.equal(geometry.boundary.length, 2);
assert.equal(geometry.candidate.length, 2);
assert.equal(geometry.endpoints.length, 2);
assert.ok(Math.abs(geometry.center[0] - 200) < 1e-6);
assert.ok(Math.abs(geometry.center[1] - 200) < 1e-6);

{
  const sharedAtlas = {
    system: "rstl",
    version: "golden-v1",
    topologyId: "mediapipe-468",
    topologyVersion: "mediapipe-468-v1",
    provenance: "synthetic-golden-sample",
    validated: false,
    lines: [{ name: "bilateral", region: "cheek", points: [[0, 0.5, 0.25], [1, 0.25, 0.5]] }],
  };
  const liveMapped = mapAtlas(sharedAtlas.lines, landmarks, triangles);
  const incisionMapped = buildIncisionPhotoGeometry({
    landmarks,
    triangles,
    atlasLines: sharedAtlas.lines,
    centerRef: null,
    boundaryRefs: [],
    candidateRefs: [],
    endpointRefs: [],
  }).rstl;
  assert.deepEqual(incisionMapped, liveMapped, "live and incision paths preserve the same surface mapping");
  const liveContract = buildRstlSourceContract(sharedAtlas);
  const incisionContract = buildRstlSourceContract(structuredClone(sharedAtlas));
  assert.equal(compareRstlSourceContracts(liveContract, incisionContract).compatible, true);
}

const faceLandmarks = Array.from({ length: 478 }, () => [50, 50, 0] as Vec3);
faceLandmarks[1] = [0, 100, 0];
faceLandmarks[2] = [100, 100, 0];
faceLandmarks[10] = [50, 10, 0];
const clippedForeheadRuns = visibleIncisionPhotoRstlRuns({
  name: "extended-forehead",
  region: "forehead_bridge_arc_v15",
  pts: [[50, -40, 0], [50, 10, 0], [50, 20, 0], [50, 80, 0]],
  tris: [0, 0, 0, 0],
}, faceLandmarks);
assert.deepEqual(clippedForeheadRuns, [[[50, 10, 0], [50, 20, 0]]],
  "photo planning clips extended forehead RSTL to the head envelope");
const cheekRuns = visibleIncisionPhotoRstlRuns({
  name: "cheek",
  region: "cheek",
  pts: [[-20, 20, 0], [120, 20, 0]],
  tris: [0, 0],
}, faceLandmarks);
assert.equal(cheekRuns.length, 1, "ordinary face lines are not changed by the forehead-only clip");

assert.equal(validateIncisionPhotoFile({ type: "image/jpeg", size: 1024 }), null);
assert.equal(validateIncisionPhotoFile({ type: "image/png", size: 1024 }), null);
assert.match(validateIncisionPhotoFile({ type: "image/webp", size: 1024 }) || "", /JPEG.*PNG/);
assert.match(validateIncisionPhotoFile({ type: "image/jpeg", size: 0 }) || "", /为空/);
assert.match(validateIncisionPhotoFile({ type: "image/jpeg", size: 21 * 1024 * 1024 }) || "", /20 MB/);

assert.equal(nearestPhotoEndpointHandle({ x: 108, y: 103 }, [{ x: 100, y: 100 }, { x: 300, y: 300 }], 12), 0);
assert.equal(nearestPhotoEndpointHandle({ x: 200, y: 200 }, [{ x: 100, y: 100 }, { x: 300, y: 300 }], 12), null);

console.log("test_incision_photo_planning: file gate and surface-ref projection passed");
