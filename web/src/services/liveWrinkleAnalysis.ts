import { FaceLandmarker } from "@mediapipe/tasks-vision";
import visionWasmLoaderUrl from "../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url";
import visionWasmBinaryUrl from "../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url";
import faceLandmarkerUrl from "../../assets/face_landmarker.task?url";

import { els } from "./liveDom.ts";
import { mapAtlas, toPixels, type MappedAtlasLine } from "./geometryAtlas.ts";
import { countMetric, logWarn } from "./logger.ts";
import {
  hasManualRefineChanges,
  replaceStaticRefineBaseline,
} from "./liveRefine2d.ts";
import { modelState, renderState, sourceState, type EditableRefineLine } from "./liveState.ts";
import type { Triangle, Vec3 } from "./softBody.ts";
import { liveBenchmark } from "./liveBenchmark.ts";
import { LatestFrameProcessor } from "./latestFrameProcessor.ts";
import { WrinkleOpticalFlowTracker } from "./liveWrinkleOpticalFlow.ts";
import {
  evaluateWrinkleCorrection,
  type WrinkleCorrectionGateResult,
} from "./liveWrinkleCorrection.ts";
import {
  bindWrinkleLinesToFace,
  mapTrackedWrinkleLines,
  type TrackedWrinkleLine,
} from "./liveWrinkleTracking.ts";
import {
  captureWrinkleTextureFrame,
  type WrinkleRidgeSnapDiagnostics,
} from "./liveWrinkleTextureTracking.ts";
import { TemporalWrinkleStabilizer } from "./temporalWrinkleStabilizer.ts";
import {
  fromWrinkleWorkingPoint,
  toWrinkleWorkingPoint,
  wrinkleSourceSize,
  wrinkleWorkingTransform,
} from "./liveWrinkleMath.ts";
import { V6_RSTL_ALGORITHM } from "./personalized/v6RstlRefinementV9.ts";
import {
  createLiveWrinklePipelineWorkerClient,
  type LiveWrinklePipelineWorkerClient,
} from "./personalized/liveWrinklePipelineWorkerClient.ts";
import {
  LATEST_WRINKLE_REFINEMENT_PROFILE,
} from "./personalized/v9RstlRefinementProfile.ts";
import {
  isYoloGuidedRstlSeed,
  YOLO_GUIDED_RSTL_SCOPE,
} from "./personalized/yoloGuidedRstlScope.ts";
import {
  wrinkleV10ProcessingLocationLabel,
  type WrinkleV10ProviderCapability,
} from "./personalized/wrinkleV10Provider.ts";
import { RSTL_STANDARD_CONTRACT } from "./rstlStandardContract.ts";
import type { LiveWrinkleWorkerEvidence } from
  "../workers/liveWrinklePipelineWorkerContract.ts";
import type { LiveWrinkleDetectionResult } from
  "../workers/liveWrinklePipelineWorkerContract.ts";
import type { LiveWrinkleWorkerTimings } from
  "../workers/liveWrinklePipelineWorkerContract.ts";

export type WrinkleDisplayMode = "rstl" | "wrinkles" | "both";
type AnalysisStatus =
  | "idle"
  | "loading"
  | "detecting"
  | "detected"
  | "refining"
  | "evidence"
  | "live-detecting"
  | "live-empty"
  | "live-ready"
  | "ready"
  | "applied"
  | "error";

export interface LiveWrinkleEvidenceLine {
  id: string;
  className: string;
  points: Array<[number, number]>;
}

