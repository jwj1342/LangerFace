import * as THREE from "three";

import { compileIncisionOverlay, pointToSurfaceRef } from "./incisionOverlay.ts";
import { createPhotoPlanningController } from "./photoPlanningController";
import type { SurfaceRef } from "./incisionOverlay.ts";
import { pointsToSurfaceRefs, surfaceRefToModelPoint } from "./incisionPhotoPlanning";
import { createIncisionPhotoRuntime, type IncisionPhotoRuntime } from "./incisionPhotoRuntime";
import {
  applyCandidateEdit,
  workflowTraceGate,
  classifyRegion,
  compareCandidateRecords,
  summarizeTumorBoundary,
  summarizeTumorInputQuality,
  unitsPerMmFromVertices,
} from "./incisionTools.ts";
import type { TumorInput } from "./incisionCandidateTools.ts";
import {
  INCISION_CONTROLLER_STATE_EVENT,
  INCISION_EDIT_REACT_COMMAND_EVENT,
  INCISION_LIBRARY_REACT_COMMAND_EVENT,
  INCISION_REVIEW_REACT_COMMAND_EVENT,
  INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT,
  INCISION_TUMOR_REACT_COMMAND_EVENT,
} from "../lib/controllerEvents";
import {
  bindWindowControllerEvents,
  dispatchControllerEvent,
} from "../lib/controllerCommand";
import { isReactManagedWorkbench } from "../lib/reactManagedWorkbench";
import { assetBaseUrl } from "./assetLoader";
import {
  guardrailLabel,
  reasonLabel,
  regionLabel,
  reviewStatusLabel,
  subunitLabel,
} from "./incisionClinicalCopy";
import { collectIncisionElements, type IncisionDomElements } from "./incisionDom";
import {
  buildLocalIncisionPrivacyAudit,
  normalizeSecondaryCuePayload,
} from "./incisionAuxiliaryEvidence";
import {
  applyReactEditControlValue,
  applyReactTumorControlValue,
  bindIncisionDomEvents,
} from "./incisionDomBindings";
import {
  buildIncisionAssetLoadingSnapshot,
  buildIncisionCandidateSnapshot,
  buildIncisionControllerSnapshot,
  buildIncisionEditSnapshot,
  buildIncisionPrivacyAuditSnapshot,
  buildIncisionResultViewSnapshot,
  buildIncisionReviewSnapshot,
  buildIncisionSavedCandidateSummaries,
  buildIncisionSecondaryCueSnapshot,
  type IncisionHeadAssetState,
  incisionHasClass as hasClass,
  incisionTextOf as textOf,
  incisionTitleOf as titleOf,
} from "./incisionSnapshots";
import {
  buildTumorFormSnapshot,
  buildTumorInput,
  importedTumorFormState,
  numericControlValue,
  shouldClearFreehandBoundaryOnLesionRepick,
} from "./tumorInput";
import { dataSource } from "./dataSource";
import type { HeadMeshPayload } from "./dataSource";
import { auditExportPayload } from "./exportPrivacy";
import { resolveIncisionAtlas, type IncisionAtlasResolution } from "./incisionAtlasSource";
import {
  buildReviewExportPayload,
  buildTumorExportPayload,
  downloadCanvasPng,
  downloadText,
} from "./incisionExport";
import {
  incisionEditIsActive,
  neutralIncisionEdit,
  type IncisionEdit,
} from "./incisionEditHistory";
import { createIncisionControllerState, resetIncisionBoundaryState, type IncisionRuntimeState } from "./incisionControllerState";
import {
  buildCandidateEditSession,
  buildIncisionReviewRecord,
  buildIncisionReviewReport,
  findSensitiveStructureInspection,
} from "./incisionReviewRecords";
import {
  buildIncisionResultPresentation,
  type IncisionTextPresentation,
} from "./incisionPresenter";
import { IncisionCommandRouter } from "./incisionCommandRouter";
import {
  createIncisionSessionGuard,
  loadIncisionSessionAssets,
  type IncisionSessionToken,
} from "./incisionSession";
import {
  pickEndpointHandle,
  pickFaceSurface,
  signedAngleDegrees,
} from "./incisionPicking";
import {
  add3 as add,
  buildBoundaryGeometry,
  buildPolylineGeometry,
  buildRingGeometry,
  clamp,
  cross3 as cross,
  dot3 as dot,
  length3 as len,
  meanMeshEdgeLength,
  normalize3 as norm,
  scale3 as mul,
  subtract3 as sub,
  tangentFrame,
} from "./incisionSceneGeometry";
import type { VectorLike } from "./incisionSceneGeometry";
import {
  assessReviewReadiness,
  buildReviewGate,
  reviewForCandidateRecord,
} from "./incisionReviewPolicy";
import {
  buildIncisionWorkspaceSession,
  loadIncisionWorkspaceSession,
  saveIncisionWorkspaceSession,
  tumorContextsMatch,
} from "./incisionWorkspaceSession";
import { planIncisionWithWorkflowFallback } from "./workflowPlanner";
import { createWorkflowWorkerClient } from "./workflowWorkerClient";
import { Head3D, buildLineGeometry, vertexNormals } from "./three3d.ts";
import type { Vec3 } from "./softBody";

type DynamicRecord = Record<string, any>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let els = {} as IncisionDomElements;
let S: IncisionRuntimeState = createIncisionControllerState();
let photoRuntime: IncisionPhotoRuntime | null = null;
const activeSession = createIncisionSessionGuard();
function isActiveSession(session: IncisionSessionToken): boolean {
  return S.mounted && activeSession.isActive(session);
}
function currentTumorFormSnapshot() {
  return buildTumorFormSnapshot({
    kind: els.tumorKind?.value,
    author: els.tumorAuthor?.value,
    diameterMm: numericControlValue(els.diameter),
    depthMm: numericControlValue(els.depth),
    marginMm: numericControlValue(els.margin),
    boundaryMode: els.boundaryMode?.value,
    boundaryActive: Boolean(S.boundaryActive),
    boundaryPointCount: S.boundaryPoints?.length || 0,
    boundaryStatus: els.boundaryStatus?.textContent || "",
    boundaryStatusWarn: Boolean(els.boundaryStatus?.classList?.contains("warn")),
    pickState: els.pickState?.textContent || "",
    anatomyPreview: els.anatomyPreview?.textContent || "",
    anatomyPreviewWarn: Boolean(els.anatomyPreview?.classList?.contains("warn")),
  });
}

function currentSecondaryCueSnapshot() {
  return buildIncisionSecondaryCueSnapshot({
    present: Boolean(S.secondaryCues),
    stateLabel: els.secondaryCueState?.textContent || "未导入",
    summary: els.secondaryCueSummary?.textContent || "仅展示自然皱襞、皱纹和皮表肿物边界的低置信度线索；不会自动改变肿物边界或候选切口。",
    manualConfirmed: Boolean(els.secondaryCueConfirmed?.checked),
  });
}

function currentPrivacyAuditSnapshot() {
  return buildIncisionPrivacyAuditSnapshot({
    stateLabel: els.privacyState?.textContent || "本地几何",
    message: els.privacyAudit?.textContent || "所有切口 workflow 均在浏览器本地执行，不配置或调用远程模型。",
  });
}

function currentAssetLoadingSnapshot() {
  return buildIncisionAssetLoadingSnapshot({
    visible: !els.assetLoading?.classList?.contains("hidden"),
    text: els.assetLoadingText?.textContent || "准备下载 MediaPipe 面部表面、个体化张力线和切口规划资产。",
  });
}

