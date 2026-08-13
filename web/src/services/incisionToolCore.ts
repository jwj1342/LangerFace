import {
  REGION_BOUNDARY_X,
  REGION_BOUNDARY_Y,
  REGION_TRANSITION_REASONS,
  SENSITIVE_ANCHORS,
  SENSITIVE_MARGIN_SEGMENTS,
} from "./incisionToolRules.ts";
import {
  inspectPathPolygonRelation,
  pointInPolygon2d,
  resamplePolyline2d,
  type Point2,
} from "./incisionPathGeometry.ts";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Triangle = [number, number, number];
export type AnyRecord = Record<string, any>;

type AtlasPoint = [number, number, number];
type AtlasLine = { points?: AtlasPoint[]; points3d?: Vec3[] };
type AtlasPayload = {
  lines?: AtlasLine[];
  provenance?: string;
  personalization?: { source?: string; algorithm?: string };
  diagnostics?: { algorithm?: string };
};
type RegionConfidenceInput = {
  region: string;
  confidence: number;
  rawXY: Vec2;
  clippedXY: Vec2;
  nearbyLandmarks: string[];
  boundaryMargin: number;
};

const MEDIAPIPE_FACE_VERTEX_COUNT = 468;
const MEDIAPIPE_TOPOLOGY_OPENINGS = [
  { id: "left-eye-opening", indices: [33, 160, 158, 133, 153, 144], projectionBufferScale: 1 },
  { id: "right-eye-opening", indices: [362, 385, 387, 263, 373, 380], projectionBufferScale: 1 },
  {
    id: "oral-opening",
    indices: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
    projectionBufferScale: 1,
  },
] as const;

// Reuse the audited standard-atlas nostril aperture mask (v9) in normalized
// face coordinates. It is an engineering non-skin opening, not a clinical
// safety margin, and deliberately does not cover the surrounding nasal ala.
const STANDARD_RSTL_NOSTRIL_APERTURES = [
  { id: "left-nostril-opening", center: [0.405, 0.53] as Point2, radii: [0.034, 0.052] as Point2 },
  { id: "right-nostril-opening", center: [0.595, 0.53] as Point2, radii: [0.034, 0.052] as Point2 },
] as const;

export interface DirectionResult extends AnyRecord {
  point: Vec3;
  vector: Vec3;
  angle_deg: number;
  confidence: number;
  source: string;
  nearest_distance: number | null;
  support_count: number;
  angular_spread_deg: number;
  confidence_reasons: string[];
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: ArrayLike<number>, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (v: ArrayLike<number>): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [1, 0, 0];
};

function canonicalAxis(vector: Vec3): Vec3 {
  for (const component of vector) {
    if (Math.abs(component) <= 1e-12) continue;
    return component < 0 ? mul(vector, -1) : vector;
  }
  return vector;
}

export function bbox(verts: ArrayLike<number>[]): { lo: Vec3; hi: Vec3 } {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  return { lo, hi };
}

function pointSegmentDistance2d(point: Vec2, segment: Vec2[]): number {
  const [a, b] = segment;
  const ab = [b[0] - a[0], b[1] - a[1]];
  const denom = ab[0] * ab[0] + ab[1] * ab[1];
  if (denom <= 1e-12) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = clamp(((point[0] - a[0]) * ab[0] + (point[1] - a[1]) * ab[1]) / denom, 0, 1);
  const closest = [a[0] + t * ab[0], a[1] + t * ab[1]];
  return Math.hypot(point[0] - closest[0], point[1] - closest[1]);
}

function sensitiveMarginDistances(normalizedXY: Vec2, faceHeightMm = 180): Array<[string, number]> {
  const distances: Array<[string, number]> = [];
  for (const [name, anchor] of Object.entries(SENSITIVE_ANCHORS)) {
    const point = anchor as Vec2;
    distances.push([name, Math.hypot(normalizedXY[0] - point[0], normalizedXY[1] - point[1]) * faceHeightMm]);
  }
  for (const [name, segment] of Object.entries(SENSITIVE_MARGIN_SEGMENTS)) {
    distances.push([name, pointSegmentDistance2d(normalizedXY, segment as Vec2[]) * faceHeightMm]);
  }
  return distances;
}

