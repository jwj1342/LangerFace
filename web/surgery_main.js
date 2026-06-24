// 切除 → 闭合演示页：标准脸（MediaPipe 标准头）+ 医生 RSTL 张力线，做表面质点-弹簧软体。
// 标一个肿物 → 梭形切除 → 周围皮肤预张力把伤口拉合（含轻微回弹）；顺皮纹 vs 逆皮纹的跨伤口张力不同。
// 物理核心在 soft_body.js（已 Node 单测）；本文件只负责渲染、拾取、交互、上色。
import * as THREE from "three";

import { assetUrls } from "./assets.js";
import { rstlDirField } from "./rstl_field.js";
import { boundaryVerts, buildSoftBody, excise, stepSoftBody, vertexTension } from "./soft_body.js";
import { Head3D, buildLineGeometry, vertexNormals } from "./three3d.js";

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $("surgeryCanvas"), wrap: document.querySelector(".main-wrap"), hint: $("hint"),
  lesionState: $("lesionState"), size: $("sizeRange"), sizeVal: $("sizeVal"), along: $("btnAlong"), across: $("btnAcross"),
  reset: $("btnReset"), showLines: $("showLines"), tensionVal: $("tensionVal"),
  tensionBar: $("tensionBar"), verdict: $("verdict"),
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// 上色用的是「闭合新增张力」= 当前张力 − 静息基线（逐顶点扣除）。皮肤沿 RSTL 本就有高静息张力，
// 若画绝对张力则整脸全红；扣掉基线后只剩闭合**新增**的那部分 → 远处归零（中性肤色）、仅伤口变红。
const EXC_LO = 0.03, EXC_HI = 0.13;   // 新增张力色标窗口
const RELEASE = 1.6;                  // 游离半径 / 长轴（小→张力局部化，不糊满脸）
const FUSIFORM = 0.5;                 // 短轴/长轴比（梭形细长度）
function tensionColor(t) {            // 低=中性肤色，高=偏红（顶点色与肤色相乘）
  const f = Math.max(0, Math.min(1, (t - EXC_LO) / (EXC_HI - EXC_LO)));
  return [1 + 0.6 * f, 1 - 0.85 * f, 1 - 0.88 * f];
}

const S = {                        // 全局状态
  verts: null, tris: null, atlas: null, atlasSub: null, dir: null, anchored: null, normalsRest: null,
  meanEdge: 1, head: null, lines: null, marker: null, raycaster: new THREE.Raycaster(),
  sb: null, colors: null, baseline: null, shortAxis: null, lesion: 0, simActive: false, linesDirty: true,
  cutType: null, lastScar: 0, settled: { along: null, across: null }, simFrames: 0,
  previewAlong: null, previewAcross: null, woundBed: null,
};

async function loadJSON(url) { return (await fetch(url)).json(); }

async function boot() {
  const [verts, tris, atlas] = await Promise.all([
    loadJSON(assetUrls.canonicalVertices), loadJSON(assetUrls.triangles), loadJSON(assetUrls.atlasRstl),
  ]);
  S.verts = verts; S.tris = tris; S.atlas = atlas;
  S.dir = rstlDirField(verts, tris, atlas);
  S.anchored = boundaryVerts(tris, verts.length);
  S.normalsRest = vertexNormals(verts, tris);

  let e = 0, n = 0;
  for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) { e += len(sub(verts[p], verts[q])); n++; }
  S.meanEdge = e / n;

  S.atlasSub = { lines: atlas.lines.filter((_, i) => i % 2 === 0) };   // 隔行抽稀，避免线条糊满脸

  S.head = new Head3D(els.canvas);
  S.colors = verts.map(() => [1, 1, 1]);
  rebuildMesh(tris);                // 初始：完整网格
  // RSTL 线 = 半透明青色导引层（与红色张力图对比），统一色不随顶点
  S.lines = new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x6fe9ff, transparent: true, opacity: 0.5, toneMapped: false }));
  S.lines.renderOrder = 3;
  S.head.group.add(S.lines);

  const mr = S.meanEdge * 0.45;
  S.marker = new THREE.Mesh(new THREE.SphereGeometry(mr, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff2b4e, toneMapped: false }));
  S.head.group.add(S.marker);

  // 切口预览：两条朝向的梭形轮廓（绿=沿 RSTL，红=逆 RSTL），随滑块/落点实时更新
  S.previewAlong = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x18c08a, toneMapped: false }));
  S.previewAcross = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf06a5e, toneMapped: false }));
  S.previewAlong.renderOrder = 5; S.previewAcross.renderOrder = 5;
  S.head.group.add(S.previewAlong); S.head.group.add(S.previewAcross);

  // 创面床：肿物正后方的暗红圆盘，切除后透过缺口看到的是创面而非黑色背景
  S.woundBed = new THREE.Mesh(new THREE.CircleGeometry(1, 28),
    new THREE.MeshBasicMaterial({ color: 0x7d2b24, side: THREE.DoubleSide, toneMapped: false }));
  S.woundBed.visible = false;
  S.head.group.add(S.woundBed);

  setLesion(defaultLesion());

  S.head.resetView();
  fitSize();
  refreshLines();
  els.hint.textContent = "已就绪：在脸上点击标记肿物，再选「沿 / 逆 RSTL 切除」。";
  loop();
}

