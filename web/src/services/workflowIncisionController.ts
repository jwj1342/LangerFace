import * as Comlink from "comlink";

import {
  INCISION_CONTROLLER_STATE_EVENT,
  INCISION_LIBRARY_REACT_COMMAND_EVENT,
  INCISION_REVIEW_REACT_COMMAND_EVENT,
  INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT,
  INCISION_TUMOR_REACT_COMMAND_EVENT,
  LIVE_CONTROLLER_STATE_EVENT,
  WORKFLOW_INCISION_TOOL_REACT_COMMAND_EVENT,
} from "../lib/controllerEvents";
import {
  WORKFLOW_INCISION_TOOL_COMMANDS,
  bindWindowControllerEvents,
  dispatchControllerEvent,
  readControllerCommandDetail,
} from "../lib/controllerCommand";
import {
  readIncisionLibraryCommand,
  readIncisionReviewCommand,
  readIncisionSecondaryCueCommand,
  readIncisionTumorCommand,
} from "./incisionCommandSchemas";
import {
  CONTROLLED_MARKER_DETECTOR_VERSION,
  detectControlledMarker,
  type ControlledMarkerDetection,
} from "./controlledMarkerDetection";
import { dataSource } from "./dataSource";
import { auditExportPayload } from "./exportPrivacy";
import { controlledMarkerFailureMessage, engineeringBlockMessage, guardrailLabel, reasonLabel, regionLabel, reviewStatusLabel, subunitLabel } from "./incisionClinicalCopy";
import { buildLocalIncisionPrivacyAudit, normalizeSecondaryCuePayload } from "./incisionAuxiliaryEvidence";
import {
  buildReviewExportPayload,
  buildTumorExportPayload,
  downloadCanvasWithSvgOverlayPng,
  downloadText,
} from "./incisionExport";
import { compileIncisionOverlay, pointToSurfaceRef, type SurfaceRef } from "./incisionOverlay";
import {
  buildForeheadSurfaceLandmarks,
  buildIncisionPhotoGeometry,
  candidateEndpointSurfaceRefs,
  incisionPhotoLayerContract,
  incisionPhotoStatusPresentation,
  incisionPhotoSkinVisibility,
  pointsToSurfaceRefs,
  queryIncisionPhotoRstlDirection,
  surfaceRefToModelPoint,
  type IncisionPhotoGeometry,
} from "./incisionPhotoPlanning";
import { stablePhotoPixelsPerMm } from "./incisionPhotoRuntime";
import { buildIncisionResultPresentation } from "./incisionPresenter";
import {
  assessReviewReadiness,
  buildReviewGate,
  reviewForCandidateRecord,
} from "./incisionReviewPolicy";
import {
  buildCandidateEditSession,
  buildIncisionReviewRecord,
  buildIncisionReviewReport,
  findSensitiveStructureInspection,
} from "./incisionReviewRecords";
import {
  buildIncisionAssetLoadingSnapshot,
  buildIncisionCandidateSnapshot,
  buildIncisionControllerSnapshot,
  buildIncisionEditSnapshot,
  buildIncisionHeadAssetSnapshot,
  buildIncisionPrivacyAuditSnapshot,
  buildIncisionReviewSnapshot,
  buildIncisionSavedCandidateSummaries,
  buildIncisionSecondaryCueSnapshot,
  type IncisionHeadAssetState,
  type IncisionResultViewState,
} from "./incisionSnapshots";
import { resolveIncisionAtlas } from "./incisionAtlasSource";
import { requestFrame } from "./pipeline";
import {
  sourcePointToSurfaceRef,
  surfaceRefToSourcePoint,
  type PhotoPlanningFrameState,
} from "./photoPlanningController";
import { add3, scale3, tangentFrame } from "./incisionSceneGeometry";
import {
  classifyRegion,
  compareCandidateRecords,
  summarizeTumorBoundary,
  summarizeTumorInputQuality,
  unitsPerMmFromVertices,
  workflowTraceGate,
} from "./incisionTools";
import {
  inspectTumorEngineeringExclusions,
  tumorPointEngineeringExclusionMessage,
} from "./incisionToolCore";
import {
  buildTumorInput,
  importedTumorFormState,
  withControlledMarkerProvenance,
} from "./tumorInput";
import { modelState, renderState, sourceState } from "./liveState";
import { resetImageView } from "./liveCanvasFit";
import type { LiveControllerSnapshot } from "./liveSnapshots";
import type { VisibilityPredicate } from "./foreheadVisibility";
import type { Triangle, Vec3 } from "./softBody";
import { vertexNormals } from "./three3d";
import {
  beginWorkflowPointerIntent,
  completesWorkflowCanvasClick,
  minimumWorkflowMarkerScanDiameterMm,
  updateWorkflowPointerIntent,
  workflowFusiformSvgPath,
  workflowCandidateDisplayAllowed,
  workflowInvalidationNeedsLiveFrame,
  workflowLiveOverlayChanged,
  workflowMarkerRequestStillCurrent,
  workflowMarkerScanDiameterForTumor,
  workflowCenteredLinearPath,
  workflowPhotoCircleFootprint,
  workflowPhotoEllipseBoundary,
  workflowPhotoOpeningIntersection,
  workflowPhotoTumorOpeningIntersection,
  workflowPhotoTumorOutline,
  workflowScanCircleGeometry,
  workflowSubcutaneousLengthLimit,
  type WorkflowMarkerRequestSnapshot,
  type WorkflowPointerIntent,
} from "./workflowControllerUtils";
import { planIncisionWithWorkflowFallback } from "./workflowPlanner";
import { createWorkflowWorkerClient, type WorkflowWorkerClient } from "./workflowWorkerClient";

type DynamicRecord = Record<string, any>;
type Cleanup = () => void;

interface RepairStroke {
  points: Array<{ x: number; y: number }>;
  widthPx: number;
}

interface WorkflowIncisionState {
  mounted: boolean;
  root: HTMLElement;
  verts: Vec3[];
  tris: Triangle[];
  atlas: DynamicRecord | null;
  headAsset: IncisionHeadAssetState | null;
  normals: Vec3[];
  unitsPerMm: number;
  centerRef: SurfaceRef | null;
  boundaryRefs: SurfaceRef[];
  controlledBoundary: boolean;
  boundaryActive: boolean;
  kind: "cutaneous" | "subcutaneous";
  diameterMm: number;
  depthMm: number;
  marginMm: number;
  author: string;
  boundaryMode: "ellipse" | "freehand";
  ellipseRatio: number;
  result: DynamicRecord | null;
  saved: DynamicRecord[];
  secondaryCues: DynamicRecord | null;
  review: { status: string; reviewer: string; notes: string };
  generationCount: number;
  stageStatus: string;
  stageStatusTone: "normal" | "warning";
  loading: boolean;
  workflowBusy: boolean;
  selectionMode: boolean;
  markerMode: boolean;
  markerBusy: boolean;
  markerRequestId: number;
  repairAvailable: boolean;
  repairMode: boolean;
  repairStrokes: RepairStroke[];
  repairDrawing: RepairStroke | null;
  markerSeed: { x: number; y: number } | null;
  markerPointerSource: { x: number; y: number } | null;
  markerPreviewSuppressed: boolean;
  markerSourceRevision: number | null;
  controlledMarkerScale: { sourceRevision: number; pixelsPerMm: number } | null;
  scanDiameterMm: number;
  worker: WorkflowWorkerClient | null;
  workerFailed: boolean;
  workflowRequestId: number;
  pendingClick: WorkflowPointerIntent | null;
  photoFrameRevision: number | null;
  photoFrameLandmarks: readonly Vec3[] | null;
  photoSurfaceLandmarks: Vec3[];
  photoSkinVisible: VisibilityPredicate | null;
  geometryRevision: number;
  cachedGeometryRevision: number;
  cachedGeometryFrameRevision: number | null;
  cachedPhotoGeometry: IncisionPhotoGeometry | null;
  photoEllipseBoundaryCache: { key: string; refs: SurfaceRef[] } | null;
  cleanup: Cleanup | null;
  liveSnapshot: LiveControllerSnapshot | null;
}

const EMPTY_RESULT_VIEW: IncisionResultViewState = {
  candidateType: "—",
  candidateLength: "—",
  candidateWidth: "—",
  candidateTipAngle: "—",
  rstlDeviation: "—",
  directionConfidence: "—",
  directionTitle: "",
  region: "—",
  regionTitle: "",
  guardrailLabel: "—",
  guardrailWarn: false,
  workflowSummary: "尚未生成。",
  directionSource: "方向依据：尚未生成。",
  directionSourceWarn: false,
  workflowGate: "工作流工具门控：尚未生成。",
  workflowGateWarn: false,
  workflowGateTitle: "",
  workflowComparison: "工作流候选比较：尚未生成。",
  workflowComparisonWarn: false,
  workflowComparisonTitle: "",
  nextStep: "请先上传照片并在中央画布选择肿物。",
  guardrailDetails: "保护规则尚未运行。",
  guardrailDetailsWarn: false,
  guardrailDetailsDanger: false,
};

let activeState: WorkflowIncisionState | null = null;

function createState(root: HTMLElement): WorkflowIncisionState {
  return {
    mounted: true,
    root,
    verts: [],
    tris: [],
    atlas: null,
    headAsset: null,
    normals: [],
    unitsPerMm: 1,
    centerRef: null,
    boundaryRefs: [],
    controlledBoundary: false,
    boundaryActive: false,
    kind: "cutaneous",
    diameterMm: 12,
    depthMm: 6,
    marginMm: 0,
    author: "clinician",
    boundaryMode: "ellipse",
    ellipseRatio: 90,
    result: null,
    saved: [],
    secondaryCues: null,
    review: { status: "pending_clinician_confirmation", reviewer: "", notes: "" },
    generationCount: 0,
    stageStatus: "加载切口规划资产",
    stageStatusTone: "normal",
    loading: true,
    workflowBusy: false,
    selectionMode: false,
    markerMode: false,
    markerBusy: false,
    markerRequestId: 0,
    repairAvailable: false,
    repairMode: false,
    repairStrokes: [],
    repairDrawing: null,
    markerSeed: null,
    markerPointerSource: null,
    markerPreviewSuppressed: false,
    markerSourceRevision: null,
    controlledMarkerScale: null,
    scanDiameterMm: 20,
    worker: null,
    workerFailed: false,
    workflowRequestId: 0,
    pendingClick: null,
    photoFrameRevision: null,
    photoFrameLandmarks: null,
    photoSurfaceLandmarks: [],
    photoSkinVisible: null,
    geometryRevision: 0,
    cachedGeometryRevision: -1,
    cachedGeometryFrameRevision: null,
    cachedPhotoGeometry: null,
    photoEllipseBoundaryCache: null,
    cleanup: null,
    liveSnapshot: null,
  };
}

function fallbackHeadAsset(): IncisionHeadAssetState {
  return {
    id: "pending",
    label: "RSTL 资产加载中",
    topologyId: "unknown",
    topologyVersion: "unknown",
    vertexCount: 0,
    triangleCount: 0,
    atlasTopologyId: null,
    atlasLineCount: 0,
    mode: "unknown",
    atlasProvenance: null,
    atlasContract: null,
    statusLabel: "资产加载中",
    warnings: [],
  };
}

