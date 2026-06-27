import type { JsonObject } from "./types";

const PATIENT_IDENTITY_KEYS = new Set([
  "name",
  "patient_name",
  "patientName",
  "phone",
  "phone_number",
  "phoneNumber",
  "email",
  "id_card",
  "idCard",
  "medical_record_number",
  "medicalRecordNumber",
  "mrn",
  "hospital_number",
  "hospitalNumber",
  "social_security_number",
  "ssn",
]);

const PII_PATTERNS = [
  /\b1[3-9]\d{9}\b/u,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b\d{15}(\d{2}[0-9Xx])?\b/u,
];

export function createId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `${prefix}_${randomId}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function asJsonText(value: unknown, fallback: unknown = {}) {
  return JSON.stringify(value === undefined ? fallback : value);
}

export function hasPatientIdentityPayload(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return PII_PATTERNS.some((pattern) => pattern.test(value));
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasPatientIdentityPayload(item));

  for (const [key, nested] of Object.entries(value as JsonObject)) {
    if (PATIENT_IDENTITY_KEYS.has(key)) return true;
    if (hasPatientIdentityPayload(nested)) return true;
  }
  return false;
}

export function requireCaseStatus(value: unknown) {
  if (value === "draft" || value === "needs_review" || value === "confirmed" || value === "exported") return value;
  return "draft";
}

export function requireCaseStep(value: unknown) {
  if (value === "evaluate" || value === "plan" || value === "review") return value;
  return "evaluate";
}

export function requireTumorLayer(value: unknown) {
  return value === "cutaneous" ? "cutaneous" : "subcutaneous";
}

export function requireCandidateType(value: unknown) {
  return value === "fusiform" ? "fusiform" : "linear";
}

export function requireReviewDecision(value: unknown) {
  if (value === "approved" || value === "rejected" || value === "needs_revision") return value;
  return "needs_revision";
}

export function isHighRiskReviewMissingNote(payload: JsonObject): boolean {
  const decision = requireReviewDecision(payload.decision);
  const highRisk = payload.highRisk === true || payload.high_risk === true;
  const notes = asString(payload.notes);
  const overrideReason = asString(payload.overrideReason ?? payload.override_reason);
  return highRisk && decision === "approved" && !notes && !overrideReason;
}
