import * as Comlink from "comlink";

import { toPixels } from "./geometryAtlas";
import { controlledMarkerFailureMessage, engineeringBlockMessage } from "./incisionClinicalCopy";
import { CONTROLLED_MARKER_DETECTOR_VERSION, detectControlledMarker } from "./controlledMarkerDetection";
import type { ControlledMarkerDetection } from "./controlledMarkerDetection";
import type { IncisionRuntimeState } from "./incisionControllerState";
import type { IncisionDomElements } from "./incisionDom";
import {
  confirmLesionDetectionDraft,
  normalizeLesionDetectionAdapter,
} from "./lesionDetectionAdapter";
import type { SurfaceRef } from "./incisionOverlay";
import {
  buildForeheadSurfaceLandmarks,
  incisionPhotoLayerContract,
  incisionPhotoSkinVisibility,
  incisionPhotoStatusPresentation,
  candidateEndpointSurfaceRefs,
  drawFusiformRenderMode,
  nearestPhotoEndpointHandle,
  pointsToSurfaceRefs,
  renderIncisionPhotoPlanning,
  surfaceRefToModelPoint,
  validateIncisionPhotoFile,
  type FusiformFitDiagnostics,
  type IncisionPhotoSmoothingMode,
  type PhotoReferenceAttemptDiagnostics,
  type SurfaceProjectedFusiformFit,
} from "./incisionPhotoPlanning";
import { incisionCandidateScreenStyle } from "./incisionOverlayStyle";
import { buildCandidateMetricPresentation } from "./incisionPresenter";
import { prepareImageSource } from "./imageSource";
import { modelState } from "./liveState";
import { sourcePointToSurfaceRef } from "./photoPlanningController";
import { ensureImageReady } from "./pipelineModels";
import { detectStaticImageWithRetries } from "./staticImageDetection";
import { shouldClearFreehandBoundaryOnLesionRepick } from "./tumorInput";
import {
  inspectTumorEngineeringExclusions,
  tumorPointEngineeringExclusionMessage,
} from "./incisionToolCore";
import { workflowPhotoSurfaceReferenceRecoveryEligible } from "./workflowControllerUtils";
import type { Triangle, Vec3 } from "./softBody";

interface IncisionPhotoRuntimeOptions {
  elements: IncisionDomElements;
  state: IncisionRuntimeState;
  clearTransientPlanning(): void;
  nearestVertex(point: unknown): number;
  setLesion(index: number, centerRef?: SurfaceRef | null): void;
  updateTumorRing(): void;
  runWorkflow(): void | Promise<void>;
  publishState(reason: string): void;
  dragEndpoint(point: [number, number, number], index: number): void;
  commitEndpointDrag(): void;
}

