// @ts-nocheck
import {
  AGENT_REACT_PLAN_STEP_DEFINITIONS,
  AGENT_TRACE_GATE_REQUIRED,
  DEFAULT_RULES,
  TOOL_SCHEMAS,
} from "./incisionToolRules.ts";
import {
  add,
  annotateCandidateSensitiveDistances,
  classifyRegion,
  editRecordIsActive,
  mul,
  norm,
  queryDirection,
  sub,
  unitsPerMmFromVertices,
  versionedEditProvenance,
} from "./incisionToolCore.ts";
import {
  boundaryProfile,
  evaluateGuardrails,
  freeMarginDistanceThresholdMm,
  fusiformProfile,
  generateFusiformIncision,
  generateLinearIncision,
  inspectSensitiveStructures,
  normalizeTumorInput,
  outlineQualityMetrics,
  summarizeTumorBoundary,
  summarizeTumorInputQuality,
  tangentPerp,
  validateTumor,
} from "./incisionCandidateTools.ts";

export function rotateInPlane(axis, normal, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  const p = tangentPerp(axis, normal);
  return norm(add(mul(axis, Math.cos(a)), mul(p, Math.sin(a))));
}

function clonePlan(plan) {
  return JSON.parse(JSON.stringify(plan));
}

function editedTraceStep(edit, candidate, guardrails) {
  return {
    summary: "医生调整候选参数，系统重新计算几何并复跑 guardrails。",
    action: "clinician_edit_candidate",
    input: edit,
    observation: {
      candidate: shortCandidate(candidate),
      guardrails,
    },
  };
}

function buildEditedFusiform(base, center, axis, normal, unitsPerMm, edit, tumorInput = null) {
  const tumor = tumorInput ? validateTumor(tumorInput) : null;
  const widthAxis = tangentPerp(axis, normal);
  const lengthMm = Math.max(1, Number(base.length_mm || 1) * Number(edit.length_scale || 1));
  const widthMm = Math.max(1, Number(base.width_mm || 1) * Number(edit.width_scale || 1));
  const boundary = tumor ? boundaryProfile(tumor, axis, widthAxis, unitsPerMm) : null;
  const tumorDiameterMm = Number(tumor?.diameter_mm ?? base.metrics?.diameter_mm ?? 0);
  const tumorMarginMm = Number(tumor?.margin_mm ?? base.metrics?.margin_mm ?? 0);
  const lesionAxisMm = Math.max(tumorDiameterMm, Number(boundary?.axis_diameter_mm ?? 0));
  const axisCoverageRequiredMm = boundary
    ? lesionAxisMm + 2 * tumorMarginMm
    : Number(base.metrics?.axis_coverage_required_mm || 0);
  const axisCoverageDeficitMm = axisCoverageRequiredMm > 0 ? Math.max(0, axisCoverageRequiredMm - lengthMm) : 0;
  const halfL = lengthMm * unitsPerMm * 0.5;
  const halfW = widthMm * unitsPerMm * 0.5;
  const samples = Math.max(12, Math.round((base.outline?.length || 58) / 2));
  const targetTipAngle = base.metrics?.tip_angle_target_deg || base.tip_angle_deg || 30;
  const profile = fusiformProfile(center, axis, widthAxis, halfL, halfW, samples, targetTipAngle);
  const { upper, lower } = profile;
  const outline = upper.concat(lower.slice(1, -1).reverse());
  const outlineMetrics = outlineQualityMetrics({
    upper,
    lower,
    outline,
    tumor: tumor || { boundary: [] },
    center,
    axis,
    perp: widthAxis,
    unitsPerMm,
    boundaryUsed: Boolean(boundary),
  });
  return {
    ...base,
    axis,
    width_axis: widthAxis,
    center,
    endpoints: [sub(center, mul(axis, halfL)), add(center, mul(axis, halfL))],
    outline,
    polyline: outline.concat([outline[0]]),
    length_mm: lengthMm,
    width_mm: widthMm,
    length_units: lengthMm * unitsPerMm,
    width_units: widthMm * unitsPerMm,
    tip_angle_deg: profile.metrics.tip_angle_estimated_deg,
    metrics: {
      ...(base.metrics || {}),
      rstl_deviation_deg: Math.abs(Number(edit.angle_offset_deg || 0)),
      length_to_width_ratio: lengthMm / widthMm,
      ...profile.metrics,
      axis_coverage_required_mm: axisCoverageRequiredMm,
      axis_coverage_deficit_mm: axisCoverageDeficitMm,
      boundary_used: Boolean(boundary),
      boundary_point_count: boundary?.point_count ?? base.metrics?.boundary_point_count ?? 0,
      boundary_axis_diameter_mm: boundary?.axis_diameter_mm ?? base.metrics?.boundary_axis_diameter_mm ?? null,
      boundary_perp_diameter_mm: boundary?.perp_diameter_mm ?? base.metrics?.boundary_perp_diameter_mm ?? null,
      boundary_area_mm2: boundary?.area_mm2 ?? base.metrics?.boundary_area_mm2 ?? null,
      boundary_area_ratio_to_diameter_disk: boundary?.area_ratio_to_diameter_disk ??
        base.metrics?.boundary_area_ratio_to_diameter_disk ?? null,
      boundary_self_intersection: Boolean(boundary?.self_intersection ?? base.metrics?.boundary_self_intersection),
      boundary_center_shift_mm: boundary?.center_shift_mm ?? base.metrics?.boundary_center_shift_mm ?? null,
      ...outlineMetrics,
    },
  };
}

