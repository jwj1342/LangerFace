// 浏览器实时管线 + 仪表盘 UI。
// 摄像头/上传 → MediaPipe FaceLandmarker(客户端) → 平滑 → 图谱映射 → 背面剔除 → 画布叠加。
import { FaceLandmarker, HandLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
import { toPixels, mapAtlas, visibleTriangles, noseTriangles, OneEuro, visibleRuns,
         buildHandMasks, pointInHandMasks, umeyama, applySim }
  from "./geometry.js";
// three3d.js（含 Three.js CDN）按需动态加载，避免影响默认 2D 路线。

const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
// 单色（按模板）；开启分区着色时按面部上/中/下分色
const SOLID = { rstl: "#c026d3", langer: "#06b6d4" };
const BAND = { top: "#f0c24b", mid: "#56bdf2", low: "#3fd39c" };

// 细节放大窗：关键手术参考区域（用 MediaPipe 关键点索引界定）
const ZOOM_REGIONS = [
  { label: "额·眉间", idx: [10, 151, 9, 8, 107, 336, 69, 299] },
  { label: "右眼周", idx: [33, 133, 159, 145, 153, 246, 7, 163] },
  { label: "左眼周", idx: [362, 263, 386, 374, 380, 466, 249, 390] },
  { label: "鼻·鼻唇沟", idx: [1, 4, 98, 327, 205, 425, 2, 94] },
  { label: "口周", idx: [61, 291, 0, 17, 13, 14, 40, 270] },
  { label: "颏部", idx: [152, 377, 148, 176, 400, 378, 149, 365] },
];

const $ = (id) => document.getElementById(id);
const els = {
  video: $("video"), canvas: $("canvas"), msg: $("overlayMsg"),
  upload: $("uploadBtn"), file: $("fileInput"),
  cam: $("camBtn"), pause: $("pauseBtn"), export: $("exportBtn"),
  tmpl: $("templateSel"), density: $("density"), smooth: $("smooth"), opacity: $("opacity"),
  densityVal: $("densityVal"), smoothVal: $("smoothVal"), opacityVal: $("opacityVal"),
  clip: $("clip"), handOcc: $("handOcc"), mirror: $("mirror"), bands: $("bands"),
  zoom: $("zoom"), zoomStrip: $("zoomStrip"), meshPts: $("meshPts"),
  routeSel: $("routeSel"), route3dPanel: $("route3dPanel"), reconDemo: $("reconDemoBtn"),
  reconScan: $("reconScanBtn"), view3d: $("view3dBtn"), project3d: $("project3dBtn"),
  reconStatus: $("reconStatus"), three: $("three"),
  badge: $("modelBadge"), live: $("livePill"), fps: $("fps"),
  qualityVal: $("qualityVal"), qualityBar: $("qualityBar"),
  statState: $("statState"), statFace: $("statFace"), statYaw: $("statYaw"), statLines: $("statLines"),
};
const ctx = els.canvas.getContext("2d");

const S = {
  system: "rstl", clip: true, handOcc: true, mirror: true, bands: true, zoom: true, meshPts: false,
  zoomCards: [],
  densityFrac: 1, smoothLevel: 0.6, opacity: 0.92,
  landmarker: null, handLandmarker: null, triangles: null, noseTris: null, atlases: {},
  smoother: new OneEuro({ minCutoff: 1.5, beta: 0.05 }),
  source: null, sourceKind: null,      // 'camera' | 'video' | 'image'
  running: false, paused: false, presence: 0,
  lastLM: null, imageCacheLM: null, imageHulls: null, recorder: null, chunks: [],
  // 3D Beta
  route: "2d", head3d: null, reconVerts: null, mode3d: "view",
  viewerRAF: null, rot: { x: 0, y: 0 }, scan: null,
};

// ── 资产 / 模型加载 ───────────────────────────────────────────────────────────
async function ensureReady() {
  if (S.landmarker) return;
  const [tri, rstl, langer] = await Promise.all([
    fetch("assets/triangles.json").then((r) => r.json()),
    fetch("assets/atlas_rstl.json").then((r) => r.json()),
    fetch("assets/atlas_langer.json").then((r) => r.json()),
  ]);
  S.triangles = tri; S.noseTris = noseTriangles(tri);
  S.atlases.rstl = rstl.lines; S.atlases.langer = langer.lines;
  const resolver = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const build = (delegate) => FaceLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: "assets/face_landmarker.task", delegate },
    runningMode: "VIDEO", numFaces: 1,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { S.landmarker = await build("GPU"); }
  catch { S.landmarker = await build("CPU"); }

  // 手部检测器（用于前方手部遮挡）。失败不阻塞主流程。
  const buildHand = (delegate) => HandLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: "assets/hand_landmarker.task", delegate },
    runningMode: "VIDEO", numHands: 2,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { S.handLandmarker = await buildHand("GPU"); }
  catch { try { S.handLandmarker = await buildHand("CPU"); } catch (e) { console.warn("手部模型加载失败", e); } }

  els.badge.textContent = "模型就绪"; els.badge.classList.remove("loading");
}

