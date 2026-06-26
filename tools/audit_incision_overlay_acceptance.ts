#!/usr/bin/env node
// Engineering acceptance audit for issue #19 incision overlay evidence.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ACCEPTANCE_SCHEMA = "incision-overlay-acceptance-audit/v0.1";
const EVIDENCE_SCHEMA = "incision-overlay-acceptance-evidence/v0.1";
const RUNTIME_SCHEMA = "incision-overlay-runtime-diagnostics/v0.1";
const REPLAY_SCHEMA = "incision-overlay-replay-qa/v0.1";
const REGISTRATION_SCHEMA = "incision-overlay-registration/v0.1";
const STABILITY_SCHEMA = "incision-overlay-stability/v0.1";
const LOCAL_REGION_QUALITY_SCHEMA = "rstl-local-region-quality-gate/v0.1";

function usage() {
  return [
    "Usage: node tools/audit_incision_overlay_acceptance.ts --input evidence.json [--output audit.json]",
    "",
    "Input is sanitized evidence only. It may contain:",
    "  { schema_version: \"incision-overlay-acceptance-evidence/v0.1\", evidence: [...] }",
    "  diagnostics snapshots with sections.incision_overlay_runtime",
    "  incision-overlay-replay-qa/v0.1 reports",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { input: "", output: "", generatedAt: new Date().toISOString(), noFail: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--help" || key === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (key === "--input") { args.input = next || ""; i += 1; continue; }
    if (key === "--output") { args.output = next || ""; i += 1; continue; }
    if (key === "--generated-at") { args.generatedAt = next || ""; i += 1; continue; }
    if (key === "--no-fail") { args.noFail = true; continue; }
    throw new Error(`unknown argument: ${key}`);
  }
  if (!args.input) throw new Error("--input is required");
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sourceKind(value) {
  const raw = String(value?.source_kind || value?.sourceKind || value?.kind || "").toLowerCase();
  if (raw === "image") return "photo";
  if (["photo", "video", "camera", "scan3d"].includes(raw)) return raw;
  return "";
}

function runtimeFromDiagnostics(payload) {
  if (payload?.schema_version === RUNTIME_SCHEMA) return payload;
  return payload?.runtime_diagnostics
    || payload?.sections?.incision_overlay_runtime
    || payload?.incision_overlay_runtime
    || null;
}

function replayFromEvidence(entry) {
  if (entry?.schema_version === REPLAY_SCHEMA) return entry;
  return entry?.replay_qa || entry?.overlay_replay_qa || entry?.incision_overlay_replay_qa || null;
}

function registrationFromEvidence(entry) {
  if (entry?.schema_version === REGISTRATION_SCHEMA) return entry;
  return entry?.registration || runtimeFromDiagnostics(entry)?.registration || null;
}

function stabilityFromEvidence(entry) {
  if (entry?.schema_version === STABILITY_SCHEMA) return entry;
  return entry?.stability || runtimeFromDiagnostics(entry)?.stability || replayFromEvidence(entry)?.stability || null;
}

function localRegionQualityFromEvidence(entry) {
  if (entry?.schema_version === LOCAL_REGION_QUALITY_SCHEMA) return entry;
  const localQuality = entry?.local_region_quality || runtimeFromDiagnostics(entry)?.local_region_quality || null;
  return localQuality?.schema_version === LOCAL_REGION_QUALITY_SCHEMA ? localQuality : null;
}

function exportEvidence(entry) {
  return entry?.export || entry?.export_contract || entry?.recording || {};
}

function exportPlayable(entry) {
  const exp = exportEvidence(entry);
  if (exp.passed === true || exp.playable === true || exp.webm_playable === true) return true;
  const mime = String(exp.mime_type || exp.mimeType || "").toLowerCase();
  const size = Number(exp.blob_size_bytes ?? exp.byte_length ?? exp.size_bytes ?? 0);
  return mime === "video/webm" && size > 0;
}

function registrationReady(report) {
  if (!report || report.schema_version !== REGISTRATION_SCHEMA || report.passed !== true) return false;
  if (Number(report.mapped_point_count ?? 0) < 3) return false;
  if (Number(report.candidate_point_count ?? 0) < 2) return false;
  if (report.tumor_center_mapped === false) return false;
  return true;
}

function stabilityReady(report) {
  if (!report || report.schema_version !== STABILITY_SCHEMA || report.passed !== true) return false;
  const overall = report.overall || {};
  const thresholds = report.thresholds || {};
  const rms = Number(overall.rms_px);
  const p95 = Number(overall.p95_px);
  const maxPx = Number(overall.max_px);
  if (Number.isFinite(rms) && Number.isFinite(Number(thresholds.max_rms_px)) && rms > Number(thresholds.max_rms_px)) return false;
  if (Number.isFinite(p95) && Number.isFinite(Number(thresholds.max_p95_px)) && p95 > Number(thresholds.max_p95_px)) return false;
  if (Number.isFinite(maxPx) && Number.isFinite(Number(thresholds.max_max_px)) && maxPx > Number(thresholds.max_max_px)) return false;
  return true;
}

function replayReady(report) {
  return Boolean(report && report.schema_version === REPLAY_SCHEMA && report.passed === true);
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function localRegionQualitySummary(entries) {
  const reports = entries.map(localRegionQualityFromEvidence).filter(Boolean);
  const activeRegions = reports.flatMap((report) => report.active_regions || []);
  const activeRegionRecords = reports.flatMap((report) => (
    (report.regions || []).filter((region) => region && region.action && region.action !== "normal")
  ));
  return {
    present_count: reports.length,
    passed_count: reports.filter((report) => report.passed === true).length,
    failed_count: reports.filter((report) => report.passed === false).length,
    reason_counts: countBy(reports, (report) => report.reason || "unknown"),
    active_region_counts: countBy(activeRegions, (regionId) => String(regionId || "unknown")),
    action_counts: countBy(activeRegionRecords, (region) => region.action || "unknown"),
    source_kind_counts: countBy(reports, (report) => report.source_kind || "unknown"),
    clinical_boundary: (
      "Local region quality is a review signal for eye/brow and mouth overlay confidence. "
      + "It does not by itself prove or disprove clinical AR registration."
    ),
  };
}

function rawMediaFlags(value, pathParts = []) {
  const hits = [];
  if (!value || typeof value !== "object") return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...rawMediaFlags(item, [...pathParts, String(index)])));
    return hits;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (
      ["raw_image_sent", "raw_video_sent", "contains_face_image", "contains_raw_media", "exported_raw_pixels", "exported_landmarks"].includes(key)
      && child !== false
      && child !== null
      && child !== undefined
    ) {
      hits.push(childPath.join("."));
    }
    if (typeof child === "string" && child.startsWith("data:image/")) hits.push(childPath.join("."));
    if (typeof child === "string" && child.startsWith("data:video/")) hits.push(childPath.join("."));
    hits.push(...rawMediaFlags(child, childPath));
  }
  return hits;
}

