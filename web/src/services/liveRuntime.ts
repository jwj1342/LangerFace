// Live workbench runtime: wires DOM events and model bootstrap under the React route adapter.
import { bindDom, clearDomBinding, els } from "../../dom.js";
import { fitCanvasDisplayToStage, observeCanvasStageResize, panImageViewBy, zoomImageViewAt } from "../../canvas_fit.js";
import { validateIncisionOverlay } from "../../incision_overlay.js";
import { enterRoute, loadDemoRecon, resetView3d, setMode3d, startScan, startTwin, stopTwin, toggleTwinHead, toggleTwinTexture } from "../../mode3d.js";
import { ensureReady, handleFile, requestFrame, restoreOfficialAtlas, setActiveAtlas, startCamera, stopSource } from "../../pipeline.js";
import { adjustFocusZoom, buildZoomCards } from "../../render.js";
import {
  LIVE_CONTROLLER_STATE_EVENT,
  LIVE_RENDER_REACT_COMMAND_EVENT,
  LIVE_ROUTE_REACT_COMMAND_EVENT,
  LIVE_SOURCE_REACT_COMMAND_EVENT,
} from "../lib/controllerEvents";
import {
  LIVE_RENDER_COMMANDS,
  LIVE_ROUTE_COMMANDS,
  LIVE_SOURCE_COMMANDS,
  bindWindowControllerEvents,
  dispatchControllerEvent,
  readControllerCommandDetail,
} from "../lib/controllerCommand";
import type { LiveZoomCard } from "../../render.js";
import { isReactManagedWorkbench } from "../lib/reactManagedWorkbench";
import {
  buildLiveControllerSnapshot,
  liveTextOf,
  visibleLiveTextOf,
} from "./liveSnapshots";
import { dataSource } from "./dataSource";
import { countMetric, logError } from "./logger";
import { createCanvasRecordingController, type CanvasRecordingController, type RecordingExtraCanvas } from "./canvasRecording";
import { recordingState, reconState, renderState, sourceState } from "../../state.js";
import { setIncisionOverlayQa, setMsg, setProvenance, smoothLabel } from "./liveUi";

interface ImageDragState {
  pointerId: number;
  x: number;
  y: number;
}

interface ValueControlEvent {
  target: {
    value: unknown;
  };
}

interface CheckedControlEvent {
  target: {
    checked: boolean;
  };
}

let previewSystem: string | null = null;
let previewMeta: { source: string; validated: boolean; count: number } | null = null;
let recordingController: CanvasRecordingController | null = null;
let imageDrag: ImageDragState | null = null;
let resizeCleanup: (() => void) | null = null;
let abortController: AbortController | null = null;
let mounted = false;
let activeSession = 0;
let liveStateTimer: ReturnType<typeof setTimeout> | 0 = 0;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

function eventValue(event: Event | ValueControlEvent): unknown {
  return (event.target as { value?: unknown } | null)?.value;
}

function eventChecked(event: Event | CheckedControlEvent): boolean {
  return Boolean((event.target as { checked?: boolean } | null)?.checked);
}

function controllerEvent(event: Event): Event & { detail?: unknown } {
  return event as Event & { detail?: unknown };
}

function hasBoundLiveDom(): boolean {
  return Boolean(els.video && els.canvas && els.mainWrap);
}

function publishLiveState(reason = "state_update"): void {
  if (!mounted || typeof window === "undefined" || !els.canvas) return;
  dispatchControllerEvent(LIVE_CONTROLLER_STATE_EVENT, buildLiveControllerSnapshot({
    reason,
    modelBadge: liveTextOf(els.badge),
    overlayMessage: visibleLiveTextOf(els.msg),
    sourceKind: sourceState.sourceKind,
    sourceRunning: sourceState.running,
    sourcePaused: sourceState.paused,
    liveLabel: els.live?.dataset?.k || liveTextOf(els.live) || "待机",
    route: reconState.route,
    mode3d: reconState.mode3d,
    routeHint: liveTextOf(els.routeModeHint),
    renderSystem: renderState.system,
    densityFrac: renderState.densityFrac,
    smoothLabel: liveTextOf(els.smoothVal),
    opacity: renderState.opacity,
    mirror: renderState.mirror,
    zoom: renderState.zoom,
    meshPts: renderState.meshPts,
    bands: renderState.bands,
    has3dModel: Boolean(reconState.reconVerts || reconState.flameFit || reconState.flameNeutral),
    projectable: reconState.reconProjectable,
    scanActive: reconState.scan?.active,
    twinMode: reconState.twinMode,
    twinTexture: reconState.twinTexture,
    reconStatus: liveTextOf(els.reconStatus),
    previewSystem,
    previewMeta,
    incisionOverlayLoaded: Boolean(renderState.incisionOverlay),
    incisionOverlayQaLabel: liveTextOf(els.incisionOverlayQaState) || null,
    recording: Boolean(recordingState.recorder),
  }));
}

