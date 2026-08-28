// Live workbench runtime: wires DOM events and model bootstrap under the React route adapter.
import { bindDom, clearDomBinding, els } from "./liveDom.ts";
import { fitCanvasDisplayToStage, observeCanvasStageResize, panImageViewBy, transformImageViewGesture, zoomImageViewAt, zoomImageViewByFactorAt } from "./liveCanvasFit.ts";
import { validateIncisionOverlay } from "./incisionOverlay.ts";
import { ensureImageReady, handleFile, redrawPausedFrame, requestFrame, restoreOfficialAtlas, setActiveAtlas, startCamera, stopSource } from "./pipeline.ts";
import { adjustFocusZoom, buildZoomCards } from "./render2d.ts";
import {
  LIVE_CONTROLLER_STATE_EVENT,
  LIVE_RENDER_REACT_COMMAND_EVENT,
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
import { LiveActionScheduler } from "./liveActionScheduler";
import { bindLiveCanvasInteractions } from "./liveCanvasInteraction";
import { LiveCommandRouter } from "./liveCommandRouter";
import { createCanvasRecordingController, type CanvasRecordingController, type RecordingExtraCanvas } from "./canvasRecording";
import { modelState, recordingState, renderState, sourceState } from "./liveState";
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
import {
  clearLiveUiMessageTimer,
  setIncisionOverlayQa,
  setLive,
  setMsg,
  setProvenance,
  setTransientMsg,
  smoothLabel,
} from "./liveUi";
import {
  analyzeCurrentWrinkles,
  applyWrinkleGuidedRefinement,
  disposeLiveWrinkleAnalysis,
  resetLiveWrinkleAnalysis,
  restoreStandardRstl,
  setWrinkleDisplayMode,
  updateWrinkleUi,
} from "./liveWrinkleAnalysis.ts";

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
let resizeCleanup: (() => void) | null = null;
let abortController: AbortController | null = null;
let mounted = false;
let activeSession = 0;
const liveActions = new LiveActionScheduler({
  currentSession: () => activeSession,
  isActive: (session) => isActiveSession(session),
  publish: (reason) => publishLiveState(reason),
});

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
    renderSystem: renderState.system,
    densityFrac: renderState.densityFrac,
    smoothLabel: liveTextOf(els.smoothVal),
    opacity: renderState.opacity,
    mirror: renderState.mirror,
    zoom: renderState.zoom,
    meshPts: renderState.meshPts,
    bands: renderState.bands,
    previewSystem,
    previewMeta,
    atlasContract: modelState.atlasContracts[renderState.system] || null,
    incisionOverlayLoaded: Boolean(renderState.incisionOverlay),
    incisionOverlayQaLabel: liveTextOf(els.incisionOverlayQaState) || null,
    recording: Boolean(recordingState.recorder),
  }));
}

function scheduleLiveState(reason = "state_update"): void {
  liveActions.schedule(reason);
}

function runLiveAction(reason: string, action: () => unknown): unknown {
  return liveActions.run(reason, action);
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
    detail: "上传照片或开启摄像头后开始检查。",
  });
  buildZoomCards(refreshStaticImage);
  const highCodes = overlay.guardrail_summary?.high_codes || overlay.review_gate?.high_guardrail_codes || [];
  const reviewLabel = overlay.review?.status === "approved_for_discussion" ? "已确认候选草案" : "待复核候选";
  const riskText = highCodes.length ? `；高风险项 ${highCodes.join("、")}` : "";
  setMsg(`已载入切口候选叠加（${reviewLabel}${riskText}）。上传照片或开启摄像头后，会随 RSTL 一起显示。`);
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
  return extras;
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
    els.pause.textContent = "▶ 继续";
    els.pause.setAttribute("aria-pressed", "true");
    setLive(false, "已定格 · 可微调");
    setTransientMsg("已暂停当前画面。可点击“检测皱纹”，或使用“医生手动微调（2D）”继续处理。");
    redrawPausedFrame();
    setRefineAvailability();
    return;
  }
  sourceState.paused = false;
  sourceState.frozenFrame = null;
  const refinementCommitted = commitRefineForLive();
  resetLiveWrinkleAnalysis();
  els.pause.textContent = "⏸ 暂停";
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
  els.mirror.checked = renderState.mirror;
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

const liveCommands = new LiveCommandRouter({
  run: runLiveAction,
  uploadSource: () => els.file.click(),
  cameraToggle: () => startCamera({
    onFacingMode() {
      handleMirrorChange(checkedEvent(false));
    },
  }),
  pauseToggle: handlePauseToggle,
  recordingToggle: toggleRecording,
  templateChange: (value) => handleTemplateChange(valueEvent(value)),
  densityInput: (value) => handleDensityInput(valueEvent(value)),
  opacityInput: (value) => handleOpacityInput(valueEvent(value)),
  mirrorToggle: (value) => handleMirrorChange(checkedEvent(value)),
  meshPointsToggle: (value) => {
    renderState.meshPts = value;
    refreshStaticImage();
  },
  restoreAtlas: restoreAtlasPreview,
  clearIncisionOverlay,
});

