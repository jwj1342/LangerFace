import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const htmlUrl = new URL("../web/compat/personalized/wrinkle_rstl_experiment.html", import.meta.url);
const sourceUrl = new URL("../web/compat/personalized/wrinkleRstlExperiment.ts", import.meta.url);
const viteUrl = new URL("../web/vite.config.ts", import.meta.url);
const atlasUrl = new URL("../web/assets/atlas_rstl.json", import.meta.url);

const [html, source, vite, atlas] = await Promise.all([
  readFile(htmlUrl, "utf8"),
  readFile(sourceUrl, "utf8"),
  readFile(viteUrl, "utf8"),
  readFile(atlasUrl, "utf8").then(JSON.parse),
]);

for (const id of [
  "imageInput", "fineLineInput", "runButton", "exportButton", "priorCanvas", "evidenceCanvas",
  "decisionCanvas", "refinedCanvas", "compareCanvas", "displacementCanvas",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing experiment control ${id}`);
}

assert.match(vite, /wrinkleRstlExperiment/);
assert.match(source, /vision_wasm_internal\.js\?url/);
assert.match(source, /vision_wasm_internal\.wasm\?url/);
assert.match(source, /ort-wasm-simd-threaded\.mjs\?url/);
assert.match(source, /ort-wasm-simd-threaded\.wasm\?url/);
assert.match(source, /wasmPaths:\s*\{\s*mjs:\s*ortWasmModuleUrl,\s*wasm:\s*ortWasmBinaryUrl\s*\}/);
assert.match(source, /verifySha256:\s*true/);
assert.match(source, /refineV6\(\{/);
assert.match(source, /exclusiveTrendMatching:\s*true/);
assert.match(source, /oneToOneTrendCurveMatching:\s*true/);
assert.match(source, /topologyRetryAttempts:\s*3/);
assert.match(source, /postAdherenceGate:\s*true/);
assert.match(source, /targetGapPx:/);
assert.match(source, /dataAttractionStrength:\s*20/);
assert.match(source, /maxCurvatureChangeDegrees:\s*60/);
assert.match(source, /transitionLengthPx:\s*workingFaceWidth\s*\*\s*0\.010/);
assert.match(source, /postExpansionOffsetsFaceRatioSparse/);
assert.match(source, /post_expansion_correction_maximum_px/);
assert.match(source, /post_expansion_correction_limit_px/);
assert.match(source, /"personalized_rstl_atlas\.json":\s*rounded\(activeAtlas,\s*9\)/);
const [runner, runnerV7, runnerV8] = await Promise.all([
  readFile(new URL("../tools/run_wrinkle_rstl_experiment_v4.mjs", import.meta.url), "utf8"),
  readFile(new URL("../tools/run_wrinkle_rstl_experiment_v7.mjs", import.meta.url), "utf8"),
  readFile(new URL("../tools/run_wrinkle_rstl_experiment_v8.mjs", import.meta.url), "utf8"),
]);
assert.match(runner, /WRINKLE_EXPERIMENT_OUTPUT/,
  "determinism reruns must use a separate output directory");
assert.match(runner, /version=\$\{experimentVersion\}/);
assert.match(runnerV7, /WRINKLE_EXPERIMENT_VERSION\s*=\s*"v7"/);
assert.match(runnerV8, /WRINKLE_EXPERIMENT_VERSION\s*=\s*"v8"/);
assert.match(source, /wrinkleDominantCoreStrength:\s*0\.95/);
assert.match(source, /complete_fine_line_wrinkle_dominant_v4/);
assert.match(source, /exclusive_anchor_normalized_bundle_propagation_v5/);
assert.match(source, /bundlePropagation:\s*true/);
assert.match(source, /bundleFollowerCountPerSide:\s*1/);
assert.match(source, /bundleFollowerStrength:\s*0\.85/);
assert.match(source, /bundlePropagationRadiusPx:\s*workingFaceWidth\s*\*\s*0\.050/);
assert.match(source, /bundleDirectionConflictDegrees:\s*25/);
assert.match(source, /bundleConflictDominanceRatio:\s*1\.5/);
assert.match(source, /bundle_minimum_spacing_ratio\s*<\s*0\.65/);
assert.match(source, /bundle_multi_source_weights_normalized/);
assert.match(source, /audit\.bundleFollowerRecords/);
assert.match(source, /COLORS\.follower/);
assert.match(source, /wrinkle_extraction_experiment_v1/);
assert.match(source, /buildFineLineEvidence/);
assert.match(source, /drawEvidence\(workingImage, fineEvidence\)/);
assert.match(source, /strokePolyline\(context, line\.points, COLORS\.wrinkleFine, 1\)/,
  "wrinkle evidence must render only red one-pixel centerlines");
assert.doesNotMatch(source, /skinMask:\s*skin/,
  "the v4 experiment must not erode frozen fine-line evidence with the old brow disk");
assert.match(source, /adherenceMeanThresholdPx/);
assert.match(source, /adherenceP90ThresholdPx/);
assert.match(source, /const seeds = mapAtlas\(atlas\.lines, mesh3, triangles\)\.map/,
  "the experiment prior must use the same v68 runtime forehead mapping as the live page");
assert.match(source, /buildForeheadSkinVisibility/);
assert.match(source, /buildHeadVisibility/);
assert.match(source, /stabilizeForeheadMask/);
assert.match(source, /disableRuntimeExpansion:\s*!runtimeExpansion/,
  "the exported forehead curves must retain the v68 runtime transform");
assert.match(source, /baseline:\s*"rstl_v8_1_68"/);
assert.match(source, /requestedVersion\s*===\s*"v8"\s*\?\s*"v8"\s*:\s*"v7"/);
assert.match(source, /intervalAwareAnchorSharing:\s*true/);
assert.match(source, /adherenceRetryAttempts:\s*10/);
assert.match(source, /shortWrinkleQuantizationTolerance:\s*true/);
assert.match(source, /adherenceDirectionSoftDegrees:\s*25/);
assert.match(source, /adherenceDirectionHardDegrees:\s*40/);
assert.match(source, /bundleMinimumSpacingRatio:\s*0\.65/);
assert.match(source, /bundleDenseFollowerRegion:\s*"lateral_canthus_short_arc_v65"/);
assert.match(source, /bundleDenseFollowerCountPerSide:\s*3/);
assert.match(source, /lateral_canthus_short_arc_v65/);
assert.match(source, /atlas\.lines\.length\s*!==\s*141/);
assert.match(source, /pointCount\s*!==\s*14_804/);
assert.match(source, /replay_p90_error_px/,
  "the personalized atlas must audit replay against the refined canonical curves");
assert.match(source, /replay_p90_error_px > 0\.10/);
assert.match(source, /replay_max_error_px > 1\.0/);
assert.match(source, /acceptedTrendCount/);
assert.match(source, /barycentricFallbackPointCount/);
assert.match(source, /validated:\s*false/g);
assert.match(source, /post_export_new_intersection_pair_count/);
assert.doesNotMatch(source, /https?:\/\//, "single-image experiment must not load remote runtime assets");
assert.doesNotMatch(`${html}\n${source}`, /年龄|肿物|切口设计/, "experiment scope must stay wrinkle/RSTL only");

for (const filename of [
  "01_prior_rstl.png", "02_wrinkle_evidence.png", "03_match_decisions.png",
  "04_refined_rstl.png", "05_before_after.png", "06_displacement_audit.png",
  "wrinkle_yolo_evidence.json", "wrinkle_rstl_refinement.json", "personalized_rstl_atlas.json",
]) {
  assert.match(source, new RegExp(filename.replaceAll(".", "\\.")), `missing artifact ${filename}`);
}

assert.equal(atlas.validated, false);
assert.equal(atlas.lines.length, 141);
assert.equal(atlas.lines.reduce((sum, line) => sum + line.points.length, 0), 14_804);
assert.equal(atlas.lines.filter((line) => line.region === "lateral_canthus_short_arc_v65").length, 8);

console.log("single-image wrinkle/RSTL experiment contract tests passed");