export function applyCandidateEdit(plan, edit = {}, normal = [0, 0, 1], unitsPerMm = 1, verts = null) {
  const out = clonePlan(plan);
  const base = clonePlan(plan.original_candidate || plan.candidate);
  const axis0 = norm(base.axis || [1, 0, 0]);
  const perp0 = tangentPerp(axis0, normal);
  const axis = rotateInPlane(axis0, normal, Number(edit.angle_offset_deg || 0));
  const center = add(
    add(base.center || plan.tumor.center, mul(axis0, Number(edit.shift_along_mm || 0) * unitsPerMm)),
    mul(perp0, Number(edit.shift_perp_mm || 0) * unitsPerMm),
  );
  const editRecord = {
    kind: "clinician_adjustment",
    angle_offset_deg: Number(edit.angle_offset_deg || 0),
    length_scale: Number(edit.length_scale || 1),
    width_scale: Number(edit.width_scale || 1),
    shift_along_mm: Number(edit.shift_along_mm || 0),
    shift_perp_mm: Number(edit.shift_perp_mm || 0),
    reason: String(edit.reason || ""),
    source: "web/incision_agent",
  };
  const sessionHistory = Array.isArray(edit.session_history) ? edit.session_history : [];
  const sessionHasEdits = sessionHistory.some((entry) => editRecordIsActive(entry) || entry.interaction === "control_change");
  if (!editRecordIsActive(editRecord) && !sessionHasEdits) return out;

  let candidate;
  if (base.type === "linear") {
    const lengthMm = Math.max(1, Number(base.length_mm || 1) * editRecord.length_scale);
    const diameterCoverageRequiredMm = Number(base.metrics?.diameter_coverage_required_mm || plan.tumor?.diameter_mm || 0);
    const half = mul(axis, lengthMm * unitsPerMm * 0.5);
    candidate = {
      ...base,
      center,
      axis,
      endpoints: [sub(center, half), add(center, half)],
      polyline: [sub(center, half), add(center, half)],
      length_mm: lengthMm,
      length_units: lengthMm * unitsPerMm,
      metrics: {
        ...(base.metrics || {}),
        rstl_deviation_deg: Math.abs(editRecord.angle_offset_deg),
        length_multiplier: lengthMm / Math.max(Number(plan.tumor?.diameter_mm || base.metrics?.diameter_mm || 1), 1),
        diameter_coverage_deficit_mm: diameterCoverageRequiredMm > 0
          ? Math.max(0, diameterCoverageRequiredMm - lengthMm)
          : 0,
      },
    };
  } else {
    candidate = buildEditedFusiform(base, center, axis, normal, unitsPerMm, editRecord, plan.tumor);
  }

  if (verts) annotateCandidateSensitiveDistances(candidate, verts);
  candidate.provenance = versionedEditProvenance(base, editRecord, sessionHistory);
  candidate.edited = true;

  out.original_candidate = plan.original_candidate || plan.candidate;
  out.candidate = candidate;
  out.guardrails = evaluateGuardrails(candidate, out.anatomy);
  out.trace = (out.trace || []).filter((step) => step.action !== "clinician_edit_candidate");
  if (
    editRecord.angle_offset_deg !== 0 ||
    editRecord.length_scale !== 1 ||
    editRecord.width_scale !== 1 ||
    editRecord.shift_along_mm !== 0 ||
    editRecord.shift_perp_mm !== 0 ||
    editRecord.reason
  ) {
    out.trace.push(editedTraceStep(editRecord, candidate, out.guardrails));
    out.llm = {
      ...(out.llm || {}),
      summary: "已应用医生调整并重新计算候选几何；请复核 guardrails 与覆盖原因。",
      next_step: "医生确认调整是否进入审阅记录。",
    };
  }
  return attachWorkflowAudit(out);
}

function shortCandidate(candidate) {
  const keys = ["id", "type", "tumor_kind", "center", "axis", "endpoints", "length_mm", "width_mm", "tip_angle_deg", "direction_confidence", "metrics"];
  return Object.fromEntries(keys.filter((k) => k in candidate).map((k) => [k, candidate[k]]));
}

function fallbackSummary(tumor, candidate, guardrails) {
  const kind = candidate.type === "linear" ? "皮下线性切口" : "皮表梭形切口";
  const status = guardrails.passed ? "guardrails 通过" : "guardrails 需要医生复核";
  return `已生成${kind}候选：长轴沿局部 RSTL，病灶直径 ${tumor.diameter_mm.toFixed(1)} mm，${status}。`;
}

