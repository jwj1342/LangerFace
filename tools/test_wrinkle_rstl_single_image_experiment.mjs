import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const htmlUrl = new URL("../web/compat/personalized/wrinkle_rstl_experiment.html", import.meta.url);
const sourceUrl = new URL("../web/compat/personalized/wrinkleRstlExperiment.ts", import.meta.url);
const refinementSourceUrl = new URL(
  "../web/src/services/personalized/v6RstlRefinementV9.ts", import.meta.url,
);
const directNoseSourceUrl = new URL(
  "../web/src/services/personalized/directNoseDorsumRstl.ts", import.meta.url,
);
const noseRootVisibilitySourceUrl = new URL(
  "../web/src/services/personalized/noseRootIntersectionVisibility.ts", import.meta.url,
);
const viteUrl = new URL("../web/vite.config.ts", import.meta.url);
const atlasUrl = new URL("../assets/atlas_rstl_standard_v8.json", import.meta.url);
const fineLinesUrl = new URL("../web/assets/wrinkle_fine_lines_v10_wrinkle.json", import.meta.url);
const localRunnerUrl = new URL("../tools/run_wrinkle_rstl_local.mjs", import.meta.url);
const directCrowsRunnerUrl = new URL(
  "../tools/run_crows_feet_direct_rstl_experiment.mjs", import.meta.url,
);

const [html, source, refinementSource, directNoseSource, noseRootVisibilitySource,
  vite, atlas, fineLines, localRunner, directCrowsRunner] = await Promise.all([
  readFile(htmlUrl, "utf8"),
  readFile(sourceUrl, "utf8"),
  readFile(refinementSourceUrl, "utf8"),
  readFile(directNoseSourceUrl, "utf8"),
  readFile(noseRootVisibilitySourceUrl, "utf8"),
  readFile(viteUrl, "utf8"),
  readFile(atlasUrl, "utf8").then(JSON.parse),
  readFile(fineLinesUrl, "utf8").then(JSON.parse),
  readFile(localRunnerUrl, "utf8"),
  readFile(directCrowsRunnerUrl, "utf8"),
]);

