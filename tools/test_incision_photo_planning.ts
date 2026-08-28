import assert from "node:assert/strict";

import {
  attemptConstrainedPhotoReferences,
  buildPhotoSpaceLinearCandidate,
  buildPhotoSpaceDiameterEstimate,
  buildSubcutaneousDiameterEstimateRefs,
  buildIncisionPhotoGeometry,
  buildPhotoSurfaceCanonicalFusiform,
  candidateEndpointSurfaceRefs,
  diagnoseSurfaceProjectedFusiformFit,
  drawFusiformRenderMode,
  fitSurfaceProjectedFusiform,
  incisionPhotoEndpointRadius,
  incisionPhotoLayerContract,
  incisionPhotoStatusPresentation,
  incisionPhotoStrokeWidths,
  inspectPhotoCandidateProjection,
  nearestPhotoEndpointHandle,
  pointsToSurfaceRefs,
  projectedRstlUpperForeheadSupportsPoint,
  projectedRstlDeviation,
  queryIncisionPhotoRstlDirection,
  recoverPhotoFaceEdgeSurfaceRef,
  smoothSurfaceProjectedFusiform,
  surfaceRefToModelPoint,
  validateIncisionPhotoFile,
} from "../web/src/services/incisionPhotoPlanning.ts";
import type { Triangle, Vec3 } from "../web/src/services/softBody.ts";
import { mapAtlas } from "../web/src/services/geometryAtlas.ts";
import { mapSurfaceRefs } from "../web/src/services/incisionOverlay.ts";
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

const pickFaceOvalIndices = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const;
const edgeLandmarks = Array.from({ length: 468 }, () => [50, 50, 0] as Vec3);
pickFaceOvalIndices.forEach((landmarkIndex, order) => {
  const angle = order / pickFaceOvalIndices.length * Math.PI * 2;
  edgeLandmarks[landmarkIndex] = [50 + Math.cos(angle) * 40, 50 + Math.sin(angle) * 40, 0];
});
const edgeTriangles = pickFaceOvalIndices.map((landmarkIndex, order) => [
  1,
  landmarkIndex,
  pickFaceOvalIndices[(order + 1) % pickFaceOvalIndices.length],
] as Triangle);
const narrowEdgeRecovery = recoverPhotoFaceEdgeSurfaceRef(
  { x: 92, y: 50 }, edgeLandmarks, edgeTriangles,
);
assert.ok(narrowEdgeRecovery, "a point in the narrow visible face-edge band recovers to the outer oval");
const recoveredEdgePoint = mapSurfaceRefs([narrowEdgeRecovery.ref], edgeLandmarks, edgeTriangles).pts[0];
assert.ok(recoveredEdgePoint);
assert.ok(Math.hypot(recoveredEdgePoint[0] - 90, recoveredEdgePoint[1] - 50) < 0.5,
  "face-edge recovery snaps to the nearest outer-oval surface point");
assert.equal(recoverPhotoFaceEdgeSurfaceRef({ x: 98, y: 50 }, edgeLandmarks, edgeTriangles), null,
  "a point beyond the bounded edge band remains rejected as hair or background");
assert.equal(recoverPhotoFaceEdgeSurfaceRef({ x: 50, y: 50 }, edgeLandmarks, []), null,
  "an internal mesh gap cannot borrow the distant outer-face recovery band");

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

const surfaceProjectedFusiform: Vec3[] = [
  [0, 0, 0], [20, 4, 0], [38, 14, 0], [60, 12, 0], [82, 9, 0], [100, 5, 0], [120, 0, 0],
  [100, -5, 0], [80, -9, 0], [60, -12, 0], [40, -9, 0], [20, -5, 0], [0, 0, 0],
];
const surfaceSmoothedFusiform = smoothSurfaceProjectedFusiform(surfaceProjectedFusiform);
const surfaceFusiformFit = fitSurfaceProjectedFusiform(surfaceProjectedFusiform);
const surfaceFitDiagnostics = diagnoseSurfaceProjectedFusiformFit(surfaceProjectedFusiform);
assert.ok(surfaceSmoothedFusiform, "photo planning smooths the existing surface-projected fusiform");
assert.ok(surfaceFusiformFit, "photo planning retains the fitted global cubic instead of only sampled points");
assert.equal(surfaceFitDiagnostics.diagnostics.ok, true,
  "successful smoothing exposes a structured diagnostic result");
const denselySampledFusiform = surfaceProjectedFusiform.slice(0, -1).flatMap((point, index, polygon) => {
  const next = polygon[(index + 1) % polygon.length];
  return Array.from({ length: 4 }, (_, subdivision) => [0, 1, 2].map((axis) =>
    point[axis] + (next[axis] - point[axis]) * subdivision / 4) as Vec3);
}).concat([[...surfaceProjectedFusiform[0]] as Vec3]);
const denseFitDiagnostics = diagnoseSurfaceProjectedFusiformFit(denselySampledFusiform);
assert.equal(denseFitDiagnostics.diagnostics.ok, true,
  "the same outline remains smoothable when only its sampling density changes");
assert.ok(Math.abs(
  denseFitDiagnostics.diagnostics.candidateLength - surfaceFitDiagnostics.diagnostics.candidateLength,
) < 1e-6, "shape-scale diagnostics are independent of adjacent point spacing");
const rejectedFitDiagnostics = diagnoseSurfaceProjectedFusiformFit(surfaceProjectedFusiform, [0, 60, 0]);
assert.equal(rejectedFitDiagnostics.diagnostics.reason, "center_shift_exceeded",
  "a rejected fit reports the exact failed constraint instead of an unexplained null");

const makeLargeCurvedFusiform = (length: number, bend: number, wave: number): Vec3[] => {
  const upper: Vec3[] = [];
  const lower: Vec3[] = [];
  for (let index = 0; index <= 32; index += 1) {
    const t = index / 32;
    const x = length * t;
    const centerY = bend * Math.sin(3 * Math.PI * t) * Math.sin(Math.PI * t);
    const halfWidth = 28 * Math.sin(Math.PI * t);
    const meshWave = wave * Math.sin(Math.PI * t) * (index % 2 ? 1 : -1);
    upper.push([x, centerY - halfWidth + meshWave, 0]);
    lower.push([x, centerY + halfWidth - meshWave, 0]);
  }
  return upper.concat(lower.slice(1, -1).reverse(), [[...upper[0]] as Vec3]);
};
const largeCurvedFit = diagnoseSurfaceProjectedFusiformFit(
  makeLargeCurvedFusiform(180, 25, 2),
  [90, -25, 0],
);
assert.equal(largeCurvedFit.diagnostics.ok, true,
  "a long surface-projected fusiform is no longer forced back to its mesh-scale source polyline");
assert.equal(largeCurvedFit.fit?.strategy, "segmented_c1",
  "long low-frequency face curvature uses the bounded segmented path when one global cubic is insufficient");
assert.equal(largeCurvedFit.fit?.upperCurves.length, 4);
assert.equal(largeCurvedFit.fit?.lowerCurves.length, 4);
assert.ok(largeCurvedFit.diagnostics.maxTangentDiscontinuityDeg < 0.01,
  "adjacent low-frequency segments share a tangent instead of creating visible internal corners");
assert.ok(largeCurvedFit.diagnostics.maxEndpointTangentErrorDeg < 1,
  "the rendered tip tangents retain the source surface projection direction");
assert.ok(largeCurvedFit.diagnostics.maxCorridorError <= largeCurvedFit.diagnostics.corridor,
  "the longer smooth curve remains inside the original surface-projection corridor");
assert.equal(inspectPhotoCandidateProjection(largeCurvedFit.fit!.outline, "fusiform").valid, true,
  "the segmented result also passes the existing projection fold, pinch, and closure gate");
