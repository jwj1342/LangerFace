// 网页 3D 标注入口：加载网格 → 在表面点击落点成线 → 导出图谱/xyz。
// 拖拽旋转、滚轮缩放；点击（非拖拽）在网格表面拾取一个控制点。
import { Annotator3D } from "./annotateViewer.ts";
import {
  ANNOTATE_CONTROLLER_STATE_EVENT,
  ANNOTATE_DRAW_REACT_COMMAND_EVENT,
  ANNOTATE_LIBRARY_REACT_COMMAND_EVENT,
  ANNOTATE_MESH_REACT_COMMAND_EVENT,
} from "../lib/controllerEvents";
import {
  bindWindowControllerEvents,
  dispatchControllerEvent,
} from "../lib/controllerCommand";
import { AnnotationModel, type AnnotationLine, type AnnotationPoint } from "./annotationModel";
import type { Triangle, Vec3 } from "./softBody";
import { isReactManagedWorkbench } from "../lib/reactManagedWorkbench";
import {
  annotateFileFromEvent,
  collectAnnotateElements,
  isAnnotateTextControl,
  type AnnotateDomElements,
} from "./annotateDom";
import {
  buildAnnotationExport,
  downloadAnnotationExport,
  type AnnotationExportKind,
} from "./annotationExport";
import {
  ANNOTATE_SYSTEM_LABELS as SYSTEM_LABELS,
  buildAnnotateControllerSnapshot,
  controlsOf,
} from "./annotateSnapshots";
import { assetUrls } from "./assetLoader";
import { dataSource } from "./dataSource";
import { facesArray, flameForward, loadFlameBasis, type FlameBasis } from "./flameFit";
import { parseMeshFile } from "./meshIo";
import { parseSlicerCurveFile } from "./slicerCurve";
import { topologyMeta } from "./topologyRegistry";
import {
  createAnnotationSessionGuard,
  type AnnotationSessionToken,
} from "./annotationSession";
import {
  readAnnotateDrawCommand,
  readAnnotateLibraryCommand,
  readAnnotateMeshCommand,
} from "./workbenchCommandSchemas";

interface DragState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
  axis: "yaw" | "pitch" | "free" | null;
}

interface FlameMesh {
  verts: Vec3[];
  tris: Triangle[];
}

interface MeshTopologyPayload {
  topologyId?: string;
  topologyVersion?: string;
  triangles: Triangle[];
  vertexCount?: number;
}


type AnnotationModelInstance = InstanceType<typeof AnnotationModel>;
type Annotator3DInstance = InstanceType<typeof Annotator3D>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let els = {} as AnnotateDomElements;
let viewer = null as unknown as Annotator3DInstance;
let model = null as unknown as AnnotationModelInstance;
let onCanonical = false;   // 是否在标准脸拓扑上标注（决定能否导出图谱）
let frameId = 0;
let abortController: AbortController | null = null;
const activeSession = createAnnotationSessionGuard();

let bundledFlameBasis: FlameBasis | null = null;

function isAnnotationPoint(point: AnnotationPoint | null): point is AnnotationPoint {
  return point !== null;
}

function publishAnnotateState(reason = "state_update"): void {
  if (!activeSession.isMounted() || typeof window === "undefined" || !els?.hint) return;
  dispatchControllerEvent(ANNOTATE_CONTROLLER_STATE_EVENT, buildAnnotateControllerSnapshot({
    reason,
    hint: els.hint?.textContent || "",
    system: model?.system || els.system?.value || "rstl",
    model,
    meshLoaded: Boolean(viewer?.hasMesh?.()),
    modeLabel: els.drawMode?.textContent || "",
    onCanonical: Boolean(onCanonical),
    canLoadFlame: flameAvailable(),
    canLoadFittedFlame: fittedFlameAvailable(),
  }));
}

