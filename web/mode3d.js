// 3D 重建（Beta）：转头扫描/示例重建 → 旋转查看 → 相似变换投影回实时画面。
import { RIGID3D } from "./constants.js";
import { assetUrls } from "./assets.js";
import { CAMERA_CONSTRAINTS, describeCameraError, openCameraStream } from "./camera.js";
import { ctx, els } from "./dom.js";
import { applySim, toPixels, umeyama } from "./geometry.js";
import { facesArray, fitExpression, fitShape, flameForward, loadFlameBasis } from "./flame_fit.js";
import { countMetric, logWarn, recordEvent, recordMetricSample } from "./logger.js";
import { ensureReady, showCameraPlaceholder, startCamera, stopSource } from "./pipeline.js";
import { modelState, reconState, renderState, sourceState } from "./state.js";
import { setLive, setMsg } from "./ui.js";

// 偏航覆盖门控：扫描结束前要求左右转头的偏航跨度（ymax-ymin）至少达到该值，
// 否则只采到近正脸样本、深度 Z 无侧脸视角约束，不同人深度剖面会趋同（见 #36）。
const YAW_SPAN_MIN = 0.5;

let canonicalRef = null;
let scanColorCanvas = null, scanColorCtx = null;
const COLOR_SAMPLE_W = 320;
const SCAN_TARGET_SECS = 9;
const SCAN_TARGET_FRAMES = 40;
const YAW_DISPLAY_SPAN = 0.5;

async function fetchCanonicalRef() {
  if (canonicalRef) return canonicalRef;
  const cv = await fetch(assetUrls.canonicalVertices).then((r) => r.json());
  canonicalRef = cv.map((p) => [p[0], -p[1], -p[2]]);  // 翻到屏幕手性 (y下,z入屏)
  return canonicalRef;
}

async function ensureHead3D() {
  if (reconState.head3d) return;
  const mod = await import("./three3d.js");
  reconState.head3d = new mod.Head3D(els.three);
  let drag = false, px = 0, py = 0;
  els.three.addEventListener("pointerdown", (e) => { drag = true; px = e.clientX; py = e.clientY; els.three.setPointerCapture(e.pointerId); });
  els.three.addEventListener("pointermove", (e) => {
    if (!drag) return;
    reconState.rot.y += (e.clientX - px) * 0.01;
    reconState.rot.x = Math.max(-1.2, Math.min(1.2, reconState.rot.x + (e.clientY - py) * 0.01));
    px = e.clientX; py = e.clientY;
  });
  els.three.addEventListener("pointerup", () => { drag = false; });
  els.three.addEventListener("pointercancel", () => { drag = false; });
  els.three.addEventListener("wheel", (e) => {
    e.preventDefault();
    reconState.head3d.zoom(Math.exp(Math.max(-160, Math.min(160, e.deltaY || 0)) * 0.001));
  }, { passive: false });
  els.three.addEventListener("dblclick", resetView3d);
}

async function buildViewer() {
  await ensureHead3D();
  const disp = reconState.reconVerts.map((p) => [p[0], -p[1], -p[2]]);  // 翻成 y 上 供查看
  reconState.head3d.setGeometry(
    disp,
    modelState.triangles,
    // setActiveAtlas() updates this shared atlas table; 3D view picks it up only when buildViewer() reruns.
    modelState.atlases[renderState.system],
    { showSurface: true, bands: renderState.bands, vertexColors: reconState.reconColors },
  );
  els.view3d.disabled = false; els.project3d.disabled = false;
  els.reset3d.disabled = false; els.cloudFitFlame.disabled = false;
  setMode3d("view");
}

export function resetView3d() {
  reconState.rot.x = 0; reconState.rot.y = 0;
  reconState.head3d?.resetView();
}

