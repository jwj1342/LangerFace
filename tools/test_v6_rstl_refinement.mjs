import assert from "node:assert/strict";

import {
  refineV6,
  resolveBundleContributions,
  V6_RSTL_ALGORITHM,
} from "../web/src/services/personalized/v6RstlRefinement.ts";
import { refineV6 as refineV9Smooth } from
  "../web/src/services/personalized/v6RstlRefinementV9.ts";
import { mapAtlas } from "../web/src/services/geometryAtlas.ts";

const size = 96;
const index = (x, y) => y * size + x;

function horizontalSeed(name, y, x0 = 8, x1 = 87, step = 2) {
  const pts = [];
  for (let x = x0; x <= x1; x += step) pts.push([x, y]);
  return { name, region: "test", pts };
}

function evidence(lines, confidenceValue = 1) {
  const mask = new Uint8Array(size * size);
  const confidence = new Float32Array(size * size);
  const q = new Float32Array(size * size * 2);
  for (const line of lines) {
    for (const [x, y] of line) {
      mask[index(x, y)] = 1;
      confidence[index(x, y)] = confidenceValue;
      q[index(x, y) * 2] = 1; // horizontal axial direction
    }
  }
  return { mask, confidence, q };
}

function rangeLine(x0, x1, y) {
  return Array.from({ length: x1 - x0 + 1 }, (_, offset) => [x0 + offset, y]);
}

function meanVerticalDistance(points, wrinkle, x0, x1) {
  const wrinkleY = new Map(wrinkle.map(([x, y]) => [x, y]));
  const distances = points
    .filter(([x]) => x >= x0 && x <= x1 && wrinkleY.has(Math.round(x)))
    .map(([x, y]) => Math.abs(y - wrinkleY.get(Math.round(x))));
  return distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length);
}

function signedTurnDegrees(points) {
  return points.map((point, pointIndex) => {
    if (pointIndex === 0 || pointIndex === points.length - 1) return 0;
    const first = [
      point[0] - points[pointIndex - 1][0],
      point[1] - points[pointIndex - 1][1],
    ];
    const second = [
      points[pointIndex + 1][0] - point[0],
      points[pointIndex + 1][1] - point[1],
    ];
    const firstLength = Math.hypot(...first), secondLength = Math.hypot(...second);
    const cross = first[0] * second[1] - first[1] * second[0];
    const dot = first[0] * second[0] + first[1] * second[1];
    return Math.atan2(cross / (firstLength * secondLength), dot / (firstLength * secondLength)) *
      180 / Math.PI;
  });
}

function maximumTurnDegrees(points) {
  return Math.max(...signedTurnDegrees(points).map(Math.abs));
}

// Compatible sources blend, a clearly stronger conflicting source wins, and
// an ambiguous directional conflict conservatively retains the prior.
{
  const first = { trendIndex: 0, weight: 1, tangent: [1, 0] };
  const compatible = { trendIndex: 1, weight: 0.8, tangent: [0.98, 0.20] };
  const conflicting = { trendIndex: 1, weight: 0.8, tangent: [0.77, 0.64] };
  assert.equal(resolveBundleContributions([first, compatible], 25, 1.5).status, "compatible");
  assert.equal(resolveBundleContributions([first, conflicting], 25, 1.5).status,
    "ambiguous_prior");
  const dominant = resolveBundleContributions([
    { ...first, weight: 1.5 }, { ...conflicting, weight: 0.8 },
  ], 25, 1.5);
  assert.equal(dominant.status, "dominant_source");
  assert.deepEqual(dominant.active.map((source) => source.trendIndex), [0]);
}

// Personalized atlases can encode sparse post-expansion residuals normalized
// by face width, so replay remains exact without changing curve topology.
{
  const mapped = mapAtlas([{
    name: "corrected",
    region: "test",
    points: [[0, 1, 0]],
    postExpansionOffsetsFaceRatioSparse: [[0, 0.1, 0.2]],
  }], [[0, 0, 0], [10, 0, 0], [0, 10, 0]], [[0, 1, 2]]);
  assert.deepEqual(mapped[0].pts[0], [1, 2, 0]);
}

// No evidence is an exact, topology-preserving fallback.
{
  const seeds = [horizontalSeed("a", 30), horizontalSeed("b", 50)];
  const result = refineV6({
    seeds,
    wrinkleMask: new Uint8Array(size * size),
    confidenceMap: new Float32Array(size * size),
    size,
    faceWidthPx: 80,
  });
  assert.equal(result.diagnostics.algorithm, V6_RSTL_ALGORITHM);
  assert.equal(result.diagnostics.topology_contract_preserved, true);
  assert.deepEqual(result.curves.map((curve) => curve.pts), seeds.map((seed) => seed.pts));
  assert.equal(result.diagnostics.moved_point_count, 0);
  assert.deepEqual(result.audit.wrinkleTrends, []);
  assert.deepEqual(result.audit.matchRecords, []);
}

// A stable parallel wrinkle produces only local normal displacement.
{
  const seeds = [horizontalSeed("guided", 30), horizontalSeed("far", 70)];
  const fields = evidence([rangeLine(24, 70, 33)]);
  const result = refineV6({
    seeds, wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 80,
  });
  const guided = result.curves[0];
  assert.equal(result.curves.length, seeds.length);
  assert.equal(guided.pts.length, seeds[0].pts.length);
  assert.ok(guided.normalOffsetsPx.some((value) => value > 0.05));
  assert.deepEqual(result.curves[1].pts, seeds[1].pts);
  for (let pointIndex = 0; pointIndex < guided.pts.length; pointIndex += 1) {
    assert.ok(Math.abs(guided.pts[pointIndex][0] - seeds[0].pts[pointIndex][0]) < 1e-9,
      "horizontal prior may move only along its vertical normal");
  }
  assert.equal(result.diagnostics.post_export_new_intersection_pair_count, 0);
  assert.equal(result.diagnostics.post_export_new_self_cross_curve_count, 0);
  assert.ok(result.audit.wrinkleTrends.some((trend) => trend.finalAccepted));
  assert.ok(result.audit.matchRecords.some((record) => record.final_accepted));
}