// facesAlive：不含被移除顶点的三角形 → 渲染出"洞"。保存/恢复视角避免 setGeometry 重置缩放。
function rebuildMesh(faces) {
  const d = S.head ? S.head._dist : null;
  S.head.setGeometry(S.verts, faces, [], { showSurface: true, bands: false, vertexColors: S.colors });
  if (d != null) S.head._dist = d;
}

function aliveFaces() {
  if (!S.sb) return S.tris;
  return S.tris.filter((f) => !S.sb.removed[f[0]] && !S.sb.removed[f[1]] && !S.sb.removed[f[2]]);
}

function defaultLesion() {           // 右脸颊：质心 + 半个 x 跨度、略偏前
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const v of S.verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const target = [c[0] + 0.42 * (hi[0] - lo[0]), c[1], hi[2]];
  let best = 0, bd = 1e9;
  for (let i = 0; i < S.verts.length; i++) {
    if (S.anchored[i]) continue;
    const d = len(sub(S.verts[i], target));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function setLesion(i) {
  S.lesion = i;
  S.marker.position.set(S.verts[i][0], S.verts[i][1], S.verts[i][2]);
  updatePreview();
}

function lesionSizes() {
  const la = S.meanEdge * (Number(els.size.value) / 100) * 1.6;
  return { la, lb: la * FUSIFORM };
}

// 切平面内正交化：返回沿 longAxis 的长轴 u 与垂直的短轴 v
function tangentFrame(normal, longAxis) {
  const v = norm(cross(normal, longAxis));
  return { u: norm(cross(v, normal)), v };
}

function ellipsePositions(center, normal, longAxis, la, lb, N = 56) {
  const { u, v } = tangentFrame(normal, longAxis);
  const lift = S.meanEdge * 0.12;
  const p = [];
  for (let k = 0; k <= N; k++) {
    const t = (k / N) * Math.PI * 2, ca = Math.cos(t), sa = Math.sin(t);
    p.push(center[0] + la * ca * u[0] + lb * sa * v[0] + normal[0] * lift,
      center[1] + la * ca * u[1] + lb * sa * v[1] + normal[1] * lift,
      center[2] + la * ca * u[2] + lb * sa * v[2] + normal[2] * lift);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  return g;
}

// 切口预览：在落点画两条梭形轮廓（绿=沿 RSTL，红=逆 RSTL），切除后隐藏
function updatePreview() {
  const show = Boolean(S.head && !S.sb);
  S.previewAlong.visible = show; S.previewAcross.visible = show; S.marker.visible = show;
  if (!show) return;
  const i = S.lesion, n = S.normalsRest[i], c = S.verts[i];
  const { la, lb } = lesionSizes();
  S.previewAlong.geometry.dispose();
  S.previewAlong.geometry = ellipsePositions(c, n, S.dir[i], la, lb);
  S.previewAcross.geometry.dispose();
  S.previewAcross.geometry = ellipsePositions(c, n, norm(cross(n, S.dir[i])), la, lb);
}

// 沿 longAxis 做梭形切除并启动闭合沉降。longAxis 沿 RSTL → 短轴(闭合方向)=垂直 RSTL(软)→ 平和。
function setActiveCut(type) {       // 高亮当前切向按钮（选中反馈）
  els.along.classList.toggle("active", type === "along");
  els.across.classList.toggle("active", type === "across");
}

function doExcision(longAxisVec, cutType) {
  if (!S.dir) return;
  setActiveCut(cutType);
  S.simFrames = 0;
  const i = S.lesion;
  const longAxis = norm(longAxisVec);
  S.shortAxis = norm(cross(S.normalsRest[i], longAxis));
  S.cutType = cutType;
  S.sb = buildSoftBody(S.verts, S.tris, S.dir, { anchored: S.anchored });
  const { la, lb } = lesionSizes();
  const removed = excise(S.sb, S.verts, S.verts[i], longAxis, la, lb, la * RELEASE);
  S.baseline = vertexTension(S.sb, S.shortAxis);   // 静息基线（沉降前 pos=rest0）→ 之后扣除
  // 创面床：放到肿物正后方、朝向表面法线，透过缺口显暗红创面而非黑背景
  const n = S.normalsRest[i], c = S.verts[i];
  S.woundBed.position.set(c[0] - n[0] * S.meanEdge * 0.7, c[1] - n[1] * S.meanEdge * 0.7, c[2] - n[2] * S.meanEdge * 0.7);
  S.woundBed.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0], n[1], n[2]));
  S.woundBed.scale.setScalar(la * 1.15);
  S.woundBed.visible = true;
  updatePreview();                   // S.sb 已置 → 隐藏预览轮廓与标记
  rebuildMesh(aliveFaces());         // 显示缺口 + 重建带顶点色的网格
  S.simActive = true; S.linesDirty = true;
  els.hint.textContent = `${cutType === "along" ? "沿" : "逆"} RSTL 切除 ${removed} 个顶点，正在闭合…`;
}

