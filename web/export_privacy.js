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
const SECONDARY_CUE_FORBIDDEN_TRUE = ["used_for_geometry", "used_for_agent_prompt"];
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(^|[^\d])(?:\+?\d[\d .()\-]{8,}\d)(?!\d)/;

function pathContains(path, hints) {
  return path.some((part) => hints.some((hint) => part.toLowerCase().includes(hint)));
}

function exportText(value) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return "";
  return String(value).trim();
}

function valueIsRedacted(value) {
  const text = exportText(value);
  return !text || REDACTED_VALUES.has(text.toLowerCase());
}

function looksLikeEmbeddedMedia(text) {
  if (/^data:(image|video|application\/dicom)\//i.test(text)) return true;
  if (text.length < 256 || text.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(text) && /^(\/9j\/|iVBORw0KGgo|R0lGOD|UklGR|RElDTQ)/.test(text);
}

export function auditExportPayload(payload) {
  const violations = [];
  const visit = (value, path = []) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, child]) => visit(child, [...path, key]));
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
    if (text && !lowerLeaf.endsWith("_at") && (EMAIL_RE.test(text) || PHONE_RE.test(text))) {
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

