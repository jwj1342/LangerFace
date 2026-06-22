// 网页 3D 标注入口：加载网格 → 在表面点击落点成线 → 导出图谱/xyz。
// 拖拽旋转、滚轮缩放；点击（非拖拽）在网格表面拾取一个控制点。
import { AnnotationModel } from "./annotate_model.js";
import { Annotator3D } from "./annotate_viewer.js";
import { assetUrls } from "./assets.js";
import { dataSource } from "./data_source.js";

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"), system: $("annSystem"), name: $("annName"), region: $("annRegion"),
  btnNew: $("btnNew"), btnUndo: $("btnUndo"), btnFinish: $("btnFinish"), btnClear: $("btnClear"),
  exAtlas: $("btnExportAtlas"), exXyz: $("btnExportXyz"), setActive: $("btnSetActiveAtlas"),
  loadCanonical: $("btnLoadCanonical"), meshFile: $("meshFile"),
  list: $("lineList"), status: $("annStatus"), hint: $("hint"),
  current: $("currentState"), drawMode: $("drawMode"),
};

const viewer = new Annotator3D(els.stage);
const model = new AnnotationModel(els.system.value);
viewer.setAnnotation(model);
let onCanonical = false;   // 是否在标准脸拓扑上标注（决定能否导出图谱）

const SYSTEM_LABELS = { rstl: "RSTL", langer: "Langer" };

// ── 网格加载 ──────────────────────────────────────────────────────────────────
async function loadCanonical() {
  setHint("加载标准脸…");
  const [verts, tris] = await Promise.all([
    fetchJSON(assetUrls.canonicalVertices, "标准脸顶点"),
    fetchJSON(assetUrls.triangles, "标准脸三角拓扑"),
  ]);
  viewer.setMesh(verts, tris, { showSurface: true });
  onCanonical = true;
  els.drawMode.textContent = "标准脸图谱";
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
  els.drawMode.textContent = "自定义头模";
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
  if (!model.current) startLineFromInputs();
  hit.exportable = onCanonical;   // 自定义头模仍用 tri/bary 贴面连线，但不能导出项目图谱
  model.addPoint(hit);
  viewer.rebuildLines();
  refresh();
}

// ── 按钮 ──────────────────────────────────────────────────────────────────────
els.system.onchange = () => { model.system = els.system.value; refresh(); };
els.btnNew.onclick = startLineFromInputs;
els.btnUndo.onclick = undoLast;
els.btnFinish.onclick = saveCurrentLine;
els.btnClear.onclick = () => { if (confirm("清空所有线？")) { model.clear(); viewer.rebuildLines(); refresh(); } };
els.exAtlas.onclick = () => exportJSON(() => model.toAtlasJSON(), `atlas_${model.system}_annotated.json`);
els.exXyz.onclick = () => exportJSON(() => model.toXyzJSON(), `lines_${model.system}_xyz.json`);
els.setActive.onclick = previewActiveAtlas;
els.loadCanonical.onclick = loadCanonical;
els.meshFile.onchange = (e) => loadMeshFile(e.target.files[0]);

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
  if (isTextControl(e.target)) return;
  e.preventDefault();
  undoLast();
});

function lineDraft() {
  const next = model.lines.length + 1;
  return {
    name: els.name.value.trim() || `${model.system}_${String(next).padStart(2, "0")}`,
    region: els.region.value.trim(),
  };
}

function startLineFromInputs() {
  if (model.current) {
    setHint("当前线正在绘制；请先保存当前线，或撤销点后继续。");
    return false;
  }
  const draft = lineDraft();
  model.startLine(draft);
  syncInputsFromLine(model.current);
  viewer.rebuildLines();
  setHint(`正在绘制 ${draft.name}：在 3D 脸表面点击添加点，至少 2 个点后保存。`);
  refresh();
  return true;
}

function saveCurrentLine() {
  if (!model.current) {
    setHint("请先点击“开始一条线”，或直接在脸表面点击开始。");
    return;
  }
  const controlCount = controlsOf(model.current).length;
  if (controlCount < 2) {
    setHint("当前线至少需要 2 个点才能保存。");
    return;
  }
  const saved = model.finishLine();
  viewer.rebuildLines();
  els.name.value = "";
  setHint(`已保存 ${saved.name}。继续填写下一条线并点击“开始一条线”。`);
  refresh();
}

