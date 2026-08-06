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
  buildAnnotateControllerSnapshot,
} from "./annotateSnapshots";
import {
  annotationNdcPoint,
  annotationZoomFactor,
  beginAnnotationDrag,
  updateAnnotationDrag,
  type AnnotationDragState,
} from "./annotationInteraction";
import { AnnotationLineService } from "./annotationLineService";
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
let lineService = null as unknown as AnnotationLineService;
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
let drag: AnnotationDragState | null = null;
function bindAnnotateEvents(): void {
  const signal = abortController?.signal;
  if (!signal) return;
  els.stage.addEventListener("pointerdown", (e: PointerEvent) => {
    drag = beginAnnotationDrag(e.clientX, e.clientY);
    els.stage.setPointerCapture(e.pointerId);
  }, { signal });
  els.stage.addEventListener("pointermove", (e: PointerEvent) => {
    if (!drag) return;
    const update = updateAnnotationDrag(drag, e.clientX, e.clientY);
    drag = update.state;
    if (update.orbit) viewer.orbit(update.orbit.dx, update.orbit.dy);
  }, { signal });
  els.stage.addEventListener("pointerup", (e: PointerEvent) => {
    const isClick = Boolean(drag && !drag.moved);
    drag = null;
    if (els.stage.hasPointerCapture(e.pointerId)) els.stage.releasePointerCapture(e.pointerId);
    if (isClick) addPointAt(e);
  }, { signal });
  els.stage.addEventListener("pointercancel", (e: PointerEvent) => {
    drag = null;
    if (els.stage.hasPointerCapture(e.pointerId)) els.stage.releasePointerCapture(e.pointerId);
  }, { signal });
  els.stage.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    viewer.zoom(annotationZoomFactor(e.deltaY));
  }, { passive: false, signal });

  bindWindowControllerEvents([
    [ANNOTATE_MESH_REACT_COMMAND_EVENT, handleReactMeshCommand],
    [ANNOTATE_DRAW_REACT_COMMAND_EVENT, handleReactDrawCommand],
    [ANNOTATE_LIBRARY_REACT_COMMAND_EVENT, handleReactLineLibraryCommand],
  ], { signal });
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
  const ndc = annotationNdcPoint(e.clientX, e.clientY, r);
  const hit = viewer.raycast(ndc.x, ndc.y);
  if (!hit) return;
  if (!model.current) startLineFromInputs();
  hit.exportable = onCanonical;   // 自定义头模仍用 tri/bary 贴面连线，但不能导出项目图谱
  const { fallback } = model.addPoint(hit);
  viewer.rebuildLines();
  refresh();
  if (fallback) setHint("两点不在同一连通网格上，已退回直线连接，可能穿面");
}

function lineDraft(): { name: string; region: string } {
  return lineService.draft(els.name.value, els.region.value);
}

function startLineFromInputs(): boolean {
  const draft = lineDraft();
  const result = lineService.start(draft);
  if (result.status === "blocked") {
    setHint("当前线正在绘制；请先保存当前线，或撤销点后继续。");
    return false;
  }
  syncInputsFromLine(result.line);
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
  const result = lineService.save();
  if (result.status === "no_current") {
    setHint("请先点击“开始一条线”，或直接在脸表面点击开始。");
    return;
  }
  if (result.status === "too_short") {
    setHint("当前线至少需要 2 个点才能保存。");
    return;
  }
  viewer.rebuildLines();
  els.name.value = "";
  setHint(`已保存 ${result.line.name || "当前线"}。继续填写下一条线并点击“开始一条线”。`);
  refresh();
}

function undoLast(): void {
  const result = lineService.undo();
  if (result.status === "point") {
    setHint(`已撤销当前线的上一个点，剩余 ${result.remaining} 个控制点。`);
  } else if (result.status === "cancelled") {
    setHint("已取消当前空线。");
  } else if (result.status === "restored") {
    syncInputsFromLine(result.line);
    setHint(`已恢复 ${result.line.name || "上一条线"}，可继续编辑或重新保存。`);
  } else {
    setHint("没有可撤销的标注。");
  }
  viewer.rebuildLines();
  refresh();
}

function restoreLine(i: number): void {
  const result = lineService.restore(i);
  if (result.status === "blocked") {
    setHint("请先保存或撤销当前线，再编辑已保存线。");
    return;
  }
  if (result.status === "missing") return;
  syncInputsFromLine(result.line);
  viewer.rebuildLines();
  setHint(`正在编辑 ${result.line.name}。修改后点击“保存当前线”。`);
  refresh();
}

function clearLines(): void {
  lineService.clear();
  viewer.rebuildLines();
  refresh();
}

function deleteLine(i: number): void {
  lineService.delete(i);
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
  location.href = "/app/live";
}

// ── UI 刷新 ───────────────────────────────────────────────────────────────────
function setHint(t: string): void {
  if (els?.hint) {
    els.hint.textContent = t;
    publishAnnotateState("hint");
  }
}

function refresh(): void {
  if (!model || !els?.status) return;
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
  lineService = null as unknown as AnnotationLineService;
  drag = null;
}

export function mountAnnotateWorkbench(root: ParentNode | Document = document) {
  disposeAnnotateWorkbench();
  els = collectAnnotateElements(root);
  viewer = new Annotator3D(els.stage);
  model = new AnnotationModel(els.system.value);
  lineService = new AnnotationLineService(model);
  viewer.setAnnotation(model);
  onCanonical = false;
  const bootSession = activeSession.mount();
  abortController = new AbortController();
  bindAnnotateEvents();
  refresh();
  setHint("点「加载标准脸」开始，或上传头模 JSON / OBJ / PLY。");
  loadCanonical().catch((e) => {
    if (isActiveSession(bootSession)) setHint("标准脸加载失败：" + errorMessage(e));
  });
  frameId = requestAnimationFrame(tick);
  return disposeAnnotateWorkbench;
}