for (const id of [
  "imageInput", "runButton", "exportButton", "priorCanvas", "evidenceCanvas",
  "decisionCanvas", "refinedCanvas", "compareCanvas", "displacementCanvas",
  "noseRootAuditCanvas", "noseRootBeforeCanvas", "noseRootAfterCanvas",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing experiment control ${id}`);
}
assert.doesNotMatch(html, /id=["']fineLineInput["']/,
  "the bundled v10 centerlines must not require a second file picker");

assert.match(html, /01 原始 v8\.1\.96 RSTL/);
assert.match(html, /02 最新 v10 皱纹中心线/);
assert.doesNotMatch(html, /v8\.1\.70/,
  "the experiment page must not advertise the obsolete RSTL version");

assert.match(vite, /wrinkleRstlExperiment/);
assert.match(source, /vision_wasm_internal\.js\?url/);
assert.match(source, /vision_wasm_internal\.wasm\?url/);
assert.match(source, /ort-wasm-simd-threaded\.mjs\?url/);
assert.match(source, /ort-wasm-simd-threaded\.wasm\?url/);
assert.match(source, /wasmPaths:\s*\{\s*mjs:\s*ortWasmModuleUrl,\s*wasm:\s*ortWasmBinaryUrl\s*\}/);
assert.match(source, /verifySha256:\s*true/);
assert.match(source, /refinementFunction\(\{/);
assert.match(source, /refineV6 as refineV9Exact/);
assert.match(source, /V9_REFINEMENT_REPLAY\s*\?\s*refineV9Exact\s*:\s*refineV6/);
assert.match(source, /regional-wrinkle-guided-plus-direct-nose-rstl-intersection-only-7\.6/);
assert.match(source, /nearestSingleCurveMatching:\s*true/);
assert.match(source, /topologyRetryAttempts:\s*3/);
assert.match(source, /postAdherenceGate:\s*true/);
assert.match(source, /targetGapPx:/);
assert.match(source, /dataAttractionStrength:\s*20/);
assert.match(source, /maxCurvatureChangeDegrees:\s*60/);
assert.match(source,
  /transitionLengthPx:\s*workingFaceWidth\s*\*\s*\(V9_REFINEMENT_REPLAY\s*\?\s*0\.040\s*:\s*0\.010\)/);
assert.match(source, /postExpansionOffsetsFaceRatioSparse/);
assert.match(source, /post_expansion_correction_maximum_px/);
assert.match(source, /post_expansion_correction_limit_px/);
assert.match(source, /"personalized_rstl_atlas\.json":\s*rounded\(activeAtlas,\s*9\)/);
const [runner, runnerV7, runnerV8, runnerV9Logic] = await Promise.all([
  readFile(new URL("../tools/run_wrinkle_rstl_experiment_v4.mjs", import.meta.url), "utf8"),
  readFile(new URL("../tools/run_wrinkle_rstl_experiment_v7.mjs", import.meta.url), "utf8"),
  readFile(new URL("../tools/run_wrinkle_rstl_experiment_v8.mjs", import.meta.url), "utf8"),
  readFile(new URL("../tools/run_wrinkle_rstl_experiment_v9_logic.mjs", import.meta.url), "utf8"),
]);
assert.match(runner, /WRINKLE_EXPERIMENT_OUTPUT/,
  "determinism reruns must use a separate output directory");
assert.match(runner, /version=\$\{experimentVersion\}/);
assert.match(runnerV7, /WRINKLE_EXPERIMENT_VERSION\s*=\s*"v7"/);
assert.match(runnerV8, /WRINKLE_EXPERIMENT_VERSION\s*=\s*"v8"/);
assert.match(runnerV9Logic, /WRINKLE_REFINEMENT_MODE\s*=\s*"v9"/);
assert.doesNotMatch(runner, /fineLineInput|WRINKLE_FINE_LINE_PATH/,
  "the runner must rely on the browser's contract-checked bundled v10 centerlines");
assert.doesNotMatch(runner, /wrinkle_extraction_experiment_v1/,
  "the default runner must not silently use the obsolete v1 extraction");
assert.match(source, /wrinkleDominantCoreStrength:\s*0\.95/);
assert.match(source, /const TWO_SIDED_NEAREST_MATCHING = V9_REFINEMENT_REPLAY/);
assert.match(source, /const BUNDLE_PROPAGATION = false/);
assert.match(source, /V9_REFINEMENT_REPLAY[\s\S]*nearestSingleCurveMatching:\s*false/);
assert.match(source, /twoSidedNearestMatching:\s*true/);
assert.match(source, /regionalNearestSingleCurveMatching:\s*true/);
assert.match(source, /exclusiveTrendMatching:\s*false/);
assert.match(source, /oneToOneTrendCurveMatching:\s*false/);
assert.match(source, /v10_three_region_guided_direct_nose_v7_2/);
assert.match(source, /forehead_single_curve_selected_count\s*<\s*3/);
assert.match(source, /glabellar_single_curve_selected_count\s*<\s*2/);
assert.match(source, /nose_bridge_single_curve_selected_count\s*!==\s*0/);
assert.match(source, /nose_bridge_planar_warp\?\.applied\s*===\s*true/);
assert.match(source, /direct_nose_dorsum_generated_curve_count\s*!==\s*3/);
assert.match(source, /crows_feet_single_curve_selected_count\s*<\s*7/);
assert.match(source, /maximum_selected_rstl_curves_per_wrinkle\s*>\s*2/);
assert.match(source, /curve_unique_wrinkle_ownership\s*!==\s*true/);
assert.match(source, /wrinkle_with_single_side_selected_count\s*!==\s*0/);
assert.match(source, /bundle_propagation_enabled\s*===\s*true/);
assert.match(source, /fineLineExtractionVersion\(fineLineSource\.payload\)/);
assert.match(source, /latestWrinkleFineLinesUrl/,
  "the browser experiment must load bundled v10 centerlines by default");
assert.match(source, /LATEST_WRINKLE_FINE_LINE_CONTRACT/);
assert.match(source, /lineCount:\s*26/);
assert.match(source, /fineLineSource\.sha256 !== LATEST_WRINKLE_FINE_LINE_CONTRACT\.sha256/);
assert.match(source, /fineLineCount:\s*fineEvidence\.lines\.length/);
assert.match(source, /payload\.summary\?\.sourceSchemaVersion/,
  "centerline provenance must preserve paired-edge v10 source metadata");
assert.match(source, /payload\.method\?\.adapter/,
  "centerline provenance must fall back to the input adapter");
assert.doesNotMatch(source, /extractionVersion:\s*"wrinkle_extraction_experiment_v1"/,
  "centerline provenance must not be hard-coded to the obsolete v1 experiment");
assert.doesNotMatch(source, /guided by the frozen extraction-v1 centerlines/,
  "export limitations must not claim that obsolete v1 evidence guided refinement");
assert.match(source, /buildFineLineEvidence/);
assert.match(source, /drawEvidence\(workingImage, fineEvidence\)/);
assert.match(source, /strokePolyline\(context, line\.points, COLORS\.wrinkleFine, 1\)/,
  "wrinkle evidence must render only red one-pixel centerlines");
assert.doesNotMatch(source, /skinMask:\s*skin/,
  "the v4 experiment must not erode frozen fine-line evidence with the old brow disk");
assert.match(source, /adherenceMeanThresholdPx/);
assert.match(source, /adherenceP90ThresholdPx/);
assert.match(source, /const seeds = mapAtlas\(atlas\.lines, mesh3, triangles, \{/,
  "the experiment prior must use the standard v8.1.96 runtime mapping");
assert.match(source, /expandForehead:\s*RSTL_EXPERIMENT_CONTRACT\.expandForehead/,
  "the standard forehead mapping option must be explicit and contract-controlled");
assert.match(source, /preservePriorGeometry:\s*true/);
assert.match(source, /displayClippingOnly:\s*true/);
assert.match(source, /lineColor:\s*"rgba\(200, 0, 200, 0\.6\)"/);
assert.match(source, /snapshotSeedGeometry\(seeds\)/);
assert.match(source, /assertSeedGeometryPreserved\(seeds, seedGeometrySnapshot, "原始 RSTL 绘制后"\)/);
assert.match(source, /assertSeedGeometryPreserved\(seeds, seedGeometrySnapshot, "皱纹引导微调后"\)/);
assert.doesNotMatch(source, /fitForeheadCurvesToVisibleBand/,
  "visibility clipping must never remap or compress existing forehead curves");
assert.match(source, /WRINKLE_PHOTO_SHA256/);
assert.match(source, /sourceSha256\.toLowerCase\(\) === WRINKLE_PHOTO_SHA256/,
  "the hand-reviewed hairline must be gated to the exact wrinkle.png input");
assert.match(source, /generic_forehead_skin_v1/,
  "other input images must fall back to generic per-image forehead visibility");
assert.match(source, /CONTINUOUS_FACE_DISPLAY_REGIONS[\s\S]*supraorbital_medial_short_arc_v69/,
  "medial supraorbital arcs must be rendered as continuous face curves");
assert.match(source, /continuousFaceDisplay \|\| visibility\.skinVisible\(point\)/,
  "continuous face curves must not be fragmented by the forehead skin-color mask");
assert.match(source, /getVisualizationSnapshot/,
  "the visualization runner must expose pre-export prior and refined curves");
assert.match(source, /buildForeheadSkinVisibility/);
assert.match(source, /buildHeadVisibility/);
assert.match(source, /stabilizeForeheadMask/);
assert.match(source, /disableRuntimeExpansion:\s*!runtimeExpansion/,
  "the exported forehead curves must retain the v69 runtime transform");
assert.match(source, /baseline:\s*"rstl_v8_1_96"/);
assert.match(source, /atlasVersion:\s*atlas\.atlasVersion/,
  "the export must record the atlas content version");
assert.doesNotMatch(source, /atlasVersion:\s*atlas\.version/,
  "the export must not substitute the JSON schema version for the atlas content version");
assert.match(source, /requestedVersion\s*===\s*"v8"\s*\?\s*"v8"\s*:\s*"v7"/);
assert.match(source, /adherenceRetryAttempts:\s*10/);
assert.match(source, /shortWrinkleQuantizationTolerance:\s*true/);
assert.match(source, /adherenceDirectionSoftDegrees:\s*25/);
assert.match(source, /adherenceDirectionHardDegrees:\s*40/);
assert.match(source, /bundleDenseFollowerCountPerSide:\s*3/);
assert.match(source, /curvatureFairing:\s*V9_REFINEMENT_REPLAY/);
assert.match(source, /curvatureFairingMaximumTurnDegrees:\s*4/);
assert.match(source, /curvatureFairingMaximumAddedSignChanges:\s*0/);
assert.match(source, /curvatureFairingForeheadMaximumAddedSignChanges:\s*4/);
assert.match(source, /foreheadAdherenceMeanThresholdPx:\s*1\.5/);
assert.match(source, /foreheadAdherenceP90ThresholdPx:\s*3/);
assert.match(source, /foreheadBundleCoherence:\s*true/);
assert.match(source, /foreheadBundleMinimumSpacingRatio:\s*0\.65/);
assert.match(source, /foreheadBundleMaximumSpacingRatio:\s*1\.45/);
assert.match(source, /foreheadBundleMaximumTurnDegrees:\s*8/);
assert.match(source, /foreheadBundleMinimumReversalSpacingPx:\s*12/);
assert.match(source, /forehead_bundle_coherence\?\.applied\s*!==\s*true/,
  "the V9 experiment must reject a run that did not apply forehead field coherence");
assert.match(source, /curvatureFairingGlabellarMaximumTurnDegrees:\s*8/);
assert.doesNotMatch(source, /curvatureFairingNoseBridgeMaximumTurnDegrees:/,
  "nose-dorsum wrinkles must not configure deformation fairing");
assert.match(source, /curvatureFairingCrowsFeetMaximumTurnDegrees:\s*9/);
assert.match(source, /glabellarAdherenceMeanThresholdPx:\s*2\.6/);
assert.doesNotMatch(source, /noseBridgeAdherenceMeanThresholdPx:/,
  "nose-dorsum wrinkles must not configure deformation adherence");
assert.match(source, /crowsFeetAdherenceMeanThresholdPx:\s*3\.75/);
assert.match(refinementSource, /suppressShortCurvatureReversals/);
assert.match(refinementSource, /guidedRegionForResult/);
assert.match(refinementSource, /guidedRegionSideCompatible/);
assert.match(refinementSource, /regional_guided_similarity_envelope/);
assert.match(refinementSource, /planar_warp_smooth_topology_search_rejected/);
assert.match(refinementSource, /minimumMaterialSignChangeSpacingPx/);
assert.match(source, /v10_nearest_single_curve_v9_anchor_trajectory_v8/);
assert.match(source, /lateral_canthus_short_arc_v65/);
assert.match(source, /supraorbital_lateral_short_arc_v66/);
assert.match(source, /supraorbital_medial_short_arc_v69/);
assert.match(source, /brow_temporal_fan_v94/);
assert.match(source, /cheek_alar_gap_fill_v95/);
assert.match(source, /curveCount:\s*204/);
assert.match(source, /pointCount:\s*19_030/);
assert.match(source, /atlas\.lines\.length\s*!==\s*RSTL_EXPERIMENT_CONTRACT\.curveCount/);
assert.match(source, /pointCount\s*!==\s*RSTL_EXPERIMENT_CONTRACT\.pointCount/);
assert.match(source, /replay_p90_error_px/,
  "the personalized atlas must audit replay against the refined canonical curves");
assert.match(source, /replay_p90_error_px > 0\.10/);
assert.match(source, /replay_max_error_px > 1\.0/);
assert.match(source, /boundary_projection_point_count/);
assert.match(source, /source_anchor_reuse_point_count/);
assert.match(source, /excludedLineIds:\s*new Set\(DIRECT_NOSE_DORSUM_FINE_LINE_IDS\)/,
  "nose-dorsum evidence must be excluded from the deformation mask");
assert.match(source, /buildDirectNoseDorsumRstl\(\{/,
  "nose-dorsum wrinkles must directly generate personalized RSTL curves");
assert.match(source, /guidanceCenterlineUnionExcludingNoseDorsum/);
assert.match(source, /personalized_curve_extension_contract_preserved/);
assert.match(source, /directNoseDorsumGeneratedCurveCount/);
assert.match(directNoseSource, /DIRECT_NOSE_DORSUM_FINE_LINE_IDS/);
for (const id of ["paired-edge-v10-022", "paired-edge-v10-023", "paired-edge-v10-024"]) {
  assert.match(directNoseSource, new RegExp(id));
}
assert.match(directNoseSource, /minimum_eye_clearance_px/);
assert.match(directNoseSource, /maximum_turn_degrees/);
assert.match(directNoseSource, /existing_curve_intersection_count/);
assert.match(source, /buildNoseRootIntersectionVisibilityPlan\(\{/);
assert.match(source, /visibilityMaskForCurve\(/);
assert.match(source, /nose_root_intersection_visibility/);
assert.match(source, /geometryMaximumDeltaPx\s*!==\s*0/);
assert.match(source, /visiblePreservedDirectIntersectionCount\s*!==\s*0/);
assert.match(noseRootVisibilitySource, /standard_field_0108_right/);
assert.match(noseRootVisibilitySource, /standard_field_0108_left/);
assert.match(noseRootVisibilitySource, /standard_field_0109_right/);
assert.match(noseRootVisibilitySource, /standard_field_0109_left/);
assert.match(noseRootVisibilitySource, /roiMarginFaceWidthRatio/);
assert.match(noseRootVisibilitySource, /marginRatio\s*=\s*0\.04/);
assert.match(noseRootVisibilitySource, /hiddenPointRuns/);
assert.match(noseRootVisibilitySource, /direct_nose_intersection_gap/);
assert.match(noseRootVisibilitySource, /nonIntersectionCurveChangedPointCount/);
assert.match(noseRootVisibilitySource, /visiblePolylineIntersectionCount/);
assert.match(source, /acceptedTrendCount/);
assert.match(source, /barycentricFallbackPointCount/);
assert.match(source, /validated:\s*false/g);
assert.match(source, /post_export_new_intersection_pair_count/);
assert.doesNotMatch(source, /https?:\/\//, "single-image experiment must not load remote runtime assets");
assert.doesNotMatch(`${html}\n${source}`, /年龄|肿物|切口设计/, "experiment scope must stay wrinkle/RSTL only");

for (const filename of [
  "01_prior_rstl.png", "02_wrinkle_evidence.png", "03_match_decisions.png",
  "04_refined_rstl.png", "05_before_after.png", "06_displacement_audit.png",
  "07_nose_root_visibility_audit.png", "08_nose_root_before_visibility.png",
  "09_nose_root_after_visibility.png",
  "wrinkle_yolo_evidence.json", "wrinkle_rstl_refinement.json", "personalized_rstl_atlas.json",
]) {
  assert.match(source, new RegExp(filename.replaceAll(".", "\\.")), `missing artifact ${filename}`);
}

assert.equal(atlas.validated, false);
assert.equal(atlas.atlasVersion, "8.1.96");
assert.equal(atlas.lines.length, 204);
assert.equal(atlas.lines.reduce((sum, line) => sum + line.points.length, 0), 19_030);
assert.equal(fineLines.summary.sourceSchemaVersion,
  "langerface.wrinkle-paired-edge.v10-forehead-recall-experiment");
assert.equal(fineLines.lines.length, 26);
assert.equal(atlas.lines.filter((line) => line.region === "lateral_canthus_short_arc_v65").length, 10);
assert.equal(atlas.lines.filter((line) => line.region === "supraorbital_lateral_short_arc_v66").length, 0);
assert.equal(atlas.lines.filter((line) => line.region === "supraorbital_medial_short_arc_v69").length, 10);
assert.equal(atlas.lines.filter((line) => line.region === "brow_temporal_fan_v94").length, 10);
assert.equal(atlas.lines.filter((line) => line.region === "cheek_alar_gap_fill_v95").length, 4);

assert.match(localRunner, /WRINKLE_LOCAL_INPUT/);
assert.match(localRunner, /WRINKLE_LOCAL_BASELINE/);
assert.match(localRunner, /WRINKLE_LOCAL_PYTHON/);
assert.match(localRunner, /pathToFileURL/,
  "local file URLs must be portable across Windows and POSIX");
assert.match(localRunner, /artifactSha256:\s*frozenArtifactSha256/,
  "the replay manifest must record every copied artifact hash");
assert.match(localRunner, /assertEqual\(atlas\.validated,\s*false/,
  "the local runner must reject a clinically validated personalized atlas claim");
assert.match(localRunner, /validated:\s*false/);
assert.doesNotMatch(localRunner, /validated:\s*true/);
assert.doesNotMatch(localRunner, /\/opt\/anaconda3/,
  "the local runner must not hard-code one developer's Python environment");

assert.match(directCrowsRunner, /WRINKLE_CROWS_INPUT/);
assert.match(directCrowsRunner, /WRINKLE_CROWS_BASELINE/);
assert.match(directCrowsRunner, /WRINKLE_CROWS_FINE_LINES/);
assert.match(directCrowsRunner, /WRINKLE_CROWS_PYTHON/);
assert.match(directCrowsRunner, /validated:\s*false/);
assert.match(directCrowsRunner, /for line in payload\['lines'\]/,
  "the direct experiment must render the complete rewritten geometry");
assert.match(directCrowsRunner,
  /\], \[sourceImage, resolve\(outputDir, outputName\),/,
  "the direct output must be rendered from the original image, not the old overlay");
assert.doesNotMatch(directCrowsRunner, /\/opt\/anaconda3/,
  "the direct experiment must not hard-code one developer's Python environment");

console.log("single-image wrinkle/RSTL experiment contract tests passed");
