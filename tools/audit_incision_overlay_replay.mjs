#!/usr/bin/env node
// Offline QA for incision overlay replay on sanitized runtime landmark frames.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  measureIncisionOverlayJitter,
  measureIncisionOverlayRegistration,
  validateIncisionOverlay,
} from "../web/incision_overlay.js";

const REPLAY_QA_SCHEMA = "incision-overlay-replay-qa/v0.1";

function usage() {
  return [
    "Usage: node tools/audit_incision_overlay_replay.mjs --input replay.json [--output qa.json]",
    "",
    "Input JSON:",
    "  {",
    "    \"overlay\": { \"schema_version\": \"incision-overlay/v0.1\", ... },",
    "    \"triangles\": [[0,1,2], ...],",
    "    \"landmark_frames\": [[[x,y,z], ...], ...],",
    "    \"frame\": { \"width\": 640, \"height\": 480 }",
    "  }",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    input: "",
    output: "",
    generatedAt: new Date().toISOString(),
    maxRmsPx: 2,
    maxP95Px: 4,
    maxMaxPx: 8,
    minMappedPointCount: 3,
    minCandidatePointCount: 2,
    minTriangleAreaPx2: 1,
    minOverlayDiagonalPx: 4,
    maxOverlayFrameFraction: 0.95,
    maxOutOfFrameFraction: 0,
  };
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
    if (key === "--max-rms-px") { args.maxRmsPx = Number(next); i += 1; continue; }
    if (key === "--max-p95-px") { args.maxP95Px = Number(next); i += 1; continue; }
    if (key === "--max-max-px") { args.maxMaxPx = Number(next); i += 1; continue; }
    if (key === "--min-mapped-point-count") { args.minMappedPointCount = Number(next); i += 1; continue; }
    if (key === "--min-candidate-point-count") { args.minCandidatePointCount = Number(next); i += 1; continue; }
    if (key === "--min-triangle-area-px2") { args.minTriangleAreaPx2 = Number(next); i += 1; continue; }
    if (key === "--min-overlay-diagonal-px") { args.minOverlayDiagonalPx = Number(next); i += 1; continue; }
    if (key === "--max-overlay-frame-fraction") { args.maxOverlayFrameFraction = Number(next); i += 1; continue; }
    if (key === "--max-out-of-frame-fraction") { args.maxOutOfFrameFraction = Number(next); i += 1; continue; }
    throw new Error(`unknown argument: ${key}`);
  }
  if (!args.input) throw new Error("--input is required");
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function asFrameLandmarks(frame) {
  if (Array.isArray(frame)) return frame;
  if (Array.isArray(frame?.landmarks)) return frame.landmarks;
  if (Array.isArray(frame?.landmarks_px)) return frame.landmarks_px;
  return null;
}

function normalizeReplayInput(payload) {
  const overlay = payload?.overlay || payload?.incision_overlay?.overlay || payload?.incision_overlay;
  const triangles = payload?.triangles || payload?.topology?.triangles;
  const rawFrames = payload?.landmark_frames || payload?.frames || [];
  const landmarkFrames = rawFrames.map(asFrameLandmarks).filter(Array.isArray);
  const frame = payload?.frame || payload?.video_frame || {};
  return {
    overlay,
    triangles,
    landmarkFrames,
    frame: {
      width: Number(frame.width ?? payload?.frame_width ?? payload?.frameWidth),
      height: Number(frame.height ?? payload?.frame_height ?? payload?.frameHeight),
    },
    source_schema_version: payload?.schema_version || null,
  };
}

