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
    sensitive_regions: {
      lower_eyelid: "Protect the lower eyelid free margin; consider manual override away from vertical traction.",
      lip_vermilion: "Protect vermilion border alignment; require clinician confirmation before committing.",
      nasal_ala: "Protect nasal alar contour; evaluate distortion risk before accepting.",
    },
  },
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
  if (ny >= 0.78) [region, subunit, confidence] = ["forehead", "forehead", 0.62];
  else if (ny >= 0.61 && ny < 0.78 && nx >= 0.18 && nx <= 0.82) [region, subunit, confidence] = ["periorbital", "upper_midface", 0.58];
  else if (ny >= 0.53 && ny < 0.66 && ((nx >= 0.2 && nx <= 0.4) || (nx >= 0.6 && nx <= 0.8))) [region, subunit, confidence] = ["lower_eyelid", "free_margin", 0.66];
  else if (ny >= 0.4 && ny < 0.58 && nx >= 0.38 && nx <= 0.62) [region, subunit, confidence] = ["nasal_ala", "nose", 0.62];
  else if (ny >= 0.24 && ny < 0.39 && nx >= 0.34 && nx <= 0.66) [region, subunit, confidence] = ["lip_vermilion", "oral_free_margin", 0.66];
  else if (ny < 0.24) [region, subunit, confidence] = ["chin", "chin", 0.58];
  else if (nx < 0.23 || nx > 0.77) [region, subunit, confidence] = ["temple_cheek", "lateral_face", 0.56];
  const sensitive = ["lower_eyelid", "lip_vermilion", "nasal_ala"].includes(region);
  return { region, subunit, confidence, normalized_xy: [nx, ny], sensitive };
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

export function queryDirection(point, verts, tris, atlas) {
  const { pts, tans } = atlasSamples(verts, tris, atlas);
  if (!pts.length) {
    return { point, vector: [1, 0, 0], angle_deg: 0, confidence: 0, source: "rstl_atlas_empty", nearest_distance: Infinity };
  }
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = sub(pts[i], point);
    const dd = dot(d, d);
    if (dd < bd) { bd = dd; best = i; }
  }
  const { lo, hi } = bbox(verts);
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const nearest = Math.sqrt(bd);
  const maxDistance = Math.max(diag * 0.18, 1e-9);
  const vector = norm(tans[best]);
  return {
    point,
    vector,
    angle_deg: Math.atan2(vector[1], vector[0]) * 180 / Math.PI,
    confidence: clamp(1 - nearest / maxDistance, 0, 1),
    source: "rstl_atlas_nearest",
    nearest_distance: nearest,
  };
}

function validateTumor(tumor) {
  if (!["subcutaneous", "cutaneous"].includes(tumor.kind)) throw new Error("tumor.kind must be subcutaneous or cutaneous");
  if (!Array.isArray(tumor.center) || tumor.center.length !== 3) throw new Error("tumor.center must be a 3D point");
  if (!(tumor.diameter_mm > 0)) throw new Error("tumor.diameter_mm must be positive");
  return {
    kind: tumor.kind,
    center: tumor.center.map(Number),
    diameter_mm: Number(tumor.diameter_mm),
    depth_mm: tumor.depth_mm == null ? null : Number(tumor.depth_mm),
    margin_mm: Number(tumor.margin_mm || 0),
    boundary: Array.isArray(tumor.boundary) ? tumor.boundary : [],
    source: tumor.source || "manual",
    author: tumor.author || "",
  };
}

export function generateLinearIncision(tumorInput, direction, unitsPerMm, rules = DEFAULT_RULES) {
  const tumor = validateTumor(tumorInput);
  if (tumor.kind !== "subcutaneous") throw new Error("linear incision requires subcutaneous tumor");
  const cfg = rules.linear_subcutaneous;
  const axis = norm(direction.vector);
  const lengthMm = clamp(tumor.diameter_mm * cfg.length_multiplier, cfg.min_length_mm, cfg.max_length_mm);
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

export function generateFusiformIncision(tumorInput, direction, unitsPerMm, normal = [0, 0, 1], rules = DEFAULT_RULES) {
  const tumor = validateTumor(tumorInput);
  if (tumor.kind !== "cutaneous") throw new Error("fusiform incision requires cutaneous tumor");
  const cfg = rules.fusiform_cutaneous;
  const axis = norm(direction.vector);
  const perp = tangentPerp(axis, normal);
  const widthMm = tumor.diameter_mm + 2 * tumor.margin_mm;
  const lengthMm = clamp(widthMm * cfg.length_to_width_ratio, cfg.min_length_mm, cfg.max_length_mm);
  const halfL = lengthMm * unitsPerMm * 0.5, halfW = widthMm * unitsPerMm * 0.5;
  const samples = Math.max(12, cfg.samples || 56);
  const upper = [], lower = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = (t - 0.5) * 2 * halfL;
    const y = Math.sin(Math.PI * t) * halfW;
    upper.push(add(add(tumor.center, mul(axis, x)), mul(perp, y)));
    lower.push(add(add(tumor.center, mul(axis, x)), mul(perp, -y)));
  }
  const outline = upper.concat(lower.slice(1, -1).reverse());
  return {
    id: "fusiform_cutaneous_candidate",
    type: "fusiform",
    tumor_kind: tumor.kind,
    center: tumor.center,
    axis,
    width_axis: perp,
    endpoints: [sub(tumor.center, mul(axis, halfL)), add(tumor.center, mul(axis, halfL))],
    outline,
    polyline: outline.concat([outline[0]]),
    length_mm: lengthMm,
    width_mm: widthMm,
    length_units: lengthMm * unitsPerMm,
    width_units: widthMm * unitsPerMm,
    tip_angle_deg: cfg.tip_angle_deg,
    direction_confidence: direction.confidence,
    metrics: {
      rstl_deviation_deg: 0,
      length_to_width_ratio: lengthMm / widthMm,
      diameter_mm: tumor.diameter_mm,
      margin_mm: tumor.margin_mm,
    },
    provenance: { generator: "generateFusiformIncision", rules_version: rules.version },
  };
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
  const halfL = lengthMm * unitsPerMm * 0.5;
  const halfW = widthMm * unitsPerMm * 0.5;
  const samples = Math.max(12, Math.round((base.outline?.length || 58) / 2));
  const upper = [], lower = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = (t - 0.5) * 2 * halfL;
    const y = Math.sin(Math.PI * t) * halfW;
    upper.push(add(add(center, mul(axis, x)), mul(widthAxis, y)));
    lower.push(add(add(center, mul(axis, x)), mul(widthAxis, -y)));
  }
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
    metrics: {
      ...(base.metrics || {}),
      rstl_deviation_deg: Math.abs(Number(edit.angle_offset_deg || 0)),
      length_to_width_ratio: lengthMm / widthMm,
    },
  };
}

export function applyCandidateEdit(plan, edit = {}, normal = [0, 0, 1], unitsPerMm = 1) {
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
      },
    };
  } else {
    candidate = buildEditedFusiform(base, center, axis, normal, unitsPerMm, editRecord);
  }

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

export const __incisionToolsForTests = {
  DEFAULT_RULES,
  applyCandidateEdit,
  classifyRegion,
  queryDirection,
  generateLinearIncision,
  generateFusiformIncision,
  evaluateGuardrails,
  planIncisionDeterministic,
  unitsPerMmFromVertices,
};
