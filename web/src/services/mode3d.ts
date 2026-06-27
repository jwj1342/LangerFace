// 3D 重建（Beta）：转头扫描/示例重建 → 旋转查看 → 相似变换投影回实时画面。
import { RIGID3D } from "./constants.ts";
import { assetUrls } from "./assetLoader.ts";
import { CAMERA_CONSTRAINTS, describeCameraError, openCameraStream } from "./cameraSource.ts";
import { dataSource } from "./dataSource.ts";
import { ctx as boundCtx, els } from "./liveDom.ts";
import { toPixels } from "./geometryAtlas.ts";
import { applySim, umeyama } from "./geometryTransform.ts";
import type { Triangle, Vec3 } from "./softBody.ts";
import { facesArray, fitExpression, fitShape, flameForward, loadFlameBasis } from "./flameFit.ts";
import type { FlameBasis } from "./flameFit.ts";
import { countMetric, logWarn, recordEvent, recordMetricSample, setDiagnosticSection } from "./logger.ts";
import { ensureReady } from "./pipelineModels.ts";
import { showCameraPlaceholder, startCamera, stopSource } from "./pipelineSource.ts";
import { modelState, reconState, renderState, sourceState } from "./liveState.ts";
import { setLive, setMsg } from "./liveUi.ts";

type AnyRecord = Record<string, any>;
type ColorFrame = Vec3[];
type FlameAtlasLine = { name?: string; region?: string; points3d: Vec3[] };
type FlameOverlayContext = { canonical: Vec3[]; triangles: Triangle[] };

interface TriangleGrid {
  buckets: Map<string, number[]>;
  cell: number;
  lo: Vec3;
  center: Vec3;
  eps: number;
  key: (ix: number, iy: number, iz: number) => string;
  idx: (p: Vec3) => [number, number, number];
}

function currentCtx(): CanvasRenderingContext2D {
  if (!boundCtx) throw new Error("Live canvas context is not bound.");
  return boundCtx;
}

const ctx = new Proxy({} as CanvasRenderingContext2D, {
  get(_target, key: PropertyKey) {
    const value = (currentCtx() as AnyRecord)[key as keyof CanvasRenderingContext2D];
    return typeof value === "function" ? value.bind(currentCtx()) : value;
  },
  set(_target, key: PropertyKey, value: unknown) {
    (currentCtx() as AnyRecord)[key as keyof CanvasRenderingContext2D] = value;
    return true;
  },
});

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const asVec3 = (point: number[]): Vec3 => [Number(point[0]), Number(point[1]), Number(point[2] || 0)];
const asTriangles = (triangles: unknown): Triangle[] => (Array.isArray(triangles) ? triangles as Triangle[] : []);

// 偏航覆盖门控：扫描结束前要求左右转头的偏航跨度（ymax-ymin）至少达到该值，
// 否则只采到近正脸样本、深度 Z 无侧脸视角约束，不同人深度剖面会趋同（见 #36）。
const YAW_SPAN_MIN = 0.5;

let canonicalRef: Vec3[] | null = null;
let scanColorCanvas: HTMLCanvasElement | null = null;
let scanColorCtx: CanvasRenderingContext2D | null = null;
const COLOR_SAMPLE_W = 320;
const SCAN_TARGET_SECS = 9;
const SCAN_TARGET_FRAMES = 40;
const YAW_DISPLAY_SPAN = 0.5;
let flameDemoLines: FlameAtlasLine[] | null = null;
let flameDemoOverlayContext: FlameOverlayContext | null = null;

async function fetchCanonicalRef(): Promise<Vec3[]> {
  if (canonicalRef) return canonicalRef;
  const cv = (await dataSource.getHeadMesh("mediapipe-468")).vertices;
  canonicalRef = cv.map((p: number[]) => [p[0], -p[1], -p[2]]);  // 翻到屏幕手性 (y下,z入屏)
  return canonicalRef;
}

async function ensureHead3D(): Promise<void> {
  if (reconState.head3d) return;
  const mod = await import("./three3d.ts");
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
    reconState.head3d?.zoom(Math.exp(Math.max(-160, Math.min(160, e.deltaY || 0)) * 0.001));
  }, { passive: false });
  els.three.addEventListener("dblclick", resetView3d);
}

