// Live workbench runtime: wires DOM events and model bootstrap under the React route adapter.
import { bindDom, clearDomBinding, els } from "./liveDom.ts";
import { fitCanvasDisplayToStage, observeCanvasStageResize, panImageViewBy, zoomImageViewAt } from "./liveCanvasFit.ts";
import { validateIncisionOverlay } from "./incisionOverlay.ts";
import { enterRoute, loadDemoRecon, resetView3d, setMode3d, startScan, startTwin, stopTwin, toggleTwinHead, toggleTwinTexture } from "./mode3d.ts";
import { ensureReady, handleFile, redrawPausedFrame, requestFrame, restoreOfficialAtlas, setActiveAtlas, startCamera, stopSource } from "./pipeline.ts";
import { adjustFocusZoom, buildZoomCards } from "./render2d.ts";
import {
  LIVE_CONTROLLER_STATE_EVENT,
  LIVE_RENDER_REACT_COMMAND_EVENT,
  LIVE_ROUTE_REACT_COMMAND_EVENT,
  LIVE_SOURCE_REACT_COMMAND_EVENT,
} from "../lib/controllerEvents";
import {
  bindWindowControllerEvents,
  dispatchControllerEvent,
} from "../lib/controllerCommand";
import type { LiveZoomCard } from "./render2d.ts";
import { isReactManagedWorkbench } from "../lib/reactManagedWorkbench";
import {
  buildLiveControllerSnapshot,
  liveTextOf,
  visibleLiveTextOf,
} from "./liveSnapshots";
import { dataSource } from "./dataSource";
import { countMetric, logError } from "./logger";
import { createCanvasRecordingController, type CanvasRecordingController, type RecordingExtraCanvas } from "./canvasRecording";
import { modelState, recordingState, reconState, renderState, sourceState } from "./liveState";
import { createPhotoPlanningController } from "./photoPlanningController";
import {
  adjustRefineImageZoom,
  beginFrozenRefineSession,
  beginRefinePointer,
  commitRefineForLive,
  endRefinePointer,
  exportRefine,
  isRefineActive,
  moveRefinePointer,
  nudgeSelected,
  resetRefineForNewSource,
  resetRefineToAuto,
  setAxisVisible,
  setRefineMode,
  setRefineNudgeStep,
  setRefinePointCount,
  setRefineSpread,
  setRefineAvailability,
  setSymmetryEnabled,
  toggleRefine2d,
  undoRefine,
  updateRefineUi,
} from "./liveRefine2d";
import { setIncisionOverlayQa, setLive, setMsg, setProvenance, smoothLabel } from "./liveUi";
import {
  readLiveRenderCommand,
  readLiveRouteCommand,
  readLiveSourceCommand,
} from "./workbenchCommandSchemas";
import {
  analyzeCurrentWrinkles,
  applyWrinkleGuidedRefinement,
  disposeLiveWrinkleAnalysis,
  resetLiveWrinkleAnalysis,
  restoreStandardRstl,
  setWrinkleDisplayMode,
  updateWrinkleUi,
} from "./liveWrinkleAnalysis.ts";

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
  const provenance = atlas.provenance && typeof atlas.provenance === "object"
    ? atlas.provenance as Record<string, unknown>
    : null;
  const provenanceText = typeof atlas.provenance === "string" ? atlas.provenance : "";
  const provenanceSource = typeof provenance?.source === "string"
    ? provenance.source
    : provenanceText.includes("local-yolo")
      ? "个性化 V6"
      : "标注会话";
  previewMeta = {
    source: provenanceSource,
    validated: atlas.validated === true,
    count: atlas.lines.length,
  };
  els.tmpl.value = atlas.system;
  resetRefineForNewSource();
  resetLiveWrinkleAnalysis();
  syncPreviewControls();
  if (!sourceState.running) {
    setMsg(provenanceSource === "个性化 V6"
      ? "已载入本次个性化 V6 RSTL。开启摄像头或上传照片即可实时查看。"
      : "已载入标注预览图谱（未验证）。开启摄像头或上传照片即可在脸上查看。");
  }
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

function clearIncisionOverlay(): void {
  dataSource.clearIncisionOverlay();
  renderState.incisionOverlay = null;
  setIncisionOverlayQa(null);
  buildZoomCards(refreshStaticImage);
  refreshStaticImage();
  setMsg("已清除本次切口候选叠加。RSTL 显示不受影响。");
  scheduleLiveState("incision_overlay_cleared");
}

// ── UI 绑定 ───────────────────────────────────────────────────────────────────
function refreshStaticImage(): void {
  if (sourceState.paused && redrawPausedFrame()) return;
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
  if (isRefineActive()) {
    if (beginRefinePointer(e)) e.preventDefault();
    return;
  }
  if (sourceState.sourceKind !== "image" || e.button !== 0) return;
  imageDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  els.mainWrap.classList.add("dragging");
  els.mainWrap.setPointerCapture(e.pointerId);
}

