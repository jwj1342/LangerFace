const INCISION_OVERLAY_KEY = "langerface.incisionOverlay";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len2 = (v) => dot(v, v);

function closestPointOnTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { point: a, weights: [1, 0, 0] };

  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { point: b, weights: [0, 1, 0] };

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { point: add(a, mul(ab, v)), weights: [1 - v, v, 0] };
  }

  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
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

export function pointToSurfaceRef(point, verts, tris) {
  let best = null;
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

function refsFromPolyline(points, verts, tris) {
  if (!Array.isArray(points)) return [];
  return points.map((p) => pointToSurfaceRef(p, verts, tris)).filter(Boolean);
}

function codesBySeverity(guardrails, severity) {
  return (guardrails?.warnings || [])
    .filter((w) => w.severity === severity)
    .map((w) => w.code)
    .filter(Boolean);
}

function guardrailSummary(record) {
  const summary = record?.guardrail_summary || {};
  const guardrails = record?.guardrails || {};
  return {
    passed: summary.passed ?? Boolean(guardrails.passed),
    high_codes: Array.isArray(summary.high_codes) ? summary.high_codes : codesBySeverity(guardrails, "high"),
    medium_codes: Array.isArray(summary.medium_codes) ? summary.medium_codes : codesBySeverity(guardrails, "medium"),
  };
}

function normalizeReviewGate(gate) {
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

export function compileIncisionOverlay(record, verts, tris) {
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

function validSurfaceRef(ref) {
  if (!ref || !Number.isInteger(ref.tri) || ref.tri < 0) return false;
  const u = Number(ref.u), v = Number(ref.v), w = Number(ref.w ?? (1 - u - v));
  if (![u, v, w].every(Number.isFinite)) return false;
  if (Math.abs((u + v + w) - 1) > 1e-4) return false;
  if (ref.distance != null && !Number.isFinite(Number(ref.distance))) return false;
  return u >= -1e-4 && v >= -1e-4 && w >= -1e-4;
}

export function validateIncisionOverlay(overlay) {
  if (!overlay || overlay.schema_version !== "incision-overlay/v0.1") return false;
  if (!validSurfaceRef(overlay.tumor?.center_ref)) return false;
  if (!Array.isArray(overlay.candidate?.polyline_refs) || overlay.candidate.polyline_refs.length < 2) return false;
  if (!overlay.candidate.polyline_refs.every(validSurfaceRef)) return false;
  if (overlay.audit?.raw_image_sent !== false || overlay.audit?.review_required !== true) return false;
  if (overlay.review_gate && overlay.review_gate.live_overlay_ready !== true) return false;
  if (overlay.audit?.live_overlay_ready != null && overlay.audit.live_overlay_ready !== true) return false;
  return true;
}

export function mapSurfaceRefs(refs, landmarksPx, triangles) {
  const pts = [];
  const triIds = [];
  for (const ref of refs || []) {
    const tri = triangles[ref.tri];
    if (!tri) continue;
    const a = landmarksPx[tri[0]], b = landmarksPx[tri[1]], c = landmarksPx[tri[2]];
    if (!a || !b || !c) continue;
    const u = Number(ref.u), v = Number(ref.v), w = Number(ref.w ?? (1 - u - v));
    pts.push([
      u * a[0] + v * b[0] + w * c[0],
      u * a[1] + v * b[1] + w * c[1],
      u * a[2] + v * b[2] + w * c[2],
    ]);
    triIds.push(ref.tri);
  }
  return { pts, tris: triIds };
}

function overlayRefGroups(overlay) {
  return [
    ["tumor_center", [overlay?.tumor?.center_ref].filter(Boolean)],
    ["tumor_boundary", overlay?.tumor?.boundary_refs || []],
    ["candidate_polyline", overlay?.candidate?.polyline_refs || []],
  ];
}

function overlayPointTracks(overlay, landmarksPx, triangles) {
  const tracks = [];
  const addTrack = (group, refs) => {
    const mapped = mapSurfaceRefs(refs, landmarksPx, triangles);
    mapped.pts.forEach((pt, i) => tracks.push({ group, index: i, pt }));
  };
  for (const [group, refs] of overlayRefGroups(overlay)) addTrack(group, refs);
  return tracks;
}

function displacementStats(values) {
  if (!values.length) return { count: 0, mean_px: null, rms_px: null, p95_px: null, max_px: null };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const sumSq = values.reduce((acc, v) => acc + v * v, 0);
  const p95Idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    count: values.length,
    mean_px: sum / values.length,
    rms_px: Math.sqrt(sumSq / values.length),
    p95_px: sorted[p95Idx],
    max_px: sorted[sorted.length - 1],
  };
}

function roundMetric(value) {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

function finitePoint(pt) {
  return Array.isArray(pt) && pt.length >= 2 && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1]));
}

