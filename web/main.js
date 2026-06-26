// 入口：装配 UI 事件绑定并初始化。各功能模块见 pipeline/render/mode3d/ui/state。
import { bindDom, els } from "./dom.js";
import { fitCanvasDisplayToStage, observeCanvasStageResize, panImageViewBy, zoomImageViewAt } from "./canvas_fit.js";
import { dataSource } from "./data_source.js";
import { createCanvasRecordingController } from "./export_canvas.js";
import { validateIncisionOverlay } from "./incision_overlay.js";
import { countMetric, logError } from "./logger.js";
import { enterRoute, loadDemoRecon, resetView3d, setMode3d, startScan, startTwin, stopTwin, toggleTwinHead, toggleTwinTexture } from "./mode3d.js";
import { ensureReady, handleFile, requestFrame, restoreOfficialAtlas, setActiveAtlas, startCamera, stopSource } from "./pipeline.js";
import { adjustFocusZoom, buildZoomCards } from "./render.js";
import { recordingState, reconState, renderState, sourceState } from "./state.js";
import { setIncisionOverlayQa, setMsg, setProvenance, smoothLabel } from "./ui.js";

let previewSystem = null;
let previewMeta = null;
let recordingController = null;
let imageDrag = null;
let resizeCleanup = null;
let abortController = null;
let mounted = false;
let activeSession = 0;
let liveStateTimer = 0;

const LIVE_CONTROLLER_STATE_EVENT = "langerface:live-state";
const LIVE_SOURCE_REACT_COMMAND_EVENT = "langerface:live-source-react-command";
const LIVE_RENDER_REACT_COMMAND_EVENT = "langerface:live-render-react-command";
const LIVE_ROUTE_REACT_COMMAND_EVENT = "langerface:live-route-react-command";

function textOf(el) {
  return el?.textContent?.trim?.() || "";
}

function visibleTextOf(el) {
  if (!el || el.classList?.contains("hidden")) return "";
  return textOf(el);
}

function publishLiveState(reason = "state_update") {
  if (!mounted || typeof window === "undefined" || !els.canvas) return;
  window.dispatchEvent(new CustomEvent(LIVE_CONTROLLER_STATE_EVENT, {
    detail: {
      schema_version: "react-live-controller-snapshot/v0.1",
      reason,
      modelBadge: textOf(els.badge),
      overlayMessage: visibleTextOf(els.msg),
      source: {
        kind: sourceState.sourceKind,
        running: Boolean(sourceState.running),
        paused: Boolean(sourceState.paused),
        liveLabel: els.live?.dataset?.k || textOf(els.live) || "待机",
      },
      route: {
        route: reconState.route,
        mode3d: reconState.mode3d,
        hint: textOf(els.routeModeHint),
      },
      render: {
        system: renderState.system,
        densityPct: Math.round(renderState.densityFrac * 100),
        smoothLabel: textOf(els.smoothVal),
        opacityPct: Math.round(renderState.opacity * 100),
        mirror: Boolean(renderState.mirror),
        zoom: Boolean(renderState.zoom),
        meshPts: Boolean(renderState.meshPts),
        bands: Boolean(renderState.bands),
      },
      recon: {
        has3dModel: Boolean(reconState.reconVerts || reconState.flameFit || reconState.flameNeutral),
        projectable: Boolean(reconState.reconProjectable),
        scanActive: Boolean(reconState.scan?.active),
        twinMode: reconState.twinMode,
        twinTexture: Boolean(reconState.twinTexture),
        status: textOf(els.reconStatus),
      },
      atlasPreview: {
        active: Boolean(previewSystem && previewMeta && renderState.system === previewSystem),
        source: previewMeta?.source || null,
        validated: previewMeta ? previewMeta.validated === true : null,
        count: Number.isFinite(previewMeta?.count) ? previewMeta.count : null,
      },
      incisionOverlay: {
        loaded: Boolean(renderState.incisionOverlay),
        qaLabel: textOf(els.incisionOverlayQaState) || null,
      },
      recording: Boolean(recordingState.recorder),
      updatedAt: new Date().toISOString(),
    },
  }));
}

