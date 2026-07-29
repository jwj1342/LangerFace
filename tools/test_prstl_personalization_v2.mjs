import assert from "node:assert/strict";
import {
  accumulateDynamicValidationV2,
  buildNeutralConsensusEvidence,
  createDynamicValidationV2,
  finalizePersonalizationEvidenceV2,
  optimizeCurvesWithFieldV2,
  PERSONALIZATION_V2_VERSION,
  smoothProjectedCurveV2,
} from "../web/compat/personalized/prstl_personalization_v2.js";

const ok = (message) => console.log(`ok: ${message}`);

function horizontalQ(size) {
  const q = new Float32Array(size * size * 2);
  for (let i = 0; i < size * size; i++) q[i * 2] = 1;
  return q;
}

function line(name, y, x0 = 18, x1 = 102, count = 43) {
  return {
    name,
    pts: Array.from({ length: count }, (_, index) => [x0 + (x1 - x0) * index / (count - 1), y]),
  };
}

function maxDisplacementSecondDifference(curve) {
  let maximum = 0;
  for (let index = 1; index < curve.pts.length - 1; index++) {
    const before = [
      curve.pts[index - 1][0] - curve.priorPts[index - 1][0],
      curve.pts[index - 1][1] - curve.priorPts[index - 1][1],
    ];
    const current = [
      curve.pts[index][0] - curve.priorPts[index][0],
      curve.pts[index][1] - curve.priorPts[index][1],
    ];
    const after = [
      curve.pts[index + 1][0] - curve.priorPts[index + 1][0],
      curve.pts[index + 1][1] - curve.priorPts[index + 1][1],
    ];
    maximum = Math.max(maximum, Math.hypot(
      before[0] - 2 * current[0] + after[0],
      before[1] - 2 * current[1] + after[1],
    ));
  }
  return maximum;
}

{
  const size = 72, skin = new Uint8Array(size * size).fill(1);
  const frames = [];
  for (let frameIndex = 0; frameIndex < 5; frameIndex++) {
    const gray = new Float32Array(size * size).fill(125 + frameIndex * 3);
    for (let x = 8; x < size - 8; x++) {
      gray[34 * size + x] -= 42;
      gray[(12 + frameIndex * 7) * size + x] -= 28;
    }
    frames.push(gray);
  }
  const consensus = buildNeutralConsensusEvidence(frames, size, size, skin);
  let stable = 0, moving = 0;
  for (let x = 12; x < size - 12; x++) {
    stable += consensus.confidence[34 * size + x];
    moving += consensus.confidence[(12 + 2 * 7) * size + x];
  }
  assert(stable > moving * 1.25, `stable=${stable}, moving=${moving}`);
  ok("中性多帧方向共识抑制移动伪影");

  const validation = createDynamicValidationV2(size * size);
  const emptyNeutral = { q: consensus.q, confidence: new Float32Array(size * size) };
  const action = {
    q: consensus.q, coh: new Float32Array(size * size).fill(1),
    ridge: new Float32Array(size * size).fill(1), deformation: new Float32Array(size * size).fill(1),
  };
  accumulateDynamicValidationV2(emptyNeutral, action, new Float32Array(size * size).fill(1), validation,
    { repeatability: 1, temporalPersistence: 1, expressionAmplitudeQuality: 1 });
  assert.equal(Math.max(...validation), 0);
  ok("没有中性候选时表情不能独立生成个性化证据");
}

{
  const size = 120, n = size * size;
  const skin = new Uint8Array(n).fill(1), forbidden = new Uint8Array(n);
  const q0 = horizontalQ(size), confidence = new Float32Array(n), ridge = new Float32Array(n);
  for (let y = 45; y <= 49; y++) {
    for (let x = 12; x < 108; x++) {
      const index = y * size + x;
      confidence[index] = 0.95;
      ridge[index] = 1;
    }
  }
  const result = optimizeCurvesWithFieldV2(q0, confidence, ridge, q0,
    [line("test", 30)], skin, forbidden, size,
    { gridSize: 15, smoothness: 1.0, anchor: 0.025, minEvidence: 0.05, minImprovement: 0.002 });
  const curve = result.curves[0];
  const offsets = curve.pts.map((point, index) => point[1] - curve.priorPts[index][1]);
  const central = offsets.slice(8, -8);
  const mean = central.reduce((sum, value) => sum + value, 0) / central.length;
  let maxSecondDifference = 0;
  for (let i = 1; i < offsets.length - 1; i++) {
    maxSecondDifference = Math.max(maxSecondDifference, Math.abs(offsets[i - 1] - 2 * offsets[i] + offsets[i + 1]));
  }
  assert(mean > 9, `mean=${mean}`);
  assert(maxSecondDifference < 0.35, `secondDifference=${maxSecondDifference}`);
  assert(result.diagnostics.jacobian.min >= 0.35);
  assert.equal(result.diagnostics.new_intersection_pairs, 0);
  assert.equal(curve.rollbackReason, null);
  ok(`连续场允许有证据的位移越过旧 9px 帽（${mean.toFixed(2)}px）`);
  ok(`连续场位移无逐点折角（二阶差 ${maxSecondDifference.toFixed(3)}px）`);
  ok("正 Jacobian 与拓扑检查通过且不做整线回退");

  const zero = optimizeCurvesWithFieldV2(q0, new Float32Array(n), new Float32Array(n), q0,
    [line("a", 30), line("b", 70)], skin, forbidden, size);
  const maxZero = Math.max(...zero.curves.flatMap((item) => item.pts.map((point, index) =>
    Math.hypot(point[0] - item.priorPts[index][0], point[1] - item.priorPts[index][1]))));
  assert(maxZero < 1e-6, `maxZero=${maxZero}`);
  assert.equal(zero.curves.length, 2);
  ok("无证据时全部原始曲线严格不动且数量不变");
}