function runtimeErrorFree(payloads, entries) {
  const runtimeEvents = [];
  const runtimeCounters = [];
  const inspect = (payload, source) => {
    if (payload?.diagnostics && payload.diagnostics !== payload) {
      inspect(payload.diagnostics, `${source}.diagnostics`);
    }
    const counters = payload?.counters || {};
    for (const [key, value] of Object.entries(counters)) {
      if ((key === "runtime.error" || key === "runtime.unhandledrejection") && Number(value) > 0) {
        runtimeCounters.push({ source, key, count: Number(value) });
      }
    }
    for (const event of payload?.events || []) {
      const name = event?.event;
      if (name === "runtime.error" || name === "runtime.unhandledrejection") {
        runtimeEvents.push({ source, event: name });
      }
    }
  };
  payloads.forEach((payload, index) => inspect(payload, `input[${index}]`));
  entries.forEach((entry, index) => inspect(entry.diagnostics || entry, `evidence[${index}]`));
  return {
    passed: runtimeCounters.length === 0 && runtimeEvents.length === 0,
    counters: runtimeCounters,
    events: runtimeEvents,
  };
}

function resourcesAvailable(payloads, entries) {
  const candidates = [];
  const collect = (value) => {
    if (!value || typeof value !== "object") return;
    for (const key of ["resource_qa", "resources", "asset_qa", "dist_assets"]) {
      if (value[key] && typeof value[key] === "object") candidates.push(value[key]);
    }
  };
  payloads.forEach(collect);
  entries.forEach(collect);
  const passed = candidates.some((item) => (
    item.passed === true
    || item.no_404 === true
    || item.all_200 === true
    || Number(item.missing_count ?? item.not_found_count ?? 1) === 0
  ));
  return { passed, evidence_count: candidates.length };
}

