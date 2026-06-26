import type { IncisionOverlayPayload } from "./dataSource";
import type { Triangle, Vec3 } from "./softBody";

const INCISION_OVERLAY_KEY = "langerface.incisionOverlay";

type AnyRecord = Record<string, any>;
type PointLike = number[];

export interface SurfaceRef {
  tri: number;
  u: number;
  v: number;
  w: number;
  distance?: number;
}

interface ClosestPointResult {
  point: Vec3;
  weights: Vec3;
}

interface SurfaceRefCandidate {
  tri: number;
  weights: Vec3;
  d2: number;
}

export interface ReviewGate {
  reviewer_required: boolean;
  reviewer_present: boolean;
  notes_required_for_high_guardrails: boolean;
  notes_present: boolean;
  high_guardrail_codes: string[];
  approval_ready: boolean;
  live_overlay_ready: boolean;
  reason: string;
}

interface GuardrailSummary {
  passed: boolean;
  high_codes: string[];
  medium_codes: string[];
}

interface DisplacementStats {
  count: number;
  mean_px: number | null;
  rms_px: number | null;
  p95_px: number | null;
  max_px: number | null;
}

interface OverlayPointTrack {
  group: string;
  index: number;
  pt: Vec3;
}

interface RegistrationOptions {
  frameWidth?: number | null;
  frameHeight?: number | null;
  minMappedPointCount?: number;
  minCandidatePointCount?: number;
  minTriangleAreaPx2?: number;
  minOverlayDiagonalPx?: number;
  maxOverlayFrameFraction?: number;
  maxOutOfFrameFraction?: number;
  context?: string;
}

interface JitterOptions {
  maxRmsPx?: number;
  maxP95Px?: number;
  maxMaxPx?: number;
  context?: string;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len2 = (v: Vec3): number => dot(v, v);

function closestPointOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): ClosestPointResult {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { point: a, weights: [1, 0, 0] };

  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { point: b, weights: [0, 1, 0] };

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { point: add(a, mul(ab, v)), weights: [1 - v, v, 0] };
  }

  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { point: c, weights: [0, 0, 1] };

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { point: add(a, mul(ac, w)), weights: [1 - w, 0, w] };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return { point: add(b, mul(sub(c, b), w)), weights: [0, 1 - w, w] };
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return { point: add(add(a, mul(ab, v)), mul(ac, w)), weights: [1 - v - w, v, w] };
}

export function pointToSurfaceRef(point: Vec3, verts: Vec3[], tris: Triangle[]): SurfaceRef | null {
  let best: SurfaceRefCandidate | null = null;
  for (let i = 0; i < tris.length; i++) {
    const tri = tris[i];
    const hit = closestPointOnTriangle(point, verts[tri[0]], verts[tri[1]], verts[tri[2]]);
    const d2 = len2(sub(point, hit.point));
    if (!best || d2 < best.d2) best = { tri: i, weights: hit.weights, d2 };
  }
  if (!best) return null;
  return {
    tri: best.tri,
    u: best.weights[0],
    v: best.weights[1],
    w: best.weights[2],
    distance: Math.sqrt(best.d2),
  };
}

function isSurfaceRef(value: SurfaceRef | null): value is SurfaceRef {
  return value !== null;
}

function refsFromPolyline(points: unknown, verts: Vec3[], tris: Triangle[]): SurfaceRef[] {
  if (!Array.isArray(points)) return [];
  return points.map((point) => pointToSurfaceRef(point as Vec3, verts, tris)).filter(isSurfaceRef);
}

function codesBySeverity(guardrails: AnyRecord | null | undefined, severity: string): string[] {
  return (guardrails?.warnings || [])
    .filter((warning: AnyRecord) => warning.severity === severity)
    .map((warning: AnyRecord) => warning.code)
    .filter(Boolean);
}

function guardrailSummary(record: AnyRecord | null | undefined): GuardrailSummary {
  const summary = record?.guardrail_summary || {};
  const guardrails = record?.guardrails || {};
  return {
    passed: summary.passed ?? Boolean(guardrails.passed),
    high_codes: Array.isArray(summary.high_codes) ? summary.high_codes : codesBySeverity(guardrails, "high"),
    medium_codes: Array.isArray(summary.medium_codes) ? summary.medium_codes : codesBySeverity(guardrails, "medium"),
  };
}

