import * as Comlink from "comlink";

import {
  INCISION_CONTROLLER_STATE_EVENT,
  INCISION_EDIT_REACT_COMMAND_EVENT,
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
  readIncisionEditCommand,
  readIncisionLibraryCommand,
  readIncisionReviewCommand,
  readIncisionSecondaryCueCommand,
  readIncisionTumorCommand,
} from "./incisionCommandSchemas";
import {
  cloneIncisionEdit,
  incisionEditIsActive,
  neutralIncisionEdit,
  type IncisionEdit,
} from "./incisionEditHistory";
import {
  buildIncisionWorkspaceSession,
  tumorContextsMatch,
} from "./incisionWorkspaceSession";
import {
  CONTROLLED_MARKER_DETECTOR_VERSION,
  detectControlledMarker,
  type ControlledMarkerDetection,
} from "./controlledMarkerDetectionProfile";
import { dataSource } from "./dataSource";
import { auditExportPayload } from "./exportPrivacy";
import { FREEHAND_MARKER_DISABLED_MESSAGE, TUMOR_DIAMETER_DISABLED_MESSAGE, controlledMarkerFailureMessage, engineeringBlockMessage, guardrailLabel, reasonLabel, regionLabel, reviewStatusLabel, subunitLabel } from "./incisionClinicalCopy";
import { buildLocalIncisionPrivacyAudit, normalizeSecondaryCuePayload } from "./incisionAuxiliaryEvidence";
import {
  buildReviewExportPayload,
  buildTumorExportPayload,
  downloadCanvasWithSvgOverlayPng,
  downloadText,
} from "./incisionExport";
import { compileIncisionOverlay, pointToSurfaceRef, type SurfaceRef } from "./incisionOverlay";
import { incisionOverlayScreenStyle } from "./incisionOverlayStyle";
import {
  buildForeheadSurfaceLandmarks,
  buildIncisionPhotoGeometry,
  candidateEndpointSurfaceRefs,
  incisionPhotoLayerContract,
  incisionPhotoStatusPresentation,
  incisionPhotoSkinVisibility,
  pointsToSurfaceRefs,
  queryIncisionPhotoRstlDirection,
  recoverPhotoFaceEdgeSurfaceRef,
  surfaceRefToModelPoint,
  type IncisionPhotoGeometry,
  type ProjectedRstlLineInput,
} from "./incisionPhotoPlanning";
import { stablePhotoPixelsPerMm } from "./incisionPhotoRuntime";
import { buildIncisionResultPresentation } from "./incisionPresenter";
import {
  assessDiagnosticReviewAcknowledgement,
  assessReviewReadiness,
  buildReviewGate,
  reviewForCandidateRecord,
} from "./incisionReviewPolicy";
import {
  buildCandidateEditSession,
  buildIncisionReviewRecord,
  buildIncisionReviewReport,
  findSensitiveStructureInspection,
  transitionIncisionReviewRecord,
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
import { applyCandidateEdit } from "./incisionWorkflowTools";
import {
  inspectTumorEngineeringExclusions,
  tumorPointEngineeringExclusionMessage,
} from "./incisionToolCore";
import {
  buildTumorInput,
  importedTumorFormState,
  tumorDiameterParameterInactive,
  withControlledMarkerProvenance,
} from "./tumorInput";
import { modelState, renderState, sourceState, type EditableRefineLine } from "./liveState";
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
  workflowDiagnosticCandidateVisible,
  workflowProjectionStatusMayOverride,
  workflowPhotoSurfaceReferenceRecoveryEligible,
  workflowVisibilityLimitedReferenceDisplayActive,
  workflowUpperForeheadSurfaceRecoveryActive,
  workflowBoundaryCentroid,
  workflowBoundaryModeTransition,
  workflowClosedBoundarySvgPath,
  workflowFreehandContinuationAllowed,
  workflowFocusViewportPoint,
  workflowFusiformEditBase,
  workflowFusiformPlaneNormal,
  workflowInvalidationNeedsLiveFrame,
  workflowLiveOverlayChanged,
  workflowMarkerRequestStillCurrent,
  workflowMarkerScanDiameterForTumor,
  workflowCenteredLinearPath,
  workflowPhotoBoundaryEnclosingDiameterMm,
  workflowPhotoEllipseBoundary,
  workflowPhotoOpeningIntersection,
  workflowPhotoTumorOpeningIntersection,
  workflowPhotoTumorOutline,
  workflowPlanningClientPoint,
  workflowScanCircleGeometry,
  recoverWorkflowFreehandBoundary,
  workflowSubcutaneousLengthLimit,
  type SvgPoint,
  type WorkflowMarkerRequestSnapshot,
  type WorkflowPointerIntent,
} from "./workflowControllerUtils";
import { planIncisionWithWorkflowFallback } from "./workflowPlanner";
import { createWorkflowWorkerClient, type WorkflowWorkerClient } from "./workflowWorkerClient";
import {
  saveWorkflowIncisionDraft,
  WORKFLOW_DRAFT_RESTORE_EVENT,
  type WorkflowIncisionDraft,
} from "./workflowDraftSession";

type DynamicRecord = Record<string, any>;
const MOBILE_WORKFLOW_MEDIA_QUERY = "(max-width: 560px) and (pointer: coarse) and (hover: none)";

function mobileWorkflowViewportActive(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia(MOBILE_WORKFLOW_MEDIA_QUERY).matches;
}

function isMobileWorkflowTouch(event: PointerEvent): boolean {
  return event.pointerType === "touch" && mobileWorkflowViewportActive();
}
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
  boundaryPhotoPoints: SvgPoint[];
  boundaryPhotoRevision: number | null;
  boundaryDrawingPointerId: number | null;
  boundaryDrawingStartIndex: number | null;
  boundaryClosed: boolean;
  controlledBoundary: boolean;
  controlledBoundaryPhotoDiameterMm: number | null;
  boundaryActive: boolean;
  kind: "cutaneous" | "subcutaneous";
  diameterMm: number;
  depthMm: number;
  marginMm: number;
  author: string;
  boundaryMode: "ellipse" | "freehand";
  ellipseRatio: number;
  baseResult: DynamicRecord | null;
  edit: IncisionEdit;
  result: DynamicRecord | null;
  saved: DynamicRecord[];
  secondaryCues: DynamicRecord | null;
  review: { status: string; reviewer: string; notes: string };
  reviewAttention: "reviewer" | "decision" | "notes" | null;
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
  markerPendingSeed: { x: number; y: number } | null;
  markerPointerSource: { x: number; y: number } | null;
  mobileMarkerTouchIntent: WorkflowPointerIntent | null;
  mobileTouchPointers: Set<number>;
  mobileTouchGestureActive: boolean;
  markerPreviewSuppressed: boolean;
  markerSourceRevision: number | null;
  controlledMarkerScale: { sourceRevision: number; pixelsPerMm: number } | null;
  scanDiameterMm: number;
  worker: WorkflowWorkerClient | null;
  workerFailed: boolean;
  workflowRequestId: number;
  candidateRecomputeTimer: number | null;
  mobileEditPreviewFrame: number | null;
  draftSaveTimer: number | null;
  pendingDraftRestore: WorkflowIncisionDraft | null | undefined;
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
  lastPublishedPhotoReady: boolean;
  lastSourceRevision: number | null;
  lastProjectedRstlFingerprint: string | null;
  candidateRstlFingerprint: string | null;
  pendingRstlFingerprint: string | null;
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
    boundaryPhotoPoints: [],
    boundaryPhotoRevision: null,
    boundaryDrawingPointerId: null,
    boundaryDrawingStartIndex: null,
    boundaryClosed: false,
    controlledBoundary: false,
    controlledBoundaryPhotoDiameterMm: null,
    boundaryActive: false,
    kind: "cutaneous",
    diameterMm: 8,
    depthMm: 6,
    marginMm: 0,
    author: "clinician",
    boundaryMode: "ellipse",
    ellipseRatio: 100,
    baseResult: null,
    edit: neutralIncisionEdit(),
    result: null,
    saved: [],
    secondaryCues: null,
    review: { status: "pending_clinician_confirmation", reviewer: "", notes: "" },
    reviewAttention: null,
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
    markerPendingSeed: null,
    markerPointerSource: null,
    mobileMarkerTouchIntent: null,
    mobileTouchPointers: new Set<number>(),
    mobileTouchGestureActive: false,
    markerPreviewSuppressed: false,
    markerSourceRevision: null,
    controlledMarkerScale: null,
    scanDiameterMm: 20,
    worker: null,
    workerFailed: false,
    workflowRequestId: 0,
    candidateRecomputeTimer: null,
    mobileEditPreviewFrame: null,
    draftSaveTimer: null,
    pendingDraftRestore: undefined,
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
    lastPublishedPhotoReady: false,
    lastSourceRevision: sourceState.planning2d?.getFrameState().revision ?? null,
    lastProjectedRstlFingerprint: null,
    candidateRstlFingerprint: null,
    pendingRstlFingerprint: null,
  };
}