const largeCenterUpper = largeCurvedFit.fit!.upperCurves[1][3];
const largeCenterLower = largeCurvedFit.fit!.lowerCurves[1][3];
assert.ok(Math.hypot(
  (largeCenterUpper[0] + largeCenterLower[0]) * 0.5 - 90,
  (largeCenterUpper[1] + largeCenterLower[1]) * 0.5 + 25,
) < 1e-6, "segmented smoothing keeps the fusiform geometry centered on the lesion");
const largerCurvedFit = diagnoseSurfaceProjectedFusiformFit(
  makeLargeCurvedFusiform(240, 25, 3),
  [120, -25, 0],
);
assert.equal(largerCurvedFit.diagnostics.ok, true,
  "increasing the candidate extent does not by itself trigger a source-polyline fallback");
assert.equal(largerCurvedFit.fit?.strategy, "segmented_c1");
assert.deepEqual(surfaceSmoothedFusiform?.[0], surfaceProjectedFusiform[0]);
const smoothedFarTipIndex = (surfaceSmoothedFusiform!.length - 1) / 2;
assert.deepEqual(surfaceSmoothedFusiform?.[smoothedFarTipIndex], surfaceProjectedFusiform[6]);
assert.deepEqual(surfaceSmoothedFusiform?.at(-1), surfaceProjectedFusiform[0],
  "surface smoothing preserves both projected tips and closure");
const smoothedUpper = surfaceSmoothedFusiform!.slice(0, smoothedFarTipIndex + 1);
const upperVerticalTurns = smoothedUpper.slice(1).map((point, index) =>
  Math.sign(point[1] - smoothedUpper[index][1])).filter((value) => value !== 0);
const upperVerticalTurnChanges = upperVerticalTurns.slice(1).filter((value, index) =>
  value !== upperVerticalTurns[index]).length;
assert.ok(upperVerticalTurnChanges <= 2,
  "a globally fitted fusiform side has no mesh-scale vertical waviness");
assert.ok(surfaceSmoothedFusiform!.every((point) => point[0] >= 0 && point[0] <= 120
  && point[1] >= -12 && point[1] <= 14),
"surface smoothing stays inside the local envelope instead of creating a planar sticker outside the face");

{
  const calls: string[] = [];
  const context = {
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    bezierCurveTo: () => calls.push("bezierCurveTo"),
    closePath: () => calls.push("closePath"),
    stroke: () => calls.push("stroke"),
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "miter",
    lineCap: "butt",
  } as unknown as CanvasRenderingContext2D;
  const counts = new Map<string, { line: number; cubic: number }>();
  for (const mode of [
    "raw", "globalBezierDirect", "segmentedBezierDirect", "sampledPolyline", "sampledLocalCubic",
  ] as const) {
    calls.length = 0;
    drawFusiformRenderMode(context, surfaceFusiformFit!.outline, surfaceFusiformFit, mode, "#000", 1);
    counts.set(mode, {
      line: calls.filter((call) => call === "lineTo").length,
      cubic: calls.filter((call) => call === "bezierCurveTo").length,
    });
  }
  assert.deepEqual(counts.get("globalBezierDirect"), { line: 0, cubic: 2 },
    "the product path draws the two fitted global cubics directly without local re-interpolation");
  assert.deepEqual(counts.get("segmentedBezierDirect"), {
    line: 0,
    cubic: surfaceFusiformFit!.upperCurves.length + surfaceFusiformFit!.lowerCurves.length,
  }, "the long-candidate path draws only its C1 curve chain without polyline or local-cubic re-interpolation");
  assert.ok((counts.get("raw")?.line || 0) > 2 && counts.get("raw")?.cubic === 0,
    "raw mode exposes the source-projected polygon for same-input diagnosis");
  assert.ok((counts.get("sampledPolyline")?.line || 0) > (counts.get("raw")?.line || 0),
    "sampled polyline mode exposes the global fit samples without changing them again");
  assert.ok((counts.get("sampledLocalCubic")?.cubic || 0) > 2,
    "legacy local-cubic mode remains available only for A/B diagnosis");
  calls.length = 0;
  const visibilityLimitedFit = {
    ...surfaceFusiformFit!,
    visibleSegments: [surfaceFusiformFit!.outline.slice(2, 8)],
  };
  drawFusiformRenderMode(
    context,
    visibilityLimitedFit.outline,
    visibilityLimitedFit,
    "segmentedBezierDirect",
    "#000",
    1,
  );
  assert.equal(calls.filter((call) => call === "closePath").length, 0,
    "view-limited rendering never reconnects an open visible run across the hidden region");
  assert.equal(calls.filter((call) => call === "bezierCurveTo").length, 0,
    "view-limited rendering draws only prevalidated visible samples instead of extrapolating hidden curves");
  assert.ok(calls.filter((call) => call === "lineTo").length >= 2);
}
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
const photoDiameterEstimate = buildPhotoSpaceDiameterEstimate([220, 140, 0], 12, 4, 48);
const secondPhotoDiameterEstimate = buildPhotoSpaceDiameterEstimate([420, 360, 0], 12, 4, 48);
assert.equal(photoDiameterEstimate.length, 49,
  "the subcutaneous photo indicator is encoded as a closed photo-space circle");
assert.ok(photoDiameterEstimate.every((point) => Math.abs(Math.hypot(point[0] - 220, point[1] - 140) - 24) < 1e-6),
  "the photo-space diameter indicator keeps the entered diameter circular at every face location");
assert.ok(secondPhotoDiameterEstimate.every((point, index) => {
  const reference = photoDiameterEstimate[index];
  return Math.abs((point[0] - 420) - (reference[0] - 220)) < 1e-9
    && Math.abs((point[1] - 360) - (reference[1] - 140)) < 1e-9;
}), "equal entered diameters produce the same photo-space circle on the forehead and cheek");

const firstPhotoLinear = buildPhotoSpaceLinearCandidate({
  center: [220, 140, 0],
  lengthMm: 15,
  pixelsPerMm: 2,
  axisHint: [1, 0],
});
const secondPhotoLinear = buildPhotoSpaceLinearCandidate({
  center: [420, 360, 0],
  lengthMm: 15,
  pixelsPerMm: 2,
  axisHint: [1, 0],
});
for (const [candidate, center] of [
  [firstPhotoLinear, [220, 140, 0]],
  [secondPhotoLinear, [420, 360, 0]],
] as const) {
  assert.ok(candidate, "a valid millimetre length and photo scale produce a linear photo candidate");
  assert.ok(Math.abs(Math.hypot(
    candidate.endpoints[1][0] - candidate.endpoints[0][0],
    candidate.endpoints[1][1] - candidate.endpoints[0][1],
  ) - 30) < 1e-9, "the photo-space line keeps the requested millimetre length at every face location");
  assert.ok(Math.abs((candidate.endpoints[0][0] + candidate.endpoints[1][0]) * 0.5 - center[0]) < 1e-9);
  assert.ok(Math.abs((candidate.endpoints[0][1] + candidate.endpoints[1][1]) * 0.5 - center[1]) < 1e-9,
    "the linear incision stays centered on the detected lesion");
}

const geometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [{ name: "bilateral", region: "cheek", points: [[0, 0.5, 0.25], [1, 0.25, 0.5]] }],
  centerRef: refs[0],
  diameterEstimateRefs,
  photoDiameterEstimateMm: 0.5,
  photoPixelsPerMm: 80,
  boundaryRefs: refs,
  candidateRefs: refs,
  endpointRefs: refs,
});
assert.equal(geometry.rstl.length, 1);
assert.equal(geometry.rstl[0].pts.length, 2);
assert.ok(geometry.center);
assert.equal(geometry.diameterEstimate.length, 49);
assert.ok(geometry.diameterEstimate.every((point) => Math.abs(
  Math.hypot(point[0] - geometry.center![0], point[1] - geometry.center![1]) - 20,
) < 1e-6), "photo rendering prefers a stable screen-space circle over the distorted tangent-plane projection");
assert.equal(geometry.boundary.length, 2);
assert.equal(geometry.candidate.length, 2);
assert.equal(geometry.endpoints.length, 2);
assert.ok(Math.abs(geometry.center[0] - 200) < 1e-6);
assert.ok(Math.abs(geometry.center[1] - 200) < 1e-6);

const stableLinearGeometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [],
  centerRef: refs[0],
  boundaryRefs: [],
  candidateRefs: refs,
  endpointRefs: refs,
  candidateType: "linear",
  candidateLengthMm: 15,
  photoPixelsPerMm: 2,
});
assert.ok(Math.abs(Math.hypot(
  stableLinearGeometry.endpoints[1][0] - stableLinearGeometry.endpoints[0][0],
  stableLinearGeometry.endpoints[1][1] - stableLinearGeometry.endpoints[0][1],
) - 30) < 1e-9, "integrated photo geometry renders equal linear lengths with the stable photo scale");
assert.ok(Math.abs(stableLinearGeometry.planningCenter![0] - stableLinearGeometry.center![0]) < 1e-9
  && Math.abs(stableLinearGeometry.planningCenter![1] - stableLinearGeometry.center![1]) < 1e-9,
"the integrated linear candidate passes through the lesion center");

const directPhotoBoundary: Vec3[] = [
  [180, 188, 0], [200, 184, 0], [220, 188, 0], [224, 200, 0],
  [220, 212, 0], [200, 216, 0], [180, 212, 0], [176, 200, 0],
];
const directPhotoBoundaryGeometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [],
  centerRef: refs[0],
  boundaryRefs: refs,
  photoBoundary: directPhotoBoundary,
  candidateRefs: refs,
  endpointRefs: refs,
});
assert.deepEqual(directPhotoBoundaryGeometry.boundary, directPhotoBoundary,
  "a stable photo-space cutaneous outline does not fall back to a face-curvature-distorted surface projection");

const surfaceCandidateModel: Vec3[] = [
  [0.1, 0.5, 0], [0.25, 0.42, 0], [0.4, 0.34, 0], [0.5, 0.32, 0],
  [0.6, 0.34, 0], [0.75, 0.42, 0], [0.9, 0.5, 0], [0.75, 0.58, 0],
  [0.6, 0.66, 0], [0.5, 0.68, 0], [0.4, 0.66, 0], [0.25, 0.58, 0], [0.1, 0.5, 0],
];
const surfaceCandidateRefs = pointsToSurfaceRefs(surfaceCandidateModel, vertices, triangles);
const surfaceEndpointRefs = pointsToSurfaceRefs([surfaceCandidateModel[0], surfaceCandidateModel[6]], vertices, triangles);
const surfaceCenterRefs = pointsToSurfaceRefs([[0.5, 0.5, 0]], vertices, triangles);
const surfaceGeometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [],
  centerRef: surfaceCenterRefs[0],
  boundaryRefs: [],
  candidateRefs: surfaceCandidateRefs,
  endpointRefs: surfaceEndpointRefs,
  candidateType: "fusiform",
});
assert.equal(surfaceGeometry.candidateProjection.surfaceConstrained, true);
assert.equal(surfaceGeometry.candidateProjection.valid, true);
assert.equal(surfaceGeometry.candidateProjection.smoothingMode, "globalBezier");
assert.equal(surfaceGeometry.candidateProjection.smoothingDiagnostics?.ok, true);

const photoCanonicalBoundaryRefs = pointsToSurfaceRefs([
  [0.46, 0.39, 0], [0.54, 0.39, 0], [0.54, 0.61, 0], [0.46, 0.61, 0],
], vertices, triangles);
const photoCanonicalGeometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [],
  centerRef: surfaceCenterRefs[0],
  boundaryRefs: photoCanonicalBoundaryRefs,
  candidateRefs: surfaceCandidateRefs,
  endpointRefs: surfaceEndpointRefs,
  candidateType: "fusiform",
  candidateAspectRatio: 4,
  candidateTipAngleDeg: 30,
});
assert.equal(photoCanonicalGeometry.candidateProjection.smoothingMode, "photoCanonical",
  "product geometry prefers a standard photo-space fusiform when every point maps to visible facial surface");
assert.equal(photoCanonicalGeometry.candidateProjection.valid, true);
assert.equal(photoCanonicalGeometry.candidateProjection.smoothingDiagnostics?.photoBoundaryOutsideCount, 0,
  "the standard photo geometry expands symmetrically until every projected lesion-boundary point is enclosed");
assert.equal(photoCanonicalGeometry.candidateProjection.smoothingDiagnostics?.photoSurfaceOutsideCount, 0,
  "the standard photo geometry is accepted only while all samples remain on visible facial triangles");
assert.ok((photoCanonicalGeometry.candidateProjection.smoothingDiagnostics?.photoCanonicalScale || 1) > 1,
  "photo-space coverage correction is explicit and auditable instead of silently clipping the boundary");
assert.ok(Math.abs(
  (photoCanonicalGeometry.endpoints[0][0] + photoCanonicalGeometry.endpoints[1][0]) * 0.5
    - photoCanonicalGeometry.center![0],
) < 1e-6 && Math.abs(
  (photoCanonicalGeometry.endpoints[0][1] + photoCanonicalGeometry.endpoints[1][1]) * 0.5
    - photoCanonicalGeometry.center![1],
) < 1e-6, "photo-canonical tips remain symmetric around the detector-confirmed center");
assert.ok(Math.abs(
  Number(photoCanonicalGeometry.candidateProjection.smoothingDiagnostics?.candidateLength)
    / Number(photoCanonicalGeometry.candidateProjection.smoothingDiagnostics?.maxWidth) - 4,
) < 1e-6, "photo-canonical correction preserves the candidate's requested aspect ratio");
const photoCanonicalUpper = photoCanonicalGeometry.fusiformRendering!.outline.slice(0, 33);
const photoCanonicalHalfLength = Number(photoCanonicalGeometry.candidateProjection.smoothingDiagnostics?.candidateLength) / 2;
const photoCanonicalHalfWidth = Number(photoCanonicalGeometry.candidateProjection.smoothingDiagnostics?.maxWidth) / 2;
const quarterProfilePoint = photoCanonicalUpper.reduce((best, point) => (
  Math.abs(point[0] - (photoCanonicalGeometry.center![0] - photoCanonicalHalfLength / 2))
    < Math.abs(best[0] - (photoCanonicalGeometry.center![0] - photoCanonicalHalfLength / 2)) ? point : best
));
const quarterProfileFullness = Math.abs(quarterProfilePoint[1] - photoCanonicalGeometry.center![1])
  / photoCanonicalHalfWidth;
assert.ok(quarterProfileFullness > 0.74,
  `photo-canonical fusiform moves curvature away from the crown while filling the quarter profile (${quarterProfileFullness})`);
const photoCanonicalUpperCurves = photoCanonicalGeometry.fusiformRendering!.upperCurves;
const cubicSecondDerivative = (curve: Vec3[], atEnd: boolean) => atEnd
  ? [0, 1].map((axis) => 6 * (curve[3][axis] - 2 * curve[2][axis] + curve[1][axis]))
  : [0, 1].map((axis) => 6 * (curve[2][axis] - 2 * curve[1][axis] + curve[0][axis]));