function normalizeReviewGate(gate: AnyRecord | null | undefined): ReviewGate {
  return {
    reviewer_required: gate?.reviewer_required === true,
    reviewer_present: gate?.reviewer_present === true,
    notes_required_for_high_guardrails: gate?.notes_required_for_high_guardrails === true,
    notes_present: gate?.notes_present === true,
    high_guardrail_codes: Array.isArray(gate?.high_guardrail_codes) ? gate.high_guardrail_codes : [],
    approval_ready: gate?.approval_ready === true,
    live_overlay_ready: gate?.live_overlay_ready === true,
    reason: gate?.reason || "",
  };
}

export function compileIncisionOverlay(
  record: AnyRecord | null | undefined,
  verts: Vec3[],
  tris: Triangle[],
): IncisionOverlayPayload | null {
  const candidate = record?.candidate;
  const tumor = record?.tumor || {};
  const reviewGate = normalizeReviewGate(record?.review_gate);
  if (!candidate || !Array.isArray(candidate.polyline) || !Array.isArray(tumor.center)) return null;
  if (reviewGate.live_overlay_ready !== true) return null;
  const reviewStatus = record?.review?.status || record?.review_status || "pending_clinician_confirmation";
  const summary = guardrailSummary(record);
  const overlay = {
    schema_version: "incision-overlay/v0.1",
    created_at: new Date().toISOString(),
    label: record.label || "切口候选",
    candidate_type: candidate.type,
    tumor_kind: tumor.kind,
    tumor: {
      center_ref: pointToSurfaceRef(tumor.center, verts, tris),
      boundary_refs: refsFromPolyline(tumor.boundary || [], verts, tris),
      diameter_mm: tumor.diameter_mm,
      margin_mm: tumor.margin_mm,
    },
    candidate: {
      polyline_refs: refsFromPolyline(candidate.polyline, verts, tris),
      length_mm: candidate.length_mm,
      width_mm: candidate.width_mm,
      guardrails_passed: summary.passed === true,
      high_guardrail_codes: summary.high_codes,
    },
    review: {
      status: reviewStatus,
      reviewer: record?.review?.reviewer || "",
      notes_present: Boolean(record?.review?.notes),
    },
    guardrail_summary: summary,
    review_gate: reviewGate,
    audit: {
      raw_image_sent: false,
      source: "web/incision_agent",
      review_required: true,
      review_status: reviewStatus,
      approval_ready: reviewGate.approval_ready,
      live_overlay_ready: reviewGate.live_overlay_ready,
    },
  };
  return validateIncisionOverlay(overlay) ? overlay : null;
}

function validSurfaceRef(ref: AnyRecord | null | undefined): boolean {
  if (!ref || !Number.isInteger(ref.tri) || ref.tri < 0) return false;
  const u = Number(ref.u);
  const v = Number(ref.v);
  const w = Number(ref.w ?? (1 - u - v));
  if (![u, v, w].every(Number.isFinite)) return false;
  if (Math.abs((u + v + w) - 1) > 1e-4) return false;
  if (ref.distance != null && !Number.isFinite(Number(ref.distance))) return false;
  return u >= -1e-4 && v >= -1e-4 && w >= -1e-4;
}

export function validateIncisionOverlay(overlay: unknown): overlay is IncisionOverlayPayload {
  const value = overlay as AnyRecord | null | undefined;
  if (!value || value.schema_version !== "incision-overlay/v0.1") return false;
  if (!validSurfaceRef(value.tumor?.center_ref)) return false;
  if (!Array.isArray(value.candidate?.polyline_refs) || value.candidate.polyline_refs.length < 2) return false;
  if (!value.candidate.polyline_refs.every(validSurfaceRef)) return false;
  if (value.audit?.raw_image_sent !== false || value.audit?.review_required !== true) return false;
  if (value.review_gate && value.review_gate.live_overlay_ready !== true) return false;
  if (value.audit?.live_overlay_ready != null && value.audit.live_overlay_ready !== true) return false;
  return true;
}

export function mapSurfaceRefs(
  refs: Array<AnyRecord | SurfaceRef> | null | undefined,
  landmarksPx: PointLike[],
  triangles: Triangle[],
): { pts: Vec3[]; tris: number[] } {
  const pts: Vec3[] = [];
  const triIds: number[] = [];
  for (const ref of refs || []) {
    const tri = triangles[ref.tri];
    if (!tri) continue;
    const a = landmarksPx[tri[0]];
    const b = landmarksPx[tri[1]];
    const c = landmarksPx[tri[2]];
    if (!a || !b || !c) continue;
    const u = Number(ref.u);
    const v = Number(ref.v);
    const w = Number(ref.w ?? (1 - u - v));
    pts.push([
      u * a[0] + v * b[0] + w * c[0],
      u * a[1] + v * b[1] + w * c[1],
      u * a[2] + v * b[2] + w * c[2],
    ]);
    triIds.push(ref.tri);
  }
  return { pts, tris: triIds };
}