interface WorkingFrame {
  imageData: ImageData;
  size: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface FramewiseDetectionFrame {
  generation: number;
  sourceKind: "camera" | "video";
  timestamp: number;
  working: WorkingFrame;
  landmarks: Vec3[];
}

interface WrinkleAnalysisState {
  generation: number;
  status: AnalysisStatus;
  displayMode: WrinkleDisplayMode;
  evidenceLines: LiveWrinkleEvidenceLine[];
  standardLines: EditableRefineLine[] | null;
  autoRefinedLines: EditableRefineLine[] | null;
  movedCurveCount: number;
  movedPointCount: number;
  fineLineCount: number;
  sourceComponentCount: number;
  evidenceSource: "paired-edge-v10-dynamic" | "yolo-live" | null;
  diagnostics: Record<string, any> | null;
  audit: Record<string, any> | null;
  timings: LiveWrinkleWorkerTimings | null;
  provider: WrinkleV10ProviderCapability | null;
  reproducibility: Record<string, unknown> | null;
  detectionId: string | null;
  refinementContext: {
    working: WorkingFrame;
    workLandmarks: Vec3[];
    seeds: Array<{ id: number; name: string; region: string; pts: Array<[number, number]> }>;
    faceWidthPx: number;
  } | null;
  trackedLines: TrackedWrinkleLine[];
  error: string | null;
}

export type WrinkleDisplayResumeState = Omit<WrinkleAnalysisState, "generation">;

const state: WrinkleAnalysisState = {
  generation: 0,
  status: "idle",
  displayMode: "both",
  evidenceLines: [],
  standardLines: null,
  autoRefinedLines: null,
  movedCurveCount: 0,
  movedPointCount: 0,
  fineLineCount: 0,
  sourceComponentCount: 0,
  evidenceSource: null,
  diagnostics: null,
  audit: null,
  timings: null,
  provider: null,
  reproducibility: null,
  detectionId: null,
  refinementContext: null,
  trackedLines: [],
  error: null,
};

let wrinkleWorker: LiveWrinklePipelineWorkerClient | null = null;
let wrinkleFaceLandmarker: FaceLandmarker | null = null;
const activeAnalyses = new Set<Promise<void>>();
const LIVE_YOLO_INPUT_SIZE = 640;
const LIVE_YOLO_CORRECTION_INTERVAL_SECONDS = 2;
const LIVE_YOLO_INITIAL_RETRY_INTERVAL_SECONDS = 2;
let liveDetectionInFlight = false;
let liveDetectionAttempted = false;
let liveDetectionCount = 0;
let lastLiveDetectionAttemptMediaTime = Number.NaN;
let liveCorrectionInFlight = false;
let lastLiveCorrectionMediaTime = Number.NaN;
let liveCorrectionDiagnostics: (WrinkleCorrectionGateResult & {
  attemptedAt: number;
  acceptedCount: number;
  rejectedCount: number;
}) | null = null;
let liveCorrectionAcceptedCount = 0;
let liveCorrectionRejectedCount = 0;
let skinTracker: WrinkleOpticalFlowTracker | null = null;
let wrinkleTextureScratch: HTMLCanvasElement | null = null;
let wrinkleWorkingScratch: HTMLCanvasElement | null = null;
let wrinkleWorkingContext: CanvasRenderingContext2D | null = null;
let trackingGrayBuffer: Uint8Array | undefined;
let liveDisplayLines: LiveWrinkleEvidenceLine[] = [];
let ridgeSnapDiagnostics: WrinkleRidgeSnapDiagnostics | null = null;
let framewiseProcessor: LatestFrameProcessor<FramewiseDetectionFrame, LiveWrinkleDetectionResult> | null = null;
const temporalFramewiseStabilizer = new TemporalWrinkleStabilizer();

export function liveWrinkleProcessingMode(_search = ""): "tracking" | "framewise" {
  return "tracking";
}

export function isDynamicWrinkleSourceKind(value: string | null): boolean {
  return value === "camera" || value === "video";
}

function dynamicWrinkleSourceLabel(): "摄像头" | "视频" {
  return sourceState.sourceKind === "video" ? "视频" : "摄像头";
}

const cloneMappedLines = (lines: readonly MappedAtlasLine[]): EditableRefineLine[] => (
  lines.map((line) => ({
    name: line.name || "unnamed_curve",
    region: line.region || "",
    symmetryRole: "",
    symmetryPairId: "",
    hidden: false,
    hiddenPointRuns: [],
    tris: [...(line.tris || [])],
    pts: line.pts.map((point) => [point[0], point[1], point[2] || 0] as Vec3),
  }))
);

const cloneEditableLines = (lines: readonly EditableRefineLine[]): EditableRefineLine[] => (
  lines.map((line) => ({
    ...line,
    hiddenPointRuns: line.hiddenPointRuns.map((run) => [run[0], run[1]]),
    tris: [...line.tris],
    pts: line.pts.map((point) => [point[0], point[1], point[2] || 0] as Vec3),
  }))
);

function currentPixelSource(): CanvasImageSource | null {
  if (sourceState.sourceKind === "image") return sourceState.source as CanvasImageSource | null;
  return null;
}

async function ensureWrinkleFaceLandmarker(): Promise<FaceLandmarker> {
  if (wrinkleFaceLandmarker) return wrinkleFaceLandmarker;
  wrinkleFaceLandmarker = await FaceLandmarker.createFromOptions(
    { wasmLoaderPath: visionWasmLoaderUrl, wasmBinaryPath: visionWasmBinaryUrl },
    {
      baseOptions: { modelAssetPath: faceLandmarkerUrl, delegate: "CPU" },
      runningMode: "IMAGE",
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    },
  );
  return wrinkleFaceLandmarker;
}

async function detectV9ReferenceLandmarks(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Vec3[]> {
  const detector = await ensureWrinkleFaceLandmarker();
  const result = detector.detect(source as Parameters<FaceLandmarker["detect"]>[0]);
  const normalized = result.faceLandmarks?.[0];
  if (!normalized?.length) throw new Error("CPU 精确模式未检测到单一正面人脸");
  return toPixels(normalized, width, height).map((point) => [point[0], point[1], 0] as Vec3);
}

export function isWrinkleFrameReady(): boolean {
  const imageReady = sourceState.sourceKind === "image" && Boolean(sourceState.imageCacheLM);
  const dynamicReady = isDynamicWrinkleSourceKind(sourceState.sourceKind)
    && !sourceState.paused && Boolean(sourceState.lastLM);
  return sourceState.running && Boolean(imageReady || dynamicReady);
}

export function buildWrinkleWorkingFrame(
  source: CanvasImageSource,
  width: number,
  height: number,
  maximumSize = 1280,
): WorkingFrame {
  const { size, scale, targetWidth, targetHeight, offsetX, offsetY } =
    wrinkleWorkingTransform(width, height, maximumSize);
  const canvas = wrinkleWorkingScratch ||= document.createElement("canvas");
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  const context = wrinkleWorkingContext ||= canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法建立皱纹检测画布");
  context.fillStyle = "#000";
  context.fillRect(0, 0, size, size);
  context.drawImage(source, offsetX, offsetY, targetWidth, targetHeight);
  return {
    imageData: context.getImageData(0, 0, size, size),
    size,
    scale,
    offsetX,
    offsetY,
  };
}

async function sha256Hex(value: Uint8Array | Uint8ClampedArray | string): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!globalThis.crypto?.subtle) return "unavailable-in-insecure-context";
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function numericFingerprint(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(value, (_key, item) => (
    typeof item === "number" && Number.isFinite(item) ? Number(item.toFixed(6)) : item
  )));
}

function currentStandardLines(landmarks: Vec3[]): EditableRefineLine[] {
  const atlasLines = modelState.atlases.rstl;
  return cloneMappedLines(mapAtlas(atlasLines, landmarks, modelState.triangles as any[], {
    expandForehead: RSTL_STANDARD_CONTRACT.expandForehead,
  }));
}

function wrinkleWorkerInstance(): LiveWrinklePipelineWorkerClient {
  wrinkleWorker ||= createLiveWrinklePipelineWorkerClient();
  return wrinkleWorker;
}

function terminateWrinkleWorker(): void {
  const current = wrinkleWorker;
  wrinkleWorker = null;
  current?.dispose();
}

function assertRefinementGate(diagnostics: Record<string, any>): void {
  if (
    diagnostics.algorithm !== V6_RSTL_ALGORITHM
    || diagnostics.two_sided_nearest_matching !== true
    || diagnostics.forehead_nearest_single_curve_matching !== true
    || diagnostics.regional_nearest_single_curve_matching !== true
    || Number(diagnostics.maximum_selected_rstl_curves_per_wrinkle) > 2
    || diagnostics.curve_unique_wrinkle_ownership !== true
    || Number(diagnostics.wrinkle_with_single_side_selected_count || 0) !== 0
    || Number(diagnostics.nose_bridge_single_curve_selected_count || 0) !== 0
    || diagnostics.bundle_propagation_enabled === true
    || Number(diagnostics.bundle_follower_moved_curve_count || 0) > 0
    || diagnostics.curvature_fairing_enabled !== true
    || diagnostics.topology_contract_preserved !== true
    || diagnostics.post_export_new_intersection_pair_count !== 0
    || diagnostics.post_export_new_self_cross_curve_count !== 0
  ) {
    throw new Error("皱纹引导结果未通过拓扑、交叉或线束间距门禁");
  }
}

function updateStatus(status: AnalysisStatus, error: string | null = null): void {
  state.status = status;
  state.error = error;
  updateWrinkleUi();
  publishDebugSnapshot();
}

function statusLabel(): string {
  if (state.status === "live-detecting") return state.evidenceLines.length
    ? liveWrinkleProcessingMode() === "framewise" ? "逐帧检测中 · 正在更新" : "实时跟踪中 · 正在更新"
    : "正在启动实时皱纹检测";
  if (state.status === "live-ready") return liveWrinkleProcessingMode() === "framewise"
    ? "GPU 逐帧皱纹检测中"
    : "实时皱纹跟踪中";
  if (state.status === "live-empty") return "暂未检测到明显皱纹 · 自动重试中";
  if (state.status === "loading") return "正在准备最新检测流程";
  if (state.status === "detecting") return "正在检测皱纹";
  if (state.status === "detected") return "皱纹检测完成";
  if (state.status === "refining") return "正在计算自动微调";
  if (state.status === "evidence") return "皱纹已检测 · 自动微调未通过门禁";
  if (state.status === "ready") return "检测完成 · 待选择";
  if (state.status === "applied") return "已应用皱纹引导微调";
  if (state.status === "error") return "检测失败";
  if (isDynamicWrinkleSourceKind(sourceState.sourceKind)) {
    return `等待${dynamicWrinkleSourceLabel()}人脸`;
  }
  return isWrinkleFrameReady() ? "等待手动检测" : "等待照片";
}

