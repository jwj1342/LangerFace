// 2D 渲染：线条叠加、细节放大窗、统计面板。
import { SOLID, BAND, ZOOM_REGIONS } from "../../constants.js";
import type { ZoomRegion } from "../../constants.js";
import { ctx as boundCtx, els } from "../../dom.js";
import {
  estimateFacePoseQuality,
  faceBBox,
  innerMouthTriangles,
  mapAtlas,
  pointInHandMasks,
  visibleRuns,
  visibleTriangles,
} from "../../geometry.js";
import type { HandMask, MappedAtlasLine, Point2, Triangle, Vec3 } from "../../geometry.js";
import { mapSurfaceRefs, measureIncisionOverlayJitter, measureIncisionOverlayRegistration } from "../../incision_overlay.js";
import type { SurfaceRef } from "../../incision_overlay.js";
import { countMetric, recordMetricSample, setDiagnosticSection } from "../../logger.js";
import { modelState, renderState, sourceState } from "../../state.js";
import { setIncisionOverlayQa, setLive } from "../../ui.js";
import type { IncisionOverlayPayload } from "./dataSource";

type AnyRecord = Record<string, any>;
type IncisionZoomRegion = { kind: "incision_overlay" };
type RenderRegion = ZoomRegion | IncisionZoomRegion | null;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Bounds extends Rect {
  w: number;
  h: number;
}

interface LocalRegionMask {
  id: string;
  label?: string;
  action: string;
  opacityScale: number;
  boxes: Rect[];
}

interface LocalRegionActionResult {
  action: "normal" | "dim" | "freeze";
  opacityScale: number;
}

interface ZoomItem {
  label: string;
  region: RenderRegion;
}