function scheduleLiveState(reason = "state_update"): void {
  if (!mounted) return;
  if (liveStateTimer) clearTimeout(liveStateTimer);
  liveStateTimer = setTimeout(() => {
    liveStateTimer = 0;
    publishLiveState(reason);
  }, 0);
}

function runLiveAction(reason: string, action: () => unknown): unknown {
  try {
    const result = action();
    scheduleLiveState(reason);
    if (isThenable(result)) {
      result.then(
        () => scheduleLiveState(`${reason}_done`),
        () => scheduleLiveState(`${reason}_failed`),
      );
    }
    return result;
  } catch (err) {
    scheduleLiveState(`${reason}_failed`);
    throw err;
  }
}

function syncPreviewControls(): void {
  const previewIsActive = Boolean(previewSystem && previewMeta && renderState.system === previewSystem);
  setProvenance(previewIsActive ? previewMeta : null);
  els.restoreAtlas.classList.toggle("hidden", !previewIsActive);
}

function configureLandmarkSmoothing(): void {
  renderState.smoother.minCutoff = 6.0 - 5.5 * renderState.smoothLevel;
  renderState.smoother.beta = 0.02 + 0.06 * renderState.smoothLevel;
  if (typeof renderState.smoother.configureForSmoothLevel === "function") {
    renderState.smoother.configureForSmoothLevel(renderState.smoothLevel);
  }
}

function applyStagedAtlas(): void {
  const atlas = dataSource.takePreviewAtlas();
  if (!atlas || !Array.isArray(atlas.lines)) return;
  if (!setActiveAtlas(atlas.system, atlas)) {
    setMsg("标注预览图谱加载失败：图谱格式无效。已继续使用内置图谱。");
    return;
  }
  previewSystem = atlas.system;
  previewMeta = { source: "标注会话", validated: atlas.validated === true, count: atlas.lines.length };
  els.tmpl.value = atlas.system;
  syncPreviewControls();
  if (!sourceState.running) setMsg("已载入标注预览图谱（未验证）。开启摄像头或上传照片即可在脸上查看。");
  scheduleLiveState("staged_atlas");
}

function applyStagedIncisionOverlay(): void {
  const overlay = dataSource.loadIncisionOverlay();
  if (!overlay) return;
  if (!validateIncisionOverlay(overlay)) {
    dataSource.clearIncisionOverlay();
    setIncisionOverlayQa(null);
    setMsg("切口候选叠加数据无效，已清除。");
    return;
  }
  renderState.incisionOverlay = overlay;
  setIncisionOverlayQa({
    label: "等待画面",
    detail: "上传照片、视频或开启摄像头后开始检查。",
  });
  buildZoomCards(refreshStaticImage);
  const highCodes = overlay.guardrail_summary?.high_codes || overlay.review_gate?.high_guardrail_codes || [];
  const reviewLabel = overlay.review?.status === "approved_for_discussion" ? "已确认候选草案" : "待复核候选";
  const riskText = highCodes.length ? `；高风险项 ${highCodes.join("、")}` : "";
  setMsg(`已载入切口候选叠加（${reviewLabel}${riskText}）。上传照片、视频或开启摄像头后，会随 RSTL 一起显示。`);
  scheduleLiveState("staged_incision_overlay");
}

// ── UI 绑定 ───────────────────────────────────────────────────────────────────
function refreshStaticImage(): void {
  if (sourceState.sourceKind === "image") requestFrame();
}

function visibleRecordingCanvases(): RecordingExtraCanvas[] {
  const extras: RecordingExtraCanvas[] = [];
  if (renderState.zoom && !els.zoomStrip.classList.contains("hidden")) {
    renderState.zoomCards.forEach((zc: LiveZoomCard) => {
      if (!zc?.canvas || !zc.canvas.width || !zc.canvas.height) return;
      if (zc.card?.offsetParent === null) return;
      const label = zc.card?.querySelector(".tag")?.textContent || "细节放大窗";
      extras.push({ label, canvas: zc.canvas });
    });
  }
  if (els.three && !els.three.classList.contains("hidden") && els.three.width && els.three.height) {
    extras.push({ label: "3D 视图", canvas: els.three });
  }
  return extras;
}

