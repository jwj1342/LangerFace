// @ts-nocheck
import { DEFAULT_RULES } from "./incisionToolRules.ts";
import {
  add,
  annotateCandidateSensitiveDistances,
  clamp,
  cross,
  directionProvenance,
  dot,
  mul,
  norm,
  sub,
} from "./incisionToolCore.ts";

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

export function validateTumor(tumor) {
  return normalizeTumorInput(tumor);
}

export function summarizeTumorInputQuality(tumorInput) {
  const tumor = validateTumor(tumorInput);
  const warnings = [];
  if (!tumor.author) {
    warnings.push({
      code: "missing_tumor_author",
      severity: "medium",
      message: "Tumor input has no author/reviewer name recorded.",
    });
  }
  if (tumor.units !== "mm") {
    warnings.push({
      code: "non_mm_tumor_units",
      severity: "high",
      message: "Tumor input units are not millimeters; deterministic incision rules assume mm.",
    });
  }
  if (tumor.kind === "subcutaneous" && tumor.depth_mm == null) {
    warnings.push({
      code: "missing_subcutaneous_depth",
      severity: "medium",
      message: "Subcutaneous tumor depth is missing; confirm ultrasound/source depth before review.",
    });
  }
  if (tumor.kind === "cutaneous") {
    if (tumor.margin_mm <= 0) {
      warnings.push({
        code: "missing_cutaneous_margin",
        severity: "medium",
        message: "Cutaneous tumor margin is zero; confirm intended margin before review.",
      });
    }
    if (tumor.boundary_mode === "freehand" && tumor.boundary.length < 6) {
      warnings.push({
        code: "sparse_cutaneous_boundary_input",
        severity: "medium",
        message: "Freehand cutaneous boundary has fewer than 6 points.",
      });
    }
    if (tumor.boundary_mode !== "center_diameter" && tumor.boundary.length < 3) {
      warnings.push({
        code: "missing_cutaneous_boundary",
        severity: "medium",
        message: "Cutaneous boundary mode is selected but no usable boundary was provided.",
      });
    }
  }
  return {
    passed: !warnings.some((w) => w.severity === "high"),
    warning_count: warnings.length,
    warnings,
    source: tumor.source,
    boundary_source: tumor.boundary_source,
    author_present: Boolean(tumor.author),
    units: tumor.units,
  };
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
    provenance: {
      generator: "generateLinearIncision",
      rules_version: rules.version,
      candidate_version: 1,
      edit_history: [],
      ...directionProvenance(direction),
    },
  };
}

export function tangentPerp(axis, normal) {
  const n = norm(normal || [0, 0, 1]);
  let p = cross(n, axis);
  if (Math.hypot(p[0], p[1], p[2]) < 1e-9) p = [-axis[1], axis[0], 0];
  return norm(p);
}

