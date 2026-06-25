import * as THREE from "three";

import { assetUrls } from "./assets.js";
import { dataSource } from "./data_source.js";
import { auditExportPayload } from "./export_privacy.js";
import { compileIncisionOverlay } from "./incision_overlay.js";
import {
  applyCandidateEdit,
  classifyRegion,
  compareCandidateRecords,
  normalizeTumorInput,
  planIncisionDeterministic,
  summarizeTumorBoundary,
  summarizeTumorInputQuality,
  unitsPerMmFromVertices,
} from "./incision_tools.js";
import { requestAgentPlan } from "./llm_provider.js";
import { Head3D, buildLineGeometry, vertexNormals } from "./three3d.js";

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $("agentCanvas"),
  wrap: document.querySelector(".main-wrap"),
  tumorKind: $("tumorKind"),
  diameter: $("diameterMm"),
  diameterVal: $("diameterVal"),
  tumorAuthor: $("tumorAuthor"),
  depth: $("depthMm"),
  depthVal: $("depthVal"),
  depthWrap: $("depthWrap"),
  margin: $("marginMm"),
  marginVal: $("marginVal"),
  marginWrap: $("marginWrap"),
  boundaryWrap: $("boundaryWrap"),
  boundaryMode: $("boundaryMode"),
  ellipseWrap: $("ellipseWrap"),
  ellipseRatio: $("ellipseRatio"),
  ellipseRatioVal: $("ellipseRatioVal"),
  freehandControls: $("freehandControls"),
  startBoundary: $("startBoundaryBtn"),
  clearBoundary: $("clearBoundaryBtn"),
  boundaryStatus: $("boundaryStatus"),
  exportTumor: $("exportTumorBtn"),
  importTumor: $("importTumorBtn"),
  tumorImportFile: $("tumorImportFile"),
  run: $("runAgentBtn"),
  pickState: $("pickState"),
  anatomyPreview: $("anatomyPreview"),
  secondaryCueState: $("secondaryCueState"),
  secondaryCueSummary: $("secondaryCueSummary"),
  importSecondaryCue: $("importSecondaryCueBtn"),
  clearSecondaryCue: $("clearSecondaryCueBtn"),
  secondaryCueImportFile: $("secondaryCueImportFile"),
  secondaryCueConfirmed: $("secondaryCueConfirmed"),
  useAgentServer: $("useAgentServer"),
  endpoint: $("agentEndpoint"),
  providerMode: $("providerMode"),
  providerBaseUrl: $("providerBaseUrl"),
  providerModel: $("providerModel"),
  providerApiKey: $("providerApiKey"),
  providerTimeout: $("providerTimeout"),
  providerTimeoutVal: $("providerTimeoutVal"),
  providerState: $("providerState"),
  candidateType: $("candidateType"),
  candidateLength: $("candidateLength"),
  candidateWidth: $("candidateWidth"),
  candidateTipAngle: $("candidateTipAngle"),
  directionConf: $("directionConf"),
  regionVal: $("regionVal"),
  guardrailVal: $("guardrailVal"),
  directionSource: $("directionSource"),
  agentGate: $("agentGate"),
  agentExecutionList: $("agentExecutionList"),
  agentPlanList: $("agentPlanList"),
  agentComparison: $("agentComparison"),
  guardrailDetails: $("guardrailDetails"),
  llmSummary: $("llmSummary"),
  nextStep: $("nextStep"),
  editStatus: $("editStatus"),
  angleOffset: $("angleOffsetDeg"),
  angleOffsetVal: $("angleOffsetVal"),
  lengthScale: $("lengthScale"),
  lengthScaleVal: $("lengthScaleVal"),
  widthScale: $("widthScale"),
  widthScaleVal: $("widthScaleVal"),
  widthScaleWrap: $("widthScaleWrap"),
  shiftAlong: $("shiftAlongMm"),
  shiftAlongVal: $("shiftAlongVal"),
  shiftPerp: $("shiftPerpMm"),
  shiftPerpVal: $("shiftPerpVal"),
  editReason: $("editReason"),
  undoEdit: $("undoEditBtn"),
  redoEdit: $("redoEditBtn"),
  resetEdit: $("resetEditBtn"),
  editHistoryState: $("editHistoryState"),
  reviewerName: $("reviewerName"),
  reviewDecision: $("reviewDecision"),
  reviewNotes: $("reviewNotes"),
  reviewState: $("reviewState"),
  approveCandidate: $("approveCandidateBtn"),
  rejectCandidate: $("rejectCandidateBtn"),
  saveReview: $("saveReviewBtn"),
  saveCandidate: $("saveCandidateBtn"),
  makeVariants: $("makeVariantsBtn"),
  clearSaved: $("clearSavedBtn"),
  exportJson: $("exportJsonBtn"),
  exportReport: $("exportReportBtn"),
  exportPng: $("exportPngBtn"),
  stageLiveOverlay: $("stageLiveOverlayBtn"),
  candidateList: $("candidateList"),
  savedCount: $("savedCount"),
  privacyState: $("privacyState"),
  privacyAudit: $("privacyAudit"),
  traceList: $("traceList"),
  traceCount: $("traceCount"),
  stageStatus: $("stageStatus"),
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const S = {
  verts: null,
  tris: null,
  atlas: null,
  normals: null,
  meanEdge: 1,
  unitsPerMm: 1,
  head: null,
  marker: null,
  tumorRing: null,
  boundaryLine: null,
  candidateLine: null,
  endpointHandles: [],
  raycaster: new THREE.Raycaster(),
  lesion: 0,
  boundaryPoints: [],
  boundaryActive: false,
  saved: [],
  result: null,
  baseResult: null,
  secondaryCues: null,
  editTimeline: null,
  editCursor: 0,
};

const REVIEW_LABELS = {
  pending_clinician_confirmation: "待医生确认",
  approved_for_discussion: "确认候选草案",
  needs_revision: "退回修改",
  rejected_by_clinician: "否决候选",
};

async function loadJSON(url) { return (await fetch(url)).json(); }

function meanEdge(verts, tris) {
  let e = 0, n = 0;
  for (const [a, b, c] of tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      e += len(sub(verts[p], verts[q]));
      n++;
    }
  }
  return n ? e / n : 1;
}

function defaultLesion() {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of S.verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const target = [c[0] + 0.38 * (hi[0] - lo[0]), c[1] + 0.03 * (hi[1] - lo[1]), hi[2]];
  let best = 0, bd = Infinity;
  for (let i = 0; i < S.verts.length; i++) {
    const d = len(sub(S.verts[i], target));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function nearestVertex(point) {
  if (!S.verts || !Array.isArray(point)) return S.lesion || 0;
  let best = 0, bd = Infinity;
  for (let i = 0; i < S.verts.length; i++) {
    const d = len(sub(S.verts[i], point));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

async function boot() {
  const [verts, tris, atlas] = await Promise.all([
    loadJSON(assetUrls.canonicalVertices),
    loadJSON(assetUrls.triangles),
    loadJSON(assetUrls.atlasRstl),
  ]);
  S.verts = verts; S.tris = tris; S.atlas = atlas;
  S.normals = vertexNormals(verts, tris);
  S.meanEdge = meanEdge(verts, tris);
  S.unitsPerMm = unitsPerMmFromVertices(verts);

  S.head = new Head3D(els.canvas);
  S.head.setGeometry(verts, tris, atlas.lines.filter((_, i) => i % 2 === 0), { showSurface: true, bands: false });
  S.head.resetView();

  S.marker = new THREE.Mesh(
    new THREE.SphereGeometry(S.meanEdge * 0.30, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.92, toneMapped: false }),
  );
  S.tumorRing = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xfacc15, toneMapped: false }),
  );
  S.boundaryLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xfb7185, toneMapped: false }),
  );
  S.candidateLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x34d399, toneMapped: false, linewidth: 2 }),
  );
  S.endpointHandles = [0, 1].map((idx) => {
    const h = new THREE.Mesh(
      new THREE.SphereGeometry(S.meanEdge * 0.22, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.95, toneMapped: false }),
    );
    h.userData.handle = idx;
    h.renderOrder = 8;
    return h;
  });
  S.marker.renderOrder = 5; S.tumorRing.renderOrder = 5; S.boundaryLine.renderOrder = 6; S.candidateLine.renderOrder = 7;
  S.head.group.add(S.marker, S.tumorRing, S.boundaryLine, S.candidateLine, ...S.endpointHandles);

  loadProviderPrefs();
  renderSecondaryCuePanel();
  setLesion(defaultLesion());
  fitSize();
  renderLoop();
  runAgent();
}

function fitSize() {
  const w = els.wrap.clientWidth || 900, h = els.wrap.clientHeight || 680;
  S.head.resize(w, h);
}

function providerConfig() {
  const cfg = {
    provider: els.providerMode.value,
    base_url: els.providerBaseUrl.value.trim(),
    model: els.providerModel.value.trim(),
    timeout_s: Number(els.providerTimeout.value),
  };
  if (els.providerApiKey.value) cfg.api_key = els.providerApiKey.value;
  return cfg;
}

function redactedProviderConfig() {
  const cfg = providerConfig();
  return {
    ...cfg,
    api_key: cfg.api_key ? "[redacted]" : "",
  };
}

function saveProviderPrefs() {
  const cfg = redactedProviderConfig();
  localStorage.setItem("langerface.incision.provider", JSON.stringify({
    provider: cfg.provider,
    base_url: cfg.base_url,
    model: cfg.model,
    timeout_s: cfg.timeout_s,
  }));
}

function loadProviderPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem("langerface.incision.provider") || "{}");
    if (raw.provider) els.providerMode.value = raw.provider;
    if (raw.base_url) els.providerBaseUrl.value = raw.base_url;
    if (raw.model) els.providerModel.value = raw.model;
    if (raw.timeout_s) els.providerTimeout.value = String(raw.timeout_s);
  } catch {
    // Keep defaults.
  }
  els.providerTimeoutVal.textContent = els.providerTimeout.value;
}

function privacyAudit(provider = {}) {
  const remote = Boolean(providerConfig().base_url && els.useAgentServer.checked);
  return {
    raw_image_sent: false,
    raw_video_sent: false,
    data_sent_to_agent: [
      "tumor.kind",
      "tumor.center",
      "tumor.diameter_mm",
      "tumor.depth_mm",
      "tumor.margin_mm",
      "tumor.boundary",
      "abstract face coordinates",
      "candidate geometry",
      "tool trace",
    ],
    provider: redactedProviderConfig(),
    remote_provider_configured: remote,
    provider_state: provider,
    secondary_cues_present: Boolean(S.secondaryCues),
    secondary_cues_sent_to_agent: false,
  };
}

