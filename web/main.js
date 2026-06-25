// 入口：装配 UI 事件绑定并初始化。各功能模块见 pipeline/render/mode3d/ui/state。
import { els } from "./dom.js";
import { fitCanvasDisplayToStage, observeCanvasStageResize, panImageViewBy, zoomImageViewAt } from "./canvas_fit.js";
import { dataSource } from "./data_source.js";
import { createCanvasRecordingController } from "./export_canvas.js";
import { validateIncisionOverlay } from "./incision_overlay.js";
import { countMetric, logError } from "./logger.js";
import { enterRoute, loadDemoRecon, resetView3d, setMode3d, startScan, startTwin, toggleTwinHead, toggleTwinTexture } from "./mode3d.js";
import { ensureReady, handleFile, requestFrame, restoreOfficialAtlas, setActiveAtlas, startCamera } from "./pipeline.js";
import { adjustFocusZoom, buildZoomCards } from "./render.js";
import { recordingState, reconState, renderState, sourceState } from "./state.js";
import { setIncisionOverlayQa, setMsg, setProvenance, smoothLabel } from "./ui.js";

let previewSystem = null;
let previewMeta = null;
let recordingController = null;

function syncPreviewControls() {
  const previewIsActive = Boolean(previewSystem && previewMeta && renderState.system === previewSystem);
  setProvenance(previewIsActive ? previewMeta : null);
  els.restoreAtlas.classList.toggle("hidden", !previewIsActive);
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

let imageDrag = null;

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

els.upload.onclick = () => els.file.click();
els.file.onchange = (e) => handleFile(e.target.files[0]);
els.cam.onclick = startCamera;
els.pause.onclick = () => {
  sourceState.paused = !sourceState.paused; els.pause.textContent = sourceState.paused ? "▶ 继续" : "⏸ 暂停";
  if (!sourceState.paused) requestFrame();
};
els.tmpl.onchange = (e) => { renderState.system = e.target.value; syncPreviewControls(); refreshStaticImage(); };
els.density.oninput = (e) => { renderState.densityFrac = e.target.value / 100; els.densityVal.textContent = e.target.value + "%"; refreshStaticImage(); };
els.smooth.oninput = (e) => {
  const v = +e.target.value; renderState.smoothLevel = v / 100; els.smoothVal.textContent = smoothLabel(v);
  renderState.smoother.minCutoff = 6.0 - 5.5 * renderState.smoothLevel;
  renderState.smoother.beta = 0.02 + 0.06 * renderState.smoothLevel;
  refreshStaticImage();
};
els.opacity.oninput = (e) => { renderState.opacity = e.target.value / 100; els.opacityVal.textContent = e.target.value + "%"; refreshStaticImage(); };
els.clip.onchange = (e) => { renderState.clip = e.target.checked; refreshStaticImage(); };
els.handOcc.onchange = (e) => {
  renderState.handOcc = e.target.checked;
  sourceState.imageHulls = null;
  refreshStaticImage();
};
els.mirror.onchange = (e) => {
  renderState.mirror = e.target.checked;
  els.canvas.classList.toggle("mirror", renderState.mirror);
  renderState.zoomCards.forEach((zc) => zc.canvas.classList.toggle("mirror", renderState.mirror));
  refreshStaticImage();
};
els.bands.onchange = (e) => { renderState.bands = e.target.checked; refreshStaticImage(); };
els.zoom.onchange = (e) => { renderState.zoom = e.target.checked; els.zoomStrip.classList.toggle("hidden", !renderState.zoom); refreshStaticImage(); };
els.meshPts.onchange = (e) => { renderState.meshPts = e.target.checked; refreshStaticImage(); };
els.restoreAtlas.onclick = () => {
  if (!previewSystem) return;
  if (!restoreOfficialAtlas(previewSystem)) {
    setMsg("恢复官方图谱失败。");
    return;
  }
  previewSystem = null; previewMeta = null;
  syncPreviewControls();
  setMsg(null);
};

// 导出：录制画布为 webm 下载
els.export.onclick = () => {
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
      },
    });
  }
  recordingController.toggle();
};

// 3D Beta 路线绑定
els.routeSel.onchange = (e) => enterRoute(e.target.value);
els.reconDemo.onclick = loadDemoRecon;
els.reconScan.onclick = startScan;
els.view3d.onclick = () => { if (reconState.reconVerts) setMode3d("view"); };
els.project3d.onclick = () => { if (reconState.reconVerts && reconState.reconProjectable) setMode3d("project"); };
els.reset3d.onclick = resetView3d;
els.cloudFitFlame.onclick = startTwin;
els.flameStd.onchange = toggleTwinHead;
els.twinTexture.onchange = toggleTwinTexture;

// ── 初始化 ────────────────────────────────────────────────────────────────────
buildZoomCards(refreshStaticImage);
observeCanvasStageResize(() => {
  if (sourceState.sourceKind === "image") fitCanvasDisplayToStage();
});
els.mainWrap.addEventListener("pointerdown", startImageDrag);
els.mainWrap.addEventListener("pointermove", moveImageDrag);
els.mainWrap.addEventListener("pointerup", endImageDrag);
els.mainWrap.addEventListener("pointercancel", endImageDrag);
els.mainWrap.addEventListener("wheel", handleMainWheel, { passive: false });
els.smoothVal.textContent = smoothLabel(+els.smooth.value);
renderState.smoother.minCutoff = 6.0 - 5.5 * renderState.smoothLevel;
renderState.smoother.beta = 0.02 + 0.06 * renderState.smoothLevel;

// 预加载模型并反馈状态
ensureReady().then(() => {
  applyStagedAtlas();
  applyStagedIncisionOverlay();
}).catch((e) => {
  countMetric("bootstrap.loadFailure");
  els.badge.textContent = "模型加载失败";
  logError("启动时模型加载失败。", e);
});