function moveImageDrag(e: PointerEvent): void {
  if (isRefineActive()) {
    if (moveRefinePointer(e)) e.preventDefault();
    return;
  }
  if (!imageDrag || e.pointerId !== imageDrag.pointerId) return;
  panImageViewBy(e.clientX - imageDrag.x, e.clientY - imageDrag.y);
  imageDrag.x = e.clientX;
  imageDrag.y = e.clientY;
  e.preventDefault();
}

function endImageDrag(e: PointerEvent): void {
  if (isRefineActive()) {
    if (endRefinePointer(e)) e.preventDefault();
    return;
  }
  if (!imageDrag || e.pointerId !== imageDrag.pointerId) return;
  imageDrag = null;
  els.mainWrap.classList.remove("dragging");
  if (els.mainWrap.hasPointerCapture(e.pointerId)) els.mainWrap.releasePointerCapture(e.pointerId);
}

function handleMainWheel(e: WheelEvent): void {
  if (sourceState.sourceKind === "image" || isRefineActive()) {
    if (zoomImageViewAt(e.clientX, e.clientY, e.deltaY)) {
      if (isRefineActive()) updateRefineUi();
      e.preventDefault();
    }
    return;
  }
  if (!adjustFocusZoom(e.deltaY)) return;
  e.preventDefault();
  refreshStaticImage();
}

function handlePauseToggle(): void {
  if (!sourceState.running || sourceState.sourceKind === "image") return;
  if (!sourceState.paused) {
    if (!sourceState.lastLM || sourceState.presence <= 0) {
      setMsg("尚未获得稳定人脸，请正对摄像头后再定格。");
      return;
    }
    const frozen = document.createElement("canvas");
    frozen.width = els.canvas.width;
    frozen.height = els.canvas.height;
    frozen.getContext("2d")?.drawImage(sourceState.source as CanvasImageSource, 0, 0, frozen.width, frozen.height);
    sourceState.frozenFrame = frozen;
    sourceState.paused = true;
    beginFrozenRefineSession();
    els.pause.textContent = "▶ 继续实时";
    els.pause.setAttribute("aria-pressed", "true");
    setLive(false, "已定格 · 可微调");
    setMsg("已定格当前帧，正在本机检测皱纹。可选择自动微调、医生手动微调，或自动后继续手动调整。");
    redrawPausedFrame();
    setRefineAvailability();
    void analyzeCurrentWrinkles();
    return;
  }
  sourceState.paused = false;
  sourceState.frozenFrame = null;
  const refinementCommitted = commitRefineForLive();
  resetLiveWrinkleAnalysis();
  els.pause.textContent = sourceState.sourceKind === "camera" ? "📷 定格微调" : "⏸ 暂停";
  els.pause.setAttribute("aria-pressed", "false");
  setMsg(refinementCommitted ? "已返回实时画面，当前微调曲线会继续跟随人脸。" : null);
  setLive(true, sourceState.sourceKind === "camera" ? "实时摄像头" : "视频");
  requestFrame();
}

function handleTemplateChange(e: Event | ValueControlEvent): void {
  renderState.system = String(eventValue(e) ?? "");
  resetRefineForNewSource();
  resetLiveWrinkleAnalysis();
  syncPreviewControls();
  refreshStaticImage();
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
  resetRefineForNewSource();
  resetLiveWrinkleAnalysis();
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
  const detail = readLiveSourceCommand(event);
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
  const detail = readLiveRenderCommand(event);
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
  if (command === "clear_incision_overlay") runLiveAction("clear_incision_overlay", clearIncisionOverlay);
}

function handleReactRouteCommand(event: Event): void {
  const detail = readLiveRouteCommand(event);
  if (!detail) return;
  const { command, value } = detail;
  if (command === "route_change") runLiveAction("route_change", () => enterRoute(value === "3d" ? "3d" : "2d"));
  if (command === "load_demo_recon") runLiveAction("load_demo_recon", loadDemoRecon);
  if (command === "start_scan") runLiveAction("start_scan", startScan);
  if (command === "view_3d") runLiveAction("view_3d", () => { if (reconState.reconVerts) setMode3d("view"); });
  if (command === "project_3d") {
    runLiveAction("project_3d", () => {
      if (!reconState.reconVerts) return;
      if (reconState.mode3d === "project") setMode3d("view");
      else if (reconState.reconProjectable) setMode3d("project");
    });
  }
  if (command === "reset_3d") runLiveAction("reset_3d", resetView3d);
  if (command === "start_twin") runLiveAction("start_twin", startTwin);
  if (command === "toggle_twin_head") runLiveAction("toggle_twin_head", toggleTwinHead);
  if (command === "toggle_twin_texture") runLiveAction("toggle_twin_texture", toggleTwinTexture);
}