export function updateWrinkleUi(): void {
  if (!els.wrinkleStatus) return;
  const frameReady = isWrinkleFrameReady();
  const imageMode = sourceState.sourceKind === "image";
  const detectionReady = imageMode && state.status === "detected"
    && Boolean(state.detectionId && state.refinementContext);
  const busy = state.status === "loading" || state.status === "detecting" || state.status === "refining";
  const processingLocation = wrinkleV10ProcessingLocationLabel(
    state.provider,
    window.location.hostname,
  );
  els.wrinkleStatus.textContent = statusLabel();
  els.wrinkleDisplayMode.value = state.displayMode;
  els.wrinkleDisplayMode.disabled = !frameReady;
  els.wrinkleDetect.disabled = !imageMode || !frameReady || busy;
  els.wrinkleDetect.textContent = state.status === "error"
    ? "重试皱纹检测"
    : state.status === "idle" ? "检测皱纹" : "重新检测皱纹";
  els.wrinkleAutoRefine.disabled = !detectionReady || hasManualRefineChanges();
  els.wrinkleRestore.disabled = !state.standardLines
    || (state.status !== "applied" && !hasManualRefineChanges());
  if (isDynamicWrinkleSourceKind(sourceState.sourceKind)) {
    const sourceLabel = dynamicWrinkleSourceLabel();
    if (state.status === "error" || state.status === "live-empty") {
      els.wrinkleSummary.textContent = state.error
        || `${sourceLabel}皱纹检测失败，请重新启动${sourceLabel}后重试。`;
    } else {
      const elapsed = state.timings?.totalMs;
      els.wrinkleSummary.textContent = state.evidenceLines.length
        ? liveWrinkleProcessingMode() === "framewise"
          ? `YOLO 当前检测 ${state.fineLineCount} 条皱纹；每次处理使用新帧，仅做相邻结果时间稳定` +
            `${elapsed ? `；最近一帧 ${Math.round(elapsed)} ms` : ""}。`
          : `YOLO 已锁定 ${state.fineLineCount} 条皱纹，正逐帧跟踪并每 2 秒进行可信纠偏` +
            `${elapsed ? `；最近检测 ${Math.round(elapsed)} ms` : ""}。${sourceLabel}模式不运行微调。`
        : `${sourceLabel}模式仅运行 YOLO 皱纹检测；检测结果会随人脸实时移动，不运行微调。`;
    }
  } else if (state.status === "error") {
    els.wrinkleSummary.textContent = state.error || "请重试，或更换正面、清晰、光线均匀的照片。";
  } else if (state.status === "evidence") {
    els.wrinkleSummary.textContent = `已绘制 ${state.fineLineCount} 条细皱纹（${state.sourceComponentCount} 个候选区域）；${state.error || "自动微调未通过安全门禁"}，标准 RSTL 保持不变。`;
  } else if (state.status === "detected") {
    els.wrinkleSummary.textContent = `YOLO 已检测 ${state.fineLineCount} 条细皱纹（${state.sourceComponentCount} 个候选区域）；` +
      "额头或眉间证据可用时，可点击按钮微调对应 RSTL。";
  } else if (state.status === "ready" || state.status === "applied") {
    const evidenceVersion = state.evidenceSource === "yolo-live"
      ? "YOLO-only 额头/眉间引导"
      : "V10 四区域实时检测";
    const regionalMovement = state.evidenceSource === "yolo-live" && state.diagnostics
      ? `额头移动 ${Number(state.diagnostics.forehead_moved_curve_count || 0)} 条，` +
        `眉间移动 ${Number(state.diagnostics.glabellar_moved_curve_count || 0)} 条；`
      : "";
    const glabellarDiagnostic = state.evidenceSource === "yolo-live" && state.diagnostics
      && Number(state.diagnostics.glabellar_moved_curve_count || 0) === 0
      ? `眉间诊断：证据 ${Number(state.diagnostics.glabellar_evidence_line_count || 0)} 条，` +
        `几何趋势 ${Number(state.diagnostics.glabellar_classified_trend_count || 0)} 条，` +
        `候选 ${Number(state.diagnostics.glabellar_candidate_pair_count || 0)} 对，` +
        `支持通过 ${Number(state.diagnostics.glabellar_supported_curve_count || 0)} 条，` +
        `选中 ${Number(state.diagnostics.glabellar_selected_curve_count || 0)} 条。`
      : "";
    const moved = `RSTL v${RSTL_STANDARD_CONTRACT.atlasVersion} · ${evidenceVersion} · V9 7.2 · ${processingLocation}；` +
      `识别 ${state.fineLineCount} 条细皱纹（${state.sourceComponentCount} 个候选区域），` +
      regionalMovement + `共调整 ${state.movedCurveCount} 条 RSTL / ${state.movedPointCount} 个点。` +
      glabellarDiagnostic;
    els.wrinkleSummary.textContent = hasManualRefineChanges()
      ? `${moved} 已有医生手动修改，自动应用已锁定；可恢复后重新应用。`
      : moved;
  } else if (busy) {
    els.wrinkleSummary.textContent = state.status === "refining"
      ? "正在使用已缓存的皱纹检测结果运行 RSTL 微调。"
      : state.provider
      ? `正在${processingLocation}运行 V10 四区域检测。`
      : import.meta.env?.VITE_SERVER_COMPUTE === 'true'
      ? '正在服务器运行 YOLO 皱纹检测。'
      : "正在当前浏览器运行 YOLO 皱纹检测。";
  } else {
    els.wrinkleSummary.textContent = "点击“检测皱纹”只运行皱纹检测；微调算法仅在点击“皱纹引导自动微调”后启动。";
  }
}

export function setWrinkleDisplayMode(value: string): void {
  if (value !== "rstl" && value !== "wrinkles" && value !== "both") return;
  state.displayMode = value;
  updateWrinkleUi();
  window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
}

export function shouldDrawRstlLayer(): boolean {
  return state.displayMode !== "wrinkles";
}

export function shouldDrawWrinkleLayer(): boolean {
  return state.displayMode !== "rstl" && state.evidenceLines.length > 0;
}

export function getWrinkleEvidenceLines(): readonly LiveWrinkleEvidenceLine[] {
  if (isDynamicWrinkleSourceKind(sourceState.sourceKind)) {
    return liveDisplayLines;
  }
  return state.evidenceLines;
}