function countReasons(reports) {
  const counts = {};
  for (const report of reports) {
    for (const reason of report.reasons || [report.reason || "unknown"]) {
      counts[reason] = (counts[reason] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : 0;
}

export function buildIncisionOverlayReplayQa(payload, options = {}) {
  const normalized = normalizeReplayInput(payload);
  const frameKnown = Number.isFinite(normalized.frame.width) && Number.isFinite(normalized.frame.height)
    && normalized.frame.width > 0 && normalized.frame.height > 0;
  const registrationOptions = {
    frameWidth: frameKnown ? normalized.frame.width : null,
    frameHeight: frameKnown ? normalized.frame.height : null,
    minMappedPointCount: options.minMappedPointCount ?? 3,
    minCandidatePointCount: options.minCandidatePointCount ?? 2,
    minTriangleAreaPx2: options.minTriangleAreaPx2 ?? 1,
    minOverlayDiagonalPx: options.minOverlayDiagonalPx ?? 4,
    maxOverlayFrameFraction: options.maxOverlayFrameFraction ?? 0.95,
    maxOutOfFrameFraction: options.maxOutOfFrameFraction ?? 0,
    context: "offline_incision_overlay_replay",
  };
  const jitterOptions = {
    maxRmsPx: options.maxRmsPx ?? 2,
    maxP95Px: options.maxP95Px ?? 4,
    maxMaxPx: options.maxMaxPx ?? 8,
    context: "offline_incision_overlay_replay",
  };
  const overlayValid = validateIncisionOverlay(normalized.overlay);
  const trianglesValid = Array.isArray(normalized.triangles);
  const registrationFrames = normalized.landmarkFrames.map((landmarks, frameIndex) => ({
    frame_index: frameIndex,
    ...measureIncisionOverlayRegistration(
      normalized.overlay,
      landmarks,
      normalized.triangles,
      registrationOptions,
    ),
  }));
  const registrationPassedCount = registrationFrames.filter((report) => report.passed === true).length;
  const registrationFailedCount = registrationFrames.length - registrationPassedCount;
  const stability = measureIncisionOverlayJitter(
    normalized.overlay,
    normalized.landmarkFrames,
    normalized.triangles,
    jitterOptions,
  );
  const passed = Boolean(
    overlayValid
    && trianglesValid
    && registrationFrames.length > 0
    && registrationFailedCount === 0
    && stability.passed === true,
  );
  const reason = passed
    ? "offline_overlay_replay_passed"
    : (
      !overlayValid ? "invalid_overlay"
        : !trianglesValid ? "missing_triangles"
          : registrationFailedCount > 0 ? "registration_frame_failure"
            : stability.reason || "stability_failure"
    );
  return {
    schema_version: REPLAY_QA_SCHEMA,
    generated_at: options.generatedAt || new Date().toISOString(),
    generated_by: "tools/audit_incision_overlay_replay.mjs",
    source_schema_version: normalized.source_schema_version,
    passed,
    reason,
    overlay_valid: overlayValid,
    triangles_present: trianglesValid,
    frame: frameKnown ? normalized.frame : null,
    frame_count: normalized.landmarkFrames.length,
    registration_summary: {
      frame_count: registrationFrames.length,
      passed_count: registrationPassedCount,
      failed_count: registrationFailedCount,
      pass_rate: ratio(registrationPassedCount, registrationFrames.length),
      reason_counts: countReasons(registrationFrames),
      first_failed_frame_index: registrationFrames.find((report) => report.passed !== true)?.frame_index ?? null,
    },
    stability,
    registration_frames: registrationFrames,
    clinical_boundary: (
      "Offline replay QA uses sanitized surface refs and runtime landmarks only. "
      + "It is an engineering regression check, not patient-specific clinical AR registration."
    ),
  };
}

export function loadReplayInput(filePath) {
  return readJson(filePath);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const input = loadReplayInput(args.input);
    const report = buildIncisionOverlayReplayQa(input, args);
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (args.output) {
      fs.mkdirSync(path.dirname(args.output), { recursive: true });
      fs.writeFileSync(args.output, text, "utf8");
      console.log(`[ok] ${args.output} ${report.frame_count} frames pass=${report.passed}`);
    } else {
      process.stdout.write(text);
    }
  } catch (error) {
    console.error(`[error] ${error.message}`);
    console.error(usage());
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(currentFile).href) {
  main();
}
