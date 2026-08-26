const SECRET_KEY_HINTS = ["api_key", "secret", "token", "authorization", "password", "private_key"];
const REDACTED_VALUES = new Set(["", "[redacted]", "redacted", "***", "null", "none"]);
const PII_KEY_HINTS = [
  "patient_name",
  "patientname",
  "mrn",
  "medical_record",
  "hospital_number",
  "id_card",
  "phone",
  "email",
  "date_of_birth",
  "dob",
  "address",
];
const RAW_MEDIA_FLAGS = ["raw_image_sent", "raw_video_sent", "contains_face_image", "contains_raw_media"];
const MEDIA_KEY_HINTS = [
  "image",
  "photo",
  "video",
  "frame",
  "texture",
  "pixels",
  "exif",
  "ultrasound",
  "dicom",
  "mask",
  "overlay",
  "bytes",
];
const SECONDARY_CUE_FORBIDDEN_TRUE = ["used_for_geometry"];
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(^|[^\d])(?:\+?\d[\d .()\-]{8,}\d)(?!\d)/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC_MILLISECONDS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ExportPrivacyViolation {
  code: string;
  path: string;
}

export interface ExportPrivacyAudit {
  schema_version: string;
  passed: boolean;
  violation_count: number;
  violations: ExportPrivacyViolation[];
}

function pathContains(path: string[], hints: string[]): boolean {
  return path.some((part) => hints.some((hint) => part.toLowerCase().includes(hint)));
}

function exportText(value: unknown): string {
  if (value == null || typeof value === "boolean" || typeof value === "number") return "";
  return String(value).trim();
}

function valueIsRedacted(value: unknown): boolean {
  const text = exportText(value);
  return !text || REDACTED_VALUES.has(text.toLowerCase());
}

function looksLikeEmbeddedMedia(text: string): boolean {
  if (/^data:(image|video|application\/dicom)\//i.test(text)) return true;
  if (text.length < 256 || text.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(text) && /^(\/9j\/|iVBORw0KGgo|R0lGOD|UklGR|RElDTQ)/.test(text);
}

function isStrictUuid(text: string): boolean {
  return UUID_RE.test(text);
}

function isStrictIsoUtcTimestamp(text: string): boolean {
  if (!ISO_UTC_MILLISECONDS_RE.test(text)) return false;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === text;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function reviewExportRecordAtPath(payload: unknown, path: string[]): Record<string, unknown> | null {
  const exportPayload = objectRecord(payload);
  if (exportPayload?.schema_version !== "incision-review-export/v0.4") return null;
  const record = path[0] === "current"
    ? exportPayload.current
    : path[0] === "saved" && /^\d+$/.test(path[1] || "")
      ? (Array.isArray(exportPayload.saved) ? exportPayload.saved[Number(path[1])] : null)
      : null;
  const reviewRecord = objectRecord(record);
  return reviewRecord?.schema_version === "incision-review-record/v0.4" ? reviewRecord : null;
}

function candidateComparisonReferencesReviewRecord(payload: unknown, path: string[], text: string): boolean {
  const exportPayload = objectRecord(payload);
  if (
    exportPayload?.schema_version !== "incision-review-export/v0.4"
    || path.length !== 3
    || path[0] !== "candidate_comparison"
    || !/^\d+$/.test(path[1])
    || path[2] !== "id"
  ) return false;
  const comparison = Array.isArray(exportPayload.candidate_comparison)
    ? objectRecord(exportPayload.candidate_comparison[Number(path[1])])
    : null;
  if (comparison?.id !== text) return false;
  const records = [exportPayload.current, ...(Array.isArray(exportPayload.saved) ? exportPayload.saved : [])];
  return records.some((record) => {
    const reviewRecord = objectRecord(record);
    return reviewRecord?.schema_version === "incision-review-record/v0.4" && reviewRecord.id === text;
  });
}

function isAllowedMetadataUuid(payload: unknown, path: string[], text: string): boolean {
  if (!isStrictUuid(text)) return false;
  if (candidateComparisonReferencesReviewRecord(payload, path, text)) return true;
  if (!reviewExportRecordAtPath(payload, path)) return false;
  const recordOffset = path[0] === "saved" ? 2 : 1;
  return path.length === recordOffset + 1 && path[recordOffset] === "id";
}

function isAllowedMetadataTimestamp(payload: unknown, path: string[], text: string): boolean {
  if (!isStrictIsoUtcTimestamp(text)) return false;
  const exportPayload = objectRecord(payload);
  const schemaVersion = exportPayload?.schema_version;
  if (path.length === 1 && path[0] === "exported_at") {
    return schemaVersion === "incision-review-export/v0.4"
      || schemaVersion === "tumor-input/v0.2";
  }
  if (schemaVersion !== "incision-review-export/v0.4") return false;
  if (!reviewExportRecordAtPath(payload, path)) return false;
  const recordOffset = path[0] === "saved" ? 2 : 1;
  if (path.length === recordOffset + 1 && path[recordOffset] === "created_at") return true;
  if (
    path.length === recordOffset + 2
    && path[recordOffset] === "review"
    && path[recordOffset + 1] === "reviewed_at"
  ) return true;
  return path.length === recordOffset + 3
    && path[recordOffset] === "audit_events"
    && /^\d+$/.test(path[recordOffset + 1])
    && path[recordOffset + 2] === "at";
}

function isAllowedMetadataValue(payload: unknown, path: string[], text: string): boolean {
  return isAllowedMetadataUuid(payload, path, text) || isAllowedMetadataTimestamp(payload, path, text);
}

export function auditExportPayload(payload: unknown): ExportPrivacyAudit {
  const violations: ExportPrivacyViolation[] = [];
  const visit = (value: unknown, path: string[] = []) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([key, child]) => visit(child, [...path, key]));
      return;
    }
    const leaf = path.at(-1) || "";
    const lowerLeaf = leaf.toLowerCase();
    const lowerPath = path.map((part) => part.toLowerCase());
    const text = exportText(value);
    if (RAW_MEDIA_FLAGS.includes(lowerLeaf) && value === true) {
      violations.push({ code: "raw_media_flag_true", path: path.join(".") || "$" });
    }
    if (
      lowerPath.includes("secondary_cues")
      && SECONDARY_CUE_FORBIDDEN_TRUE.includes(lowerLeaf)
      && value === true
    ) {
      violations.push({ code: `secondary_cue_${lowerLeaf}_true`, path: path.join(".") });
    }
    if (
      pathContains(lowerPath, SECRET_KEY_HINTS)
      && !lowerLeaf.endsWith("_present")
      && !valueIsRedacted(value)
    ) {
      violations.push({ code: "secret_value_present", path: path.join(".") });
    }
    if (pathContains(lowerPath, PII_KEY_HINTS) && text) {
      violations.push({ code: "pii_field_present", path: path.join(".") });
    }
    if (text && !isAllowedMetadataValue(payload, path, text) && (EMAIL_RE.test(text) || PHONE_RE.test(text))) {
      violations.push({ code: "pii_pattern_present", path: path.join(".") });
    }
    if (text && pathContains(lowerPath, MEDIA_KEY_HINTS) && looksLikeEmbeddedMedia(text)) {
      violations.push({ code: "embedded_media_payload", path: path.join(".") });
    }
  };
  visit(payload);
  return {
    schema_version: "browser-export-privacy-preflight/v0.1",
    passed: violations.length === 0,
    violation_count: violations.length,
    violations,
  };
}