export interface IncisionPhotoRuntime {
  fit(): void;
  render(): void;
  setMode(active: boolean): void;
  resetView(): void;
  load(file?: File): Promise<void>;
  syncTumorKindGuard(kind?: "subcutaneous" | "cutaneous"): void;
  beginControlledMarkerDetection(): void;
  updateControlledMarkerScan(userAdjusted?: boolean): void;
  toggleControlledMarkerRepair(): void;
  undoControlledMarkerRepair(): void;
  clearControlledMarkerRepairStrokes(): void;
  beginControlledMarkerRepairStroke(event: PointerEvent): boolean;
  moveControlledMarkerRepairStroke(event: PointerEvent): void;
  endControlledMarkerRepairStroke(event: PointerEvent): void;
  cancelControlledMarkerRepairStroke(): void;
  moveControlledMarkerScan(event: PointerEvent): void;
  hideControlledMarkerScan(): void;
  pick(event: PointerEvent): void;
  endpointHandleFromEvent(event: PointerEvent): number | null;
  dragEndpoint(event: PointerEvent, index: number): void;
  commitEndpointDrag(): void;
  pan(deltaX: number, deltaY: number): void;
  zoom(event: WheelEvent): void;
  toggleMirror(): void;
  dispose(): void;
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

function localPhotoPixelsPerMm(
  point: { x: number; y: number },
  photoLandmarks: readonly Vec3[],
  triangles: readonly Triangle[],
  modelVertices: readonly Vec3[],
  unitsPerMm: number,
): number | null {
  if (!(unitsPerMm > 0)) return null;
  const ref = sourcePointToSurfaceRef(point, photoLandmarks, triangles);
  const triangle = ref ? triangles[ref.tri] : null;
  if (!triangle) return null;
  const ratios: number[] = [];
  for (const [firstIndex, secondIndex] of [[0, 1], [1, 2], [2, 0]] as const) {
    const firstPhoto = photoLandmarks[triangle[firstIndex]];
    const secondPhoto = photoLandmarks[triangle[secondIndex]];
    const firstModel = modelVertices[triangle[firstIndex]];
    const secondModel = modelVertices[triangle[secondIndex]];
    if (!firstPhoto || !secondPhoto || !firstModel || !secondModel) continue;
    const photoLength = Math.hypot(firstPhoto[0] - secondPhoto[0], firstPhoto[1] - secondPhoto[1]);
    const modelLength = Math.hypot(
      firstModel[0] - secondModel[0],
      firstModel[1] - secondModel[1],
      firstModel[2] - secondModel[2],
    );
    const physicalLengthMm = modelLength / unitsPerMm;
    if (photoLength > 0 && physicalLengthMm > 1e-6) ratios.push(photoLength / physicalLengthMm);
  }
  if (!ratios.length) return null;
  ratios.sort((first, second) => first - second);
  return ratios[Math.floor(ratios.length / 2)];
}

export function stablePhotoPixelsPerMm(
  photoLandmarks: readonly Vec3[],
  triangles: readonly Triangle[],
  modelVertices: readonly Vec3[],
  unitsPerMm: number,
): number | null {
  if (!(unitsPerMm > 0)) return null;
  const visitedEdges = new Set<string>();
  const ratios: number[] = [];
  for (const triangle of triangles) {
    for (const [firstIndex, secondIndex] of [[0, 1], [1, 2], [2, 0]] as const) {
      const firstVertexIndex = triangle[firstIndex];
      const secondVertexIndex = triangle[secondIndex];
      const edgeKey = firstVertexIndex < secondVertexIndex
        ? `${firstVertexIndex}:${secondVertexIndex}`
        : `${secondVertexIndex}:${firstVertexIndex}`;
      if (visitedEdges.has(edgeKey)) continue;
      visitedEdges.add(edgeKey);
      const firstPhoto = photoLandmarks[firstVertexIndex];
      const secondPhoto = photoLandmarks[secondVertexIndex];
      const firstModel = modelVertices[firstVertexIndex];
      const secondModel = modelVertices[secondVertexIndex];
      if (!firstPhoto || !secondPhoto || !firstModel || !secondModel) continue;
      const photoLength = Math.hypot(firstPhoto[0] - secondPhoto[0], firstPhoto[1] - secondPhoto[1]);
      const modelLength = Math.hypot(
        firstModel[0] - secondModel[0],
        firstModel[1] - secondModel[1],
        firstModel[2] - secondModel[2],
      );
      const physicalLengthMm = modelLength / unitsPerMm;
      const ratio = photoLength / Math.max(physicalLengthMm, 1e-9);
      if (photoLength > 0 && physicalLengthMm > 1e-6 && Number.isFinite(ratio)) ratios.push(ratio);
    }
  }
  if (!ratios.length) return null;
  ratios.sort((first, second) => first - second);
  // A face-wide upper quantile avoids the triangle-boundary size jumps of the
  // old pointer-local scale without shrinking the scan ROI below most facial
  // regions. It remains fixed for the current photo revision.
  return ratios[Math.floor((ratios.length - 1) * 0.8)];
}

const stripTerminalPunctuation = (value: string): string => value.trim().replace(/[。；;，,：:\s]+$/u, "");

function referenceAttemptFailureDetail(attempts: readonly PhotoReferenceAttemptDiagnostics[]): string {
  if (!attempts.length) {
    return "受限比例计算未能开始，因为原候选缺少可用的照片映射端点";
  }
  const detail = attempts.map((attempt) => {
    const ratio = attempt.aspectRatio.toFixed(2);
    if (attempt.ok) return `${ratio}:1 已通过`;
    if (attempt.reason === "photo_boundary_not_enclosed") {
      return `${ratio}:1 仍有 ${attempt.boundaryOutsideCount} 个肿物边界采样点未被包裹`;
    }
    if (attempt.reason === "photo_surface_exit") {
      return `${ratio}:1 仍有 ${attempt.surfaceOutsideCount} 个切口采样点超出可用面部区域`;
    }
    if (attempt.reason === "center_shift_exceeded") return `${ratio}:1 的中心偏移超过限制`;
    if (attempt.reason === "corridor_exceeded" || attempt.reason === "envelope_exceeded") {
      return `${ratio}:1 的轮廓平滑约束未通过`;
    }
    return `${ratio}:1 的照片映射或候选采样无效`;
  });
  return `已依次尝试 ${detail.join("；")}`;
}

export function photoProjectionFailureDetail(
  diagnostics: FusiformFitDiagnostics | null | undefined,
  attempts: readonly PhotoReferenceAttemptDiagnostics[],
): string {
  const ratio = Number(diagnostics?.photoCanonicalStandardAspectRatio || 3).toFixed(2);
  const standard = diagnostics?.reason === "photo_surface_exit"
    ? `标准 ${ratio}:1 方案有 ${Number(diagnostics.photoSurfaceOutsideCount || 0)} 个切口采样点超出当前照片可用面部区域`
    : diagnostics?.reason === "photo_boundary_not_enclosed"
      ? `标准 ${ratio}:1 方案仍有 ${Number(diagnostics.photoBoundaryOutsideCount || 0)} 个肿物边界采样点未被完整包裹`
      : diagnostics?.reason === "center_shift_exceeded"
        ? `标准 ${ratio}:1 方案的中心偏移超过限制`
        : diagnostics?.reason === "corridor_exceeded" || diagnostics?.reason === "envelope_exceeded"
          ? `标准 ${ratio}:1 方案的轮廓平滑约束未通过`
          : `标准 ${ratio}:1 方案未通过照片映射、中心方向或梭形几何检查`;
  return attempts.length ? `${standard}；${referenceAttemptFailureDetail(attempts)}` : standard;
}

interface ControlledMarkerRepairStroke {
  points: { x: number; y: number }[];
  widthPx: number;
}

interface ControlledMarkerRepairContext {
  seed: { x: number; y: number };
  sourceRevision: number;
  pixelsPerMm: number;
}

function controlledMarkerFingerprint(detection: ControlledMarkerDetection): string {
  const bbox = detection.bbox;
  if (!bbox || !detection.boundary.length) return "unavailable";
  let hash = 2166136261;
  for (const point of detection.boundary) {
    const normalizedX = Math.round((point.x - bbox.x) / Math.max(1, bbox.width) * 255);
    const normalizedY = Math.round((point.y - bbox.y) / Math.max(1, bbox.height) * 255);
    for (const value of [normalizedX, normalizedY]) {
      hash ^= value & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return `cm-${bbox.width}x${bbox.height}-${detection.area_px}-${hash.toString(16).padStart(8, "0")}`;
}

function controlledMarkerPlanningAudit(
  detection: ControlledMarkerDetection,
  result: Record<string, any> | null | undefined,
  projection: { valid: boolean; reasonCodes: string[] },
): Record<string, unknown> {
  const normalization = result?.tumor_normalization || {};
  const direction = result?.direction || {};
  const candidate = result?.candidate || {};
  return {
    detector_version: CONTROLLED_MARKER_DETECTOR_VERSION,
    marker: {
      fingerprint: controlledMarkerFingerprint(detection),
      geometry_mode: detection.geometry_mode,
      area_px: detection.area_px,
      bbox_size_px: detection.bbox ? [detection.bbox.width, detection.bbox.height] : null,
      boundary_point_count: detection.boundary.length,
      scan: detection.scan ?? null,
      repair_radius: detection.diagnostics?.repair_radius ?? 0,
      warnings: detection.warnings,
    },
    normalization: {
      status: normalization.status ?? null,
      planning_diameter_mm: normalization.planning_diameter_mm ?? null,
      detected_enclosing_diameter_mm: normalization.detected_enclosing_diameter_mm ?? null,
      detected_center_shift_mm: normalization.detected_center_shift_mm ?? null,
    },
    direction: {
      line_id: direction.line_id ?? null,
      line_index: direction.line_index ?? null,
      segment_index: direction.segment_index ?? null,
      angle_deg: direction.angle_deg ?? null,
      confidence: direction.confidence ?? null,
    },
    candidate: {
      type: candidate.type ?? null,
      length_mm: candidate.length_mm ?? null,
      width_mm: candidate.width_mm ?? null,
      axis: Array.isArray(candidate.axis) ? candidate.axis.map((value: number) => Number(value.toFixed(6))) : null,
      display_blocked: result?.candidate_display_blocked === true,
    },
    photo_projection: projection,
    raw_media_retained: false,
  };
}

export function createIncisionPhotoRuntime(options: IncisionPhotoRuntimeOptions): IncisionPhotoRuntime {
  const {
    elements,
    state,
    clearTransientPlanning,
    nearestVertex,
    setLesion,
    updateTumorRing,
    runWorkflow,
    publishState,
    dragEndpoint,
    commitEndpointDrag,
  } = options;
  let disposed = false;
  let controlledMarkerSeedMode = false;
  let controlledMarkerBusy = false;
  let controlledMarkerRequestId = 0;
  let controlledMarkerScanUserAdjusted = false;
  let controlledMarkerPointer: { x: number; y: number } | null = null;
  let controlledMarkerScale: { sourceRevision: number; pixelsPerMm: number } | null = null;
  let currentPhotoFileName = "";
  let controlledMarkerRepairAvailable = false;
  let controlledMarkerRepairMode = false;
  let controlledMarkerRepairContext: ControlledMarkerRepairContext | null = null;
  let controlledMarkerRepairStrokes: ControlledMarkerRepairStroke[] = [];
  let controlledMarkerRepairDrawing: ControlledMarkerRepairStroke | null = null;
  let controlledMarkerRepairOverlayVisible = false;
  let candidatePhotoProjectionValid = false;
  let projectedCandidate: unknown = null;
  let latestPhotoEndpointSources: { x: number; y: number }[] = [];
  let latestCandidateOverlay: {
    candidate: Vec3[];
    fit: SurfaceProjectedFusiformFit | null;
    candidateType: string;
    valid: boolean;
  } = { candidate: [], fit: null, candidateType: "", valid: false };
  let latestCandidateProjection = {
    valid: false,
    reasonCodes: [] as string[],
    surfaceConstrained: false,
    sourceReasonCodes: [] as string[],
    smoothingMode: "notApplicable" as IncisionPhotoSmoothingMode,
    smoothingDiagnostics: null as FusiformFitDiagnostics | null,
    referenceAspectRatio: null as number | null,
    referenceLengthScale: null as number | null,
    referenceAttempts: [] as PhotoReferenceAttemptDiagnostics[],
    visibilityLimited: false,
    visibleFraction: null as number | null,
    hiddenPointCount: 0,
  };

  const isCutaneousTumor = (kind?: "subcutaneous" | "cutaneous") => (
    kind ? kind === "cutaneous" : elements.tumorKind.value === "cutaneous"
  );
  const subcutaneousControlledMarkerMessage =
    "受控标记仅适用于皮表肿物；皮下肿物按术前测量直径与 RSTL 方向规划。";

  const updatePhotoUploadTitle = (fileName = currentPhotoFileName) => {
    currentPhotoFileName = fileName;
    elements.photoUploadLabel.title = `上传患者静态照片\n当前已上传照片：${fileName || "无"}`;
  };

  const setControlledMarkerActionState = (
    active: boolean,
    kind?: "subcutaneous" | "cutaneous",
  ) => {
    const cutaneous = isCutaneousTumor(kind);
    elements.controlledMarkerDetect.setAttribute("aria-pressed", String(active));
    elements.controlledMarkerDetect.disabled = !state.photoView.active || !cutaneous;
    elements.controlledMarkerDetect.title = !cutaneous
      ? subcutaneousControlledMarkerMessage
      : active
        ? "退出受控标记模式"
        : "在照片上点击黑点、贴纸或手绘标记";
    const label = elements.controlledMarkerDetect.querySelector<HTMLElement>("[data-marker-action-label]");
    if (label) label.textContent = active ? "退出标记" : "受控标记";
    elements.photoCanvas.dataset.controlledMarker = String(active);
    elements.controlledMarkerScanControl.hidden = !active;
    if (!active) elements.controlledMarkerScanOverlay.hidden = true;
  };

  const syncControlledMarkerRepairControls = (kind?: "subcutaneous" | "cutaneous") => {
    const cutaneous = isCutaneousTumor(kind);
    elements.controlledMarkerRepair.hidden = false;
    elements.controlledMarkerRepairUndo.hidden = false;
    elements.controlledMarkerRepairClear.hidden = false;
    elements.controlledMarkerRepair.setAttribute("aria-pressed", String(controlledMarkerRepairMode));
    const label = elements.controlledMarkerRepair.querySelector<HTMLElement>("[data-marker-repair-label]");
    if (label) label.textContent = controlledMarkerRepairMode ? "结束补线" : "补线";
    elements.controlledMarkerRepair.title = controlledMarkerRepairMode
      ? "结束人工补线，保留当前补线结果"
      : "补充照片中可见但不连续的肿物边缘";
    elements.controlledMarkerRepair.disabled = !cutaneous || controlledMarkerBusy
      || !controlledMarkerRepairAvailable || !controlledMarkerRepairContext;
    elements.controlledMarkerRepairUndo.disabled = !cutaneous
      || controlledMarkerBusy || controlledMarkerRepairStrokes.length === 0;
    elements.controlledMarkerRepairClear.disabled = !cutaneous
      || controlledMarkerBusy || controlledMarkerRepairStrokes.length === 0;
    elements.photoCanvas.dataset.controlledMarkerRepair = String(controlledMarkerRepairMode);
    if (controlledMarkerSeedMode) elements.controlledMarkerScanControl.hidden = controlledMarkerRepairMode;
  };

  const restartAttentionAnimation = (element: HTMLElement) => {
    element.classList.remove("controlled-marker-recovery-attention");
    void element.offsetWidth;
    element.classList.add("controlled-marker-recovery-attention");
    element.addEventListener("animationend", () => {
      element.classList.remove("controlled-marker-recovery-attention");
    }, { once: true });
  };

  const promptControlledMarkerRecovery = () => {
    restartAttentionAnimation(elements.controlledMarkerScanControl);
    restartAttentionAnimation(elements.controlledMarkerRepair);
  };

  const clearControlledMarkerRepair = ({
    keepContext = false,
    kind,
  }: {
    keepContext?: boolean;
    kind?: "subcutaneous" | "cutaneous";
  } = {}) => {
    controlledMarkerRepairAvailable = false;
    controlledMarkerRepairMode = false;
    controlledMarkerRepairDrawing = null;
    controlledMarkerRepairStrokes = [];
    controlledMarkerRepairOverlayVisible = false;
    if (!keepContext) controlledMarkerRepairContext = null;
    syncControlledMarkerRepairControls(kind);
  };

  const controlledMarkerFailureCanBeRepaired = (detection: ControlledMarkerDetection) => {
    if (["scan_range_too_small", "edge_discontinuous", "unstable_enclosure"]
      .includes(String(detection.failure_code))) {
      return true;
    }
    const stage = String(detection.diagnostics?.failure_stage || "");
    return detection.failure_code === "seed_not_enclosed" && [
      "seed_region_leaks_to_roi_border",
      "boundary_support_low",
      "boundary_support_missing",
      "radial_boundary_incomplete",
      "radial_boundary_requires_endpoint_confirmation",
    ].includes(stage);
  };

  const recommendedScanDiameterMm = () => {
    const lesionDiameterMm = Math.max(0, Number(elements.diameter.value) || 0);
    return clamp(Math.ceil(Math.max(10, lesionDiameterMm * 1.5) / 5) * 5, 10, 60);
  };

  const controlledMarkerScanDiameterMm = () => {
    const rawDiameterMm = Number(elements.controlledMarkerScanDiameter.value);
    return clamp(Number.isFinite(rawDiameterMm) ? rawDiameterMm : recommendedScanDiameterMm(), 10, 60);
  };

  const syncControlledMarkerScanControl = (useRecommendation: boolean) => {
    if (useRecommendation && !controlledMarkerScanUserAdjusted) {
      elements.controlledMarkerScanDiameter.value = String(recommendedScanDiameterMm());
    }
    const diameterMm = controlledMarkerScanDiameterMm();
    elements.controlledMarkerScanDiameter.value = String(diameterMm);
    elements.controlledMarkerScanValue.textContent = `${diameterMm} mm`;
    elements.controlledMarkerScanOverlayLabel.textContent = `扫描 ${diameterMm} mm`;
    const presentationProgress = diameterMm / 60;
    elements.controlledMarkerScanDiameter.style.setProperty("--scan-progress", `${presentationProgress * 100}%`);
    // A native range keeps the thumb centre inset by half its diameter. Offset
    // the 14 px thumb so the visual centre follows the full 0-60 presentation
    // track: 10 mm is 1/6 and 60 mm is exactly the right-hand endpoint.
    elements.controlledMarkerScanDiameter.style.setProperty(
      "--scan-thumb-offset",
      `${7 * (2 * presentationProgress - 1)}px`,
    );
  };

  const controlledMarkerPixelsPerMm = (frame: ReturnType<NonNullable<typeof state.planning2d>["getFrameState"]>) => {
    if (controlledMarkerScale?.sourceRevision === frame.revision) return controlledMarkerScale.pixelsPerMm;
    const projectionLandmarks = frame.surfaceLandmarks || frame.landmarks;
    if (!projectionLandmarks?.length) return null;
    const pixelsPerMm = stablePhotoPixelsPerMm(
      projectionLandmarks,
      frame.triangles,
      state.verts,
      state.unitsPerMm,
    );
    if (!(pixelsPerMm && pixelsPerMm > 0)) return null;
    controlledMarkerScale = { sourceRevision: frame.revision, pixelsPerMm };
    return pixelsPerMm;
  };

  const positionControlledMarkerScan = (clientPoint: { x: number; y: number } | null) => {
    controlledMarkerPointer = clientPoint;
    if (!controlledMarkerSeedMode || controlledMarkerRepairMode || !clientPoint) {
      elements.controlledMarkerScanOverlay.hidden = true;
      return;
    }
    const sourcePoint = state.planning2d?.clientToSource(clientPoint);
    const frame = state.planning2d?.getFrameState();
    const projectionLandmarks = frame?.surfaceLandmarks || frame?.landmarks;
    if (!sourcePoint || !frame?.source || !projectionLandmarks?.length) {
      elements.controlledMarkerScanOverlay.hidden = true;
      return;
    }
    const pixelsPerMm = controlledMarkerPixelsPerMm(frame)
      || localPhotoPixelsPerMm(sourcePoint, projectionLandmarks, frame.triangles, state.verts, state.unitsPerMm);
    if (!(pixelsPerMm && pixelsPerMm > 0)) {
      elements.controlledMarkerScanOverlay.hidden = true;
      return;
    }
    const photoRect = elements.photoCanvas.getBoundingClientRect();
    const wrapRect = elements.wrap.getBoundingClientRect();
    const sourceDiameterPx = controlledMarkerScanDiameterMm() * pixelsPerMm;
    const displayDiameterPx = sourceDiameterPx * photoRect.width / Math.max(1, frame.width);
    elements.controlledMarkerScanOverlay.style.left = `${clientPoint.x - wrapRect.left}px`;
    elements.controlledMarkerScanOverlay.style.top = `${clientPoint.y - wrapRect.top}px`;
    elements.controlledMarkerScanOverlay.style.width = `${displayDiameterPx}px`;
    elements.controlledMarkerScanOverlay.style.height = `${displayDiameterPx}px`;
    elements.controlledMarkerScanOverlay.hidden = false;
  };

  const setControlledMarkerBusy = (busy: boolean) => {
    controlledMarkerBusy = busy;
    elements.photoCanvas.setAttribute("aria-busy", String(busy));
    elements.controlledMarkerDetect.setAttribute("aria-busy", String(busy));
    syncControlledMarkerRepairControls();
  };

  const resetControlledMarker = ({
    restoreSelection = false,
    kind,
  }: {
    restoreSelection?: boolean;
    kind?: "subcutaneous" | "cutaneous";
  } = {}) => {
    controlledMarkerRequestId += 1;
    setControlledMarkerBusy(false);
    controlledMarkerSeedMode = false;
    clearControlledMarkerRepair({ kind });
    setControlledMarkerActionState(false, kind);
    controlledMarkerPointer = null;
    if (restoreSelection) {
      state.planning2d?.setSelection({ centerRef: state.lesionRef, boundaryRefs: state.boundaryRefs });
    }
  };

  const updateEndpointHandles = () => {
    const wrapRect = elements.wrap.getBoundingClientRect();
    const points = state.result?.candidate_display_blocked
      || !candidatePhotoProjectionValid
      || projectedCandidate !== state.result?.candidate
      ? []
      : latestPhotoEndpointSources.map((point) => state.planning2d?.sourceToClient(point) || null);
    elements.photoEndpointHandles.forEach((handle, index) => {
      const point = state.photoView.active ? points[index] : null;
      handle.hidden = !point;
      if (!point) return;
      handle.style.left = `${point.x - wrapRect.left}px`;
      handle.style.top = `${point.y - wrapRect.top}px`;
    });
  };

  const renderCandidateOverlay = () => {
    const canvas = elements.photoCandidateCanvas;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = elements.wrap.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const backingWidth = Math.max(1, Math.round(rect.width * dpr));
    const backingHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    if (!state.photoView.active || !state.planning2d) return;

    if (latestCandidateOverlay.valid && latestCandidateOverlay.candidate.length >= 2) {
      const mapPoint = (point: Vec3): Vec3 | null => {
        const mapped = state.planning2d?.sourceToClient({ x: point[0], y: point[1] });
        return mapped ? [mapped.x - rect.left, mapped.y - rect.top, point[2]] : null;
      };
      const candidate = latestCandidateOverlay.candidate.map(mapPoint);
      if (!candidate.some((point) => point === null)) {
        const mappedCandidate = candidate as Vec3[];
        const sourceFit = latestCandidateOverlay.fit;
        let mappedFit: SurfaceProjectedFusiformFit | null = null;
        if (sourceFit) {
          const upperCurve = sourceFit.upperCurve.map(mapPoint);
          const lowerCurve = sourceFit.lowerCurve.map(mapPoint);
          const upperCurves = sourceFit.upperCurves.map((curve) => curve.map(mapPoint));
          const lowerCurves = sourceFit.lowerCurves.map((curve) => curve.map(mapPoint));
          const sourceOutline = sourceFit.sourceOutline.map(mapPoint);
          const outline = sourceFit.outline.map(mapPoint);
          const visibleSegments = sourceFit.visibleSegments?.map((segment) => segment.map(mapPoint));
          const allCurvePoints = [...upperCurves.flat(), ...lowerCurves.flat()];
          if (![...upperCurve, ...lowerCurve, ...allCurvePoints, ...sourceOutline, ...outline]
            .concat(visibleSegments?.flat() || [])
            .some((point) => point === null)) {
            mappedFit = {
              ...sourceFit,
              upperCurve: upperCurve as SurfaceProjectedFusiformFit["upperCurve"],
              lowerCurve: lowerCurve as SurfaceProjectedFusiformFit["lowerCurve"],
              upperCurves: upperCurves as SurfaceProjectedFusiformFit["upperCurves"],
              lowerCurves: lowerCurves as SurfaceProjectedFusiformFit["lowerCurves"],
              sourceOutline: sourceOutline as Vec3[],
              outline: outline as Vec3[],
              visibleSegments: visibleSegments as Vec3[][] | undefined,
            };
          }
        }
        const style = incisionCandidateScreenStyle(latestCandidateOverlay.candidateType);
        if (latestCandidateOverlay.candidateType === "fusiform") {
          drawFusiformRenderMode(
            context,
            mappedCandidate,
            mappedFit,
            mappedFit
              ? mappedFit.strategy === "segmented_c1" ? "segmentedBezierDirect" : "globalBezierDirect"
              : "raw",
            style.color,
            style.lineWidth,
          );
        } else {
          context.beginPath();
          context.moveTo(mappedCandidate[0][0], mappedCandidate[0][1]);
          mappedCandidate.slice(1).forEach((point) => context.lineTo(point[0], point[1]));
          context.lineCap = "round";
          context.lineJoin = "round";
          context.strokeStyle = style.haloColor;
          context.lineWidth = style.haloWidth;
          context.stroke();
          context.strokeStyle = style.color;
          context.lineWidth = style.lineWidth;
          context.stroke();
        }
      }
    }

    const repairStrokes = controlledMarkerRepairOverlayVisible
      ? controlledMarkerRepairDrawing
        ? [...controlledMarkerRepairStrokes, controlledMarkerRepairDrawing]
        : controlledMarkerRepairStrokes
      : [];
    for (const stroke of repairStrokes) {
      const points = stroke.points
        .map((point) => state.planning2d?.sourceToClient(point) || null)
        .filter((point): point is { x: number; y: number } => point !== null);
      if (!points.length) continue;
      const frame = state.planning2d.getFrameState();
      const firstSource = stroke.points[0];
      const nextSource = { x: firstSource.x + stroke.widthPx, y: firstSource.y };
      const firstClient = state.planning2d.sourceToClient(firstSource);
      const nextClient = state.planning2d.sourceToClient(nextSource);
      const analysisDisplayWidth = firstClient && nextClient
        ? clamp(Math.hypot(nextClient.x - firstClient.x, nextClient.y - firstClient.y), 2, 16)
        : clamp(stroke.widthPx * rect.width / Math.max(1, frame.width), 2, 16);
      const displayWidth = analysisDisplayWidth * 0.25;
      context.beginPath();
      context.moveTo(points[0].x - rect.left, points[0].y - rect.top);
      points.slice(1).forEach((point) => context.lineTo(point.x - rect.left, point.y - rect.top));
      if (points.length === 1) {
        context.lineTo(points[0].x - rect.left + 0.01, points[0].y - rect.top + 0.01);
      }
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "rgba(7, 10, 15, 0.9)";
      context.lineWidth = displayWidth + 0.75;
      context.stroke();
      context.strokeStyle = "#22d3ee";
      context.lineWidth = displayWidth;
      context.stroke();
    }
  };

  const enforceControlledMarkerTumorKind = ({
    announce = true,
    kind,
  }: {
    announce?: boolean;
    kind?: "subcutaneous" | "cutaneous";
  } = {}) => {
    if (isCutaneousTumor(kind)) {
      setControlledMarkerActionState(controlledMarkerSeedMode, kind);
      syncControlledMarkerRepairControls(kind);
      return false;
    }
    const hadActiveMode = controlledMarkerSeedMode
      || controlledMarkerRepairMode
      || controlledMarkerRepairStrokes.length > 0;
    if (hadActiveMode) resetControlledMarker({ restoreSelection: true, kind });
    else {
      setControlledMarkerActionState(false, kind);
      clearControlledMarkerRepair({ kind });
    }
    if (announce) {
      setStatus(subcutaneousControlledMarkerMessage, "warning");
      publishState(hadActiveMode
        ? "subcutaneous_controlled_marker_cancelled"
        : "subcutaneous_controlled_marker_blocked");
    }
    return true;
  };

  const setStatus = (message: string, tone: "idle" | "loading" | "ready" | "warning" = "idle") => {
    elements.photoStatus.textContent = message;
    elements.photoStatus.dataset.tone = tone;
  };

  const setStageStatus = (message: string, tone: "normal" | "warning" = "normal") => {
    elements.stageStatus.textContent = message;
    elements.stageStatus.dataset.tone = tone;
  };

  const keepControlledMarkerRetry = (message: string) => {
    controlledMarkerSeedMode = true;
    candidatePhotoProjectionValid = false;
    projectedCandidate = null;
    latestCandidateOverlay.valid = false;
    setControlledMarkerActionState(true);
    updateEndpointHandles();
    renderCandidateOverlay();
    if (message) setStatus(message, "warning");
  };

  const fit = () => {
    if (!state.photoView.active || !state.planning2d) return;
    const frame = state.planning2d.getFrameState();
    if (!frame.source || !frame.width || !frame.height) return;
    const rect = elements.wrap.getBoundingClientRect();
    const transform = state.planning2d.setView({
      viewportLeft: rect.left,
      viewportTop: rect.top,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      canvasWidth: elements.photoCanvas.width,
      canvasHeight: elements.photoCanvas.height,
      zoom: state.photoView.zoom,
      offsetX: state.photoView.offsetX,
      offsetY: state.photoView.offsetY,
      mirror: state.photoView.mirror,
      devicePixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
    });
    if (!transform) return;
    elements.photoCanvas.style.width = `${Math.round(transform.baseWidth)}px`;
    elements.photoCanvas.style.height = `${Math.round(transform.baseHeight)}px`;
    elements.photoCanvas.style.setProperty("--incision-photo-zoom", `${state.photoView.zoom}`);
    elements.photoCanvas.style.setProperty("--incision-photo-pan-x", `${Math.round(state.photoView.offsetX)}px`);
    elements.photoCanvas.style.setProperty("--incision-photo-pan-y", `${Math.round(state.photoView.offsetY)}px`);
    elements.photoCanvas.style.setProperty("--incision-photo-mirror", state.photoView.mirror ? "-1" : "1");
    updateEndpointHandles();
    renderCandidateOverlay();
    positionControlledMarkerScan(controlledMarkerPointer);
  };

  const render = () => {
    if (!state.photoView.active || !state.planning2d || !state.atlas) return;
    const frame = state.planning2d.getFrameState();
    if (!frame.source || !frame.landmarks?.length) return;
    const context = elements.photoCanvas.getContext("2d");
    if (!context) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    elements.photoCanvas.width = Math.max(1, Math.round(frame.width * dpr));
    elements.photoCanvas.height = Math.max(1, Math.round(frame.height * dpr));
    const viewport = elements.wrap.getBoundingClientRect();
    const containScale = Math.min(
      viewport.width / Math.max(1, frame.width),
      viewport.height / Math.max(1, frame.height),
    );
    const displayScale = containScale > 0 ? containScale * state.photoView.zoom : undefined;
    const candidateDisplayBlocked = Boolean(state.result?.candidate_display_blocked);
    const surfaceReferenceRecoveryEligible = workflowPhotoSurfaceReferenceRecoveryEligible(state.result);
    const candidatePoints = state.result?.candidate?.polyline || [];
    const candidateRefs = candidateDisplayBlocked && !surfaceReferenceRecoveryEligible
      ? []
      : pointsToSurfaceRefs(candidatePoints, state.verts, state.tris);
    const endpointRefs = candidateEndpointSurfaceRefs(
      candidatePoints,
      candidateRefs,
      state.result?.candidate?.endpoints || [],
      state.verts,
      state.tris,
    );
    const layerContract = incisionPhotoLayerContract(
      elements.tumorKind.value,
      state.result?.candidate?.type,
    );
    const photoPixelsPerMm = layerContract.showDiameterEstimate
      ? controlledMarkerPixelsPerMm(frame)
      : null;
    const geometry = renderIncisionPhotoPlanning({
      context,
      source: frame.source as CanvasImageSource,
      sourceWidth: frame.width,
      sourceHeight: frame.height,
      devicePixelRatio: dpr,
      displayScale,
      landmarks: [...frame.landmarks],
      surfaceLandmarks: frame.surfaceLandmarks ? [...frame.surfaceLandmarks] : [...frame.landmarks],
      triangles: state.tris,
      atlasLines: state.atlas.lines || [],
      centerRef: state.lesionRef,
      diameterEstimateRefs: [],
      photoDiameterEstimateMm: layerContract.showDiameterEstimate
        ? Number(elements.diameter.value)
        : undefined,
      photoPixelsPerMm: photoPixelsPerMm || undefined,
      boundaryRefs: frame.selection.boundaryRefs,
      candidateRefs,
      endpointRefs: candidateDisplayBlocked && !surfaceReferenceRecoveryEligible ? [] : endpointRefs,
      tumorInputInvalid: state.result?.tumor_engineering_validation?.passed === false,
      candidateType: state.result?.candidate?.type,
      candidateAspectRatio: state.result?.candidate?.type === "fusiform"
        ? Number(state.result.candidate.length_mm) / Math.max(1e-9, Number(state.result.candidate.width_mm))
        : undefined,
      candidateAxisCoverageRatio: state.result?.candidate?.type === "fusiform"
        ? Number(state.result.candidate.metrics?.axis_coverage_required_mm || 0)
          / Math.max(1e-9, Number(state.result.candidate.length_mm))
        : undefined,
      candidateTipAngleDeg: state.result?.candidate?.type === "fusiform"
        ? Number(state.result.candidate.tip_angle_deg)
        : undefined,
      drawCandidate: false,
    });
    state.planning2d.setOverlaySummary({
      rstlLineCount: geometry.rstl.length,
      tumorVisible: geometry.center !== null,
      candidatePointCount: geometry.candidateProjection.valid ? geometry.candidate.length : 0,
    });
    if (state.result?.candidate?.metrics) {
      state.result.candidate.metrics.photo_lesion_to_planning_center_px = geometry.lesionToPlanningCenterPx;
      state.result.candidate.metrics.photo_geometry_mode = geometry.candidateProjection.smoothingMode;
      state.result.candidate.metrics.photo_canonical_scale = geometry.candidateProjection.smoothingDiagnostics?.photoCanonicalScale ?? null;
      state.result.candidate.metrics.photo_boundary_outside_count = geometry.candidateProjection.smoothingDiagnostics?.photoBoundaryOutsideCount ?? null;
      state.result.candidate.metrics.photo_surface_outside_count = geometry.candidateProjection.smoothingDiagnostics?.photoSurfaceOutsideCount ?? null;
      state.result.candidate.metrics.photo_surface_mesh_outside_count = geometry.candidateProjection.smoothingDiagnostics?.photoSurfaceMeshOutsideCount ?? null;
      state.result.candidate.metrics.photo_head_outside_count = geometry.candidateProjection.smoothingDiagnostics?.photoHeadOutsideCount ?? null;
      state.result.candidate.metrics.photo_skin_outside_count = geometry.candidateProjection.smoothingDiagnostics?.photoSkinOutsideCount ?? null;
      state.result.candidate.metrics.photo_canonical_axis_source = geometry.candidateProjection.smoothingDiagnostics?.photoCanonicalAxisSource ?? null;
      state.result.candidate.metrics.photo_reference_candidate = geometry.candidateProjection.smoothingMode === "constrainedReference";
      state.result.candidate.metrics.photo_visibility_limited_candidate = geometry.candidateProjection.smoothingMode === "limitedVisibility";
      state.result.candidate.metrics.photo_visible_fraction = geometry.candidateProjection.visibleFraction ?? null;
      state.result.candidate.metrics.photo_hidden_point_count = geometry.candidateProjection.hiddenPointCount || 0;
      state.result.candidate.metrics.photo_reference_aspect_ratio = geometry.candidateProjection.referenceAspectRatio ?? null;
      state.result.candidate.metrics.photo_reference_length_scale = geometry.candidateProjection.referenceLengthScale ?? null;
      state.result.candidate.metrics.photo_reference_attempts = geometry.candidateProjection.referenceAttempts || [];
      if (geometry.projectedRstlDeviationDeg != null) {
        state.result.candidate.metrics.projected_rstl_deviation_deg = geometry.projectedRstlDeviationDeg;
      }
      const metricPresentation = buildCandidateMetricPresentation(state.result);
      elements.candidateType.textContent = metricPresentation.candidateType;
      elements.candidateLength.textContent = metricPresentation.candidateLength;
      elements.candidateWidth.textContent = metricPresentation.candidateWidth;
      elements.candidateTipAngle.textContent = metricPresentation.candidateTipAngle;
    }
    const recoveryReferenceMode = geometry.candidateProjection.smoothingMode === "constrainedReference"
      || geometry.candidateProjection.smoothingMode === "limitedVisibility";
    const surfaceReferenceRecoveryActive = surfaceReferenceRecoveryEligible && recoveryReferenceMode;
    const effectiveCandidateDisplayBlocked = candidateDisplayBlocked && !surfaceReferenceRecoveryActive;
    candidatePhotoProjectionValid = !effectiveCandidateDisplayBlocked
      && geometry.candidateProjection.valid;
    latestPhotoEndpointSources = candidatePhotoProjectionValid && !recoveryReferenceMode
      ? geometry.endpoints.map((point) => ({ x: point[0], y: point[1] }))
      : [];
    latestCandidateOverlay = {
      candidate: geometry.candidate.map((point) => [...point] as Vec3),
      fit: geometry.fusiformRendering || null,
      candidateType: state.result?.candidate?.type || "",
      valid: candidatePhotoProjectionValid,
    };
    latestCandidateProjection = {
      valid: geometry.candidateProjection.valid,
      reasonCodes: [...geometry.candidateProjection.reasonCodes],
      surfaceConstrained: geometry.candidateProjection.surfaceConstrained === true,
      sourceReasonCodes: [...(geometry.candidateProjection.sourceReasonCodes || [])],
      smoothingMode: geometry.candidateProjection.smoothingMode || "notApplicable",
      smoothingDiagnostics: geometry.candidateProjection.smoothingDiagnostics || null,
      referenceAspectRatio: geometry.candidateProjection.referenceAspectRatio ?? null,
      referenceLengthScale: geometry.candidateProjection.referenceLengthScale ?? null,
      referenceAttempts: [...(geometry.candidateProjection.referenceAttempts || [])],
      visibilityLimited: geometry.candidateProjection.visibilityLimited === true,
      visibleFraction: geometry.candidateProjection.visibleFraction ?? null,
      hiddenPointCount: geometry.candidateProjection.hiddenPointCount || 0,
    };
    projectedCandidate = candidatePhotoProjectionValid && !recoveryReferenceMode ? state.result?.candidate : null;
    fit();
    if (!geometry.candidateProjection.valid) {
      elements.photoEndpointHandles.forEach((handle) => { handle.hidden = true; });
    }
    const status = incisionPhotoStatusPresentation({
      rstlLineCount: geometry.rstl.length,
      candidateDisplayBlocked: effectiveCandidateDisplayBlocked,
      engineeringBlockMessage: engineeringBlockMessage(state.result),
      candidateProjectionValid: geometry.candidateProjection.valid,
      candidatePointCount: geometry.candidate.length,
      candidateSmoothingMode: geometry.candidateProjection.smoothingMode,
      candidateReferenceAspectRatio: geometry.candidateProjection.referenceAspectRatio,
      projectedRstlDeviationDeg: geometry.projectedRstlDeviationDeg,
    });
    setStatus(status.message, status.tone);
  };

  const setMode = (active: boolean) => {
    if (!active && controlledMarkerSeedMode) {
      resetControlledMarker({ restoreSelection: true });
    }
    state.photoView.active = active && Boolean(state.planning2d?.getFrameState().source);
    elements.canvas.classList.toggle("hidden", state.photoView.active);
    elements.photoCanvas.dataset.active = String(state.photoView.active);
    elements.photoMirror.disabled = !state.photoView.active;
    elements.photoReset.disabled = !state.photoView.active;
    elements.surfaceMode.disabled = !state.planning2d?.getFrameState().source;
    setControlledMarkerActionState(controlledMarkerSeedMode);
    syncControlledMarkerRepairControls();
    elements.surfaceMode.title = state.photoView.active
      ? "切换到三维规划视图"
      : "返回患者照片规划";
    if (state.photoView.active) {
      fit();
      render();
      setStageStatus("患者照片规划：点击面部定位，拖拽平移，滚轮缩放");
    } else {
      updateEndpointHandles();
      setStageStatus("三维规划视图：拖拽旋转 · 滚轮缩放 · 点击定位");
      setStatus("三维规划视图；上传 JPEG 或 PNG 可进入患者照片规划", "idle");
    }
    renderCandidateOverlay();
  };

  const resetView = () => {
    state.photoView.zoom = 1;
    state.photoView.offsetX = 0;
    state.photoView.offsetY = 0;
    fit();
  };

  const load = async (file?: File) => {
    if (!file || disposed) return;
    elements.photoInput.value = "";
    const validationError = validateIncisionPhotoFile(file);
    if (validationError) {
      if (state.planning2d?.getFrameState().source) {
        state.photoView.operationId += 1;
        state.planning2d.clearSource();
        clearTransientPlanning();
        setMode(false);
      }
      updatePhotoUploadTitle("");
      setStatus(validationError, "warning");
      setStageStatus(validationError, "warning");
      return;
    }
    if (!state.verts.length || !state.tris.length || !state.atlas) {
      const message = "切口规划资产仍在加载，请稍后重新选择照片。";
      setStatus(message, "warning");
      setStageStatus(message, "warning");
      return;
    }
    const operationId = ++state.photoView.operationId;
    updatePhotoUploadTitle(file.name);
    controlledMarkerScale = null;
    resetControlledMarker();
    state.planning2d?.clearSource();
    clearTransientPlanning();
    setMode(false);
    setStatus("正在本地加载模型并检测照片…", "loading");
    setStageStatus("患者照片检测中…");
    let objectUrl: string | null = null;
    try {
      await ensureImageReady();
      if (disposed || !state.mounted || operationId !== state.photoView.operationId) return;
      objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      if (disposed || !state.mounted || operationId !== state.photoView.operationId) return;
      const prepared = prepareImageSource(image);
      const releaseUrl = objectUrl;
      const revision = state.planning2d?.replaceSource({
        source: prepared.source,
        kind: "image",
        width: prepared.width,
        height: prepared.height,
        release: () => URL.revokeObjectURL(releaseUrl),
      });
      objectUrl = null;
      if (!state.planning2d || revision == null) return;
      const context = elements.photoCanvas.getContext("2d");
      if (context) {
        const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
        elements.photoCanvas.width = Math.max(1, Math.round(prepared.width * dpr));
        elements.photoCanvas.height = Math.max(1, Math.round(prepared.height * dpr));
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, prepared.width, prepared.height);
        context.drawImage(prepared.source, 0, 0, prepared.width, prepared.height);
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
      state.planning2d.setTopology(state.tris);
      state.planning2d.setDetectorLease({ detector: modelState.imageLandmarker });
      state.planning2d.setDetection({ sourceRevision: revision, status: "detecting" });
      const outcome = detectStaticImageWithRetries(modelState.imageLandmarker, prepared.source);
      if (disposed || !state.mounted || operationId !== state.photoView.operationId) return;
      const faces = outcome.result?.faceLandmarks || [];
      if (faces.length !== 1) {
        const reason = faces.length > 1 ? "multiple_faces" : outcome.error ? "detection_error" : "no_face";
        state.planning2d.setDetection({ sourceRevision: revision, status: "failed", attempts: outcome.attempts, reason });
        setMode(true);
        const message = faces.length > 1
          ? "检测到多张人脸；请上传仅包含一位受试者的照片。"
          : outcome.error
            ? "照片检测失败；请重新上传清晰正脸照片。"
            : "未检测到人脸；请更换正面、清晰、光线充足的照片。";
        setStatus(message, "warning");
        setStageStatus(message, "warning");
        return;
      }
      const landmarks = toPixels(faces[0], prepared.width, prepared.height);
      state.planning2d.setDetection({
        sourceRevision: revision,
        status: "ready",
        landmarks,
        surfaceLandmarks: buildForeheadSurfaceLandmarks(landmarks),
        attempts: outcome.attempts,
      });
      resetView();
      state.planning2d.setSelection({ centerRef: null, boundaryRefs: [] });
      setMode(true);
      render();
      setStatus("照片已载入；请点击面部定位病灶，或开启受控标记识别。", "idle");
      setStageStatus("患者照片规划：尚未选择病灶位置");
    } catch (error) {
      if (disposed || !state.mounted || operationId !== state.photoView.operationId) return;
      updatePhotoUploadTitle("");
      const message = `照片加载失败：${errorMessage(error)}`;
      setStatus(message, "warning");
      setStageStatus(message, "warning");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };

  const drawControlledMarkerRepairs = (context: CanvasRenderingContext2D) => {
    for (const stroke of controlledMarkerRepairStrokes) {
      if (!stroke.points.length) continue;
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      if (stroke.points.length === 1) {
        context.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y + 0.01);
      }
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "rgb(16, 18, 20)";
      context.lineWidth = stroke.widthPx;
      context.stroke();
    }
  };

  const runControlledMarkerDetection = (
    seed: { x: number; y: number },
    { preserveRepair = false } = {},
  ) => {
    if (enforceControlledMarkerTumorKind()) return;
    if (controlledMarkerBusy) {
      setStatus("正在识别肿物边界，请稍候。需要取消时可点击“退出标记”。", "loading");
      return;
    }
    if (!preserveRepair && (controlledMarkerRepairAvailable || controlledMarkerRepairStrokes.length)) {
      clearControlledMarkerRepair();
      renderCandidateOverlay();
    }
    const frame = state.planning2d?.getFrameState();
    if (!frame?.source || !frame.landmarks?.length) {
      keepControlledMarkerRetry("");
      setStatus("该点击无法映射到照片，请直接在面部标记中心重试。", "warning");
      return;
    }
    if (preserveRepair && controlledMarkerRepairContext?.sourceRevision !== frame.revision) {
      clearControlledMarkerRepair();
      keepControlledMarkerRetry("");
      setStatus("照片已经变化，原补线已清除；请重新扫描后再补线。", "warning");
      return;
    }
    const photoLandmarks = frame.landmarks;
    const projectionLandmarks = frame.surfaceLandmarks || photoLandmarks;
    const kind = elements.tumorKind.value === "cutaneous" ? "cutaneous" : "subcutaneous";
    const diameterMm = Number(elements.diameter.value);
    const depthMm = Number(elements.depth.value);
    const marginMm = Number(elements.margin.value);
    const author = elements.tumorAuthor.value;
    const scanDiameterMm = controlledMarkerScanDiameterMm();
    const pixelsPerMm = controlledMarkerPixelsPerMm(frame)
      || localPhotoPixelsPerMm(seed, projectionLandmarks, frame.triangles, state.verts, state.unitsPerMm);
    if (!(pixelsPerMm && pixelsPerMm > 0)) {
      keepControlledMarkerRetry("");
      setStatus("当前点击位置无法建立毫米扫描尺度，请在面部肿物边界内部重新点击。", "warning");
      return;
    }
    const minimumScanDiameterMm = clamp(Math.ceil(Math.max(10, diameterMm * 1.2) / 5) * 5, 10, 60);
    if (scanDiameterMm < minimumScanDiameterMm) {
      keepControlledMarkerRetry("");
      setStatus(
        `当前 ${scanDiameterMm} mm 扫描面小于肿物直径所需覆盖范围，请扩大到至少 ${minimumScanDiameterMm} mm 后重试。`,
        "warning",
      );
      return;
    }
    // Every click or repair retry is a fresh visual result. Keep the last
    // accepted controller state available for an explicit mode exit, but hide
    // its yellow boundary and candidate while this attempt is being computed.
    // Otherwise a failed retry can appear to have a closed current boundary.
    state.planning2d?.setSelection({ centerRef: null, boundaryRefs: [] });
    keepControlledMarkerRetry("");
    render();
    const detectionOptions = {
      roiRadius: Math.max(8, Math.round(scanDiameterMm * pixelsPerMm / 2)),
      expectedDiameterPx: Math.max(1, diameterMm * pixelsPerMm),
      scanDiameterMm,
    };
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      keepControlledMarkerRetry("");
      setStatus("浏览器无法读取本地照片像素；可直接重试，持续失败时请重新上传照片。", "warning");
      return;
    }
    context.drawImage(frame.source as CanvasImageSource, 0, 0, frame.width, frame.height);
    const usedManualRepair = controlledMarkerRepairStrokes.length > 0;
    if (usedManualRepair) drawControlledMarkerRepairs(context);
    const imageData = context.getImageData(0, 0, frame.width, frame.height);
    const requestId = ++controlledMarkerRequestId;
    setControlledMarkerBusy(true);
    setStatus(
      usedManualRepair ? "正在使用人工补线重新识别肿物边界…" : "正在识别肿物边界，请稍候。需要取消时可点击“退出标记”。",
      "loading",
    );
    const worker = state.workflowWorker;
    const detectionRequest = worker
      ? worker.api.detectControlledMarker(Comlink.transfer({
        width: imageData.width,
        height: imageData.height,
        data: imageData.data,
      }, [imageData.data.buffer]), seed, detectionOptions)
      : new Promise<ReturnType<typeof detectControlledMarker>>((resolve) => {
        requestAnimationFrame(() => resolve(detectControlledMarker(imageData, seed, detectionOptions)));
      });
    void Promise.resolve(detectionRequest).then(async (rawDetection) => {
      if (disposed || requestId !== controlledMarkerRequestId || !controlledMarkerSeedMode) return;
      const detection: ControlledMarkerDetection = usedManualRepair
        ? { ...rawDetection, warnings: [...new Set([...rawDetection.warnings, "manual_boundary_repair"])] }
        : rawDetection;
      if (!detection.ok || !detection.center) {
        const repairable = controlledMarkerFailureCanBeRepaired(detection) || usedManualRepair;
        if (repairable) {
          const firstRepairPrompt = !controlledMarkerRepairAvailable && !usedManualRepair;
          controlledMarkerRepairAvailable = true;
          controlledMarkerRepairMode = usedManualRepair || preserveRepair;
          controlledMarkerRepairOverlayVisible = usedManualRepair;
          controlledMarkerRepairContext = { seed: { ...seed }, sourceRevision: frame.revision, pixelsPerMm };
          syncControlledMarkerRepairControls();
          if (firstRepairPrompt) promptControlledMarkerRecovery();
        } else {
          clearControlledMarkerRepair();
        }
        keepControlledMarkerRetry("");
        console.info("[LangerFace] controlled marker not recognized", {
          failure_code: detection.failure_code,
          seed,
          bbox: detection.bbox,
          area_px: detection.area_px,
          scan: detection.scan,
          diagnostics: detection.diagnostics,
          warnings: detection.warnings,
          manual_boundary_repair: usedManualRepair,
        });
        setStatus(
          `${controlledMarkerFailureMessage(detection)}${repairable
            ? usedManualRepair
              ? "本次补线仍未形成可识别的完整边界；可扩大扫描范围、继续补线或撤销上一笔。"
              : "可扩大扫描范围，或点击“补线”后按住鼠标左键补充照片中确实可见的缺口；抬笔后会自动重检。"
            : "受控标记仍保持开启，可直接重试。"}`,
          "warning",
        );
        return;
      }
      if (elements.tumorKind.value !== kind
        || Number(elements.diameter.value) !== diameterMm
        || Number(elements.depth.value) !== depthMm
        || Number(elements.margin.value) !== marginMm) {
        clearControlledMarkerRepair();
        keepControlledMarkerRetry("");
        setStatus("识别期间肿物类型或参数发生变化；为避免套用旧结果，请重新点击标记。", "warning");
        return;
      }
      if (kind === "cutaneous" && detection.geometry_mode !== "enclosed_region") {
        keepControlledMarkerRetry("");
        console.info("[LangerFace] controlled marker stroke-only result rejected", {
          geometry_mode: detection.geometry_mode,
          seed_relation: detection.seed_relation,
          marker_fingerprint: controlledMarkerFingerprint(detection),
          raw_media_retained: false,
        });
        setStatus(
          "当前点击处只识别到黑色笔画，没有识别到由曲线围出的肿物范围。请在肿物边界内部重试。",
          "warning",
        );
        return;
      }
      const centerRef = sourcePointToSurfaceRef(detection.center, projectionLandmarks, frame.triangles);
      const boundaryRefs = detection.boundary
        .map((point) => sourcePointToSurfaceRef(point, projectionLandmarks, frame.triangles))
        .filter((ref): ref is SurfaceRef => ref !== null);
      if (!centerRef || (kind === "cutaneous" && boundaryRefs.length < 3)) {
        keepControlledMarkerRetry("");
        setStatus("标记位于不可映射区域或跨出面部表面，请在面部标记中心重试。", "warning");
        return;
      }
      const draft = normalizeLesionDetectionAdapter({
        schema: "lesion-detection-adapter/v0.1",
        source: "detector",
        kind,
        topology: { id: state.headAsset?.topologyId, version: state.headAsset?.topologyVersion },
        center_ref: centerRef,
        boundary_refs: kind === "cutaneous" ? boundaryRefs : [],
        diameter_mm: diameterMm,
        depth_mm: kind === "subcutaneous" ? depthMm : null,
        margin_mm: kind === "cutaneous" ? marginMm : 0,
        confidence: detection.confidence,
        units: "mm",
        model: { name: "controlled-marker-barrier-segmentation", version: CONTROLLED_MARKER_DETECTOR_VERSION },
        warnings: detection.warnings,
      }, {
        topologyId: state.headAsset?.topologyId,
        topologyVersion: state.headAsset?.topologyVersion,
        vertices: state.verts,
        triangles: state.tris,
      });
      const confirmed = confirmLesionDetectionDraft(draft, {
        kind,
        diameter_mm: diameterMm,
        depth_mm: kind === "subcutaneous" ? depthMm : null,
        margin_mm: kind === "cutaneous" ? marginMm : 0,
        boundary_mode: kind === "cutaneous" ? "controlled_marker" : "ellipse",
        boundary_source: kind === "cutaneous" ? "controlled_marker_confirmed" : "detector_confirmed",
      }, author);
      if (!confirmed.eligible_for_candidate || !confirmed.tumor) {
        throw new Error("当前类型、范围或参数尚未通过输入质量检查");
      }
      const tumorEngineeringValidation = inspectTumorEngineeringExclusions(confirmed.tumor, state.verts);
      if (!tumorEngineeringValidation.passed) {
        throw new Error("病灶中心或范围进入眼裂、口裂或鼻孔等非皮肤开口，请在标记内其他位置重试");
      }
      clearTransientPlanning();
      state.controlledBoundaryActive = kind === "cutaneous";
      if (state.controlledBoundaryActive) {
        state.boundaryRefs = [...confirmed.geometry.boundary_refs];
        state.boundaryPoints = [...confirmed.geometry.boundary];
      }
      setLesion(nearestVertex(confirmed.geometry.center), confirmed.geometry.center_ref);
      updateTumorRing();
      state.planning2d?.setSelection({
        centerRef: confirmed.geometry.center_ref,
        boundaryRefs: state.controlledBoundaryActive ? confirmed.geometry.boundary_refs : [],
      });
      if (usedManualRepair) {
        controlledMarkerRepairAvailable = true;
        controlledMarkerRepairMode = false;
        controlledMarkerRepairOverlayVisible = false;
        controlledMarkerRepairContext = { seed: { ...seed }, sourceRevision: frame.revision, pixelsPerMm };
        syncControlledMarkerRepairControls();
      } else {
        clearControlledMarkerRepair();
      }
      await Promise.resolve(runWorkflow());
      if (disposed || requestId !== controlledMarkerRequestId || !controlledMarkerSeedMode || !state.mounted) return;
      render();
      setControlledMarkerActionState(true);
      console.info(
        "[LangerFace] controlled marker planning audit",
        controlledMarkerPlanningAudit(detection, state.result, latestCandidateProjection),
      );
      const candidatePointCount = state.result?.candidate?.polyline?.length || 0;
      const surfaceReferenceRecoveryEligible = workflowPhotoSurfaceReferenceRecoveryEligible(state.result);
      const surfaceReferenceRecoveryActive = surfaceReferenceRecoveryEligible
        && (latestCandidateProjection.smoothingMode === "constrainedReference"
          || latestCandidateProjection.smoothingMode === "limitedVisibility");
      const candidateBlocked = state.result?.candidate_display_blocked === true && !surfaceReferenceRecoveryActive;
      const candidateVisible = candidatePointCount >= 2 && !candidateBlocked && candidatePhotoProjectionValid;
      if (!candidateVisible) {
        const reason = candidateBlocked
          ? engineeringBlockMessage(state.result)
          : candidatePointCount < 2
            ? "系统未能生成可用的切口线"
            : `${photoProjectionFailureDetail(
              latestCandidateProjection.smoothingDiagnostics,
              latestCandidateProjection.referenceAttempts,
            )}。当前工具无法提供可靠的切口参考，请调整拍摄角度或位置后重试`;
        setStatus(
          `已识别肿物边界，但没有显示候选切口：${stripTerminalPunctuation(reason)}。受控标记仍保持开启，请调整后重试。`,
          "warning",
        );
        publishState("controlled_marker_candidate_hidden");
        return;
      }
      if (kind === "cutaneous" && latestCandidateProjection.smoothingMode === "sourceFallback") {
        setStatus(
          "已识别肿物边界，但候选切口未通过平滑与尖端拓扑校正。当前线条仅供检查，请重新点击复核。",
          "warning",
        );
        publishState("controlled_marker_candidate_needs_review");
        return;
      }
      if (kind === "cutaneous" && latestCandidateProjection.smoothingMode === "constrainedReference") {
        const ratio = Number(latestCandidateProjection.referenceAspectRatio || 0).toFixed(2);
        setStatus(
          `已识别肿物边界，并生成受限参考候选：原定 3:1 梭形超出当前可用面部区域，现按 ${ratio}:1 显示。该结果不满足项目原定比例，只用于展示约束原因；请医生结合皮肤松弛度、轻捏后能否自然对合、明显牵拉与解剖位置复核。`,
          "warning",
        );
        publishState("controlled_marker_reference_candidate");
        return;
      }
      if (kind === "cutaneous" && latestCandidateProjection.smoothingMode === "limitedVisibility") {
        const ratio = Number(latestCandidateProjection.referenceAspectRatio || 0);
        const ratioCopy = Math.abs(ratio - 3) <= 0.05
          ? "当前为视野受限参考"
          : `当前为视野受限的非标准比例参考（${ratio.toFixed(2)}:1）`;
        setStatus(
          `已识别肿物边界。${ratioCopy}，不能确认完整长度及不可见区域，请结合另一视角复核。`,
          "warning",
        );
        publishState("controlled_marker_visibility_limited_candidate");
        return;
      }
      const weakBoundaryInferred = kind === "cutaneous"
        && !usedManualRepair
        && detection.warnings.includes("low_contrast_near_circular_recovered");
      if (weakBoundaryInferred) {
        setStatus(
          "已根据浅色近圆轮廓生成参考候选。部分边界由局部明暗和形状连续性推断，请核对黄色范围后再继续。",
          "warning",
        );
        publishState("controlled_marker_weak_boundary_candidate");
        return;
      }
      const diameterAdjusted = kind === "cutaneous"
        && detection.warnings.includes("operator_diameter_mismatch");
      setStatus(kind === "cutaneous"
        ? usedManualRepair
          ? "已通过人工补线识别肿物边界并生成候选切口。蓝色补线已隐藏；如需继续可再次点击“补线”。请复核黄色范围后再继续。"
          : diameterAdjusted
            ? "已识别肿物边界并生成候选切口。识别范围与填写直径有差异，切口已按黄色识别范围自动调整。可继续点击其他位置复核，或点击“退出标记”。"
            : "已识别肿物边界并生成候选切口。黄色线表示识别范围，切口大小已根据识别结果自动调整。可继续点击其他位置复核，或点击“退出标记”。"
        : "已识别位置并生成候选切口。可继续点击其他位置复核，或点击“退出标记”。",
      "ready");
      if (usedManualRepair) publishState("controlled_marker_repair_applied");
      else publishState("controlled_marker_applied");
    }).catch((error) => {
      if (disposed || requestId !== controlledMarkerRequestId || !controlledMarkerSeedMode) return;
      keepControlledMarkerRetry("");
      setStatus(`本次识别未能完成：${errorMessage(error)}。受控标记仍保持开启，可直接重试。`, "warning");
    }).finally(() => {
      if (requestId === controlledMarkerRequestId) setControlledMarkerBusy(false);
    });
  };

  syncControlledMarkerScanControl(true);
  updatePhotoUploadTitle("");

  return {
    fit,
    render,
    setMode,
    resetView,
    load,
    syncTumorKindGuard(kind) {
      enforceControlledMarkerTumorKind({ announce: !isCutaneousTumor(kind), kind });
      render();
    },
    beginControlledMarkerDetection() {
      if (enforceControlledMarkerTumorKind()) return;
      const frame = state.planning2d?.getFrameState();
      if (!state.photoView.active || !frame?.source || !frame.landmarks?.length) {
        setStatus("请先上传并成功检测一张单人正脸照片。", "warning");
        return;
      }
      if (controlledMarkerSeedMode) {
        resetControlledMarker({ restoreSelection: true });
        render();
        setStatus("已退出受控标记模式；当前已生成的病灶和候选保持不变。", "idle");
        publishState("controlled_marker_cancelled");
        return;
      }
      syncControlledMarkerScanControl(true);
      // Entering a new scan is a fresh visual attempt. Keep the last accepted
      // result in controller state so cancelling can restore it, but hide its
      // center, boundary and candidate while the next scan is pending. This
      // prevents a failed click from making an old yellow contour look like the
      // current detection result.
      state.planning2d?.setSelection({ centerRef: null, boundaryRefs: [] });
      keepControlledMarkerRetry("");
      render();
      setStatus(
        `受控标记已开启：鼠标圆形扫描面当前为 ${controlledMarkerScanDiameterMm()} mm。请让扫描面覆盖完整肿物边界后点击。`,
        "loading",
      );
    },
    updateControlledMarkerScan(userAdjusted = true) {
      if (userAdjusted) controlledMarkerScanUserAdjusted = true;
      syncControlledMarkerScanControl(!userAdjusted);
      positionControlledMarkerScan(controlledMarkerPointer);
      if (controlledMarkerSeedMode && !controlledMarkerBusy) {
        setStatus(
          `受控标记已开启：鼠标圆形扫描面当前为 ${controlledMarkerScanDiameterMm()} mm。请让扫描面覆盖完整肿物边界后点击。`,
          "loading",
        );
      }
    },
    toggleControlledMarkerRepair() {
      if (enforceControlledMarkerTumorKind()) return;
      if (!controlledMarkerRepairAvailable || !controlledMarkerRepairContext) {
        setStatus("只有在扫描已覆盖相关曲线、但边缘仍不连续时，才可使用人工补线。", "warning");
        return;
      }
      if (controlledMarkerBusy) {
        setStatus("正在识别肿物边界，请稍候。", "loading");
        return;
      }
      controlledMarkerRepairMode = !controlledMarkerRepairMode;
      controlledMarkerRepairDrawing = null;
      if (controlledMarkerRepairMode) controlledMarkerRepairOverlayVisible = true;
      syncControlledMarkerRepairControls();
      positionControlledMarkerScan(controlledMarkerPointer);
      renderCandidateOverlay();
      setStatus(controlledMarkerRepairMode
        ? "人工补线已开启：按住鼠标左键沿照片中确实可见的缺口补线，抬笔后自动重检。请勿凭空改写肿物边界。"
        : "人工补线已暂停；已有补线仍保留，可重新开启或撤销。",
      "warning");
    },
    undoControlledMarkerRepair() {
      if (controlledMarkerBusy || !controlledMarkerRepairStrokes.length) return;
      controlledMarkerRepairDrawing = null;
      controlledMarkerRepairStrokes.pop();
      controlledMarkerRepairOverlayVisible = controlledMarkerRepairStrokes.length > 0;
      syncControlledMarkerRepairControls();
      renderCandidateOverlay();
      const retryContext = controlledMarkerRepairContext;
      if (retryContext) runControlledMarkerDetection(retryContext.seed, { preserveRepair: true });
    },
    clearControlledMarkerRepairStrokes() {
      if (controlledMarkerBusy || !controlledMarkerRepairStrokes.length) return;
      controlledMarkerRepairDrawing = null;
      controlledMarkerRepairStrokes = [];
      controlledMarkerRepairOverlayVisible = false;
      syncControlledMarkerRepairControls();
      renderCandidateOverlay();
      const retryContext = controlledMarkerRepairContext;
      if (retryContext) runControlledMarkerDetection(retryContext.seed, { preserveRepair: true });
    },
    beginControlledMarkerRepairStroke(event) {
      if (!controlledMarkerRepairMode) return false;
      if (enforceControlledMarkerTumorKind()) return true;
      if (controlledMarkerBusy) return true;
      if (event.button !== 0 || !event.isPrimary) {
        setStatus("人工补线只响应主鼠标左键或主要触控笔。", "warning");
        return true;
      }
      const frame = state.planning2d?.getFrameState();
      const point = state.planning2d?.clientToSource({ x: event.clientX, y: event.clientY });
      if (!frame?.source || !point || frame.revision !== controlledMarkerRepairContext?.sourceRevision
        || point.x < 0 || point.y < 0 || point.x > frame.width || point.y > frame.height) {
        setStatus("补线起点不在当前照片内，请在缺口处重新按住鼠标左键。", "warning");
        return true;
      }
      controlledMarkerRepairDrawing = {
        points: [point],
        widthPx: clamp(controlledMarkerRepairContext.pixelsPerMm * 0.65, 3, 14),
      };
      controlledMarkerRepairOverlayVisible = true;
      renderCandidateOverlay();
      return true;
    },
    moveControlledMarkerRepairStroke(event) {
      const stroke = controlledMarkerRepairDrawing;
      if (!stroke || !(event.buttons & 1)) return;
      const frame = state.planning2d?.getFrameState();
      const point = state.planning2d?.clientToSource({ x: event.clientX, y: event.clientY });
      if (!frame || !point || point.x < 0 || point.y < 0 || point.x > frame.width || point.y > frame.height) return;
      const previous = stroke.points[stroke.points.length - 1];
      const samplingDistance = Math.max(0.75, stroke.widthPx * 0.2);
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < samplingDistance) return;
      const totalPointCount = controlledMarkerRepairStrokes.reduce((sum, item) => sum + item.points.length, 0)
        + stroke.points.length;
      if (totalPointCount >= 5000) {
        setStatus("本次补线点数已达到上限；请抬笔等待重检，避免一次描绘过长。", "warning");
        return;
      }
      stroke.points.push(point);
      renderCandidateOverlay();
    },
    endControlledMarkerRepairStroke(event) {
      const stroke = controlledMarkerRepairDrawing;
      controlledMarkerRepairDrawing = null;
      if (!stroke) return;
      const point = state.planning2d?.clientToSource({ x: event.clientX, y: event.clientY });
      if (point) {
        const previous = stroke.points[stroke.points.length - 1];
        if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.75) stroke.points.push(point);
      }
      const strokeLength = stroke.points.slice(1).reduce((sum, item, index) => {
        const previous = stroke.points[index];
        return sum + Math.hypot(item.x - previous.x, item.y - previous.y);
      }, 0);
      if (strokeLength < Math.max(1.5, stroke.widthPx * 0.5)) {
        renderCandidateOverlay();
        setStatus("这次补线过短，未写入照片分析层；请按住左键沿缺口拖动。", "warning");
        return;
      }
      controlledMarkerRepairStrokes.push(stroke);
      syncControlledMarkerRepairControls();
      renderCandidateOverlay();
      const retryContext = controlledMarkerRepairContext;
      if (retryContext) runControlledMarkerDetection(retryContext.seed, { preserveRepair: true });
    },
    cancelControlledMarkerRepairStroke() {
      controlledMarkerRepairDrawing = null;
      renderCandidateOverlay();
    },
    moveControlledMarkerScan(event) {
      positionControlledMarkerScan({ x: event.clientX, y: event.clientY });
    },
    hideControlledMarkerScan() {
      positionControlledMarkerScan(null);
    },
    pick(event) {
      if (controlledMarkerSeedMode) {
        if (enforceControlledMarkerTumorKind()) return;
        const seed = state.planning2d?.clientToSource({ x: event.clientX, y: event.clientY });
        if (!seed) {
          keepControlledMarkerRetry("");
          setStatus("该点击无法映射到照片，请直接在面部标记中心重试。", "warning");
          return;
        }
        runControlledMarkerDetection(seed);
        return;
      }
      const sourcePoint = state.planning2d?.clientToSource({ x: event.clientX, y: event.clientY });
      const frame = state.planning2d?.getFrameState();
      const ref = state.planning2d?.pickSurfaceRef({ x: event.clientX, y: event.clientY });
      if (!ref) {
        setStatus("该位置不在人脸表面，请点击检测到的面部区域。", "warning");
        return;
      }
      const rawSurfaceRef = sourcePoint && frame?.landmarks
        ? sourcePointToSurfaceRef(sourcePoint, frame.landmarks, frame.triangles)
        : null;
      if (!rawSurfaceRef && sourcePoint && frame?.landmarks) {
        const context = elements.photoCanvas.getContext("2d");
        const skinVisible = context
          ? incisionPhotoSkinVisibility(context, frame.width, frame.height, [...frame.landmarks])
          : () => true;
        if (!skinVisible([sourcePoint.x, sourcePoint.y, 0])) {
          setStatus("该位置不在可见额头皮肤区域，请避开头发和背景后重试。", "warning");
          return;
        }
      }
      const point = surfaceRefToModelPoint(ref, state.verts, state.tris);
      if (!point) return;
      if (state.boundaryActive && elements.tumorKind.value === "cutaneous" && elements.boundaryMode.value === "freehand") {
        state.boundaryPoints.push(point);
        state.boundaryRefs.push(ref);
        updateTumorRing();
        elements.pickState.textContent = `自由轮廓点：${state.boundaryPoints.length} 个`;
        publishState("tumor_boundary_point");
        return;
      }
      const openingMessage = tumorPointEngineeringExclusionMessage(point, state.verts);
      if (openingMessage) { setStatus(openingMessage, "warning"); return; }
      const clearedFreehandBoundary = shouldClearFreehandBoundaryOnLesionRepick({
        kind: elements.tumorKind.value,
        boundaryMode: elements.boundaryMode.value,
        boundaryPointCount: state.boundaryPoints.length,
      });
      if (clearedFreehandBoundary || state.controlledBoundaryActive) {
        state.boundaryPoints = [];
        state.boundaryRefs = [];
        state.boundaryActive = false;
        state.controlledBoundaryActive = false;
        elements.startBoundary.textContent = "开始轮廓";
      }
      setLesion(nearestVertex(point), ref);
      if (clearedFreehandBoundary) {
        elements.pickState.textContent = "已选择新病灶中心；原自由轮廓已清空，请重新绘制。";
      }
      void runWorkflow();
    },
    endpointHandleFromEvent(event) {
      if (controlledMarkerSeedMode) return null;
      if (!state.photoView.active || !state.planning2d) return null;
      if (state.result?.candidate_display_blocked || !candidatePhotoProjectionValid
        || projectedCandidate !== state.result?.candidate) return null;
      const endpoints = latestPhotoEndpointSources
        .map((point) => state.planning2d?.sourceToClient(point))
        .filter((point): point is { x: number; y: number } => point !== null && point !== undefined);
      return nearestPhotoEndpointHandle(
        { x: event.clientX, y: event.clientY },
        endpoints,
        event.pointerType === "touch" ? 20 : 14,
      );
    },
    dragEndpoint(event, index) {
      const ref = state.planning2d?.pickSurfaceRef({ x: event.clientX, y: event.clientY });
      if (!ref) return;
      const point = surfaceRefToModelPoint(ref, state.verts, state.tris);
      if (point) dragEndpoint(point, index);
    },
    commitEndpointDrag,
    pan(deltaX, deltaY) {
      if (!state.photoView.active || controlledMarkerSeedMode) return;
      state.photoView.offsetX += deltaX;
      state.photoView.offsetY += deltaY;
      fit();
    },
    zoom(event) {
      if (!state.photoView.active || !state.planning2d) return;
      const sourcePoint = state.planning2d.clientToSource({ x: event.clientX, y: event.clientY });
      const nextZoom = clamp(state.photoView.zoom * Math.exp(-clamp(event.deltaY, -160, 160) * 0.0018), 1, 5);
      if (Math.abs(nextZoom - state.photoView.zoom) < 0.001) return;
      state.photoView.zoom = nextZoom;
      fit();
      if (!sourcePoint) return;
      const projected = state.planning2d.sourceToClient(sourcePoint);
      if (!projected) return;
      state.photoView.offsetX += event.clientX - projected.x;
      state.photoView.offsetY += event.clientY - projected.y;
      fit();
    },
    toggleMirror() {
      if (!state.photoView.active) return;
      state.photoView.mirror = !state.photoView.mirror;
      elements.photoMirror.setAttribute("aria-pressed", String(state.photoView.mirror));
      fit();
    },
    dispose() {
      resetControlledMarker();
      positionControlledMarkerScan(null);
      disposed = true;
      state.photoView.operationId += 1;
    },
  };
}