function normalizeEntries(payloads) {
  const entries = [];
  for (const payload of payloads) {
    if (Array.isArray(payload)) {
      entries.push(...normalizeEntries(payload));
      continue;
    }
    if (!payload || typeof payload !== "object") continue;
    if (payload.schema_version === EVIDENCE_SCHEMA && Array.isArray(payload.evidence)) {
      entries.push(...payload.evidence);
      continue;
    }
    if (Array.isArray(payload.evidence)) {
      entries.push(...payload.evidence);
      continue;
    }
    if (payload.schema_version === REPLAY_SCHEMA) {
      entries.push({ source_kind: "video", replay_qa: payload });
      continue;
    }
    const runtime = runtimeFromDiagnostics(payload);
    if (runtime) {
      entries.push({
        source_kind: payload.source_kind || payload.sourceKind || runtime.source_kind || runtime.sourceKind || "camera",
        diagnostics: payload,
        registration: runtime.registration,
        stability: runtime.stability,
      });
      continue;
    }
    entries.push(payload);
  }
  return entries;
}

function entrySummary(entry) {
  const replay = replayFromEvidence(entry);
  const registration = registrationFromEvidence(entry);
  const stability = stabilityFromEvidence(entry);
  const localRegionQuality = localRegionQualityFromEvidence(entry);
  return {
    source_kind: sourceKind(entry) || "unknown",
    registration_passed: registration?.passed === true,
    stability_passed: stability?.passed === true,
    replay_passed: replay?.passed === true,
    local_region_quality_passed: localRegionQuality?.passed ?? null,
    local_region_active_regions: localRegionQuality?.active_regions || [],
    export_playable: exportPlayable(entry),
  };
}

export function buildIncisionOverlayAcceptanceAudit(payloads, options = {}) {
  const normalizedPayloads = Array.isArray(payloads) ? payloads : [payloads];
  const entries = normalizeEntries(normalizedPayloads);
  const photoEntries = entries.filter((entry) => sourceKind(entry) === "photo");
  const videoEntries = entries.filter((entry) => sourceKind(entry) === "video");
  const cameraEntries = entries.filter((entry) => sourceKind(entry) === "camera");
  const photoReady = photoEntries.some((entry) => registrationReady(registrationFromEvidence(entry)));
  const videoStable = videoEntries.some((entry) => (
    replayReady(replayFromEvidence(entry))
    || (registrationReady(registrationFromEvidence(entry)) && stabilityReady(stabilityFromEvidence(entry)))
  ));
  const videoPlayable = videoEntries.some(exportPlayable);
  const cameraStable = cameraEntries.some((entry) => (
    registrationReady(registrationFromEvidence(entry)) && stabilityReady(stabilityFromEvidence(entry))
  ));
  const runtime = runtimeErrorFree(normalizedPayloads, entries);
  const resources = resourcesAvailable(normalizedPayloads, entries);
  const rawMediaLeaks = rawMediaFlags(normalizedPayloads);
  const localRegionQuality = localRegionQualitySummary(entries);
  const checks = {
    photo_overlay_ready: photoReady,
    video_overlay_stable: videoStable,
    video_export_playable: videoPlayable,
    camera_overlay_stable: cameraStable,
    runtime_error_free: runtime.passed,
    resources_available: resources.passed,
    sanitized_evidence_only: rawMediaLeaks.length === 0,
  };
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key);
  return {
    schema_version: ACCEPTANCE_SCHEMA,
    generated_at: options.generatedAt || new Date().toISOString(),
    generated_by: "tools/audit_incision_overlay_acceptance.ts",
    input_schema_versions: normalizedPayloads
      .map((payload) => payload?.schema_version)
      .filter(Boolean),
    passed: failures.length === 0,
    failures,
    checks,
    evidence_counts: {
      total: entries.length,
      photo: photoEntries.length,
      video: videoEntries.length,
      camera: cameraEntries.length,
      resource_qa: resources.evidence_count,
    },
    runtime_errors: runtime,
    raw_media_leak_paths: rawMediaLeaks,
    local_region_quality: localRegionQuality,
    evidence_summary: entries.map(entrySummary),
    clinical_boundary: (
      "This audit verifies engineering evidence for photo/video/camera incision overlay behavior. "
      + "It does not prove patient-specific clinical AR registration or surgical safety."
    ),
  };
}

export function auditFile(filePath, options = {}) {
  return buildIncisionOverlayAcceptanceAudit([readJson(filePath)], options);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = auditFile(args.input, { generatedAt: args.generatedAt });
  const text = JSON.stringify(report, null, 2);
  if (args.output) {
    fs.writeFileSync(args.output, `${text}\n`);
  } else {
    console.log(text);
  }
  return report.passed || args.noFail ? 0 : 1;
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
