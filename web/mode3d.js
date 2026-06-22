// 3D 重建（Beta）：转头扫描/示例重建 → 旋转查看 → 相似变换投影回实时画面。
import { RIGID3D } from "./constants.js";
import { assetUrls } from "./assets.js";
import { els } from "./dom.js";
import { applySim, toPixels, umeyama } from "./geometry.js";
import { ensureReady, startCamera, stopSource } from "./pipeline.js";
import { S } from "./state.js";
import { setLive, setMsg } from "./ui.js";

let canonicalRef = null;

async function fetchCanonicalRef() {
  if (canonicalRef) return canonicalRef;
  const cv = await fetch(assetUrls.canonicalVertices).then((r) => r.json());
  canonicalRef = cv.map((p) => [p[0], -p[1], -p[2]]);  // 翻到屏幕手性 (y下,z入屏)
  return canonicalRef;
}

// 投影模式：把重建网格用相似变换刚性配准到当前帧的活体关键点，返回贴合的网格顶点
export function projectVerts(lm) {
  if (S.route === "3d" && S.mode3d === "project" && S.reconVerts) {
    const sim = umeyama(RIGID3D.map((i) => S.reconVerts[i]), RIGID3D.map((i) => lm[i]));
    return applySim(sim, S.reconVerts);
  }
  return lm;
}

async function ensureHead3D() {
  if (S.head3d) return;
  const mod = await import("./three3d.js");
  S.head3d = new mod.Head3D(els.three);
  let drag = false, px = 0, py = 0;
  els.three.addEventListener("pointerdown", (e) => { drag = true; px = e.clientX; py = e.clientY; els.three.setPointerCapture(e.pointerId); });
  els.three.addEventListener("pointermove", (e) => {
    if (!drag) return;
    S.rot.y += (e.clientX - px) * 0.01;
    S.rot.x = Math.max(-1.2, Math.min(1.2, S.rot.x + (e.clientY - py) * 0.01));
    px = e.clientX; py = e.clientY;
  });
  els.three.addEventListener("pointerup", () => { drag = false; });
}

async function buildViewer() {
  await ensureHead3D();
  const disp = S.reconVerts.map((p) => [p[0], -p[1], -p[2]]);  // 翻成 y 上 供查看
  S.head3d.setGeometry(disp, S.triangles, S.atlases[S.system], { showSurface: true, bands: S.bands });
  els.view3d.disabled = false; els.project3d.disabled = false;
  setMode3d("view");
}

function viewerLoop() {
  if (S.route !== "3d" || S.mode3d !== "view" || !S.head3d) return;
  const r = els.three.parentElement.getBoundingClientRect();
  S.head3d.resize(Math.max(2, r.width | 0), Math.max(2, r.height | 0));
  S.head3d.setRotation(S.rot.x, S.rot.y);
  S.head3d.render();
  S.viewerRAF = requestAnimationFrame(viewerLoop);
}

export function setMode3d(m) {
  S.mode3d = m;
  els.view3d.setAttribute("aria-pressed", String(m === "view"));
  els.project3d.setAttribute("aria-pressed", String(m === "project"));
  if (m === "view") {
    stopSource(); S.running = false;
    els.canvas.classList.add("hidden"); els.three.classList.remove("hidden");
    setMsg(null); setLive(false, "3D 模型（拖拽旋转）");
    cancelAnimationFrame(S.viewerRAF); viewerLoop();
  } else {
    cancelAnimationFrame(S.viewerRAF);
    els.three.classList.add("hidden"); els.canvas.classList.remove("hidden");
    startCamera();  // 复用主循环；projectVerts 注入重建配准
  }
}

export async function loadDemoRecon() {
  els.reconStatus.textContent = "加载示例重建（基于你的视频）…";
  await ensureReady();
  const d = await fetch(assetUrls.reconDemo).then((r) => r.json());
  S.reconVerts = d.vertices;
  els.reconStatus.textContent = `示例重建就绪：${d.frames} 帧，偏航 ${d.yaw_min}~${d.yaw_max}。可旋转查看 / 投影。`;
  await buildViewer();
}

export async function startScan() {
  els.reconStatus.textContent = "加载模型…"; await ensureReady();
  const ref = await fetchCanonicalRef(); const refRigid = RIGID3D.map((i) => ref[i]);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false });
    stopSource(); els.video.srcObject = stream; await els.video.play();
  } catch (e) { els.reconStatus.textContent = "无法开启摄像头：" + e.message; return; }
  els.canvas.classList.add("hidden"); els.three.classList.add("hidden");
  const collected = []; const t0 = performance.now(); let ymin = 1e9, ymax = -1e9;
  S.scan = { active: true };
  const tick = () => {
    if (!S.scan || !S.scan.active) return;
    const t = performance.now();
    const res = S.landmarker.detectForVideo(els.video, t);
    if (res.faceLandmarks && res.faceLandmarks.length) {
      const lm = toPixels(res.faceLandmarks[0], els.video.videoWidth, els.video.videoHeight).slice(0, 468);
      collected.push(applySim(umeyama(RIGID3D.map((i) => lm[i]), refRigid), lm));
      const nose = lm[1], cl = lm[234], cr = lm[454], yaw = (nose[0] - (cl[0] + cr[0]) / 2) / (Math.abs(cr[0] - cl[0]) || 1);
      ymin = Math.min(ymin, yaw); ymax = Math.max(ymax, yaw);
    }
    const secs = (t - t0) / 1000;
    els.reconStatus.textContent = `扫描中 ${secs.toFixed(1)}s：缓慢左右上下转头（已采 ${collected.length} 帧，偏航 ${ymin.toFixed(2)}~${ymax.toFixed(2)}）`;
    if (secs > 9 && collected.length > 40) { finishScan(collected, ymin, ymax); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function finishScan(collected, ymin, ymax) {
  S.scan = null;
  const N = collected.length, V = 468, verts = [];
  const med = (k) => { k.sort((a, b) => a - b); return k[(k.length - 1) >> 1]; };
  for (let v = 0; v < V; v++) {
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < N; i++) { xs.push(collected[i][v][0]); ys.push(collected[i][v][1]); zs.push(collected[i][v][2]); }
    verts.push([med(xs), med(ys), med(zs)]);
  }
  const c = [0, 0, 0]; for (const p of verts) for (let k = 0; k < 3; k++) c[k] += p[k] / V;
  S.reconVerts = verts.map((p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
  els.reconStatus.textContent = `重建完成：${N} 帧，偏航 ${ymin.toFixed(2)}~${ymax.toFixed(2)}。可旋转查看 / 投影。`;
  buildViewer();
}

export function enterRoute(route) {
  S.route = route;
  if (route === "3d") {
    els.route3dPanel.classList.remove("hidden"); els.badge.classList.add("beta");
    S.running = false; stopSource();
    els.zoomStrip.classList.add("hidden"); els.canvas.classList.add("hidden");
    setMsg(S.reconVerts ? null : "3D Beta：请先「用示例重建」或「转头扫描」"); setLive(false, "3D Beta");
    if (S.reconVerts) buildViewer();
  } else {
    cancelAnimationFrame(S.viewerRAF);
    els.route3dPanel.classList.add("hidden"); els.badge.classList.remove("beta");
    els.three.classList.add("hidden"); els.canvas.classList.remove("hidden");
    if (S.zoom) els.zoomStrip.classList.remove("hidden");
    stopSource(); S.running = false;
    setMsg("点击「摄像头」或「上传照片 / 视频」开始"); setLive(false, "待机");
  }
}