// A wrinkle guides only its nearest eligible RSTL in the search band.
{
  const seeds = [horizontalSeed("closest", 30), horizontalSeed("neighbor", 38)];
  const fields = evidence([rangeLine(20, 74, 33)]);
  const result = refineV6({
    seeds, wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 180,
    options: {
      p90LimitPx: 8,
      maxDisplacementPx: 12,
    },
  });
  assert.ok(result.curves[0].normalOffsetsPx.some((value) => Math.abs(value) > 0.05));
  assert.deepEqual(result.curves[1].pts, seeds[1].pts);
  assert.deepEqual(result.audit.wrinkleTrends[0].acceptedCurveIndices, [0]);
  assert.ok(result.audit.matchRecords.some((record) =>
    record.rstl_curve_index === 1 && record.rejection_reason === "not_nearest_rstl_curve"));
  assert.equal(result.diagnostics.nearest_single_curve_matching, true);
  assert.equal(result.diagnostics.maximum_selected_rstl_curves_per_wrinkle, 1);
}

// Distance is the primary assignment rule even when a farther, longer RSTL
// has stronger coverage and would win the legacy global score.
{
  const seeds = [
    horizontalSeed("near-short", 30, 24, 56, 1),
    horizontalSeed("far-long", 36),
  ];
  const fields = evidence([rangeLine(20, 74, 32)]);
  const result = refineV6({
    seeds, wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 180,
    options: { searchRadiusPx: 16, p90LimitPx: 12, maxDisplacementPx: 18 },
  });
  const selected = result.audit.matchRecords.filter((record) => record.provisional_accepted);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].rstl_curve_index, 0);
  assert.equal(selected[0].is_nearest_rstl_curve, true);
  assert.equal(selected[0].nearest_rstl_curve_index, 0);
  assert.ok(result.audit.matchRecords.some((record) =>
    record.rstl_curve_index === 1 && record.curve_influence > selected[0].curve_influence));
}

// Separate wrinkles may share the same nearest RSTL. The single-curve rule is
// per wrinkle and must not reserve a curve globally for only one wrinkle.
{
  const fields = evidence([
    rangeLine(12, 31, 35),
    rangeLine(64, 83, 35),
  ]);
  const result = refineV6({
    seeds: [horizontalSeed("shared-nearest", 30)],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: { searchRadiusPx: 16 },
  });
  const accepted = result.audit.matchRecords.filter((record) => record.provisional_accepted);
  assert.equal(accepted.length, 2);
  assert.equal(new Set(accepted.map((record) => record.wrinkle_segment_id)).size, 2);
  assert.deepEqual([...new Set(accepted.map((record) => record.rstl_curve_index))], [0]);
  assert.ok(result.audit.wrinkleTrends.every((trend) =>
    trend.acceptedCurveIndices.length <= 1));
  assert.equal(result.diagnostics.maximum_selected_rstl_curves_per_wrinkle, 1);
}

// With a stronger data term, the selected RSTL follows the wrinkle's changing
// vertical position instead of reducing it to a flat average offset.
{
  const seed = horizontalSeed("trajectory", 30, 8, 87, 1);
  const wrinkle = Array.from({ length: 57 }, (_, offset) => {
    const x = 20 + offset;
    return [x, 37 + Math.round(3 * Math.sin(offset / 9))];
  });
  const fields = evidence([wrinkle]);
  const result = refineV6({
    seeds: [seed], wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 180,
    options: {
      exclusiveTrendMatching: true,
      targetGapPx: 1.5,
      dataAttractionStrength: 14,
      smoothingPasses: 32,
      searchRadiusPx: 16,
      p90LimitPx: 14,
      maxDisplacementPx: 18,
      maxCurvatureChangeDegrees: 26,
    },
  });
  const before = meanVerticalDistance(seed.pts, wrinkle, 24, 72);
  const after = meanVerticalDistance(result.curves[0].pts, wrinkle, 24, 72);
  assert.ok(after < 2.5, `trajectory should stay beside the wrinkle (got ${after.toFixed(3)}px)`);
  assert.ok(after < before * 0.35,
    `trajectory following must substantially improve distance (${before.toFixed(3)} -> ${after.toFixed(3)})`);
  assert.ok(result.diagnostics.trajectory_adherence_final_mean_distance_px <
    result.diagnostics.trajectory_adherence_prior_mean_distance_px);
  assert.equal(result.diagnostics.trajectory_adherence_records.length, 1);
}

// Evidence length/coverage drives eligibility; a two-pixel fragment is rejected
// at this face scale even though it has multiple samples.
{
  const seeds = [horizontalSeed("short-support", 30)];
  const fields = evidence([rangeLine(40, 41, 33)]);
  const result = refineV6({
    seeds, wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 220,
  });
  assert.deepEqual(result.curves[0].pts, seeds[0].pts);
  assert.equal(result.diagnostics.moved_point_count, 0);
  assert.ok(result.audit.wrinkleTrends.every((trend) => !trend.finalAccepted));
  assert.ok(result.audit.wrinkleTrends.some((trend) =>
    ["insufficient_segment_support", "insufficient_curve_support"].includes(trend.rejectionReason)));
}

