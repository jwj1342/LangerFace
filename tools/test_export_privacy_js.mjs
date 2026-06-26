import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "../web/node_modules/typescript/lib/typescript.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function importTypeScriptModule(rel) {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { auditExportPayload } = await importTypeScriptModule("web/src/services/exportPrivacy.ts");

function safeReviewExport() {
  return {
    schema_version: "incision-review-export/v0.3",
    exported_at: "2026-06-25T12:34:56.000Z",
    current: {
      schema_version: "incision-review-record/v0.3",
      provider_config: { api_key_present: true, api_key: "[redacted]" },
      privacy_audit: {
        raw_image_sent: false,
        raw_video_sent: false,
        contains_face_image: false,
      },
      secondary_cues: {
        present: true,
        used_for_geometry: false,
        used_for_agent_prompt: false,
        outputs: { cue_overlay: "review-overlay.png" },
      },
    },
    saved: [],
  };
}

let report = auditExportPayload(safeReviewExport());
assert.equal(report.schema_version, "browser-export-privacy-preflight/v0.1");
assert.equal(report.passed, true);
assert.equal(report.violation_count, 0);

const unsafe = safeReviewExport();
unsafe.current.provider_config.api_key = "sk-test-not-redacted";
unsafe.current.privacy_audit.raw_image_sent = true;
unsafe.current.patient_name = "Alice Example";
unsafe.current.review = { notes: "Call +1 555 010 9999 before review" };
unsafe.current.secondary_cues.used_for_geometry = true;
unsafe.current.secondary_cues.used_for_agent_prompt = true;
unsafe.current.secondary_cues.outputs.cue_overlay = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
report = auditExportPayload(unsafe);
const codes = new Set(report.violations.map((item) => item.code));
assert.equal(report.passed, false);
assert.ok(codes.has("secret_value_present"));
assert.ok(codes.has("raw_media_flag_true"));
assert.ok(codes.has("pii_field_present"));
assert.ok(codes.has("pii_pattern_present"));
assert.ok(codes.has("secondary_cue_used_for_geometry_true"));
assert.ok(codes.has("secondary_cue_used_for_agent_prompt_true"));
assert.ok(codes.has("embedded_media_payload"));

const timestampOnly = safeReviewExport();
timestampOnly.current.reviewed_at = "2026-06-25T12:34:56.000Z";
report = auditExportPayload(timestampOnly);
assert.equal(report.passed, true, "timestamp fields should not be mistaken for phone numbers");

console.log("test_export_privacy_js: browser export privacy preflight assertions passed");
