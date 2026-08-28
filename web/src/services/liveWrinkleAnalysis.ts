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
import type { Vec3 } from "./softBody.ts";
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
  wrinkleV10ProcessingLocationLabel,
  type WrinkleV10ProviderCapability,
} from "./personalized/wrinkleV10Provider.ts";
import { RSTL_STANDARD_CONTRACT } from "./rstlStandardContract.ts";
import type { LiveWrinkleWorkerEvidence } from
  "../workers/liveWrinklePipelineWorkerContract.ts";
import type { LiveWrinkleWorkerTimings } from
  "../workers/liveWrinklePipelineWorkerContract.ts";

export type WrinkleDisplayMode = "rstl" | "wrinkles" | "both";
type AnalysisStatus =
  | "idle"
  | "loading"
  | "detecting"
  | "refining"
  | "evidence"
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
  evidenceSource: "paired-edge-v10-dynamic" | null;
  diagnostics: Record<string, any> | null;
  audit: Record<string, any> | null;
  timings: LiveWrinkleWorkerTimings | null;
  provider: WrinkleV10ProviderCapability | null;
  reproducibility: Record<string, unknown> | null;
  error: string | null;
}

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
  error: null,
};

let wrinkleWorker: LiveWrinklePipelineWorkerClient | null = null;
let wrinkleFaceLandmarker: FaceLandmarker | null = null;
const activeAnalyses = new Set<Promise<void>>();

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

function currentPixelSource(): CanvasImageSource | null {
  if (sourceState.sourceKind === "image") return sourceState.source as CanvasImageSource | null;
  if (sourceState.paused) return sourceState.frozenFrame;
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
  const frozenReady = (sourceState.sourceKind === "camera" || sourceState.sourceKind === "video")
    && sourceState.paused && Boolean(sourceState.frozenFrame) && Boolean(sourceState.lastLM);
  return sourceState.running && Boolean(imageReady || frozenReady);
}

export function buildWrinkleWorkingFrame(
  source: CanvasImageSource,
  width: number,
  height: number,
  maximumSize = 1280,
): WorkingFrame {
  const { size, scale, targetWidth, targetHeight, offsetX, offsetY } =
    wrinkleWorkingTransform(width, height, maximumSize);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
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
  if (state.status === "loading") return "正在准备最新检测流程";
  if (state.status === "detecting") return "正在检测皱纹";
  if (state.status === "refining") return "正在计算自动微调";
  if (state.status === "evidence") return "皱纹已检测 · 自动微调未通过门禁";
  if (state.status === "ready") return "检测完成 · 待选择";
  if (state.status === "applied") return "已应用皱纹引导微调";
  if (state.status === "error") return "检测失败";
  return isWrinkleFrameReady() ? "等待手动检测" : "等待照片或定格帧";
}