// Refinement 6.5 fairs the scalar normal-offset field after trajectory fitting.
// A rasterized wavy wrinkle must remain adopted without leaving high-frequency
// angular kinks in the exported RSTL, and both curve endpoints stay fixed.
{
  const seed = horizontalSeed("curvature-fairing", 30, 8, 87, 1);
  const wrinkle = Array.from({ length: 57 }, (_, offset) => [
    20 + offset,
    38 + Math.round(3 * Math.sin(offset / 18)),
  ]);
  const fields = evidence([wrinkle]);
  const result = refineV6({
    seeds: [seed],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      postAdherenceGate: true,
      targetGapPx: 1.5,
      dataAttractionStrength: 20,
      wrinkleDominantCoreStrength: 0.95,
      smoothingPasses: 12,
      searchRadiusPx: 16,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
      maxCurvatureChangeDegrees: 60,
      curvatureFairing: true,
      curvatureFairingPasses: 32,
      curvatureFairingMaximumTurnDegrees: 8,
      curvatureFairingStrictMaximumTurnDegrees: 6,
      curvatureFairingStrictRegion: "test",
      curvatureFairingBaselineSlackDegrees: 2,
      curvatureFairingMaximumAddedSignChanges: 2,
      curvatureFairingEndpointTangentChangeDegrees: 45,
    },
  });
  const event = result.diagnostics.curvature_fairing_events.find((candidate) =>
    candidate.curve_name === seed.name);
  assert.equal(result.diagnostics.curvature_fairing_enabled, true);
  assert.equal(event?.status, "faired", JSON.stringify(event));
  assert.ok(result.curves[0].normalOffsetsPx.some((value) => Math.abs(value) > 0.05));
  assert.ok(maximumTurnDegrees(result.curves[0].pts) <= 6 + 1e-6);
  assert.deepEqual(result.curves[0].pts[0], seed.pts[0]);
  assert.deepEqual(result.curves[0].pts.at(-1), seed.pts.at(-1));
  assert.equal(result.diagnostics.post_fairing_adherence_rollback_curve_count, 0);
  assert.equal(result.diagnostics.post_export_new_intersection_pair_count, 0);
  assert.equal(result.diagnostics.post_export_new_self_cross_curve_count, 0);
}

// The exact 6.1-derived path must reject sharp corners before export.
{
  const seed = horizontalSeed("v9-smooth-contract", 30, 8, 87, 1);
  const wrinkle = Array.from({ length: 57 }, (_, offset) => [
    20 + offset,
    38 + Math.round(3 * Math.sin(offset / 18)),
  ]);
  const fields = evidence([wrinkle]);
  const result = refineV9Smooth({
    seeds: [seed],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      targetGapPx: 1.5,
      dataAttractionStrength: 20,
      wrinkleDominantCoreStrength: 0.95,
      smoothingPasses: 12,
      searchRadiusPx: 16,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
      maxCurvatureChangeDegrees: 60,
      curvatureFairing: true,
      curvatureFairingPasses: 64,
      curvatureFairingMaximumTurnDegrees: 4,
      curvatureFairingStrictMaximumTurnDegrees: 3,
      curvatureFairingStrictRegion: "test",
      curvatureFairingBaselineSlackDegrees: 0.75,
      curvatureFairingMaterialTurnDegrees: 0.35,
      curvatureFairingMaximumAddedSignChanges: 0,
      curvatureFairingEndpointTangentChangeDegrees: 20,
    },
  });
  const event = result.diagnostics.curvature_fairing_events.find((candidate) =>
    candidate.curve_name === seed.name);
  assert.equal(result.diagnostics.algorithm,
    "regional-wrinkle-guided-smooth-rstl-refinement-7.2");
  assert.equal(result.diagnostics.curvature_fairing_contract_preserved, true);
  assert.equal(event?.status, "faired", JSON.stringify(event));
  assert.ok(result.curves[0].normalOffsetsPx.some((value) => Math.abs(value) > 0.05));
  assert.ok(maximumTurnDegrees(result.curves[0].pts) <=
    event.maximum_turn_limit_degrees + 1e-6);
  assert.ok(event.after.materialSignChanges <= event.prior.materialSignChanges);
  assert.deepEqual(result.curves[0].pts[0], seed.pts[0]);
  assert.deepEqual(result.curves[0].pts.at(-1), seed.pts.at(-1));
  assert.equal(result.diagnostics.post_export_new_intersection_pair_count, 0);
  assert.equal(result.diagnostics.post_export_new_self_cross_curve_count, 0);
}

// Each wrinkle owns its nearest curve on both sides. A curve eligible for two
// wrinkles belongs exclusively to the wrinkle with the smaller mean distance.
{
  const seeds = [
    horizontalSeed("upper-first", 24),
    horizontalSeed("lower-first", 35),
    horizontalSeed("shared-nearer-second", 40),
    horizontalSeed("lower-second", 54),
  ];
  const fields = evidence([rangeLine(20, 74, 30), rangeLine(20, 74, 48)]);
  const result = refineV9Smooth({
    seeds,
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      twoSidedNearestMatching: true,
      logicalTrendGrouping: true,
      searchRadiusPx: 14,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
      smoothingPasses: 12,
    },
  });
  const selected = result.audit.matchRecords.filter((record) => record.selected_for_wrinkle);
  assert.equal(selected.length, 4, JSON.stringify(selected));
  assert.equal(new Set(selected.map((record) => record.rstl_curve_index)).size, 4);
  for (const trendId of [0, 1]) {
    const trendRecords = selected.filter((record) => record.wrinkle_segment_id === trendId);
    assert.deepEqual(new Set(trendRecords.map((record) => record.wrinkle_side)),
      new Set(["upper", "lower"]));
  }
  assert.equal(selected.find((record) => record.rstl_curve_index === 2)?.wrinkle_segment_id, 1);
  assert.equal(result.diagnostics.two_sided_nearest_matching, true);
  assert.equal(result.diagnostics.maximum_selected_rstl_curves_per_wrinkle, 2);
  assert.equal(result.diagnostics.curve_unique_wrinkle_ownership, true);
  assert.equal(result.diagnostics.wrinkle_with_both_sides_selected_count, 2);
  assert.equal(result.diagnostics.wrinkle_with_single_side_selected_count, 0);
}