{
  const size = 120, n = size * size;
  const skin = new Uint8Array(n).fill(1), forbidden = new Uint8Array(n);
  const q0 = horizontalQ(size), confidence = new Float32Array(n), ridge = new Float32Array(n);
  for (let y = 45; y <= 49; y++) {
    for (let x = 12; x < 108; x++) {
      confidence[y * size + x] = 0.95;
      ridge[y * size + x] = 1;
    }
  }
  const result = optimizeCurvesWithFieldV2(q0, confidence, ridge, q0,
    [line("near", 30), line("far", 88)], skin, forbidden, size,
    { gridSize: 15, smoothness: 1.0, anchor: 0.025, minEvidence: 0.05, minImprovement: 0.002 });
  const nearMean = result.curves[0].pts.reduce((sum, point, index) =>
    sum + Math.hypot(point[0] - result.curves[0].priorPts[index][0],
      point[1] - result.curves[0].priorPts[index][1]), 0) / result.curves[0].pts.length;
  const farMaximum = Math.max(...result.curves[1].pts.map((point, index) =>
    Math.hypot(point[0] - result.curves[1].priorPts[index][0],
      point[1] - result.curves[1].priorPts[index][1])));
  assert(nearMean > 8, `nearMean=${nearMean}`);
  assert(farMaximum < 1e-6, `farMaximum=${farMaximum}`);
  assert.equal(result.diagnostics.unsupported_moved_points, 0);
  ok(`强证据附近产生明显位移（${nearMean.toFixed(2)}px），远处无证据曲线严格不动`);

  for (let x = 0; x < size; x++) forbidden[30 * size + x] = 1;
  const blocked = optimizeCurvesWithFieldV2(q0, confidence, ridge, q0,
    [line("blocked", 30), line("source", 34)], skin, forbidden, size,
    { gridSize: 15, smoothness: 1.0, anchor: 0.025, minEvidence: 0.05, minImprovement: 0.002 });
  const blockedMaximum = Math.max(...blocked.curves[0].pts.map((point, index) =>
    Math.hypot(point[0] - blocked.curves[0].priorPts[index][0],
      point[1] - blocked.curves[0].priorPts[index][1])));
  assert(blockedMaximum < 1e-6, `blockedMaximum=${blockedMaximum}`);
  assert.equal(blocked.diagnostics.occluded_moved_points, 0);
  assert(maxDisplacementSecondDifference(blocked.curves[1]) <= 0.85);
  ok("遮挡/禁区点严格保持原线，局部位移仍满足整线连续性限制");
}

{
  const projected = Array.from({ length: 13 }, (_, index) => [index, index % 2 ? 2 : -2]);
  const smoothed = smoothProjectedCurveV2(projected, 2);
  const roughness = (points) => Math.max(...points.slice(1, -1).map((point, index) =>
    Math.abs(points[index][1] - 2 * point[1] + points[index + 2][1])));
  assert(roughness(smoothed) < roughness(projected) * 0.25);
  assert.deepEqual(smoothed[0], projected[0]);
  assert.deepEqual(smoothed.at(-1), projected.at(-1));
  ok("实时三角网格重投影后的折线被沿整条曲线平滑，且端点保持不变");
}

{
  const size = 32, n = size * size, skin = new Uint8Array(n).fill(1);
  const q0 = horizontalQ(size);
  const neutral = {
    q: q0, confidence: new Float32Array(n).fill(0.5), ridge: new Float32Array(n).fill(0.4),
  };
  const dynamic = new Float32Array(n).fill(0.6);
  const final = finalizePersonalizationEvidenceV2(q0, neutral, dynamic, skin);
  assert(final.confidence[0] > neutral.confidence[0]);
  assert(final.confidence[0] <= 1);
  ok("动态重复只增强中性候选的置信度");
  assert(PERSONALIZATION_V2_VERSION.includes("diffeomorphic"));
}

console.log("\n✅ prstl_personalization_v2 测试通过");