// 检测手部 → 凸包列表（图像空间），落在其中的脸部线点将被剔除
function detectHands(t, W, H) {
  if (!S.handOcc || !S.handLandmarker) return [];
  const hr = S.handLandmarker.detectForVideo(S.source, t);
  if (!hr.landmarks || !hr.landmarks.length) return [];
  const margin = Math.max(5, W * 0.006);
  return buildHandMasks(hr.landmarks.map((h) => toPixels(h, W, H)), 0.16, margin);
}

// ── 数据源 ────────────────────────────────────────────────────────────────────
async function startCamera() {
  if (S.sourceKind === "camera") { stopSource(); setLive(false, "待机"); els.cam.setAttribute("aria-pressed","false"); return; }
  setMsg("加载模型…");
  try {
    await ensureReady();
    setMsg("请求摄像头权限…");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false });
    stopSource();
    els.video.srcObject = stream; await els.video.play();
    setSource(els.video, "camera", els.video.videoWidth, els.video.videoHeight);
    els.cam.setAttribute("aria-pressed", "true");
  } catch (e) { setMsg("无法开启摄像头：" + e.message); }
}

async function handleFile(file) {
  if (!file) return;
  setMsg("加载模型…"); await ensureReady();
  stopSource();
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) {
    const img = new Image(); img.src = url; await img.decode();
    S.imageCacheLM = null;
    setSource(img, "image", img.naturalWidth, img.naturalHeight);
  } else {
    els.video.srcObject = null; els.video.src = url; els.video.loop = true; await els.video.play();
    setSource(els.video, "video", els.video.videoWidth, els.video.videoHeight);
  }
  els.cam.setAttribute("aria-pressed", "false");
}

function setSource(src, kind, w, h) {
  S.source = src; S.sourceKind = kind;
  els.canvas.width = w || 1280; els.canvas.height = h || 720;
  S.smoother.reset(); S.presence = 0; S.running = true; S.paused = false;
  els.pause.disabled = false; els.export.disabled = false; els.pause.textContent = "⏸ 暂停";
  setMsg(null); setLive(true, kind === "camera" ? "实时摄像头" : kind === "video" ? "视频" : "照片");
  requestAnimationFrame(loop);
}

function stopSource() {
  const ms = els.video.srcObject;
  if (ms) ms.getTracks().forEach((t) => t.stop());
  els.video.srcObject = null; els.video.removeAttribute("src");
  S.source = null; S.sourceKind = null; S.running = false;
}

// ── 主循环 ────────────────────────────────────────────────────────────────────
let fpsEMA = 0, lastT = performance.now();
function loop() {
  if (!S.running || S.paused) return;
  const W = els.canvas.width, H = els.canvas.height;
  ctx.drawImage(S.source, 0, 0, W, H);
  const t = performance.now();

  let lm = null, hulls = [];
  if (S.sourceKind === "image") {
    if (!S.imageCacheLM) {
      const res = S.landmarker.detectForVideo(S.source, t);
      S.imageCacheLM = (res.faceLandmarks && res.faceLandmarks[0]) ? toPixels(res.faceLandmarks[0], W, H) : null;
      S.imageHulls = detectHands(t, W, H);
    }
    lm = S.imageCacheLM; hulls = S.imageHulls || [];
    S.presence = lm ? 1 : 0;
  } else if (S.source.currentTime !== undefined) {
    const res = S.landmarker.detectForVideo(S.source, t);
    if (res.faceLandmarks && res.faceLandmarks.length) {
      lm = toPixels(res.faceLandmarks[0], W, H);
      if (S.smoothLevel > 0) lm = S.smoother.filter(lm, t / 1000);
      S.lastLM = lm; S.presence = Math.min(1, S.presence + 0.34);
    } else {
      S.presence = Math.max(0, S.presence - 0.16);
      if (S.presence <= 0) { S.smoother.reset(); S.lastLM = null; }
      lm = S.lastLM;
    }
    hulls = detectHands(t, W, H);
  }

  let lineCount = 0;
  if (lm && S.presence > 0) { const dlm = projectVerts(lm); lineCount = draw(dlm, W, H, hulls); drawZooms(dlm, W); }
  else clearZooms();
  updateStats(lm, W, H, lineCount);

  const now = performance.now();
  fpsEMA = fpsEMA ? fpsEMA * 0.9 + (1000 / Math.max(1, now - lastT)) * 0.1 : 30;
  lastT = now; els.fps.textContent = fpsEMA.toFixed(0) + " fps";
  requestAnimationFrame(loop);
}

