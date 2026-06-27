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
  ANNOTATE_DRAW_COMMANDS,
  ANNOTATE_LIBRARY_COMMANDS,
  ANNOTATE_MESH_COMMANDS,
  bindWindowControllerEvents,
  dispatchControllerEvent,
  readControllerCommandDetail,
} from "../lib/controllerCommand";
import { AnnotationModel, type AnnotationLine, type AnnotationPoint } from "./annotationModel";
import type { Triangle, Vec3 } from "./softBody";
import { isReactManagedWorkbench } from "../lib/reactManagedWorkbench";
import { requireScopedElement } from "../lib/scopedDom";
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

interface AnnotateDomElements {
  stage: HTMLCanvasElement;
  system: HTMLSelectElement;
  name: HTMLInputElement;
  region: HTMLInputElement;
  btnNew: HTMLButtonElement;
  btnUndo: HTMLButtonElement;
  btnFinish: HTMLButtonElement;
  btnClear: HTMLButtonElement;
  exAtlas: HTMLButtonElement;
  exXyz: HTMLButtonElement;
  setActive: HTMLButtonElement;
  loadCanonical: HTMLButtonElement;
  loadFlame: HTMLButtonElement;
  loadFittedFlame: HTMLButtonElement;
  cloudFit: HTMLButtonElement;
  meshFile: HTMLInputElement;
  slicerFile: HTMLInputElement;
  resampleSpacing: HTMLInputElement;
  list: HTMLElement;
  status: HTMLElement;
  hint: HTMLElement;
  current: HTMLElement;
  drawMode: HTMLElement;
}

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

interface CloudFitResponse {
  verts?: Vec3[];
  faces?: Triangle[];
  error?: string;
  residual?: number | null;
  nLandmarks?: number;
}

type AnnotationModelInstance = InstanceType<typeof AnnotationModel>;
type Annotator3DInstance = InstanceType<typeof Annotator3D>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function controllerEvent(event: Event): Event & { detail?: unknown } {
  return event as Event & { detail?: unknown };
}

const $ = <T extends Element>(root: ParentNode | Document, id: string): T => {
  return requireScopedElement<T>(root, id);
};

function collectElements(root: ParentNode | Document = document): AnnotateDomElements {
  return {
    stage: $<HTMLCanvasElement>(root, "stage"),
    system: $<HTMLSelectElement>(root, "annSystem"),
    name: $<HTMLInputElement>(root, "annName"),
    region: $<HTMLInputElement>(root, "annRegion"),
    btnNew: $<HTMLButtonElement>(root, "btnNew"),
    btnUndo: $<HTMLButtonElement>(root, "btnUndo"),
    btnFinish: $<HTMLButtonElement>(root, "btnFinish"),
    btnClear: $<HTMLButtonElement>(root, "btnClear"),
    exAtlas: $<HTMLButtonElement>(root, "btnExportAtlas"),
    exXyz: $<HTMLButtonElement>(root, "btnExportXyz"),
    setActive: $<HTMLButtonElement>(root, "btnSetActiveAtlas"),
    loadCanonical: $<HTMLButtonElement>(root, "btnLoadCanonical"),
    loadFlame: $<HTMLButtonElement>(root, "btnLoadFlame"),
    loadFittedFlame: $<HTMLButtonElement>(root, "btnLoadFittedFlame"),
    cloudFit: $<HTMLButtonElement>(root, "btnCloudFit"),
    meshFile: $<HTMLInputElement>(root, "meshFile"),
    slicerFile: $<HTMLInputElement>(root, "slicerFile"),
    resampleSpacing: $<HTMLInputElement>(root, "resampleSpacing"),
    list: $<HTMLElement>(root, "lineList"),
    status: $<HTMLElement>(root, "annStatus"),
    hint: $<HTMLElement>(root, "hint"),
    current: $<HTMLElement>(root, "currentState"),
    drawMode: $<HTMLElement>(root, "drawMode"),
  };
}

let els = {} as AnnotateDomElements;
let viewer = null as unknown as Annotator3DInstance;
let model = null as unknown as AnnotationModelInstance;
let onCanonical = false;   // 是否在标准脸拓扑上标注（决定能否导出图谱）
let mounted = false;
let frameId = 0;
let abortController: AbortController | null = null;
let activeSession = 0;

