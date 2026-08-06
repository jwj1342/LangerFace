import { els } from "./liveDom.ts";
import { mapAtlas, type MappedAtlasLine } from "./geometryAtlas.ts";
import { countMetric, logWarn } from "./logger.ts";
import {
  hasManualRefineChanges,
  replaceStaticRefineBaseline,
} from "./liveRefine2d.ts";
import { modelState, renderState, sourceState, type EditableRefineLine } from "./liveState.ts";
import { projectVerts } from "./projection3d.ts";
import type { Vec3 } from "./softBody.ts";
import {
  fromWrinkleWorkingPoint,
  toWrinkleWorkingPoint,
} from "./liveWrinkleMath.ts";
import {
  extractFineWrinkleLines,
  type FineWrinkleLine,
} from "./personalized/fineWrinkleLines.ts";
import { refineV6, V6_RSTL_ALGORITHM } from "./personalized/v6RstlRefinement.ts";
import {
  YoloWrinkleOnnx,
  YOLO_WRINKLE_CONFIDENCE,
} from "./personalized/yoloWrinkleOnnx.ts";

export type WrinkleDisplayMode = "rstl" | "wrinkles" | "both";
type AnalysisStatus =
  | "idle"
  | "loading"
  | "detecting"
  | "refining"
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
  error: null,
};

let yolo: YoloWrinkleOnnx | null = null;
const activeAnalyses = new Set<Promise<void>>();

const cloneMappedLines = (lines: readonly MappedAtlasLine[]): EditableRefineLine[] => (
  lines.map((line) => ({
    name: line.name || "unnamed_curve",
    region: line.region || "",
    symmetryRole: "",
    symmetryPairId: "",
    hidden: false,
    tris: [...(line.tris || [])],
    pts: line.pts.map((point) => [point[0], point[1], point[2] || 0] as Vec3),
  }))
);

function currentLandmarks(): Vec3[] | null {
  const landmarks = sourceState.sourceKind === "image"
    ? sourceState.imageCacheLM
    : sourceState.lastLM;
  return Array.isArray(landmarks) ? projectVerts(landmarks as Vec3[]) : null;
}

