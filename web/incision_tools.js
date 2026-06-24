const DEFAULT_RULES = {
  version: "0.2-agentic-incision",
  linear_subcutaneous: {
    length_multiplier: 1.25,
    min_length_mm: 8,
    max_length_mm: 35,
  },
  fusiform_cutaneous: {
    length_to_width_ratio: 3,
    tip_angle_deg: 30,
    min_length_mm: 12,
    max_length_mm: 80,
    samples: 56,
  },
  guardrails: {
    low_direction_confidence: 0.35,
    low_region_confidence: 0.45,
    free_margin_distance_warn_mm: 18,
    free_margin_distance_thresholds_mm: {
      default: 18,
      lower_eyelid: 16,
      lower_eyelid_margin: 16,
      lip_vermilion: 14,
      lip_vermilion_margin: 14,
      oral_commissure: 14,
      nasal_ala: 12,
      nasal_ala_margin: 12,
      nasal_tip: 10,
      inner_canthus: 14,
    },
    min_freehand_boundary_points: 6,
    min_boundary_area_diameter_disk_fraction: 0.08,
    boundary_center_shift_diameter_multiplier: 1,
    sensitive_regions: {
      lower_eyelid: "Protect the lower eyelid free margin; consider manual override away from vertical traction.",
      lip_vermilion: "Protect vermilion border alignment; require clinician confirmation before committing.",
      nasal_ala: "Protect nasal alar contour; evaluate distortion risk before accepting.",
      nasal_tip: "Protect nasal tip contour and support; require clinician confirmation before committing.",
      oral_commissure: "Protect oral commissure alignment and traction; require clinician confirmation before committing.",
    },
  },
};

const TOOL_SCHEMAS = [
  { name: "classify_region", input: ["point"], output: ["region", "subunit", "confidence", "free_margin_distance_mm"] },
  { name: "query_rstl_direction", input: ["point", "source"], output: ["vector", "angle_deg", "confidence", "support_count"] },
  { name: "linear_subcutaneous_incision", input: ["tumor", "direction", "units_per_mm"], output: ["endpoints", "length_mm", "metrics"] },
  { name: "fusiform_cutaneous_incision", input: ["tumor", "direction", "units_per_mm"], output: ["outline", "length_mm", "width_mm", "metrics"] },
  { name: "evaluate_guardrails", input: ["candidate", "anatomy"], output: ["passed", "warnings", "suggested_overrides"] },
  { name: "clinician_edit_candidate", input: ["edit"], output: ["candidate", "guardrails", "provenance"] },
  { name: "compare_candidates", input: ["review_records"], output: ["ranked_candidates", "score_breakdown", "clinical_boundary"] },
  { name: "save_review_record", input: ["candidate", "tumor", "trace", "privacy_audit", "reviewer", "review_status", "review_notes"], output: ["review_record_json", "report_markdown", "screenshot_png", "audit_events"] },
];

const SENSITIVE_ANCHORS = {
  left_lower_eyelid: [0.30, 0.59],
  right_lower_eyelid: [0.70, 0.59],
  left_nasal_ala: [0.40, 0.49],
  right_nasal_ala: [0.60, 0.49],
  nasal_tip: [0.50, 0.43],
  lip_vermilion: [0.50, 0.31],
  left_oral_commissure: [0.35, 0.32],
  right_oral_commissure: [0.65, 0.32],
};
const SENSITIVE_MARGIN_SEGMENTS = {
  left_lower_eyelid_margin: [[0.20, 0.59], [0.42, 0.59]],
  right_lower_eyelid_margin: [[0.58, 0.59], [0.80, 0.59]],
  left_nasal_ala_margin: [[0.36, 0.45], [0.42, 0.52]],
  right_nasal_ala_margin: [[0.58, 0.52], [0.64, 0.45]],
  lip_vermilion_margin: [[0.34, 0.31], [0.66, 0.31]],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [1, 0, 0];
};

function bbox(verts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  return { lo, hi };
}

function pointSegmentDistance2d(point, segment) {
  const [a, b] = segment;
  const ab = [b[0] - a[0], b[1] - a[1]];
  const denom = ab[0] * ab[0] + ab[1] * ab[1];
  if (denom <= 1e-12) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = clamp(((point[0] - a[0]) * ab[0] + (point[1] - a[1]) * ab[1]) / denom, 0, 1);
  const closest = [a[0] + t * ab[0], a[1] + t * ab[1]];
  return Math.hypot(point[0] - closest[0], point[1] - closest[1]);
}

function sensitiveMarginDistances(normalizedXY, faceHeightMm = 180) {
  const distances = [];
  for (const [name, anchor] of Object.entries(SENSITIVE_ANCHORS)) {
    distances.push([name, Math.hypot(normalizedXY[0] - anchor[0], normalizedXY[1] - anchor[1]) * faceHeightMm]);
  }
  for (const [name, segment] of Object.entries(SENSITIVE_MARGIN_SEGMENTS)) {
    distances.push([name, pointSegmentDistance2d(normalizedXY, segment) * faceHeightMm]);
  }
  return distances;
}

export function unitsPerMmFromVertices(verts, faceHeightMm = 180) {
  const { lo, hi } = bbox(verts);
  const height = hi[1] - lo[1];
  return height > 1e-9 ? height / faceHeightMm : 1;
}

export function classifyRegion(point, verts) {
  const { lo, hi } = bbox(verts);
  const span = [Math.max(hi[0] - lo[0], 1e-9), Math.max(hi[1] - lo[1], 1e-9)];
  const nx = clamp((point[0] - lo[0]) / span[0], 0, 1);
  const ny = clamp((point[1] - lo[1]) / span[1], 0, 1);
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
  return {
    region,
    subunit,
    confidence,
    normalized_xy: [nx, ny],
    sensitive,
    nearby_landmarks: nearby,
    free_margin_distance_mm: freeMarginDistanceMm,
  };
}