export function updateLiveWrinkleMeshTracking(
  canvas: HTMLCanvasElement,
  landmarks: Vec3[],
): void {
  if (isDynamicWrinkleSourceKind(sourceState.sourceKind)
      && liveWrinkleProcessingMode() === "framewise") {
    skinTracker?.suspend();
    if (new URLSearchParams(window.location.search).has("wrinkleDebug")) {
      canvas.dataset.wrinkleTextureTracking = JSON.stringify({
        mode: "fresh-detection-temporal-stabilization",
        extractionCount: liveDetectionCount,
        mediaTime: (sourceState.source as HTMLVideoElement).currentTime,
        lineCount: liveDisplayLines.length,
        scheduler: framewiseProcessor?.diagnostics() || null,
      });
    }
    return;
  }
  if (!isDynamicWrinkleSourceKind(sourceState.sourceKind)
      || !state.trackedLines.length || !landmarks.length) {
    liveDisplayLines = [];
    skinTracker?.suspend();
    delete canvas.dataset.wrinkleTextureTracking;
    delete (canvas as HTMLCanvasElement & {
      __wrinkleDisplayLines?: LiveWrinkleEvidenceLine[];
    }).__wrinkleDisplayLines;
    return;
  }
  const sample = liveBenchmark()?.current;
  const meshStart = sample ? performance.now() : 0;
  const meshLines = mapTrackedWrinkleLines(
    state.trackedLines,
    landmarks,
    modelState.triangles as Triangle[],
  );
  const mediaTime = (sourceState.source as HTMLVideoElement).currentTime;
  if (sample) sample.stages.wrinkleMesh = performance.now() - meshStart;
  if (skinTracker && !skinTracker.hasFrame(mediaTime)) {
    wrinkleTextureScratch ||= document.createElement("canvas");
    const captureStart = sample ? performance.now() : 0;
    // The tracker copies gray pixels into its owned Mat synchronously. This
    // buffer is only for subsequent frames; the asynchronous seed owns its data.
    const frame = captureWrinkleTextureFrame(canvas, wrinkleTextureScratch, 640, sample?.stages, trackingGrayBuffer);
    if (frame) trackingGrayBuffer = frame.gray;
    if (sample) sample.stages.textureCapture = performance.now() - captureStart;
    try {
      const flowStart = sample ? performance.now() : 0;
      liveDisplayLines = frame ? skinTracker.update(frame, meshLines, mediaTime) : [];
      if (sample) sample.stages.opticalFlow = performance.now() - flowStart;
      if (!frame) skinTracker.suspend();
    } catch (error) {
      skinTracker.suspend();
      liveDisplayLines = [];
      logWarn("皱纹皮肤点跟踪失败，本帧已隐藏。", error);
    }
  }
  if (sample) sample.wrinkles = liveDisplayLines.map((line) => ({
    id: line.id, points: line.points.filter((_, index) => index % 8 === 0)
      .map((point, index) => [point[0], point[1], index * 8]),
  }));
  if (new URLSearchParams(window.location.search).has("wrinkleDebug")) {
    (canvas as HTMLCanvasElement & {
      __wrinkleDisplayLines?: LiveWrinkleEvidenceLine[];
    }).__wrinkleDisplayLines = liveDisplayLines;
    canvas.dataset.wrinkleTextureTracking = JSON.stringify(
      {
        mode: "first-frame-evidence-skin-tracking-with-gated-yolo-correction",
        extractionCount: liveDetectionCount,
        mediaTime,
        opticalFlow: skinTracker?.diagnostics() || null,
        lineCount: liveDisplayLines.length,
        pointCount: liveDisplayLines.reduce((sum, line) => sum + line.points.length, 0),
        ridgeLockedLineCount: 0,
        meanRidgeCorrectionPx: 0,
      },
    );
  }
}

export function captureWrinkleDisplayState(): WrinkleDisplayResumeState {
  return {
    status: state.status,
    displayMode: state.displayMode,
    evidenceLines: state.evidenceLines.map((line) => ({
      ...line,
      points: line.points.map((point) => [point[0], point[1]]),
    })),
    standardLines: state.standardLines ? cloneEditableLines(state.standardLines) : null,
    autoRefinedLines: state.autoRefinedLines ? cloneEditableLines(state.autoRefinedLines) : null,
    movedCurveCount: state.movedCurveCount,
    movedPointCount: state.movedPointCount,
    fineLineCount: state.fineLineCount,
    sourceComponentCount: state.sourceComponentCount,
    evidenceSource: state.evidenceSource,
    diagnostics: state.diagnostics,
    audit: state.audit,
    timings: state.timings,
    provider: state.provider,
    reproducibility: state.reproducibility,
    detectionId: state.detectionId,
    refinementContext: state.refinementContext,
    trackedLines: state.trackedLines.map((line) => ({
      ...line,
      points: line.points.map((point) => ({
        ...point,
        source: [...point.source] as [number, number],
        surfaceRef: point.surfaceRef ? { ...point.surfaceRef } : null,
        fallback: point.fallback.map((anchor) => ({
          ...anchor,
          reference: [...anchor.reference] as [number, number],
        })),
        fallbackOffset: [...point.fallbackOffset] as [number, number],
      })),
    })),
    error: state.error,
  };
}

export function restoreWrinkleDisplayState(snapshot: WrinkleDisplayResumeState): void {
  const interrupted = snapshot.status === "loading"
    || snapshot.status === "detecting"
    || snapshot.status === "refining"
    || snapshot.status === "evidence";
  state.status = interrupted ? "idle" : snapshot.status;
  state.displayMode = snapshot.displayMode;
  state.evidenceLines = interrupted ? [] : snapshot.evidenceLines.map((line) => ({
    ...line,
    points: line.points.map((point) => [point[0], point[1]]),
  }));
  state.standardLines = interrupted || !snapshot.standardLines ? null : cloneEditableLines(snapshot.standardLines);
  state.autoRefinedLines = interrupted || !snapshot.autoRefinedLines ? null : cloneEditableLines(snapshot.autoRefinedLines);
  state.movedCurveCount = interrupted ? 0 : snapshot.movedCurveCount;
  state.movedPointCount = interrupted ? 0 : snapshot.movedPointCount;
  state.fineLineCount = interrupted ? 0 : snapshot.fineLineCount;
  state.sourceComponentCount = interrupted ? 0 : snapshot.sourceComponentCount;
  state.evidenceSource = interrupted ? null : snapshot.evidenceSource;
  state.diagnostics = interrupted ? null : snapshot.diagnostics;
  state.audit = interrupted ? null : snapshot.audit;
  state.timings = interrupted ? null : snapshot.timings;
  state.provider = interrupted ? null : snapshot.provider;
  state.reproducibility = interrupted ? null : snapshot.reproducibility;
  state.detectionId = interrupted ? null : snapshot.detectionId;
  state.refinementContext = interrupted ? null : snapshot.refinementContext;
  state.trackedLines = interrupted ? [] : snapshot.trackedLines.map((line) => ({
    ...line,
    points: line.points.map((point) => ({
      ...point,
      source: [...point.source] as [number, number],
      surfaceRef: point.surfaceRef ? { ...point.surfaceRef } : null,
      fallback: point.fallback.map((anchor) => ({
        ...anchor,
        reference: [...anchor.reference] as [number, number],
      })),
      fallbackOffset: [...point.fallbackOffset] as [number, number],
    })),
  }));
  state.error = interrupted ? null : snapshot.error;
  updateWrinkleUi();
  publishDebugSnapshot();
  window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
}

/**
 * Numeric-only research diagnostics for deterministic browser regression.
 * This intentionally excludes source pixels and YOLO masks.
 */