async function loadBundledFlameStandard(): Promise<FlameMesh> {
  if (!bundledFlameBasis) bundledFlameBasis = await loadFlameBasis(assetUrls.flameBasis);
  const verts = flameForward(
    bundledFlameBasis,
    new Float64Array(bundledFlameBasis.NS),
    new Float64Array(bundledFlameBasis.NE),
    0,
  );
  return { verts, tris: facesArray(bundledFlameBasis) };
}

// ── 网格加载 ──────────────────────────────────────────────────────────────────
async function loadCanonical(): Promise<void> {
  const session = activeSession.current();
  if (session === null) return;
  setHint("加载标准三维面部模型…");
  let mesh: FlameMesh;
  try {
    mesh = await loadBundledFlameStandard();
  } catch (err) {
    if (!isActiveSession(session)) return;
    setHint("标准三维面部模型加载失败，回退到基础标准脸：" + errorMessage(err));
    const head = await dataSource.getHeadMesh("mediapipe-468");
    if (!isActiveSession(session)) return;
    model.setTopology(head.topology);
    viewer.setMesh(head.vertices, head.triangles, { showSurface: true });
    onCanonical = true;
    els.drawMode.textContent = "基础标准图谱";
    setHint("已回退到基础标准脸；可导出待复核图谱草案。");
    refresh();
    return;
  }
  if (!isActiveSession(session)) return;
  const meta = topologyMeta("flame-2023");
  if (!meta) throw new Error("缺少 FLAME 拓扑登记");
  model.setTopology({ topologyId: meta.id, topologyVersion: meta.version });
  viewer.setMesh(mesh.verts, mesh.tris, { showSurface: true });
  onCanonical = true;
  els.drawMode.textContent = "高精度标准图谱";
  setHint(`在标准三维面部模型上点击落点（${mesh.verts.length} 个采样点）；导出可得待复核图谱草案。`);
  refresh();
}

