import { INCISION_SNAPSHOT_SCHEMA_VERSION } from "../lib/controllerSnapshotSchemas";

export { INCISION_SNAPSHOT_SCHEMA_VERSION };

export interface IncisionTextLike {
  textContent?: string | null;
  title?: string | null;
  value?: string | null;
  checked?: boolean;
  disabled?: boolean;
  classList?: {
    contains: (className: string) => boolean;
  };
  style?: {
    color?: string | null;
  };
}

export interface IncisionProviderConfigLike {
  provider?: string;
  base_url?: string;
  model?: string;
  timeout_s?: number | string | null;
}

export interface IncisionTumorState {
  kind: "subcutaneous" | "cutaneous" | string;
  author: string;
  diameterMm: number | null;
  depthMm: number | null;
  marginMm: number | null;
  boundaryMode: string;
  boundaryActive: boolean;
  boundaryPointCount: number;
  boundaryStatus: string;
  boundaryStatusWarn: boolean;
  pickState: string;
  anatomyPreview: string;
  anatomyPreviewWarn: boolean;
}

export interface IncisionProviderState {
  provider: string;
  baseUrl: string;
  model: string;
  timeoutS: number | null;
  stateLabel: string;
  testLabel: string;
}

export interface IncisionSecondaryCueState {
  present: boolean;
  stateLabel: string;
  summary: string;
  manualConfirmed: boolean;
}

export interface IncisionPrivacyAuditState {
  stateLabel: string;
  message: string;
  blocked: boolean;
}

export interface IncisionAssetLoadingState {
  visible: boolean;
  text: string;
}

export interface IncisionReviewState {
  status: string;
  reviewer: string;
  notesPresent: boolean;
}

export interface IncisionEditState {
  angleOffsetDeg: number;
  lengthScalePct: number;
  widthScalePct: number;
  shiftAlongMm: number;
  shiftPerpMm: number;
  reason: string;
  statusLabel: string;
  active: boolean;
  widthScaleVisible: boolean;
  historyLabel: string;
  undoDisabled: boolean;
  redoDisabled: boolean;
}

export interface IncisionCandidateSummary {
  id: string | null;
  type: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  guardrailsPassed: boolean | null;
  directionConfidence: number | null;
  edited: boolean;
}

export interface IncisionResultViewState {
  candidateType: string;
  candidateLength: string;
  candidateWidth: string;
  candidateTipAngle: string;
  directionConfidence: string;
  directionTitle: string;
  region: string;
  regionTitle: string;
  guardrailLabel: string;
  guardrailWarn: boolean;
  llmSummary: string;
  directionSource: string;
  directionSourceWarn: boolean;
  agentGate: string;
  agentGateWarn: boolean;
  agentGateTitle: string;
  agentComparison: string;
  agentComparisonWarn: boolean;
  agentComparisonTitle: string;
  nextStep: string;
  guardrailDetails: string;
  guardrailDetailsWarn: boolean;
  guardrailDetailsDanger: boolean;
}

export interface IncisionSavedCandidateSummary {
  id: string;
  title: string;
  statusLabel: string;
  statusDanger: boolean;
  meta: string;
}

export interface IncisionWorkflowRuntime {
  executor: string;
  worker: boolean;
  thread: string;
  error: string | null;
}

export interface IncisionControllerSnapshot {
  schema_version: typeof INCISION_SNAPSHOT_SCHEMA_VERSION;
  reason: string;
  stageStatus: string;
  assetLoading: IncisionAssetLoadingState;
  tumor: IncisionTumorState;
  secondaryCue: IncisionSecondaryCueState;
  privacyAudit: IncisionPrivacyAuditState;
  provider: IncisionProviderState;
  review: IncisionReviewState;
  edit: IncisionEditState;
  candidate: IncisionCandidateSummary | null;
  resultView: IncisionResultViewState;
  savedCandidates: IncisionSavedCandidateSummary[];
  workflowRuntime: IncisionWorkflowRuntime | null;
  savedCount: number;
  updatedAt: string;
}

export interface IncisionEditLike {
  angle_offset_deg?: number;
  length_scale?: number;
  width_scale?: number;
  shift_along_mm?: number;
  shift_perp_mm?: number;
  reason?: string;
}

export interface IncisionComparisonLike {
  id?: string;
  rank?: number;
  score?: number;
  reasons?: string[];
}

export function incisionTextOf(el?: IncisionTextLike | null, fallback = "") {
  return el?.textContent || fallback;
}

export function incisionTitleOf(el?: IncisionTextLike | null) {
  return el?.title || "";
}