function candidatePoints(candidate) {
  const raw = candidate.polyline || candidate.outline || candidate.endpoints || [];
  return raw.filter((p) => Array.isArray(p) && p.length === 3).map((p) => p.map(Number)).filter((p) => p.every(Number.isFinite));
}

export function annotateCandidateSensitiveDistances(candidate, verts, faceHeightMm = 180) {
  const points = candidatePoints(candidate);
  if (!points.length || !Array.isArray(verts) || !verts.length) return candidate;
  const { lo, hi } = bbox(verts);
  const span = [Math.max(hi[0] - lo[0], 1e-9), Math.max(hi[1] - lo[1], 1e-9)];
  let best = { distance: Infinity, landmark: "", point: null };
  for (const point of points) {
    const nx = clamp((point[0] - lo[0]) / span[0], 0, 1);
    const ny = clamp((point[1] - lo[1]) / span[1], 0, 1);
    for (const [landmark, distance] of sensitiveMarginDistances([nx, ny], faceHeightMm)) {
      if (distance < best.distance) best = { distance, landmark, point };
    }
  }
  if (!Number.isFinite(best.distance)) return candidate;
  candidate.metrics = {
    ...(candidate.metrics || {}),
    sensitive_free_margin_min_distance_mm: best.distance,
    sensitive_free_margin_nearest: best.landmark,
    sensitive_free_margin_point: best.point,
  };
  return candidate;
}

