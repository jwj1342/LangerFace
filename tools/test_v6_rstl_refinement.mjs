import assert from "node:assert/strict";

import {
  refineV6,
  V6_RSTL_ALGORITHM,
} from "../web/src/services/personalized/v6RstlRefinement.ts";

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

console.log("v6 rstl refinement tests passed");
