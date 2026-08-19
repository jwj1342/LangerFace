import {
  directionHintLabel,
  directionSourceLabel,
  engineeringRecoveryLabel,
  guardrailLabel,
  overrideLabel,
  reasonLabel,
  regionLabel,
  severityLabel,
} from "./incisionClinicalCopy.ts";
import { formatRecoveredFailureSummary } from "./incisionReviewRecords.ts";

export interface IncisionTextPresentation {
  text: string;
  title?: string;
  classNames?: readonly string[];
}

export interface IncisionGuardrailWarning {
  code?: unknown;
  severity?: unknown;
}

export interface IncisionSuggestedOverride {
  kind?: unknown;
  structure?: unknown;
  direction_hint?: unknown;
}

export interface IncisionGuardrailsPresentationInput {
  passed?: boolean;
  hard_violations?: Array<{ code?: unknown; recovery?: unknown }>;
  warnings?: IncisionGuardrailWarning[];
  suggested_overrides?: IncisionSuggestedOverride[];
}

export interface IncisionWorkflowGatePresentationInput {
  passed?: boolean;
  observed_actions?: unknown[];
  missing_actions?: Array<{ label?: unknown }>;
}

export interface IncisionTumorQualityPresentationInput {
  warnings?: IncisionGuardrailWarning[];
  warning_count?: number;
}

export interface IncisionResultPresentationInput {
  candidate?: {
    type?: unknown;
    length_mm?: unknown;
    width_mm?: unknown;
    tip_angle_deg?: unknown;
    edited?: unknown;
    metrics?: {
      length_to_width_ratio?: unknown;
      tip_angle_error_deg?: unknown;
      rstl_deviation_deg?: unknown;
      projected_rstl_deviation_deg?: unknown;
      photo_reference_candidate?: unknown;
      photo_visibility_limited_candidate?: unknown;
      photo_visible_fraction?: unknown;
      photo_reference_aspect_ratio?: unknown;
      photo_reference_length_scale?: unknown;
      photo_canonical_scale?: unknown;
    };
  };
  direction?: {
    source?: unknown;
    support_count?: unknown;
    angular_spread_deg?: unknown;
    confidence?: unknown;
    confidence_reasons?: unknown[];
  };
  anatomy?: {
    region?: unknown;
    confidence_reasons?: unknown[];
  };
  guardrails?: IncisionGuardrailsPresentationInput;
  candidate_comparison?: Array<{
    id?: unknown;
    rank?: unknown;
    label?: unknown;
    score?: unknown;
  }>;
  workflow_audit?: Record<string, unknown>;
  summary?: unknown;
  next_step?: unknown;
}

export interface IncisionResultPresentation {
  candidateType: string;
  candidateLength: string;
  candidateWidth: string;
  candidateTipAngle: string;
  candidateRstlDeviation: string;
  directionConfidence: IncisionTextPresentation;
  region: IncisionTextPresentation;
  guardrailValue: { text: string; color: string };
  guardrailDetails: IncisionTextPresentation;
  directionSource: IncisionTextPresentation;
  workflowGate: IncisionTextPresentation;
  workflowComparison: IncisionTextPresentation;
  workflowSummary: string;
  nextStep: string;
  privacyState: string;
  privacyAudit: string;
  stageStatus: string;
}

export interface BuildIncisionResultPresentationInput {
  result: IncisionResultPresentationInput;
  workflowGate: IncisionWorkflowGatePresentationInput;
  tumorQuality: IncisionTumorQualityPresentationInput;
  secondaryCuesPresent: boolean;
  generationCount: number;
  headStatusLabel?: string;
  privacyAudit: {
    local_workflow_fields?: unknown[];
    secondary_cues_present?: boolean;
  };
}

