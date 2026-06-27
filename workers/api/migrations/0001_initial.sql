CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  current_step TEXT NOT NULL DEFAULT 'evaluate',
  patient_context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  client_draft_id TEXT
);

CREATE TABLE IF NOT EXISTS tumors (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  layer TEXT NOT NULL,
  geometry_json TEXT NOT NULL DEFAULT '{}',
  measurements_json TEXT NOT NULL DEFAULT '{}',
  margin_json TEXT NOT NULL DEFAULT '{}',
  source TEXT,
  author TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  geometry_json TEXT NOT NULL DEFAULT '{}',
  author TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  validated INTEGER NOT NULL DEFAULT 0,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incision_candidates (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  candidate_type TEXT NOT NULL,
  generated_geometry_json TEXT NOT NULL DEFAULT '{}',
  edited_geometry_json TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  rule_trace_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_reviews (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES incision_candidates(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  reviewer TEXT,
  notes TEXT,
  override_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
  actor TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tumors_case_id ON tumors(case_id);
CREATE INDEX IF NOT EXISTS idx_annotations_case_id ON annotations(case_id);
CREATE INDEX IF NOT EXISTS idx_candidates_case_id ON incision_candidates(case_id);
CREATE INDEX IF NOT EXISTS idx_reviews_candidate_id ON candidate_reviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_audit_case_id ON audit_events(case_id);