function currentHeadAssetSnapshot(): IncisionHeadAssetState {
  return S.headAsset || {
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

function currentReviewSnapshot() {
  return buildIncisionReviewSnapshot({
    status: els.reviewDecision?.value || "pending_clinician_confirmation",
    reviewer: els.reviewerName?.value?.trim?.() || "",
    notesPresent: Boolean(els.reviewNotes?.value?.trim?.()),
  });
}

function persistWorkspaceSession() {
  if (!S.mounted || !S.verts.length || !els.tumorKind) return false;
  const tumor = tumorInput();
  const resultMatchesTumor = tumorContextsMatch(S.result?.tumor, tumor);
  return saveIncisionWorkspaceSession(buildIncisionWorkspaceSession({
    tumor,
    result: resultMatchesTumor ? S.result : null,
    baseResult: resultMatchesTumor ? S.baseResult : null,
    saved: S.saved,
    review: currentReviewMetadata(),
    generationCount: S.generationCount,
  }));
}

function restoreWorkspaceSession() {
  const session = loadIncisionWorkspaceSession();
  if (!session) return false;
  applyTumorContext(session.tumor);
  S.saved = session.saved;
  S.generationCount = session.generationCount;
  S.baseResult = session.baseResult;
  setReviewControls(session.review);
  renderSaved();
  if (session.result && tumorContextsMatch(session.result.tumor, session.tumor)) {
    renderResult(session.result);
    els.stageStatus.textContent = "已恢复切口候选、审阅状态和候选库";
  } else {
    runWorkflow();
  }
  publishIncisionState("workspace_session_restored");
  return true;
}

function currentEditSnapshot() {
  const edit = currentEditBase();
  return buildIncisionEditSnapshot({
    edit,
    tipAngleDeg: Number(els.tipAngle?.value || baseTipAngleDeg()),
    statusLabel: els.editStatus?.textContent || "工具建议",
    statusActive: Boolean(els.editStatus?.classList?.contains("active")),
    editActive: incisionEditIsActive(edit),
    widthScaleVisible: !els.widthScaleWrap?.classList?.contains("hidden"),
    tipAngleVisible: !els.tipAngleWrap?.classList?.contains("hidden"),
    historyLabel: els.editHistoryState?.textContent || "编辑版本：v1 · 无已提交调整",
    undoDisabled: Boolean(els.undoEdit?.disabled),
    redoDisabled: Boolean(els.redoEdit?.disabled),
  });
}

function currentCandidateSnapshot(result = S.result) {
  return buildIncisionCandidateSnapshot(result);
}

function currentResultViewSnapshot() {
  return buildIncisionResultViewSnapshot({
    candidateType: els.candidateType,
    candidateLength: els.candidateLength,
    candidateWidth: els.candidateWidth,
    candidateTipAngle: els.candidateTipAngle,
    rstlDeviation: els.candidateRstlDeviation,
    directionConfidence: els.directionConf,
    region: els.regionVal,
    guardrail: els.guardrailVal,
    workflowSummary: els.workflowSummary,
    directionSource: els.directionSource,
    workflowGate: els.workflowGate,
    workflowComparison: els.workflowComparison,
    nextStep: els.nextStep,
    guardrailDetails: els.guardrailDetails,
  });
}

function currentSavedCandidateSummaries() {
  return buildIncisionSavedCandidateSummaries({
    records: S.saved as any,
    comparisons: compareCandidateRecords(S.saved || []),
    reviewStatusLabel,
  });
}

function publishIncisionState(reason = "state_update") {
  if (!S.mounted || typeof window === "undefined" || !els.stageStatus) return;
  dispatchControllerEvent(INCISION_CONTROLLER_STATE_EVENT, buildIncisionControllerSnapshot({
    reason,
    stageStatus: els.stageStatus?.textContent || "",
    assetLoading: currentAssetLoadingSnapshot(),
    headAsset: currentHeadAssetSnapshot(),
    tumor: currentTumorFormSnapshot(),
    secondaryCue: currentSecondaryCueSnapshot(),
    privacyAudit: currentPrivacyAuditSnapshot(),
    review: currentReviewSnapshot(),
    edit: currentEditSnapshot(),
    candidate: currentCandidateSnapshot(),
    resultView: currentResultViewSnapshot(),
    savedCandidates: currentSavedCandidateSummaries(),
    workflowRuntime: S.result?.workflow_runtime || null,
    savedCount: S.saved?.length || 0,
  }));
}

function formatAssetBytes(bytes: unknown): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function updateAssetLoading(evt: DynamicRecord = {}): void {
  const label = evt.label || evt.key || "资产";
  const loaded = formatAssetBytes(evt.loaded);
  const total = formatAssetBytes(evt.total);
  const progress = loaded && total ? ` · ${loaded}/${total}` : loaded ? ` · ${loaded}` : "";
  if (els.assetLoadingText) {
    els.assetLoadingText.textContent = `${label}${evt.phase === "done" ? " 已加载" : " 加载中"}${progress}`;
  }
  if (els.stageStatus) {
    els.stageStatus.textContent = `正在从 ${assetBaseUrl()} 加载 ${label}${progress}`;
  }
  publishIncisionState("asset_loading");
}

function hideAssetLoading() {
  els.assetLoading?.classList.add("hidden");
  publishIncisionState("asset_loaded");
}

function defaultLesion(): number {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of S.verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  // Start the research demo in the mid-cheek classifier instead of directly
  // inside the lower-eyelid region.
  const target: Vec3 = [c[0] + 0.30 * (hi[0] - lo[0]), c[1] - 0.02 * (hi[1] - lo[1]), hi[2]];
  let best = 0, bd = Infinity;
  for (let i = 0; i < S.verts.length; i++) {
    const d = len(sub(S.verts[i], target));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function nearestVertex(point: unknown): number {
  if (!S.verts || !Array.isArray(point)) return S.lesion || 0;
  let best = 0, bd = Infinity;
  for (let i = 0; i < S.verts.length; i++) {
    const d = len(sub(S.verts[i], point as VectorLike));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function headAssetSnapshot({
  head,
  atlas,
  resolved,
}: {
  head: HeadMeshPayload;
  atlas: DynamicRecord;
  resolved: IncisionAtlasResolution;
}): IncisionHeadAssetState {
  return {
    id: head.id,
    label: head.label,
    topologyId: head.topologyId,
    topologyVersion: head.topologyVersion,
    vertexCount: head.vertices.length,
    triangleCount: head.triangles.length,
    atlasTopologyId: typeof atlas?.topologyId === "string" ? atlas.topologyId : null,
    atlasLineCount: Array.isArray(atlas?.lines) ? atlas.lines.length : 0,
    mode: resolved.mode,
    atlasProvenance: resolved.provenance,
    atlasContract: resolved.contract,
    statusLabel: resolved.statusLabel,
    warnings: resolved.warnings,
  };
}

async function loadMediaPipeIncisionAssets(session: IncisionSessionToken) {
  const updateActiveAssetLoading = (event: DynamicRecord) => {
    if (isActiveSession(session)) updateAssetLoading(event);
  };
  const assets = await loadIncisionSessionAssets(session, isActiveSession, {
    loadHead: () => dataSource.getHeadMesh("mediapipe-468", { onProgress: updateActiveAssetLoading }),
    loadStandardAtlas: () => dataSource.loadAtlas("rstl", { onProgress: updateActiveAssetLoading }),
    takePreviewAtlas: () => dataSource.takePreviewAtlas(),
  });
  if (!assets) return null;
  const { head, standardAtlas, personalizedAtlas } = assets;
  const resolved = resolveIncisionAtlas({
    personalizedAtlas,
    standardAtlas,
    triangleCount: head.triangles.length,
  });
  return {
    head,
    atlas: resolved.atlas as DynamicRecord,
    headAsset: headAssetSnapshot({
      head,
      atlas: resolved.atlas as DynamicRecord,
      resolved,
    }),
  };
}

async function boot(session: IncisionSessionToken) {
  const assets = await loadMediaPipeIncisionAssets(session);
  if (!assets) return;
  const { head, atlas, headAsset } = assets;
  if (!isActiveSession(session)) return;
  S.verts = head.vertices; S.tris = head.triangles; S.atlas = atlas; S.headAsset = headAsset; S.assetWarnings = headAsset.warnings;
  S.planning2d?.setTopology(S.tris);
  S.planning2d?.setOverlaySummary({ rstlLineCount: atlas.lines?.length || 0 });
  S.normals = vertexNormals(S.verts, S.tris);
  S.meanEdge = meanMeshEdgeLength(S.verts, S.tris);
  S.unitsPerMm = unitsPerMmFromVertices(S.verts);

  S.head = new Head3D(els.canvas);
  S.head.setGeometry(
    S.verts,
    S.tris,
    atlas.lines || [],
    { showSurface: true, bands: false },
  );
  if (S.head.lines) {
    S.head.lines.material.transparent = true;
    S.head.lines.material.opacity = 0.62;
  }
  S.head.resetView();

  S.marker = new THREE.Mesh(
    new THREE.SphereGeometry(S.meanEdge * 0.30, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.92, toneMapped: false }),
  );
  S.tumorRing = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xfacc15, toneMapped: false }),
  );
  S.boundaryLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xfb7185, toneMapped: false }),
  );
  S.candidateLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x34d399, depthTest: false, toneMapped: false }),
  );
  S.endpointHandles = [0, 1].map((idx) => {
    const h = new THREE.Mesh(
      new THREE.SphereGeometry(S.meanEdge * 0.22, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.95, toneMapped: false }),
    );
    h.userData.handle = idx;
    h.renderOrder = 8;
    return h;
  });
  S.marker.renderOrder = 5; S.tumorRing.renderOrder = 5; S.boundaryLine.renderOrder = 6; S.candidateLine.renderOrder = 7;
  if (S.marker && S.tumorRing && S.boundaryLine && S.candidateLine) {
    S.head.group.add(S.marker, S.tumorRing, S.boundaryLine, S.candidateLine, ...S.endpointHandles);
  }

  renderSecondaryCuePanel();
  const restored = restoreWorkspaceSession();
  if (!restored) setLesion(defaultLesion());
  fitSize();
  renderLoop();
  if (!restored) runWorkflow();
  hideAssetLoading();
}

function fitSize() {
  if (!S.head || !els.wrap) return;
  const w = els.wrap.clientWidth || 900, h = els.wrap.clientHeight || 680;
  S.head.resize(w, h);
  photoRuntime?.fit();
}

