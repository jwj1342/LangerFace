// 网页 3D 标注入口：加载网格 → 在表面点击落点成线 → 导出图谱/xyz。
// 拖拽旋转、滚轮缩放；点击（非拖拽）在网格表面拾取一个控制点。
import { AnnotationModel } from "./annotate_model.js";
import { Annotator3D } from "./annotate_viewer.js";
import { assetUrls } from "./assets.js";

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"), system: $("annSystem"), name: $("annName"), region: $("annRegion"),
  btnNew: $("btnNew"), btnUndo: $("btnUndo"), btnFinish: $("btnFinish"), btnClear: $("btnClear"),
  exAtlas: $("btnExportAtlas"), exXyz: $("btnExportXyz"),
  loadCanonical: $("btnLoadCanonical"), meshFile: $("meshFile"),
  list: $("lineList"), status: $("annStatus"), hint: $("hint"),
};

const viewer = new Annotator3D(els.stage);
const model = new AnnotationModel(els.system.value);
viewer.setAnnotation(model);
let onCanonical = false;   // 是否在标准脸拓扑上标注（决定能否导出图谱）

// ── 网格加载 ──────────────────────────────────────────────────────────────────
async function loadCanonical() {
  setHint("加载标准脸…");
  const [verts, tris] = await Promise.all([
    fetchJSON(assetUrls.canonicalVertices, "标准脸顶点"),
    fetchJSON(assetUrls.triangles, "标准脸三角拓扑"),
  ]);
  viewer.setMesh(verts, tris, { showSurface: true });
  onCanonical = true;
  setHint("在脸上点击落点；拖拽旋转、滚轮缩放。导出可得图谱(tri,u,v)。");
  refresh();
}

async function fetchJSON(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}加载失败：HTTP ${res.status}`);
  return res.json();
}

async function loadMeshFile(file) {
  if (!file) return;
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data.vertices) || !Array.isArray(data.triangles)) {
    setHint("网格 JSON 需含 {vertices:[[x,y,z]...], triangles:[[a,b,c]...]}");
    return;
  }
  viewer.setMesh(data.vertices, data.triangles, { showSurface: true });
  onCanonical = false;
  setHint("已载入自定义头模。导出为 xyz 折线（非标准脸拓扑，无法导出图谱）。");
  refresh();
}

// ── 指针交互：拖拽旋转 vs 点击落点 ────────────────────────────────────────────
let drag = null;
els.stage.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
  els.stage.setPointerCapture(e.pointerId);
});
els.stage.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
  if (drag.moved) { viewer.orbit(dx, dy); drag.x = e.clientX; drag.y = e.clientY; }
});
els.stage.addEventListener("pointerup", (e) => {
  if (drag && !drag.moved) addPointAt(e);
  drag = null;
});
els.stage.addEventListener("wheel", (e) => { e.preventDefault(); viewer.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });

function addPointAt(e) {
  const r = els.stage.getBoundingClientRect();
  const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  const hit = viewer.raycast(ndcX, ndcY);
  if (!hit) return;
  if (!onCanonical) { hit.tri = null; hit.bary = null; }   // 自定义头模：只存 xyz
  model.addPoint(hit);
  viewer.rebuildLines();
  refresh();
}

// ── 按钮 ──────────────────────────────────────────────────────────────────────
els.system.onchange = () => { model.system = els.system.value; };
els.btnNew.onclick = () => { model.startLine({ name: els.name.value.trim(), region: els.region.value.trim() }); refresh(); };
els.btnUndo.onclick = () => { model.undoPoint(); viewer.rebuildLines(); refresh(); };
els.btnFinish.onclick = () => { model.finishLine(); viewer.rebuildLines(); els.name.value = ""; refresh(); };
els.btnClear.onclick = () => { if (confirm("清空所有线？")) { model.clear(); viewer.rebuildLines(); refresh(); } };
els.exAtlas.onclick = () => exportJSON(() => model.toAtlasJSON(), `atlas_${model.system}_annotated.json`);
els.exXyz.onclick = () => exportJSON(() => model.toXyzJSON(), `lines_${model.system}_xyz.json`);
els.loadCanonical.onclick = loadCanonical;
els.meshFile.onchange = (e) => loadMeshFile(e.target.files[0]);

function exportJSON(build, filename) {
  let data;
  try { data = build(); } catch (err) { setHint("导出失败：" + err.message); return; }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setHint(`已导出 ${filename}`);
}

// ── UI 刷新 ───────────────────────────────────────────────────────────────────
function setHint(t) { els.hint.textContent = t; }
function refresh() {
  const cur = model.current ? `（绘制中：${model.current.points.length} 点）` : "";
  els.status.textContent = `已完成 ${model.lines.length} 条线${cur}`;
  els.exAtlas.disabled = !(model.lines.length && onCanonical);
  els.exXyz.disabled = !model.lines.length;
  els.list.innerHTML = "";
  model.lines.forEach((ln, i) => {
    const row = document.createElement("div");
    row.className = "line-row";
    row.innerHTML = `<span>${ln.name}${ln.region ? " · " + ln.region : ""} <em>(${ln.points.length})</em></span>`;
    const del = document.createElement("button");
    del.textContent = "✕"; del.className = "del";
    del.onclick = () => { model.deleteLine(i); viewer.rebuildLines(); refresh(); };
    row.appendChild(del);
    els.list.appendChild(row);
  });
}

// ── 渲染循环 + 自适应 ─────────────────────────────────────────────────────────
function tick() {
  const r = els.stage.parentElement.getBoundingClientRect();
  viewer.resize(Math.max(2, r.width | 0), Math.max(2, r.height | 0));
  viewer.render();
  requestAnimationFrame(tick);
}

refresh();
setHint("点「加载标准脸」开始，或上传头模 JSON。");
loadCanonical().catch((e) => setHint("标准脸加载失败：" + e.message));
requestAnimationFrame(tick);