// A wrinkle with only one eligible side cannot reserve that curve and starve
// another wrinkle that can form a complete upper/lower pair.
{
  const seeds = [
    horizontalSeed("shared-upper", 24),
    horizontalSeed("complete-lower", 54),
  ];
  const fields = evidence([rangeLine(20, 74, 30), rangeLine(20, 74, 42)]);
  const result = refineV9Smooth({
    seeds,
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      twoSidedNearestMatching: true,
      logicalTrendGrouping: true,
      searchRadiusPx: 20,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
      smoothingPasses: 12,
    },
  });
  const selected = result.audit.matchRecords.filter((record) => record.selected_for_wrinkle);
  assert.equal(selected.length, 2, JSON.stringify(selected));
  assert.equal(new Set(selected.map((record) => record.wrinkle_segment_id)).size, 1);
  assert.deepEqual(new Set(selected.map((record) => record.wrinkle_side)),
    new Set(["upper", "lower"]));
  assert.equal(result.diagnostics.wrinkle_with_both_sides_selected_count, 1);
  assert.equal(result.diagnostics.wrinkle_with_single_side_selected_count, 0);
}

// Forehead wrinkles use one nearest unique RSTL each, matching the annotated
// forehead target without collapsing two RSTL curves onto one wrinkle.
{
  const seeds = [
    horizontalSeed("forehead-upper", 24),
    horizontalSeed("forehead-middle", 42),
    horizontalSeed("forehead-lower", 60),
  ].map((seed) => ({ ...seed, region: "forehead_bridge_arc_v15" }));
  const fields = evidence([rangeLine(20, 74, 30), rangeLine(20, 74, 48)]);
  const result = refineV9Smooth({
    seeds,
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      twoSidedNearestMatching: true,
      foreheadNearestSingleCurveMatching: true,
      logicalTrendGrouping: true,
      searchRadiusPx: 16,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
      smoothingPasses: 12,
    },
  });
  const selected = result.audit.matchRecords.filter((record) => record.selected_for_wrinkle);
  assert.equal(selected.length, 2, JSON.stringify(selected));
  assert.equal(new Set(selected.map((record) => record.wrinkle_segment_id)).size, 2);
  assert.equal(new Set(selected.map((record) => record.rstl_curve_index)).size, 2);
  assert.ok(selected.every((record) => record.forehead_single_curve_selected === true));
  assert.equal(result.diagnostics.forehead_nearest_single_curve_matching, true);
  assert.equal(result.diagnostics.forehead_single_curve_selected_count, 2);
  assert.equal(result.diagnostics.wrinkle_with_single_side_selected_count, 0);
}

// Forehead anchors retain their wrinkle adherence while the surrounding layer
// follows a monotone displacement field instead of leaving a compressed row
// beside an oversized empty band.
{
  const seeds = [18, 28, 38, 48, 58, 68, 78].map((y, index) => ({
    ...horizontalSeed(`forehead-layer-${index}`, y, 8, 87, 1),
    region: "forehead_bridge_arc_v15",
  }));
  const fields = evidence([rangeLine(20, 74, 64)]);
  const options = {
    twoSidedNearestMatching: true,
    foreheadNearestSingleCurveMatching: true,
    logicalTrendGrouping: true,
    postAdherenceGate: true,
    targetGapPx: 1,
    dataAttractionStrength: 20,
    wrinkleDominantCoreStrength: 0.95,
    smoothingPasses: 12,
    searchRadiusPx: 16,
    p90LimitPx: 18,
    maxDisplacementPx: 24,
    maxCurvatureChangeDegrees: 60,
    foreheadAdherenceMeanThresholdPx: 2,
    foreheadAdherenceP90ThresholdPx: 4,
  };
  const baseline = refineV9Smooth({
    seeds,
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options,
  });
  const coherent = refineV9Smooth({
    seeds,
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      ...options,
      foreheadBundleCoherence: true,
      foreheadBundleMinimumSpacingRatio: 0.65,
      foreheadBundleMaximumSpacingRatio: 1.45,
      foreheadBundleMaximumTurnDegrees: 8,
      foreheadBundleMaximumAddedSignChanges: 6,
      foreheadBundleMinimumReversalSpacingPx: 12,
    },
  });
  const diagnostics = coherent.diagnostics.forehead_bundle_coherence;
  assert.equal(diagnostics.applied, true, JSON.stringify(diagnostics));
  assert.equal(diagnostics.anchorCurveIndices.length, 1);
  const anchorIndex = diagnostics.anchorCurveIndices[0];
  assert.deepEqual(coherent.curves[anchorIndex].pts, baseline.curves[anchorIndex].pts,
    "field coherence must not alter the wrinkle-adherent anchor");
  assert.equal(diagnostics.anchorReplayMaximumErrorPx, 0);
  assert.ok(diagnostics.movedFollowerCurveCount >= 2);
  assert.ok(diagnostics.afterSpacing.minimumRatio >= 0.65 - 1e-6);
  assert.ok(diagnostics.afterSpacing.maximumRatio <= 1.45 + 1e-6);
  assert.equal(diagnostics.afterSpacing.orderPreserved, true);
  assert.ok(diagnostics.maximumTurnDegrees <= 8 + 1e-6);
  assert.equal(diagnostics.newIntersectionPairs.length, 0);
  assert.equal(diagnostics.newSelfCrossCurveCount, 0);
  assert.equal(coherent.diagnostics.post_export_new_intersection_pair_count, 0);
  assert.equal(coherent.diagnostics.post_export_new_self_cross_curve_count, 0);
}

