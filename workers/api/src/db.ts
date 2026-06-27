import type { AnnotationRow, AuditRow, CandidateRow, CaseRow, Env, JsonObject, ReviewRow, TumorRow } from "./types";
import {
  asJsonText,
  asString,
  createId,
  nowIso,
  requireCandidateType,
  requireCaseStatus,
  requireCaseStep,
  requireReviewDecision,
  requireTumorLayer,
} from "./validation";

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function serializeCase(row: CaseRow) {
  return {
    id: row.id,
    status: row.status,
    current_step: row.current_step,
    patient_context: parseJson(row.patient_context_json, {}),
    client_draft_id: row.client_draft_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function serializeTumor(row: TumorRow) {
  return {
    id: row.id,
    case_id: row.case_id,
    layer: row.layer,
    geometry: parseJson(row.geometry_json, {}),
    measurements: parseJson(row.measurements_json, {}),
    margin: parseJson(row.margin_json, {}),
    source: row.source,
    author: row.author,
    provenance: parseJson(row.provenance_json, {}),
    created_at: row.created_at,
  };
}

export function serializeAnnotation(row: AnnotationRow) {
  return {
    id: row.id,
    case_id: row.case_id,
    kind: row.kind,
    geometry: parseJson(row.geometry_json, {}),
    author: row.author,
    version: row.version,
    validated: Boolean(row.validated),
    provenance: parseJson(row.provenance_json, {}),
    created_at: row.created_at,
  };
}

export function serializeCandidate(row: CandidateRow) {
  return {
    id: row.id,
    case_id: row.case_id,
    candidate_type: row.candidate_type,
    generated_geometry: parseJson(row.generated_geometry_json, {}),
    edited_geometry: parseJson(row.edited_geometry_json, null),
    metrics: parseJson(row.metrics_json, {}),
    warnings: parseJson(row.warnings_json, []),
    rule_trace: parseJson(row.rule_trace_json, {}),
    provenance: parseJson(row.provenance_json, {}),
    version: row.version,
    review_status: row.review_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function serializeReview(row: ReviewRow) {
  return {
    id: row.id,
    candidate_id: row.candidate_id,
    decision: row.decision,
    reviewer: row.reviewer,
    notes: row.notes,
    override_reason: row.override_reason,
    created_at: row.created_at,
  };
}

export function serializeAudit(row: AuditRow) {
  return {
    id: row.id,
    case_id: row.case_id,
    actor: row.actor,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    summary: parseJson(row.summary_json, {}),
    created_at: row.created_at,
  };
}

export async function audit(env: Env, event: {
  action: string;
  actor?: string;
  caseId?: string;
  targetId?: string;
  targetType?: string;
  summary?: JsonObject;
}) {
  await env.DB.prepare(
    "INSERT INTO audit_events (id, case_id, actor, action, target_type, target_id, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    createId("audit"),
    event.caseId ?? null,
    event.actor ?? null,
    event.action,
    event.targetType ?? null,
    event.targetId ?? null,
    asJsonText(event.summary),
    nowIso(),
  ).run();
}

export async function createCase(env: Env, payload: JsonObject) {
  const timestamp = nowIso();
  const id = asString(payload.id, createId("case"));
  const status = requireCaseStatus(payload.status);
  const currentStep = requireCaseStep(payload.current_step ?? payload.currentStep);
  await env.DB.prepare(
    "INSERT INTO cases (id, status, current_step, patient_context_json, created_at, updated_at, client_draft_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id,
    status,
    currentStep,
    asJsonText(payload.patient_context ?? payload.patientContext),
    timestamp,
    timestamp,
    asString(payload.client_draft_id ?? payload.clientDraftId, "") || null,
  ).run();
  await audit(env, { action: "case.create", caseId: id, targetId: id, targetType: "case" });
  return getCaseSummary(env, id);
}

export async function updateCase(env: Env, caseId: string, payload: JsonObject) {
  const existing = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(caseId).first<CaseRow>();
  if (!existing) return null;
  const timestamp = nowIso();
  await env.DB.prepare(
    "UPDATE cases SET status = ?, current_step = ?, patient_context_json = ?, updated_at = ?, client_draft_id = ? WHERE id = ?",
  ).bind(
    requireCaseStatus(payload.status ?? existing.status),
    requireCaseStep(payload.current_step ?? payload.currentStep ?? existing.current_step),
    payload.patient_context || payload.patientContext
      ? asJsonText(payload.patient_context ?? payload.patientContext)
      : existing.patient_context_json,
    timestamp,
    asString(payload.client_draft_id ?? payload.clientDraftId, existing.client_draft_id ?? "") || null,
    caseId,
  ).run();
  await audit(env, { action: "case.update", caseId, targetId: caseId, targetType: "case" });
  return getCaseSummary(env, caseId);
}

export async function getCaseSummary(env: Env, caseId: string) {
  const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(caseId).first<CaseRow>();
  if (!row) return null;
  const [tumors, annotations, candidates, audits] = await Promise.all([
    env.DB.prepare("SELECT * FROM tumors WHERE case_id = ? ORDER BY created_at DESC").bind(caseId).all<TumorRow>(),
    env.DB.prepare("SELECT * FROM annotations WHERE case_id = ? ORDER BY created_at DESC").bind(caseId).all<AnnotationRow>(),
    env.DB.prepare("SELECT * FROM incision_candidates WHERE case_id = ? ORDER BY updated_at DESC").bind(caseId).all<CandidateRow>(),
    env.DB.prepare("SELECT * FROM audit_events WHERE case_id = ? ORDER BY created_at DESC LIMIT 50").bind(caseId).all<AuditRow>(),
  ]);
  const candidateIds = (candidates.results || []).map((item) => item.id);
  const reviews = candidateIds.length
    ? await env.DB.prepare(
      `SELECT * FROM candidate_reviews WHERE candidate_id IN (${candidateIds.map(() => "?").join(",")}) ORDER BY created_at DESC`,
    ).bind(...candidateIds).all<ReviewRow>()
    : { results: [] as ReviewRow[] };

  return {
    case: serializeCase(row),
    tumors: (tumors.results || []).map(serializeTumor),
    annotations: (annotations.results || []).map(serializeAnnotation),
    incision_candidates: (candidates.results || []).map(serializeCandidate),
    reviews: (reviews.results || []).map(serializeReview),
    audit_events: (audits.results || []).map(serializeAudit),
  };
}

async function caseExists(env: Env, caseId: string) {
  const row = await env.DB.prepare("SELECT id FROM cases WHERE id = ?").bind(caseId).first<{ id: string }>();
  return Boolean(row);
}

export async function saveTumor(env: Env, caseId: string, payload: JsonObject) {
  if (!(await caseExists(env, caseId))) return null;
  const id = asString(payload.id, createId("tumor"));
  await env.DB.prepare(
    "INSERT INTO tumors (id, case_id, layer, geometry_json, measurements_json, margin_json, source, author, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id,
    caseId,
    requireTumorLayer(payload.layer),
    asJsonText(payload.geometry),
    asJsonText(payload.measurements),
    asJsonText(payload.margin),
    asString(payload.source, "") || null,
    asString(payload.author, "") || null,
    asJsonText(payload.provenance),
    nowIso(),
  ).run();
  await audit(env, { action: "tumor.save", actor: asString(payload.author), caseId, targetId: id, targetType: "tumor" });
  return getCaseSummary(env, caseId);
}

export async function saveAnnotation(env: Env, caseId: string, payload: JsonObject) {
  if (!(await caseExists(env, caseId))) return null;
  const id = asString(payload.id, createId("annotation"));
  await env.DB.prepare(
    "INSERT INTO annotations (id, case_id, kind, geometry_json, author, version, validated, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id,
    caseId,
    asString(payload.kind, "rstl"),
    asJsonText(payload.geometry),
    asString(payload.author, "") || null,
    typeof payload.version === "number" ? payload.version : 1,
    payload.validated === true ? 1 : 0,
    asJsonText(payload.provenance),
    nowIso(),
  ).run();
  await audit(env, { action: "annotation.save", actor: asString(payload.author), caseId, targetId: id, targetType: "annotation" });
  return getCaseSummary(env, caseId);
}

export async function saveCandidate(env: Env, caseId: string, payload: JsonObject) {
  if (!(await caseExists(env, caseId))) return null;
  const id = asString(payload.id, createId("candidate"));
  const timestamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO incision_candidates (id, case_id, candidate_type, generated_geometry_json, edited_geometry_json, metrics_json, warnings_json, rule_trace_json, provenance_json, version, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id,
    caseId,
    requireCandidateType(payload.candidate_type ?? payload.candidateType),
    asJsonText(payload.generated_geometry ?? payload.generatedGeometry),
    payload.edited_geometry || payload.editedGeometry ? asJsonText(payload.edited_geometry ?? payload.editedGeometry) : null,
    asJsonText(payload.metrics),
    asJsonText(payload.warnings, []),
    asJsonText(payload.rule_trace ?? payload.ruleTrace),
    asJsonText(payload.provenance),
    typeof payload.version === "number" ? payload.version : 1,
    asString(payload.review_status ?? payload.reviewStatus, "pending"),
    timestamp,
    timestamp,
  ).run();
  await audit(env, { action: "candidate.save", caseId, targetId: id, targetType: "incision_candidate" });
  return getCaseSummary(env, caseId);
}

export async function saveReview(env: Env, candidateId: string, payload: JsonObject) {
  const candidate = await env.DB.prepare("SELECT * FROM incision_candidates WHERE id = ?").bind(candidateId).first<CandidateRow>();
  if (!candidate) return null;
  const id = asString(payload.id, createId("review"));
  const decision = requireReviewDecision(payload.decision);
  await env.DB.prepare(
    "INSERT INTO candidate_reviews (id, candidate_id, decision, reviewer, notes, override_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id,
    candidateId,
    decision,
    asString(payload.reviewer, "") || null,
    asString(payload.notes, "") || null,
    asString(payload.override_reason ?? payload.overrideReason, "") || null,
    nowIso(),
  ).run();
  await env.DB.prepare(
    "UPDATE incision_candidates SET review_status = ?, updated_at = ? WHERE id = ?",
  ).bind(decision, nowIso(), candidateId).run();
  await audit(env, {
    action: "candidate.review",
    actor: asString(payload.reviewer),
    caseId: candidate.case_id,
    targetId: candidateId,
    targetType: "incision_candidate",
    summary: { decision },
  });
  return getCaseSummary(env, candidate.case_id);
}