function resetFreehandPhotoBoundary(state: WorkflowIncisionState, clearRefs = false) {
  state.boundaryPhotoPoints = [];
  state.boundaryPhotoRevision = null;
  state.boundaryDrawingPointerId = null;
  state.boundaryDrawingStartIndex = null;
  state.boundaryClosed = false;
  if (clearRefs) {
    state.boundaryRefs = [];
    state.controlledBoundaryPhotoDiameterMm = null;
  }
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

function persistWorkflowDraft(state: WorkflowIncisionState): void {
  const frame = sourceState.planning2d?.getFrameState();
  if (frame?.kind !== "image" || !frame.source) return;
  const tumor = currentTumor(state);
  if (!tumor) {
    saveWorkflowIncisionDraft(null);
    return;
  }
  const resultMatchesTumor = tumorContextsMatch(state.result?.tumor, tumor);
  saveWorkflowIncisionDraft({
    workspace: buildIncisionWorkspaceSession({
      tumor,
      result: resultMatchesTumor ? state.result : null,
      baseResult: resultMatchesTumor ? state.baseResult : null,
      saved: state.saved,
      review: { ...currentReview(state) },
      generationCount: state.generationCount,
    }),
    edit: { ...state.edit },
    boundaryMode: state.boundaryMode,
    ellipseRatio: state.ellipseRatio,
    controlledBoundary: state.controlledBoundary,
    controlledBoundaryPhotoDiameterMm: state.controlledBoundaryPhotoDiameterMm,
  });
}

function cancelWorkflowDraftSave(state: WorkflowIncisionState): void {
  if (state.draftSaveTimer === null) return;
  window.clearTimeout(state.draftSaveTimer);
  state.draftSaveTimer = null;
}

function scheduleWorkflowDraftSave(state: WorkflowIncisionState): void {
  cancelWorkflowDraftSave(state);
  state.draftSaveTimer = window.setTimeout(() => {
    state.draftSaveTimer = null;
    if (state.mounted) persistWorkflowDraft(state);
  }, 300);
}

function restoredWorkflowEdit(edit: Partial<IncisionEdit>): IncisionEdit {
  return {
    ...neutralIncisionEdit(),
    angle_offset_deg: Math.max(-35, Math.min(35, Number(edit.angle_offset_deg) || 0)),
    length_scale: Math.max(1, Math.min(1.5, Number(edit.length_scale) || 1)),
    width_scale: Math.max(1, Math.min(1.5, Number(edit.width_scale) || 1)),
    reason: String(edit.reason || ""),
  };
}

function applyWorkflowDraftRestore(state: WorkflowIncisionState): boolean {
  const draft = state.pendingDraftRestore;
  if (draft === undefined || state.loading || !workflowPhotoReady(state)) return false;
  state.pendingDraftRestore = undefined;
  if (draft === null) {
    setStatus(state, "已恢复照片；该草稿没有可恢复的切口操作。", "normal");
    publish(state, "workflow_draft_photo_restored");
    return true;
  }
  try {
    const session = draft.workspace;
    const imported = importedTumorFormState(session.tumor, {
      diameterMin: 2,
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
    state.boundaryMode = draft.boundaryMode;
    state.ellipseRatio = Math.max(40, Math.min(200, Number(draft.ellipseRatio) || 100));
    state.centerRef = pointToSurfaceRef(imported.tumor.center as Vec3, state.verts, state.tris);
    state.boundaryRefs = draft.boundaryMode === "freehand"
      ? pointsToSurfaceRefs(imported.boundaryPoints, state.verts, state.tris)
      : [];
    resetFreehandPhotoBoundary(state);
    state.boundaryClosed = state.boundaryRefs.length >= 3;
    state.boundaryActive = false;
    state.controlledBoundary = Boolean(draft.controlledBoundary);
    state.controlledBoundaryPhotoDiameterMm = draft.controlledBoundary
      ? Number(draft.controlledBoundaryPhotoDiameterMm) || null
      : null;
    state.saved = session.saved;
    state.generationCount = session.generationCount;
    const resultMatchesTumor = Boolean(session.result && tumorContextsMatch(session.result.tumor, session.tumor));
    state.baseResult = resultMatchesTumor ? session.baseResult : null;
    state.result = resultMatchesTumor ? session.result : null;
    state.edit = resultMatchesTumor ? restoredWorkflowEdit(draft.edit) : neutralIncisionEdit();
    state.review = {
      status: String(session.review.status || "pending_clinician_confirmation"),
      reviewer: String(session.review.reviewer || ""),
      notes: String(session.review.notes || ""),
    };
    state.reviewAttention = null;
    const reviewer = rootInput(state, "reviewerName");
    const notes = rootInput(state, "reviewNotes");
    const decision = rootInput(state, "reviewDecision");
    if (reviewer) reviewer.value = state.review.reviewer;
    if (notes) notes.value = state.review.notes;
    if (decision) decision.value = state.review.status;
    syncSelection(state);
    if (resultMatchesTumor) {
      setStatus(state, "已恢复照片、肿物范围、候选微调和审阅草稿。", "normal");
      publish(state, "workflow_draft_restored");
    } else {
      setStatus(state, "已恢复照片与肿物范围，正在用当前工具重新生成候选。", "normal");
      void runWorkflow(state);
    }
    return true;
  } catch (error) {
    setStatus(state, `草稿中的切口状态无法恢复：${error instanceof Error ? error.message : String(error)}`, "warning");
    publish(state, "workflow_draft_restore_failed");
    return true;
  }
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
  if (ref) {
    const rawRef = sourcePointToSurfaceRef(point, frame.landmarks, state.tris);
    if (!rawRef && projection.skinVisible && !projection.skinVisible([point.x, point.y, 0])) return null;
    return ref;
  }
  if (projection.skinVisible && !projection.skinVisible([point.x, point.y, 0])) return null;
  return recoverPhotoFaceEdgeSurfaceRef(point, projection.surfaceLandmarks, state.tris)?.ref || null;
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
    || (state.kind === "cutaneous" && candidate.type === "fusiform");
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
  const currentPhotoBoundary = state.kind === "cutaneous"
    && state.boundaryClosed
    && state.boundaryPhotoRevision === frame.revision
    && state.boundaryPhotoPoints.length >= 3
    ? state.boundaryPhotoPoints.map((point) => [point.x, point.y, 0] as Vec3)
    : undefined;
  const photoBoundary = currentPhotoBoundary || (state.kind === "cutaneous"
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
    : undefined);
  state.cachedPhotoGeometry = buildIncisionPhotoGeometry({
    landmarks: [...frame.landmarks],
    surfaceLandmarks: projection.surfaceLandmarks,
    triangles: state.tris,
    atlasLines: activeAtlas(state)?.lines || [],
    projectedRstlLines: activeProjectedRstlLines(),
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
    candidateDirectionEdited: candidate.type === "fusiform"
      && Math.abs(Number(state.edit.angle_offset_deg)) > 1e-9,
    candidateSkinVisible: projection.skinVisible || undefined,
  });
  return state.cachedPhotoGeometry;
}

function upperForeheadSurfaceRecoveryActive(
  state: WorkflowIncisionState,
  geometry: IncisionPhotoGeometry | null,
): boolean {
  const diagnostics = geometry?.candidateProjection.smoothingDiagnostics;
  return Boolean(geometry && workflowUpperForeheadSurfaceRecoveryActive({
    canonicalSurfaceOnly: workflowPhotoSurfaceReferenceRecoveryEligible(state.result),
    projectionValid: geometry.candidateProjection.valid,
    smoothingMode: geometry.candidateProjection.smoothingMode,
    meshOutsideCount: diagnostics?.photoSurfaceMeshOutsideCount,
    surfaceOutsideCount: diagnostics?.photoSurfaceOutsideCount,
    rstlSupportedMeshOutsideCount: diagnostics?.photoRstlSupportedMeshOutsideCount,
    upperForeheadPointCount: diagnostics?.photoRstlSupportedUpperForeheadPointCount,
    pointCount: diagnostics?.photoSurfacePointCount,
  }));
}

function visibilityLimitedReferenceGeometry(
  geometry: IncisionPhotoGeometry | null,
): boolean {
  return Boolean(geometry && workflowVisibilityLimitedReferenceDisplayActive({
    canonicalSurfaceOnly: true,
    projectionValid: geometry.candidateProjection.valid,
    smoothingMode: geometry.candidateProjection.smoothingMode,
    visibilityLimited: geometry.candidateProjection.visibilityLimited,
    hiddenPointCount: geometry.candidateProjection.hiddenPointCount,
    visibleFraction: geometry.candidateProjection.visibleFraction,
    openingIntersection: visibilityLimitedPhotoOpeningIntersection(geometry),
  }));
}

function visibilityLimitedReferenceRecoveryActive(
  state: WorkflowIncisionState,
  geometry: IncisionPhotoGeometry | null,
): boolean {
  return Boolean(geometry && workflowVisibilityLimitedReferenceDisplayActive({
    canonicalSurfaceOnly: workflowPhotoSurfaceReferenceRecoveryEligible(state.result),
    projectionValid: geometry.candidateProjection.valid,
    smoothingMode: geometry.candidateProjection.smoothingMode,
    visibilityLimited: geometry.candidateProjection.visibilityLimited,
    hiddenPointCount: geometry.candidateProjection.hiddenPointCount,
    visibleFraction: geometry.candidateProjection.visibleFraction,
    openingIntersection: visibilityLimitedPhotoOpeningIntersection(geometry),
  }));
}

function visibilityLimitedPhotoOpeningIntersection(
  geometry: IncisionPhotoGeometry | null,
): string | null {
  if (geometry?.candidateProjection.smoothingMode !== "limitedVisibility") return null;
  const landmarks = sourceState.planning2d?.getFrameState().landmarks;
  const outline = geometry.fusiformRendering?.outline;
  if (!landmarks || landmarks.length < 468 || !outline || outline.length < 4) {
    return "photo-opening-check-unavailable";
  }
  return workflowPhotoOpeningIntersection(
    outline.slice(0, -1).map((point) => ({ x: point[0], y: point[1] })),
    landmarks,
  );
}

function photoDiagnosticOpeningIntersection(
  geometry: IncisionPhotoGeometry | null,
): string | null {
  const landmarks = sourceState.planning2d?.getFrameState().landmarks;
  const outline = geometry?.fusiformRendering?.outline
    || geometry?.diagnosticFusiformRendering?.outline
    || geometry?.candidate;
  if (!landmarks || landmarks.length < 468 || !outline || outline.length < 4) return null;
  return workflowPhotoOpeningIntersection(
    outline.slice(0, -1).map((point) => ({ x: point[0], y: point[1] })),
    landmarks,
  );
}

function photoDisplayRecoveryActive(
  state: WorkflowIncisionState,
  geometry: IncisionPhotoGeometry | null,
): boolean {
  return upperForeheadSurfaceRecoveryActive(state, geometry)
    || visibilityLimitedReferenceRecoveryActive(state, geometry);
}

function diagnosticCandidateVisibleForGeometry(
  state: WorkflowIncisionState,
  geometry: IncisionPhotoGeometry | null,
  openingIntersection = photoDiagnosticOpeningIntersection(geometry),
): boolean {
  if (!state.result || !geometry) return false;
  const candidateDisplayBlocked = (state.result.candidate_display_blocked === true
    && !photoDisplayRecoveryActive(state, geometry))
    || Boolean(openingIntersection);
  const pointCount = geometry.candidateProjection.valid
    ? geometry.candidate.length
    : geometry.diagnosticCandidate.length;
  return workflowDiagnosticCandidateVisible(
    { ...state.result, candidate_display_blocked: candidateDisplayBlocked },
    geometry.candidateProjection.valid,
    pointCount,
    openingIntersection,
  );
}

function currentDiagnosticCandidateVisible(state: WorkflowIncisionState): boolean {
  const frame = sourceState.planning2d?.getFrameState();
  const geometry = frame?.kind === "image" ? workflowPhotoGeometry(state, frame) : null;
  return diagnosticCandidateVisibleForGeometry(state, geometry);
}

function recordPhotoProjectionMetrics(
  state: WorkflowIncisionState,
  geometry: IncisionPhotoGeometry,
  upperForeheadRecovery: boolean,
  visibilityLimitedReference: boolean,
): void {
  const metrics = state.result?.candidate?.metrics;
  if (!metrics) return;
  const diagnostics = geometry.candidateProjection.smoothingDiagnostics;
  metrics.photo_surface_mesh_outside_count = diagnostics?.photoSurfaceMeshOutsideCount ?? null;
  metrics.photo_rstl_supported_mesh_outside_count = diagnostics?.photoRstlSupportedMeshOutsideCount ?? null;
  metrics.photo_upper_forehead_rstl_recovery = upperForeheadRecovery;
  metrics.photo_visibility_limited_candidate = visibilityLimitedReference;
  metrics.photo_visible_fraction = geometry.candidateProjection.visibleFraction ?? null;
  metrics.photo_hidden_point_count = geometry.candidateProjection.hiddenPointCount ?? 0;
  metrics.photo_reference_candidate = geometry.candidateProjection.smoothingMode === "constrainedReference";
  metrics.photo_reference_aspect_ratio = geometry.candidateProjection.referenceAspectRatio ?? null;
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
  if (state.controlledBoundary || state.boundaryMode === "freehand") {
    return state.boundaryClosed && state.boundaryRefs.length >= 3
      ? state.boundaryRefs.map((ref) => modelPoint(state, ref)).filter((point): point is Vec3 => Boolean(point))
      : [];
  }
  const refs = ellipseBoundaryRefs(state);
  return refs.length >= 3
    ? refs.map((ref) => modelPoint(state, ref)).filter((point): point is Vec3 => Boolean(point))
    : ellipseBoundaryPoints(state);
}

function currentTumor(state: WorkflowIncisionState) {
  const center = modelPoint(state, state.centerRef);
  if (!center) return null;
  const tumor = withControlledMarkerProvenance(buildTumorInput({
    kind: state.kind,
    center,
    diameterMm: state.diameterMm,
    depthMm: state.depthMm,
    marginMm: state.marginMm,
    boundary: boundaryPoints(state),
    boundaryMode: state.controlledBoundary ? "freehand" : state.boundaryMode,
    author: state.author,
  }), state.controlledBoundary);
  return state.controlledBoundary && state.controlledBoundaryPhotoDiameterMm
    ? { ...tumor, photo_boundary_enclosing_diameter_mm: state.controlledBoundaryPhotoDiameterMm }
    : tumor;
}

function tumorPresentation(state: WorkflowIncisionState) {
  const tumor = currentTumor(state);
  if (state.boundaryActive && state.boundaryPhotoPoints.length > 0 && !state.boundaryClosed) {
    const drawing = state.boundaryDrawingPointerId !== null;
    return {
      boundaryStatus: drawing
        ? "正在描画自由轮廓；可连续补充轨迹。"
        : "轮廓轨迹已记录；请点击“结束描绘”后再识别并生成候选。",
      boundaryStatusWarn: false,
      pickState: `已绘制 ${state.boundaryPhotoPoints.length} 个轨迹点；系统尚未识别，结束描绘后才会处理。`,
      anatomyPreview: tumor ? "当前点位分区：等待轮廓闭合" : "当前点位分区：待选择",
      anatomyPreviewWarn: false,
    };
  }
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
      ? state.controlledBoundary && state.controlledBoundaryPhotoDiameterMm
        ? `皮表边界：${summary.point_count} 点 · 照片估算最大直径 ${state.controlledBoundaryPhotoDiameterMm.toFixed(1)} mm${warnings.length ? ` · ${warnings.map((item: DynamicRecord) => guardrailLabel(item.code)).join("；")}` : ""}`
        : `皮表边界：${summary.point_count} 点 · 横向 ${Number(summary.perp_diameter_mm || 0).toFixed(1)} mm${warnings.length ? ` · ${warnings.map((item: DynamicRecord) => guardrailLabel(item.code)).join("；")}` : ""}`
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

function syncWorkflowPointerMode(state: WorkflowIncisionState) {
  const wrap = state.root.querySelector<HTMLElement>(".main-wrap");
  if (!wrap) return;
  const mode = state.boundaryActive && state.kind === "cutaneous" && state.boundaryMode === "freehand"
    ? "freehand"
    : state.repairMode
      ? "repair"
      : state.markerMode
        ? "marker"
        : "";
  if (mode) wrap.dataset.workflowPointerMode = mode;
  else delete wrap.dataset.workflowPointerMode;
}

function publish(state: WorkflowIncisionState, reason = "state_update") {
  if (!state.mounted) return;
  state.root.dataset.workflowMarkerBusy = String(state.markerBusy);
  state.root.dataset.workflowMarkerMode = String(state.markerMode);
  syncWorkflowPointerMode(state);
  state.geometryRevision += 1;
  const frame = sourceState.planning2d?.getFrameState();
  let diagnosticCandidateVisible = false;
  if (state.result && frame?.kind === "image") {
    const geometry = workflowPhotoGeometry(state, frame);
    const upperForeheadRecovery = upperForeheadSurfaceRecoveryActive(state, geometry);
    const visibilityLimitedReference = visibilityLimitedReferenceGeometry(geometry);
    const visibilityLimitedRecovery = visibilityLimitedReferenceRecoveryActive(state, geometry);
    const photoOpeningIntersection = photoDiagnosticOpeningIntersection(geometry);
    const displayRecoveryActive = (upperForeheadRecovery || visibilityLimitedRecovery)
      && !photoOpeningIntersection;
    const candidateDisplayBlocked = (state.result.candidate_display_blocked === true && !displayRecoveryActive)
      || Boolean(photoOpeningIntersection);
    if (geometry) {
      recordPhotoProjectionMetrics(state, geometry, upperForeheadRecovery, visibilityLimitedReference);
      sourceState.planning2d?.setOverlaySummary({
        candidatePointCount: candidateDisplayBlocked || !geometry.candidateProjection.valid
          ? 0
          : geometry.candidate.length,
      });
      diagnosticCandidateVisible = diagnosticCandidateVisibleForGeometry(
        state,
        geometry,
        photoOpeningIntersection,
      );
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
      const projectionStatusMayOverride = workflowProjectionStatusMayOverride(reason, state.stageStatus);
      if (projectionStatusMayOverride && (displayRecoveryActive || visibilityLimitedReference)) {
        setStatus(state, photoStatus.message, photoStatus.tone === "warning" ? "warning" : "normal");
      } else if (projectionStatusMayOverride && diagnosticCandidateVisible) {
        setStatus(
          state,
          "红色虚线表示候选进入敏感开口，已阻断且不会保存；请调整位置或范围。",
          "warning",
        );
      } else if (projectionStatusMayOverride
        && geometry.candidateProjection.reasonCodes.includes("candidate_boundary_not_enclosed")) {
        setStatus(
          state,
          "当前候选无法完整覆盖肿物边界，因此不显示容易误解的红色轮廓；请调整肿物范围后重新计算。",
          "warning",
        );
      } else if (projectionStatusMayOverride
        && (candidateDisplayBlocked || !geometry.candidateProjection.valid)) {
        setStatus(state, photoStatus.message, photoStatus.tone === "warning" ? "warning" : "normal");
      }
    } else if (candidateDisplayBlocked && workflowProjectionStatusMayOverride(reason, state.stageStatus)) {
      setStatus(state, engineeringBlockMessage(state.result), "warning");
    }
  }
  const photoReady = workflowPhotoReady(state);
  state.lastPublishedPhotoReady = photoReady;
  const tumorUi = tumorPresentation(state);
  dispatchControllerEvent(INCISION_CONTROLLER_STATE_EVENT, buildIncisionControllerSnapshot({
    reason,
    stageStatus: state.stageStatus,
    stageStatusTone: state.stageStatusTone,
    stageBusy: state.loading || state.workflowBusy || state.markerBusy,
    assetLoading: buildIncisionAssetLoadingSnapshot({
      visible: state.loading,
      text: state.loading ? "正在加载人脸定位与切口规划资源。" : "切口规划资源已加载。",
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
      boundaryPointCount: state.boundaryPhotoPoints.length || state.boundaryRefs.length,
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
      stateLabel: "设备本地",
      message: `原始照片仅在当前设备中处理，不随候选记录上传；记录仅保留 ${privacyAudit(state).local_workflow_fields.length} 类必要参数。`,
    }),
    review: buildIncisionReviewSnapshot({
      status: state.review.status,
      reviewer: state.review.reviewer,
      notesPresent: Boolean(state.review.notes),
      reviewerAttentionRequired: state.reviewAttention === "reviewer",
      decisionAttentionRequired: state.reviewAttention === "decision",
      notesAttentionRequired: state.reviewAttention === "notes",
    }),
    edit: buildIncisionEditSnapshot({
      edit: state.edit,
      statusLabel: incisionEditIsActive(state.edit) ? "已调整" : "工具建议",
      statusActive: incisionEditIsActive(state.edit),
      editActive: incisionEditIsActive(state.edit),
      widthScaleVisible: Boolean(workflowFusiformEditBase(state.result, state.baseResult)),
      undoDisabled: true,
      redoDisabled: true,
    }),
    candidate: diagnosticCandidateVisible ? null : buildIncisionCandidateSnapshot(state.result),
    resultView: resultView(state),
    savedCandidates: buildIncisionSavedCandidateSummaries({
      records: state.saved as any,
      comparisons: compareCandidateRecords(state.saved),
      reviewStatusLabel,
    }),
    workflowRuntime: state.result?.workflow_runtime || null,
    savedCount: state.saved.length,
    workflowTools: {
      photoReady,
      selectionMode: state.selectionMode,
      controlledMarkerMode: state.markerMode,
      markerBusy: state.markerBusy,
      mobileMarkerPlacementReady: Boolean(state.markerPendingSeed),
      repairAvailable: state.repairAvailable,
      repairMode: state.repairMode,
      repairCount: state.repairStrokes.length,
      scanDiameterMm: state.scanDiameterMm,
      minimumScanDiameterMm: minimumWorkflowMarkerScanDiameterMm(state.diameterMm),
    },
  }));
  scheduleWorkflowDraftSave(state);
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

function cancelCandidateRecompute(state: WorkflowIncisionState) {
  if (state.candidateRecomputeTimer === null) return;
  window.clearTimeout(state.candidateRecomputeTimer);
  state.candidateRecomputeTimer = null;
}

function cancelMobileEditPreview(state: WorkflowIncisionState) {
  if (state.mobileEditPreviewFrame === null) return;
  window.cancelAnimationFrame(state.mobileEditPreviewFrame);
  state.mobileEditPreviewFrame = null;
}

function markCandidatePendingReview(state: WorkflowIncisionState, reason: string) {
  const hadActiveOverlay = Boolean(renderState.incisionOverlay) || state.liveSnapshot?.incisionOverlay?.loaded === true;
  state.review.status = "pending_clinician_confirmation";
  state.reviewAttention = null;
  renderState.incisionOverlay = null;
  publishLiveOverlayState(state, false, null, reason);
  if (workflowInvalidationNeedsLiveFrame(hadActiveOverlay)) requestFrame();
}

function invalidateCandidate(state: WorkflowIncisionState, message?: string) {
  const hadActiveOverlay = Boolean(renderState.incisionOverlay) || state.liveSnapshot?.incisionOverlay?.loaded === true;
  cancelCandidateRecompute(state);
  cancelMobileEditPreview(state);
  state.workflowRequestId += 1;
  state.workflowBusy = false;
  state.baseResult = null;
  state.edit = neutralIncisionEdit();
  state.result = null;
  state.candidateRstlFingerprint = null;
  state.pendingRstlFingerprint = null;
  state.review.status = "pending_clinician_confirmation";
  state.reviewAttention = null;
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
  state.markerPendingSeed = null;
  state.mobileMarkerTouchIntent = null;
  state.mobileTouchPointers.clear();
  state.mobileTouchGestureActive = false;
  state.markerSourceRevision = null;
  drawRepairStrokes(state);
}

function prepareControlledMarkerAttempt(state: WorkflowIncisionState) {
  state.centerRef = null;
  state.boundaryRefs = [];
  resetFreehandPhotoBoundary(state, true);
  state.controlledBoundary = false;
  state.controlledBoundaryPhotoDiameterMm = null;
  invalidateCandidate(state);
  syncSelection(state);
}

function resetWorkflowForSourceChange(state: WorkflowIncisionState, _revision: number | null) {
  const preserveActiveCandidate = Boolean(renderState.incisionOverlay && state.result?.candidate);
  if (preserveActiveCandidate) resetFreehandPhotoBoundary(state);
  else {
    state.centerRef = null;
    state.boundaryRefs = [];
    resetFreehandPhotoBoundary(state, true);
    state.controlledBoundary = false;
  }
  state.boundaryActive = false;
  state.selectionMode = false;
  state.pendingClick = null;
  resetMarkerRepair(state);
  state.markerMode = false;
  state.markerPointerSource = null;
  state.markerPreviewSuppressed = false;
  state.controlledMarkerScale = null;
  state.photoFrameRevision = null;
  state.photoFrameLandmarks = null;
  state.photoSurfaceLandmarks = [];
  state.photoSkinVisible = null;
  state.cachedGeometryRevision = -1;
  state.cachedGeometryFrameRevision = null;
  state.cachedPhotoGeometry = null;
  state.photoEllipseBoundaryCache = null;
  state.lastProjectedRstlFingerprint = null;
  if (!preserveActiveCandidate) invalidateCandidate(state);
  clearWorkflowDraftOverlay(state);
  if (preserveActiveCandidate) {
    syncSelection(state);
    publishLiveOverlayState(state, true, "已自动激活", "workflow_incision_overlay_preserved_for_source");
    setStatus(state, "媒体已变化；已载入候选和肿物曲面位置保持激活，正在映射到当前面部。");
    requestFrame();
  } else {
    setStatus(state, "媒体已变化，旧肿物与切口已清除；请在新照片上重新选择。");
    sourceState.planning2d?.setSelection({ centerRef: null, boundaryRefs: [] });
    sourceState.planning2d?.setOverlaySummary({ tumorVisible: false, candidatePointCount: 0 });
  }
  publish(state, "workflow_source_changed");
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

function activeProjectedRstlLines(): readonly EditableRefineLine[] | null {
  const frozenPhotoSource = sourceState.sourceKind === "image" || sourceState.paused;
  return frozenPhotoSource && renderState.refine2d.lines?.length
    ? renderState.refine2d.lines
    : null;
}

function projectedRstlFingerprint(lines: readonly ProjectedRstlLineInput[] | null): string | null {
  if (!lines?.length) return null;
  let hash = 2166136261;
  const write = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  lines.forEach((line, lineIndex) => {
    write(`${lineIndex}|${line.name || ""}|${line.region || ""}|${line.hidden ? 1 : 0}|`);
    for (const [start, length] of line.hiddenPointRuns || []) write(`${start}:${length};`);
    for (const point of line.pts) {
      write(`${Number(point[0]).toFixed(2)},${Number(point[1]).toFixed(2)},${Number(point[2]).toFixed(3)};`);
    }
  });
  return `photo-rstl-v1:${lines.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function reconcileProjectedRstlSnapshot(state: WorkflowIncisionState): boolean {
  const currentFingerprint = projectedRstlFingerprint(activeProjectedRstlLines());
  state.lastProjectedRstlFingerprint = currentFingerprint;
  if (!currentFingerprint) return false;
  const consumedFingerprint = state.workflowBusy
    ? state.pendingRstlFingerprint
    : state.candidateRstlFingerprint;
  if (!(state.workflowBusy || state.result) || consumedFingerprint === currentFingerprint) return false;
  invalidateCandidate(
    state,
    "最终 RSTL 已更新，旧候选已失效；请重新选择肿物或调整任一参数生成新候选。",
  );
  publish(state, "workflow_rstl_snapshot_changed");
  return true;
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

async function runWorkflow(state: WorkflowIncisionState, explicit = false, preserveVisibleCandidate = false) {
  const tumor = currentTumor(state);
  if (!tumor || !state.verts.length || !state.tris.length || !state.atlas) {
    setStatus(state, state.loading ? "切口规划功能仍在加载，请稍候。" : "请先在照片上选择肿物位置。", "warning");
    publish(state, "workflow_not_ready");
    return;
  }
  cancelCandidateRecompute(state);
  const retainedCandidate = preserveVisibleCandidate && Boolean(state.result);
  if (retainedCandidate) {
    markCandidatePendingReview(state, "workflow_candidate_recalculating");
  } else {
    invalidateCandidate(state);
  }
  const requestId = ++state.workflowRequestId;
  state.workflowBusy = true;
  setStatus(state, retainedCandidate ? "正在更新候选切口；当前示意会保留到新结果生成。" : "正在生成候选切口…");
  publish(state, "workflow_running");
  const frame = sourceState.planning2d?.getFrameState();
  const sourceRevision = frame?.kind === "image" ? frame.revision : null;
  const photoProjection = frame ? workflowPhotoProjection(state, frame) : null;
  const atlas = activeAtlas(state);
  const projectedRstlLines = activeProjectedRstlLines();
  const rstlFingerprint = projectedRstlFingerprint(projectedRstlLines);
  state.pendingRstlFingerprint = rstlFingerprint;
  state.lastProjectedRstlFingerprint = rstlFingerprint;
  const queriedDirection = frame?.source && frame.landmarks?.length && state.centerRef
    ? queryIncisionPhotoRstlDirection({
      centerRef: state.centerRef,
      vertices: state.verts,
      landmarks: frame.landmarks,
      surfaceLandmarks: photoProjection?.surfaceLandmarks || frame.surfaceLandmarks,
      triangles: state.tris,
      atlasLines: atlas?.lines || [],
      projectedRstlLines,
    })
    : null;
  const directionOverride = queriedDirection
    ? {
      ...queriedDirection,
      rstl_snapshot_fingerprint: rstlFingerprint,
      rstl_snapshot_source: projectedRstlLines?.length ? "final_photo_refine2d" : "atlas_projection",
    }
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
      state.pendingRstlFingerprint = null;
      state.workflowBusy = false;
      setStatus(state, "照片在候选生成期间已变化，旧结果已丢弃；请在新照片上重新选择肿物。", "warning");
      publish(state, "workflow_stale_source");
      return;
    }
    const currentRstlFingerprint = projectedRstlFingerprint(activeProjectedRstlLines());
    if (currentRstlFingerprint !== rstlFingerprint) {
      invalidateCandidate(state, "RSTL 在候选生成期间已更新，旧结果已丢弃；请重新生成候选。");
      state.lastProjectedRstlFingerprint = currentRstlFingerprint;
      publish(state, "workflow_stale_rstl");
      return;
    }
    state.baseResult = {
      ...execution.result,
      original_candidate: execution.result?.candidate,
    };
    const retainedEdit = retainedCandidate ? cloneIncisionEdit(state.edit) : neutralIncisionEdit();
    state.edit = state.baseResult.candidate?.type === "fusiform" ? retainedEdit : neutralIncisionEdit();
    state.result = incisionEditIsActive(state.edit)
      ? applyCandidateEdit(
        state.baseResult,
        state.edit,
        workflowFusiformPlaneNormal(state.baseResult.candidate, normal),
        state.unitsPerMm,
        state.verts,
      )
      : state.baseResult;
    state.candidateRstlFingerprint = rstlFingerprint;
    state.pendingRstlFingerprint = null;
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
        execution.statusMessage || "候选已生成；请填写审阅人并保存审阅状态。符合显示条件的候选会自动显示在画布上。",
        execution.workerFailed || !state.result?.guardrails?.passed ? "warning" : "normal",
      );
    }
    syncSelection(state);
    publish(state, "candidate_result");
  } catch (error) {
    if (!state.mounted || requestId !== state.workflowRequestId) return;
    state.pendingRstlFingerprint = null;
    state.workflowBusy = false;
    setStatus(
      state,
      `候选生成失败：${error instanceof Error ? error.message : String(error)}${retainedCandidate ? "；已保留调整前的候选示意。" : ""}`,
      "warning",
    );
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
  if (!rawReview.reviewer) return null;
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
    const reviewStatus = record.review?.status || record.review_status;
    const pendingConfirmation = reviewStatus === "pending_clinician_confirmation";
    renderState.incisionOverlay = null;
    publishLiveOverlayState(
      state,
      false,
      pendingConfirmation ? "未叠加 · 待医生确认" : "未叠加 · 显示检查未通过",
      "workflow_incision_overlay_blocked",
    );
    setStatus(
      state,
      pendingConfirmation
        ? "已载入待医生确认草案；照片中可继续核对，但实时摄像头不会显示该候选。请完成审阅后再启用叠加。"
        : "候选未通过显示检查，已保留审阅记录，暂不显示在实时画面中。",
      "warning",
    );
    requestFrame();
    return false;
  }
  renderState.incisionOverlay = overlay;
  publishLiveOverlayState(state, true, "已自动激活", "workflow_incision_overlay_activated");
  setStatus(state, "候选已确认并显示在当前画布上；切换同一人的视频或摄像头后，系统会按面部位置重新显示。");
  requestFrame();
  return true;
}

function acknowledgeDiagnosticReview(
  state: WorkflowIncisionState,
  review: { status: string; reviewer: string; notes: string },
): boolean {
  if (!currentDiagnosticCandidateVisible(state)) return false;
  const acknowledgement = assessDiagnosticReviewAcknowledgement(review);
  state.review.status = "pending_clinician_confirmation";
  state.reviewAttention = acknowledgement.attention;
  renderState.incisionOverlay = null;
  publishLiveOverlayState(state, false, null, "workflow_incision_diagnostic_review");
  if (!acknowledgement.ok) {
    setStatus(state, acknowledgement.message, "warning");
    requestFrame();
    publish(state, "diagnostic_review_blocked");
    return true;
  }
  setStatus(
    state,
    "未保存审阅记录：已记录本次敏感开口阻断的备注，但红色虚线不是候选，不能加入候选库。",
    "warning",
  );
  requestFrame();
  publish(state, "diagnostic_review_acknowledged");
  return true;
}

function saveReview(state: WorkflowIncisionState) {
  const review = currentReview(state);
  state.reviewAttention = null;
  if (acknowledgeDiagnosticReview(state, review)) return;
  const readiness = assessReviewReadiness({ ...review, result: state.result });
  if (!readiness.ok) {
    state.reviewAttention = readiness.attention;
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
  state.reviewAttention = null;
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
  const review = currentReview(state);
  if (acknowledgeDiagnosticReview(state, review)) return;
  if (!review.reviewer) {
    state.reviewAttention = "reviewer";
    setStatus(state, "保存候选记录前请填写审阅人。", "warning");
    publish(state, "candidate_save_missing_reviewer");
    return;
  }
  const record = buildRecord(state, state.result, label, forceDraft);
  if (!record) {
    setStatus(state, "没有可保存的候选", "warning");
    publish(state, "candidate_save_missing");
    return;
  }
  state.saved.push(record);
  state.reviewAttention = null;
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
  const current = currentDiagnosticCandidateVisible(state)
    ? null
    : buildRecord(state, state.result, "当前候选");
  const payload = buildReviewExportPayload({ current, saved: state.saved, secondaryCues: secondaryCueSummary(state) });
  if (!exportAllowed(state, payload, "审阅 JSON 导出")) return;
  downloadText(`incision_review_${Date.now()}.json`, JSON.stringify(payload, null, 2));
}

function exportTumor(state: WorkflowIncisionState) {
  const tumor = currentTumor(state);
  if (!tumor) {
    setStatus(state, "无法导出肿物：请先在中央照片上选择肿物位置。", "warning");
    publish(state, "tumor_export_missing");
    return;
  }
  const payload = buildTumorExportPayload({
    tumor,
    tumorQuality: summarizeTumorInputQuality(tumor),
    boundarySummary: boundarySummary(state, { tumor, candidate: state.result?.candidate || {} }),
  });
  if (!exportAllowed(state, payload, "肿物输入 JSON 导出")) return;
  try {
    downloadText(`tumor_input_${Date.now()}.json`, JSON.stringify(payload, null, 2));
    setStatus(state, "已触发肿物输入 JSON 下载。文件不包含原始照片。", "normal");
    publish(state, "tumor_exported");
  } catch (error) {
    setStatus(state, `肿物导出失败：${error instanceof Error ? error.message : String(error)}`, "warning");
    publish(state, "tumor_export_failed");
  }
}

function requestFile(state: WorkflowIncisionState, id: string) {
  (rootInput(state, id) as HTMLInputElement | null)?.click();
}

async function importTumor(state: WorkflowIncisionState, file: File) {
  try {
    const imported = importedTumorFormState(JSON.parse(await file.text()), {
      diameterMin: 2,
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
    resetFreehandPhotoBoundary(state);
    state.boundaryClosed = state.boundaryRefs.length >= 3;
    state.boundaryActive = false;
    state.controlledBoundary = imported.tumor.source === "detector_confirmed";
    state.controlledBoundaryPhotoDiameterMm = state.controlledBoundary
      ? Number(imported.tumor.photo_boundary_enclosing_diameter_mm) || null
      : null;
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

function completeControlledMarkerAttempt(
  state: WorkflowIncisionState,
  mobileRetrySeed: { x: number; y: number } | null,
) {
  state.markerBusy = false;
  if (!mobileRetrySeed || !state.markerMode) return;
  state.markerSeed = { ...mobileRetrySeed };
  state.markerPendingSeed = { ...mobileRetrySeed };
  state.markerPointerSource = { ...mobileRetrySeed };
}

async function runControlledMarker(state: WorkflowIncisionState, seed: { x: number; y: number }) {
  const mobileRetrySeed = mobileWorkflowViewportActive() && state.markerPendingSeed
    ? { ...state.markerPendingSeed }
    : null;
  const frame = sourceState.planning2d?.getFrameState();
  if (state.boundaryMode === "freehand") {
    setStatus(state, FREEHAND_MARKER_DISABLED_MESSAGE, "warning");
    publish(state, "controlled_marker_freehand_blocked");
    return;
  }
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
  // Match the standalone workflow: a retry starts from an empty shared
  // selection so a failed attempt cannot look like a newly detected lesion.
  sourceState.planning2d?.setSelection({ centerRef: null, boundaryRefs: [] });
  state.markerPreviewSuppressed = true;
  requestFrame();
  const options = {
    roiRadius: Math.max(8, Math.round(started.scanDiameterMm * pixelsPerMm / 2)),
    expectedDiameterPx: Math.max(1, started.diameterMm * pixelsPerMm),
    scanDiameterMm: started.scanDiameterMm,
  };
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    setStatus(state, "浏览器无法读取当前照片像素，受控标记未运行。", "warning");
    publish(state, "controlled_marker_no_context");
    return;
  }
  prepareControlledMarkerAttempt(state);
  context.drawImage(frame.source as CanvasImageSource, 0, 0, frame.width, frame.height);
  drawRepairsToContext(state, context);
  const image = context.getImageData(0, 0, frame.width, frame.height);
  const requestId = ++state.markerRequestId;
  if (mobileRetrySeed) state.markerPendingSeed = null;
  state.markerBusy = true;
  state.markerSeed = { ...seed };
  state.markerSourceRevision = frame.revision;
  setStatus(state, state.repairStrokes.length ? "正在使用人工补线重新识别肿物边界…" : "正在识别肿物边界…");
  publish(state, "controlled_marker_running");
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
    if (!mobileRetrySeed) state.markerBusy = false;
    if (!detection.ok || !detection.center || detection.geometry_mode !== "enclosed_region") {
      completeControlledMarkerAttempt(state, mobileRetrySeed);
      state.repairAvailable = controlledMarkerRepairable(detection) || state.repairStrokes.length > 0;
      setStatus(
        state,
        `${controlledMarkerFailureMessage(detection)}${state.repairAvailable ? "可扩大扫描范围，或启用补线后沿照片中确实可见的缺口描画。" : "受控标记保持开启，可直接换位置重试。"}`,
        "warning",
      );
      publish(state, "controlled_marker_failed");
      return;
    }
    const centerRef = workflowSurfaceRefAtSource(state, frame, detection.center);
    const boundaryRefs = detection.boundary
      .map((point) => workflowSurfaceRefAtSource(state, frame, point))
      .filter((ref): ref is SurfaceRef => Boolean(ref));
    if (!centerRef || boundaryRefs.length < 3) {
      completeControlledMarkerAttempt(state, mobileRetrySeed);
      state.repairAvailable = true;
      setStatus(state, "识别边界有一部分超出可见面部皮肤范围；请换位置重试，或补齐照片中可见的缺口。", "warning");
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
      completeControlledMarkerAttempt(state, mobileRetrySeed);
      state.repairAvailable = true;
      setStatus(state, "识别范围进入眼裂、口裂或鼻孔等非皮肤开口；请移动扫描位置后重试。", "warning");
      publish(state, "controlled_marker_opening_rejected");
      return;
    }
    state.centerRef = centerRef;
    state.boundaryRefs = boundaryRefs;
    state.boundaryPhotoPoints = detection.boundary.map((point) => ({ x: point.x, y: point.y }));
    state.boundaryPhotoRevision = frame.revision;
    state.boundaryDrawingPointerId = null;
    state.boundaryDrawingStartIndex = null;
    state.boundaryClosed = true;
    state.boundaryActive = false;
    state.controlledBoundary = true;
    state.controlledBoundaryPhotoDiameterMm = workflowPhotoBoundaryEnclosingDiameterMm(
      detection.center,
      detection.boundary,
      pixelsPerMm,
    );
    state.selectionMode = false;
    state.repairMode = false;
    state.repairAvailable = state.repairStrokes.length > 0;
    state.markerPreviewSuppressed = false;
    syncSelection(state);
    await runWorkflow(state);
    if (!state.mounted || requestId !== state.markerRequestId) return;
    if (sourceState.planning2d?.getFrameState().revision !== frame.revision) return;
    completeControlledMarkerAttempt(state, mobileRetrySeed);
    setStatus(
      state,
      `已识别受控标记边界（本地检测器 v${CONTROLLED_MARKER_DETECTOR_VERSION}），候选已生成并等待审阅。`,
      state.result?.guardrails?.passed ? "normal" : "warning",
    );
    publish(state, "controlled_marker_applied");
  } catch (error) {
    if (!state.mounted || requestId !== state.markerRequestId) return;
    completeControlledMarkerAttempt(state, mobileRetrySeed);
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
  if (!planning) return [];
  const frame = planning.getFrameState();
  const projection = workflowPhotoProjection(state, frame);
  if (!projection) return [];
  return refs.map((ref) => surfaceRefToSourcePoint(ref, projection.surfaceLandmarks, state.tris))
    .map((point) => point ? sourceClientPoint(state, [point.x, point.y, 0]) : null)
    .filter((point): point is { x: number; y: number } => Boolean(point));
}

function sourceClientPoint(state: WorkflowIncisionState, point: Vec3) {
  const planning = sourceState.planning2d;
  const wrap = state.root.querySelector<HTMLElement>(".main-wrap");
  if (!planning || !wrap) return null;
  const frame = planning.getFrameState();
  const crop = renderState.focusCrop;
  const viewportPoint = workflowFocusViewportPoint(
    { x: point[0], y: point[1] },
    { width: frame.width, height: frame.height },
    crop,
  );
  const mapped = planning.sourceToClient(viewportPoint);
  if (!mapped) return null;
  const rect = wrap.getBoundingClientRect();
  const viewportLeft = frame.transform?.viewportLeft ?? rect.left;
  const viewportTop = frame.transform?.viewportTop ?? rect.top;
  return { x: mapped.x - viewportLeft, y: mapped.y - viewportTop };
}

function sourcePointAtClient(
  state: WorkflowIncisionState,
  point: { x: number; y: number },
) {
  const planning = sourceState.planning2d;
  const wrap = state.root.querySelector<HTMLElement>(".main-wrap");
  if (!planning || !wrap) return null;
  const frame = planning.getFrameState();
  const rect = wrap.getBoundingClientRect();
  return planning.clientToSource(workflowPlanningClientPoint(
    point,
    { left: rect.left, top: rect.top },
    frame.transform,
  ));
}

function photoEllipseClientPoints(state: WorkflowIncisionState, frame: PhotoPlanningFrameState): SvgPoint[] {
  if (state.kind !== "cutaneous" || state.boundaryMode !== "ellipse" || !state.centerRef) return [];
  const projection = workflowPhotoProjection(state, frame);
  const centerSource = projection
    ? surfaceRefToSourcePoint(state.centerRef, projection.surfaceLandmarks, state.tris)
    : null;
  const pixelsPerMm = projection
    ? stablePhotoPixelsPerMm(projection.surfaceLandmarks, frame.triangles, state.verts, state.unitsPerMm)
    : null;
  if (!centerSource || !pixelsPerMm) return [];
  return workflowPhotoEllipseBoundary({
    center: centerSource,
    diameterMm: state.diameterMm,
    ellipseRatio: state.ellipseRatio,
    pixelsPerMm,
  }).map((point) => sourceClientPoint(state, [point.x, point.y, 0]))
    .filter((point): point is SvgPoint => Boolean(point));
}

function clearWorkflowDraftOverlay(state: WorkflowIncisionState) {
  const svg = state.root.querySelector<SVGSVGElement>("#workflowIncisionOverlay");
  if (!svg) return;
  for (const selector of [
    "[data-workflow-boundary-halo]",
    "[data-workflow-boundary]",
    "[data-workflow-candidate-halo]",
    "[data-workflow-candidate]",
    "[data-workflow-diagnostic-candidate]",
  ]) {
    svg.querySelector<SVGPathElement>(selector)?.setAttribute("d", "");
  }
  const center = svg.querySelector<SVGCircleElement>("[data-workflow-center]");
  if (center) center.style.display = "none";
}

function drawDraftOverlay(state: WorkflowIncisionState) {
  const svg = state.root.querySelector<SVGSVGElement>("#workflowIncisionOverlay");
  if (!svg) return;
  const frame = sourceState.planning2d?.getFrameState();
  const visible = frame?.kind === "image" && Boolean(frame.landmarks?.length);
  svg.style.display = visible ? "" : "none";
  if (!visible || !frame) {
    clearWorkflowDraftOverlay(state);
    return;
  }
  const geometry = workflowPhotoGeometry(state, frame);
  const planningVisible = !state.markerPreviewSuppressed;
  const center = planningVisible && state.centerRef ? clientPoints(state, [state.centerRef])[0] : null;
  const tumorOutline = geometry ? workflowPhotoTumorOutline(state.kind, geometry) : [];
  const photoEllipse = planningVisible ? photoEllipseClientPoints(state, frame) : [];
  const photoBoundary = planningVisible
    && state.boundaryPhotoRevision === frame.revision
    && state.boundaryPhotoPoints.length > 0
    ? state.boundaryPhotoPoints
      .map((point) => sourceClientPoint(state, [point.x, point.y, 0]))
      .filter((point): point is { x: number; y: number } => Boolean(point))
    : [];
  const boundary = photoBoundary.length
    ? photoBoundary
    : geometry
    ? planningVisible
      ? tumorOutline.map((point) => sourceClientPoint(state, point)).filter((point): point is { x: number; y: number } => Boolean(point))
      : []
    : photoEllipse;
  const boundaryPath = svg.querySelector<SVGPathElement>("[data-workflow-boundary]");
  const boundaryHaloPath = svg.querySelector<SVGPathElement>("[data-workflow-boundary-halo]");
  const candidatePath = svg.querySelector<SVGPathElement>("[data-workflow-candidate]");
  const candidateHaloPath = svg.querySelector<SVGPathElement>("[data-workflow-candidate-halo]");
  const diagnosticCandidatePath = svg.querySelector<SVGPathElement>("[data-workflow-diagnostic-candidate]");
  const centerCircle = svg.querySelector<SVGCircleElement>("[data-workflow-center]");
  const boundaryPathData = photoBoundary.length && !state.boundaryClosed
    ? pathData(boundary)
    : workflowClosedBoundarySvgPath(boundary);
  boundaryPath?.setAttribute("d", boundaryPathData);
  boundaryHaloPath?.setAttribute("d", boundaryPathData);
  const photoOpeningIntersection = photoDiagnosticOpeningIntersection(geometry);
  const effectiveCandidateDisplayBlocked = (state.result?.candidate_display_blocked === true
    && !photoDisplayRecoveryActive(state, geometry))
    || Boolean(photoOpeningIntersection);
  const candidateVisible = workflowCandidateDisplayAllowed(
    { candidate_display_blocked: effectiveCandidateDisplayBlocked },
    planningVisible && Boolean(geometry?.candidateProjection.valid),
  );
  const renderedCandidatePathData = geometry
    ? state.result?.candidate?.type === "fusiform"
      ? workflowFusiformSvgPath(geometry.fusiformRendering, (point) => sourceClientPoint(state, point))
        || pathData(geometry.candidate.map((point) => sourceClientPoint(state, point)).filter((point): point is { x: number; y: number } => Boolean(point)), true)
      : pathData(geometry.candidate.map((point) => sourceClientPoint(state, point)).filter((point): point is { x: number; y: number } => Boolean(point)))
    : "";
  const diagnosticCandidate = geometry?.candidateProjection.valid
    ? geometry.candidate
    : geometry?.diagnosticCandidate || [];
  const diagnosticFusiformRendering = geometry?.candidateProjection.valid
    ? geometry.fusiformRendering
    : geometry?.diagnosticFusiformRendering;
  const diagnosticCandidatePathData = geometry
    ? state.result?.candidate?.type === "fusiform"
      ? workflowFusiformSvgPath(diagnosticFusiformRendering, (point) => sourceClientPoint(state, point))
        || pathData(diagnosticCandidate.map((point) => sourceClientPoint(state, point)).filter((point): point is { x: number; y: number } => Boolean(point)), true)
      : pathData(diagnosticCandidate.map((point) => sourceClientPoint(state, point)).filter((point): point is { x: number; y: number } => Boolean(point)))
    : "";
  const diagnosticCandidateVisible = planningVisible && workflowDiagnosticCandidateVisible(
    { ...state.result, candidate_display_blocked: effectiveCandidateDisplayBlocked },
    Boolean(geometry?.candidateProjection.valid),
    diagnosticCandidate.length,
    photoOpeningIntersection,
  );
  candidatePath?.setAttribute("d", candidateVisible ? renderedCandidatePathData : "");
  candidateHaloPath?.setAttribute("d", candidateVisible ? renderedCandidatePathData : "");
  diagnosticCandidatePath?.setAttribute("d", diagnosticCandidateVisible ? diagnosticCandidatePathData : "");
  const overlayStyle = incisionOverlayScreenStyle(state.result?.candidate?.type, {
    compact: mobileWorkflowViewportActive(),
    viewScale: frame.transform?.zoom,
  });
  if (boundaryPath) {
    boundaryPath.style.stroke = overlayStyle.boundary.color;
    boundaryPath.style.strokeWidth = String(overlayStyle.boundary.lineWidth);
  }
  if (boundaryHaloPath) {
    boundaryHaloPath.style.stroke = overlayStyle.boundary.haloColor;
    boundaryHaloPath.style.strokeWidth = String(overlayStyle.boundary.haloWidth);
  }
  if (candidatePath) {
    candidatePath.style.stroke = overlayStyle.candidate.color;
    candidatePath.style.strokeWidth = String(overlayStyle.candidate.lineWidth);
  }
  if (candidateHaloPath) {
    candidateHaloPath.style.stroke = overlayStyle.candidate.haloColor;
    candidateHaloPath.style.strokeWidth = String(overlayStyle.candidate.haloWidth);
  }
  if (center && centerCircle) {
    centerCircle.style.display = "";
    centerCircle.setAttribute("r", String(overlayStyle.center.radiusCss));
    centerCircle.style.fill = overlayStyle.center.color;
    centerCircle.style.stroke = overlayStyle.center.strokeColor;
    centerCircle.style.strokeWidth = String(overlayStyle.center.strokeWidthCss);
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
    || Boolean(renderState.focusRegion)
    || frame?.kind !== "image" || !frame.landmarks?.length
  ) {
    if (group) group.style.display = "none";
    return;
  }
  const projection = workflowPhotoProjection(state, frame);
  const pixelsPerMm = projection?.surfaceLandmarks.length && frame
    ? controlledMarkerPixelsPerMm(state, frame, sourcePoint, projection.surfaceLandmarks)
    : null;
  const geometry = pixelsPerMm ? workflowScanCircleGeometry({
    sourcePoint,
    scanDiameterMm: state.scanDiameterMm,
    pixelsPerMm,
    project: (point) => sourceClientPoint(state, [point.x, point.y, 0]),
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
  for (const stroke of [...state.repairStrokes, ...(state.repairDrawing ? [state.repairDrawing] : [])]) {
    const points = stroke.points
      .map((point) => sourceClientPoint(state, [point.x, point.y, 0]))
      .filter((point): point is { x: number; y: number } => Boolean(point));
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData(points));
    path.setAttribute("class", "workflow-repair-stroke");
    group.append(path);
  }
}

function freehandDisplaySamples(state: WorkflowIncisionState) {
  const planning = sourceState.planning2d;
  if (!planning) return [];
  return state.boundaryPhotoPoints
    .map((source) => {
      const display = planning.sourceToClient(source);
      return display ? { source, display } : null;
    })
    .filter((sample): sample is { source: SvgPoint; display: SvgPoint } => Boolean(sample));
}

function freehandDisplayPoints(state: WorkflowIncisionState): SvgPoint[] {
  return freehandDisplaySamples(state).map(({ display }) => display);
}

function claimWorkflowPointer(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function claimFreehandPointer(event: PointerEvent) {
  event.preventDefault();
  if (isMobileWorkflowTouch(event)) return;
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function cancelFreehandStrokeForTouchGesture(state: WorkflowIncisionState) {
  if (state.boundaryDrawingStartIndex !== null) {
    state.boundaryPhotoPoints.splice(state.boundaryDrawingStartIndex);
  }
  state.boundaryDrawingPointerId = null;
  state.boundaryDrawingStartIndex = null;
  state.boundaryClosed = false;
  setStatus(state, "已进入双指缩放/平移；本次尚未提交的单指笔画已取消。", "normal");
  publish(state, "freehand_touch_gesture_started");
}

function markerBusyToolbarPointer(state: WorkflowIncisionState, event: Event): boolean {
  const target = event.target;
  return state.markerBusy
    && target instanceof Element
    && Boolean(target.closest(".workflow-canvas-tools"));
}

function blockMarkerBusyPointer(state: WorkflowIncisionState, event: PointerEvent): boolean {
  if (!state.markerBusy) return false;
  state.pendingClick = null;
  state.mobileMarkerTouchIntent = null;
  state.mobileTouchPointers.clear();
  state.mobileTouchGestureActive = false;
  claimWorkflowPointer(event);
  return true;
}

function handleFreehandPointerDown(
  state: WorkflowIncisionState,
  event: PointerEvent,
  frame: PhotoPlanningFrameState,
): boolean {
  if (event.button !== 0 || state.kind !== "cutaneous" || state.boundaryMode !== "freehand") return false;
  const planning = sourceState.planning2d;
  const sourcePoint = sourcePointAtClient(state, { x: event.clientX, y: event.clientY });
  if (!planning) return false;
  if (!sourcePoint) {
    claimFreehandPointer(event);
    setStatus(state, "当前位置不在照片显示区域，请在面部图像内继续描画。", "warning");
    publish(state, "freehand_boundary_unmapped_start");
    return true;
  }
  if (state.boundaryPhotoRevision !== frame.revision) resetFreehandPhotoBoundary(state, true);
  const displayPoints = freehandDisplayPoints(state);
  if (!workflowFreehandContinuationAllowed(displayPoints, { x: event.clientX, y: event.clientY })) {
    setStatus(state, "请从上一段轮廓的末端附近继续描画；如需重画，请先清空轮廓。", "warning");
    publish(state, "freehand_boundary_continuation_rejected");
    claimFreehandPointer(event);
    return true;
  }
  if (!state.boundaryPhotoPoints.length) {
    invalidateCandidate(state, "肿物边界正在重新描画，旧活动候选已撤销。完成闭合后请重新审阅。");
    state.centerRef = null;
    state.boundaryRefs = [];
    state.boundaryClosed = false;
  }
  state.boundaryDrawingStartIndex = state.boundaryPhotoPoints.length;
  const previous = state.boundaryPhotoPoints.at(-1);
  if (!previous || Math.hypot(sourcePoint.x - previous.x, sourcePoint.y - previous.y) >= 1) {
    state.boundaryPhotoPoints.push(sourcePoint);
  }
  state.boundaryPhotoRevision = frame.revision;
  state.boundaryDrawingPointerId = event.pointerId;
  state.controlledBoundary = false;
  state.controlledBoundaryPhotoDiameterMm = null;
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  setStatus(state, "正在描画皮表肿物边界；完成闭环后请松开鼠标，再点击“结束描绘”进行识别。", "normal");
  syncSelection(state);
  publish(state, "freehand_boundary_started");
  claimFreehandPointer(event);
  return true;
}

function handleFreehandPointerMove(state: WorkflowIncisionState, event: PointerEvent): boolean {
  if (state.boundaryDrawingPointerId !== event.pointerId) return false;
  claimFreehandPointer(event);
  const point = sourcePointAtClient(state, { x: event.clientX, y: event.clientY });
  if (!point) return true;
  const previous = state.boundaryPhotoPoints.at(-1);
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 1) {
    state.boundaryPhotoPoints.push(point);
    scheduleOverlayDraw(state);
  }
  return true;
}

async function finalizeWorkflowFreehandBoundary(state: WorkflowIncisionState): Promise<void> {
  if (state.boundaryDrawingPointerId !== null) {
    setStatus(state, "正在描画中，请先松开鼠标或结束触屏笔迹，再点击“结束描绘”。", "warning");
    publish(state, "freehand_boundary_finish_while_drawing");
    return;
  }
  const planning = sourceState.planning2d;
  const frame = planning?.getFrameState();
  const recovered = recoverWorkflowFreehandBoundary(freehandDisplaySamples(state));
  if (recovered.length < 8) {
    state.boundaryClosed = false;
    setStatus(state, "轮廓尚未闭合；请从线条末端继续描画，回到起点附近或与已画线相交，再点击“结束描绘”。", "warning");
    publish(state, "freehand_boundary_finish_open");
    return;
  }
  if (frame?.kind !== "image" || !frame.landmarks?.length) {
    setStatus(state, "照片状态已变化，当前轮廓未提交；请重新上传照片后再描画。", "warning");
    publish(state, "freehand_boundary_stale_photo");
    return;
  }
  if (workflowPhotoOpeningIntersection(recovered, frame.landmarks)) {
    state.boundaryClosed = false;
    setStatus(state, "轮廓进入眼裂、口裂或鼻孔等非皮肤开口；请清空后在可见皮肤内重新描画。", "warning");
    publish(state, "freehand_boundary_opening_rejected");
    return;
  }
  const centerSource = workflowBoundaryCentroid(recovered);
  const centerRef = centerSource ? workflowSurfaceRefAtSource(state, frame, centerSource) : null;
  if (!centerRef) {
    state.boundaryClosed = false;
    setStatus(state, "绘制范围的中心不在可见面部皮肤内；请清空后重新描画。", "warning");
    publish(state, "freehand_boundary_center_rejected");
    return;
  }
  const refs = recovered
    .map((point) => workflowSurfaceRefAtSource(state, frame, point))
    .filter((ref): ref is SurfaceRef => Boolean(ref));
  if (refs.length !== recovered.length) {
    state.boundaryClosed = false;
    setStatus(state, "轮廓有一部分超出可见面部皮肤范围；请清空后重新描画。", "warning");
    publish(state, "freehand_boundary_surface_rejected");
    return;
  }
  state.centerRef = centerRef;
  state.boundaryPhotoPoints = recovered;
  state.boundaryPhotoRevision = frame.revision;
  state.boundaryRefs = refs;
  state.boundaryClosed = true;
  state.boundaryActive = false;
  state.controlledBoundary = false;
  state.controlledBoundaryPhotoDiameterMm = null;
  syncSelection(state);
  setStatus(state, "已结束描绘，正在识别并整理肿物边界。", "normal");
  publish(state, "freehand_boundary_submitted");
  await runWorkflow(state);
}

function handleFreehandPointerUp(state: WorkflowIncisionState, event: PointerEvent): boolean {
  if (state.boundaryDrawingPointerId !== event.pointerId) return false;
  const planning = sourceState.planning2d;
  const finalPoint = sourcePointAtClient(state, { x: event.clientX, y: event.clientY });
  const previous = state.boundaryPhotoPoints.at(-1);
  if (finalPoint && (!previous || Math.hypot(finalPoint.x - previous.x, finalPoint.y - previous.y) >= 1)) {
    state.boundaryPhotoPoints.push(finalPoint);
  }
  state.boundaryDrawingPointerId = null;
  state.boundaryDrawingStartIndex = null;
  state.boundaryClosed = false;
  (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
  claimFreehandPointer(event);
  setStatus(state, "本段轮廓已记录；可从末端继续描画，完成后请点击“结束描绘”进行识别。", "normal");
  publish(state, "freehand_boundary_stroke_paused");
  return true;
}

function handleCanvasPointerDown(state: WorkflowIncisionState, event: PointerEvent) {
  if (markerBusyToolbarPointer(state, event)) return;
  const planning = sourceState.planning2d;
  const frame = planning?.getFrameState();
  if (!planning || frame?.kind !== "image") return;
  if (blockMarkerBusyPointer(state, event)) return;
  if (renderState.focusRegion) {
    const target = event.target;
    if (target instanceof Element && target.closest(".workflow-canvas-tools")) return;
    claimWorkflowPointer(event);
    state.markerPointerSource = null;
    setStatus(state, "局部放大图仅用于核对同一面部位置；请切换回“全脸”后创建或编辑肿物与切口。", "warning");
    publish(state, "focused_photo_edit_blocked");
    return;
  }
  const mobileMarkerTouch = state.markerMode && !state.repairMode && isMobileWorkflowTouch(event);
  const mobileFreehandTouch = state.boundaryActive
    && state.kind === "cutaneous"
    && state.boundaryMode === "freehand"
    && isMobileWorkflowTouch(event);
  if (mobileFreehandTouch) {
    state.mobileTouchPointers.add(event.pointerId);
    if (state.mobileTouchPointers.size > 1) {
      state.mobileTouchGestureActive = true;
      cancelFreehandStrokeForTouchGesture(state);
      event.preventDefault();
      return;
    }
  }
  if (mobileMarkerTouch) {
    state.mobileTouchPointers.add(event.pointerId);
    if (state.mobileTouchPointers.size > 1) {
      state.mobileTouchGestureActive = true;
      state.mobileMarkerTouchIntent = null;
    } else if (!state.mobileTouchGestureActive) {
      state.mobileMarkerTouchIntent = beginWorkflowPointerIntent(
        event.pointerId,
        event.button,
        event.clientX,
        event.clientY,
      );
    }
  }
  if (mobileMarkerTouch) {
    event.preventDefault();
    return;
  }
  if (state.repairMode) {
    const point = sourcePointAtClient(state, { x: event.clientX, y: event.clientY });
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
  if (state.boundaryActive && handleFreehandPointerDown(state, event, frame)) return;
  if (state.boundaryMode === "freehand" && !state.boundaryActive && !state.markerMode) {
    claimWorkflowPointer(event);
    state.pendingClick = null;
    state.selectionMode = false;
    setStatus(state, "当前已有自由轮廓肿物边界。如需重画，请再次点击“开始描绘”；如需生成模拟肿物，请切换为“椭圆近似”。", "warning");
    publish(state, "freehand_inactive_canvas_click_blocked");
    return;
  }
  if (!state.selectionMode && !state.markerMode && !state.boundaryActive) {
    const target = event.target;
    if (target instanceof Element && target.closest(".workflow-canvas-tools")) return;
    state.pendingClick = beginWorkflowPointerIntent(event.pointerId, event.button, event.clientX, event.clientY);
    return;
  }
  const sourcePoint = sourcePointAtClient(state, { x: event.clientX, y: event.clientY });
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
  const photoOpening = pixelsPerMm
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
    publish(state, "tumor_opening_photo_rejected");
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
  state.controlledBoundaryPhotoDiameterMm = null;
  if (state.boundaryMode === "freehand") resetFreehandPhotoBoundary(state, true);
  syncSelection(state);
  void runWorkflow(state);
}

function handleCanvasPointerMove(state: WorkflowIncisionState, event: PointerEvent) {
  if (markerBusyToolbarPointer(state, event)) return;
  if (blockMarkerBusyPointer(state, event)) return;
  if (isMobileWorkflowTouch(event) && state.mobileTouchGestureActive
    && state.mobileTouchPointers.has(event.pointerId)) {
    event.preventDefault();
    return;
  }
  if (handleFreehandPointerMove(state, event)) return;
  if (state.markerMode && !state.repairMode && isMobileWorkflowTouch(event)
    && state.mobileTouchPointers.has(event.pointerId)) {
    updateWorkflowPointerIntent(
      state.mobileMarkerTouchIntent,
      event.pointerId,
      event.clientX,
      event.clientY,
    );
    event.preventDefault();
    return;
  }
  updateWorkflowPointerIntent(state.pendingClick, event.pointerId, event.clientX, event.clientY);
  if (state.markerMode && !state.repairMode) {
    state.markerPointerSource = sourcePointAtClient(state, { x: event.clientX, y: event.clientY });
  }
  if (!state.repairDrawing) {
    scheduleOverlayDraw(state);
    return;
  }
  const point = sourcePointAtClient(state, { x: event.clientX, y: event.clientY });
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
  if (markerBusyToolbarPointer(state, event)) return;
  if (blockMarkerBusyPointer(state, event)) return;
  const mobileFreehandTouch = isMobileWorkflowTouch(event)
    && state.boundaryMode === "freehand"
    && state.mobileTouchPointers.has(event.pointerId);
  if (mobileFreehandTouch) {
    const wasGesture = state.mobileTouchGestureActive;
    state.mobileTouchPointers.delete(event.pointerId);
    if (state.mobileTouchPointers.size === 0) state.mobileTouchGestureActive = false;
    if (wasGesture) {
      event.preventDefault();
      return;
    }
  }
  if (handleFreehandPointerUp(state, event)) return;
  if (isMobileWorkflowTouch(event) && state.mobileTouchPointers.has(event.pointerId)) {
    const wasGesture = state.mobileTouchGestureActive;
    const placementReady = state.markerMode
      && !state.repairMode
      && !wasGesture
      && completesWorkflowCanvasClick(state.mobileMarkerTouchIntent, event.pointerId);
    state.mobileTouchPointers.delete(event.pointerId);
    if (state.mobileTouchPointers.size === 0) state.mobileTouchGestureActive = false;
    state.mobileMarkerTouchIntent = null;
    if (placementReady) {
      const sourcePoint = sourcePointAtClient(state, { x: event.clientX, y: event.clientY });
      if (sourcePoint) {
        state.markerPendingSeed = { ...sourcePoint };
        state.markerPointerSource = { ...sourcePoint };
        setStatus(state, "扫描圆圈已放置。请确认圆圈覆盖完整肿物边界，再点击“识别此处”；可再次轻触照片调整位置。", "normal");
        publish(state, "mobile_marker_placement_ready");
      } else {
        setStatus(state, "该位置不在照片显示区域，请重新轻触肿物附近。", "warning");
        publish(state, "mobile_marker_placement_unmapped");
      }
    }
    event.preventDefault();
    return;
  }
  if (!state.repairDrawing) {
    const directSelection = completesWorkflowCanvasClick(state.pendingClick, event.pointerId);
    state.pendingClick = null;
    if (!directSelection) return;
    const planning = sourceState.planning2d;
    const frame = planning?.getFrameState();
    const sourcePoint = frame?.kind === "image"
      ? sourcePointAtClient(state, { x: event.clientX, y: event.clientY })
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
    state.controlledBoundaryPhotoDiameterMm = null;
    if (state.boundaryMode === "freehand") resetFreehandPhotoBoundary(state, true);
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
  if (markerBusyToolbarPointer(state, event)) return;
  if (blockMarkerBusyPointer(state, event)) return;
  state.pendingClick = null;
  if (isMobileWorkflowTouch(event)) {
    state.mobileTouchPointers.delete(event.pointerId);
    if (state.mobileTouchPointers.size === 0) state.mobileTouchGestureActive = false;
    if (state.mobileMarkerTouchIntent?.pointerId === event.pointerId) state.mobileMarkerTouchIntent = null;
  }
  if (state.boundaryDrawingPointerId === event.pointerId) {
    state.boundaryDrawingPointerId = null;
    state.boundaryDrawingStartIndex = null;
    (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
    setStatus(state, "轮廓描画已中断；请从线条末端附近继续，并让线条首尾相接。", "warning");
    publish(state, "freehand_boundary_cancelled");
    return;
  }
  if (!state.repairDrawing) return;
  state.repairDrawing = null;
  (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
  drawRepairStrokes(state);
  publish(state, "marker_repair_cancelled");
}

function handleCanvasPointerLeave(state: WorkflowIncisionState) {
  if (state.markerBusy) return;
  state.markerPointerSource = state.markerPendingSeed ? { ...state.markerPendingSeed } : null;
  scheduleOverlayDraw(state);
}

function cancelControlledMarker(state: WorkflowIncisionState): boolean {
  if (!state.markerBusy) return false;
  const seed = state.markerSeed || state.markerPointerSource;
  state.markerRequestId += 1;
  if (state.workflowBusy) {
    state.workflowRequestId += 1;
    state.workflowBusy = false;
  }
  state.markerBusy = false;
  state.repairMode = false;
  state.mobileMarkerTouchIntent = null;
  state.mobileTouchPointers.clear();
  state.mobileTouchGestureActive = false;
  if (seed) {
    state.markerSeed = { ...seed };
    state.markerPointerSource = { ...seed };
    state.markerPendingSeed = state.markerMode ? { ...seed } : null;
  }
  state.markerPreviewSuppressed = true;
  setStatus(
    state,
    mobileWorkflowViewportActive()
      ? "识别已取消；扫描圆圈和照片位置已保留，可核对后再次点击“识别此处”。"
      : "识别已取消；扫描位置和照片视图已保留，可在照片上重新点击识别。",
  );
  scheduleOverlayDraw(state);
  return true;
}

function applyTumorCommand(state: WorkflowIncisionState, event: Event) {
  const detail = readIncisionTumorCommand(event);
  if (!detail) return;
  const value = detail.value;
  if (detail.command === "diameter_inactive_hint") {
    setStatus(state, TUMOR_DIAMETER_DISABLED_MESSAGE, "warning");
    publish(state, "diameter_inactive_hint");
    return;
  }
  const liveParameterCommands = ["diameter_input", "depth_input", "margin_input", "ellipse_ratio_input"];
  const committedParameterCommands = ["diameter_changed", "depth_changed", "margin_changed", "ellipse_ratio_changed"];
  const geometryChange = !["author_changed", "export_tumor", "import_tumor", "run_workflow"].includes(detail.command);
  const parameterChange = liveParameterCommands.includes(detail.command) || committedParameterCommands.includes(detail.command);
  if (geometryChange && !parameterChange) {
    invalidateCandidate(state, "肿物参数已变化，旧活动候选已撤销。请重新审阅。");
  }
  if (geometryChange && state.markerBusy) {
    resetMarkerRepair(state);
    state.markerPreviewSuppressed = state.markerMode;
  }
  switch (detail.command) {
    case "kind_changed":
      state.kind = value === "subcutaneous" ? "subcutaneous" : "cutaneous";
      state.boundaryActive = false;
      state.controlledBoundary = false;
      state.controlledBoundaryPhotoDiameterMm = null;
      resetFreehandPhotoBoundary(state, true);
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
      if (tumorDiameterParameterInactive({
        kind: state.kind,
        boundaryMode: state.boundaryMode,
        controlledMarkerMode: state.markerMode,
      })) break;
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
      {
        const transition = workflowBoundaryModeTransition(state.boundaryMode, "select");
        state.boundaryActive = transition.boundaryActive;
        if (transition.clearCenter) state.centerRef = null;
      }
      state.controlledBoundary = false;
      state.controlledBoundaryPhotoDiameterMm = null;
      resetFreehandPhotoBoundary(state, true);
      if (state.boundaryActive) {
        state.selectionMode = false;
        state.markerMode = false;
        setStatus(state, "自由轮廓鼠绘已开启：按住鼠标左键沿肿物边界描画，并让线条首尾相接。", "normal");
      }
      break;
    case "ellipse_ratio_input":
    case "ellipse_ratio_changed": state.ellipseRatio = Number(value); break;
    case "toggle_boundary":
      if (state.boundaryActive) {
        state.selectionMode = false;
        state.markerMode = false;
        if (state.boundaryPhotoPoints.length === 0) {
          setStatus(state, "尚未描画自由轮廓；请先沿肿物边界描画，再点击“结束描绘”。", "warning");
          break;
        }
        void finalizeWorkflowFreehandBoundary(state);
        return;
      }
      state.boundaryActive = true;
      state.selectionMode = false;
      state.markerMode = false;
      resetFreehandPhotoBoundary(state, true);
      state.centerRef = null;
      setStatus(state, "按住鼠标左键沿肿物边界连续描画；完成后点击“结束描绘”进行识别。", "normal");
      break;
    case "clear_boundary":
      resetFreehandPhotoBoundary(state, true);
      {
        const transition = workflowBoundaryModeTransition(state.boundaryMode, "clear");
        state.boundaryActive = transition.boundaryActive;
        if (transition.clearCenter) state.centerRef = null;
      }
      state.controlledBoundary = false;
      state.controlledBoundaryPhotoDiameterMm = null;
      setStatus(state, state.boundaryMode === "freehand"
        ? "自由轮廓已清空；请按住鼠标左键重新描画完整边界。"
        : "肿物边界已清空。", "normal");
      break;
    case "export_tumor": exportTumor(state); return;
    case "import_tumor": requestFile(state, "tumorImportFile"); return;
    case "run_workflow": void runWorkflow(state, true, Boolean(state.result)); return;
  }
  syncSelection(state);
  const boundaryTransition = detail.command === "boundary_mode_changed"
    ? workflowBoundaryModeTransition(state.boundaryMode, "select")
    : null;
  if (liveParameterCommands.includes(detail.command) && state.centerRef) {
    cancelCandidateRecompute(state);
    state.candidateRecomputeTimer = window.setTimeout(() => {
      state.candidateRecomputeTimer = null;
      void runWorkflow(state, false, true);
    }, 80);
    publish(state, detail.command);
  } else if (committedParameterCommands.includes(detail.command) && state.centerRef) {
    cancelCandidateRecompute(state);
    void runWorkflow(state, false, true);
  } else if (["kind_changed", "boundary_mode_changed"].includes(detail.command)
    && state.centerRef
    && boundaryTransition?.mayGenerateCandidate !== false) {
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

function clearActiveCandidateAfterMobileEdit(state: WorkflowIncisionState) {
  markCandidatePendingReview(state, "workflow_mobile_candidate_edited");
}

function applyMobileCandidateEdit(state: WorkflowIncisionState, reason: string) {
  const baseResult = workflowFusiformEditBase(state.result, state.baseResult);
  if (!baseResult) {
    setStatus(state, "请先生成梭形候选，再进行移动端微调。", "warning");
    publish(state, "mobile_edit_unavailable");
    return;
  }
  state.baseResult = baseResult;
  const center = (baseResult.candidate?.center || baseResult.tumor?.center) as Vec3 | undefined;
  const fallbackNormal: Vec3 = center ? state.normals[nearestVertex(state, center)] || [0, 0, 1] : [0, 0, 1];
  const normal = workflowFusiformPlaneNormal(baseResult.candidate, fallbackNormal);
  state.result = applyCandidateEdit(baseResult, state.edit, normal, state.unitsPerMm, state.verts);
  clearActiveCandidateAfterMobileEdit(state);
  setStatus(
    state,
    incisionEditIsActive(state.edit)
      ? "移动端候选已调整；中心点保持不变，请重新审阅确认。"
      : "已恢复工具建议；请重新审阅确认。",
  );
  publish(state, reason);
}

function scheduleMobileCandidateEdit(state: WorkflowIncisionState) {
  if (state.mobileEditPreviewFrame !== null) return;
  state.mobileEditPreviewFrame = window.requestAnimationFrame(() => {
    state.mobileEditPreviewFrame = null;
    if (state.mounted) applyMobileCandidateEdit(state, "mobile_edit_previewed");
  });
}

function handleMobileEditCommand(state: WorkflowIncisionState, event: Event) {
  if (!mobileWorkflowViewportActive()) return;
  const detail = readIncisionEditCommand(event);
  if (!detail) return;
  if (detail.command === "reset_edit") {
    cancelMobileEditPreview(state);
    state.edit = neutralIncisionEdit();
    applyMobileCandidateEdit(state, "mobile_edit_reset");
    return;
  }
  if (detail.command !== "preview_edit" && detail.command !== "commit_edit") return;
  const value = Number(detail.value);
  if (!Number.isFinite(value)) return;
  const before = `${state.edit.angle_offset_deg}|${state.edit.length_scale}|${state.edit.width_scale}`;
  switch (detail.controlId) {
    case "angleOffsetDeg":
      state.edit.angle_offset_deg = Math.max(-35, Math.min(35, value));
      break;
    case "uniformScale": {
      const scale = Math.max(1, Math.min(1.5, value / 100));
      state.edit.length_scale = scale;
      state.edit.width_scale = scale;
      break;
    }
    case "lengthScale":
      state.edit.length_scale = Math.max(1, Math.min(1.5, value / 100));
      break;
    case "widthScale":
      state.edit.width_scale = Math.max(1, Math.min(1.5, value / 100));
      break;
    default:
      return;
  }
  const changed = before !== `${state.edit.angle_offset_deg}|${state.edit.length_scale}|${state.edit.width_scale}`;
  if (detail.command === "preview_edit") {
    if (changed) scheduleMobileCandidateEdit(state);
    return;
  }
  const previewPending = state.mobileEditPreviewFrame !== null;
  cancelMobileEditPreview(state);
  if (changed || previewPending) applyMobileCandidateEdit(state, "mobile_edit_committed");
}

function handleReviewCommand(state: WorkflowIncisionState, event: Event) {
  const detail = readIncisionReviewCommand(event);
  if (!detail) return;
  currentReview(state);
  if (state.reviewAttention === "reviewer" && state.review.reviewer) state.reviewAttention = null;
  if (state.reviewAttention === "decision" && state.review.status !== "approved_for_discussion") {
    state.reviewAttention = null;
  }
  if (state.reviewAttention === "notes" && state.review.notes) state.reviewAttention = null;
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

function loadSavedCandidateState(state: WorkflowIncisionState, record: DynamicRecord) {
  resetMarkerRepair(state);
  state.markerMode = false;
  state.markerPointerSource = null;
  state.markerPreviewSuppressed = false;
  state.baseResult = {
    ...record,
    original_candidate: record.original_candidate || record.candidate,
    review_status: record.review_status,
  };
  state.edit = neutralIncisionEdit();
  state.result = state.baseResult;
  state.kind = record.tumor?.kind === "subcutaneous" ? "subcutaneous" : "cutaneous";
  state.diameterMm = Number(record.tumor?.diameter_mm || state.diameterMm);
  state.depthMm = Number(record.tumor?.depth_mm || state.depthMm);
  state.marginMm = Number(record.tumor?.margin_mm || 0);
  state.author = String(record.tumor?.author || state.author);
  state.centerRef = pointToSurfaceRef(record.tumor?.center, state.verts, state.tris);
  state.boundaryRefs = pointsToSurfaceRefs(record.tumor?.boundary || [], state.verts, state.tris);
  resetFreehandPhotoBoundary(state);
  state.boundaryClosed = state.boundaryRefs.length >= 3;
  state.boundaryActive = false;
  state.controlledBoundary = record.tumor?.source === "detector_confirmed";
  state.controlledBoundaryPhotoDiameterMm = state.controlledBoundary
    ? Number(record.tumor?.photo_boundary_enclosing_diameter_mm) || null
    : null;
  state.boundaryMode = record.tumor?.boundary_mode === "freehand" ? "freehand" : "ellipse";
  state.review = {
    status: record.review?.status || record.review_status,
    reviewer: record.review?.reviewer || "",
    notes: record.review?.notes || "",
  };
  state.reviewAttention = null;
  const reviewer = rootInput(state, "reviewerName");
  const notes = rootInput(state, "reviewNotes");
  const decision = rootInput(state, "reviewDecision");
  if (reviewer) reviewer.value = state.review.reviewer;
  if (notes) notes.value = state.review.notes;
  if (decision) decision.value = state.review.status;
  syncSelection(state);
}

function toggleSavedCandidateReviewStatus(state: WorkflowIncisionState, id: string) {
  const recordIndex = state.saved.findIndex((item) => item.id === id);
  if (recordIndex < 0) return;
  const record = state.saved[recordIndex];
  const currentStatus = String(record.review?.status || record.review_status || "pending_clinician_confirmation");
  if (currentStatus !== "pending_clinician_confirmation" && currentStatus !== "approved_for_discussion") {
    setStatus(state, "当前候选状态不能使用待确认/已确认切换按钮。", "warning");
    publish(state, "candidate_review_transition_unsupported");
    return;
  }

  const wasCurrentCandidate = state.result?.id === record.id;
  const reviewContext = wasCurrentCandidate
    ? currentReview(state)
    : record.review;
  const targetStatus = currentStatus === "pending_clinician_confirmation"
    ? "approved_for_discussion"
    : "pending_clinician_confirmation";
  const transition = transitionIncisionReviewRecord({ record, targetStatus, reviewContext });

  if (!transition.ok) {
    loadSavedCandidateState(state, record);
    state.reviewAttention = transition.attention;
    renderState.incisionOverlay = null;
    publishLiveOverlayState(state, false, "未叠加 · 待医生确认", "workflow_incision_review_transition_blocked");
    setStatus(state, `无法转为已确认：${transition.message}`, "warning");
    requestFrame();
    publish(state, "candidate_review_transition_blocked");
    return;
  }

  state.saved = state.saved.map((item, index) => index === recordIndex ? transition.record : item);
  if (targetStatus === "approved_for_discussion") {
    loadSavedCandidateState(state, transition.record);
    if (activateRecord(state, transition.record)) {
      setStatus(state, "已转为已确认研究候选；审阅门禁已通过，候选已进入实时叠加。", "normal");
    }
  } else if (wasCurrentCandidate) {
    loadSavedCandidateState(state, transition.record);
    renderState.incisionOverlay = null;
    publishLiveOverlayState(state, false, "未叠加 · 待医生确认", "workflow_incision_review_transitioned_to_pending");
    setStatus(state, "已转为待医生确认；实时叠加已关闭，候选几何和审阅历史已保留。", "warning");
    requestFrame();
  } else {
    setStatus(state, "已转为待医生确认；候选几何和审阅历史已保留。", "normal");
  }
  publish(state, "candidate_review_status_transitioned");
}

function handleLibraryCommand(state: WorkflowIncisionState, event: Event) {
  const detail = readIncisionLibraryCommand(event);
  if (!detail) return;
  switch (detail.command) {
    case "save_current": saveCurrent(state); return;
    case "make_variants": {
      const review = currentReview(state);
      if (acknowledgeDiagnosticReview(state, review)) return;
      if (!review.reviewer) {
        state.reviewAttention = "reviewer";
        setStatus(state, "保存候选记录前请填写审阅人。", "warning");
        publish(state, "variant_save_missing_reviewer");
        return;
      }
      const alternatives = state.result?.candidate_alternatives || [];
      let savedCount = 0;
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
        if (record) {
          state.saved.push(record);
          savedCount += 1;
        }
      }
      setStatus(state, savedCount ? `已保存 ${savedCount} 个方向备选` : "当前结果没有可保存的方向备选", savedCount ? "normal" : "warning");
      publish(state, "variants_saved");
      return;
    }
    case "clear_saved": state.saved = []; setStatus(state, "已清空候选库"); publish(state, "saved_cleared"); return;
    case "load_candidate": {
      const record = state.saved.find((item) => item.id === detail.id);
      if (!record) return;
      loadSavedCandidateState(state, record);
      activateRecord(state, record);
      publish(state, "candidate_loaded");
      return;
    }
    case "toggle_candidate_review_status": toggleSavedCandidateReviewStatus(state, detail.id as string); return;
    case "remove_candidate": state.saved = state.saved.filter((item) => item.id !== detail.id); publish(state, "candidate_removed"); return;
    case "export_json": exportReview(state); return;
    case "export_report": {
      const current = currentDiagnosticCandidateVisible(state)
        ? null
        : buildRecord(state, state.result, "当前候选");
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
      setStatus(state, "无需手动添加叠加；候选完成审阅并通过显示检查后会自动显示。", "warning");
      publish(state, "legacy_stage_ignored");
  }
}

function handleToolCommand(state: WorkflowIncisionState, event: Event) {
  const detail = readControllerCommandDetail(event as CustomEvent, WORKFLOW_INCISION_TOOL_COMMANDS);
  if (!detail) return;
  let rerunAfterCommand = false;
  switch (detail.command) {
    case "select_lesion":
      state.selectionMode = !state.selectionMode;
      state.markerMode = false;
      state.repairMode = false;
      state.markerPendingSeed = null;
      state.mobileMarkerTouchIntent = null;
      state.mobileTouchPointers.clear();
      state.mobileTouchGestureActive = false;
      setStatus(state, state.selectionMode ? "请在当前照片的人脸区域点击肿物中心。" : "已退出肿物选择。");
      break;
    case "controlled_marker":
      if (!state.markerMode && state.boundaryMode === "freehand") {
        setStatus(state, FREEHAND_MARKER_DISABLED_MESSAGE, "warning");
        publish(state, "controlled_marker_freehand_blocked");
        return;
      }
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
      state.markerPendingSeed = null;
      state.mobileMarkerTouchIntent = null;
      state.mobileTouchPointers.clear();
      state.mobileTouchGestureActive = false;
      state.markerPointerSource = null;
      state.markerPreviewSuppressed = state.markerMode;
      state.markerSourceRevision = state.markerMode
        ? sourceState.planning2d?.getFrameState().revision ?? null
        : null;
      if (!state.markerMode && state.controlledBoundary) {
        invalidateCandidate(state, "已退出受控标记；当前点位已切回椭圆近似，请按直径参数重新审阅候选。");
        state.controlledBoundary = false;
        state.controlledBoundaryPhotoDiameterMm = null;
        state.boundaryMode = "ellipse";
        state.boundaryActive = false;
        resetFreehandPhotoBoundary(state, true);
        rerunAfterCommand = Boolean(state.centerRef);
      }
      setStatus(
        state,
        state.markerMode
          ? mobileWorkflowViewportActive()
            ? `受控标记已开启：可双指缩放或平移照片；轻触肿物放置 ${state.scanDiameterMm} mm 扫描圆圈，确认位置后点击“识别此处”。`
            : `受控标记已开启：鼠标圆形扫描面当前为 ${state.scanDiameterMm} mm。请让扫描面覆盖完整肿物边界后点击。`
          : "已退出受控标记识别。",
      );
      break;
    case "confirm_controlled_marker": {
      if (!mobileWorkflowViewportActive()) break;
      if (state.markerBusy) {
        setStatus(state, "正在识别肿物边界，请稍候。", "warning");
        break;
      }
      if (!state.markerMode || !state.markerPendingSeed) {
        setStatus(state, "请先轻触照片中的肿物，放置扫描圆圈后再确认识别。", "warning");
        break;
      }
      const seed = { ...state.markerPendingSeed };
      state.markerPointerSource = { ...seed };
      void runControlledMarker(state, seed);
      break;
    }
    case "cancel_controlled_marker":
      cancelControlledMarker(state);
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
      if (state.markerMode) {
        setStatus(
          state,
          state.markerPendingSeed && mobileWorkflowViewportActive()
            ? `扫描圆圈已调整为 ${state.scanDiameterMm} mm，当前识别结果未更新。请核对覆盖范围，再点击“识别此处”。`
            : mobileWorkflowViewportActive()
              ? `轻触肿物放置 ${state.scanDiameterMm} mm 扫描圆圈，确认位置后点击“识别此处”。`
              : `扫描面已调整为 ${state.scanDiameterMm} mm，当前识别结果未更新。请让扫描面覆盖完整肿物边界后重新点击照片识别。`,
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
  if (rerunAfterCommand) void runWorkflow(state);
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
  window.addEventListener("langerface:image-view-changed", () => scheduleOverlayDraw(state), { signal: abort.signal });
  window.addEventListener("langerface:focus-crop-changed", () => scheduleOverlayDraw(state), { signal: abort.signal });
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
  for (const id of ["reviewerName", "reviewNotes"]) {
    rootInput(state, id)?.addEventListener("input", () => scheduleWorkflowDraftSave(state), { signal: abort.signal });
  }
  window.addEventListener("pagehide", () => {
    cancelWorkflowDraftSave(state);
    persistWorkflowDraft(state);
  }, { signal: abort.signal });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    cancelWorkflowDraftSave(state);
    persistWorkflowDraft(state);
  }, { signal: abort.signal });
  window.addEventListener("langerface:refine2d-state", () => {
    if (!reconcileProjectedRstlSnapshot(state)) scheduleOverlayDraw(state);
  }, { signal: abort.signal });
  const commandCleanup = bindWindowControllerEvents([
    [INCISION_TUMOR_REACT_COMMAND_EVENT, (event) => applyTumorCommand(state, event)],
    [INCISION_EDIT_REACT_COMMAND_EVENT, (event) => handleMobileEditCommand(state, event)],
    [INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT, (event) => handleSecondaryCueCommand(state, event)],
    [INCISION_REVIEW_REACT_COMMAND_EVENT, (event) => handleReviewCommand(state, event)],
    [INCISION_LIBRARY_REACT_COMMAND_EVENT, (event) => handleLibraryCommand(state, event)],
    [WORKFLOW_INCISION_TOOL_REACT_COMMAND_EVENT, (event) => handleToolCommand(state, event)],
    [WORKFLOW_DRAFT_RESTORE_EVENT, (event) => {
      state.pendingDraftRestore = (event as CustomEvent<WorkflowIncisionDraft | null>).detail ?? null;
      applyWorkflowDraftRestore(state);
    }],
    [LIVE_CONTROLLER_STATE_EVENT, (event) => {
      const snapshot = (event as CustomEvent<LiveControllerSnapshot>).detail;
      if (snapshot?.schema_version) state.liveSnapshot = snapshot;
      const revision = sourceState.planning2d?.getFrameState().revision ?? null;
      if (revision !== state.lastSourceRevision) {
        state.lastSourceRevision = revision;
        resetWorkflowForSourceChange(state, revision);
      } else if (state.markerSourceRevision !== null && revision !== state.markerSourceRevision) {
        resetMarkerRepair(state);
        state.markerMode = false;
        state.markerPointerSource = null;
        state.markerPreviewSuppressed = false;
        setStatus(state, "媒体已变化，旧受控标记补线状态已清除。");
        publish(state, "marker_source_changed");
      } else if (reconcileProjectedRstlSnapshot(state)) {
        // The old candidate is intentionally invalidated instead of following
        // RSTL continuously. The next explicit generation consumes this snapshot.
      } else if (workflowPhotoReady(state) !== state.lastPublishedPhotoReady) {
        publish(state, "workflow_photo_readiness_changed");
      } else {
        scheduleOverlayDraw(state);
      }
      applyWorkflowDraftRestore(state);
    }],
  ]);
  state.cleanup = () => {
    abort.abort();
    delete state.root.dataset.workflowMarkerBusy;
    delete state.root.dataset.workflowMarkerMode;
    commandCleanup();
    cancelWorkflowDraftSave(state);
    if (wrap) delete wrap.dataset.workflowPointerMode;
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
    if (applyWorkflowDraftRestore(state)) return;
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
  cancelWorkflowDraftSave(state);
  persistWorkflowDraft(state);
  state.mounted = false;
  state.markerRequestId += 1;
  state.workflowRequestId += 1;
  cancelCandidateRecompute(state);
  cancelMobileEditPreview(state);
  state.cleanup?.();
  state.worker?.dispose();
  state.worker = null;
  renderState.workflowPhotoOverlay = false;
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
  renderState.workflowPhotoOverlay = true;
  bindDom(state);
  publish(state, "mounted");
  void loadAssets(state);
  return disposeWorkflowIncisionController;
}