// ── 实时孪生：左实时人脸 / 右 FLAME 头随头姿转 + 浏览器本地拟合（身份 + 表情 + 张嘴）──────
// 头姿调参（这边看不到渲染，留旋钮；若「转反了」翻对应 sign）。jaw 调参见 flame_fit.js 的 JAW。
const POSE = { yawSign: 1, pitchSign: 1, pitchClamp: 1.3 };
const ZERO_BETA = new Float64Array(60);  // 标准头身份系数（全 0 = neutral 标准脸）
const EXPR_AMPLIFY = 1.3;  // 表情放大（landmark-only 拟合偏淡，放大更明显；旋钮）
let twinRAF = null, twinFaces = null, twinMeshReady = false, twinTexturedMesh = false;

export function stopTwin() {
  cancelAnimationFrame(twinRAF); twinRAF = null;
  els.mainWrap.classList.remove("twin");
}

// 「▶ 实时孪生」：加载基(一次) → 分屏 + 开摄像头(左) → 右 FLAME 头随头姿转 + 每帧本地表情/张嘴拟合。
export async function startTwin() {
  els.reconStatus.textContent = "加载 FLAME 基（约 6.9MB，仅首次）…";
  try {
    if (!reconState.flameBasis) reconState.flameBasis = await loadFlameBasis(assetUrls.flameBasis);
    if (!canonicalRef) await fetchCanonicalRef();
  } catch (err) {
    els.reconStatus.textContent = "FLAME 基加载失败：" + err.message;
    return;
  }
  const basis = reconState.flameBasis;
  twinFaces = facesArray(basis);
  twinMeshReady = false; twinTexturedMesh = false;
  reconState.flameBeta = null;  // 身份待首帧拟合
  reconState.twinMode = "individual";
  els.flameStd.checked = false;
  els.twinTexture.checked = false; reconState.twinTexture = false;
  els.flameHeadToggleWrap.style.display = "";
  els.twinTextureWrap.style.display = "";

  await ensureHead3D();
  reconState.head3d.setGeometry(
    flameForward(basis, ZERO_BETA, new Float64Array(basis.NE), 0), twinFaces, [], { showSurface: true, bands: false });
  twinMeshReady = true;

  reconState.route = "3d"; reconState.mode3d = "twin";
  els.mainWrap.classList.add("twin");
  els.canvas.classList.remove("hidden"); els.three.classList.remove("hidden");
  setLive(true, "实时孪生");
  await startCamera();  // 复用主管线：画左侧人脸 + 每帧更新 sourceState.lastLM / jawOpen
  cancelAnimationFrame(twinRAF); twinLoop();
}

// 每帧：头姿跟随 + 身份(首帧一次) + 表情拟合 + 张嘴(MediaPipe jawOpen) → FLAME 前向 → 原地更新顶点。
function twinLoop() {
  if (reconState.mode3d !== "twin" || !reconState.head3d) return;
  const lm = sourceState.lastLM, basis = reconState.flameBasis;
  if (lm && lm.length && canonicalRef && basis) {
    applyHeadPose(lm);
    if (!reconState.flameBeta) { try { reconState.flameBeta = fitShape(lm, basis).beta; } catch { /* 等下一帧 */ } }
    if (reconState.flameBeta) {
      try {
        const beta = reconState.twinMode === "standard" ? ZERO_BETA : reconState.flameBeta;
        const psi = fitExpression(lm, basis, beta).psi;
        for (let i = 0; i < psi.length; i++) psi[i] *= EXPR_AMPLIFY;  // 表情放大
        const jaw = sourceState.jawOpen || 0;
        const verts = flameForward(basis, beta, psi, jaw);
        const colors = reconState.twinTexture ? projectColors(verts, lm, basis) : null;
        const wantTextured = !!colors;
        if (twinMeshReady && wantTextured === twinTexturedMesh) {
          reconState.head3d.updateVerts(verts, colors);
        } else {
          reconState.head3d.setGeometry(verts, twinFaces, [], { showSurface: true, bands: false, vertexColors: colors });
          twinMeshReady = true; twinTexturedMesh = wantTextured;
        }
        els.reconStatus.textContent =
          `实时孪生 · ${reconState.twinMode === "standard" ? "标准" : "个体"} · 张嘴 ${Math.round(jaw * 100)}%${reconState.twinTexture ? " · 贴脸" : ""}`;
      } catch (err) {
        els.reconStatus.textContent = "拟合失败：" + err.message;
      }
    }
  }
  const tr = els.three.getBoundingClientRect();
  reconState.head3d.resize(Math.max(2, tr.width | 0), Math.max(2, tr.height | 0));
  reconState.head3d.render();
  twinRAF = requestAnimationFrame(twinLoop);
}