async function buildViewer(): Promise<void> {
  await ensureHead3D();
  const head = reconState.head3d;
  if (!head) return;
  const disp = reconState.reconDisplaySpace === "screen"
    ? (reconState.reconVerts as Vec3[]).map((p: Vec3): Vec3 => [p[0], -p[1], -p[2]])  // MediaPipe 重建：翻成 y 上供查看
    : reconState.reconVerts;
  const faces = reconState.reconFaces || modelState.triangles;
  const atlasLines = reconState.reconAtlasLines ?? modelState.atlases[renderState.system];
  head.setGeometry(
    disp,
    faces,
    // setActiveAtlas() updates this shared atlas table; 3D view picks it up only when buildViewer() reruns.
    atlasLines,
    { showSurface: true, bands: renderState.bands, vertexColors: reconState.reconColors },
  );
  applyIncisionOverlayToViewer(disp, faces);
  els.view3d.disabled = false; els.project3d.disabled = !reconState.reconProjectable;
  els.reset3d.disabled = false; els.cloudFitFlame.disabled = false;
  setMode3d("view");
}

function refsToCanonicalPoints(refs: AnyRecord[] | null | undefined, canonical: Vec3[], triangles: Triangle[]): Vec3[] {
  return (refs || []).map((ref) => {
    const tri = triangles?.[ref?.tri];
    if (!tri || tri.length < 3) return null;
    const A = canonical[tri[0]], B = canonical[tri[1]], C = canonical[tri[2]];
    if (!A || !B || !C) return null;
    const u = Number(ref.u), v = Number(ref.v), w = Number(ref.w ?? (1 - u - v));
    if (![u, v, w].every(Number.isFinite)) return null;
    return [
      u * A[0] + v * B[0] + w * C[0],
      u * A[1] + v * B[1] + w * C[1],
      u * A[2] + v * B[2] + w * C[2],
    ];
  }).filter((point): point is Vec3 => Boolean(point));
}

function mediaPipeOverlayToFlamePoints(
  overlay: AnyRecord,
  canonical: Vec3[],
  triangles: Triangle[],
  flameVerts: Vec3[],
  basis: FlameBasis,
): AnyRecord {
  const { src, dst } = sampleFlameLandmarkPairs(flameVerts, basis, canonical);
  const sim = umeyama(src as Vec3[], dst as Vec3[]);
  const flameFaces = facesArray(basis);
  const grid = buildTriangleGrid(flameVerts, flameFaces);
  const transformRefs = (refs: AnyRecord[] | null | undefined): Vec3[] => applySim(sim, refsToCanonicalPoints(refs, canonical, triangles))
    .map((p) => snapPointToMesh(p, flameVerts, flameFaces, grid));
  return {
    schema_version: "incision-overlay-3d-points/v0.1",
    candidate_type: overlay.candidate_type,
    tumor_center_point: transformRefs([overlay.tumor?.center_ref])[0] || null,
    tumor_boundary_points: transformRefs(overlay.tumor?.boundary_refs || []),
    candidate_points: transformRefs(overlay.candidate?.polyline_refs || []),
  };
}

function recordIncisionOverlay3dDiagnostics(summary: AnyRecord | null | undefined, mappingMode: string): void {
  const overlay = renderState.incisionOverlay as AnyRecord | null;
  if (!summary || !overlay) {
    setDiagnosticSection("incision_overlay_3d_view", null);
    return;
  }
  setDiagnosticSection("incision_overlay_3d_view", {
    schema_version: "incision-overlay-3d-view-diagnostics/v0.1",
    updated_at: new Date().toISOString(),
    raw_image_sent: false,
    exported_raw_pixels: false,
    mapping_mode: mappingMode,
    recon_display_space: reconState.reconDisplaySpace,
    recon_projectable: reconState.reconProjectable === true,
    overlay: {
      schema_version: overlay.schema_version,
      label: overlay.label || "",
      candidate_type: overlay.candidate_type || "",
      tumor_kind: overlay.tumor_kind || "",
      review_status: overlay.review?.status || "",
      live_overlay_ready: overlay.review_gate?.live_overlay_ready === true,
    },
    viewer: summary,
    clinical_boundary: "3D incision overlay is an engineering visualization, not patient-specific clinical AR registration.",
  });
}

