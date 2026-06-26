#!/usr/bin/env node
// Build sanitized #19 incision overlay acceptance evidence from QA artifacts.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildIncisionOverlayAcceptanceAudit } from "./audit_incision_overlay_acceptance.mjs";

const EVIDENCE_SCHEMA = "incision-overlay-acceptance-evidence/v0.1";
const RUNTIME_SCHEMA = "incision-overlay-runtime-diagnostics/v0.1";
const REPLAY_SCHEMA = "incision-overlay-replay-qa/v0.1";
const REGISTRATION_SCHEMA = "incision-overlay-registration/v0.1";
const STABILITY_SCHEMA = "incision-overlay-stability/v0.1";

function usage() {
  return [
    "Usage: node tools/build_incision_overlay_acceptance_evidence.mjs [options]",
    "",
    "Required in normal CLI use:",
    "  --output evidence.json",
    "",
    "Inputs may be repeated:",
    "  --photo-diagnostics photo_diagnostics.json",
    "  --video-replay video_replay_qa.json",
    "  --video-diagnostics video_diagnostics.json",
    "  --video-export export_contract.json",
    "  --camera-diagnostics camera_diagnostics.json",
    "  --resource-qa resource_qa.json",
    "  --diagnostics browser_diagnostics.json",
    "  --input already_sanitized_payload.json",
    "",
    "Optional:",
    "  --audit-output acceptance_audit.json",
    "  --generated-at 2026-06-25T00:00:00Z",
    "  --no-fail",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    generatedAt: new Date().toISOString(),
    input: [],
    photoDiagnostics: [],
    videoReplay: [],
    videoDiagnostics: [],
    videoExport: [],
    cameraDiagnostics: [],
    resourceQa: [],
    diagnostics: [],
    output: "",
    auditOutput: "",
    noFail: false,
  };
  const pushFile = (key, value) => {
    if (!value) throw new Error(`${key} requires a file path`);
    args[key].push(value);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--help" || key === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (key === "--input") { pushFile("input", next); i += 1; continue; }
    if (key === "--photo-diagnostics") { pushFile("photoDiagnostics", next); i += 1; continue; }
    if (key === "--video-replay") { pushFile("videoReplay", next); i += 1; continue; }
    if (key === "--video-diagnostics") { pushFile("videoDiagnostics", next); i += 1; continue; }
    if (key === "--video-export") { pushFile("videoExport", next); i += 1; continue; }
    if (key === "--camera-diagnostics") { pushFile("cameraDiagnostics", next); i += 1; continue; }
    if (key === "--resource-qa") { pushFile("resourceQa", next); i += 1; continue; }
    if (key === "--diagnostics") { pushFile("diagnostics", next); i += 1; continue; }
    if (key === "--output") { args.output = next || ""; i += 1; continue; }
    if (key === "--audit-output") { args.auditOutput = next || ""; i += 1; continue; }
    if (key === "--generated-at") { args.generatedAt = next || ""; i += 1; continue; }
    if (key === "--no-fail") { args.noFail = true; continue; }
    throw new Error(`unknown argument: ${key}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function schemaVersion(payload) {
  return payload?.schema_version || payload?.schemaVersion || "";
}

function runtimeFromDiagnostics(payload) {
  if (schemaVersion(payload) === RUNTIME_SCHEMA) return payload;
  return payload?.sections?.incision_overlay_runtime
    || payload?.incision_overlay_runtime
    || payload?.runtime_diagnostics
    || null;
}

function registrationFromPayload(payload) {
  if (schemaVersion(payload) === REGISTRATION_SCHEMA) return payload;
  return payload?.registration || runtimeFromDiagnostics(payload)?.registration || null;
}

function stabilityFromPayload(payload) {
  if (schemaVersion(payload) === STABILITY_SCHEMA) return payload;
  return payload?.stability || runtimeFromDiagnostics(payload)?.stability || payload?.replay_qa?.stability || null;
}

function resourceReportFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  for (const key of ["resource_qa", "resources", "asset_qa", "dist_assets"]) {
    if (payload[key] && typeof payload[key] === "object") return payload[key];
  }
  if (
    payload.passed === true
    || payload.no_404 === true
    || payload.all_200 === true
    || payload.missing_count !== undefined
    || payload.not_found_count !== undefined
  ) {
    return payload;
  }
  return null;
}

function exportContractFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload.export || payload.export_contract || payload.recording || payload;
  if (
    candidate.mime_type !== undefined
    || candidate.mimeType !== undefined
    || candidate.blob_size_bytes !== undefined
    || candidate.size_bytes !== undefined
    || candidate.byte_length !== undefined
    || candidate.playable !== undefined
    || candidate.webm_playable !== undefined
  ) {
    return candidate;
  }
  return null;
}

const RAW_CONTAINER_KEYS = new Set([
  "canvas_pixels",
  "face_image",
  "frame_pixels",
  "image_data",
  "image_pixels",
  "landmark_frames",
  "landmarks",
  "landmarks_px",
  "raw_frame",
  "raw_image",
  "raw_landmarks",
  "raw_pixels",
  "raw_video",
  "video_data",
  "video_frame_pixels",
]);

const RAW_FLAG_KEYS = new Set([
  "contains_face_image",
  "contains_raw_media",
  "exported_landmarks",
  "exported_raw_pixels",
  "raw_image_sent",
  "raw_video_sent",
]);

function rawPayloadPaths(value, pathParts = []) {
  const hits = [];
  if (!value || typeof value !== "object") return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...rawPayloadPaths(item, [...pathParts, String(index)])));
    return hits;
  }
  for (const [key, child] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    const childPath = [...pathParts, key];
    if (RAW_CONTAINER_KEYS.has(lowerKey) && child !== null && child !== undefined) {
      hits.push(childPath.join("."));
      continue;
    }
    if (
      RAW_FLAG_KEYS.has(lowerKey)
      && child !== false
      && child !== null
      && child !== undefined
    ) {
      hits.push(childPath.join("."));
      continue;
    }
    if (typeof child === "string" && (child.startsWith("data:image/") || child.startsWith("data:video/"))) {
      hits.push(childPath.join("."));
      continue;
    }
    hits.push(...rawPayloadPaths(child, childPath));
  }
  return hits;
}

function assertSanitized(payload, label) {
  const hits = rawPayloadPaths(payload);
  if (hits.length) {
    throw new Error(`${label} contains raw media or landmark payloads: ${hits.slice(0, 8).join(", ")}`);
  }
}

function sanitizeDiagnostics(payload) {
  if (!payload || typeof payload !== "object") return null;
  const root = payload.diagnostics && payload.diagnostics !== payload ? payload.diagnostics : payload;
  if (!root || typeof root !== "object") return null;
  const hasDiagnostics = root.counters || root.events || root.schemaVersion || root.schema_version || root.exportedAt;
  if (!hasDiagnostics) return null;
  assertSanitized(root, "diagnostics");
  return {
    schemaVersion: root.schemaVersion || root.schema_version || null,
    exportedAt: root.exportedAt || root.exported_at || null,
    counters: cloneJson(root.counters || {}),
    events: asArray(root.events).map((event) => ({
      t: event?.t || event?.time || null,
      level: event?.level || null,
      event: event?.event || event?.message || "",
      message: event?.message || event?.event || "",
    })),
  };
}

function mergeDiagnostics(items) {
  const diagnostics = {
    schemaVersion: "acceptance-evidence-diagnostics/v0.1",
    counters: {},
    events: [],
  };
  for (const item of items.filter(Boolean)) {
    for (const [key, value] of Object.entries(item.counters || {})) {
      diagnostics.counters[key] = (diagnostics.counters[key] || 0) + Number(value || 0);
    }
    diagnostics.events.push(...asArray(item.events));
  }
  return Object.keys(diagnostics.counters).length || diagnostics.events.length ? diagnostics : null;
}

function resourcePassed(report) {
  if (!report || typeof report !== "object") return false;
  return Boolean(
    report.passed === true
    || report.no_404 === true
    || report.all_200 === true
    || Number(report.missing_count ?? report.not_found_count ?? Number.NaN) === 0,
  );
}

function mergeResourceQa(reports) {
  const cleanReports = reports.filter(Boolean).map((report) => {
    assertSanitized(report, "resource QA");
    return cloneJson(report);
  });
  if (!cleanReports.length) return null;
  const checkedCount = cleanReports.reduce((sum, report) => sum + Number(report.checked_count ?? report.checkedCount ?? 0), 0);
  const missingCount = cleanReports.reduce((sum, report) => sum + Number(report.missing_count ?? report.not_found_count ?? 0), 0);
  return {
    passed: cleanReports.every(resourcePassed),
    checked_count: checkedCount || null,
    missing_count: missingCount,
    reports: cleanReports.map((report) => ({
      passed: resourcePassed(report),
      checked_count: report.checked_count ?? report.checkedCount ?? null,
      missing_count: report.missing_count ?? report.not_found_count ?? null,
      source: report.source || report.name || null,
    })),
  };
}

function sanitizeExportContract(payload) {
  const contract = exportContractFromPayload(payload);
  if (!contract) return null;
  assertSanitized(contract, "video export contract");
  return {
    passed: contract.passed === undefined ? undefined : contract.passed === true,
    playable: contract.playable === undefined ? undefined : contract.playable === true,
    webm_playable: contract.webm_playable === undefined ? undefined : contract.webm_playable === true,
    mime_type: contract.mime_type || contract.mimeType || contract.type || null,
    blob_size_bytes: Number(contract.blob_size_bytes ?? contract.size_bytes ?? contract.byte_length ?? contract.size ?? 0),
    source: contract.source || contract.filename || contract.name || null,
  };
}

function runtimeEvidenceEntry(payload, sourceKind) {
  const runtime = runtimeFromDiagnostics(payload) || {};
  assertSanitized(payload, `${sourceKind} diagnostics`);
  const entry = {
    source_kind: sourceKind,
    registration: cloneJson(registrationFromPayload(payload)),
    stability: cloneJson(stabilityFromPayload(payload)),
    runtime_diagnostics: cloneJson(runtime),
  };
  const diagnostics = sanitizeDiagnostics(payload);
  if (diagnostics) entry.diagnostics = diagnostics;
  for (const key of Object.keys(entry)) {
    if (entry[key] === undefined || entry[key] === null) delete entry[key];
  }
  return entry;
}

function replayEvidenceEntry(payload) {
  assertSanitized(payload, "video replay QA");
  if (schemaVersion(payload) !== REPLAY_SCHEMA) {
    throw new Error(`video replay QA must use ${REPLAY_SCHEMA}`);
  }
  return {
    source_kind: "video",
    replay_qa: cloneJson(payload),
  };
}

function exportEvidenceEntry(payload) {
  const contract = sanitizeExportContract(payload);
  if (!contract) throw new Error("video export input does not look like an export contract");
  return {
    source_kind: "video",
    export: contract,
  };
}

function alreadyPackagedEvidence(payload, accumulator) {
  assertSanitized(payload, "packaged acceptance evidence");
  accumulator.evidence.push(...asArray(payload.evidence).map(cloneJson));
  const resource = resourceReportFromPayload(payload);
  if (resource) accumulator.resourceReports.push(resource);
  const diagnostics = sanitizeDiagnostics(payload);
  if (diagnostics) accumulator.diagnostics.push(diagnostics);
}

function classifyGenericInput(payload, accumulator) {
  const version = schemaVersion(payload);
  if (version === EVIDENCE_SCHEMA || Array.isArray(payload?.evidence)) {
    alreadyPackagedEvidence(payload, accumulator);
    return;
  }
  if (version === REPLAY_SCHEMA) {
    accumulator.evidence.push(replayEvidenceEntry(payload));
    return;
  }
  const resource = resourceReportFromPayload(payload);
  if (resource) {
    accumulator.resourceReports.push(resource);
    return;
  }
  const exportContract = exportContractFromPayload(payload);
  if (exportContract) {
    accumulator.evidence.push(exportEvidenceEntry(payload));
    return;
  }
  const runtime = runtimeFromDiagnostics(payload);
  if (runtime) {
    accumulator.evidence.push(runtimeEvidenceEntry(payload, payload.source_kind || payload.sourceKind || runtime.source_kind || "camera"));
    return;
  }
  const diagnostics = sanitizeDiagnostics(payload);
  if (diagnostics) {
    accumulator.diagnostics.push(diagnostics);
    return;
  }
  throw new Error(`cannot classify sanitized input with schema_version=${version || "unknown"}`);
}

export function buildIncisionOverlayAcceptanceEvidence(sources = {}, options = {}) {
  const accumulator = {
    evidence: [],
    resourceReports: [],
    diagnostics: [],
  };
  const sourceCounts = {
    generic_input: asArray(sources.genericInputs || sources.input).length,
    photo_diagnostics: asArray(sources.photoDiagnostics).length,
    video_replay: asArray(sources.videoReplays || sources.videoReplay).length,
    video_diagnostics: asArray(sources.videoDiagnostics).length,
    video_export: asArray(sources.videoExports || sources.videoExport).length,
    camera_diagnostics: asArray(sources.cameraDiagnostics).length,
    resource_qa: asArray(sources.resourceQa).length,
    diagnostics: asArray(sources.diagnostics).length,
  };

  for (const payload of asArray(sources.genericInputs || sources.input)) classifyGenericInput(payload, accumulator);
  for (const payload of asArray(sources.photoDiagnostics)) accumulator.evidence.push(runtimeEvidenceEntry(payload, "photo"));
  for (const payload of asArray(sources.videoReplays || sources.videoReplay)) accumulator.evidence.push(replayEvidenceEntry(payload));
  for (const payload of asArray(sources.videoDiagnostics)) accumulator.evidence.push(runtimeEvidenceEntry(payload, "video"));
  for (const payload of asArray(sources.videoExports || sources.videoExport)) accumulator.evidence.push(exportEvidenceEntry(payload));
  for (const payload of asArray(sources.cameraDiagnostics)) accumulator.evidence.push(runtimeEvidenceEntry(payload, "camera"));
  for (const payload of asArray(sources.resourceQa)) accumulator.resourceReports.push(resourceReportFromPayload(payload) || payload);
  for (const payload of asArray(sources.diagnostics)) {
    const diagnostics = sanitizeDiagnostics(payload);
    if (diagnostics) accumulator.diagnostics.push(diagnostics);
  }

  const evidence = {
    schema_version: EVIDENCE_SCHEMA,
    generated_at: options.generatedAt || new Date().toISOString(),
    generated_by: "tools/build_incision_overlay_acceptance_evidence.mjs",
    evidence_sources: sourceCounts,
    evidence: accumulator.evidence,
    privacy: {
      raw_media_or_landmark_payloads: false,
      builder_rejects_raw_payloads: true,
    },
    clinical_boundary: (
      "This evidence package contains sanitized engineering QA only. "
      + "It does not include photos, videos, canvas pixels, landmark coordinates, or clinical AR validation."
    ),
  };
  const resourceQa = mergeResourceQa(accumulator.resourceReports);
  if (resourceQa) evidence.resource_qa = resourceQa;
  const diagnostics = mergeDiagnostics(accumulator.diagnostics);
  if (diagnostics) evidence.diagnostics = diagnostics;
  assertSanitized(evidence, "acceptance evidence output");
  return evidence;
}

function loadFiles(files) {
  return files.map(readJson);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const evidence = buildIncisionOverlayAcceptanceEvidence({
    genericInputs: loadFiles(args.input),
    photoDiagnostics: loadFiles(args.photoDiagnostics),
    videoReplays: loadFiles(args.videoReplay),
    videoDiagnostics: loadFiles(args.videoDiagnostics),
    videoExports: loadFiles(args.videoExport),
    cameraDiagnostics: loadFiles(args.cameraDiagnostics),
    resourceQa: loadFiles(args.resourceQa),
    diagnostics: loadFiles(args.diagnostics),
  }, { generatedAt: args.generatedAt });

  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  if (args.output) {
    fs.writeFileSync(args.output, evidenceText);
  } else {
    console.log(evidenceText.trimEnd());
  }

  if (!args.auditOutput) return 0;
  const audit = buildIncisionOverlayAcceptanceAudit([evidence], { generatedAt: args.generatedAt });
  fs.writeFileSync(args.auditOutput, `${JSON.stringify(audit, null, 2)}\n`);
  return audit.passed || args.noFail ? 0 : 1;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 2;
  }
}