// 用 Umeyama(标准脸→当前关键点) 的旋转，提取 yaw/pitch 驱动右侧头（roll 暂略）。
function applyHeadPose(lm) {
  const src = RIGID3D.map((i) => canonicalRef[i]);
  const dst = RIGID3D.map((i) => lm[i]);
  let R;
  try { R = umeyama(src, dst).R; } catch { return; }
  let yaw = Math.atan2(R[0][2], R[2][2]) * POSE.yawSign;
  let pitch = Math.atan2(-R[1][2], Math.hypot(R[1][0], R[1][1])) * POSE.pitchSign;
  pitch = Math.max(-POSE.pitchClamp, Math.min(POSE.pitchClamp, pitch));
  reconState.head3d.setRotation(pitch, yaw);
}

// 「标准⇄个体」开关：仅切 twinMode，下一帧 twinLoop 自动按之渲染。
export function toggleTwinHead() {
  if (reconState.mode3d !== "twin") return;
  reconState.twinMode = els.flameStd.checked ? "standard" : "individual";
}

// 实时贴脸纹理：用 FLAME 关键点 ↔ 当前帧关键点的相似变换，把每个 FLAME 顶点投回画面、
// 采样 #canvas（左侧实时画面）的像素 → 每顶点色。轻量、配合 MediaPipe，不需要神经网络。
function projectColors(verts, lm, basis) {
  const fl = [], lv = [];
  for (let i = 0; i < basis.NL; i++) {
    const idx = basis.landmarkIndices[i];
    if (idx >= lm.length) continue;
    const f = basis.lmkFaceIdx[i], a = basis.faces[f * 3], b = basis.faces[f * 3 + 1], c = basis.faces[f * 3 + 2];
    const w0 = basis.lmkBCoords[i * 3], w1 = basis.lmkBCoords[i * 3 + 1], w2 = basis.lmkBCoords[i * 3 + 2];
    fl.push([0, 1, 2].map((x) => w0 * verts[a][x] + w1 * verts[b][x] + w2 * verts[c][x]));
    lv.push(lm[idx]);
  }
  let proj;
  try { proj = applySim(umeyama(fl, lv), verts); } catch { return null; }
  const W = els.canvas.width, H = els.canvas.height;
  let data;
  try { data = ctx.getImageData(0, 0, W, H).data; } catch { return null; }
  const out = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    const px = proj[i][0] | 0, py = proj[i][1] | 0;
    if (px >= 0 && px < W && py >= 0 && py < H) {
      const o = (py * W + px) * 4;
      out[i] = [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255];
    } else out[i] = [0.72, 0.56, 0.5];  // 投影外（背面/越界）退回中性肤色
  }
  return out;
}

// 「贴真实人脸纹理」开关（实时孪生）：下一帧 twinLoop 自动按之采样/渲染。
export function toggleTwinTexture() {
  reconState.twinTexture = els.twinTexture.checked;
}

function viewerLoop() {
  if (reconState.route !== "3d" || reconState.mode3d !== "view" || !reconState.head3d) return;
  const r = els.three.parentElement.getBoundingClientRect();
  reconState.head3d.resize(Math.max(2, r.width | 0), Math.max(2, r.height | 0));
  reconState.head3d.setRotation(reconState.rot.x, reconState.rot.y);
  reconState.head3d.render();
  reconState.viewerRAF = requestAnimationFrame(viewerLoop);
}