for (let index = 0; index < photoCanonicalUpperCurves.length - 1; index += 1) {
  const previousSecond = cubicSecondDerivative(photoCanonicalUpperCurves[index], true);
  const nextSecond = cubicSecondDerivative(photoCanonicalUpperCurves[index + 1], false);
  assert.ok(Math.hypot(
    previousSecond[0] - nextSecond[0],
    previousSecond[1] - nextSecond[1],
  ) < 1e-6, `photo-canonical segment ${index + 1} preserves curvature continuity`);
}
const crownSecondDerivative = cubicSecondDerivative(photoCanonicalUpperCurves[1], true);
const normalizedCrownCurvature = Math.abs(crownSecondDerivative[1]) / photoCanonicalHalfWidth / (0.5 ** 2);
assert.ok(normalizedCrownCurvature < 1.2,
  `the widest crown remains gently rounded instead of retaining the former diamond-like bend (${normalizedCrownCurvature})`);
const firstPhotoCanonicalCurve = photoCanonicalUpperCurves[0];
const tipHalfAngleDeg = Math.atan2(
  Math.abs(firstPhotoCanonicalCurve[1][1] - firstPhotoCanonicalCurve[0][1]),
  Math.abs(firstPhotoCanonicalCurve[1][0] - firstPhotoCanonicalCurve[0][0]),
) * 180 / Math.PI;
assert.ok(Math.abs(tipHalfAngleDeg * 2 - 30) < 1e-6,
  "curvature smoothing preserves the requested 30-degree included tip angle");
const photoCanonicalWidths = photoCanonicalUpper.map((point) => Math.abs(
  point[1] - photoCanonicalGeometry.center![1],
));
const widestIndex = photoCanonicalWidths.indexOf(Math.max(...photoCanonicalWidths));
assert.equal(widestIndex, Math.floor(photoCanonicalWidths.length / 2),
  "the smoother profile keeps one unique maximum at the lesion center");
for (let index = 1; index <= widestIndex; index += 1) {
  assert.ok(photoCanonicalWidths[index] >= photoCanonicalWidths[index - 1] - 1e-6,
    "the smoother profile expands monotonically from the first tip");
}
for (let index = widestIndex + 1; index < photoCanonicalWidths.length; index += 1) {
  assert.ok(photoCanonicalWidths[index] <= photoCanonicalWidths[index - 1] + 1e-6,
    "the smoother profile tapers monotonically to the second tip");
}

const foreheadGapLandmarks = Array.from({ length: 468 }, () => [200, 250, 0] as Vec3);
foreheadGapLandmarks[0] = [100, 220, 0];
foreheadGapLandmarks[1] = [300, 220, 0];
foreheadGapLandmarks[2] = [100, 400, 0];
foreheadGapLandmarks[10] = [200, 80, 0];
for (const index of [9, 8, 107, 336]) foreheadGapLandmarks[index] = [200, 200, 0];
const foreheadGapFit = buildPhotoSurfaceCanonicalFusiform({
  sourceCandidate: surfaceProjectedFusiform,
  sourceEndpoints: [[120, 160, 0], [280, 160, 0]],
  center: [200, 160, 0],
  boundary: [[190, 150, 0], [210, 150, 0], [210, 170, 0], [190, 170, 0]],
  aspectRatio: 4,
  tipAngleDeg: 30,
  landmarks: foreheadGapLandmarks,
  triangles: [[0, 1, 2]],
  skinVisible: () => true,
  axisHint: [1, 0],
});
assert.ok(foreheadGapFit.fit,
  "an upper-forehead outline may bridge MediaPipe's known mesh cutoff when it remains inside the head envelope");
assert.ok((foreheadGapFit.diagnostics.photoSurfaceMeshOutsideCount || 0) > 0);
assert.equal(foreheadGapFit.diagnostics.photoSurfaceOutsideCount, 0,
  "the forehead-only fallback is auditable instead of silently disabling the mesh gate");
assert.equal(foreheadGapFit.diagnostics.photoCanonicalAxisSource, "nearest_projected_rstl");
const skinSupportedUpperForeheadFit = buildPhotoSurfaceCanonicalFusiform({
  sourceCandidate: surfaceProjectedFusiform,
  sourceEndpoints: [[220, 120, 0], [380, 120, 0]],
  center: [300, 120, 0],
  boundary: [[292, 112, 0], [308, 112, 0], [308, 128, 0], [292, 128, 0]],
  aspectRatio: 4,
  tipAngleDeg: 30,
  landmarks: foreheadGapLandmarks,
  triangles: [[0, 1, 2]],
  skinVisible: () => true,
  axisHint: [1, 0],
});
assert.ok(skinSupportedUpperForeheadFit.fit,
  "reliable photo-skin evidence may extend an upper-forehead candidate beyond the fixed head ellipse");
const unsupportedUpperForeheadFit = buildPhotoSurfaceCanonicalFusiform({
  sourceCandidate: surfaceProjectedFusiform,
  sourceEndpoints: [[220, 120, 0], [380, 120, 0]],
  center: [300, 120, 0],
  boundary: [[292, 112, 0], [308, 112, 0], [308, 128, 0], [292, 128, 0]],
  aspectRatio: 4,
  tipAngleDeg: 30,
  landmarks: foreheadGapLandmarks,
  triangles: [[0, 1, 2]],
  skinVisible: () => false,
  axisHint: [1, 0],
});
assert.equal(unsupportedUpperForeheadFit.fit, null,
  "the upper-forehead extension remains blocked without either mesh, head-envelope or photo-skin evidence");
const upperForeheadRstl = [{ pts: [[200, 100, 0], [400, 100, 0]] as Vec3[] }];
assert.equal(projectedRstlUpperForeheadSupportsPoint([300, 120, 0], upperForeheadRstl), true,
  "a point below the locally topmost visible RSTL is supported by the requested forehead boundary");
assert.equal(projectedRstlUpperForeheadSupportsPoint([300, 90, 0], upperForeheadRstl), false,
  "a point crossing above the locally topmost visible RSTL remains blocked");
assert.equal(projectedRstlUpperForeheadSupportsPoint([450, 120, 0], upperForeheadRstl), false,
  "RSTL support does not extrapolate beyond an actually visible line segment");
const rstlSupportedUpperForeheadFit = buildPhotoSurfaceCanonicalFusiform({
  sourceCandidate: surfaceProjectedFusiform,
  sourceEndpoints: [[220, 120, 0], [380, 120, 0]],
  center: [300, 120, 0],
  boundary: [[292, 112, 0], [308, 112, 0], [308, 128, 0], [292, 128, 0]],
  aspectRatio: 4,
  tipAngleDeg: 30,
  landmarks: foreheadGapLandmarks,
  triangles: [[0, 1, 2]],
  skinVisible: () => false,
  rstlBoundaryVisible: (point) => projectedRstlUpperForeheadSupportsPoint(point, upperForeheadRstl),
  axisHint: [1, 0],
});
assert.ok(rstlSupportedUpperForeheadFit.fit,
  "a forehead candidate may bridge the MediaPipe cutoff when its full outline stays below the local outer RSTL");
assert.ok(Number(rstlSupportedUpperForeheadFit.diagnostics.photoSurfaceMeshOutsideCount) > 0);
assert.equal(
  rstlSupportedUpperForeheadFit.diagnostics.photoRstlSupportedMeshOutsideCount,
  rstlSupportedUpperForeheadFit.diagnostics.photoSurfaceMeshOutsideCount,
  "every recovered mesh-outside point is explicitly attributable to the local upper RSTL",
);
const lowerFaceMeshGapFit = buildPhotoSurfaceCanonicalFusiform({
  sourceCandidate: surfaceProjectedFusiform,
  sourceEndpoints: [[120, 320, 0], [280, 320, 0]],
  center: [200, 320, 0],
  boundary: [[190, 310, 0], [210, 310, 0], [210, 330, 0], [190, 330, 0]],
  aspectRatio: 4,
  tipAngleDeg: 30,
  landmarks: foreheadGapLandmarks,
  triangles: [[0, 1, 2]],
  skinVisible: () => true,
  axisHint: [1, 0],
});
assert.equal(lowerFaceMeshGapFit.fit, null,
  "mesh gaps below the forehead are not reclassified as skin because they may be eyes, nostrils or mouth");