function applyIncisionOverlayToViewer(displayVerts: Vec3[], faces: Triangle[]): AnyRecord | null {
  const overlay = renderState.incisionOverlay as AnyRecord | null;
  if (!reconState.head3d) return null;
  if (!overlay) {
    reconState.head3d.clearIncisionOverlay?.();
    setDiagnosticSection("incision_overlay_3d_view", null);
    return null;
  }
  let summary;
  let mappingMode = "mediapipe_468_surface_refs";
  if (reconState.reconDisplaySpace === "screen") {
    summary = reconState.head3d.setIncisionOverlay(overlay, displayVerts, faces);
  } else if (reconState.reconDisplaySpace === "model" && reconState.flameBasis && flameDemoOverlayContext) {
    mappingMode = "mediapipe_468_refs_to_flame_demo_nearest_surface";
    const overlay3d = mediaPipeOverlayToFlamePoints(
      overlay,
      flameDemoOverlayContext.canonical,
      flameDemoOverlayContext.triangles,
      displayVerts,
      reconState.flameBasis,
    );
    summary = reconState.head3d.setIncisionOverlayPoints(overlay3d);
  } else {
    summary = {
      schema_version: "incision-overlay-3d-view/v0.1",
      rendered: false,
      reason: "unsupported_3d_overlay_mapping",
    };
    reconState.head3d.clearIncisionOverlay?.();
  }
  recordIncisionOverlay3dDiagnostics(summary, mappingMode);
  return summary;
}

export function resetView3d() {
  reconState.rot.x = 0; reconState.rot.y = 0;
  reconState.head3d?.resetView();
}

// ── 实时孪生：左实时人脸 / 右 FLAME 头随头姿转 + 浏览器本地拟合（身份 + 表情 + 张嘴）──────
// 头姿调参（这边看不到渲染，留旋钮；若「转反了」翻对应 sign）。jaw 调参见 flameFit.ts 的 JAW。
const POSE = { yawSign: 1, pitchSign: 1, pitchClamp: 1.3 };
const ZERO_BETA = new Float64Array(60);  // 标准头身份系数（全 0 = neutral 标准脸）
const EXPR_AMPLIFY = 1.3;  // 表情放大（landmark-only 拟合偏淡，放大更明显；旋钮）
let twinRAF: number | null = null;
let twinFaces: Triangle[] | null = null;
let twinMeshReady = false;
let twinTexturedMesh = false;

export function stopTwin(): void {
  if (twinRAF != null) cancelAnimationFrame(twinRAF);
  twinRAF = null;
  els.mainWrap.classList.remove("twin");
}

// 「▶ 实时孪生」：加载基(一次) → 分屏 + 开摄像头(左) → 右 FLAME 头随头姿转 + 每帧本地表情/张嘴拟合。
export async function startTwin(): Promise<void> {
  els.reconStatus.textContent = "加载 FLAME 基（约 6.9MB，仅首次）…";
  try {
    if (!reconState.flameBasis) reconState.flameBasis = await loadFlameBasis(assetUrls.flameBasis);
    if (!canonicalRef) await fetchCanonicalRef();
  } catch (err) {
    els.reconStatus.textContent = "FLAME 基加载失败：" + errorMessage(err);
    return;
  }
  const basis = reconState.flameBasis as FlameBasis;
  twinFaces = facesArray(basis);
  twinMeshReady = false; twinTexturedMesh = false;
  reconState.flameBeta = null;  // 身份待首帧拟合
  reconState.twinMode = "individual";
  els.flameStd.checked = false;
  els.twinTexture.checked = false; reconState.twinTexture = false;
  els.flameHeadToggleWrap.style.display = "";
  els.twinTextureWrap.style.display = "";

  await ensureHead3D();
  reconState.head3d?.setGeometry(
    flameForward(basis, ZERO_BETA, new Float64Array(basis.NE), 0), twinFaces, [], { showSurface: true, bands: false });
  twinMeshReady = true;

  reconState.route = "3d"; reconState.mode3d = "twin";
  els.mainWrap.classList.add("twin");
  els.canvas.classList.remove("hidden"); els.three.classList.remove("hidden");
  setLive(true, "实时孪生");
  await startCamera();  // 复用主管线：画左侧人脸 + 每帧更新 sourceState.lastLM / jawOpen
  if (twinRAF != null) cancelAnimationFrame(twinRAF);
  twinLoop();
}