function scheduleLiveState(reason = "state_update") {
  if (!mounted) return;
  if (liveStateTimer) clearTimeout(liveStateTimer);
  liveStateTimer = setTimeout(() => {
    liveStateTimer = 0;
    publishLiveState(reason);
  }, 0);
}

function runLiveAction(reason, action) {
  try {
    const result = action();
    scheduleLiveState(reason);
    if (result?.then) {
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

function syncPreviewControls() {
  const previewIsActive = Boolean(previewSystem && previewMeta && renderState.system === previewSystem);
  setProvenance(previewIsActive ? previewMeta : null);
  els.restoreAtlas.classList.toggle("hidden", !previewIsActive);
}

function configureLandmarkSmoothing() {
  renderState.smoother.minCutoff = 6.0 - 5.5 * renderState.smoothLevel;
  renderState.smoother.beta = 0.02 + 0.06 * renderState.smoothLevel;
  if (typeof renderState.smoother.configureForSmoothLevel === "function") {
    renderState.smoother.configureForSmoothLevel(renderState.smoothLevel);
  }
}

function applyStagedAtlas() {
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

function applyStagedIncisionOverlay() {
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
function refreshStaticImage() {
  if (sourceState.sourceKind === "image") requestFrame();
}

function visibleRecordingCanvases() {
  const extras = [];
  if (renderState.zoom && !els.zoomStrip.classList.contains("hidden")) {
    renderState.zoomCards.forEach((zc) => {
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

function startImageDrag(e) {
  if (sourceState.sourceKind !== "image" || e.button !== 0) return;
  imageDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  els.mainWrap.classList.add("dragging");
  els.mainWrap.setPointerCapture(e.pointerId);
}

function moveImageDrag(e) {
  if (!imageDrag || e.pointerId !== imageDrag.pointerId) return;
  panImageViewBy(e.clientX - imageDrag.x, e.clientY - imageDrag.y);
  imageDrag.x = e.clientX;
  imageDrag.y = e.clientY;
  e.preventDefault();
}

function endImageDrag(e) {
  if (!imageDrag || e.pointerId !== imageDrag.pointerId) return;
  imageDrag = null;
  els.mainWrap.classList.remove("dragging");
  if (els.mainWrap.hasPointerCapture(e.pointerId)) els.mainWrap.releasePointerCapture(e.pointerId);
}

function handleMainWheel(e) {
  if (sourceState.sourceKind === "image") {
    if (zoomImageViewAt(e.clientX, e.clientY, e.deltaY)) e.preventDefault();
    return;
  }
  if (!adjustFocusZoom(e.deltaY)) return;
  e.preventDefault();
  refreshStaticImage();
}

function handlePauseToggle() {
  sourceState.paused = !sourceState.paused; els.pause.textContent = sourceState.paused ? "▶ 继续" : "⏸ 暂停";
  if (!sourceState.paused) requestFrame();
}

function handleTemplateChange(e) {
  renderState.system = e.target.value; syncPreviewControls(); refreshStaticImage();
}

function handleDensityInput(e) {
  renderState.densityFrac = e.target.value / 100; els.densityVal.textContent = e.target.value + "%"; refreshStaticImage();
}

function handleSmoothInput(e) {
  const v = +e.target.value; renderState.smoothLevel = v / 100; els.smoothVal.textContent = smoothLabel(v);
  configureLandmarkSmoothing();
  refreshStaticImage();
}

function handleOpacityInput(e) {
  renderState.opacity = e.target.value / 100; els.opacityVal.textContent = e.target.value + "%"; refreshStaticImage();
}

function valueEvent(value) {
  return { target: { value } };
}

function checkedEvent(checked) {
  return { target: { checked } };
}

function handleHandOccChange(e) {
  renderState.handOcc = e.target.checked;
  sourceState.imageHulls = null;
  refreshStaticImage();
}

function handleMirrorChange(e) {
  renderState.mirror = e.target.checked;
  els.canvas.classList.toggle("mirror", renderState.mirror);
  renderState.zoomCards.forEach((zc) => zc.canvas.classList.toggle("mirror", renderState.mirror));
  refreshStaticImage();
}

function restoreAtlasPreview() {
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
function toggleRecording() {
  if (!recordingController) {
    recordingController = createCanvasRecordingController({
      canvas: els.canvas,
      getExtraCanvases: visibleRecordingCanvases,
      system: () => renderState.system,
      onStateChange(recording) {
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

function handleReactSourceCommand(event) {
  const { command } = event.detail || {};
  if (command === "upload_source") {
    els.file.click();
    return;
  }
  if (command === "camera_toggle") runLiveAction("camera_toggle", startCamera);
  if (command === "pause_toggle") runLiveAction("pause_toggle", handlePauseToggle);
  if (command === "recording_toggle") runLiveAction("recording_toggle", toggleRecording);
}

function handleReactRenderCommand(event) {
  const { command, value } = event.detail || {};
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

function handleReactRouteCommand(event) {
  const { command, value } = event.detail || {};
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

function bindLiveEvents(signal) {
  els.file.addEventListener("change", (e) => runLiveAction("file_source", () => handleFile(e.target.files?.[0])), { signal });
  if (window.__LANGERFACE_REACT_MANAGED__) {
    window.addEventListener(LIVE_SOURCE_REACT_COMMAND_EVENT, handleReactSourceCommand, { signal });
    window.addEventListener(LIVE_RENDER_REACT_COMMAND_EVENT, handleReactRenderCommand, { signal });
    window.addEventListener(LIVE_ROUTE_REACT_COMMAND_EVENT, handleReactRouteCommand, { signal });
  } else {
    els.upload.addEventListener("click", () => els.file.click(), { signal });
    els.cam.addEventListener("click", () => runLiveAction("camera_toggle", startCamera), { signal });
    els.pause.addEventListener("click", () => runLiveAction("pause_toggle", handlePauseToggle), { signal });
    els.tmpl.addEventListener("change", (e) => runLiveAction("template_change", () => handleTemplateChange(e)), { signal });
    els.density.addEventListener("input", (e) => runLiveAction("density_input", () => handleDensityInput(e)), { signal });
    els.smooth.addEventListener("input", (e) => runLiveAction("smooth_input", () => handleSmoothInput(e)), { signal });
    els.opacity.addEventListener("input", (e) => runLiveAction("opacity_input", () => handleOpacityInput(e)), { signal });
    els.clip.addEventListener("change", (e) => runLiveAction("clip_toggle", () => { renderState.clip = e.target.checked; refreshStaticImage(); }), { signal });
    els.handOcc.addEventListener("change", (e) => runLiveAction("hand_occlusion_toggle", () => handleHandOccChange(e)), { signal });
    els.mirror.addEventListener("change", (e) => runLiveAction("mirror_toggle", () => handleMirrorChange(e)), { signal });
    els.bands.addEventListener("change", (e) => runLiveAction("bands_toggle", () => { renderState.bands = e.target.checked; refreshStaticImage(); }), { signal });
    els.zoom.addEventListener("change", (e) => runLiveAction("zoom_toggle", () => { renderState.zoom = e.target.checked; els.zoomStrip.classList.toggle("hidden", !renderState.zoom); refreshStaticImage(); }), { signal });
    els.meshPts.addEventListener("change", (e) => runLiveAction("mesh_points_toggle", () => { renderState.meshPts = e.target.checked; refreshStaticImage(); }), { signal });
    els.restoreAtlas.addEventListener("click", () => runLiveAction("restore_atlas", restoreAtlasPreview), { signal });
    els.export.addEventListener("click", () => runLiveAction("recording_toggle", toggleRecording), { signal });

    // 3D Beta 路线绑定
    els.routeSel.addEventListener("change", (e) => runLiveAction("route_change", () => enterRoute(e.target.value)), { signal });
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

function isActiveSession(session) {
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
  stopTwin();
  stopSource();
  if (reconState.scan) reconState.scan.active = false;
  cancelAnimationFrame(reconState.viewerRAF);
  reconState.viewerRAF = null;
  reconState.head3d?.dispose?.();
  reconState.head3d = null;
  imageDrag = null;
}

export function mountLiveWorkbench(root = document) {
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

if (document.getElementById("canvas") && !window.__LANGERFACE_REACT_MANAGED__) {
  mountLiveWorkbench();
}