assert.ok(lowerFaceMeshGapFit.diagnosticFit,
  "a surface-rejected diagnostic retains the actual boundary-enclosing geometry that failed the gate");
assert.equal(lowerFaceMeshGapFit.diagnostics.photoBoundaryOutsideCount, 0,
  "the rejected audit geometry exists only after the lesion boundary has been fully enclosed");
assert.equal(lowerFaceMeshGapFit.visibilityLimitedFit, null,
  "an internal lower-face mesh gap cannot be relabelled as a harmless view occlusion");
assert.equal(lowerFaceMeshGapFit.diagnostics.reason, "photo_surface_exit");
const boundaryNotEnclosedFit = buildPhotoSurfaceCanonicalFusiform({
  sourceCandidate: surfaceProjectedFusiform,
  sourceEndpoints: [[120, 320, 0], [280, 320, 0]],
  center: [200, 320, 0],
  boundary: [[20, 140, 0], [380, 140, 0], [380, 500, 0], [20, 500, 0]],
  aspectRatio: 4,
  tipAngleDeg: 30,
  landmarks: foreheadGapLandmarks,
  triangles: [[0, 1, 2]],
  skinVisible: () => true,
  axisHint: [1, 0],
});
assert.equal(boundaryNotEnclosedFit.diagnostics.reason, "photo_boundary_not_enclosed");
assert.equal(boundaryNotEnclosedFit.diagnosticFit, null,
  "an outline that cannot enclose the lesion is withheld instead of being shown as an undersized red candidate");

const silhouetteLandmarks = Array.from({ length: 468 }, () => [200, 250, 0] as Vec3);
silhouetteLandmarks[0] = [100, 150, 0];
silhouetteLandmarks[1] = [300, 150, 0];
silhouetteLandmarks[2] = [300, 350, 0];
silhouetteLandmarks[3] = [100, 350, 0];
silhouetteLandmarks[10] = [200, 150, 0];
for (const index of [9, 8, 107, 336]) silhouetteLandmarks[index] = [200, 150, 0];
const faceOvalIndices = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
faceOvalIndices.forEach((landmarkIndex, index) => {
  const angle = index / faceOvalIndices.length * Math.PI * 2 - Math.PI / 2;
  silhouetteLandmarks[landmarkIndex] = [
    200 + Math.cos(angle) * 100,
    250 + Math.sin(angle) * 100,
    0,
  ];
});
// A lower-jaw photo can have a conservative head ellipse that extends beyond
// the actual triangulated face surface. That ellipse must not decide whether a
// single clipped tip is a legitimate view-limited reference.
silhouetteLandmarks[467] = [400, 450, 0];
const visibilityLimitedSource = Array.from({ length: 13 }, (_, index) => {
  const angle = index / 12 * Math.PI * 2;
  return [260 + Math.cos(angle) * 120, 250 + Math.sin(angle) * 40, 0] as Vec3;
});
const visibilityLimitedInput = {
  sourceCandidate: visibilityLimitedSource,
  sourceEndpoints: [[140, 250, 0], [380, 250, 0]] as Vec3[],
  center: [260, 250, 0] as Vec3,
  boundary: [[248, 240, 0], [272, 240, 0], [272, 260, 0], [248, 260, 0]] as Vec3[],
  aspectRatio: 3,
  tipAngleDeg: 30,
  landmarks: silhouetteLandmarks,
  triangles: [[0, 1, 2], [0, 2, 3]] as [number, number, number][],
  skinVisible: () => true,
  axisHint: [1, 0] as const,
};
const visibilityLimitedStandard = buildPhotoSurfaceCanonicalFusiform(visibilityLimitedInput);
assert.equal(visibilityLimitedStandard.fit, null,
  "a standard candidate is not falsely classified as fully visible at the face silhouette");
assert.ok(visibilityLimitedStandard.visibilityLimitedFit,
  "one contiguous hidden tip may retain the complete standard geometry as a view-limited reference");
assert.equal(visibilityLimitedStandard.diagnostics.photoVisibilityLimitedEligible, true);
assert.equal(visibilityLimitedStandard.visibilityLimitedFit?.visibleSegments?.length, 1,
  "view clipping produces one open visible run instead of reconnecting across the hidden face region");
assert.ok(Number(visibilityLimitedStandard.diagnostics.photoVisibleFraction) >= 0.55
  && Number(visibilityLimitedStandard.diagnostics.photoVisibleFraction) < 1);
assert.equal(inspectPhotoCandidateProjection(
  visibilityLimitedStandard.visibilityLimitedFit!.outline,
  "fusiform",
).valid, true, "the complete hidden-plus-visible geometry passes self-intersection, pinch and fold gates before clipping");
assert.ok(Math.abs(
  Number(visibilityLimitedStandard.diagnostics.candidateLength)
    / Number(visibilityLimitedStandard.diagnostics.maxWidth) - 3,
) < 1e-6, "view clipping does not change the underlying standard 3:1 geometry");
assert.ok(Math.abs(
  (visibilityLimitedStandard.endpoints[0][0] + visibilityLimitedStandard.endpoints[1][0]) * 0.5 - 260,
) < 1e-6, "hidden geometry remains symmetric around the detector-confirmed lesion center");
assert.ok(Number(visibilityLimitedStandard.diagnostics.photoHeadOutsideCount)
  < Number(visibilityLimitedStandard.diagnostics.photoSurfaceOutsideCount),
"the fixture proves that the fixed head ellipse overestimates the visible lower-jaw surface");
const halfVisibleReference = buildPhotoSurfaceCanonicalFusiform({
  ...visibilityLimitedInput,
  sourceCandidate: Array.from({ length: 13 }, (_, index) => {
    const angle = index / 12 * Math.PI * 2;
    return [298 + Math.cos(angle) * 120, 250 + Math.sin(angle) * 40, 0] as Vec3;
  }),
  sourceEndpoints: [[178, 250, 0], [418, 250, 0]],
  center: [298, 250, 0],
  boundary: [[286, 246, 0], [298, 246, 0], [298, 254, 0], [286, 254, 0]],
});
assert.ok(Number(halfVisibleReference.diagnostics.photoVisibleFraction) >= 0.45
  && Number(halfVisibleReference.diagnostics.photoVisibleFraction) < 0.55,
"the regression fixture keeps approximately half of the standard fusiform visible");
assert.ok(halfVisibleReference.visibilityLimitedFit,
  "an approximately half-visible candidate with one hidden tip remains a blue view-limited reference");
const sideClippedReference = buildPhotoSurfaceCanonicalFusiform({
  ...visibilityLimitedInput,
  sourceCandidate: Array.from({ length: 13 }, (_, index) => {
    const angle = index / 12 * Math.PI * 2;
    return [295 + Math.cos(angle) * 30, 250 + Math.sin(angle) * 80, 0] as Vec3;
  }),
  sourceEndpoints: [[295, 170, 0], [295, 330, 0]],
  center: [295, 250, 0],
  boundary: [[287, 240, 0], [298, 240, 0], [298, 260, 0], [287, 260, 0]],
  axisHint: [0, 1],
});
assert.equal(sideClippedReference.diagnostics.photoHiddenTipCount, 0,
  "the face-edge fixture keeps both lengthwise tips visible while one lateral half leaves the face");
assert.ok(sideClippedReference.visibilityLimitedFit,
  "a single side-clipped half remains a view-limited reference even when neither lengthwise tip is hidden");