function rootInput(state: WorkflowIncisionState, id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
  return state.root.querySelector(`#${CSS.escape(id)}`);
}

function setStatus(state: WorkflowIncisionState, message: string, tone: "normal" | "warning" = "normal") {
  state.stageStatus = message;
  state.stageStatusTone = tone;
}

function currentReview(state: WorkflowIncisionState) {
  const statusControl = rootInput(state, "reviewDecision");
  const reviewerControl = rootInput(state, "reviewerName");
  const notesControl = rootInput(state, "reviewNotes");
  const status = String(statusControl ? statusControl.value : state.review.status);
  const reviewer = String(reviewerControl ? reviewerControl.value : state.review.reviewer).trim();
  const notes = String(notesControl ? notesControl.value : state.review.notes).trim();
  state.review = { status, reviewer, notes };
  return state.review;
}

function privacyAudit(state: WorkflowIncisionState) {
  return buildLocalIncisionPrivacyAudit(Boolean(state.secondaryCues));
}

function secondaryCueSummary(state: WorkflowIncisionState) {
  if (!state.secondaryCues) return { present: false, manual_confirmed: false, used_for_geometry: false };
  const confirmed = (rootInput(state, "secondaryCueConfirmed") as HTMLInputElement | null)?.checked === true;
  return { present: true, ...state.secondaryCues, manual_confirmed: confirmed };
}

function modelPoint(state: WorkflowIncisionState, ref: SurfaceRef | null): Vec3 | null {
  return ref ? surfaceRefToModelPoint(ref, state.verts, state.tris) : null;
}

function nearestVertex(state: WorkflowIncisionState, point: Vec3): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  state.verts.forEach((candidate, index) => {
    const next = Math.hypot(candidate[0] - point[0], candidate[1] - point[1], candidate[2] - point[2]);
    if (next < distance) {
      distance = next;
      best = index;
    }
  });
  return best;
}

function photoPixelsPerMmAt(
  state: WorkflowIncisionState,
  point: { x: number; y: number },
  photoLandmarks: readonly Vec3[],
): number | null {
  if (!(state.unitsPerMm > 0)) return null;
  const ref = sourcePointToSurfaceRef(point, photoLandmarks, state.tris);
  const triangle = ref ? state.tris[ref.tri] : null;
  if (!triangle) return null;
  const ratios: number[] = [];
  for (const [firstIndex, secondIndex] of [[0, 1], [1, 2], [2, 0]] as const) {
    const firstPhoto = photoLandmarks[triangle[firstIndex]];
    const secondPhoto = photoLandmarks[triangle[secondIndex]];
    const firstModel = state.verts[triangle[firstIndex]];
    const secondModel = state.verts[triangle[secondIndex]];
    if (!firstPhoto || !secondPhoto || !firstModel || !secondModel) continue;
    const photoLength = Math.hypot(firstPhoto[0] - secondPhoto[0], firstPhoto[1] - secondPhoto[1]);
    const modelLengthMm = Math.hypot(
      firstModel[0] - secondModel[0],
      firstModel[1] - secondModel[1],
      firstModel[2] - secondModel[2],
    ) / state.unitsPerMm;
    if (photoLength > 0 && modelLengthMm > 1e-6) ratios.push(photoLength / modelLengthMm);
  }
  ratios.sort((first, second) => first - second);
  return ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
}

function controlledMarkerPixelsPerMm(
  state: WorkflowIncisionState,
  frame: PhotoPlanningFrameState,
  point: { x: number; y: number },
  photoLandmarks: readonly Vec3[],
): number | null {
  if (state.controlledMarkerScale?.sourceRevision === frame.revision) {
    return state.controlledMarkerScale.pixelsPerMm;
  }
  const pixelsPerMm = stablePhotoPixelsPerMm(
    photoLandmarks,
    frame.triangles,
    state.verts,
    state.unitsPerMm,
  );
  if (pixelsPerMm && pixelsPerMm > 0) {
    state.controlledMarkerScale = { sourceRevision: frame.revision, pixelsPerMm };
    return pixelsPerMm;
  }
  return photoPixelsPerMmAt(state, point, photoLandmarks);
}

function workflowPhotoProjection(
  state: WorkflowIncisionState,
  frame: PhotoPlanningFrameState,
): { surfaceLandmarks: Vec3[]; skinVisible: VisibilityPredicate | null } | null {
  if (frame.kind !== "image" || !frame.landmarks?.length) return null;
  if (state.photoFrameRevision === frame.revision && state.photoFrameLandmarks === frame.landmarks) {
    return { surfaceLandmarks: state.photoSurfaceLandmarks, skinVisible: state.photoSkinVisible };
  }
  state.controlledMarkerScale = null;
  state.photoFrameRevision = frame.revision;
  state.photoFrameLandmarks = frame.landmarks;
  state.photoSurfaceLandmarks = buildForeheadSurfaceLandmarks(frame.landmarks);
  state.photoSkinVisible = null;
  if (frame.source && frame.width > 0 && frame.height > 0) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = frame.width;
      canvas.height = frame.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        context.drawImage(frame.source as CanvasImageSource, 0, 0, frame.width, frame.height);
        state.photoSkinVisible = incisionPhotoSkinVisibility(
          context,
          frame.width,
          frame.height,
          [...frame.landmarks],
        );
      }
    } catch {
      state.photoSkinVisible = null;
    }
  }
  state.cachedPhotoGeometry = null;
  state.cachedGeometryFrameRevision = null;
  state.photoEllipseBoundaryCache = null;
  return { surfaceLandmarks: state.photoSurfaceLandmarks, skinVisible: state.photoSkinVisible };
}

function workflowSurfaceRefAtSource(
  state: WorkflowIncisionState,
  frame: PhotoPlanningFrameState,
  point: { x: number; y: number },
): SurfaceRef | null {
  const projection = workflowPhotoProjection(state, frame);
  if (!projection || !frame.landmarks?.length) return null;
  const ref = sourcePointToSurfaceRef(point, projection.surfaceLandmarks, state.tris);
  if (!ref) return null;
  const rawRef = sourcePointToSurfaceRef(point, frame.landmarks, state.tris);
  if (!rawRef && projection.skinVisible && !projection.skinVisible([point.x, point.y, 0])) return null;
  return ref;
}

function workflowPhotoGeometry(
  state: WorkflowIncisionState,
  frame: PhotoPlanningFrameState,
): IncisionPhotoGeometry | null {
  if (
    state.cachedGeometryRevision === state.geometryRevision
    && state.cachedGeometryFrameRevision === frame.revision
  ) return state.cachedPhotoGeometry;
  state.cachedGeometryRevision = state.geometryRevision;
  state.cachedGeometryFrameRevision = frame.revision;
  state.cachedPhotoGeometry = null;
  const projection = workflowPhotoProjection(state, frame);
  const candidate = state.result?.candidate;
  if (!projection || !frame.landmarks?.length || !candidate?.polyline?.length) return null;
  const candidatePath = candidate.type === "linear"
    ? workflowCenteredLinearPath(candidate.polyline, candidate.center || state.result?.tumor?.center)
    : candidate.polyline;
  const candidateRefs = pointsToSurfaceRefs(candidatePath, state.verts, state.tris);
  const endpointRefs = candidateEndpointSurfaceRefs(
    candidatePath,
    candidateRefs,
    candidate.endpoints || [],
    state.verts,
    state.tris,
  );
  const boundaryRefs = state.kind === "cutaneous"
    ? state.boundaryRefs.length >= 3
      ? state.boundaryRefs
      : ellipseBoundaryRefs(state)
    : [];
  const layerContract = incisionPhotoLayerContract(state.kind, candidate.type);
  const needsPhotoScale = layerContract.showDiameterEstimate
    || (state.kind === "cutaneous" && !state.controlledBoundary && state.boundaryMode === "ellipse");
  const photoPixelsPerMm = needsPhotoScale
    ? stablePhotoPixelsPerMm(
      projection.surfaceLandmarks,
      frame.triangles,
      state.verts,
      state.unitsPerMm,
    )
    : null;
  const centerSource = state.centerRef
    ? surfaceRefToSourcePoint(state.centerRef, projection.surfaceLandmarks, state.tris)
    : null;
  const photoBoundary = state.kind === "cutaneous"
    && !state.controlledBoundary
    && state.boundaryMode === "ellipse"
    && centerSource
    && photoPixelsPerMm
    ? workflowPhotoEllipseBoundary({
      center: centerSource,
      diameterMm: state.diameterMm,
      ellipseRatio: state.ellipseRatio,
      pixelsPerMm: photoPixelsPerMm,
    }).map((point) => [point.x, point.y, 0] as Vec3)
    : undefined;
  state.cachedPhotoGeometry = buildIncisionPhotoGeometry({
    landmarks: [...frame.landmarks],
    surfaceLandmarks: projection.surfaceLandmarks,
    triangles: state.tris,
    atlasLines: activeAtlas(state)?.lines || [],
    centerRef: state.centerRef,
    diameterEstimateRefs: [],
    photoDiameterEstimateMm: layerContract.showDiameterEstimate ? state.diameterMm : undefined,
    photoPixelsPerMm: photoPixelsPerMm || undefined,
    candidateLengthMm: Number(candidate.length_mm),
    boundaryRefs,
    photoBoundary,
    candidateRefs,
    endpointRefs,
    candidateType: candidate.type,
    candidateAspectRatio: candidate.type === "fusiform"
      ? Number(candidate.length_mm) / Math.max(1e-9, Number(candidate.width_mm))
      : undefined,
    candidateAxisCoverageRatio: candidate.type === "fusiform"
      ? Number(candidate.metrics?.axis_coverage_required_mm || 0) / Math.max(1e-9, Number(candidate.length_mm))
      : undefined,
    candidateTipAngleDeg: candidate.type === "fusiform" ? Number(candidate.tip_angle_deg) : undefined,
    candidateSkinVisible: projection.skinVisible || undefined,
  });
  return state.cachedPhotoGeometry;
}

function ellipseBoundaryPoints(state: WorkflowIncisionState, samples = 32): Vec3[] {
  const center = modelPoint(state, state.centerRef);
  if (!center) return [];
  const normal = state.normals[nearestVertex(state, center)] || [0, 0, 1];
  const { u, v } = tangentFrame(normal, [0, 1, 0]);
  const radius = state.diameterMm / 2 * state.unitsPerMm;
  const ratio = state.ellipseRatio / 100;
  return Array.from({ length: samples }, (_, index) => {
    const angle = index / samples * Math.PI * 2;
    return add3(add3(center, scale3(u, Math.cos(angle) * radius)), scale3(v, Math.sin(angle) * radius * ratio));
  });
}