// V3 assigns parallel wrinkles to distinct nearby RSTL curves instead of
// allowing several wrinkle trends to compete for the same curve.
{
  const seeds = [horizontalSeed("upper", 30), horizontalSeed("lower", 52)];
  const fields = evidence([rangeLine(20, 74, 34), rangeLine(20, 74, 48)]);
  const result = refineV6({
    seeds, wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      searchRadiusPx: 16,
      p90LimitPx: 12,
      maxDisplacementPx: 18,
    },
  });
  const selected = result.audit.matchRecords.filter((record) => record.provisional_accepted);
  assert.equal(selected.length, 2);
  assert.equal(new Set(selected.map((record) => record.wrinkle_segment_id)).size, 2);
  assert.equal(new Set(selected.map((record) => record.rstl_curve_index)).size, 2);
}

// V5 keeps one exclusive positional anchor but propagates its low-frequency
// normal deformation to the nearest non-anchor RSTL on both sides.
{
  const seeds = [
    horizontalSeed("anchor", 30),
    horizontalSeed("upper-follower", 24),
    horizontalSeed("lower-follower", 36),
  ];
  const fields = evidence([rangeLine(18, 76, 33)]);
  const result = refineV6({
    seeds,
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      nearestSingleCurveMatching: false,
      bundlePropagation: true,
      bundlePropagationRadiusPx: 16,
      bundleFollowerCountPerSide: 1,
      bundleFollowerStrength: 0.70,
      searchRadiusPx: 16,
      targetGapPx: 1.5,
      dataAttractionStrength: 20,
      wrinkleDominantCoreStrength: 0.95,
      smoothingPasses: 12,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
      maxCurvatureChangeDegrees: 60,
    },
  });
  assert.deepEqual(result.diagnostics.bundle_primary_anchor_curve_indices, [0]);
  assert.ok(result.curves[0].normalOffsetsPx.some((value) => Math.abs(value) > 0.05));
  assert.ok(result.curves[1].normalOffsetsPx.some((value) => Math.abs(value) > 0.05));
  assert.ok(result.curves[2].normalOffsetsPx.some((value) => Math.abs(value) > 0.05));
  assert.deepEqual(
    result.diagnostics.bundle_follower_records.map((record) => record.rstl_curve_index)
      .sort((left, right) => left - right),
    [1, 2],
  );
  assert.equal(result.diagnostics.bundle_follower_moved_curve_count, 2);
  assert.ok(result.diagnostics.bundle_minimum_spacing_ratio >= 0.65);
  assert.equal(result.diagnostics.post_export_new_intersection_pair_count, 0);
  assert.equal(result.diagnostics.topology_contract_preserved, true);
}

// Product-default nearest matching suppresses bundle propagation even when a
// stale caller explicitly requests it, so one wrinkle cannot move followers.
{
  const seeds = [
    horizontalSeed("nearest-anchor", 30),
    horizontalSeed("upper-follower", 24),
    horizontalSeed("lower-follower", 36),
  ];
  const fields = evidence([rangeLine(18, 76, 32)]);
  const result = refineV6({
    seeds,
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      bundlePropagation: true,
      bundlePropagationRadiusPx: 16,
      bundleFollowerCountPerSide: 1,
      searchRadiusPx: 16,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
    },
  });
  assert.ok(result.curves[0].normalOffsetsPx.some((value) => Math.abs(value) > 0.05));
  assert.deepEqual(result.curves[1].pts, seeds[1].pts);
  assert.deepEqual(result.curves[2].pts, seeds[2].pts);
  assert.equal(result.diagnostics.bundle_propagation_suppressed_by_nearest_single_curve, true);
  assert.equal(result.diagnostics.maximum_selected_rstl_curves_per_wrinkle, 1);
  assert.equal(result.diagnostics.bundle_follower_moved_curve_count, undefined);
  assert.equal(result.diagnostics.bundle_propagation_enabled, undefined);
}