export function getLiveWrinkleAnalysisDebugSnapshot() {
  return {
    atlasVersion: RSTL_STANDARD_CONTRACT.atlasVersion,
    refinementProfile: LATEST_WRINKLE_REFINEMENT_PROFILE,
    executionThread: "web_worker",
    status: state.status,
    fineLineCount: state.fineLineCount,
    sourceComponentCount: state.sourceComponentCount,
    evidenceSource: state.evidenceSource,
    movedCurveCount: state.movedCurveCount,
    movedPointCount: state.movedPointCount,
    faceLandmarkerDelegate: "CPU",
    faceLandmarkerRunningMode: "IMAGE",
    diagnostics: state.diagnostics ? { ...state.diagnostics } : null,
    audit: state.audit ? { ...state.audit } : null,
    timings: state.timings ? { ...state.timings } : null,
    provider: state.provider ? { ...state.provider } : null,
    reproducibility: state.reproducibility ? { ...state.reproducibility } : null,
    detectionId: state.detectionId,
    liveTracked: state.trackedLines.length > 0,
    liveTrackingMode: "first-frame-evidence-skin-tracking-with-gated-yolo-correction",
    textureFlowTracking: "opencv-pyramidal-lk-forward-backward",
    extractionCount: liveDetectionCount,
    yoloCorrectionIntervalSeconds: LIVE_YOLO_CORRECTION_INTERVAL_SECONDS,
    yoloCorrection: liveCorrectionDiagnostics ? { ...liveCorrectionDiagnostics } : null,
    opticalFlow: skinTracker?.diagnostics() || null,
    ridgeSnapDiagnostics: ridgeSnapDiagnostics ? { ...ridgeSnapDiagnostics } : null,
    maintenanceRidgeSnapDiagnostics: null,
    error: state.error,
    evidenceLines: state.evidenceLines.map((line) => ({
      id: line.id,
      className: line.className,
      points: line.points.map((point) => [point[0], point[1]]),
    })),
    standardLines: state.standardLines?.map((line) => ({
      name: line.name,
      region: line.region,
      pts: line.pts.map((point) => [point[0], point[1]]),
    })) || null,
    autoRefinedLines: state.autoRefinedLines?.map((line) => ({
      name: line.name,
      region: line.region,
      hiddenPointRuns: line.hiddenPointRuns.map((run) => [run[0], run[1]]),
      pts: line.pts.map((point) => [point[0], point[1]]),
    })) || null,
  };
}

function publishDebugSnapshot(): void {
  if (typeof document === "undefined" ||
      !new URLSearchParams(window.location.search).has("wrinkleDebug")) return;
  let element = document.getElementById("langerface-wrinkle-debug-snapshot");
  if (!element) {
    element = document.createElement("script");
    element.id = "langerface-wrinkle-debug-snapshot";
    element.setAttribute("type", "application/json");
    document.body.appendChild(element);
  }
  element.textContent = JSON.stringify(getLiveWrinkleAnalysisDebugSnapshot());
}