export function unitsPerMmFromVertices(verts: ArrayLike<number>[], faceHeightMm = 180): number {
  const { lo, hi } = bbox(verts);
  const height = hi[1] - lo[1];
  return height > 1e-9 ? height / faceHeightMm : 1;
}

function regionBoundaryMarginNorm(normalizedXY: Vec2): number {
  const [nx, ny] = normalizedXY;
  const xMargin = Math.min(...REGION_BOUNDARY_X.map((boundary) => Math.abs(nx - boundary)));
  const yMargin = Math.min(...REGION_BOUNDARY_Y.map((boundary) => Math.abs(ny - boundary)));
  const edgeMargin = Math.min(nx, 1 - nx, ny, 1 - ny);
  return Math.min(xMargin, yMargin, edgeMargin);
}

function regionConfidenceReasons({ region, confidence, rawXY, clippedXY, nearbyLandmarks, boundaryMargin }: RegionConfidenceInput): string[] {
  const reasons = ["bbox_heuristic_region_classifier"];
  const [rawX, rawY] = rawXY;
  const [nx, ny] = clippedXY;
  if (rawX < 0 || rawX > 1 || rawY < 0 || rawY > 1) reasons.push("outside_canonical_face_bbox");
  if (Math.min(nx, 1 - nx, ny, 1 - ny) <= 0.02) reasons.push("near_canonical_face_edge");
  if (boundaryMargin <= 0.015) reasons.push("near_region_rule_boundary");
  if (confidence < 0.55) reasons.push("heuristic_region_low_confidence");
  if ((nearbyLandmarks || []).length) reasons.push("near_sensitive_free_margin");
  const regionTransitionReasons = REGION_TRANSITION_REASONS as Record<string, string>;
  if (regionTransitionReasons[region]) reasons.push(regionTransitionReasons[region]);
  return [...new Set(reasons)];
}

export function classifyRegion(point: ArrayLike<number>, verts: ArrayLike<number>[]): AnyRecord {
  const { lo, hi } = bbox(verts);
  const span = [Math.max(hi[0] - lo[0], 1e-9), Math.max(hi[1] - lo[1], 1e-9)];
  const rawNx = (point[0] - lo[0]) / span[0];
  const rawNy = (point[1] - lo[1]) / span[1];
  const nx = clamp(rawNx, 0, 1);
  const ny = clamp(rawNy, 0, 1);
  let region = "cheek", subunit = "midface", confidence = 0.64;
  if (ny >= 0.80) [region, subunit, confidence] = ["forehead", "forehead", 0.56];
  else if ((nx <= 0.12 || nx >= 0.88) && ny >= 0.30 && ny <= 0.76) [region, subunit, confidence] = ["ear_region", "preauricular_or_postauricular", 0.42];
  else if ((nx < 0.22 || nx > 0.78) && ny >= 0.58) [region, subunit, confidence] = ["temple_cheek", "lateral_face", 0.54];
  else if (ny >= 0.68 && ny < 0.80 && nx >= 0.22 && nx <= 0.78) [region, subunit, confidence] = ["upper_eyelid", "upper_eyelid", 0.58];
  else if (ny >= 0.55 && ny < 0.68 && nx >= 0.43 && nx <= 0.57) [region, subunit, confidence] = ["inner_canthus", "medial_canthal_region", 0.50];
  else if (ny >= 0.53 && ny < 0.68 && ((nx >= 0.2 && nx <= 0.42) || (nx >= 0.58 && nx <= 0.8))) [region, subunit, confidence] = ["lower_eyelid", "free_margin", 0.66];
  else if (ny >= 0.50 && ny < 0.62 && nx >= 0.43 && nx <= 0.57) [region, subunit, confidence] = ["nasal_dorsum", "nasal_root_or_dorsum", 0.56];
  else if (ny >= 0.39 && ny < 0.47 && nx >= 0.44 && nx <= 0.56) [region, subunit, confidence] = ["nasal_tip", "nasal_tip", 0.54];
  else if (ny >= 0.40 && ny < 0.56 && nx >= 0.36 && nx <= 0.64) [region, subunit, confidence] = ["nasal_ala", "nose", 0.62];
  else if (ny >= 0.34 && ny < 0.49 && ((nx >= 0.24 && nx <= 0.38) || (nx >= 0.62 && nx <= 0.76))) [region, subunit, confidence] = ["nasolabial_fold", "midface_crease", 0.52];
  else if (ny >= 0.28 && ny < 0.40 && ((nx >= 0.30 && nx < 0.39) || (nx > 0.61 && nx <= 0.70))) [region, subunit, confidence] = ["oral_commissure", "oral_commissure", 0.54];
  else if (ny >= 0.34 && ny < 0.42 && nx >= 0.39 && nx <= 0.61) [region, subunit, confidence] = ["upper_lip", "white_lip", 0.58];
  else if (ny >= 0.24 && ny < 0.34 && nx >= 0.34 && nx <= 0.66) [region, subunit, confidence] = ["lip_vermilion", "oral_free_margin", 0.66];
  else if (ny < 0.22 && nx >= 0.28 && nx <= 0.72) [region, subunit, confidence] = ["chin", "chin", 0.58];
  else if (ny < 0.30 || nx < 0.18 || nx > 0.82) [region, subunit, confidence] = ["jawline", "mandibular_border", 0.50];
  const nearby = [];
  let freeMarginDistanceMm = null;
  for (const [name, dist] of sensitiveMarginDistances([nx, ny])) {
    if (dist <= 28) {
      nearby.push(name);
      freeMarginDistanceMm = freeMarginDistanceMm == null ? dist : Math.min(freeMarginDistanceMm, dist);
    }
  }
  const sensitive = ["lower_eyelid", "lip_vermilion", "nasal_ala", "nasal_tip", "oral_commissure"].includes(region) || nearby.length > 0;
  const boundaryMargin = regionBoundaryMarginNorm([nx, ny]);
  const confidenceReasons = regionConfidenceReasons({
    region,
    confidence,
    rawXY: [rawNx, rawNy],
    clippedXY: [nx, ny],
    nearbyLandmarks: nearby,
    boundaryMargin,
  });
  return {
    region,
    subunit,
    confidence,
    normalized_xy: [nx, ny] as Vec2,
    sensitive,
    nearby_landmarks: nearby,
    free_margin_distance_mm: freeMarginDistanceMm,
    confidence_reasons: confidenceReasons,
    region_boundary_margin_norm: boundaryMargin,
  };
}

