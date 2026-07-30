import {
  directionSourceLabel,
  reviewStatusLabel,
} from "./incisionClinicalCopy.ts";
import { summarizeGuardrails } from "./incisionReviewPolicy.ts";
import {
  compareCandidateRecords,
  workflowTraceGate,
} from "./incisionWorkflowTools.ts";

type AnyRecord = Record<string, any>;

export interface CandidateEditSessionOptions {
  undoAvailable: boolean;
  redoAvailable: boolean;
}

export interface IncisionReviewRecordInput {
  result: AnyRecord;
  label?: string;
  createdAt?: string;
  id?: string;
  review: AnyRecord;
  reviewGate: AnyRecord;
  tumorQuality: AnyRecord;
  tumorBoundarySummary: AnyRecord;
  headAsset: AnyRecord | null;
  secondaryCues: AnyRecord;
  candidateEditSession: AnyRecord;
  sensitiveStructureInspection: AnyRecord | null;
  privacyAudit: AnyRecord;
}

export interface IncisionReviewReportArtifact {
  filename: string;
  text: string;
  mimeType: "text/markdown";
}

function formatNumber(value: unknown, digits = 1): string {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

export function buildCandidateEditSession(
  result: AnyRecord,
  options: CandidateEditSessionOptions,
): AnyRecord {
  const provenance = result?.candidate?.provenance || {};
  const history = Array.isArray(provenance.edit_history) ? provenance.edit_history : [];
  return {
    schema_version: "candidate-edit-session/v0.1",
    candidate_version: Number(provenance.candidate_version || 1),
    edit_count: history.length,
    current_edit_id: provenance.clinician_edit?.edit_id || null,
    undo_available: options.undoAvailable,
    redo_available: options.redoAvailable,
    source: "web/incision_workflow",
    history: history.map((entry: AnyRecord) => ({
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

export function findSensitiveStructureInspection(
  result: AnyRecord,
): AnyRecord | null {
  if (result?.sensitive_structure_inspection) {
    return result.sensitive_structure_inspection;
  }
  const trace = Array.isArray(result?.trace) ? result.trace : [];
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const step = trace[index];
    if (step?.action === "inspect_sensitive_structures" && step.observation) {
      return step.observation;
    }
  }
  return null;
}

export function buildIncisionReviewRecord(
  input: IncisionReviewRecordInput,
): AnyRecord {
  const {
    result,
    review,
    reviewGate,
    tumorQuality,
    tumorBoundarySummary,
    headAsset,
    secondaryCues,
    candidateEditSession,
    sensitiveStructureInspection,
    privacyAudit,
  } = input;
  const createdAt = input.createdAt || new Date().toISOString();
  const actor = review.reviewer || result.tumor?.author || "unknown";
  const traceGate = workflowTraceGate(result);
  return {
    schema_version: "incision-review-record/v0.3",
    id: input.id || `candidate_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    label: input.label || "候选",
    created_at: createdAt,
    tumor: result.tumor,
    tumor_quality: tumorQuality,
    tumor_boundary_summary: tumorBoundarySummary,
    head_asset: headAsset,
    secondary_cues: secondaryCues,
    anatomy: result.anatomy,
    sensitive_structure_inspection: sensitiveStructureInspection,
    direction: result.direction,
    candidate: result.candidate,
    original_candidate: result.original_candidate || result.candidate,
    candidate_edit_session: candidateEditSession,
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
    privacy_audit: privacyAudit,
    review_status: review.status,
    review,
    review_gate: reviewGate,
    guardrail_summary: summarizeGuardrails(result.guardrails),
    audit_events: [
      {
        event: "candidate_saved",
        at: createdAt,
        actor,
        status: review.status,
        approval_ready: reviewGate.approval_ready,
        live_overlay_ready: reviewGate.live_overlay_ready,
        workflow_trace_gate_passed: traceGate.passed,
        active_topology_id: headAsset?.topologyId || null,
        active_topology_version: headAsset?.topologyVersion || null,
      },
      ...(review.status === "pending_clinician_confirmation"
        ? []
        : [{
          event: "clinician_review_recorded",
          at: createdAt,
          actor,
          status: review.status,
          notes_present: Boolean(review.notes),
          high_guardrail_codes: reviewGate.high_guardrail_codes,
        }]),
    ],
  };
}

export function formatRecoveredFailureSummary(
  audit: AnyRecord,
  includeError = false,
): string {
  const failures = Array.isArray(audit?.recovered_failures)
    ? audit.recovered_failures
    : [];
  return failures.map((failure: AnyRecord) => {
    const variant = failure.variant
      || (failure.angle_offset_deg != null
        ? `${formatNumber(failure.angle_offset_deg)}°`
        : "候选变体");
    const tool = failure.tool || "确定性工具";
    const recovery = failure.recovery === "skipped_failed_variant_and_kept_other_candidates"
      ? "已跳过失败变体并继续比较"
      : failure.recovery || "已记录恢复动作";
    const error = includeError && failure.error
      ? `；错误 ${String(failure.error).slice(0, 80)}`
      : "";
    return `${variant}/${tool}：${recovery}${error}`;
  }).join("；");
}

function reviewRecordMarkdown(record: AnyRecord, index: number): string {
  const metrics = record.candidate.metrics || {};
  const boundary = record.tumor_boundary_summary || {};
  const warningLines = (record.guardrails.warnings || [])
    .map((warning: AnyRecord) => `  - ${warning.code} [${warning.severity}] ${warning.message || ""}`)
    .join("\n") || "  - 无";
  const overrideLines = (record.guardrails.suggested_overrides || [])
    .map((override: AnyRecord) => `  - ${override.kind}: ${override.reason || ""}`)
    .join("\n") || "  - 无";
  const recoveredFailureDetails = formatRecoveredFailureSummary(record.workflow_audit, true);
  return [
    `## 候选 ${index + 1}: ${record.label}`,
    `- 类型：${record.candidate.type === "linear" ? "皮下线性切口" : "皮表梭形切口"}`,
    `- 候选版本：v${record.candidate.provenance?.candidate_version || 1}；编辑记录 ${(record.candidate.provenance?.edit_history || []).length} 条`,
    record.head_asset
      ? `- 头模资产：${record.head_asset.label}；topology=${record.head_asset.topologyId}@${record.head_asset.topologyVersion}；顶点 ${record.head_asset.vertexCount} / 三角面 ${record.head_asset.triangleCount}；状态 ${record.head_asset.statusLabel}`
      : null,
    (record.head_asset?.warnings || []).length
      ? `- 头模资产提示：${record.head_asset.warnings.join("；")}`
      : null,
    record.candidate_edit_session?.edit_count
      ? `- 编辑时间线：${record.candidate_edit_session.edit_count} 步；当前 edit_id ${record.candidate_edit_session.current_edit_id || "—"}`
      : null,
    `- 肿物：${record.tumor.kind}，直径 ${formatNumber(record.tumor.diameter_mm)} mm，切缘 ${formatNumber(record.tumor.margin_mm)} mm`,
    (record.tumor_quality?.warnings || []).length
      ? `- 肿物输入提示：${record.tumor_quality.warnings.map((warning: AnyRecord) => `${warning.code}(${warning.severity})`).join("；")}`
      : null,
    record.secondary_cues?.present
      ? `- 辅助线索：${record.secondary_cues.confidence_label}；人工确认 ${record.secondary_cues.manual_confirmed ? "是" : "否"}；不参与几何 ${record.secondary_cues.used_for_geometry === false ? "是" : "否"}`
      : null,
    boundary.boundary_used
      ? `- 肿物边界摘要：点数 ${boundary.point_count ?? "—"}；长轴 ${formatNumber(boundary.axis_diameter_mm)} mm；短轴 ${formatNumber(boundary.perp_diameter_mm)} mm；面积 ${formatNumber(boundary.area_mm2)} mm²；自交 ${boundary.self_intersection ? "是" : "否"}；中心偏移 ${formatNumber(boundary.center_shift_mm)} mm`
      : null,
    `- 面部分区：${record.anatomy.region} / ${record.anatomy.subunit}`,
    (record.anatomy.confidence_reasons || []).length
      ? `- 分区置信原因：${record.anatomy.confidence_reasons.join(", ")}`
      : null,
    `- RSTL 来源：${directionSourceLabel(record.direction.source)}；support ${record.direction.support_count ?? 0}；轴向离散 ${formatNumber(record.direction.angular_spread_deg)}°`,
    `- RSTL 方向置信度：${Math.round((record.direction.confidence || 0) * 100)}%`,
    (record.direction.confidence_reasons || []).length
      ? `- RSTL 低置信原因：${record.direction.confidence_reasons.join(", ")}`
      : null,
    record.sensitive_structure_inspection
      ? `- 敏感结构检查：中心距 ${formatNumber(record.sensitive_structure_inspection.center_free_margin_distance_mm)} mm / 阈值 ${formatNumber(record.sensitive_structure_inspection.center_free_margin_threshold_mm)} mm；候选几何距 ${formatNumber(record.sensitive_structure_inspection.candidate_free_margin_distance_mm)} mm / 阈值 ${formatNumber(record.sensitive_structure_inspection.candidate_free_margin_threshold_mm)} mm；warning ${record.sensitive_structure_inspection.warning_count || 0} 个；保护方向 ${record.sensitive_structure_inspection.protective_direction?.direction_hint || "无"}`
      : null,
    `- 工作流工具门控：passed=${Boolean(record.workflow_trace_gate?.passed)}；order_ok=${Boolean(record.workflow_trace_gate?.order_ok)}；missing=${(record.workflow_trace_gate?.missing_actions || []).map((item: AnyRecord) => item.label || item.key).join(", ") || "无"}`,
    record.workflow_plan_audit
      ? `- 工作流计划：passed=${Boolean(record.workflow_plan_audit.passed)}；步骤 ${record.workflow_plan_audit.completed_step_count || 0}/${record.workflow_plan_audit.step_count || 0}；失败 ${record.workflow_plan_audit.failed_step_count || 0}`
      : null,
    record.workflow_execution_events
      ? `- 工作流执行事件：passed=${Boolean(record.workflow_execution_events.passed)}；事件 ${record.workflow_execution_events.event_count || 0} 条；工具事件 ${record.workflow_execution_events.tool_event_count || 0} 条；重试 ${record.workflow_execution_events.retry_event_count || 0}；恢复 ${record.workflow_execution_events.recovery_event_count || 0}`
      : null,
    record.workflow_audit
      ? `- 浏览器 workflow 审计：候选 ${record.workflow_audit.candidate_count || 0} 个；比较 ${record.workflow_audit.comparison_ready ? "已生成" : "未生成"}；恢复失败 ${record.workflow_audit.tool_failure_count || 0} 个`
      : null,
    recoveredFailureDetails ? `- 工作流恢复详情：${recoveredFailureDetails}` : null,
    (record.candidate_comparison || []).length
      ? `- 浏览器候选比较：${record.candidate_comparison.map((candidate: AnyRecord) => `#${candidate.rank} ${candidate.label || candidate.id} ${formatNumber(candidate.score, 1)}分`).join("；")}（不是临床推荐或手术指令）`
      : null,
    `- 候选长度：${formatNumber(record.candidate.length_mm)} mm`,
    record.candidate.type === "fusiform"
      ? `- 梭形宽度 / 长宽比：${formatNumber(record.candidate.width_mm)} mm / ${formatNumber(record.candidate.metrics?.length_to_width_ratio, 2)}:1`
      : null,
    record.candidate.type === "fusiform"
      ? `- 尖端角：${formatNumber(record.candidate.tip_angle_deg)}°；目标 ${formatNumber(record.candidate.metrics?.tip_angle_target_deg)}°；误差 ${formatNumber(record.candidate.metrics?.tip_angle_error_deg)}°`
      : null,
    record.candidate.type === "fusiform"
      ? `- 边界质量：点数 ${metrics.boundary_point_count ?? "—"}；面积 ${formatNumber(metrics.boundary_area_mm2)} mm²；自交 ${metrics.boundary_self_intersection ? "是" : "否"}；中心偏移 ${formatNumber(metrics.boundary_center_shift_mm)} mm`
      : null,
    record.candidate.type === "fusiform"
      ? `- 梭形包络：outline 面积 ${formatNumber(metrics.outline_area_mm2)} mm²；单峰收窄 ${metrics.outline_half_width_monotone === false ? "否" : "是"}；对称误差 ${formatNumber(metrics.outline_symmetry_max_error_mm)} mm；自交 ${metrics.outline_self_intersection ? "是" : "否"}；边界余量 ${formatNumber(metrics.boundary_envelope_min_margin_mm)} mm；出界点 ${metrics.boundary_envelope_outside_count ?? 0}`
      : null,
    metrics.sensitive_free_margin_min_distance_mm != null
      ? `- 最近敏感游离缘：${metrics.sensitive_free_margin_nearest || "—"}，${formatNumber(metrics.sensitive_free_margin_min_distance_mm)} mm`
      : null,
    `- Guardrails：${record.guardrails.passed ? "通过" : "需医生复核"}`,
    `- 警告：\n${warningLines}`,
    `- 建议覆盖项：\n${overrideLines}`,
    `- 审阅门槛：approval_ready=${Boolean(record.review_gate?.approval_ready)}；live_overlay_ready=${Boolean(record.review_gate?.live_overlay_ready)}；workflow_trace_gate=${Boolean(record.review_gate?.workflow_trace_gate_passed)}；high=${(record.review_gate?.high_guardrail_codes || []).join(", ") || "无"}`,
    `- 审阅状态：${reviewStatusLabel(record.review_status)}；审阅人：${record.review?.reviewer || "未填写"}`,
    `- 审阅备注：${record.review?.notes || "无"}`,
    "- 审阅边界：研究候选记录，非手术指令。",
  ].filter(Boolean).join("\n");
}

export function buildIncisionReviewReport(
  records: AnyRecord[],
  timestamp = Date.now(),
): IncisionReviewReportArtifact {
  const comparison = compareCandidateRecords(records);
  const comparisonBody = comparison.length
    ? [
      "## 候选工程排序",
      "",
      "该排序只按 guardrails、RSTL 偏角、覆盖缺口、敏感距离和几何误差比较，不是临床推荐或手术指令。",
      "",
      ...comparison.map((candidate: AnyRecord) => `- #${candidate.rank} ${candidate.label}：${formatNumber(candidate.score, 1)} 分；${candidate.reasons.join("；")}`),
      "",
    ].join("\n")
    : "";
  const body = records.map(reviewRecordMarkdown).join("\n\n");
  return {
    filename: `incision_report_${timestamp}.md`,
    text: `# 切口候选审阅草案\n\n${comparisonBody}${body}\n`,
    mimeType: "text/markdown",
  };
}