// 每帧：头姿跟随 + 身份(首帧一次) + 表情拟合 + 张嘴(MediaPipe jawOpen) → FLAME 前向 → 原地更新顶点。
function twinLoop(): void {
  if (reconState.mode3d !== "twin" || !reconState.head3d) return;
  const lm = sourceState.lastLM as Vec3[] | null;
  const basis = reconState.flameBasis as FlameBasis | null;
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
        els.reconStatus.textContent = "拟合失败：" + errorMessage(err);
      }
    }
  }
  const tr = els.three.getBoundingClientRect();
  reconState.head3d.resize(Math.max(2, tr.width | 0), Math.max(2, tr.height | 0));
  reconState.head3d.render();
  twinRAF = requestAnimationFrame(twinLoop);
}

// 用 Umeyama(标准脸→当前关键点) 的旋转，提取 yaw/pitch 驱动右侧头（roll 暂略）。
function applyHeadPose(lm: Vec3[]): void {
  const canonical = canonicalRef;
  if (!canonical) return;
  const src = RIGID3D.map((i) => canonical[i]);
  const dst = RIGID3D.map((i) => lm[i]);
  let R;
  try { R = umeyama(src, dst).R; } catch { return; }
  let yaw = Math.atan2(R[0][2], R[2][2]) * POSE.yawSign;
  let pitch = Math.atan2(-R[1][2], Math.hypot(R[1][0], R[1][1])) * POSE.pitchSign;
  pitch = Math.max(-POSE.pitchClamp, Math.min(POSE.pitchClamp, pitch));
  reconState.head3d?.setRotation(pitch, yaw);
}

// 「标准⇄个体」开关：仅切 twinMode，下一帧 twinLoop 自动按之渲染。
export function toggleTwinHead(): void {
  if (reconState.mode3d !== "twin") return;
  reconState.twinMode = els.flameStd.checked ? "standard" : "individual";
}

// 实时贴脸纹理：用 FLAME 关键点 ↔ 当前帧关键点的相似变换，把每个 FLAME 顶点投回画面、
// 采样 #canvas（左侧实时画面）的像素 → 每顶点色。轻量、配合 MediaPipe，不需要神经网络。
function projectColors(verts: Vec3[], lm: Vec3[], basis: FlameBasis): Vec3[] | null {
  const fl: Vec3[] = [], lv: Vec3[] = [];
  for (let i = 0; i < basis.NL; i++) {
    const idx = basis.landmarkIndices[i];
    if (idx >= lm.length) continue;
    const f = basis.lmkFaceIdx[i], a = basis.faces[f * 3], b = basis.faces[f * 3 + 1], c = basis.faces[f * 3 + 2];
    const w0 = basis.lmkBCoords[i * 3], w1 = basis.lmkBCoords[i * 3 + 1], w2 = basis.lmkBCoords[i * 3 + 2];
    fl.push([0, 1, 2].map((x) => w0 * verts[a][x] + w1 * verts[b][x] + w2 * verts[c][x]) as Vec3);
    lv.push(lm[idx]);
  }
  let proj;
  try { proj = applySim(umeyama(fl, lv), verts); } catch { return null; }
  const W = els.canvas.width, H = els.canvas.height;
  let data;
  try { data = ctx.getImageData(0, 0, W, H).data; } catch { return null; }
  const out: Vec3[] = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    const px = proj[i][0] | 0, py = proj[i][1] | 0;
    if (px >= 0 && px < W && py >= 0 && py < H) {
      const o = (py * W + px) * 4;
      out[i] = [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255];
    } else out[i] = [0.72, 0.56, 0.5];  // 投影外（背面/越界）退回中性肤色
  }
  return out;
}