function metricSummary(raw = {}) {
  const numberOrNull = (key) => {
    if (raw[key] == null) return null;
    const value = Number(raw[key]);
    return Number.isFinite(value) ? value : null;
  };
  return {
    precision: numberOrNull("precision"),
    recall: numberOrNull("recall"),
    iou: numberOrNull("iou"),
  };
}

function normalizeSecondaryCuePayload(payload = {}) {
  const metrics = payload.metrics || payload;
  return {
    schema_version: "secondary-cue-summary/v0.1",
    source: payload.source || metrics.source || "synthetic",
    source_tool: payload.source_tool || metrics.source_tool || "tools/prototype_wrinkle_lesion_cues.py",
    imported_at: new Date().toISOString(),
    confidence_label: metrics.confidence_label || "low_confidence_cv_cue_requires_manual_confirmation",
    manual_confirmation_required: true,
    used_for_geometry: false,
    used_for_agent_prompt: false,
    clinical_boundary: "辅助线索 / 低置信度 / 需医生确认；不自动改变肿物边界或候选切口。",
    lesion: metricSummary(metrics.lesion || {}),
    wrinkle: metricSummary(metrics.wrinkle || {}),
    outputs: metrics.outputs || {},
    counts: {
      lesion_polylines: Array.isArray(payload.lesion_polylines) ? payload.lesion_polylines.length : null,
      wrinkle_polylines: Array.isArray(payload.wrinkle_polylines) ? payload.wrinkle_polylines.length : null,
    },
  };
}

function secondaryCueReviewSummary() {
  if (!S.secondaryCues) {
    return {
      present: false,
      manual_confirmed: false,
      used_for_geometry: false,
      used_for_agent_prompt: false,
    };
  }
  return {
    present: true,
    ...S.secondaryCues,
    manual_confirmed: Boolean(els.secondaryCueConfirmed?.checked),
  };
}

function renderSecondaryCuePanel() {
  if (!els.secondaryCueState || !els.secondaryCueSummary) return;
  if (!S.secondaryCues) {
    els.secondaryCueState.textContent = "未导入";
    els.secondaryCueSummary.textContent = "仅展示自然皱襞、皱纹和皮表肿物边界的低置信度线索；不会自动改变肿物边界或候选切口。";
    return;
  }
  const lesion = S.secondaryCues.lesion || {};
  const wrinkle = S.secondaryCues.wrinkle || {};
  els.secondaryCueState.textContent = "低置信度 · 需医生确认";
  els.secondaryCueSummary.textContent = [
    `来源：${S.secondaryCues.source} · ${S.secondaryCues.source_tool}`,
    `标签：${S.secondaryCues.confidence_label}`,
    `皮表边界 IoU ${fmt(lesion.iou, 2)} / precision ${fmt(lesion.precision, 2)} / recall ${fmt(lesion.recall, 2)}`,
    `皱纹 recall ${fmt(wrinkle.recall, 2)} / precision ${fmt(wrinkle.precision, 2)}`,
    "只读展示：不进入几何生成，不发送给 Agent prompt。",
  ].join("\n");
}

function reviewStatusLabel(status) {
  return REVIEW_LABELS[status] || REVIEW_LABELS.pending_clinician_confirmation;
}

function updateReviewStateUI() {
  const status = els.reviewDecision.value || "pending_clinician_confirmation";
  els.reviewState.textContent = reviewStatusLabel(status);
  els.reviewState.classList.toggle("approved", status === "approved_for_discussion");
  els.reviewState.classList.toggle("rejected", status === "rejected_by_clinician");
  els.reviewState.classList.toggle("revision", status === "needs_revision");
}

function currentReviewMetadata(at = new Date().toISOString()) {
  const status = els.reviewDecision.value || "pending_clinician_confirmation";
  const terminal = status !== "pending_clinician_confirmation";
  return {
    status,
    label: reviewStatusLabel(status),
    reviewer: els.reviewerName.value.trim(),
    notes: els.reviewNotes.value.trim(),
    reviewed_at: terminal ? at : null,
    confirmation_scope: "research_candidate_only_not_surgical_order",
  };
}

function setReviewControls(review = {}) {
  els.reviewDecision.value = review.status || "pending_clinician_confirmation";
  els.reviewerName.value = review.reviewer || "";
  els.reviewNotes.value = review.notes || "";
  updateReviewStateUI();
}

function highGuardrailWarnings(result = S.result) {
  return (result?.guardrails?.warnings || []).filter((w) => w.severity === "high");
}

const AGENT_TRACE_GATE_REQUIRED = [
  { key: "tumor_input_quality", label: "肿物输入质量", actions: ["summarize_tumor_input_quality"] },
  { key: "face_region", label: "面部分区", actions: ["classify_region"] },
  { key: "rstl_direction", label: "RSTL 查询", actions: ["query_rstl_direction"] },
  { key: "sensitive_structures", label: "敏感结构检查", actions: ["inspect_sensitive_structures"] },
  { key: "candidate_generation", label: "确定性切口生成", actions: ["linear_subcutaneous_incision", "fusiform_cutaneous_incision"] },
  { key: "guardrails", label: "Guardrails", actions: ["evaluate_guardrails"] },
  { key: "face_preview", label: "面部预览", actions: ["preview_incision_on_face"] },
];

function agentTraceGate(result = S.result) {
  const actions = (result?.trace || []).map((step) => step?.action).filter(Boolean);
  const observed = new Set(actions);
  const required = AGENT_TRACE_GATE_REQUIRED.map((req) => ({
    key: req.key,
    label: req.label,
    actions: req.actions,
    observed: req.actions.some((action) => observed.has(action)),
    first_index: Math.min(...req.actions.map((action) => {
      const idx = actions.indexOf(action);
      return idx < 0 ? Infinity : idx;
    })),
  }));
  const missing = required.filter((req) => !req.observed);
  const presentIndexes = required.filter((req) => req.observed).map((req) => req.first_index);
  const orderOk = presentIndexes.every((idx, i) => i === 0 || idx >= presentIndexes[i - 1]);
  const geometryPresent = Array.isArray(result?.candidate?.polyline) && result.candidate.polyline.length >= 2;
  return {
    schema_version: "agent-trace-gate/v0.1",
    passed: missing.length === 0 && orderOk && geometryPresent,
    mode: result?.agent_trace_mode || "unknown",
    observed_actions: actions,
    required_actions: required.map((req) => ({ key: req.key, label: req.label, actions: req.actions })),
    missing_actions: missing.map((req) => ({ key: req.key, label: req.label, actions: req.actions })),
    order_ok: orderOk,
    deterministic_geometry_present: geometryPresent,
    boundary: "LLM may summarize and explain only after deterministic tools provide sensitive-structure, geometry, preview, and guardrail observations.",
  };
}

function reviewReadiness(status, result = S.result) {
  if (!result) return { ok: false, message: "没有可审阅的候选" };
  if (status === "approved_for_discussion") {
    const traceGate = agentTraceGate(result);
    if (!traceGate.passed) {
      return { ok: false, message: "Agent 工具 trace 未通过门控；缺少必要工具动作或顺序异常，不能确认候选。" };
    }
    if (!els.reviewerName.value.trim()) return { ok: false, message: "确认候选前请填写审阅人。" };
    if (highGuardrailWarnings(result).length && !els.reviewNotes.value.trim()) {
      return { ok: false, message: "当前候选有高风险 guardrail；确认前请填写审阅备注或覆盖原因。" };
    }
  }
  return { ok: true, message: "" };
}

function resetReviewControls() {
  setReviewControls({ status: "pending_clinician_confirmation", reviewer: els.reviewerName.value });
}

function invalidateReviewAfterGeometryChange(message = "候选几何已变化，审阅状态已回到待医生确认。") {
  if (els.reviewDecision.value !== "pending_clinician_confirmation") {
    els.reviewDecision.value = "pending_clinician_confirmation";
    updateReviewStateUI();
    els.stageStatus.textContent = message;
  }
}

function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportPreflightPasses(payload, label) {
  const report = auditExportPayload(payload);
  if (report.passed) return true;
  const preview = report.violations.slice(0, 3).map((v) => `${v.code}@${v.path}`).join("；");
  els.stageStatus.textContent = `${label}已阻断：隐私预检发现 ${report.violation_count} 个问题：${preview}`;
  els.privacyAudit.textContent = "导出隐私预检未通过；请移除原始媒体、明文密钥或直接身份字段后再导出。";
  els.privacyState.textContent = "导出已阻断";
  return false;
}

function tumorInput() {
  const boundary = tumorBoundaryPoints();
  return {
    kind: els.tumorKind.value,
    center: S.verts[S.lesion],
    diameter_mm: Number(els.diameter.value),
    depth_mm: els.tumorKind.value === "subcutaneous" ? Number(els.depth.value) : null,
    margin_mm: els.tumorKind.value === "cutaneous" ? Number(els.margin.value) : 0,
    boundary,
    boundary_mode: els.tumorKind.value === "cutaneous" ? els.boundaryMode.value : "center_diameter",
    boundary_source: els.tumorKind.value === "cutaneous" ? `manual_${els.boundaryMode.value}` : "ultrasound_diameter",
    source: "manual_web_agent",
    author: els.tumorAuthor.value.trim(),
    units: "mm",
  };
}

function boundarySummaryFor(tumor = tumorInput(), result = S.result) {
  const axis = result?.candidate?.axis || result?.original_candidate?.axis || S.result?.candidate?.axis || S.baseResult?.candidate?.axis || [1, 0, 0];
  const lesionIndex = Array.isArray(tumor?.center) ? nearestVertex(tumor.center) : S.lesion;
  const normal = S.normals?.[lesionIndex] || S.normals?.[S.lesion] || [0, 0, 1];
  return summarizeTumorBoundary(tumor, axis, normal, S.unitsPerMm || 1);
}

function updateBoundaryStatus() {
  if (!els.boundaryStatus || !S.verts) return;
  const tumor = tumorInput();
  const summary = boundarySummaryFor(tumor);
  els.boundaryStatus.classList.toggle("warn", Boolean(summary.warnings?.length));
  if (tumor.kind !== "cutaneous") {
    els.boundaryStatus.textContent = "皮表边界：仅皮表肿物启用";
    return;
  }
  if (!summary.boundary_used) {
    els.boundaryStatus.textContent = `皮表边界：${summary.point_count || 0} 点，当前按中心直径近似`;
    return;
  }
  const warn = summary.warnings?.length ? ` · ${summary.warnings.map((w) => w.code).join(", ")}` : "";
  const area = summary.area_mm2 != null ? ` · 面积 ${fmt(summary.area_mm2)} mm²` : "";
  const selfX = summary.self_intersection ? " · 自交" : "";
  els.boundaryStatus.textContent = `皮表边界：${summary.point_count} 点 · 横向 ${fmt(summary.perp_diameter_mm)} mm · 长轴覆盖 ${fmt(summary.axis_diameter_mm)} mm${area}${selfX}${warn}`;
}