export function polygonArea(points) {
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

export function boundaryProfile(tumor, axis, perp, unitsPerMm) {
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

export function fusiformProfile(center, axis, perp, halfL, halfW, samples, tipAngleDeg) {
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

function projectToAxisPlane(points, center, axis, perp) {
  return points.map((p) => {
    const d = sub(p, center);
    return [dot(d, axis), dot(d, perp)];
  });
}

function interpolateHalfWidth(x, profile) {
  if (x < profile[0][0]) return -(profile[0][0] - x);
  if (x > profile[profile.length - 1][0]) return -(x - profile[profile.length - 1][0]);
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], b = profile[i + 1];
    if (a[0] <= x && x <= b[0]) {
      const span = b[0] - a[0];
      const t = Math.abs(span) > 1e-12 ? (x - a[0]) / span : 0;
      return Math.abs(a[1]) + (Math.abs(b[1]) - Math.abs(a[1])) * t;
    }
  }
  return 0;
}

export function outlineQualityMetrics({ upper, lower, outline, tumor, center, axis, perp, unitsPerMm, boundaryUsed }) {
  if (!(unitsPerMm > 0)) return {};
  const upperProjected = projectToAxisPlane(upper, center, axis, perp);
  const lowerProjected = projectToAxisPlane(lower, center, axis, perp);
  const outlineProjected = projectToAxisPlane(outline, center, axis, perp);
  const widths = upperProjected.map((p) => Math.abs(p[1]));
  const mid = Math.floor(widths.length / 2);
  const eps = 1e-7;
  let monotone = true;
  for (let i = 0; i < mid; i++) if (widths[i] > widths[i + 1] + eps) monotone = false;
  for (let i = mid; i < widths.length - 1; i++) if (widths[i] < widths[i + 1] - eps) monotone = false;
  let symmetryMax = 0;
  for (let i = 0; i < upperProjected.length; i++) {
    symmetryMax = Math.max(
      symmetryMax,
      Math.hypot(upperProjected[i][0] - lowerProjected[i][0], upperProjected[i][1] + lowerProjected[i][1]),
    );
  }
  let boundaryEnvelopeMinMarginMm = null;
  let boundaryEnvelopeOutsideCount = 0;
  if (boundaryUsed && Array.isArray(tumor.boundary) && tumor.boundary.length >= 3) {
    const boundaryProjected = projectToAxisPlane(tumor.boundary, center, axis, perp);
    const margins = boundaryProjected.map(([x, y]) => (interpolateHalfWidth(x, upperProjected) - Math.abs(y)) / unitsPerMm);
    if (margins.length) {
      boundaryEnvelopeMinMarginMm = Math.min(...margins);
      boundaryEnvelopeOutsideCount = margins.filter((margin) => margin < -1e-6).length;
    }
  }
  return {
    outline_area_mm2: polygonArea(outlineProjected) / (unitsPerMm * unitsPerMm),
    outline_self_intersection: polygonSelfIntersects(outlineProjected),
    outline_half_width_monotone: monotone,
    outline_symmetry_max_error_mm: symmetryMax / unitsPerMm,
    boundary_envelope_min_margin_mm: boundaryEnvelopeMinMarginMm,
    boundary_envelope_outside_count: boundaryEnvelopeOutsideCount,
  };
}

export function summarizeTumorBoundary(tumorInput, axis = [1, 0, 0], normal = [0, 0, 1], unitsPerMm = 1) {
  const tumor = validateTumor(tumorInput);
  const a = norm(axis);
  const n = norm(normal);
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
    units_per_mm: unitsPerMm,
    summary_axis: a,
    summary_normal: n,
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
  const outlineMetrics = outlineQualityMetrics({
    upper,
    lower,
    outline,
    tumor,
    center,
    axis,
    perp,
    unitsPerMm,
    boundaryUsed: Boolean(boundary),
  });
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
      ...outlineMetrics,
    },
    provenance: {
      generator: "generateFusiformIncision",
      rules_version: rules.version,
      boundary_source: tumor.boundary_source,
      candidate_version: 1,
      edit_history: [],
      ...directionProvenance(direction),
    },
  };
}

function asLandmarkNames(value) {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return [String(value)];
}