function clearTransientPlanningForPhoto() {
  S.boundaryPoints = [];
  S.boundaryRefs = [];
  S.boundaryActive = false;
  S.lesionRef = null;
  S.result = null;
  S.baseResult = null;
  resetEditTimeline();
  S.candidateLine && (S.candidateLine.visible = false);
  for (const handle of S.endpointHandles) handle.visible = false;
  resetEditControls();
  for (const element of [
    els.candidateType,
    els.candidateLength,
    els.candidateWidth,
    els.candidateTipAngle,
    els.candidateRstlDeviation,
    els.directionConf,
    els.regionVal,
    els.guardrailVal,
  ]) element.textContent = "—";
  els.workflowSummary.textContent = "等待患者照片检测与规划";
  els.workflowGate.textContent = "未生成";
  els.workflowComparison.textContent = "—";
  els.guardrailDetails.textContent = "";
  els.nextStep.textContent = "照片检测完成后点击面部定位病灶。";
  resetReviewControls();
}

const privacyAudit = () => buildLocalIncisionPrivacyAudit(Boolean(S.secondaryCues));

function secondaryCueReviewSummary() {
  if (!S.secondaryCues) {
    return {
      present: false,
      manual_confirmed: false,
      used_for_geometry: false,
    };
  }
  return {
    present: true,
    ...S.secondaryCues,
    manual_confirmed: Boolean(els.secondaryCueConfirmed?.checked),
  };
}

function renderSecondaryCuePanel() {
  if (!els.secondaryCueState || !els.secondaryCueSummary) return;
  if (!S.secondaryCues) {
    els.secondaryCueState.textContent = "未导入";
    els.secondaryCueSummary.textContent = "仅展示自然皱襞、皱纹和皮表肿物边界的低置信度线索；不会自动改变肿物边界或候选切口。";
    publishIncisionState("secondary_cue_state");
    return;
  }
  const lesion = S.secondaryCues.lesion || {};
  const wrinkle = S.secondaryCues.wrinkle || {};
  els.secondaryCueState.textContent = "低置信度 · 需医生确认";
  els.secondaryCueSummary.textContent = [
    `来源：${S.secondaryCues.source} · ${S.secondaryCues.source_tool}`,
    `标签：${S.secondaryCues.confidence_label}`,
    `皮表边界 IoU ${fmt(lesion.iou, 2)} / precision ${fmt(lesion.precision, 2)} / recall ${fmt(lesion.recall, 2)}`,
    `皱纹 recall ${fmt(wrinkle.recall, 2)} / precision ${fmt(wrinkle.precision, 2)}`,
    "只读展示：不进入几何生成，不发送给 远程模型输入。",
  ].join("\n");
  publishIncisionState("secondary_cue_state");
}

function setSecondaryCueConfirmedFromControl() {
  renderSecondaryCuePanel();
  els.stageStatus.textContent = els.secondaryCueConfirmed?.checked
    ? "辅助线索已标记为人工确认；仍不参与候选几何。"
    : "辅助线索人工确认已取消；仍不参与候选几何。";
  publishIncisionState("secondary_cue_confirmed");
}

function updateReviewStateUI() {
  const status = els.reviewDecision.value || "pending_clinician_confirmation";
  els.reviewState.textContent = reviewStatusLabel(status);
  els.reviewState.classList.toggle("approved", status === "approved_for_discussion");
  els.reviewState.classList.toggle("rejected", status === "rejected_by_clinician");
  els.reviewState.classList.toggle("revision", status === "needs_revision");
  publishIncisionState("review_state");
}

function currentReviewMetadata(at = new Date().toISOString()) {
  const status = els.reviewDecision.value || "pending_clinician_confirmation";
  const terminal = status !== "pending_clinician_confirmation";
  return {
    status,
    label: reviewStatusLabel(status),
    reviewer: els.reviewerName.value.trim(),
    notes: els.reviewNotes.value.trim(),
    reviewed_at: terminal ? at : null,
    confirmation_scope: "research_candidate_only_not_surgical_order",
  };
}

function setReviewControls(review: DynamicRecord = {}) {
  els.reviewDecision.value = review.status || "pending_clinician_confirmation";
  els.reviewerName.value = review.reviewer || "";
  els.reviewNotes.value = review.notes || "";
  updateReviewStateUI();
}

function reviewReadiness(status: string, result = S.result) {
  return assessReviewReadiness({
    status,
    result,
    reviewer: els.reviewerName.value,
    notes: els.reviewNotes.value,
  });
}

function resetReviewControls() {
  setReviewControls({ status: "pending_clinician_confirmation", reviewer: els.reviewerName.value });
}

function invalidateReviewAfterGeometryChange(message = "候选几何已变化，审阅状态已回到待医生确认。") {
  if (els.reviewDecision.value !== "pending_clinician_confirmation") {
    els.reviewDecision.value = "pending_clinician_confirmation";
    updateReviewStateUI();
    els.stageStatus.textContent = message;
  }
}

function exportPreflightPasses(payload: unknown, label: string) {
  const report = auditExportPayload(payload);
  if (report.passed) return true;
  const preview = report.violations.slice(0, 3).map((v) => `${v.code}@${v.path}`).join("；");
  els.stageStatus.textContent = `${label}已阻断：隐私预检发现 ${report.violation_count} 个问题：${preview}`;
  els.privacyAudit.textContent = "导出隐私预检未通过；请移除原始媒体、明文密钥或直接身份字段后再导出。";
  els.privacyState.textContent = "导出已阻断";
  publishIncisionState("privacy_preflight_failed");
  return false;
}

function tumorInput() {
  return buildTumorInput({
    kind: els.tumorKind.value,
    center: (S.lesionRef && surfaceRefToModelPoint(S.lesionRef, S.verts, S.tris)) || S.verts[S.lesion],
    diameterMm: numericControlValue(els.diameter),
    depthMm: numericControlValue(els.depth),
    marginMm: numericControlValue(els.margin),
    boundary: tumorBoundaryPoints(),
    boundaryMode: els.boundaryMode.value,
    author: els.tumorAuthor.value,
  });
}

function boundarySummaryFor(tumor: TumorInput = tumorInput(), result = S.result) {
  const axis = result?.candidate?.axis || result?.original_candidate?.axis || S.result?.candidate?.axis || S.baseResult?.candidate?.axis || [1, 0, 0];
  const lesionIndex = Array.isArray(tumor?.center) ? nearestVertex(tumor.center) : S.lesion;
  const normal = S.normals?.[lesionIndex] || S.normals?.[S.lesion] || [0, 0, 1];
  return summarizeTumorBoundary(tumor, axis, normal, S.unitsPerMm || 1);
}

function updateBoundaryStatus() {
  if (!els.boundaryStatus || !S.verts) return;
  const tumor = tumorInput();
  const summary = boundarySummaryFor(tumor);
  els.boundaryStatus.classList.toggle("warn", Boolean(summary.warnings?.length));
  if (tumor.kind !== "cutaneous") {
    els.boundaryStatus.textContent = `皮下范围：直径估计 ${fmt(tumor.diameter_mm)} mm（非真实边界）`;
    return;
  }
  if (!summary.boundary_used) {
    els.boundaryStatus.textContent = `皮表边界：${summary.point_count || 0} 点，当前按中心直径近似`;
    return;
  }
  const warn = summary.warnings?.length ? ` · ${summary.warnings.map((w: DynamicRecord) => guardrailLabel(w.code)).join("；")}` : "";
  const area = summary.area_mm2 != null ? ` · 面积 ${fmt(summary.area_mm2)} mm²` : "";
  const selfX = summary.self_intersection ? " · 自交" : "";
  els.boundaryStatus.textContent = `皮表边界：${summary.point_count} 点 · 横向 ${fmt(summary.perp_diameter_mm)} mm · 长轴覆盖 ${fmt(summary.axis_diameter_mm)} mm${area}${selfX}${warn}`;
}

function updateAnatomyPreview() {
  if (!els.anatomyPreview || !S.verts) return;
  const anatomy = classifyRegion(S.verts[S.lesion], S.verts);
  const reasons = anatomy.confidence_reasons || [];
  const confidence = Math.round((anatomy.confidence || 0) * 100);
  const freeMargin = anatomy.free_margin_distance_mm != null
    ? ` · 游离缘 ${fmt(anatomy.free_margin_distance_mm)} mm`
    : "";
  const reasonText = reasons.length ? ` · ${reasons.map(reasonLabel).join("；")}` : "";
  els.anatomyPreview.textContent = `当前点位分区：${regionLabel(anatomy.region)} / ${subunitLabel(anatomy.subunit)} · 置信 ${confidence}%${freeMargin}${reasonText}`;
  els.anatomyPreview.title = reasons.length ? `分区置信原因：${reasons.map(reasonLabel).join("；")}` : "";
  els.anatomyPreview.classList.toggle(
    "warn",
    (anatomy.confidence || 0) < 0.55 ||
      reasons.includes("near_sensitive_free_margin") ||
      reasons.includes("near_region_rule_boundary"),
  );
}

function ellipseBoundaryPoints(samples = 32): Vec3[] {
  const center = (S.lesionRef && surfaceRefToModelPoint(S.lesionRef, S.verts, S.tris)) || S.verts[S.lesion];
  const normal = S.normals[S.lesion];
  const { u, v } = tangentFrame(normal, [0, 1, 0]);
  const radiusMm = Number(els.diameter.value) / 2;
  const ratio = Number(els.ellipseRatio.value) / 100;
  const a = radiusMm * S.unitsPerMm;
  const b = radiusMm * ratio * S.unitsPerMm;
  const pts: Vec3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / samples * Math.PI * 2;
    pts.push(add(add(center, mul(u, Math.cos(t) * a)), mul(v, Math.sin(t) * b)));
  }
  return pts;
}

