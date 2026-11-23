import {
  bbox,
  clamp,
  dot,
  mul,
  norm,
  sub,
  type AnyRecord,
  type DirectionResult,
  type Triangle,
  type Vec3,
} from "./incisionToolCore.ts";

export const INCISION_LOCAL_RSTL_DIRECTION_SCHEMA = "incision-local-rstl-direction/v0.1";

interface AtlasLine {
  id?: string;
  name?: string;
  points?: Array<[number, number, number]>;
  points3d?: Vec3[];
}

interface SegmentSupport {
  lineId: string;
  lineIndex: number;
  segmentIndex: number;
  segmentT: number;
  point: Vec3;
  vector: Vec3;
  distance: number;
}

function canonicalAxis(vector: Vec3): Vec3 {
  for (const component of vector) {
    if (Math.abs(component) <= 1e-12) continue;
    return component < 0 ? mul(vector, -1) : vector;
  }
  return vector;
}

function atlasLinePoints(line: AtlasLine, verts: ArrayLike<number>[], tris: Triangle[]): Vec3[] {
  const points: Vec3[] = [];
  if (Array.isArray(line.points3d) && line.points3d.length) {
    for (const point of line.points3d) {
      if (Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)) {
        points.push([Number(point[0]), Number(point[1]), Number(point[2])]);
      }
    }
  } else {
    for (const raw of line.points || []) {
      if (!Array.isArray(raw) || raw.length < 3) continue;
      const [rawTri, rawU, rawV] = raw.map(Number);
      if (![rawTri, rawU, rawV].every(Number.isFinite)) continue;
      const triangle = tris[Math.round(rawTri)];
      if (!triangle) continue;
      const a = verts[triangle[0]], b = verts[triangle[1]], c = verts[triangle[2]];
      if (![a, b, c].every((vertex) => vertex?.length >= 3
        && Array.from(vertex).slice(0, 3).every(Number.isFinite))) continue;
      const w = 1 - rawU - rawV;
      points.push([
        rawU * a[0] + rawV * b[0] + w * c[0],
        rawU * a[1] + rawV * b[1] + w * c[1],
        rawU * a[2] + rawV * b[2] + w * c[2],
      ]);
    }
  }
  return points.filter((point, index) => index === 0 || Math.hypot(...sub(point, points[index - 1])) > 1e-12);
}

function nearestPointOnSegment(point: Vec3, start: Vec3, end: Vec3): { point: Vec3; t: number; distance: number } | null {
  const delta = sub(end, start);
  const lengthSquared = dot(delta, delta);
  if (!(lengthSquared > 1e-12)) return null;
  const t = clamp(dot(sub(point, start), delta) / lengthSquared, 0, 1);
  const nearest: Vec3 = [
    start[0] + delta[0] * t,
    start[1] + delta[1] * t,
    start[2] + delta[2] * t,
  ];
  return { point: nearest, t, distance: Math.hypot(...sub(point, nearest)) };
}

function emptyDirection(point: Vec3, source: string, reason: string): DirectionResult & AnyRecord {
  return {
    schema: INCISION_LOCAL_RSTL_DIRECTION_SCHEMA,
    point,
    vector: [1, 0, 0],
    angle_deg: 0,
    confidence: 0,
    source,
    nearest_distance: null,
    support_count: 0,
    angular_spread_deg: 0,
    confidence_reasons: [reason],
    line_id: null,
    line_index: null,
    segment_index: null,
    segment_t: null,
    nearest_point: null,
    equidistant_segment_count: 0,
  };
}

export function queryIncisionLocalRstlDirection(
  point: Vec3,
  verts: ArrayLike<number>[],
  tris: Triangle[],
  atlas: AnyRecord,
): DirectionResult & AnyRecord {
  const lines = Array.isArray(atlas?.lines) ? atlas.lines as AtlasLine[] : [];
  if (!lines.length) return emptyDirection(point, "rstl_atlas_empty", "empty_atlas");
  const supports: SegmentSupport[] = [];
  lines.forEach((line, lineIndex) => {
    const points = atlasLinePoints(line, verts, tris);
    for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
      const nearest = nearestPointOnSegment(point, points[segmentIndex], points[segmentIndex + 1]);
      if (!nearest) continue;
      supports.push({
        lineId: String(line.id || line.name || `rstl_line_${lineIndex}`),
        lineIndex,
        segmentIndex,
        segmentT: nearest.t,
        point: nearest.point,
        vector: canonicalAxis(norm(sub(points[segmentIndex + 1], points[segmentIndex]))),
        distance: nearest.distance,
      });
    }
  });
  if (!supports.length) {
    return emptyDirection(point, "rstl_atlas_no_valid_direction_support", "no_valid_direction_support");
  }
  supports.sort((left, right) => left.distance - right.distance
    || left.lineIndex - right.lineIndex
    || left.segmentIndex - right.segmentIndex);
  const selected = supports[0];
  const { lo, hi } = bbox(verts);
  const diagonal = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const maxDistance = Math.max(diagonal * 0.18, 1e-9);
  const numericalTieTolerance = Math.max(diagonal * 1e-9, 1e-12);
  const equidistant = supports.filter((support) => Math.abs(support.distance - selected.distance) <= numericalTieTolerance);
  const conflictingTie = equidistant.some((support) => support.lineIndex !== selected.lineIndex
    && Math.abs(dot(support.vector, selected.vector)) < 1 - 1e-9);
  const confidenceReasons: string[] = [];
  if (selected.distance >= maxDistance) confidenceReasons.push("nearest_atlas_support_far");
  else if (selected.distance >= maxDistance * 0.6) confidenceReasons.push("nearest_atlas_support_sparse");
  if (conflictingTie) confidenceReasons.push("equidistant_rstl_segments");
  let confidence = clamp(1 - selected.distance / maxDistance, 0, 1);
  if (conflictingTie) confidence = Math.min(confidence, 0.25);
  if (confidence < 0.35 && !confidenceReasons.length) confidenceReasons.push("low_direction_confidence");
  const atlasProvenance = String(atlas.provenance || atlas.personalization?.source || "bundled_standard_rstl_prior");
  const personalized = atlasProvenance.toLowerCase().includes("local-yolo")
    || atlasProvenance.toLowerCase().includes("personalized_rstl")
    || String(atlas.personalization?.algorithm || atlas.diagnostics?.algorithm || "").toLowerCase().includes("rstl-refinement");
  return {
    schema: INCISION_LOCAL_RSTL_DIRECTION_SCHEMA,
    point,
    vector: selected.vector,
    angle_deg: Math.atan2(selected.vector[1], selected.vector[0]) * 180 / Math.PI,
    confidence,
    source: personalized ? "personalized_rstl_atlas_nearest_segment" : "rstl_atlas_nearest_segment",
    nearest_distance: selected.distance,
    support_count: 1,
    angular_spread_deg: 0,
    confidence_reasons: confidenceReasons,
    line_id: selected.lineId,
    line_index: selected.lineIndex,
    segment_index: selected.segmentIndex,
    segment_t: selected.segmentT,
    nearest_point: selected.point,
    equidistant_segment_count: equidistant.length,
  };
}