function ellipseBoundaryRefs(state: WorkflowIncisionState): SurfaceRef[] {
  const frame = sourceState.planning2d?.getFrameState();
  const projection = frame?.kind === "image" ? workflowPhotoProjection(state, frame) : null;
  const centerSource = state.centerRef && projection
    ? surfaceRefToSourcePoint(state.centerRef, projection.surfaceLandmarks, state.tris)
    : null;
  const pixelsPerMm = projection && frame
    ? stablePhotoPixelsPerMm(projection.surfaceLandmarks, frame.triangles, state.verts, state.unitsPerMm)
    : null;
  if (frame && projection && centerSource && pixelsPerMm && pixelsPerMm > 0) {
    const key = [
      frame.revision,
      state.centerRef?.tri,
      state.centerRef?.u,
      state.centerRef?.v,
      state.centerRef?.w,
      state.diameterMm,
      state.ellipseRatio,
      pixelsPerMm,
    ].join(":");
    if (state.photoEllipseBoundaryCache?.key === key) return state.photoEllipseBoundaryCache.refs;
    const sourceBoundary = workflowPhotoEllipseBoundary({
      center: centerSource,
      diameterMm: state.diameterMm,
      ellipseRatio: state.ellipseRatio,
      pixelsPerMm,
    });
    const refs = sourceBoundary.map((point) => sourcePointToSurfaceRef(point, projection.surfaceLandmarks, state.tris));
    if (sourceBoundary.length > 0 && refs.every((ref): ref is SurfaceRef => Boolean(ref))) {
      state.photoEllipseBoundaryCache = { key, refs };
      return refs;
    }
  }
  return pointsToSurfaceRefs(ellipseBoundaryPoints(state), state.verts, state.tris);
}

function boundaryPoints(state: WorkflowIncisionState): Vec3[] {
  if (state.kind !== "cutaneous") return [];
  if ((state.controlledBoundary || state.boundaryMode === "freehand") && state.boundaryRefs.length >= 3) {
    return state.boundaryRefs.map((ref) => modelPoint(state, ref)).filter((point): point is Vec3 => Boolean(point));
  }
  const refs = ellipseBoundaryRefs(state);
  return refs.length >= 3
    ? refs.map((ref) => modelPoint(state, ref)).filter((point): point is Vec3 => Boolean(point))
    : ellipseBoundaryPoints(state);
}

function currentTumor(state: WorkflowIncisionState) {
  const center = modelPoint(state, state.centerRef);
  if (!center) return null;
  return withControlledMarkerProvenance(buildTumorInput({
    kind: state.kind,
    center,
    diameterMm: state.diameterMm,
    depthMm: state.depthMm,
    marginMm: state.marginMm,
    boundary: boundaryPoints(state),
    boundaryMode: state.controlledBoundary ? "freehand" : state.boundaryMode,
    author: state.author,
  }), state.controlledBoundary);
}

function tumorPresentation(state: WorkflowIncisionState) {
  const tumor = currentTumor(state);
  if (!tumor) {
    return {
      boundaryStatus: "皮表边界：等待选择肿物",
      boundaryStatusWarn: false,
      pickState: "当前点位：未选择。请在中央照片上选择肿物。",
      anatomyPreview: "当前点位分区：待选择",
      anatomyPreviewWarn: false,
    };
  }
  const center = tumor.center as Vec3;
  const anatomy = classifyRegion(center, state.verts);
  const normal = state.normals[nearestVertex(state, center)] || [0, 0, 1];
  const axis = state.result?.candidate?.axis || [1, 0, 0];
  const summary = summarizeTumorBoundary(tumor, axis, normal, state.unitsPerMm);
  const warnings = summary.warnings || [];
  const boundaryStatus = tumor.kind === "cutaneous"
    ? summary.boundary_used
      ? `皮表边界：${summary.point_count} 点 · 横向 ${Number(summary.perp_diameter_mm || 0).toFixed(1)} mm${warnings.length ? ` · ${warnings.map((item: DynamicRecord) => guardrailLabel(item.code)).join("；")}` : ""}`
      : "皮表边界：当前按中心直径近似"
    : `皮下范围：直径估计 ${state.diameterMm.toFixed(1)} mm（非真实边界）`;
  const reasons = anatomy.confidence_reasons || [];
  return {
    boundaryStatus,
    boundaryStatusWarn: warnings.length > 0,
    pickState: state.controlledBoundary ? "当前点位：受控标记已确认" : "当前点位：已在共享照片画布选择",
    anatomyPreview: `当前点位分区：${regionLabel(anatomy.region)} / ${subunitLabel(anatomy.subunit)} · 置信 ${Math.round((anatomy.confidence || 0) * 100)}%${reasons.length ? ` · ${reasons.map(reasonLabel).join("；")}` : ""}`,
    anatomyPreviewWarn: (anatomy.confidence || 0) < 0.55 || reasons.includes("near_sensitive_free_margin"),
  };
}

function resultView(state: WorkflowIncisionState): IncisionResultViewState {
  if (!state.result) return EMPTY_RESULT_VIEW;
  const tumorQuality = state.result.tumor_quality || summarizeTumorInputQuality(state.result.tumor);
  const presentation = buildIncisionResultPresentation({
    result: state.result,
    workflowGate: workflowTraceGate(state.result),
    tumorQuality,
    secondaryCuesPresent: Boolean(state.secondaryCues),
    generationCount: state.generationCount,
    headStatusLabel: state.headAsset?.statusLabel,
    privacyAudit: privacyAudit(state),
  });
  return {
    candidateType: presentation.candidateType,
    candidateLength: presentation.candidateLength,
    candidateWidth: presentation.candidateWidth,
    candidateTipAngle: presentation.candidateTipAngle,
    rstlDeviation: presentation.candidateRstlDeviation,
    directionConfidence: presentation.directionConfidence.text,
    directionTitle: presentation.directionConfidence.title || "",
    region: presentation.region.text,
    regionTitle: presentation.region.title || "",
    guardrailLabel: presentation.guardrailValue.text,
    guardrailWarn: Boolean(presentation.guardrailValue.color),
    workflowSummary: presentation.workflowSummary,
    directionSource: presentation.directionSource.text,
    directionSourceWarn: Boolean(presentation.directionSource.classNames?.includes("warn")),
    workflowGate: presentation.workflowGate.text,
    workflowGateWarn: Boolean(presentation.workflowGate.classNames?.includes("warn")),
    workflowGateTitle: presentation.workflowGate.title || "",
    workflowComparison: presentation.workflowComparison.text,
    workflowComparisonWarn: Boolean(presentation.workflowComparison.classNames?.includes("warn")),
    workflowComparisonTitle: presentation.workflowComparison.title || "",
    nextStep: presentation.nextStep,
    guardrailDetails: presentation.guardrailDetails.text,
    guardrailDetailsWarn: Boolean(presentation.guardrailDetails.classNames?.includes("warn")),
    guardrailDetailsDanger: Boolean(presentation.guardrailDetails.classNames?.includes("danger")),
  };
}

function publish(state: WorkflowIncisionState, reason = "state_update") {
  if (!state.mounted) return;
  state.geometryRevision += 1;
  const frame = sourceState.planning2d?.getFrameState();
  if (state.result && frame?.kind === "image") {
    const geometry = workflowPhotoGeometry(state, frame);
    const candidateDisplayBlocked = state.result.candidate_display_blocked === true;
    if (geometry) {
      const photoStatus = incisionPhotoStatusPresentation({
        rstlLineCount: geometry.rstl.length,
        candidateDisplayBlocked,
        engineeringBlockMessage: engineeringBlockMessage(state.result),
        candidateProjectionValid: geometry.candidateProjection.valid,
        candidatePointCount: geometry.candidate.length,
        candidateSmoothingMode: geometry.candidateProjection.smoothingMode,
        candidateReferenceAspectRatio: geometry.candidateProjection.referenceAspectRatio,
        projectedRstlDeviationDeg: geometry.projectedRstlDeviationDeg,
      });
      const genericGeneratedStatus = /候选已生成|候选生成并等待审阅/.test(state.stageStatus);
      if (candidateDisplayBlocked || !geometry.candidateProjection.valid || genericGeneratedStatus) {
        setStatus(state, photoStatus.message, photoStatus.tone === "warning" ? "warning" : "normal");
      }
    } else if (candidateDisplayBlocked) {
      setStatus(state, engineeringBlockMessage(state.result), "warning");
    }
  }
  const tumorUi = tumorPresentation(state);
  dispatchControllerEvent(INCISION_CONTROLLER_STATE_EVENT, buildIncisionControllerSnapshot({
    reason,
    stageStatus: state.stageStatus,
    stageStatusTone: state.stageStatusTone,
    stageBusy: state.loading || state.workflowBusy || state.markerBusy,
    assetLoading: buildIncisionAssetLoadingSnapshot({
      visible: state.loading,
      text: state.loading ? "正在加载 MediaPipe 面部拓扑与 RSTL 规划资产。" : "切口规划资产已加载。",
    }),
    headAsset: state.headAsset || fallbackHeadAsset(),
    tumor: {
      kind: state.kind,
      author: state.author,
      diameterMm: state.diameterMm,
      depthMm: state.kind === "subcutaneous" ? state.depthMm : null,
      marginMm: state.kind === "cutaneous" ? state.marginMm : 0,
      ellipseRatio: state.kind === "cutaneous" ? state.ellipseRatio : null,
      boundaryMode: state.boundaryMode,
      boundaryActive: state.boundaryActive,
      boundaryPointCount: state.boundaryRefs.length,
      ...tumorUi,
    },
    secondaryCue: buildIncisionSecondaryCueSnapshot({
      present: Boolean(state.secondaryCues),
      stateLabel: state.secondaryCues ? "低置信度 · 需医生确认" : "未导入",
      summary: state.secondaryCues
        ? `来源：${state.secondaryCues.source} · ${state.secondaryCues.source_tool}；只读展示，不参与几何生成。`
        : undefined,
      manualConfirmed: secondaryCueSummary(state).manual_confirmed,
    }),
    privacyAudit: buildIncisionPrivacyAuditSnapshot({
      stateLabel: "浏览器本地",
      message: `不上传原始影像；${privacyAudit(state).local_workflow_fields.length} 类抽象字段只在浏览器确定性 workflow 内处理。`,
    }),
    review: buildIncisionReviewSnapshot({
      status: state.review.status,
      reviewer: state.review.reviewer,
      notesPresent: Boolean(state.review.notes),
    }),
    edit: buildIncisionEditSnapshot({ undoDisabled: true, redoDisabled: true }),
    candidate: buildIncisionCandidateSnapshot(state.result),
    resultView: resultView(state),
    savedCandidates: buildIncisionSavedCandidateSummaries({
      records: state.saved as any,
      comparisons: compareCandidateRecords(state.saved),
      reviewStatusLabel,
    }),
    workflowRuntime: state.result?.workflow_runtime || null,
    savedCount: state.saved.length,
    workflowTools: {
      photoReady: workflowPhotoReady(state),
      selectionMode: state.selectionMode,
      controlledMarkerMode: state.markerMode,
      markerBusy: state.markerBusy,
      repairAvailable: state.repairAvailable,
      repairMode: state.repairMode,
      repairCount: state.repairStrokes.length,
      scanDiameterMm: state.scanDiameterMm,
      minimumScanDiameterMm: minimumWorkflowMarkerScanDiameterMm(state.diameterMm),
    },
  }));
  scheduleOverlayDraw(state);
}

