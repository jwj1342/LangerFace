export interface Env {
  DB: D1Database;
  ASSETS?: R2Bucket;
  ALLOWED_ORIGINS?: string;
  ALLOW_VERCEL_PREVIEW_ORIGINS?: string;
}

export type JsonObject = Record<string, unknown>;

export interface RouteContext {
  env: Env;
  request: Request;
  url: URL;
  params: Record<string, string>;
}

export interface CaseRow {
  id: string;
  status: string;
  current_step: string;
  patient_context_json: string;
  created_at: string;
  updated_at: string;
  client_draft_id: string | null;
}

export interface TumorRow {
  id: string;
  case_id: string;
  layer: string;
  geometry_json: string;
  measurements_json: string;
  margin_json: string;
  source: string | null;
  author: string | null;
  provenance_json: string;
  created_at: string;
}

export interface AnnotationRow {
  id: string;
  case_id: string;
  kind: string;
  geometry_json: string;
  author: string | null;
  version: number;
  validated: number;
  provenance_json: string;
  created_at: string;
}

export interface CandidateRow {
  id: string;
  case_id: string;
  candidate_type: string;
  generated_geometry_json: string;
  edited_geometry_json: string | null;
  metrics_json: string;
  warnings_json: string;
  rule_trace_json: string;
  provenance_json: string;
  version: number;
  review_status: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewRow {
  id: string;
  candidate_id: string;
  decision: string;
  reviewer: string | null;
  notes: string | null;
  override_reason: string | null;
  created_at: string;
}

export interface AuditRow {
  id: string;
  case_id: string | null;
  actor: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary_json: string;
  created_at: string;
}