function tumorBoundaryPoints(): Vec3[] {
  if (els.tumorKind.value !== "cutaneous") return [];
  if (els.boundaryMode.value === "freehand" && S.boundaryPoints.length >= 3) return S.boundaryPoints;
  return ellipseBoundaryPoints();
}

function syncPhotoPlanningSelection() {
  if (!S.planning2d || !S.verts.length || !S.tris.length) return;
  const centerRef = S.lesionRef || pointToSurfaceRef(S.verts[S.lesion], S.verts, S.tris);
  S.lesionRef = centerRef;
  const boundaryPoints = tumorBoundaryPoints();
  const usePhotoRefs = els.boundaryMode.value === "freehand"
    && S.boundaryPoints.length >= 3
    && S.boundaryRefs.length === S.boundaryPoints.length;
  const boundaryRefs = usePhotoRefs
    ? [...S.boundaryRefs]
    : pointsToSurfaceRefs(boundaryPoints, S.verts, S.tris);
  S.planning2d.setSelection({ centerRef, boundaryRefs });
  S.planning2d.setOverlaySummary({
    tumorVisible: centerRef !== null,
    candidatePointCount: S.result?.candidate?.polyline?.length || 0,
  });
  photoRuntime?.render();
}

function setLesion(i: number, centerRef: SurfaceRef | null = null) {
  S.lesion = i;
  S.lesionRef = centerRef || pointToSurfaceRef(S.verts[i], S.verts, S.tris);
  const center = (S.lesionRef && surfaceRefToModelPoint(S.lesionRef, S.verts, S.tris)) || S.verts[i], normal = S.normals[i];
  const markerPoint = add(center, mul(normal, S.meanEdge * 0.34));
  S.marker?.position.set(markerPoint[0], markerPoint[1], markerPoint[2]);
  updateTumorRing();
  els.pickState.textContent = `当前点位：顶点 #${i}`;
  updateAnatomyPreview();
  syncPhotoPlanningSelection();
}

function updateTumorRing() {
  if (!S.tumorRing || !S.verts) return;
  const tumor = tumorInput();
  const diameterMm = Number(tumor.diameter_mm || 0);
  const marginMm = Number(tumor.margin_mm || 0);
  const radiusMm = tumor.kind === "cutaneous" ? diameterMm / 2 + marginMm : diameterMm / 2;
  const old = S.tumorRing.geometry;
  S.tumorRing.geometry = buildRingGeometry(
    (S.lesionRef && surfaceRefToModelPoint(S.lesionRef, S.verts, S.tris)) || S.verts[S.lesion],
    S.normals[S.lesion],
    radiusMm * S.unitsPerMm,
    S.meanEdge,
  );
  old.dispose();
  if (!S.boundaryLine) return;
  const bold = S.boundaryLine.geometry;
  const boundary = tumorBoundaryPoints();
  S.boundaryLine.geometry = buildBoundaryGeometry(
    boundary,
    S.normals[S.lesion],
    S.meanEdge,
    boundary.length >= 3,
  );
  S.boundaryLine.visible = tumor.kind === "cutaneous" && boundary.length >= 2;
  bold.dispose();
  updateBoundaryStatus();
  syncPhotoPlanningSelection();
}

function drawCandidate(result: DynamicRecord) {
  if (!S.candidateLine) return;
  S.candidateLine.visible = true;
  const old = S.candidateLine.geometry;
  S.candidateLine.geometry = buildPolylineGeometry(
    result.candidate.polyline,
    S.normals[S.lesion],
    S.meanEdge,
  );
  old.dispose();
  S.candidateLine.visible = true;
  (S.candidateLine.material as THREE.LineBasicMaterial).color.set(result.candidate.type === "linear" ? 0x34d399 : 0x5eead4);
  const endpoints = result.candidate.endpoints || [];
  const lift = S.meanEdge * 0.42;
  for (const [idx, h] of S.endpointHandles.entries()) {
    const p = endpoints[idx];
    h.visible = Boolean(p);
    if (p) {
      const hp = add(p, mul(S.normals[S.lesion], lift));
      h.position.set(hp[0], hp[1], hp[2]);
    }
  }
  S.planning2d?.setOverlaySummary({ candidatePointCount: result.candidate.polyline?.length || 0 });
  photoRuntime?.render();
}

function updateFormVisibility() {
  const cutaneous = els.tumorKind.value === "cutaneous";
  els.depthWrap.classList.toggle("hidden", cutaneous);
  els.marginWrap.classList.toggle("hidden", !cutaneous);
  els.boundaryWrap.classList.toggle("hidden", !cutaneous);
  els.ellipseWrap.classList.toggle("hidden", !cutaneous || els.boundaryMode.value !== "ellipse");
  els.freehandControls.classList.toggle("hidden", !cutaneous || els.boundaryMode.value !== "freehand");
  updateTumorRing();
  updateAnatomyPreview();
}

function toggleBoundaryDrawing() {
  S.boundaryActive = !S.boundaryActive;
  els.startBoundary.textContent = S.boundaryActive ? "结束轮廓" : "开始轮廓";
  els.pickState.textContent = S.boundaryActive ? "请在脸上连续点击皮表肿物边界点。" : `自由轮廓点：${S.boundaryPoints.length} 个`;
  if (!S.boundaryActive && S.boundaryPoints.length >= 3) previewWorkflow();
  publishIncisionState("tumor_boundary_toggle");
}

function clearBoundaryPoints() {
  S.boundaryPoints = [];
  S.boundaryRefs = [];
  updateTumorRing();
  els.pickState.textContent = "自由轮廓已清空。";
  previewWorkflow();
  publishIncisionState("tumor_boundary_clear");
}

function fmt(x: unknown, digits = 1): string {
  return Number.isFinite(Number(x)) ? Number(x).toFixed(digits) : "—";
}

function baseTipAngleDeg(): number {
  const base = S.baseResult?.original_candidate || S.baseResult?.candidate;
  const value = Number(base?.metrics?.tip_angle_target_deg ?? base?.tip_angle_deg ?? 30);
  return Number.isFinite(value) ? value : 30;
}

function currentEditBase(): IncisionEdit {
  const tipAngleDeg = Number(els.tipAngle.value);
  const baseTipAngle = baseTipAngleDeg();
  return {
    angle_offset_deg: Number(els.angleOffset.value),
    length_scale: Number(els.lengthScale.value) / 100,
    width_scale: Number(els.widthScale.value) / 100,
    tip_angle_deg: Number.isFinite(tipAngleDeg) && Math.abs(tipAngleDeg - baseTipAngle) > 1e-9
      ? tipAngleDeg
      : null,
    shift_along_mm: Number(els.shiftAlong.value),
    shift_perp_mm: Number(els.shiftPerp.value),
    reason: els.editReason.value,
  };
}

function currentEdit(): IncisionEdit {
  const edit = currentEditBase();
  return {
    ...edit,
    session_history: S.editHistory.entriesFor(edit),
  };
}

function syncEditLabels() {
  els.angleOffsetVal.textContent = els.angleOffset.value;
  els.lengthScaleVal.textContent = `${els.lengthScale.value}%`;
  els.widthScaleVal.textContent = `${els.widthScale.value}%`;
  els.tipAngleVal.textContent = `${els.tipAngle.value}°`;
  els.shiftAlongVal.textContent = els.shiftAlong.value;
  els.shiftPerpVal.textContent = els.shiftPerp.value;
}

function setEditControls(edit: DynamicRecord = neutralIncisionEdit()) {
  els.angleOffset.value = String(Math.round(Number(edit.angle_offset_deg || 0)));
  els.lengthScale.value = String(Math.round(Number(edit.length_scale || 1) * 100));
  els.widthScale.value = String(Math.round(Number(edit.width_scale || 1) * 100));
  els.tipAngle.value = String(Math.round(
    edit.tip_angle_deg == null ? baseTipAngleDeg() : Number(edit.tip_angle_deg),
  ));
  els.shiftAlong.value = String(Math.round(Number(edit.shift_along_mm || 0)));
  els.shiftPerp.value = String(Math.round(Number(edit.shift_perp_mm || 0)));
  els.editReason.value = String(edit.reason || "");
  syncEditLabels();
}

function resetEditControls() {
  setEditControls(neutralIncisionEdit());
}

function resetEditTimeline() {
  S.editHistory.reset();
  renderEditHistoryState();
}

function renderEditHistoryState() {
  if (!els.editHistoryState) return;
  const edit = currentEditBase();
  const summary = S.editHistory.summary(edit);
  const pending = summary.uncommitted ? " · 当前预览未提交" : "";
  els.editHistoryState.textContent = summary.historyCount
    ? `编辑版本：v${summary.version} · 已提交 ${summary.committedCount} 步${pending}`
    : `编辑版本：v1 · 无已提交调整${pending}`;
  if (els.undoEdit) els.undoEdit.disabled = !summary.canUndo;
  if (els.redoEdit) els.redoEdit.disabled = !summary.canRedo;
  publishIncisionState("edit_state");
}