export function previewIncisionOnFace(tumor, candidate, anatomy, guardrails, variant = "baseline") {
  const candidatePoints = candidate.polyline || candidate.outline || candidate.endpoints || [];
  const pointCount = Array.isArray(candidatePoints) ? candidatePoints.length : 0;
  const boundaryCount = Array.isArray(tumor.boundary) ? tumor.boundary.length : 0;
  const renderable = pointCount >= 2 && Array.isArray(tumor.center) && tumor.center.length >= 3;
  return {
    schema_version: "incision-preview-observation/v0.1",
    renderable,
    reason: renderable ? "candidate_geometry_renderable" : "candidate_geometry_not_renderable",
    preview_space: "standard_face_geometry",
    variant,
    candidate_id: candidate.id || "unknown",
    candidate_type: candidate.type || "unknown",
    face_region: anatomy.region || null,
    subunit: anatomy.subunit || null,
    candidate_point_count: pointCount,
    tumor_center_present: true,
    tumor_boundary_point_count: boundaryCount,
    guardrails_passed: guardrails.passed === true,
    clinician_review_required: true,
    raw_image_sent: false,
    raw_video_sent: false,
    exported_raw_pixels: false,
    clinical_boundary: "预览记录只说明确定性几何可渲染，医生确认前不能作为手术指令。",
  };
}

export function traceStep(action, input, observation, summary) {
  return { summary, action, input, observation };
}

function traceActions(trace = []) {
  return (trace || []).map((step) => String(step?.action || "")).filter(Boolean);
}

function indexesForActions(actions = [], accepted = new Set()) {
  return actions
    .map((action, index) => (accepted.has(action) ? index : -1))
    .filter((index) => index >= 0);
}

export function agentTraceGate(resultOrTrace = {}, candidateArg = null, mode = "single_turn_react_with_deterministic_tools") {
  const trace = Array.isArray(resultOrTrace) ? resultOrTrace : resultOrTrace?.trace || [];
  const candidate = candidateArg || (Array.isArray(resultOrTrace) ? null : resultOrTrace?.candidate);
  const actions = traceActions(trace);
  const required = AGENT_TRACE_GATE_REQUIRED.map((req) => {
    const indexes = req.actions
      .map((action) => actions.indexOf(action))
      .filter((index) => index >= 0);
    return {
      key: req.key,
      label: req.label,
      actions: req.actions,
      observed: indexes.length > 0,
      first_index: indexes.length ? Math.min(...indexes) : null,
    };
  });
  const missing = required.filter((req) => !req.observed);
  const presentIndexes = required
    .filter((req) => req.first_index != null)
    .map((req) => Number(req.first_index));
  const orderOk = presentIndexes.every((idx, i) => i === 0 || idx >= presentIndexes[i - 1]);
  const geometryPresent = Array.isArray(candidate?.polyline) && candidate.polyline.length >= 2;
  return {
    schema_version: "agent-trace-gate/v0.1",
    passed: missing.length === 0 && orderOk && geometryPresent,
    mode,
    observed_actions: actions,
    required_actions: required.map((req) => ({ key: req.key, label: req.label, actions: req.actions })),
    missing_actions: missing.map((req) => ({ key: req.key, label: req.label, actions: req.actions })),
    order_ok: orderOk,
    deterministic_geometry_present: geometryPresent,
    boundary: "LLM 只能在确定性工具完成敏感结构、几何、guardrails 和预览观察后做摘要解释；不能计算或覆盖切口几何。",
  };
}

export function agentReactPlan(
  resultOrTrace = {},
  {
    candidateCount = 0,
    comparisonReady = false,
    traceGate = null,
    retriedFailures = [],
    recoveredFailures = [],
    mode = "single_turn_react_multi_candidate_with_deterministic_tools",
  } = {},
) {
  const trace = Array.isArray(resultOrTrace) ? resultOrTrace : resultOrTrace?.trace || [];
  const actions = traceActions(trace);
  const gate = traceGate || agentTraceGate(resultOrTrace);
  const steps = AGENT_REACT_PLAN_STEP_DEFINITIONS.map((definition) => {
    const requiredGroups = definition.required_action_groups.map((group) => [...group]);
    const optionalActions = [...(definition.optional_actions || [])];
    const requiredActions = new Set(requiredGroups.flat());
    const accepted = new Set([...requiredActions, ...optionalActions]);
    const traceIndexes = indexesForActions(actions, accepted);
    const missingGroups = requiredGroups.filter((group) => !indexesForActions(actions, new Set(group)).length);
    let status = missingGroups.length ? "failed" : "completed";
    const issues = missingGroups.map((group) => `missing any of: ${group.join(", ")}`);
    if (definition.id === "compare_direction_variants") {
      if (recoveredFailures.length) {
        status = missingGroups.length ? "failed_with_recovery" : "completed_with_recovery";
        issues.push("one or more deterministic variants were skipped after bounded retry");
      } else if (retriedFailures.length) {
        status = missingGroups.length ? "failed_after_retry" : "completed_after_retry";
        issues.push("one or more deterministic variants required bounded retry");
      }
      if (!comparisonReady) {
        status = "failed";
        issues.push("candidate comparison missing");
      }
      if (candidateCount <= 0) {
        status = "failed";
        issues.push("no candidate alternatives available for review");
      }
    }
    return {
      id: definition.id,
      label: definition.label,
      intent: definition.intent,
      required_action_groups: requiredGroups,
      optional_actions: optionalActions,
      observed_actions: traceIndexes.map((index) => actions[index]),
      trace_indexes: traceIndexes,
      status,
      issues,
    };
  });
  const failedSteps = steps.filter((step) => String(step.status).startsWith("failed"));
  const passed = Boolean(gate.passed) && comparisonReady && candidateCount > 0 && failedSteps.length === 0;
  return {
    schema_version: "agent-react-plan/v0.1",
    mode,
    passed,
    trace_gate_passed: Boolean(gate.passed),
    candidate_count: Number(candidateCount),
    comparison_ready: Boolean(comparisonReady),
    step_count: steps.length,
    completed_step_count: steps.filter((step) => String(step.status).startsWith("completed")).length,
    failed_step_count: failedSteps.length,
    retry_count: retriedFailures.length,
    recovery_count: recoveredFailures.length,
    steps,
    clinical_boundary: "该 ReAct 计划只是确定性工具 trace 的审计脚手架，不是自主临床推理或手术指令。",
  };
}

