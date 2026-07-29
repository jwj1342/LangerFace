/**
 * 表情 atlas 微调 Demo — 浏览器引导采集 UI / 会话
 *
 * 文档：docs/PERSONALIZED_RSTL.md
 * 算法：采集/质控 ./prstl_pipeline.js；皱纹检测 ./yolo_wrinkle_onnx.js；个性化 ./v6_rstl_refinement.js
 * 定位：非个体 RSTL 测量
 *
 * 分区：
 *   1. 常量与 DOM
 *   2. 侧栏引导 / 步骤 / 按钮状态
 *   3. Canonical 裁剪与图像工具
 *   4. 先验 vs 微调对比与导出
 *   5. 每步融合 commitCycle + 动作状态机
 *   6. 主循环 tick / runSession
 *   7. 3-2-1 倒计时与开停摄像头
 */
import { FaceLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
import {
  toPixels, OneEuro, mapAtlas,
} from "./geometry.js";
import {
  SIZE, TEXTURE_SIZE, ACTION_ORDER, ACTION_LABELS, ACTION_REGION_WEIGHT, THRESHOLDS, QUALITY_THRESHOLDS, REFINE_CONF, TIMED_ACTIONS,
  CANONICAL_REGISTRATION_ANCHORS,
  buildMasks, buildMasksFromMesh, buildRegionMasks, actionRegionField, chooseNextAction, estimatePoseQuality,
  warpToCanonical, landmarksToCanonicalXY, pointToBary,
  textureOrientation, downsampleAxialEvidence, downsampleGray, temporalMedianGray,
  actionMeshResidual, estimateReturnMeshThreshold,
  blockMatchFlow, meshDeformationSupport, rasterizePrior, evaluateQualityGate,
  pickBestFrames, decideRepeatability, createSessionState, blendDict, actionScore,
  summarizeWeightedField, summarizeCurveDisplacements, axialDiffDeg,
  relativeScore, estimateBaseline, personalThreshold,
  dominantExpression, NEUTRAL_MAX,
} from "./prstl_pipeline.js";
import { adaptiveFaceResolutionMetrics } from "./camera_adaptive.js";
import {
  BOTTOM_UP_PARAMETER_VERSION,
  BOTTOM_UP_PERSONALIZATION_VERSION,
  buildStaticHessianTextureTemplate,
  validateHessianTemplateWithAction,
} from "./bottom_up_personalization.js";
import { smoothProjectedCurveV2 } from "./prstl_personalization_v2.js";
import { dataSource } from "./data_source.js";
import { WrinkleYoloOnnx, fuseStrictUnion } from "./yolo_wrinkle_onnx.js";
import { refineV6 } from "./v6_rstl_refinement.js";
import personalizedAtlasUrl from "../../assets/atlas_rstl.json?url";
import faceLandmarkerUrl from "../../assets/face_landmarker.task?url";
import trianglesUrl from "../../assets/triangles.json?url";

// ── 1. 常量与 DOM ───────────────────────────────────────────────────────────
const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
const $ = (id) => document.getElementById(id);

const ACTION_HINT = {
  raise_brows: "慢慢把眉毛往上抬，像惊讶一样，保持住",
  frown: "皱起眉头，两眉向中间靠拢，保持约 1 秒",
  squint: "双眼轻轻眯起，保持眼球和眼裂仍可见；不要闭眼、低头或挤鼻子",
  smile: "自然微笑，嘴角上扬，保持住",
  puff: "鼓起两边脸颊（像含着空气），保持约 1 秒即可",
  purse: "撅起嘴唇，像吹口哨，保持约 1 秒即可",
  open_mouth: "张大嘴，保持住，然后慢慢合上",
};

const PHASE_TEXT = {
  paused: "本步已完成，点击下方按钮开始下一步",
  countdown: "倒计时结束后开始做动作",
  onset: "开始做动作…",
  apex: "保持这个表情！",
  offset: "很好，慢慢放松回来",
  processing: "正在融合本步证据…",
};

// 降低阈值，便于普通摄像头采集（THRESHOLDS 来自 pipeline）
const HOLD_NEED = 0.75; // 秒
const NEUTRAL_NEED = 15;
const CYCLES_REQUIRED = 1;
// 眯眼时眼睑遮挡会让 FaceLandmarker 的短时 tracking/illumination
// 评分下降；仍保留峰值帧要求，只对这一路放宽稳定性门槛。
const SQUINT_QUALITY_THRESHOLDS = Object.freeze({
  ...QUALITY_THRESHOLDS,
  tracking: 0.50,
  illumination: 0.40,
  minPeakFrames: 3,
});
// 皱眉会改变眉间与眼周的几何形状，手机端 FaceLandmarker 的跟踪和
// 光照评分也更容易在这个动作期间下降。仍保留有效帧门槛，但不要让
// 一个弱视觉信号把用户永久卡在“采集失败”。
const FROWN_QUALITY_THRESHOLDS = Object.freeze({
  ...QUALITY_THRESHOLDS,
  tracking: 0.50,
  illumination: 0.45,
  minPeakFrames: 3,
});
const YOLO_CONFIDENCE = 0.07;
const REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO = 0.018;
const FROWN_REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO = 0.025;
const SMILE_REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO = 0.030;
const RESIDUAL_FLOW_SEARCH_FACE_RATIO = 0.014;
const RESIDUAL_FLOW_MAX_SHIFT_FACE_RATIO = 0.018;
const UNION_DEGHOST_RADIUS_FACE_RATIO = 0.014;
const EXPRESSION_VISUAL_SIGNAL_MIN = 0.08;
// Keep a low spatial floor, then use the gate value as a confidence weight.
// This preserves thin expression wrinkles near an ROI boundary without
// reopening the skin/forbidden anatomical gates.
const REGION_GATE_THRESHOLD = 0.08;
const ACTIVE_ATLAS_VERSION = "0.2";
const ACTIVE_TOPOLOGY_ID = "mediapipe-468";
const ACTIVE_TOPOLOGY_VERSION = "mediapipe-canonical-468-v1";

const els = {
  start: $("startBtn"), stop: $("stopBtn"), skip: $("skipBtn"), confirm: $("confirmBtn"), debug: $("debugBtn"),
  recordDebugMedia: $("recordDebugMedia"), debugMediaStatus: $("debugMediaStatus"), debugMediaExports: $("debugMediaExports"),
  discardDebugMedia: $("discardDebugMediaBtn"),
  msg: $("msg"), badge: $("badge"), live: $("live"), fps: $("fps"),
  guideTitle: $("guideTitle"), guideSub: $("guideSub"),
  scoreVal: $("scoreVal"), scoreFill: $("scoreFill"),
  holdVal: $("holdVal"), holdFill: $("holdFill"),
  steps: $("steps"), exports: $("exports"), compareSummary: $("compareSummary"), compareCanvas: $("compareCanvas"),
  wrinkleMaskPanel: $("wrinkleMaskPanel"), wrinkleMaskCanvas: $("wrinkleMaskCanvas"),
  wrinkleMaskDownload: $("wrinkleMaskDownloadBtn"), wrinkleSemanticCanvas: $("wrinkleSemanticCanvas"),
  wrinkleSemanticDownload: $("wrinkleSemanticDownloadBtn"),
  wrinkleAlignmentCanvas: $("wrinkleAlignmentCanvas"), wrinkleAlignmentDownload: $("wrinkleAlignmentDownloadBtn"),
  wrinkleEvidenceCanvas: $("wrinkleEvidenceCanvas"), wrinkleEvidenceDownload: $("wrinkleEvidenceDownloadBtn"),
  localPipelineStatus: $("localPipelineStatus"), localPipelineProgress: $("localPipelineProgress"),
  usePersonalized: $("usePersonalizedBtn"),
  liveWorkspace: $("liveWorkspace"), liveWorkspaceFrame: $("liveWorkspaceFrame"),
  closeLiveWorkspace: $("closeLiveWorkspaceBtn"),
  video: $("video"), view: $("view"), boot: $("boot"),
  countdown: $("countdown"), countNum: $("countNum"), countTip: $("countTip"),
  coach: $("coach"), coachTitle: $("coachTitle"), coachSub: $("coachSub"), coachBar: $("coachBar"),
};
const ctx = els.view.getContext("2d", { willReadFrequently: true });

let landmarker = null, triangles = null, atlasLines = null;
let smoother = new OneEuro({ minCutoff: 1.8, beta: 0.04 });
let stream = null, looping = false, sess = null;
let t0 = performance.now(), frames = 0;
let lastEvidenceT = 0, processing = false;
let retainedMediaUrls = [];
let wrinkleYolo = null;
/** Survives sess=null so the completed V6 atlas can enter the inline live workspace. */
let personalizedAtlasStaged = false;
let personalizedActiveAtlas = null;

// ── 2. 侧栏引导 / 步骤 / 按钮状态 ───────────────────────────────────────────
function setLive(on) {
  els.live.innerHTML = `<span class="dot"></span>${on ? "采集中" : "待机"}`;
  els.live.classList.toggle("on", on);
}
function setMsg(t, warn = false) {
  els.msg.textContent = t || "";
  els.msg.classList.toggle("warn", !!warn);
}
function setMeters(score01, hold01) {
  const s = Math.max(0, Math.min(1, score01 || 0));
  const h = Math.max(0, Math.min(1, hold01 || 0));
  els.scoreFill.style.width = `${(s * 100).toFixed(0)}%`;
  els.holdFill.style.width = `${(h * 100).toFixed(0)}%`;
  els.scoreVal.textContent = `${(s * 100).toFixed(0)}%`;
  els.holdVal.textContent = `${(h * 100).toFixed(0)}%`;
  els.coachBar.style.width = `${(h * 100).toFixed(0)}%`;
}
function setLocalPipelineStatus(text, progress = 0, tone = "") {
  if (els.localPipelineStatus) {
    els.localPipelineStatus.textContent = text || "";
    els.localPipelineStatus.dataset.tone = tone;
  }
  if (els.localPipelineProgress) {
    els.localPipelineProgress.value = Math.max(0, Math.min(100, Math.round(progress)));
  }
}
function renderSteps() {
  const rows = [{ id: "neutral", label: "静息基线" }, ...ACTION_ORDER.map((a) => ({ id: a, label: ACTION_LABELS[a] }))];
  const done = new Set(sess?.done || []);
  const cur = !sess ? null
    : sess.stage === "neutral" ? "neutral"
      : sess.stage === "done" ? null
        : ACTION_ORDER[sess.actionIndex];
  els.steps.innerHTML = rows.map((r, i) => {
    let cls = "step";
    if (r.id === "neutral" && sess && sess.stage !== "neutral") cls += " done";
    if (done.has(r.id)) cls += " done";
    if (r.id === cur) cls += " current";
    return `<div class="${cls}"><span class="n">${i + 1}</span><span>${r.label}</span></div>`;
  }).join("");
}
function syncStartButton() {
  if (!sess || !stream) {
    els.start.disabled = false;
    els.start.textContent = "开始采集";
    if (els.confirm) els.confirm.disabled = true;
    return;
  }
  if (sess.stage === "done") {
    els.start.disabled = true;
    els.start.textContent = "已完成";
    if (els.confirm) els.confirm.disabled = true;
    return;
  }
  if (sess.stage === "neutral") {
    els.start.disabled = true;
    els.start.textContent = "静息采集中…";
    if (els.confirm) els.confirm.disabled = true;
    return;
  }
  if (sess.stage === "actions" && (sess.phase === "paused" || sess.phase === "countdown")) {
    const a = ACTION_ORDER[sess.actionIndex];
    const label = ACTION_LABELS[a] || "";
    if (sess.phase === "countdown") {
      els.start.disabled = true;
      els.start.textContent = "倒计时中…";
      if (els.confirm) els.confirm.disabled = true;
      return;
    }
    els.start.disabled = false;
    els.start.textContent = sess.retryCurrent ? `重新采集：${label}` : `下一步：${label}`;
    if (els.confirm) els.confirm.disabled = true;
    return;
  }
  els.start.disabled = true;
  const a = ACTION_ORDER[sess.actionIndex];
  els.start.textContent = a ? `采集中：${ACTION_LABELS[a]}` : "采集中…";
  // 采集中可手动确认（鼓腮等难检测动作）
  if (els.confirm) {
    els.confirm.disabled = !["onset", "apex"].includes(sess.phase) || processing;
  }
}

function updateGuide() {
  if (!sess) {
    els.guideTitle.textContent = "准备开始";
    els.guideSub.textContent = "点击下方按钮开启摄像头";
    els.coach.classList.add("hidden");
    syncStartButton();
    renderSteps();
    return;
  }
  if (sess.stage === "neutral") {
    const n = sess.neutralFrames?.length || 0;
    els.guideTitle.textContent = "① 静息采集";
    els.guideSub.textContent = "正对镜头，放松面部，不要笑、不要抬眉";
    els.coach.classList.remove("hidden");
    els.coachTitle.textContent = "放松";
    els.coachSub.textContent = `采集中 ${Math.min(n, NEUTRAL_NEED)}/${NEUTRAL_NEED}`;
    setMeters(0, Math.min(1, n / NEUTRAL_NEED));
  } else if (sess.stage === "actions") {
    const a = ACTION_ORDER[sess.actionIndex];
    const label = ACTION_LABELS[a] || "";
    const phase = sess.phase;
    if (phase === "paused") {
      const verb = sess.retryCurrent ? "重新采集" : "单次采集";
      els.guideTitle.textContent = `${label} · ${verb}`;
      els.guideSub.textContent = "点击后倒计时；完成动作并保持到进度结束，即提交该表情";
      els.coach.classList.remove("hidden");
      els.coachTitle.textContent = label;
      els.coachSub.textContent = ACTION_HINT[a] || "点击下方按钮开始";
      setMeters(0, 0);
    } else if (phase === "countdown") {
      els.guideTitle.textContent = label;
      els.guideSub.textContent = "倒计时结束后开始做动作";
      els.coach.classList.add("hidden");
    } else {
      els.guideTitle.textContent = `${label} · 采集中`;
      els.guideSub.textContent = ACTION_HINT[a] || "";
      els.coach.classList.remove("hidden");
      els.coachTitle.textContent = label;
      els.coachSub.textContent = PHASE_TEXT[phase] || ACTION_HINT[a];
    }
  } else if (sess.stage === "done") {
    els.guideTitle.textContent = "采集完成 · 对比结果";
    els.guideSub.textContent = "绿色=皱纹严格并集，灰色=初始 RSTL，洋红=V6 个性化 RSTL，青色=法向位移";
    els.coach.classList.add("hidden");
    setMeters(0, 1);
  }
  syncStartButton();
  renderSteps();
}

// ── 3. Canonical warp 与图像工具 ────────────────────────────────────────────
/**
 * 分片仿射把当前帧 warp 到固定 refMesh（canonical）。
 * 关键：无论相机平移/缩放，同一张脸都落到同一 canonical 坐标，
 * 因此背景图与 refMesh 坐标系里的种子/曲线始终对齐（修复坐标漂移）。
 * refMesh 在静息期一次性锁定后不再更改；重设会让已累计的方向场/曲线失去坐标依据。
 */
function stableRegistrationMetrics(reference, aligned, faceWidth = SIZE * 0.72) {
  if (!reference?.length || !aligned?.length) {
    return { medianPx: Infinity, p90Px: Infinity, limitPx: Infinity, ok: false };
  }
  const distances = CANONICAL_REGISTRATION_ANCHORS
    .filter((index) => reference[index] && aligned[index])
    .map((index) => Math.hypot(
      aligned[index][0] - reference[index][0],
      aligned[index][1] - reference[index][1],
    ))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (distances.length < 3) {
    return { medianPx: Infinity, p90Px: Infinity, limitPx: Infinity, ok: false };
  }
  const at = (fraction) => distances[Math.min(distances.length - 1,
    Math.max(0, Math.round((distances.length - 1) * fraction)))];
  const limitPx = Math.max(2.5, REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO * faceWidth);
  const p90Px = at(0.90);
  return {
    medianPx: at(0.50),
    p90Px,
    maximumPx: distances[distances.length - 1],
    limitPx,
    normalizedP90: p90Px / Math.max(1, faceWidth),
    ok: p90Px <= limitPx,
  };
}

function buildExpressionRegionGate(expression, session = sess) {
  const pixels = SIZE * SIZE;
  const skin = session?.skin;
  if (!skin?.length || skin.length !== pixels) return null;
  if (expression === "neutral") return Uint8Array.from(skin, (value) => value ? 1 : 0);
  const field = actionRegionField(expression, session.regionMasks, SIZE);
  const gate = new Float32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const value = Number(field?.[index] || 0);
    if (skin[index] && value >= REGION_GATE_THRESHOLD) gate[index] = value;
  }
  return gate;
}