function currentPixelSource(): CanvasImageSource | null {
  if (sourceState.sourceKind === "image") return sourceState.source as CanvasImageSource | null;
  if (sourceState.paused) return sourceState.frozenFrame;
  return null;
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
  const maximum = Math.max(width, height);
  if (!(maximum > 0)) throw new Error("皱纹检测画面尺寸无效");
  const size = Math.max(4, Math.min(maximumSize, Math.round(maximum)));
  const scale = size / maximum;
  const targetWidth = width * scale;
  const targetHeight = height * scale;
  const offsetX = (size - targetWidth) / 2;
  const offsetY = (size - targetHeight) / 2;
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

function currentStandardLines(landmarks: Vec3[]): EditableRefineLine[] {
  const atlasLines = modelState.atlases.rstl;
  return cloneMappedLines(mapAtlas(atlasLines, landmarks, modelState.triangles as any[]));
}

function yoloInstance(): YoloWrinkleOnnx {
  yolo ||= new YoloWrinkleOnnx({ confidenceThreshold: YOLO_WRINKLE_CONFIDENCE });
  return yolo;
}

function v9Options(faceWidth: number) {
  return {
    exclusiveTrendMatching: true,
    oneToOneTrendCurveMatching: true,
    logicalTrendGrouping: true,
    softLinkDistancePx: faceWidth * 0.030,
    softLinkTurnDegrees: 18,
    softLinkTangentSpanPx: Math.round(faceWidth * 0.020),
    globalLengthAwareMatching: true,
    intervalAwareAnchorSharing: true,
    anchorIntervalPaddingPx: faceWidth * 0.010,
    adherenceRetryAttempts: 10,
    shortWrinkleQuantizationTolerance: true,
    shortWrinkleMaximumLengthRatio: 0.12,
    shortWrinkleP90TolerancePx: Math.max(0.5, faceWidth * 0.001),
    adherenceDirectionSoftDegrees: 25,
    adherenceDirectionHardDegrees: 40,
    topologyRetryAttempts: 3,
    postAdherenceGate: true,
    targetGapPx: Math.max(1.25, faceWidth * 0.0025),
    dataAttractionStrength: 20,
    wrinkleDominantCoreStrength: 0.95,
    wrinkleDominantCoreSupportRatio: 0.08,
    smoothingPasses: 12,
    transitionLengthPx: faceWidth * 0.010,
    p90LimitPx: faceWidth * 0.030,
    maxDisplacementPx: faceWidth * 0.045,
    maxCurvatureChangeDegrees: 60,
    bundlePropagation: true,
    bundleFollowerCountPerSide: 1,
    bundleFollowerStrength: 0.85,
    bundlePropagationRadiusPx: faceWidth * 0.050,
    bundleDirectionConflictDegrees: 25,
    bundleConflictDominanceRatio: 1.5,
    bundleDataAttractionStrength: 8,
    bundleSmoothingPasses: 16,
    bundleFollowerTopologyPriority: 0.25,
    bundleMinimumSpacingRatio: 0.65,
    bundleDenseFollowerRegion: "lateral_canthus_short_arc_v65",
    bundleDenseFollowerCountPerSide: 3,
  };
}

function assertRefinementGate(diagnostics: Record<string, any>): void {
  if (
    diagnostics.algorithm !== V6_RSTL_ALGORITHM
    || diagnostics.topology_contract_preserved !== true
    || diagnostics.post_export_new_intersection_pair_count !== 0
    || diagnostics.post_export_new_self_cross_curve_count !== 0
    || Number(diagnostics.bundle_minimum_spacing_ratio) < 0.65
  ) {
    throw new Error("皱纹引导结果未通过拓扑、交叉或线束间距门禁");
  }
}

function updateStatus(status: AnalysisStatus, error: string | null = null): void {
  state.status = status;
  state.error = error;
  updateWrinkleUi();
}

function statusLabel(): string {
  if (state.status === "loading") return "正在加载 YOLO 模型";
  if (state.status === "detecting") return "正在检测皱纹";
  if (state.status === "refining") return "正在计算自动微调";
  if (state.status === "ready") return "检测完成 · 待选择";
  if (state.status === "applied") return "已应用皱纹引导微调";
  if (state.status === "error") return "检测失败";
  return isWrinkleFrameReady() ? "等待自动检测" : "等待照片或定格帧";
}

export function updateWrinkleUi(): void {
  if (!els.wrinkleStatus) return;
  const frameReady = isWrinkleFrameReady();
  const analysisReady = state.status === "ready" || state.status === "applied";
  const busy = state.status === "loading" || state.status === "detecting" || state.status === "refining";
  els.wrinkleStatus.textContent = statusLabel();
  els.wrinkleDisplayMode.value = state.displayMode;
  els.wrinkleDisplayMode.disabled = !frameReady;
  els.wrinkleDetect.disabled = !frameReady || busy;
  els.wrinkleDetect.textContent = state.status === "error" ? "重试皱纹检测" : "重新检测皱纹";
  els.wrinkleAutoRefine.disabled = !analysisReady || hasManualRefineChanges() || state.status === "applied";
  els.wrinkleRestore.disabled = !state.standardLines
    || (state.status !== "applied" && !hasManualRefineChanges());
  if (state.status === "error") {
    els.wrinkleSummary.textContent = state.error || "请重试，或更换正面、清晰、光线均匀的照片。";
  } else if (analysisReady) {
    const moved = `自动识别 ${state.fineLineCount} 条细皱纹（${state.sourceComponentCount} 个候选区域），可引导调整 ${state.movedCurveCount} 条 RSTL / ${state.movedPointCount} 个点。`;
    els.wrinkleSummary.textContent = hasManualRefineChanges()
      ? `${moved} 已有医生手动修改，自动应用已锁定；可恢复后重新应用。`
      : moved;
  } else if (busy) {
    els.wrinkleSummary.textContent = "处理完全在当前浏览器中进行，不上传原始照片。";
  } else {
    els.wrinkleSummary.textContent = "标准 RSTL 会先显示，皱纹检测在后台完成。";
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

async function runCurrentWrinkleAnalysis({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (!isWrinkleFrameReady()) {
    updateWrinkleUi();
    return;
  }
  if (!force && state.status !== "idle" && state.status !== "error") return;
  const source = currentPixelSource();
  const landmarks = currentLandmarks();
  if (!source || !landmarks?.length) return;
  const generation = ++state.generation;
  state.evidenceLines = [];
  state.autoRefinedLines = null;
  state.standardLines = currentStandardLines(landmarks);
  state.movedCurveCount = 0;
  state.movedPointCount = 0;
  state.fineLineCount = 0;
  state.sourceComponentCount = 0;
  updateStatus("loading");
  try {
    const working = buildWrinkleWorkingFrame(source, els.canvas.width, els.canvas.height);
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
    const xs = workLandmarks.map((point) => point[0]);
    const faceWidth = Math.max(...xs) - Math.min(...xs);
    const model = yoloInstance();
    await model.load((progress) => {
      if (generation !== state.generation) return;
      const percent = Math.round(progress.loadedChunks / Math.max(1, progress.totalChunks) * 100);
      els.wrinkleSummary.textContent = `正在本机加载 YOLO 模型：${percent}%`;
    });
    if (generation !== state.generation) return;
    updateStatus("detecting");
    const detection = await model.detect(working.imageData, {
      confidenceThreshold: YOLO_WRINKLE_CONFIDENCE,
    });
    if (generation !== state.generation) return;
    const evidence = extractFineWrinkleLines(
      detection.classMasks,
      working.size,
      working.size,
      { minimumLineLengthPx: 20, resampleSpacingPx: 1, maximumSkeletonIterations: 96 },
    );
    if (!evidence.lines.length || !evidence.validation.passed) {
      throw new Error("未提取到通过质量门禁的细皱纹线");
    }
    updateStatus("refining");
    const refined = refineV6({
      seeds,
      wrinkleMask: evidence.mask,
      confidenceMap: evidence.confidence,
      directionQ: evidence.directionQ,
      size: working.size,
      faceWidthPx: faceWidth,
      options: v9Options(faceWidth),
    });
    if (generation !== state.generation) return;
    assertRefinementGate(refined.diagnostics);
    if (refined.curves.length !== state.standardLines.length) {
      throw new Error("皱纹引导结果未保持 RSTL 曲线数量");
    }
    state.evidenceLines = evidence.lines.map((line: FineWrinkleLine) => ({
      id: line.id,
      className: line.class,
      points: line.points.map((point) => fromWrinkleWorkingPoint(point, working)),
    }));
    state.autoRefinedLines = state.standardLines.map((line, index) => {
      const points = refined.curves[index]?.pts;
      if (!Array.isArray(points) || points.length !== line.pts.length) {
        throw new Error(`皱纹引导结果第 ${index + 1} 条曲线点数不一致`);
      }
      return {
        ...line,
        tris: [...line.tris],
        pts: points.map((point: number[], pointIndex: number) => {
          const [x, y] = fromWrinkleWorkingPoint(point, working);
          return [x, y, line.pts[pointIndex]?.[2] || 0] as Vec3;
        }),
      };
    });
    state.fineLineCount = evidence.summary.fineLineCount;
    state.sourceComponentCount = evidence.summary.sourceConnectedComponents;
    state.movedCurveCount = Number(refined.diagnostics.moved_curve_count) || 0;
    state.movedPointCount = Number(refined.diagnostics.moved_point_count) || 0;
    updateStatus("ready");
    countMetric("wrinkle.singleFrame.ready");
    window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
  } catch (error) {
    if (generation !== state.generation) return;
    const message = error instanceof Error ? error.message : "未知错误";
    logWarn("单帧皱纹检测或自动微调失败。", error);
    countMetric("wrinkle.singleFrame.failure");
    updateStatus("error", message);
  }
}

export function analyzeCurrentWrinkles(options: { force?: boolean } = {}): Promise<void> {
  const analysis = runCurrentWrinkleAnalysis(options);
  activeAnalyses.add(analysis);
  analysis.then(
    () => activeAnalyses.delete(analysis),
    () => activeAnalyses.delete(analysis),
  );
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
  state.status = "idle";
  state.evidenceLines = [];
  state.standardLines = null;
  state.autoRefinedLines = null;
  state.movedCurveCount = 0;
  state.movedPointCount = 0;
  state.fineLineCount = 0;
  state.sourceComponentCount = 0;
  state.error = null;
  updateWrinkleUi();
}

export async function disposeLiveWrinkleAnalysis(): Promise<void> {
  resetLiveWrinkleAnalysis();
  const current = yolo;
  yolo = null;
  await Promise.allSettled([...activeAnalyses]);
  await current?.close();
}