function overlayRefGroups(overlay: AnyRecord | null | undefined): Array<[string, AnyRecord[]]> {
  return [
    ["tumor_center", [overlay?.tumor?.center_ref].filter(Boolean)],
    ["tumor_boundary", overlay?.tumor?.boundary_refs || []],
    ["candidate_polyline", overlay?.candidate?.polyline_refs || []],
  ];
}

function overlayPointTracks(overlay: AnyRecord, landmarksPx: PointLike[], triangles: Triangle[]): OverlayPointTrack[] {
  const tracks: OverlayPointTrack[] = [];
  const addTrack = (group: string, refs: AnyRecord[]) => {
    const mapped = mapSurfaceRefs(refs, landmarksPx, triangles);
    mapped.pts.forEach((pt, index) => tracks.push({ group, index, pt }));
  };
  for (const [group, refs] of overlayRefGroups(overlay)) addTrack(group, refs);
  return tracks;
}

function displacementStats(values: number[]): DisplacementStats {
  if (!values.length) return { count: 0, mean_px: null, rms_px: null, p95_px: null, max_px: null };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  const sumSq = values.reduce((acc, value) => acc + value * value, 0);
  const p95Idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    count: values.length,
    mean_px: sum / values.length,
    rms_px: Math.sqrt(sumSq / values.length),
    p95_px: sorted[p95Idx],
    max_px: sorted[sorted.length - 1],
  };
}

function roundMetric(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

function finitePoint(point: unknown): point is PointLike {
  return Array.isArray(point)
    && point.length >= 2
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]));
}

function triangleAreaPx2(a: PointLike, b: PointLike, c: PointLike): number {
  return Math.abs(
    (Number(b[0]) - Number(a[0])) * (Number(c[1]) - Number(a[1]))
    - (Number(c[0]) - Number(a[0])) * (Number(b[1]) - Number(a[1])),
  ) / 2;
}

function mappedPointFromRef(ref: AnyRecord, a: PointLike, b: PointLike, c: PointLike): Vec3 {
  const u = Number(ref.u);
  const v = Number(ref.v);
  const w = Number(ref.w ?? (1 - u - v));
  return [
    u * Number(a[0]) + v * Number(b[0]) + w * Number(c[0]),
    u * Number(a[1]) + v * Number(b[1]) + w * Number(c[1]),
    u * Number(a[2] || 0) + v * Number(b[2] || 0) + w * Number(c[2] || 0),
  ];
}