function formatMetric(value: unknown, digits = 1): string {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

export function buildCandidateMetricPresentation(result: IncisionResultPresentationInput) {
  const candidate = result.candidate || {};
  const metrics = candidate.metrics || {};
  const referenceRatio = Number(metrics.photo_reference_aspect_ratio);
  const isVisibilityLimited = metrics.photo_visibility_limited_candidate === true;
  const isReference = metrics.photo_reference_candidate === true
    && Number.isFinite(referenceRatio) && referenceRatio > 1;
  const photoScale = isReference && Number(metrics.photo_canonical_scale) > 0
    ? Number(metrics.photo_canonical_scale) : 1;
  const lengthScale = isReference && Number(metrics.photo_reference_length_scale) > 0
    ? Number(metrics.photo_reference_length_scale) : 1;
  const length = Number(candidate.length_mm) * photoScale * lengthScale;
  const width = Number(candidate.width_mm) * photoScale;
  const rawRatio = Number(metrics.length_to_width_ratio);
  const displayedRatio = isReference
    ? referenceRatio
    : Number.isFinite(rawRatio) && rawRatio > 1
      ? rawRatio
      : Number(candidate.length_mm) / Math.max(1e-9, Number(candidate.width_mm));
  return {
    candidateType: isVisibilityLimited
      ? "视野受限参考"
      : isReference ? "受限参考" : candidate.type === "linear" ? "线性" : "梭形",
    candidateLength: `${formatMetric(isReference ? length : candidate.length_mm)} mm`,
    candidateWidth: candidate.type === "fusiform"
      ? `${formatMetric(isReference ? width : candidate.width_mm)} mm / ${formatMetric(
        displayedRatio,
        2,
      )}:1${isReference || isVisibilityLimited ? "（黄色参考）" : ""}`
      : "—",
    candidateTipAngle: candidate.type === "fusiform"
      ? `${formatMetric(candidate.tip_angle_deg)}° · 误差 ${formatMetric(metrics.tip_angle_error_deg)}°`
      : "—",
    isReference,
    isVisibilityLimited,
    displayedRatio,
    referenceRatio,
  };
}

function overrideAdviceLabel(override: IncisionSuggestedOverride): string {
  if (override.kind === "protective_direction") {
    return `${regionLabel(override.structure)}优先采用${directionHintLabel(override.direction_hint)}`;
  }
  return overrideLabel(override.kind);
}

export function buildGuardrailDetailsPresentation(
  guardrails: IncisionGuardrailsPresentationInput = {},
  tumorQuality: IncisionTumorQualityPresentationInput = {},
): IncisionTextPresentation {
  const hardViolations = guardrails.hard_violations || [];
  const warnings = guardrails.warnings || [];
  const overrides = guardrails.suggested_overrides || [];
  let text = !warnings.length
    ? "保护提示：未发现需要复核的规则项。"
    : `保护提示：${warnings.map((warning) => `${guardrailLabel(warning.code)}（${severityLabel(warning.severity)}）`).join("；")}`;
  if (overrides.length) text += `\n建议：${overrides.map(overrideAdviceLabel).join(" · ")}`;
  if (hardViolations.length) {
    text = `工程硬阻断：${hardViolations.map((item) => `${guardrailLabel(item.code)}（${engineeringRecoveryLabel(item.code)}）`).join("；")}\n${text}`;
  }
  if (tumorQuality.warning_count) {
    text += `\n肿物输入：${(tumorQuality.warnings || []).map((warning) => `${guardrailLabel(warning.code)}（${severityLabel(warning.severity)}）`).join("；")}`;
  }
  const classNames = [
    ...(warnings.some((warning) => warning.severity === "medium") ? ["warn"] : []),
    ...(warnings.some((warning) => warning.severity === "high") ? ["danger"] : []),
    ...(hardViolations.length ? ["danger"] : []),
  ];
  return { text, classNames: [...new Set(classNames)] };
}

export function buildDirectionSourcePresentation(input: {
  result: IncisionResultPresentationInput;
  secondaryCuesPresent: boolean;
}): IncisionTextPresentation {
  const direction = input.result.direction || {};
  const overrides = (input.result.guardrails?.suggested_overrides || [])
    .filter((override) => override.kind === "protective_direction");
  const sources = [
    directionSourceLabel(direction.source),
    `支持线 ${direction.support_count ?? 0} 条`,
    direction.angular_spread_deg != null ? `轴向离散 ${formatMetric(direction.angular_spread_deg)}°` : null,
  ].filter(Boolean);
  if (overrides.length) {
    sources.push(`敏感结构方向例外：${overrides.map((override) => `${regionLabel(override.structure)}／${directionHintLabel(override.direction_hint)}`).join("；")}`);
  }
  sources.push(input.secondaryCuesPresent ? "皱襞/边界辅助线索：只读审阅，不参与几何" : "皱襞/边界辅助线索：未参与几何");
  if (input.result.candidate?.edited) sources.push("医生人工覆盖已记录");
  return {
    text: `方向依据：${sources.join(" · ")}`,
    classNames: Number(direction.confidence) < 0.35 || overrides.length > 0 || Boolean(input.result.candidate?.edited)
      ? ["warn"]
      : [],
  };
}

export function buildWorkflowGatePresentation(
  gate: IncisionWorkflowGatePresentationInput,
): IncisionTextPresentation {
  const observedActions = gate.observed_actions || [];
  const missing = (gate.missing_actions || []).map((item) => item.label).join("、");
  const status = gate.passed ? "通过" : `未通过${missing ? `；缺 ${missing}` : ""}`;
  return {
    text: `工作流工具门控：${status} · ${observedActions.length} 个动作；完整 workflow trace 已写入 DevTools Console。`,
    title: `observed_actions=${observedActions.join(", ")}`,
    classNames: gate.passed ? [] : ["warn"],
  };
}

export function buildWorkflowComparisonPresentation(
  result: IncisionResultPresentationInput,
): IncisionTextPresentation {
  const comparison = Array.isArray(result.candidate_comparison) ? result.candidate_comparison : [];
  const audit = result.workflow_audit || {};
  if (!comparison.length) {
    return {
      text: "候选比较：浏览器 workflow 尚未生成多候选比较；可手动保存候选后生成备选。",
      classNames: ["warn"],
    };
  }
  const top = comparison
    .slice(0, 3)
    .map((item) => `#${item.rank} ${item.label || item.id} ${formatMetric(item.score, 1)}分`)
    .join("；");
  const failureSummary = formatRecoveredFailureSummary(audit);
  const failureCount = audit.tool_failure_count;
  const failures = failureCount
    ? `；恢复失败 ${failureCount} 个${failureSummary ? `（${failureSummary}）` : ""}`
    : "";
  return {
    text: `候选比较：${comparison.length} 个浏览器确定性候选 · ${top}${failures}。工程排序不是临床推荐或手术指令。`,
    title: failureSummary ? `recovered_failures=${formatRecoveredFailureSummary(audit, true)}` : "",
    classNames: failureCount ? ["warn"] : [],
  };
}

export function buildIncisionResultPresentation(
  input: BuildIncisionResultPresentationInput,
): IncisionResultPresentation {
  const { result } = input;
  const candidate = result.candidate || {};
  const metrics = candidate.metrics || {};
  const direction = result.direction || {};
  const anatomy = result.anatomy || {};
  const directionReasons = direction.confidence_reasons || [];
  const regionReasons = anatomy.confidence_reasons || [];
  const rstlDeviation = metrics.rstl_deviation_deg;
  const projectedRstlDeviation = metrics.projected_rstl_deviation_deg;
  const generationLabel = input.generationCount ? `已明确生成 ${input.generationCount} 次` : "";
  const candidateMetrics = buildCandidateMetricPresentation(result);
  return {
    candidateType: candidateMetrics.candidateType,
    candidateLength: candidateMetrics.candidateLength,
    candidateWidth: candidateMetrics.candidateWidth,
    candidateTipAngle: candidateMetrics.candidateTipAngle,
    candidateRstlDeviation: typeof rstlDeviation === "number" && Number.isFinite(rstlDeviation)
      ? `${formatMetric(rstlDeviation)}°${typeof projectedRstlDeviation === "number" && Number.isFinite(projectedRstlDeviation)
        ? ` · 照片 ${formatMetric(projectedRstlDeviation)}°`
        : ""}`
      : "—",
    directionConfidence: {
      text: `${Math.round((Number(direction.confidence) || 0) * 100)}%${directionReasons.length ? ` · ${directionReasons.map(reasonLabel).join("、")}` : ""}`,
      title: directionReasons.length ? `原始原因代码：${directionReasons.join(", ")}` : "",
    },
    region: {
      text: `${regionLabel(anatomy.region)}${regionReasons.length ? ` · ${regionReasons.map(reasonLabel).join("、")}` : ""}`,
      title: regionReasons.length ? `原始分区代码：${anatomy.region}；${regionReasons.join(", ")}` : "",
    },
    guardrailValue: { text: result.guardrails?.passed ? "通过" : "复核", color: result.guardrails?.passed ? "" : "#b45309" },
    guardrailDetails: buildGuardrailDetailsPresentation(result.guardrails, input.tumorQuality),
    directionSource: buildDirectionSourcePresentation({ result, secondaryCuesPresent: input.secondaryCuesPresent }),
    workflowGate: buildWorkflowGatePresentation(input.workflowGate),
    workflowComparison: buildWorkflowComparisonPresentation(result),
    workflowSummary: candidateMetrics.isVisibilityLimited
      ? Math.abs(candidateMetrics.displayedRatio - 3) <= 0.05
        ? `当前显示视野受限的标准参考投影；完整方案保持 3:1，当前照片可见约 ${Math.round(
          Number(metrics.photo_visible_fraction || 0) * 100,
        )}%。`
        : `当前显示视野受限的非标准比例参考；完整方案为 ${formatMetric(
          candidateMetrics.displayedRatio,
          2,
        )}:1，当前照片可见约 ${Math.round(Number(metrics.photo_visible_fraction || 0) * 100)}%。`
      : candidateMetrics.isReference
      ? `当前显示 ${formatMetric(candidateMetrics.referenceRatio, 2)}:1 黄色受限参考；原定 3:1 候选未通过可用面部区域门禁。`
      : String(result.summary || "已生成候选。"),
    nextStep: candidateMetrics.isVisibilityLimited
      ? "请补充另一视角并复核隐藏区域；完成前不能确认或进入实时叠加。"
      : candidateMetrics.isReference
      ? "该参考不满足项目原定比例；请医生结合查体在本页记录原因，不能直接确认或发送实时叠加。"
      : String(result.next_step || "医生审阅、编辑或拒绝该候选。"),
    privacyState: "浏览器本地",
    privacyAudit: `不上传原始影像；${input.privacyAudit.local_workflow_fields?.length || 0} 类抽象字段只在浏览器确定性 workflow 内处理，不配置或调用远程模型。${input.privacyAudit.secondary_cues_present ? " 辅助线索仅随审阅导出，不参与几何。" : ""}`,
    stageStatus: generationLabel,
  };
}