export function freeMarginDistanceThresholdMm(landmarks, cfg, fallbackRegion = "unknown") {
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

function protectiveDirectionRule(names, cfg, fallbackRegion = "unknown") {
  const rules = cfg?.protective_direction_hints || {};
  const candidates = asLandmarkNames(names).concat([fallbackRegion]);
  for (const name of candidates) {
    const normalized = String(name).toLowerCase();
    if (rules[normalized]) return [normalized, rules[normalized]];
    for (const [key, rule] of Object.entries(rules)) {
      const normalizedKey = String(key).toLowerCase();
      if (normalizedKey && normalized.includes(normalizedKey)) return [normalizedKey, rule];
    }
  }
  return null;
}

function protectiveDirectionSummary(cfg, names, fallbackRegion, source) {
  const match = protectiveDirectionRule(names, cfg, fallbackRegion);
  if (!match) return null;
  const [structure, rule] = match;
  return {
    structure,
    source,
    direction_hint: rule.direction_hint || "manual_sensitive_margin_axis",
    canonical_axis: rule.canonical_axis || null,
    reason: rule.reason || "Protect sensitive free-margin anatomy before following local RSTL.",
    requires_clinician_override_reason: true,
    priority: "sensitive_margin_exception_before_rstl",
  };
}

export function inspectSensitiveStructures(anatomy, candidate = null, rules = DEFAULT_RULES) {
  const cfg = rules.guardrails;
  const region = anatomy?.region || "unknown";
  const nearby = Array.isArray(anatomy?.nearby_landmarks) ? anatomy.nearby_landmarks : [];
  const centerDistance = anatomy?.free_margin_distance_mm ?? null;
  const centerThreshold = freeMarginDistanceThresholdMm(nearby, cfg, region);
  const metrics = candidate?.metrics || {};
  const candidateDistance = metrics.sensitive_free_margin_min_distance_mm ?? null;
  const candidateNearest = metrics.sensitive_free_margin_nearest ?? null;
  const candidateThreshold = freeMarginDistanceThresholdMm(candidateNearest || nearby, cfg, region);
  const warnings = [];
  let protectiveNames = nearby;
  let protectiveSource = "nearby_sensitive_free_margin";
  if (cfg.sensitive_regions[region]) {
    warnings.push({ code: `sensitive_region_${region}`, severity: "high", message: cfg.sensitive_regions[region] });
    protectiveNames = region;
    protectiveSource = `sensitive_region_${region}`;
  }
  if (centerDistance != null && Number(centerDistance) <= centerThreshold) {
    warnings.push({
      code: "near_sensitive_free_margin",
      severity: "high",
      message: `Candidate center is ${Number(centerDistance).toFixed(1)} mm from sensitive free-margin structures (threshold ${centerThreshold.toFixed(1)} mm).`,
    });
    protectiveSource = "near_sensitive_free_margin";
  }
  if (candidateDistance != null && Number(candidateDistance) <= candidateThreshold) {
    warnings.push({
      code: "candidate_near_sensitive_free_margin",
      severity: "high",
      message: `Candidate geometry is ${Number(candidateDistance).toFixed(1)} mm from sensitive free-margin structures (threshold ${candidateThreshold.toFixed(1)} mm).`,
    });
    protectiveNames = candidateNearest || protectiveNames;
    protectiveSource = "candidate_near_sensitive_free_margin";
  }
  return {
    schema_version: "sensitive-structure-inspection/v0.1",
    region,
    subunit: anatomy?.subunit || "unknown",
    sensitive_region: Boolean(anatomy?.sensitive) || Boolean(cfg.sensitive_regions[region]),
    nearby_landmarks: nearby,
    center_free_margin_distance_mm: centerDistance,
    center_free_margin_threshold_mm: centerThreshold,
    center_within_threshold: centerDistance != null && Number(centerDistance) <= centerThreshold,
    candidate_free_margin_distance_mm: candidateDistance,
    candidate_free_margin_nearest: candidateNearest,
    candidate_free_margin_threshold_mm: candidateDistance != null ? candidateThreshold : null,
    candidate_within_threshold: candidateDistance != null && Number(candidateDistance) <= candidateThreshold,
    warning_count: warnings.length,
    warnings,
    protective_direction: protectiveDirectionSummary(cfg, protectiveNames, region, protectiveSource),
    clinician_review_required: true,
    clinical_boundary: "敏感结构检查只是确定性筛查观察；医生审阅和 guardrails 仍然必需。",
  };
}

function appendProtectiveDirectionOverride(suggestedOverrides, cfg, names, fallbackRegion, sourceWarning) {
  const match = protectiveDirectionRule(names, cfg, fallbackRegion);
  if (!match) return;
  const [structure, rule] = match;
  if (suggestedOverrides.some((item) => item.kind === "protective_direction" && item.structure === structure)) {
    return;
  }
  suggestedOverrides.push({
    kind: "protective_direction",
    structure,
    source_warning: sourceWarning,
    direction_hint: rule.direction_hint || "manual_sensitive_margin_axis",
    canonical_axis: rule.canonical_axis || null,
    reason: rule.reason || "Protect sensitive free-margin anatomy before following local RSTL.",
    requires_clinician_override_reason: true,
    priority: "sensitive_margin_exception_before_rstl",
  });
}

export function evaluateGuardrails(candidate, anatomy, rules = DEFAULT_RULES) {
  const cfg = rules.guardrails;
  const warnings = [], suggested_overrides = [];
  if ((candidate.direction_confidence || 0) < cfg.low_direction_confidence) {
    const reasons = candidate.provenance?.direction_confidence_reasons || [];
    warnings.push({
      code: "low_rstl_confidence",
      severity: "medium",
      message: `Local RSTL direction is low confidence; require manual confirmation${reasons.length ? ` (${reasons.join(", ")}).` : "."}`,
    });
  }
  if ((anatomy.confidence || 0) < cfg.low_region_confidence) {
    const reasons = anatomy.confidence_reasons || [];
    warnings.push({
      code: "low_region_confidence",
      severity: "medium",
      message: `Face region classification is low confidence; require clinician review${reasons.length ? ` (${reasons.join(", ")}).` : "."}`,
    });
  }
  if (cfg.sensitive_regions[anatomy.region]) {
    warnings.push({ code: `sensitive_region_${anatomy.region}`, severity: "high", message: cfg.sensitive_regions[anatomy.region] });
    suggested_overrides.push({ kind: "manual_direction_confirmation", reason: `${anatomy.region} is a sensitive free-margin region.` });
    appendProtectiveDirectionOverride(
      suggested_overrides,
      cfg,
      anatomy.region,
      anatomy.region,
      `sensitive_region_${anatomy.region}`,
    );
  }
  const centerThreshold = freeMarginDistanceThresholdMm(anatomy.nearby_landmarks, cfg, anatomy.region);
  if (anatomy.free_margin_distance_mm != null && Number(anatomy.free_margin_distance_mm) <= centerThreshold) {
    warnings.push({
      code: "near_sensitive_free_margin",
      severity: "high",
      message: `Candidate center is approximately ${Number(anatomy.free_margin_distance_mm).toFixed(1)} mm from sensitive free-margin landmark(s): ${(anatomy.nearby_landmarks || []).join(", ") || anatomy.region} (threshold ${centerThreshold.toFixed(1)} mm).`,
    });
    suggested_overrides.push({ kind: "free_margin_distance_review", reason: "Confirm functional and contour risk before accepting this direction." });
    appendProtectiveDirectionOverride(
      suggested_overrides,
      cfg,
      anatomy.nearby_landmarks,
      anatomy.region,
      "near_sensitive_free_margin",
    );
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
  if (candidate.type === "fusiform") {
    if (candidate.metrics?.outline_self_intersection) {
      warnings.push({
        code: "fusiform_outline_self_intersection",
        severity: "high",
        message: "Fusiform candidate outline self-intersects; regenerate or edit the candidate.",
      });
      suggested_overrides.push({
        kind: "fusiform_shape_review",
        reason: "Self-intersecting fusiform outlines cannot be treated as valid candidates.",
      });
    }
    if (candidate.metrics?.outline_half_width_monotone === false) {
      warnings.push({
        code: "fusiform_outline_not_smoothly_tapered",
        severity: "high",
        message: "Fusiform candidate does not taper smoothly from the widest point to both tips.",
      });
      suggested_overrides.push({
        kind: "fusiform_shape_review",
        reason: "Regenerate the candidate or adjust length/width/tip-angle before review.",
      });
    }
    const outsideCount = Number(candidate.metrics?.boundary_envelope_outside_count || 0);
    if (outsideCount > 0) {
      const minMargin = candidate.metrics?.boundary_envelope_min_margin_mm;
      warnings.push({
        code: "fusiform_boundary_outside_envelope",
        severity: "high",
        message: `${outsideCount} cutaneous boundary point(s) fall outside the fusiform outline${minMargin != null ? ` (minimum envelope margin ${Number(minMargin).toFixed(1)} mm).` : "."}`,
      });
      suggested_overrides.push({
        kind: "fusiform_boundary_envelope_review",
        reason: "Increase candidate width/length, redraw boundary, or record an explicit clinician decision.",
      });
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
    appendProtectiveDirectionOverride(
      suggested_overrides,
      cfg,
      nearestSensitiveMargin,
      anatomy.region,
      "candidate_near_sensitive_free_margin",
    );
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