function publishLiveOverlayState(
  state: WorkflowIncisionState,
  loaded: boolean,
  qaLabel: string | null,
  reason: string,
) {
  if (!state.liveSnapshot) return;
  if (!workflowLiveOverlayChanged(state.liveSnapshot.incisionOverlay, loaded, qaLabel)) return;
  state.liveSnapshot = {
    ...state.liveSnapshot,
    reason,
    incisionOverlay: { loaded, qaLabel },
    updatedAt: new Date().toISOString(),
  };
  dispatchControllerEvent(LIVE_CONTROLLER_STATE_EVENT, state.liveSnapshot);
}

function invalidateCandidate(state: WorkflowIncisionState, message?: string) {
  const hadActiveOverlay = Boolean(renderState.incisionOverlay) || state.liveSnapshot?.incisionOverlay?.loaded === true;
  state.workflowRequestId += 1;
  state.workflowBusy = false;
  state.result = null;
  state.review.status = "pending_clinician_confirmation";
  renderState.incisionOverlay = null;
  publishLiveOverlayState(state, false, null, "workflow_incision_invalidated");
  if (message) setStatus(state, message, "warning");
  sourceState.planning2d?.setOverlaySummary({ candidatePointCount: 0 });
  if (workflowInvalidationNeedsLiveFrame(hadActiveOverlay)) requestFrame();
}

function resetMarkerRepair(state: WorkflowIncisionState) {
  state.markerRequestId += 1;
  state.markerBusy = false;
  state.repairAvailable = false;
  state.repairMode = false;
  state.repairStrokes = [];
  state.repairDrawing = null;
  state.markerSeed = null;
  state.markerSourceRevision = null;
  drawRepairStrokes(state);
}

function workflowPhotoReady(state: WorkflowIncisionState) {
  const frame = sourceState.planning2d?.getFrameState();
  return !state.loading
    && state.tris.length > 0
    && frame?.kind === "image"
    && Boolean(frame.source)
    && Boolean(frame.landmarks?.length);
}

function markerRequestSnapshot(state: WorkflowIncisionState): WorkflowMarkerRequestSnapshot {
  return {
    kind: state.kind,
    diameterMm: state.diameterMm,
    depthMm: state.depthMm,
    marginMm: state.marginMm,
    scanDiameterMm: state.scanDiameterMm,
    author: state.author,
  };
}

function syncSelection(state: WorkflowIncisionState) {
  const planning = sourceState.planning2d;
  if (!planning) return;
  const refs = state.kind === "cutaneous"
    ? state.boundaryRefs.length >= 3
      ? state.boundaryRefs
      : ellipseBoundaryRefs(state)
    : [];
  planning.setSelection({ centerRef: state.centerRef, boundaryRefs: refs });
  planning.setOverlaySummary({
    tumorVisible: Boolean(state.centerRef),
    candidatePointCount: state.result?.candidate_display_blocked === true
      ? 0
      : state.result?.candidate?.polyline?.length || 0,
  });
}

function activeAtlas(state: WorkflowIncisionState) {
  const lines = modelState.atlases[renderState.system];
  if (lines?.length && state.headAsset) {
    const personalized = lines !== modelState.officialAtlases[renderState.system];
    state.headAsset = {
      ...state.headAsset,
      atlasLineCount: lines.length,
      mode: personalized ? "mediapipe_personalized" : "mediapipe_standard",
      atlasProvenance: personalized ? "current_live_runtime" : state.headAsset.atlasProvenance,
      atlasContract: modelState.atlasContracts[renderState.system] || state.headAsset.atlasContract,
      statusLabel: personalized ? "当前 Live 个性化 RSTL" : "当前 Live 标准 RSTL",
    };
  }
  return lines?.length ? { ...(state.atlas || {}), system: renderState.system, lines } : state.atlas;
}

function ensureWorker(state: WorkflowIncisionState) {
  if (state.worker || state.workerFailed) return state.worker;
  try {
    state.worker = createWorkflowWorkerClient();
  } catch {
    state.workerFailed = true;
  }
  return state.worker;
}

async function runWorkflow(state: WorkflowIncisionState, explicit = false) {
  const tumor = currentTumor(state);
  if (!tumor || !state.verts.length || !state.tris.length || !state.atlas) {
    setStatus(state, state.loading ? "切口规划资产仍在加载" : "请先在照片上选择肿物位置", "warning");
    publish(state, "workflow_not_ready");
    return;
  }
  invalidateCandidate(state);
  const requestId = ++state.workflowRequestId;
  state.workflowBusy = true;
  setStatus(state, "Worker 确定性 workflow 生成中…");
  publish(state, "workflow_running");
  const frame = sourceState.planning2d?.getFrameState();
  const sourceRevision = frame?.kind === "image" ? frame.revision : null;
  const photoProjection = frame ? workflowPhotoProjection(state, frame) : null;
  const atlas = activeAtlas(state);
  const directionOverride = frame?.source && frame.landmarks?.length && state.centerRef
    ? queryIncisionPhotoRstlDirection({
      centerRef: state.centerRef,
      vertices: state.verts,
      landmarks: frame.landmarks,
      surfaceLandmarks: photoProjection?.surfaceLandmarks || frame.surfaceLandmarks,
      triangles: state.tris,
      atlasLines: atlas?.lines || [],
    })
    : null;
  const center = tumor.center as Vec3;
  const normal = state.normals[nearestVertex(state, center)] || [0, 0, 1];
  try {
    const execution = await planIncisionWithWorkflowFallback({
      client: ensureWorker(state),
      request: { tumor, verts: state.verts, tris: state.tris, atlas, normal, directionOverride },
    });
    if (!state.mounted || requestId !== state.workflowRequestId) return;
    if (sourceRevision !== null && sourceState.planning2d?.getFrameState().revision !== sourceRevision) {
      state.workflowBusy = false;
      setStatus(state, "照片在候选生成期间已变化，旧结果已丢弃；请在新照片上重新选择肿物。", "warning");
      publish(state, "workflow_stale_source");
      return;
    }
    state.result = execution.result;
    state.workflowBusy = false;
    if (explicit) state.generationCount += 1;
    state.review.status = "pending_clinician_confirmation";
    const lengthLimit = state.kind === "subcutaneous"
      ? workflowSubcutaneousLengthLimit(state.result?.candidate, state.diameterMm)
      : null;
    if (lengthLimit) {
      if (lengthLimit.deficitMm > 0) {
        setStatus(
          state,
          `当前皮下线性候选达到草案长度上限 ${lengthLimit.lengthMm.toFixed(1)} mm，短于病灶直径 ${lengthLimit.diameterMm.toFixed(1)} mm；该候选已被高等级覆盖门禁拦截，不能按普通候选通过。`,
          "warning",
        );
      } else {
        setStatus(
          state,
          `当前皮下线性候选已达到草案长度上限 ${lengthLimit.lengthMm.toFixed(1)} mm；继续增大病灶直径时切口不会再增长。请先由医生确认术式和长度规则，不能把该上限当作通用手术规则。`,
          "warning",
        );
      }
    } else {
      setStatus(
        state,
        execution.statusMessage || "候选已生成；请完成医生审阅，门禁通过后将在当前画布自动激活。",
        execution.workerFailed || !state.result?.guardrails?.passed ? "warning" : "normal",
      );
    }
    syncSelection(state);
    publish(state, "candidate_result");
  } catch (error) {
    if (!state.mounted || requestId !== state.workflowRequestId) return;
    state.workflowBusy = false;
    setStatus(state, `候选生成失败：${error instanceof Error ? error.message : String(error)}`, "warning");
    publish(state, "workflow_failed");
  }
}

function resultWithCenteredLinearPath(result: DynamicRecord): DynamicRecord {
  const candidate = result?.candidate;
  if (candidate?.type !== "linear" || !Array.isArray(candidate.polyline)) return result;
  const center = candidate.center || result?.tumor?.center;
  return {
    ...result,
    candidate: {
      ...candidate,
      polyline: workflowCenteredLinearPath(candidate.polyline, center),
    },
  };
}

function boundarySummary(state: WorkflowIncisionState, result: DynamicRecord) {
  const tumor = result.tumor || currentTumor(state);
  if (!tumor) return {};
  const center = tumor.center as Vec3;
  const normal = state.normals[nearestVertex(state, center)] || [0, 0, 1];
  return summarizeTumorBoundary(tumor, result.candidate?.axis || [1, 0, 0], normal, state.unitsPerMm);
}

function buildRecord(state: WorkflowIncisionState, result = state.result, label = "候选", forceDraft = false) {
  if (!result) return null;
  const recordResult = resultWithCenteredLinearPath(result);
  const createdAt = new Date().toISOString();
  const rawReview = { ...currentReview(state), reviewed_at: createdAt };
  const normalized = reviewForCandidateRecord({ review: rawReview, result: recordResult, forceDraft });
  const review = { ...normalized.review, label: reviewStatusLabel(normalized.review.status) };
  const gate = buildReviewGate({
    review,
    result: recordResult,
    topologyId: state.headAsset?.topologyId,
    topologyVersion: state.headAsset?.topologyVersion,
  });
  return buildIncisionReviewRecord({
    result: recordResult,
    label,
    createdAt,
    review,
    reviewGate: gate,
    tumorQuality: recordResult.tumor_quality || summarizeTumorInputQuality(recordResult.tumor),
    tumorBoundarySummary: boundarySummary(state, recordResult),
    headAsset: state.headAsset,
    secondaryCues: secondaryCueSummary(state),
    candidateEditSession: buildCandidateEditSession(recordResult, { undoAvailable: false, redoAvailable: false }),
    sensitiveStructureInspection: findSensitiveStructureInspection(recordResult),
    privacyAudit: privacyAudit(state),
  });
}

function activateRecord(state: WorkflowIncisionState, record: DynamicRecord) {
  const overlay = compileIncisionOverlay(record, state.verts, state.tris);
  if (!overlay) {
    renderState.incisionOverlay = null;
    publishLiveOverlayState(state, false, null, "workflow_incision_overlay_blocked");
    setStatus(state, "候选未通过自动叠加门禁；已保留为审阅记录。", "warning");
    requestFrame();
    return false;
  }
  renderState.incisionOverlay = overlay;
  publishLiveOverlayState(state, true, "已自动激活", "workflow_incision_overlay_activated");
  setStatus(state, "审阅门禁已通过；候选已在当前画布自动激活，切换同一受试者的视频或摄像头后会自动重投影。");
  requestFrame();
  return true;
}

function saveReview(state: WorkflowIncisionState) {
  const review = currentReview(state);
  const readiness = assessReviewReadiness({ ...review, result: state.result });
  if (!readiness.ok) {
    state.review.status = "pending_clinician_confirmation";
    renderState.incisionOverlay = null;
    publishLiveOverlayState(state, false, null, "workflow_incision_review_blocked");
    setStatus(state, readiness.message, "warning");
    requestFrame();
    publish(state, "review_blocked");
    return;
  }
  const record = buildRecord(state, state.result, "当前候选");
  if (!record) {
    setStatus(state, "没有可保存的候选", "warning");
    publish(state, "review_missing_candidate");
    return;
  }
  state.saved = [...state.saved.filter((item) => item.id !== record.id), record];
  if (review.status === "approved_for_discussion") activateRecord(state, record);
  else {
    renderState.incisionOverlay = null;
    publishLiveOverlayState(state, false, null, "workflow_incision_review_changed");
    setStatus(state, `已保存${reviewStatusLabel(review.status)}；活动候选已撤销。`, review.status === "pending_clinician_confirmation" ? "normal" : "warning");
    requestFrame();
  }
  publish(state, "review_saved");
}

