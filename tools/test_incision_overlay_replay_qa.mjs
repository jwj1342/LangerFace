// Dependency-free tests for offline incision overlay replay QA.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIncisionOverlayReplayQa, replayQaCsvRows } from "./audit_incision_overlay_replay.mjs";
import { __incisionOverlayForTests as T } from "../web/incision_overlay.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const verts = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 10, 0],
  [10, 10, 0],
];
const tris = [[0, 1, 2], [1, 3, 2]];
const landmarks = [
  [0, 0, 0],
  [100, 0, 0],
  [0, 100, 0],
  [100, 100, 0],
];

const record = {
  label: "复放候选",
  tumor: {
    kind: "subcutaneous",
    center: [4, 2, 0],
    diameter_mm: 10,
    boundary: [[3, 2, 0], [4, 3, 0], [5, 2, 0], [3, 2, 0]],
  },
  candidate: {
    type: "linear",
    polyline: [[2, 2, 0], [8, 2, 0]],
    length_mm: 12.5,
  },
  guardrails: { passed: true },
  review: { status: "approved_for_discussion", reviewer: "测试医生", notes: "同意用于研究讨论" },
  guardrail_summary: { passed: true, high_codes: [], medium_codes: [] },
  review_gate: {
    reviewer_required: true,
    reviewer_present: true,
    notes_required_for_high_guardrails: false,
    notes_present: true,
    high_guardrail_codes: [],
    approval_ready: true,
    live_overlay_ready: true,
    reason: "approved_candidate_ready_for_research_overlay",
  },
};

const overlay = T.compileIncisionOverlay(record, verts, tris);
const shifted = (dx, dy) => landmarks.map(([x, y, z]) => [x + dx, y + dy, z]);

const stableInput = {
  schema_version: "incision-overlay-replay-input/v0.1",
  overlay,
  triangles: tris,
  frame: { width: 120, height: 120 },
  landmark_frames: [shifted(0, 0), shifted(0.2, 0.1), shifted(0.1, -0.1)],
};
const stableReport = buildIncisionOverlayReplayQa(stableInput, { generatedAt: "2026-06-24T00:00:00Z" });
assert.equal(stableReport.schema_version, "incision-overlay-replay-qa/v0.1");
assert.equal(stableReport.passed, true, "stable replay passes registration and jitter gates");
assert.equal(stableReport.reason, "offline_overlay_replay_passed");
assert.equal(stableReport.overlay_valid, true);
assert.equal(stableReport.registration_summary.passed_count, 3);
assert.equal(stableReport.registration_summary.failed_count, 0);
assert.equal(stableReport.registration_summary.pass_rate, 1);
assert.equal(stableReport.stability.schema_version, "incision-overlay-stability/v0.1");
assert.equal(stableReport.registration_frames[0].schema_version, "incision-overlay-registration/v0.1");
assert.ok(stableReport.clinical_boundary.includes("not patient-specific clinical AR registration"));
const csvRows = replayQaCsvRows(stableReport, { source: "stable-replay.json" });
assert.equal(csvRows.length, 4, "CSV export includes one summary row and one row per frame");
assert.equal(csvRows[0].record_type, "summary");
assert.equal(csvRows[0].source, "stable-replay.json");
assert.equal(csvRows[0].registration_pass_rate, 1);
assert.equal(csvRows[1].record_type, "registration_frame");
assert.equal(csvRows[1].mapped_point_count, stableReport.registration_frames[0].mapped_point_count);
assert.equal(csvRows[1].reasons, "runtime_projection_registration_ready");

const unstableInput = {
  ...stableInput,
  landmark_frames: [shifted(0, 0), shifted(80, 0), shifted(0, 0)],
};
const unstableReport = buildIncisionOverlayReplayQa(unstableInput);
assert.equal(unstableReport.passed, false, "out-of-frame replay fails QA");
assert.equal(unstableReport.reason, "registration_frame_failure");
assert.equal(unstableReport.registration_summary.failed_count, 1);
assert.equal(unstableReport.registration_summary.first_failed_frame_index, 1);
assert.ok(unstableReport.registration_summary.reason_counts.out_of_frame_projection >= 1);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "incision-overlay-replay-"));
const inputPath = path.join(tmpDir, "replay.json");
const outputPath = path.join(tmpDir, "qa.json");
const csvOutputPath = path.join(tmpDir, "qa.csv");
fs.writeFileSync(inputPath, JSON.stringify(stableInput), "utf8");
const cli = spawnSync(
  process.execPath,
  [
    "tools/audit_incision_overlay_replay.mjs",
    "--input",
    inputPath,
    "--output",
    outputPath,
    "--csv-output",
    csvOutputPath,
    "--generated-at",
    "2026-06-24T00:00:00Z",
  ],
  { cwd: ROOT, text: true, encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
assert.ok(cli.stdout.includes("[ok]"), "CLI reports successful output");
assert.ok(cli.stdout.includes("replay CSV"), "CLI reports CSV output");
const cliReport = JSON.parse(fs.readFileSync(outputPath, "utf8"));
assert.equal(cliReport.passed, true, "CLI output matches stable QA pass");
assert.equal(cliReport.frame_count, 3);
const cliCsv = fs.readFileSync(csvOutputPath, "utf8");
assert.ok(cliCsv.includes("record_type,source,schema_version"), "CSV has a stable header");
assert.ok(cliCsv.includes("summary,replay.json,incision-overlay-replay-qa/v0.1"), "CSV includes summary row");
assert.ok(cliCsv.includes("registration_frame,replay.json,incision-overlay-registration/v0.1"), "CSV includes frame rows");

console.log("test_incision_overlay_replay_qa: offline replay QA assertions passed");
