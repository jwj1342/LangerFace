// 入口：装配 UI 事件绑定并初始化。各功能模块见 pipeline/render/mode3d/ui/state。
import { els } from "./dom.js";
import { fitCanvasDisplayToStage, observeCanvasStageResize, panImageViewBy, zoomImageViewAt } from "./canvas_fit.js";
import { dataSource } from "./data_source.js";
import { countMetric, logError } from "./logger.js";
import { cloudFitFlame, enterRoute, loadDemoRecon, resetView3d, setMode3d, startScan } from "./mode3d.js";
import { ensureReady, handleFile, requestFrame, restoreOfficialAtlas, setActiveAtlas, startCamera } from "./pipeline.js";
import { adjustFocusZoom, buildZoomCards } from "./render.js";
import { recordingState, reconState, renderState, sourceState } from "./state.js";
import { setMsg, setProvenance, smoothLabel } from "./ui.js";

let previewSystem = null;
let previewMeta = null;

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

// ── UI 绑定 ───────────────────────────────────────────────────────────────────
function refreshStaticImage() {
  if (sourceState.sourceKind === "image") requestFrame();
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
  if (recordingState.recorder) { recordingState.recorder.stop(); return; }
  const stream = els.canvas.captureStream(30);
  recordingState.chunks = []; recordingState.recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  recordingState.recorder.ondataavailable = (e) => e.data.size && recordingState.chunks.push(e.data);
  recordingState.recorder.onstop = () => {
    const blob = new Blob(recordingState.chunks, { type: "video/webm" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `langer_${renderState.system}_${Date.now()}.webm`; a.click();
    recordingState.recorder = null; els.export.textContent = "⬇ 导出"; els.export.removeAttribute("aria-pressed");
  };
  recordingState.recorder.start(); els.export.textContent = "■ 停止"; els.export.setAttribute("aria-pressed", "true");
};

// 3D Beta 路线绑定
els.routeSel.onchange = (e) => enterRoute(e.target.value);
els.reconDemo.onclick = loadDemoRecon;
els.reconScan.onclick = startScan;
els.view3d.onclick = () => { if (reconState.reconVerts) setMode3d("view"); };
els.project3d.onclick = () => { if (reconState.reconVerts) setMode3d("project"); };
els.reset3d.onclick = resetView3d;
els.cloudFitFlame.onclick = cloudFitFlame;

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
ensureReady().then(applyStagedAtlas).catch((e) => {
  countMetric("bootstrap.loadFailure");
  els.badge.textContent = "模型加载失败";
  logError("启动时模型加载失败。", e);
});