function bindLiveEvents(signal: AbortSignal): void {
  els.file.addEventListener("change", (e) => runLiveAction("file_source", () => handleFile((e.target as HTMLInputElement | null)?.files?.[0])), { signal });
  els.wrinkleDisplayMode.addEventListener("change", (event) => {
    runLiveAction("wrinkle_display_mode", () => setWrinkleDisplayMode((event.target as HTMLSelectElement).value));
  }, { signal });
  els.wrinkleDetect.addEventListener("click", () => {
    runLiveAction("wrinkle_detect", () => analyzeCurrentWrinkles({ force: true }));
  }, { signal });
  els.wrinkleAutoRefine.addEventListener("click", () => {
    runLiveAction("wrinkle_auto_refine", applyWrinkleGuidedRefinement);
  }, { signal });
  els.wrinkleRestore.addEventListener("click", () => {
    runLiveAction("wrinkle_restore_standard", restoreStandardRstl);
  }, { signal });
  els.refine2d.addEventListener("click", () => runLiveAction("refine_toggle", toggleRefine2d), { signal });
  els.refineView.addEventListener("click", () => runLiveAction("refine_view", () => setRefineMode("view")), { signal });
  els.refineDrag.addEventListener("click", () => runLiveAction("refine_drag", () => setRefineMode("drag")), { signal });
  els.refinePoint.addEventListener("click", () => runLiveAction("refine_point", () => setRefineMode("point")), { signal });
  els.refineErase.addEventListener("click", () => runLiveAction("refine_erase", () => setRefineMode("erase")), { signal });
  els.refineUndo.addEventListener("click", () => runLiveAction("refine_undo", undoRefine), { signal });
  els.refineExport.addEventListener("click", () => runLiveAction("refine_export", exportRefine), { signal });
  els.refineZoomOut.addEventListener("click", () => runLiveAction("refine_zoom_out", () => adjustRefineImageZoom("out")), { signal });
  els.refineZoomReset.addEventListener("click", () => runLiveAction("refine_zoom_reset", () => adjustRefineImageZoom("reset")), { signal });
  els.refineZoomIn.addEventListener("click", () => runLiveAction("refine_zoom_in", () => adjustRefineImageZoom("in")), { signal });
  els.refineSymmetry.addEventListener("change", (event) => runLiveAction("refine_symmetry", () => setSymmetryEnabled((event.target as HTMLInputElement).checked)), { signal });
  els.refineAxis.addEventListener("change", (event) => runLiveAction("refine_axis", () => setAxisVisible((event.target as HTMLInputElement).checked)), { signal });
  els.refineSpread.addEventListener("input", (event) => runLiveAction("refine_spread", () => setRefineSpread((event.target as HTMLInputElement).value)), { signal });
  els.refinePointCount.addEventListener("input", (event) => runLiveAction("refine_point_count", () => setRefinePointCount((event.target as HTMLInputElement).value)), { signal });
  els.refineNudgeStep.addEventListener("change", (event) => runLiveAction("refine_nudge_step", () => setRefineNudgeStep((event.target as HTMLSelectElement).value)), { signal });
  for (const button of els.refineNudgeButtons) {
    button.addEventListener("click", () => runLiveAction("refine_nudge", () => nudgeSelected(button.dataset.refineNudge || "")), { signal });
  }
  els.refineReset.addEventListener("click", () => runLiveAction("refine_reset", resetRefineToAuto), { signal });
  window.addEventListener("langerface:refine2d-redraw", () => {
    refreshStaticImage();
  }, { signal });
  window.addEventListener("langerface:refine2d-state", updateWrinkleUi, { signal });
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
    els.project3d.addEventListener("click", () => {
      runLiveAction("project_3d", () => {
        if (!reconState.reconVerts) return;
        if (reconState.mode3d === "project") setMode3d("view");
        else if (reconState.reconProjectable) setMode3d("project");
      });
    }, { signal });
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
  sourceState.planning2d?.dispose();
  sourceState.planning2d = null;
  void disposeLiveWrinkleAnalysis();
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
  sourceState.planning2d = createPhotoPlanningController({ owner: "live" });
  mounted = true;
  activeSession += 1;
  abortController = new AbortController();
  previewSystem = null;
  previewMeta = null;
  recordingController = null;
  imageDrag = null;
  bindLiveEvents(abortController.signal);
  updateRefineUi();
  updateWrinkleUi();
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
    els.badge.textContent = "模型就绪";
    els.badge.classList.remove("loading");
    sourceState.planning2d?.setTopology(modelState.triangles || []);
    sourceState.planning2d?.setDetectorLease({ detector: modelState.imageLandmarker || modelState.landmarker });
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