function startImageDrag(e: PointerEvent): void {
  if (sourceState.sourceKind !== "image" || e.button !== 0) return;
  imageDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  els.mainWrap.classList.add("dragging");
  els.mainWrap.setPointerCapture(e.pointerId);
}

function moveImageDrag(e: PointerEvent): void {
  if (!imageDrag || e.pointerId !== imageDrag.pointerId) return;
  panImageViewBy(e.clientX - imageDrag.x, e.clientY - imageDrag.y);
  imageDrag.x = e.clientX;
  imageDrag.y = e.clientY;
  e.preventDefault();
}

function endImageDrag(e: PointerEvent): void {
  if (!imageDrag || e.pointerId !== imageDrag.pointerId) return;
  imageDrag = null;
  els.mainWrap.classList.remove("dragging");
  if (els.mainWrap.hasPointerCapture(e.pointerId)) els.mainWrap.releasePointerCapture(e.pointerId);
}

function handleMainWheel(e: WheelEvent): void {
  if (sourceState.sourceKind === "image") {
    if (zoomImageViewAt(e.clientX, e.clientY, e.deltaY)) e.preventDefault();
    return;
  }
  if (!adjustFocusZoom(e.deltaY)) return;
  e.preventDefault();
  refreshStaticImage();
}

function handlePauseToggle(): void {
  sourceState.paused = !sourceState.paused; els.pause.textContent = sourceState.paused ? "▶ 继续" : "⏸ 暂停";
  if (!sourceState.paused) requestFrame();
}

function handleTemplateChange(e: Event | ValueControlEvent): void {
  renderState.system = String(eventValue(e) ?? ""); syncPreviewControls(); refreshStaticImage();
}

function handleDensityInput(e: Event | ValueControlEvent): void {
  const value = Number(eventValue(e) ?? 0);
  renderState.densityFrac = value / 100; els.densityVal.textContent = value + "%"; refreshStaticImage();
}

function handleSmoothInput(e: Event | ValueControlEvent): void {
  const v = Number(eventValue(e) ?? 0); renderState.smoothLevel = v / 100; els.smoothVal.textContent = smoothLabel(v);
  configureLandmarkSmoothing();
  refreshStaticImage();
}

function handleOpacityInput(e: Event | ValueControlEvent): void {
  const value = Number(eventValue(e) ?? 0);
  renderState.opacity = value / 100; els.opacityVal.textContent = value + "%"; refreshStaticImage();
}

function valueEvent(value: unknown): ValueControlEvent {
  return { target: { value } };
}

function checkedEvent(checked: boolean): CheckedControlEvent {
  return { target: { checked } };
}

function handleHandOccChange(e: Event | CheckedControlEvent): void {
  renderState.handOcc = eventChecked(e);
  sourceState.imageHulls = null;
  refreshStaticImage();
}

function handleMirrorChange(e: Event | CheckedControlEvent): void {
  renderState.mirror = eventChecked(e);
  els.canvas.classList.toggle("mirror", renderState.mirror);
  renderState.zoomCards.forEach((zc: LiveZoomCard) => zc.canvas.classList.toggle("mirror", renderState.mirror));
  refreshStaticImage();
}

function restoreAtlasPreview(): void {
  if (!previewSystem) return;
  if (!restoreOfficialAtlas(previewSystem)) {
    setMsg("恢复官方图谱失败。");
    return;
  }
  previewSystem = null; previewMeta = null;
  syncPreviewControls();
  setMsg(null);
}

// 导出：录制画布为 webm 下载
function toggleRecording(): void {
  if (!recordingController) {
    recordingController = createCanvasRecordingController({
      canvas: els.canvas,
      getExtraCanvases: visibleRecordingCanvases,
      system: () => renderState.system,
      onStateChange(recording: boolean) {
        recordingState.recorder = recording ? recordingController : null;
        els.export.textContent = recording ? "■ 停止" : "⬇ 导出";
        if (recording) els.export.setAttribute("aria-pressed", "true");
        else els.export.removeAttribute("aria-pressed");
        scheduleLiveState("recording_state");
      },
    });
  }
  recordingController.toggle();
}

