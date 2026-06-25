import * as THREE from "three";

import { assetUrls } from "./assets.js";
import { dataSource } from "./data_source.js";
import { compileIncisionOverlay } from "./incision_overlay.js";
import {
  applyCandidateEdit,
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
  resetEdit: $("resetEditBtn"),
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
    new THREE.SphereGeometry(S.meanEdge * 0.48, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xf43f5e, toneMapped: false }),
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
      new THREE.SphereGeometry(S.meanEdge * 0.38, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    );
    h.userData.handle = idx;
    h.renderOrder = 8;
    return h;
  });
  S.marker.renderOrder = 5; S.tumorRing.renderOrder = 5; S.boundaryLine.renderOrder = 6; S.candidateLine.renderOrder = 7;
  S.head.group.add(S.marker, S.tumorRing, S.boundaryLine, S.candidateLine, ...S.endpointHandles);

  loadProviderPrefs();
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
  };
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

function reviewReadiness(status, result = S.result) {
  if (!result) return { ok: false, message: "没有可审阅的候选" };
  if (status === "approved_for_discussion") {
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

function boundarySummaryFor(tumor = tumorInput()) {
  const axis = S.result?.candidate?.axis || S.baseResult?.candidate?.axis || [1, 0, 0];
  return summarizeTumorBoundary(tumor, axis, S.normals?.[S.lesion] || [0, 0, 1], S.unitsPerMm || 1);
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
  S.marker.position.set(center[0], center[1], center[2]);
  updateTumorRing();
  els.pickState.textContent = `当前点位：顶点 #${i}`;
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
  for (const [idx, h] of S.endpointHandles.entries()) {
    const p = endpoints[idx];
    h.visible = Boolean(p);
    if (p) h.position.set(p[0], p[1], p[2]);
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
}

function fmt(x, digits = 1) {
  return Number.isFinite(Number(x)) ? Number(x).toFixed(digits) : "—";
}

function currentEdit() {
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

function syncEditLabels() {
  els.angleOffsetVal.textContent = els.angleOffset.value;
  els.lengthScaleVal.textContent = `${els.lengthScale.value}%`;
  els.widthScaleVal.textContent = `${els.widthScale.value}%`;
  els.shiftAlongVal.textContent = els.shiftAlong.value;
  els.shiftPerpVal.textContent = els.shiftPerp.value;
}

function resetEditControls() {
  els.angleOffset.value = 0;
  els.lengthScale.value = 100;
  els.widthScale.value = 100;
  els.shiftAlong.value = 0;
  els.shiftPerp.value = 0;
  els.editReason.value = "";
  syncEditLabels();
}

function updateEditVisibility(result) {
  const fusiform = result?.candidate?.type === "fusiform";
  els.widthScaleWrap.classList.toggle("hidden", !fusiform);
  const active = editIsActive();
  els.editStatus.textContent = active ? "已调整" : "工具建议";
  els.editStatus.classList.toggle("active", active);
}

function applyEditControls() {
  syncEditLabels();
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

function handleAgentStreamEvent(trace, evt) {
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
  if (event === "trace") {
    const step = data || {};
    const index = Number.isInteger(step.index) ? step.index : trace.length;
    trace[index] = step;
    const visibleTrace = trace.filter(Boolean);
    renderTrace(visibleTrace);
    els.stageStatus.textContent = `工具 trace ${visibleTrace.length} 步${step.action ? `：${step.action}` : ""}`;
    return;
  }
  if (event === "fallback") {
    const msg = data?.error ? `：${String(data.error).slice(0, 80)}` : "";
    els.stageStatus.textContent = `SSE trace 不可用，改用普通 Agent 请求${msg}`;
  }
}

function renderGuardrailDetails(guardrails) {
  const warnings = guardrails?.warnings || [];
  els.guardrailDetails.classList.toggle("warn", warnings.some((w) => w.severity === "medium"));
  els.guardrailDetails.classList.toggle("danger", warnings.some((w) => w.severity === "high"));
  if (!warnings.length) {
    els.guardrailDetails.textContent = "Guardrails：未发现需要复核的规则项。";
    return;
  }
  els.guardrailDetails.textContent = `Guardrails：${warnings.map((w) => `${w.code}(${w.severity})`).join(" · ")}`;
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
    : `不上传原始影像；发送给 Agent 的是 ${audit.data_sent_to_agent.length} 类抽象字段，API Key 仅在本次请求中传给代理。`;
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
  const reviewerRequired = review.status === "approved_for_discussion";
  const notesRequired = reviewerRequired && summary.high_count > 0;
  const reviewerPresent = Boolean(review.reviewer);
  const notesPresent = Boolean(review.notes);
  const approvalReady = review.status === "approved_for_discussion" &&
    (!reviewerRequired || reviewerPresent) &&
    (!notesRequired || notesPresent);
  return {
    reviewer_required: reviewerRequired,
    reviewer_present: reviewerPresent,
    notes_required_for_high_guardrails: notesRequired,
    notes_present: notesPresent,
    high_guardrail_codes: summary.high_codes,
    approval_ready: approvalReady,
    live_overlay_ready: approvalReady,
    reason: approvalReady
      ? "approved_candidate_ready_for_research_overlay"
      : "pending_clinician_confirmation_or_missing_required_review_context",
  };
}

function reviewRecord(result = S.result, label = "候选") {
  const createdAt = new Date().toISOString();
  const review = currentReviewMetadata(createdAt);
  const actor = review.reviewer || result.tumor?.author || "unknown";
  const gate = reviewGate(review, result);
  return {
    schema_version: "incision-review-record/v0.3",
    id: `candidate_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    label,
    created_at: createdAt,
    tumor: result.tumor,
    tumor_quality: tumorQualityFor(result),
    anatomy: result.anatomy,
    direction: result.direction,
    candidate: result.candidate,
    original_candidate: result.original_candidate || result.candidate,
    guardrails: result.guardrails,
    trace: result.trace,
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

function makeVariantCandidates() {
  if (!S.baseResult) return;
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
    candidate_comparison: compareCandidateRecords(records),
  };
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
    const warningLines = (r.guardrails.warnings || [])
      .map((w) => `  - ${w.code} [${w.severity}] ${w.message || ""}`)
      .join("\n") || "  - 无";
    const overrideLines = (r.guardrails.suggested_overrides || [])
      .map((o) => `  - ${o.kind}: ${o.reason || ""}`)
      .join("\n") || "  - 无";
    return [
    `## 候选 ${idx + 1}: ${r.label}`,
    `- 类型：${r.candidate.type === "linear" ? "皮下线性切口" : "皮表梭形切口"}`,
    `- 候选版本：v${r.candidate.provenance?.candidate_version || 1}；编辑记录 ${(r.candidate.provenance?.edit_history || []).length} 条`,
    `- 肿物：${r.tumor.kind}，直径 ${fmt(r.tumor.diameter_mm)} mm，切缘 ${fmt(r.tumor.margin_mm)} mm`,
    (r.tumor_quality?.warnings || []).length
      ? `- 肿物输入提示：${r.tumor_quality.warnings.map((w) => `${w.code}(${w.severity})`).join("；")}`
      : null,
    `- 面部分区：${r.anatomy.region} / ${r.anatomy.subunit}`,
    (r.anatomy.confidence_reasons || []).length
      ? `- 分区置信原因：${r.anatomy.confidence_reasons.join(", ")}`
      : null,
    `- RSTL 方向置信度：${Math.round((r.direction.confidence || 0) * 100)}%`,
    (r.direction.confidence_reasons || []).length
      ? `- RSTL 低置信原因：${r.direction.confidence_reasons.join(", ")}`
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
    metrics.sensitive_free_margin_min_distance_mm != null
      ? `- 最近敏感游离缘：${metrics.sensitive_free_margin_nearest || "—"}，${fmt(metrics.sensitive_free_margin_min_distance_mm)} mm`
      : null,
    `- Guardrails：${r.guardrails.passed ? "通过" : "需医生复核"}`,
    `- 警告：\n${warningLines}`,
    `- 建议覆盖项：\n${overrideLines}`,
    `- 审阅门槛：approval_ready=${Boolean(r.review_gate?.approval_ready)}；live_overlay_ready=${Boolean(r.review_gate?.live_overlay_ready)}；high=${(r.review_gate?.high_guardrail_codes || []).join(", ") || "无"}`,
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
      const streamedTrace = [];
      result = await requestAgentPlan(tumor, {
        endpoint: els.endpoint.value.trim(),
        timeoutMs: Number(els.providerTimeout.value) * 1000,
        providerConfig: providerConfig(),
        stream: true,
        onStreamEvent: (evt) => handleAgentStreamEvent(streamedTrace, evt),
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
  if (drag && drag.moved < 6) pick(e);
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
els.editReason.onchange = applyEditControls;
els.resetEdit.onclick = () => {
  if (!S.baseResult) return;
  resetEditControls();
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