// Two adjacent wrinkles may both influence one in-between follower. Their
// normalized contributions are solved once, so displacement cannot double.
{
  const seeds = [
    horizontalSeed("upper-anchor", 24),
    horizontalSeed("shared-follower", 36),
    horizontalSeed("lower-anchor", 48),
  ];
  const fields = evidence([rangeLine(18, 76, 29), rangeLine(18, 76, 44)]);
  const result = refineV6({
    seeds,
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      nearestSingleCurveMatching: false,
      bundlePropagation: true,
      bundlePropagationRadiusPx: 16,
      bundleFollowerCountPerSide: 1,
      bundleFollowerStrength: 0.70,
      searchRadiusPx: 16,
      targetGapPx: 1.5,
      dataAttractionStrength: 20,
      wrinkleDominantCoreStrength: 0.95,
      smoothingPasses: 12,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
      maxCurvatureChangeDegrees: 60,
    },
  });
  assert.deepEqual(
    [...result.diagnostics.bundle_primary_anchor_curve_indices].sort((left, right) => left - right),
    [0, 2],
  );
  const shared = result.diagnostics.bundle_follower_records.find((record) =>
    record.rstl_curve_index === 1);
  assert.ok(shared, "the middle RSTL must be selected as a follower");
  assert.equal(shared.source_wrinkle_segment_ids.length, 2);
  assert.equal(shared.source_anchor_curve_indices.length, 2);
  assert.equal(shared.normalized_multi_source_weights, true);
  const anchorMaximum = Math.max(
    ...[0, 2].flatMap((index) => result.curves[index].normalOffsetsPx.map(Math.abs)),
  );
  const followerMaximum = Math.max(...result.curves[1].normalOffsetsPx.map(Math.abs));
  assert.ok(followerMaximum <= anchorMaximum + 1e-9,
    `normalized follower displacement must not double (${followerMaximum} > ${anchorMaximum})`);
  assert.equal(result.diagnostics.bundle_multi_source_follower_curve_count, 1);
  assert.ok(result.diagnostics.bundle_minimum_spacing_ratio >= 0.65);
  assert.equal(result.diagnostics.post_export_new_intersection_pair_count, 0);
  assert.equal(result.diagnostics.post_export_new_self_cross_curve_count, 0);
  assert.equal(result.diagnostics.topology_contract_preserved, true);
}

// V3 wrinkle-dominant core follows both the distance and local direction of a
// curved wrinkle, and adoption is decided only after the adherence gate.
{
  const seed = horizontalSeed("v3-trajectory", 30, 8, 87, 1);
  const wrinkle = Array.from({ length: 57 }, (_, offset) => {
    const x = 20 + offset;
    return [x, 38 + Math.round(2 * Math.sin(offset / 8))];
  });
  const fields = evidence([wrinkle]);
  const result = refineV6({
    seeds: [seed], wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      postAdherenceGate: true,
      targetGapPx: 1.5,
      dataAttractionStrength: 18,
      wrinkleDominantCoreStrength: 0.88,
      wrinkleDominantCoreSupportRatio: 0.14,
      smoothingPasses: 20,
      searchRadiusPx: 16,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
      maxCurvatureChangeDegrees: 34,
    },
  });
  const adherence = result.diagnostics.trajectory_adherence_records[0];
  assert.equal(result.audit.wrinkleTrends[0].finalStatus, "accepted");
  assert.equal(result.audit.wrinkleTrends[0].finalAccepted, true);
  assert.ok(adherence.final_mean_distance_px <= adherence.mean_distance_threshold_px);
  assert.ok(adherence.final_p90_distance_px <= adherence.p90_distance_threshold_px);
  assert.ok(adherence.final_direction_p90_degrees <=
    adherence.direction_p90_threshold_degrees);
}

// A wrinkle that already satisfies the v3 distance/direction contract is
// recorded separately and leaves the prior curve byte-for-byte unchanged.
{
  const seed = horizontalSeed("already-aligned", 30);
  const fields = evidence([rangeLine(20, 74, 32)]);
  const result = refineV6({
    seeds: [seed], wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      postAdherenceGate: true,
      searchRadiusPx: 16,
      p90LimitPx: 12,
      maxDisplacementPx: 18,
    },
  });
  assert.equal(result.audit.wrinkleTrends[0].finalStatus, "already_aligned");
  assert.equal(result.audit.wrinkleTrends[0].finalAccepted, true);
  assert.deepEqual(result.curves[0].pts, seed.pts);
}

// Geometry-only soft links extend direction trends without counting a mask gap
// as direct evidence length.
{
  const seeds = [horizontalSeed("soft-link", 30)];
  const fields = evidence([
    rangeLine(20, 38, 33),
    rangeLine(41, 60, 33), // endpoint gap = 3 px; threshold = 3.9 px
  ]);
  const result = refineV6({
    seeds, wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 300,
  });
  assert.equal(result.diagnostics.soft_link_count, 1);
  assert.equal(result.diagnostics.soft_link_max_gap_px, 3.9);
  assert.ok(result.diagnostics.curve_support_records[0].direct_evidence_arc_length_px < 40,
    "the empty gap must not become direct wrinkle evidence");
}

// V6 combines two collinear fragments of one physical wrinkle across a 12 px
// extraction gap, while the empty bridge remains geometry-only.
{
  const fields = evidence([
    rangeLine(12, 34, 33),
    rangeLine(46, 78, 33),
  ]);
  const result = refineV6({
    seeds: [horizontalSeed("fragment-anchor", 29)],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 400,
    options: { logicalTrendGrouping: true },
  });
  assert.equal(result.diagnostics.wrinkle_segment_count, 1);
  assert.equal(result.diagnostics.logical_wrinkle_composite_count, 1);
  assert.equal(result.diagnostics.logical_wrinkle_grouped_fragment_count, 1);
  assert.equal(result.diagnostics.logical_wrinkle_endpoint_tangent_span_px, 8);
  assert.equal(result.audit.wrinkleTrends[0].sourcePathCount, 2);
  assert.equal(result.audit.wrinkleTrends[0].softLinkCount, 1);
  assert.ok(result.audit.wrinkleTrends[0].arcLengthPx >= 65);
  assert.ok(result.audit.wrinkleTrends[0].directArcLengthPx < 60,
    "the 12 px empty bridge must not count as direct wrinkle evidence");
}

// Spatial proximity alone cannot merge two vertically separate parallel
// wrinkles because their endpoint-to-endpoint gap is not tangent-continuous.
{
  const fields = evidence([
    rangeLine(16, 40, 31),
    rangeLine(42, 68, 37),
  ]);
  const result = refineV6({
    seeds: [horizontalSeed("parallel-anchor", 28)],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 400,
    options: { logicalTrendGrouping: true },
  });
  assert.equal(result.diagnostics.wrinkle_segment_count, 2);
  assert.equal(result.diagnostics.logical_wrinkle_composite_count, 0);
  assert.ok(result.audit.wrinkleTrends.every((trend) => trend.sourcePathCount === 1));
}