function sampleFlameLandmarkPairs(verts: Vec3[], basis: FlameBasis, canonical: Vec3[]): { src: Vec3[]; dst: Vec3[] } {
  const src: Vec3[] = [], dst: Vec3[] = [];
  for (let i = 0; i < basis.NL; i++) {
    const idx = basis.landmarkIndices[i];
    if (idx >= canonical.length) continue;
    const f = basis.lmkFaceIdx[i];
    const a = basis.faces[f * 3], b = basis.faces[f * 3 + 1], c = basis.faces[f * 3 + 2];
    const w0 = basis.lmkBCoords[i * 3], w1 = basis.lmkBCoords[i * 3 + 1], w2 = basis.lmkBCoords[i * 3 + 2];
    src.push(canonical[idx]);
    dst.push([
      w0 * verts[a][0] + w1 * verts[b][0] + w2 * verts[c][0],
      w0 * verts[a][1] + w1 * verts[b][1] + w2 * verts[c][1],
      w0 * verts[a][2] + w1 * verts[b][2] + w2 * verts[c][2],
    ]);
  }
  return { src, dst };
}

const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vscale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vnorm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dist2 = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
};

function closestPointOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = vsub(b, a), ac = vsub(c, a), ap = vsub(p, a);
  const d1 = vdot(ab, ap), d2 = vdot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;

  const bp = vsub(p, b);
  const d3 = vdot(ab, bp), d4 = vdot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return vadd(a, vscale(ab, d1 / (d1 - d3)));

  const cp = vsub(p, c);
  const d5 = vdot(ab, cp), d6 = vdot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return vadd(a, vscale(ac, d2 / (d2 - d6)));

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    return vadd(b, vscale(vsub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return vadd(a, vadd(vscale(ab, v), vscale(ac, w)));
}

function buildTriangleGrid(verts: Vec3[], faces: Triangle[]): TriangleGrid {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const center: Vec3 = [0, 0, 0];
  for (const p of verts) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
      center[k] += p[k] / verts.length;
    }
  }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const cell = size / 28;
  const key = (ix: number, iy: number, iz: number): string => `${ix},${iy},${iz}`;
  const idx = (p: Vec3): [number, number, number] => [
    Math.floor((p[0] - lo[0]) / cell),
    Math.floor((p[1] - lo[1]) / cell),
    Math.floor((p[2] - lo[2]) / cell),
  ];
  const buckets = new Map<string, number[]>();
  faces.forEach((f: Triangle, fi: number) => {
    const A = verts[f[0]], B = verts[f[1]], C = verts[f[2]];
    const mn: Vec3 = [
      Math.min(A[0], B[0], C[0]), Math.min(A[1], B[1], C[1]), Math.min(A[2], B[2], C[2]),
    ];
    const mx: Vec3 = [
      Math.max(A[0], B[0], C[0]), Math.max(A[1], B[1], C[1]), Math.max(A[2], B[2], C[2]),
    ];
    const a = idx(mn), b = idx(mx);
    for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) {
      const k = key(x, y, z);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(fi);
    }
  });
  return { buckets, cell, lo, center, eps: size * 0.003, key, idx };
}

function snapPointToMesh(p: Vec3, verts: Vec3[], faces: Triangle[], grid: TriangleGrid): Vec3 {
  const base = grid.idx(p);
  let candidates: number[] = [];
  for (let r = 0; r <= 3 && candidates.length === 0; r++) {
    const seen = new Set();
    for (let x = base[0] - r; x <= base[0] + r; x++) {
      for (let y = base[1] - r; y <= base[1] + r; y++) {
        for (let z = base[2] - r; z <= base[2] + r; z++) {
          for (const fi of grid.buckets.get(grid.key(x, y, z)) || []) {
            if (!seen.has(fi)) { seen.add(fi); candidates.push(fi); }
          }
        }
      }
    }
  }
  if (!candidates.length) candidates = faces.map((_face: Triangle, i: number) => i);

  let best: Vec3 = p, bestN: Vec3 = [0, 0, 1], bestD = Infinity;
  for (const fi of candidates) {
    const f = faces[fi], A = verts[f[0]], B = verts[f[1]], C = verts[f[2]];
    const q = closestPointOnTriangle(p, A, B, C);
    const d = dist2(p, q);
    if (d < bestD) {
      best = q;
      bestN = vnorm(vcross(vsub(B, A), vsub(C, A)));
      bestD = d;
    }
  }
  if (vdot(bestN, vsub(best, grid.center)) < 0) bestN = vscale(bestN, -1);
  return vadd(best, vscale(bestN, grid.eps));
}