interface RenderZoomCard {
  region: RenderRegion;
  card: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
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

const modelTriangles = (): Triangle[] => modelState.triangles as Triangle[];
const modelNoseTris = (): number[] => modelState.noseTris as number[];
const toPoint2 = (point: number[]): Point2 => [Number(point[0]), Number(point[1])];
const surfaceRefs = (refs: unknown): SurfaceRef[] => (Array.isArray(refs) ? refs as SurfaceRef[] : []);
const optionalSurfaceRef = (ref: unknown): SurfaceRef[] => (ref ? [ref as SurfaceRef] : []);
const isIncisionZoomRegion = (region: RenderRegion): region is IncisionZoomRegion => (
  Boolean(region && "kind" in region && region.kind === "incision_overlay")
);

const focusScratch = document.createElement("canvas");
const focusCtx = focusScratch.getContext("2d") as CanvasRenderingContext2D;
const focusZoomRange = { min: 1, max: 4.5 };
const INCISION_ZOOM_REGION: IncisionZoomRegion = { kind: "incision_overlay" };
const INCISION_OVERLAY_STABILITY_FRAMES = 8;
const LIVE_OCCLUSION_MIN_TRIANGLE_AREA_PX2 = 1;
const LOCAL_REGION_RENDER_GROUPS: Record<string, string[]> = {
  brow_eye: ["额·眉间", "右眼周", "左眼周"],
  mouth: ["口周"],
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const renderQualityDiagnostics: { source: unknown; previousFrame: Vec3[] | null } = { source: null, previousFrame: null };
const overlayRuntimeDiagnostics: { key: string | null; landmarkFrames: Vec3[][] } = { key: null, landmarkFrames: [] };

function fmtPx(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(n >= 10 ? 0 : 1)}px` : "—";
}

function compactReason(reason: unknown): string {
  return String(reason || "unknown").replaceAll("_", " ");
}

function fmtRatio(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function fmtPercent(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
}

function currentFaceExpression() {
  return {
    jawOpen: sourceState.jawOpen,
    eyeBlinkLeft: sourceState.eyeBlinkLeft,
    eyeBlinkRight: sourceState.eyeBlinkRight,
  };
}

function estimateRenderQualityGate(lm: Vec3[], W: number, H: number): AnyRecord {
  if (renderQualityDiagnostics.source !== sourceState.source) {
    renderQualityDiagnostics.source = sourceState.source;
    renderQualityDiagnostics.previousFrame = null;
  }
  const gate = estimateFacePoseQuality(lm, W, H, {
    presence: sourceState.presence,
    sourceKind: sourceState.sourceKind,
    previousLandmarks: renderQualityDiagnostics.previousFrame,
    expression: currentFaceExpression(),
  });
  renderQualityDiagnostics.previousFrame = cloneLandmarkFrame(lm);
  sourceState.qualityGate = gate;
  sourceState.localRegionQuality = gate.local_region_quality || null;
  return gate;
}

export function draw(lm: Vec3[], W: number, H: number, masks: HandMask[] = []): number {
  const atlas = modelState.atlases[renderState.system];
  const vis = renderState.clip
    ? visibleTriangles(lm, modelTriangles(), modelNoseTris(), undefined, {
      minTriangleAreaPx2: LIVE_OCCLUSION_MIN_TRIANGLE_AREA_PX2,
    })
    : null;
  const innerMouth = innerMouthTriangles(modelTriangles()); // 口裂三角面（张嘴会落进口内/牙齿），永久排除
  const mapped = mapAtlas(atlas, lm, modelTriangles());
  const bb = faceBBox(lm);
  const stride = Math.max(1, Math.round(100 / (renderState.densityFrac * 100)));
  const hasMasks = masks.length > 0;
  const frameQualityGate = estimateRenderQualityGate(lm, W, H);
  const canDrawAtlas = sourceState.sourceKind === "image" || frameQualityGate.passed;
  const localRegionQuality = frameQualityGate.local_region_quality;
  const localRegionMasks = buildLocalRegionMasks(lm, localRegionQuality);

  ctx.save();
  ctx.globalAlpha = renderState.opacity; ctx.lineWidth = Math.max(1, W / 1300);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  let count = 0;
  if (canDrawAtlas) {
    for (let li = 0; li < mapped.length; li++) {
      if (li % stride !== 0) continue;
      const ln = mapped[li];
      if (renderState.bands) {
        let my = 0; for (const p of ln.pts) my += p[1]; my = (my / ln.pts.length - bb.y0) / (bb.h || 1);
        ctx.strokeStyle = my < 0.36 ? BAND.top : my < 0.66 ? BAND.mid : BAND.low;
      } else ctx.strokeStyle = SOLID[renderState.system as keyof typeof SOLID] || SOLID.rstl;
      // 每点可见性 = 朝向相机(背面剔除) 且 不属于口裂三角面 且 不在前方手部凸包内
      const mask = ln.pts.map((p, i) => {
        const v = vis ? vis[ln.tris[i]] : 1;
        if (innerMouth.has(ln.tris[i])) return 0; // 口裂三角面无论朝向都排除（#38）
        if (localActionForPoints([p], localRegionMasks).action === "freeze") return 0;
        return v && !(hasMasks && pointInHandMasks(toPoint2(p), masks)) ? 1 : 0;
      });
      const localLineAction = localActionForPoints(ln.pts, localRegionMasks.filter((region: LocalRegionMask) => region.action === "dim"));
      const savedAlpha = ctx.globalAlpha;
      if (localLineAction.action === "dim") ctx.globalAlpha = savedAlpha * localLineAction.opacityScale;
      for (const run of visibleRuns(ln.pts, mask)) {
        ctx.beginPath(); ctx.moveTo(run[0][0], run[0][1]);
        for (let i = 1; i < run.length; i++) ctx.lineTo(run[i][0], run[i][1]);
        ctx.stroke();
      }
      ctx.globalAlpha = savedAlpha;
      count++;
    }
  }
  if (canDrawAtlas && renderState.meshPts) {
    ctx.globalAlpha = Math.min(1, renderState.opacity); ctx.fillStyle = "rgba(255,255,255,.55)";
    for (let i = 0; i < lm.length; i += 2) {
      if (hasMasks && pointInHandMasks(toPoint2(lm[i]), masks)) continue;
      ctx.beginPath(); ctx.arc(lm[i][0], lm[i][1], Math.max(1, W / 1100), 0, 6.283); ctx.fill();
    }
  }
  drawIncisionOverlay(lm, W, H, masks, vis, innerMouth, frameQualityGate, localRegionQuality, localRegionMasks);
  ctx.restore();
  return count;
}

function overlayMask(
  mapped: MappedAtlasLine,
  masks: HandMask[],
  vis: Uint8Array | null,
  innerMouth: Set<number>,
  localRegionMasks: LocalRegionMask[] = [],
): number[] {
  const hasMasks = masks.length > 0;
  return mapped.pts.map((p, i) => {
    const tri = mapped.tris[i];
    const front = vis ? vis[tri] : 1;
    if (innerMouth.has(tri)) return 0;
    if (localActionForPoints([p], localRegionMasks).action === "freeze") return 0;
    return front && !(hasMasks && pointInHandMasks(toPoint2(p), masks)) ? 1 : 0;
  });
}

function strokeOverlayRefs(
  refs: SurfaceRef[],
  lm: Vec3[],
  masks: HandMask[],
  vis: Uint8Array | null,
  innerMouth: Set<number>,
  style: { color: string; lineWidth: number; dash?: number[] },
  localRegionMasks: LocalRegionMask[] = [],
): void {
  const mapped = mapSurfaceRefs(refs, lm, modelTriangles());
  if (mapped.pts.length < 2) return;
  const mask = overlayMask(mapped as MappedAtlasLine, masks, vis, innerMouth, localRegionMasks);
  const localAction = localActionForPoints(mapped.pts, localRegionMasks);
  const savedAlpha = ctx.globalAlpha;
  if (localAction.action === "dim") ctx.globalAlpha = savedAlpha * localAction.opacityScale;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(style.dash || []);
  for (const run of visibleRuns(mapped.pts, mask)) {
    ctx.beginPath();
    ctx.moveTo(run[0][0], run[0][1]);
    for (let i = 1; i < run.length; i++) ctx.lineTo(run[i][0], run[i][1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = savedAlpha;
}

function overlayRuntimeKey(overlay: AnyRecord | null | undefined): string {
  return [
    overlay?.schema_version || "",
    overlay?.created_at || "",
    overlay?.label || "",
    overlay?.candidate_type || "",
    overlay?.candidate?.polyline_refs?.length || 0,
    overlay?.tumor?.boundary_refs?.length || 0,
  ].join("|");
}

function cloneLandmarkFrame(lm: Vec3[] | null | undefined): Vec3[] {
  return (lm || []).map((p) => {
    const x = Number(p?.[0]);
    const y = Number(p?.[1]);
    const z = Number(p?.[2] ?? 0);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : [NaN, NaN, NaN];
  });
}

function compactRegistration(registration: AnyRecord | null | undefined): AnyRecord | null {
  if (!registration) return null;
  return {
    schema_version: registration.schema_version,
    passed: registration.passed,
    reason: registration.reason,
    reasons: registration.reasons || [],
    frame: registration.frame,
    mapped_point_count: registration.mapped_point_count,
    candidate_point_count: registration.candidate_point_count,
    tumor_center_mapped: registration.tumor_center_mapped,
    invalid_ref_count: registration.invalid_ref_count,
    missing_landmark_count: registration.missing_landmark_count,
    degenerate_triangle_count: registration.degenerate_triangle_count,
    out_of_frame_count: registration.out_of_frame_count,
    out_of_frame_fraction: registration.out_of_frame_fraction,
    bbox_px: registration.bbox_px,
    clinical_boundary: registration.clinical_boundary,
  };
}

function compactStability(stability: AnyRecord | null | undefined): AnyRecord | null {
  if (!stability) return null;
  return {
    schema_version: stability.schema_version,
    passed: stability.passed,
    reason: stability.reason,
    frame_count: stability.frame_count,
    tracked_point_count: stability.tracked_point_count,
    sample_count: stability.sample_count,
    thresholds: stability.thresholds,
    overall: stability.overall,
    by_group: stability.by_group,
  };
}

function compactPoseGate(poseGate: AnyRecord | null | undefined): AnyRecord | null {
  if (!poseGate) return null;
  return {
    schema_version: poseGate.schema_version,
    passed: poseGate.passed,
    reason: poseGate.reason,
    reasons: poseGate.reasons || [],
    source_kind: poseGate.source_kind,
    presence: poseGate.presence,
    yaw_norm: poseGate.yaw_norm,
    abs_yaw_norm: poseGate.abs_yaw_norm,
    frame_motion_norm: poseGate.frame_motion_norm,
    face_frame_fraction: poseGate.face_frame_fraction,
    expression: poseGate.expression,
    thresholds: poseGate.thresholds,
  };
}

function compactLocalRegionQuality(localRegionQuality: AnyRecord | null | undefined): AnyRecord | null {
  if (!localRegionQuality) return null;
  return {
    schema_version: localRegionQuality.schema_version,
    passed: localRegionQuality.passed,
    reason: localRegionQuality.reason,
    reasons: localRegionQuality.reasons || [],
    source_kind: localRegionQuality.source_kind,
    active_region_count: localRegionQuality.active_region_count,
    active_regions: localRegionQuality.active_regions || [],
    regions: (localRegionQuality.regions || []).map((region: AnyRecord) => ({
      id: region.id,
      label: region.label,
      action: region.action,
      opacity_scale: region.opacity_scale,
      reasons: region.reasons || [],
      motion_norm: region.motion_norm,
      expression_metric: region.expression_metric,
      expression_value: region.expression_value,
    })),
    thresholds: localRegionQuality.thresholds,
    clinical_boundary: localRegionQuality.clinical_boundary,
  };
}

function compactLandmarkSmoothing() {
  const smoother = (renderState.smoother || {}) as AnyRecord;
  const hasGlobal = Number.isFinite(smoother.globalMinCutoff) || Number.isFinite(smoother.globalBeta);
  return {
    schema_version: "landmark-motion-stabilized-smoothing/v0.1",
    enabled: renderState.smoothLevel > 0,
    smooth_level: Number(renderState.smoothLevel.toFixed(3)),
    method: hasGlobal ? "global_translation_plus_local_one_euro" : "pointwise_one_euro",
    local: {
      min_cutoff: smoother.minCutoff,
      beta: smoother.beta,
      dcutoff: smoother.dcutoff,
    },
    global: hasGlobal ? {
      min_cutoff: smoother.globalMinCutoff,
      beta: smoother.globalBeta,
      dcutoff: smoother.globalDcutoff,
      anchor_count: smoother.anchorIndices?.length || 0,
    } : null,
    exported_landmarks: false,
    clinical_boundary: "Smoothing diagnostics expose parameters only, not landmark coordinates.",
  };
}

function localQualityNeedsReview(localRegionQuality: AnyRecord | null | undefined): boolean {
  return Boolean(localRegionQuality && localRegionQuality.passed === false && localRegionQuality.active_region_count > 0);
}

function localQualitySummary(localRegionQuality: AnyRecord | null | undefined): string {
  const active = (localRegionQuality?.regions || []).filter((region: AnyRecord) => region.action !== "normal");
  if (!active.length) return "局部区域通过";
  return active
    .map((region: AnyRecord) => `${region.label || region.id}:${region.action === "freeze" ? "冻结" : "降透明"}(${compactReason(region.reasons?.[0])})`)
    .join("；");
}

function expandedBox(box: Bounds | null | undefined, padFrac = 0.18): Rect | null {
  if (!box) return null;
  const pad = Math.max(box.w, box.h) * padFrac;
  return {
    x0: box.x0 - pad,
    y0: box.y0 - pad,
    x1: box.x1 + pad,
    y1: box.y1 + pad,
  };
}

function pointInBox(p: number[] | null | undefined, box: Rect | null | undefined): boolean {
  return Boolean(p && box && p[0] >= box.x0 && p[0] <= box.x1 && p[1] >= box.y0 && p[1] <= box.y1);
}

function pointMean(points: Array<number[] | null | undefined> | null | undefined): Point2 | null {
  let x = 0, y = 0, count = 0;
  for (const p of points || []) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    x += p[0]; y += p[1]; count += 1;
  }
  return count ? [x / count, y / count] : null;
}

function buildLocalRegionMasks(lm: Vec3[], localRegionQuality: AnyRecord | null | undefined): LocalRegionMask[] {
  return (localRegionQuality?.regions || [])
    .filter((region: AnyRecord) => region.action && region.action !== "normal")
    .map((region: AnyRecord) => {
      const labels = LOCAL_REGION_RENDER_GROUPS[String(region.id)] || [];
      const boxes = labels
        .map((label: string) => ZOOM_REGIONS.find((r) => r.label === label))
        .filter(Boolean)
        .map((sourceRegion) => expandedBox(regionBounds(lm, sourceRegion as ZoomRegion)))
        .filter(Boolean);
      return {
        id: region.id,
        label: region.label,
        action: region.action,
        opacityScale: Number.isFinite(region.opacity_scale) ? region.opacity_scale : 1,
        boxes,
      };
    })
    .filter((region: LocalRegionMask) => region.boxes.length);
}

function localActionForPoints(
  points: Array<number[] | null | undefined>,
  localRegionMasks: LocalRegionMask[] = [],
): LocalRegionActionResult {
  const action: LocalRegionActionResult = { action: "normal", opacityScale: 1 };
  if (!localRegionMasks.length) return action;
  const probes = [...(points || []), pointMean(points)].filter(Boolean);
  for (const region of localRegionMasks) {
    if (!probes.some((p) => region.boxes.some((box: Rect) => pointInBox(p, box)))) continue;
    if (region.action === "freeze") return { action: "freeze", opacityScale: 0 };
    if (region.action === "dim") action.action = "dim";
    action.opacityScale = Math.min(action.opacityScale, region.opacityScale);
  }
  return action;
}

function updateIncisionOverlayRuntimeDiagnostics(
  overlay: AnyRecord,
  registration: AnyRecord,
  stability: AnyRecord | null,
  poseGate: AnyRecord,
  localRegionQuality: AnyRecord | null | undefined,
): void {
  setDiagnosticSection("incision_overlay_runtime", {
    schema_version: "incision-overlay-runtime-diagnostics/v0.1",
    updated_at: new Date().toISOString(),
    raw_image_sent: false,
    exported_raw_pixels: false,
    exported_landmarks: false,
    rolling_window_frame_count: INCISION_OVERLAY_STABILITY_FRAMES,
    rolling_frame_count: overlayRuntimeDiagnostics.landmarkFrames.length,
    overlay: {
      schema_version: overlay?.schema_version || "",
      label: overlay?.label || "",
      candidate_type: overlay?.candidate_type || "",
      tumor_kind: overlay?.tumor_kind || "",
      review_status: overlay?.review?.status || "",
      guardrails_passed: overlay?.candidate?.guardrails_passed === true,
      high_guardrail_codes: overlay?.candidate?.high_guardrail_codes || [],
      live_overlay_ready: overlay?.review_gate?.live_overlay_ready === true,
    },
    pose_gate: compactPoseGate(poseGate),
    local_region_quality: compactLocalRegionQuality(localRegionQuality),
    landmark_smoothing: compactLandmarkSmoothing(),
    registration: compactRegistration(registration),
    stability: compactStability(stability),
    clinical_boundary: "Runtime overlay diagnostics are engineering QA signals, not clinical AR registration.",
  });
}

function updateIncisionOverlayQa(
  registration: AnyRecord,
  stability: AnyRecord | null,
  poseGate: AnyRecord,
  localRegionQuality: AnyRecord | null | undefined,
): void {
  if (poseGate && !poseGate.passed) {
    setIncisionOverlayQa({
      tone: "warn",
      label: "姿态需复核",
      detail: `工程 QA：${compactReason(poseGate.reason)}；${poseGateQaSummary(poseGate)}。暂不绘制候选叠加。`,
    });
    return;
  }
  if (!registration?.passed) {
    setIncisionOverlayQa({
      tone: "warn",
      label: "投射需复核",
      detail: `工程 QA：${compactReason(registration?.reason)}；映射点 ${registration?.mapped_point_count ?? 0}，出画面 ${registration?.out_of_frame_count ?? 0}。`,
    });
    return;
  }
  if (localQualityNeedsReview(localRegionQuality) && registration?.passed) {
    setIncisionOverlayQa({
      tone: "warn",
      label: "局部需复核",
      detail: `工程 QA：${localQualitySummary(localRegionQuality)}；局部线条已降透明或断开，请在静止帧复核。`,
    });
    return;
  }
  if (!stability) {
    setIncisionOverlayQa({
      label: "已投射",
      detail: `工程 QA：映射点 ${registration.mapped_point_count}；等待连续帧稳定性。`,
    });
    return;
  }
  const detail = `工程 QA：映射点 ${registration.mapped_point_count}；RMS ${fmtPx(stability.overall?.rms_px)} / P95 ${fmtPx(stability.overall?.p95_px)} / max ${fmtPx(stability.overall?.max_px)}。`;
  setIncisionOverlayQa({
    tone: stability.passed ? "ok" : "warn",
    label: stability.passed ? "叠加稳定" : "抖动需复核",
    detail: stability.passed ? detail : `${detail} 原因：${compactReason(stability.reason)}。`,
  });
}

function poseGateQaSummary(poseGate: AnyRecord): string {
  const parts = [
    `偏航 ${fmtRatio(poseGate.yaw_norm)} / 门槛 ±${fmtRatio(poseGate.thresholds?.max_abs_yaw_norm)}`,
    `检测 ${fmtPercent(poseGate.presence)}`,
  ];
  if (poseGate.frame_motion_norm != null) {
    parts.push(`运动 ${fmtRatio(poseGate.frame_motion_norm)} / 门槛 ${fmtRatio(poseGate.thresholds?.max_frame_motion_norm)}`);
  }
  if (poseGate.expression?.jaw_open != null) {
    parts.push(`张口 ${fmtPercent(poseGate.expression.jaw_open)}`);
  }
  if (poseGate.expression?.eye_blink_max != null) {
    parts.push(`眨眼 ${fmtPercent(poseGate.expression.eye_blink_max)}`);
  }
  return parts.join("，");
}

function recordIncisionOverlayRegistration(overlay: AnyRecord, lm: Vec3[], W: number, H: number): AnyRecord {
  const registration = measureIncisionOverlayRegistration(overlay, lm, modelTriangles(), {
    frameWidth: W,
    frameHeight: H,
  });
  countMetric(registration.passed ? "incisionOverlay.registration.pass" : "incisionOverlay.registration.fail");
  recordMetricSample("incisionOverlay.registration.mappedPointCount", registration.mapped_point_count, {
    passed: registration.passed,
    reason: registration.reason,
  });
  recordMetricSample("incisionOverlay.registration.outOfFrameCount", registration.out_of_frame_count, {
    passed: registration.passed,
    reason: registration.reason,
  });
  if (registration.bbox_px?.diagonal_px != null) {
    recordMetricSample("incisionOverlay.registration.bboxDiagonalPx", registration.bbox_px.diagonal_px, {
      passed: registration.passed,
      reason: registration.reason,
    });
  }
  return registration;
}

function recordIncisionOverlayStability(overlay: AnyRecord, lm: Vec3[]): AnyRecord | null {
  const key = overlayRuntimeKey(overlay);
  if (overlayRuntimeDiagnostics.key !== key) {
    overlayRuntimeDiagnostics.key = key;
    overlayRuntimeDiagnostics.landmarkFrames = [];
  }
  overlayRuntimeDiagnostics.landmarkFrames.push(cloneLandmarkFrame(lm));
  if (overlayRuntimeDiagnostics.landmarkFrames.length > INCISION_OVERLAY_STABILITY_FRAMES) {
    overlayRuntimeDiagnostics.landmarkFrames.splice(
      0,
      overlayRuntimeDiagnostics.landmarkFrames.length - INCISION_OVERLAY_STABILITY_FRAMES,
    );
  }
  if (overlayRuntimeDiagnostics.landmarkFrames.length < 2) return null;
  const stability = measureIncisionOverlayJitter(
    overlay,
    overlayRuntimeDiagnostics.landmarkFrames,
    modelTriangles(),
    { context: "live_runtime_overlay_window" },
  );
  countMetric(stability.passed ? "incisionOverlay.stability.pass" : "incisionOverlay.stability.fail");
  if (stability.overall?.rms_px != null) {
    recordMetricSample("incisionOverlay.stability.rmsPx", stability.overall.rms_px, {
      passed: stability.passed,
      reason: stability.reason,
      frameCount: stability.frame_count,
    });
  }
  if (stability.overall?.p95_px != null) {
    recordMetricSample("incisionOverlay.stability.p95Px", stability.overall.p95_px, {
      passed: stability.passed,
      reason: stability.reason,
      frameCount: stability.frame_count,
    });
  }
  if (stability.overall?.max_px != null) {
    recordMetricSample("incisionOverlay.stability.maxPx", stability.overall.max_px, {
      passed: stability.passed,
      reason: stability.reason,
      frameCount: stability.frame_count,
    });
  }
  return stability;
}

function recordIncisionOverlayPoseGate(poseGate: AnyRecord): void {
  countMetric(poseGate.passed ? "incisionOverlay.poseGate.pass" : "incisionOverlay.poseGate.blocked");
  if (poseGate.abs_yaw_norm != null) {
    recordMetricSample("incisionOverlay.poseGate.absYawNorm", poseGate.abs_yaw_norm, {
      passed: poseGate.passed,
      reason: poseGate.reason,
      sourceKind: poseGate.source_kind,
    });
  }
  if (poseGate.presence != null) {
    recordMetricSample("incisionOverlay.poseGate.presence", poseGate.presence, {
      passed: poseGate.passed,
      reason: poseGate.reason,
      sourceKind: poseGate.source_kind,
    });
  }
  if (poseGate.frame_motion_norm != null) {
    recordMetricSample("incisionOverlay.poseGate.frameMotionNorm", poseGate.frame_motion_norm, {
      passed: poseGate.passed,
      reason: poseGate.reason,
      sourceKind: poseGate.source_kind,
    });
  }
  if (poseGate.expression?.jaw_open != null) {
    recordMetricSample("incisionOverlay.poseGate.jawOpen", poseGate.expression.jaw_open, {
      passed: poseGate.passed,
      reason: poseGate.reason,
      sourceKind: poseGate.source_kind,
    });
  }
  if (poseGate.expression?.eye_blink_max != null) {
    recordMetricSample("incisionOverlay.poseGate.eyeBlinkMax", poseGate.expression.eye_blink_max, {
      passed: poseGate.passed,
      reason: poseGate.reason,
      sourceKind: poseGate.source_kind,
    });
  }
}

function recordLocalRegionQuality(localRegionQuality: AnyRecord | null | undefined): void {
  if (!localRegionQuality) return;
  countMetric(localQualityNeedsReview(localRegionQuality)
    ? "incisionOverlay.localRegionQuality.review"
    : "incisionOverlay.localRegionQuality.pass");
  recordMetricSample("incisionOverlay.localRegionQuality.activeRegionCount", localRegionQuality.active_region_count || 0, {
    passed: localRegionQuality.passed,
    reason: localRegionQuality.reason,
  });
  for (const region of localRegionQuality.regions || [] as AnyRecord[]) {
    if (region.motion_norm != null) {
      recordMetricSample("incisionOverlay.localRegionQuality.regionMotionNorm", region.motion_norm, {
        region: region.id,
        action: region.action,
        reason: region.reasons?.[0] || "local_regions_passed",
      });
    }
  }
}

function drawIncisionOverlay(
  lm: Vec3[],
  W: number,
  H: number,
  masks: HandMask[],
  vis: Uint8Array | null,
  innerMouth: Set<number>,
  poseGate: AnyRecord,
  localRegionQuality: AnyRecord | null | undefined,
  localRegionMasks: LocalRegionMask[],
): void {
  const overlay = renderState.incisionOverlay as AnyRecord | null;
  if (!overlay) {
    overlayRuntimeDiagnostics.key = null;
    overlayRuntimeDiagnostics.landmarkFrames = [];
    setDiagnosticSection("incision_overlay_runtime", null);
    setIncisionOverlayQa(null);
    return;
  }
  const key = overlayRuntimeKey(overlay);
  if (overlayRuntimeDiagnostics.key !== key) {
    overlayRuntimeDiagnostics.key = key;
    overlayRuntimeDiagnostics.landmarkFrames = [];
  }
  recordIncisionOverlayPoseGate(poseGate);
  recordLocalRegionQuality(localRegionQuality);
  const registration = recordIncisionOverlayRegistration(overlay, lm, W, H);
  let stability: AnyRecord | null = null;
  if (poseGate.passed) {
    stability = recordIncisionOverlayStability(overlay, lm);
  } else {
    overlayRuntimeDiagnostics.landmarkFrames = [];
  }
  updateIncisionOverlayRuntimeDiagnostics(overlay, registration, stability, poseGate, localRegionQuality);
  updateIncisionOverlayQa(registration, stability, poseGate, localRegionQuality);
  if (!poseGate.passed) return;
  ctx.save();
  ctx.globalAlpha = 0.98;
  const baseWidth = Math.max(2, W / 520);
  strokeOverlayRefs(surfaceRefs(overlay.tumor?.boundary_refs), lm, masks, vis, innerMouth, {
    color: "#facc15",
    lineWidth: baseWidth,
    dash: [baseWidth * 3, baseWidth * 2],
  }, localRegionMasks);
  strokeOverlayRefs(surfaceRefs(overlay.candidate?.polyline_refs), lm, masks, vis, innerMouth, {
    color: overlay.candidate_type === "linear" ? "#22c55e" : "#5eead4",
    lineWidth: baseWidth * 1.35,
  }, localRegionMasks);
  const center = mapSurfaceRefs(optionalSurfaceRef(overlay.tumor?.center_ref), lm, modelTriangles()).pts[0];
  const centerLocalAction = localActionForPoints([center], localRegionMasks);
  const centerOccluded = Boolean(center && masks.length && pointInHandMasks(toPoint2(center), masks));
  if (center && centerLocalAction.action !== "freeze" && !centerOccluded) {
    const savedAlpha = ctx.globalAlpha;
    if (centerLocalAction.action === "dim") ctx.globalAlpha = savedAlpha * centerLocalAction.opacityScale;
    ctx.fillStyle = "#facc15";
    ctx.strokeStyle = "#111820";
    ctx.lineWidth = Math.max(1, W / 900);
    ctx.beginPath();
    ctx.arc(center[0], center[1], Math.max(4, W / 180), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = savedAlpha;
  }
  ctx.restore();
}

// ── 细节放大窗 ────────────────────────────────────────────────────────────────
export function buildZoomCards(onSelect: () => void = () => {}): void {
  els.zoomStrip.innerHTML = "";
  const zoomItems: ZoomItem[] = [
    { label: "全脸", region: null },
    ...(renderState.incisionOverlay ? [{ label: "切口候选", region: INCISION_ZOOM_REGION }] : []),
    ...ZOOM_REGIONS.map((region) => ({ label: region.label, region })),
  ];
  renderState.zoomCards = zoomItems.map((item) => {
    const card = document.createElement("div"); card.className = "zoom-card";
    card.tabIndex = 0;
    const cv = document.createElement("canvas"); cv.width = 300; cv.height = 300;
    if (renderState.mirror) cv.classList.add("mirror");
    const tag = document.createElement("div"); tag.className = "tag"; tag.textContent = item.label;
    card.appendChild(cv); card.appendChild(tag); els.zoomStrip.appendChild(card);
    const select = () => {
      const nextRegion = item.region && renderState.focusRegion !== item.region ? item.region : null;
      setFocusRegion(nextRegion);
      onSelect();
    };
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      select();
    });
    return { region: item.region, card, canvas: cv, ctx: cv.getContext("2d") as CanvasRenderingContext2D };
  });
  syncFocusCards();
}

export function setFocusRegion(region: RenderRegion): void {
  renderState.focusRegion = region;
  syncFocusCards();
}

export function adjustFocusZoom(deltaY: number): boolean {
  if (!renderState.focusRegion) return false;
  const delta = clamp(deltaY || 0, -120, 120);
  renderState.focusZoom = clamp(renderState.focusZoom * Math.exp(-delta * 0.0018), focusZoomRange.min, focusZoomRange.max);
  return true;
}

function syncFocusCards() {
  (renderState.zoomCards as RenderZoomCard[]).forEach((zc) => zc.card.classList.toggle("active", zc.region === renderState.focusRegion));
}

export function clearZooms(): void {
  for (const zc of renderState.zoomCards as RenderZoomCard[]) { zc.ctx.fillStyle = "#05070a"; zc.ctx.fillRect(0, 0, zc.canvas.width, zc.canvas.height); }
}

// 从已叠加线条的主画布上裁剪关键区域并放大到各窗口（线条随之放大显示）
export function drawZooms(lm: Vec3[], W: number): void {
  if (!renderState.zoom || !renderState.zoomCards.length) return;
  const faceW = faceBBox(lm).w || W;
  for (const zc of renderState.zoomCards as RenderZoomCard[]) {
    const g = zc.ctx, dw = zc.canvas.width, dh = zc.canvas.height;
    g.fillStyle = "#05070a"; g.fillRect(0, 0, dw, dh);
    if (!zc.region) {
      drawFullFrameCard(g, dw, dh, W, els.canvas.height);
      continue;
    }
    const box = zoomRegionBounds(lm, zc.region);
    if (!box) continue;
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    let s = Math.max(box.w, box.h) * 1.7;
    s = Math.max(s, faceW * 0.13);   // 避免过度放大、保留一点周边
    g.drawImage(els.canvas, cx - s / 2, cy - s / 2, s, s, 0, 0, dw, dh);
  }
  syncFocusCards();
}

function drawFullFrameCard(g: CanvasRenderingContext2D, dw: number, dh: number, W: number, H: number): void {
  const scale = Math.min(dw / W, dh / H);
  const tw = W * scale;
  const th = H * scale;
  g.drawImage(els.canvas, 0, 0, W, H, (dw - tw) / 2, (dh - th) / 2, tw, th);
}

function boundsFromPoints(points: Array<number[] | null | undefined> | null | undefined): Bounds | null {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of points || []) {
    if (!p) continue;
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  if (x1 < x0) return null;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function regionBounds(lm: Vec3[], region: ZoomRegion): Bounds | null {
  const pts: Vec3[] = [];
  for (const i of region.idx) {
    const p = lm[i]; if (!p) continue;
    pts.push(p);
  }
  return boundsFromPoints(pts);
}

function incisionOverlayBounds(lm: Vec3[]): Bounds | null {
  const overlay = renderState.incisionOverlay as AnyRecord | null;
  if (!overlay) return null;
  const refs = [
    overlay.tumor?.center_ref,
    ...(overlay.tumor?.boundary_refs || []),
    ...(overlay.candidate?.polyline_refs || []),
  ].filter(Boolean);
  if (!refs.length) return null;
  return boundsFromPoints(mapSurfaceRefs(surfaceRefs(refs), lm, modelTriangles()).pts);
}

function zoomRegionBounds(lm: Vec3[], region: RenderRegion): Bounds | null {
  if (!region) return null;
  if (isIncisionZoomRegion(region)) return incisionOverlayBounds(lm);
  return regionBounds(lm, region);
}

export function drawFocusedRegion(lm: Vec3[] | null, W: number, H: number): void {
  const region = renderState.focusRegion as RenderRegion;
  if (!region || !lm) return;
  const crop = focusCropRect(lm, region, W, H);
  if (!crop) return;

  focusScratch.width = W;
  focusScratch.height = H;
  focusCtx.drawImage(els.canvas, 0, 0);
  ctx.drawImage(focusScratch, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
}

function focusCropRect(lm: Vec3[], region: RenderRegion, W: number, H: number): { sx: number; sy: number; sw: number; sh: number } | null {
  const box = zoomRegionBounds(lm, region);
  if (!box) return null;
  const faceW = faceBBox(lm).w || W;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const zoom = clamp(renderState.focusZoom || 1.8, focusZoomRange.min, focusZoomRange.max);
  let sw = Math.max(box.w * 2.5, faceW * 0.42) / zoom;
  let sh = sw * (H / W);
  if (sh < box.h * 2.2) { sh = box.h * 2.2; sw = sh * (W / H); }
  sw = Math.min(W, sw); sh = Math.min(H, sh);
  return {
    sx: clamp(cx - sw / 2, 0, W - sw),
    sy: clamp(cy - sh / 2, 0, H - sh),
    sw,
    sh,
  };
}

// ── 统计 ──────────────────────────────────────────────────────────────────────
export function updateStats(lm: Vec3[] | null, W: number, H: number, lineCount: number): void {
  const gate = sourceState.qualityGate as AnyRecord | null;
  const localRegionQuality = (sourceState.localRegionQuality || gate?.local_region_quality) as AnyRecord | null;
  const localNeedsReview = gate?.passed && localQualityNeedsReview(localRegionQuality) && sourceState.sourceKind !== "image";
  const rawQ = Math.round(sourceState.presence * 100);
  const q = gate && !gate.passed ? Math.min(rawQ, 44) : localNeedsReview ? Math.min(rawQ, 68) : rawQ;
  const label = gate && !gate.passed ? "需复核" : localNeedsReview ? "局部复核" : q >= 85 ? "稳定" : q >= 45 ? "一般" : q > 0 ? "寻找中" : "未开始";
  els.qualityVal.textContent = `${label} ${q}%`; els.qualityBar.style.width = q + "%";
  if (!lm || sourceState.presence <= 0) {
    sourceState.qualityGate = null;
    sourceState.localRegionQuality = null;
    renderQualityDiagnostics.previousFrame = null;
    renderQualityDiagnostics.source = sourceState.source;
    els.statState.textContent = sourceState.running ? "搜索中" : "未开始";
    els.statFace.textContent = els.statYaw.textContent = els.statLines.textContent = "—";
    setLive(sourceState.running && sourceState.sourceKind === "camera", sourceState.running ? els.live.dataset.k || "运行中" : "待机");
    return;
  }
  els.statState.textContent = gate && !gate.passed ? "需复核" : localNeedsReview ? "局部复核" : sourceState.presence > 0.85 ? "稳定" : "搜索中";
  const bb = faceBBox(lm);
  els.statFace.textContent = Math.round(100 * (bb.w * bb.h) / (W * H)) + "%";
  els.statYaw.textContent = gate?.yaw_norm != null ? gate.yaw_norm.toFixed(2) : "—";
  els.statLines.textContent = String(lineCount);
}