export function updateWrinkleUi(): void {
  if (!els.wrinkleStatus) return;
  const frameReady = isWrinkleFrameReady();
  const analysisReady = state.status === "ready" || state.status === "applied";
  const busy = state.status === "loading" || state.status === "detecting" || state.status === "refining";
  const processingLocation = wrinkleV10ProcessingLocationLabel(
    state.provider,
    window.location.hostname,
  );
  els.wrinkleStatus.textContent = statusLabel();
  els.wrinkleDisplayMode.value = state.displayMode;
  els.wrinkleDisplayMode.disabled = !frameReady;
  els.wrinkleDetect.disabled = !frameReady || busy;
  els.wrinkleDetect.textContent = state.status === "error"
    ? "重试皱纹检测"
    : state.status === "idle" ? "检测皱纹" : "重新检测皱纹";
  els.wrinkleAutoRefine.disabled = !analysisReady || hasManualRefineChanges() || state.status === "applied";
  els.wrinkleRestore.disabled = !state.standardLines
    || (state.status !== "applied" && !hasManualRefineChanges());
  if (state.status === "error") {
    els.wrinkleSummary.textContent = state.error || "请重试，或更换正面、清晰、光线均匀的照片。";
  } else if (state.status === "evidence") {
    els.wrinkleSummary.textContent = `已绘制 ${state.fineLineCount} 条细皱纹（${state.sourceComponentCount} 个候选区域）；${state.error || "自动微调未通过安全门禁"}，标准 RSTL 保持不变。`;
  } else if (analysisReady) {
    const evidenceVersion = "V10 四区域实时检测";
    const moved = `RSTL v${RSTL_STANDARD_CONTRACT.atlasVersion} · ${evidenceVersion} · V9 7.2 · ${processingLocation}；` +
      `识别 ${state.fineLineCount} 条细皱纹（${state.sourceComponentCount} 个候选区域），` +
      `可引导调整 ${state.movedCurveCount} 条 RSTL / ${state.movedPointCount} 个点。`;
    els.wrinkleSummary.textContent = hasManualRefineChanges()
      ? `${moved} 已有医生手动修改，自动应用已锁定；可恢复后重新应用。`
      : moved;
  } else if (busy) {
    els.wrinkleSummary.textContent = state.provider
      ? `正在${processingLocation}运行 V10 四区域检测。`
      : "正在检查 V10 检测服务和实际处理位置。";
  } else {
    els.wrinkleSummary.textContent = "标准 RSTL 已显示；点击“检测皱纹”后才会检查处理位置并启动 V10。";
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
  return state.evidenceLines;
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
  if (!isWrinkleFrameReady()) {
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
      state.evidenceSource = "paired-edge-v10-dynamic";
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
      updateStatus("refining");
    };
    const pipeline = await wrinkleWorkerInstance().analyze({
      imageData: working.imageData,
      seeds,
      size: working.size,
      faceWidthPx: faceWidth,
      landmarks: workLandmarks.map((point) => [
        point[0] / working.size,
        point[1] / working.size,
        point[2] / working.size,
      ]),
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
          : "四区域检测完成，正在运行 V9 7.2 微调……";
        return;
      }
      if (event.type === "evidence") return;
    });
    if (generation !== state.generation) return;
    pipelineCompleted = true;
    commitEvidence(pipeline.evidence);
    const { refined } = pipeline;
    assertRefinementGate(refined.diagnostics);
    if (refined.standardCurveCount !== state.standardLines.length
        || refined.curves.length < refined.standardCurveCount) {
      throw new Error("皱纹引导结果未保持 RSTL 曲线数量");
    }
    const autoRefinedLines = state.standardLines.map((line, index) => {
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
          const [x, y] = fromWrinkleWorkingPoint(point, working);
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
          const [x, y] = fromWrinkleWorkingPoint(point, working);
          return [x, y, 0] as Vec3;
        }),
      });
    }
    Object.assign(refined.diagnostics, {
      refinement_profile: LATEST_WRINKLE_REFINEMENT_PROFILE,
    });
    state.autoRefinedLines = autoRefinedLines;
    state.diagnostics = refined.diagnostics;
    state.audit = refined.audit;
    state.timings = pipeline.timings;
    state.provider = pipeline.provider;
    state.movedCurveCount = (Number(refined.diagnostics.moved_curve_count) || 0)
      + Number(refined.diagnostics.direct_nose_dorsum_generated_curve_count || 0);
    state.movedPointCount = Number(refined.diagnostics.moved_point_count) || 0;
    updateStatus("ready");
    countMetric("wrinkle.singleFrame.ready");
    window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
  } catch (error) {
    if (generation !== state.generation) return;
    const message = error instanceof Error ? error.message : "未知错误";
    if (state.evidenceLines.length > 0) {
      logWarn("皱纹已检测，但自动微调未通过安全门禁。", error);
      countMetric("wrinkle.singleFrame.gateRejected");
      updateStatus("evidence", message);
      window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
      return;
    }
    logWarn("单帧皱纹检测或自动微调失败。", error);
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

export function applyWrinkleGuidedRefinement(): void {
  if (!state.autoRefinedLines || (state.status !== "ready" && state.status !== "applied")) return;
  if (hasManualRefineChanges()) {
    updateWrinkleUi();
    return;
  }
  replaceStaticRefineBaseline(state.autoRefinedLines);
  updateStatus("applied");
  countMetric("wrinkle.singleFrame.applied");
}

export function restoreStandardRstl(): void {
  if (!state.standardLines) return;
  replaceStaticRefineBaseline(state.standardLines);
  updateStatus("ready");
  countMetric("wrinkle.singleFrame.standardRestored");
}

export function resetLiveWrinkleAnalysis(): void {
  state.generation += 1;
  terminateWrinkleWorker();
  state.status = "idle";
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