function mediaPipeAtlasToFlameLines(
  atlas: AnyRecord,
  canonical: Vec3[],
  triangles: Triangle[],
  flameVerts: Vec3[],
  basis: FlameBasis,
): FlameAtlasLine[] {
  const { src, dst } = sampleFlameLandmarkPairs(flameVerts, basis, canonical);
  const sim = umeyama(src, dst);
  const flameFaces = facesArray(basis);
  const grid = buildTriangleGrid(flameVerts, flameFaces);
  return (atlas?.lines || []).map((ln: AnyRecord) => {
    const rawPoints = ln.points.map(([tri, u, v]: [number, number, number]) => {
      const t = triangles[tri], w = 1 - u - v;
      const A = canonical[t[0]], B = canonical[t[1]], C = canonical[t[2]];
      return [
        u * A[0] + v * B[0] + w * C[0],
        u * A[1] + v * B[1] + w * C[1],
        u * A[2] + v * B[2] + w * C[2],
      ];
    });
    const points3d = applySim(sim, rawPoints).map((p) => snapPointToMesh(p, flameVerts, flameFaces, grid));
    return { name: ln.name, region: ln.region, points3d };
  });
}

// 「贴真实人脸纹理」开关（实时孪生）：下一帧 twinLoop 自动按之采样/渲染。
export function toggleTwinTexture(): void {
  reconState.twinTexture = els.twinTexture.checked;
}

function viewerLoop(): void {
  if (reconState.route !== "3d" || reconState.mode3d !== "view" || !reconState.head3d) return;
  const r = (els.three.parentElement || els.three).getBoundingClientRect();
  reconState.head3d.resize(Math.max(2, r.width | 0), Math.max(2, r.height | 0));
  reconState.head3d.setRotation(reconState.rot.x, reconState.rot.y);
  reconState.head3d.render();
  reconState.viewerRAF = requestAnimationFrame(viewerLoop);
}

export function setMode3d(m: string): void {
  stopTwin();  // 离开实时孪生：取消其 RAF + 撤销分屏
  if (m === "project" && !reconState.reconProjectable) {
    setMsg("FLAME 示例脸仅支持 3D 旋转查看；投影回实时画面请使用「转头扫描」。");
    return;
  }
  reconState.mode3d = m;
  els.view3d.setAttribute("aria-pressed", String(m === "view"));
  els.project3d.setAttribute("aria-pressed", String(m === "project"));
  els.project3d.textContent = m === "project" ? "返回 3D 模型" : "投影到画面";
  els.scanPanel.classList.add("hidden"); els.scanToast.classList.add("hidden");
  if (m === "view") {
    stopSource(); sourceState.running = false;
    els.canvas.classList.add("hidden"); els.three.classList.remove("hidden");
    setMsg(null); setLive(false, "3D 模型（拖拽旋转）");
    if (reconState.viewerRAF != null) cancelAnimationFrame(reconState.viewerRAF);
    viewerLoop();
  } else {
    if (reconState.viewerRAF != null) cancelAnimationFrame(reconState.viewerRAF);
    els.three.classList.add("hidden"); els.canvas.classList.remove("hidden");
    els.project3d.disabled = false;
    startCamera();  // 复用主循环；projectVerts 注入重建配准
  }
}

export async function loadDemoRecon(): Promise<void> {
  els.scanPanel.classList.add("hidden"); els.scanToast.classList.add("hidden");
  els.reconStatus.textContent = "加载 FLAME 标准示例脸（无需摄像头）…";
  try {
    if (!reconState.flameBasis) reconState.flameBasis = await loadFlameBasis(assetUrls.flameBasis);
  } catch (err) {
    els.reconStatus.textContent = "FLAME 示例脸加载失败：" + errorMessage(err);
    return;
  }
  const basis = reconState.flameBasis as FlameBasis;
  reconState.reconVerts = flameForward(basis, ZERO_BETA, new Float64Array(basis.NE), 0);
  reconState.reconFaces = facesArray(basis);
  if (!flameDemoLines || !flameDemoOverlayContext) {
    const [head, atlas] = await Promise.all([
      dataSource.getHeadMesh("mediapipe-468"),
      dataSource.loadAtlas("rstl"),
    ]);
    flameDemoOverlayContext = { canonical: head.vertices, triangles: head.triangles };
    if (!flameDemoLines) {
      flameDemoLines = mediaPipeAtlasToFlameLines(atlas, head.vertices, head.triangles, reconState.reconVerts, basis);
    }
  }
  reconState.reconAtlasLines = flameDemoLines;
  reconState.reconColors = null;
  reconState.reconProjectable = false;
  reconState.reconDisplaySpace = "model";
  els.reconStatus.textContent = `FLAME 标准示例脸就绪：${basis.NV} 顶点 / ${basis.NF} 三角面，已叠加 RSTL 线。可旋转查看；投影回实时画面请用「转头扫描」。`;
  await buildViewer();
}