const boundaryAndCandidateClippedReference = buildPhotoSurfaceCanonicalFusiform({
  ...visibilityLimitedInput,
  sourceCandidate: Array.from({ length: 13 }, (_, index) => {
    const angle = index / 12 * Math.PI * 2;
    return [295 + Math.cos(angle) * 30, 250 + Math.sin(angle) * 80, 0] as Vec3;
  }),
  sourceEndpoints: [[295, 170, 0], [295, 330, 0]],
  center: [295, 250, 0],
  boundary: [[287, 240, 0], [307, 240, 0], [307, 260, 0], [287, 260, 0]],
  axisHint: [0, 1],
});
assert.ok(Number(boundaryAndCandidateClippedReference.diagnostics.photoBoundaryOutsideCount) === 0,
  "the canonical outline still fully encloses the recorded lesion geometry before visibility clipping");
assert.ok(boundaryAndCandidateClippedReference.visibilityLimitedFit,
  "a lesion boundary touching the outer face silhouette uses the same blue view-limited reference instead of an internal-gap rejection");
const metricLengthReference = buildPhotoSurfaceCanonicalFusiform({
  ...visibilityLimitedInput,
  sourceCandidate: Array.from({ length: 13 }, (_, index) => {
    const angle = index / 12 * Math.PI * 2;
    return [200 + Math.cos(angle) * 10, 250 + Math.sin(angle) * 3, 0] as Vec3;
  }),
  sourceEndpoints: [[190, 250, 0], [210, 250, 0]],
  center: [200, 250, 0],
  boundary: [[180, 235, 0], [220, 235, 0], [220, 265, 0], [180, 265, 0]],
  axisHint: [1, 0],
  candidateLengthPx: 180,
} as any);
assert.ok(metricLengthReference.fit,
  "a face-edge endpoint projection cannot shrink a declared photo candidate until it no longer encloses the lesion boundary");
assert.ok(Number(metricLengthReference.diagnostics.candidateLength) >= 180,
  "photo canonical geometry keeps at least the metric candidate length supplied by the workflow");
const belowReferenceFloorVisibility = buildPhotoSurfaceCanonicalFusiform({
  ...visibilityLimitedInput,
  aspectRatio: 2.1,
});
assert.equal(belowReferenceFloorVisibility.visibilityLimitedFit, null,
  "view clipping cannot bypass the existing 2.2:1 lower floor for nonstandard references");
const skippedRatiosForVisibilityLimited = attemptConstrainedPhotoReferences({
  input: visibilityLimitedInput,
  standardAttempt: visibilityLimitedStandard,
  standardAspectRatio: 3,
  minimumLengthScale: 0.5,
});
assert.deepEqual(skippedRatiosForVisibilityLimited.attempts, [],
  "a valid standard view-limited reference is preferred over shortening the candidate ratio");
const bothTipsHiddenSource = Array.from({ length: 13 }, (_, index) => {
  const angle = index / 12 * Math.PI * 2;
  return [200 + Math.cos(angle) * 120, 250 + Math.sin(angle) * 40, 0] as Vec3;
});
const bothTipsHidden = buildPhotoSurfaceCanonicalFusiform({
  ...visibilityLimitedInput,
  sourceCandidate: bothTipsHiddenSource,
  sourceEndpoints: [[80, 250, 0], [320, 250, 0]],
  center: [200, 250, 0],
  boundary: [[188, 240, 0], [212, 240, 0], [212, 260, 0], [188, 260, 0]],
});
assert.equal(bothTipsHidden.visibilityLimitedFit, null,
  "two disconnected hidden tips are not presented as one trustworthy view-limited segment");
assert.ok(Number(bothTipsHidden.diagnostics.photoVisibleSegmentCount) > 1,
  "multiple visible runs remain explicit in diagnostics instead of being joined across hidden regions");

const constrainedLandmarks: Vec3[] = [
  [100, 150, 0], [300, 150, 0], [300, 350, 0], [100, 350, 0],
];
const constrainedSource = Array.from({ length: 13 }, (_, index) => {
  const angle = index / 12 * Math.PI * 2;
  return [200 + Math.cos(angle) * 120, 250 + Math.sin(angle) * 40, 0] as Vec3;
});
const constrainedInput = {
  sourceCandidate: constrainedSource,
  sourceEndpoints: [[80, 250, 0], [320, 250, 0]] as Vec3[],
  center: [200, 250, 0] as Vec3,
  boundary: [[185, 240, 0], [215, 240, 0], [215, 260, 0], [185, 260, 0]] as Vec3[],
  aspectRatio: 3,
  tipAngleDeg: 30,
  landmarks: constrainedLandmarks,
  triangles: [[0, 1, 2], [0, 2, 3]] as [number, number, number][],
  skinVisible: () => true,
  axisHint: [1, 0] as const,
};
const constrainedStandard = buildPhotoSurfaceCanonicalFusiform(constrainedInput);
assert.equal(constrainedStandard.diagnostics.reason, "photo_surface_exit",
  "the standard 3:1 plan remains blocked when it leaves usable facial surface");
assert.ok(constrainedStandard.diagnosticFit,
  "the rejected standard plan remains available as auditable geometry without implying a red display entitlement");
assert.equal(constrainedStandard.visibilityLimitedFit, null,
  "an interior mesh exit cannot bypass the surface gate through view clipping");
const constrainedReference = buildPhotoSurfaceCanonicalFusiform({
  ...constrainedInput,
  referenceAspectRatio: 2.2,
  minimumLengthScale: 0.5,
});
assert.ok(constrainedReference.fit,
  "a bounded 2.2:1 reference can be shown when it remains on surface and still covers the target boundary");
assert.equal(constrainedReference.diagnostics.photoCanonicalReference, true);
assert.ok(Math.abs(Number(constrainedReference.diagnostics.photoCanonicalAspectRatio) - 2.2) < 1e-6);
assert.equal(constrainedReference.diagnostics.photoBoundaryOutsideCount, 0);
const constrainedSequence = attemptConstrainedPhotoReferences({
  input: constrainedInput,
  standardAttempt: constrainedStandard,
  standardAspectRatio: 3,
  minimumLengthScale: 0.5,
});
assert.deepEqual(
  constrainedSequence.attempts.map((attempt) => attempt.aspectRatio),
  [2.8, 2.6, 2.4, 2.2].slice(0, constrainedSequence.attempts.length),
  "surface-limited recovery tries the 2.8-to-2.2 sequence in order until one ratio fits",
);
assert.equal(constrainedSequence.attempts.at(-1)?.ok, true);
assert.ok(constrainedSequence.fitAttempt?.fit,
  "the first passing constrained ratio is retained with auditable preceding failures");
const narrowLandmarks = [...constrainedLandmarks];
narrowLandmarks[0] = [160, 190, 0];
narrowLandmarks[1] = [240, 190, 0];
narrowLandmarks[2] = [240, 310, 0];
narrowLandmarks[3] = [160, 310, 0];
const alwaysOutsideInput = { ...constrainedInput, landmarks: narrowLandmarks, skinVisible: () => false };
const alwaysOutsideStandard = buildPhotoSurfaceCanonicalFusiform(alwaysOutsideInput);
const allFailedConstrainedSequence = attemptConstrainedPhotoReferences({
  input: alwaysOutsideInput,
  standardAttempt: alwaysOutsideStandard,
  standardAspectRatio: 3,
  minimumLengthScale: 0.5,
});
assert.deepEqual(allFailedConstrainedSequence.attempts.map((attempt) => attempt.aspectRatio), [2.8, 2.6, 2.4, 2.2]);
assert.ok(allFailedConstrainedSequence.attempts.every((attempt) => !attempt.ok
  && attempt.reason === "photo_surface_exit"));
assert.equal(allFailedConstrainedSequence.fitAttempt, null,
  "when every constrained ratio still leaves usable facial skin, all four failures remain explicit");