function warpFrameToRef(lmPx, size = SIZE) {
  if (!sess?.refMesh) return null;
  try {
    const target = size === TEXTURE_SIZE ? sess.refMeshHi : sess.refMesh;
    return warpToCanonical(els.video, lmPx, target, triangles, size);
  } catch (_) {
    return null;
  }
}

function grayFromImageData(img) {
  const g = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  return g;
}
function boxBlurGray(source, size, radius = 4) {
  if (!source || source.length !== size * size || radius < 1) return source;
  const temp = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  const diameter = radius * 2 + 1;
  for (let y = 0; y < size; y += 1) {
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) {
      sum += source[y * size + Math.max(0, Math.min(size - 1, x))];
    }
    for (let x = 0; x < size; x += 1) {
      temp[y * size + x] = sum / diameter;
      const removeX = Math.max(0, x - radius);
      const addX = Math.min(size - 1, x + radius + 1);
      sum += source[y * size + addX] - source[y * size + removeX];
    }
  }
  for (let x = 0; x < size; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += temp[Math.max(0, Math.min(size - 1, y)) * size + x];
    }
    for (let y = 0; y < size; y += 1) {
      output[y * size + x] = sum / diameter;
      const removeY = Math.max(0, y - radius);
      const addY = Math.min(size - 1, y + radius + 1);
      sum += temp[addY * size + x] - temp[removeY * size + x];
    }
  }
  return output;
}
function cloneImageData(image) {
  if (!image?.data || !image.width || !image.height) return null;
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}
function medianImages(list) {
  // 用均值代替逐像素排序，避免静息结束时卡死
  const n = list.length, out = new ImageData(SIZE, SIZE);
  const d = out.data;
  for (let i = 0; i < SIZE * SIZE; i++) {
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < n; k++) {
      const p = list[k].data;
      const o = i * 4;
      r += p[o]; g += p[o + 1]; b += p[o + 2];
    }
    const o = i * 4;
    d[o] = (r / n) | 0;
    d[o + 1] = (g / n) | 0;
    d[o + 2] = (b / n) | 0;
    d[o + 3] = 255;
  }
  return out;
}

async function fetchJsonAsset(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label}加载失败（HTTP ${response.status}）`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}格式错误，请刷新页面后重试`);
  }
}

async function ensureModels() {
  if (landmarker) return;
  els.badge.textContent = "加载模型";
  els.badge.classList.add("warn");
  const [tri, rstl] = await Promise.all([
    fetchJsonAsset(trianglesUrl, "面部拓扑"),
    fetchJsonAsset(personalizedAtlasUrl, "个性化图谱"),
  ]);
  triangles = tri;
  atlasLines = rstl.lines;
  const resolver = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const build = (d) => FaceLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: faceLandmarkerUrl, delegate: d },
    runningMode: "VIDEO", numFaces: 1,
    outputFaceBlendshapes: true,
  });
  try { landmarker = await build("GPU"); }
  catch { landmarker = await build("CPU"); }
  els.badge.textContent = "模型就绪";
  els.badge.classList.remove("warn");
}

// ── 4. 先验 vs 微调对比与导出 ───────────────────────────────────────────────
function strokePoly(cctx, pts, color, width) {
  if (!pts || pts.length < 2) return;
  cctx.strokeStyle = color;
  cctx.lineWidth = width;
  cctx.lineJoin = "round";
  cctx.lineCap = "round";
  cctx.beginPath();
  cctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) cctx.lineTo(pts[i][0], pts[i][1]);
  cctx.stroke();
}

// 最终个性化曲线颜色（完整连续，不因分类切碎/隐藏）
const FINAL_COLOR = "rgba(255,0,200,0.95)";
const PRIOR_COLOR = "rgba(150,160,175,0.85)";

/**
 * 画一条完整连续曲线（不按分类切碎）。mapPt(p,i)->[x,y] 可把 canonical 点
 * 重投影到目标画布；返回 null 的点跳过但不断线（用前一个有效点续接）。
 */
function strokeFull(cctx, pts, width, color, mapPt, dash = [], projectionSmoothingPasses = 0) {
  if (!pts || pts.length < 2) return;
  const conv = mapPt || ((p) => p);
  let mapped = pts.map((point, index) => conv(point, index))
    .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (projectionSmoothingPasses > 0) {
    mapped = smoothProjectedCurveV2(mapped, projectionSmoothingPasses);
  }
  if (mapped.length < 2) return;
  cctx.strokeStyle = color;
  cctx.lineWidth = width;
  cctx.setLineDash(dash);
  cctx.lineJoin = "round";
  cctx.beginPath();
  for (let i = 0; i < mapped.length; i++) {
    const point = mapped[i];
    if (i === 0) cctx.moveTo(point[0], point[1]);
    else cctx.lineTo(point[0], point[1]);
  }
  cctx.stroke();
  cctx.setLineDash([]);
}

function nearestDist(p, poly) {
  let best = 1e9;
  for (let i = 0; i < poly.length; i++) {
    const d = Math.hypot(p[0] - poly[i][0], p[1] - poly[i][1]);
    if (d < best) best = d;
  }
  return best;
}

/** 先验种子 vs 微调曲线：逐条平均偏移（像素） */
function compareCurves(seeds, curves) {
  const byName = new Map((curves || []).map((c) => [c.name, c]));
  const rows = [];
  let sum = 0, n = 0;
  for (const s of seeds || []) {
    const c = byName.get(s.name);
    if (!c?.pts?.length || !s.pts?.length) {
      rows.push({ name: s.name, meanPx: null, maxPx: null, prior: s.pts, personalized: c?.pts || null });
      continue;
    }
    // 在种子点上采样到微调曲线的距离
    const step = Math.max(1, Math.floor(s.pts.length / 24));
    let acc = 0, cnt = 0, mx = 0;
    for (let i = 0; i < s.pts.length; i += step) {
      const d = nearestDist(s.pts[i], c.pts);
      acc += d; cnt++; mx = Math.max(mx, d);
    }
    const meanPx = cnt ? acc / cnt : 0;
    rows.push({ name: s.name, meanPx, maxPx: mx, prior: s.pts, personalized: c.pts });
    sum += meanPx; n++;
  }
  return { rows, meanAll: n ? sum / n : 0, n };
}

function drawLegend(cctx, x, y, lineCount = atlasLines?.length || 0, hasWrinkles = false) {
  cctx.font = "11px sans-serif";
  cctx.fillStyle = "rgba(0,0,0,0.6)";
  cctx.fillRect(x - 6, y - 12, 214, hasWrinkles ? 76 : 58);
  cctx.setLineDash([]);
  cctx.strokeStyle = FINAL_COLOR;
  cctx.lineWidth = 3;
  cctx.beginPath(); cctx.moveTo(x, y - 3); cctx.lineTo(x + 14, y - 3); cctx.stroke();
  cctx.fillStyle = "#fce7f3";
  cctx.fillText(`洋红：V6 个性化 RSTL（${lineCount} 条）`, x + 20, y);
  cctx.strokeStyle = "rgba(150,160,175,0.85)";
  cctx.beginPath(); cctx.moveTo(x, y + 15); cctx.lineTo(x + 14, y + 15); cctx.stroke();
  cctx.fillStyle = "#cbd5e1";
  cctx.fillText(`灰线：初始 atlas（${lineCount} 条）`, x + 20, y + 18);
  cctx.strokeStyle = "rgba(67,217,255,0.92)";
  cctx.beginPath(); cctx.moveTo(x, y + 33); cctx.lineTo(x + 14, y + 33); cctx.stroke();
  cctx.fillStyle = "#b8efff";
  cctx.fillText("青色：法向位移箭头", x + 20, y + 36);
  if (hasWrinkles) {
    cctx.fillStyle = "rgba(53,233,155,0.92)";
    cctx.fillRect(x, y + 48, 14, 4);
    cctx.fillStyle = "#bdf8dc";
    cctx.fillText("绿色：多表情皱纹严格并集", x + 20, y + 54);
  }
}

function scalarMask(mask, size = SIZE) {
  const source = mask?.mask || mask?.wrinkleMask || mask;
  const data = source?.data || source;
  if (!data || typeof data.length !== "number") return null;
  if (data.length === size * size) return data;
  if (data.length === size * size * 4) {
    const out = new Uint8Array(size * size);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    return out;
  }
  return null;
}

function wrinkleMaskCanvas(mask, size = SIZE) {
  const values = scalarMask(mask, size);
  if (!values) return null;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext("2d");
  const overlay = g.createImageData(size, size);
  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i]) || 0;
    if (value <= 0) continue;
    overlay.data[i * 4] = 32;
    overlay.data[i * 4 + 1] = 255;
    overlay.data[i * 4 + 2] = 157;
    overlay.data[i * 4 + 3] = Math.max(90, Math.min(235, value <= 1 ? value * 220 : value));
  }
  g.putImageData(overlay, 0, 0);
  return canvas;
}

function drawBinaryWrinkleMask(mask, target, size = SIZE) {
  const values = scalarMask(mask, size);
  if (!values || !target) return false;
  target.width = size;
  target.height = size;
  const g = target.getContext("2d");
  const image = g.createImageData(size, size);
  for (let i = 0; i < values.length; i++) {
    const on = Number(values[i]) > 0;
    const value = on ? 255 : 0;
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  if (els.wrinkleMaskPanel) els.wrinkleMaskPanel.style.display = "block";
  if (els.wrinkleMaskDownload) els.wrinkleMaskDownload.disabled = false;
  return true;
}

function drawSemanticWrinkleMask(imageData, fused, target, size = SIZE) {
  if (!target) return false;
  const union = scalarMask(fused?.consolidatedMask || fused?.mask || fused?.binaryMask || fused, size);
  if (!union) return false;
  target.width = size;
  target.height = size;
  const g = target.getContext("2d");
  if (imageData?.data && imageData.width === size && imageData.height === size) {
    g.putImageData(imageData, 0, 0);
  } else {
    g.fillStyle = "#05070a";
    g.fillRect(0, 0, size, size);
  }
  const base = g.getImageData(0, 0, size, size);
  const classes = [
    ["forehead", [255, 176, 32]],
    ["frown", [56, 189, 248]],
    ["wrinkle", [244, 63, 94]],
  ];
  for (let i = 0; i < union.length; i++) {
    if (!union[i]) continue;
    let color = [52, 233, 155];
    for (const [name, candidate] of classes) {
      if (fused?.classMasks?.[name]?.[i]) { color = candidate; break; }
    }
    const offset = i * 4, alpha = 0.70;
    base.data[offset] = Math.round(base.data[offset] * (1 - alpha) + color[0] * alpha);
    base.data[offset + 1] = Math.round(base.data[offset + 1] * (1 - alpha) + color[1] * alpha);
    base.data[offset + 2] = Math.round(base.data[offset + 2] * (1 - alpha) + color[2] * alpha);
    base.data[offset + 3] = 255;
  }
  g.putImageData(base, 0, 0);
  if (els.wrinkleMaskPanel) els.wrinkleMaskPanel.style.display = "block";
  if (els.wrinkleSemanticDownload) els.wrinkleSemanticDownload.disabled = false;
  return true;
}

const EXPRESSION_AUDIT_COLORS = Object.freeze({
  neutral: [255, 255, 255],
  raise_brows: [250, 204, 21],
  frown: [56, 189, 248],
  squint: [168, 85, 247],
  smile: [244, 63, 94],
  puff: [251, 146, 60],
  purse: [34, 197, 94],
  open_mouth: [236, 72, 153],
});

function drawExpressionAlignmentAudit(imageData, detections, target, size = SIZE) {
  if (!target) return false;
  target.width = size;
  target.height = size;
  const g = target.getContext("2d");
  if (imageData?.data && imageData.width === size && imageData.height === size) {
    g.putImageData(imageData, 0, 0);
  } else {
    g.fillStyle = "#05070a";
    g.fillRect(0, 0, size, size);
  }
  const base = g.getImageData(0, 0, size, size);
  for (const result of detections || []) {
    const values = result?.binaryMask || result?.mask || result?.skeleton;
    if (!values || values.length !== size * size) continue;
    const color = EXPRESSION_AUDIT_COLORS[result.expression] || [255, 255, 255];
    for (let index = 0; index < values.length; index += 1) {
      if (!values[index]) continue;
      const offset = index * 4, alpha = 0.30;
      base.data[offset] = Math.round(base.data[offset] * (1 - alpha) + color[0] * alpha);
      base.data[offset + 1] = Math.round(base.data[offset + 1] * (1 - alpha) + color[1] * alpha);
      base.data[offset + 2] = Math.round(base.data[offset + 2] * (1 - alpha) + color[2] * alpha);
      base.data[offset + 3] = 255;
    }
  }
  g.putImageData(base, 0, 0);
  if (els.wrinkleMaskPanel) els.wrinkleMaskPanel.style.display = "block";
  if (els.wrinkleAlignmentDownload) els.wrinkleAlignmentDownload.disabled = false;
  return true;
}

function drawV6EvidenceMask(imageData, mask, target, size = SIZE) {
  if (!target || !mask || mask.length !== size * size) return false;
  target.width = size;
  target.height = size;
  const g = target.getContext("2d");
  if (imageData?.data && imageData.width === size && imageData.height === size) {
    g.putImageData(imageData, 0, 0);
  } else {
    g.fillStyle = "#05070a";
    g.fillRect(0, 0, size, size);
  }
  const base = g.getImageData(0, 0, size, size);
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const offset = index * 4, alpha = 0.88;
    base.data[offset] = Math.round(base.data[offset] * (1 - alpha) + 52 * alpha);
    base.data[offset + 1] = Math.round(base.data[offset + 1] * (1 - alpha) + 233 * alpha);
    base.data[offset + 2] = Math.round(base.data[offset + 2] * (1 - alpha) + 164 * alpha);
    base.data[offset + 3] = 255;
  }
  g.putImageData(base, 0, 0);
  if (els.wrinkleMaskPanel) els.wrinkleMaskPanel.style.display = "block";
  if (els.wrinkleEvidenceDownload) els.wrinkleEvidenceDownload.disabled = false;
  return true;
}

function drawDisplacementArrow(cctx, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.25) return;
  const angle = Math.atan2(dy, dx);
  const head = Math.max(1.4, Math.min(3.5, length * 0.75));
  cctx.beginPath();
  cctx.moveTo(start[0], start[1]);
  cctx.lineTo(end[0], end[1]);
  cctx.lineTo(end[0] - head * Math.cos(angle - Math.PI / 5), end[1] - head * Math.sin(angle - Math.PI / 5));
  cctx.moveTo(end[0], end[1]);
  cctx.lineTo(end[0] - head * Math.cos(angle + Math.PI / 5), end[1] - head * Math.sin(angle + Math.PI / 5));
  cctx.stroke();
}

/**
 * 在 canonical 图上按输出分类叠画（全部 atlas 线）：
 * refined 粉实线 / prior_only 灰虚线 / occluded 不画 + 位移短线。
 */
function renderCompareImage(imageData, seeds, curves, size = SIZE, wrinkleEvidence = null) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const cctx = c.getContext("2d");
  if (imageData) cctx.putImageData(imageData, 0, 0);
  else {
    cctx.fillStyle = "#111";
    cctx.fillRect(0, 0, size, size);
  }

  const maskCanvas = wrinkleMaskCanvas(wrinkleEvidence, size);
  if (maskCanvas) {
    cctx.save();
    cctx.globalAlpha = 0.82;
    cctx.drawImage(maskCanvas, 0, 0);
    cctx.restore();
  }

  const cmp = compareCurves(seeds, curves);
  const list = curves && curves.length ? curves : (seeds || []).map((s) => ({ name: s.name, pts: s.pts, priorPts: s.pts, kinds: null }));

  // 1) 初始 atlas：全部曲线完整灰线
  for (const cc of list) {
    const prior = cc.priorPts || cc.pts;
    strokeFull(cctx, prior, 1.2, "rgba(150,160,175,0.7)", null);
  }

  // 2) 法向位移箭头（青）：逐点 prior→final，仅画实际发生位移处
  if (curves && curves.length) {
    cctx.strokeStyle = "rgba(67,217,255,0.92)";
    cctx.lineWidth = 0.8;
    cctx.setLineDash([]);
    for (const cc of curves) {
      const prior = cc.priorPts || cc.pts;
      if (!prior || !cc.pts) continue;
      const m = Math.min(prior.length, cc.pts.length);
      const stepN = Math.max(1, Math.floor(m / 12));
      for (let i = 0; i < m; i += stepN) {
        const a = prior[i], b = cc.pts[i];
        if (!a || !b) continue;
        drawDisplacementArrow(cctx, a, b);
      }
    }
  }

  // 3) 最终个性化曲线：全部曲线完整连续洋红线
  if (curves && curves.length) {
    for (const cc of curves) strokeFull(cctx, cc.pts, 1.6, FINAL_COLOR, null);
  }
  drawLegend(cctx, 8, size - (maskCanvas ? 66 : 48), list.length, Boolean(maskCanvas));
  return { canvas: c, cmp };
}