// ── 渲染 ──────────────────────────────────────────────────────────────────────
function faceBBox(lm) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of lm) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function draw(lm, W, H, masks = []) {
  const atlas = S.atlases[S.system];
  const vis = S.clip ? visibleTriangles(lm, S.triangles, S.noseTris) : null;
  const mapped = mapAtlas(atlas, lm, S.triangles);
  const bb = faceBBox(lm);
  const stride = Math.max(1, Math.round(100 / (S.densityFrac * 100)));
  const hasMasks = masks.length > 0;

  ctx.save();
  ctx.globalAlpha = S.opacity; ctx.lineWidth = Math.max(1, W / 1300);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  let count = 0;
  for (let li = 0; li < mapped.length; li++) {
    if (li % stride !== 0) continue;
    const ln = mapped[li];
    if (S.bands) {
      let my = 0; for (const p of ln.pts) my += p[1]; my = (my / ln.pts.length - bb.y0) / (bb.h || 1);
      ctx.strokeStyle = my < 0.36 ? BAND.top : my < 0.66 ? BAND.mid : BAND.low;
    } else ctx.strokeStyle = SOLID[S.system];
    // 每点可见性 = 朝向相机(背面剔除) 且 不在前方手部凸包内
    const mask = ln.pts.map((p, i) => {
      const v = vis ? vis[ln.tris[i]] : 1;
      return v && !(hasMasks && pointInHandMasks(p, masks)) ? 1 : 0;
    });
    for (const run of visibleRuns(ln.pts, mask)) {
      ctx.beginPath(); ctx.moveTo(run[0][0], run[0][1]);
      for (let i = 1; i < run.length; i++) ctx.lineTo(run[i][0], run[i][1]);
      ctx.stroke();
    }
    count++;
  }
  if (S.meshPts) {
    ctx.globalAlpha = Math.min(1, S.opacity); ctx.fillStyle = "rgba(255,255,255,.55)";
    for (let i = 0; i < lm.length; i += 2) {
      if (hasMasks && pointInHandMasks(lm[i], masks)) continue;
      ctx.beginPath(); ctx.arc(lm[i][0], lm[i][1], Math.max(1, W / 1100), 0, 6.283); ctx.fill();
    }
  }
  ctx.restore();
  return count;
}

// ── 细节放大窗 ────────────────────────────────────────────────────────────────
function buildZoomCards() {
  els.zoomStrip.innerHTML = "";
  S.zoomCards = ZOOM_REGIONS.map((r) => {
    const card = document.createElement("div"); card.className = "zoom-card";
    const cv = document.createElement("canvas"); cv.width = 300; cv.height = 300;
    if (S.mirror) cv.classList.add("mirror");
    const tag = document.createElement("div"); tag.className = "tag"; tag.textContent = r.label;
    card.appendChild(cv); card.appendChild(tag); els.zoomStrip.appendChild(card);
    return { region: r, canvas: cv, ctx: cv.getContext("2d") };
  });
}

function clearZooms() {
  for (const zc of S.zoomCards) { zc.ctx.fillStyle = "#05070a"; zc.ctx.fillRect(0, 0, zc.canvas.width, zc.canvas.height); }
}