function updateAnatomyPreview() {
  if (!els.anatomyPreview || !S.verts) return;
  const anatomy = classifyRegion(S.verts[S.lesion], S.verts);
  const reasons = anatomy.confidence_reasons || [];
  const confidence = Math.round((anatomy.confidence || 0) * 100);
  const freeMargin = anatomy.free_margin_distance_mm != null
    ? ` · 游离缘 ${fmt(anatomy.free_margin_distance_mm)} mm`
    : "";
  const reasonText = reasons.length ? ` · ${reasons.join(", ")}` : "";
  els.anatomyPreview.textContent = `当前点位分区：${anatomy.region} / ${anatomy.subunit} · 置信 ${confidence}%${freeMargin}${reasonText}`;
  els.anatomyPreview.title = reasons.length ? `分区置信原因：${reasons.join(", ")}` : "";
  els.anatomyPreview.classList.toggle(
    "warn",
    (anatomy.confidence || 0) < 0.55 ||
      reasons.includes("near_sensitive_free_margin") ||
      reasons.includes("near_region_rule_boundary"),
  );
}

function tangentFrame(normal, axis = [1, 0, 0]) {
  const u0 = norm(cross(normal, axis));
  const u = len(u0) > 0 ? u0 : [1, 0, 0];
  const v = norm(cross(normal, u));
  return { u, v };
}

