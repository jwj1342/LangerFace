// 入口：装配 UI 事件绑定并初始化。各功能模块见 pipeline/render/mode3d/ui/state。
import { els } from "./dom.js";
import { enterRoute, loadDemoRecon, setMode3d, startScan } from "./mode3d.js";
import { ensureReady, handleFile, loop, startCamera } from "./pipeline.js";
import { buildZoomCards } from "./render.js";
import { S } from "./state.js";
import { smoothLabel } from "./ui.js";

// ── UI 绑定 ───────────────────────────────────────────────────────────────────
els.upload.onclick = () => els.file.click();
els.file.onchange = (e) => handleFile(e.target.files[0]);
els.cam.onclick = startCamera;
els.pause.onclick = () => {
  S.paused = !S.paused; els.pause.textContent = S.paused ? "▶ 继续" : "⏸ 暂停";
  if (!S.paused) requestAnimationFrame(loop);
};
els.tmpl.onchange = (e) => { S.system = e.target.value; };
els.density.oninput = (e) => { S.densityFrac = e.target.value / 100; els.densityVal.textContent = e.target.value + "%"; };
els.smooth.oninput = (e) => {
  const v = +e.target.value; S.smoothLevel = v / 100; els.smoothVal.textContent = smoothLabel(v);
  S.smoother.minCutoff = 6.0 - 5.5 * S.smoothLevel; S.smoother.beta = 0.02 + 0.06 * S.smoothLevel;
};
els.opacity.oninput = (e) => { S.opacity = e.target.value / 100; els.opacityVal.textContent = e.target.value + "%"; };
els.clip.onchange = (e) => { S.clip = e.target.checked; };
els.handOcc.onchange = (e) => { S.handOcc = e.target.checked; };
els.mirror.onchange = (e) => {
  S.mirror = e.target.checked;
  els.canvas.classList.toggle("mirror", S.mirror);
  S.zoomCards.forEach((zc) => zc.canvas.classList.toggle("mirror", S.mirror));
};
els.bands.onchange = (e) => { S.bands = e.target.checked; };
els.zoom.onchange = (e) => { S.zoom = e.target.checked; els.zoomStrip.classList.toggle("hidden", !S.zoom); };
els.meshPts.onchange = (e) => { S.meshPts = e.target.checked; };

// 导出：录制画布为 webm 下载
els.export.onclick = () => {
  if (S.recorder) { S.recorder.stop(); return; }
  const stream = els.canvas.captureStream(30);
  S.chunks = []; S.recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  S.recorder.ondataavailable = (e) => e.data.size && S.chunks.push(e.data);
  S.recorder.onstop = () => {
    const blob = new Blob(S.chunks, { type: "video/webm" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `langer_${S.system}_${Date.now()}.webm`; a.click();
    S.recorder = null; els.export.textContent = "⬇ 导出"; els.export.removeAttribute("aria-pressed");
  };
  S.recorder.start(); els.export.textContent = "■ 停止"; els.export.setAttribute("aria-pressed", "true");
};

// 3D Beta 路线绑定
els.routeSel.onchange = (e) => enterRoute(e.target.value);
els.reconDemo.onclick = loadDemoRecon;
els.reconScan.onclick = startScan;
els.view3d.onclick = () => { if (S.reconVerts) setMode3d("view"); };
els.project3d.onclick = () => { if (S.reconVerts) setMode3d("project"); };

// ── 初始化 ────────────────────────────────────────────────────────────────────
buildZoomCards();
els.smoothVal.textContent = smoothLabel(+els.smooth.value);
S.smoother.minCutoff = 6.0 - 5.5 * S.smoothLevel; S.smoother.beta = 0.02 + 0.06 * S.smoothLevel;

// 预加载模型并反馈状态
ensureReady().catch((e) => { els.badge.textContent = "模型加载失败"; console.error(e); });