const offCenterSelectionRefs = pointsToSurfaceRefs([[0.42, 0.5, 0]], vertices, triangles);
const offCenterSurfaceGeometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [],
  centerRef: offCenterSelectionRefs[0],
  boundaryRefs: [],
  candidateRefs: surfaceCandidateRefs,
  endpointRefs: surfaceEndpointRefs,
  candidateType: "fusiform",
});
assert.equal(offCenterSurfaceGeometry.candidateProjection.smoothingDiagnostics?.ok, true,
  "photo fallback is revalidated after centering an asymmetric projected candidate");
assert.ok(["globalBezier", "segmentedBezier"].includes(offCenterSurfaceGeometry.candidateProjection.smoothingMode || ""),
  "a bounded centered fallback may use either direct cubic strategy");
const offCenterCandidate = offCenterSurfaceGeometry.candidate;
const offCenterFarTipIndex = (offCenterCandidate.length - 1) / 2;
const offCenterRenderedMidpointX = (
  offCenterSurfaceGeometry.endpoints[0][0] + offCenterSurfaceGeometry.endpoints[1][0]
) * 0.5;
assert.ok(Math.abs(offCenterSurfaceGeometry.center![0] - 268) < 1e-6,
  "the visible lesion center remains the detector-confirmed point instead of moving to the fusiform midpoint");
assert.ok(Math.abs(offCenterSurfaceGeometry.planningCenter![0] - offCenterSurfaceGeometry.center![0]) < 1e-6);
assert.ok(Math.abs(offCenterSurfaceGeometry.lesionToPlanningCenterPx || 0) < 1e-6,
  "a displayed fallback cannot retain an imported or stale candidate-center mismatch");
assert.ok(Math.abs(
  (offCenterCandidate[0][0] + offCenterCandidate[offCenterFarTipIndex][0]) * 0.5
    - offCenterSurfaceGeometry.center![0],
) < 1e-6 && Math.abs(offCenterRenderedMidpointX - offCenterSurfaceGeometry.center![0]) < 1e-6,
"both rendered tips and the smoothed outline remain symmetric around the detector-confirmed center");
assert.ok(surfaceGeometry.fusiformRendering, "successful fusiform geometry exposes direct-render cubic controls");
const surfaceGeometryFarTip = (surfaceGeometry.candidate.length - 1) / 2;
assert.deepEqual(surfaceGeometry.endpoints, [surfaceGeometry.candidate[0], surfaceGeometry.candidate[surfaceGeometryFarTip]],
  "visible endpoint controls remain on the original surface-projected candidate tips");
const surfaceGeometryPolygon = surfaceGeometry.candidate.slice(0, -1);
const surfaceGeometryLower = [
  surfaceGeometryPolygon[0],
  ...surfaceGeometryPolygon.slice(surfaceGeometryFarTip + 1).reverse(),
  surfaceGeometryPolygon[surfaceGeometryFarTip],
];
const surfaceGeometryMiddleIndex = surfaceGeometryFarTip / 2;
assert.ok(Math.abs((surfaceGeometry.candidate[surfaceGeometryMiddleIndex][0]
  + surfaceGeometryLower[surfaceGeometryMiddleIndex][0]) * 0.5 - surfaceGeometry.center![0]) < 1e-6
  && Math.abs((surfaceGeometry.candidate[surfaceGeometryMiddleIndex][1]
    + surfaceGeometryLower[surfaceGeometryMiddleIndex][1]) * 0.5 - surfaceGeometry.center![1]) < 1e-6,
"global low-frequency fit keeps the fusiform midpoint on the lesion center");
const mappedSurfaceCandidate = surfaceCandidateRefs.length
  ? surfaceCandidateModel.map(([x, y]) => [100 + x * 400, 100 + y * 400])
  : [];
const sourceMinX = Math.min(...mappedSurfaceCandidate.map((point) => point[0]));
const sourceMaxX = Math.max(...mappedSurfaceCandidate.map((point) => point[0]));
const sourceMinY = Math.min(...mappedSurfaceCandidate.map((point) => point[1]));
const sourceMaxY = Math.max(...mappedSurfaceCandidate.map((point) => point[1]));
assert.ok(surfaceGeometry.candidate.every((point) => point[0] >= sourceMinX - 1e-6 && point[0] <= sourceMaxX + 1e-6
  && point[1] >= sourceMinY - 1e-6 && point[1] <= sourceMaxY + 1e-6),
"rendered smoothing cannot expand beyond the original surface-projected envelope");

const offCenterRefs = pointsToSurfaceRefs([[0.1, 0.1, 0]], vertices, triangles);
const farOffSelectionGeometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [],
  centerRef: offCenterRefs[0],
  boundaryRefs: [],
  candidateRefs: surfaceCandidateRefs,
  endpointRefs: surfaceEndpointRefs,
  candidateType: "fusiform",
});
assert.equal(farOffSelectionGeometry.candidateProjection.valid, true,
  "a recentered fallback may remain visible in the explicitly supported upper-forehead envelope");
assert.equal(farOffSelectionGeometry.center?.[0], 140,
  "even a large legacy mismatch cannot overwrite the visible lesion center");
assert.ok(Math.abs(farOffSelectionGeometry.planningCenter![0] - farOffSelectionGeometry.center![0]) < 1e-6);
assert.ok(Math.abs(farOffSelectionGeometry.lesionToPlanningCenterPx || 0) < 1e-6);
assert.ok(Math.abs(
  (farOffSelectionGeometry.endpoints[0][0] + farOffSelectionGeometry.endpoints[1][0]) * 0.5
    - farOffSelectionGeometry.center![0],
) < 1e-6, "even a large legacy mismatch is corrected before a fallback is displayed");

const lowerEdgeSelectionRefs = pointsToSurfaceRefs([[0.5, 0.92, 0]], vertices, triangles);
const lowerEdgeSurfaceGeometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [],
  centerRef: lowerEdgeSelectionRefs[0],
  boundaryRefs: [],
  candidateRefs: surfaceCandidateRefs,
  endpointRefs: surfaceEndpointRefs,
  candidateType: "fusiform",
});
assert.equal(lowerEdgeSurfaceGeometry.candidateProjection.valid, false,
  "centering a fallback cannot bypass the usable lower-face surface gate");
assert.ok(lowerEdgeSurfaceGeometry.candidateProjection.reasonCodes.includes("candidate_surface_exit"));
assert.ok(lowerEdgeSurfaceGeometry.diagnosticCandidate.length >= 8,
  "an integrated surface failure exposes the actual rejected fit instead of the raw source candidate");
assert.equal(
  lowerEdgeSurfaceGeometry.diagnosticCandidate,
  lowerEdgeSurfaceGeometry.diagnosticFusiformRendering?.outline,
  "the diagnostic renderer and diagnostic point set share one rejected geometry",
);

