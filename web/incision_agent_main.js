import * as THREE from "three";

import { assetUrls } from "./assets.js";
import { applyCandidateEdit, planIncisionDeterministic, unitsPerMmFromVertices } from "./incision_tools.js";
import { requestAgentPlan } from "./llm_provider.js";
import { Head3D, buildLineGeometry, vertexNormals } from "./three3d.js";

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $("agentCanvas"),
  wrap: document.querySelector(".main-wrap"),
  tumorKind: $("tumorKind"),
  diameter: $("diameterMm"),
  diameterVal: $("diameterVal"),
  depth: $("depthMm"),
  depthVal: $("depthVal"),
  depthWrap: $("depthWrap"),
  margin: $("marginMm"),
  marginVal: $("marginVal"),
  marginWrap: $("marginWrap"),
  run: $("runAgentBtn"),
  pickState: $("pickState"),
  useAgentServer: $("useAgentServer"),
  endpoint: $("agentEndpoint"),
  providerState: $("providerState"),
  candidateType: $("candidateType"),
  candidateLength: $("candidateLength"),
  directionConf: $("directionConf"),
  regionVal: $("regionVal"),
  guardrailVal: $("guardrailVal"),
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
  traceList: $("traceList"),
  traceCount: $("traceCount"),
  stageStatus: $("stageStatus"),
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
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
  candidateLine: null,
  raycaster: new THREE.Raycaster(),
  lesion: 0,
  result: null,
  baseResult: null,
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
  S.candidateLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x34d399, toneMapped: false, linewidth: 2 }),
  );
  S.marker.renderOrder = 5; S.tumorRing.renderOrder = 5; S.candidateLine.renderOrder = 6;
  S.head.group.add(S.marker, S.tumorRing, S.candidateLine);

  setLesion(defaultLesion());
  fitSize();
  renderLoop();
  runAgent();
}

function fitSize() {
  const w = els.wrap.clientWidth || 900, h = els.wrap.clientHeight || 680;
  S.head.resize(w, h);
}

function tumorInput() {
  return {
    kind: els.tumorKind.value,
    center: S.verts[S.lesion],
    diameter_mm: Number(els.diameter.value),
    depth_mm: els.tumorKind.value === "subcutaneous" ? Number(els.depth.value) : null,
    margin_mm: els.tumorKind.value === "cutaneous" ? Number(els.margin.value) : 0,
    source: "manual_web_agent",
  };
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
}

function drawCandidate(result) {
  const old = S.candidateLine.geometry;
  S.candidateLine.geometry = polylineGeometry(result.candidate.polyline, S.normals[S.lesion]);
  old.dispose();
  S.candidateLine.material.color.set(result.candidate.type === "linear" ? 0x34d399 : 0x5eead4);
}

function updateFormVisibility() {
  const cutaneous = els.tumorKind.value === "cutaneous";
  els.depthWrap.classList.toggle("hidden", cutaneous);
  els.marginWrap.classList.toggle("hidden", !cutaneous);
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
  const result = applyCandidateEdit(S.baseResult, currentEdit(), S.normals[S.lesion], S.unitsPerMm);
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

function renderResult(result) {
  S.result = result;
  drawCandidate(result);
  const c = result.candidate;
  els.candidateType.textContent = c.type === "linear" ? "线性" : "梭形";
  els.candidateLength.textContent = `${fmt(c.length_mm)} mm`;
  els.directionConf.textContent = `${Math.round((result.direction.confidence || 0) * 100)}%`;
  els.regionVal.textContent = result.anatomy.region;
  els.guardrailVal.textContent = result.guardrails.passed ? "通过" : "复核";
  els.guardrailVal.style.color = result.guardrails.passed ? "" : "#b45309";
  els.llmSummary.textContent = result.llm?.summary || "已生成候选。";
  els.nextStep.textContent = result.llm?.next_step || "";
  renderTrace(result.trace);
  const provider = result.provider || {};
  els.providerState.textContent = provider.model ? `${provider.mode} · ${provider.model}` : provider.mode || "deterministic";
  els.providerState.style.color = provider.error ? "#b45309" : "";
  updateEditVisibility(result);
  const edited = result.candidate.edited ? " · 已记录医生调整" : "";
  els.stageStatus.textContent = provider.error ? `LLM fallback: ${provider.error.slice(0, 80)}${edited}` : `候选已更新${edited}`;
}

async function runAgent() {
  if (!S.verts) return;
  els.run.disabled = true;
  els.stageStatus.textContent = "生成中…";
  const tumor = tumorInput();
  let result;
  if (els.useAgentServer.checked) {
    try {
      result = await requestAgentPlan(tumor, { endpoint: els.endpoint.value.trim() });
    } catch (err) {
      result = planIncisionDeterministic({ tumor, verts: S.verts, tris: S.tris, atlas: S.atlas, normal: S.normals[S.lesion] });
      result.provider = { mode: "browser_deterministic_fallback", model: null, error: err.message };
    }
  } else {
    result = planIncisionDeterministic({ tumor, verts: S.verts, tris: S.tris, atlas: S.atlas, normal: S.normals[S.lesion] });
  }
  S.baseResult = result;
  resetEditControls();
  renderResult(result);
  els.run.disabled = false;
}

function pick(e) {
  if (!S.head) return;
  const r = els.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  S.head.camera.updateMatrixWorld(true);
  S.head.scene.updateMatrixWorld(true);
  S.raycaster.setFromCamera(ndc, S.head.camera);
  const hit = S.raycaster.intersectObject(S.head.mesh, false)[0];
  if (!hit || !hit.face) return;
  const local = S.head.group.worldToLocal(hit.point.clone());
  const lp = [local.x, local.y, local.z];
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
  drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
  els.canvas.setPointerCapture(e.pointerId);
});
els.canvas.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
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
els.run.onclick = runAgent;
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
  renderResult(S.baseResult);
};
new ResizeObserver(fitSize).observe(els.wrap);

function renderLoop() {
  S.head.render();
  requestAnimationFrame(renderLoop);
}

boot().catch((err) => {
  els.stageStatus.textContent = "加载失败：" + err.message;
  console.error(err);
});