export function candidatePoints(candidate: AnyRecord): Vec3[] {
  const raw = candidate.polyline || candidate.outline || candidate.endpoints || [];
  return raw
    .filter((p: unknown) => Array.isArray(p) && p.length === 3)
    .map((p: number[]) => p.map(Number) as Vec3)
    .filter((p: Vec3) => p.every(Number.isFinite));
}

function candidateRawPoints(candidate: AnyRecord): unknown[] {
  const raw = candidate.polyline || candidate.outline || candidate.endpoints || [];
  return Array.isArray(raw) ? raw : [];
}

function normalizedCandidatePath(candidate: AnyRecord, verts: ArrayLike<number>[]): Point2[] {
  const { lo, hi } = bbox(verts);
  const span = [Math.max(hi[0] - lo[0], 1e-9), Math.max(hi[1] - lo[1], 1e-9)];
  return candidatePoints(candidate).map((point) => [
    (point[0] - lo[0]) / span[0],
    (point[1] - lo[1]) / span[1],
  ]);
}

function polygonArea2d(points: Point2[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

export function buildMediaPipeEngineeringExclusionZones(verts: ArrayLike<number>[]): AnyRecord[] {
  if (!Array.isArray(verts) || verts.length < MEDIAPIPE_FACE_VERTEX_COUNT) return [];
  const { lo, hi } = bbox(verts);
  const span = [hi[0] - lo[0], hi[1] - lo[1]];
  if (!span.every((value) => Number.isFinite(value) && value > 1e-9)) return [];

  const topologyZones = MEDIAPIPE_TOPOLOGY_OPENINGS.flatMap(({ id, indices, projectionBufferScale }) => {
    const vertices = indices.map((index) => verts[index]);
    if (vertices.some((vertex) => !vertex || vertex.length < 2 || !Number.isFinite(vertex[0]) || !Number.isFinite(vertex[1]))) {
      return [];
    }
    const rawPolygon = vertices.map((vertex) => [
      (vertex[0] - lo[0]) / span[0],
      (vertex[1] - lo[1]) / span[1],
    ] as Point2);
    const center = rawPolygon.reduce((sum, point) => [
      sum[0] + point[0] / rawPolygon.length,
      sum[1] + point[1] / rawPolygon.length,
    ], [0, 0] as Point2);
    const polygon = rawPolygon.map((point) => [
      center[0] + (point[0] - center[0]) * projectionBufferScale,
      center[1] + (point[1] - center[1]) * projectionBufferScale,
    ] as Point2);
    if (Math.abs(polygonArea2d(polygon)) <= 1e-6) return [];
    return [{
      id,
      code: "candidate_intersects_non_skin_opening",
      polygon,
      source: projectionBufferScale > 1
        ? "mediapipe-468-topology-loop-with-projection-buffer"
        : "mediapipe-468-topology-loop",
      projection_buffer_scale: projectionBufferScale,
      recovery: "Move or regenerate the candidate so its complete path stays outside the mapped face opening.",
      clinical_boundary: "This topology opening and projection buffer are engineering exclusions only; they do not define a medical safety margin.",
    }];
  });
  const nostrilZones = STANDARD_RSTL_NOSTRIL_APERTURES.map(({ id, center, radii }) => ({
    id,
    code: "candidate_intersects_non_skin_opening",
    polygon: Array.from({ length: 32 }, (_, index) => {
      const angle = index / 32 * Math.PI * 2;
      return [center[0] + Math.cos(angle) * radii[0], center[1] + Math.sin(angle) * radii[1]] as Point2;
    }),
    source: "standard-rstl-v1-nostril-aperture-mask-v9",
    projection_buffer_scale: 1,
    recovery: "Move or regenerate the candidate so its complete path stays outside the mapped nostril opening.",
    clinical_boundary: "This nostril aperture is an engineering exclusion only; it does not define a medical safety margin.",
  }));
  return [...topologyZones, ...nostrilZones];
}

function normalizedModelPoint(point: ArrayLike<number>, verts: ArrayLike<number>[]): Point2 | null {
  if (!point || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const { lo, hi } = bbox(verts);
  const width = hi[0] - lo[0], height = hi[1] - lo[1];
  if (!(width > 1e-9) || !(height > 1e-9)) return null;
  return [(point[0] - lo[0]) / width, (point[1] - lo[1]) / height];
}

export function inspectTumorPointEngineeringExclusion(
  point: ArrayLike<number>,
  verts: ArrayLike<number>[],
): AnyRecord | null {
  const normalized = normalizedModelPoint(point, verts);
  if (!normalized) return null;
  for (const zone of buildMediaPipeEngineeringExclusionZones(verts)) {
    if (!pointInPolygon2d(normalized, zone.polygon as Point2[])) continue;
    return {
      code: "tumor_center_inside_non_skin_opening",
      zone_id: zone.id,
      zone_source: zone.source,
      normalized_xy: normalized,
      recovery: "Choose a lesion center on visible skin outside the mapped face opening.",
      clinical_boundary: zone.clinical_boundary,
    };
  }
  return null;
}

export function tumorPointEngineeringExclusionMessage(
  point: ArrayLike<number>,
  verts: ArrayLike<number>[],
): string | null {
  const opening = inspectTumorPointEngineeringExclusion(point, verts);
  if (!opening) return null;
  const label = opening.zone_id === "oral-opening"
    ? "口裂"
    : String(opening.zone_id).includes("nostril") ? "鼻孔" : "眼裂";
  return `该位置落在${label}等非皮肤开口，不能作为病灶中心；请在可见皮肤上重新选择。`;
}

function normalizedTumorFootprint(tumor: AnyRecord, verts: ArrayLike<number>[]): {
  source: "boundary" | "diameter";
  points: Point2[];
} | null {
  const boundary = Array.isArray(tumor?.boundary)
    ? tumor.boundary.map((point: ArrayLike<number>) => normalizedModelPoint(point, verts)).filter(Boolean) as Point2[]
    : [];
  if (boundary.length >= 3) return { source: "boundary", points: boundary };
  const center = normalizedModelPoint(tumor?.center, verts);
  const diameterMm = Number(tumor?.diameter_mm);
  if (!center || !(diameterMm > 0)) return null;
  const { lo, hi } = bbox(verts);
  const radiusModel = diameterMm * unitsPerMmFromVertices(verts) / 2;
  const radiusX = radiusModel / Math.max(hi[0] - lo[0], 1e-9);
  const radiusY = radiusModel / Math.max(hi[1] - lo[1], 1e-9);
  const points = Array.from({ length: 48 }, (_, index) => {
    const angle = index / 48 * Math.PI * 2;
    return [center[0] + Math.cos(angle) * radiusX, center[1] + Math.sin(angle) * radiusY] as Point2;
  });
  return { source: "diameter", points };
}

export function inspectTumorEngineeringExclusions(tumor: AnyRecord, verts: ArrayLike<number>[]): AnyRecord {
  const violations: AnyRecord[] = [];
  const centerViolation = inspectTumorPointEngineeringExclusion(tumor?.center, verts);
  if (centerViolation) {
    violations.push({
      code: centerViolation.code,
      location: centerViolation,
      recovery: centerViolation.recovery,
    });
  }
  const footprint = normalizedTumorFootprint(tumor, verts);
  if (footprint) {
    for (const zone of buildMediaPipeEngineeringExclusionZones(verts)) {
      const relation = inspectPathPolygonRelation(footprint.points, zone.polygon as Point2[], { closedPath: true });
      if (!relation.intersects) continue;
      violations.push({
        code: footprint.source === "boundary"
          ? "tumor_boundary_intersects_non_skin_opening"
          : "tumor_diameter_intersects_non_skin_opening",
        location: { zone_id: zone.id, zone_source: zone.source, relation },
        recovery: footprint.source === "boundary"
          ? "Keep the recorded boundary as evidence, then redraw it outside the mapped face opening."
          : "Keep the recorded diameter as evidence, then move the center or correct the diameter before generating a candidate.",
      });
    }
  }
  return {
    schema_version: "tumor-engineering-exclusions/v0.1",
    passed: violations.length === 0,
    violations,
    footprint_source: footprint?.source || null,
    clinical_boundary: "MediaPipe topology openings are engineering exclusions only; they do not define a medical safety margin.",
  };
}

function validSurfaceRef(ref: AnyRecord): boolean {
  if (!ref || !Number.isInteger(ref.tri) || ref.tri < 0) return false;
  const weights = [Number(ref.u), Number(ref.v), Number(ref.w ?? 1 - Number(ref.u) - Number(ref.v))];
  return weights.every(Number.isFinite)
    && Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) <= 1e-4
    && weights.every((value) => value >= -1e-4 && value <= 1 + 1e-4);
}

export function annotateCandidateEngineeringViolations<T extends AnyRecord>(candidate: T, verts: ArrayLike<number>[]): T {
  const rawPoints = candidateRawPoints(candidate);
  const path = normalizedCandidatePath(candidate, verts);
  const violations: AnyRecord[] = [];
  if (rawPoints.length < 2 || path.length !== rawPoints.length) {
    violations.push({
      code: "invalid_candidate_geometry",
      location: null,
      recovery: "Regenerate the candidate with at least two finite 3D path points.",
    });
  }
  const outsideIndex = path.findIndex(([x, y]) => x < -1e-6 || x > 1 + 1e-6 || y < -1e-6 || y > 1 + 1e-6);
  if (outsideIndex >= 0) {
    violations.push({
      code: "candidate_outside_canonical_surface",
      location: { path_index: outsideIndex, normalized_xy: path[outsideIndex] },
      recovery: "Move or regenerate the candidate inside the canonical face surface bounds.",
    });
  }
  const refs = candidate.surface_refs || candidate.polyline_refs;
  if (Array.isArray(refs) && (refs.length < 2 || refs.some((ref: AnyRecord) => !validSurfaceRef(ref)))) {
    violations.push({
      code: "invalid_candidate_surface_refs",
      location: null,
      recovery: "Reproject the complete candidate path onto the active topology before review.",
    });
  } else if (candidate.surface_refs_required === true && !Array.isArray(refs)) {
    violations.push({
      code: "missing_candidate_surface_refs",
      location: null,
      recovery: "Generate surface references for the complete candidate path before review.",
    });
  }
  const zonesById = new Map<string, AnyRecord>();
  for (const zone of buildMediaPipeEngineeringExclusionZones(verts)) zonesById.set(String(zone.id), zone);
  for (const [index, zone] of (Array.isArray(candidate.engineering_exclusion_zones) ? candidate.engineering_exclusion_zones : []).entries()) {
    zonesById.set(String(zone?.id || `candidate-zone-${index}`), zone);
  }
  for (const zone of zonesById.values()) {
    const polygon = Array.isArray(zone?.polygon)
      ? zone.polygon.filter((point: unknown) => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite))
        .map((point: number[]) => [Number(point[0]), Number(point[1])] as Point2)
      : [];
    if (polygon.length < 3 || path.length < 2) continue;
    const relation = inspectPathPolygonRelation(path, polygon, { closedPath: candidate.type === "fusiform" });
    if (!relation.intersects) continue;
    violations.push({
      code: String(zone.code || "candidate_intersects_engineering_exclusion_zone"),
      location: { zone_id: zone.id || null, zone_source: zone.source || "candidate", relation },
      recovery: String(zone.recovery || "Move or regenerate the candidate outside the engineering exclusion zone."),
    });
  }
  const mutable = candidate as AnyRecord;
  mutable.hard_violations = violations;
  mutable.hard_violation_count = violations.length;
  mutable.engineering_guardrails = {
    schema_version: "engineering-geometry-guardrails/v0.1",
    passed: violations.length === 0,
    hard_violation_count: violations.length,
    hard_violations: violations,
    coordinate_space: "canonical_model_normalized_xy",
    clinical_boundary: "Engineering geometry checks do not define clinical safety margins or anatomy.",
  };
  return candidate;
}

export function annotateCandidateSensitiveDistances<T extends AnyRecord>(candidate: T, verts: ArrayLike<number>[], faceHeightMm = 180): T {
  const points = candidatePoints(candidate);
  if (!Array.isArray(verts) || !verts.length) return candidate;
  annotateCandidateEngineeringViolations(candidate, verts);
  if (!points.length) return candidate;
  const normalized = normalizedCandidatePath(candidate, verts);
  const sampled = resamplePolyline2d(normalized, 0.005, candidate.type === "fusiform");
  let best: { distance: number; landmark: string; point: Vec3 | null } = { distance: Infinity, landmark: "", point: null };
  for (const [index, point] of sampled.entries()) {
    const nx = point[0];
    const ny = point[1];
    for (const [landmark, distance] of sensitiveMarginDistances([nx, ny], faceHeightMm)) {
      if (distance < best.distance) {
        const original = points[Math.min(points.length - 1, Math.round(index * (points.length - 1) / Math.max(1, sampled.length - 1)))];
        best = { distance, landmark, point: original || null };
      }
    }
  }
  if (!Number.isFinite(best.distance)) return candidate;
  const mutableCandidate = candidate as AnyRecord;
  mutableCandidate.metrics = {
    ...(mutableCandidate.metrics || {}),
    sensitive_free_margin_min_distance_mm: best.distance,
    sensitive_free_margin_nearest: best.landmark,
    sensitive_free_margin_point: best.point,
  };
  return candidate;
}

function atlasSamples(verts: ArrayLike<number>[], tris: Triangle[], atlas: AtlasPayload): { pts: Vec3[]; tans: Vec3[] } {
  const pts: Vec3[] = [], tans: Vec3[] = [];
  for (const line of atlas.lines || []) {
    const P: Vec3[] = [];
    if (Array.isArray(line.points3d) && line.points3d.length) {
      for (const point of line.points3d) {
        if (Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)) P.push([point[0], point[1], point[2]]);
      }
    } else {
      for (const raw of line.points || []) {
        if (!Array.isArray(raw) || raw.length < 3) continue;
        const [tri, u, v] = raw;
        if (![tri, u, v].every(Number.isFinite)) continue;
        const t = tris[Math.round(tri)];
        if (!t) continue;
        const A = verts[t[0]], B = verts[t[1]], C = verts[t[2]];
        if (![A, B, C].every((vertex) => vertex?.length >= 3 && Array.from(vertex).slice(0, 3).every(Number.isFinite))) continue;
        const w = 1 - u - v;
        const mapped: Vec3 = [
          u * A[0] + v * B[0] + w * C[0],
          u * A[1] + v * B[1] + w * C[1],
          u * A[2] + v * B[2] + w * C[2],
        ];
        if (mapped.every(Number.isFinite)) P.push(mapped);
      }
    }
    const deduplicated: Vec3[] = [];
    for (const point of P) {
      const previous = deduplicated[deduplicated.length - 1];
      if (!previous || Math.hypot(...sub(point, previous)) > 1e-12) deduplicated.push(point);
    }
    P.length = 0;
    P.push(...deduplicated);
    if (P.length < 2) continue;
    for (let i = 0; i < P.length; i++) {
      const before = P[Math.max(0, i - 1)];
      const after = P[Math.min(P.length - 1, i + 1)];
      const delta = sub(after, before);
      if (Math.hypot(...delta) <= 1e-12) continue;
      pts.push(P[i]);
      tans.push(norm(delta));
    }
  }
  return { pts, tans };
}