async function runCurrentWrinkleAnalysis({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (sourceState.sourceKind !== "image" || !isWrinkleFrameReady()) {
    updateWrinkleUi();
    return;
  }
  if (!force && state.status !== "idle" && state.status !== "error") return;
  const source = currentPixelSource();
  if (!source) return;
  const generation = ++state.generation;
  state.evidenceLines = [];
  state.autoRefinedLines = null;
  state.standardLines = null;
  state.movedCurveCount = 0;
  state.movedPointCount = 0;
  state.fineLineCount = 0;
  state.sourceComponentCount = 0;
  state.evidenceSource = null;
  state.diagnostics = null;
  state.audit = null;
  state.timings = null;
  state.provider = null;
  state.reproducibility = null;
  state.detectionId = null;
  state.refinementContext = null;
  state.trackedLines = [];
  updateStatus("loading");
  try {
    const sourceSize = wrinkleSourceSize(source);
    const landmarks = await detectV9ReferenceLandmarks(
      source,
      sourceSize.width,
      sourceSize.height,
    );
    if (generation !== state.generation) return;
    state.standardLines = currentStandardLines(landmarks);
    const working = buildWrinkleWorkingFrame(source, sourceSize.width, sourceSize.height);
    const workLandmarks = landmarks.map((point) => {
      const [x, y] = toWrinkleWorkingPoint(point, working);
      return [x, y, (point[2] || 0) * working.scale] as Vec3;
    });
    const seeds = state.standardLines.map((line, id) => ({
      id,
      name: line.name,
      region: line.region,
      pts: line.pts.map((point) => toWrinkleWorkingPoint(point, working)),
    }));
    const [workingRgbaSha256, landmarksSha256, standardRstlSha256] = await Promise.all([
      sha256Hex(working.imageData.data),
      numericFingerprint(workLandmarks),
      numericFingerprint(seeds),
    ]);
    if (generation !== state.generation) return;
    state.reproducibility = {
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      workingSize: working.size,
      workingRgbaSha256,
      landmarksSha256,
      standardRstlSha256,
    };
    publishDebugSnapshot();
    const xs = workLandmarks.map((point) => point[0]);
    const faceWidth = Math.max(...xs) - Math.min(...xs);
    updateStatus("detecting");
    let pipelineCompleted = false;
    let evidenceCommitted = false;
    const commitEvidence = (evidence: LiveWrinkleWorkerEvidence) => {
      if (generation !== state.generation || evidenceCommitted) return;
      evidenceCommitted = true;
      state.evidenceSource = "yolo-live";
      state.evidenceLines = evidence.lines.map((line) => ({
        id: line.id,
        className: line.class,
        points: line.points.map((point) => fromWrinkleWorkingPoint(point, working)),
      }));
      state.fineLineCount = evidence.lines.length;
      state.sourceComponentCount = Number(evidence.summary.sourceConnectedComponents)
        || Number(evidence.summary.fineLineCount)
        || evidence.lines.length;
      state.reproducibility = {
        ...(state.reproducibility || {}),
        browserBaselineSha256: evidence.summary.browserBaselineSha256,
        v10InputImageSha256: evidence.summary.v10InputImageSha256,
        lineCountByAnatomicalClass: evidence.summary.lineCountByAnatomicalClass,
      };
      window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
    };
    const pipeline = await wrinkleWorkerInstance().detect({
      imageData: working.imageData,
      size: working.size,
      landmarks: workLandmarks.map((point) => [
        point[0] / working.size,
        point[1] / working.size,
        point[2] / working.size,
      ]),
      mode: "yolo-only",
      cacheForRefinement: true,
    }, (event) => {
      if (pipelineCompleted) return;
      if (event.type === "model-progress") {
        if (generation !== state.generation) return;
        const { progress } = event;
        const percent = Math.round(progress.loadedChunks / Math.max(1, progress.totalChunks) * 100);
        els.wrinkleSummary.textContent = `正在当前设备加载 YOLO 模型：${percent}%`;
        return;
      }
      if (event.type === "provider-ready") {
        if (generation !== state.generation) return;
        state.provider = event.capability;
        updateWrinkleUi();
        publishDebugSnapshot();
        return;
      }
      if (event.type === "pipeline-progress") {
        if (generation !== state.generation) return;
        els.wrinkleSummary.textContent = event.stage === "four-region"
          ? `正在${wrinkleV10ProcessingLocationLabel(state.provider, window.location.hostname)}` +
            "运行 V10 四区域检测……"
          : "正在运行 V9 7.2 微调……";
        return;
      }
      if (event.type === "evidence") return;
    });
    if (generation !== state.generation) return;
    pipelineCompleted = true;
    commitEvidence(pipeline.evidence);
    state.detectionId = pipeline.detectionId;
    state.refinementContext = pipeline.detectionId ? {
      working,
      workLandmarks,
      seeds,
      faceWidthPx: faceWidth,
    } : null;
    state.timings = pipeline.timings;
    state.provider = pipeline.provider;
    updateStatus("detected");
    countMetric("wrinkle.singleFrame.detected");
    window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
  } catch (error) {
    if (generation !== state.generation) return;
    const message = error instanceof Error ? error.message : "未知错误";
    if (state.evidenceLines.length > 0) {
      logWarn("皱纹中心线已生成，但检测结果未通过最终提交。", error);
      countMetric("wrinkle.singleFrame.partialFailure");
      updateStatus("evidence", message);
      window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
      return;
    }
    logWarn("单帧皱纹检测失败。", error);
    countMetric("wrinkle.singleFrame.failure");
    updateStatus("error", message);
  }
}

export function analyzeCurrentWrinkles(options: { force?: boolean } = {}): Promise<void> {
  const analysis = runCurrentWrinkleAnalysis(options);
  activeAnalyses.add(analysis);
  void analysis.finally(() => activeAnalyses.delete(analysis));
  return analysis;
}

export function updateLiveWrinkleTracking(
  landmarks: Vec3[],
  timeMs: number,
): void {
  const sourceKind = sourceState.sourceKind;
  if (!isDynamicWrinkleSourceKind(sourceKind) || sourceState.paused || !sourceState.running) return;
  if (liveWrinkleProcessingMode() === "framewise") {
    updateFramewiseWrinkleDetection(landmarks, timeMs, sourceKind as "camera" | "video");
    return;
  }
  if (liveDetectionAttempted) {
    scheduleLiveWrinkleCorrection(landmarks, sourceKind as "camera" | "video");
    return;
  }
  // An empty result or failure also completes the single extraction attempt.
  if (liveDetectionInFlight) return;
  if (landmarks.length < 468) {
    if (sourceKind === "video") {
      liveDetectionAttempted = true;
      updateStatus("error", "视频第一帧未检测到人脸，无法建立皱纹跟踪。");
    }
    return;
  }
  const source = els.canvas;
  if (!source || landmarks.length < 468) return;
  const dynamicSource = sourceState.source as HTMLVideoElement;
  const currentMediaTime = Number(dynamicSource.currentTime);
  if (Number.isFinite(lastLiveDetectionAttemptMediaTime) && Number.isFinite(currentMediaTime)) {
    const elapsed = currentMediaTime - lastLiveDetectionAttemptMediaTime;
    if (elapsed >= 0 && elapsed < LIVE_YOLO_INITIAL_RETRY_INTERVAL_SECONDS) return;
  }
  const generation = state.generation;
  const detectionLandmarks = landmarks.map((point) => [...point] as Vec3);
  const detectionMediaTime = currentMediaTime;
  liveDetectionAttempted = true;
  lastLiveDetectionAttemptMediaTime = detectionMediaTime;
  liveDetectionInFlight = true;
  if (!state.evidenceLines.length) updateStatus("live-detecting");
  const analysis = (async () => {
    let candidateTracker: WrinkleOpticalFlowTracker | null = null;
    try {
      const width = els.canvas.width;
      const height = els.canvas.height;
      wrinkleTextureScratch ||= document.createElement("canvas");
      const detectionTextureFrame = captureWrinkleTextureFrame(
        els.canvas,
        wrinkleTextureScratch,
        640,
      );
      const working = buildWrinkleWorkingFrame(source, width, height, LIVE_YOLO_INPUT_SIZE);
      if (!detectionTextureFrame) throw new Error("无法读取首帧皮肤纹理");
      candidateTracker = await WrinkleOpticalFlowTracker.create();
      if (generation !== state.generation) return;
      liveDetectionCount += 1;
      const result = await wrinkleWorkerInstance().detect({
        imageData: working.imageData,
        size: working.size,
        mode: "yolo-only",
        includeFingerprint: false,
      });
      if (generation !== state.generation || sourceState.sourceKind !== sourceKind
          || sourceState.paused || !sourceState.running) return;
      const sourceLines = result.evidence.lines.map((line) => ({
        id: line.id,
        className: line.class,
        points: line.points.map((point) => fromWrinkleWorkingPoint(point, working)),
      }));
      lastLiveCorrectionMediaTime = detectionMediaTime;
      state.evidenceLines = sourceLines;
      const displaySeed = { lines: sourceLines, diagnostics: null };
      ridgeSnapDiagnostics = displaySeed.diagnostics;
      const benchmark = liveBenchmark();
      if (benchmark) benchmark.seed = displaySeed.lines.map((line) => ({
        id: line.id, points: line.points.map((point) => [...point]),
      }));
      candidateTracker.seed(detectionTextureFrame, displaySeed.lines, detectionMediaTime);
      skinTracker?.dispose();
      skinTracker = candidateTracker;
      candidateTracker = null;
      liveDisplayLines = displaySeed.lines;
      state.trackedLines = bindWrinkleLinesToFace(
        displaySeed.lines,
        detectionLandmarks,
        modelState.triangles as Triangle[],
      );
      state.evidenceSource = "yolo-live";
      state.fineLineCount = sourceLines.length;
      state.sourceComponentCount = Number(result.evidence.summary.sourceConnectedComponents)
        || sourceLines.length;
      state.timings = result.timings;
      state.provider = null;
      state.error = null;
      updateStatus("live-ready");
      countMetric("wrinkle.liveYolo.ready");
    } catch (error) {
      if (generation !== state.generation) return;
      const message = error instanceof Error ? error.message : "未知错误";
      if (message === "YOLO 未提取到有效皱纹中心线") {
        liveDetectionAttempted = false;
        countMetric("wrinkle.liveYolo.empty");
        updateStatus("live-empty",
          "当前画面没有检测到达到阈值的皱纹中心线；可能皱纹较浅，也可能是光线或对焦不足。系统将每 2 秒自动重试。");
        return;
      }
      logWarn("实时 YOLO 皱纹检测失败。", error);
      countMetric("wrinkle.liveYolo.failure");
      if (!state.evidenceLines.length) updateStatus("error", message);
    } finally {
      candidateTracker?.dispose();
      if (generation === state.generation) liveDetectionInFlight = false;
    }
  })();
  activeAnalyses.add(analysis);
  void analysis.finally(() => activeAnalyses.delete(analysis));
}

function numericSummaryArray(summary: Record<string, unknown>, key: string): number[] {
  const value = summary[key];
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item))
    : [];
}

