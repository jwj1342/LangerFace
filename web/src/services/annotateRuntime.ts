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
} from "./annotationInteraction";
import {
  bindAnnotationPointerInteractions,
  type AnnotationPointerPosition,
} from "./annotationPointerController";
import { AnnotationLineService } from "./annotationLineService";
import { prepareAnnotationSlicerImport } from "./annotationSlicerImport";
import {
  AnnotationMeshService,
  type AnnotationFlameAssetName,
  type AnnotationFlameSource,
  type AnnotationMeshResult,
} from "./annotationMeshService";
import { dataSource } from "./dataSource";
import {
  createAnnotationSessionGuard,
  type AnnotationSessionToken,
} from "./annotationSession";
import {
  readAnnotateDrawCommand,
  readAnnotateLibraryCommand,
  readAnnotateMeshCommand,
} from "./workbenchCommandSchemas";

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

// ── 网格加载 ──────────────────────────────────────────────────────────────────
// FLAME 资产为 dev-local（gitignore）：用 import.meta.glob 在构建期按存在与否解析，
// 缺失（CI / 生产构建）时 glob 为空 → FLAME 入口自动隐藏，绝不影响构建。
const FLAME_URLS = import.meta.glob(
  "../../assets/{topology_flame_2023,flame_neutral_vertices,flame_fitted_vertices}.json",
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;
const meshService = new AnnotationMeshService({
  flameAssetUrl: (name: AnnotationFlameAssetName) => FLAME_URLS[`../../assets/${name}.json`] || null,
});
const flameAvailable = () => meshService.flameAvailable("neutral");
const fittedFlameAvailable = () => meshService.flameAvailable("fitted");

function applyAnnotationMesh(mesh: AnnotationMeshResult): void {
  if (mesh.topology) model.setTopology(mesh.topology);
  viewer.setMesh(mesh.vertices, mesh.triangles, { showSurface: true, colors: mesh.colors });
  onCanonical = mesh.canonical;
  els.drawMode.textContent = mesh.modeLabel;
  setHint(mesh.hint);
  refresh();
}

async function loadCanonical(): Promise<void> {
  const session = activeSession.current();
  if (session === null) return;
  setHint("加载标准三维面部模型…");
  const mesh = await meshService.loadCanonical();
  if (!isActiveSession(session)) return;
  applyAnnotationMesh(mesh);
}

async function loadFlame(source: AnnotationFlameSource): Promise<void> {
  const session = activeSession.current();
  if (session === null) return;
  const label = meshService.flameLabel(source);
  setHint(`加载 ${label}…`);
  const result = await meshService.loadFlame(source);
  if (!isActiveSession(session)) return;
  if (result.status === "unavailable") {
    setHint(result.message);
    return;
  }
  applyAnnotationMesh(result.mesh);
}

function runMeshLoad(task: Promise<void>, label: string): void {
  const session = activeSession.current();
  task.catch((error) => {
    if (session !== null && isActiveSession(session)) setHint(`${label}加载失败：${errorMessage(error)}`);
  });
}

function handleReactMeshCommand(event: Event): void {
  const detail = readAnnotateMeshCommand(event);
  if (!detail) return;
  const { command } = detail;
  if (command === "load_canonical") runMeshLoad(loadCanonical(), "标准脸");
  if (command === "load_flame") runMeshLoad(loadFlame("neutral"), "高精度三维头模");
  if (command === "load_fitted_flame") runMeshLoad(loadFlame("fitted"), "FLAME 个体（拟合）");
}

async function loadMeshFile(file?: File): Promise<void> {
  if (!file) return;
  const session = activeSession.current();
  if (session === null) return;
  setHint(`正在读取 ${file.name} ...`);
  let mesh: AnnotationMeshResult;
  try {
    mesh = await meshService.loadFile(file);
  } catch (err) {
    if (isActiveSession(session)) setHint("头模加载失败：" + errorMessage(err));
    return;
  }
  if (!isActiveSession(session)) return;
  applyAnnotationMesh(mesh);
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
  const sourceMesh = viewer.mesh, exportable = onCanonical;
  let prepared: Awaited<ReturnType<typeof prepareAnnotationSlicerImport>>;
  try {
    prepared = await prepareAnnotationSlicerImport(file, {
      spacing,
      exportable,
      snapToSurface: (point) => viewer.snapToSurface(point),
      isCurrent: () => viewer.mesh === sourceMesh && onCanonical === exportable,
    });
  } catch (err) {
    if (isActiveSession(session)) setHint("Slicer 曲线导入失败：" + errorMessage(err));
    return;
  }
  if (!isActiveSession(session)) return;
  for (const line of prepared.lines) model.addLine(line);
  viewer.rebuildLines();
  setHint(`已导入 ${prepared.lines.length} 条 Slicer 曲线，生成 ${prepared.pointCount} 个表面采样点。`);
  refresh();
}

function bindAnnotateEvents(): void {
  const signal = abortController?.signal;
  if (!signal) return;
  bindAnnotationPointerInteractions(els.stage, {
    orbit: (dx, dy) => viewer.orbit(dx, dy),
    zoom: (factor) => viewer.zoom(factor),
    addPoint: addPointAt,
  }, { signal });

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

function addPointAt(e: AnnotationPointerPosition): void {
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