function reactPlanStepIdsByTraceIndex(reactPlan = {}) {
  const byIndex = new Map();
  for (const step of reactPlan.steps || []) {
    if (!step?.id) continue;
    for (const rawIndex of step.trace_indexes || []) {
      const index = Number(rawIndex);
      if (!Number.isInteger(index)) continue;
      byIndex.set(index, [...(byIndex.get(index) || []), String(step.id)]);
    }
  }
  return byIndex;
}

export function agentExecutionEvents(
  resultOrTrace = {},
  {
    traceGate = null,
    reactPlan = null,
    mode = "single_turn_react_multi_candidate_with_deterministic_tools",
  } = {},
) {
  const trace = Array.isArray(resultOrTrace) ? resultOrTrace : resultOrTrace?.trace || [];
  const gate = traceGate || agentTraceGate(resultOrTrace);
  const plan = reactPlan || agentReactPlan(resultOrTrace, { traceGate: gate });
  const stepIdsByTraceIndex = reactPlanStepIdsByTraceIndex(plan);
  const events = [{
    index: 0,
    event: "execution_started",
    status: "started",
    message: "浏览器确定性 workflow 已启动；几何和 guardrails 由本地工具负责。",
    trace_index: null,
    action: null,
    plan_step_ids: [],
  }];
  for (const [traceIndex, step] of trace.entries()) {
    const action = String(step?.action || "");
    let status = "observed";
    if (action === "retry_tool_failure") status = "retrying";
    if (action === "recover_tool_failure") status = "recovered";
    events.push({
      index: events.length,
      event: "tool_observed",
      status,
      trace_index: traceIndex,
      action,
      plan_step_ids: stepIdsByTraceIndex.get(traceIndex) || [],
      message: String(step?.summary || action),
    });
  }
  events.push({
    index: events.length,
    event: "trace_gate_evaluated",
    status: gate.passed ? "passed" : "failed",
    trace_index: null,
    action: "agent_trace_gate",
    plan_step_ids: [],
    message: gate.passed ? "确定性工具门控已通过。" : "确定性工具门控未通过，候选不能确认。",
    missing_actions: gate.missing_actions || [],
  });
  events.push({
    index: events.length,
    event: "react_plan_evaluated",
    status: plan.passed ? "passed" : "failed",
    trace_index: null,
    action: "agent_react_plan",
    plan_step_ids: (plan.steps || []).map((step) => step.id).filter(Boolean),
    message: `ReAct 审计计划已评估：${plan.completed_step_count || 0}/${plan.step_count || 0} 步完成。`,
    failed_step_count: Number(plan.failed_step_count || 0),
  });
  return {
    schema_version: "agent-execution-events/v0.1",
    mode,
    passed: Boolean(gate.passed) && Boolean(plan.passed),
    event_count: events.length,
    tool_event_count: trace.length,
    retry_event_count: events.filter((event) => event.status === "retrying").length,
    recovery_event_count: events.filter((event) => event.status === "recovered").length,
    events,
    clinical_boundary: "执行事件只复放浏览器确定性工具观察，便于 UI 和审计；不是自主临床推理或手术指令。",
  };
}

export function rotateDirectionVariant(direction, angleOffsetDeg, normal = [0, 0, 1]) {
  const vector = rotateInPlane(norm(direction.vector || [1, 0, 0]), normal, Number(angleOffsetDeg || 0));
  const angle = Math.atan2(vector[1], vector[0]) * 180 / Math.PI;
  const reasons = [
    ...(Array.isArray(direction.confidence_reasons) ? direction.confidence_reasons : []),
    ...(Math.abs(Number(angleOffsetDeg || 0)) > 1e-9 ? ["browser_direction_variant_requires_clinician_review"] : []),
  ];
  return {
    ...direction,
    vector,
    angle_deg: angle,
    confidence: Math.max(0, Number(direction.confidence || 0) - Math.abs(Number(angleOffsetDeg || 0)) / 180),
    source: direction.source || "rstl_atlas_weighted_nearest",
    variant_source: Math.abs(Number(angleOffsetDeg || 0)) > 1e-9 ? "browser_direction_variant" : "rstl_primary",
    angle_offset_deg: Number(angleOffsetDeg || 0),
    confidence_reasons: [...new Set(reasons)],
  };
}