function handleReactSourceCommand(event: Event): void {
  const detail = readControllerCommandDetail(controllerEvent(event), LIVE_SOURCE_COMMANDS);
  if (!detail) return;
  const { command } = detail;
  if (command === "upload_source") {
    els.file.click();
    return;
  }
  if (command === "camera_toggle") runLiveAction("camera_toggle", startCamera);
  if (command === "pause_toggle") runLiveAction("pause_toggle", handlePauseToggle);
  if (command === "recording_toggle") runLiveAction("recording_toggle", toggleRecording);
}

function handleReactRenderCommand(event: Event): void {
  const detail = readControllerCommandDetail(controllerEvent(event), LIVE_RENDER_COMMANDS);
  if (!detail) return;
  const { command, value } = detail;
  if (command === "template_change") runLiveAction("template_change", () => handleTemplateChange(valueEvent(value)));
  if (command === "density_input") runLiveAction("density_input", () => handleDensityInput(valueEvent(Number(value))));
  if (command === "opacity_input") runLiveAction("opacity_input", () => handleOpacityInput(valueEvent(Number(value))));
  if (command === "mirror_toggle") runLiveAction("mirror_toggle", () => handleMirrorChange(checkedEvent(Boolean(value))));
  if (command === "mesh_points_toggle") {
    runLiveAction("mesh_points_toggle", () => {
      renderState.meshPts = Boolean(value);
      refreshStaticImage();
    });
  }
  if (command === "restore_atlas") runLiveAction("restore_atlas", restoreAtlasPreview);
}

function handleReactRouteCommand(event: Event): void {
  const detail = readControllerCommandDetail(controllerEvent(event), LIVE_ROUTE_COMMANDS);
  if (!detail) return;
  const { command, value } = detail;
  if (command === "route_change") runLiveAction("route_change", () => enterRoute(value === "3d" ? "3d" : "2d"));
  if (command === "load_demo_recon") runLiveAction("load_demo_recon", loadDemoRecon);
  if (command === "start_scan") runLiveAction("start_scan", startScan);
  if (command === "view_3d") runLiveAction("view_3d", () => { if (reconState.reconVerts) setMode3d("view"); });
  if (command === "project_3d") runLiveAction("project_3d", () => { if (reconState.reconVerts && reconState.reconProjectable) setMode3d("project"); });
  if (command === "reset_3d") runLiveAction("reset_3d", resetView3d);
  if (command === "start_twin") runLiveAction("start_twin", startTwin);
  if (command === "toggle_twin_head") runLiveAction("toggle_twin_head", toggleTwinHead);
  if (command === "toggle_twin_texture") runLiveAction("toggle_twin_texture", toggleTwinTexture);
}