let bundledFlameBasis: FlameBasis | null = null;

function fileFromEvent(event: Event): File | undefined {
  return (event.target as HTMLInputElement | null)?.files?.[0] ?? undefined;
}

function isAnnotationPoint(point: AnnotationPoint | null): point is AnnotationPoint {
  return point !== null;
}

function publishAnnotateState(reason = "state_update"): void {
  if (!mounted || typeof window === "undefined" || !els?.hint) return;
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
  const session = activeSession;
  setHint("加载 FLAME 标准脸…");
  let mesh: FlameMesh;
  try {
    mesh = await loadBundledFlameStandard();
  } catch (err) {
    if (!isActiveSession(session)) return;
    setHint("FLAME 标准脸加载失败，回退到 MediaPipe 标准脸：" + errorMessage(err));
    const [verts, topology] = await Promise.all([
      fetchJSON<Vec3[]>(assetUrls.canonicalVertices, "MediaPipe 标准脸顶点"),
      fetchJSON<MeshTopologyPayload | Triangle[]>(assetUrls.topology, "MediaPipe 标准脸拓扑"),
    ]);
    if (!isActiveSession(session)) return;
    const tris = Array.isArray(topology) ? topology : topology.triangles;
    model.setTopology(Array.isArray(topology) ? undefined : topology);
    viewer.setMesh(verts, tris, { showSurface: true });
    onCanonical = true;
    els.drawMode.textContent = "MediaPipe 标准图谱";
    setHint("已回退到 MediaPipe 标准脸；可导出 mediapipe-468 图谱(tri,u,v)。");
    refresh();
    return;
  }
  if (!isActiveSession(session)) return;
  const meta = topologyMeta("flame-2023");
  if (!meta) throw new Error("缺少 FLAME 拓扑登记");
  model.setTopology({ topologyId: meta.id, topologyVersion: meta.version });
  viewer.setMesh(mesh.verts, mesh.tris, { showSurface: true });
  onCanonical = true;
  els.drawMode.textContent = "FLAME 标准图谱";
  setHint(`在 FLAME 标准脸上点击落点（${mesh.verts.length} 顶点）；导出可得 flame-2023 图谱(tri,u,v)。`);
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
  const session = activeSession;
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
const loadFlame = () => loadFlameMesh("flame_neutral_vertices", topologyMeta("flame-2023")?.label ?? "FLAME 头模 (5023)");
const loadFittedFlame = () => loadFlameMesh("flame_fitted_vertices", "FLAME 个体（拟合）");

function handleReactMeshCommand(event: Event): void {
  const detail = readControllerCommandDetail(controllerEvent(event), ANNOTATE_MESH_COMMANDS);
  if (!detail) return;
  const { command } = detail;
  if (command === "load_canonical") loadCanonical();
  if (command === "load_flame") loadFlame();
  if (command === "load_fitted_flame") loadFittedFlame();
  if (command === "cloud_fit_flame") cloudFitFlame();
}

// 云端拟合演示：把标准脸关键点 POST 到 /api/fit（Vercel Python 云函数）→ 拿回个体 FLAME 网格渲染。
// 全程云端、无需本地资产，可直接在 PR 预览里用。
async function cloudFitFlame(): Promise<void> {
  const session = activeSession;
  setHint("云端拟合 FLAME 中…（首次冷启动约 1–2 秒）");
  let observed: Vec3[];
  try {
    observed = await fetchJSON(assetUrls.canonicalVertices, "标准脸顶点");
  } catch (err) {
    setHint("加载 MediaPipe 参考点失败：" + errorMessage(err));
    return;
  }
  if (!isActiveSession(session)) return;
  let res: CloudFitResponse;
  try {
    const r = await fetch("/api/fit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ landmarks: observed }),
    });
    res = await r.json().catch(() => ({} as CloudFitResponse));
    if (!r.ok || res.error) throw new Error(res.error || `HTTP ${r.status}`);
  } catch (err) {
    setHint("云端拟合失败：" + errorMessage(err));
    return;
  }
  if (!isActiveSession(session)) return;
  model.setTopology({ topologyId: "flame-2023", topologyVersion: "flame-2023-v1" });
  if (!res.verts || !res.faces) {
    setHint("云端拟合失败：响应缺少 FLAME 网格。");
    return;
  }
  viewer.setMesh(res.verts, res.faces, { showSurface: true });
  onCanonical = false;
  els.drawMode.textContent = "FLAME 个体（云端拟合）";
  const mm = res.residual != null ? (res.residual * 1000).toFixed(1) : "?";
  setHint(`云端拟合完成：${res.verts.length} 顶点 · ${res.nLandmarks ?? "?"} 关键点 · 残差 ${mm}mm。`);
  refresh();
}

