import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";

type TableName = "cases" | "tumors" | "annotations" | "incision_candidates" | "candidate_reviews" | "audit_events";
type Row = Record<string, unknown>;

class FakeStatement {
  private bindings: unknown[] = [];

  constructor(private readonly db: FakeD1Database, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async run() {
    this.db.run(this.sql, this.bindings);
    return { success: true };
  }

  async first<T>() {
    return this.db.first(this.sql, this.bindings) as T | null;
  }

  async all<T>() {
    return { results: this.db.all(this.sql, this.bindings) as T[] };
  }
}

class FakeD1Database {
  readonly tables: Record<TableName, Row[]> = {
    cases: [],
    tumors: [],
    annotations: [],
    incision_candidates: [],
    candidate_reviews: [],
    audit_events: [],
  };

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  run(sql: string, bindings: unknown[]) {
    if (sql.startsWith("INSERT INTO audit_events")) {
      this.tables.audit_events.push({
        id: bindings[0],
        case_id: bindings[1],
        actor: bindings[2],
        action: bindings[3],
        target_type: bindings[4],
        target_id: bindings[5],
        summary_json: bindings[6],
        created_at: bindings[7],
      });
      return;
    }
    if (sql.startsWith("INSERT INTO cases")) {
      this.tables.cases.push({
        id: bindings[0],
        status: bindings[1],
        current_step: bindings[2],
        patient_context_json: bindings[3],
        created_at: bindings[4],
        updated_at: bindings[5],
        client_draft_id: bindings[6],
      });
      return;
    }
    if (sql.startsWith("UPDATE cases SET")) {
      const row = this.tables.cases.find((item) => item.id === bindings[5]);
      if (row) {
        row.status = bindings[0];
        row.current_step = bindings[1];
        row.patient_context_json = bindings[2];
        row.updated_at = bindings[3];
        row.client_draft_id = bindings[4];
      }
      return;
    }
    if (sql.startsWith("INSERT INTO tumors")) {
      this.tables.tumors.push({
        id: bindings[0],
        case_id: bindings[1],
        layer: bindings[2],
        geometry_json: bindings[3],
        measurements_json: bindings[4],
        margin_json: bindings[5],
        source: bindings[6],
        author: bindings[7],
        provenance_json: bindings[8],
        created_at: bindings[9],
      });
      return;
    }
    if (sql.startsWith("INSERT INTO annotations")) {
      this.tables.annotations.push({
        id: bindings[0],
        case_id: bindings[1],
        kind: bindings[2],
        geometry_json: bindings[3],
        author: bindings[4],
        version: bindings[5],
        validated: bindings[6],
        provenance_json: bindings[7],
        created_at: bindings[8],
      });
      return;
    }
    if (sql.startsWith("INSERT INTO incision_candidates")) {
      this.tables.incision_candidates.push({
        id: bindings[0],
        case_id: bindings[1],
        candidate_type: bindings[2],
        generated_geometry_json: bindings[3],
        edited_geometry_json: bindings[4],
        metrics_json: bindings[5],
        warnings_json: bindings[6],
        rule_trace_json: bindings[7],
        provenance_json: bindings[8],
        version: bindings[9],
        review_status: bindings[10],
        created_at: bindings[11],
        updated_at: bindings[12],
      });
      return;
    }
    if (sql.startsWith("INSERT INTO candidate_reviews")) {
      this.tables.candidate_reviews.push({
        id: bindings[0],
        candidate_id: bindings[1],
        decision: bindings[2],
        reviewer: bindings[3],
        notes: bindings[4],
        override_reason: bindings[5],
        created_at: bindings[6],
      });
      return;
    }
    if (sql.startsWith("UPDATE incision_candidates SET review_status")) {
      const row = this.tables.incision_candidates.find((item) => item.id === bindings[2]);
      if (row) {
        row.review_status = bindings[0];
        row.updated_at = bindings[1];
      }
      return;
    }
    throw new Error(`Unhandled fake D1 run: ${sql}`);
  }