export function incisionHasClass(el: IncisionTextLike | null | undefined, className: string) {
  return Boolean(el?.classList?.contains(className));
}

export function formatIncisionMetric(value: unknown, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

function finiteOrNull(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function finiteOrFallback(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildIncisionProviderSnapshot(
  cfg: IncisionProviderConfigLike,
  stateLabel = "待运行",
  testLabel = "",
): IncisionProviderState {
  return {
    provider: cfg.provider || "openai-compatible",
    baseUrl: cfg.base_url || "",
    model: cfg.model || "",
    timeoutS: finiteOrNull(cfg.timeout_s),
    stateLabel,
    testLabel,
  };
}

export function buildIncisionSecondaryCueSnapshot({
  present = false,
  stateLabel = "未导入",
  summary = "仅展示自然皱襞、皱纹和皮表肿物边界的低置信度线索；不会自动改变肿物边界或候选切口。",
  manualConfirmed = false,
}: Partial<IncisionSecondaryCueState>): IncisionSecondaryCueState {
  return {
    present: Boolean(present),
    stateLabel,
    summary,
    manualConfirmed: Boolean(manualConfirmed),
  };
}

export function buildIncisionPrivacyAuditSnapshot({
  stateLabel = "本地几何",
  message = "不上传原始影像；Agent 只接收肿物参数、抽象坐标、规则和候选几何。",
}: Partial<IncisionPrivacyAuditState>): IncisionPrivacyAuditState {
  return {
    stateLabel,
    message,
    blocked: /阻断|警告/.test(`${stateLabel} ${message}`),
  };
}

export function buildIncisionAssetLoadingSnapshot({
  visible = false,
  text = "准备下载标准脸、拓扑和 RSTL 图谱。",
}: Partial<IncisionAssetLoadingState>): IncisionAssetLoadingState {
  return {
    visible: Boolean(visible),
    text,
  };
}

export function buildIncisionReviewSnapshot({
  status = "pending_clinician_confirmation",
  reviewer = "",
  notesPresent = false,
}: Partial<IncisionReviewState>): IncisionReviewState {
  return {
    status,
    reviewer: reviewer.trim(),
    notesPresent: Boolean(notesPresent),
  };
}

export function buildIncisionEditSnapshot({
  edit = {},
  statusLabel = "工具建议",
  statusActive = false,
  editActive = false,
  widthScaleVisible = false,
  historyLabel = "编辑版本：v1 · 无已提交调整",
  undoDisabled = false,
  redoDisabled = false,
}: {
  edit?: IncisionEditLike;
  statusLabel?: string;
  statusActive?: boolean;
  editActive?: boolean;
  widthScaleVisible?: boolean;
  historyLabel?: string;
  undoDisabled?: boolean;
  redoDisabled?: boolean;
}): IncisionEditState {
  return {
    angleOffsetDeg: finiteOrFallback(edit.angle_offset_deg, 0),
    lengthScalePct: Math.round(finiteOrFallback(edit.length_scale, 1) * 100),
    widthScalePct: Math.round(finiteOrFallback(edit.width_scale, 1) * 100),
    shiftAlongMm: finiteOrFallback(edit.shift_along_mm, 0),
    shiftPerpMm: finiteOrFallback(edit.shift_perp_mm, 0),
    reason: edit.reason || "",
    statusLabel,
    active: Boolean(statusActive) || Boolean(editActive),
    widthScaleVisible: Boolean(widthScaleVisible),
    historyLabel,
    undoDisabled: Boolean(undoDisabled),
    redoDisabled: Boolean(redoDisabled),
  };
}

export function buildIncisionCandidateSnapshot(result: any): IncisionCandidateSummary | null {
  const candidate = result?.candidate;
  if (!candidate) return null;
  return {
    id: candidate.id || null,
    type: candidate.type || null,
    lengthMm: finiteOrNull(candidate.length_mm),
    widthMm: finiteOrNull(candidate.width_mm),
    guardrailsPassed: result?.guardrails?.passed == null ? null : Boolean(result.guardrails.passed),
    directionConfidence: finiteOrNull(result?.direction?.confidence),
    edited: Boolean(candidate.edited),
  };
}

export function buildIncisionResultViewSnapshot(input: {
  candidateType?: IncisionTextLike | null;
  candidateLength?: IncisionTextLike | null;
  candidateWidth?: IncisionTextLike | null;
  candidateTipAngle?: IncisionTextLike | null;
  directionConfidence?: IncisionTextLike | null;
  region?: IncisionTextLike | null;
  guardrail?: IncisionTextLike | null;
  llmSummary?: IncisionTextLike | null;
  directionSource?: IncisionTextLike | null;
  agentGate?: IncisionTextLike | null;
  agentComparison?: IncisionTextLike | null;
  nextStep?: IncisionTextLike | null;
  guardrailDetails?: IncisionTextLike | null;
}): IncisionResultViewState {
  return {
    candidateType: incisionTextOf(input.candidateType, "—"),
    candidateLength: incisionTextOf(input.candidateLength, "—"),
    candidateWidth: incisionTextOf(input.candidateWidth, "—"),
    candidateTipAngle: incisionTextOf(input.candidateTipAngle, "—"),
    directionConfidence: incisionTextOf(input.directionConfidence, "—"),
    directionTitle: incisionTitleOf(input.directionConfidence),
    region: incisionTextOf(input.region, "—"),
    regionTitle: incisionTitleOf(input.region),
    guardrailLabel: incisionTextOf(input.guardrail, "—"),
    guardrailWarn: Boolean(input.guardrail?.style?.color),
    llmSummary: incisionTextOf(input.llmSummary, "尚未生成。"),
    directionSource: incisionTextOf(input.directionSource, "方向依据：尚未生成。"),
    directionSourceWarn: incisionHasClass(input.directionSource, "warn"),
    agentGate: incisionTextOf(input.agentGate, "Agent 工具门控：尚未生成。"),
    agentGateWarn: incisionHasClass(input.agentGate, "warn"),
    agentGateTitle: incisionTitleOf(input.agentGate),
    agentComparison: incisionTextOf(input.agentComparison, "Agent 候选比较：尚未生成。"),
    agentComparisonWarn: incisionHasClass(input.agentComparison, "warn"),
    agentComparisonTitle: incisionTitleOf(input.agentComparison),
    nextStep: incisionTextOf(input.nextStep, ""),
    guardrailDetails: incisionTextOf(input.guardrailDetails, "Guardrails 尚未运行。"),
    guardrailDetailsWarn: incisionHasClass(input.guardrailDetails, "warn"),
    guardrailDetailsDanger: incisionHasClass(input.guardrailDetails, "danger"),
  };
}

export function buildIncisionSavedCandidateSummaries({
  records = [],
  comparisons = [],
  reviewStatusLabel,
}: {
  records?: any[];
  comparisons?: IncisionComparisonLike[];
  reviewStatusLabel: (status?: string) => string;
}): IncisionSavedCandidateSummary[] {
  const comparisonById = new Map(comparisons.map((comparison) => [comparison.id, comparison]));
  return records.map((rec) => {
    const comparison = comparisonById.get(rec.id);
    const reviewer = rec.review?.reviewer ? ` · 审阅人 ${rec.review.reviewer}` : "";
    const guardrails = rec.guardrails?.passed ? "guardrails 通过" : "guardrails 需复核";
    const rank = comparison
      ? `工程排序 #${comparison.rank} · 分 ${formatIncisionMetric(comparison.score, 1)} · ${(comparison.reasons || []).slice(0, 2).join("；")} · `
      : "";
    return {
      id: rec.id,
      title: `${rec.label} · ${rec.candidate?.type === "linear" ? "线性" : "梭形"}`,
      statusLabel: reviewStatusLabel(rec.review_status),
      statusDanger: rec.review_status === "rejected_by_clinician" || !rec.guardrails?.passed,
      meta: `${rank}长度 ${formatIncisionMetric(rec.candidate?.length_mm)} mm · 区域 ${rec.anatomy?.region || "—"} · ${guardrails}${reviewer} · ${rec.created_at}`,
    };
  });
}

export function buildIncisionControllerSnapshot({
  reason = "state_update",
  stageStatus = "",
  assetLoading,
  tumor,
  secondaryCue,
  privacyAudit,
  provider,
  review,
  edit,
  candidate,
  resultView,
  savedCandidates = [],
  workflowRuntime = null,
  savedCount = 0,
  updatedAt = new Date().toISOString(),
}: Omit<IncisionControllerSnapshot, "schema_version" | "updatedAt"> & { updatedAt?: string }): IncisionControllerSnapshot {
  return {
    schema_version: INCISION_SNAPSHOT_SCHEMA_VERSION,
    reason,
    stageStatus,
    assetLoading,
    tumor,
    secondaryCue,
    privacyAudit,
    provider,
    review,
    edit,
    candidate,
    resultView,
    savedCandidates,
    workflowRuntime,
    savedCount,
    updatedAt,
  };
}