/**
 * Capture preview deliberately contains only the mirrored camera frame.
 * Face landmarks and RSTL are still processed off-screen for sampling, but
 * no atlas, personalized curve or canonical face inset is drawn here.
 */
function paint() {
  const w = els.video.videoWidth || 640;
  const h = els.video.videoHeight || 480;
  if (els.view.width !== w || els.view.height !== h) {
    els.view.width = w; els.view.height = h;
  }
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(els.video, 0, 0, w, h);
  ctx.restore();
}

/** 统计一条曲线里的直接证据、连续传播、先验与遮挡点数。 */
function curveKindStats(c) {
  const s = { refined: 0, propagated: 0, prior: 0, occluded: 0 };
  for (const k of c.kinds || []) if (s[k] != null) s[k]++;
  return s;
}

const finiteMedian = (values) => {
  const sorted = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
};

function roundedMetrics(value, digits = 4) {
  if (typeof value === "number") return Number.isFinite(value) ? +value.toFixed(digits) : null;
  if (Array.isArray(value)) return value.map((item) => roundedMetrics(item, digits));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundedMetrics(item, digits)]));
  }
  return value;
}

function recordDebugEvent(type, details = {}) {
  if (!sess) return null;
  const event = {
    seq: ++sess.debugSequence,
    at: new Date().toISOString(),
    type,
    ...roundedMetrics(details),
  };
  sess.debugEvents.push(event);
  return event;
}

function preferredRecordingMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=avc1",
    "video/mp4",
  ];
  return candidates.find((mime) => MediaRecorder.isTypeSupported?.(mime)) || "";
}

function clipFileExtension(mime = "") {
  return mime.includes("mp4") ? "mp4" : "webm";
}

function releaseMediaUrls() {
  for (const url of retainedMediaUrls) URL.revokeObjectURL(url);
  retainedMediaUrls = [];
}

// 人脸视频调试录制默认关闭；勾选后仍需一次显式同意，明确用途、留存位置和生命周期。
function consentToDebugRecording() {
  if (!els.recordDebugMedia?.checked) return false;
  const agreed = typeof confirm !== "function" || confirm(
    "将录制静息及每个表情每轮的人脸视频与同步关键点。\n\n"
    + "用途：仅用于本机算法调试。\n"
    + "留存：只在当前标签页内存中，不上传服务器、不写入本地存储。\n"
    + "生命周期：刷新、关闭页面、重新开始采集或点「丢弃调试录制」即清除。\n\n"
    + "确认开启人脸视频录制？",
  );
  if (!agreed) {
    els.recordDebugMedia.checked = false;
    return false;
  }
  return true;
}

// 让使用者可以在导出后立刻抹掉内存中的人脸视频，而不必依赖刷新页面。
function discardDebugRecording() {
  releaseMediaUrls();
  if (sess) {
    sess.recordedClips = [];
    sess.activeRecording = null;
  }
  if (els.debugMediaExports) els.debugMediaExports.innerHTML = "";
  if (els.debugMediaStatus) els.debugMediaStatus.textContent = "调试录制已丢弃，内存中不再保留人脸视频";
  if (els.discardDebugMedia) els.discardDebugMedia.disabled = true;
}

function renderDebugMediaExports() {
  if (!els.debugMediaStatus || !els.debugMediaExports) return;
  const clips = sess?.recordedClips || [];
  const active = sess?.activeRecording;
  const bytes = clips.reduce((sum, clip) => sum + (clip.bytes || 0), 0);
  els.debugMediaStatus.textContent = active
    ? `正在记录：${active.actionLabel}（已保存 ${clips.length} 段）`
    : clips.length
      ? `已保存 ${clips.length} 段 · ${(bytes / 1024 / 1024).toFixed(1)} MB；刷新页面前请下载`
      : sess?.recordingEnabled ? "视频调试已启用，等待采集" : "视频调试未启用，仅保留聚合诊断";
  if (els.discardDebugMedia) els.discardDebugMedia.disabled = !clips.length && !active;
  els.debugMediaExports.innerHTML = clips.map((clip) => {
    if (!clip.blob) return `<span class="hint">${clip.actionLabel}：仅数据（无视频）</span>`;
    if (!clip.downloadUrl) {
      clip.downloadUrl = URL.createObjectURL(clip.blob);
      retainedMediaUrls.push(clip.downloadUrl);
    }
    return `<a href="${clip.downloadUrl}" download="${clip.fileName}">下载 ${clip.actionLabel} 视频（${(clip.bytes / 1024 / 1024).toFixed(1)} MB）</a>`;
  }).join("");
}