export function candidateForDirection(tumor, direction, unitsPerMm, verts, normal = [0, 0, 1], rules = DEFAULT_RULES) {
  const toolName = tumor.kind === "subcutaneous" ? "linear_subcutaneous_incision" : "fusiform_cutaneous_incision";
  const candidate = tumor.kind === "subcutaneous"
    ? generateLinearIncision(tumor, direction, unitsPerMm, rules)
    : generateFusiformIncision(tumor, direction, unitsPerMm, normal, rules);
  annotateCandidateSensitiveDistances(candidate, verts);
  candidate.provenance = {
    ...(candidate.provenance || {}),
    direction_variant_angle_offset_deg: direction.angle_offset_deg || 0,
    direction_variant_source: direction.variant_source || "rstl_primary",
  };
  return { toolName, candidate };
}

export function workflowAudit(result, { retriedFailures = [], recoveredFailures = [] } = {}) {
  const candidateRecords = Array.isArray(result.candidate_alternatives)
    ? result.candidate_alternatives.filter((record) => record?.candidate)
    : [];
  const comparisonReady = Array.isArray(result.candidate_comparison) && result.candidate_comparison.length > 0;
  const traceGate = agentTraceGate(result);
  const reactPlan = agentReactPlan(result, {
    candidateCount: candidateRecords.length,
    comparisonReady,
    traceGate,
    retriedFailures,
    recoveredFailures,
  });
  const executionEvents = agentExecutionEvents(result, { traceGate, reactPlan });
  return {
    traceGate,
    reactPlan,
    executionEvents,
    orchestrationAudit: {
      schema_version: "agent-orchestration-audit/v0.1",
      mode: "browser_single_turn_react_multi_candidate_with_deterministic_tools",
      candidate_count: candidateRecords.length,
      preview_count: candidateRecords.filter((record) => record.preview && typeof record.preview === "object").length,
      preview_ready_count: candidateRecords.filter((record) => record.preview?.renderable === true).length,
      comparison_ready: comparisonReady,
      react_plan_passed: reactPlan.passed,
      react_plan_step_count: reactPlan.step_count,
      retry_count: retriedFailures.length,
      retried_failures: retriedFailures,
      tool_failure_count: recoveredFailures.length,
      recovered_failures: recoveredFailures,
      trace_gate_passed: traceGate.passed,
      clinical_boundary: "浏览器 workflow 可以比较确定性候选供审阅，但不能发出手术指令或绕过医生确认。",
    },
  };
}

export function attachWorkflowAudit(result, opts = {}) {
  const audit = workflowAudit(result, opts);
  result.agent_trace_gate = audit.traceGate;
  result.agent_react_plan = audit.reactPlan;
  result.agent_execution_events = audit.executionEvents;
  result.agent_orchestration_audit = audit.orchestrationAudit;
  return result;
}

export function planIncisionDeterministic({ tumor: tumorInput, verts, tris, atlas, normal = [0, 0, 1] }) {
  const tumor = validateTumor(tumorInput);
  const tumorQuality = summarizeTumorInputQuality(tumor);
  const anatomy = classifyRegion(tumor.center, verts);
  const direction = queryDirection(tumor.center, verts, tris, atlas);
  const preCandidateSensitiveInspection = inspectSensitiveStructures(anatomy);
  const unitsPerMm = unitsPerMmFromVertices(verts);
  const candidate = tumor.kind === "subcutaneous"
    ? generateLinearIncision(tumor, direction, unitsPerMm)
    : generateFusiformIncision(tumor, direction, unitsPerMm, normal);
  annotateCandidateSensitiveDistances(candidate, verts);
  const sensitiveInspection = inspectSensitiveStructures(anatomy, candidate);
  const guardrails = evaluateGuardrails(candidate, anatomy);
  const preview = previewIncisionOnFace(tumor, candidate, anatomy, guardrails);
  const trace = [
    {
      summary: "检查肿物输入来源、作者、单位、深度、切缘和边界完整性。",
      action: "summarize_tumor_input_quality",
      input: { tumor },
      observation: tumorQuality,
    },
    { summary: "定位病灶所在面部分区。", action: "classify_region", input: { point: tumor.center }, observation: anatomy },
    { summary: "查询局部 RSTL 方向。", action: "query_rstl_direction", input: { point: tumor.center, source: "rstl_atlas" }, observation: direction },
    { summary: "检查附近敏感游离缘和保护性方向例外。", action: "inspect_sensitive_structures", input: { anatomy }, observation: preCandidateSensitiveInspection },
    {
      summary: "用确定性工具生成切口候选。",
      action: tumor.kind === "subcutaneous" ? "linear_subcutaneous_incision" : "fusiform_cutaneous_incision",
      input: { tumor, direction, units_per_mm: unitsPerMm },
      observation: shortCandidate(candidate),
    },
    { summary: "复核候选几何到敏感游离缘的距离。", action: "inspect_sensitive_structures", input: { anatomy, candidate: shortCandidate(candidate) }, observation: sensitiveInspection },
    { summary: "评估敏感结构和置信度 guardrails。", action: "evaluate_guardrails", input: { candidate: shortCandidate(candidate), anatomy }, observation: guardrails },
    { summary: "在标准脸上预览候选切口，确认几何可渲染后再进入医生审阅。", action: "preview_incision_on_face", input: { candidate: shortCandidate(candidate), tumor, anatomy }, observation: preview },
  ];
  return {
    schema_version: "agentic-incision-plan/v0.1",
    agent_trace_mode: "single_turn_react_with_deterministic_tools",
    tool_schemas: TOOL_SCHEMAS,
    tumor,
    tumor_quality: tumorQuality,
    anatomy,
    direction,
    sensitive_structure_inspection: sensitiveInspection,
    candidate,
    preview,
    guardrails,
    trace,
    llm: {
      summary: fallbackSummary(tumor, candidate, guardrails),
      rationale: "浏览器内确定性工具生成；未使用 LLM 摘要。",
      next_step: "医生审阅、编辑或拒绝该候选。",
      model: null,
      reasoning: "",
    },
    provider: { mode: "browser_deterministic_fallback", model: null, error: null },
  };
}

