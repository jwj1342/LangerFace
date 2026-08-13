import assert from "node:assert/strict";

import {
  buildSubcutaneousDiameterEstimateRefs,
  buildIncisionPhotoGeometry,
  candidateEndpointSurfaceRefs,
  incisionPhotoEndpointRadius,
  incisionPhotoStrokeWidths,
  inspectPhotoCandidateProjection,
  nearestPhotoEndpointHandle,
  pointsToSurfaceRefs,
  surfaceRefToModelPoint,
  validateIncisionPhotoFile,
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

const layeredVertices: Vec3[] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 0.01], [1, 0, 0.01], [0, 1, 0.01], [1, 1, 0.01],
];
const layeredTriangles: Triangle[] = [[0, 1, 2], [1, 3, 2], [4, 5, 6], [5, 7, 6]];
const continuousRefs = pointsToSurfaceRefs([
  [0.2, 0.2, 0], [0.4, 0.4, 0.01], [0.6, 0.6, 0], [0.8, 0.8, 0.01],
], layeredVertices, layeredTriangles);
assert.equal(continuousRefs.length, 4);
assert.ok(continuousRefs.every((ref) => ref.tri < 2),
  "candidate projection stays on one connected surface instead of jumping to a nearby disconnected layer");
const alignedEndpointRefs = candidateEndpointSurfaceRefs(
  [[0.2, 0.2, 0], [0.4, 0.4, 0.01], [0.6, 0.6, 0], [0.8, 0.8, 0.01]],
  continuousRefs,
  [[0.2, 0.2, 0], [0.8, 0.8, 0.01]],
  layeredVertices,
  layeredTriangles,
);
assert.deepEqual(alignedEndpointRefs, [continuousRefs[0], continuousRefs[3]],
  "visible endpoint controls reuse the projected candidate tips instead of a second projection path");
assert.equal(inspectPhotoCandidateProjection([
  [0, 0, 0], [2, 1, 0], [4, 0, 0], [2, -1, 0], [0, 0, 0],
], "fusiform").valid, false, "collapsed low-sample fusiform projection is rejected");
assert.equal(inspectPhotoCandidateProjection([
  [0, 0, 0], [1, 0.7, 0], [2, 1, 0], [3, 0.7, 0], [4, 0, 0],
  [3, -0.7, 0], [2, -1, 0], [1, -0.7, 0], [0, 0, 0],
], "fusiform").valid, true, "continuous tapered fusiform projection remains renderable");
const foldedProjection = inspectPhotoCandidateProjection([
  [0, 0, 0], [1, 0.7, 0], [3, 1, 0], [2, 0.7, 0], [4, 0, 0],
  [2, -0.7, 0], [3, -1, 0], [1, -0.7, 0], [0, 0, 0],
], "fusiform");
assert.equal(foldedProjection.valid, false, "a locally folded fusiform projection is rejected");
assert.ok(foldedProjection.reasonCodes.includes("candidate_projection_local_fold"));
const pinchedProjection = inspectPhotoCandidateProjection([
  [0, 0, 0], [1, 0.7, 0], [2, 0.04, 0], [3, 0.7, 0], [4, 0, 0],
  [3, -0.7, 0], [2, -0.04, 0], [1, -0.7, 0], [0, 0, 0],
], "fusiform");
assert.equal(pinchedProjection.valid, false, "a pinched fusiform projection is rejected before display");
assert.ok(pinchedProjection.reasonCodes.includes("candidate_projection_pinched"));
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

assert.equal(validateIncisionPhotoFile({ type: "image/jpeg", size: 1024 }), null);
assert.equal(validateIncisionPhotoFile({ type: "image/png", size: 1024 }), null);
assert.match(validateIncisionPhotoFile({ type: "image/webp", size: 1024 }) || "", /JPEG.*PNG/);
assert.match(validateIncisionPhotoFile({ type: "image/jpeg", size: 0 }) || "", /为空/);
assert.match(validateIncisionPhotoFile({ type: "image/jpeg", size: 21 * 1024 * 1024 }) || "", /20 MB/);

assert.equal(nearestPhotoEndpointHandle({ x: 108, y: 103 }, [{ x: 100, y: 100 }, { x: 300, y: 300 }], 12), 0);
assert.equal(nearestPhotoEndpointHandle({ x: 200, y: 200 }, [{ x: 100, y: 100 }, { x: 300, y: 300 }], 12), null);

const strokeWidths = incisionPhotoStrokeWidths(1300);
assert.equal(strokeWidths.rstl, 2);
assert.ok(strokeWidths.candidate <= strokeWidths.rstl * 0.5,
  "candidate reference line stays at most half the RSTL width");
assert.ok(strokeWidths.boundary < strokeWidths.rstl,
  "lesion boundary is thinner than the RSTL reference layer");
assert.ok(strokeWidths.candidateHalo < 2,
  "contrast halo no longer produces the former toy-like 8px stroke");
assert.equal(incisionPhotoEndpointRadius(strokeWidths.candidate) * 2, strokeWidths.candidate * 1.5,
  "visible endpoint diameter stays at 1.5 times the candidate line width");

console.log("test_incision_photo_planning: file gate and surface-ref projection passed");
