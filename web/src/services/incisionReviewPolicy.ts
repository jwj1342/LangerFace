import { workflowTraceGate } from "./incisionWorkflowTools.ts";

type AnyRecord = Record<string, any>;

export function summarizeGuardrails(guardrails: AnyRecord = {}) {
  const warnings = Array.isArray(guardrails.warnings) ? guardrails.warnings : [];
  const high = warnings.filter((warning: AnyRecord) => warning.severity === "high");
  const medium = warnings.filter((warning: AnyRecord) => warning.severity === "medium");
  return {
    passed: Boolean(guardrails.passed),
    high_count: high.length,
    medium_count: medium.length,
    high_codes: high.map((warning: AnyRecord) => warning.code),
    medium_codes: medium.map((warning: AnyRecord) => warning.code),
    warnings: warnings.map((warning: AnyRecord) => ({
      code: warning.code,
      severity: warning.severity,
      message: warning.message || "",
    })),
    suggested_overrides: guardrails.suggested_overrides || [],
  };
}

export function assessReviewReadiness({
  status,
  result,
  reviewer,
  notes,
}: {
  status: string;
  result: AnyRecord | null | undefined;
  reviewer: string;
  notes: string;
}) {
  if (!result) return { ok: false, message: "没有可审阅的候选" };
  if (status !== "approved_for_discussion") return { ok: true, message: "" };

  const traceGate = workflowTraceGate(result);
  if (!traceGate.passed) {
    return { ok: false, message: "工作流工具 trace 未通过门控；缺少必要工具动作或顺序异常，不能确认候选。" };
  }
  if (!reviewer.trim()) return { ok: false, message: "确认候选前请填写审阅人。" };
  if (summarizeGuardrails(result.guardrails).high_count > 0 && !notes.trim()) {
    return { ok: false, message: "当前候选有高风险保护提示；确认前请填写审阅备注或覆盖原因。" };
  }
  return { ok: true, message: "" };
}

export function reviewForCandidateRecord({
  review,
  result,
  forceDraft = false,
}: {
  review: AnyRecord;
  result: AnyRecord | null | undefined;
  forceDraft?: boolean;
}) {
  const readiness = assessReviewReadiness({
    status: review.status || "pending_clinician_confirmation",
    result,
    reviewer: String(review.reviewer || ""),
    notes: String(review.notes || ""),
  });
  if (!forceDraft && readiness.ok) return { review, readiness, downgraded: false };
  return {
    review: {
      ...review,
      status: "pending_clinician_confirmation",
      reviewed_at: null,
    },
    readiness,
    downgraded: review.status !== "pending_clinician_confirmation",
  };
}

export function buildReviewGate({
  review,
  result,
  topologyId,
  topologyVersion,
}: {
  review: AnyRecord;
  result: AnyRecord;
  topologyId?: string | null;
  topologyVersion?: string | null;
}) {
  const summary = summarizeGuardrails(result.guardrails);
  const traceGate = workflowTraceGate(result);
  const reviewerRequired = review.status === "approved_for_discussion";
  const notesRequired = reviewerRequired && summary.high_count > 0;
  const reviewerPresent = Boolean(review.reviewer);
  const notesPresent = Boolean(review.notes);
  const approvalReady = review.status === "approved_for_discussion"
    && traceGate.passed
    && (!reviewerRequired || reviewerPresent)
    && (!notesRequired || notesPresent);
  const liveOverlayReady = approvalReady;
  return {
    reviewer_required: reviewerRequired,
    reviewer_present: reviewerPresent,
    notes_required_for_high_guardrails: notesRequired,
    notes_present: notesPresent,
    high_guardrail_codes: summary.high_codes,
    workflow_trace_gate_passed: traceGate.passed,
    workflow_trace_gate_missing: traceGate.missing_actions.map((item: AnyRecord) => item.key),
    approval_ready: approvalReady,
    live_overlay_ready: liveOverlayReady,
    live_overlay_blocked_reason: null,
    active_topology_id: topologyId || null,
    active_topology_version: topologyVersion || null,
    reason: liveOverlayReady
      ? "approved_candidate_ready_for_research_overlay"
      : traceGate.passed
        ? "pending_clinician_confirmation_or_missing_required_review_context"
        : "workflow_trace_gate_failed",
  };
}