export async function startScan(): Promise<void> {
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
  const collected: Vec3[][] = [];
  const colorFrames: ColorFrame[] = [];
  const t0 = performance.now(); let ymin = 1e9, ymax = -1e9;
  reconState.scan = { active: true };
  const tick = () => {
    if (!reconState.scan || !reconState.scan.active) return;
    const t = performance.now();
    const res = modelState.landmarker.detectForVideo(els.video, t);
    const secs = (t - t0) / 1000;
    if (res.faceLandmarks && res.faceLandmarks.length) {
      const lm = toPixels(res.faceLandmarks[0], els.video.videoWidth, els.video.videoHeight).slice(0, 468) as Vec3[];
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

function sampleFrameColors(lm: Vec3[]): ColorFrame {
  if (!scanColorCanvas) {
    scanColorCanvas = document.createElement("canvas");
    scanColorCtx = scanColorCanvas.getContext("2d", { willReadFrequently: true });
  }
  const vw = els.video.videoWidth || 1, vh = els.video.videoHeight || 1;
  const scale = Math.min(1, COLOR_SAMPLE_W / vw);
  const W = Math.max(1, Math.round(vw * scale)), H = Math.max(1, Math.round(vh * scale));
  scanColorCanvas.width = W; scanColorCanvas.height = H;
  if (!scanColorCtx) return lm.map(() => [0.72, 0.56, 0.5]);
  scanColorCtx.drawImage(els.video, 0, 0, W, H);
  const data = scanColorCtx.getImageData(0, 0, W, H).data;
  return lm.map((p: Vec3): Vec3 => {
    const x = Math.max(0, Math.min(W - 1, Math.round(p[0] * scale)));
    const y = Math.max(0, Math.min(H - 1, Math.round(p[1] * scale)));
    const j = (y * W + x) * 4;
    return [data[j] / 255, data[j + 1] / 255, data[j + 2] / 255];
  });
}

function mergeVertexColors(colorFrames: ColorFrame[], count: number): Vec3[] | null {
  if (!colorFrames.length) return null;
  const out = Array.from({ length: count }, () => [0, 0, 0]);
  for (const frame of colorFrames) {
    for (let i = 0; i < count; i++) {
      out[i][0] += frame[i][0]; out[i][1] += frame[i][1]; out[i][2] += frame[i][2];
    }
  }
  return out.map((c) => c.map((v) => v / colorFrames.length) as Vec3);
}

function drawScanFrame(lm: Vec3[] | null, secs: number, frames: number, ymin: number, ymax: number): void {
  const W = els.canvas.width, H = els.canvas.height;
  ctx.drawImage(els.video, 0, 0, W, H);
  if (lm && modelState.triangles) {
    ctx.save();
    ctx.lineWidth = Math.max(0.7, W / 1800);
    ctx.strokeStyle = "rgba(86,189,242,.22)";
    for (const tri of asTriangles(modelState.triangles)) {
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

function updateScanPanel(secs: number, frames: number, yawSpan: number, yawMid: number | null): void {
  const pct = Math.min(1, Math.max(secs / SCAN_TARGET_SECS, frames / SCAN_TARGET_FRAMES));
  els.scanProgressVal.textContent = Math.round(pct * 100) + "%";
  els.scanProgressBar.style.width = Math.round(pct * 100) + "%";
  els.scanYawVal.textContent = Number.isFinite(yawSpan) ? yawSpan.toFixed(2) : "0.00";
  const wideEnough = Number.isFinite(yawSpan) && yawSpan > YAW_DISPLAY_SPAN * 0.55;
  els.scanYawLeft.classList.toggle("active", wideEnough || (yawMid != null && Number.isFinite(yawMid) && yawMid < -0.08));
  els.scanYawMid.classList.toggle("active", Number.isFinite(yawMid));
  els.scanYawRight.classList.toggle("active", wideEnough || (yawMid != null && Number.isFinite(yawMid) && yawMid > 0.08));
}

function finishScan(
  collected: Vec3[][],
  ymin: number,
  ymax: number,
  colorFrames: ColorFrame[] = [],
  lowDepthConfidence = false,
  durationMs: number | null = null,
): void {
  reconState.scan = null;
  els.scanPanel.classList.add("hidden"); els.scanToast.classList.add("hidden");
  const N = collected.length, V = 468, verts: Vec3[] = [];
  const med = (k: number[]): number => { k.sort((a: number, b: number) => a - b); return k[(k.length - 1) >> 1]; };
  for (let v = 0; v < V; v++) {
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < N; i++) { xs.push(collected[i][v][0]); ys.push(collected[i][v][1]); zs.push(collected[i][v][2]); }
    verts.push([med(xs), med(ys), med(zs)]);
  }
  const c = [0, 0, 0]; for (const p of verts) for (let k = 0; k < 3; k++) c[k] += p[k] / V;
  reconState.reconVerts = verts.map((p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
  reconState.reconFaces = null;
  reconState.reconAtlasLines = null;
  reconState.reconColors = mergeVertexColors(colorFrames, V);
  reconState.reconProjectable = true;
  reconState.reconDisplaySpace = "screen";
  const yawSpan = ymax - ymin;
  const scanDetail: AnyRecord = {
    phase: "scan",
    frames: N,
    yawMin: ymin,
    yawMax: ymax,
    yawSpan,
    lowDepthConfidence,
  };
  if (durationMs != null && Number.isFinite(durationMs)) {
    scanDetail.durationMs = Number(durationMs.toFixed(2));
    recordMetricSample("scan.durationMs", scanDetail.durationMs, scanDetail);
  }
  recordEvent("scan.finished", scanDetail);
  els.reconStatus.textContent = lowDepthConfidence
    ? `重建完成（深度置信度低：偏航跨度 ${(ymax - ymin).toFixed(2)} < ${YAW_SPAN_MIN}，缺侧脸视角，深度不可靠）：${N} 帧。可旋转查看，或投影到画面。`
    : `重建完成：${N} 帧，偏航 ${ymin.toFixed(2)}~${ymax.toFixed(2)}。可旋转查看，或投影到画面。`;
  buildViewer();
}

export function enterRoute(route: "2d" | "3d"): void {
  stopTwin();
  reconState.route = route;
  els.scanPanel.classList.add("hidden"); els.scanToast.classList.add("hidden");
  if (route === "3d") {
    els.route3dPanel.classList.remove("hidden"); els.badge.classList.add("beta");
    els.threeDWorkflowCard?.classList.remove("hidden");
    if (els.routeModeHint) els.routeModeHint.textContent = "当前是 3D 重建 / 标注上下文，可进入 3D 线标注和沿 RSTL 闭合演示。";
    sourceState.running = false; stopSource();
    els.zoomStrip.classList.add("hidden"); els.canvas.classList.add("hidden");
    setMsg(reconState.reconVerts ? null : "3D Beta：请先扫描人脸重建"); setLive(false, "3D Beta");
    if (reconState.reconVerts) buildViewer();
  } else {
    reconState.scan = null;
    if (reconState.viewerRAF != null) cancelAnimationFrame(reconState.viewerRAF);
    els.route3dPanel.classList.add("hidden"); els.badge.classList.remove("beta");
    els.threeDWorkflowCard?.classList.add("hidden");
    if (els.routeModeHint) els.routeModeHint.textContent = "当前是 2D 实时贴合模式，只显示稳定主流程。";
    els.three.classList.add("hidden"); els.canvas.classList.remove("hidden");
    els.reset3d.disabled = true;
    if (renderState.zoom) els.zoomStrip.classList.remove("hidden");
    stopSource(); sourceState.running = false;
    setMsg("点击「摄像头」或「上传照片 / 视频」开始"); setLive(false, "待机");
  }
}