function saveCurrent(state: WorkflowIncisionState, label = `候选 ${state.saved.length + 1}`, forceDraft = false) {
  const record = buildRecord(state, state.result, label, forceDraft);
  if (!record) {
    setStatus(state, "没有可保存的候选", "warning");
    publish(state, "candidate_save_missing");
    return;
  }
  state.saved.push(record);
  setStatus(state, `已保存${label}`);
  publish(state, "candidate_saved");
}

function exportAllowed(state: WorkflowIncisionState, payload: unknown, label: string) {
  const report = auditExportPayload(payload);
  if (report.passed) return true;
  setStatus(state, `${label}已阻断：隐私预检发现 ${report.violation_count} 个问题。`, "warning");
  publish(state, "privacy_preflight_failed");
  return false;
}

function exportReview(state: WorkflowIncisionState) {
  const current = buildRecord(state, state.result, "当前候选");
  const payload = buildReviewExportPayload({ current, saved: state.saved, secondaryCues: secondaryCueSummary(state) });
  if (!exportAllowed(state, payload, "审阅 JSON 导出")) return;
  downloadText(`incision_review_${Date.now()}.json`, JSON.stringify(payload, null, 2));
}

function exportTumor(state: WorkflowIncisionState) {
  const tumor = currentTumor(state);
  if (!tumor) {
    setStatus(state, "请先选择肿物位置", "warning");
    publish(state, "tumor_export_missing");
    return;
  }
  const payload = buildTumorExportPayload({
    tumor,
    tumorQuality: summarizeTumorInputQuality(tumor),
    boundarySummary: boundarySummary(state, { tumor, candidate: state.result?.candidate || {} }),
  });
  if (!exportAllowed(state, payload, "肿物输入 JSON 导出")) return;
  downloadText(`tumor_input_${Date.now()}.json`, JSON.stringify(payload, null, 2));
}

function requestFile(state: WorkflowIncisionState, id: string) {
  (rootInput(state, id) as HTMLInputElement | null)?.click();
}

async function importTumor(state: WorkflowIncisionState, file: File) {
  try {
    const imported = importedTumorFormState(JSON.parse(await file.text()), {
      diameterMin: 4,
      diameterMax: 40,
      depthMin: 0,
      depthMax: 35,
      depthFallback: state.depthMm,
      marginMin: 0,
      marginMax: 10,
      authorFallback: state.author,
    });
    resetMarkerRepair(state);
    state.markerMode = false;
    state.markerPointerSource = null;
    state.markerPreviewSuppressed = false;
    state.kind = imported.kind === "subcutaneous" ? "subcutaneous" : "cutaneous";
    state.diameterMm = Number(imported.diameterValue);
    state.depthMm = Number(imported.depthValue);
    state.marginMm = Number(imported.marginValue);
    state.author = imported.author;
    state.boundaryMode = imported.boundaryMode;
    state.centerRef = pointToSurfaceRef(imported.tumor.center as Vec3, state.verts, state.tris);
    state.boundaryRefs = pointsToSurfaceRefs(imported.boundaryPoints, state.verts, state.tris);
    state.controlledBoundary = imported.tumor.source === "detector_confirmed";
    syncSelection(state);
    await runWorkflow(state);
    setStatus(state, "已导入肿物输入并重新生成候选");
    publish(state, "tumor_imported");
  } catch (error) {
    setStatus(state, `导入肿物失败：${error instanceof Error ? error.message : String(error)}`, "warning");
    publish(state, "tumor_import_failed");
  }
}

async function importSecondaryCue(state: WorkflowIncisionState, file: File) {
  try {
    state.secondaryCues = normalizeSecondaryCuePayload(JSON.parse(await file.text()));
    setStatus(state, "已导入低置信辅助线索；候选几何未改变。");
    publish(state, "secondary_cue_imported");
  } catch (error) {
    setStatus(state, `导入辅助线索失败：${error instanceof Error ? error.message : String(error)}`, "warning");
    publish(state, "secondary_cue_import_failed");
  }
}

function controlledMarkerRepairable(detection: ControlledMarkerDetection) {
  if (["scan_range_too_small", "edge_discontinuous", "unstable_enclosure"].includes(String(detection.failure_code))) return true;
  const stage = String(detection.diagnostics?.failure_stage || "");
  return detection.failure_code === "seed_not_enclosed" && [
    "seed_region_leaks_to_roi_border",
    "boundary_support_low",
    "boundary_support_missing",
    "radial_boundary_incomplete",
    "radial_boundary_requires_endpoint_confirmation",
  ].includes(stage);
}

function drawRepairsToContext(state: WorkflowIncisionState, context: CanvasRenderingContext2D) {
  for (const stroke of state.repairStrokes) {
    if (!stroke.points.length) continue;
    context.beginPath();
    context.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = stroke.widthPx;
    context.strokeStyle = "rgb(16, 18, 20)";
    context.stroke();
  }
}

async function runControlledMarker(state: WorkflowIncisionState, seed: { x: number; y: number }) {
  const frame = sourceState.planning2d?.getFrameState();
  if (state.kind !== "cutaneous") {
    setStatus(state, "受控标记仅用于皮表肿物；皮下肿物请直接选择中心。", "warning");
    publish(state, "controlled_marker_wrong_kind");
    return;
  }
  if (!frame?.source || frame.kind !== "image" || !frame.landmarks?.length) {
    setStatus(state, "请先上传并完成照片人脸检测，再使用受控标记。", "warning");
    publish(state, "controlled_marker_no_photo");
    return;
  }
  if (state.markerBusy) return;
  const started = markerRequestSnapshot(state);
  const minimumScanDiameterMm = minimumWorkflowMarkerScanDiameterMm(started.diameterMm);
  if (started.scanDiameterMm < minimumScanDiameterMm) {
    setStatus(
      state,
      `当前 ${started.scanDiameterMm} mm 扫描面小于肿物直径所需覆盖范围，请扩大到至少 ${minimumScanDiameterMm} mm 后重试。`,
      "warning",
    );
    publish(state, "controlled_marker_scan_too_small");
    return;
  }
  const photoProjection = workflowPhotoProjection(state, frame);
  if (!photoProjection) {
    setStatus(state, "当前照片无法建立切口投影表面，请重新上传正面照片。", "warning");
    publish(state, "controlled_marker_no_surface");
    return;
  }
  const pixelsPerMm = controlledMarkerPixelsPerMm(state, frame, seed, photoProjection.surfaceLandmarks);
  if (!(pixelsPerMm && pixelsPerMm > 0)) {
    setStatus(state, "当前照片无法建立毫米扫描尺度，请重新上传正面照片。", "warning");
    publish(state, "controlled_marker_no_scale");
    return;
  }
  const scanFootprint = workflowPhotoCircleFootprint(
    seed,
    started.scanDiameterMm * pixelsPerMm / 2,
  );
  const scanOpening = workflowPhotoOpeningIntersection(scanFootprint, frame.landmarks);
  // Match the standalone workflow: a retry starts from an empty shared
  // selection so a failed attempt cannot look like a newly detected lesion.
  sourceState.planning2d?.setSelection({ centerRef: null, boundaryRefs: [] });
  state.markerPreviewSuppressed = true;
  requestFrame();
  if (scanOpening) {
    setStatus(state, "识别范围进入眼裂、口裂或鼻孔等非皮肤开口；请移动扫描位置后重试。", "warning");
    publish(state, "controlled_marker_opening_scan_rejected");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    setStatus(state, "浏览器无法读取当前照片像素，受控标记未运行。", "warning");
    publish(state, "controlled_marker_no_context");
    return;
  }
  context.drawImage(frame.source as CanvasImageSource, 0, 0, frame.width, frame.height);
  drawRepairsToContext(state, context);
  const image = context.getImageData(0, 0, frame.width, frame.height);
  const requestId = ++state.markerRequestId;
  state.markerBusy = true;
  state.markerSeed = { ...seed };
  state.markerSourceRevision = frame.revision;
  setStatus(state, state.repairStrokes.length ? "正在使用人工补线重新识别肿物边界…" : "正在识别肿物边界…");
  publish(state, "controlled_marker_running");
  const options = {
    roiRadius: Math.max(8, Math.round(started.scanDiameterMm * pixelsPerMm / 2)),
    expectedDiameterPx: Math.max(1, started.diameterMm * pixelsPerMm),
    scanDiameterMm: started.scanDiameterMm,
  };
  const worker = ensureWorker(state);
  const detectionPromise = worker
    ? worker.api.detectControlledMarker(Comlink.transfer({ width: image.width, height: image.height, data: image.data }, [image.data.buffer]), seed, options)
    : Promise.resolve(detectControlledMarker(image, seed, options));
  try {
    const detection = await detectionPromise;
    if (!state.mounted || requestId !== state.markerRequestId) return;
    if (sourceState.planning2d?.getFrameState().revision !== frame.revision) {
      state.markerBusy = false;
      resetMarkerRepair(state);
      setStatus(state, "照片在识别期间已变化，旧识别结果已丢弃。", "warning");
      publish(state, "controlled_marker_stale_source");
      return;
    }
    if (!workflowMarkerRequestStillCurrent(started, markerRequestSnapshot(state))) {
      resetMarkerRepair(state);
      state.markerPreviewSuppressed = state.markerMode;
      setStatus(state, "识别期间肿物类型、参数、扫描范围或记录者发生变化；为避免套用旧结果，请重新点击标记。", "warning");
      publish(state, "controlled_marker_stale_parameters");
      return;
    }
    state.markerBusy = false;
    if (!detection.ok || !detection.center || detection.geometry_mode !== "enclosed_region") {
      state.repairAvailable = controlledMarkerRepairable(detection) || state.repairStrokes.length > 0;
      setStatus(
        state,
        `${controlledMarkerFailureMessage(detection)}${state.repairAvailable ? "可扩大扫描范围，或启用补线后沿照片中确实可见的缺口描画。" : "受控标记保持开启，可直接换位置重试。"}`,
        "warning",
      );
      publish(state, "controlled_marker_failed");
      return;
    }
    const detectedFootprint = detection.boundary.length >= 3
      ? detection.boundary
      : workflowPhotoCircleFootprint(detection.center, started.diameterMm * pixelsPerMm / 2);
    if (workflowPhotoOpeningIntersection(detectedFootprint, frame.landmarks)) {
      state.repairAvailable = true;
      setStatus(state, "识别范围进入眼裂、口裂或鼻孔等非皮肤开口；请移动扫描位置后重试。", "warning");
      publish(state, "controlled_marker_opening_photo_rejected");
      return;
    }
    const centerRef = sourcePointToSurfaceRef(detection.center, photoProjection.surfaceLandmarks, state.tris);
    const boundaryRefs = detection.boundary
      .map((point) => sourcePointToSurfaceRef(point, photoProjection.surfaceLandmarks, state.tris))
      .filter((ref): ref is SurfaceRef => Boolean(ref));
    if (!centerRef || boundaryRefs.length < 3) {
      state.repairAvailable = true;
      setStatus(state, "识别边界跨出可映射面部区域；请换位置重试或补齐可见缺口。", "warning");
      publish(state, "controlled_marker_unmapped");
      return;
    }
    const detectedCenter = surfaceRefToModelPoint(centerRef, state.verts, state.tris);
    const detectedBoundary = boundaryRefs
      .map((ref) => surfaceRefToModelPoint(ref, state.verts, state.tris))
      .filter((point): point is Vec3 => Boolean(point));
    const detectedTumor = detectedCenter
      ? withControlledMarkerProvenance(buildTumorInput({
        kind: "cutaneous",
        center: detectedCenter,
        diameterMm: started.diameterMm,
        depthMm: started.depthMm,
        marginMm: started.marginMm,
        boundary: detectedBoundary,
        boundaryMode: "freehand",
        author: started.author,
      }), true)
      : null;
    if (!detectedTumor || !inspectTumorEngineeringExclusions(detectedTumor, state.verts).passed) {
      state.repairAvailable = true;
      setStatus(state, "识别范围进入眼裂、口裂或鼻孔等非皮肤开口；请移动扫描位置后重试。", "warning");
      publish(state, "controlled_marker_opening_rejected");
      return;
    }
    state.centerRef = centerRef;
    state.boundaryRefs = boundaryRefs;
    state.controlledBoundary = true;
    state.boundaryMode = "freehand";
    state.selectionMode = false;
    state.repairMode = false;
    state.repairAvailable = state.repairStrokes.length > 0;
    state.markerPreviewSuppressed = false;
    syncSelection(state);
    await runWorkflow(state);
    setStatus(
      state,
      `已识别受控标记边界（本地检测器 v${CONTROLLED_MARKER_DETECTOR_VERSION}），候选已生成并等待审阅。`,
      state.result?.guardrails?.passed ? "normal" : "warning",
    );
    publish(state, "controlled_marker_applied");
  } catch (error) {
    if (!state.mounted || requestId !== state.markerRequestId) return;
    state.markerBusy = false;
    setStatus(state, `受控标记识别失败：${error instanceof Error ? error.message : String(error)}`, "warning");
    publish(state, "controlled_marker_error");
  }
}