function commitEditSnapshot(interaction = "control_change") {
  if (!S.editHistory.commit(currentEditBase(), interaction)) {
    renderEditHistoryState();
    return;
  }
  renderEditHistoryState();
  if (S.baseResult) {
    const result = applyCandidateEdit(S.baseResult, currentEdit(), S.normals[S.lesion], S.unitsPerMm, S.verts);
    renderResult(result);
  }
}

function applyEditSnapshot(edit: DynamicRecord) {
  setEditControls(edit);
  if (S.baseResult) {
    const result = applyCandidateEdit(S.baseResult, currentEdit(), S.normals[S.lesion], S.unitsPerMm, S.verts);
    renderResult(result);
  } else {
    renderEditHistoryState();
  }
}

function undoEditSnapshot() {
  const edit = S.editHistory.undo();
  if (!edit) return;
  invalidateReviewAfterGeometryChange("已撤销上一步医生调整，审阅状态已回到待医生确认。");
  applyEditSnapshot(edit);
}

function redoEditSnapshot() {
  const edit = S.editHistory.redo();
  if (!edit) return;
  invalidateReviewAfterGeometryChange("已重做医生调整，审阅状态已回到待医生确认。");
  applyEditSnapshot(edit);
}

function resetEditToToolSuggestion() {
  if (!S.baseResult) return;
  resetEditControls();
  resetEditTimeline();
  invalidateReviewAfterGeometryChange("已恢复工具建议，审阅状态已回到待医生确认。");
  renderResult(S.baseResult);
}

function updateEditVisibility(result: DynamicRecord) {
  const fusiform = result?.candidate?.type === "fusiform";
  els.widthScaleWrap.classList.toggle("hidden", !fusiform);
  els.tipAngleWrap.classList.toggle("hidden", !fusiform);
  const active = incisionEditIsActive(currentEdit());
  els.editStatus.textContent = active ? "已调整" : "工具建议";
  els.editStatus.classList.toggle("active", active);
  renderEditHistoryState();
}

function applyEditControls() {
  syncEditLabels();
  renderEditHistoryState();
  if (!S.baseResult) return;
  if (incisionEditIsActive(currentEdit())) invalidateReviewAfterGeometryChange();
  const result = applyCandidateEdit(S.baseResult, currentEdit(), S.normals[S.lesion], S.unitsPerMm, S.verts);
  renderResult(result);
}

function workflowConsoleSignature(result: DynamicRecord = {}) {
  const trace = Array.isArray(result.trace) ? result.trace : [];
  const candidate = result.candidate || {};
  return JSON.stringify({
    candidate_id: candidate.id || null,
    candidate_type: candidate.type || null,
    candidate_version: candidate.provenance?.candidate_version || candidate.candidate_version || null,
    edited: Boolean(candidate.edited),
    trace: trace.map((step: DynamicRecord) => [step?.action || "", step?.summary || ""]),
    comparison: (result.candidate_comparison || []).map((item: DynamicRecord) => [item.id, item.rank, item.score]),
  });
}

function logWorkflowTraceToConsole(result: DynamicRecord) {
  if (!result || typeof console === "undefined") return;
  const signature = workflowConsoleSignature(result);
  if (S.lastConsoleTraceSignature === signature) return;
  S.lastConsoleTraceSignature = signature;

  const trace = Array.isArray(result.trace) ? result.trace : [];
  const gate = result.workflow_trace_gate || workflowTraceGate(result);
  const label = `[LangerFace] 浏览器切口 workflow trace · ${trace.length} 步 · gate=${gate.passed ? "passed" : "failed"}`;
  const rows = trace.map((step: DynamicRecord, index: number) => ({
    index: index + 1,
    action: step?.action || "",
    summary: step?.summary || "",
  }));
  const comparisonRows = (result.candidate_comparison || []).map((item: DynamicRecord) => ({
    rank: item.rank,
    id: item.id,
    label: item.label,
    score: item.score,
  }));

  if (typeof console.groupCollapsed === "function") console.groupCollapsed(label);
  else console.log(label);
  if (typeof console.table === "function") console.table(rows);
  else console.log("trace summary", rows);
  console.log("trace", trace);
  console.log("trace_gate", gate);
  if (result.workflow_plan_audit) console.log("workflow_plan", result.workflow_plan_audit);
  if (result.workflow_execution_events) console.log("execution_events", result.workflow_execution_events);
  if (comparisonRows.length) {
    if (typeof console.table === "function") console.table(comparisonRows);
    else console.log("candidate_comparison", comparisonRows);
  }
  console.log("workflow_result", result);
  if (typeof console.groupEnd === "function") console.groupEnd();
}

function tumorQualityFor(result: DynamicRecord = S.result) {
  if (!result?.tumor) return { warnings: [], warning_count: 0, passed: true };
  return result.tumor_quality || summarizeTumorInputQuality(result.tumor);
}

function applyTextPresentation(element: HTMLElement, presentation: IncisionTextPresentation) {
  element.textContent = presentation.text;
  if (presentation.title !== undefined) element.title = presentation.title;
  element.classList.toggle("warn", Boolean(presentation.classNames?.includes("warn")));
  element.classList.toggle("danger", Boolean(presentation.classNames?.includes("danger")));
}

function renderResult(result: DynamicRecord) {
  S.result = result;
  drawCandidate(result);
  const tumorQuality = tumorQualityFor(result);
  const presentation = buildIncisionResultPresentation({
    result,
    workflowGate: workflowTraceGate(result),
    tumorQuality,
    secondaryCuesPresent: Boolean(S.secondaryCues),
    generationCount: S.generationCount,
    headStatusLabel: S.headAsset?.statusLabel,
    privacyAudit: privacyAudit(),
  });
  els.candidateType.textContent = presentation.candidateType;
  els.candidateLength.textContent = presentation.candidateLength;
  els.candidateWidth.textContent = presentation.candidateWidth;
  els.candidateTipAngle.textContent = presentation.candidateTipAngle;
  els.candidateRstlDeviation.textContent = presentation.candidateRstlDeviation;
  applyTextPresentation(els.directionConf, presentation.directionConfidence);
  applyTextPresentation(els.regionVal, presentation.region);
  els.guardrailVal.textContent = presentation.guardrailValue.text;
  els.guardrailVal.style.color = presentation.guardrailValue.color;
  applyTextPresentation(els.guardrailDetails, presentation.guardrailDetails);
  if (els.directionSource) applyTextPresentation(els.directionSource, presentation.directionSource);
  if (els.workflowGate) applyTextPresentation(els.workflowGate, presentation.workflowGate);
  if (els.workflowComparison) applyTextPresentation(els.workflowComparison, presentation.workflowComparison);
  els.workflowSummary.textContent = presentation.workflowSummary;
  els.nextStep.textContent = presentation.nextStep;
  logWorkflowTraceToConsole(result);
  updateBoundaryStatus();
  updateEditVisibility(result);
  els.privacyState.textContent = presentation.privacyState;
  els.privacyAudit.textContent = presentation.privacyAudit;
  els.stageStatus.textContent = presentation.stageStatus;
  publishIncisionState("candidate_result");
}

function reviewGate(review: DynamicRecord, result: DynamicRecord) {
  return buildReviewGate({
    review,
    result,
    topologyId: S.headAsset?.topologyId,
    topologyVersion: S.headAsset?.topologyVersion,
  });
}

function reviewRecord(
  result: DynamicRecord = S.result,
  label = "候选",
  { forceDraft = false }: { forceDraft?: boolean } = {},
) {
  const createdAt = new Date().toISOString();
  const normalized = reviewForCandidateRecord({
    review: currentReviewMetadata(createdAt),
    result,
    forceDraft,
  });
  const review = {
    ...normalized.review,
    label: reviewStatusLabel(normalized.review.status),
  };
  const gate = reviewGate(review, result);
  return buildIncisionReviewRecord({
    result,
    label,
    createdAt,
    review,
    reviewGate: gate,
    tumorQuality: tumorQualityFor(result),
    tumorBoundarySummary: boundarySummaryFor(result.tumor, result),
    headAsset: currentHeadAssetSnapshot(),
    secondaryCues: secondaryCueReviewSummary(),
    candidateEditSession: buildCandidateEditSession(result, {
      undoAvailable: Boolean(els.undoEdit && !els.undoEdit.disabled),
      redoAvailable: Boolean(els.redoEdit && !els.redoEdit.disabled),
    }),
    sensitiveStructureInspection: findSensitiveStructureInspection(result),
    privacyAudit: privacyAudit(),
  });
}