export function planIncisionWorkflow({
  tumor: tumorInput,
  verts,
  tris,
  atlas,
  normal = [0, 0, 1],
  angleOffsetsDeg = [-10, 0, 10],
  rules = DEFAULT_RULES,
} = {}) {
  const result = planIncisionDeterministic({ tumor: tumorInput, verts, tris, atlas, normal });
  result.agent_trace_mode = "single_turn_react_multi_candidate_with_deterministic_tools";
  const tumor = result.tumor;
  const unitsPerMm = unitsPerMmFromVertices(verts);
  const directionVariants = angleOffsetsDeg.map((offset) => rotateDirectionVariant(result.direction, offset, normal));
  result.trace.push(traceStep(
    "propose_direction_variants",
    { direction: result.direction, angle_offsets_deg: angleOffsetsDeg },
    {
      variants: directionVariants.map((variant) => ({
        angle_offset_deg: variant.angle_offset_deg,
        angle_deg: variant.angle_deg,
        confidence: variant.confidence,
        source: variant.source,
        variant_source: variant.variant_source,
      })),
      boundary: "方向备选是浏览器确定性参数探索，不是 LLM 计算几何。",
    },
    "探索附近方向偏移，供审阅面板比较确定性候选。",
  ));

  const candidateRecords = [];
  const retriedFailures = [];
  const recoveredFailures = [];
  for (const variant of directionVariants) {
    const offset = Number(variant.angle_offset_deg || 0);
    const variantId = Math.abs(offset) < 1e-9 ? "baseline" : `offset_${offset > 0 ? "+" : ""}${Math.round(offset)}deg`;
    const label = Math.abs(offset) < 1e-9 ? "RSTL baseline" : `RSTL offset ${offset > 0 ? "+" : ""}${Math.round(offset)} deg`;
    let variantCandidate;
    let variantGuardrails;
    let variantPreview;
    let variantSensitiveInspection;
    if (Math.abs(offset) < 1e-9) {
      variantCandidate = result.candidate;
      variantGuardrails = result.guardrails;
      variantPreview = result.preview;
      variantSensitiveInspection = result.sensitive_structure_inspection;
    } else {
      try {
        const generated = candidateForDirection(tumor, variant, unitsPerMm, verts, normal, rules);
        variantCandidate = generated.candidate;
        result.trace.push(traceStep(
          generated.toolName,
          { tumor, direction: variant, units_per_mm: unitsPerMm, variant: variantId },
          shortCandidate(variantCandidate),
          "生成确定性方向备选候选，供比较使用。",
        ));
        variantSensitiveInspection = inspectSensitiveStructures(result.anatomy, variantCandidate, rules);
        result.trace.push(traceStep(
          "inspect_sensitive_structures",
          { anatomy: result.anatomy, candidate: shortCandidate(variantCandidate), variant: variantId },
          variantSensitiveInspection,
          "复核方向备选候选几何到敏感游离缘的距离。",
        ));
        variantGuardrails = evaluateGuardrails(variantCandidate, result.anatomy, rules);
        result.trace.push(traceStep(
          "evaluate_guardrails",
          { candidate: shortCandidate(variantCandidate), anatomy: result.anatomy, variant: variantId },
          variantGuardrails,
          "复跑方向备选候选的 guardrails。",
        ));
        variantPreview = previewIncisionOnFace(tumor, variantCandidate, result.anatomy, variantGuardrails, variantId);
        result.trace.push(traceStep(
          "preview_incision_on_face",
          { candidate: shortCandidate(variantCandidate), tumor, anatomy: result.anatomy, variant: variantId },
          variantPreview,
          "预览确定性方向备选候选后再进入比较。",
        ));
      } catch (err) {
        const retry = {
          tool: tumor.kind === "subcutaneous" ? "linear_subcutaneous_incision" : "fusiform_cutaneous_incision",
          variant: variantId,
          angle_offset_deg: offset,
          attempt: 1,
          error: err.message,
          retry: "retry_same_deterministic_tool_once",
          max_attempts: 1,
        };
        retriedFailures.push(retry);
        result.trace.push(traceStep(
          "retry_tool_failure",
          { tool: retry.tool, variant: variantId, error: err.message, attempt: 1 },
          retry,
          "确定性工具失败后重试一次，再决定是否跳过该备选。",
        ));
        try {
          const generated = candidateForDirection(tumor, variant, unitsPerMm, verts, normal, rules);
          variantCandidate = generated.candidate;
          result.trace.push(traceStep(
            generated.toolName,
            { tumor, direction: variant, units_per_mm: unitsPerMm, variant: variantId, retry_attempt: 1 },
            shortCandidate(variantCandidate),
            "重试后生成确定性方向备选候选。",
          ));
          variantSensitiveInspection = inspectSensitiveStructures(result.anatomy, variantCandidate, rules);
          result.trace.push(traceStep(
            "inspect_sensitive_structures",
            { anatomy: result.anatomy, candidate: shortCandidate(variantCandidate), variant: variantId, retry_attempt: 1 },
            variantSensitiveInspection,
            "重试成功后复核方向备选候选几何到敏感游离缘的距离。",
          ));
          variantGuardrails = evaluateGuardrails(variantCandidate, result.anatomy, rules);
          result.trace.push(traceStep(
            "evaluate_guardrails",
            { candidate: shortCandidate(variantCandidate), anatomy: result.anatomy, variant: variantId, retry_attempt: 1 },
            variantGuardrails,
            "重试成功后复跑方向备选候选的 guardrails。",
          ));
          variantPreview = previewIncisionOnFace(tumor, variantCandidate, result.anatomy, variantGuardrails, variantId);
          result.trace.push(traceStep(
            "preview_incision_on_face",
            { candidate: shortCandidate(variantCandidate), tumor, anatomy: result.anatomy, variant: variantId, retry_attempt: 1 },
            variantPreview,
            "重试成功后预览方向备选候选。",
          ));
        } catch (retryErr) {
          const failure = {
            tool: retry.tool,
            variant: variantId,
            angle_offset_deg: offset,
            error: retryErr.message,
            previous_errors: [err.message],
            recovery: "skipped_failed_variant_and_kept_other_candidates",
          };
          recoveredFailures.push(failure);
          result.trace.push(traceStep(
            "recover_tool_failure",
            { tool: retry.tool, variant: variantId, error: retryErr.message },
            failure,
            "记录确定性工具失败并继续比较剩余候选。",
          ));
          continue;
        }
      }
    }
    candidateRecords.push({
      id: `browser_${variantId}`,
      label,
      angle_offset_deg: offset,
      candidate: variantCandidate,
      guardrails: variantGuardrails,
      preview: variantPreview,
      sensitive_structure_inspection: variantSensitiveInspection,
      anatomy: result.anatomy,
      review_status: "pending_clinician_confirmation",
    });
  }

  result.candidate_alternatives = candidateRecords;
  result.candidate_comparison = compareCandidateRecords(candidateRecords, rules);
  result.trace.push(traceStep(
    "compare_candidates",
    { candidate_ids: candidateRecords.map((record) => record.id) },
    {
      ranked_candidates: result.candidate_comparison,
      candidate_count: candidateRecords.length,
      recovered_failure_count: recoveredFailures.length,
      clinical_boundary: "工程排序只用于审阅分流，不是临床推荐或手术指令。",
    },
    "用确定性工程指标对方向备选做排序，辅助医生审阅。",
  ));
  result.llm = {
    summary: fallbackSummary(tumor, result.candidate, result.guardrails),
    rationale: "浏览器确定性 workflow 已执行全部工具；当前未调用 LLM 摘要。",
    next_step: "医生查看 trace、候选比较和 guardrails 后，编辑、确认或否决该候选。",
    model: null,
    reasoning: "",
  };
  result.provider = { mode: "browser_deterministic_workflow", model: null, error: null };
  return attachWorkflowAudit(result, { retriedFailures, recoveredFailures });
}

function finiteOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function warningSeverityCounts(guardrails = {}) {
  const warnings = Array.isArray(guardrails.warnings) ? guardrails.warnings : [];
  return {
    high: warnings.filter((w) => w.severity === "high").length,
    medium: warnings.filter((w) => w.severity === "medium").length,
    low: warnings.filter((w) => w.severity === "low").length,
  };
}

function comparisonReasons({ severity, metrics, reviewStatus, sensitiveDistance, sensitiveThreshold, candidateType }) {
  const reasons = [];
  if (reviewStatus === "rejected_by_clinician") reasons.push("医生已否决");
  if (severity.high) reasons.push(`${severity.high} 个 high guardrail`);
  if (severity.medium) reasons.push(`${severity.medium} 个 medium guardrail`);
  const rstlDeviation = finiteOr(metrics.rstl_deviation_deg, 0);
  if (rstlDeviation > 0) reasons.push(`RSTL 偏角 ${rstlDeviation.toFixed(1)}°`);
  const linearDeficit = finiteOr(metrics.diameter_coverage_deficit_mm, 0);
  if (linearDeficit > 0) reasons.push(`直径覆盖缺口 ${linearDeficit.toFixed(1)} mm`);
  const axisDeficit = finiteOr(metrics.axis_coverage_deficit_mm, 0);
  if (axisDeficit > 0) reasons.push(`边界覆盖缺口 ${axisDeficit.toFixed(1)} mm`);
  if (candidateType === "fusiform") {
    const tipError = finiteOr(metrics.tip_angle_error_deg, 0);
    if (tipError > 0.5) reasons.push(`尖端角误差 ${tipError.toFixed(1)}°`);
  }
  if (Number.isFinite(sensitiveDistance) && Number.isFinite(sensitiveThreshold) && sensitiveDistance <= sensitiveThreshold) {
    reasons.push(`距敏感游离缘 ${sensitiveDistance.toFixed(1)} mm（阈值 ${sensitiveThreshold.toFixed(1)} mm）`);
  }
  return reasons.length ? reasons : ["工程指标未见额外扣分"];
}