async function fetchJSON<T = unknown>(url: string, label: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}加载失败：HTTP ${res.status}`);
  return res.json();
}

async function loadMeshFile(file?: File): Promise<void> {
  if (!file) return;
  const session = activeSession;
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
  const session = activeSession;
  if (!viewer.hasMesh()) {
    setHint("请先加载 FLAME 标准脸或上传头模，再导入 Slicer 曲线。");
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
    els.exAtlas.addEventListener("click", () => exportJSON(() => model.toAtlasJSON(), `atlas_${model.system}_annotated.json`), { signal });
    els.exXyz.addEventListener("click", () => exportJSON(() => model.toXyzJSON(), `lines_${model.system}_xyz.json`), { signal });
    els.setActive.addEventListener("click", previewActiveAtlas, { signal });
    els.loadCanonical.addEventListener("click", loadCanonical, { signal });
    els.loadFlame.addEventListener("click", loadFlame, { signal });
    els.loadFittedFlame.addEventListener("click", loadFittedFlame, { signal });
    els.cloudFit.addEventListener("click", cloudFitFlame, { signal });
  }
  els.meshFile.addEventListener("change", (e) => loadMeshFile(fileFromEvent(e)), { signal });
  els.slicerFile.addEventListener("change", (e) => loadSlicerFile(fileFromEvent(e)), { signal });

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
    if (isTextControl(e.target)) return;
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
  const detail = readControllerCommandDetail(controllerEvent(event), ANNOTATE_DRAW_COMMANDS);
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
  const detail = readControllerCommandDetail(controllerEvent(event), ANNOTATE_LIBRARY_COMMANDS);
  if (!detail) return;
  const { command, index } = detail;
  if (command === "clear_lines") {
    clearLines();
    return;
  }
  if (command === "export_atlas") {
    exportJSON(() => model.toAtlasJSON(), `atlas_${model.system}_annotated.json`);
    return;
  }
  if (command === "export_xyz") {
    exportJSON(() => model.toXyzJSON(), `lines_${model.system}_xyz.json`);
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

function isTextControl(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function exportJSON(build: () => unknown, filename: string): void {
  let data;
  try { data = build(); } catch (err) { setHint("导出失败：" + errorMessage(err)); return; }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setHint(`已导出 ${filename}`);
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
  if (!mounted || !viewer || !els?.stage) return;
  const r = (els.stage.parentElement ?? els.stage).getBoundingClientRect();
  viewer.resize(Math.max(2, r.width | 0), Math.max(2, r.height | 0));
  viewer.render();
  frameId = requestAnimationFrame(tick);
}

function isActiveSession(session: number): boolean {
  return mounted && session === activeSession;
}

export function disposeAnnotateWorkbench() {
  mounted = false;
  activeSession += 1;
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
  els = collectElements(root);
  viewer = new Annotator3D(els.stage);
  model = new AnnotationModel(els.system.value);
  viewer.setAnnotation(model);
  onCanonical = false;
  mounted = true;
  activeSession += 1;
  abortController = new AbortController();
  bindAnnotateEvents();
  if (!isReactManagedWorkbench()) {
    if (!flameAvailable()) els.loadFlame.style.display = "none";
    if (!fittedFlameAvailable()) els.loadFittedFlame.style.display = "none";
  }
  refresh();
  setHint("点「加载 FLAME 标准脸」开始，或上传头模 JSON / OBJ / PLY。");
  const bootSession = activeSession;
  loadCanonical().catch((e) => {
    if (isActiveSession(bootSession)) setHint("标准脸加载失败：" + errorMessage(e));
  });
  frameId = requestAnimationFrame(tick);
  return disposeAnnotateWorkbench;
}