// 从已叠加线条的主画布上裁剪关键区域并放大到各窗口（线条随之放大显示）
function drawZooms(lm, W) {
  if (!S.zoom || !S.zoomCards.length) return;
  const faceW = faceBBox(lm).w || W;
  for (const zc of S.zoomCards) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const i of zc.region.idx) {
      const p = lm[i]; if (!p) continue;
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    if (x1 < x0) continue;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let s = Math.max(x1 - x0, y1 - y0) * 1.7;
    s = Math.max(s, faceW * 0.13);   // 避免过度放大、保留一点周边
    const g = zc.ctx, dw = zc.canvas.width, dh = zc.canvas.height;
    g.fillStyle = "#05070a"; g.fillRect(0, 0, dw, dh);
    g.drawImage(els.canvas, cx - s / 2, cy - s / 2, s, s, 0, 0, dw, dh);
  }
}

// ── 统计 ──────────────────────────────────────────────────────────────────────
function updateStats(lm, W, H, lineCount) {
  const q = Math.round(S.presence * 100);
  els.qualityVal.textContent = q; els.qualityBar.style.width = q + "%";
  if (!lm || S.presence <= 0) {
    els.statState.textContent = S.running ? "搜索中" : "未开始";
    els.statFace.textContent = els.statYaw.textContent = els.statLines.textContent = "—";
    setLive(S.running && S.sourceKind === "camera", S.running ? els.live.dataset.k || "运行中" : "待机");
    return;
  }
  els.statState.textContent = S.presence > 0.85 ? "稳定" : "搜索中";
  const bb = faceBBox(lm);
  els.statFace.textContent = Math.round(100 * (bb.w * bb.h) / (W * H)) + "%";
  // 偏航估计：鼻尖相对两颊中点的水平偏移 / 脸宽
  const nose = lm[1], cheekL = lm[234], cheekR = lm[454];
  const cx = (cheekL[0] + cheekR[0]) / 2, fw = Math.abs(cheekR[0] - cheekL[0]) || 1;
  els.statYaw.textContent = ((nose[0] - cx) / fw).toFixed(2);
  els.statLines.textContent = lineCount;
}

// ── UI 绑定 ───────────────────────────────────────────────────────────────────
function setMsg(t) { if (t == null) els.msg.classList.add("hidden"); else { els.msg.textContent = t; els.msg.classList.remove("hidden"); } }
function setLive(on, label) { els.live.dataset.k = label; els.live.classList.toggle("on", !!on); els.live.innerHTML = `<span class="dot"></span>${label}`; }
function smoothLabel(v) { return v === 0 ? "关" : v < 35 ? "弱" : v < 70 ? "中" : "强"; }

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

// ── 3D 重建（Beta）────────────────────────────────────────────────────────────
const RIGID3D = [33, 263, 133, 362, 168, 6, 195, 5, 4, 1, 10, 152, 234, 454, 127, 356];
let canonicalRef = null;

async function fetchCanonicalRef() {
  if (canonicalRef) return canonicalRef;
  const cv = await fetch("assets/canonical_vertices.json").then((r) => r.json());
  canonicalRef = cv.map((p) => [p[0], -p[1], -p[2]]);  // 翻到屏幕手性 (y下,z入屏)
  return canonicalRef;
}

// 投影模式：把重建网格用相似变换刚性配准到当前帧的活体关键点，返回贴合的网格顶点
function projectVerts(lm) {
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

function setMode3d(m) {
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

async function loadDemoRecon() {
  els.reconStatus.textContent = "加载示例重建（基于你的视频）…";
  await ensureReady();
  const d = await fetch("assets/recon_demo.json").then((r) => r.json());
  S.reconVerts = d.vertices;
  els.reconStatus.textContent = `示例重建就绪：${d.frames} 帧，偏航 ${d.yaw_min}~${d.yaw_max}。可旋转查看 / 投影。`;
  await buildViewer();
}

async function startScan() {
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

function enterRoute(route) {
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

els.routeSel.onchange = (e) => enterRoute(e.target.value);
els.reconDemo.onclick = loadDemoRecon;
els.reconScan.onclick = startScan;
els.view3d.onclick = () => { if (S.reconVerts) setMode3d("view"); };
els.project3d.onclick = () => { if (S.reconVerts) setMode3d("project"); };

// 初始化
buildZoomCards();
els.smoothVal.textContent = smoothLabel(+els.smooth.value);
S.smoother.minCutoff = 6.0 - 5.5 * S.smoothLevel; S.smoother.beta = 0.02 + 0.06 * S.smoothLevel;
ensureReady().catch((e) => { els.badge.textContent = "模型加载失败"; console.error(e); });
