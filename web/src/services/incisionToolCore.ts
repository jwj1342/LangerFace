import {
  REGION_BOUNDARY_X,
  REGION_BOUNDARY_Y,
  REGION_TRANSITION_REASONS,
  SENSITIVE_ANCHORS,
  SENSITIVE_MARGIN_SEGMENTS,
} from "./incisionToolRules.ts";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Triangle = [number, number, number];
export type AnyRecord = Record<string, any>;

type AtlasPoint = [number, number, number];
type AtlasLine = { points?: AtlasPoint[]; points3d?: Vec3[] };
type AtlasPayload = { lines?: AtlasLine[] };
type RegionConfidenceInput = {
  region: string;
  confidence: number;
  rawXY: Vec2;
  clippedXY: Vec2;
  nearbyLandmarks: string[];
  boundaryMargin: number;
};

export interface DirectionResult extends AnyRecord {
  point?: Vec3;
  vector: Vec3;
  angle_deg: number;
  confidence: number;
  source: string;
  nearest_distance?: number;
  support_count?: number;
  angular_spread_deg?: number;
  confidence_reasons?: string[];
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

export function annotateCandidateSensitiveDistances<T extends AnyRecord>(candidate: T, verts: ArrayLike<number>[], faceHeightMm = 180): T {
  const points = candidatePoints(candidate);
  if (!points.length || !Array.isArray(verts) || !verts.length) return candidate;
  const { lo, hi } = bbox(verts);
  const span = [Math.max(hi[0] - lo[0], 1e-9), Math.max(hi[1] - lo[1], 1e-9)];
  let best: { distance: number; landmark: string; point: Vec3 | null } = { distance: Infinity, landmark: "", point: null };
  for (const point of points) {
    const nx = clamp((point[0] - lo[0]) / span[0], 0, 1);
    const ny = clamp((point[1] - lo[1]) / span[1], 0, 1);
    for (const [landmark, distance] of sensitiveMarginDistances([nx, ny], faceHeightMm)) {
      if (distance < best.distance) best = { distance, landmark, point };
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
        if (Array.isArray(point) && point.length >= 3 && point.every(Number.isFinite)) P.push([point[0], point[1], point[2]]);
      }
    } else {
      for (const raw of line.points || []) {
        const [tri, u, v] = raw;
        const t = tris[Math.round(tri)];
        if (!t) continue;
        const w = 1 - u - v, A = verts[t[0]], B = verts[t[1]], C = verts[t[2]];
        P.push([
          u * A[0] + v * B[0] + w * C[0],
          u * A[1] + v * B[1] + w * C[1],
          u * A[2] + v * B[2] + w * C[2],
        ]);
      }
    }
    if (P.length < 2) continue;
    for (let i = 0; i < P.length; i++) {
      const before = P[Math.max(0, i - 1)];
      const after = P[Math.min(P.length - 1, i + 1)];
      pts.push(P[i]);
      tans.push(norm(sub(after, before)));
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
  const { pts, tans } = atlasSamples(verts, tris, atlas);
  if (!pts.length) {
    return {
      point,
      vector: [1, 0, 0],
      angle_deg: 0,
      confidence: 0,
      source: "rstl_atlas_empty",
      nearest_distance: Infinity,
      confidence_reasons: ["empty_atlas"],
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
  const order = dist2.map((d, i) => [d, i] as [number, number]).sort((a, b) => a[0] - b[0]).slice(0, Math.min(7, dist2.length));
  const ref = tans[best];
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
  const vector = norm(mul(acc, 1 / Math.max(weightSum, 1e-9)));
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
    source: "rstl_atlas_weighted_nearest",
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
    shift_along_mm: Number(raw.shift_along_mm || 0),
    shift_perp_mm: Number(raw.shift_perp_mm || 0),
    reason: String(raw.reason || ""),
    source: raw.source || "web/incision_agent",
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