function scheduleLiveWrinkleCorrection(
  landmarks: Vec3[],
  sourceKind: "camera" | "video",
): void {
  if (liveCorrectionInFlight || !skinTracker || state.trackedLines.length === 0
      || landmarks.length < 468) return;
  const source = sourceState.source as HTMLVideoElement;
  const mediaTime = Number(source.currentTime);
  if (!Number.isFinite(mediaTime)) return;
  if (Number.isFinite(lastLiveCorrectionMediaTime)) {
    const elapsed = mediaTime - lastLiveCorrectionMediaTime;
    if (elapsed >= 0 && elapsed < LIVE_YOLO_CORRECTION_INTERVAL_SECONDS) return;
    if (elapsed < 0) {
      lastLiveCorrectionMediaTime = mediaTime;
      return;
    }
  }

  const width = els.canvas.width;
  const height = els.canvas.height;
  if (!width || !height) return;
  const generation = state.generation;
  const correctionLandmarks = landmarks.map((point) => [...point] as Vec3);
  const comparisonLines = mapTrackedWrinkleLines(
    state.trackedLines,
    correctionLandmarks,
    modelState.triangles as Triangle[],
  );
  wrinkleTextureScratch ||= document.createElement("canvas");
  const textureFrame = captureWrinkleTextureFrame(els.canvas, wrinkleTextureScratch, 640);
  if (!textureFrame) return;
  const working = buildWrinkleWorkingFrame(els.canvas, width, height, LIVE_YOLO_INPUT_SIZE);
  const xs = correctionLandmarks.slice(0, 468).map((point) => point[0]);
  const faceWidthPx = Math.max(...xs) - Math.min(...xs);
  lastLiveCorrectionMediaTime = mediaTime;
  liveCorrectionInFlight = true;

  const correction = (async () => {
    let candidateTracker: WrinkleOpticalFlowTracker | null = null;
    try {
      const result = await wrinkleWorkerInstance().detect({
        imageData: working.imageData,
        size: working.size,
        mode: "yolo-only",
        includeFingerprint: false,
      });
      if (generation !== state.generation || sourceState.sourceKind !== sourceKind
          || sourceState.paused || !sourceState.running) return;
      const candidateLines = result.evidence.lines.map((line) => ({
        id: line.id,
        className: line.class,
        points: line.points.map((point) => fromWrinkleWorkingPoint(point, working)),
      }));
      const yoloDiagnostics = result.evidence.summary.yoloDiagnostics;
      const confidenceThreshold = yoloDiagnostics && typeof yoloDiagnostics === "object"
        ? Number((yoloDiagnostics as Record<string, unknown>).confidenceThreshold) || 0.07
        : 0.07;
      const gate = evaluateWrinkleCorrection({
        current: comparisonLines,
        candidate: candidateLines,
        faceWidthPx,
        yoloScores: numericSummaryArray(result.evidence.summary, "yoloScores"),
        yoloConfidenceThreshold: confidenceThreshold,
      });
      if (!gate.accepted) {
        liveCorrectionRejectedCount += 1;
        liveCorrectionDiagnostics = {
          ...gate,
          attemptedAt: mediaTime,
          acceptedCount: liveCorrectionAcceptedCount,
          rejectedCount: liveCorrectionRejectedCount,
        };
        countMetric(`wrinkle.liveYolo.correctionRejected.${gate.reason}`);
        publishDebugSnapshot();
        return;
      }

      candidateTracker = await WrinkleOpticalFlowTracker.create();
      if (generation !== state.generation || sourceState.sourceKind !== sourceKind) return;
      candidateTracker.seed(textureFrame, candidateLines, mediaTime);
      skinTracker?.dispose();
      skinTracker = candidateTracker;
      candidateTracker = null;
      liveDisplayLines = candidateLines;
      state.evidenceLines = candidateLines;
      state.trackedLines = bindWrinkleLinesToFace(
        candidateLines,
        correctionLandmarks,
        modelState.triangles as Triangle[],
      );
      state.fineLineCount = candidateLines.length;
      state.sourceComponentCount = Number(result.evidence.summary.sourceConnectedComponents)
        || candidateLines.length;
      state.timings = result.timings;
      liveDetectionCount += 1;
      liveCorrectionAcceptedCount += 1;
      liveCorrectionDiagnostics = {
        ...gate,
        attemptedAt: mediaTime,
        acceptedCount: liveCorrectionAcceptedCount,
        rejectedCount: liveCorrectionRejectedCount,
      };
      countMetric("wrinkle.liveYolo.correctionAccepted");
      publishDebugSnapshot();
    } catch (error) {
      if (generation !== state.generation) return;
      liveCorrectionRejectedCount += 1;
      logWarn("低频 YOLO 纠偏失败，继续使用当前跟踪结果。", error);
      countMetric("wrinkle.liveYolo.correctionFailure");
    } finally {
      candidateTracker?.dispose();
      if (generation === state.generation) liveCorrectionInFlight = false;
    }
  })();
  activeAnalyses.add(correction);
  void correction.finally(() => activeAnalyses.delete(correction));
}

function clearFramewiseEvidence(): void {
  temporalFramewiseStabilizer.reset();
  liveDisplayLines = [];
  state.evidenceLines = [];
  state.trackedLines = [];
  state.fineLineCount = 0;
  state.sourceComponentCount = 0;
  window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
}

function framewiseDetectionProcessor(): LatestFrameProcessor<FramewiseDetectionFrame, LiveWrinkleDetectionResult> {
  framewiseProcessor ||= new LatestFrameProcessor({
    timestamp: frame => frame.timestamp,
    process: frame => wrinkleWorkerInstance().detect({
      imageData: frame.working.imageData,
      size: frame.working.size,
      mode: "yolo-only",
      includeFingerprint: false,
    }),
    commit: (result, frame) => {
      if (frame.generation !== state.generation || sourceState.sourceKind !== frame.sourceKind
          || sourceState.paused || !sourceState.running) return;
      const detected = result.evidence.lines.map((line) => ({
        id: line.id,
        className: line.class,
        points: line.points.map((point) => fromWrinkleWorkingPoint(point, frame.working)),
      }));
      const xs = frame.landmarks.slice(0, 468).map((point) => point[0]);
      const faceWidthPx = Math.max(...xs) - Math.min(...xs);
      const stabilized = temporalFramewiseStabilizer.update(detected, faceWidthPx);
      liveDetectionCount += 1;
      liveDisplayLines = stabilized;
      state.evidenceLines = stabilized;
      state.trackedLines = [];
      state.evidenceSource = "yolo-live";
      state.fineLineCount = stabilized.length;
      state.sourceComponentCount = Number(result.evidence.summary.sourceConnectedComponents)
        || stabilized.length;
      state.timings = result.timings;
      state.provider = null;
      state.error = null;
      updateStatus("live-ready");
      countMetric("wrinkle.liveYolo.framewiseReady");
      window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
    },
    onError: (error, frame) => {
      if (frame.generation !== state.generation || sourceState.sourceKind !== frame.sourceKind) return;
      clearFramewiseEvidence();
      const message = error instanceof Error ? error.message : "未知错误";
      logWarn("逐帧 YOLO 皱纹检测失败。", error);
      updateStatus("error", message);
    },
  });
  return framewiseProcessor;
}