export function setMode3d(m) {
  stopTwin();  // 离开实时孪生：取消其 RAF + 撤销分屏
  reconState.mode3d = m;
  els.view3d.setAttribute("aria-pressed", String(m === "view"));
  els.project3d.setAttribute("aria-pressed", String(m === "project"));
  els.scanPanel.classList.add("hidden"); els.scanToast.classList.add("hidden");
  if (m === "view") {
    stopSource(); sourceState.running = false;
    els.canvas.classList.add("hidden"); els.three.classList.remove("hidden");
    setMsg(null); setLive(false, "3D 模型（拖拽旋转）");
    cancelAnimationFrame(reconState.viewerRAF); viewerLoop();
  } else {
    cancelAnimationFrame(reconState.viewerRAF);
    els.three.classList.add("hidden"); els.canvas.classList.remove("hidden");
    startCamera();  // 复用主循环；projectVerts 注入重建配准
  }
}

export async function loadDemoRecon() {
  els.scanPanel.classList.add("hidden"); els.scanToast.classList.add("hidden");
  els.reconStatus.textContent = "加载固定演示模型（非你的脸，仅用于体验流程）…";
  await ensureReady();
  const d = await fetch(assetUrls.reconDemo).then((r) => r.json());
  reconState.reconVerts = d.vertices; reconState.reconColors = null;
  els.reconStatus.textContent = `固定演示模型就绪（非你的脸）：${d.frames} 帧，偏航 ${d.yaw_min}~${d.yaw_max}。可旋转查看 / 投影。想重建自己的脸请用「转头扫描」。`;
  await buildViewer();
}