function pathData(points: Array<{ x: number; y: number }>, close = false) {
  if (!points.length) return "";
  return `M ${points.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" L ")}${close ? " Z" : ""}`;
}

function clientPoints(state: WorkflowIncisionState, refs: SurfaceRef[]) {
  const planning = sourceState.planning2d;
  const wrap = state.root.querySelector<HTMLElement>(".main-wrap");
  if (!planning || !wrap) return [];
  const frame = planning.getFrameState();
  const projection = workflowPhotoProjection(state, frame);
  if (!projection) return [];
  const rect = wrap.getBoundingClientRect();
  return refs.map((ref) => surfaceRefToSourcePoint(ref, projection.surfaceLandmarks, state.tris))
    .map((point) => point ? planning.sourceToClient({ x: point.x, y: point.y }) : null)
    .filter((point): point is { x: number; y: number } => Boolean(point))
    .map((point) => ({ x: point.x - rect.left, y: point.y - rect.top }));
}

function sourceClientPoint(state: WorkflowIncisionState, point: Vec3) {
  const planning = sourceState.planning2d;
  const wrap = state.root.querySelector<HTMLElement>(".main-wrap");
  if (!planning || !wrap) return null;
  const mapped = planning.sourceToClient({ x: point[0], y: point[1] });
  if (!mapped) return null;
  const rect = wrap.getBoundingClientRect();
  return { x: mapped.x - rect.left, y: mapped.y - rect.top };
}

function drawDraftOverlay(state: WorkflowIncisionState) {
  const svg = state.root.querySelector<SVGSVGElement>("#workflowIncisionOverlay");
  if (!svg) return;
  const frame = sourceState.planning2d?.getFrameState();
  const visible = frame?.kind === "image" && Boolean(frame.landmarks?.length) && !renderState.incisionOverlay;
  svg.style.display = visible ? "" : "none";
  if (!visible || !frame) return;
  const geometry = workflowPhotoGeometry(state, frame);
  const planningVisible = !state.markerPreviewSuppressed;
  const center = planningVisible && state.centerRef ? clientPoints(state, [state.centerRef])[0] : null;
  const tumorOutline = geometry ? workflowPhotoTumorOutline(state.kind, geometry) : [];
  const boundary = geometry
    ? planningVisible
      ? tumorOutline.map((point) => sourceClientPoint(state, point)).filter((point): point is { x: number; y: number } => Boolean(point))
      : []
    : planningVisible && state.kind === "cutaneous"
      ? clientPoints(state, state.boundaryRefs.length >= 3
        ? state.boundaryRefs
        : pointsToSurfaceRefs(ellipseBoundaryPoints(state), state.verts, state.tris))
      : [];
  const boundaryPath = svg.querySelector<SVGPathElement>("[data-workflow-boundary]");
  const candidatePath = svg.querySelector<SVGPathElement>("[data-workflow-candidate]");
  const centerCircle = svg.querySelector<SVGCircleElement>("[data-workflow-center]");
  boundaryPath?.setAttribute("d", pathData(boundary, true));
  const candidateVisible = workflowCandidateDisplayAllowed(
    state.result,
    planningVisible && Boolean(geometry?.candidateProjection.valid),
  );
  const candidatePathData = candidateVisible && geometry
    ? state.result?.candidate?.type === "fusiform"
      ? workflowFusiformSvgPath(geometry.fusiformRendering, (point) => sourceClientPoint(state, point))
        || pathData(geometry.candidate.map((point) => sourceClientPoint(state, point)).filter((point): point is { x: number; y: number } => Boolean(point)), true)
      : pathData(geometry.candidate.map((point) => sourceClientPoint(state, point)).filter((point): point is { x: number; y: number } => Boolean(point)))
    : "";
  candidatePath?.setAttribute("d", candidatePathData);
  if (center && centerCircle) {
    centerCircle.style.display = "";
    centerCircle.setAttribute("cx", String(center.x));
    centerCircle.setAttribute("cy", String(center.y));
  } else if (centerCircle) {
    centerCircle.style.display = "none";
  }
  drawRepairStrokes(state);
  drawControlledMarkerScan(state);
}

function drawControlledMarkerScan(state: WorkflowIncisionState) {
  const group = state.root.querySelector<SVGGElement>("[data-workflow-marker-scan]");
  const circle = group?.querySelector<SVGCircleElement>("[data-workflow-marker-scan-circle]");
  const label = group?.querySelector<SVGTextElement>("[data-workflow-marker-scan-label]");
  const planning = sourceState.planning2d;
  const wrap = state.root.querySelector<HTMLElement>(".main-wrap");
  const frame = planning?.getFrameState();
  const sourcePoint = state.markerPointerSource;
  if (
    !group || !circle || !label || !planning || !wrap || !sourcePoint
    || !state.markerMode || state.repairMode || state.kind !== "cutaneous"
    || frame?.kind !== "image" || !frame.landmarks?.length
  ) {
    if (group) group.style.display = "none";
    return;
  }
  const projection = workflowPhotoProjection(state, frame);
  const pixelsPerMm = projection?.surfaceLandmarks.length && frame
    ? controlledMarkerPixelsPerMm(state, frame, sourcePoint, projection.surfaceLandmarks)
    : null;
  const rect = wrap.getBoundingClientRect();
  const geometry = pixelsPerMm ? workflowScanCircleGeometry({
    sourcePoint,
    scanDiameterMm: state.scanDiameterMm,
    pixelsPerMm,
    project: (point) => {
      const mapped = planning.sourceToClient(point);
      return mapped ? { x: mapped.x - rect.left, y: mapped.y - rect.top } : null;
    },
  }) : null;
  if (!geometry) {
    group.style.display = "none";
    return;
  }
  circle.setAttribute("cx", String(geometry.center.x));
  circle.setAttribute("cy", String(geometry.center.y));
  circle.setAttribute("r", String(geometry.radius));
  label.setAttribute("x", String(geometry.center.x));
  label.setAttribute("y", String(geometry.center.y - geometry.radius - 7));
  label.textContent = `扫描 ${state.scanDiameterMm} mm`;
  group.style.display = "";
}

let overlayFrame = 0;
function scheduleOverlayDraw(state: WorkflowIncisionState) {
  if (overlayFrame || !state.mounted) return;
  overlayFrame = requestAnimationFrame(() => {
    overlayFrame = 0;
    if (state.mounted) drawDraftOverlay(state);
  });
}

function drawRepairStrokes(state: WorkflowIncisionState) {
  const group = state.root.querySelector<SVGGElement>("[data-workflow-repairs]");
  const planning = sourceState.planning2d;
  const wrap = state.root.querySelector<HTMLElement>(".main-wrap");
  if (!group || !planning || !wrap) return;
  group.replaceChildren();
  const rect = wrap.getBoundingClientRect();
  for (const stroke of [...state.repairStrokes, ...(state.repairDrawing ? [state.repairDrawing] : [])]) {
    const points = stroke.points.map((point) => planning.sourceToClient(point)).filter((point): point is { x: number; y: number } => Boolean(point))
      .map((point) => ({ x: point.x - rect.left, y: point.y - rect.top }));
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData(points));
    path.setAttribute("class", "workflow-repair-stroke");
    group.append(path);
  }
}

