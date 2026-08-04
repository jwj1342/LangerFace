import * as THREE from "three";

import { compileIncisionOverlay } from "./incisionOverlay.ts";
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
  INCISION_EDIT_COMMANDS,
  INCISION_LIBRARY_COMMANDS,
  INCISION_REVIEW_COMMANDS,
  INCISION_SECONDARY_CUE_COMMANDS,
  INCISION_TUMOR_COMMANDS,
  bindWindowControllerEvents,
  dispatchControllerEvent,
  readControllerCommandDetail,
  type IncisionTumorCommand,
} from "../lib/controllerCommand";
import { isReactManagedWorkbench } from "../lib/reactManagedWorkbench";
import { assetBaseUrl } from "./assetLoader";
import {
  directionHintLabel,
  directionSourceLabel,
  guardrailLabel,
  overrideLabel,
  reasonLabel,
  regionLabel,
  reviewStatusLabel,
  severityLabel,
  subunitLabel,
} from "./incisionClinicalCopy";
import { collectIncisionElements, type IncisionDomElements } from "./incisionDom";
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
} from "./tumorInput";
import { dataSource } from "./dataSource";
import type { AtlasPayload, HeadMeshPayload } from "./dataSource";
import { auditExportPayload } from "./exportPrivacy";
import { loadFlameBasisAsset, mediaPipeAtlasToFlamePreviewAtlas } from "./flameHeadAssets";
import {
  assessReviewReadiness,
  buildReviewGate,
  summarizeGuardrails,
} from "./incisionReviewPolicy";
import { planIncisionWithWorkflowFallback } from "./workflowPlanner";
import { createWorkflowWorkerClient } from "./workflowWorkerClient";
import type { WorkflowWorkerClient } from "./workflowWorkerClient";
import { Head3D, buildLineGeometry, vertexNormals } from "./three3d.ts";
import type { Triangle, Vec3 } from "./softBody";

type DynamicRecord = Record<string, any>;
type VectorLike = ArrayLike<number>;
type ControllerCleanup = () => void;
type IncisionMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
type IncisionLine = THREE.Line<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

interface IncisionRuntimeState {
  mounted: boolean;
  frameId: number;
  resizeObserver: ResizeObserver | null;
  verts: Vec3[];
  tris: Triangle[];
  atlas: DynamicRecord | null;
  headAsset: IncisionHeadAssetState | null;
  assetWarnings: string[];
  normals: Vec3[];
  meanEdge: number;
  unitsPerMm: number;
  head: Head3D | null;
  marker: IncisionMesh | null;
  tumorRing: IncisionLine | null;
  boundaryLine: IncisionLine | null;
  candidateLine: IncisionLine | null;
  endpointHandles: IncisionMesh[];
  raycaster: THREE.Raycaster;
  lesion: number;
  boundaryPoints: Vec3[];
  boundaryActive: boolean;
  saved: DynamicRecord[];
  result: any;
  baseResult: any;
  secondaryCues: any;
  workflowWorker: WorkflowWorkerClient | null;
  workflowWorkerFailed: boolean;
  reactCommandCleanup: ControllerCleanup | null;
  editTimeline: DynamicRecord[];
  editCursor: number;
  lastConsoleTraceSignature: string;
  generationCount: number;
}

interface RuntimeEdit extends DynamicRecord {
  angle_offset_deg: number;
  length_scale: number;
  width_scale: number;
  tip_angle_deg: number | null;
  shift_along_mm: number;
  shift_perp_mm: number;
  reason: string;
  session_history?: DynamicRecord[];
}

interface PointerDragState {
  x: number;
  y: number;
  moved: number;
  id: number;
  handle?: number | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function controllerEvent(event: Event): Event & { detail?: unknown } {
  return event as Event & { detail?: unknown };
}

function fileFromEvent(event: Event): File | undefined {
  return (event.target as HTMLInputElement | null)?.files?.[0] ?? undefined;
}

let els = {} as IncisionDomElements;

const sub = (a: VectorLike, b: VectorLike): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: VectorLike, b: VectorLike): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: VectorLike, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: VectorLike, b: VectorLike): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (v: VectorLike): number => Math.hypot(v[0], v[1], v[2]);
const norm = (v: VectorLike): Vec3 => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: VectorLike, b: VectorLike): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

function createRuntimeState(): IncisionRuntimeState {
  return {
    mounted: false,
    frameId: 0,
    resizeObserver: null,
    verts: [],
    tris: [],
    atlas: null,
    headAsset: null,
    assetWarnings: [],
    normals: [],
    meanEdge: 1,
    unitsPerMm: 1,
    head: null,
    marker: null,
    tumorRing: null,
    boundaryLine: null,
    candidateLine: null,
    endpointHandles: [],
    raycaster: new THREE.Raycaster(),
    lesion: 0,
    boundaryPoints: [],
    boundaryActive: false,
    saved: [],
    result: null,
    baseResult: null,
    secondaryCues: null,
    workflowWorker: null,
    workflowWorkerFailed: false,
    reactCommandCleanup: null,
    editTimeline: [],
    editCursor: 0,
    lastConsoleTraceSignature: "",
    generationCount: 0,
  };
}

let S = createRuntimeState();

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
    text: els.assetLoadingText?.textContent || "准备下载标准三维面部模型、张力线图谱和切口规划资产。",
  });
}

function currentHeadAssetSnapshot(): IncisionHeadAssetState {
  return S.headAsset || {
    id: "pending",
    label: "头模资产加载中",
    topologyId: "unknown",
    topologyVersion: "unknown",
    vertexCount: 0,
    triangleCount: 0,
    atlasTopologyId: null,
    atlasLineCount: 0,
    mode: "unknown",
    statusLabel: "资产加载中",
    warnings: [],
    liveOverlaySupported: false,
  };
}

function currentReviewSnapshot() {
  return buildIncisionReviewSnapshot({
    status: els.reviewDecision?.value || "pending_clinician_confirmation",
    reviewer: els.reviewerName?.value?.trim?.() || "",
    notesPresent: Boolean(els.reviewNotes?.value?.trim?.()),
  });
}