  first(sql: string, bindings: unknown[]) {
    if (sql.startsWith("SELECT * FROM cases WHERE id") || sql.startsWith("SELECT id FROM cases WHERE id")) {
      return this.tables.cases.find((row) => row.id === bindings[0]) ?? null;
    }
    if (sql.startsWith("SELECT * FROM incision_candidates WHERE id")) {
      return this.tables.incision_candidates.find((row) => row.id === bindings[0]) ?? null;
    }
    throw new Error(`Unhandled fake D1 first: ${sql}`);
  }

  all(sql: string, bindings: unknown[]) {
    if (sql.startsWith("SELECT * FROM tumors WHERE case_id")) {
      return this.byCase("tumors", bindings[0]);
    }
    if (sql.startsWith("SELECT * FROM annotations WHERE case_id")) {
      return this.byCase("annotations", bindings[0]);
    }
    if (sql.startsWith("SELECT * FROM incision_candidates WHERE case_id")) {
      return this.byCase("incision_candidates", bindings[0]);
    }
    if (sql.startsWith("SELECT * FROM audit_events WHERE case_id")) {
      return this.byCase("audit_events", bindings[0]);
    }
    if (sql.startsWith("SELECT * FROM candidate_reviews WHERE candidate_id IN")) {
      const ids = new Set(bindings);
      return this.tables.candidate_reviews.filter((row) => ids.has(row.candidate_id));
    }
    throw new Error(`Unhandled fake D1 all: ${sql}`);
  }