function handleCanvasPointerDown(state: WorkflowIncisionState, event: PointerEvent) {
  const planning = sourceState.planning2d;
  const frame = planning?.getFrameState();
  if (!planning || frame?.kind !== "image") return;
  if (state.repairMode) {
    const point = planning.clientToSource({ x: event.clientX, y: event.clientY });
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    const photoProjection = workflowPhotoProjection(state, frame);
    const pixelsPerMm = photoProjection?.surfaceLandmarks.length
      ? photoPixelsPerMmAt(state, point, photoProjection.surfaceLandmarks)
      : null;
    state.repairDrawing = { points: [point], widthPx: Math.max(2, Number(pixelsPerMm || 2) * 0.8) };
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    scheduleOverlayDraw(state);
    return;
  }
  if (!state.selectionMode && !state.markerMode && !state.boundaryActive) {
    const target = event.target;
    if (target instanceof Element && target.closest(".workflow-canvas-tools")) return;
    state.pendingClick = beginWorkflowPointerIntent(event.pointerId, event.button, event.clientX, event.clientY);
    return;
  }
  const sourcePoint = planning.clientToSource({ x: event.clientX, y: event.clientY });
  if (!sourcePoint) {
    setStatus(state, "该点击无法映射到照片，请直接在面部区域重试。", "warning");
    publish(state, "photo_click_unmapped");
    return;
  }
  if (state.markerMode) {
    event.preventDefault();
    event.stopPropagation();
    void runControlledMarker(state, sourcePoint);
    return;
  }
  const photoProjection = workflowPhotoProjection(state, frame);
  const photoLandmarks = frame.landmarks || [];
  const pixelsPerMm = photoProjection
    ? stablePhotoPixelsPerMm(photoProjection.surfaceLandmarks, frame.triangles, state.verts, state.unitsPerMm)
    : null;
  const photoOpening = state.boundaryActive
    ? workflowPhotoOpeningIntersection(workflowPhotoCircleFootprint(sourcePoint, 1), photoLandmarks)
    : pixelsPerMm
      ? workflowPhotoTumorOpeningIntersection({
        center: sourcePoint,
        kind: state.kind,
        diameterMm: state.diameterMm,
        ellipseRatio: state.ellipseRatio,
        pixelsPerMm,
        photoLandmarks,
      })
      : null;
  if (photoOpening) {
    setStatus(state, "识别范围进入眼裂、口裂或鼻孔等非皮肤开口；请在可见皮肤上重新选择。", "warning");
    publish(state, state.boundaryActive ? "tumor_boundary_opening_pick_rejected" : "tumor_opening_photo_rejected");
    return;
  }
  const ref = workflowSurfaceRefAtSource(state, frame, sourcePoint);
  if (!ref) {
    setStatus(state, "该位置不在可见人脸皮肤表面，请避开头发和背景后重试。", "warning");
    publish(state, "photo_surface_pick_rejected");
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (state.boundaryActive) {
    invalidateCandidate(state, "肿物位置或边界已变化，旧活动候选已撤销。请重新审阅。 ");
    state.boundaryRefs.push(ref);
    state.controlledBoundary = false;
    syncSelection(state);
    publish(state, "freehand_boundary_point");
    return;
  }
  const openingMessage = tumorPointEngineeringExclusionMessage(modelPoint(state, ref) || [], state.verts);
  if (openingMessage) {
    setStatus(state, openingMessage, "warning");
    publish(state, "tumor_opening_pick_rejected");
    return;
  }
  invalidateCandidate(state, "肿物位置或边界已变化，旧活动候选已撤销。请重新审阅。 ");
  state.centerRef = ref;
  state.selectionMode = false;
  state.controlledBoundary = false;
  if (state.boundaryMode === "freehand") state.boundaryRefs = [];
  syncSelection(state);
  void runWorkflow(state);
}

function handleCanvasPointerMove(state: WorkflowIncisionState, event: PointerEvent) {
  updateWorkflowPointerIntent(state.pendingClick, event.pointerId, event.clientX, event.clientY);
  if (state.markerMode && !state.repairMode) {
    state.markerPointerSource = sourceState.planning2d?.clientToSource({ x: event.clientX, y: event.clientY }) || null;
  }
  if (!state.repairDrawing) {
    scheduleOverlayDraw(state);
    return;
  }
  const point = sourceState.planning2d?.clientToSource({ x: event.clientX, y: event.clientY });
  if (!point) return;
  event.preventDefault();
  event.stopPropagation();
  const previous = state.repairDrawing.points.at(-1);
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 1) {
    state.repairDrawing.points.push(point);
    scheduleOverlayDraw(state);
  }
}