export async function startScan() {
  els.reconStatus.textContent = "加载模型…"; await ensureReady();
  const ref = await fetchCanonicalRef(); const refRigid = RIGID3D.map((i) => ref[i]);
  try {
    const stream = await openCameraStream(CAMERA_CONSTRAINTS);
    stopSource(); els.video.srcObject = stream; await els.video.play();
  } catch (e) {
    const detail = describeCameraError(e);
    countMetric(`scan.cameraOpenFailure.${detail.reason}`);
    logWarn("3D 扫描无法开启摄像头。", { reason: detail.reason, error: e });
    els.reconStatus.textContent = detail.message;
    els.canvas.classList.remove("hidden"); els.three.classList.add("hidden");
    showCameraPlaceholder(detail.message);
    setMsg(detail.message); setLive(false, "3D Beta");
    return;
  }
  els.canvas.width = els.video.videoWidth || 1280;
  els.canvas.height = els.video.videoHeight || 720;
  els.canvas.classList.remove("hidden"); els.three.classList.add("hidden");
  els.msg.classList.add("hidden"); els.scanPanel.classList.remove("hidden"); els.scanToast.classList.remove("hidden");
  updateScanPanel(0, 0, 0, null);
  const collected = [], colorFrames = []; const t0 = performance.now(); let ymin = 1e9, ymax = -1e9;
  reconState.scan = { active: true };
  const tick = () => {
    if (!reconState.scan || !reconState.scan.active) return;
    const t = performance.now();
    const res = modelState.landmarker.detectForVideo(els.video, t);
    const secs = (t - t0) / 1000;
    if (res.faceLandmarks && res.faceLandmarks.length) {
      const lm = toPixels(res.faceLandmarks[0], els.video.videoWidth, els.video.videoHeight).slice(0, 468);
      collected.push(applySim(umeyama(RIGID3D.map((i) => lm[i]), refRigid), lm));
      colorFrames.push(sampleFrameColors(lm));
      const nose = lm[1], cl = lm[234], cr = lm[454], yaw = (nose[0] - (cl[0] + cr[0]) / 2) / (Math.abs(cr[0] - cl[0]) || 1);
      ymin = Math.min(ymin, yaw); ymax = Math.max(ymax, yaw);
      drawScanFrame(lm, secs, collected.length, ymin, ymax);
    } else {
      drawScanFrame(null, secs, collected.length, ymin, ymax);
    }
    const yawSpan = ymax - ymin;
    const yawRange = Number.isFinite(ymin) && Number.isFinite(ymax) ? `${ymin.toFixed(2)}~${ymax.toFixed(2)}` : "等待人脸";
    els.reconStatus.textContent = `扫描中 ${secs.toFixed(1)}s：缓慢左右上下转头（已采 ${collected.length} 帧，偏航 ${yawRange} / 需跨度 ${YAW_SPAN_MIN}）`;
    updateScanPanel(secs, collected.length, yawSpan, Number.isFinite(ymin) && Number.isFinite(ymax) ? (ymin + ymax) / 2 : null);
    // 时长+帧数+偏航覆盖都满足才正常结束，确保有侧脸视角约束深度 Z（见 #36）。
    if (secs > SCAN_TARGET_SECS && collected.length > SCAN_TARGET_FRAMES && yawSpan > YAW_SPAN_MIN) { finishScan(collected, ymin, ymax, colorFrames, false, t - t0); return; }
    // 硬上限：避免偏航始终不足时无限扫描；此时仍结束，但明确标注深度置信度低。
    if (secs > 20 && collected.length > SCAN_TARGET_FRAMES) { finishScan(collected, ymin, ymax, colorFrames, yawSpan <= YAW_SPAN_MIN, t - t0); return; }
    // 时长+帧数已够、但偏航跨度仍不足：不结束，提示用户继续转头。
    if (secs > SCAN_TARGET_SECS && collected.length > SCAN_TARGET_FRAMES) {
      els.reconStatus.textContent = `请继续向左 / 右转头：当前偏航跨度 ${yawSpan.toFixed(2)}，需达到 ${YAW_SPAN_MIN} 才能完成（${secs.toFixed(1)}s，已采 ${collected.length} 帧）`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function sampleFrameColors(lm) {
  if (!scanColorCanvas) {
    scanColorCanvas = document.createElement("canvas");
    scanColorCtx = scanColorCanvas.getContext("2d", { willReadFrequently: true });
  }
  const vw = els.video.videoWidth || 1, vh = els.video.videoHeight || 1;
  const scale = Math.min(1, COLOR_SAMPLE_W / vw);
  const W = Math.max(1, Math.round(vw * scale)), H = Math.max(1, Math.round(vh * scale));
  scanColorCanvas.width = W; scanColorCanvas.height = H;
  scanColorCtx.drawImage(els.video, 0, 0, W, H);
  const data = scanColorCtx.getImageData(0, 0, W, H).data;
  return lm.map((p) => {
    const x = Math.max(0, Math.min(W - 1, Math.round(p[0] * scale)));
    const y = Math.max(0, Math.min(H - 1, Math.round(p[1] * scale)));
    const j = (y * W + x) * 4;
    return [data[j] / 255, data[j + 1] / 255, data[j + 2] / 255];
  });
}

function mergeVertexColors(colorFrames, count) {
  if (!colorFrames.length) return null;
  const out = Array.from({ length: count }, () => [0, 0, 0]);
  for (const frame of colorFrames) {
    for (let i = 0; i < count; i++) {
      out[i][0] += frame[i][0]; out[i][1] += frame[i][1]; out[i][2] += frame[i][2];
    }
  }
  return out.map((c) => c.map((v) => v / colorFrames.length));
}

function drawScanFrame(lm, secs, frames, ymin, ymax) {
  const W = els.canvas.width, H = els.canvas.height;
  ctx.drawImage(els.video, 0, 0, W, H);
  if (lm && modelState.triangles) {
    ctx.save();
    ctx.lineWidth = Math.max(0.7, W / 1800);
    ctx.strokeStyle = "rgba(86,189,242,.22)";
    for (const tri of modelState.triangles) {
      const a = lm[tri[0]], b = lm[tri[1]], c = lm[tri[2]];
      if (!a || !b || !c) continue;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath(); ctx.stroke();
    }
    ctx.fillStyle = "rgba(78,216,255,.75)";
    for (let i = 0; i < lm.length; i += 3) {
      const p = lm[i]; ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1.1, W / 1150), 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }
  const yawText = Number.isFinite(ymin) && Number.isFinite(ymax) ? `角度覆盖 ${(ymax - ymin).toFixed(2)} · ${frames} 帧` : `${frames} 帧`;
  els.scanToast.textContent = `扫描中 ${secs.toFixed(1)}s · ${yawText} · 缓慢转向另一侧`;
}

function updateScanPanel(secs, frames, yawSpan, yawMid) {
  const pct = Math.min(1, Math.max(secs / SCAN_TARGET_SECS, frames / SCAN_TARGET_FRAMES));
  els.scanProgressVal.textContent = Math.round(pct * 100) + "%";
  els.scanProgressBar.style.width = Math.round(pct * 100) + "%";
  els.scanYawVal.textContent = Number.isFinite(yawSpan) ? yawSpan.toFixed(2) : "0.00";
  const wideEnough = Number.isFinite(yawSpan) && yawSpan > YAW_DISPLAY_SPAN * 0.55;
  els.scanYawLeft.classList.toggle("active", wideEnough || (Number.isFinite(yawMid) && yawMid < -0.08));
  els.scanYawMid.classList.toggle("active", Number.isFinite(yawMid));
  els.scanYawRight.classList.toggle("active", wideEnough || (Number.isFinite(yawMid) && yawMid > 0.08));
}

function finishScan(collected, ymin, ymax, colorFrames = [], lowDepthConfidence = false, durationMs = null) {
  reconState.scan = null;
  els.scanPanel.classList.add("hidden"); els.scanToast.classList.add("hidden");
  const N = collected.length, V = 468, verts = [];
  const med = (k) => { k.sort((a, b) => a - b); return k[(k.length - 1) >> 1]; };
  for (let v = 0; v < V; v++) {
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < N; i++) { xs.push(collected[i][v][0]); ys.push(collected[i][v][1]); zs.push(collected[i][v][2]); }
    verts.push([med(xs), med(ys), med(zs)]);
  }
  const c = [0, 0, 0]; for (const p of verts) for (let k = 0; k < 3; k++) c[k] += p[k] / V;
  reconState.reconVerts = verts.map((p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
  reconState.reconColors = mergeVertexColors(colorFrames, V);
  const yawSpan = ymax - ymin;
  const scanDetail = {
    phase: "scan",
    frames: N,
    yawMin: ymin,
    yawMax: ymax,
    yawSpan,
    lowDepthConfidence,
  };
  if (Number.isFinite(durationMs)) {
    scanDetail.durationMs = Number(durationMs.toFixed(2));
    recordMetricSample("scan.durationMs", scanDetail.durationMs, scanDetail);
  }
  recordEvent("scan.finished", scanDetail);
  els.reconStatus.textContent = lowDepthConfidence
    ? `重建完成（深度置信度低：偏航跨度 ${(ymax - ymin).toFixed(2)} < ${YAW_SPAN_MIN}，缺侧脸视角，深度不可靠）：${N} 帧。可旋转查看 / 投影。`
    : `重建完成：${N} 帧，偏航 ${ymin.toFixed(2)}~${ymax.toFixed(2)}。可旋转查看 / 投影。`;
  buildViewer();
}

export function enterRoute(route) {
  stopTwin();
  reconState.route = route;
  els.scanPanel.classList.add("hidden"); els.scanToast.classList.add("hidden");
  if (route === "3d") {
    els.route3dPanel.classList.remove("hidden"); els.badge.classList.add("beta");
    sourceState.running = false; stopSource();
    els.zoomStrip.classList.add("hidden"); els.canvas.classList.add("hidden");
    setMsg(reconState.reconVerts ? null : "3D Beta：请先「用示例重建」或「转头扫描」"); setLive(false, "3D Beta");
    if (reconState.reconVerts) buildViewer();
  } else {
    reconState.scan = null;
    cancelAnimationFrame(reconState.viewerRAF);
    els.route3dPanel.classList.add("hidden"); els.badge.classList.remove("beta");
    els.three.classList.add("hidden"); els.canvas.classList.remove("hidden");
    els.reset3d.disabled = true;
    if (renderState.zoom) els.zoomStrip.classList.remove("hidden");
    stopSource(); sourceState.running = false;
    setMsg("点击「摄像头」或「上传照片 / 视频」开始"); setLive(false, "待机");
  }
}