function currentEditSnapshot() {
  const edit = currentEditBase();
  return buildIncisionEditSnapshot({
    edit,
    tipAngleDeg: Number(els.tipAngle?.value || baseTipAngleDeg()),
    statusLabel: els.editStatus?.textContent || "工具建议",
    statusActive: Boolean(els.editStatus?.classList?.contains("active")),
    editActive: editIsActive(edit),
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

function meanEdge(verts: Vec3[], tris: Triangle[]): number {
  let e = 0, n = 0;
  for (const [a, b, c] of tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      e += len(sub(verts[p], verts[q]));
      n++;
    }
  }
  return n ? e / n : 1;
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
  mode,
  statusLabel,
  warnings,
  liveOverlaySupported,
}: {
  head: HeadMeshPayload;
  atlas: DynamicRecord;
  mode: IncisionHeadAssetState["mode"];
  statusLabel: string;
  warnings: string[];
  liveOverlaySupported: boolean;
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
    mode,
    statusLabel,
    warnings,
    liveOverlaySupported,
  };
}

async function loadMediaPipeIncisionAssets(atlas?: AtlasPayload, warnings: string[] = []) {
  const [head, resolvedAtlas] = await Promise.all([
    dataSource.getHeadMesh("mediapipe-468", { onProgress: updateAssetLoading }),
    atlas ? Promise.resolve(atlas) : dataSource.loadAtlas("rstl", { onProgress: updateAssetLoading }),
  ]);
  return {
    head,
    atlas: resolvedAtlas as DynamicRecord,
    headAsset: headAssetSnapshot({
      head,
      atlas: resolvedAtlas as DynamicRecord,
      mode: "mediapipe_fallback",
      statusLabel: warnings.length
        ? "标准三维模型回退 · 高精度头模资产未就绪"
        : "标准三维面部模型",
      warnings,
      liveOverlaySupported: true,
    }),
  };
}

async function loadPreferredIncisionAssets() {
  const rstlAtlas = await dataSource.loadAtlas("rstl", { onProgress: updateAssetLoading });
  const warnings: string[] = [];
  try {
    const [mediaPipeHead, flameHead, basis] = await Promise.all([
      dataSource.getHeadMesh("mediapipe-468", { onProgress: updateAssetLoading }),
      dataSource.getHeadMesh("flame-2023", { onProgress: updateAssetLoading }),
      loadFlameBasisAsset({ label: "高精度头模基底", onProgress: updateAssetLoading }),
    ]);
    const flameAtlas = mediaPipeAtlasToFlamePreviewAtlas({
      atlas: rstlAtlas,
      mediaPipeHead,
      flameHead,
      basis,
    });
    warnings.push("当前高精度头模上的 RSTL 线为研究预览；发送到实时叠加前必须完成单独映射复核。");
    return {
      head: flameHead,
      atlas: flameAtlas as DynamicRecord,
      headAsset: headAssetSnapshot({
        head: flameHead,
        atlas: flameAtlas as DynamicRecord,
        mode: "flame_preview",
        statusLabel: "高精度三维头模 · RSTL 预览",
        warnings,
        liveOverlaySupported: false,
      }),
    };
  } catch (error) {
    warnings.push(`高精度头模资产加载或转换失败：${errorMessage(error)}`);
    return loadMediaPipeIncisionAssets(rstlAtlas, warnings);
  }
}

async function boot() {
  const { head, atlas, headAsset } = await loadPreferredIncisionAssets();
  if (!S.mounted) return;
  S.verts = head.vertices; S.tris = head.triangles; S.atlas = atlas; S.headAsset = headAsset; S.assetWarnings = headAsset.warnings;
  S.normals = vertexNormals(S.verts, S.tris);
  S.meanEdge = meanEdge(S.verts, S.tris);
  S.unitsPerMm = unitsPerMmFromVertices(S.verts);

  S.head = new Head3D(els.canvas);
  S.head.setGeometry(
    S.verts,
    S.tris,
    (atlas.lines || []).filter((_: unknown, i: number) => i % 2 === 0),
    { showSurface: true, bands: false },
  );
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
    new THREE.LineBasicMaterial({ color: 0x34d399, toneMapped: false, linewidth: 2 }),
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
  setLesion(defaultLesion());
  fitSize();
  renderLoop();
  runWorkflow();
  hideAssetLoading();
}

function fitSize() {
  if (!S.head || !els.wrap) return;
  const w = els.wrap.clientWidth || 900, h = els.wrap.clientHeight || 680;
  S.head.resize(w, h);
}

function privacyAudit() {
  return {
    raw_image_sent: false,
    raw_video_sent: false,
    local_workflow_fields: [
      "tumor.kind",
      "tumor.center",
      "tumor.diameter_mm",
      "tumor.depth_mm",
      "tumor.margin_mm",
      "tumor.boundary",
      "abstract face coordinates",
      "candidate geometry",
      "tool trace",
    ],
    browser_workflow_only: true,
    secondary_cues_present: Boolean(S.secondaryCues),
  };
}

function metricSummary(raw: DynamicRecord = {}) {
  const numberOrNull = (key: string) => {
    if (raw[key] == null) return null;
    const value = Number(raw[key]);
    return Number.isFinite(value) ? value : null;
  };
  return {
    precision: numberOrNull("precision"),
    recall: numberOrNull("recall"),
    iou: numberOrNull("iou"),
  };
}

function normalizeSecondaryCuePayload(payload: DynamicRecord = {}) {
  const metrics = payload.metrics || payload;
  return {
    schema_version: "secondary-cue-summary/v0.1",
    source: payload.source || metrics.source || "synthetic",
    source_tool: payload.source_tool || metrics.source_tool || "tools/prototype_wrinkle_lesion_cues.py",
    imported_at: new Date().toISOString(),
    confidence_label: metrics.confidence_label || "low_confidence_cv_cue_requires_manual_confirmation",
    manual_confirmation_required: true,
    used_for_geometry: false,
    clinical_boundary: "辅助线索 / 低置信度 / 需医生确认；不自动改变肿物边界或候选切口。",
    lesion: metricSummary(metrics.lesion || {}),
    wrinkle: metricSummary(metrics.wrinkle || {}),
    outputs: metrics.outputs || {},
    counts: {
      lesion_polylines: Array.isArray(payload.lesion_polylines) ? payload.lesion_polylines.length : null,
      wrinkle_polylines: Array.isArray(payload.wrinkle_polylines) ? payload.wrinkle_polylines.length : null,
    },
  };
}

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

function downloadText(filename: string, text: string, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
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
    center: S.verts[S.lesion],
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
    els.boundaryStatus.textContent = "皮表边界：仅皮表肿物启用";
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

function tangentFrame(normal: VectorLike, axis: VectorLike = [1, 0, 0]) {
  const u0 = norm(cross(normal, axis));
  const u = len(u0) > 0 ? u0 : [1, 0, 0];
  const v = norm(cross(normal, u));
  return { u, v };
}

function ringGeometry(center: VectorLike, normal: VectorLike, radius: number) {
  const { u, v } = tangentFrame(normal, [0, 1, 0]);
  const lift = S.meanEdge * 0.18;
  const pos = [];
  for (let i = 0; i <= 72; i++) {
    const t = i / 72 * Math.PI * 2;
    const p = add(add(center, mul(u, Math.cos(t) * radius)), add(mul(v, Math.sin(t) * radius), mul(normal, lift)));
    pos.push(...p);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function ellipseBoundaryPoints(samples = 32): Vec3[] {
  const center = S.verts[S.lesion], normal = S.normals[S.lesion];
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

function boundaryGeometry(points: VectorLike[], normal: VectorLike, closed = true) {
  const lift = S.meanEdge * 0.22;
  const pos = [];
  const pts = closed && points.length ? points.concat([points[0]]) : points;
  for (const p0 of pts || []) {
    const p = add(p0, mul(normal, lift));
    pos.push(...p);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function polylineGeometry(points: VectorLike[], normal: VectorLike) {
  const lift = S.meanEdge * 0.32;
  const pos = [];
  for (const p0 of points || []) {
    const p = add(p0, mul(normal, lift));
    pos.push(...p);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function setLesion(i: number) {
  S.lesion = i;
  const center = S.verts[i], normal = S.normals[i];
  const markerPoint = add(center, mul(normal, S.meanEdge * 0.34));
  S.marker?.position.set(markerPoint[0], markerPoint[1], markerPoint[2]);
  updateTumorRing();
  els.pickState.textContent = `当前点位：顶点 #${i}`;
  updateAnatomyPreview();
}

function updateTumorRing() {
  if (!S.tumorRing || !S.verts) return;
  const tumor = tumorInput();
  const diameterMm = Number(tumor.diameter_mm || 0);
  const marginMm = Number(tumor.margin_mm || 0);
  const radiusMm = tumor.kind === "cutaneous" ? diameterMm / 2 + marginMm : diameterMm / 2;
  const old = S.tumorRing.geometry;
  S.tumorRing.geometry = ringGeometry(S.verts[S.lesion], S.normals[S.lesion], radiusMm * S.unitsPerMm);
  old.dispose();
  if (!S.boundaryLine) return;
  const bold = S.boundaryLine.geometry;
  const boundary = tumorBoundaryPoints();
  S.boundaryLine.geometry = boundaryGeometry(boundary, S.normals[S.lesion], boundary.length >= 3);
  S.boundaryLine.visible = tumor.kind === "cutaneous" && boundary.length >= 2;
  bold.dispose();
  updateBoundaryStatus();
}

function drawCandidate(result: DynamicRecord) {
  if (!S.candidateLine) return;
  const old = S.candidateLine.geometry;
  S.candidateLine.geometry = polylineGeometry(result.candidate.polyline, S.normals[S.lesion]);
  old.dispose();
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
  if (!S.boundaryActive && S.boundaryPoints.length >= 3) runWorkflow();
  publishIncisionState("tumor_boundary_toggle");
}

function clearBoundaryPoints() {
  S.boundaryPoints = [];
  updateTumorRing();
  els.pickState.textContent = "自由轮廓已清空。";
  runWorkflow();
  publishIncisionState("tumor_boundary_clear");
}

function tumorCommandControl(command: IncisionTumorCommand): HTMLInputElement | HTMLSelectElement | null {
  if (command === "kind_changed") return els.tumorKind;
  if (command === "diameter_input" || command === "diameter_changed") return els.diameter;
  if (command === "author_changed") return els.tumorAuthor;
  if (command === "depth_input" || command === "depth_changed") return els.depth;
  if (command === "margin_input" || command === "margin_changed") return els.margin;
  if (command === "boundary_mode_changed") return els.boundaryMode;
  if (command === "ellipse_ratio_input" || command === "ellipse_ratio_changed") return els.ellipseRatio;
  return null;
}

function applyReactControlValue(
  control: HTMLInputElement | HTMLSelectElement | null,
  value: unknown,
) {
  if (!control || (typeof value !== "string" && typeof value !== "number")) return;
  const serializedValue = String(value);
  if (control instanceof HTMLSelectElement) {
    if ([...control.options].some((option) => option.value === serializedValue)) control.value = serializedValue;
    return;
  }
  if (control.type === "range") {
    const numericValue = Number(serializedValue);
    if (!Number.isFinite(numericValue)) return;
    const min = Number(control.min);
    const max = Number(control.max);
    control.value = String(clamp(
      numericValue,
      Number.isFinite(min) ? min : numericValue,
      Number.isFinite(max) ? max : numericValue,
    ));
    return;
  }
  control.value = serializedValue;
}

function applyReactTumorCommandValue(command: IncisionTumorCommand, value: unknown) {
  applyReactControlValue(tumorCommandControl(command), value);
}

function handleReactTumorCommand(event: Event) {
  const detail = readControllerCommandDetail(controllerEvent(event), INCISION_TUMOR_COMMANDS);
  if (!detail) return;
  const { command } = detail;
  applyReactTumorCommandValue(command, detail.value);
  if (command === "kind_changed") {
    S.boundaryActive = false;
    updateFormVisibility();
    publishIncisionState("tumor_kind_changed");
    runWorkflow();
    return;
  }
  if (command === "diameter_input") {
    updateTumorRing();
    publishIncisionState("tumor_diameter_input");
    return;
  }
  if (command === "depth_input" || command === "author_changed") {
    publishIncisionState(command);
    return;
  }
  if (command === "margin_input" || command === "ellipse_ratio_input") {
    updateTumorRing();
    publishIncisionState(command);
    return;
  }
  if (command === "diameter_changed" || command === "depth_changed" || command === "margin_changed" || command === "ellipse_ratio_changed") {
    runWorkflow();
    return;
  }
  if (command === "boundary_mode_changed") {
    S.boundaryActive = false;
    updateFormVisibility();
    publishIncisionState("tumor_boundary_mode_changed");
    runWorkflow();
    return;
  }
  if (command === "toggle_boundary") {
    toggleBoundaryDrawing();
    return;
  }
  if (command === "clear_boundary") {
    clearBoundaryPoints();
    return;
  }
  if (command === "export_tumor") {
    exportTumorJson();
    return;
  }
  if (command === "import_tumor") {
    els.tumorImportFile.click();
    return;
  }
  if (command === "run_workflow") {
    runWorkflow();
  }
}

function handleReactSecondaryCueCommand(event: Event) {
  const detail = readControllerCommandDetail(controllerEvent(event), INCISION_SECONDARY_CUE_COMMANDS);
  if (!detail) return;
  const { command } = detail;
  if (command === "import_secondary_cue") {
    els.secondaryCueImportFile.click();
    return;
  }
  if (command === "clear_secondary_cue") {
    clearSecondaryCues();
    return;
  }
  if (command === "secondary_cue_confirmed") {
    setSecondaryCueConfirmedFromControl();
  }
}

function fmt(x: unknown, digits = 1): string {
  return Number.isFinite(Number(x)) ? Number(x).toFixed(digits) : "—";
}

function neutralEdit(): RuntimeEdit {
  return {
    angle_offset_deg: 0,
    length_scale: 1,
    width_scale: 1,
    tip_angle_deg: null,
    shift_along_mm: 0,
    shift_perp_mm: 0,
    reason: "",
  };
}

function baseTipAngleDeg(): number {
  const base = S.baseResult?.original_candidate || S.baseResult?.candidate;
  const value = Number(base?.metrics?.tip_angle_target_deg ?? base?.tip_angle_deg ?? 30);
  return Number.isFinite(value) ? value : 30;
}

function currentEditBase(): RuntimeEdit {
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

function editIsActive(edit: DynamicRecord = currentEdit()): boolean {
  return edit.angle_offset_deg !== 0 ||
    edit.length_scale !== 1 ||
    edit.width_scale !== 1 ||
    edit.tip_angle_deg != null ||
    edit.shift_along_mm !== 0 ||
    edit.shift_perp_mm !== 0 ||
    Boolean(edit.reason);
}

function editsEqual(a: DynamicRecord = neutralEdit(), b: DynamicRecord = neutralEdit()): boolean {
  return Number(a.angle_offset_deg || 0) === Number(b.angle_offset_deg || 0) &&
    Number(a.length_scale || 1) === Number(b.length_scale || 1) &&
    Number(a.width_scale || 1) === Number(b.width_scale || 1) &&
    (a.tip_angle_deg == null ? null : Number(a.tip_angle_deg)) ===
      (b.tip_angle_deg == null ? null : Number(b.tip_angle_deg)) &&
    Number(a.shift_along_mm || 0) === Number(b.shift_along_mm || 0) &&
    Number(a.shift_perp_mm || 0) === Number(b.shift_perp_mm || 0) &&
    String(a.reason || "") === String(b.reason || "");
}

function cloneEdit(edit: DynamicRecord = neutralEdit()): RuntimeEdit {
  return {
    angle_offset_deg: Number(edit.angle_offset_deg || 0),
    length_scale: Number(edit.length_scale || 1),
    width_scale: Number(edit.width_scale || 1),
    tip_angle_deg: edit.tip_angle_deg == null ? null : Number(edit.tip_angle_deg),
    shift_along_mm: Number(edit.shift_along_mm || 0),
    shift_perp_mm: Number(edit.shift_perp_mm || 0),
    reason: String(edit.reason || ""),
  };
}

function ensureEditTimeline(): void {
  if (!Array.isArray(S.editTimeline) || !S.editTimeline.length) {
    S.editTimeline = [neutralEdit()];
    S.editCursor = 0;
  }
}

function editHistoryEntriesForCurrent(edit: DynamicRecord = currentEditBase()): DynamicRecord[] {
  ensureEditTimeline();
  const rawCommitted = S.editTimeline.slice(1, Math.max(1, S.editCursor + 1));
  const committedSource = rawCommitted.some((entry) => editIsActive(entry))
    ? rawCommitted
    : rawCommitted.filter((entry) => editIsActive(entry));
  const committed = committedSource.map((entry: DynamicRecord, idx: number) => ({
      ...cloneEdit(entry),
      source: "web/incision_workflow",
      interaction: entry.interaction || "committed_control_edit",
      history_index: idx + 1,
    }));
  const cursorEdit = S.editTimeline[S.editCursor] || neutralEdit();
  if (!editsEqual(edit, cursorEdit) && editIsActive(edit)) {
    committed.push({
      ...cloneEdit(edit),
      source: "web/incision_workflow",
      interaction: "live_preview_uncommitted_edit",
      history_index: committed.length + 1,
    });
  }
  return committed;
}

function currentEdit(): RuntimeEdit {
  const edit = currentEditBase();
  return {
    ...edit,
    session_history: editHistoryEntriesForCurrent(edit),
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

function setEditControls(edit: DynamicRecord = neutralEdit()) {
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
  setEditControls(neutralEdit());
}

function resetEditTimeline() {
  S.editTimeline = [neutralEdit()];
  S.editCursor = 0;
  renderEditHistoryState();
}

function renderEditHistoryState() {
  if (!els.editHistoryState) return;
  ensureEditTimeline();
  const edit = currentEditBase();
  const committedCount = Math.max(0, S.editCursor);
  const uncommitted = !editsEqual(edit, S.editTimeline[S.editCursor] || neutralEdit());
  const historyCount = editHistoryEntriesForCurrent(edit).length;
  const version = 1 + historyCount;
  const pending = uncommitted ? " · 当前预览未提交" : "";
  els.editHistoryState.textContent = historyCount
    ? `编辑版本：v${version} · 已提交 ${committedCount} 步${pending}`
    : `编辑版本：v1 · 无已提交调整${pending}`;
  if (els.undoEdit) els.undoEdit.disabled = S.editCursor <= 0;
  if (els.redoEdit) els.redoEdit.disabled = S.editCursor >= S.editTimeline.length - 1;
  publishIncisionState("edit_state");
}

function commitEditSnapshot(interaction = "control_change") {
  ensureEditTimeline();
  const edit = {
    ...cloneEdit(currentEditBase()),
    interaction,
    committed_at: new Date().toISOString(),
  };
  const current = S.editTimeline[S.editCursor] || neutralEdit();
  if (editsEqual(edit, current)) {
    renderEditHistoryState();
    return;
  }
  S.editTimeline = S.editTimeline.slice(0, S.editCursor + 1);
  S.editTimeline.push(edit);
  S.editCursor = S.editTimeline.length - 1;
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
  ensureEditTimeline();
  if (S.editCursor <= 0) return;
  S.editCursor -= 1;
  invalidateReviewAfterGeometryChange("已撤销上一步医生调整，审阅状态已回到待医生确认。");
  applyEditSnapshot(S.editTimeline[S.editCursor]);
}

function redoEditSnapshot() {
  ensureEditTimeline();
  if (S.editCursor >= S.editTimeline.length - 1) return;
  S.editCursor += 1;
  invalidateReviewAfterGeometryChange("已重做医生调整，审阅状态已回到待医生确认。");
  applyEditSnapshot(S.editTimeline[S.editCursor]);
}

function resetEditToToolSuggestion() {
  if (!S.baseResult) return;
  resetEditControls();
  resetEditTimeline();
  invalidateReviewAfterGeometryChange("已恢复工具建议，审阅状态已回到待医生确认。");
  renderResult(S.baseResult);
}

function editCommandControl(controlId: unknown): HTMLInputElement | HTMLSelectElement | null {
  if (controlId === "angleOffsetDeg") return els.angleOffset;
  if (controlId === "lengthScale") return els.lengthScale;
  if (controlId === "widthScale") return els.widthScale;
  if (controlId === "tipAngleDeg") return els.tipAngle;
  if (controlId === "shiftAlongMm") return els.shiftAlong;
  if (controlId === "shiftPerpMm") return els.shiftPerp;
  if (controlId === "editReason") return els.editReason;
  return null;
}

function handleReactEditCommand(event: Event) {
  const detail = readControllerCommandDetail(controllerEvent(event), INCISION_EDIT_COMMANDS);
  if (!detail) return;
  const { command } = detail;
  applyReactControlValue(
    editCommandControl(detail.controlId),
    detail.value,
  );
  if (command === "preview_edit") {
    applyEditControls();
    return;
  }
  if (command === "commit_edit") {
    commitEditSnapshot("control_change");
    return;
  }
  if (command === "commit_reason") {
    applyEditControls();
    commitEditSnapshot("reason_change");
    return;
  }
  if (command === "undo_edit") {
    undoEditSnapshot();
    return;
  }
  if (command === "redo_edit") {
    redoEditSnapshot();
    return;
  }
  if (command === "reset_edit") {
    resetEditToToolSuggestion();
  }
}

function updateEditVisibility(result: DynamicRecord) {
  const fusiform = result?.candidate?.type === "fusiform";
  els.widthScaleWrap.classList.toggle("hidden", !fusiform);
  els.tipAngleWrap.classList.toggle("hidden", !fusiform);
  const active = editIsActive();
  els.editStatus.textContent = active ? "已调整" : "工具建议";
  els.editStatus.classList.toggle("active", active);
  renderEditHistoryState();
}

function applyEditControls() {
  syncEditLabels();
  renderEditHistoryState();
  if (!S.baseResult) return;
  if (editIsActive()) invalidateReviewAfterGeometryChange();
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

function overrideAdviceLabel(override: DynamicRecord) {
  if (override.kind === "protective_direction") {
    return `${regionLabel(override.structure)}优先采用${directionHintLabel(override.direction_hint)}`;
  }
  return overrideLabel(override.kind);
}

function renderGuardrailDetails(guardrails: DynamicRecord = {}) {
  const warnings = guardrails?.warnings || [];
  const overrides = guardrails?.suggested_overrides || [];
  els.guardrailDetails.classList.toggle("warn", warnings.some((w: DynamicRecord) => w.severity === "medium"));
  els.guardrailDetails.classList.toggle("danger", warnings.some((w: DynamicRecord) => w.severity === "high"));
  if (!warnings.length) {
    els.guardrailDetails.textContent = "保护提示：未发现需要复核的规则项。";
    if (overrides.length) {
      els.guardrailDetails.textContent += `\n建议：${overrides.map(overrideAdviceLabel).join(" · ")}`;
    }
    return;
  }
  els.guardrailDetails.textContent = `保护提示：${warnings.map((w: DynamicRecord) => `${guardrailLabel(w.code)}（${severityLabel(w.severity)}）`).join("；")}`;
  if (overrides.length) {
    els.guardrailDetails.textContent += `\n建议：${overrides.map(overrideAdviceLabel).join(" · ")}`;
  }
}

function renderDirectionSource(result: DynamicRecord) {
  if (!els.directionSource) return;
  const direction = result.direction || {};
  const sources = [
    directionSourceLabel(direction.source),
    `支持线 ${direction.support_count ?? 0} 条`,
    direction.angular_spread_deg != null ? `轴向离散 ${fmt(direction.angular_spread_deg)}°` : null,
  ].filter(Boolean);
  const overrides = (result.guardrails?.suggested_overrides || []).filter((o: DynamicRecord) => o.kind === "protective_direction");
  if (overrides.length) {
    sources.push(`敏感结构方向例外：${overrides.map((o: DynamicRecord) => `${regionLabel(o.structure)}／${directionHintLabel(o.direction_hint)}`).join("；")}`);
  }
  sources.push(S.secondaryCues ? "皱襞/边界辅助线索：只读审阅，不参与几何" : "皱襞/边界辅助线索：未参与几何");
  if (result.candidate?.edited) sources.push("医生人工覆盖已记录");
  els.directionSource.textContent = `方向依据：${sources.join(" · ")}`;
  els.directionSource.classList.toggle("warn", direction.confidence < 0.35 || overrides.length > 0 || Boolean(result.candidate?.edited));
}

function renderWorkflowGate(result: DynamicRecord) {
  if (!els.workflowGate) return;
  const gate = workflowTraceGate(result);
  const observedActions = gate.observed_actions || [];
  els.workflowGate.classList.toggle("warn", !gate.passed);
  const missing = gate.missing_actions.map((item: DynamicRecord) => item.label).join("、");
  const status = gate.passed ? "通过" : `未通过${missing ? `；缺 ${missing}` : ""}`;
  els.workflowGate.textContent = `工作流工具门控：${status} · ${observedActions.length} 个动作；完整 workflow trace 已写入 DevTools Console。`;
  els.workflowGate.title = `observed_actions=${observedActions.join(", ")}`;
}

function formatRecoveredFailureSummary(audit: DynamicRecord, includeError = false): string {
  const failures = Array.isArray(audit?.recovered_failures) ? audit.recovered_failures : [];
  return failures
    .map((failure: DynamicRecord) => {
      const variant = failure.variant
        || (failure.angle_offset_deg != null ? `${fmt(failure.angle_offset_deg)}°` : "候选变体");
      const tool = failure.tool || "确定性工具";
      const recovery = failure.recovery === "skipped_failed_variant_and_kept_other_candidates"
        ? "已跳过失败变体并继续比较"
        : failure.recovery || "已记录恢复动作";
      const error = includeError && failure.error ? `；错误 ${String(failure.error).slice(0, 80)}` : "";
      return `${variant}/${tool}：${recovery}${error}`;
    })
    .join("；");
}

function renderWorkflowComparison(result: DynamicRecord) {
  if (!els.workflowComparison) return;
  const comparison = Array.isArray(result.candidate_comparison) ? result.candidate_comparison : [];
  const audit = result.workflow_audit || {};
  if (!comparison.length) {
    els.workflowComparison.classList.add("warn");
    els.workflowComparison.textContent = "候选比较：浏览器 workflow 尚未生成多候选比较；可手动保存候选后生成备选。";
    return;
  }
  const top = comparison
    .slice(0, 3)
    .map((item: DynamicRecord) => `#${item.rank} ${item.label || item.id} ${fmt(item.score, 1)}分`)
    .join("；");
  const failureSummary = formatRecoveredFailureSummary(audit);
  const failures = audit.tool_failure_count
    ? `；恢复失败 ${audit.tool_failure_count} 个${failureSummary ? `（${failureSummary}）` : ""}`
    : "";
  els.workflowComparison.classList.toggle("warn", Boolean(audit.tool_failure_count));
  els.workflowComparison.title = failureSummary
    ? `recovered_failures=${formatRecoveredFailureSummary(audit, true)}`
    : "";
  els.workflowComparison.textContent =
    `候选比较：${comparison.length} 个浏览器确定性候选 · ${top}${failures}。工程排序不是临床推荐或手术指令。`;
}

function tumorQualityFor(result: DynamicRecord = S.result) {
  if (!result?.tumor) return { warnings: [], warning_count: 0, passed: true };
  return result.tumor_quality || summarizeTumorInputQuality(result.tumor);
}

function renderResult(result: DynamicRecord) {
  S.result = result;
  drawCandidate(result);
  const c = result.candidate;
  els.candidateType.textContent = c.type === "linear" ? "线性" : "梭形";
  els.candidateLength.textContent = `${fmt(c.length_mm)} mm`;
  if (c.type === "fusiform") {
    const ratio = c.metrics?.length_to_width_ratio;
    const err = c.metrics?.tip_angle_error_deg;
    els.candidateWidth.textContent = `${fmt(c.width_mm)} mm / ${fmt(ratio, 2)}:1`;
    els.candidateTipAngle.textContent = `${fmt(c.tip_angle_deg)}° · 误差 ${fmt(err)}°`;
  } else {
    els.candidateWidth.textContent = "—";
    els.candidateTipAngle.textContent = "—";
  }
  const rstlDeviation = c.metrics?.rstl_deviation_deg;
  els.candidateRstlDeviation.textContent = typeof rstlDeviation === "number" && Number.isFinite(rstlDeviation)
    ? `${fmt(rstlDeviation)}°`
    : "—";
  const directionReasons = result.direction.confidence_reasons || [];
  els.directionConf.textContent = `${Math.round((result.direction.confidence || 0) * 100)}%${directionReasons.length ? ` · ${directionReasons.map(reasonLabel).join("、")}` : ""}`;
  els.directionConf.title = directionReasons.length ? `原始原因代码：${directionReasons.join(", ")}` : "";
  const regionReasons = result.anatomy.confidence_reasons || [];
  els.regionVal.textContent = `${regionLabel(result.anatomy.region)}${regionReasons.length ? ` · ${regionReasons.map(reasonLabel).join("、")}` : ""}`;
  els.regionVal.title = regionReasons.length ? `原始分区代码：${result.anatomy.region}；${regionReasons.join(", ")}` : "";
  els.guardrailVal.textContent = result.guardrails.passed ? "通过" : "复核";
  els.guardrailVal.style.color = result.guardrails.passed ? "" : "#b45309";
  renderGuardrailDetails(result.guardrails);
  renderDirectionSource(result);
  renderWorkflowGate(result);
  renderWorkflowComparison(result);
  const tumorQuality = tumorQualityFor(result);
  if (tumorQuality.warning_count) {
    els.guardrailDetails.textContent += `\n肿物输入：${tumorQuality.warnings.map((w: DynamicRecord) => `${guardrailLabel(w.code)}（${severityLabel(w.severity)}）`).join("；")}`;
  }
  els.workflowSummary.textContent = result.summary || "已生成候选。";
  els.nextStep.textContent = result.next_step || "医生审阅、编辑或拒绝该候选。";
  logWorkflowTraceToConsole(result);
  updateBoundaryStatus();
  updateEditVisibility(result);
  const audit = privacyAudit();
  els.privacyState.textContent = "浏览器本地";
  els.privacyAudit.textContent =
    `不上传原始影像；${audit.local_workflow_fields.length} 类抽象字段只在浏览器确定性 workflow 内处理，不配置或调用远程模型。${audit.secondary_cues_present ? " 辅助线索仅随审阅导出，不参与几何。" : ""}`;
  const edited = result.candidate.edited ? " · 已记录医生调整" : "";
  const headLabel = S.headAsset?.statusLabel ? ` · ${S.headAsset.statusLabel}` : "";
  const generationLabel = S.generationCount ? ` · 第 ${S.generationCount} 次生成` : "";
  els.stageStatus.textContent = `浏览器确定性 workflow 已更新候选${generationLabel}${edited}${headLabel}`;
  publishIncisionState("candidate_result");
}

function reviewGate(review: DynamicRecord, result: DynamicRecord) {
  return buildReviewGate({
    review,
    result,
    liveOverlaySupported: S.headAsset?.liveOverlaySupported !== false,
    topologyId: S.headAsset?.topologyId,
    topologyVersion: S.headAsset?.topologyVersion,
  });
}

function candidateEditSession(result: DynamicRecord = S.result) {
  const provenance = result?.candidate?.provenance || {};
  const history = Array.isArray(provenance.edit_history) ? provenance.edit_history : [];
  return {
    schema_version: "candidate-edit-session/v0.1",
    candidate_version: Number(provenance.candidate_version || 1),
    edit_count: history.length,
    current_edit_id: provenance.clinician_edit?.edit_id || null,
    undo_available: Boolean(els.undoEdit && !els.undoEdit.disabled),
    redo_available: Boolean(els.redoEdit && !els.redoEdit.disabled),
    source: "web/incision_workflow",
    history: history.map((entry: DynamicRecord) => ({
      edit_id: entry.edit_id,
      resulting_candidate_version: entry.resulting_candidate_version,
      angle_offset_deg: entry.angle_offset_deg,
      length_scale: entry.length_scale,
      width_scale: entry.width_scale,
      tip_angle_deg: entry.tip_angle_deg,
      shift_along_mm: entry.shift_along_mm,
      shift_perp_mm: entry.shift_perp_mm,
      reason: entry.reason || "",
      interaction: entry.interaction || entry.source || "clinician_adjustment",
    })),
  };
}

function sensitiveStructureInspectionFor(result: DynamicRecord = S.result) {
  if (result?.sensitive_structure_inspection) return result.sensitive_structure_inspection;
  const trace = Array.isArray(result?.trace) ? result.trace : [];
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const step = trace[i];
    if (step?.action === "inspect_sensitive_structures" && step.observation) return step.observation;
  }
  return null;
}

function reviewRecord(result: DynamicRecord = S.result, label = "候选") {
  const createdAt = new Date().toISOString();
  const review = currentReviewMetadata(createdAt);
  const actor = review.reviewer || result.tumor?.author || "unknown";
  const gate = reviewGate(review, result);
  const traceGate = workflowTraceGate(result);
  const tumorBoundarySummary = boundarySummaryFor(result.tumor, result);
  return {
    schema_version: "incision-review-record/v0.4",
    id: `candidate_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    label,
    created_at: createdAt,
    tumor: result.tumor,
    tumor_quality: tumorQualityFor(result),
    tumor_boundary_summary: tumorBoundarySummary,
    head_asset: currentHeadAssetSnapshot(),
    secondary_cues: secondaryCueReviewSummary(),
    anatomy: result.anatomy,
    sensitive_structure_inspection: sensitiveStructureInspectionFor(result),
    direction: result.direction,
    candidate: result.candidate,
    original_candidate: result.original_candidate || result.candidate,
    candidate_edit_session: candidateEditSession(result),
    guardrails: result.guardrails,
    trace: result.trace,
    workflow_trace_gate: traceGate,
    workflow_plan_audit: result.workflow_plan_audit || null,
    workflow_execution_events: result.workflow_execution_events || null,
    candidate_alternatives: result.candidate_alternatives || [],
    candidate_comparison: result.candidate_comparison || [],
    workflow_audit: result.workflow_audit || null,
    summary: result.summary || null,
    next_step: result.next_step || null,
    privacy_audit: privacyAudit(),
    review_status: review.status,
    review,
    review_gate: gate,
    guardrail_summary: summarizeGuardrails(result.guardrails),
    audit_events: [
      {
        event: "candidate_saved",
        at: createdAt,
        actor,
        status: review.status,
        approval_ready: gate.approval_ready,
        live_overlay_ready: gate.live_overlay_ready,
        workflow_trace_gate_passed: traceGate.passed,
        active_topology_id: S.headAsset?.topologyId || null,
        active_topology_version: S.headAsset?.topologyVersion || null,
      },
      ...(review.status === "pending_clinician_confirmation"
        ? []
        : [{
          event: "clinician_review_recorded",
          at: createdAt,
          actor,
          status: review.status,
          notes_present: Boolean(review.notes),
          high_guardrail_codes: gate.high_guardrail_codes,
        }]),
    ],
  };
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
  S.baseResult = rec;
  setReviewControls(rec.review || { status: rec.review_status });
  renderResult(rec);
  els.stageStatus.textContent = "已载入候选草案";
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

function saveCurrentCandidate(label = "医生候选") {
  if (!S.result) return;
  S.saved.push(reviewRecord(S.result, `${label} ${S.saved.length + 1}`));
  els.stageStatus.textContent = "候选已保存到审阅列表";
  renderSaved();
}

function saveReviewRecord() {
  const status = els.reviewDecision.value || "pending_clinician_confirmation";
  const readiness = reviewReadiness(status);
  if (!readiness.ok) {
    els.stageStatus.textContent = readiness.message;
    return;
  }
  saveCurrentCandidate("审阅候选");
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
      S.saved.push(reviewRecord(result, alternative.label || `浏览器备选 ${S.saved.length + 1}`));
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
    S.saved.push(reviewRecord(result, `备选 ${S.saved.length + 1}`));
  }
  els.stageStatus.textContent = "已生成 3 个方向备选、复跑 guardrails，并更新工程排序";
  renderSaved();
}

function recordReviewDecision(status: string, label: string) {
  if (!S.result) {
    els.stageStatus.textContent = "没有可审阅的候选";
    return;
  }
  const readiness = reviewReadiness(status);
  if (!readiness.ok) {
    els.stageStatus.textContent = readiness.message;
    return;
  }
  els.reviewDecision.value = status;
  updateReviewStateUI();
  saveCurrentCandidate(label);
}

function handleReactReviewCommand(event: Event) {
  const detail = readControllerCommandDetail(controllerEvent(event), INCISION_REVIEW_COMMANDS);
  if (!detail) return;
  const { command } = detail;
  if (command === "review_state_changed") {
    updateReviewStateUI();
    return;
  }
  if (command === "approve_candidate") {
    recordReviewDecision("approved_for_discussion", "确认候选");
    return;
  }
  if (command === "reject_candidate") {
    recordReviewDecision("rejected_by_clinician", "否决候选");
    return;
  }
  if (command === "save_review") {
    saveReviewRecord();
  }
}

function handleReactLibraryCommand(event: Event) {
  const detail = readControllerCommandDetail(controllerEvent(event), INCISION_LIBRARY_COMMANDS);
  if (!detail) return;
  const { command, id } = detail;
  if (command === "save_current") {
    saveCurrentCandidate();
    return;
  }
  if (command === "make_variants") {
    makeVariantCandidates();
    return;
  }
  if (command === "clear_saved") {
    clearSavedCandidates();
    return;
  }
  if (command === "load_candidate") {
    loadSavedCandidate(String(id || ""));
    return;
  }
  if (command === "remove_candidate") {
    removeSavedCandidate(String(id || ""));
    return;
  }
  if (command === "export_json") {
    exportReviewJson();
    return;
  }
  if (command === "export_report") {
    exportReport();
    return;
  }
  if (command === "export_png") {
    exportScreenshot();
    return;
  }
  if (command === "stage_live_overlay") {
    stageLiveOverlay();
  }
}

function exportReviewJson() {
  if (!S.result && !S.saved.length) {
    els.stageStatus.textContent = "没有可导出的候选";
    return;
  }
  const current = S.result ? reviewRecord(S.result, "当前候选") : null;
  const records = [current, ...S.saved].filter(Boolean) as DynamicRecord[];
  const payload = {
    schema_version: "incision-review-export/v0.4",
    exported_at: new Date().toISOString(),
    current,
    saved: S.saved,
    secondary_cues: secondaryCueReviewSummary(),
    candidate_comparison: compareCandidateRecords(records),
  };
  if (!exportPreflightPasses(payload, "审阅 JSON 导出")) return;
  downloadText(`incision_review_${Date.now()}.json`, JSON.stringify(payload, null, 2));
}

function exportTumorJson() {
  if (!S.verts) return;
  const tumor = tumorInput();
  const payload = {
    schema_version: "tumor-input/v0.2",
    exported_at: new Date().toISOString(),
    tumor,
    tumor_quality: summarizeTumorInputQuality(tumor),
    boundary_summary: boundarySummaryFor(tumor),
    privacy_audit: {
      raw_image_sent: false,
      raw_video_sent: false,
      contains_face_image: false,
      contains_abstract_face_coordinates: true,
    },
  };
  if (!exportPreflightPasses(payload, "肿物输入 JSON 导出")) return;
  downloadText(`tumor_input_${Date.now()}.json`, JSON.stringify(payload, null, 2));
  els.stageStatus.textContent = "已导出肿物输入 JSON";
}

function applyImportedTumor(payload: unknown) {
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
  S.boundaryPoints = imported.boundaryPoints;
  if (tumor.kind === "cutaneous") els.boundaryMode.value = imported.boundaryMode;
  S.boundaryActive = false;
  els.startBoundary.textContent = "开始轮廓";
  setLesion(nearestVertex(tumor.center));
  updateFormVisibility();
  els.pickState.textContent = imported.pickState;
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
  const comparison = compareCandidateRecords(rows);
  const comparisonBody = comparison.length
    ? [
      "## 候选工程排序",
      "",
      "该排序只按 guardrails、RSTL 偏角、覆盖缺口、敏感距离和几何误差比较，不是临床推荐或手术指令。",
      "",
      ...comparison.map((c: DynamicRecord) => `- #${c.rank} ${c.label}：${fmt(c.score, 1)} 分；${c.reasons.join("；")}`),
      "",
    ].join("\n")
    : "";
  const body = rows.map((r, idx) => {
    const metrics = r.candidate.metrics || {};
    const boundary = r.tumor_boundary_summary || {};
    const warningLines = (r.guardrails.warnings || [])
      .map((w: DynamicRecord) => `  - ${w.code} [${w.severity}] ${w.message || ""}`)
      .join("\n") || "  - 无";
    const overrideLines = (r.guardrails.suggested_overrides || [])
      .map((o: DynamicRecord) => `  - ${o.kind}: ${o.reason || ""}`)
      .join("\n") || "  - 无";
    const recoveredFailureDetails = formatRecoveredFailureSummary(r.workflow_audit, true);
    return [
    `## 候选 ${idx + 1}: ${r.label}`,
    `- 类型：${r.candidate.type === "linear" ? "皮下线性切口" : "皮表梭形切口"}`,
    `- 候选版本：v${r.candidate.provenance?.candidate_version || 1}；编辑记录 ${(r.candidate.provenance?.edit_history || []).length} 条`,
    r.head_asset
      ? `- 头模资产：${r.head_asset.label}；topology=${r.head_asset.topologyId}@${r.head_asset.topologyVersion}；顶点 ${r.head_asset.vertexCount} / 三角面 ${r.head_asset.triangleCount}；状态 ${r.head_asset.statusLabel}`
      : null,
    (r.head_asset?.warnings || []).length
      ? `- 头模资产提示：${r.head_asset.warnings.join("；")}`
      : null,
    r.candidate_edit_session?.edit_count
      ? `- 编辑时间线：${r.candidate_edit_session.edit_count} 步；当前 edit_id ${r.candidate_edit_session.current_edit_id || "—"}`
      : null,
    `- 肿物：${r.tumor.kind}，直径 ${fmt(r.tumor.diameter_mm)} mm，切缘 ${fmt(r.tumor.margin_mm)} mm`,
    (r.tumor_quality?.warnings || []).length
      ? `- 肿物输入提示：${r.tumor_quality.warnings.map((w: DynamicRecord) => `${w.code}(${w.severity})`).join("；")}`
      : null,
    r.secondary_cues?.present
      ? `- 辅助线索：${r.secondary_cues.confidence_label}；人工确认 ${r.secondary_cues.manual_confirmed ? "是" : "否"}；不参与几何 ${r.secondary_cues.used_for_geometry === false ? "是" : "否"}`
      : null,
    boundary.boundary_used
      ? `- 肿物边界摘要：点数 ${boundary.point_count ?? "—"}；长轴 ${fmt(boundary.axis_diameter_mm)} mm；短轴 ${fmt(boundary.perp_diameter_mm)} mm；面积 ${fmt(boundary.area_mm2)} mm²；自交 ${boundary.self_intersection ? "是" : "否"}；中心偏移 ${fmt(boundary.center_shift_mm)} mm`
      : null,
    `- 面部分区：${r.anatomy.region} / ${r.anatomy.subunit}`,
    (r.anatomy.confidence_reasons || []).length
      ? `- 分区置信原因：${r.anatomy.confidence_reasons.join(", ")}`
      : null,
    `- RSTL 来源：${directionSourceLabel(r.direction.source)}；support ${r.direction.support_count ?? 0}；轴向离散 ${fmt(r.direction.angular_spread_deg)}°`,
    `- RSTL 方向置信度：${Math.round((r.direction.confidence || 0) * 100)}%`,
    (r.direction.confidence_reasons || []).length
      ? `- RSTL 低置信原因：${r.direction.confidence_reasons.join(", ")}`
      : null,
    r.sensitive_structure_inspection
      ? `- 敏感结构检查：中心距 ${fmt(r.sensitive_structure_inspection.center_free_margin_distance_mm)} mm / 阈值 ${fmt(r.sensitive_structure_inspection.center_free_margin_threshold_mm)} mm；候选几何距 ${fmt(r.sensitive_structure_inspection.candidate_free_margin_distance_mm)} mm / 阈值 ${fmt(r.sensitive_structure_inspection.candidate_free_margin_threshold_mm)} mm；warning ${r.sensitive_structure_inspection.warning_count || 0} 个；保护方向 ${r.sensitive_structure_inspection.protective_direction?.direction_hint || "无"}`
      : null,
    `- 工作流工具门控：passed=${Boolean(r.workflow_trace_gate?.passed)}；order_ok=${Boolean(r.workflow_trace_gate?.order_ok)}；missing=${(r.workflow_trace_gate?.missing_actions || []).map((item: DynamicRecord) => item.label || item.key).join(", ") || "无"}`,
    r.workflow_plan_audit
      ? `- 工作流计划：passed=${Boolean(r.workflow_plan_audit.passed)}；步骤 ${r.workflow_plan_audit.completed_step_count || 0}/${r.workflow_plan_audit.step_count || 0}；失败 ${r.workflow_plan_audit.failed_step_count || 0}`
      : null,
    r.workflow_execution_events
      ? `- 工作流执行事件：passed=${Boolean(r.workflow_execution_events.passed)}；事件 ${r.workflow_execution_events.event_count || 0} 条；工具事件 ${r.workflow_execution_events.tool_event_count || 0} 条；重试 ${r.workflow_execution_events.retry_event_count || 0}；恢复 ${r.workflow_execution_events.recovery_event_count || 0}`
      : null,
    r.workflow_audit
      ? `- 浏览器 workflow 审计：候选 ${r.workflow_audit.candidate_count || 0} 个；比较 ${r.workflow_audit.comparison_ready ? "已生成" : "未生成"}；恢复失败 ${r.workflow_audit.tool_failure_count || 0} 个`
      : null,
    recoveredFailureDetails ? `- 工作流恢复详情：${recoveredFailureDetails}` : null,
    (r.candidate_comparison || []).length
      ? `- 浏览器候选比较：${r.candidate_comparison.map((c: DynamicRecord) => `#${c.rank} ${c.label || c.id} ${fmt(c.score, 1)}分`).join("；")}（不是临床推荐或手术指令）`
      : null,
    `- 候选长度：${fmt(r.candidate.length_mm)} mm`,
    r.candidate.type === "fusiform"
      ? `- 梭形宽度 / 长宽比：${fmt(r.candidate.width_mm)} mm / ${fmt(r.candidate.metrics?.length_to_width_ratio, 2)}:1`
      : null,
    r.candidate.type === "fusiform"
      ? `- 尖端角：${fmt(r.candidate.tip_angle_deg)}°；目标 ${fmt(r.candidate.metrics?.tip_angle_target_deg)}°；误差 ${fmt(r.candidate.metrics?.tip_angle_error_deg)}°`
      : null,
    r.candidate.type === "fusiform"
      ? `- 边界质量：点数 ${metrics.boundary_point_count ?? "—"}；面积 ${fmt(metrics.boundary_area_mm2)} mm²；自交 ${metrics.boundary_self_intersection ? "是" : "否"}；中心偏移 ${fmt(metrics.boundary_center_shift_mm)} mm`
      : null,
    r.candidate.type === "fusiform"
      ? `- 梭形包络：outline 面积 ${fmt(metrics.outline_area_mm2)} mm²；单峰收窄 ${metrics.outline_half_width_monotone === false ? "否" : "是"}；对称误差 ${fmt(metrics.outline_symmetry_max_error_mm)} mm；自交 ${metrics.outline_self_intersection ? "是" : "否"}；边界余量 ${fmt(metrics.boundary_envelope_min_margin_mm)} mm；出界点 ${metrics.boundary_envelope_outside_count ?? 0}`
      : null,
    metrics.sensitive_free_margin_min_distance_mm != null
      ? `- 最近敏感游离缘：${metrics.sensitive_free_margin_nearest || "—"}，${fmt(metrics.sensitive_free_margin_min_distance_mm)} mm`
      : null,
    `- Guardrails：${r.guardrails.passed ? "通过" : "需医生复核"}`,
    `- 警告：\n${warningLines}`,
    `- 建议覆盖项：\n${overrideLines}`,
    `- 审阅门槛：approval_ready=${Boolean(r.review_gate?.approval_ready)}；live_overlay_ready=${Boolean(r.review_gate?.live_overlay_ready)}；workflow_trace_gate=${Boolean(r.review_gate?.workflow_trace_gate_passed)}；high=${(r.review_gate?.high_guardrail_codes || []).join(", ") || "无"}`,
    `- 审阅状态：${reviewStatusLabel(r.review_status)}；审阅人：${r.review?.reviewer || "未填写"}`,
    `- 审阅备注：${r.review?.notes || "无"}`,
    `- 审阅边界：研究候选记录，非手术指令。`,
  ].filter(Boolean).join("\n");
  }).join("\n\n");
  downloadText(`incision_report_${Date.now()}.md`, `# 切口候选审阅草案\n\n${comparisonBody}${body}\n`, "text/markdown");
}

function exportScreenshot() {
  if (!S.result) {
    els.stageStatus.textContent = "没有可截图的候选";
    return;
  }
  els.canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `incision_candidate_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
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
  if (S.headAsset?.liveOverlaySupported === false) {
    els.stageStatus.textContent = "当前候选基于高精度三维头模预览生成；发送到实时叠加前需要单独映射复核，已阻止发送。";
    publishIncisionState("live_overlay_blocked_by_topology");
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
    return;
  }
  els.stageStatus.textContent = "已发送到实时叠加；返回实时显示后上传照片、视频或开启摄像头查看。";
}

async function runWorkflow() {
  if (!S.verts) return;
  els.run.disabled = true;
  els.stageStatus.textContent = "Worker 确定性 workflow 生成中…";
  try {
    const tumor = tumorInput();
    const result = await planWorkflowForCurrentTumor(tumor);
    S.baseResult = result;
    S.generationCount += 1;
    resetEditControls();
    resetEditTimeline();
    resetReviewControls();
    renderResult(result);
  } finally {
    els.run.disabled = false;
  }
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
  const r = els.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  S.head.camera.updateMatrixWorld(true);
  S.head.scene.updateMatrixWorld(true);
  S.raycaster.setFromCamera(ndc, S.head.camera);
  const hit = S.raycaster.intersectObject(S.head.mesh, false)[0];
  if (!hit || !hit.face) return null;
  const local = S.head.group.worldToLocal(hit.point.clone());
  return { point: [local.x, local.y, local.z] as Vec3, face: hit.face };
}

function handleFromEvent(e: PointerEvent) {
  if (!S.head || !S.endpointHandles.length) return null;
  const r = els.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  S.head.camera.updateMatrixWorld(true);
  S.head.scene.updateMatrixWorld(true);
  S.raycaster.setFromCamera(ndc, S.head.camera);
  const hit = S.raycaster.intersectObjects(S.endpointHandles.filter((h) => h.visible), false)[0];
  return hit?.object?.userData?.handle ?? null;
}

function signedAngleDeg(axis0: VectorLike, axis1: VectorLike, normal: VectorLike): number {
  const perp = norm(cross(normal, axis0));
  return Math.atan2(dot(axis1, perp), dot(axis1, axis0)) * 180 / Math.PI;
}

function setEditFromGeometry(center: VectorLike, axis: VectorLike, lengthMm: number) {
  if (!S.baseResult) return;
  const base = S.baseResult.original_candidate || S.baseResult.candidate;
  const axis0 = norm(base.axis || [1, 0, 0]);
  const normal = S.normals[S.lesion];
  const perp0 = norm(cross(normal, axis0));
  const delta = sub(center, base.center || S.baseResult.tumor.center);
  const angle = clamp(signedAngleDeg(axis0, axis, normal), Number(els.angleOffset.min), Number(els.angleOffset.max));
  const lengthScale = clamp((lengthMm / Math.max(Number(base.length_mm || 1), 1)) * 100, Number(els.lengthScale.min), Number(els.lengthScale.max));
  const shiftAlong = clamp(dot(delta, axis0) / S.unitsPerMm, Number(els.shiftAlong.min), Number(els.shiftAlong.max));
  const shiftPerp = clamp(dot(delta, perp0) / S.unitsPerMm, Number(els.shiftPerp.min), Number(els.shiftPerp.max));
  els.angleOffset.value = String(Math.round(angle));
  els.lengthScale.value = String(Math.round(lengthScale));
  els.shiftAlong.value = String(Math.round(shiftAlong));
  els.shiftPerp.value = String(Math.round(shiftPerp));
  applyEditControls();
}

function dragEndpointTo(e: PointerEvent, idx: number) {
  if (!S.result?.candidate?.endpoints) return;
  const hit = facePointFromEvent(e);
  if (!hit) return;
  const candidate = S.result.candidate;
  const current = candidate.endpoints;
  const center = candidate.center || S.result.tumor.center;
  const handleVector = sub(hit.point, center);
  const axis = len(handleVector) > 1e-6
    ? norm(idx === 0 ? mul(handleVector, -1) : handleVector)
    : norm(candidate.axis || sub(current[1], current[0]));
  const lengthMm = Math.max(1, len(handleVector) * 2 / S.unitsPerMm);
  setEditFromGeometry(center, axis, lengthMm);
}

function pick(e: PointerEvent) {
  if (!S.head) return;
  const hit = facePointFromEvent(e);
  if (!hit) return;
  if (S.boundaryActive && els.tumorKind.value === "cutaneous" && els.boundaryMode.value === "freehand") {
    S.boundaryPoints.push(hit.point);
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
  setLesion(best);
  runWorkflow();
}

function bindWorkbenchEvents() {
  let drag: PointerDragState | null = null;
  els.canvas.addEventListener("pointerdown", (e: PointerEvent) => {
    const handle = handleFromEvent(e);
  if (handle != null) {
    drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId, handle };
    els.canvas.setPointerCapture(e.pointerId);
    return;
  }
  drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
  els.canvas.setPointerCapture(e.pointerId);
  });
  els.canvas.addEventListener("pointermove", (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.handle != null) {
    dragEndpointTo(e, drag.handle);
    drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
    return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  S.head?.setRotation(clamp((S.head?.rotX || 0) + dy * 0.01, -1.2, 1.2), (S.head?.rotY || 0) + dx * 0.01);
  drag.x = e.clientX; drag.y = e.clientY;
  });
  els.canvas.addEventListener("pointerup", (e: PointerEvent) => {
  const endpointDrag = drag?.handle != null;
  const moved = drag?.moved || 0;
  if (drag && drag.moved < 6 && !endpointDrag) pick(e);
  if (endpointDrag && moved >= 1) commitEditSnapshot("endpoint_drag");
  drag = null;
  });
  els.canvas.addEventListener("wheel", (e: WheelEvent) => { e.preventDefault(); S.head?.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
  const reactManaged = isReactManagedWorkbench();
  if (reactManaged) {
    bindReactWorkbenchCommands();
  } else {
    const stateRoot = els.canvas?.closest(".app");
    stateRoot?.addEventListener("change", () => publishIncisionState("form_change"));
    stateRoot?.addEventListener("input", (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) {
        publishIncisionState("form_input");
      }
    });
  }

  if (!reactManaged) {
    els.tumorKind.onchange = () => { updateFormVisibility(); runWorkflow(); };
    els.diameter.oninput = () => { els.diameterVal.textContent = els.diameter.value; updateTumorRing(); };
    els.diameter.onchange = runWorkflow;
    els.depth.oninput = () => { els.depthVal.textContent = els.depth.value; };
    els.depth.onchange = runWorkflow;
    els.margin.oninput = () => { els.marginVal.textContent = els.margin.value; updateTumorRing(); };
    els.margin.onchange = runWorkflow;
    els.ellipseRatio.oninput = () => { els.ellipseRatioVal.textContent = `${els.ellipseRatio.value}%`; updateTumorRing(); };
    els.ellipseRatio.onchange = runWorkflow;
    els.boundaryMode.onchange = () => { S.boundaryActive = false; updateFormVisibility(); runWorkflow(); };
    els.run.onclick = runWorkflow;
    els.startBoundary.onclick = toggleBoundaryDrawing;
    els.clearBoundary.onclick = clearBoundaryPoints;
    els.exportTumor.onclick = exportTumorJson;
    els.importTumor.onclick = () => els.tumorImportFile.click();
  }
  if (!reactManaged) {
    els.importSecondaryCue.onclick = () => els.secondaryCueImportFile.click();
    els.clearSecondaryCue.onclick = clearSecondaryCues;
    els.secondaryCueConfirmed.onchange = setSecondaryCueConfirmedFromControl;
  }
  if (!reactManaged) {
    [
    els.angleOffset,
    els.lengthScale,
    els.widthScale,
    els.tipAngle,
    els.shiftAlong,
    els.shiftPerp,
    ].forEach((el) => { el.oninput = applyEditControls; });
    [
    els.angleOffset,
    els.lengthScale,
    els.widthScale,
    els.tipAngle,
    els.shiftAlong,
    els.shiftPerp,
    ].forEach((el) => { el.onchange = () => commitEditSnapshot("control_change"); });
    els.editReason.onchange = () => {
    applyEditControls();
    commitEditSnapshot("reason_change");
    };
    els.undoEdit.onclick = undoEditSnapshot;
    els.redoEdit.onclick = redoEditSnapshot;
    els.resetEdit.onclick = resetEditToToolSuggestion;
  }
  if (!reactManaged) {
    els.reviewDecision.onchange = updateReviewStateUI;
    els.approveCandidate.onclick = () => recordReviewDecision("approved_for_discussion", "确认候选");
    els.rejectCandidate.onclick = () => recordReviewDecision("rejected_by_clinician", "否决候选");
    els.saveReview.onclick = saveReviewRecord;
  }
  if (!reactManaged) {
    els.saveCandidate.onclick = () => saveCurrentCandidate();
    els.makeVariants.onclick = makeVariantCandidates;
    els.clearSaved.onclick = clearSavedCandidates;
    els.exportJson.onclick = exportReviewJson;
    els.exportReport.onclick = exportReport;
    els.exportPng.onclick = exportScreenshot;
    els.stageLiveOverlay.onclick = stageLiveOverlay;
  }
  els.tumorImportFile.onchange = (e: Event) => importTumorFile(fileFromEvent(e));
  els.secondaryCueImportFile.onchange = (e: Event) => importSecondaryCueFile(fileFromEvent(e));
  S.resizeObserver = new ResizeObserver(fitSize);
  S.resizeObserver.observe(els.wrap);
}

function renderLoop() {
  if (!S.mounted || !S.head) return;
  S.head.render();
  S.frameId = requestAnimationFrame(renderLoop);
}

function bindReactWorkbenchCommands() {
  S.reactCommandCleanup = bindWindowControllerEvents([
    [INCISION_TUMOR_REACT_COMMAND_EVENT, handleReactTumorCommand],
    [INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT, handleReactSecondaryCueCommand],
    [INCISION_EDIT_REACT_COMMAND_EVENT, handleReactEditCommand],
    [INCISION_REVIEW_REACT_COMMAND_EVENT, handleReactReviewCommand],
    [INCISION_LIBRARY_REACT_COMMAND_EVENT, handleReactLibraryCommand],
  ]);
}

export function disposeIncisionWorkbench() {
  S.mounted = false;
  if (S.frameId) cancelAnimationFrame(S.frameId);
  S.resizeObserver?.disconnect?.();
  S.workflowWorker?.dispose?.();
  S.workflowWorker = null;
  S.reactCommandCleanup?.();
  S.reactCommandCleanup = null;
  S.head?.dispose?.();
}

export function mountIncisionWorkbench(root: ParentNode | Document = document) {
  disposeIncisionWorkbench();
  els = collectIncisionElements(root);
  S = createRuntimeState();
  S.mounted = true;
  bindWorkbenchEvents();
  boot().catch((err) => {
    if (!S.mounted) return;
    els.stageStatus.textContent = "加载失败：" + err.message;
    if (els.assetLoadingText) {
      els.assetLoadingText.textContent = `资产加载失败：${err.message}`;
    }
    publishIncisionState("asset_load_failed");
    console.error(err);
  });
  return disposeIncisionWorkbench;
}