// When a long wrinkle and a short nearby fragment compete for one RSTL, v6's
// global assignment gives the anchor to the stronger span of direct evidence.
{
  const fields = evidence([
    rangeLine(42, 50, 32),
    rangeLine(12, 78, 36),
  ]);
  const result = refineV6({
    seeds: [horizontalSeed("shared-anchor", 29)],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      nearestSingleCurveMatching: false,
      globalLengthAwareMatching: true,
      searchRadiusPx: 16,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
    },
  });
  const selected = result.audit.matchRecords.filter((record) => record.provisional_accepted);
  assert.equal(selected.length, 1);
  assert.ok(selected[0].direct_evidence_arc_length_px > 50);
  assert.ok(selected[0].assignment_score > 0);
  assert.ok(result.audit.matchRecords.some((record) =>
    record.direct_evidence_arc_length_px < 12 &&
    record.rejection_reason === "curve_reserved_for_better_wrinkle"));
}

// V8 lets two spatially disjoint wrinkles anchor separate intervals of one
// long RSTL instead of reserving the entire curve for only one side.
{
  const fields = evidence([
    rangeLine(12, 31, 35),
    rangeLine(64, 83, 35),
  ]);
  const result = refineV6({
    seeds: [horizontalSeed("cross-face", 30)],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      nearestSingleCurveMatching: false,
      globalLengthAwareMatching: true,
      intervalAwareAnchorSharing: true,
      anchorIntervalPaddingPx: 3,
      searchRadiusPx: 16,
    },
  });
  const selected = result.audit.matchRecords.filter((record) => record.provisional_accepted);
  assert.equal(selected.length, 2);
  assert.deepEqual([...new Set(selected.map((record) => record.rstl_curve_index))], [0]);
  assert.ok(selected.every((record) => record.anchor_interval_shared));
  assert.equal(result.diagnostics.shared_primary_anchor_curve_count, 1);
}

// Two wrinkles whose projected support overlaps still compete for one anchor
// interval, so interval sharing cannot collapse adjacent wrinkles together.
{
  const fields = evidence([
    rangeLine(20, 56, 34),
    rangeLine(22, 58, 39),
  ]);
  const result = refineV6({
    seeds: [horizontalSeed("overlap", 30)],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      nearestSingleCurveMatching: false,
      globalLengthAwareMatching: true,
      intervalAwareAnchorSharing: true,
      anchorIntervalPaddingPx: 3,
      searchRadiusPx: 16,
    },
  });
  assert.equal(result.audit.matchRecords.filter((record) =>
    record.provisional_accepted).length, 1);
  assert.equal(result.diagnostics.shared_primary_anchor_curve_count, 0);
}

// A short wrinkle gets one explicitly audited raster-quantization allowance
// at the P90 gate; the same candidate remains rejected without that allowance.
{
  const fields = evidence([rangeLine(34, 60, 36)]);
  const options = {
    oneToOneTrendCurveMatching: true,
    globalLengthAwareMatching: true,
    postAdherenceGate: true,
    targetGapPx: 1.5,
    dataAttractionStrength: 20,
    wrinkleDominantCoreStrength: 0.95,
    smoothingPasses: 12,
    searchRadiusPx: 16,
    p90LimitPx: 18,
    maxDisplacementPx: 24,
    maxCurvatureChangeDegrees: 60,
    adherenceMeanThresholdPx: 3,
    adherenceP90ThresholdPx: 1,
    adherenceDirectionHardDegrees: 40,
  };
  const strict = refineV6({
    seeds: [horizontalSeed("short-strict", 30)],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 300,
    options,
  });
  const tolerant = refineV6({
    seeds: [horizontalSeed("short-tolerant", 30)],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 300,
    options: {
      ...options,
      shortWrinkleQuantizationTolerance: true,
      shortWrinkleMaximumLengthRatio: 0.12,
      shortWrinkleP90TolerancePx: 2,
      adherenceDirectionSoftDegrees: 25,
    },
  });
  assert.equal(strict.audit.wrinkleTrends[0].finalStatus, "rejected_p90_distance");
  assert.equal(tolerant.audit.wrinkleTrends[0].finalStatus, "accepted");
  const record = tolerant.diagnostics.trajectory_adherence_records[0];
  assert.equal(record.short_wrinkle_gate_applied, true);
  assert.equal(record.short_wrinkle_quantization_tolerance_px, 2);
  assert.equal(record.base_p90_distance_threshold_px, 1);
  assert.equal(record.p90_distance_threshold_px, 3);
}

// The displacement guard is local to each affected curve interval and uses the
// normalized 0.010*faceWidth cap.
{
  const seeds = [horizontalSeed("cap", 30)];
  const fields = evidence([rangeLine(18, 76, 42)]);
  const result = refineV6({
    seeds, wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 80,
    options: { searchRadiusPx: 16 },
  });
  const active = result.curves[0].normalOffsetsPx.filter((value) => Math.abs(value) > 0.05);
  assert.ok(active.length >= 8);
  const sorted = active.map(Math.abs).sort((a, b) => a - b);
  const position = 0.9 * (sorted.length - 1);
  const lower = Math.floor(position), upper = Math.ceil(position), mix = position - lower;
  const p90 = sorted[lower] * (1 - mix) + sorted[upper] * mix;
  assert.ok(p90 <= 0.010 * 80 + 1e-6);
  assert.equal(result.diagnostics.displacement_p90_guard_scope, "curve_affected_interval");
  assert.ok(result.diagnostics.displacement_p90_scaled_interval_count > 0);
}