async function startClipRecording(action, round, role = "action_cycle") {
  if (!sess?.recordingEnabled || !stream) return null;
  if (sess.pendingClipStop) {
    await sess.pendingClipStop;
    sess.pendingClipStop = null;
  }
  if (sess.activeRecording) await stopClipRecording("superseded_by_next_clip");
  const actionLabel = action === "neutral" ? "静息基线" : (ACTION_LABELS[action] || action);
  const clipIndex = (sess.recordedClips?.length || 0) + 1;
  const mimeType = preferredRecordingMime();
  const active = {
    clipId: `${action}_r${round}_${String(clipIndex).padStart(2, "0")}`,
    action,
    actionLabel,
    round,
    role,
    startedAt: new Date().toISOString(),
    startedPerfMs: performance.now(),
    mimeType,
    chunks: [],
    frames: [],
    lastFrameLogMs: -Infinity,
    recorder: null,
    videoError: null,
  };
  sess.activeRecording = active;
  try {
    if (typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持 MediaRecorder");
    const options = { videoBitsPerSecond: 1_600_000 };
    if (mimeType) options.mimeType = mimeType;
    const recorder = new MediaRecorder(stream, options);
    active.recorder = recorder;
    recorder.ondataavailable = (event) => { if (event.data?.size) active.chunks.push(event.data); };
    recorder.onerror = (event) => {
      active.videoError = event.error?.message || "MediaRecorder error";
      sess?.recordingErrors?.push({ clip_id: active.clipId, error: active.videoError });
    };
    recorder.start(1000);
  } catch (error) {
    active.videoError = error.message || String(error);
    sess.recordingErrors.push({ clip_id: active.clipId, error: active.videoError });
  }
  recordDebugEvent("clip_started", { clip_id: active.clipId, action, round, role, mime_type: mimeType || null });
  renderDebugMediaExports();
  return active;
}

async function stopClipRecording(reason = "completed") {
  const session = sess;
  const active = session?.activeRecording;
  if (!active) return null;
  session.activeRecording = null;
  const recorder = active.recorder;
  if (recorder && recorder.state !== "inactive") {
    await new Promise((resolve) => {
      const finish = () => resolve();
      recorder.addEventListener("stop", finish, { once: true });
      try { recorder.stop(); } catch (_) { resolve(); }
      setTimeout(resolve, 1500);
    });
  }
  const actualMime = recorder?.mimeType || active.mimeType || "video/webm";
  const blob = active.chunks.length ? new Blob(active.chunks, { type: actualMime }) : null;
  const endedPerfMs = performance.now();
  const clip = {
    clipId: active.clipId,
    action: active.action,
    actionLabel: active.actionLabel,
    round: active.round,
    role: active.role,
    startedAt: active.startedAt,
    endedAt: new Date().toISOString(),
    durationMs: endedPerfMs - active.startedPerfMs,
    stopReason: reason,
    mimeType: actualMime,
    bytes: blob?.size || 0,
    fileName: `${active.clipId}.${clipFileExtension(actualMime)}`,
    videoError: active.videoError,
    frameSamples: active.frames,
    blob,
    downloadUrl: null,
  };
  session.recordedClips.push(clip);
  recordDebugEvent("clip_stopped", {
    clip_id: clip.clipId,
    reason,
    duration_ms: clip.durationMs,
    bytes: clip.bytes,
    synchronized_samples: clip.frameSamples.length,
    video_error: clip.videoError,
  });
  renderDebugMediaExports();
  return clip;
}

function appendCaptureSample({ bs, alignedMesh, registration, pose, poseQuality, sourceFaceWidth, detectedFace = true }) {
  const active = sess?.activeRecording;
  if (!active) return;
  const nowMs = performance.now();
  if (nowMs - active.lastFrameLogMs < 120) return;
  active.lastFrameLogMs = nowMs;
  const action = sess.stage === "actions" ? ACTION_ORDER[sess.actionIndex] : "neutral";
  const baseline = sess.baseline || {};
  const actionScores = Object.fromEntries(ACTION_ORDER.map((name) => [name, relativeScore(bs || {}, name, baseline)]));
  const threshold = action !== "neutral" ? personalThreshold(action, baseline) : null;
  const returnResidual = action !== "neutral" && sess.phase === "return" && alignedMesh && sess.refMesh
    ? actionMeshResidual(sess.refMesh, alignedMesh, action)
    : sess.currentReturnMeshResidual;
  active.frames.push(roundedMetrics({
    sample_index: active.frames.length,
    clip_id: active.clipId,
    video_time_ms: nowMs - active.startedPerfMs,
    media_time_s: els.video.currentTime,
    detected_face: detectedFace,
    stage: sess.stage,
    phase: sess.phase,
    action,
    action_score: action !== "neutral" ? actionScores[action] : null,
    personal_threshold: threshold,
    action_scores: actionScores,
    pose: pose ? { ok: pose.ok, roll_deg: pose.rollDeg, yaw_proxy: pose.yawProxy } : null,
    tracking_quality: poseQuality,
    source_face_width_px: sourceFaceWidth,
    registration_residual_median_px: registration?.medianPx ?? null,
    registration_residual_p90_px: registration?.p90Px ?? null,
    registration_residual_limit_px: registration?.limitPx ?? null,
    registration_ok: registration?.ok ?? null,
    return_mesh_residual_px: returnResidual ?? null,
    return_mesh_ratio: action !== "neutral" && Number.isFinite(returnResidual)
      ? returnResidual / Math.max(0.5, sess.returnMeshThresholds?.[action] || 2.4)
      : null,
    blendshapes: bs || {},
    canonical_landmarks_xy: alignedMesh?.slice(0, 468) || null,
  }, 3));
}

function curvePointDiagnostics(session) {
  return (session?.curves || []).map((curve) => ({
    name: curve.name,
    points: (curve.pts || []).map((point, index) => {
      const prior = curve.priorPts?.[index] || point;
      const x = Math.max(0, Math.min(SIZE - 1, Math.round(prior[0])));
      const y = Math.max(0, Math.min(SIZE - 1, Math.round(prior[1])));
      const offset = Math.hypot(point[0] - prior[0], point[1] - prior[1]);
      const idx = y * SIZE + x;
      const evidenceQ = session.fieldQ ? [session.fieldQ[idx * 2], session.fieldQ[idx * 2 + 1]] : null;
      const priorQ = session.q0 ? [session.q0[idx * 2], session.q0[idx * 2 + 1]] : null;
      return roundedMetrics({
        prior_xy: prior,
        final_xy: point,
        offset_px: offset,
        kind: curve.kinds?.[index] || "unknown",
        field_confidence: session.fieldC?.[idx] || 0,
        ridge_score: session.ridgeField?.[idx] || 0,
        dynamic_validation: session.dynamicValidation?.[idx] || 0,
        direction_delta_deg: evidenceQ && priorQ ? axialDiffDeg(evidenceQ, priorQ) : null,
        optimizer_audit: curve.audit?.[index] || null,
      }, 3);
    }),
  }));
}

function clipDataForExport(clip, partial = false) {
  if (!clip) return null;
  const nowMs = performance.now();
  return {
    clip_id: clip.clipId,
    action: clip.action,
    action_label: clip.actionLabel,
    round: clip.round,
    role: clip.role,
    partial,
    started_at: clip.startedAt,
    ended_at: partial ? null : clip.endedAt,
    duration_ms: partial ? nowMs - clip.startedPerfMs : clip.durationMs,
    stop_reason: partial ? null : clip.stopReason,
    video_file: partial ? null : clip.fileName,
    video_mime_type: clip.mimeType || null,
    video_bytes: partial ? null : clip.bytes,
    video_error: clip.videoError || null,
    synchronized_frame_samples: clip.frameSamples || clip.frames || [],
  };
}

function buildDebugPayload(session = sess) {
  if (!session) return null;
  const camera = session.captureSettings || {};
  const completedClips = (session.recordedClips || []).map((clip) => clipDataForExport(clip));
  const activeClip = session.activeRecording ? clipDataForExport(session.activeRecording, true) : null;
  return {
    schema: "langerface.personalized.debug.v2",
    generated_at: new Date().toISOString(),
    privacy: {
      contains_face_images: false,
      contains_video_frames: false,
      contains_synchronized_canonical_landmarks: completedClips.length > 0 || !!activeClip,
      contains_raw_blendshapes: completedClips.length > 0 || !!activeClip,
      associated_face_video_files: completedClips.some((clip) => clip.video_bytes > 0),
      storage: "browser_memory_and_user_initiated_local_download_only",
      note: "The JSON contains synchronized facial motion data. Video binaries are separate local downloads and are not embedded or uploaded.",
    },
    runtime: {
      algorithm_version: session.algorithmVersion,
      parameter_version: session.parameterVersion,
      session_started_at: session.startedAt,
      page_url: location.href,
      user_agent: navigator.userAgent,
      camera: {
        width: camera.width || els.video.videoWidth || null,
        height: camera.height || els.video.videoHeight || null,
        frame_rate: camera.frameRate || null,
        facing_mode: camera.facingMode || null,
      },
      geometry_size: SIZE,
      texture_size: TEXTURE_SIZE,
      source_face_width_px: roundedMetrics(session.sourceFaceWidth || 0, 1),
      thresholds: {
        quality_gate: QUALITY_THRESHOLDS,
        refined_point_confidence: REFINE_CONF,
        cycles_required: CYCLES_REQUIRED,
        soft_minimum_source_face_width_px: session.sourceFaceMetrics?.softMinimumFaceWidth ?? null,
        target_source_face_width_px: session.sourceFaceMetrics?.targetFaceWidth ?? null,
        source_face_width_hard_blocking: false,
      },
    },
    state: {
      stage: session.stage,
      phase: session.phase,
      current_action: ACTION_ORDER[session.actionIndex] || null,
      completed_actions: session.completed || [],
      skipped_actions: session.skipped || [],
      adaptive_not_required_actions: session.notRequired || [],
      action_validation: roundedMetrics(session.actionValidation || {}),
      region_evidence: roundedMetrics(session.regionState || {}),
      finalization: {
        status: session.v6Result ? "completed" : "pending",
        strict_union: "pixelwise_or_after_expression_region_gate",
        v6_evidence: session.v6Result?.evidenceMask ? "skeleton_available" : "not_available",
      },
    },
    neutral: {
      action_baseline: roundedMetrics(session.baseline || {}),
      return_mesh_thresholds_px: roundedMetrics(session.returnMeshThresholds || {}),
      static_field: roundedMetrics(summarizeWeightedField(session.staticEvidence?.confidence, session.skin)),
      static_quality: roundedMetrics(session.staticEvidenceDiagnostics || {}),
      fused_confidence_field: roundedMetrics(summarizeWeightedField(session.fieldC, session.skin)),
      ridge_field: roundedMetrics(summarizeWeightedField(session.ridgeField, session.skin)),
      dynamic_validation_field: roundedMetrics(summarizeWeightedField(session.dynamicValidation, session.skin)),
    },
    optimizer: roundedMetrics(session.optimizationDiagnostics || {}),
    yolo: session.v6Result ? {
      confidence_threshold: YOLO_CONFIDENCE,
      expression_count: session.v6Result.detections?.length || 0,
      fusion_operation: session.v6Result.fused?.fusionOperation || "strict_union",
      detection_diagnostics: (session.v6Result.detections || []).map((result) => ({
        expression: result.expression,
        diagnostics: result.diagnostics || null,
        region_gate_threshold: result.regionGateThreshold ?? REGION_GATE_THRESHOLD,
      })),
    } : null,
    cycle_diagnostics: roundedMetrics(session.cycleDiagnostics || {}),
    rejected_cycles: roundedMetrics(session.rejectedCycles || []),
    synchronized_capture: {
      enabled: !!session.recordingEnabled,
      recording_errors: session.recordingErrors || [],
      clips: activeClip ? [...completedClips, activeClip] : completedClips,
    },
    curve_displacements: roundedMetrics(summarizeCurveDisplacements(session.curves || [])),
    curve_point_diagnostics: curvePointDiagnostics(session),
    events: session.debugEvents || [],
  };
}

function downloadDebugPayload() {
  const payload = buildDebugPayload();
  if (!payload) return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `personalized_debug_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function preserveFinalDebugDownload(payload) {
  if (!payload || !els.debugMediaExports) return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  retainedMediaUrls.push(url);
  els.debugMediaExports.insertAdjacentHTML("beforeend",
    `<a href="${url}" download="personalized_capture_data.json">下载本次同步采集数据 JSON</a>`);
}

function renderFinalExports() {
  const links = [];
  const seeds = sess?.displaySeeds || sess?.seeds || [];
  const curves = sess?.curves || [];
  const neutralImage = sess?.neutralCanonical || sess?.lastCanon;
  const wrinkleEvidence = sess?.v6Result?.wrinkleMask || null;
  const v6EvidenceMask = sess?.v6Result?.evidenceMask || null;
  drawSemanticWrinkleMask(neutralImage, sess?.v6Result?.fused, els.wrinkleSemanticCanvas, SIZE);
  drawExpressionAlignmentAudit(neutralImage, sess?.v6Result?.detections,
    els.wrinkleAlignmentCanvas, SIZE);
  drawV6EvidenceMask(neutralImage, v6EvidenceMask, els.wrinkleEvidenceCanvas, SIZE);
  const { canvas: cmpCanvas, cmp } = renderCompareImage(neutralImage, seeds, curves, SIZE, wrinkleEvidence);
  drawBinaryWrinkleMask(wrinkleEvidence, els.wrinkleMaskCanvas, SIZE);

  // 覆盖率：refined 点占比 + 至少含一段 refined 的线数
  let ptR = 0, ptG = 0, ptP = 0, ptO = 0, refinedLines = 0, movedLines = 0;
  for (const c of curves) {
    const st = curveKindStats(c);
    if (!(c.kinds || []).length) {
      const prior = c.priorPts || c.points_prior_xy || c.pts || [];
      const final = c.pts || c.points_xy || [];
      const count = Math.min(prior.length, final.length);
      for (let i = 0; i < count; i++) {
        if (Math.hypot(final[i][0] - prior[i][0], final[i][1] - prior[i][1]) > 0.05) st.refined++;
        else st.prior++;
      }
    }
    ptR += st.refined; ptG += st.propagated; ptP += st.prior; ptO += st.occluded;
    if (st.refined > 0) refinedLines++;
    if (st.refined + st.propagated > 0) movedLines++;
  }
  const ptTotal = ptR + ptG + ptP + ptO || 1;
  const coverage = (ptR + ptG) / ptTotal;

  if (els.compareCanvas) {
    const cc = els.compareCanvas;
    cc.style.display = "block";
    const cx = cc.getContext("2d");
    cx.clearRect(0, 0, cc.width, cc.height);
    cx.drawImage(cmpCanvas, 0, 0, cc.width, cc.height);
  }
  if (els.compareSummary) {
    const top = [...cmp.rows]
      .filter((r) => r.meanPx != null)
      .sort((a, b) => b.meanPx - a.meanPx)
      .slice(0, 5);
    const lines = top.map((r) =>
      `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;margin:2px 0">
        <span>${r.name || "line"}</span>
        <span style="color:#0c8460;font-weight:700">Δ ${r.meanPx.toFixed(1)}px</span>
      </div>`).join("");
    els.compareSummary.innerHTML =
      `<div style="font-size:13px;font-weight:700;margin-bottom:2px">最终曲线 ${curves.length}/${seeds.length} · 直接证据 ${refinedLines} 条 · 连续场移动 ${movedLines} 条</div>
       <div class="hint" style="margin-bottom:6px">绿=皱纹并集 · 灰=初始 RSTL · 洋红=V6 结果 · 青=法向位移</div>
       <div style="font-size:12px;font-weight:600;margin-bottom:2px">全线平均偏移 ${cmp.meanAll.toFixed(1)}px · 移动点 ${(coverage * 100).toFixed(0)}%</div>
       ${lines || "<span class='hint'>暂无对比数据</span>"}`;
  }

  try {
    const w = els.view.width, h = els.view.height;
    const side = Math.min(Math.floor(h * 0.72), Math.floor(w * 0.42), 420);
    ctx.drawImage(cmpCanvas, w - side - 16, Math.floor((h - side) / 2), side, side);
    ctx.strokeStyle = "#34e3a4";
    ctx.lineWidth = 2;
    ctx.strokeRect(w - side - 16, Math.floor((h - side) / 2), side, side);
  } catch (_) {}

  try {
    links.push(`<a href="${els.view.toDataURL("image/jpeg", 0.92)}" download="view.jpg">下载主画面</a>`);
  } catch (_) {}
  links.push(`<a href="${cmpCanvas.toDataURL("image/png")}" download="compare_prior_vs_refined.png">下载对比图</a>`);
  if (wrinkleEvidence && els.wrinkleMaskCanvas) {
    links.push(`<a href="${els.wrinkleMaskCanvas.toDataURL("image/png")}" download="wrinkle_mask_strict_union.png">下载二值皱纹严格并集 Mask</a>`);
  }
  if (wrinkleEvidence && els.wrinkleSemanticCanvas) {
    links.push(`<a href="${els.wrinkleSemanticCanvas.toDataURL("image/png")}" download="wrinkle_mask_semantic_front.png">下载正脸语义分割 Mask</a>`);
  }
  if (els.wrinkleAlignmentCanvas && sess?.v6Result?.detections?.length) {
    links.push(`<a href="${els.wrinkleAlignmentCanvas.toDataURL("image/png")}" download="wrinkle_alignment_audit.png">下载跨表情配准审核图</a>`);
  }
  if (els.wrinkleEvidenceCanvas && v6EvidenceMask) {
    links.push(`<a href="${els.wrinkleEvidenceCanvas.toDataURL("image/png")}" download="wrinkle_v6_evidence.png">下载 V6 去重骨架证据图</a>`);
  }

  // 并排：左初始 atlas（灰）右最终 V6 个性化（洋红）
  try {
    const sideC = document.createElement("canvas");
    sideC.width = SIZE * 2 + 12;
    sideC.height = SIZE + 28;
    const sx = sideC.getContext("2d");
    sx.fillStyle = "#0c0f14";
    sx.fillRect(0, 0, sideC.width, sideC.height);
    if (neutralImage) {
      sx.putImageData(neutralImage, 0, 0);
      sx.putImageData(neutralImage, SIZE + 12, 0);
    }
    for (const s of seeds) strokePoly(sx, s.pts, "rgba(180,190,200,0.9)", 1.4);
    sx.save();
    sx.translate(SIZE + 12, 0);
    for (const c of curves) strokeFull(sx, c.pts, 1.6, FINAL_COLOR, null);
    sx.restore();
    sx.setLineDash([]);
    sx.fillStyle = "#e5e7eb";
    sx.font = "13px sans-serif";
    sx.fillText(`初始 atlas（${seeds.length} 条）`, 8, SIZE + 18);
    sx.fillText(`最终中性模板（${curves.length} 条）`, SIZE + 20, SIZE + 18);
    links.push(`<a href="${sideC.toDataURL("image/png")}" download="side_by_side.png">下载并排对比</a>`);
  } catch (_) {}

  const topoId = `mp468_tri${triangles?.length || 0}`;
  const json = {
    system: "expression_atlas_refinement_browser",
    disclaimer: "expression-conditioned atlas refinement demo — not individual RSTL measurement; not a surgical instruction",
    measurement_claim: "not_individual_rstl",
    validated: false,
    algorithm_version: sess?.algorithmVersion || null,
    parameter_version: sess?.parameterVersion || null,
    evidence_sources: [
      `anatomical_rstl_prior_${atlasLines.length}`,
      "temporally_stable_neutral_texture_adaptive_resolution",
      "repeatable_dynamic_texture_validation",
      "mesh_deformation_quality_support",
    ],
    completed_actions: sess?.completed || [],
    skipped_actions: sess?.skipped || [],
    adaptive_not_required_actions: sess?.notRequired || [],
    rejected_cycles: sess?.rejectedCycles || [],
    action_validation: sess?.actionValidation || {},
    optimizer: sess?.optimizationDiagnostics || {},
    region_evidence: sess?.regionState || {},
    action_cycles: Object.fromEntries(Object.entries(sess?.actionCycles || {}).map(([action, cycles]) => [action, cycles.map((cycle) => ({
      quality: cycle.quality,
      temporal_persistence: cycle.temporalPersistence,
    }))])),
    coordinate: {
      space: "canonical_refmesh",
      size: SIZE,
      ref_mesh_id: sess?.refMeshId || null,
      topology: topoId,
    },
    // 契约：初始 N 条 → 最终 N 条（严格对应）；修正为叠加在 prior 上的受限位移
    contract: {
      model: "three-source neutral template: anatomical prior + temporally stable neutral skin lines + repeated expression validation; dynamic texture cannot directly create final RSTL direction",
      safeguards: "each curve is displaced only along its local normal, displacements are coupled along the full curve, invalid-mask points fall back to prior, and any newly intersecting curve is rolled back",
      template_space: "neutral_canonical",
      prior_lines: seeds.length,
      final_lines: curves.length,
      directly_supported_lines: refinedLines,
      continuously_moved_lines: movedLines,
      note: "dynamic expressions validate neutral candidates only; all final curves remain in the neutral canonical template",
    },
    coverage: {
      final_point_ratio_with_correction: +coverage.toFixed(3),
      points: { directly_supported: ptR, field_propagated: ptG, prior_preserved: ptP, occluded: ptO },
    },
    compare: {
      note: "per-point offset final vs prior (0 where no observation)",
      mean_offset_px: +cmp.meanAll.toFixed(3),
      n_matched: cmp.n,
      per_line: cmp.rows.filter((r) => r.meanPx != null).map((r) => ({
        name: r.name,
        mean_offset_px: +r.meanPx.toFixed(3),
        max_offset_px: +r.maxPx.toFixed(3),
      })),
    },
    lines: curves.map((c) => ({
      name: c.name,
      status: (c.movedFrac || 0) > 0 ? "continuous_field_moved" : "prior_preserved",
      corrected_fraction: +(c.refinedFrac || 0).toFixed(3),
      moved_fraction: +(c.movedFrac || 0).toFixed(3),
      points_xy: c.pts.map((p) => [+p[0].toFixed(2), +p[1].toFixed(2)]),
      points_prior_xy: (c.priorPts || c.pts).map((p) => [+p[0].toFixed(2), +p[1].toFixed(2)]),
      point_kinds: c.kinds || [],
      point_audit: c.audit || [],
      rollback_reason: c.rollbackReason || null,
      max_direction_change_deg: +(c.maxDirectionChangeDeg || 0).toFixed(3),
      max_curvature_change_deg: +(c.maxCurvatureChangeDeg || 0).toFixed(3),
      // 重心坐标（tri,u,v）：配合 topology 可在导出后重投影到任意帧关键点
      points_bary: (c.bary || []).map((b) => (b ? [b.tri, +b.u.toFixed(4), +b.v.toFixed(4)] : null)),
    })),
  };
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
  links.push(`<a download="curves_compare.json" href="${URL.createObjectURL(blob)}">下载对比 JSON</a>`);
  if (sess?.v6Result?.payload) {
    const v6Blob = new Blob([JSON.stringify(sess.v6Result.payload, null, 2)], { type: "application/json" });
    links.push(`<a download="personalized_rstl.json" href="${URL.createObjectURL(v6Blob)}">下载 V6 个性化 RSTL JSON</a>`);
  }
  if (sess?.v6Result?.activeAtlas) {
    const atlasBlob = new Blob([JSON.stringify(sess.v6Result.activeAtlas, null, 2)], { type: "application/json" });
    links.push(`<a download="personalized_rstl_atlas.json" href="${URL.createObjectURL(atlasBlob)}">下载实时重投影 Atlas</a>`);
  }
  const debugBlob = new Blob([JSON.stringify(buildDebugPayload(), null, 2)], { type: "application/json" });
  links.push(`<a download="personalized_capture_data.json" href="${URL.createObjectURL(debugBlob)}">下载同步采集数据 JSON（含关键点）</a>`);
  els.exports.innerHTML = links.join("<br>");
  renderDebugMediaExports();

  sess.compare = cmp;
}

// ── 5. 每步融合 + 动作状态机 ────────────────────────────────────────────────
/** 把 canonical 曲线锚到网格拓扑（重心坐标），供实时主画面重投影，避免坐标漂移 */
function attachCurveBary(curves) {
  if (!sess?.refMesh || !curves) return;
  for (const c of curves) {
    c.bary = (c.pts || []).map((p) => pointToBary(p, sess.refMesh, triangles));
  }
}

async function ensureWrinkleYolo() {
  if (!wrinkleYolo) wrinkleYolo = new WrinkleYoloOnnx({ confidenceThreshold: YOLO_CONFIDENCE });
  if (typeof wrinkleYolo.initialize === "function") await wrinkleYolo.initialize();
  else if (typeof wrinkleYolo.load === "function") await wrinkleYolo.load();
  else if (wrinkleYolo.ready && typeof wrinkleYolo.ready.then === "function") await wrinkleYolo.ready;
  return wrinkleYolo;
}

function applyResidualFlowToDetection(result, flow, regionGate, size = SIZE) {
  const pixels = size * size;
  if (!result || !flow?.u || !flow?.v || !flow?.conf
    || flow.u.length !== pixels || flow.v.length !== pixels || flow.conf.length !== pixels) return result;
  const coordinates = new Float32Array(pixels * 2);
  const maximumAllowedShift = Math.max(2.5, Math.min(5,
    RESIDUAL_FLOW_MAX_SHIFT_FACE_RATIO * canonicalFaceWidth(sess)));
  let appliedPixels = 0, confidenceSum = 0, maximumShift = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const index = y * size + x;
    const confidence = Math.max(0, Math.min(1, Number(flow.conf[index] || 0)));
    const weight = Math.max(0, Math.min(1, (confidence - 0.18) / 0.42));
    const dx = Math.max(-maximumAllowedShift, Math.min(maximumAllowedShift,
      Number(flow.u[index] || 0) * weight));
    const dy = Math.max(-maximumAllowedShift, Math.min(maximumAllowedShift,
      Number(flow.v[index] || 0) * weight));
    coordinates[index * 2] = Math.max(0, Math.min(size - 1, x + dx));
    coordinates[index * 2 + 1] = Math.max(0, Math.min(size - 1, y + dy));
    if (weight > 0) {
      appliedPixels += 1;
      confidenceSum += confidence;
      maximumShift = Math.max(maximumShift, Math.hypot(dx, dy));
    }
  }
  const nearest = (field, channels = 1, Output = field?.constructor || Float32Array) => {
    if (!field || field.length !== pixels * channels) return field;
    const output = new Output(field.length);
    for (let index = 0; index < pixels; index += 1) {
      const x = Math.round(coordinates[index * 2]);
      const y = Math.round(coordinates[index * 2 + 1]);
      const source = y * size + x;
      for (let channel = 0; channel < channels; channel += 1) {
        output[index * channels + channel] = field[source * channels + channel];
      }
    }
    return output;
  };
  const gatedMask = (field) => {
    const output = nearest(field, 1, Uint8Array);
    if (!output) return output;
    for (let index = 0; index < pixels; index += 1) {
      if (Number(regionGate?.[index] ?? 1) < REGION_GATE_THRESHOLD) output[index] = 0;
    }
    return output;
  };
  const gatedScalar = (field) => {
    const output = nearest(field, 1, Float32Array);
    if (!output) return output;
    for (let index = 0; index < pixels; index += 1) {
      if (Number(regionGate?.[index] ?? 1) < REGION_GATE_THRESHOLD) output[index] = 0;
    }
    return output;
  };
  return {
    ...result,
    mask: gatedMask(result.mask),
    skeleton: gatedMask(result.skeleton),
    binaryMask: gatedMask(result.binaryMask),
    confidence: gatedScalar(result.confidence),
    denseConfidence: gatedScalar(result.denseConfidence),
    directionQ: nearest(result.directionQ, 2, Float32Array),
    directionConsistency: gatedScalar(result.directionConsistency),
    classMasks: Object.fromEntries(Object.entries(result.classMasks || {})
      .map(([name, mask]) => [name, gatedMask(mask)])),
    diagnostics: {
      ...(result.diagnostics || {}),
      residualRegistration: {
        method: "lowpass_block_flow_neutral_pullback",
        appliedPixelCount: appliedPixels,
        meanAcceptedConfidence: confidenceSum / Math.max(1, appliedPixels),
        maximumShiftPx: maximumShift,
        maximumAllowedShiftPx: maximumAllowedShift,
      },
    },
  };
}

async function detectWrinkles(model, sample) {
  const options = {
    confidenceThreshold: YOLO_CONFIDENCE,
    expression: sample.expression,
    label: sample.label,
    round: sample.round,
    skinMask: sess?.skin || null,
    forbiddenMask: sess?.forbidden || null,
    regionGate: sample.regionGate || buildExpressionRegionGate(sample.expression, sess),
    regionGateThreshold: REGION_GATE_THRESHOLD,
  };
  for (const name of ["detect", "infer", "predict", "run"]) {
    if (typeof model?.[name] !== "function") continue;
    const result = await model[name](sample.imageData, options);
    if (result && typeof result === "object" && !ArrayBuffer.isView(result)) {
      const normalized = { ...result, ...options };
      return applyResidualFlowToDetection(normalized, sample.residualFlow, options.regionGate, SIZE);
    }
    return { mask: result, ...options };
  }
  throw new Error("WrinkleYoloOnnx 未提供 detect/infer/predict/run 方法");
}

function canonicalFaceWidth(session) {
  const points = session?.refMesh || [];
  let minX = Infinity, maxX = -Infinity;
  for (const point of points) {
    if (!point || !Number.isFinite(point[0])) continue;
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
  }
  return Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX ? maxX - minX : SIZE * 0.72;
}

function normalizeV6Curves(rawCurves, seeds) {
  const source = Array.isArray(rawCurves) ? rawCurves : [];
  const byName = new Map(source.map((curve, index) => [curve?.name || seeds[index]?.name, curve]));
  return seeds.map((seed, index) => {
    const curve = byName.get(seed.name) || source[index] || {};
    const priorPts = curve.priorPts || curve.points_prior_xy || seed.pts;
    const pts = curve.pts || curve.points_xy || curve.finalPts || priorPts;
    if (!Array.isArray(pts) || pts.length !== priorPts.length) {
      throw new Error(`V6 曲线 ${seed.name || index} 的微调前后点数不一致`);
    }
    return {
      ...curve,
      name: seed.name,
      region: curve.region || atlasLines?.[index]?.region || "",
      priorPts: priorPts.map((point) => [Number(point[0]), Number(point[1])]),
      pts: pts.map((point) => [Number(point[0]), Number(point[1])]),
    };
  });
}

function baryArray(value) {
  const point = Array.isArray(value) && value.length >= 3
    ? [Number(value[0]), Number(value[1]), Number(value[2])]
    : value && Number.isInteger(value.tri)
      ? [value.tri, Number(value.u), Number(value.v)]
      : null;
  if (!point || !Number.isInteger(point[0]) || !point.slice(1).every(Number.isFinite)) return null;
  const w = 1 - point[1] - point[2], eps = 1e-3;
  if (point[1] < -eps || point[2] < -eps || w < -eps
    || point[1] > 1 + eps || point[2] > 1 + eps || w > 1 + eps) return null;
  return point;
}

function buildActiveAtlas(curves, diagnostics = {}) {
  const sourceByName = new Map((atlasLines || []).map((line) => [line.name, line]));
  const lines = curves.map((curve) => {
    const source = sourceByName.get(curve.name);
    const bary = curve.bary || curve.points_bary || [];
    const points = (curve.pts || []).map((_, index) => {
      const sourceIndex = source?.points?.length > 1 && curve.pts.length > 1
        ? Math.round(index * (source.points.length - 1) / (curve.pts.length - 1))
        : index;
      return baryArray(bary[index]) || baryArray(source?.points?.[sourceIndex]);
    });
    if (points.some((point) => !point)) {
      throw new Error(`曲线 ${curve.name} 含无法重投影的点`);
    }
    return {
      name: curve.name,
      region: curve.region || source?.region || "",
      disableRuntimeExpansion: true,
      points,
    };
  });
  return {
    system: "rstl",
    version: ACTIVE_ATLAS_VERSION,
    topologyId: ACTIVE_TOPOLOGY_ID,
    topologyVersion: ACTIVE_TOPOLOGY_VERSION,
    provenance: "local-yolo-conf007-softgate008-rstl-v6-p90-010",
    validated: false,
    diagnostics,
    lines,
  };
}

function buildV6Payload(curves, diagnostics, activeAtlas) {
  return {
    system: "rstl",
    validated: false,
    clinical_status: "research_visualization_only",
    diagnostics: {
      algorithm: diagnostics?.algorithm || "interval-guarded-continuous-polyline-rstl-refinement-6.0",
      yolo_confidence: YOLO_CONFIDENCE,
      cross_expression_operation: "strict_union",
      curve_count: curves.length,
      topology_contract_preserved: true,
      ...diagnostics,
    },
    lines: curves.map((curve, index) => ({
      name: curve.name,
      region: curve.region || "",
      points_prior_xy: curve.priorPts.map((point) => [Number(point[0]), Number(point[1])]),
      points_xy: curve.pts.map((point) => [Number(point[0]), Number(point[1])]),
      points_source_bary: atlasLines?.[index]?.points || [],
      points_bary: (activeAtlas.lines[index]?.points || []).map((point) => [...point]),
      normal_offsets_px: curve.normalOffsets || curve.normal_offsets_px || [],
      affected_intervals: curve.affectedIntervals || curve.affected_intervals || [],
      direct_match_count: curve.directMatchCount || curve.direct_match_count || 0,
      mean_match_weight: curve.meanMatchWeight || curve.mean_match_weight || 0,
    })),
  };
}

async function runLocalYoloV6(session) {
  const samples = (session.yoloSamples || []).filter((sample) => sample?.imageData?.data);
  if (samples.length < 2 || !samples.some((sample) => sample.expression === "neutral")) {
    throw new Error("至少需要中性帧和一个已接受的表情轮次才能运行 YOLO + V6");
  }
  setLocalPipelineStatus("正在本机加载皱纹 YOLO…", 4);
  const model = await ensureWrinkleYolo();
  const detections = [];
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    setLocalPipelineStatus(
      `YOLO 0.07：${sample.label}（${index + 1}/${samples.length}）`,
      8 + 55 * ((index + 1) / samples.length),
    );
    detections.push(await detectWrinkles(model, {
      ...sample,
      regionGate: buildExpressionRegionGate(sample.expression, session),
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  setLocalPipelineStatus("正在对所有表情执行严格像素并集…", 68);
  drawExpressionAlignmentAudit(session.neutralCanonical || session.lastCanon, detections,
    els.wrinkleAlignmentCanvas, SIZE);
  const consolidationRadiusPx = Math.max(2, Math.min(5,
    Math.round(UNION_DEGHOST_RADIUS_FACE_RATIO * canonicalFaceWidth(session))));
  const fused = await fuseStrictUnion(detections, {
    width: SIZE,
    height: SIZE,
    operation: "strict_union",
    consolidationRadiusPx,
    consolidationDirectionToleranceDegrees: 28,
  });
  // fused.mask 始终保留逐像素严格并集，供审计；显示与 V6 使用相邻同向
  // 重复皱纹合并后的 mask，避免不同表情的轻微错位形成双线。
  const wrinkleMask = fused?.consolidatedMask || fused?.mask || fused?.wrinkleMask || fused?.unionMask || fused;
  if (!scalarMask(wrinkleMask, SIZE)) throw new Error("严格并集未返回有效的 320×320 皱纹 mask");
  drawSemanticWrinkleMask(session.neutralCanonical || session.lastCanon, fused, els.wrinkleSemanticCanvas, SIZE);
  // Expose the binary union as soon as detection finishes, independently of
  // the later V6 refinement, so the user can inspect/export the actual evidence.
  drawBinaryWrinkleMask(wrinkleMask, els.wrinkleMaskCanvas, SIZE);
  const confidenceMap = fused?.confidenceMap || fused?.confidence || fused?.scoreMap || null;
  const directionQ = fused?.directionQ || fused?.direction || null;

  setLocalPipelineStatus("正在按皱纹位置与走势执行 RSTL V6 局部法向微调…", 76);
  const seeds = session.displaySeeds || session.seeds || [];
  const refined = await refineV6({
    seeds,
    wrinkleMask,
    confidenceMap,
    directionQ,
    size: SIZE,
    faceWidthPx: canonicalFaceWidth(session),
  });
  if (sess !== session) throw new Error("采集会话已结束，已丢弃过期微调结果");
  const curves = normalizeV6Curves(refined?.curves || refined?.lines || refined, seeds);
  if (curves.length !== seeds.length || curves.length !== atlasLines.length) {
    throw new Error(`V6 必须保持 ${atlasLines.length} 条曲线，实际得到 ${curves.length} 条`);
  }
  session.curves = curves;
  session.algorithmVersion = refined?.diagnostics?.algorithm || "interval-guarded-continuous-polyline-rstl-refinement-6.0";
  session.parameterVersion = "yolo-conf007-softgate008-smile-reg030-flow014-deghost014-v6-p90-010";
  attachCurveBary(session.curves);
  const evidenceMask = refined?.wrinkleSkeleton || null;
  session.optimizationDiagnostics = {
    ...(refined?.diagnostics || {}),
    final_refinement_pending: false,
    final_refinement_completed: true,
    strict_union_mask_pixels: Number(fused.mask?.reduce?.((sum, value) => sum + (value ? 1 : 0), 0) || 0),
    consolidated_union_mask_pixels: Number(fused.consolidatedMask?.reduce?.(
      (sum, value) => sum + (value ? 1 : 0), 0) || 0),
    v6_evidence_skeleton_pixels: Number(evidenceMask?.reduce?.((sum, value) => sum + (value ? 1 : 0), 0) || 0),
    expression_count: detections.length,
    expression_registration_gate: {
      anchor_indices: [...CANONICAL_REGISTRATION_ANCHORS],
      residual_limit_face_ratio: {
        default: REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO,
        frown: FROWN_REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO,
        smile: SMILE_REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO,
      },
      residual_flow_search_face_ratio: RESIDUAL_FLOW_SEARCH_FACE_RATIO,
      residual_flow_max_shift_face_ratio: RESIDUAL_FLOW_MAX_SHIFT_FACE_RATIO,
      region_gate_threshold: REGION_GATE_THRESHOLD,
      region_gate_mode: "soft_floor_with_confidence_weight",
      union_deghost_radius_face_ratio: UNION_DEGHOST_RADIUS_FACE_RATIO,
      union_deghost_radius_px: consolidationRadiusPx,
      union_deghost_mode: "parallel_direction_nms_after_exact_union",
    },
  };

  setLocalPipelineStatus("正在校验并生成实时重投影 Atlas…", 91);
  const activeAtlas = buildActiveAtlas(session.curves, refined?.diagnostics || {});
  const payload = buildV6Payload(session.curves, refined?.diagnostics || {}, activeAtlas);
  const staged = dataSource.stagePreviewAtlas(activeAtlas);
  personalizedAtlasStaged = !!staged;
  personalizedActiveAtlas = activeAtlas;
  session.v6Result = {
    detections, fused, wrinkleMask, evidenceMask, confidenceMap, directionQ,
    payload, activeAtlas, staged,
  };
  if (els.usePersonalized) els.usePersonalized.disabled = !personalizedAtlasStaged;
  renderFinalExports();
  setLocalPipelineStatus(
    staged
      ? "完成：V6 个性化 Atlas 已暂存，可进入实时 2D RSTL。"
      : "V6 已完成，但浏览器无法暂存实时 Atlas；仍可下载结果。",
    100,
    staged ? "success" : "warning",
  );
  setMsg(staged ? "个性化微调完成，可查看完整对比或进入实时 2D RSTL。" : "个性化微调完成，请下载结果。", !staged);
  updateGuide();
  return session.v6Result;
}

function finishExports() {
  if (!sess) return Promise.resolve(null);
  if (sess.finalizationPromise) return sess.finalizationPromise;
  const session = sess;
  session.finalizationPromise = runLocalYoloV6(session).catch((error) => {
    console.error(error);
    if (sess === session) {
      renderFinalExports();
      setLocalPipelineStatus(`本地 YOLO / V6 失败：${error.message || error}`, 0, "error");
      setMsg(`本地 YOLO / V6 失败：${error.message || error}`, true);
    }
    return null;
  });
  return session.finalizationPromise;
}


function meanGray(gray, mask) {
  let sum = 0, count = 0;
  for (let i = 0; i < gray.length; i++) if (!mask || mask[i]) { sum += gray[i]; count++; }
  return count ? sum / count : 0;
}

function medianNumber(values) {
  if (!values.length) return Infinity;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

async function aggregateCycleEvidence(frames, action) {
  const selectionField = actionRegionField(action, sess.regionMasksHi, TEXTURE_SIZE);
  const selectionMask = new Uint8Array(selectionField.length);
  for (let i = 0; i < selectionMask.length; i++) {
    selectionMask[i] = sess.skinHi[i] && selectionField[i] >= 0.20 ? 1 : 0;
  }
  const registrationRatio = action === "frown"
    ? FROWN_REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO
    : action === "smile"
      ? SMILE_REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO
      : REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO;
  const registrationLimitPx = Math.max(
    2.5,
    registrationRatio * canonicalFaceWidth(sess),
  );
  const best = pickBestFrames(sess.neutralGrayHi, frames, selectionMask, 4, {
    registrationWeight: 0.40,
    registrationResidualLimitPx: registrationLimitPx,
  });
  if (best.length < 4) throw new Error("有效峰值帧不足 4 帧");
  const bottomUpHi = validateHessianTemplateWithAction(
    sess.bottomUpStaticHi,
    best.map((item) => item.gray),
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    selectionMask,
  );
  const bottomUp = downsampleAxialEvidence(
    bottomUpHi.q,
    bottomUpHi.validation,
    bottomUpHi.amplification,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    SIZE,
    SIZE,
  );
  const n = SIZE * SIZE;
  const moment = new Float32Array(n * 2);
  const coh = new Float32Array(n), amp = new Float32Array(n), ridge = new Float32Array(n);
  const flowConf = new Float32Array(n), deformation = new Float32Array(n), stretch = new Float32Array(n);
  let tracking = 0, illumination = 0;
  let regionDeformationSum = 0, regionDeformationWeight = 0;
  let visualSignal = 0, expressionPeak = 0;
  const lowRegionField = actionRegionField(action, sess.regionMasks, SIZE);
  const neutralRegistrationGray = boxBlurGray(sess.neutralGray, SIZE, 4);
  const residualFlowSearchPx = Math.max(2, Math.min(4,
    Math.round(RESIDUAL_FLOW_SEARCH_FACE_RATIO * canonicalFaceWidth(sess))));
  let representativeFlow = null;
  const neutralMean = meanGray(sess.neutralGrayHi, sess.skinHi);
  for (const item of best) {
    const fr = item.fr;
    const texHi = textureOrientation(sess.neutralGrayHi, item.gray, TEXTURE_SIZE, TEXTURE_SIZE, sess.skinHi);
    const tex = downsampleAxialEvidence(texHi.q, texHi.coh, texHi.amp, TEXTURE_SIZE, TEXTURE_SIZE, SIZE, SIZE);
    const currentRegistrationGray = boxBlurGray(fr.grayLow, SIZE, 4);
    const flow = blockMatchFlow(
      neutralRegistrationGray,
      currentRegistrationGray,
      SIZE,
      SIZE,
      sess.skin,
      12,
      residualFlowSearchPx,
    );
    if (item === best[0]) representativeFlow = flow;
    const def = meshDeformationSupport(sess.refMesh, fr.meshAligned, triangles, SIZE);
    const difference = Number(item.imageDifferenceScore || 0);
    visualSignal = Math.max(visualSignal, 1 - Math.exp(-Math.sqrt(Math.max(0, difference)) / 16));
    expressionPeak = Math.max(expressionPeak, Number(fr.actionScore || 0));
    for (let i = 0; i < n; i += 1) {
      const regionWeight = Number(lowRegionField?.[i] || 0);
      if (regionWeight <= 0) continue;
      const deformationValue = action === "puff" ? def.stretch[i] : def.support[i];
      regionDeformationSum += regionWeight * Math.max(0, Math.min(1, deformationValue || 0));
      regionDeformationWeight += regionWeight;
    }
    for (let i = 0; i < n; i++) {
      const w = tex.confidence[i];
      moment[i * 2] += tex.q[i * 2] * w;
      moment[i * 2 + 1] += tex.q[i * 2 + 1] * w;
      coh[i] += tex.confidence[i];
      amp[i] += tex.ridge[i];
      ridge[i] += tex.ridge[i];
      flowConf[i] += flow.conf[i];
      deformation[i] += def.support[i];
      stretch[i] += def.stretch[i];
    }
    tracking += fr.tracking ?? 0;
    const lightDelta = Math.abs(meanGray(item.gray, sess.skinHi) - neutralMean);
    illumination += Math.exp(-lightDelta / 24);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const count = best.length;
  const q = new Float32Array(n * 2);
  let temporalMoment = 0, temporalWeight = 0;
  for (let i = 0; i < n; i++) {
    const len = Math.hypot(moment[i * 2], moment[i * 2 + 1]);
    if (len > 1e-6) { q[i * 2] = moment[i * 2] / len; q[i * 2 + 1] = moment[i * 2 + 1] / len; }
    temporalMoment += len;
    temporalWeight += coh[i];
    coh[i] /= count; amp[i] /= count; ridge[i] /= count; flowConf[i] /= count; deformation[i] /= count; stretch[i] /= count;
  }
  const quality = {
    tracking: tracking / count,
    illumination: illumination / count,
    returnConsistency: null,
    validPeakFrames: count,
    expressionPeak,
    visualSignal,
    regionDeformationSignal: regionDeformationWeight
      ? regionDeformationSum / regionDeformationWeight : 0,
    registrationResidualP90: Math.max(...best.map((item) =>
      Number(item.registrationResidualPx ?? 0)), 0),
    registrationResidualLimitPx: registrationLimitPx,
    residualFlowSearchPx,
  };
  return {
    q, coh, amp, ridge, flow: { conf: flowConf }, deformation, stretch, quality,
    representativeImage: cloneImageData(best[0]?.fr?.imageLow || null),
    representativeFlow,
    bottomUp: {
      q: bottomUp.q,
      validation: bottomUp.confidence,
      amplification: bottomUp.ridge,
      diagnostics: bottomUpHi.diagnostics,
    },
    temporalPersistence: temporalWeight ? Math.min(1, temporalMoment / temporalWeight) : 0,
  };
}

function repeatabilityScore(a, b, regionWeight) {
  let sum = 0, weight = 0;
  for (let i = 0; i < regionWeight.length; i++) {
    const sharedRidge = Math.min(a.ridge?.[i] || 0, b.ridge?.[i] || 0);
    const w = regionWeight[i] * Math.min(a.coh[i], b.coh[i]) * (0.35 + 0.65 * Math.sqrt(sharedRidge));
    if (w <= 0) continue;
    const dot = Math.max(-1, Math.min(1, a.q[i * 2] * b.q[i * 2] + a.q[i * 2 + 1] * b.q[i * 2 + 1]));
    const directionAgreement = 0.5 + 0.5 * dot;
    const ridgeMax = Math.max(a.ridge?.[i] || 0, b.ridge?.[i] || 0, 1e-6);
    const ridgeAgreement = sharedRidge / ridgeMax;
    const deformationAgreement = 1 - Math.min(1,
      Math.abs((a.deformation?.[i] || 0) - (b.deformation?.[i] || 0))
    );
    sum += w * (0.58 * directionAgreement + 0.24 * ridgeAgreement + 0.18 * deformationAgreement);
    weight += w;
  }
  return weight ? sum / weight : 0;
}

function mergeRepeatedCycles(a, b) {
  const n = a.coh.length;
  const q = new Float32Array(n * 2);
  const coh = new Float32Array(n), amp = new Float32Array(n), ridge = new Float32Array(n);
  const flowConf = new Float32Array(n), deformation = new Float32Array(n), stretch = new Float32Array(n);
  const bottomUpValidation = new Float32Array(n), bottomUpAmplification = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const sx = a.q[i * 2] * a.coh[i] + b.q[i * 2] * b.coh[i];
    const sy = a.q[i * 2 + 1] * a.coh[i] + b.q[i * 2 + 1] * b.coh[i];
    const len = Math.hypot(sx, sy);
    if (len > 1e-6) { q[i * 2] = sx / len; q[i * 2 + 1] = sy / len; }
    coh[i] = 0.5 * (a.coh[i] + b.coh[i]);
    amp[i] = 0.5 * (a.amp[i] + b.amp[i]);
    ridge[i] = 0.5 * (a.ridge[i] + b.ridge[i]);
    flowConf[i] = 0.5 * (a.flow.conf[i] + b.flow.conf[i]);
    deformation[i] = 0.5 * (a.deformation[i] + b.deformation[i]);
    stretch[i] = 0.5 * (a.stretch[i] + b.stretch[i]);
    bottomUpValidation[i] = Math.sqrt(
      (a.bottomUp?.validation?.[i] || 0) * (b.bottomUp?.validation?.[i] || 0)
    );
    bottomUpAmplification[i] = Math.sqrt(
      (a.bottomUp?.amplification?.[i] || 0) * (b.bottomUp?.amplification?.[i] || 0)
    );
  }
  return {
    q, coh, amp, ridge, flow: { conf: flowConf }, deformation, stretch,
    bottomUp: {
      q: a.bottomUp?.q || b.bottomUp?.q,
      validation: bottomUpValidation,
      amplification: bottomUpAmplification,
    },
    quality: b.quality,
    temporalPersistence: 0.5 * (a.temporalPersistence + b.temporalPersistence),
    effectiveSampleCount: (a.quality?.validPeakFrames || 0) + (b.quality?.validPeakFrames || 0),
  };
}

function createCycleDiagnostic(action, cycle, gate, round) {
  const regionWeight = actionRegionField(action, sess.regionMasks, SIZE);
  const meshResiduals = sess.returnFrames.map((frame) => frame.meshResidual);
  const meshRatios = sess.returnFrames.map((frame) => frame.meshRatio);
  const signal = (field) => roundedMetrics(summarizeWeightedField(field, regionWeight));
  return {
    id: `${action}-${String((sess.cycleDiagnostics?.length || 0) + 1).padStart(3, "0")}`,
    recorded_at: new Date().toISOString(),
    action,
    action_label: ACTION_LABELS[action],
    round,
    outcome: gate.valid ? "quality_gate_passed" : "quality_gate_rejected",
    captured_peak_frames: sess.cycleFrames.length,
    selected_peak_frames: cycle.quality.validPeakFrames,
    return_frames: sess.returnFrames.length,
    expression: roundedMetrics({
      peak_score: sess.apexPeak || 0,
      personal_threshold: personalThreshold(action, sess.baseline),
      peak_to_threshold: (sess.apexPeak || 0) / Math.max(0.01, personalThreshold(action, sess.baseline)),
    }),
    quality: roundedMetrics(cycle.quality),
    quality_gate: { valid: gate.valid, reasons: gate.reasons || [], thresholds: QUALITY_THRESHOLDS },
    return: roundedMetrics({
      mesh_threshold_px: sess.returnMeshThresholds?.[action] || null,
      mesh_residual_median_px: finiteMedian(meshResiduals),
      mesh_ratio_median: finiteMedian(meshRatios),
      image_and_mesh_consistency: cycle.quality.returnConsistency,
    }),
    evidence: {
      temporal_persistence: roundedMetrics(cycle.temporalPersistence),
      texture_coherence: signal(cycle.coh),
      wrinkle_amplitude: signal(cycle.amp),
      ridge_strength: signal(cycle.ridge),
      residual_flow_confidence: signal(cycle.flow?.conf),
      deformation_support: signal(cycle.deformation),
      stretch_support: signal(cycle.stretch),
    },
  };
}

function compactCurveUpdate(curves) {
  const summary = summarizeCurveDisplacements(curves || []);
  const moved = [...summary.per_line]
    .filter((line) => line.moved_points > 0)
    .sort((a, b) => b.mean_offset_px - a.mean_offset_px)
    .slice(0, 20);
  return roundedMetrics({
    lines: summary.lines,
    points: summary.points,
    moved_points: summary.moved_points,
    moved_fraction: summary.moved_fraction,
    mean_offset_px: summary.mean_offset_px,
    max_offset_px: summary.max_offset_px,
    top_moved_lines: moved,
  });
}

function retainYoloSample(action, round, imageData, residualFlow = null) {
  if (!sess || !imageData?.data) return;
  sess.yoloSamples = sess.yoloSamples || [];
  sess.yoloSamples = sess.yoloSamples.filter((sample) =>
    !(sample.expression === action && sample.round === round));
  sess.yoloSamples.push({
    expression: action,
    label: action === "neutral" ? "中性" : (ACTION_LABELS[action] || action),
    round,
    imageData: cloneImageData(imageData),
    residualFlow,
  });
}

function commitCycle(action) {
  if (processing || !sess?.neutralGray || !["onset", "apex", "return"].includes(sess.phase)) return;
  const stoppedClip = stopClipRecording("action_captured");
  processing = true;
  sess.phase = "processing";
  sess.message = `验证并融合「${ACTION_LABELS[action]}」证据…`;
  updateGuide();
  setMsg(sess.message);

  // 让 UI 先刷新再算，避免卡死感
  setTimeout(async () => {
    let debugRecord = null;
    try {
      await stoppedClip;
      const cycle = await aggregateCycleEvidence(sess.cycleFrames, action);
      // Stable pre-personalization capture submitted at the action apex and did
      // not require a separate return-to-neutral phase. Keep the remaining
      // tracking/illumination/peak-frame gates and mark return consistency as
      // non-blocking for this rollback-compatible workflow.
      const gateThresholds = action === "squint"
        ? { ...SQUINT_QUALITY_THRESHOLDS, returnConsistency: 0 }
        : action === "frown"
          ? { ...FROWN_QUALITY_THRESHOLDS, returnConsistency: 0 }
          : { ...QUALITY_THRESHOLDS, returnConsistency: 0 };
      const gate = evaluateQualityGate(cycle.quality, gateThresholds);
      const expressionThreshold = personalThreshold(action, sess.baseline);
      const expressionSignalOk = action === "frown"
        // 皱眉由定时采集提交；视觉信号是证据强度，不是采集资格门槛。
        ? true
        : TIMED_ACTIONS.has(action)
          ? Number(cycle.quality?.visualSignal || 0) >= EXPRESSION_VISUAL_SIGNAL_MIN
        : Number(sess.apexPeak || 0) >= expressionThreshold;
      const registrationOk = Number(cycle.quality?.registrationResidualP90 || 0) <=
        Number(cycle.quality?.registrationResidualLimitPx || Infinity);
      if (!expressionSignalOk) gate.reasons.push("expression_signal");
      if (!registrationOk) gate.reasons.push("registration_residual");
      gate.valid = gate.reasons.length === 0;
      const existingCycles = sess.actionCycles[action] || [];
      debugRecord = createCycleDiagnostic(action, cycle, gate, existingCycles.length + 1);
      debugRecord.quality_gate.thresholds = {
        ...gateThresholds,
        expression_signal_min: action === "frown"
          ? null
          : TIMED_ACTIONS.has(action) ? EXPRESSION_VISUAL_SIGNAL_MIN : expressionThreshold,
        expression_signal_mode: action === "frown" ? "advisory_only" : "blocking",
        registration_residual_limit_px: cycle.quality?.registrationResidualLimitPx ?? null,
      };
      sess.cycleDiagnostics.push(debugRecord);
      if (!gate.valid) {
        debugRecord.outcome = "quality_gate_rejected";
        debugRecord.quality_gate.thresholds = gateThresholds;
        sess.rejectedCycles.push({ action, reasons: gate.reasons, quality: cycle.quality });
        throw new Error(`质量门控未通过：${gate.reasons.join("、")}`);
      }
      const cycles = existingCycles;
      cycles.push(cycle);
      sess.actionCycles[action] = cycles;
      const regionWeight = actionRegionField(action, sess.regionMasks, SIZE);
      // Single-capture mode: quality and temporal stability inside this capture
      // replace the old cross-round repeatability gate.
      const repeatability = 1;
      const repeatDecision = {
        accept: true,
        threshold: null,
        mode: "single_capture_quality_gate",
        directionValidated: true,
      };
      debugRecord.repeatability = roundedMetrics({
        score: repeatability,
        threshold: repeatDecision.threshold,
        decision_mode: repeatDecision.mode,
        direction_validated: repeatDecision.directionValidated,
      });
      const current = {
        ...cycle,
        effectiveSampleCount: cycle.quality?.validPeakFrames || 0,
      };
      retainYoloSample(action, 1, cycle.representativeImage, cycle.representativeFlow);
      sess.actionValidation[action] = {
        repeatability,
        directionValidated: repeatDecision.directionValidated,
        dynamicRole: "neutral_candidate_validator_only",
        returnConsistency: current?.quality?.returnConsistency ?? null,
        mode: repeatDecision.mode,
        retries: sess.directionRetries[action] || 0,
      };
      // Puff is stretch validation only; it cannot introduce a new direction.
      if (action !== "puff" && repeatDecision.directionValidated) {
        const amplitudeQuality = Math.min(1,
          (sess.apexPeak || 0) / Math.max(personalThreshold(action, sess.baseline), 0.04));
        for (let i = 0; i < sess.dynamicValidation.length; i++) {
          const validated = (current.bottomUp?.validation?.[i] || 0) *
            regionWeight[i] * repeatability * amplitudeQuality;
          sess.dynamicValidation[i] = Math.max(sess.dynamicValidation[i], validated);
        }
        sess.fieldQ = sess.bottomUpTexture.q;
        for (let i = 0; i < sess.fieldC.length; i++) {
          sess.fieldC[i] = sess.bottomUpTexture.confidence[i] *
            (0.55 + 0.45 * sess.dynamicValidation[i]);
        }
      }
      for (const [region, weight] of Object.entries(ACTION_REGION_WEIGHT[action] || {})) {
        const state = sess.regionState[region];
        if (!state) continue;
        const mask = sess.regionMasks[region];
        let deformSum = 0, deformCount = 0;
        const deformationField = action === "puff" ? current.stretch : current.deformation;
        for (let i = 0; i < mask.length; i++) if (mask[i]) { deformSum += deformationField[i]; deformCount++; }
        const regionDeformation = deformCount ? deformSum / deformCount : 0;
        const directionalFactor = repeatDecision.directionValidated ? 1 : 0.35;
        state.dynamicConfidence = Math.max(state.dynamicConfidence,
          repeatability * directionalFactor * (0.70 + 0.30 * regionDeformation) * weight);
        state.deformationConfidence = Math.max(state.deformationConfidence, regionDeformation * weight);
        state.repeatability = repeatability;
        state.conflict = Math.max(state.conflict, repeatDecision.directionValidated ? 1 - repeatability : 1);
        state.coverage = Math.min(1, state.coverage + 0.35 * weight);
        state.finalConfidence = state.staticConfidence * (0.55 + 0.45 * state.dynamicConfidence);
      }
      // 采集阶段只做单次质量与时序稳定性门控，不提前改写 RSTL。
      // 全部已接受表情会在采集结束后统一进入 YOLO 严格并集与 V6。
      const seedsForTrace = sess.displaySeeds || sess.seeds || [];
      sess.curves = seedsForTrace.map((seed) => ({
        name: seed.name,
        pts: seed.pts.map((point) => [...point]),
        priorPts: seed.pts.map((point) => [...point]),
        kinds: seed.pts.map(() => "prior"),
        refinedFrac: 0,
        movedFrac: 0,
      }));
      sess.optimizationDiagnostics = {
        algorithm: "capture-quality-gate-before-yolo-v6",
        trigger: `action:${action}`,
        final_refinement_pending: true,
        atlas_curve_count: seedsForTrace.length,
      };
      debugRecord.outcome = "accepted_for_yolo_strict_union_v6";
      debugRecord.curve_update_after_action = compactCurveUpdate(sess.curves);
      recordDebugEvent("action_committed", {
        action,
        repeatability,
        direction_validated: repeatDecision.directionValidated,
        effective_sample_count: current.effectiveSampleCount,
        curve_update: debugRecord.curve_update_after_action,
      });
      attachCurveBary(sess.curves);
      try {
        const { canvas: prev } = renderCompareImage(sess.neutralCanonical || sess.lastCanon, sess.displaySeeds || sess.seeds, sess.curves, SIZE);
        if (els.compareCanvas) {
          els.compareCanvas.style.display = "block";
          const cx = els.compareCanvas.getContext("2d");
          cx.clearRect(0, 0, els.compareCanvas.width, els.compareCanvas.height);
          cx.drawImage(prev, 0, 0, els.compareCanvas.width, els.compareCanvas.height);
        }
        if (els.compareSummary) {
          els.compareSummary.innerHTML =
            `<div style="font-size:12px">已接受 ${(sess.completed?.length || 0) + 1} 个表情 · 等待最终 YOLO 严格并集与 V6</div>
             <div class="hint">采集结束前保持 ${atlasLines.length} 条初始先验不变</div>`;
        }
      } catch (_) {}
      sess.completed = sess.completed || [];
      sess.completed.push(action);
      sess.done.push(action);
      sess.attempts[action] = (sess.attempts[action] || 0) + 1;
      sess.cycleFrames = [];
      sess.holdT0 = null;
      sess.apexPeak = 0;
      sess.retryCurrent = false;
      sess.repeatCurrent = false;
      const next = chooseNextAction(sess.regionState, sess.done, sess.skipped, sess.attempts).action;
      if (!next) {
        sess.notRequired = ACTION_ORDER.filter((candidate) => !sess.done.includes(candidate) && !sess.skipped.includes(candidate));
        for (const candidate of sess.notRequired) if (!sess.done.includes(candidate)) sess.done.push(candidate);
        sess.stage = "done";
        sess.phase = "done";
        sess.message = `采集完成（${sess.curves.length} 条）· 正在在线运行 YOLO + V6…`;
        finishExports();
        looping = false;
        setLive(false);
      } else {
        sess.actionIndex = ACTION_ORDER.indexOf(next);
        sess.phase = "paused";
        const resultNote = "单次质量检查通过，已加入 YOLO 0.07 待处理队列";
        sess.message = `「${ACTION_LABELS[action]}」已完成（${resultNote}）→ 点击「下一步：${ACTION_LABELS[next]}」`;
      }
    } catch (e) {
      console.error(e);
      const reason = e?.message || String(e);
      if (debugRecord) {
        debugRecord.failure_reason = reason;
      } else {
        sess.cycleDiagnostics.push({
          id: `${action}-${String((sess.cycleDiagnostics?.length || 0) + 1).padStart(3, "0")}`,
          recorded_at: new Date().toISOString(),
          action,
          action_label: ACTION_LABELS[action],
          round: (sess.actionCycles[action]?.length || 0) + 1,
          outcome: "evidence_extraction_failed",
          captured_peak_frames: sess.cycleFrames.length,
          return_frames: sess.returnFrames.length,
          failure_reason: reason,
        });
      }
      recordDebugEvent("cycle_rejected", { action, reason });
      sess.phase = "paused";
      sess.retryCurrent = true;
      sess.cycleFrames = [];
      sess.returnFrames = [];
      const tip = /reading ['"]?0['"]?/i.test(String(e?.message || e))
        ? "曲线重采样异常，已修复请重试本步"
        : (e.message || String(e));
      sess.message = `本步失败，点击「重新采集」：${tip}`;
      setMsg(sess.message, true);
    }
    processing = false;
    updateGuide();
    setMsg(sess.message);
    if (looping) requestAnimationFrame(tick);
  }, 30);
}

function advanceActionMachine(bs, now, score) {
  const action = ACTION_ORDER[sess.actionIndex];
  if (!action) return;
  const thr = personalThreshold(action, sess.baseline);
  const timed = TIMED_ACTIONS.has(action);
  const raw = actionScore(bs, action);
  const base = sess.baseline?.[action] ?? 0;

  if (sess.phase === "paused" || sess.phase === "processing" || sess.phase === "countdown") {
    setMeters(score / Math.max(thr, 0.01), 0);
    return;
  }

  // 鼓腮/撅嘴：按计时完成
  if (timed && (sess.phase === "onset" || sess.phase === "apex")) {
    if (!sess.holdT0) sess.holdT0 = now;
    sess.phase = "apex";
    sess.apexPeak = Math.max(sess.apexPeak || 0, score);
    const holdNeed = HOLD_NEED * 1.15;
    const hold = (now - sess.holdT0) / holdNeed;
    setMeters(Math.max(score / Math.max(thr, 0.01), Math.min(1, hold)), hold);
    sess.message = `请保持「${ACTION_LABELS[action]}」… ${Math.min(100, hold * 100).toFixed(0)}%（也可点「确认完成本步」）`;
    if (hold >= 1 && sess.cycleFrames.length >= 4) {
      commitCycle(action);
    } else if (hold >= 1) {
      sess.message = "再保持一下，正在取样…";
    }
    return;
  }

  if (sess.phase === "onset") {
    setMeters(score / Math.max(thr, 0.01), 0);
    if (score >= thr * 0.4) {
      sess.phase = "apex";
      sess.holdT0 = now;
    }
    sess.message = `${ACTION_HINT[action]}（相对你的静息再做一点即可）`;
    return;
  }

  if (sess.phase === "apex") {
    sess.apexPeak = Math.max(sess.apexPeak || 0, score);
    if (score >= thr * 0.35) {
      if (!sess.holdT0) sess.holdT0 = now;
      const hold = (now - sess.holdT0) / HOLD_NEED;
      setMeters(score / Math.max(thr, 0.01), hold);
      sess.message = `保持「${ACTION_LABELS[action]}」… ${Math.min(100, hold * 100).toFixed(0)}%`;
      if (hold >= 1 && sess.cycleFrames.length >= 4) {
        commitCycle(action);
      } else if (hold >= 1) {
        sess.message = "再保持一下，正在取样…";
      }
    } else {
      sess.holdT0 = null;
      setMeters(score / Math.max(thr, 0.01), 0);
      const needPct = (thr * 100).toFixed(0);
      const curPct = (score * 100).toFixed(0);
      sess.message = `相对静息再明显一点（现 +${curPct}% / 需 +${needPct}%；静息底 ${ (base * 100).toFixed(0) }%）`;
    }
  }
}

/** 手动确认当前动作完成（用于鼓腮等难检测步骤） */
function confirmCurrentStep() {
  if (!sess || sess.stage !== "actions" || processing) return;
  if (!["onset", "apex"].includes(sess.phase)) return;
  const action = ACTION_ORDER[sess.actionIndex];
  if (!action) return;
  if (sess.cycleFrames.length < 4) {
    setMsg("请先对着镜头鼓腮/做动作再确认", true);
    return;
  }
  sess.message = `峰值已确认，正在提交本轮采集…`;
  commitCycle(action);
}

// ── 6. 主循环 ───────────────────────────────────────────────────────────────
function tick() {
  if (!looping) return;
  if (els.video.readyState < 2) {
    requestAnimationFrame(tick);
    return;
  }

  let lmPx = null;
  const now = performance.now() / 1000;
  try {
    const res = landmarker.detectForVideo(els.video, performance.now());
    const face = res.faceLandmarks?.[0];
    const bs = blendDict(res.faceBlendshapes?.[0]?.categories);
    if (face) {
      lmPx = smoother.filter(toPixels(face, els.video.videoWidth, els.video.videoHeight), now);
      runSession(lmPx, bs, now);
      els.boot.classList.add("hidden");
    } else if (sess) {
      appendCaptureSample({ bs, alignedMesh: null, pose: null, poseQuality: 0, sourceFaceWidth: 0, detectedFace: false });
      sess.message = "未检测到人脸，请正对镜头、光线充足";
      setMsg(sess.message, true);
    }
  } catch (e) {
    console.error(e);
    setMsg(`检测异常：${e.message}`, true);
  }

  try { paint(); } catch (e) { console.warn(e); }
  updateGuide();

  frames++;
  const elapsed = (performance.now() - t0) / 1000;
  if (elapsed > 0.4) {
    els.fps.textContent = `${(frames / elapsed).toFixed(0)} fps`;
    if (elapsed > 2.5) { t0 = performance.now(); frames = 0; }
  }
  if (sess?.stage !== "done") requestAnimationFrame(tick);
}

function runSession(lmPx, bs, now) {
  if (!sess || processing) return;

  // 每帧 warp 到固定 refMesh（表情期姿态过差则跳过，减少转头伪影）
  let warped = null;
  let warpedHi = null;
  let alignedMesh = null;
  let poseQuality = 0;
  let poseSnapshot = null;
  let sourceFaceWidthSnapshot = 0;
  const needFrame = sess.stage === "neutral"
    || (sess.stage === "actions" && ["onset", "apex", "return"].includes(sess.phase));
  if (needFrame && performance.now() - lastEvidenceT > 140) {
    lastEvidenceT = performance.now();
    try {
      const pose = estimatePoseQuality(lmPx);
      poseSnapshot = pose;
      const faceXs = lmPx.slice(0, 468).map((p) => p[0]);
      const sourceFaceWidth = Math.max(...faceXs) - Math.min(...faceXs);
      sourceFaceWidthSnapshot = sourceFaceWidth;
      sess.sourceFaceWidth = sourceFaceWidth;
      // 尚未锁定参考：仅在姿态合格时锁定 refMesh + 掩膜（一次，之后冻结）
      if (!sess.refMesh) {
        if (pose.ok) {
          sess.refLm = lmPx.map((p) => [p[0], p[1]]);
          sess.refMesh = landmarksToCanonicalXY(lmPx, SIZE);
          sess.refMeshHi = sess.refMesh.map((p) => [p[0] * TEXTURE_SIZE / SIZE, p[1] * TEXTURE_SIZE / SIZE]);
          const m = buildMasksFromMesh(sess.refMesh, SIZE);
          sess.skin = m.skin;
          sess.forbidden = m.forbidden;
          const mh = buildMasksFromMesh(sess.refMeshHi, TEXTURE_SIZE);
          sess.skinHi = mh.skin;
          sess.forbiddenHi = mh.forbidden;
          sess.regionMasks = buildRegionMasks(sess.refMesh, sess.skin, SIZE);
          sess.regionMasksHi = buildRegionMasks(sess.refMeshHi, sess.skinHi, TEXTURE_SIZE);
        } else if (sess.stage === "neutral") {
          sess.message = "请正对镜头以锁定参考网格…";
        }
      }
      if (sess.refMesh) {
        if (sess.stage === "actions" && !pose.ok) {
          sess.message = `请正对镜头（姿态偏差过大，本帧未采）`;
        } else {
          warped = warpFrameToRef(lmPx);
          alignedMesh = landmarksToCanonicalXY(lmPx, SIZE, sess.refMesh, {
            anchorIndices: CANONICAL_REGISTRATION_ANCHORS,
          });
          const registration = stableRegistrationMetrics(
            sess.refMesh,
            alignedMesh,
            canonicalFaceWidth(sess),
          );
          sess.currentRegistration = registration;
          sess.currentAlignedMesh = alignedMesh;
          const faceMetrics = adaptiveFaceResolutionMetrics({
            sourceFaceWidth,
            cameraWidth: els.video.videoWidth || sess.captureSettings?.width || 1280,
          });
          sess.sourceFaceMetrics = faceMetrics;
          // 分辨率只影响证据权重，不再阻断帧入库。低清摄像头仍可完成流程，
          // 优化器会通过 sourceFaceQuality 自动增加锚定与回退。
          warpedHi = warpFrameToRef(lmPx, TEXTURE_SIZE);
          poseQuality = Math.max(0, Math.min(1,
            0.5 * (1 - Math.abs(pose.rollDeg) / 18) +
            0.5 * (1 - Math.abs(pose.yawProxy) / 0.22)
          )) * (0.7 + 0.3 * faceMetrics.quality);
          if (warped) sess.lastCanon = warped;
        }
      }
    } catch (_) {}
    appendCaptureSample({
      bs,
      alignedMesh,
      registration: sess.currentRegistration,
      pose: poseSnapshot,
      poseQuality,
      sourceFaceWidth: sourceFaceWidthSnapshot,
      detectedFace: true,
    });
  }

  if (sess.stage === "neutral") {
    // 静息阶段：warp 帧入库；blendshape 建个人基线（不因眉型误拦）
    if (warped) {
      sess.neutralFrames.push(warped);
      if (sess.neutralFrames.length > 40) sess.neutralFrames.shift();
    }
    if (warpedHi) {
      sess.neutralGrayFramesHi.push(grayFromImageData(warpedHi));
      if (sess.neutralGrayFramesHi.length > 24) sess.neutralGrayFramesHi.shift();
    }
    if (alignedMesh) {
      for (const action of ACTION_ORDER) {
        const residual = actionMeshResidual(sess.refMesh, alignedMesh, action);
        const samples = sess.neutralMeshResiduals[action];
        if (Number.isFinite(residual)) samples.push(residual);
        if (samples.length > 30) samples.shift();
      }
    }
    if (bs && Object.keys(bs).length) {
      sess.neutralBs = sess.neutralBs || [];
      sess.neutralBs.push({ ...bs });
      if (sess.neutralBs.length > 60) sess.neutralBs.shift();
    }
    // 用滚动基线看「相对扰动」，仅作提示不阻断
    const runningBase = estimateBaseline(sess.neutralBs || []);
    const dom = dominantExpression(bs, runningBase);
    const thr0 = personalThreshold(dom.action || "smile", runningBase);
    setMeters(
      Math.min(1, dom.score / Math.max(thr0, 0.05)),
      Math.min(1, (sess.neutralGrayFramesHi.length || 0) / NEUTRAL_NEED),
    );
    const faceMetrics = sess.sourceFaceMetrics;
    const progressText = `静息标定中 ${Math.min(sess.neutralGrayFramesHi.length, NEUTRAL_NEED)}/${NEUTRAL_NEED}（皮纹 + 几何基线）`;
    sess.message = faceMetrics?.tooClose
      ? `${progressText}；可稍微远离镜头，避免脸部裁切或失焦`
      : faceMetrics?.belowSoftMinimum
        ? `${progressText}；若方便可稍靠近一些（不会阻塞采集）`
        : progressText;
    if (sess.neutralGrayFramesHi.length >= NEUTRAL_NEED) {
      try {
        const med = medianImages(sess.neutralFrames.slice(-NEUTRAL_NEED));
        sess.neutralGrayHi = temporalMedianGray(sess.neutralGrayFramesHi.slice(-NEUTRAL_NEED));
        sess.neutralGray = downsampleGray(sess.neutralGrayHi, TEXTURE_SIZE, TEXTURE_SIZE, SIZE, SIZE);
        sess.lastCanon = med;
        sess.neutralCanonical = med;
        retainYoloSample("neutral", 1, med);
        sess.baseline = estimateBaseline(sess.neutralBs || []);
        for (const action of ACTION_ORDER) {
          sess.returnMeshThresholds[action] = estimateReturnMeshThreshold(sess.neutralMeshResiduals[action]);
        }
        const mesh3 = (sess.refMesh || []).map((p) => [p[0], p[1], 0]);
        if (mesh3.length < 100) throw new Error("关键点不足");
        const masks = buildMasksFromMesh(sess.refMesh, SIZE);
        sess.skin = masks.skin;
        sess.forbidden = masks.forbidden;
        const prior = rasterizePrior(atlasLines, mesh3, triangles, SIZE, { expandForehead: false });
        const topologySeeds = mapAtlas(atlasLines, mesh3, triangles, { expandForehead: false }).map((line, id) => ({
          name: line.name,
          region: line.region || atlasLines[id]?.region || "",
          id,
          pts: line.pts.map((point) => [point[0], point[1]]),
        }));
        if (topologySeeds.length !== atlasLines.length
          || topologySeeds.some((line, id) => line.pts.length !== atlasLines[id].points.length)) {
          throw new Error("初始 RSTL 的曲线或点数未保持");
        }
        sess.q0 = prior.q0;
        sess.seeds = topologySeeds;
        // 全部 atlas 线都参与精修；可读性靠逐点分类着色（只有 refined 才粉色）
        sess.displaySeeds = topologySeeds;
        sess.refMeshId = `ref_${Date.now().toString(36)}`;
        sess.fieldQ = prior.q0.slice();
        sess.fieldC = new Float32Array(SIZE * SIZE);
        const staticHi = buildStaticHessianTextureTemplate(
          sess.neutralGrayHi,
          sess.neutralGrayFramesHi.slice(-NEUTRAL_NEED),
          TEXTURE_SIZE,
          TEXTURE_SIZE,
          sess.skinHi,
        );
        const staticLow = downsampleAxialEvidence(staticHi.q, staticHi.confidence, staticHi.ridge,
          TEXTURE_SIZE, TEXTURE_SIZE, SIZE, SIZE);
        sess.bottomUpStaticHi = staticHi;
        sess.bottomUpTexture = staticLow;
        sess.staticEvidence = staticLow;
        sess.staticEvidenceDiagnostics = {
          frames_evaluated: staticHi.frameCount,
          illumination_stability: staticHi.illuminationStability,
          temporal_stability: summarizeWeightedField(staticHi.temporalStability, sess.skinHi),
          temporal_persistence: summarizeWeightedField(staticHi.temporalStability, sess.skinHi),
        };
        sess.fieldQ = staticLow.q.slice();
        sess.fieldC = staticLow.confidence.slice();
        sess.ridgeField = staticLow.ridge.slice();
        sess.dynamicValidation.fill(0);
        for (const [region, mask] of Object.entries(sess.regionMasks)) {
          let sum = 0, count = 0;
          for (let i = 0; i < mask.length; i++) if (mask[i]) { sum += staticLow.confidence[i]; count++; }
          sess.regionState[region].staticConfidence = count ? sum / count : 0;
          sess.regionState[region].finalConfidence = sess.regionState[region].staticConfidence * 0.40;
        }
        recordDebugEvent("neutral_calibrated", {
          source_face_width_px: sess.sourceFaceWidth,
          static_field: summarizeWeightedField(staticLow.confidence, sess.skin),
          static_temporal_stability: summarizeWeightedField(staticHi.temporalStability, sess.skinHi),
          static_temporal_persistence: summarizeWeightedField(staticHi.temporalStability, sess.skinHi),
          static_illumination_stability: staticHi.illuminationStability,
          static_frames_evaluated: staticHi.frameCount,
          region_static_confidence: Object.fromEntries(Object.entries(sess.regionState)
            .map(([region, state]) => [region, state.staticConfidence])),
          return_mesh_thresholds_px: sess.returnMeshThresholds,
        });
        sess.pendingClipStop = stopClipRecording("neutral_calibrated");
        sess.curves = [];
        sess.stage = "actions";
        sess.phase = "paused";
        sess.actionIndex = 0;
        sess.retryCurrent = false;
        const first = ACTION_LABELS[ACTION_ORDER[0]];
        const browBase = ((sess.baseline.raise_brows || 0) * 100).toFixed(0);
        sess.message = `个人基线已标定（抬眉静息 ${browBase}%）。点击「下一步：${first}」`;
        els.skip.disabled = false;
      } catch (e) {
        console.error(e);
        sess.neutralFrames = [];
        sess.neutralGrayFramesHi = [];
        sess.neutralBs = [];
        sess.message = `静息建场失败，请重试：${e.message}`;
        setMsg(sess.message, true);
      }
    }
    setMsg(sess.message);
    return;
  }

  if (sess.stage === "actions") {
    const action = ACTION_ORDER[sess.actionIndex];
    const score = relativeScore(bs, action, sess.baseline);
    if (warped && warpedHi && ["onset", "apex"].includes(sess.phase) && sess.cycleFrames.length < 40) {
      sess.cycleFrames.push({
        image: warpedHi,
        imageLow: cloneImageData(warped),
        grayLow: grayFromImageData(warped),
        // Umeyama similarity to the frozen reference removes rigid head motion;
        // triangle Jacobians are then computed from the residual mesh only.
        meshAligned: alignedMesh || landmarksToCanonicalXY(lmPx, SIZE, sess.refMesh, {
          anchorIndices: CANONICAL_REGISTRATION_ANCHORS,
        }),
        registrationResidualPx: sess.currentRegistration?.p90Px ?? null,
        actionScore: score,
        tracking: poseQuality,
      });
    }
    advanceActionMachine(bs, now, score);
    setMsg(sess.message);
  }
}

// ── 7. 倒计时与开停摄像头 ───────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function showCountdown(n, tip) {
  if (!els.countdown) return;
  els.countdown.classList.remove("hidden");
  // 触发动画重播
  els.countNum.style.animation = "none";
  void els.countNum.offsetWidth;
  els.countNum.style.animation = "";
  els.countNum.textContent = String(n);
  if (els.countTip) els.countTip.textContent = tip || "";
}

function hideCountdown() {
  if (els.countdown) els.countdown.classList.add("hidden");
}

/** 用户点击后：3-2-1 再开始采集 */
async function beginCurrentAction() {
  if (!sess || sess.stage !== "actions" || sess.phase !== "paused" || processing) return;
  const action = ACTION_ORDER[sess.actionIndex];
  if (!action) return;
  while (sess.done.includes(ACTION_ORDER[sess.actionIndex])
    && sess.actionIndex < ACTION_ORDER.length) {
    sess.actionIndex += 1;
  }
  const next = ACTION_ORDER[sess.actionIndex];
  if (!next) {
    sess.stage = "done";
    sess.phase = "done";
    sess.message = "全部步骤已完成";
    finishExports();
    updateGuide();
    return;
  }

  const label = ACTION_LABELS[next];
  const roundNumber = (sess.actionCycles?.[next]?.length || 0) + 1;
  const roundHint = ACTION_HINT[next];
  sess.phase = "countdown";
  sess.cycleFrames = [];
  sess.holdT0 = null;
  sess.apexPeak = 0;
  sess.message = `准备「${label}」…`;
  setMsg(sess.message);
  updateGuide();
  els.start.disabled = true;

  try {
    for (const n of [3, 2, 1]) {
      if (!sess || sess.stage !== "actions") return;
      showCountdown(n, n === 3 ? `${label} · 单次采集` : n === 2 ? roundHint : "马上开始！");
      sess.message = `${label} · 单次采集 · ${n}`;
      setMsg(sess.message);
      await sleep(900);
    }
    showCountdown("开始", `请做「${label}」并保持`);
    await sleep(450);
  } finally {
    hideCountdown();
  }

  if (!sess || sess.stage !== "actions") return;
  await startClipRecording(next, roundNumber, "action_cycle");
  sess.retryCurrent = false;
  sess.phase = "onset";
  sess.holdT0 = TIMED_ACTIONS.has(next) ? performance.now() / 1000 : null;
  sess.apexPeak = 0;
  sess.cycleFrames = [];
  sess.message = roundHint;
  setMsg(sess.message);
  updateGuide();
}

async function onStartClick() {
  // 已开摄像头且停在某步：点按钮 → 倒计时 → 采集
  if (sess && stream && sess.stage === "actions" && sess.phase === "paused") {
    await beginCurrentAction();
    return;
  }
  // 首次：开摄像头 + 静息
  if (stream && sess && sess.stage !== "done") return;
  await startCapture();
}

async function startCapture() {
  els.start.disabled = true;
  setMsg("请求摄像头权限…");
  els.boot.textContent = "请允许摄像头权限";
  els.boot.classList.remove("hidden");
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("浏览器不支持摄像头（需 HTTPS）");
    }
    const trials = [
      { video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { facingMode: "user" }, audio: false },
      { video: true, audio: false },
    ];
    let err = null;
    for (const c of trials) {
      try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
      catch (e) { err = e; }
    }
    if (!stream) throw err || new Error("无法打开摄像头");
    els.video.srcObject = stream;
    els.video.muted = true;
    await els.video.play();
    for (let i = 0; i < 40 && !els.video.videoWidth; i++) await new Promise((r) => setTimeout(r, 50));
    if (!els.video.videoWidth) throw new Error("摄像头无画面");

    setLive(true);
    els.boot.textContent = "加载模型中…";
    await ensureModels();

    sess = createSessionState(SIZE);
    sess.algorithmVersion = BOTTOM_UP_PERSONALIZATION_VERSION;
    sess.parameterVersion = BOTTOM_UP_PARAMETER_VERSION;
    sess.yoloSamples = [];
    sess.finalizationPromise = null;
    sess.v6Result = null;
    personalizedAtlasStaged = false;
    personalizedActiveAtlas = null;
    if (els.usePersonalized) els.usePersonalized.disabled = true;
    if (els.wrinkleMaskPanel) els.wrinkleMaskPanel.style.display = "none";
    if (els.wrinkleMaskDownload) els.wrinkleMaskDownload.disabled = true;
    if (els.wrinkleSemanticDownload) els.wrinkleSemanticDownload.disabled = true;
    if (els.wrinkleAlignmentDownload) els.wrinkleAlignmentDownload.disabled = true;
    if (els.wrinkleEvidenceDownload) els.wrinkleEvidenceDownload.disabled = true;
    setLocalPipelineStatus("采集完成后将在本机运行 YOLO 0.07 与 V6。", 0);
    releaseMediaUrls();
    if (els.debugMediaExports) els.debugMediaExports.innerHTML = "";
    sess.recordingEnabled = consentToDebugRecording();
    if (els.recordDebugMedia) els.recordDebugMedia.disabled = true;
    const cameraSettings = stream.getVideoTracks?.()[0]?.getSettings?.() || {};
    sess.captureSettings = {
      width: cameraSettings.width || els.video.videoWidth || null,
      height: cameraSettings.height || els.video.videoHeight || null,
      frameRate: cameraSettings.frameRate || null,
      facingMode: cameraSettings.facingMode || null,
    };
    recordDebugEvent("session_started", { camera: sess.captureSettings });
    await startClipRecording("neutral", 1, "neutral_reference");
    const masks = buildMasks(SIZE);
    sess.skin = masks.skin;
    sess.forbidden = masks.forbidden;
    sess.neutralFrames = [];
    sess.neutralBs = [];
    sess.baseline = null;
    sess.done = [];
    sess.completed = [];
    sess.skipped = [];
    sess.cycleFrames = [];
    sess.phase = "paused";
    smoother.reset();

    els.stop.disabled = false;
    els.skip.disabled = true;
    if (els.debug) els.debug.disabled = false;
    els.boot.classList.add("hidden");
    setMsg("请放松面部，开始静息采集");
    updateGuide();

    looping = true;
    t0 = performance.now();
    frames = 0;
    requestAnimationFrame(tick);
  } catch (e) {
    console.error(e);
    await stopClipRecording("startup_failed");
    if (stream) { stream.getTracks().forEach((track) => track.stop()); stream = null; }
    if (els.recordDebugMedia) els.recordDebugMedia.disabled = false;
    els.start.disabled = false;
    syncStartButton();
    setLive(false);
    const tip = /NotAllowed|Permission/i.test(`${e.name} ${e.message}`)
      ? "请允许摄像头权限后重试"
      : e.message;
    setMsg(`启动失败：${tip}`, true);
    els.boot.textContent = `启动失败：${tip}`;
    els.badge.textContent = "失败";
    els.badge.classList.add("warn");
  }
}

async function skipStep() {
  if (!sess || sess.stage !== "actions" || processing) return;
  // 采集中也可跳过；paused 时跳过当前待采动作
  const action = ACTION_ORDER[sess.actionIndex];
  if (!action) return;
  await stopClipRecording("action_skipped");
  sess.skipped = sess.skipped || [];
  sess.skipped.push(action);
  recordDebugEvent("action_skipped", { action, phase: sess.phase });
  sess.done.push(action); // 仅用于步骤推进/列表状态
  sess.cycleFrames = [];
  sess.returnFrames = [];
  sess.holdT0 = null;
  const next = chooseNextAction(sess.regionState, sess.done, sess.skipped, sess.attempts).action;
  if (!next) {
    const seedsForTrace = sess.displaySeeds || sess.seeds;
    if (seedsForTrace) {
      sess.curves = seedsForTrace.map((s) => ({
        name: s.name,
        pts: s.pts.map((point) => [...point]),
        priorPts: s.pts.map((point) => [...point]),
        kinds: s.pts.map(() => "prior"),
        refinedFrac: 0, movedFrac: 0,
      }));
    }
    attachCurveBary(sess.curves);
    sess.stage = "done";
    sess.phase = "done";
    sess.message = "已跳过剩余步骤并导出当前结果";
    finishExports();
    looping = false;
    setLive(false);
  } else {
    sess.actionIndex = ACTION_ORDER.indexOf(next);
    sess.phase = "paused";
    sess.retryCurrent = false;
    sess.message = `已跳过「${ACTION_LABELS[action]}」。点击「下一步：${ACTION_LABELS[next]}」`;
  }
  updateGuide();
  setMsg(sess.message);
}

async function stopCapture() {
  if (sess) recordDebugEvent("session_stopped", { stage: sess.stage, phase: sess.phase });
  await stopClipRecording("session_stopped");
  looping = false;
  setLive(false);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (sess?.curves?.length || sess?.seeds?.length) {
    if (!sess.curves?.length && sess.seeds) {
      sess.curves = sess.seeds.map((s) => ({ name: s.name, pts: s.pts }));
    }
    attachCurveBary(sess.curves);
    await finishExports();
  }
  if (sess) preserveFinalDebugDownload(buildDebugPayload(sess));
  sess = null;
  els.start.disabled = false;
  els.start.textContent = "开始采集";
  els.stop.disabled = true;
  els.skip.disabled = true;
  if (els.debug) els.debug.disabled = true;
  if (els.recordDebugMedia) els.recordDebugMedia.disabled = false;
  els.coach.classList.add("hidden");
  els.boot.classList.remove("hidden");
  els.boot.textContent = "已结束，可再次开始";
  setMsg("已结束");
  syncStartButton();
}

els.start.addEventListener("click", () => { onStartClick(); });
els.stop.addEventListener("click", stopCapture);
els.skip.addEventListener("click", skipStep);
if (els.confirm) els.confirm.addEventListener("click", confirmCurrentStep);
if (els.debug) els.debug.addEventListener("click", downloadDebugPayload);
if (els.discardDebugMedia) els.discardDebugMedia.addEventListener("click", discardDebugRecording);
// 页面卸载时主动回收 Blob URL，避免录制的人脸视频比标签页活得更久。
window.addEventListener("pagehide", releaseMediaUrls);
if (els.wrinkleMaskDownload) els.wrinkleMaskDownload.addEventListener("click", () => {
  if (!els.wrinkleMaskCanvas) return;
  const link = document.createElement("a");
  link.href = els.wrinkleMaskCanvas.toDataURL("image/png");
  link.download = `wrinkle_mask_strict_union_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  link.click();
});
if (els.wrinkleSemanticDownload) els.wrinkleSemanticDownload.addEventListener("click", () => {
  if (!els.wrinkleSemanticCanvas) return;
  const link = document.createElement("a");
  link.href = els.wrinkleSemanticCanvas.toDataURL("image/png");
  link.download = `wrinkle_mask_semantic_front_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  link.click();
});
if (els.wrinkleAlignmentDownload) els.wrinkleAlignmentDownload.addEventListener("click", () => {
  if (!els.wrinkleAlignmentCanvas) return;
  const link = document.createElement("a");
  link.href = els.wrinkleAlignmentCanvas.toDataURL("image/png");
  link.download = `wrinkle_alignment_audit_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  link.click();
});
if (els.wrinkleEvidenceDownload) els.wrinkleEvidenceDownload.addEventListener("click", () => {
  if (!els.wrinkleEvidenceCanvas) return;
  const link = document.createElement("a");
  link.href = els.wrinkleEvidenceCanvas.toDataURL("image/png");
  link.download = `wrinkle_v6_evidence_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  link.click();
});
async function openLiveWorkspace() {
  const activeAtlas = personalizedActiveAtlas || sess?.v6Result?.activeAtlas || null;
  if (!activeAtlas || !els.liveWorkspace || !els.liveWorkspaceFrame) return;
  if (!dataSource.stagePreviewAtlas(activeAtlas)) {
    setMsg("浏览器无法暂存个性化 Atlas，实时 2D 工作区未打开；仍可下载当前结果。", true);
    return;
  }
  personalizedAtlasStaged = true;
  await stopClipRecording("enter_live_2d_workspace");
  looping = false;
  setLive(false);
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
    els.video.srcObject = null;
  }
  els.liveWorkspace.hidden = false;
  els.liveWorkspaceFrame.src = `/app/live?embedded=personalized&v=${Date.now()}`;
}

function closeLiveWorkspace() {
  if (!els.liveWorkspace || !els.liveWorkspaceFrame) return;
  // Unloading the child page also releases any camera it opened. The atlas is
  // retained here and will be staged again if the workspace is reopened.
  els.liveWorkspaceFrame.src = "about:blank";
  els.liveWorkspace.hidden = true;
  setMsg("个性化 RSTL 已保留；可继续查看 Mask、对比图，或再次进入实时 2D 工作区。");
}

if (els.usePersonalized) els.usePersonalized.addEventListener("click", () => { void openLiveWorkspace(); });
if (els.closeLiveWorkspace) els.closeLiveWorkspace.addEventListener("click", closeLiveWorkspace);

updateGuide();
setMeters(0, 0);
setLocalPipelineStatus("采集完成后将在本机运行 YOLO 0.07 与 V6。", 0);
els.badge.textContent = "就绪";
els.badge.classList.remove("warn");
setMsg("点击「开始采集」开启摄像头；每完成一步需再点一次进入下一步。");