function bindLiveEvents(signal: AbortSignal): void {
  els.file.addEventListener("change", (e) => runLiveAction("file_source", () => handleFile((e.target as HTMLInputElement | null)?.files?.[0])), { signal });
  if (isReactManagedWorkbench()) {
    bindWindowControllerEvents([
      [LIVE_SOURCE_REACT_COMMAND_EVENT, handleReactSourceCommand],
      [LIVE_RENDER_REACT_COMMAND_EVENT, handleReactRenderCommand],
      [LIVE_ROUTE_REACT_COMMAND_EVENT, handleReactRouteCommand],
    ], { signal });
  } else {
    els.upload.addEventListener("click", () => els.file.click(), { signal });
    els.cam.addEventListener("click", () => runLiveAction("camera_toggle", startCamera), { signal });
    els.pause.addEventListener("click", () => runLiveAction("pause_toggle", handlePauseToggle), { signal });
    els.tmpl.addEventListener("change", (e) => runLiveAction("template_change", () => handleTemplateChange(e)), { signal });
    els.density.addEventListener("input", (e) => runLiveAction("density_input", () => handleDensityInput(e)), { signal });
    els.smooth.addEventListener("input", (e) => runLiveAction("smooth_input", () => handleSmoothInput(e)), { signal });
    els.opacity.addEventListener("input", (e) => runLiveAction("opacity_input", () => handleOpacityInput(e)), { signal });
    els.clip.addEventListener("change", (e) => runLiveAction("clip_toggle", () => { renderState.clip = eventChecked(e); refreshStaticImage(); }), { signal });
    els.handOcc.addEventListener("change", (e) => runLiveAction("hand_occlusion_toggle", () => handleHandOccChange(e)), { signal });
    els.mirror.addEventListener("change", (e) => runLiveAction("mirror_toggle", () => handleMirrorChange(e)), { signal });
    els.bands.addEventListener("change", (e) => runLiveAction("bands_toggle", () => { renderState.bands = eventChecked(e); refreshStaticImage(); }), { signal });
    els.zoom.addEventListener("change", (e) => runLiveAction("zoom_toggle", () => { renderState.zoom = eventChecked(e); els.zoomStrip.classList.toggle("hidden", !renderState.zoom); refreshStaticImage(); }), { signal });
    els.meshPts.addEventListener("change", (e) => runLiveAction("mesh_points_toggle", () => { renderState.meshPts = eventChecked(e); refreshStaticImage(); }), { signal });
    els.restoreAtlas.addEventListener("click", () => runLiveAction("restore_atlas", restoreAtlasPreview), { signal });
    els.export.addEventListener("click", () => runLiveAction("recording_toggle", toggleRecording), { signal });

    // 3D Beta 路线绑定
    els.routeSel.addEventListener("change", (e) => runLiveAction("route_change", () => enterRoute(String(eventValue(e)) === "3d" ? "3d" : "2d")), { signal });
    els.reconDemo.addEventListener("click", () => runLiveAction("load_demo_recon", loadDemoRecon), { signal });
    els.reconScan.addEventListener("click", () => runLiveAction("start_scan", startScan), { signal });
    els.view3d.addEventListener("click", () => runLiveAction("view_3d", () => { if (reconState.reconVerts) setMode3d("view"); }), { signal });
    els.project3d.addEventListener("click", () => runLiveAction("project_3d", () => { if (reconState.reconVerts && reconState.reconProjectable) setMode3d("project"); }), { signal });
    els.reset3d.addEventListener("click", () => runLiveAction("reset_3d", resetView3d), { signal });
    els.cloudFitFlame.addEventListener("click", () => runLiveAction("start_twin", startTwin), { signal });
    els.flameStd.addEventListener("change", () => runLiveAction("toggle_twin_head", toggleTwinHead), { signal });
    els.twinTexture.addEventListener("change", () => runLiveAction("toggle_twin_texture", toggleTwinTexture), { signal });
  }

  els.mainWrap.addEventListener("pointerdown", startImageDrag, { signal });
  els.mainWrap.addEventListener("pointermove", moveImageDrag, { signal });
  els.mainWrap.addEventListener("pointerup", endImageDrag, { signal });
  els.mainWrap.addEventListener("pointercancel", endImageDrag, { signal });
  els.mainWrap.addEventListener("wheel", handleMainWheel, { passive: false, signal });
}

function isActiveSession(session: number): boolean {
  return mounted && session === activeSession;
}

export function disposeLiveWorkbench() {
  mounted = false;
  activeSession += 1;
  if (liveStateTimer) clearTimeout(liveStateTimer);
  liveStateTimer = 0;
  abortController?.abort?.();
  abortController = null;
  resizeCleanup?.();
  resizeCleanup = null;
  recordingController?.stop?.();
  recordingController = null;
  recordingState.recorder = null;
  if (hasBoundLiveDom()) {
    stopTwin();
    stopSource();
  }
  if (reconState.scan) reconState.scan.active = false;
  if (reconState.viewerRAF != null) cancelAnimationFrame(reconState.viewerRAF);
  reconState.viewerRAF = null;
  reconState.head3d?.dispose?.();
  reconState.head3d = null;
  imageDrag = null;
  clearDomBinding();
}

export function mountLiveWorkbench(root: ParentNode | Document = document) {
  disposeLiveWorkbench();
  bindDom(root);
  mounted = true;
  activeSession += 1;
  abortController = new AbortController();
  previewSystem = null;
  previewMeta = null;
  recordingController = null;
  imageDrag = null;
  bindLiveEvents(abortController.signal);
  buildZoomCards(refreshStaticImage);
  resizeCleanup = observeCanvasStageResize(() => {
    if (sourceState.sourceKind === "image") fitCanvasDisplayToStage();
  });
  els.smoothVal.textContent = smoothLabel(+els.smooth.value);
  configureLandmarkSmoothing();
  scheduleLiveState("mounted");

  // 预加载模型并反馈状态
  const session = activeSession;
  ensureReady().then(() => {
    if (!isActiveSession(session)) return;
    applyStagedAtlas();
    applyStagedIncisionOverlay();
    scheduleLiveState("model_ready");
  }).catch((e) => {
    if (!isActiveSession(session)) return;
    countMetric("bootstrap.loadFailure");
    els.badge.textContent = "模型加载失败";
    logError("启动时模型加载失败。", e);
    scheduleLiveState("model_load_failed");
  });
  return disposeLiveWorkbench;
}