export function measureIncisionOverlayRegistration(
  overlay: unknown,
  landmarksPx: PointLike[],
  triangles: Triangle[],
  {
    frameWidth = null,
    frameHeight = null,
    minMappedPointCount = 3,
    minCandidatePointCount = 2,
    minTriangleAreaPx2 = 1,
    minOverlayDiagonalPx = 4,
    maxOverlayFrameFraction = 0.95,
    maxOutOfFrameFraction = 0,
    context = "runtime_landmark_surface_ref_projection",
  }: RegistrationOptions = {},
): AnyRecord {
  const thresholds = {
    min_mapped_point_count: minMappedPointCount,
    min_candidate_point_count: minCandidatePointCount,
    min_triangle_area_px2: minTriangleAreaPx2,
    min_overlay_diagonal_px: minOverlayDiagonalPx,
    max_overlay_frame_fraction: maxOverlayFrameFraction,
    max_out_of_frame_fraction: maxOutOfFrameFraction,
    context,
  };
  const frameKnown = Number.isFinite(Number(frameWidth)) && Number.isFinite(Number(frameHeight))
    && Number(frameWidth) > 0 && Number(frameHeight) > 0;
  if (!validateIncisionOverlay(overlay) || !Array.isArray(landmarksPx) || !Array.isArray(triangles)) {
    return {
      schema_version: "incision-overlay-registration/v0.1",
      passed: false,
      reason: "invalid_overlay_or_missing_runtime_geometry",
      reasons: ["invalid_overlay_or_missing_runtime_geometry"],
      thresholds,
      frame: frameKnown ? { width: Number(frameWidth), height: Number(frameHeight) } : null,
      total_ref_count: 0,
      mapped_point_count: 0,
      candidate_point_count: 0,
      tumor_center_mapped: false,
      invalid_ref_count: 0,
      missing_landmark_count: 0,
      degenerate_triangle_count: 0,
      out_of_frame_count: 0,
      out_of_frame_fraction: null,
      bbox_px: null,
      groups: {},
      clinical_boundary: "Runtime projection registration is an engineering QA signal, not clinical AR registration.",
    };
  }

  const groupCounts: Record<string, { ref_count: number; mapped_count: number }> = {};
  const mappedPoints: Array<{ group: string; pt: Vec3 }> = [];
  let totalRefCount = 0;
  let invalidRefCount = 0;
  let missingLandmarkCount = 0;
  let degenerateTriangleCount = 0;
  let outOfFrameCount = 0;
  for (const [group, refs] of overlayRefGroups(overlay as AnyRecord)) {
    groupCounts[group] ||= { ref_count: 0, mapped_count: 0 };
    for (const ref of refs) {
      totalRefCount += 1;
      groupCounts[group].ref_count += 1;
      const tri = triangles[ref?.tri];
      if (!tri || tri.length < 3) {
        invalidRefCount += 1;
        continue;
      }
      const a = landmarksPx[tri[0]];
      const b = landmarksPx[tri[1]];
      const c = landmarksPx[tri[2]];
      if (!finitePoint(a) || !finitePoint(b) || !finitePoint(c)) {
        missingLandmarkCount += 1;
        continue;
      }
      if (triangleAreaPx2(a, b, c) < minTriangleAreaPx2) degenerateTriangleCount += 1;
      const pt = mappedPointFromRef(ref, a, b, c);
      if (!finitePoint(pt)) {
        invalidRefCount += 1;
        continue;
      }
      mappedPoints.push({ group, pt });
      groupCounts[group].mapped_count += 1;
      if (
        frameKnown
        && (pt[0] < 0 || pt[0] > Number(frameWidth) || pt[1] < 0 || pt[1] > Number(frameHeight))
      ) {
        outOfFrameCount += 1;
      }
    }
  }

  let bbox: AnyRecord | null = null;
  if (mappedPoints.length) {
    const xs = mappedPoints.map(({ pt }) => Number(pt[0]));
    const ys = mappedPoints.map(({ pt }) => Number(pt[1]));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;
    const diagonal = Math.hypot(width, height);
    const frameDiagonal = frameKnown ? Math.hypot(Number(frameWidth), Number(frameHeight)) : null;
    bbox = {
      min_x: roundMetric(minX),
      min_y: roundMetric(minY),
      max_x: roundMetric(maxX),
      max_y: roundMetric(maxY),
      width: roundMetric(width),
      height: roundMetric(height),
      diagonal_px: roundMetric(diagonal),
      frame_fraction: frameDiagonal ? roundMetric(diagonal / frameDiagonal) : null,
    };
  }

  const candidatePointCount = groupCounts.candidate_polyline?.mapped_count || 0;
  const tumorCenterMapped = (groupCounts.tumor_center?.mapped_count || 0) >= 1;
  const outOfFrameFraction = mappedPoints.length ? outOfFrameCount / mappedPoints.length : null;
  const reasons: string[] = [];
  if (invalidRefCount > 0) reasons.push("invalid_surface_ref");
  if (missingLandmarkCount > 0) reasons.push("missing_runtime_landmark");
  if (degenerateTriangleCount > 0) reasons.push("degenerate_runtime_triangle");
  if (mappedPoints.length < minMappedPointCount || candidatePointCount < minCandidatePointCount || !tumorCenterMapped) {
    reasons.push("insufficient_mapped_overlay_points");
  }
  if (bbox && bbox.diagonal_px < minOverlayDiagonalPx) reasons.push("overlay_bbox_too_small");
  if (bbox?.frame_fraction != null && bbox.frame_fraction > maxOverlayFrameFraction) {
    reasons.push("overlay_bbox_too_large_for_frame");
  }
  if (outOfFrameFraction != null && outOfFrameFraction > maxOutOfFrameFraction) {
    reasons.push("out_of_frame_projection");
  }
  const passed = reasons.length === 0;
  return {
    schema_version: "incision-overlay-registration/v0.1",
    passed,
    reason: passed ? "runtime_projection_registration_ready" : reasons[0],
    reasons: passed ? ["runtime_projection_registration_ready"] : reasons,
    thresholds,
    frame: frameKnown ? { width: Number(frameWidth), height: Number(frameHeight) } : null,
    total_ref_count: totalRefCount,
    mapped_point_count: mappedPoints.length,
    candidate_point_count: candidatePointCount,
    tumor_center_mapped: tumorCenterMapped,
    invalid_ref_count: invalidRefCount,
    missing_landmark_count: missingLandmarkCount,
    degenerate_triangle_count: degenerateTriangleCount,
    out_of_frame_count: outOfFrameCount,
    out_of_frame_fraction: roundMetric(outOfFrameFraction),
    bbox_px: bbox,
    groups: groupCounts,
    clinical_boundary: "Runtime projection registration is an engineering QA signal, not clinical AR registration.",
  };
}

