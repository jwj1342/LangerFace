import {
  directionHintLabel,
  directionSourceLabel,
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
  const warnings = guardrails.warnings || [];
  const overrides = guardrails.suggested_overrides || [];
  let text = !warnings.length
    ? "保护提示：未发现需要复核的规则项。"
    : `保护提示：${warnings.map((warning) => `${guardrailLabel(warning.code)}（${severityLabel(warning.severity)}）`).join("；")}`;
  if (overrides.length) text += `\n建议：${overrides.map(overrideAdviceLabel).join(" · ")}`;
  if (tumorQuality.warning_count) {
    text += `\n肿物输入：${(tumorQuality.warnings || []).map((warning) => `${guardrailLabel(warning.code)}（${severityLabel(warning.severity)}）`).join("；")}`;
  }
  const classNames = [
    ...(warnings.some((warning) => warning.severity === "medium") ? ["warn"] : []),
    ...(warnings.some((warning) => warning.severity === "high") ? ["danger"] : []),
  ];
  return { text, classNames };
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
  const edited = candidate.edited ? " · 已记录医生调整" : "";
  const headLabel = input.headStatusLabel ? ` · ${input.headStatusLabel}` : "";
  const generationLabel = input.generationCount ? ` · 已明确生成 ${input.generationCount} 次` : " · 自动预览";

  return {
    candidateType: candidate.type === "linear" ? "线性" : "梭形",
    candidateLength: `${formatMetric(candidate.length_mm)} mm`,
    candidateWidth: candidate.type === "fusiform"
      ? `${formatMetric(candidate.width_mm)} mm / ${formatMetric(metrics.length_to_width_ratio, 2)}:1`
      : "—",
    candidateTipAngle: candidate.type === "fusiform"
      ? `${formatMetric(candidate.tip_angle_deg)}° · 误差 ${formatMetric(metrics.tip_angle_error_deg)}°`
      : "—",
    candidateRstlDeviation: typeof rstlDeviation === "number" && Number.isFinite(rstlDeviation)
      ? `${formatMetric(rstlDeviation)}°`
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
    workflowSummary: String(result.summary || "已生成候选。"),
    nextStep: String(result.next_step || "医生审阅、编辑或拒绝该候选。"),
    privacyState: "浏览器本地",
    privacyAudit: `不上传原始影像；${input.privacyAudit.local_workflow_fields?.length || 0} 类抽象字段只在浏览器确定性 workflow 内处理，不配置或调用远程模型。${input.privacyAudit.secondary_cues_present ? " 辅助线索仅随审阅导出，不参与几何。" : ""}`,
    stageStatus: `浏览器确定性 workflow 已更新候选${generationLabel}${edited}${headLabel}`,
  };
}