// A newly introduced crossing rolls back the responsible moved curve while
// retaining array/point topology.
{
  const moving = horizontalSeed("moving", 30);
  const blocker = { name: "blocker", region: "test", pts: [[49, 30.25], [49, 75]] };
  const fields = evidence([rangeLine(18, 76, 32)]);
  const result = refineV6({
    seeds: [moving, blocker], wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 80,
  });
  assert.deepEqual(result.curves[0].pts, moving.pts);
  assert.match(result.curves[0].rollbackReason || "", /intersection/);
  assert.equal(result.diagnostics.intersection_rollback_curve_count, 1);
  assert.equal(result.diagnostics.post_export_new_intersection_pair_count, 0);
  assert.equal(result.diagnostics.topology_contract_preserved, true);
}

// If the nearest RSTL fails topology, the wrinkle is rejected instead of being
// reassigned to the second-nearest curve.
{
  const preferred = horizontalSeed("preferred", 30);
  const fallback = horizontalSeed("fallback", 36);
  const blocker = { name: "blocker", region: "test", pts: [[49, 30.25], [49, 32.5]] };
  const wrinkle = rangeLine(18, 76, 32);
  const fields = evidence([wrinkle]);
  const result = refineV6({
    seeds: [preferred, fallback, blocker],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      topologyRetryAttempts: 3,
      postAdherenceGate: true,
      targetGapPx: 1.5,
      dataAttractionStrength: 20,
      wrinkleDominantCoreStrength: 0.95,
      wrinkleDominantCoreSupportRatio: 0.08,
      smoothingPasses: 12,
      searchRadiusPx: 16,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
      maxCurvatureChangeDegrees: 60,
    },
  });
  assert.deepEqual(result.curves[0].pts, preferred.pts);
  assert.deepEqual(result.curves[1].pts, fallback.pts);
  assert.equal(result.diagnostics.topology_candidate_retry_count, 1);
  assert.equal(result.diagnostics.topology_candidate_retry_records[0].excluded_rstl_curve_index, 0);
  assert.deepEqual(result.audit.wrinkleTrends[0].acceptedCurveIndices, []);
  assert.notEqual(result.audit.wrinkleTrends[0].finalStatus, "accepted");
  assert.equal(result.diagnostics.post_export_new_intersection_pair_count, 0);
  assert.equal(result.diagnostics.post_export_new_self_cross_curve_count, 0);
  assert.equal(result.diagnostics.topology_contract_preserved, true);
}

// V4's 60-degree curvature guard lets a complete curved wrinkle pass the
// distance, P90-distance, and direction gates without changing topology.
{
  const seed = horizontalSeed("v4-curved", 30, 8, 87, 1);
  const wrinkle = Array.from({ length: 57 }, (_, offset) => {
    const x = 20 + offset;
    return [x, 38 + Math.round(3 * Math.sin(offset / 9))];
  });
  const fields = evidence([wrinkle]);
  const result = refineV6({
    seeds: [seed],
    wrinkleMask: fields.mask,
    confidenceMap: fields.confidence,
    directionQ: fields.q,
    size,
    faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      topologyRetryAttempts: 3,
      postAdherenceGate: true,
      targetGapPx: 1.5,
      dataAttractionStrength: 20,
      wrinkleDominantCoreStrength: 0.95,
      wrinkleDominantCoreSupportRatio: 0.08,
      smoothingPasses: 12,
      searchRadiusPx: 16,
      p90LimitPx: 18,
      maxDisplacementPx: 24,
      maxCurvatureChangeDegrees: 60,
    },
  });
  const adherence = result.diagnostics.trajectory_adherence_records[0];
  assert.equal(result.audit.wrinkleTrends[0].finalStatus, "accepted");
  assert.ok(adherence.final_mean_distance_px <= adherence.mean_distance_threshold_px);
  assert.ok(adherence.final_p90_distance_px <= adherence.p90_distance_threshold_px);
  assert.ok(adherence.final_direction_p90_degrees <=
    adherence.direction_p90_threshold_degrees);
  assert.equal(result.curves.length, 1);
  assert.equal(result.curves[0].pts.length, seed.pts.length);
  assert.equal(result.diagnostics.post_export_new_intersection_pair_count, 0);
  assert.equal(result.diagnostics.post_export_new_self_cross_curve_count, 0);
  assert.equal(result.diagnostics.topology_contract_preserved, true);
}

// A v3 curve rolled back by a safety guard cannot remain marked as accepted.
{
  const moving = horizontalSeed("guarded", 30);
  const blocker = { name: "blocker", region: "test", pts: [[49, 30.25], [49, 75]] };
  const fields = evidence([rangeLine(18, 76, 36)]);
  const result = refineV6({
    seeds: [moving, blocker], wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 180,
    options: {
      oneToOneTrendCurveMatching: true,
      postAdherenceGate: true,
      targetGapPx: 1.5,
      dataAttractionStrength: 18,
      wrinkleDominantCoreStrength: 0.88,
      searchRadiusPx: 16,
      p90LimitPx: 12,
      maxDisplacementPx: 18,
      maxCurvatureChangeDegrees: 34,
    },
  });
  assert.deepEqual(result.curves[0].pts, moving.pts);
  assert.equal(result.audit.wrinkleTrends[0].finalAccepted, false);
  assert.equal(result.audit.wrinkleTrends[0].finalStatus, "rejected_after_guard");
}

console.log("v6 rstl refinement tests passed");