function updateFramewiseWrinkleDetection(
  landmarks: Vec3[],
  timeMs: number,
  sourceKind: "camera" | "video",
): void {
  if (landmarks.length < 468) {
    framewiseProcessor?.cancel();
    if (liveDisplayLines.length) clearFramewiseEvidence();
    return;
  }
  const width = els.canvas.width;
  const height = els.canvas.height;
  if (!width || !height) return;
  const processor = framewiseDetectionProcessor();
  const diagnostics = processor.diagnostics();
  if (diagnostics.active || diagnostics.pending) return;
  const mediaTime = Number((sourceState.source as HTMLVideoElement).currentTime);
  const timestamp = Number.isFinite(mediaTime) ? mediaTime * 1000 : timeMs;
  const working = buildWrinkleWorkingFrame(els.canvas, width, height, LIVE_YOLO_INPUT_SIZE);
  if (!state.evidenceLines.length) updateStatus("live-detecting");
  processor.submit({
    generation: state.generation,
    sourceKind,
    timestamp,
    working,
    landmarks: landmarks.map((point) => [...point] as Vec3),
  });
}

export async function waitForLiveWrinkleAnalysis(): Promise<void> {
  await framewiseProcessor?.waitForIdle();
  await Promise.allSettled([...activeAnalyses]);
}

export async function applyWrinkleGuidedRefinement(): Promise<void> {
  if (sourceState.sourceKind !== "image" || state.status !== "detected"
      || !state.detectionId || !state.refinementContext || !state.standardLines) return;
  if (hasManualRefineChanges()) {
    updateWrinkleUi();
    return;
  }
  if (state.autoRefinedLines) {
    replaceStaticRefineBaseline(state.autoRefinedLines, { liveBaseline: state.standardLines });
    updateStatus("applied");
    countMetric("wrinkle.singleFrame.cachedRefinementApplied");
    window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
    return;
  }
  const generation = state.generation;
  const context = state.refinementContext;
  updateStatus("refining");
  try {
    const result = await wrinkleWorkerInstance().refine({
      detectionId: state.detectionId,
      seeds: context.seeds,
      size: context.working.size,
      faceWidthPx: context.faceWidthPx,
      landmarks: context.workLandmarks.map((point) => [
        point[0] / context.working.size,
        point[1] / context.working.size,
        point[2] / context.working.size,
      ]),
    });
    if (generation !== state.generation) return;
    const { refined } = result;
    assertRefinementGate(refined.diagnostics);
    if (refined.standardCurveCount !== state.standardLines.length
        || refined.curves.length < refined.standardCurveCount) {
      throw new Error("皱纹引导结果未保持 RSTL 曲线数量");
    }
    const autoRefinedLines = state.standardLines.map((line, index) => {
      const yoloScoped = refined.diagnostics.refinement_scope === YOLO_GUIDED_RSTL_SCOPE;
      if (yoloScoped && !isYoloGuidedRstlSeed(line)) {
        return {
          ...line,
          hiddenPointRuns: line.hiddenPointRuns.map((run) => [run[0], run[1]] as [number, number]),
          tris: [...line.tris],
          pts: line.pts.map((point) => [...point] as Vec3),
        };
      }
      const points = refined.curves[index]?.pts;
      if (!Array.isArray(points) || points.length !== line.pts.length) {
        throw new Error(`皱纹引导结果第 ${index + 1} 条曲线点数不一致`);
      }
      return {
        ...line,
        hiddenPointRuns: (refined.curves[index]?.hiddenPointRuns || [])
          .map((run) => [run[0], run[1]] as [number, number]),
        tris: [...line.tris],
        pts: points.map((point: number[], pointIndex: number) => {
          const [x, y] = fromWrinkleWorkingPoint(point, context.working);
          return [x, y, line.pts[pointIndex]?.[2] || 0] as Vec3;
        }),
      };
    });
    for (const curve of refined.curves.slice(refined.standardCurveCount)) {
      autoRefinedLines.push({
        name: curve.name,
        region: curve.region || "personalized_nose_dorsum_wrinkle_v1",
        symmetryRole: "",
        symmetryPairId: "",
        hidden: false,
        hiddenPointRuns: (curve.hiddenPointRuns || [])
          .map((run) => [run[0], run[1]] as [number, number]),
        tris: [],
        pts: curve.pts.map((point) => {
          const [x, y] = fromWrinkleWorkingPoint(point, context.working);
          return [x, y, 0] as Vec3;
        }),
      });
    }
    Object.assign(refined.diagnostics, { refinement_profile: result.refinementProfile });
    state.autoRefinedLines = autoRefinedLines;
    state.diagnostics = refined.diagnostics;
    state.audit = refined.audit;
    state.movedCurveCount = (Number(refined.diagnostics.moved_curve_count) || 0)
      + Number(refined.diagnostics.direct_nose_dorsum_generated_curve_count || 0);
    state.movedPointCount = Number(refined.diagnostics.moved_point_count) || 0;
    replaceStaticRefineBaseline(state.autoRefinedLines, { liveBaseline: state.standardLines });
    updateStatus("applied");
    countMetric("wrinkle.singleFrame.applied");
    window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
  } catch (error) {
    if (generation !== state.generation) return;
    const message = error instanceof Error ? error.message : "未知错误";
    logWarn("皱纹已检测，但自动微调未通过安全门禁。", error);
    countMetric("wrinkle.singleFrame.gateRejected");
    updateStatus("evidence", message);
  }
}

export function restoreStandardRstl(): void {
  if (!state.standardLines) return;
  replaceStaticRefineBaseline(state.standardLines);
  updateStatus(state.detectionId ? "detected" : "ready");
  countMetric("wrinkle.singleFrame.standardRestored");
}

export function resetLiveWrinkleAnalysis(): void {
  framewiseProcessor?.cancel();
  framewiseProcessor = null;
  temporalFramewiseStabilizer.reset();
  trackingGrayBuffer = undefined;
  skinTracker?.dispose();
  skinTracker = null;
  liveDetectionCount = 0;
  liveCorrectionAcceptedCount = 0;
  liveCorrectionRejectedCount = 0;
  liveCorrectionDiagnostics = null;
  lastLiveCorrectionMediaTime = Number.NaN;
  lastLiveDetectionAttemptMediaTime = Number.NaN;
  liveCorrectionInFlight = false;
  state.generation += 1;
  terminateWrinkleWorker();
  state.status = "idle";
  state.displayMode = isDynamicWrinkleSourceKind(sourceState.sourceKind) ? "wrinkles" : "both";
  state.evidenceLines = [];
  state.standardLines = null;
  state.autoRefinedLines = null;
  state.movedCurveCount = 0;
  state.movedPointCount = 0;
  state.fineLineCount = 0;
  state.sourceComponentCount = 0;
  state.evidenceSource = null;
  state.diagnostics = null;
  state.audit = null;
  state.timings = null;
  state.provider = null;
  state.reproducibility = null;
  state.detectionId = null;
  state.refinementContext = null;
  state.trackedLines = [];
  liveDisplayLines = [];
  ridgeSnapDiagnostics = null;
  liveDetectionInFlight = false;
  liveDetectionAttempted = false;
  state.error = null;
  updateWrinkleUi();
  publishDebugSnapshot();
}

export async function disposeLiveWrinkleAnalysis(): Promise<void> {
  resetLiveWrinkleAnalysis();
  const currentLandmarker = wrinkleFaceLandmarker;
  wrinkleFaceLandmarker = null;
  await Promise.allSettled([...activeAnalyses]);
  currentLandmarker?.close();
}