{
  const centerRef = pointsToSurfaceRefs([[0.25, 0.25, 0]], vertices, triangles)[0];
  const displayedAtlas = [{
    name: "displayed_local_rstl",
    region: "cheek",
    points: [[0, 0.65, 0.10], [0, 0.35, 0.40]] as [number, number, number][],
    postExpansionOffsetsFaceRatioSparse: [[0, 0, 0.05], [1, 0, -0.05]] as [number, number, number][],
  }];
  const direction = queryIncisionPhotoRstlDirection({
    centerRef,
    vertices,
    landmarks,
    surfaceLandmarks: landmarks,
    triangles,
    atlasLines: displayedAtlas,
  });
  assert.equal(direction?.source, "photo_projected_rstl_nearest_segment");
  assert.equal(direction?.line_id, "displayed_local_rstl");
  const modelCenter = surfaceRefToModelPoint(centerRef, vertices, triangles)!;
  const axis = direction?.vector as Vec3;
  const epsilon = 0.05;
  const axisRefs = pointsToSurfaceRefs([
    [modelCenter[0] - axis[0] * epsilon, modelCenter[1] - axis[1] * epsilon, 0],
    [modelCenter[0] + axis[0] * epsilon, modelCenter[1] + axis[1] * epsilon, 0],
  ], vertices, triangles);
  const projectedEndpoints = mapSurfaceRefs(axisRefs, landmarks, triangles).pts;
  const mappedRstl = mapAtlas(displayedAtlas, landmarks, triangles);
  assert.ok((projectedRstlDeviation(mapSurfaceRefs([centerRef], landmarks, triangles).pts[0], projectedEndpoints, mappedRstl) || 0) < 1e-4,
    "the inverse local surface mapping makes the generated center axis parallel to the nearest displayed RSTL tangent");

  const photoFallbackAligned = buildIncisionPhotoGeometry({
    landmarks,
    triangles,
    atlasLines: displayedAtlas,
    centerRef: offCenterSelectionRefs[0],
    boundaryRefs: [],
    candidateRefs: surfaceCandidateRefs,
    endpointRefs: surfaceEndpointRefs,
    candidateType: "fusiform",
  });
  assert.equal(photoFallbackAligned.candidateProjection.valid, true);
  assert.ok((photoFallbackAligned.projectedRstlDeviationDeg || 0) < 1e-4,
    "the centered photo fallback uses the nearest displayed RSTL tangent instead of retaining a stale source axis");
  assert.ok(Math.abs(
    (photoFallbackAligned.endpoints[0][0] + photoFallbackAligned.endpoints[1][0]) * 0.5
      - photoFallbackAligned.center![0],
  ) < 1e-6 && Math.abs(
    (photoFallbackAligned.endpoints[0][1] + photoFallbackAligned.endpoints[1][1]) * 0.5
      - photoFallbackAligned.center![1],
  ) < 1e-6, "RSTL alignment does not sacrifice endpoint symmetry around the lesion center");
}

{
  const surfaceLandmarks = landmarks.map(([x, y, z]) => [x, y + x * 0.2, z] as Vec3);
  const horizontalRefs = pointsToSurfaceRefs([[0.2, 0.5, 0], [0.8, 0.5, 0]], vertices, triangles);
  const atlasLines = [{ name: "local", region: "cheek", points: [[0, 0.3, 0.2], [1, 0.5, 0.3]] }];
  const aligned = buildIncisionPhotoGeometry({
    landmarks,
    surfaceLandmarks,
    triangles,
    atlasLines,
    centerRef: horizontalRefs[0],
    boundaryRefs: [],
    candidateRefs: horizontalRefs,
    endpointRefs: horizontalRefs,
  });
  assert.deepEqual(aligned.rstl, mapAtlas(atlasLines, landmarks, triangles),
    "incision RSTL remains byte-for-byte aligned with the live 2D mapping even when picking uses an extended surface");
}

const tipFold = inspectPhotoCandidateProjection([
  [0, 0, 0], [0.8, 0.5, 0], [2, 1, 0], [3.2, 0.5, 0], [4, 0, 0],
  [3.2, -0.5, 0], [2, -1, 0], [0.8, 0.4, 0], [0, 0, 0],
], "fusiform");
assert.equal(tipFold.valid, false, "same-side tip convergence is rejected before display");
assert.ok(tipFold.reasonCodes.includes("candidate_projection_tip_fold"));

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
assert.ok(Math.abs(strokeWidths.candidate - strokeWidths.rstl / 6) < 1e-9,
  "candidate incision line is half of the previous one-third RSTL line width");
assert.ok(strokeWidths.boundary < strokeWidths.rstl,
  "lesion boundary is thinner than the RSTL reference layer");
assert.ok(strokeWidths.candidateHalo < 2,
  "contrast halo no longer produces the former toy-like 8px stroke");
assert.equal(incisionPhotoEndpointRadius(strokeWidths.candidate) * 2, 6,
  "visible endpoint diameter stays at a fixed 6 CSS-pixel visual target");

assert.deepEqual(incisionPhotoLayerContract("cutaneous", "fusiform"), {
  expectedCandidateType: "fusiform",
  candidateTypeMatches: true,
  showDiameterEstimate: false,
});
assert.deepEqual(incisionPhotoLayerContract("subcutaneous", "linear"), {
  expectedCandidateType: "linear",
  candidateTypeMatches: true,
  showDiameterEstimate: true,
});
assert.equal(incisionPhotoLayerContract("cutaneous", "linear").candidateTypeMatches, false,
  "cutaneous photo planning reports a mismatched linear candidate contract");

assert.equal(incisionPhotoStatusPresentation({
  rstlLineCount: 159,
  candidateDisplayBlocked: true,
  engineeringBlockMessage: "candidate blocked",
  candidateProjectionValid: true,
  candidatePointCount: 0,
}).tone, "warning", "engineering candidate blocks must not be presented as ready");
assert.equal(incisionPhotoStatusPresentation({
  rstlLineCount: 159,
  candidateDisplayBlocked: false,
  engineeringBlockMessage: "",
  candidateProjectionValid: false,
  candidatePointCount: 0,
}).tone, "warning", "invalid photo projection must not be presented as ready");
assert.equal(incisionPhotoStatusPresentation({
  rstlLineCount: 159,
  candidateDisplayBlocked: false,
  engineeringBlockMessage: "",
  candidateProjectionValid: true,
  candidatePointCount: 20,
}).tone, "ready");
const sourceFallbackStatus = incisionPhotoStatusPresentation({
  rstlLineCount: 159,
  candidateDisplayBlocked: false,
  engineeringBlockMessage: "",
  candidateProjectionValid: true,
  candidatePointCount: 20,
  candidateSmoothingMode: "sourceFallback",
});
assert.equal(sourceFallbackStatus.tone, "warning");
assert.match(sourceFallbackStatus.message, /未完成平滑校正/);
const constrainedReferenceStatus = incisionPhotoStatusPresentation({
  rstlLineCount: 159,
  candidateDisplayBlocked: false,
  engineeringBlockMessage: "",
  candidateProjectionValid: true,
  candidatePointCount: 20,
  candidateSmoothingMode: "constrainedReference",
  candidateReferenceAspectRatio: 2.4,
});
assert.equal(constrainedReferenceStatus.tone, "warning");
assert.match(constrainedReferenceStatus.message, /受限参考候选.*2\.40:1.*不满足项目原定比例/);
const visibilityLimitedStatus = incisionPhotoStatusPresentation({
  rstlLineCount: 159,
  candidateDisplayBlocked: false,
  engineeringBlockMessage: "",
  candidateProjectionValid: true,
  candidatePointCount: 20,
  candidateSmoothingMode: "limitedVisibility",
  candidateReferenceAspectRatio: 3,
});
assert.equal(visibilityLimitedStatus.tone, "warning");
assert.equal(
  visibilityLimitedStatus.message,
  "已识别肿物边界，当前为视野受限参考，不能确认完整长度及不可见区域，请结合另一视角复核",
  "the canvas warning matches the agreed view-limited wording exactly",
);
const nonstandardVisibilityLimitedStatus = incisionPhotoStatusPresentation({
  rstlLineCount: 159,
  candidateDisplayBlocked: false,
  engineeringBlockMessage: "",
  candidateProjectionValid: true,
  candidatePointCount: 20,
  candidateSmoothingMode: "limitedVisibility",
  candidateReferenceAspectRatio: 2.8,
});
assert.equal(nonstandardVisibilityLimitedStatus.tone, "warning");
assert.match(nonstandardVisibilityLimitedStatus.message, /视野受限的非标准比例参考.*2\.80:1.*另一视角复核/);
assert.equal(incisionPhotoStatusPresentation({
  rstlLineCount: 159,
  candidateDisplayBlocked: false,
  engineeringBlockMessage: "",
  candidateProjectionValid: true,
  candidatePointCount: 0,
}).tone, "idle");

console.log("test_incision_photo_planning: file gate and surface-ref projection passed");