// FLAME 资产为 dev-local（gitignore）：用 import.meta.glob 在构建期按存在与否解析，
// 缺失（CI / 生产构建）时 glob 为空 → FLAME 入口自动隐藏，绝不影响构建。
const FLAME_URLS = import.meta.glob(
  "../../assets/{topology_flame_2023,flame_neutral_vertices,flame_fitted_vertices}.json",
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;
const flameUrl = (name: string) => FLAME_URLS[`../../assets/${name}.json`] || null;
const flameAvailable = () =>
  Boolean(flameUrl("topology_flame_2023") && flameUrl("flame_neutral_vertices"));
// 个体（拟合后）FLAME 头：tools/fit_flame_to_landmarks.py 离线产出 flame_fitted_vertices.json。
const fittedFlameAvailable = () =>
  Boolean(flameUrl("topology_flame_2023") && flameUrl("flame_fitted_vertices"));

async function loadFlameMesh(vertsName: string, label: string): Promise<void> {
  const session = activeSession.current();
  if (session === null) return;
  const vurl = flameUrl(vertsName);
  const turl = flameUrl("topology_flame_2023");
  if (!vurl || !turl) {
    setHint("FLAME 资产未生成（dev-local）。本地放好 assets/flame/flame2023_Open.pkl 后运行 tools/export_flame_topology.py（个体网格再跑 fit_flame_to_landmarks.py）。");
    return;
  }
  setHint(`加载 ${label}…`);
  const [verts, topology] = await Promise.all([
    fetchJSON<Vec3[]>(vurl, label),
    fetchJSON<MeshTopologyPayload>(turl, "FLAME 拓扑"),
  ]);
  if (!isActiveSession(session)) return;
  const meta = topologyMeta("flame-2023");
  if (!meta) throw new Error("缺少 FLAME 拓扑登记");
  model.setTopology({ topologyId: meta.id, topologyVersion: meta.version });
  viewer.setMesh(verts, topology.triangles, { showSurface: true });
  onCanonical = true;
  els.drawMode.textContent = label;
  setHint(`在 ${label} 上点击落点（${topology.vertexCount} 顶点）；导出得 flame-2023 图谱(tri,u,v)。`);
  refresh();
}
const loadFlame = () => loadFlameMesh("flame_neutral_vertices", topologyMeta("flame-2023")?.label ?? "高精度三维头模");
const loadFittedFlame = () => loadFlameMesh("flame_fitted_vertices", "FLAME 个体（拟合）");

function handleReactMeshCommand(event: Event): void {
  const detail = readAnnotateMeshCommand(event);
  if (!detail) return;
  const { command } = detail;
  if (command === "load_canonical") loadCanonical();
  if (command === "load_flame") loadFlame();
  if (command === "load_fitted_flame") loadFittedFlame();
}

async function fetchJSON<T = unknown>(url: string, label: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}加载失败：HTTP ${res.status}`);
  return res.json();
}

async function loadMeshFile(file?: File): Promise<void> {
  if (!file) return;
  const session = activeSession.current();
  if (session === null) return;
  setHint(`正在读取 ${file.name} ...`);
  let mesh: Awaited<ReturnType<typeof parseMeshFile>>;
  try {
    mesh = await parseMeshFile(file);
  } catch (err) {
    setHint("头模加载失败：" + errorMessage(err));
    return;
  }
  if (!isActiveSession(session)) return;
  viewer.setMesh(mesh.vertices, mesh.triangles, { showSurface: true, colors: mesh.colors });
  onCanonical = false;
  els.drawMode.textContent = "自定义头模";
  setHint(`已载入 ${file.name}：${mesh.vertices.length} 顶点 / ${mesh.triangles.length} 三角面。导出为 xyz 折线。`);
  refresh();
}

async function loadSlicerFile(file?: File): Promise<void> {
  if (!file) return;
  const session = activeSession.current();
  if (session === null) return;
  if (!viewer.hasMesh()) {
    setHint("请先加载标准脸或上传头模，再导入 Slicer 曲线。");
    return;
  }
  const spacing = Number(els.resampleSpacing.value) || 2;
  setHint(`正在导入 ${file.name} 并按 ${spacing} 重采样 ...`);
  let curves: Awaited<ReturnType<typeof parseSlicerCurveFile>>;
  try {
    curves = await parseSlicerCurveFile(file, { spacing });
  } catch (err) {
    setHint("Slicer 曲线导入失败：" + errorMessage(err));
    return;
  }
  if (!isActiveSession(session)) return;
  let imported = 0, points = 0;
  for (const curve of curves) {
    const snapped = curve.points.map((p) => viewer.snapToSurface(p)).filter(isAnnotationPoint);
    if (snapped.length < 2) continue;
    for (const pt of snapped) pt.exportable = onCanonical;
    model.addLine({ name: curve.name, region: curve.region, controls: snapped });
    imported += 1;
    points += snapped.length;
  }
  viewer.rebuildLines();
  setHint(`已导入 ${imported} 条 Slicer 曲线，生成 ${points} 个表面采样点。`);
  refresh();
}

// ── 指针交互：拖拽旋转 vs 点击落点 ────────────────────────────────────────────
let drag: DragState | null = null;
function bindAnnotateEvents(): void {
  const signal = abortController?.signal;
  if (!signal) return;
  els.stage.addEventListener("pointerdown", (e: PointerEvent) => {
  drag = {
    x: e.clientX, y: e.clientY,
    startX: e.clientX, startY: e.clientY,
    moved: false, axis: null,
  };
  els.stage.setPointerCapture(e.pointerId);
  }, { signal });
  els.stage.addEventListener("pointermove", (e: PointerEvent) => {
  if (!drag) return;
  let dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  const totalDx = e.clientX - drag.startX, totalDy = e.clientY - drag.startY;
  if (!drag.moved && Math.hypot(totalDx, totalDy) > 4) drag.moved = true;
  if (!drag.axis && drag.moved && Math.hypot(totalDx, totalDy) > 10) {
    drag.axis = Math.abs(totalDx) >= Math.abs(totalDy) * 1.25 ? "yaw"
      : Math.abs(totalDy) >= Math.abs(totalDx) * 1.25 ? "pitch"
      : "free";
  }
  if (drag.axis === "yaw") dy = 0;
  if (drag.axis === "pitch") dx = 0;
  if (drag.moved) { viewer.orbit(dx, dy); drag.x = e.clientX; drag.y = e.clientY; }
  }, { signal });
  els.stage.addEventListener("pointerup", (e: PointerEvent) => {
  if (drag && !drag.moved) addPointAt(e);
  drag = null;
  }, { signal });
  els.stage.addEventListener("wheel", (e: WheelEvent) => {
  e.preventDefault();
  const delta = Math.max(-180, Math.min(180, e.deltaY || 0));
  viewer.zoom(Math.exp(delta * 0.00055));
  }, { passive: false, signal });

  if (isReactManagedWorkbench()) {
    bindWindowControllerEvents([
      [ANNOTATE_MESH_REACT_COMMAND_EVENT, handleReactMeshCommand],
      [ANNOTATE_DRAW_REACT_COMMAND_EVENT, handleReactDrawCommand],
      [ANNOTATE_LIBRARY_REACT_COMMAND_EVENT, handleReactLineLibraryCommand],
    ], { signal });
  } else {
    els.system.addEventListener("change", () => { model.system = els.system.value; refresh(); }, { signal });
    els.btnNew.addEventListener("click", startLineFromInputs, { signal });
    els.btnUndo.addEventListener("click", undoLast, { signal });
    els.btnFinish.addEventListener("click", saveCurrentLine, { signal });
    els.btnClear.addEventListener("click", () => { if (confirm("清空所有线？")) clearLines(); }, { signal });
    els.exAtlas.addEventListener("click", () => exportAnnotation("atlas"), { signal });
    els.exXyz.addEventListener("click", () => exportAnnotation("xyz"), { signal });
    els.setActive.addEventListener("click", previewActiveAtlas, { signal });
    els.loadCanonical.addEventListener("click", loadCanonical, { signal });
    els.loadFlame.addEventListener("click", loadFlame, { signal });
    els.loadFittedFlame.addEventListener("click", loadFittedFlame, { signal });
  }
  els.meshFile.addEventListener("change", (e) => loadMeshFile(annotateFileFromEvent(e)), { signal });
  els.slicerFile.addEventListener("change", (e) => loadSlicerFile(annotateFileFromEvent(e)), { signal });

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
    if (isAnnotateTextControl(e.target)) return;
    e.preventDefault();
    undoLast();
  }, { signal });
}

function addPointAt(e: PointerEvent): void {
  const r = els.stage.getBoundingClientRect();
  const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  const hit = viewer.raycast(ndcX, ndcY);
  if (!hit) return;
  if (!model.current) startLineFromInputs();
  hit.exportable = onCanonical;   // 自定义头模仍用 tri/bary 贴面连线，但不能导出项目图谱
  const { fallback } = model.addPoint(hit);
  viewer.rebuildLines();
  refresh();
  if (fallback) setHint("两点不在同一连通网格上，已退回直线连接，可能穿面");
}

function lineDraft(): { name: string; region: string } {
  const next = model.lines.length + 1;
  return {
    name: els.name.value.trim() || `${model.system}_${String(next).padStart(2, "0")}`,
    region: els.region.value.trim(),
  };
}

function startLineFromInputs(): boolean {
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

function handleReactDrawCommand(event: Event): void {
  const detail = readAnnotateDrawCommand(event);
  if (!detail) return;
  const { command, value } = detail;
  if (command === "system_changed") {
    model.system = value === "langer" ? "langer" : "rstl";
    refresh();
    return;
  }
  if (command === "start_line") startLineFromInputs();
  if (command === "undo_last") undoLast();
  if (command === "save_current_line") saveCurrentLine();
}

function saveCurrentLine(): void {
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
  setHint(`已保存 ${saved?.name || "当前线"}。继续填写下一条线并点击“开始一条线”。`);
  refresh();
}

function undoLast(): void {
  if (model.current && controlsOf(model.current).length) {
    model.undoPoint();
    setHint(`已撤销当前线的上一个点，剩余 ${controlsOf(model.current).length} 个控制点。`);
  } else if (model.current) {
    model.cancelLine();
    setHint("已取消当前空线。");
  } else if (model.lines.length) {
    model.current = model.lines.pop() ?? null;
    syncInputsFromLine(model.current);
    setHint(`已恢复 ${model.current?.name || "上一条线"}，可继续编辑或重新保存。`);
  } else {
    setHint("没有可撤销的标注。");
  }
  viewer.rebuildLines();
  refresh();
}

function restoreLine(i: number): void {
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

function clearLines(): void {
  model.clear();
  viewer.rebuildLines();
  refresh();
}

function deleteLine(i: number): void {
  model.deleteLine(i);
  viewer.rebuildLines();
  refresh();
}

function handleReactLineLibraryCommand(event: Event): void {
  const detail = readAnnotateLibraryCommand(event);
  if (!detail) return;
  const { command, index } = detail;
  if (command === "clear_lines") {
    clearLines();
    return;
  }
  if (command === "export_atlas") {
    exportAnnotation("atlas");
    return;
  }
  if (command === "export_xyz") {
    exportAnnotation("xyz");
    return;
  }
  if (command === "set_active_atlas") {
    previewActiveAtlas();
    return;
  }
  const lineIndex = Number(index);
  if (!Number.isInteger(lineIndex)) return;
  if (command === "restore_line") restoreLine(lineIndex);
  if (command === "delete_line") deleteLine(lineIndex);
}

function syncInputsFromLine(line?: AnnotationLine | null): void {
  els.name.value = line?.name || "";
  els.region.value = line?.region || "";
}

function exportAnnotation(kind: AnnotationExportKind): void {
  try {
    const artifact = buildAnnotationExport(model, kind);
    downloadAnnotationExport(artifact);
    setHint(`已导出 ${artifact.filename}`);
  } catch (err) {
    setHint("导出失败：" + errorMessage(err));
  }
}

function previewActiveAtlas(): void {
  let atlas;
  try {
    atlas = model.toAtlasJSON({ provenance: "web-annotator-live" });
  } catch (err) {
    setHint("预览失败：" + errorMessage(err));
    return;
  }
  if (!dataSource.stagePreviewAtlas(atlas as unknown as Parameters<typeof dataSource.stagePreviewAtlas>[0])) {
    setHint("预览失败：浏览器无法暂存图谱。请检查站点存储权限。");
    return;
  }
  location.href = isReactManagedWorkbench() ? "/app/live" : "index.html";
}

// ── UI 刷新 ───────────────────────────────────────────────────────────────────
function setHint(t: string): void {
  if (els?.hint) {
    els.hint.textContent = t;
    publishAnnotateState("hint");
  }
}

function renderLegacyLineList(): void {
  els.list.innerHTML = "";
  if (!model.lines.length) {
    const empty = document.createElement("div");
    empty.className = "line-empty";
    empty.textContent = "还没有保存的线。";
    els.list.appendChild(empty);
  }
  model.lines.forEach((ln: AnnotationLine, i: number) => {
    const row = document.createElement("div");
    row.className = "line-row";
    row.classList.toggle("has-warning", Boolean(ln.fallback));
    const main = document.createElement("div");
    main.className = "line-main";
    const title = document.createElement("strong");
    title.textContent = `${i + 1}. ${ln.name}`;
    const meta = document.createElement("span");
    meta.className = "line-meta";
    meta.textContent = `${SYSTEM_LABELS[model.system]}${ln.region ? " · " + ln.region : ""} · ${controlsOf(ln).length} 控制点 · ${ln.points.length} 路径点${ln.fallback ? " · 贴面 fallback" : ""}`;
    main.appendChild(title);
    main.appendChild(meta);
    if (ln.fallback) {
      const warning = document.createElement("span");
      warning.className = "line-warning";
      warning.textContent = "需复核：该线存在退回直线连接，可能穿面";
      main.appendChild(warning);
    }
    const actions = document.createElement("div");
    actions.className = "line-actions";
    const edit = document.createElement("button");
    edit.textContent = "编辑"; edit.className = "mini";
    edit.onclick = () => restoreLine(i);
    const del = document.createElement("button");
    del.textContent = "删除"; del.className = "mini del";
    del.onclick = () => deleteLine(i);
    actions.appendChild(edit);
    actions.appendChild(del);
    row.appendChild(main);
    row.appendChild(actions);
    els.list.appendChild(row);
  });
}

function refresh(): void {
  if (!model || !els?.status) return;
  const curPts = controlsOf(model.current).length;
  const currentFallback = Boolean(model.current?.fallback);
  if (!isReactManagedWorkbench()) {
    els.current.classList.toggle("active", Boolean(model.current));
    els.current.classList.toggle("warning", currentFallback);
    els.current.textContent = model.current
      ? `正在绘制：${model.current.name} · ${SYSTEM_LABELS[model.system]} · ${curPts} 点${curPts < 2 ? "（至少 2 点可保存）" : ""}${currentFallback ? " · 贴面路由已退回直线，需复核可能穿面" : ""}`
      : "当前没有正在绘制的线。点击“开始一条线”，或直接在脸表面点击开始。";
    els.btnNew.disabled = Boolean(model.current);
    els.btnFinish.disabled = !model.current;
    els.btnUndo.disabled = !(model.current || model.lines.length);
    els.status.textContent = `${model.lines.length} 条`;
    els.exAtlas.disabled = !(model.lines.length && onCanonical);
    // 「设为活动图谱并预览」是 2D MediaPipe 实时轨入口；FLAME 图谱（独立 3D 轨）不走 2D 预览。
    els.setActive.disabled = !(model.lines.length && onCanonical && model.topologyId === "mediapipe-468");
    els.exXyz.disabled = !model.lines.length;
    renderLegacyLineList();
  }
  publishAnnotateState("refresh");
}

// ── 渲染循环 + 自适应 ─────────────────────────────────────────────────────────
function tick(): void {
  if (!activeSession.isMounted() || !viewer || !els?.stage) return;
  const r = (els.stage.parentElement ?? els.stage).getBoundingClientRect();
  viewer.resize(Math.max(2, r.width | 0), Math.max(2, r.height | 0));
  viewer.render();
  frameId = requestAnimationFrame(tick);
}

function isActiveSession(session: AnnotationSessionToken): boolean {
  return activeSession.isActive(session);
}

export function disposeAnnotateWorkbench() {
  activeSession.dispose();
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  abortController?.abort?.();
  abortController = null;
  viewer?.dispose?.();
  viewer = null as unknown as Annotator3DInstance;
  model = null as unknown as AnnotationModelInstance;
  drag = null;
}

export function mountAnnotateWorkbench(root: ParentNode | Document = document) {
  disposeAnnotateWorkbench();
  els = collectAnnotateElements(root);
  viewer = new Annotator3D(els.stage);
  model = new AnnotationModel(els.system.value);
  viewer.setAnnotation(model);
  onCanonical = false;
  const bootSession = activeSession.mount();
  abortController = new AbortController();
  bindAnnotateEvents();
  if (!isReactManagedWorkbench()) {
    if (!flameAvailable()) els.loadFlame.style.display = "none";
    if (!fittedFlameAvailable()) els.loadFittedFlame.style.display = "none";
  }
  refresh();
  setHint("点「加载标准脸」开始，或上传头模 JSON / OBJ / PLY。");
  loadCanonical().catch((e) => {
    if (isActiveSession(bootSession)) setHint("标准脸加载失败：" + errorMessage(e));
  });
  frameId = requestAnimationFrame(tick);
  return disposeAnnotateWorkbench;
}