  private byCase(table: TableName, caseId: unknown) {
    return this.tables[table].filter((row) => row.case_id === caseId);
  }
}

function createEnv(overrides: Partial<Env> = {}) {
  return {
    DB: new FakeD1Database() as unknown as D1Database,
    ALLOWED_ORIGINS: "https://langer-face.example.com",
    ALLOW_VERCEL_PREVIEW_ORIGINS: "true",
    ...overrides,
  } satisfies Env;
}

function jsonRequest(path: string, body: unknown, init: RequestInit = {}) {
  return new Request(`https://api.example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    body: JSON.stringify(body),
    ...init,
  });
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("health endpoint returns stable service metadata and CORS for Vercel preview origins", async () => {
  const env = createEnv();
  const response = await handleRequest(
    new Request("https://api.example.test/health", {
      headers: { origin: "https://langer-face-preview.vercel.app" },
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://langer-face-preview.vercel.app");
  assert.deepEqual(await readJson(response), {
    ok: true,
    service: "langerface-api",
    schema: "cloudflare-worker-d1-r2/v0.1",
  });
});

test("preflight rejects origins outside the configured allow list", async () => {
  const env = createEnv({ ALLOW_VERCEL_PREVIEW_ORIGINS: "false" });
  const response = await handleRequest(
    new Request("https://api.example.test/api/cases", {
      method: "OPTIONS",
      headers: { origin: "https://unknown.example.com" },
    }),
    env,
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(((await readJson(response)).error as Record<string, unknown>).code, "origin_not_allowed");
});

test("case creation rejects direct patient identity payloads", async () => {
  const env = createEnv();
  const response = await handleRequest(
    jsonRequest("/api/cases", {
      id: "case_rejected",
      patient_context: { age: 42, patientName: "张三" },
    }),
    env,
  );

  assert.equal(response.status, 400);
  assert.equal(((await readJson(response)).error as Record<string, unknown>).code, "patient_identity_payload_rejected");
});

test("case workspace persists tumor, annotation, incision candidate, review and export envelope", async () => {
  const env = createEnv();
  const created = await handleRequest(
    jsonRequest("/api/cases", {
      id: "case_demo",
      status: "draft",
      current_step: "evaluate",
      patient_context: { age_band: "adult", age: 36 },
      client_draft_id: "browser-draft-1",
    }),
    env,
  );
  assert.equal(created.status, 201);
  assert.equal(((await readJson(created)).case as Record<string, unknown>).id, "case_demo");

  const updated = await handleRequest(
    new Request("https://api.example.test/api/cases/case_demo", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "needs_review", current_step: "plan" }),
    }),
    env,
  );
  assert.equal(updated.status, 200);
  assert.equal(((await readJson(updated)).case as Record<string, unknown>).current_step, "plan");

  const tumor = await handleRequest(
    jsonRequest("/api/cases/case_demo/tumors", {
      id: "tumor_demo",
      layer: "cutaneous",
      geometry: { kind: "ellipse", center: [0.2, 0.3], radius_mm: 6 },
      measurements: { diameter_mm: 12.5, units: "mm" },
      margin: { strategy: "manual", safety_margin_mm: 5 },
      source: "manual",
      author: "clinician",
      provenance: { raw_media_included: false },
    }),
    env,
  );
  assert.equal(tumor.status, 201);

  const annotation = await handleRequest(
    jsonRequest("/api/cases/case_demo/annotations", {
      id: "annotation_demo",
      kind: "rstl",
      geometry: { coordinate_space: "face_2d", points: [[0.1, 0.2], [0.4, 0.2]] },
      author: "clinician",
      version: 1,
      validated: false,
      provenance: { tool: "browser" },
    }),
    env,
  );
  assert.equal(annotation.status, 201);

  const candidate = await handleRequest(
    jsonRequest("/api/cases/case_demo/incision-candidates", {
      id: "candidate_demo",
      candidate_type: "fusiform",
      generated_geometry: { axis: [[0, 0], [24, 0]], width_mm: 8 },
      metrics: { length_mm: 24, apex_angle_deg: 30 },
      warnings: [{ severity: "high", code: "near_lower_eyelid" }],
      rule_trace: { rstl_axis_deg: 4, guardrails: ["near_lower_eyelid"] },
      provenance: { workflow: "deterministic-browser" },
      version: 1,
    }),
    env,
  );
  assert.equal(candidate.status, 201);

  const rejectedReview = await handleRequest(
    jsonRequest("/api/incision-candidates/candidate_demo/review", {
      decision: "approved",
      reviewer: "clinician",
      high_risk: true,
    }),
    env,
  );
  assert.equal(rejectedReview.status, 400);
  assert.equal(((await readJson(rejectedReview)).error as Record<string, unknown>).code, "high_risk_review_note_required");

  const acceptedReview = await handleRequest(
    jsonRequest("/api/incision-candidates/candidate_demo/review", {
      id: "review_demo",
      decision: "approved",
      reviewer: "clinician",
      high_risk: true,
      notes: "已结合眼睑警惕区复核。",
    }),
    env,
  );
  const reviewPayload = await readJson(acceptedReview);
  assert.equal(acceptedReview.status, 201);
  assert.equal((reviewPayload.reviews as unknown[]).length, 1);
  const [reviewedCandidate] = reviewPayload.incision_candidates as Record<string, unknown>[];
  assert.ok(reviewedCandidate);
  assert.equal(reviewedCandidate.review_status, "approved");

  const exported = await handleRequest(new Request("https://api.example.test/api/cases/case_demo/export"), env);
  const exportedPayload = await readJson(exported);
  assert.equal(exported.status, 200);
  assert.equal(exportedPayload.schema, "langerface-case-export/v0.1");
  assert.equal(exportedPayload.raw_media_included, false);
  assert.equal((exportedPayload.tumors as unknown[]).length, 1);
  assert.equal((exportedPayload.annotations as unknown[]).length, 1);
  assert.equal((exportedPayload.incision_candidates as unknown[]).length, 1);
  assert.equal((exportedPayload.audit_events as unknown[]).length >= 5, true);
});