export function measureIncisionOverlayJitter(
  overlay: unknown,
  landmarkFrames: PointLike[][],
  triangles: Triangle[],
  {
    maxRmsPx = 2,
    maxP95Px = 4,
    maxMaxPx = 8,
    context = "static_camera_or_paused_video",
  }: JitterOptions = {},
): AnyRecord {
  const thresholds = { max_rms_px: maxRmsPx, max_p95_px: maxP95Px, max_max_px: maxMaxPx, context };
  if (!validateIncisionOverlay(overlay) || !Array.isArray(landmarkFrames) || landmarkFrames.length < 2) {
    return {
      schema_version: "incision-overlay-stability/v0.1",
      passed: false,
      reason: "invalid_overlay_or_insufficient_frames",
      frame_count: Array.isArray(landmarkFrames) ? landmarkFrames.length : 0,
      tracked_point_count: 0,
      thresholds,
      overall: displacementStats([]),
      by_group: {},
    };
  }

  const perFrame = landmarkFrames.map((frame) => overlayPointTracks(overlay as AnyRecord, frame, triangles));
  const trackedPointCount = Math.min(...perFrame.map((tracks) => tracks.length));
  const byGroup: Record<string, number[]> = {};
  const all: number[] = [];
  for (let frameIndex = 1; frameIndex < perFrame.length; frameIndex++) {
    const prev = perFrame[frameIndex - 1];
    const cur = perFrame[frameIndex];
    const count = Math.min(prev.length, cur.length, trackedPointCount);
    for (let i = 0; i < count; i++) {
      if (prev[i].group !== cur[i].group || prev[i].index !== cur[i].index) continue;
      const dx = cur[i].pt[0] - prev[i].pt[0];
      const dy = cur[i].pt[1] - prev[i].pt[1];
      const d = Math.hypot(dx, dy);
      all.push(d);
      (byGroup[prev[i].group] ||= []).push(d);
    }
  }

  const overallRaw = displacementStats(all);
  const passed = Boolean(
    all.length
    && (overallRaw.rms_px ?? Infinity) <= maxRmsPx
    && (overallRaw.p95_px ?? Infinity) <= maxP95Px
    && (overallRaw.max_px ?? Infinity) <= maxMaxPx,
  );
  const normalizeStats = (stats: DisplacementStats) => ({
    count: stats.count,
    mean_px: roundMetric(stats.mean_px),
    rms_px: roundMetric(stats.rms_px),
    p95_px: roundMetric(stats.p95_px),
    max_px: roundMetric(stats.max_px),
  });
  return {
    schema_version: "incision-overlay-stability/v0.1",
    passed,
    reason: passed ? "within_static_overlay_jitter_thresholds" : "jitter_threshold_exceeded",
    frame_count: landmarkFrames.length,
    tracked_point_count: trackedPointCount,
    sample_count: all.length,
    thresholds,
    overall: normalizeStats(overallRaw),
    by_group: Object.fromEntries(
      Object.entries(byGroup).map(([group, values]) => [group, normalizeStats(displacementStats(values))]),
    ),
  };
}

function hasSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage !== null;
  } catch {
    return false;
  }
}

export function stageIncisionOverlay(overlay: unknown): boolean {
  if (!validateIncisionOverlay(overlay) || !hasSessionStorage()) return false;
  try {
    sessionStorage.setItem(INCISION_OVERLAY_KEY, JSON.stringify(overlay));
    return true;
  } catch {
    return false;
  }
}

export function loadIncisionOverlay(): IncisionOverlayPayload | null {
  if (!hasSessionStorage()) return null;
  const raw = sessionStorage.getItem(INCISION_OVERLAY_KEY);
  if (!raw) return null;
  try {
    const overlay = JSON.parse(raw);
    return validateIncisionOverlay(overlay) ? overlay : null;
  } catch {
    return null;
  }
}

export function clearIncisionOverlay(): void {
  if (hasSessionStorage()) sessionStorage.removeItem(INCISION_OVERLAY_KEY);
}

export const __incisionOverlayForTests = {
  compileIncisionOverlay,
  mapSurfaceRefs,
  measureIncisionOverlayRegistration,
  measureIncisionOverlayJitter,
  pointToSurfaceRef,
  validateIncisionOverlay,
};