function ringGeometry(center, normal, radius) {
  const { u, v } = tangentFrame(normal, [0, 1, 0]);
  const lift = S.meanEdge * 0.18;
  const pos = [];
  for (let i = 0; i <= 72; i++) {
    const t = i / 72 * Math.PI * 2;
    const p = add(add(center, mul(u, Math.cos(t) * radius)), add(mul(v, Math.sin(t) * radius), mul(normal, lift)));
    pos.push(...p);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function ellipseBoundaryPoints(samples = 32) {
  const center = S.verts[S.lesion], normal = S.normals[S.lesion];
  const { u, v } = tangentFrame(normal, [0, 1, 0]);
  const radiusMm = Number(els.diameter.value) / 2;
  const ratio = Number(els.ellipseRatio.value) / 100;
  const a = radiusMm * S.unitsPerMm;
  const b = radiusMm * ratio * S.unitsPerMm;
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const t = i / samples * Math.PI * 2;
    pts.push(add(add(center, mul(u, Math.cos(t) * a)), mul(v, Math.sin(t) * b)));
  }
  return pts;
}

function tumorBoundaryPoints() {
  if (els.tumorKind.value !== "cutaneous") return [];
  if (els.boundaryMode.value === "freehand" && S.boundaryPoints.length >= 3) return S.boundaryPoints;
  return ellipseBoundaryPoints();
}

function boundaryGeometry(points, normal, closed = true) {
  const lift = S.meanEdge * 0.22;
  const pos = [];
  const pts = closed && points.length ? points.concat([points[0]]) : points;
  for (const p0 of pts || []) {
    const p = add(p0, mul(normal, lift));
    pos.push(...p);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function polylineGeometry(points, normal) {
  const lift = S.meanEdge * 0.32;
  const pos = [];
  for (const p0 of points || []) {
    const p = add(p0, mul(normal, lift));
    pos.push(...p);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function setLesion(i) {
  S.lesion = i;
  const center = S.verts[i], normal = S.normals[i];
  const markerPoint = add(center, mul(normal, S.meanEdge * 0.34));
  S.marker.position.set(markerPoint[0], markerPoint[1], markerPoint[2]);
  updateTumorRing();
  els.pickState.textContent = `当前点位：顶点 #${i}`;
  updateAnatomyPreview();
}

function updateTumorRing() {
  if (!S.tumorRing || !S.verts) return;
  const tumor = tumorInput();
  const radiusMm = tumor.kind === "cutaneous" ? tumor.diameter_mm / 2 + tumor.margin_mm : tumor.diameter_mm / 2;
  const old = S.tumorRing.geometry;
  S.tumorRing.geometry = ringGeometry(S.verts[S.lesion], S.normals[S.lesion], radiusMm * S.unitsPerMm);
  old.dispose();
  const bold = S.boundaryLine.geometry;
  const boundary = tumorBoundaryPoints();
  S.boundaryLine.geometry = boundaryGeometry(boundary, S.normals[S.lesion], boundary.length >= 3);
  S.boundaryLine.visible = tumor.kind === "cutaneous" && boundary.length >= 2;
  bold.dispose();
  updateBoundaryStatus();
}

function drawCandidate(result) {
  const old = S.candidateLine.geometry;
  S.candidateLine.geometry = polylineGeometry(result.candidate.polyline, S.normals[S.lesion]);
  old.dispose();
  S.candidateLine.material.color.set(result.candidate.type === "linear" ? 0x34d399 : 0x5eead4);
  const endpoints = result.candidate.endpoints || [];
  const lift = S.meanEdge * 0.42;
  for (const [idx, h] of S.endpointHandles.entries()) {
    const p = endpoints[idx];
    h.visible = Boolean(p);
    if (p) {
      const hp = add(p, mul(S.normals[S.lesion], lift));
      h.position.set(hp[0], hp[1], hp[2]);
    }
  }
}

function updateFormVisibility() {
  const cutaneous = els.tumorKind.value === "cutaneous";
  els.depthWrap.classList.toggle("hidden", cutaneous);
  els.marginWrap.classList.toggle("hidden", !cutaneous);
  els.boundaryWrap.classList.toggle("hidden", !cutaneous);
  els.ellipseWrap.classList.toggle("hidden", !cutaneous || els.boundaryMode.value !== "ellipse");
  els.freehandControls.classList.toggle("hidden", !cutaneous || els.boundaryMode.value !== "freehand");
  updateTumorRing();
  updateAnatomyPreview();
}

function fmt(x, digits = 1) {
  return Number.isFinite(Number(x)) ? Number(x).toFixed(digits) : "—";
}

function neutralEdit() {
  return {
    angle_offset_deg: 0,
    length_scale: 1,
    width_scale: 1,
    shift_along_mm: 0,
    shift_perp_mm: 0,
    reason: "",
  };
}

function currentEditBase() {
  return {
    angle_offset_deg: Number(els.angleOffset.value),
    length_scale: Number(els.lengthScale.value) / 100,
    width_scale: Number(els.widthScale.value) / 100,
    shift_along_mm: Number(els.shiftAlong.value),
    shift_perp_mm: Number(els.shiftPerp.value),
    reason: els.editReason.value,
  };
}

function editIsActive(edit = currentEdit()) {
  return edit.angle_offset_deg !== 0 ||
    edit.length_scale !== 1 ||
    edit.width_scale !== 1 ||
    edit.shift_along_mm !== 0 ||
    edit.shift_perp_mm !== 0 ||
    Boolean(edit.reason);
}

function editsEqual(a = neutralEdit(), b = neutralEdit()) {
  return Number(a.angle_offset_deg || 0) === Number(b.angle_offset_deg || 0) &&
    Number(a.length_scale || 1) === Number(b.length_scale || 1) &&
    Number(a.width_scale || 1) === Number(b.width_scale || 1) &&
    Number(a.shift_along_mm || 0) === Number(b.shift_along_mm || 0) &&
    Number(a.shift_perp_mm || 0) === Number(b.shift_perp_mm || 0) &&
    String(a.reason || "") === String(b.reason || "");
}

function cloneEdit(edit = neutralEdit()) {
  return {
    angle_offset_deg: Number(edit.angle_offset_deg || 0),
    length_scale: Number(edit.length_scale || 1),
    width_scale: Number(edit.width_scale || 1),
    shift_along_mm: Number(edit.shift_along_mm || 0),
    shift_perp_mm: Number(edit.shift_perp_mm || 0),
    reason: String(edit.reason || ""),
  };
}

function ensureEditTimeline() {
  if (!Array.isArray(S.editTimeline) || !S.editTimeline.length) {
    S.editTimeline = [neutralEdit()];
    S.editCursor = 0;
  }
}

function editHistoryEntriesForCurrent(edit = currentEditBase()) {
  ensureEditTimeline();
  const rawCommitted = S.editTimeline.slice(1, Math.max(1, S.editCursor + 1));
  const committedSource = rawCommitted.some((entry) => editIsActive(entry))
    ? rawCommitted
    : rawCommitted.filter((entry) => editIsActive(entry));
  const committed = committedSource.map((entry, idx) => ({
      ...cloneEdit(entry),
      source: "web/incision_agent",
      interaction: entry.interaction || "committed_control_edit",
      history_index: idx + 1,
    }));
  const cursorEdit = S.editTimeline[S.editCursor] || neutralEdit();
  if (!editsEqual(edit, cursorEdit) && editIsActive(edit)) {
    committed.push({
      ...cloneEdit(edit),
      source: "web/incision_agent",
      interaction: "live_preview_uncommitted_edit",
      history_index: committed.length + 1,
    });
  }
  return committed;
}

function currentEdit() {
  const edit = currentEditBase();
  return {
    ...edit,
    session_history: editHistoryEntriesForCurrent(edit),
  };
}

function syncEditLabels() {
  els.angleOffsetVal.textContent = els.angleOffset.value;
  els.lengthScaleVal.textContent = `${els.lengthScale.value}%`;
  els.widthScaleVal.textContent = `${els.widthScale.value}%`;
  els.shiftAlongVal.textContent = els.shiftAlong.value;
  els.shiftPerpVal.textContent = els.shiftPerp.value;
}

function setEditControls(edit = neutralEdit()) {
  els.angleOffset.value = String(Math.round(Number(edit.angle_offset_deg || 0)));
  els.lengthScale.value = String(Math.round(Number(edit.length_scale || 1) * 100));
  els.widthScale.value = String(Math.round(Number(edit.width_scale || 1) * 100));
  els.shiftAlong.value = String(Math.round(Number(edit.shift_along_mm || 0)));
  els.shiftPerp.value = String(Math.round(Number(edit.shift_perp_mm || 0)));
  els.editReason.value = String(edit.reason || "");
  syncEditLabels();
}

function resetEditControls() {
  setEditControls(neutralEdit());
}

function resetEditTimeline() {
  S.editTimeline = [neutralEdit()];
  S.editCursor = 0;
  renderEditHistoryState();
}

function renderEditHistoryState() {
  if (!els.editHistoryState) return;
  ensureEditTimeline();
  const edit = currentEditBase();
  const committedCount = Math.max(0, S.editCursor);
  const uncommitted = !editsEqual(edit, S.editTimeline[S.editCursor] || neutralEdit());
  const historyCount = editHistoryEntriesForCurrent(edit).length;
  const version = 1 + historyCount;
  const pending = uncommitted ? " · 当前预览未提交" : "";
  els.editHistoryState.textContent = historyCount
    ? `编辑版本：v${version} · 已提交 ${committedCount} 步${pending}`
    : `编辑版本：v1 · 无已提交调整${pending}`;
  if (els.undoEdit) els.undoEdit.disabled = S.editCursor <= 0;
  if (els.redoEdit) els.redoEdit.disabled = S.editCursor >= S.editTimeline.length - 1;
}

function commitEditSnapshot(interaction = "control_change") {
  ensureEditTimeline();
  const edit = {
    ...cloneEdit(currentEditBase()),
    interaction,
    committed_at: new Date().toISOString(),
  };
  const current = S.editTimeline[S.editCursor] || neutralEdit();
  if (editsEqual(edit, current)) {
    renderEditHistoryState();
    return;
  }
  S.editTimeline = S.editTimeline.slice(0, S.editCursor + 1);
  S.editTimeline.push(edit);
  S.editCursor = S.editTimeline.length - 1;
  renderEditHistoryState();
  if (S.baseResult) {
    const result = applyCandidateEdit(S.baseResult, currentEdit(), S.normals[S.lesion], S.unitsPerMm, S.verts);
    renderResult(result);
  }
}

function applyEditSnapshot(edit) {
  setEditControls(edit);
  if (S.baseResult) {
    const result = applyCandidateEdit(S.baseResult, currentEdit(), S.normals[S.lesion], S.unitsPerMm, S.verts);
    renderResult(result);
  } else {
    renderEditHistoryState();
  }
}

function undoEditSnapshot() {
  ensureEditTimeline();
  if (S.editCursor <= 0) return;
  S.editCursor -= 1;
  invalidateReviewAfterGeometryChange("已撤销上一步医生调整，审阅状态已回到待医生确认。");
  applyEditSnapshot(S.editTimeline[S.editCursor]);
}

function redoEditSnapshot() {
  ensureEditTimeline();
  if (S.editCursor >= S.editTimeline.length - 1) return;
  S.editCursor += 1;
  invalidateReviewAfterGeometryChange("已重做医生调整，审阅状态已回到待医生确认。");
  applyEditSnapshot(S.editTimeline[S.editCursor]);
}

function updateEditVisibility(result) {
  const fusiform = result?.candidate?.type === "fusiform";
  els.widthScaleWrap.classList.toggle("hidden", !fusiform);
  const active = editIsActive();
  els.editStatus.textContent = active ? "已调整" : "工具建议";
  els.editStatus.classList.toggle("active", active);
  renderEditHistoryState();
}

function applyEditControls() {
  syncEditLabels();
  renderEditHistoryState();
  if (!S.baseResult) return;
  if (editIsActive()) invalidateReviewAfterGeometryChange();
  const result = applyCandidateEdit(S.baseResult, currentEdit(), S.normals[S.lesion], S.unitsPerMm, S.verts);
  renderResult(result);
}

function renderTrace(trace) {
  els.traceList.innerHTML = "";
  els.traceCount.textContent = String(trace?.length || 0);
  for (const [idx, step] of (trace || []).entries()) {
    const div = document.createElement("div");
    div.className = "trace-step";
    const status = document.createElement("span");
    status.className = "status-pill ok";
    status.textContent = String(idx + 1).padStart(2, "0");
    const top = document.createElement("div");
    top.className = "top";
    const code = document.createElement("code");
    code.textContent = step.action;
    top.append(code, status);
    const p = document.createElement("p");
    p.textContent = step.summary || "";
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(step.observation, null, 2);
    div.append(top, p, pre);
    els.traceList.append(div);
  }
}

function renderAgentExecutionEvents(execution) {
  if (!els.agentExecutionList) return;
  els.agentExecutionList.innerHTML = "";
  const events = Array.isArray(execution?.events) ? execution.events : [];
  if (!events.length) {
    const div = document.createElement("div");
    div.className = "execution-event warn";
    div.textContent = "Agent 执行事件：尚未生成。";
    els.agentExecutionList.append(div);
    return;
  }
  for (const event of events) {
    const status = String(event.status || "unknown");
    const warn = status === "failed" || status === "retrying" || status === "recovered";
    const div = document.createElement("div");
    div.className = `execution-event${warn ? " warn" : ""}`;
    const top = document.createElement("div");
    top.className = "top";
    const title = document.createElement("strong");
    const traceLabel = event.trace_index == null ? "system" : `trace #${Number(event.trace_index) + 1}`;
    title.textContent = `${event.event || "execution_event"} · ${traceLabel}`;
    const pill = document.createElement("span");
    pill.className = `status-pill ${warn ? "warn" : "ok"}`;
    pill.textContent = status;
    top.append(title, pill);
    const action = event.action ? `工具：${event.action}` : "工具：—";
    const planSteps = (event.plan_step_ids || []).join(" · ") || "—";
    const meta = document.createElement("p");
    meta.textContent = `${action} · plan steps: ${planSteps}`;
    const msg = document.createElement("p");
    msg.textContent = event.message || "";
    div.append(top, meta, msg);
    els.agentExecutionList.append(div);
  }
}

function handleAgentStreamEvent(streamState, evt) {
  const { event, data } = evt || {};
  if (event === "provider") {
    const provider = data || {};
    els.providerState.textContent = provider.model
      ? `${provider.mode || "agent"} · ${provider.model}`
      : provider.mode || "agent";
    els.providerState.style.color = provider.error ? "#b45309" : "";
    els.stageStatus.textContent = "Agent 已连接，等待工具 trace…";
    return;
  }
  if (event === "execution_event") {
    const step = data || {};
    const index = Number.isInteger(step.index) ? step.index : streamState.executionEvents.length;
    streamState.executionEvents[index] = step;
    const visibleEvents = streamState.executionEvents.filter(Boolean);
    renderAgentExecutionEvents({
      schema_version: "agent-execution-events/v0.1",
      events: visibleEvents,
    });
    els.stageStatus.textContent = `Agent 执行事件 ${visibleEvents.length} 条${step.event ? `：${step.event}` : ""}`;
    return;
  }
  if (event === "trace") {
    const step = data || {};
    const index = Number.isInteger(step.index) ? step.index : streamState.trace.length;
    streamState.trace[index] = step;
    const visibleTrace = streamState.trace.filter(Boolean);
    renderTrace(visibleTrace);
    els.stageStatus.textContent = `工具 trace ${visibleTrace.length} 步${step.action ? `：${step.action}` : ""}`;
    return;
  }
  if (event === "trace_gate") {
    const gate = data || {};
    if (els.agentGate) {
      els.agentGate.classList.toggle("warn", gate.passed !== true);
      const missing = (gate.missing_actions || []).map((item) => item.label || item.key).join("、");
      els.agentGate.textContent = `Agent 工具门控：${gate.passed ? "通过" : `未通过${missing ? `；缺 ${missing}` : ""}`} · SSE`;
    }
    els.stageStatus.textContent = gate.passed ? "Agent 工具门控已通过" : "Agent 工具门控未通过";
    return;
  }
  if (event === "react_plan") {
    const plan = data || {};
    renderAgentReactPlan(plan);
    els.stageStatus.textContent = plan.passed
      ? `Agent ReAct 计划已通过：${plan.completed_step_count || 0}/${plan.step_count || 0} 步`
      : `Agent ReAct 计划需复核：失败 ${plan.failed_step_count || 0} 步`;
    return;
  }
  if (event === "fallback") {
    const msg = data?.error ? `：${String(data.error).slice(0, 80)}` : "";
    els.stageStatus.textContent = `SSE trace 不可用，改用普通 Agent 请求${msg}`;
  }
}

function renderGuardrailDetails(guardrails) {
  const warnings = guardrails?.warnings || [];
  const overrides = guardrails?.suggested_overrides || [];
  els.guardrailDetails.classList.toggle("warn", warnings.some((w) => w.severity === "medium"));
  els.guardrailDetails.classList.toggle("danger", warnings.some((w) => w.severity === "high"));
  if (!warnings.length) {
    els.guardrailDetails.textContent = "Guardrails：未发现需要复核的规则项。";
    if (overrides.length) {
      els.guardrailDetails.textContent += `\n建议：${overrides.map((o) => o.kind).join(" · ")}`;
    }
    return;
  }
  els.guardrailDetails.textContent = `Guardrails：${warnings.map((w) => `${w.code}(${w.severity})`).join(" · ")}`;
  if (overrides.length) {
    els.guardrailDetails.textContent += `\n建议：${overrides.map((o) => {
      if (o.kind === "protective_direction") return `${o.kind}:${o.structure}/${o.direction_hint}`;
      return `${o.kind}:${o.reason || ""}`;
    }).join(" · ")}`;
  }
}

function directionSourceLabel(source) {
  const labels = {
    rstl_atlas_weighted_nearest: "RSTL 图谱 weighted-nearest",
    rstl_atlas_empty: "RSTL 图谱无可用支持点",
  };
  return labels[source] || source || "未记录";
}

function renderDirectionSource(result) {
  if (!els.directionSource) return;
  const direction = result.direction || {};
  const sources = [
    directionSourceLabel(direction.source),
    `support ${direction.support_count ?? 0}`,
    direction.angular_spread_deg != null ? `轴向离散 ${fmt(direction.angular_spread_deg)}°` : null,
  ].filter(Boolean);
  const overrides = (result.guardrails?.suggested_overrides || []).filter((o) => o.kind === "protective_direction");
  if (overrides.length) {
    sources.push(`敏感结构方向例外：${overrides.map((o) => `${o.structure}/${o.direction_hint}`).join("；")}`);
  }
  sources.push(S.secondaryCues ? "皱襞/边界辅助线索：只读审阅，不参与几何" : "皱襞/边界辅助线索：未参与几何");
  if (result.candidate?.edited) sources.push("医生人工覆盖已记录");
  els.directionSource.textContent = `方向依据：${sources.join(" · ")}`;
  els.directionSource.classList.toggle("warn", direction.confidence < 0.35 || overrides.length > 0 || Boolean(result.candidate?.edited));
}

function renderAgentGate(result) {
  if (!els.agentGate) return;
  const gate = agentTraceGate(result);
  els.agentGate.classList.toggle("warn", !gate.passed);
  const missing = gate.missing_actions.map((item) => item.label).join("、");
  const status = gate.passed ? "通过" : `未通过${missing ? `；缺 ${missing}` : ""}`;
  els.agentGate.textContent = `Agent 工具门控：${status} · ${gate.observed_actions.length} 个 trace 动作 · ${gate.boundary}`;
  els.agentGate.title = `observed_actions=${gate.observed_actions.join(", ")}`;
}

function renderAgentReactPlan(plan) {
  if (!els.agentPlanList) return;
  els.agentPlanList.innerHTML = "";
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (!steps.length) {
    const div = document.createElement("div");
    div.className = "react-plan-step warn";
    div.textContent = "Agent ReAct 计划：尚未生成。";
    els.agentPlanList.append(div);
    return;
  }
  for (const [idx, step] of steps.entries()) {
    const div = document.createElement("div");
    const status = String(step.status || "unknown");
    const warn = !status.startsWith("completed") || status.includes("retry") || status.includes("recovery");
    div.className = `react-plan-step${warn ? " warn" : ""}`;
    const top = document.createElement("div");
    top.className = "top";
    const title = document.createElement("strong");
    title.textContent = `${idx + 1}. ${step.label || step.id || "计划步骤"}`;
    const pill = document.createElement("span");
    pill.className = `status-pill ${warn ? "warn" : "ok"}`;
    pill.textContent = status;
    top.append(title, pill);
    const observed = (step.observed_actions || []).join(" · ") || "未观察到工具动作";
    const issues = (step.issues || []).length ? `；问题：${step.issues.join("；")}` : "";
    const meta = document.createElement("p");
    meta.textContent = `${step.intent || ""}${step.intent ? " · " : ""}工具：${observed}${issues}`;
    const indexes = document.createElement("p");
    indexes.textContent = `trace indexes: ${(step.trace_indexes || []).join(", ") || "—"}`;
    div.append(top, meta, indexes);
    els.agentPlanList.append(div);
  }
}

function formatRecoveredFailureSummary(audit, includeError = false) {
  const failures = Array.isArray(audit?.recovered_failures) ? audit.recovered_failures : [];
  return failures
    .map((failure) => {
      const variant = failure.variant
        || (failure.angle_offset_deg != null ? `${fmt(failure.angle_offset_deg)}°` : "候选变体");
      const tool = failure.tool || "确定性工具";
      const recovery = failure.recovery === "skipped_failed_variant_and_kept_other_candidates"
        ? "已跳过失败变体并继续比较"
        : failure.recovery || "已记录恢复动作";
      const error = includeError && failure.error ? `；错误 ${String(failure.error).slice(0, 80)}` : "";
      return `${variant}/${tool}：${recovery}${error}`;
    })
    .join("；");
}

function renderAgentComparison(result) {
  if (!els.agentComparison) return;
  const comparison = Array.isArray(result.candidate_comparison) ? result.candidate_comparison : [];
  const audit = result.agent_orchestration_audit || {};
  if (!comparison.length) {
    els.agentComparison.classList.add("warn");
    els.agentComparison.textContent = "Agent 候选比较：未返回后端多候选比较；可手动保存候选后生成备选。";
    return;
  }
  const top = comparison
    .slice(0, 3)
    .map((item) => `#${item.rank} ${item.label || item.id} ${fmt(item.score, 1)}分`)
    .join("；");
  const failureSummary = formatRecoveredFailureSummary(audit);
  const failures = audit.tool_failure_count
    ? `；恢复失败 ${audit.tool_failure_count} 个${failureSummary ? `（${failureSummary}）` : ""}`
    : "";
  els.agentComparison.classList.toggle("warn", Boolean(audit.tool_failure_count));
  els.agentComparison.title = failureSummary
    ? `recovered_failures=${formatRecoveredFailureSummary(audit, true)}`
    : "";
  els.agentComparison.textContent =
    `Agent 候选比较：${comparison.length} 个后端候选 · ${top}${failures}。工程排序不是临床推荐或手术指令。`;
}

function tumorQualityFor(result = S.result) {
  if (!result?.tumor) return { warnings: [], warning_count: 0, passed: true };
  return result.tumor_quality || summarizeTumorInputQuality(result.tumor);
}

function renderResult(result) {
  S.result = result;
  drawCandidate(result);
  const c = result.candidate;
  els.candidateType.textContent = c.type === "linear" ? "线性" : "梭形";
  els.candidateLength.textContent = `${fmt(c.length_mm)} mm`;
  if (c.type === "fusiform") {
    const ratio = c.metrics?.length_to_width_ratio;
    const err = c.metrics?.tip_angle_error_deg;
    els.candidateWidth.textContent = `${fmt(c.width_mm)} mm / ${fmt(ratio, 2)}:1`;
    els.candidateTipAngle.textContent = `${fmt(c.tip_angle_deg)}° · 误差 ${fmt(err)}°`;
  } else {
    els.candidateWidth.textContent = "—";
    els.candidateTipAngle.textContent = "—";
  }
  const directionReasons = result.direction.confidence_reasons || [];
  els.directionConf.textContent = `${Math.round((result.direction.confidence || 0) * 100)}%${directionReasons.length ? ` · ${directionReasons.join(", ")}` : ""}`;
  els.directionConf.title = directionReasons.length ? `RSTL 低置信原因：${directionReasons.join(", ")}` : "";
  const regionReasons = result.anatomy.confidence_reasons || [];
  els.regionVal.textContent = `${result.anatomy.region}${regionReasons.length ? ` · ${regionReasons.join(", ")}` : ""}`;
  els.regionVal.title = regionReasons.length ? `分区置信原因：${regionReasons.join(", ")}` : "";
  els.guardrailVal.textContent = result.guardrails.passed ? "通过" : "复核";
  els.guardrailVal.style.color = result.guardrails.passed ? "" : "#b45309";
  renderGuardrailDetails(result.guardrails);
  renderDirectionSource(result);
  renderAgentGate(result);
  renderAgentExecutionEvents(result.agent_execution_events);
  renderAgentReactPlan(result.agent_react_plan);
  renderAgentComparison(result);
  const tumorQuality = tumorQualityFor(result);
  if (tumorQuality.warning_count) {
    els.guardrailDetails.textContent += `\n肿物输入：${tumorQuality.warnings.map((w) => `${w.code}(${w.severity})`).join(" · ")}`;
  }
  els.llmSummary.textContent = result.llm?.summary || "已生成候选。";
  els.nextStep.textContent = result.llm?.next_step || "";
  renderTrace(result.trace);
  updateBoundaryStatus();
  const provider = result.provider || {};
  els.providerState.textContent = provider.model ? `${provider.mode} · ${provider.model}` : provider.mode || "deterministic";
  els.providerState.style.color = provider.error ? "#b45309" : "";
  updateEditVisibility(result);
  const audit = privacyAudit(provider);
  els.privacyState.textContent = audit.remote_provider_configured ? "抽象参数出域" : "浏览器本地";
  els.privacyAudit.textContent = audit.raw_image_sent
    ? "警告：检测到原始影像出域配置。"
    : `不上传原始影像；发送给 Agent 的是 ${audit.data_sent_to_agent.length} 类抽象字段，API Key 仅在本次请求中传给代理。${audit.secondary_cues_present ? " 辅助线索仅随审阅导出，不发送给 Agent。" : ""}`;
  const edited = result.candidate.edited ? " · 已记录医生调整" : "";
  els.stageStatus.textContent = provider.error ? `LLM fallback: ${provider.error.slice(0, 80)}${edited}` : `候选已更新${edited}`;
}

function guardrailSummary(guardrails = {}) {
  const warnings = guardrails.warnings || [];
  const high = warnings.filter((w) => w.severity === "high");
  const medium = warnings.filter((w) => w.severity === "medium");
  return {
    passed: Boolean(guardrails.passed),
    high_count: high.length,
    medium_count: medium.length,
    high_codes: high.map((w) => w.code),
    medium_codes: medium.map((w) => w.code),
    warnings: warnings.map((w) => ({
      code: w.code,
      severity: w.severity,
      message: w.message || "",
    })),
    suggested_overrides: guardrails.suggested_overrides || [],
  };
}

function reviewGate(review, result) {
  const summary = guardrailSummary(result.guardrails);
  const traceGate = agentTraceGate(result);
  const reviewerRequired = review.status === "approved_for_discussion";
  const notesRequired = reviewerRequired && summary.high_count > 0;
  const reviewerPresent = Boolean(review.reviewer);
  const notesPresent = Boolean(review.notes);
  const approvalReady = review.status === "approved_for_discussion" &&
    traceGate.passed &&
    (!reviewerRequired || reviewerPresent) &&
    (!notesRequired || notesPresent);
  return {
    reviewer_required: reviewerRequired,
    reviewer_present: reviewerPresent,
    notes_required_for_high_guardrails: notesRequired,
    notes_present: notesPresent,
    high_guardrail_codes: summary.high_codes,
    agent_trace_gate_passed: traceGate.passed,
    agent_trace_gate_missing: traceGate.missing_actions.map((item) => item.key),
    approval_ready: approvalReady,
    live_overlay_ready: approvalReady,
    reason: approvalReady
      ? "approved_candidate_ready_for_research_overlay"
      : traceGate.passed ? "pending_clinician_confirmation_or_missing_required_review_context" : "agent_trace_gate_failed",
  };
}

function candidateEditSession(result = S.result) {
  const provenance = result?.candidate?.provenance || {};
  const history = Array.isArray(provenance.edit_history) ? provenance.edit_history : [];
  return {
    schema_version: "candidate-edit-session/v0.1",
    candidate_version: Number(provenance.candidate_version || 1),
    edit_count: history.length,
    current_edit_id: provenance.clinician_edit?.edit_id || null,
    undo_available: Boolean(els.undoEdit && !els.undoEdit.disabled),
    redo_available: Boolean(els.redoEdit && !els.redoEdit.disabled),
    source: "web/incision_agent",
    history: history.map((entry) => ({
      edit_id: entry.edit_id,
      resulting_candidate_version: entry.resulting_candidate_version,
      angle_offset_deg: entry.angle_offset_deg,
      length_scale: entry.length_scale,
      width_scale: entry.width_scale,
      shift_along_mm: entry.shift_along_mm,
      shift_perp_mm: entry.shift_perp_mm,
      reason: entry.reason || "",
      interaction: entry.interaction || entry.source || "clinician_adjustment",
    })),
  };
}

function sensitiveStructureInspectionFor(result = S.result) {
  if (result?.sensitive_structure_inspection) return result.sensitive_structure_inspection;
  const trace = Array.isArray(result?.trace) ? result.trace : [];
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const step = trace[i];
    if (step?.action === "inspect_sensitive_structures" && step.observation) return step.observation;
  }
  return null;
}

function reviewRecord(result = S.result, label = "候选") {
  const createdAt = new Date().toISOString();
  const review = currentReviewMetadata(createdAt);
  const actor = review.reviewer || result.tumor?.author || "unknown";
  const gate = reviewGate(review, result);
  const traceGate = agentTraceGate(result);
  const tumorBoundarySummary = boundarySummaryFor(result.tumor, result);
  return {
    schema_version: "incision-review-record/v0.3",
    id: `candidate_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    label,
    created_at: createdAt,
    tumor: result.tumor,
    tumor_quality: tumorQualityFor(result),
    tumor_boundary_summary: tumorBoundarySummary,
    secondary_cues: secondaryCueReviewSummary(),
    anatomy: result.anatomy,
    sensitive_structure_inspection: sensitiveStructureInspectionFor(result),
    direction: result.direction,
    candidate: result.candidate,
    original_candidate: result.original_candidate || result.candidate,
    candidate_edit_session: candidateEditSession(result),
    guardrails: result.guardrails,
    trace: result.trace,
    agent_trace_gate: traceGate,
    agent_react_plan: result.agent_react_plan || null,
    agent_execution_events: result.agent_execution_events || null,
    candidate_alternatives: result.candidate_alternatives || [],
    candidate_comparison: result.candidate_comparison || [],
    agent_orchestration_audit: result.agent_orchestration_audit || null,
    llm: result.llm,
    provider: result.provider,
    provider_config: redactedProviderConfig(),
    privacy_audit: privacyAudit(result.provider),
    review_status: review.status,
    review,
    review_gate: gate,
    guardrail_summary: guardrailSummary(result.guardrails),
    audit_events: [
      {
        event: "candidate_saved",
        at: createdAt,
        actor,
        status: review.status,
        approval_ready: gate.approval_ready,
        live_overlay_ready: gate.live_overlay_ready,
        agent_trace_gate_passed: traceGate.passed,
      },
      ...(review.status === "pending_clinician_confirmation"
        ? []
        : [{
          event: "clinician_review_recorded",
          at: createdAt,
          actor,
          status: review.status,
          notes_present: Boolean(review.notes),
          high_guardrail_codes: gate.high_guardrail_codes,
        }]),
    ],
  };
}

function renderSaved() {
  els.savedCount.textContent = String(S.saved.length);
  els.candidateList.innerHTML = "";
  const comparisonById = new Map(compareCandidateRecords(S.saved).map((c) => [c.id, c]));
  for (const rec of S.saved) {
    const comparison = comparisonById.get(rec.id);
    const row = document.createElement("div");
    row.className = "candidate-row";
    const top = document.createElement("div");
    top.className = "top";
    const title = document.createElement("span");
    title.textContent = `${rec.label} · ${rec.candidate.type === "linear" ? "线性" : "梭形"}`;
    const status = document.createElement("span");
    status.className = rec.review_status === "rejected_by_clinician" || !rec.guardrails.passed ? "danger-text" : "";
    status.textContent = reviewStatusLabel(rec.review_status);
    top.append(title, status);
    const meta = document.createElement("div");
    meta.className = "meta";
    const reviewer = rec.review?.reviewer ? ` · 审阅人 ${rec.review.reviewer}` : "";
    const guardrails = rec.guardrails.passed ? "guardrails 通过" : "guardrails 需复核";
    const rank = comparison ? `工程排序 #${comparison.rank} · 分 ${fmt(comparison.score, 1)} · ${comparison.reasons.slice(0, 2).join("；")} · ` : "";
    meta.textContent = `${rank}长度 ${fmt(rec.candidate.length_mm)} mm · 区域 ${rec.anatomy.region} · ${guardrails}${reviewer} · ${rec.created_at}`;
    const actions = document.createElement("div");
    actions.className = "btn-row";
    actions.style.gridTemplateColumns = "1fr 1fr";
    const load = document.createElement("button");
    load.className = "btn";
    load.textContent = "载入";
    load.onclick = () => {
      S.baseResult = rec;
      setReviewControls(rec.review || { status: rec.review_status });
      renderResult(rec);
    };
    const remove = document.createElement("button");
    remove.className = "btn";
    remove.textContent = "删除";
    remove.onclick = () => { S.saved = S.saved.filter((x) => x.id !== rec.id); renderSaved(); };
    actions.append(load, remove);
    row.append(top, meta, actions);
    els.candidateList.append(row);
  }
}

function saveCurrentCandidate(label = "医生候选") {
  if (!S.result) return;
  S.saved.push(reviewRecord(S.result, `${label} ${S.saved.length + 1}`));
  renderSaved();
  els.stageStatus.textContent = "候选已保存到审阅列表";
}

function saveReviewRecord() {
  const status = els.reviewDecision.value || "pending_clinician_confirmation";
  const readiness = reviewReadiness(status);
  if (!readiness.ok) {
    els.stageStatus.textContent = readiness.message;
    return;
  }
  saveCurrentCandidate("审阅候选");
}

function directionForAgentAlternative(baseDirection = {}, alternative = {}) {
  const offset = Number(alternative.angle_offset_deg || 0);
  const confidence = Math.max(0, Number(baseDirection.confidence || 0) - Math.abs(offset) / 180);
  const reasons = [...new Set([
    ...(Array.isArray(baseDirection.confidence_reasons) ? baseDirection.confidence_reasons : []),
    ...(Math.abs(offset) > 1e-9 ? ["agent_direction_variant_requires_clinician_review"] : []),
  ])];
  return {
    ...baseDirection,
    confidence,
    angle_offset_deg: offset,
    variant_source: Math.abs(offset) > 1e-9 ? "agent_direction_variant" : "rstl_primary",
    confidence_reasons: reasons,
  };
}

function agentAlternativeResult(baseResult, alternative) {
  return {
    ...baseResult,
    direction: directionForAgentAlternative(baseResult.direction, alternative),
    candidate: alternative.candidate,
    original_candidate: alternative.candidate,
    guardrails: alternative.guardrails || baseResult.guardrails,
    preview: alternative.preview || baseResult.preview,
    anatomy: alternative.anatomy || baseResult.anatomy,
    sensitive_structure_inspection:
      alternative.sensitive_structure_inspection || baseResult.sensitive_structure_inspection,
    review_status: alternative.review_status || "pending_clinician_confirmation",
    llm: {
      ...(baseResult.llm || {}),
      summary: `已载入后端方向备选：${alternative.label || alternative.id || "候选"}；请复核 guardrails、敏感结构和候选比较。`,
      next_step: "医生审阅、编辑或否决该后端候选。",
    },
  };
}

function makeVariantCandidates() {
  if (!S.baseResult) return;
  const backendAlternatives = Array.isArray(S.result?.candidate_alternatives)
    ? S.result.candidate_alternatives.filter((item) => item?.candidate)
    : [];
  if (backendAlternatives.length) {
    for (const alternative of backendAlternatives) {
      const result = agentAlternativeResult(S.result, alternative);
      S.saved.push(reviewRecord(result, alternative.label || `后端备选 ${S.saved.length + 1}`));
    }
    renderSaved();
    els.stageStatus.textContent = `已保存 ${backendAlternatives.length} 个后端方向备选，并保留各自 guardrails、敏感结构复核和工程排序`;
    return;
  }
  const variants = [
    { angle_offset_deg: -10, length_scale: 1, width_scale: 1, reason: "variant exploration: -10 deg" },
    { angle_offset_deg: 0, length_scale: 1, width_scale: 1, reason: "variant exploration: tool baseline" },
    { angle_offset_deg: 10, length_scale: 1, width_scale: 1, reason: "variant exploration: +10 deg" },
  ];
  for (const v of variants) {
    const result = applyCandidateEdit(S.baseResult, v, S.normals[S.lesion], S.unitsPerMm, S.verts);
    S.saved.push(reviewRecord(result, `备选 ${S.saved.length + 1}`));
  }
  renderSaved();
  els.stageStatus.textContent = "已生成 3 个方向备选、复跑 guardrails，并更新工程排序";
}

function recordReviewDecision(status, label) {
  if (!S.result) {
    els.stageStatus.textContent = "没有可审阅的候选";
    return;
  }
  const readiness = reviewReadiness(status);
  if (!readiness.ok) {
    els.stageStatus.textContent = readiness.message;
    return;
  }
  els.reviewDecision.value = status;
  updateReviewStateUI();
  saveCurrentCandidate(label);
}

function exportReviewJson() {
  if (!S.result && !S.saved.length) {
    els.stageStatus.textContent = "没有可导出的候选";
    return;
  }
  const current = S.result ? reviewRecord(S.result, "当前候选") : null;
  const records = [current, ...S.saved].filter(Boolean);
  const payload = {
    schema_version: "incision-review-export/v0.3",
    exported_at: new Date().toISOString(),
    current,
    saved: S.saved,
    secondary_cues: secondaryCueReviewSummary(),
    candidate_comparison: compareCandidateRecords(records),
  };
  if (!exportPreflightPasses(payload, "审阅 JSON 导出")) return;
  downloadText(`incision_review_${Date.now()}.json`, JSON.stringify(payload, null, 2));
}

function exportTumorJson() {
  if (!S.verts) return;
  const tumor = tumorInput();
  const payload = {
    schema_version: "tumor-input/v0.2",
    exported_at: new Date().toISOString(),
    tumor,
    tumor_quality: summarizeTumorInputQuality(tumor),
    boundary_summary: boundarySummaryFor(tumor),
    privacy_audit: {
      raw_image_sent: false,
      raw_video_sent: false,
      contains_face_image: false,
      contains_abstract_face_coordinates: true,
    },
  };
  if (!exportPreflightPasses(payload, "肿物输入 JSON 导出")) return;
  downloadText(`tumor_input_${Date.now()}.json`, JSON.stringify(payload, null, 2));
  els.stageStatus.textContent = "已导出肿物输入 JSON";
}

function applyImportedTumor(payload) {
  const raw = payload?.tumor || payload;
  const tumor = normalizeTumorInput(raw);
  els.tumorKind.value = tumor.kind;
  els.diameter.value = String(clamp(Math.round(tumor.diameter_mm), Number(els.diameter.min), Number(els.diameter.max)));
  els.diameterVal.textContent = els.diameter.value;
  els.depth.value = String(clamp(Math.round(tumor.depth_mm ?? Number(els.depth.value)), Number(els.depth.min), Number(els.depth.max)));
  els.depthVal.textContent = els.depth.value;
  els.margin.value = String(clamp(Math.round(tumor.margin_mm), Number(els.margin.min), Number(els.margin.max)));
  els.marginVal.textContent = els.margin.value;
  els.tumorAuthor.value = tumor.author || els.tumorAuthor.value;
  S.boundaryPoints = [];
  if (tumor.kind === "cutaneous" && tumor.boundary.length >= 3) {
    els.boundaryMode.value = "freehand";
    S.boundaryPoints = tumor.boundary.map((p) => p.map(Number));
  } else if (tumor.kind === "cutaneous") {
    els.boundaryMode.value = tumor.boundary_mode === "freehand" ? "freehand" : "ellipse";
  }
  S.boundaryActive = false;
  els.startBoundary.textContent = "开始轮廓";
  setLesion(nearestVertex(tumor.center));
  updateFormVisibility();
  els.pickState.textContent = tumor.boundary.length >= 3
    ? `已导入肿物：自由轮廓 ${tumor.boundary.length} 点`
    : "已导入肿物：中心点与直径";
  runAgent();
}

async function importTumorFile(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    applyImportedTumor(payload);
    els.stageStatus.textContent = "已导入肿物输入并重新生成候选";
  } catch (err) {
    els.stageStatus.textContent = `导入肿物失败：${err.message}`;
  } finally {
    els.tumorImportFile.value = "";
  }
}

async function importSecondaryCueFile(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    S.secondaryCues = normalizeSecondaryCuePayload(payload);
    if (els.secondaryCueConfirmed) els.secondaryCueConfirmed.checked = false;
    renderSecondaryCuePanel();
    els.stageStatus.textContent = "已导入低置信辅助线索；候选几何未改变。";
  } catch (err) {
    els.stageStatus.textContent = `导入辅助线索失败：${err.message}`;
  } finally {
    els.secondaryCueImportFile.value = "";
  }
}

function clearSecondaryCues() {
  S.secondaryCues = null;
  if (els.secondaryCueConfirmed) els.secondaryCueConfirmed.checked = false;
  renderSecondaryCuePanel();
  els.stageStatus.textContent = "已清空辅助线索；候选几何未改变。";
}

function exportReport() {
  if (!S.result && !S.saved.length) {
    els.stageStatus.textContent = "没有可导出的候选";
    return;
  }
  const rows = (S.saved.length ? S.saved : [reviewRecord(S.result, "当前候选")]).filter(Boolean);
  const comparison = compareCandidateRecords(rows);
  const comparisonBody = comparison.length
    ? [
      "## 候选工程排序",
      "",
      "该排序只按 guardrails、RSTL 偏角、覆盖缺口、敏感距离和几何误差比较，不是临床推荐或手术指令。",
      "",
      ...comparison.map((c) => `- #${c.rank} ${c.label}：${fmt(c.score, 1)} 分；${c.reasons.join("；")}`),
      "",
    ].join("\n")
    : "";
  const body = rows.map((r, idx) => {
    const metrics = r.candidate.metrics || {};
    const boundary = r.tumor_boundary_summary || {};
    const warningLines = (r.guardrails.warnings || [])
      .map((w) => `  - ${w.code} [${w.severity}] ${w.message || ""}`)
      .join("\n") || "  - 无";
    const overrideLines = (r.guardrails.suggested_overrides || [])
      .map((o) => `  - ${o.kind}: ${o.reason || ""}`)
      .join("\n") || "  - 无";
    const recoveredFailureDetails = formatRecoveredFailureSummary(r.agent_orchestration_audit, true);
    return [
    `## 候选 ${idx + 1}: ${r.label}`,
    `- 类型：${r.candidate.type === "linear" ? "皮下线性切口" : "皮表梭形切口"}`,
    `- 候选版本：v${r.candidate.provenance?.candidate_version || 1}；编辑记录 ${(r.candidate.provenance?.edit_history || []).length} 条`,
    r.candidate_edit_session?.edit_count
      ? `- 编辑时间线：${r.candidate_edit_session.edit_count} 步；当前 edit_id ${r.candidate_edit_session.current_edit_id || "—"}`
      : null,
    `- 肿物：${r.tumor.kind}，直径 ${fmt(r.tumor.diameter_mm)} mm，切缘 ${fmt(r.tumor.margin_mm)} mm`,
    (r.tumor_quality?.warnings || []).length
      ? `- 肿物输入提示：${r.tumor_quality.warnings.map((w) => `${w.code}(${w.severity})`).join("；")}`
      : null,
    r.secondary_cues?.present
      ? `- 辅助线索：${r.secondary_cues.confidence_label}；人工确认 ${r.secondary_cues.manual_confirmed ? "是" : "否"}；不参与几何 ${r.secondary_cues.used_for_geometry === false ? "是" : "否"}`
      : null,
    boundary.boundary_used
      ? `- 肿物边界摘要：点数 ${boundary.point_count ?? "—"}；长轴 ${fmt(boundary.axis_diameter_mm)} mm；短轴 ${fmt(boundary.perp_diameter_mm)} mm；面积 ${fmt(boundary.area_mm2)} mm²；自交 ${boundary.self_intersection ? "是" : "否"}；中心偏移 ${fmt(boundary.center_shift_mm)} mm`
      : null,
    `- 面部分区：${r.anatomy.region} / ${r.anatomy.subunit}`,
    (r.anatomy.confidence_reasons || []).length
      ? `- 分区置信原因：${r.anatomy.confidence_reasons.join(", ")}`
      : null,
    `- RSTL 来源：${directionSourceLabel(r.direction.source)}；support ${r.direction.support_count ?? 0}；轴向离散 ${fmt(r.direction.angular_spread_deg)}°`,
    `- RSTL 方向置信度：${Math.round((r.direction.confidence || 0) * 100)}%`,
    (r.direction.confidence_reasons || []).length
      ? `- RSTL 低置信原因：${r.direction.confidence_reasons.join(", ")}`
      : null,
    r.sensitive_structure_inspection
      ? `- 敏感结构检查：中心距 ${fmt(r.sensitive_structure_inspection.center_free_margin_distance_mm)} mm / 阈值 ${fmt(r.sensitive_structure_inspection.center_free_margin_threshold_mm)} mm；候选几何距 ${fmt(r.sensitive_structure_inspection.candidate_free_margin_distance_mm)} mm / 阈值 ${fmt(r.sensitive_structure_inspection.candidate_free_margin_threshold_mm)} mm；warning ${r.sensitive_structure_inspection.warning_count || 0} 个；保护方向 ${r.sensitive_structure_inspection.protective_direction?.direction_hint || "无"}`
      : null,
    `- Agent 工具门控：passed=${Boolean(r.agent_trace_gate?.passed)}；order_ok=${Boolean(r.agent_trace_gate?.order_ok)}；missing=${(r.agent_trace_gate?.missing_actions || []).map((item) => item.label || item.key).join(", ") || "无"}`,
    r.agent_react_plan
      ? `- Agent ReAct 计划：passed=${Boolean(r.agent_react_plan.passed)}；步骤 ${r.agent_react_plan.completed_step_count || 0}/${r.agent_react_plan.step_count || 0}；失败 ${r.agent_react_plan.failed_step_count || 0}`
      : null,
    r.agent_execution_events
      ? `- Agent 执行事件：passed=${Boolean(r.agent_execution_events.passed)}；事件 ${r.agent_execution_events.event_count || 0} 条；工具事件 ${r.agent_execution_events.tool_event_count || 0} 条；重试 ${r.agent_execution_events.retry_event_count || 0}；恢复 ${r.agent_execution_events.recovery_event_count || 0}`
      : null,
    r.agent_orchestration_audit
      ? `- Agent 编排审计：候选 ${r.agent_orchestration_audit.candidate_count || 0} 个；比较 ${r.agent_orchestration_audit.comparison_ready ? "已生成" : "未生成"}；恢复失败 ${r.agent_orchestration_audit.tool_failure_count || 0} 个`
      : null,
    recoveredFailureDetails ? `- Agent 恢复详情：${recoveredFailureDetails}` : null,
    (r.candidate_comparison || []).length
      ? `- Agent 后端候选比较：${r.candidate_comparison.map((c) => `#${c.rank} ${c.label || c.id} ${fmt(c.score, 1)}分`).join("；")}（不是临床推荐或手术指令）`
      : null,
    `- 候选长度：${fmt(r.candidate.length_mm)} mm`,
    r.candidate.type === "fusiform"
      ? `- 梭形宽度 / 长宽比：${fmt(r.candidate.width_mm)} mm / ${fmt(r.candidate.metrics?.length_to_width_ratio, 2)}:1`
      : null,
    r.candidate.type === "fusiform"
      ? `- 尖端角：${fmt(r.candidate.tip_angle_deg)}°；目标 ${fmt(r.candidate.metrics?.tip_angle_target_deg)}°；误差 ${fmt(r.candidate.metrics?.tip_angle_error_deg)}°`
      : null,
    r.candidate.type === "fusiform"
      ? `- 边界质量：点数 ${metrics.boundary_point_count ?? "—"}；面积 ${fmt(metrics.boundary_area_mm2)} mm²；自交 ${metrics.boundary_self_intersection ? "是" : "否"}；中心偏移 ${fmt(metrics.boundary_center_shift_mm)} mm`
      : null,
    r.candidate.type === "fusiform"
      ? `- 梭形包络：outline 面积 ${fmt(metrics.outline_area_mm2)} mm²；单峰收窄 ${metrics.outline_half_width_monotone === false ? "否" : "是"}；对称误差 ${fmt(metrics.outline_symmetry_max_error_mm)} mm；自交 ${metrics.outline_self_intersection ? "是" : "否"}；边界余量 ${fmt(metrics.boundary_envelope_min_margin_mm)} mm；出界点 ${metrics.boundary_envelope_outside_count ?? 0}`
      : null,
    metrics.sensitive_free_margin_min_distance_mm != null
      ? `- 最近敏感游离缘：${metrics.sensitive_free_margin_nearest || "—"}，${fmt(metrics.sensitive_free_margin_min_distance_mm)} mm`
      : null,
    `- Guardrails：${r.guardrails.passed ? "通过" : "需医生复核"}`,
    `- 警告：\n${warningLines}`,
    `- 建议覆盖项：\n${overrideLines}`,
    `- 审阅门槛：approval_ready=${Boolean(r.review_gate?.approval_ready)}；live_overlay_ready=${Boolean(r.review_gate?.live_overlay_ready)}；agent_trace_gate=${Boolean(r.review_gate?.agent_trace_gate_passed)}；high=${(r.review_gate?.high_guardrail_codes || []).join(", ") || "无"}`,
    `- 审阅状态：${reviewStatusLabel(r.review_status)}；审阅人：${r.review?.reviewer || "未填写"}`,
    `- 审阅备注：${r.review?.notes || "无"}`,
    `- 审阅边界：研究候选记录，非手术指令。`,
  ].filter(Boolean).join("\n");
  }).join("\n\n");
  downloadText(`incision_report_${Date.now()}.md`, `# 切口候选审阅草案\n\n${comparisonBody}${body}\n`, "text/markdown");
}

function exportScreenshot() {
  if (!S.result) {
    els.stageStatus.textContent = "没有可截图的候选";
    return;
  }
  els.canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `incision_candidate_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function stageLiveOverlay() {
  if (!S.result) {
    els.stageStatus.textContent = "没有可发送的候选";
    return;
  }
  if (els.reviewDecision.value === "rejected_by_clinician") {
    els.stageStatus.textContent = "当前候选已被否决，不发送到实时叠加。";
    return;
  }
  if (els.reviewDecision.value !== "approved_for_discussion") {
    els.stageStatus.textContent = "发送到实时叠加前，请先确认当前候选草案。";
    return;
  }
  const readiness = reviewReadiness("approved_for_discussion");
  if (!readiness.ok) {
    els.stageStatus.textContent = readiness.message;
    return;
  }
  const overlay = compileIncisionOverlay(reviewRecord(S.result, "实时叠加候选"), S.verts, S.tris);
  if (!overlay || !dataSource.stageIncisionOverlay(overlay)) {
    els.stageStatus.textContent = "切口候选叠加暂存失败";
    return;
  }
  els.stageStatus.textContent = "已发送到实时叠加；返回实时显示后上传照片、视频或开启摄像头查看。";
}

async function runAgent() {
  if (!S.verts) return;
  els.run.disabled = true;
  els.stageStatus.textContent = "生成中…";
  const tumor = tumorInput();
  let result;
  if (els.useAgentServer.checked) {
    try {
      const streamState = { trace: [], executionEvents: [] };
      result = await requestAgentPlan(tumor, {
        endpoint: els.endpoint.value.trim(),
        timeoutMs: Number(els.providerTimeout.value) * 1000,
        providerConfig: providerConfig(),
        stream: true,
        onStreamEvent: (evt) => handleAgentStreamEvent(streamState, evt),
      });
    } catch (err) {
      result = planIncisionDeterministic({ tumor, verts: S.verts, tris: S.tris, atlas: S.atlas, normal: S.normals[S.lesion] });
      result.provider = { mode: "browser_deterministic_fallback", model: null, error: err.message };
    }
  } else {
    result = planIncisionDeterministic({ tumor, verts: S.verts, tris: S.tris, atlas: S.atlas, normal: S.normals[S.lesion] });
  }
  S.baseResult = result;
  resetEditControls();
  resetEditTimeline();
  resetReviewControls();
  renderResult(result);
  els.run.disabled = false;
}

function facePointFromEvent(e) {
  if (!S.head) return null;
  const r = els.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  S.head.camera.updateMatrixWorld(true);
  S.head.scene.updateMatrixWorld(true);
  S.raycaster.setFromCamera(ndc, S.head.camera);
  const hit = S.raycaster.intersectObject(S.head.mesh, false)[0];
  if (!hit || !hit.face) return null;
  const local = S.head.group.worldToLocal(hit.point.clone());
  return { point: [local.x, local.y, local.z], face: hit.face };
}

function handleFromEvent(e) {
  if (!S.head || !S.endpointHandles.length) return null;
  const r = els.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  S.head.camera.updateMatrixWorld(true);
  S.head.scene.updateMatrixWorld(true);
  S.raycaster.setFromCamera(ndc, S.head.camera);
  const hit = S.raycaster.intersectObjects(S.endpointHandles.filter((h) => h.visible), false)[0];
  return hit?.object?.userData?.handle ?? null;
}

function signedAngleDeg(axis0, axis1, normal) {
  const perp = norm(cross(normal, axis0));
  return Math.atan2(dot(axis1, perp), dot(axis1, axis0)) * 180 / Math.PI;
}

function setEditFromGeometry(center, axis, lengthMm) {
  if (!S.baseResult) return;
  const base = S.baseResult.original_candidate || S.baseResult.candidate;
  const axis0 = norm(base.axis || [1, 0, 0]);
  const normal = S.normals[S.lesion];
  const perp0 = norm(cross(normal, axis0));
  const delta = sub(center, base.center || S.baseResult.tumor.center);
  const angle = clamp(signedAngleDeg(axis0, axis, normal), Number(els.angleOffset.min), Number(els.angleOffset.max));
  const lengthScale = clamp((lengthMm / Math.max(Number(base.length_mm || 1), 1)) * 100, Number(els.lengthScale.min), Number(els.lengthScale.max));
  const shiftAlong = clamp(dot(delta, axis0) / S.unitsPerMm, Number(els.shiftAlong.min), Number(els.shiftAlong.max));
  const shiftPerp = clamp(dot(delta, perp0) / S.unitsPerMm, Number(els.shiftPerp.min), Number(els.shiftPerp.max));
  els.angleOffset.value = String(Math.round(angle));
  els.lengthScale.value = String(Math.round(lengthScale));
  els.shiftAlong.value = String(Math.round(shiftAlong));
  els.shiftPerp.value = String(Math.round(shiftPerp));
  applyEditControls();
}

function dragEndpointTo(e, idx) {
  if (!S.result?.candidate?.endpoints) return;
  const hit = facePointFromEvent(e);
  if (!hit) return;
  const current = S.result.candidate.endpoints;
  const p0 = idx === 0 ? hit.point : current[0];
  const p1 = idx === 1 ? hit.point : current[1];
  const center = mul(add(p0, p1), 0.5);
  const axis = norm(sub(p1, p0));
  const lengthMm = len(sub(p1, p0)) / S.unitsPerMm;
  setEditFromGeometry(center, axis, lengthMm);
}

function pick(e) {
  if (!S.head) return;
  const hit = facePointFromEvent(e);
  if (!hit) return;
  if (S.boundaryActive && els.tumorKind.value === "cutaneous" && els.boundaryMode.value === "freehand") {
    S.boundaryPoints.push(hit.point);
    updateTumorRing();
    els.pickState.textContent = `自由轮廓点：${S.boundaryPoints.length} 个`;
    return;
  }
  const lp = hit.point;
  let best = hit.face.a, bd = Infinity;
  for (const vi of [hit.face.a, hit.face.b, hit.face.c]) {
    const d = len(sub(S.verts[vi], lp));
    if (d < bd) { bd = d; best = vi; }
  }
  setLesion(best);
  runAgent();
}

let drag = null;
els.canvas.addEventListener("pointerdown", (e) => {
  const handle = handleFromEvent(e);
  if (handle != null) {
    drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId, handle };
    els.canvas.setPointerCapture(e.pointerId);
    return;
  }
  drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
  els.canvas.setPointerCapture(e.pointerId);
});
els.canvas.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.handle != null) {
    dragEndpointTo(e, drag.handle);
    drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
    return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  S.head.setRotation(clamp(S.head.rotX + dy * 0.01, -1.2, 1.2), S.head.rotY + dx * 0.01);
  drag.x = e.clientX; drag.y = e.clientY;
});
els.canvas.addEventListener("pointerup", (e) => {
  const endpointDrag = drag?.handle != null;
  const moved = drag?.moved || 0;
  if (drag && drag.moved < 6 && !endpointDrag) pick(e);
  if (endpointDrag && moved >= 1) commitEditSnapshot("endpoint_drag");
  drag = null;
});
els.canvas.addEventListener("wheel", (e) => { e.preventDefault(); S.head.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

els.tumorKind.onchange = () => { updateFormVisibility(); runAgent(); };
els.diameter.oninput = () => { els.diameterVal.textContent = els.diameter.value; updateTumorRing(); };
els.diameter.onchange = runAgent;
els.depth.oninput = () => { els.depthVal.textContent = els.depth.value; };
els.depth.onchange = runAgent;
els.margin.oninput = () => { els.marginVal.textContent = els.margin.value; updateTumorRing(); };
els.margin.onchange = runAgent;
els.ellipseRatio.oninput = () => { els.ellipseRatioVal.textContent = `${els.ellipseRatio.value}%`; updateTumorRing(); };
els.ellipseRatio.onchange = runAgent;
els.boundaryMode.onchange = () => { S.boundaryActive = false; updateFormVisibility(); runAgent(); };
els.run.onclick = runAgent;
els.providerMode.onchange = saveProviderPrefs;
els.providerBaseUrl.onchange = saveProviderPrefs;
els.providerModel.onchange = saveProviderPrefs;
els.providerTimeout.oninput = () => { els.providerTimeoutVal.textContent = els.providerTimeout.value; saveProviderPrefs(); };
els.startBoundary.onclick = () => {
  S.boundaryActive = !S.boundaryActive;
  els.startBoundary.textContent = S.boundaryActive ? "结束轮廓" : "开始轮廓";
  els.pickState.textContent = S.boundaryActive ? "请在脸上连续点击皮表肿物边界点。" : `自由轮廓点：${S.boundaryPoints.length} 个`;
  if (!S.boundaryActive && S.boundaryPoints.length >= 3) runAgent();
};
els.clearBoundary.onclick = () => {
  S.boundaryPoints = [];
  updateTumorRing();
  els.pickState.textContent = "自由轮廓已清空。";
  runAgent();
};
[
  els.angleOffset,
  els.lengthScale,
  els.widthScale,
  els.shiftAlong,
  els.shiftPerp,
].forEach((el) => { el.oninput = applyEditControls; });
[
  els.angleOffset,
  els.lengthScale,
  els.widthScale,
  els.shiftAlong,
  els.shiftPerp,
].forEach((el) => { el.onchange = () => commitEditSnapshot("control_change"); });
els.editReason.onchange = () => {
  applyEditControls();
  commitEditSnapshot("reason_change");
};
els.undoEdit.onclick = undoEditSnapshot;
els.redoEdit.onclick = redoEditSnapshot;
els.resetEdit.onclick = () => {
  if (!S.baseResult) return;
  resetEditControls();
  resetEditTimeline();
  invalidateReviewAfterGeometryChange("已恢复工具建议，审阅状态已回到待医生确认。");
  renderResult(S.baseResult);
};
els.reviewDecision.onchange = updateReviewStateUI;
els.approveCandidate.onclick = () => recordReviewDecision("approved_for_discussion", "确认候选");
els.rejectCandidate.onclick = () => recordReviewDecision("rejected_by_clinician", "否决候选");
els.saveReview.onclick = saveReviewRecord;
els.saveCandidate.onclick = () => saveCurrentCandidate();
els.makeVariants.onclick = makeVariantCandidates;
els.clearSaved.onclick = () => { S.saved = []; renderSaved(); };
els.exportJson.onclick = exportReviewJson;
els.exportTumor.onclick = exportTumorJson;
els.importTumor.onclick = () => els.tumorImportFile.click();
els.tumorImportFile.onchange = (e) => importTumorFile(e.target.files?.[0]);
els.importSecondaryCue.onclick = () => els.secondaryCueImportFile.click();
els.clearSecondaryCue.onclick = clearSecondaryCues;
els.secondaryCueImportFile.onchange = (e) => importSecondaryCueFile(e.target.files?.[0]);
els.secondaryCueConfirmed.onchange = renderSecondaryCuePanel;
els.exportReport.onclick = exportReport;
els.exportPng.onclick = exportScreenshot;
els.stageLiveOverlay.onclick = stageLiveOverlay;
new ResizeObserver(fitSize).observe(els.wrap);

function renderLoop() {
  S.head.render();
  requestAnimationFrame(renderLoop);
}

boot().catch((err) => {
  els.stageStatus.textContent = "加载失败：" + err.message;
  console.error(err);
});