function renderSaved() {
  if (isReactManagedWorkbench()) {
    publishIncisionState("saved_candidates");
    return;
  }
  els.savedCount.textContent = String(S.saved.length);
  els.candidateList.innerHTML = "";
  const comparisonById = new Map(compareCandidateRecords(S.saved).map((c) => [c.id, c]));
  for (const rec of S.saved) {
    const comparison = comparisonById.get(rec.id);
    const row = document.createElement("div");
    row.className = "candidate-row";
    const top = document.createElement("div");
    top.className = "top";
    const title = document.createElement("span");
    title.textContent = `${rec.label} · ${rec.candidate.type === "linear" ? "线性" : "梭形"}`;
    const status = document.createElement("span");
    status.className = rec.review_status === "rejected_by_clinician" || !rec.guardrails.passed ? "danger-text" : "";
    status.textContent = reviewStatusLabel(rec.review_status);
    top.append(title, status);
    const meta = document.createElement("div");
    meta.className = "meta";
    const reviewer = rec.review?.reviewer ? ` · 审阅人 ${rec.review.reviewer}` : "";
    const guardrails = rec.guardrails.passed ? "保护规则通过" : "保护规则需复核";
    const rank = comparison ? `工程排序 #${comparison.rank} · 分 ${fmt(comparison.score, 1)} · ${comparison.reasons.slice(0, 2).join("；")} · ` : "";
    meta.textContent = `${rank}长度 ${fmt(rec.candidate.length_mm)} mm · 区域 ${regionLabel(rec.anatomy.region)} · ${guardrails}${reviewer} · ${rec.created_at}`;
    const actions = document.createElement("div");
    actions.className = "btn-row";
    actions.style.gridTemplateColumns = "1fr 1fr";
    const load = document.createElement("button");
    load.className = "btn";
    load.textContent = "载入";
    load.onclick = () => loadSavedCandidate(rec.id);
    const remove = document.createElement("button");
    remove.className = "btn";
    remove.textContent = "删除";
    remove.onclick = () => removeSavedCandidate(rec.id);
    actions.append(load, remove);
    row.append(top, meta, actions);
    els.candidateList.append(row);
  }
  publishIncisionState("saved_candidates");
}

function loadSavedCandidate(id: string) {
  const rec = S.saved.find((item) => item.id === id);
  if (!rec) return;
  applyTumorContext(rec.tumor);
  S.baseResult = rec;
  resetEditControls();
  resetEditTimeline();
  setReviewControls(rec.review || { status: rec.review_status });
  renderResult(rec);
  els.stageStatus.textContent = "已载入候选草案及其完整肿物上下文";
  publishIncisionState("saved_candidate_loaded");
}

function removeSavedCandidate(id: string) {
  const before = S.saved.length;
  S.saved = S.saved.filter((item) => item.id !== id);
  if (S.saved.length !== before) {
    els.stageStatus.textContent = "候选已从候选库删除";
    renderSaved();
  }
}

function clearSavedCandidates() {
  S.saved = [];
  els.stageStatus.textContent = "候选库已清空";
  renderSaved();
}

function saveCurrentCandidate(
  label = "医生候选",
  { allowDraftFallback = true }: { allowDraftFallback?: boolean } = {},
) {
  if (!S.result) return false;
  const status = els.reviewDecision.value || "pending_clinician_confirmation";
  const readiness = reviewReadiness(status);
  if (!readiness.ok && !allowDraftFallback) {
    els.stageStatus.textContent = readiness.message;
    return false;
  }
  S.saved.push(reviewRecord(
    S.result,
    `${label} ${S.saved.length + 1}`,
    { forceDraft: !readiness.ok },
  ));
  els.stageStatus.textContent = readiness.ok
    ? "候选已保存到审阅列表"
    : `${readiness.message}；已按待确认草案保存。`;
  renderSaved();
  return true;
}

function saveReviewRecord() {
  const status = els.reviewDecision.value || "pending_clinician_confirmation";
  const readiness = reviewReadiness(status);
  if (!readiness.ok) {
    els.stageStatus.textContent = readiness.message;
    return;
  }
  saveCurrentCandidate("审阅候选", { allowDraftFallback: false });
}

function directionForWorkflowAlternative(baseDirection: DynamicRecord = {}, alternative: DynamicRecord = {}) {
  const offset = Number(alternative.angle_offset_deg || 0);
  const confidence = Math.max(0, Number(baseDirection.confidence || 0) - Math.abs(offset) / 180);
  const reasons = [...new Set([
    ...(Array.isArray(baseDirection.confidence_reasons) ? baseDirection.confidence_reasons : []),
    ...(Math.abs(offset) > 1e-9 ? ["browser_direction_variant_requires_clinician_review"] : []),
  ])];
  return {
    ...baseDirection,
    confidence,
    angle_offset_deg: offset,
    variant_source: Math.abs(offset) > 1e-9 ? "browser_direction_variant" : "rstl_primary",
    confidence_reasons: reasons,
  };
}

function workflowAlternativeResult(baseResult: DynamicRecord, alternative: DynamicRecord) {
  return {
    ...baseResult,
    direction: directionForWorkflowAlternative(baseResult.direction, alternative),
    candidate: alternative.candidate,
    original_candidate: alternative.candidate,
    guardrails: alternative.guardrails || baseResult.guardrails,
    preview: alternative.preview || baseResult.preview,
    anatomy: alternative.anatomy || baseResult.anatomy,
    sensitive_structure_inspection:
      alternative.sensitive_structure_inspection || baseResult.sensitive_structure_inspection,
    review_status: alternative.review_status || "pending_clinician_confirmation",
    summary: `已载入浏览器方向备选：${alternative.label || alternative.id || "候选"}；请复核保护规则、敏感结构和候选比较。`,
    next_step: "医生审阅、编辑或否决该候选。",
  };
}

function makeVariantCandidates() {
  if (!S.baseResult) return;
  const workflowAlternatives = Array.isArray(S.result?.candidate_alternatives)
    ? S.result.candidate_alternatives.filter((item: DynamicRecord) => item?.candidate)
    : [];
  if (workflowAlternatives.length) {
    for (const alternative of workflowAlternatives) {
      const result = workflowAlternativeResult(S.result, alternative);
      S.saved.push(reviewRecord(
        result,
        alternative.label || `浏览器备选 ${S.saved.length + 1}`,
        { forceDraft: true },
      ));
    }
    els.stageStatus.textContent = `已保存 ${workflowAlternatives.length} 个浏览器方向备选，并保留各自保护规则、敏感结构复核和工程排序`;
    renderSaved();
    return;
  }
  const variants = [
    { angle_offset_deg: -10, length_scale: 1, width_scale: 1, reason: "variant exploration: -10 deg" },
    { angle_offset_deg: 0, length_scale: 1, width_scale: 1, reason: "variant exploration: tool baseline" },
    { angle_offset_deg: 10, length_scale: 1, width_scale: 1, reason: "variant exploration: +10 deg" },
  ];
  for (const v of variants) {
    const result = applyCandidateEdit(S.baseResult, v, S.normals[S.lesion], S.unitsPerMm, S.verts);
    S.saved.push(reviewRecord(result, `备选 ${S.saved.length + 1}`, { forceDraft: true }));
  }
  els.stageStatus.textContent = "已生成 3 个方向备选、复跑 guardrails，并更新工程排序";
  renderSaved();
}

function exportReviewJson() {
  if (!S.result && !S.saved.length) {
    els.stageStatus.textContent = "没有可导出的候选";
    return;
  }
  const current = S.result ? reviewRecord(S.result, "当前候选") : null;
  const payload = buildReviewExportPayload({
    current,
    saved: S.saved,
    secondaryCues: secondaryCueReviewSummary(),
  });
  if (!exportPreflightPasses(payload, "审阅 JSON 导出")) return;
  downloadText(`incision_review_${Date.now()}.json`, JSON.stringify(payload, null, 2));
}

function exportTumorJson() {
  if (!S.verts) return;
  const tumor = tumorInput();
  const payload = buildTumorExportPayload({
    tumor,
    tumorQuality: summarizeTumorInputQuality(tumor),
    boundarySummary: boundarySummaryFor(tumor),
  });
  if (!exportPreflightPasses(payload, "肿物输入 JSON 导出")) return;
  downloadText(`tumor_input_${Date.now()}.json`, JSON.stringify(payload, null, 2));
  els.stageStatus.textContent = "已导出肿物输入 JSON";
}

function applyTumorContext(payload: unknown) {
  const imported = importedTumorFormState(payload, {
    diameterMin: Number(els.diameter.min),
    diameterMax: Number(els.diameter.max),
    depthMin: Number(els.depth.min),
    depthMax: Number(els.depth.max),
    depthFallback: Number(els.depth.value),
    marginMin: Number(els.margin.min),
    marginMax: Number(els.margin.max),
    authorFallback: els.tumorAuthor.value,
  });
  const tumor = imported.tumor;
  els.tumorKind.value = imported.kind;
  els.diameter.value = imported.diameterValue;
  els.diameterVal.textContent = imported.diameterValue;
  els.depth.value = imported.depthValue;
  els.depthVal.textContent = imported.depthValue;
  els.margin.value = imported.marginValue;
  els.marginVal.textContent = imported.marginValue;
  els.tumorAuthor.value = imported.author;
  S.boundaryPoints = tumor.kind === "cutaneous" ? imported.boundaryPoints : [];
  S.boundaryRefs = pointsToSurfaceRefs(S.boundaryPoints, S.verts, S.tris);
  if (tumor.kind === "cutaneous") els.boundaryMode.value = imported.boundaryMode;
  S.boundaryActive = false;
  els.startBoundary.textContent = "开始轮廓";
  setLesion(nearestVertex(tumor.center), pointToSurfaceRef(tumor.center, S.verts, S.tris));
  updateFormVisibility();
  els.pickState.textContent = imported.pickState;
  return tumor;
}