function axisAngleDiffDeg(a: number, b: number): number {
  return Math.abs((((a - b + 90) % 180) + 180) % 180 - 90);
}

function axialAngularSpreadDeg(vectors: Vec3[], reference: Vec3): number {
  if (vectors.length <= 1) return 0;
  const refAngle = Math.atan2(reference[1], reference[0]) * 180 / Math.PI;
  let maxDev = 0;
  for (const v of vectors) {
    const angle = Math.atan2(v[1], v[0]) * 180 / Math.PI;
    maxDev = Math.max(maxDev, axisAngleDiffDeg(angle, refAngle));
  }
  return Math.min(180, 2 * maxDev);
}

export function queryDirection(point: Vec3, verts: ArrayLike<number>[], tris: Triangle[], atlas: AtlasPayload): DirectionResult {
  const atlasProvenance = String(atlas.provenance || atlas.personalization?.source || "bundled_standard_rstl_prior");
  const personalized = atlasProvenance.toLowerCase().includes("local-yolo")
    || atlasProvenance.toLowerCase().includes("personalized_rstl")
    || String(atlas.personalization?.algorithm || atlas.diagnostics?.algorithm || "").toLowerCase().includes("rstl-refinement");
  const { pts, tans } = atlasSamples(verts, tris, atlas);
  if (!pts.length) {
    const emptyAtlas = !Array.isArray(atlas.lines) || atlas.lines.length === 0;
    return {
      point,
      vector: [1, 0, 0],
      angle_deg: 0,
      confidence: 0,
      source: emptyAtlas ? "rstl_atlas_empty" : "rstl_atlas_no_valid_direction_support",
      nearest_distance: null,
      support_count: 0,
      angular_spread_deg: 0,
      confidence_reasons: [emptyAtlas ? "empty_atlas" : "no_valid_direction_support"],
    };
  }
  let best = 0, bd = Infinity;
  const dist2: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const d = sub(pts[i], point);
    const dd = dot(d, d);
    dist2.push(dd);
    if (dd < bd) { bd = dd; best = i; }
  }
  const { lo, hi } = bbox(verts);
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const nearest = Math.sqrt(bd);
  const maxDistance = Math.max(diag * 0.18, 1e-9);
  const ref = tans[best];
  const order = dist2
    .map((d, i) => [d, i] as [number, number])
    .filter(([, i]) => Math.abs(dot(tans[i], ref)) >= Math.SQRT1_2)
    .sort((a, b) => a[0] - b[0])
    .slice(0, Math.min(7, dist2.length));
  let acc: Vec3 = [0, 0, 0], weightSum = 0;
  const signed: Vec3[] = [];
  for (const [d2, i] of order) {
    let t = tans[i];
    if (dot(t, ref) < 0) t = mul(t, -1);
    const w = 1 / (Math.sqrt(d2) + 1e-6);
    acc = add(acc, mul(t, w));
    weightSum += w;
    signed.push(t);
  }
  const vector = canonicalAxis(norm(mul(acc, 1 / Math.max(weightSum, 1e-9))));
  const spread = axialAngularSpreadDeg(signed, vector);
  const confidenceReasons: string[] = [];
  if (order.length < Math.min(3, 7)) confidenceReasons.push("low_support_count");
  if (nearest >= maxDistance) confidenceReasons.push("nearest_atlas_support_far");
  else if (nearest >= maxDistance * 0.6) confidenceReasons.push("nearest_atlas_support_sparse");
  if (spread > 90) confidenceReasons.push("high_angular_spread");
  const confidence = clamp((1 - nearest / maxDistance) * (spread > 90 ? 0.75 : 1), 0, 1);
  if (confidence < 0.35 && !confidenceReasons.length) confidenceReasons.push("low_direction_confidence");
  return {
    point,
    vector,
    angle_deg: Math.atan2(vector[1], vector[0]) * 180 / Math.PI,
    confidence,
    source: personalized ? "personalized_rstl_atlas_weighted_nearest" : "rstl_atlas_weighted_nearest",
    nearest_distance: nearest,
    support_count: order.length,
    angular_spread_deg: spread,
    confidence_reasons: confidenceReasons,
  };
}