function bindLiveEvents(signal: AbortSignal, root: ParentNode | Document): void {
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
  window.addEventListener("langerface:live-quality-relocated", () => {
    bindDom(root);
  }, { signal });
  window.addEventListener("langerface:refine2d-state", updateWrinkleUi, { signal });
  if (isReactManagedWorkbench()) {
    bindWindowControllerEvents([
      [LIVE_SOURCE_REACT_COMMAND_EVENT, (event) => { liveCommands.handleSourceEvent(event); }],
      [LIVE_RENDER_REACT_COMMAND_EVENT, (event) => { liveCommands.handleRenderEvent(event); }],
    ], { signal });
  } else {
    els.upload.addEventListener("click", () => liveCommands.source("upload_source"), { signal });
    els.cam.addEventListener("click", () => liveCommands.source("camera_toggle"), { signal });
    els.pause.addEventListener("click", () => liveCommands.source("pause_toggle"), { signal });
    els.tmpl.addEventListener("change", (e) => liveCommands.render("template_change", eventValue(e)), { signal });
    els.density.addEventListener("input", (e) => liveCommands.render("density_input", eventValue(e)), { signal });
    els.smooth.addEventListener("input", (e) => runLiveAction("smooth_input", () => handleSmoothInput(e)), { signal });
    els.opacity.addEventListener("input", (e) => liveCommands.render("opacity_input", eventValue(e)), { signal });
    els.clip.addEventListener("change", (e) => runLiveAction("clip_toggle", () => { renderState.clip = eventChecked(e); refreshStaticImage(); }), { signal });
    els.handOcc.addEventListener("change", (e) => runLiveAction("hand_occlusion_toggle", () => handleHandOccChange(e)), { signal });
    els.mirror.addEventListener("change", (e) => liveCommands.render("mirror_toggle", eventChecked(e)), { signal });
    els.bands.addEventListener("change", (e) => runLiveAction("bands_toggle", () => { renderState.bands = eventChecked(e); refreshStaticImage(); }), { signal });
    els.zoom.addEventListener("change", (e) => runLiveAction("zoom_toggle", () => { renderState.zoom = eventChecked(e); els.zoomStrip.classList.toggle("hidden", !renderState.zoom); refreshStaticImage(); }), { signal });
    els.meshPts.addEventListener("change", (e) => liveCommands.render("mesh_points_toggle", eventChecked(e)), { signal });
    els.restoreAtlas.addEventListener("click", () => liveCommands.render("restore_atlas"), { signal });
    els.export.addEventListener("click", () => liveCommands.source("recording_toggle"), { signal });
  }

  bindLiveCanvasInteractions(els.mainWrap, {
    isRefineActive,
    isImagePointerInteractionBlocked: () => Boolean(els.mainWrap.dataset.workflowPointerMode),
    isMobileTouchImageGestureEnabled: () => {
      const pointerMode = els.mainWrap.dataset.workflowPointerMode || "";
      return Boolean(
        els.mainWrap.closest(".workflow-workbench")
        && window.matchMedia("(max-width: 560px) and (pointer: coarse) and (hover: none)").matches
        && (!pointerMode || pointerMode === "marker")
      );
    },
    beginRefinePointer,
    moveRefinePointer,
    endRefinePointer,
    sourceKind: () => sourceState.sourceKind,
    panImageViewBy,
    zoomImageViewAt,
    zoomImageViewByFactorAt,
    transformImageViewGesture,
    adjustFocusZoom,
    updateRefineUi,
    refreshStaticImage,
    onImageViewChanged: () => window.dispatchEvent(new Event("langerface:image-view-changed")),
  }, { signal });
}

function isActiveSession(session: number): boolean {
  return mounted && session === activeSession;
}

export function disposeLiveWorkbench() {
  mounted = false;
  activeSession += 1;
  liveActions.dispose();
  abortController?.abort?.();
  abortController = null;
  resizeCleanup?.();
  resizeCleanup = null;
  recordingController?.stop?.();
  recordingController = null;
  recordingState.recorder = null;
  if (hasBoundLiveDom()) {
    stopSource();
  }
  sourceState.planning2d?.dispose();
  sourceState.planning2d = null;
  void disposeLiveWrinkleAnalysis();
  clearLiveUiMessageTimer();
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
  bindLiveEvents(abortController.signal, root);
  updateRefineUi();
  updateWrinkleUi();
  buildZoomCards(refreshStaticImage);
  resizeCleanup = observeCanvasStageResize(() => {
    if (sourceState.sourceKind === "image") fitCanvasDisplayToStage();
  });
  els.smoothVal.textContent = smoothLabel(+els.smooth.value);
  configureLandmarkSmoothing();
  scheduleLiveState("mounted");

  // 合并页优先预热静态图片模型；视频/摄像头模型在对应媒体首次使用时再加载。
  const session = activeSession;
  ensureImageReady().then(() => {
    if (!isActiveSession(session)) return;
    els.badge.textContent = "照片模型就绪";
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