function applyImportedTumor(payload: unknown) {
  applyTumorContext(payload);
  publishIncisionState("tumor_imported");
  runWorkflow();
}

async function importTumorFile(file?: File) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    applyImportedTumor(payload);
    els.stageStatus.textContent = "已导入肿物输入并重新生成候选";
  } catch (err) {
    els.stageStatus.textContent = `导入肿物失败：${errorMessage(err)}`;
  } finally {
    els.tumorImportFile.value = "";
  }
}

async function importSecondaryCueFile(file?: File) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    S.secondaryCues = normalizeSecondaryCuePayload(payload);
    if (els.secondaryCueConfirmed) els.secondaryCueConfirmed.checked = false;
    renderSecondaryCuePanel();
    els.stageStatus.textContent = "已导入低置信辅助线索；候选几何未改变。";
    publishIncisionState("secondary_cue_imported");
  } catch (err) {
    els.stageStatus.textContent = `导入辅助线索失败：${errorMessage(err)}`;
    publishIncisionState("secondary_cue_import_failed");
  } finally {
    els.secondaryCueImportFile.value = "";
  }
}

function clearSecondaryCues() {
  S.secondaryCues = null;
  if (els.secondaryCueConfirmed) els.secondaryCueConfirmed.checked = false;
  renderSecondaryCuePanel();
  els.stageStatus.textContent = "已清空辅助线索；候选几何未改变。";
  publishIncisionState("secondary_cue_cleared");
}

function exportReport() {
  if (!S.result && !S.saved.length) {
    els.stageStatus.textContent = "没有可导出的候选";
    return;
  }
  const rows = (S.saved.length ? S.saved : [reviewRecord(S.result, "当前候选")]).filter(Boolean) as DynamicRecord[];
  const artifact = buildIncisionReviewReport(rows);
  downloadText(artifact.filename, artifact.text, artifact.mimeType);
}

function exportScreenshot() {
  if (!S.result) {
    els.stageStatus.textContent = "没有可截图的候选";
    return;
  }
  downloadCanvasPng(els.canvas, `incision_candidate_${Date.now()}.png`);
}

function stageLiveOverlay() {
  if (!S.result) {
    els.stageStatus.textContent = "没有可发送的候选";
    return;
  }
  if (els.reviewDecision.value === "rejected_by_clinician") {
    els.stageStatus.textContent = "当前候选已被否决，不发送到实时叠加。";
    return;
  }
  if (els.reviewDecision.value !== "approved_for_discussion") {
    els.stageStatus.textContent = "发送到实时叠加前，请先确认当前候选草案。";
    return;
  }
  const readiness = reviewReadiness("approved_for_discussion");
  if (!readiness.ok) {
    els.stageStatus.textContent = readiness.message;
    return;
  }
  const overlay = compileIncisionOverlay(reviewRecord(S.result, "实时叠加候选"), S.verts, S.tris);
  if (!overlay || !dataSource.stageIncisionOverlay(overlay)) {
    els.stageStatus.textContent = "切口候选叠加暂存失败";
    publishIncisionState("live_overlay_stage_failed");
    return;
  }
  els.stageStatus.textContent = "切口候选已暂存，正在进入实时叠加。";
  publishIncisionState("live_overlay_staged");
  persistWorkspaceSession();
  window.location.assign("/live?incisionOverlay=staged");
}

async function runWorkflow({ countGeneration = false }: { countGeneration?: boolean } = {}) {
  if (!S.verts) return;
  const requestId = ++S.workflowRequestId;
  if (countGeneration) {
    S.activeExplicitWorkflowCount += 1;
    els.run.disabled = true;
  }
  els.stageStatus.textContent = "Worker 确定性 workflow 生成中…";
  try {
    const tumor = tumorInput();
    const result = await planWorkflowForCurrentTumor(tumor);
    if (requestId !== S.workflowRequestId) return;
    S.baseResult = result;
    if (countGeneration) S.generationCount += 1;
    resetEditControls();
    resetEditTimeline();
    resetReviewControls();
    renderResult(result);
  } finally {
    if (countGeneration) {
      S.activeExplicitWorkflowCount = Math.max(0, S.activeExplicitWorkflowCount - 1);
      els.run.disabled = S.activeExplicitWorkflowCount > 0;
    }
  }
}

function previewWorkflow() {
  return runWorkflow({ countGeneration: false });
}

function ensureWorkflowWorker() {
  if (S.workflowWorker || S.workflowWorkerFailed) return S.workflowWorker;
  try {
    S.workflowWorker = createWorkflowWorkerClient();
  } catch (err) {
    S.workflowWorkerFailed = true;
    console.warn("[LangerFace] workflow worker unavailable; using main-thread fallback", err);
  }
  return S.workflowWorker;
}

async function planWorkflowForCurrentTumor(tumor: TumorInput) {
  const request = {
    tumor,
    verts: S.verts,
    tris: S.tris,
    atlas: S.atlas,
    normal: S.normals[S.lesion],
  };
  const worker = ensureWorkflowWorker();
  const execution = await planIncisionWithWorkflowFallback({ client: worker, request });
  if (execution.workerFailed) {
    S.workflowWorkerFailed = true;
    S.workflowWorker = null;
    console.warn("[LangerFace] workflow worker failed; using main-thread fallback", execution.error);
    if (execution.statusMessage) els.stageStatus.textContent = execution.statusMessage;
  }
  return execution.result;
}

function facePointFromEvent(e: PointerEvent) {
  if (!S.head || !S.head.mesh) return null;
  return pickFaceSurface(
    e,
    els.canvas.getBoundingClientRect(),
    S.head,
    S.raycaster,
  );
}

function handleFromEvent(e: PointerEvent) {
  if (!S.head || !S.endpointHandles.length) return null;
  return pickEndpointHandle(
    e,
    els.canvas.getBoundingClientRect(),
    S.head.camera,
    S.head.scene,
    S.endpointHandles,
    S.raycaster,
  );
}

function setEditFromGeometry(center: VectorLike, axis: VectorLike, lengthMm: number) {
  if (!S.baseResult) return;
  const base = S.baseResult.original_candidate || S.baseResult.candidate;
  const axis0 = norm(base.axis || [1, 0, 0]);
  const normal = S.normals[S.lesion];
  const perp0 = norm(cross(normal, axis0));
  const delta = sub(center, base.center || S.baseResult.tumor.center);
  const angle = clamp(
    signedAngleDegrees(axis0, axis, normal),
    Number(els.angleOffset.min),
    Number(els.angleOffset.max),
  );
  const lengthScale = clamp((lengthMm / Math.max(Number(base.length_mm || 1), 1)) * 100, Number(els.lengthScale.min), Number(els.lengthScale.max));
  const shiftAlong = clamp(dot(delta, axis0) / S.unitsPerMm, Number(els.shiftAlong.min), Number(els.shiftAlong.max));
  const shiftPerp = clamp(dot(delta, perp0) / S.unitsPerMm, Number(els.shiftPerp.min), Number(els.shiftPerp.max));
  els.angleOffset.value = String(Math.round(angle));
  els.lengthScale.value = String(Math.round(lengthScale));
  els.shiftAlong.value = String(Math.round(shiftAlong));
  els.shiftPerp.value = String(Math.round(shiftPerp));
  applyEditControls();
}

function dragEndpointToPoint(point: VectorLike, idx: number) {
  if (!S.result?.candidate?.endpoints) return;
  const candidate = S.result.candidate;
  const current = candidate.endpoints;
  const center = candidate.center || S.result.tumor.center;
  const handleVector = sub(point, center);
  const axis = len(handleVector) > 1e-6
    ? norm(idx === 0 ? mul(handleVector, -1) : handleVector)
    : norm(candidate.axis || sub(current[1], current[0]));
  const lengthMm = Math.max(1, len(handleVector) * 2 / S.unitsPerMm);
  setEditFromGeometry(center, axis, lengthMm);
}

function dragEndpointTo(e: PointerEvent, idx: number) {
  const hit = facePointFromEvent(e);
  if (hit) dragEndpointToPoint(hit.point, idx);
}

function pick(e: PointerEvent) {
  if (!S.head) return;
  const hit = facePointFromEvent(e);
  if (!hit) return;
  if (S.boundaryActive && els.tumorKind.value === "cutaneous" && els.boundaryMode.value === "freehand") {
    S.boundaryPoints.push(hit.point);
    const boundaryRef = pointToSurfaceRef(hit.point, S.verts, S.tris);
    if (boundaryRef) S.boundaryRefs.push(boundaryRef);
    updateTumorRing();
    els.pickState.textContent = `自由轮廓点：${S.boundaryPoints.length} 个`;
    publishIncisionState("tumor_boundary_point");
    return;
  }
  const lp = hit.point;
  let best = hit.face.a, bd = Infinity;
  for (const vi of [hit.face.a, hit.face.b, hit.face.c]) {
    const d = len(sub(S.verts[vi], lp));
    if (d < bd) { bd = d; best = vi; }
  }
  const clearedFreehandBoundary = shouldClearFreehandBoundaryOnLesionRepick({
    kind: els.tumorKind.value,
    boundaryMode: els.boundaryMode.value,
    boundaryPointCount: S.boundaryPoints.length,
  });
  if (clearedFreehandBoundary) {
    S.boundaryPoints = [];
    S.boundaryRefs = [];
    S.boundaryActive = false;
    els.startBoundary.textContent = "开始轮廓";
  }
  setLesion(best, pointToSurfaceRef(hit.point, S.verts, S.tris));
  if (clearedFreehandBoundary) {
    els.pickState.textContent = `当前点位：顶点 #${best}；原自由轮廓已清空，请按新病灶重新绘制。`;
  }
  previewWorkflow();
}

