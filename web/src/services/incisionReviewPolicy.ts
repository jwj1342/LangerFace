import { workflowTraceGate } from "./incisionWorkflowTools.ts";

type AnyRecord = Record<string, any>;

function hardViolations(result: AnyRecord | null | undefined): AnyRecord[] {
  const values = [
    result?.guardrails?.hard_violations,
    result?.candidate?.hard_violations,
    result?.hard_violations,
  ].flatMap((source) => Array.isArray(source) ? source : []);
  const seen = new Set<string>();
  return values.filter((item: AnyRecord) => {
    const key = JSON.stringify([item?.code || "unknown", item?.location || null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

  if (result?.candidate?.metrics?.photo_visibility_limited_candidate === true) {
    return {
      ok: false,
      message: "当前为视野受限参考：可保存为待确认草案；补充另一视角并复核隐藏区域后，方可确认或进入实时叠加。",
    };
  }

  if (result?.candidate?.metrics?.photo_reference_candidate === true) {
    return {
      ok: false,
      message: "当前为受限参考候选，不满足标准 3:1 梭形要求；可保存为待确认草案，但不能直接确认或发送到实时叠加。",
    };
  }

  const violations = hardViolations(result);
  if (violations.length > 0) {
    return { ok: false, message: `候选存在 ${violations.length} 项不可覆盖的工程几何错误；请修复后再确认。` };
  }

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
  const violations = hardViolations(result);
  const referenceCandidate = result?.candidate?.metrics?.photo_reference_candidate === true;
  const visibilityLimitedCandidate = result?.candidate?.metrics?.photo_visibility_limited_candidate === true;
  const restrictedReferenceCandidate = referenceCandidate || visibilityLimitedCandidate;
  const approvalReady = review.status === "approved_for_discussion"
    && !restrictedReferenceCandidate
    && violations.length === 0
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
    hard_violation_count: violations.length,
    hard_violation_codes: violations.map((item: AnyRecord) => item.code).filter(Boolean),
    workflow_trace_gate_passed: traceGate.passed,
    workflow_trace_gate_missing: traceGate.missing_actions.map((item: AnyRecord) => item.key),
    approval_ready: approvalReady,
    live_overlay_ready: liveOverlayReady,
    live_overlay_blocked_reason: visibilityLimitedCandidate
      ? "visibility_limited_reference_candidate"
      : referenceCandidate
        ? "nonstandard_reference_candidate"
      : violations.length > 0
        ? "engineering_hard_violation"
        : null,
    active_topology_id: topologyId || null,
    active_topology_version: topologyVersion || null,
    reason: liveOverlayReady
      ? "approved_candidate_ready_for_research_overlay"
      : visibilityLimitedCandidate
        ? "visibility_limited_reference_candidate_requires_additional_view"
        : referenceCandidate
          ? "nonstandard_reference_candidate_requires_clinician_workflow"
        : violations.length > 0
          ? "engineering_hard_violation"
          : traceGate.passed
            ? "pending_clinician_confirmation_or_missing_required_review_context"
            : "workflow_trace_gate_failed",
  };
}
