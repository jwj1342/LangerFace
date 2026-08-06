import assert from "node:assert/strict";

import {
  refineV6,
  resolveBundleContributions,
  V6_RSTL_ALGORITHM,
} from "../web/src/services/personalized/v6RstlRefinement.ts";
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

// A wrinkle chooses one best curve instead of weakly pulling every parallel
// RSTL in the search band.
{
  const seeds = [horizontalSeed("closest", 30), horizontalSeed("neighbor", 38)];
  const fields = evidence([rangeLine(20, 74, 33)]);
  const result = refineV6({
    seeds, wrinkleMask: fields.mask, confidenceMap: fields.confidence,
    directionQ: fields.q, size, faceWidthPx: 180,
    options: {
      exclusiveTrendMatching: true,
      p90LimitPx: 8,
      maxDisplacementPx: 12,
    },
  });
  assert.ok(result.curves[0].normalOffsetsPx.some((value) => Math.abs(value) > 0.05));
  assert.deepEqual(result.curves[1].pts, seeds[1].pts);
  assert.deepEqual(result.audit.wrinkleTrends[0].acceptedCurveIndices, [0]);
  assert.ok(result.audit.matchRecords.some((record) =>
    record.rstl_curve_index === 1 && record.rejection_reason === "better_curve_match_selected"));
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

// V4 excludes a preferred wrinkle/curve pair that creates a new crossing and
// retries the one-to-one assignment with the next topology-safe candidate.
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
  assert.ok(result.curves[1].normalOffsetsPx.some((value) => Math.abs(value) > 0.05));
  assert.equal(result.diagnostics.topology_candidate_retry_count, 1);
  assert.equal(result.diagnostics.topology_candidate_retry_records[0].excluded_rstl_curve_index, 0);
  assert.deepEqual(result.audit.wrinkleTrends[0].acceptedCurveIndices, [1]);
  assert.equal(result.audit.wrinkleTrends[0].finalStatus, "accepted");
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