function bindWorkbenchEvents() {
  const reactManaged = isReactManagedWorkbench();
  if (reactManaged) bindReactWorkbenchCommands();
  S.domEventCleanup = bindIncisionDomEvents({
    elements: els,
    reactManaged,
    handlers: {
      endpointHandleFromEvent: handleFromEvent,
      dragEndpoint: dragEndpointTo,
      rotateHead: (dx, dy) => {
        S.head?.setRotation(
          clamp((S.head?.rotX || 0) + dy * 0.01, -1.2, 1.2),
          (S.head?.rotY || 0) + dx * 0.01,
        );
      },
      pickFace: pick,
      commitEndpointDrag: () => commitEditSnapshot("endpoint_drag"),
      zoomHead: (direction) => S.head?.zoom(direction > 0 ? 1.1 : 0.9),
      publishState: publishIncisionState,
      onTumorKindChange: () => { updateFormVisibility(); previewWorkflow(); },
      onDiameterInput: () => {
        els.diameterVal.textContent = els.diameter.value;
        updateTumorRing();
      },
      onDiameterChange: previewWorkflow,
      onDepthInput: () => { els.depthVal.textContent = els.depth.value; },
      onDepthChange: previewWorkflow,
      onMarginInput: () => {
        els.marginVal.textContent = els.margin.value;
        updateTumorRing();
      },
      onMarginChange: previewWorkflow,
      onEllipseRatioInput: () => {
        els.ellipseRatioVal.textContent = `${els.ellipseRatio.value}%`;
        updateTumorRing();
      },
      onEllipseRatioChange: previewWorkflow,
      onBoundaryModeChange: () => {
        S.boundaryActive = false;
        updateFormVisibility();
        previewWorkflow();
      },
      onRunWorkflow: () => runWorkflow({ countGeneration: true }),
      onToggleBoundary: toggleBoundaryDrawing,
      onClearBoundary: clearBoundaryPoints,
      onExportTumor: exportTumorJson,
      onImportTumorRequest: () => els.tumorImportFile.click(),
      onImportSecondaryCueRequest: () => els.secondaryCueImportFile.click(),
      onClearSecondaryCue: clearSecondaryCues,
      onSecondaryCueConfirmed: setSecondaryCueConfirmedFromControl,
      onEditInput: applyEditControls,
      onEditCommit: () => commitEditSnapshot("control_change"),
      onEditReasonChange: () => {
        applyEditControls();
        commitEditSnapshot("reason_change");
      },
      onUndoEdit: undoEditSnapshot,
      onRedoEdit: redoEditSnapshot,
      onResetEdit: resetEditToToolSuggestion,
      onReviewDecisionChange: updateReviewStateUI,
      onSaveReview: saveReviewRecord,
      onSaveCandidate: () => saveCurrentCandidate(),
      onMakeVariants: makeVariantCandidates,
      onClearSaved: clearSavedCandidates,
      onExportReview: exportReviewJson,
      onExportReport: exportReport,
      onExportScreenshot: exportScreenshot,
      onStageLiveOverlay: stageLiveOverlay,
      onTumorFile: importTumorFile,
      onSecondaryCueFile: importSecondaryCueFile,
      onPhotoFile: (file) => { void photoRuntime?.load(file); },
      onControlledMarkerDetect: () => photoRuntime?.beginControlledMarkerDetection(),
      onControlledMarkerConfirm: () => { void photoRuntime?.confirmControlledMarkerDetection(); },
      preparePhotoInteraction: () => photoRuntime?.fit(),
      photoEndpointHandleFromEvent: (event) => photoRuntime?.endpointHandleFromEvent(event) ?? null,
      dragPhotoEndpoint: (event, handle) => photoRuntime?.dragEndpoint(event, handle),
      commitPhotoEndpointDrag: () => photoRuntime?.commitEndpointDrag(),
      onPhotoPick: (event) => photoRuntime?.pick(event),
      onPhotoPan: (deltaX, deltaY) => photoRuntime?.pan(deltaX, deltaY),
      onPhotoZoom: (event) => photoRuntime?.zoom(event),
      onPhotoMirror: () => photoRuntime?.toggleMirror(),
      onPhotoReset: () => photoRuntime?.resetView(),
      onSurfaceMode: () => photoRuntime?.setMode(!S.photoView.active),
      onResize: fitSize,
    },
  });
}

function renderLoop() {
  if (!S.mounted || !S.head) return;
  S.head.render();
  S.frameId = requestAnimationFrame(renderLoop);
}

const incisionCommands = new IncisionCommandRouter({
  applyTumorControl: (command, value) => applyReactTumorControlValue(els, command, value),
  setBoundaryInactive: () => { S.boundaryActive = false; },
  updateFormVisibility,
  publish: publishIncisionState,
  previewWorkflow,
  updateTumorRing,
  toggleBoundaryDrawing,
  clearBoundaryPoints,
  exportTumor: exportTumorJson,
  importTumor: () => els.tumorImportFile.click(),
  runWorkflow: () => runWorkflow({ countGeneration: true }),
  importSecondaryCue: () => els.secondaryCueImportFile.click(),
  clearSecondaryCue: clearSecondaryCues,
  confirmSecondaryCue: setSecondaryCueConfirmedFromControl,
  applyEditControl: (controlId, value) => applyReactEditControlValue(els, controlId, value),
  applyEditControls,
  commitEdit: commitEditSnapshot,
  undoEdit: undoEditSnapshot,
  redoEdit: redoEditSnapshot,
  resetEdit: resetEditToToolSuggestion,
  updateReviewState: updateReviewStateUI,
  saveReview: saveReviewRecord,
  saveCurrentCandidate,
  makeVariants: makeVariantCandidates,
  clearSaved: clearSavedCandidates,
  loadCandidate: loadSavedCandidate,
  removeCandidate: removeSavedCandidate,
  exportJson: exportReviewJson,
  exportReport,
  exportPng: exportScreenshot,
  stageLiveOverlay,
});

function bindReactWorkbenchCommands() {
  S.reactCommandCleanup = bindWindowControllerEvents([
    [INCISION_TUMOR_REACT_COMMAND_EVENT, (event) => { incisionCommands.handleTumorEvent(event); }],
    [INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT, (event) => { incisionCommands.handleSecondaryCueEvent(event); }],
    [INCISION_EDIT_REACT_COMMAND_EVENT, (event) => { incisionCommands.handleEditEvent(event); }],
    [INCISION_REVIEW_REACT_COMMAND_EVENT, (event) => { incisionCommands.handleReviewEvent(event); }],
    [INCISION_LIBRARY_REACT_COMMAND_EVENT, (event) => { incisionCommands.handleLibraryEvent(event); }],
  ]);
}

export function disposeIncisionWorkbench() {
  activeSession.dispose();
  persistWorkspaceSession();
  S.mounted = false;
  photoRuntime?.dispose();
  photoRuntime = null;
  if (S.frameId) cancelAnimationFrame(S.frameId);
  S.domEventCleanup?.();
  S.domEventCleanup = null;
  S.workflowWorker?.dispose?.();
  S.workflowWorker = null;
  S.reactCommandCleanup?.();
  S.reactCommandCleanup = null;
  S.head?.dispose?.();
  S.planning2d?.dispose();
  S.planning2d = null;
}

export function mountIncisionWorkbench(root: ParentNode | Document = document) {
  disposeIncisionWorkbench();
  els = collectIncisionElements(root);
  S = createIncisionControllerState();
  S.planning2d = createPhotoPlanningController({ owner: "incision" });
  photoRuntime = createIncisionPhotoRuntime({
    elements: els,
    state: S,
    clearTransientPlanning: clearTransientPlanningForPhoto,
    defaultLesion,
    nearestVertex,
    setLesion,
    updateTumorRing,
    runWorkflow: previewWorkflow,
    publishState: publishIncisionState,
    dragEndpoint: dragEndpointToPoint,
    commitEndpointDrag: () => commitEditSnapshot("photo_endpoint_drag"),
  });
  S.mounted = true;
  const session = activeSession.mount();
  bindWorkbenchEvents();
  photoRuntime.setMode(false);
  boot(session).catch((error) => {
    if (!isActiveSession(session)) return;
    const message = errorMessage(error);
    els.stageStatus.textContent = "加载失败：" + message;
    if (els.assetLoadingText) {
      els.assetLoadingText.textContent = `资产加载失败：${message}`;
    }
    publishIncisionState("asset_load_failed");
    console.error(error);
  });
  return () => {
    if (isActiveSession(session)) disposeIncisionWorkbench();
  };
}