function reset() {
  S.sb = null; S.simActive = false; S.shortAxis = null; S.cutType = null; S.baseline = null;
  setActiveCut(null);
  S.settled = { along: null, across: null };
  S.colors = S.verts.map(() => [1, 1, 1]);
  S.woundBed.visible = false;
  rebuildMesh(S.tris);
  setLesion(S.lesion);               // → updatePreview 重新显示预览轮廓
  S.linesDirty = true; refreshLines();
  els.tensionVal.textContent = "—"; els.tensionBar.style.width = "0%";
  els.verdict.textContent = "切一刀看看：顺皮纹更平和，逆皮纹更绷紧。";
  els.verdict.style.color = "";
  els.hint.textContent = "已复位（长回新皮肤）。";
}

// 沉降完成后定格：记录该切向的瘢痕张力，若两种切向都切过 → 直接对比给结论
function onSettled() {
  S.settled[S.cutType] = S.lastScar;
  const a = S.settled.along, b = S.settled.across;
  if (a != null && b != null) {
    els.verdict.innerHTML = `顺皮纹新增张力 <b>${Math.round(a)}</b> ｜ 逆皮纹 <b>${Math.round(b)}</b>（满分100）<br>${a < b ? "→ 顺皮纹更平和 ✅" : "→ 本处差异不明显，换个位置再试"}`;
    els.verdict.style.color = a < b ? "#34d399" : "#fbbf24";
    els.hint.textContent = "对比完成：换个位置（复位后点击）再试。";
  } else {
    els.hint.textContent = `${S.cutType === "along" ? "沿" : "逆"}皮纹闭合完成。再点另一种切向直接对比。`;
  }
}

// 闭合新增张力（当前 − 静息基线）上色 + 0–100 指数。指数取伤口区 top-3 峰值（最绷紧处），稳健可比。
function updateTensionAndColors() {
  const tens = vertexTension(S.sb, S.shortAxis);
  const { la } = lesionSizes();
  const rel = la * RELEASE;
  const wound = [];
  for (let i = 0; i < S.verts.length; i++) {
    if (S.sb.removed[i]) { S.colors[i] = [0.2, 0.2, 0.22]; continue; }
    const d = len(sub(S.verts[i], S.verts[S.lesion]));
    const mask = Math.max(0, Math.min(1, (rel * 1.9 - d) / (rel * 0.6)));  // 平滑限定在伤口区，远处归零→干净肤色
    const ex = Math.max(0, tens[i] - (S.baseline ? S.baseline[i] : 0)) * mask;
    S.colors[i] = tensionColor(ex);
    if (!S.anchored[i] && d < rel * 1.3) wound.push(ex);
  }
  wound.sort((a, b) => b - a);
  const top = wound.slice(0, 3);
  const peak = top.length ? top.reduce((s, x) => s + x, 0) / top.length : 0;
  S.lastScar = Math.max(0, Math.min(100, ((peak - EXC_LO) / (EXC_HI - EXC_LO)) * 100));
  els.tensionVal.textContent = Math.round(S.lastScar);
  els.tensionBar.style.width = S.lastScar.toFixed(0) + "%";
}

