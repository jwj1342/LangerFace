import assert from "node:assert/strict";

import {
  buildSubcutaneousDiameterEstimateRefs,
  buildIncisionPhotoGeometry,
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
  smoothSurfaceProjectedFusiform,
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
const rejectedSmoothingGeometry = buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines: [],
  centerRef: offCenterRefs[0],
  boundaryRefs: [],
  candidateRefs: surfaceCandidateRefs,
  endpointRefs: surfaceEndpointRefs,
  candidateType: "fusiform",
});
assert.equal(rejectedSmoothingGeometry.candidateProjection.valid, true,
  "a valid source candidate remains visible when the optional bounded global fit fails");
assert.equal(rejectedSmoothingGeometry.candidateProjection.smoothingMode, "sourceFallback");
assert.equal(rejectedSmoothingGeometry.candidateProjection.smoothingDiagnostics?.reason, "center_shift_exceeded");

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
assert.equal(incisionPhotoStatusPresentation({
  rstlLineCount: 159,
  candidateDisplayBlocked: false,
  engineeringBlockMessage: "",
  candidateProjectionValid: true,
  candidatePointCount: 0,
}).tone, "idle");

console.log("test_incision_photo_planning: file gate and surface-ref projection passed");