export function directionProvenance(direction: Partial<DirectionResult> = {}): AnyRecord {
  return {
    direction_source: direction.source || null,
    direction_nearest_distance: direction.nearest_distance ?? null,
    direction_support_count: direction.support_count ?? null,
    direction_angular_spread_deg: direction.angular_spread_deg ?? null,
    direction_confidence_reasons: Array.isArray(direction.confidence_reasons) ? direction.confidence_reasons : [],
  };
}

export function editFingerprint(editRecord: AnyRecord): string {
  const raw = [
    editRecord.angle_offset_deg,
    editRecord.length_scale,
    editRecord.width_scale,
    editRecord.tip_angle_deg,
    editRecord.shift_along_mm,
    editRecord.shift_perp_mm,
    editRecord.reason,
  ].join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

export function editRecordIsActive(editRecord: AnyRecord = {}): boolean {
  return Number(editRecord.angle_offset_deg || 0) !== 0 ||
    Number(editRecord.length_scale || 1) !== 1 ||
    Number(editRecord.width_scale || 1) !== 1 ||
    editRecord.tip_angle_deg != null ||
    Number(editRecord.shift_along_mm || 0) !== 0 ||
    Number(editRecord.shift_perp_mm || 0) !== 0 ||
    Boolean(editRecord.reason);
}

export function normalizeEditHistoryEntry(base: AnyRecord, raw: AnyRecord, index: number, baseVersion: number): AnyRecord {
  const entry: AnyRecord = {
    kind: "clinician_adjustment",
    angle_offset_deg: Number(raw.angle_offset_deg || 0),
    length_scale: Number(raw.length_scale || 1),
    width_scale: Number(raw.width_scale || 1),
    tip_angle_deg: raw.tip_angle_deg == null ? null : Number(raw.tip_angle_deg),
    shift_along_mm: Number(raw.shift_along_mm || 0),
    shift_perp_mm: Number(raw.shift_perp_mm || 0),
    reason: String(raw.reason || ""),
    source: raw.source || "web/incision_workflow",
    interaction: raw.interaction || "committed_control_edit",
    committed_at: raw.committed_at || null,
    history_index: Number(raw.history_index || index + 1),
    parent_candidate_id: base.id,
    resulting_candidate_version: baseVersion + index + 1,
  };
  entry.edit_id = raw.edit_id || `edit_v${entry.resulting_candidate_version}_${editFingerprint(entry)}`;
  return entry;
}

export function versionedEditProvenance(base: AnyRecord, editRecord: AnyRecord, sessionHistory: AnyRecord[] | null = null): AnyRecord {
  const baseProvenance = base.provenance || {};
  const previousHistory = Array.isArray(baseProvenance.edit_history) ? baseProvenance.edit_history : [];
  const baseVersion = Number(baseProvenance.candidate_version || 1);
  const activeSession = Array.isArray(sessionHistory)
    ? sessionHistory.filter((entry) => editRecordIsActive(entry) || entry.interaction === "control_change")
    : [];
  if (activeSession.length) {
    const editHistory = activeSession.map((entry, index) => normalizeEditHistoryEntry(base, entry, index, baseVersion));
    return {
      ...baseProvenance,
      source_candidate_id: base.id,
      parent_candidate_id: base.id,
      candidate_version: baseVersion + editHistory.length,
      clinician_edit: editHistory.at(-1),
      edit_history: editHistory,
    };
  }
  const candidateVersion = baseVersion + 1;
  const editEntry = {
    ...editRecord,
    edit_id: `edit_v${candidateVersion}_${editFingerprint(editRecord)}`,
    parent_candidate_id: base.id,
    resulting_candidate_version: candidateVersion,
  };
  return {
    ...baseProvenance,
    source_candidate_id: base.id,
    parent_candidate_id: base.id,
    candidate_version: candidateVersion,
    clinician_edit: editEntry,
    edit_history: previousHistory.concat([editEntry]),
  };
}