function handleCanvasPointerUp(state: WorkflowIncisionState, event: PointerEvent) {
  if (!state.repairDrawing) {
    const directSelection = completesWorkflowCanvasClick(state.pendingClick, event.pointerId);
    state.pendingClick = null;
    if (!directSelection) return;
    const planning = sourceState.planning2d;
    const frame = planning?.getFrameState();
    const sourcePoint = frame?.kind === "image"
      ? planning?.clientToSource({ x: event.clientX, y: event.clientY })
      : null;
    const photoProjection = frame && sourcePoint ? workflowPhotoProjection(state, frame) : null;
    const photoLandmarks = frame?.landmarks || [];
    const pixelsPerMm = frame && photoProjection
      ? stablePhotoPixelsPerMm(photoProjection.surfaceLandmarks, frame.triangles, state.verts, state.unitsPerMm)
      : null;
    const photoOpening = frame && sourcePoint && pixelsPerMm
      ? workflowPhotoTumorOpeningIntersection({
        center: sourcePoint,
        kind: state.kind,
        diameterMm: state.diameterMm,
        ellipseRatio: state.ellipseRatio,
        pixelsPerMm,
        photoLandmarks,
      })
      : null;
    if (photoOpening) {
      setStatus(state, "识别范围进入眼裂、口裂或鼻孔等非皮肤开口；请在可见皮肤上重新选择。", "warning");
      publish(state, "direct_tumor_opening_photo_rejected");
      return;
    }
    const ref = frame && sourcePoint ? workflowSurfaceRefAtSource(state, frame, sourcePoint) : null;
    if (!ref) {
      setStatus(state, "该位置不在可见人脸皮肤表面，请避开头发和背景后重试。", "warning");
      publish(state, "direct_surface_pick_rejected");
      return;
    }
    const openingMessage = tumorPointEngineeringExclusionMessage(modelPoint(state, ref) || [], state.verts);
    if (openingMessage) {
      setStatus(state, openingMessage, "warning");
      publish(state, "tumor_opening_pick_rejected");
      return;
    }
    event.preventDefault();
    invalidateCandidate(state, "肿物位置或边界已变化，旧活动候选已撤销。请重新审阅。 ");
    state.centerRef = ref;
    state.controlledBoundary = false;
    if (state.boundaryMode === "freehand") state.boundaryRefs = [];
    syncSelection(state);
    void runWorkflow(state);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  state.repairStrokes.push(state.repairDrawing);
  state.repairDrawing = null;
  (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
  state.repairMode = false;
  drawRepairStrokes(state);
  if (state.markerSeed) void runControlledMarker(state, state.markerSeed);
  publish(state, "marker_repair_committed");
}

function handleCanvasPointerCancel(state: WorkflowIncisionState, event: PointerEvent) {
  state.pendingClick = null;
  if (!state.repairDrawing) return;
  state.repairDrawing = null;
  (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
  drawRepairStrokes(state);
  publish(state, "marker_repair_cancelled");
}

function handleCanvasPointerLeave(state: WorkflowIncisionState) {
  state.markerPointerSource = null;
  scheduleOverlayDraw(state);
}

function applyTumorCommand(state: WorkflowIncisionState, event: Event) {
  const detail = readIncisionTumorCommand(event);
  if (!detail) return;
  const value = detail.value;
  const geometryChange = !["author_changed", "export_tumor", "import_tumor"].includes(detail.command);
  if (geometryChange) invalidateCandidate(state, "肿物参数已变化，旧活动候选已撤销。请重新审阅。");
  if (geometryChange && state.markerBusy) {
    resetMarkerRepair(state);
    state.markerPreviewSuppressed = state.markerMode;
  }
  switch (detail.command) {
    case "kind_changed":
      state.kind = value === "subcutaneous" ? "subcutaneous" : "cutaneous";
      state.boundaryActive = false;
      state.controlledBoundary = false;
      resetMarkerRepair(state);
      if (state.kind === "subcutaneous") {
        state.markerMode = false;
        state.markerPointerSource = null;
        state.markerPreviewSuppressed = false;
      } else {
        state.scanDiameterMm = workflowMarkerScanDiameterForTumor(state.scanDiameterMm, state.diameterMm);
      }
      break;
    case "diameter_input":
    case "diameter_changed":
      state.diameterMm = Number(value);
      if (state.kind === "cutaneous") {
        state.scanDiameterMm = workflowMarkerScanDiameterForTumor(state.scanDiameterMm, state.diameterMm);
      }
      break;
    case "author_changed": state.author = String(value || ""); break;
    case "depth_input":
    case "depth_changed": state.depthMm = Number(value); break;
    case "margin_input":
    case "margin_changed": state.marginMm = Number(value); break;
    case "boundary_mode_changed":
      state.boundaryMode = value === "freehand" ? "freehand" : "ellipse";
      state.boundaryActive = false;
      state.controlledBoundary = false;
      if (state.boundaryMode === "ellipse") state.boundaryRefs = [];
      break;
    case "ellipse_ratio_input":
    case "ellipse_ratio_changed": state.ellipseRatio = Number(value); break;
    case "toggle_boundary":
      state.boundaryActive = !state.boundaryActive;
      state.selectionMode = false;
      state.markerMode = false;
      if (!state.boundaryActive && state.boundaryRefs.length >= 3) void runWorkflow(state);
      break;
    case "clear_boundary":
      state.boundaryRefs = [];
      state.boundaryActive = false;
      state.controlledBoundary = false;
      break;
    case "export_tumor": exportTumor(state); return;
    case "import_tumor": requestFile(state, "tumorImportFile"); return;
    case "run_workflow": void runWorkflow(state, true); return;
  }
  syncSelection(state);
  if (["diameter_changed", "depth_changed", "margin_changed", "ellipse_ratio_changed", "kind_changed", "boundary_mode_changed"].includes(detail.command) && state.centerRef) {
    void runWorkflow(state);
  } else {
    publish(state, detail.command);
  }
}

function handleSecondaryCueCommand(state: WorkflowIncisionState, event: Event) {
  const detail = readIncisionSecondaryCueCommand(event);
  if (!detail) return;
  if (detail.command === "import_secondary_cue") requestFile(state, "secondaryCueImportFile");
  if (detail.command === "clear_secondary_cue") {
    state.secondaryCues = null;
    setStatus(state, "已清空辅助线索；候选几何未改变。");
  }
  publish(state, detail.command);
}

function handleReviewCommand(state: WorkflowIncisionState, event: Event) {
  const detail = readIncisionReviewCommand(event);
  if (!detail) return;
  currentReview(state);
  if (detail.command === "review_state_changed" && state.review.status !== "approved_for_discussion") {
    renderState.incisionOverlay = null;
    publishLiveOverlayState(state, false, null, "workflow_incision_review_changed");
    setStatus(state, "审阅状态已变化，活动候选已撤销。", "warning");
    requestFrame();
    publish(state, "review_state_changed");
    return;
  }
  if (detail.command === "save_review") saveReview(state);
}

function handleLibraryCommand(state: WorkflowIncisionState, event: Event) {
  const detail = readIncisionLibraryCommand(event);
  if (!detail) return;
  switch (detail.command) {
    case "save_current": saveCurrent(state); return;
    case "make_variants": {
      const alternatives = state.result?.candidate_alternatives || [];
      for (const alternative of alternatives) {
        const result = {
          ...state.result,
          candidate: alternative.candidate,
          original_candidate: alternative.candidate,
          guardrails: alternative.guardrails || state.result?.guardrails,
          anatomy: alternative.anatomy || state.result?.anatomy,
          sensitive_structure_inspection: alternative.sensitive_structure_inspection || state.result?.sensitive_structure_inspection,
        };
        const record = buildRecord(state, result, alternative.label || `方向备选 ${state.saved.length + 1}`, true);
        if (record) state.saved.push(record);
      }
      setStatus(state, alternatives.length ? `已保存 ${alternatives.length} 个方向备选` : "当前结果没有可保存的方向备选", alternatives.length ? "normal" : "warning");
      publish(state, "variants_saved");
      return;
    }
    case "clear_saved": state.saved = []; setStatus(state, "已清空候选库"); publish(state, "saved_cleared"); return;
    case "load_candidate": {
      const record = state.saved.find((item) => item.id === detail.id);
      if (!record) return;
      resetMarkerRepair(state);
      state.markerMode = false;
      state.markerPointerSource = null;
      state.markerPreviewSuppressed = false;
      state.result = { ...record, review_status: record.review_status };
      state.kind = record.tumor?.kind === "subcutaneous" ? "subcutaneous" : "cutaneous";
      state.diameterMm = Number(record.tumor?.diameter_mm || state.diameterMm);
      state.depthMm = Number(record.tumor?.depth_mm || state.depthMm);
      state.marginMm = Number(record.tumor?.margin_mm || 0);
      state.author = String(record.tumor?.author || state.author);
      state.centerRef = pointToSurfaceRef(record.tumor?.center, state.verts, state.tris);
      state.boundaryRefs = pointsToSurfaceRefs(record.tumor?.boundary || [], state.verts, state.tris);
      state.controlledBoundary = record.tumor?.source === "detector_confirmed";
      state.boundaryMode = state.boundaryRefs.length >= 3 ? "freehand" : "ellipse";
      state.review = {
        status: record.review?.status || record.review_status,
        reviewer: record.review?.reviewer || "",
        notes: record.review?.notes || "",
      };
      const reviewer = rootInput(state, "reviewerName");
      const notes = rootInput(state, "reviewNotes");
      if (reviewer) reviewer.value = state.review.reviewer;
      if (notes) notes.value = state.review.notes;
      if (!activateRecord(state, record)) setStatus(state, "已载入候选草案；需重新通过审阅门禁。", "warning");
      syncSelection(state);
      publish(state, "candidate_loaded");
      return;
    }
    case "remove_candidate": state.saved = state.saved.filter((item) => item.id !== detail.id); publish(state, "candidate_removed"); return;
    case "export_json": exportReview(state); return;
    case "export_report": {
      const current = buildRecord(state, state.result, "当前候选");
      const artifact = buildIncisionReviewReport(state.saved.length ? state.saved : current ? [current] : []);
      downloadText(artifact.filename, artifact.text, artifact.mimeType);
      return;
    }
    case "export_png": {
      const canvas = state.root.querySelector<HTMLCanvasElement>("#canvas");
      const overlay = state.root.querySelector<SVGSVGElement>("#workflowIncisionOverlay");
      if (canvas && overlay) void downloadCanvasWithSvgOverlayPng(canvas, overlay, `incision_candidate_${Date.now()}.png`);
      return;
    }
    case "stage_live_overlay":
      setStatus(state, "合并工作流不再使用手动叠加按钮；审阅门禁通过后会自动激活。", "warning");
      publish(state, "legacy_stage_ignored");
  }
}

function handleToolCommand(state: WorkflowIncisionState, event: Event) {
  const detail = readControllerCommandDetail(event as CustomEvent, WORKFLOW_INCISION_TOOL_COMMANDS);
  if (!detail) return;
  switch (detail.command) {
    case "select_lesion":
      state.selectionMode = !state.selectionMode;
      state.markerMode = false;
      state.repairMode = false;
      setStatus(state, state.selectionMode ? "请在当前照片的人脸区域点击肿物中心。" : "已退出肿物选择。");
      break;
    case "controlled_marker":
      if (!state.markerMode && state.kind !== "cutaneous") {
        setStatus(state, "受控标记仅用于皮表肿物；皮下肿物请直接选择中心。", "warning");
        publish(state, "controlled_marker_wrong_kind");
        return;
      }
      if (!state.markerMode && !workflowPhotoReady(state)) {
        setStatus(state, "请先上传并完成照片人脸检测，再使用受控标记。", "warning");
        publish(state, "controlled_marker_no_photo");
        return;
      }
      state.pendingClick = null;
      state.markerMode = !state.markerMode;
      if (state.markerMode) {
        state.scanDiameterMm = workflowMarkerScanDiameterForTumor(state.scanDiameterMm, state.diameterMm);
      }
      state.selectionMode = false;
      state.repairMode = false;
      if (!state.markerMode) resetMarkerRepair(state);
      state.markerPointerSource = null;
      state.markerPreviewSuppressed = state.markerMode;
      state.markerSourceRevision = state.markerMode
        ? sourceState.planning2d?.getFrameState().revision ?? null
        : null;
      setStatus(
        state,
        state.markerMode
          ? `受控标记已开启：鼠标圆形扫描面当前为 ${state.scanDiameterMm} mm。请让扫描面覆盖完整肿物边界后点击。`
          : "已退出受控标记识别。",
      );
      break;
    case "repair_marker":
      if (state.markerBusy) {
        setStatus(state, "正在识别肿物边界，请稍候。", "warning");
        break;
      }
      state.repairMode = state.repairAvailable ? !state.repairMode : false;
      setStatus(state, state.repairMode ? "请按住鼠标沿照片中确实可见的边界缺口补线；抬笔后自动重检。" : "已退出补线。", state.repairMode ? "warning" : "normal");
      break;
    case "undo_repair":
      state.repairStrokes.pop();
      drawRepairStrokes(state);
      if (state.markerSeed) void runControlledMarker(state, state.markerSeed);
      break;
    case "clear_repair":
      if (state.markerBusy) {
        setStatus(state, "正在识别肿物边界，请稍候。", "warning");
        break;
      }
      state.repairStrokes = [];
      state.repairMode = false;
      drawRepairStrokes(state);
      if (state.markerSeed) void runControlledMarker(state, state.markerSeed);
      break;
    case "scan_diameter_changed":
      state.markerRequestId += 1;
      state.markerBusy = false;
      state.scanDiameterMm = workflowMarkerScanDiameterForTumor(Number(detail.value), state.diameterMm);
      if (state.markerSeed) void runControlledMarker(state, state.markerSeed);
      else if (state.markerMode) {
        setStatus(
          state,
          `受控标记已开启：鼠标圆形扫描面当前为 ${state.scanDiameterMm} mm。请让扫描面覆盖完整肿物边界后点击。`,
        );
      }
      scheduleOverlayDraw(state);
      break;
    case "reset_view":
      resetImageView();
      scheduleOverlayDraw(state);
      break;
  }
  publish(state, detail.command);
}

function bindDom(state: WorkflowIncisionState) {
  const abort = new AbortController();
  const wrap = state.root.querySelector<HTMLElement>(".main-wrap");
  wrap?.addEventListener("pointerdown", (event) => handleCanvasPointerDown(state, event), { signal: abort.signal, capture: true });
  wrap?.addEventListener("pointermove", (event) => handleCanvasPointerMove(state, event), { signal: abort.signal, capture: true });
  wrap?.addEventListener("pointerup", (event) => handleCanvasPointerUp(state, event), { signal: abort.signal, capture: true });
  wrap?.addEventListener("pointercancel", (event) => handleCanvasPointerCancel(state, event), { signal: abort.signal, capture: true });
  wrap?.addEventListener("pointerleave", () => handleCanvasPointerLeave(state), { signal: abort.signal });
  wrap?.addEventListener("wheel", () => scheduleOverlayDraw(state), { signal: abort.signal });
  window.addEventListener("resize", () => scheduleOverlayDraw(state), { signal: abort.signal });
  const tumorFile = rootInput(state, "tumorImportFile") as HTMLInputElement | null;
  const cueFile = rootInput(state, "secondaryCueImportFile") as HTMLInputElement | null;
  tumorFile?.addEventListener("change", () => {
    if (tumorFile.files?.[0]) void importTumor(state, tumorFile.files[0]);
    tumorFile.value = "";
  }, { signal: abort.signal });
  cueFile?.addEventListener("change", () => {
    if (cueFile.files?.[0]) void importSecondaryCue(state, cueFile.files[0]);
    cueFile.value = "";
  }, { signal: abort.signal });
  const commandCleanup = bindWindowControllerEvents([
    [INCISION_TUMOR_REACT_COMMAND_EVENT, (event) => applyTumorCommand(state, event)],
    [INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT, (event) => handleSecondaryCueCommand(state, event)],
    [INCISION_REVIEW_REACT_COMMAND_EVENT, (event) => handleReviewCommand(state, event)],
    [INCISION_LIBRARY_REACT_COMMAND_EVENT, (event) => handleLibraryCommand(state, event)],
    [WORKFLOW_INCISION_TOOL_REACT_COMMAND_EVENT, (event) => handleToolCommand(state, event)],
    [LIVE_CONTROLLER_STATE_EVENT, (event) => {
      const snapshot = (event as CustomEvent<LiveControllerSnapshot>).detail;
      if (snapshot?.schema_version) state.liveSnapshot = snapshot;
      const revision = sourceState.planning2d?.getFrameState().revision ?? null;
      if (state.markerSourceRevision !== null && revision !== state.markerSourceRevision) {
        resetMarkerRepair(state);
        state.markerMode = false;
        state.markerPointerSource = null;
        state.markerPreviewSuppressed = false;
        setStatus(state, "媒体已变化，旧受控标记补线状态已清除。");
        publish(state, "marker_source_changed");
      } else {
        scheduleOverlayDraw(state);
      }
    }],
  ]);
  state.cleanup = () => {
    abort.abort();
    commandCleanup();
  };
}

async function loadAssets(state: WorkflowIncisionState) {
  try {
    const [head, standardAtlas] = await Promise.all([
      dataSource.getHeadMesh("mediapipe-468"),
      dataSource.loadAtlas("rstl"),
    ]);
    if (!state.mounted) return;
    const resolved = resolveIncisionAtlas({ personalizedAtlas: null, standardAtlas, triangleCount: head.triangles.length });
    state.verts = head.vertices as Vec3[];
    state.tris = head.triangles as Triangle[];
    state.atlas = resolved.atlas as DynamicRecord;
    state.normals = vertexNormals(state.verts, state.tris);
    state.unitsPerMm = unitsPerMmFromVertices(state.verts);
    state.headAsset = buildIncisionHeadAssetSnapshot({ head, atlas: resolved.atlas as DynamicRecord, resolved });
    state.loading = false;
    setStatus(state, "切口规划资产已就绪；上传照片后在中央画布选择或识别肿物。");
    publish(state, "assets_ready");
  } catch (error) {
    if (!state.mounted) return;
    state.loading = false;
    setStatus(state, `切口规划资产加载失败：${error instanceof Error ? error.message : String(error)}`, "warning");
    publish(state, "assets_failed");
  }
}

export function disposeWorkflowIncisionController() {
  const state = activeState;
  if (!state) return;
  state.mounted = false;
  state.markerRequestId += 1;
  state.workflowRequestId += 1;
  state.cleanup?.();
  state.worker?.dispose();
  state.worker = null;
  renderState.incisionOverlay = null;
  publishLiveOverlayState(state, false, null, "workflow_incision_unmounted");
  sourceState.planning2d?.setSelection({ centerRef: null, boundaryRefs: [] });
  sourceState.planning2d?.setOverlaySummary({ tumorVisible: false, candidatePointCount: 0 });
  requestFrame();
  activeState = null;
}

export function mountWorkflowIncisionController(root: HTMLElement) {
  disposeWorkflowIncisionController();
  const state = createState(root);
  activeState = state;
  bindDom(state);
  publish(state, "mounted");
  void loadAssets(state);
  return disposeWorkflowIncisionController;
}
