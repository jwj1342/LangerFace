#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEVICE_MATRIX_SCHEMA = "incision-overlay-device-matrix/v0.1";
const SUCCESS_SCENARIOS = {
  photo: ["front", "mild_yaw", "different_lighting"],
  video: ["slow_turn", "expression"],
  camera: ["fixed_camera"],
} as const;
const FAILURE_SCENARIOS = ["no_face", "multiple_faces", "fast_motion", "large_yaw", "occlusion", "low_light"];

type RecordValue = Record<string, any>;

const present = (value: unknown): boolean => typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
const finitePositive = (value: unknown): boolean => Number.isFinite(Number(value)) && Number(value) > 0;

function environmentComplete(sample: RecordValue): boolean {
  const environment = sample.environment || {};
  const resolution = environment.resolution || {};
  const base = present(environment.browser)
    && present(environment.browser_version)
    && present(environment.os)
    && finitePositive(resolution.width)
    && finitePositive(resolution.height)
    && present(environment.lighting);
  return base && (sample.source_kind === "photo" || finitePositive(environment.fps));
}

function reviewerComplete(sample: RecordValue): boolean {
  const review = sample.manual_review || {};
  return present(review.reviewer_id)
    && present(review.reviewer_role)
    && /^\d{4}-\d{2}-\d{2}/.test(String(review.reviewed_at || ""))
    && ["pass", "review", "fail"].includes(review.status);
}

function privacyPassed(sample: RecordValue): boolean {
  return sample.privacy?.raw_media_included === false
    && sample.privacy?.landmark_coordinates_included === false;
}

function stabilityPassed(sample: RecordValue): boolean {
  const stability = sample.engineering?.stability || {};
  return stability.passed === true
    && Number(stability.rms_px) <= 2
    && Number(stability.p95_px) <= 4
    && Number(stability.max_px) <= 8;
}

function successSamplePassed(sample: RecordValue): boolean {
  const engineering = sample.engineering || {};
  if (!environmentComplete(sample) || !reviewerComplete(sample) || !privacyPassed(sample)) return false;
  if (engineering.overlay_visible !== true || engineering.registration_passed !== true) return false;
  if (engineering.clear_preserved_media_and_rstl !== true || Number(engineering.console_error_count) !== 0) return false;
  if (sample.source_kind === "photo") return true;
  if (!stabilityPassed(sample)) return false;
  return sample.source_kind !== "video" || engineering.export_playable === true;
}

function failureSamplePassed(sample: RecordValue): boolean {
  return FAILURE_SCENARIOS.includes(sample.scenario)
    && environmentComplete(sample)
    && reviewerComplete(sample)
    && privacyPassed(sample)
    && ["review", "blocked"].includes(sample.engineering?.overlay_state)
    && present(sample.engineering?.visible_reason)
    && Number(sample.engineering?.console_error_count) === 0;
}

export function auditIncisionOverlayDeviceMatrix(payload: RecordValue, generatedAt = new Date().toISOString()) {
  const samples = Array.isArray(payload?.samples) ? payload.samples : [];
  const checks: RecordValue[] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });

  add("schema", payload?.schema_version === DEVICE_MATRIX_SCHEMA, `expected ${DEVICE_MATRIX_SCHEMA}`);
  add("unique_sample_ids", samples.length > 0 && new Set(samples.map((sample: RecordValue) => sample.id)).size === samples.length
    && samples.every((sample: RecordValue) => present(sample.id)), "every sample needs a unique non-empty id");

  for (const [sourceKind, scenarios] of Object.entries(SUCCESS_SCENARIOS)) {
    for (const scenario of scenarios) {
      const matches = samples.filter((sample: RecordValue) => sample.source_kind === sourceKind && sample.scenario === scenario);
      add(`${sourceKind}_${scenario}`, matches.some(successSamplePassed), `${sourceKind}/${scenario} needs one complete passing sample`);
    }
  }
  for (const scenario of FAILURE_SCENARIOS) {
    const matches = samples.filter((sample: RecordValue) => sample.scenario === scenario);
    add(`failure_${scenario}`, matches.some(failureSamplePassed), `${scenario} needs a visible review/blocked reason`);
  }
  add("all_samples_sanitized", samples.length > 0 && samples.every(privacyPassed), "raw media and landmark coordinates must remain outside the matrix");
  add("all_samples_reviewed", samples.length > 0 && samples.every(reviewerComplete), "every sample needs reviewer id, role, date, and result");
  add("all_environments_reproducible", samples.length > 0 && samples.every(environmentComplete), "browser, OS, resolution, lighting, and video/camera fps are required");

  return {
    schema_version: "incision-overlay-device-matrix-audit/v0.1",
    generated_at: generatedAt,
    passed: checks.every((check) => check.passed),
    sample_count: samples.length,
    source_counts: Object.fromEntries(["photo", "video", "camera"].map((kind) => [kind, samples.filter((sample: RecordValue) => sample.source_kind === kind).length])),
    checks,
    clinical_boundary: "Fixed-device engineering evidence only; this is not clinical AR validation or device certification.",
  };
}

function main(): number {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input");
  const outputIndex = args.indexOf("--output");
  if (inputIndex < 0 || !args[inputIndex + 1]) throw new Error("Usage: audit_incision_overlay_device_matrix.ts --input matrix.json [--output audit.json]");
  const payload = JSON.parse(fs.readFileSync(args[inputIndex + 1], "utf8"));
  const audit = auditIncisionOverlayDeviceMatrix(payload);
  const serialized = `${JSON.stringify(audit, null, 2)}\n`;
  if (outputIndex >= 0 && args[outputIndex + 1]) fs.writeFileSync(args[outputIndex + 1], serialized);
  else process.stdout.write(serialized);
  return audit.passed ? 0 : 1;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