function triangleAreaPx2(a, b, c) {
  return Math.abs(
    (Number(b[0]) - Number(a[0])) * (Number(c[1]) - Number(a[1]))
    - (Number(c[0]) - Number(a[0])) * (Number(b[1]) - Number(a[1])),
  ) / 2;
}

function mappedPointFromRef(ref, a, b, c) {
  const u = Number(ref.u), v = Number(ref.v), w = Number(ref.w ?? (1 - u - v));
  return [
    u * Number(a[0]) + v * Number(b[0]) + w * Number(c[0]),
    u * Number(a[1]) + v * Number(b[1]) + w * Number(c[1]),
    u * Number(a[2] || 0) + v * Number(b[2] || 0) + w * Number(c[2] || 0),
  ];
}

export function measureIncisionOverlayRegistration(
  overlay,
  landmarksPx,
  triangles,
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
  } = {},
) {
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

  const groupCounts = {};
  const mappedPoints = [];
  let totalRefCount = 0;
  let invalidRefCount = 0;
  let missingLandmarkCount = 0;
  let degenerateTriangleCount = 0;
  let outOfFrameCount = 0;
  for (const [group, refs] of overlayRefGroups(overlay)) {
    groupCounts[group] ||= { ref_count: 0, mapped_count: 0 };
    for (const ref of refs) {
      totalRefCount += 1;
      groupCounts[group].ref_count += 1;
      const tri = triangles[ref?.tri];
      if (!tri || tri.length < 3) {
        invalidRefCount += 1;
        continue;
      }
      const a = landmarksPx[tri[0]], b = landmarksPx[tri[1]], c = landmarksPx[tri[2]];
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

  let bbox = null;
  if (mappedPoints.length) {
    const xs = mappedPoints.map(({ pt }) => Number(pt[0]));
    const ys = mappedPoints.map(({ pt }) => Number(pt[1]));
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = maxX - minX, height = maxY - minY;
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
  const reasons = [];
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
  overlay,
  landmarkFrames,
  triangles,
  {
    maxRmsPx = 2,
    maxP95Px = 4,
    maxMaxPx = 8,
    context = "static_camera_or_paused_video",
  } = {},
) {
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

  const perFrame = landmarkFrames.map((frame) => overlayPointTracks(overlay, frame, triangles));
  const trackedPointCount = Math.min(...perFrame.map((tracks) => tracks.length));
  const byGroup = {};
  const all = [];
  for (let f = 1; f < perFrame.length; f++) {
    const prev = perFrame[f - 1], cur = perFrame[f];
    const n = Math.min(prev.length, cur.length, trackedPointCount);
    for (let i = 0; i < n; i++) {
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
    && overallRaw.rms_px <= maxRmsPx
    && overallRaw.p95_px <= maxP95Px
    && overallRaw.max_px <= maxMaxPx,
  );
  const normalizeStats = (stats) => ({
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

function hasSessionStorage() {
  try { return typeof sessionStorage !== "undefined" && sessionStorage !== null; }
  catch { return false; }
}

export function stageIncisionOverlay(overlay) {
  if (!validateIncisionOverlay(overlay) || !hasSessionStorage()) return false;
  try {
    sessionStorage.setItem(INCISION_OVERLAY_KEY, JSON.stringify(overlay));
    return true;
  } catch {
    return false;
  }
}

export function loadIncisionOverlay() {
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

export function clearIncisionOverlay() {
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