// RSTL 线随皮肤形变（用当前位置 + 法向重建）
function refreshLines() {
  if (!S.lines) return;
  S.lines.visible = els.showLines.checked;
  if (!S.lines.visible) return;
  const pos = S.sb ? S.sb.pos : S.verts;
  const normals = S.sb ? vertexNormals(pos, S.tris) : S.normalsRest;
  const old = S.lines.geometry;
  S.lines.geometry = buildLineGeometry(S.atlasSub.lines, pos, S.tris, normals, false);
  old.dispose();
}

function loop() {
  if (S.simActive) {
    let maxV = 0;
    stepSoftBody(S.sb, 3);
    S.simFrames++;
    for (let i = 0; i < S.sb.N; i++) if (!S.sb.anchored[i] && !S.sb.removed[i]) maxV = Math.max(maxV, len(S.sb.vel[i]));
    updateTensionAndColors();
    S.head.updateVerts(S.sb.pos, S.colors);
    refreshLines();
    if (maxV < S.meanEdge * 2e-4 || S.simFrames > 900) { S.simActive = false; onSettled(); }  // 收敛或兜底定格
  }
  S.head.render();
  requestAnimationFrame(loop);
}

// ── 交互：拖拽旋转 / 滚轮缩放 / 点击拾取肿物 ──────────────────────────────────
let drag = null;
els.canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; els.canvas.setPointerCapture(e.pointerId); });
els.canvas.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  S.head.setRotation(Math.max(-1.2, Math.min(1.2, S.head.rotX + dy * 0.01)), S.head.rotY + dx * 0.01);
  drag.x = e.clientX; drag.y = e.clientY;
});
els.canvas.addEventListener("pointerup", (e) => {
  if (drag && drag.moved < 6) pick(e);          // 几乎没动 = 点击拾取
  drag = null;
});
els.canvas.addEventListener("wheel", (e) => { e.preventDefault(); S.head.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });

function pick(e) {
  if (!S.head || S.sb) return;                    // 未加载完 / 切除后先复位再重新标记
  const r = els.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  S.head.camera.updateMatrixWorld(true);
  S.head.scene.updateMatrixWorld(true);
  S.raycaster.setFromCamera(ndc, S.head.camera);
  const hit = S.raycaster.intersectObject(S.head.mesh, false)[0];
  if (!hit || !hit.face) return;
  const local = S.head.group.worldToLocal(hit.point.clone());
  const lp = [local.x, local.y, local.z];
  let best = hit.face.a, bd = 1e9;
  for (const vi of [hit.face.a, hit.face.b, hit.face.c]) {
    const d = len(sub(S.verts[vi], lp));
    if (d < bd && !S.anchored[vi]) { bd = d; best = vi; }
  }
  setLesion(best);
  els.lesionState.textContent = `顶点 #${best}`;
}

function fitSize() {
  const w = els.wrap.clientWidth || 800, h = els.wrap.clientHeight || 600;
  S.head.resize(w, h);
}
new ResizeObserver(fitSize).observe(els.wrap);

els.along.onclick = () => doExcision(S.dir[S.lesion], "along");                                  // 长轴沿 RSTL
els.across.onclick = () => doExcision(norm(cross(S.normalsRest[S.lesion], S.dir[S.lesion])), "across"); // 长轴逆 RSTL
els.reset.onclick = reset;
els.showLines.onchange = () => { S.linesDirty = true; refreshLines(); };
els.size.oninput = () => { els.sizeVal.textContent = `${els.size.value}%`; if (!S.sb) updatePreview(); };

boot().catch((err) => { els.hint.textContent = "加载失败：" + err.message; console.error(err); });