export function compareCandidateRecords(records = [], rules = DEFAULT_RULES) {
  const cfg = rules?.guardrails || DEFAULT_RULES.guardrails;
  return (records || [])
    .filter(Boolean)
    .map((record, index) => {
      const candidate = record.candidate || {};
      const metrics = candidate.metrics || {};
      const severity = warningSeverityCounts(record.guardrails);
      const reviewStatus = record.review_status || record.review?.status || "pending_clinician_confirmation";
      const sensitiveDistance = finiteOr(metrics.sensitive_free_margin_min_distance_mm, Infinity);
      const sensitiveThreshold = Number.isFinite(sensitiveDistance)
        ? freeMarginDistanceThresholdMm(
            metrics.sensitive_free_margin_nearest || record.anatomy?.region || candidate.region,
            cfg,
            record.anatomy?.region || candidate.region || "unknown",
          )
        : Infinity;
      const sensitivePenalty = Number.isFinite(sensitiveDistance)
        ? Math.max(0, sensitiveThreshold - sensitiveDistance) * 5
        : 0;
      const score =
        severity.high * 100 +
        severity.medium * 25 +
        severity.low * 5 +
        finiteOr(metrics.rstl_deviation_deg, 0) +
        finiteOr(metrics.diameter_coverage_deficit_mm, 0) * 10 +
        finiteOr(metrics.axis_coverage_deficit_mm, 0) * 10 +
        finiteOr(metrics.tip_angle_error_deg, 0) * 2 +
        sensitivePenalty +
        (reviewStatus === "rejected_by_clinician" ? 1000 : 0);
      return {
        id: record.id || `candidate_${index}`,
        label: record.label || `候选 ${index + 1}`,
        original_index: index,
        candidate_type: candidate.type || "unknown",
        review_status: reviewStatus,
        score,
        score_breakdown: {
          high_guardrails: severity.high,
          medium_guardrails: severity.medium,
          rstl_deviation_deg: finiteOr(metrics.rstl_deviation_deg, 0),
          diameter_coverage_deficit_mm: finiteOr(metrics.diameter_coverage_deficit_mm, 0),
          axis_coverage_deficit_mm: finiteOr(metrics.axis_coverage_deficit_mm, 0),
          tip_angle_error_deg: finiteOr(metrics.tip_angle_error_deg, 0),
          sensitive_free_margin_threshold_mm: Number.isFinite(sensitiveThreshold) ? sensitiveThreshold : null,
          sensitive_margin_penalty: sensitivePenalty,
          rejected_penalty: reviewStatus === "rejected_by_clinician" ? 1000 : 0,
        },
        reasons: comparisonReasons({
          severity,
          metrics,
          reviewStatus,
          sensitiveDistance,
          sensitiveThreshold,
          candidateType: candidate.type,
        }),
      };
    })
    .sort((a, b) => a.score - b.score || a.original_index - b.original_index)
    .map((item, idx) => ({
      ...item,
      rank: idx + 1,
      score: Number(item.score.toFixed(3)),
      clinical_boundary: "工程排序仅用于候选对比，不是临床推荐或手术指令。",
    }));
}

export const __incisionToolsForTests = {
  DEFAULT_RULES,
  TOOL_SCHEMAS,
  AGENT_TRACE_GATE_REQUIRED,
  agentTraceGate,
  agentReactPlan,
  agentExecutionEvents,
  applyCandidateEdit,
  compareCandidateRecords,
  classifyRegion,
  queryDirection,
  normalizeTumorInput,
  summarizeTumorInputQuality,
  annotateCandidateSensitiveDistances,
  summarizeTumorBoundary,
  generateLinearIncision,
  generateFusiformIncision,
  evaluateGuardrails,
  inspectSensitiveStructures,
  previewIncisionOnFace,
  planIncisionDeterministic,
  planIncisionWorkflow,
  unitsPerMmFromVertices,
};