function undoLast() {
  if (model.current && controlsOf(model.current).length) {
    model.undoPoint();
    setHint(`已撤销当前线的上一个点，剩余 ${controlsOf(model.current).length} 个控制点。`);
  } else if (model.current) {
    model.cancelLine();
    setHint("已取消当前空线。");
  } else if (model.lines.length) {
    model.current = model.lines.pop();
    syncInputsFromLine(model.current);
    setHint(`已恢复 ${model.current.name}，可继续编辑或重新保存。`);
  } else {
    setHint("没有可撤销的标注。");
  }
  viewer.rebuildLines();
  refresh();
}

function restoreLine(i) {
  if (model.current && model.current.points.length) {
    setHint("请先保存或撤销当前线，再编辑已保存线。");
    return;
  }
  if (model.current) model.cancelLine();
  const [line] = model.lines.splice(i, 1);
  if (!line) return;
  model.current = line;
  syncInputsFromLine(line);
  viewer.rebuildLines();
  setHint(`正在编辑 ${line.name}。修改后点击“保存当前线”。`);
  refresh();
}

function syncInputsFromLine(line) {
  els.name.value = line?.name || "";
  els.region.value = line?.region || "";
}

function isTextControl(el) {
  return el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function controlsOf(line) {
  return line ? (line.controls || line.points || []) : [];
}

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

function previewActiveAtlas() {
  let atlas;
  try {
    atlas = model.toAtlasJSON({ provenance: "web-annotator-live" });
  } catch (err) {
    setHint("预览失败：" + err.message);
    return;
  }
  if (!dataSource.stagePreviewAtlas(atlas)) {
    setHint("预览失败：浏览器无法暂存图谱。请检查站点存储权限。");
    return;
  }
  location.href = "index.html";
}

// ── UI 刷新 ───────────────────────────────────────────────────────────────────
function setHint(t) { els.hint.textContent = t; }
function refresh() {
  const curPts = controlsOf(model.current).length;
  els.status.textContent = `${model.lines.length} 条`;
  els.current.classList.toggle("active", Boolean(model.current));
  els.current.textContent = model.current
    ? `正在绘制：${model.current.name} · ${SYSTEM_LABELS[model.system]} · ${curPts} 点${curPts < 2 ? "（至少 2 点可保存）" : ""}`
    : "当前没有正在绘制的线。点击“开始一条线”，或直接在脸表面点击开始。";
  els.btnNew.disabled = Boolean(model.current);
  els.btnFinish.disabled = !model.current;
  els.btnUndo.disabled = !(model.current || model.lines.length);
  els.exAtlas.disabled = !(model.lines.length && onCanonical);
  els.setActive.disabled = !(model.lines.length && onCanonical);
  els.exXyz.disabled = !model.lines.length;
  els.list.innerHTML = "";
  if (!model.lines.length) {
    const empty = document.createElement("div");
    empty.className = "line-empty";
    empty.textContent = "还没有保存的线。";
    els.list.appendChild(empty);
  }
  model.lines.forEach((ln, i) => {
    const row = document.createElement("div");
    row.className = "line-row";
    const main = document.createElement("div");
    main.className = "line-main";
    const title = document.createElement("strong");
    title.textContent = `${i + 1}. ${ln.name}`;
    const meta = document.createElement("span");
    meta.className = "line-meta";
    meta.textContent = `${SYSTEM_LABELS[model.system]}${ln.region ? " · " + ln.region : ""} · ${controlsOf(ln).length} 控制点 · ${ln.points.length} 路径点`;
    main.appendChild(title);
    main.appendChild(meta);
    const actions = document.createElement("div");
    actions.className = "line-actions";
    const edit = document.createElement("button");
    edit.textContent = "编辑"; edit.className = "mini";
    edit.onclick = () => restoreLine(i);
    const del = document.createElement("button");
    del.textContent = "删除"; del.className = "mini del";
    del.onclick = () => { model.deleteLine(i); viewer.rebuildLines(); refresh(); };
    actions.appendChild(edit);
    actions.appendChild(del);
    row.appendChild(main);
    row.appendChild(actions);
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