function atlasSamples(verts, tris, atlas) {
  const pts = [], tans = [];
  for (const line of atlas.lines || []) {
    const P = [];
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

function axisAngleDiffDeg(a, b) {
  return Math.abs((((a - b + 90) % 180) + 180) % 180 - 90);
}

function axialAngularSpreadDeg(vectors, reference) {
  if (vectors.length <= 1) return 0;
  const refAngle = Math.atan2(reference[1], reference[0]) * 180 / Math.PI;
  let maxDev = 0;
  for (const v of vectors) {
    const angle = Math.atan2(v[1], v[0]) * 180 / Math.PI;
    maxDev = Math.max(maxDev, axisAngleDiffDeg(angle, refAngle));
  }
  return Math.min(180, 2 * maxDev);
}

export function queryDirection(point, verts, tris, atlas) {
  const { pts, tans } = atlasSamples(verts, tris, atlas);
  if (!pts.length) {
    return { point, vector: [1, 0, 0], angle_deg: 0, confidence: 0, source: "rstl_atlas_empty", nearest_distance: Infinity };
  }
  let best = 0, bd = Infinity;
  const dist2 = [];
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
  const order = dist2.map((d, i) => [d, i]).sort((a, b) => a[0] - b[0]).slice(0, Math.min(7, dist2.length));
  const ref = tans[best];
  let acc = [0, 0, 0], weightSum = 0;
  const signed = [];
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
  const confidence = clamp((1 - nearest / maxDistance) * (spread > 90 ? 0.75 : 1), 0, 1);
  return {
    point,
    vector,
    angle_deg: Math.atan2(vector[1], vector[0]) * 180 / Math.PI,
    confidence,
    source: "rstl_atlas_weighted_nearest",
    nearest_distance: nearest,
    support_count: order.length,
    angular_spread_deg: spread,
  };
}

export function normalizeTumorInput(tumor) {
  if (!["subcutaneous", "cutaneous"].includes(tumor.kind)) throw new Error("tumor.kind must be subcutaneous or cutaneous");
  if (!Array.isArray(tumor.center) || tumor.center.length !== 3) throw new Error("tumor.center must be a 3D point");
  if (!(tumor.diameter_mm > 0)) throw new Error("tumor.diameter_mm must be positive");
  return {
    kind: tumor.kind,
    center: tumor.center.map(Number),
    diameter_mm: Number(tumor.diameter_mm),
    depth_mm: tumor.depth_mm == null ? null : Number(tumor.depth_mm),
    margin_mm: Number(tumor.margin_mm || 0),
    boundary: Array.isArray(tumor.boundary)
      ? tumor.boundary
        .filter((p) => Array.isArray(p) && p.length === 3)
        .map((p) => p.map(Number))
        .filter((p) => p.every(Number.isFinite))
      : [],
    boundary_mode: tumor.boundary_mode || "center_diameter",
    boundary_source: tumor.boundary_source || "manual",
    source: tumor.source || "manual",
    author: tumor.author || "",
    units: tumor.units || "mm",
  };
}

function validateTumor(tumor) {
  return normalizeTumorInput(tumor);
}

export function generateLinearIncision(tumorInput, direction, unitsPerMm, rules = DEFAULT_RULES) {
  const tumor = validateTumor(tumorInput);
  if (tumor.kind !== "subcutaneous") throw new Error("linear incision requires subcutaneous tumor");
  const cfg = rules.linear_subcutaneous;
  const axis = norm(direction.vector);
  const targetLengthMm = tumor.diameter_mm * cfg.length_multiplier;
  const lengthMm = clamp(targetLengthMm, cfg.min_length_mm, cfg.max_length_mm);
  const diameterCoverageDeficitMm = Math.max(0, tumor.diameter_mm - lengthMm);
  const half = mul(axis, lengthMm * unitsPerMm * 0.5);
  const p0 = sub(tumor.center, half), p1 = add(tumor.center, half);
  return {
    id: "linear_subcutaneous_candidate",
    type: "linear",
    tumor_kind: tumor.kind,
    center: tumor.center,
    axis,
    endpoints: [p0, p1],
    polyline: [p0, p1],
    length_mm: lengthMm,
    length_units: lengthMm * unitsPerMm,
    direction_confidence: direction.confidence,
    metrics: {
      rstl_deviation_deg: 0,
      diameter_mm: tumor.diameter_mm,
      diameter_coverage_required_mm: tumor.diameter_mm,
      diameter_coverage_deficit_mm: diameterCoverageDeficitMm,
      length_target_mm: targetLengthMm,
      length_target_deficit_mm: Math.max(0, targetLengthMm - lengthMm),
      length_clamped_by_min: targetLengthMm < cfg.min_length_mm,
      length_clamped_by_max: targetLengthMm > cfg.max_length_mm,
      length_multiplier: lengthMm / tumor.diameter_mm,
    },
    provenance: { generator: "generateLinearIncision", rules_version: rules.version },
  };
}

function tangentPerp(axis, normal) {
  const n = norm(normal || [0, 0, 1]);
  let p = cross(n, axis);
  if (Math.hypot(p[0], p[1], p[2]) < 1e-9) p = [-axis[1], axis[0], 0];
  return norm(p);
}

function polygonArea(points) {
  if (points.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return Math.abs(s) * 0.5;
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, c) {
  const eps = 1e-9;
  return (
    Math.min(a[0], c[0]) - eps <= b[0] && b[0] <= Math.max(a[0], c[0]) + eps &&
    Math.min(a[1], c[1]) - eps <= b[1] && b[1] <= Math.max(a[1], c[1]) + eps &&
    Math.abs(orientation(a, b, c)) <= eps
  );
}

function segmentsIntersect(a, b, c, d) {
  const eps = 1e-9;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 * o2 < -eps && o3 * o4 < -eps) return true;
  return onSegment(a, c, b) || onSegment(a, d, b) || onSegment(c, a, d) || onSegment(c, b, d);
}

function polygonSelfIntersects(points) {
  if (points.length < 4) return false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function boundaryProfile(tumor, axis, perp, unitsPerMm) {
  const boundary = (tumor.boundary || []).filter((p) => Array.isArray(p) && p.length === 3).map((p) => p.map(Number));
  if (boundary.length < 3 || !(unitsPerMm > 0)) return null;
  const center = boundary.reduce((acc, p) => add(acc, p), [0, 0, 0]).map((v) => v / boundary.length);
  const projected = [];
  let maxAxis = 0, maxPerp = 0;
  for (const p of boundary) {
    const d = sub(p, center);
    const q = [dot(d, axis), dot(d, perp)];
    projected.push(q);
    maxAxis = Math.max(maxAxis, Math.abs(q[0]));
    maxPerp = Math.max(maxPerp, Math.abs(q[1]));
  }
  const areaMm2 = polygonArea(projected) / (unitsPerMm * unitsPerMm);
  const nominalDiskAreaMm2 = Math.PI * (tumor.diameter_mm * 0.5) ** 2;
  return {
    point_count: boundary.length,
    center,
    axis_diameter_mm: 2 * maxAxis / unitsPerMm,
    perp_diameter_mm: 2 * maxPerp / unitsPerMm,
    area_mm2: areaMm2,
    area_ratio_to_diameter_disk: areaMm2 / Math.max(nominalDiskAreaMm2, 1e-9),
    self_intersection: polygonSelfIntersects(projected),
    center_shift_mm: Math.hypot(...sub(center, tumor.center)) / unitsPerMm,
  };
}

function hermiteHalfWidth(u, tipSlope) {
  return (tipSlope - 2) * u ** 3 + (3 - 2 * tipSlope) * u ** 2 + tipSlope * u;
}

function fusiformProfile(center, axis, perp, halfL, halfW, samples, tipAngleDeg) {
  if (!(halfL > 1e-9) || !(halfW > 1e-9)) throw new Error("fusiform profile requires positive length and width");
  const ratio = halfL / halfW;
  const targetAngle = clamp(Number(tipAngleDeg || 30), 8, 75);
  const targetSlope = Math.tan((targetAngle / 2) * Math.PI / 180);
  const requestedShapeSlope = ratio * targetSlope;
  const shapeSlope = Math.min(requestedShapeSlope, 2.95);
  const actualSlope = shapeSlope / ratio;
  const actualAngle = Math.atan(actualSlope) * 2 * 180 / Math.PI;
  const upper = [], lower = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = (t - 0.5) * 2 * halfL;
    const u = t <= 0.5 ? 2 * t : 2 * (1 - t);
    const y = hermiteHalfWidth(u, shapeSlope) * halfW;
    upper.push(add(add(center, mul(axis, x)), mul(perp, y)));
    lower.push(add(add(center, mul(axis, x)), mul(perp, -y)));
  }
  return {
    upper,
    lower,
    metrics: {
      profile: "cubic_hermite_tip_angle_constrained",
      tip_angle_target_deg: targetAngle,
      tip_angle_estimated_deg: actualAngle,
      tip_angle_error_deg: Math.abs(actualAngle - targetAngle),
      tip_angle_limited_by_ratio: shapeSlope < requestedShapeSlope,
    },
  };
}

export function summarizeTumorBoundary(tumorInput, axis = [1, 0, 0], normal = [0, 0, 1], unitsPerMm = 1) {
  const tumor = validateTumor(tumorInput);
  const a = norm(axis);
  const perp = tangentPerp(a, normal);
  const profile = boundaryProfile(tumor, a, perp, unitsPerMm);
  const warnings = [];
  if (tumor.kind === "cutaneous" && tumor.boundary_mode === "freehand" && tumor.boundary.length < 6) {
    warnings.push({ code: "few_boundary_points", severity: "medium", message: "Freehand lesion boundary has fewer than 6 points." });
  }
  if (!profile) {
    return {
      mode: tumor.boundary_mode,
      source: tumor.boundary_source,
      point_count: tumor.boundary.length,
      boundary_used: false,
      warnings,
    };
  }
  const ratio = profile.perp_diameter_mm > 1e-6 ? profile.axis_diameter_mm / profile.perp_diameter_mm : Infinity;
  if (profile.center_shift_mm > Math.max(tumor.diameter_mm, 1)) {
    warnings.push({ code: "boundary_center_shift", severity: "medium", message: "Boundary centroid is far from selected tumor center." });
  }
  return {
    mode: tumor.boundary_mode,
    source: tumor.boundary_source,
    point_count: profile.point_count,
    boundary_used: true,
    center: profile.center,
    axis_diameter_mm: profile.axis_diameter_mm,
    perp_diameter_mm: profile.perp_diameter_mm,
    area_mm2: profile.area_mm2,
    area_ratio_to_diameter_disk: profile.area_ratio_to_diameter_disk,
    self_intersection: profile.self_intersection,
    center_shift_mm: profile.center_shift_mm,
    aspect_ratio: ratio,
    warnings,
  };
}

export function generateFusiformIncision(tumorInput, direction, unitsPerMm, normal = [0, 0, 1], rules = DEFAULT_RULES) {
  const tumor = validateTumor(tumorInput);
  if (tumor.kind !== "cutaneous") throw new Error("fusiform incision requires cutaneous tumor");
  const cfg = rules.fusiform_cutaneous;
  const axis = norm(direction.vector);
  const perp = tangentPerp(axis, normal);
  const boundary = boundaryProfile(tumor, axis, perp, unitsPerMm);
  const center = boundary?.center || tumor.center;
  const lesionAxisMm = Math.max(tumor.diameter_mm, Number(boundary?.axis_diameter_mm || 0));
  const lesionWidthMm = Math.max(tumor.diameter_mm, Number(boundary?.perp_diameter_mm || 0));
  const widthMm = lesionWidthMm + 2 * tumor.margin_mm;
  const axisCoverageMm = lesionAxisMm + 2 * tumor.margin_mm;
  const ratioLengthMm = widthMm * cfg.length_to_width_ratio;
  const targetLengthMm = Math.max(ratioLengthMm, axisCoverageMm);
  const lengthMm = clamp(targetLengthMm, cfg.min_length_mm, cfg.max_length_mm);
  const axisCoverageDeficitMm = Math.max(0, axisCoverageMm - lengthMm);
  const halfL = lengthMm * unitsPerMm * 0.5, halfW = widthMm * unitsPerMm * 0.5;
  const samples = Math.max(12, cfg.samples || 56);
  const profile = fusiformProfile(center, axis, perp, halfL, halfW, samples, cfg.tip_angle_deg);
  const { upper, lower } = profile;
  const outline = upper.concat(lower.slice(1, -1).reverse());
  return {
    id: "fusiform_cutaneous_candidate",
    type: "fusiform",
    tumor_kind: tumor.kind,
    center,
    axis,
    width_axis: perp,
    endpoints: [sub(center, mul(axis, halfL)), add(center, mul(axis, halfL))],
    outline,
    polyline: outline.concat([outline[0]]),
    length_mm: lengthMm,
    width_mm: widthMm,
    length_units: lengthMm * unitsPerMm,
    width_units: widthMm * unitsPerMm,
    tip_angle_deg: profile.metrics.tip_angle_estimated_deg,
    direction_confidence: direction.confidence,
    metrics: {
      rstl_deviation_deg: 0,
      length_to_width_ratio: lengthMm / widthMm,
      ...profile.metrics,
      diameter_mm: tumor.diameter_mm,
      margin_mm: tumor.margin_mm,
      length_target_mm: targetLengthMm,
      length_ratio_target_mm: ratioLengthMm,
      axis_coverage_required_mm: axisCoverageMm,
      axis_coverage_deficit_mm: axisCoverageDeficitMm,
      length_clamped_by_min: targetLengthMm < cfg.min_length_mm,
      length_clamped_by_max: targetLengthMm > cfg.max_length_mm,
      boundary_used: Boolean(boundary),
      boundary_point_count: boundary?.point_count || tumor.boundary.length,
      boundary_axis_diameter_mm: boundary?.axis_diameter_mm || null,
      boundary_perp_diameter_mm: boundary?.perp_diameter_mm || null,
      boundary_area_mm2: boundary?.area_mm2 || null,
      boundary_area_ratio_to_diameter_disk: boundary?.area_ratio_to_diameter_disk || null,
      boundary_self_intersection: Boolean(boundary?.self_intersection),
      boundary_center_shift_mm: boundary?.center_shift_mm || null,
    },
    provenance: {
      generator: "generateFusiformIncision",
      rules_version: rules.version,
      boundary_source: tumor.boundary_source,
    },
  };
}

function asLandmarkNames(value) {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return [String(value)];
}

function freeMarginDistanceThresholdMm(landmarks, cfg, fallbackRegion = "unknown") {
  const fallback = Number(cfg?.free_margin_distance_warn_mm ?? 18);
  const thresholds = cfg?.free_margin_distance_thresholds_mm || {};
  const defaultThreshold = Number(thresholds.default ?? fallback);
  const names = asLandmarkNames(landmarks);
  if (!names.length) names.push(fallbackRegion);

  const matched = [];
  for (const name of names) {
    const normalized = String(name).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(thresholds, normalized)) {
      const threshold = Number(thresholds[normalized]);
      if (Number.isFinite(threshold)) matched.push(threshold);
      continue;
    }
    for (const [key, rawThreshold] of Object.entries(thresholds)) {
      const normalizedKey = String(key).toLowerCase();
      if (normalizedKey !== "default" && normalizedKey && normalized.includes(normalizedKey)) {
        const threshold = Number(rawThreshold);
        if (Number.isFinite(threshold)) matched.push(threshold);
        break;
      }
    }
  }

  return matched.length ? Math.max(...matched) : defaultThreshold;
}

export function evaluateGuardrails(candidate, anatomy, rules = DEFAULT_RULES) {
  const cfg = rules.guardrails;
  const warnings = [], suggested_overrides = [];
  if ((candidate.direction_confidence || 0) < cfg.low_direction_confidence) {
    warnings.push({ code: "low_rstl_confidence", severity: "medium", message: "Local RSTL direction is low confidence; require manual confirmation." });
  }
  if ((anatomy.confidence || 0) < cfg.low_region_confidence) {
    warnings.push({ code: "low_region_confidence", severity: "medium", message: "Face region classification is low confidence; require clinician review." });
  }
  if (cfg.sensitive_regions[anatomy.region]) {
    warnings.push({ code: `sensitive_region_${anatomy.region}`, severity: "high", message: cfg.sensitive_regions[anatomy.region] });
    suggested_overrides.push({ kind: "manual_direction_confirmation", reason: `${anatomy.region} is a sensitive free-margin region.` });
  }
  const centerThreshold = freeMarginDistanceThresholdMm(anatomy.nearby_landmarks, cfg, anatomy.region);
  if (anatomy.free_margin_distance_mm != null && Number(anatomy.free_margin_distance_mm) <= centerThreshold) {
    warnings.push({
      code: "near_sensitive_free_margin",
      severity: "high",
      message: `Candidate center is approximately ${Number(anatomy.free_margin_distance_mm).toFixed(1)} mm from sensitive free-margin landmark(s): ${(anatomy.nearby_landmarks || []).join(", ") || anatomy.region} (threshold ${centerThreshold.toFixed(1)} mm).`,
    });
    suggested_overrides.push({ kind: "free_margin_distance_review", reason: "Confirm functional and contour risk before accepting this direction." });
  }
  const candidateDistance = candidate.metrics?.sensitive_free_margin_min_distance_mm;
  const diameterCoverageDeficit = Number(candidate.metrics?.diameter_coverage_deficit_mm || 0);
  if (candidate.type === "linear" && diameterCoverageDeficit > 1e-6) {
    const required = candidate.metrics?.diameter_coverage_required_mm;
    warnings.push({
      code: "linear_diameter_coverage_deficit",
      severity: "high",
      message: `Linear candidate is shorter than the recorded subcutaneous lesion diameter by ${diameterCoverageDeficit.toFixed(1)} mm${required != null ? ` (required ${Number(required).toFixed(1)} mm).` : "."}`,
    });
    suggested_overrides.push({
      kind: "linear_length_or_access_review",
      reason: "Increase incision length, confirm a smaller imaging diameter, or record an explicit clinician access decision.",
    });
  }
  if (candidate.type === "fusiform" && candidate.metrics?.boundary_used) {
    const boundaryPoints = Number(candidate.metrics?.boundary_point_count || 0);
    const minPoints = Number(cfg.min_freehand_boundary_points || 6);
    if (boundaryPoints > 0 && boundaryPoints < minPoints) {
      warnings.push({
        code: "cutaneous_boundary_too_few_points",
        severity: "medium",
        message: `Cutaneous lesion boundary has ${boundaryPoints} point(s); ${minPoints} or more are recommended before review.`,
      });
      suggested_overrides.push({
        kind: "redraw_cutaneous_boundary",
        reason: "Add more lesion boundary points or use ellipse mode before accepting this candidate.",
      });
    }

    if (candidate.metrics?.boundary_self_intersection) {
      warnings.push({
        code: "cutaneous_boundary_self_intersection",
        severity: "high",
        message: "Cutaneous lesion boundary self-intersects; redraw a simple closed contour.",
      });
      suggested_overrides.push({
        kind: "redraw_cutaneous_boundary",
        reason: "Self-intersecting lesion contours cannot be treated as valid excision boundaries.",
      });
    }

    const areaRatio = candidate.metrics?.boundary_area_ratio_to_diameter_disk;
    const minAreaRatio = Number(cfg.min_boundary_area_diameter_disk_fraction || 0.08);
    if (areaRatio != null && Number(areaRatio) < minAreaRatio) {
      const area = candidate.metrics?.boundary_area_mm2;
      warnings.push({
        code: "cutaneous_boundary_degenerate_area",
        severity: "high",
        message: `Cutaneous lesion boundary encloses too little projected area (ratio ${Number(areaRatio).toFixed(3)}${area != null ? `, area ${Number(area).toFixed(1)} mm^2` : ""}); redraw the lesion contour.`,
      });
      suggested_overrides.push({
        kind: "redraw_cutaneous_boundary",
        reason: "Boundary points are nearly collinear or do not enclose the selected lesion.",
      });
    }

    const centerShift = candidate.metrics?.boundary_center_shift_mm;
    const lesionDiameter = Number(candidate.metrics?.diameter_mm || 0);
    const multiplier = Number(cfg.boundary_center_shift_diameter_multiplier || 1);
    if (centerShift != null && lesionDiameter > 0) {
      const threshold = Math.max(lesionDiameter * multiplier, 1e-6);
      if (Number(centerShift) > threshold) {
        warnings.push({
          code: "cutaneous_boundary_center_shift",
          severity: "high",
          message: `Cutaneous lesion boundary centroid is ${Number(centerShift).toFixed(1)} mm from the selected tumor center (threshold ${threshold.toFixed(1)} mm).`,
        });
        suggested_overrides.push({
          kind: "tumor_center_or_boundary_review",
          reason: "Re-pick tumor center, redraw boundary, or record why the boundary is intentionally eccentric.",
        });
      }
    }
  }
  const axisCoverageDeficit = Number(candidate.metrics?.axis_coverage_deficit_mm || 0);
  if (candidate.type === "fusiform" && axisCoverageDeficit > 1e-6) {
    const required = candidate.metrics?.axis_coverage_required_mm;
    warnings.push({
      code: "fusiform_axis_coverage_deficit",
      severity: "high",
      message: `Fusiform candidate is shorter than the lesion boundary plus margin coverage requirement by ${axisCoverageDeficit.toFixed(1)} mm${required != null ? ` (required ${Number(required).toFixed(1)} mm).` : "."}`,
    });
    suggested_overrides.push({
      kind: "fusiform_length_or_margin_review",
      reason: "Increase candidate length, reduce margin only with explicit clinician decision, or redraw boundary.",
    });
  }
  const nearestSensitiveMargin = candidate.metrics?.sensitive_free_margin_nearest || anatomy.region;
  const candidateThreshold = freeMarginDistanceThresholdMm(nearestSensitiveMargin, cfg, anatomy.region);
  if (candidateDistance != null && Number(candidateDistance) <= candidateThreshold) {
    warnings.push({
      code: "candidate_near_sensitive_free_margin",
      severity: "high",
      message: `Candidate geometry is approximately ${Number(candidateDistance).toFixed(1)} mm from sensitive free-margin landmark: ${nearestSensitiveMargin} (threshold ${candidateThreshold.toFixed(1)} mm).`,
    });
    suggested_overrides.push({ kind: "candidate_free_margin_distance_review", reason: "Review the full candidate path/outline near sensitive free margins." });
  }
  const typeCfg = candidate.type === "fusiform" ? rules.fusiform_cutaneous : rules.linear_subcutaneous;
  const maxDeviation = Number(typeCfg?.max_rstl_deviation_deg ?? 15);
  const deviation = Math.abs(Number(candidate.metrics?.rstl_deviation_deg || 0));
  if (deviation > maxDeviation) {
    const reason = candidate.provenance?.clinician_edit?.reason || "";
    warnings.push({
      code: "rstl_deviation_override",
      severity: reason ? "medium" : "high",
      message: reason
        ? `Long-axis direction deviates ${deviation.toFixed(1)} deg from local RSTL with clinician override reason recorded.`
        : `Long-axis direction deviates ${deviation.toFixed(1)} deg from local RSTL; record an override reason before review.`,
    });
    if (!reason) suggested_overrides.push({ kind: "override_reason_required", reason: "Candidate long axis deviates from local RSTL." });
  }
  return {
    passed: !warnings.some((w) => w.severity === "high"),
    warnings,
    suggested_overrides,
  };
}

function rotateInPlane(axis, normal, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  const p = tangentPerp(axis, normal);
  return norm(add(mul(axis, Math.cos(a)), mul(p, Math.sin(a))));
}

function clonePlan(plan) {
  return JSON.parse(JSON.stringify(plan));
}

function editedTraceStep(edit, candidate, guardrails) {
  return {
    summary: "医生调整候选参数，系统重新计算几何并复跑 guardrails。",
    action: "clinician_edit_candidate",
    input: edit,
    observation: {
      candidate: shortCandidate(candidate),
      guardrails,
    },
  };
}

function buildEditedFusiform(base, center, axis, normal, unitsPerMm, edit) {
  const widthAxis = tangentPerp(axis, normal);
  const lengthMm = Math.max(1, Number(base.length_mm || 1) * Number(edit.length_scale || 1));
  const widthMm = Math.max(1, Number(base.width_mm || 1) * Number(edit.width_scale || 1));
  const axisCoverageRequiredMm = Number(base.metrics?.axis_coverage_required_mm || 0);
  const axisCoverageDeficitMm = axisCoverageRequiredMm > 0 ? Math.max(0, axisCoverageRequiredMm - lengthMm) : 0;
  const halfL = lengthMm * unitsPerMm * 0.5;
  const halfW = widthMm * unitsPerMm * 0.5;
  const samples = Math.max(12, Math.round((base.outline?.length || 58) / 2));
  const targetTipAngle = base.metrics?.tip_angle_target_deg || base.tip_angle_deg || 30;
  const profile = fusiformProfile(center, axis, widthAxis, halfL, halfW, samples, targetTipAngle);
  const { upper, lower } = profile;
  const outline = upper.concat(lower.slice(1, -1).reverse());
  return {
    ...base,
    axis,
    width_axis: widthAxis,
    center,
    endpoints: [sub(center, mul(axis, halfL)), add(center, mul(axis, halfL))],
    outline,
    polyline: outline.concat([outline[0]]),
    length_mm: lengthMm,
    width_mm: widthMm,
    length_units: lengthMm * unitsPerMm,
    width_units: widthMm * unitsPerMm,
    tip_angle_deg: profile.metrics.tip_angle_estimated_deg,
    metrics: {
      ...(base.metrics || {}),
      rstl_deviation_deg: Math.abs(Number(edit.angle_offset_deg || 0)),
      length_to_width_ratio: lengthMm / widthMm,
      ...profile.metrics,
      axis_coverage_deficit_mm: axisCoverageDeficitMm,
    },
  };
}

export function applyCandidateEdit(plan, edit = {}, normal = [0, 0, 1], unitsPerMm = 1, verts = null) {
  const out = clonePlan(plan);
  const base = clonePlan(plan.original_candidate || plan.candidate);
  const axis0 = norm(base.axis || [1, 0, 0]);
  const perp0 = tangentPerp(axis0, normal);
  const axis = rotateInPlane(axis0, normal, Number(edit.angle_offset_deg || 0));
  const center = add(
    add(base.center || plan.tumor.center, mul(axis0, Number(edit.shift_along_mm || 0) * unitsPerMm)),
    mul(perp0, Number(edit.shift_perp_mm || 0) * unitsPerMm),
  );
  const editRecord = {
    kind: "clinician_adjustment",
    angle_offset_deg: Number(edit.angle_offset_deg || 0),
    length_scale: Number(edit.length_scale || 1),
    width_scale: Number(edit.width_scale || 1),
    shift_along_mm: Number(edit.shift_along_mm || 0),
    shift_perp_mm: Number(edit.shift_perp_mm || 0),
    reason: String(edit.reason || ""),
    source: "web/incision_agent",
  };

  let candidate;
  if (base.type === "linear") {
    const lengthMm = Math.max(1, Number(base.length_mm || 1) * editRecord.length_scale);
    const diameterCoverageRequiredMm = Number(base.metrics?.diameter_coverage_required_mm || plan.tumor?.diameter_mm || 0);
    const half = mul(axis, lengthMm * unitsPerMm * 0.5);
    candidate = {
      ...base,
      center,
      axis,
      endpoints: [sub(center, half), add(center, half)],
      polyline: [sub(center, half), add(center, half)],
      length_mm: lengthMm,
      length_units: lengthMm * unitsPerMm,
      metrics: {
        ...(base.metrics || {}),
        rstl_deviation_deg: Math.abs(editRecord.angle_offset_deg),
        length_multiplier: lengthMm / Math.max(Number(plan.tumor?.diameter_mm || base.metrics?.diameter_mm || 1), 1),
        diameter_coverage_deficit_mm: diameterCoverageRequiredMm > 0
          ? Math.max(0, diameterCoverageRequiredMm - lengthMm)
          : 0,
      },
    };
  } else {
    candidate = buildEditedFusiform(base, center, axis, normal, unitsPerMm, editRecord);
  }

  if (verts) annotateCandidateSensitiveDistances(candidate, verts);
  candidate.provenance = {
    ...(base.provenance || {}),
    source_candidate_id: base.id,
    clinician_edit: editRecord,
  };
  candidate.edited = true;

  out.original_candidate = plan.original_candidate || plan.candidate;
  out.candidate = candidate;
  out.guardrails = evaluateGuardrails(candidate, out.anatomy);
  out.trace = (out.trace || []).filter((step) => step.action !== "clinician_edit_candidate");
  if (
    editRecord.angle_offset_deg !== 0 ||
    editRecord.length_scale !== 1 ||
    editRecord.width_scale !== 1 ||
    editRecord.shift_along_mm !== 0 ||
    editRecord.shift_perp_mm !== 0 ||
    editRecord.reason
  ) {
    out.trace.push(editedTraceStep(editRecord, candidate, out.guardrails));
    out.llm = {
      ...(out.llm || {}),
      summary: "已应用医生调整并重新计算候选几何；请复核 guardrails 与覆盖原因。",
      next_step: "医生确认调整是否进入审阅记录。",
    };
  }
  return out;
}

function shortCandidate(candidate) {
  const keys = ["id", "type", "tumor_kind", "center", "axis", "endpoints", "length_mm", "width_mm", "tip_angle_deg", "direction_confidence", "metrics"];
  return Object.fromEntries(keys.filter((k) => k in candidate).map((k) => [k, candidate[k]]));
}

function fallbackSummary(tumor, candidate, guardrails) {
  const kind = candidate.type === "linear" ? "皮下线性切口" : "皮表梭形切口";
  const status = guardrails.passed ? "guardrails 通过" : "guardrails 需要医生复核";
  return `已生成${kind}候选：长轴沿局部 RSTL，病灶直径 ${tumor.diameter_mm.toFixed(1)} mm，${status}。`;
}

export function planIncisionDeterministic({ tumor: tumorInput, verts, tris, atlas, normal = [0, 0, 1] }) {
  const tumor = validateTumor(tumorInput);
  const anatomy = classifyRegion(tumor.center, verts);
  const direction = queryDirection(tumor.center, verts, tris, atlas);
  const unitsPerMm = unitsPerMmFromVertices(verts);
  const candidate = tumor.kind === "subcutaneous"
    ? generateLinearIncision(tumor, direction, unitsPerMm)
    : generateFusiformIncision(tumor, direction, unitsPerMm, normal);
  annotateCandidateSensitiveDistances(candidate, verts);
  const guardrails = evaluateGuardrails(candidate, anatomy);
  const trace = [
    { summary: "定位病灶所在面部分区。", action: "classify_region", input: { point: tumor.center }, observation: anatomy },
    { summary: "查询局部 RSTL 方向。", action: "query_rstl_direction", input: { point: tumor.center, source: "rstl_atlas" }, observation: direction },
    {
      summary: "用确定性工具生成切口候选。",
      action: tumor.kind === "subcutaneous" ? "linear_subcutaneous_incision" : "fusiform_cutaneous_incision",
      input: { tumor, direction, units_per_mm: unitsPerMm },
      observation: shortCandidate(candidate),
    },
    { summary: "评估敏感结构和置信度 guardrails。", action: "evaluate_guardrails", input: { candidate: shortCandidate(candidate), anatomy }, observation: guardrails },
  ];
  return {
    schema_version: "agentic-incision-plan/v0.1",
    agent_trace_mode: "single_turn_react_with_deterministic_tools",
    tool_schemas: TOOL_SCHEMAS,
    tumor,
    anatomy,
    direction,
    candidate,
    guardrails,
    trace,
    llm: {
      summary: fallbackSummary(tumor, candidate, guardrails),
      rationale: "浏览器内确定性工具生成；未使用 LLM 摘要。",
      next_step: "医生审阅、编辑或拒绝该候选。",
      model: null,
      reasoning: "",
    },
    provider: { mode: "browser_deterministic_fallback", model: null, error: null },
  };
}

function finiteOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function warningSeverityCounts(guardrails = {}) {
  const warnings = Array.isArray(guardrails.warnings) ? guardrails.warnings : [];
  return {
    high: warnings.filter((w) => w.severity === "high").length,
    medium: warnings.filter((w) => w.severity === "medium").length,
    low: warnings.filter((w) => w.severity === "low").length,
  };
}

function comparisonReasons({ severity, metrics, reviewStatus, sensitiveDistance, sensitiveThreshold, candidateType }) {
  const reasons = [];
  if (reviewStatus === "rejected_by_clinician") reasons.push("医生已否决");
  if (severity.high) reasons.push(`${severity.high} 个 high guardrail`);
  if (severity.medium) reasons.push(`${severity.medium} 个 medium guardrail`);
  const rstlDeviation = finiteOr(metrics.rstl_deviation_deg, 0);
  if (rstlDeviation > 0) reasons.push(`RSTL 偏角 ${rstlDeviation.toFixed(1)}°`);
  const linearDeficit = finiteOr(metrics.diameter_coverage_deficit_mm, 0);
  if (linearDeficit > 0) reasons.push(`直径覆盖缺口 ${linearDeficit.toFixed(1)} mm`);
  const axisDeficit = finiteOr(metrics.axis_coverage_deficit_mm, 0);
  if (axisDeficit > 0) reasons.push(`边界覆盖缺口 ${axisDeficit.toFixed(1)} mm`);
  if (candidateType === "fusiform") {
    const tipError = finiteOr(metrics.tip_angle_error_deg, 0);
    if (tipError > 0.5) reasons.push(`尖端角误差 ${tipError.toFixed(1)}°`);
  }
  if (Number.isFinite(sensitiveDistance) && Number.isFinite(sensitiveThreshold) && sensitiveDistance <= sensitiveThreshold) {
    reasons.push(`距敏感游离缘 ${sensitiveDistance.toFixed(1)} mm（阈值 ${sensitiveThreshold.toFixed(1)} mm）`);
  }
  return reasons.length ? reasons : ["工程指标未见额外扣分"];
}

export function compareCandidateRecords(records = [], rules = DEFAULT_RULES) {
  const cfg = rules?.guardrails || DEFAULT_RULES.guardrails;
  return (records || [])
    .filter(Boolean)
    .map((record, index) => {
      const candidate = record.candidate || {};
      const metrics = candidate.metrics || {};
      const severity = warningSeverityCounts(record.guardrails);
      const reviewStatus = record.review_status || record.review?.status || "pending_clinician_confirmation";
      const sensitiveDistance = finiteOr(metrics.sensitive_free_margin_min_distance_mm, Infinity);
      const sensitiveThreshold = Number.isFinite(sensitiveDistance)
        ? freeMarginDistanceThresholdMm(
            metrics.sensitive_free_margin_nearest || record.anatomy?.region || candidate.region,
            cfg,
            record.anatomy?.region || candidate.region || "unknown",
          )
        : Infinity;
      const sensitivePenalty = Number.isFinite(sensitiveDistance)
        ? Math.max(0, sensitiveThreshold - sensitiveDistance) * 5
        : 0;
      const score =
        severity.high * 100 +
        severity.medium * 25 +
        severity.low * 5 +
        finiteOr(metrics.rstl_deviation_deg, 0) +
        finiteOr(metrics.diameter_coverage_deficit_mm, 0) * 10 +
        finiteOr(metrics.axis_coverage_deficit_mm, 0) * 10 +
        finiteOr(metrics.tip_angle_error_deg, 0) * 2 +
        sensitivePenalty +
        (reviewStatus === "rejected_by_clinician" ? 1000 : 0);
      return {
        id: record.id || `candidate_${index}`,
        label: record.label || `候选 ${index + 1}`,
        original_index: index,
        candidate_type: candidate.type || "unknown",
        review_status: reviewStatus,
        score,
        score_breakdown: {
          high_guardrails: severity.high,
          medium_guardrails: severity.medium,
          rstl_deviation_deg: finiteOr(metrics.rstl_deviation_deg, 0),
          diameter_coverage_deficit_mm: finiteOr(metrics.diameter_coverage_deficit_mm, 0),
          axis_coverage_deficit_mm: finiteOr(metrics.axis_coverage_deficit_mm, 0),
          tip_angle_error_deg: finiteOr(metrics.tip_angle_error_deg, 0),
          sensitive_free_margin_threshold_mm: Number.isFinite(sensitiveThreshold) ? sensitiveThreshold : null,
          sensitive_margin_penalty: sensitivePenalty,
          rejected_penalty: reviewStatus === "rejected_by_clinician" ? 1000 : 0,
        },
        reasons: comparisonReasons({
          severity,
          metrics,
          reviewStatus,
          sensitiveDistance,
          sensitiveThreshold,
          candidateType: candidate.type,
        }),
      };
    })
    .sort((a, b) => a.score - b.score || a.original_index - b.original_index)
    .map((item, idx) => ({
      ...item,
      rank: idx + 1,
      score: Number(item.score.toFixed(3)),
      clinical_boundary: "工程排序仅用于候选对比，不是临床推荐或手术指令。",
    }));
}

export const __incisionToolsForTests = {
  DEFAULT_RULES,
  TOOL_SCHEMAS,
  applyCandidateEdit,
  compareCandidateRecords,
  classifyRegion,
  queryDirection,
  normalizeTumorInput,
  annotateCandidateSensitiveDistances,
  summarizeTumorBoundary,
  generateLinearIncision,
  generateFusiformIncision,
  evaluateGuardrails,
  planIncisionDeterministic,
  unitsPerMmFromVertices,
};
