/**
 * 浏览器 atlas 微调管线数值测试（非个体 RSTL 测量正确性证明）。
 *   node tools/test_prstl_pipeline.mjs
 */
import { readFileSync } from "node:fs";
import {
  angleToQ,
  axialDiffDeg,
  relativeScore,
  estimateBaseline,
  personalThreshold,
  fuseEvidence,
  evaluateQualityGate,
  dynamicConfidenceScore,
  decideRepeatability,
  stableStaticTextureEvidence,
  temporalMedianGray,
  initializeStaticEvidence,
  normalizedReturnConsistency,
  robustReturnNeutral,
  actionMeshResidual,
  estimateReturnMeshThreshold,
  landmarksToCanonicalXY,
  CANONICAL_REGISTRATION_ANCHORS,
  meshDeformationSupport,
  chooseNextAction,
  createRegionEvidenceState,
  buildMasks,
  buildMasksFromMesh,
  buildGlabellaWrinkleMask,
  buildActionWrinkleMask,
  estimatePoseQuality,
  blockMatchFlow,
  pointToBary,
  baryToPoint,
  optimizePriorCurves,
  summarizeWeightedField,
  summarizeCurveDisplacements,
  createSessionState,
  TIMED_ACTIONS,
  REFINE_CONF,
  SIZE,
} from "../web/compat/personalized/prstl_pipeline.js";
import {
  extractDifferentialWrinkles,
  fuseRepeatedWrinkleExtractions,
  fuseRepeatedWrinkleProbabilities,
} from "../web/compat/personalized/wrinkle_extraction.js";

let fail = 0;
const ok = (c, m) => {
  if (!c) { console.error("FAIL:", m); fail++; }
  else console.log("ok:", m);
};
const near = (a, b, eps = 1e-2) => Math.abs(a - b) < eps;

ok(TIMED_ACTIONS.has("frown"), "皱眉采用定时单次采集，不再被 browDown 阈值无限阻塞");

// ── axialDiffDeg ────────────────────────────────────────────────────────────
ok(near(axialDiffDeg(angleToQ(0), angleToQ(0)), 0), "同向差 0°");
ok(near(axialDiffDeg(angleToQ(0), angleToQ(Math.PI)), 0), "θ~θ+π 等价 → 0°");
ok(near(axialDiffDeg(angleToQ(0), angleToQ(Math.PI / 4)), 45), "45°");
ok(near(axialDiffDeg(angleToQ(0), angleToQ(Math.PI / 2)), 90), "垂直必须是 90° 而非 0°");

// ── 眉间川字纹：同机位差分、黑帽/Hessian、骨架/PCA、两轮复现 ─────────────
{
  const width = 96, height = 96, n = width * height;
  const skin = new Uint8Array(n); skin.fill(1);
  const roi = buildGlabellaWrinkleMask(null, skin, width);
  const makePair = (depth, exposure = 0, lineX = 48, horizontal = false, sigma = 0.9) => {
    const neutral = new Float32Array(n), expression = new Float32Array(n);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const verticalGroove = horizontal ? 0 : depth * Math.exp(-0.5 * ((x - lineX) / sigma) ** 2);
      const horizontalGroove = horizontal ? depth * Math.exp(-0.5 * ((y - 33) / sigma) ** 2) : 0;
      const illuminationEdge = x >= 42 ? 18 : 0;
      neutral[y * width + x] = 138 + illuminationEdge;
      expression[y * width + x] = 138 + exposure + illuminationEdge - verticalGroove - horizontalGroove;
    }
    return { neutral, expression };
  };
  const extract = (pair) => extractDifferentialWrinkles(pair.neutral, pair.expression, width, height, roi);
  for (const method of ["blackhat-frangi", "oriented-gabor", "edge-pair", "ensemble", "frown-consensus", "frown-furrow", "paired-expression-lines"]) {
    const broad = makePair(14, 6, 48, false, 2.1);
    const detected = extractDifferentialWrinkles(
      broad.neutral, broad.expression, width, height, roi, { method },
    );
    ok(detected.skeletonPixels > 3, `${method} 可检出较浅的宽皱眉纹（${detected.skeletonPixels} px）`);
  }
  const horizontalFrown = makePair(24, 0, 48, true, 1.2);
  const rejectedBrowEdge = extractDifferentialWrinkles(
    horizontalFrown.neutral, horizontalFrown.expression, width, height, roi,
    { method: "frown-consensus" },
  );
  ok(rejectedBrowEdge.skeletonPixels === 0,
    "frown-consensus 不把水平眉毛移动边缘当成川字纹");
  const rejectedFurrowBrowEdge = extractDifferentialWrinkles(
    horizontalFrown.neutral, horizontalFrown.expression, width, height, roi,
    { method: "frown-furrow" },
  );
  ok(rejectedFurrowBrowEdge.skeletonPixels === 0,
    "frown-furrow 不把水平眉毛移动边缘当成川字纹");
  const genericHorizontal = extractDifferentialWrinkles(
    horizontalFrown.neutral, horizontalFrown.expression, width, height, roi,
    { method: "paired-expression-lines" },
  );
  ok(genericHorizontal.skeletonPixels > 3,
    "通用表情提取器可保留抬眉等动作产生的水平皱纹");
  const stableBoundaryNeutral = new Float32Array(n);
  const stableBoundaryExpression = new Float32Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const fixedDarkLine = 24 * Math.exp(-0.5 * ((x - 48) / 1.2) ** 2);
    stableBoundaryNeutral[y * width + x] = 145 - fixedDarkLine;
    stableBoundaryExpression[y * width + x] = 145 - fixedDarkLine;
  }
  const rejectedStableBoundary = extractDifferentialWrinkles(
    stableBoundaryNeutral, stableBoundaryExpression, width, height, roi,
    { method: "paired-expression-lines" },
  );
  ok(rejectedStableBoundary.skeletonPixels === 0,
    "通用提取器不把中性和表情共有的稳定暗边当作皱纹");
  const identicalTexture = new Float32Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    identicalTexture[y * width + x] = 0.52 + 0.012 * Math.sin(x * 0.71) * Math.cos(y * 0.53);
  }
  const identicalDefault = extractDifferentialWrinkles(
    identicalTexture, identicalTexture, width, height, roi,
  );
  ok(identicalDefault.skeletonPixels === 0 && !identicalDefault.absoluteGatePassed,
    "默认严格差分和MAD绝对门控在[0,1]相同纹理输入上返回空");
  const movingEdgeNeutral = new Float32Array(n);
  const movingEdgeExpression = new Float32Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    movingEdgeNeutral[y * width + x] = x < 46 ? 126 : 166;
    movingEdgeExpression[y * width + x] = x < 50 ? 126 : 166;
  }
  const rejectedMovingEdge = extractDifferentialWrinkles(
    movingEdgeNeutral, movingEdgeExpression, width, height, roi,
    { method: "paired-expression-lines" },
  );
  ok(rejectedMovingEdge.skeletonPixels === 0,
    "双侧沟槽横截面门控拒绝发生位移的单侧五官边缘");
  const makeFiniteGroove = (y0, y1) => {
    const neutral = new Float32Array(n), expression = new Float32Array(n);
    neutral.fill(145); expression.fill(145);
    for (let y = y0; y <= y1; y++) for (let x = 0; x < width; x++) {
      expression[y * width + x] -= 24 * Math.exp(-0.5 * ((x - 48) / 1.4) ** 2);
    }
    return { neutral, expression };
  };
  const shortGroove = makeFiniteGroove(45, 51);
  const longGroove = makeFiniteGroove(20, 75);
  const shortRejected = extractDifferentialWrinkles(
    shortGroove.neutral, shortGroove.expression, width, height, roi,
    { method: "paired-expression-lines", minComponentPixels: 5 },
  );
  const longAccepted = extractDifferentialWrinkles(
    longGroove.neutral, longGroove.expression, width, height, roi,
    { method: "paired-expression-lines", minComponentPixels: 5 },
  );
  ok(shortRejected.skeletonPixels === 0,
    "曲线级连续长度门控拒绝孤立短碎片");
  ok(longAccepted.skeletonPixels >= 5,
    "曲线级连续长度门控保留足够长的双侧暗沟");
  const normalizedPair = makePair(18, 0, 48, false, 1.5);
  for (let index = 0; index < n; index++) {
    normalizedPair.neutral[index] /= 255;
    normalizedPair.expression[index] /= 255;
  }
  const normalizedDetected = extractDifferentialWrinkles(
    normalizedPair.neutral, normalizedPair.expression, width, height, roi,
    { method: "paired-expression-lines" },
  );
  ok(normalizedDetected.absoluteGatePassed && Math.max(...normalizedDetected.response) > 0 &&
    normalizedDetected.diagnostics.input_range_factor === 255,
    "[0,1]灰度输入会统一到定义明确的内部强度范围");
  const delayedFields = [
    makePair(14, -2, 48, false, 1.5), makePair(13, 2, 49, false, 1.5),
    makePair(15, 1, 48, false, 1.5), makePair(14, -1, 49, false, 1.5),
  ].map((pair) => extractDifferentialWrinkles(
    pair.neutral, pair.expression, width, height, roi,
    { method: "paired-expression-lines", minComponentPixels: 50 },
  ));
  ok(delayedFields.every((field) => field.skeletonPixels === 0),
    "概率融合测试的单帧候选在骨架阶段被刻意延迟");
  const probabilityFused = fuseRepeatedWrinkleProbabilities(
    delayedFields.slice(0, 2), delayedFields.slice(2), width, height, roi,
    { minFrameProbability: 0.08, minCycleProbability: 0.08,
      minFusedProbability: 0.10, minRepeatedComponentPixels: 5 },
  );
  ok(probabilityFused.repeatedPixels > 3 &&
    probabilityFused.fusionMode === "probability-first-single-skeleton",
  "多帧先融合连续概率图、最后一次骨架化可保留一致弱沟");
  const frownExtract = (pair) => extractDifferentialWrinkles(
    pair.neutral, pair.expression, width, height, roi, { method: "frown-consensus" },
  );
  const shiftedFrown = fuseRepeatedWrinkleExtractions(
    [makePair(24, -4, 46, false, 1.4), makePair(22, 5, 47, false, 1.4)].map(frownExtract),
    [makePair(23, 6, 49, false, 1.4), makePair(25, -3, 48, false, 1.4)].map(frownExtract),
    width, height, roi, { matchRadius: 3, minDirectionAgreement: 0.78 },
  );
  ok(shiftedFrown.repeatedPixels > 3,
    "皱眉共识容忍脸宽比例的小位移但仍需方向一致");
  const firstCycle = [makePair(28, -8, 48), makePair(26, 7, 48)].map(extract);
  const secondCycle = [makePair(27, 9, 49), makePair(29, -5, 48)].map(extract);
  const repeated = fuseRepeatedWrinkleProbabilities(
    firstCycle, secondCycle, width, height, roi,
    { minFrameProbability: 0.06, minCycleProbability: 0.06,
      minFusedProbability: 0.08, minRepeatedComponentPixels: 4 },
  );
  ok(firstCycle.every((field) => field.absoluteGatePassed && Math.max(...field.response) > 0),
    "黑帽/Hessian 产生通过绝对门控的连续线状概率响应");
  ok(repeated.repeatedPixels > 3, `两轮川字纹产生重复中心线（${repeated.repeatedPixels} px）`);
  ok(repeated.globalRepeatability > 0.75,
    `两轮曝光变化下方向可复现（${repeated.globalRepeatability.toFixed(3)}）`);
  let verticalWeight = 0, verticalError = 0, outside = 0;
  for (let index = 0; index < n; index++) {
    const weight = repeated.confidence[index];
    if (weight > 0) {
      verticalError += weight * axialDiffDeg(
        [repeated.q[index * 2], repeated.q[index * 2 + 1]], angleToQ(Math.PI / 2),
      );
      verticalWeight += weight;
    }
    if (roi[index] <= 0) outside = Math.max(outside, weight);
  }
  ok(verticalWeight > 0 && verticalError / verticalWeight < 12,
    `提交方向保持眉间纵向（mean ${verticalWeight ? (verticalError / verticalWeight).toFixed(2) : "n/a"}°）`);
  ok(outside === 0, "眉间证据不会泄漏到脸缘或其他区域");
  const edgeResponse = firstCycle[0].response[33 * width + 42];
  ok(edgeResponse === 0, "中性/表情共有的单边亮度边界在差分中被消除");
  const inconsistent = fuseRepeatedWrinkleProbabilities(
    firstCycle, [makePair(28, 0, 48, true), makePair(27, 4, 48, true)].map(extract),
    width, height, roi,
    { minFrameProbability: 0.06, minCycleProbability: 0.06,
      minFusedProbability: 0.08, minRepeatedComponentPixels: 4 },
  );
  ok(inconsistent.repeatedPixels < repeated.repeatedPixels * 0.25,
    "两轮方向冲突时自动回退，不提交川字纹证据");
}

// ── ROI-relative scale must not depend on unused canvas size ───────────────
{
  const runFixedRoi = (canvasSize) => {
    const n = canvasSize * canvasSize;
    const neutral = new Float32Array(n), expression = new Float32Array(n);
    const mask = new Uint8Array(n);
    neutral.fill(145); expression.fill(145);
    const cx = Math.floor(canvasSize / 2), half = 40;
    for (let y = cx - half; y < cx + half; y++) for (let x = cx - half; x < cx + half; x++) {
      const index = y * canvasSize + x;
      mask[index] = 1;
      expression[index] -= 19 * Math.exp(-0.5 * ((x - cx) / 1.5) ** 2);
    }
    return extractDifferentialWrinkles(
      neutral, expression, canvasSize, canvasSize, mask,
      { method: "paired-expression-lines" },
    );
  };
  const compactCanvas = runFixedRoi(160);
  const largeCanvas = runFixedRoi(512);
  ok(compactCanvas.skeletonPixels > 3 && largeCanvas.skeletonPixels > 3,
    "相同80px皱纹ROI在小画布和大画布中都能检出");
  ok(Math.abs(compactCanvas.skeletonPixels - largeCanvas.skeletonPixels) <= 3 &&
    near(compactCanvas.diagnostics.analysis_scale, largeCanvas.diagnostics.analysis_scale, 1e-6),
  `滤波尺度由ROI而非整图决定（${compactCanvas.skeletonPixels}/${largeCanvas.skeletonPixels}px）`);
}

// ── 眉上斜向皱眉沟不能被宽眉毛禁区一并删除 ───────────────────────────────
{
  const size = 96, mesh = Array.from({ length: 468 }, () => [48, 48]);
  const oval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397,
    365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
    234, 127, 162, 21, 54, 103, 67, 109];
  oval.forEach((index, order) => {
    const angle = 2 * Math.PI * order / oval.length;
    mesh[index] = [48 + 35 * Math.cos(angle), 49 + 41 * Math.sin(angle)];
  });
  const leftBrow = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
  const rightBrow = [336, 296, 334, 293, 300, 285, 295, 282, 283, 276];
  leftBrow.forEach((index, order) => { mesh[index] = [27 + order * 2.0, 39 - 0.4 * order]; });
  rightBrow.forEach((index, order) => { mesh[index] = [69 - order * 2.0, 39 - 0.4 * order]; });
  const skin = new Uint8Array(size * size); skin.fill(1);
  skin[30 * size + 42] = 0; // 宽眉毛磁盘错误吞掉的眉上皮肤
  skin[38 * size + 42] = 0; // 真正眉毛带仍应排除
  const mask = buildGlabellaWrinkleMask(mesh, skin, size);
  ok(mask[30 * size + 42] > 0, "眉毛上方的斜向皱眉沟 ROI 被恢复");
  ok(mask[38 * size + 42] === 0, "紧贴眉毛毛发的像素仍保持排除");

  const leftEye = [33, 133, 160, 159, 158, 157, 173, 155, 154, 153, 145, 144, 163, 7];
  const rightEye = [362, 263, 387, 386, 385, 384, 398, 382, 381, 380, 374, 373, 390, 249];
  leftEye.forEach((index, order) => { mesh[index] = [29 + (order % 7) * 1.5, 43 + (order > 6 ? 2 : 0)]; });
  rightEye.forEach((index, order) => { mesh[index] = [58 + (order % 7) * 1.5, 43 + (order > 6 ? 2 : 0)]; });
  const lips = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 78, 95, 88, 178, 87, 14, 317, 402];
  lips.forEach((index, order) => { mesh[index] = [38 + (order % 11) * 2, 68 + (order > 10 ? 4 : 0)]; });
  const noseBoundary = [1, 2, 4, 5, 6, 19, 45, 48, 49, 64, 94, 97, 98, 115, 168, 195, 197, 220, 275, 278, 279, 294, 326, 327, 344, 440];
  noseBoundary.forEach((index, order) => { mesh[index] = [43 + (order % 7) * 1.7, 51 + Math.floor(order / 7) * 3]; });
  const actionSkin = new Uint8Array(size * size); actionSkin.fill(1);
  const squintMask = buildActionWrinkleMask("squint", mesh, actionSkin, size);
  const purseMask = buildActionWrinkleMask("purse", mesh, actionSkin, size);
  const puffMask = buildActionWrinkleMask("puff", mesh, actionSkin, size);
  ok(squintMask[44 * size + 34] === 0, "眯眼皱纹 ROI 硬排除眼睑和泪沟边界");
  ok(purseMask[57 * size + 48] === 0 && purseMask[70 * size + 48] === 0,
    "撅嘴皱纹 ROI 硬排除鼻翼、鼻孔和嘴唇边界");
  ok(!puffMask.some((value) => value > 0), "鼓腮只作拉伸反证，不生成正皱纹候选");
}

// ── 个人相对基线 ────────────────────────────────────────────────────────────
const bsList = [
  { browInnerUp: 0.3, browOuterUpLeft: 0.28, browOuterUpRight: 0.29 },
  { browInnerUp: 0.32, browOuterUpLeft: 0.3, browOuterUpRight: 0.31 },
  { browInnerUp: 0.29, browOuterUpLeft: 0.27, browOuterUpRight: 0.28 },
];
const base = estimateBaseline(bsList);
ok(base.raise_brows > 0.25 && base.raise_brows < 0.35, "抬眉静息基线约 0.3");
const high = { browInnerUp: 0.5, browOuterUpLeft: 0.48, browOuterUpRight: 0.49 };
ok(relativeScore(high, "raise_brows", base) > 0.1, "相对静息有增量");
ok(personalThreshold("raise_brows", base) >= 0.05, "个人阈值合理");
ok(personalThreshold("frown", { frown: 0 }) < 0.08,
  "皱眉阈值适配手机端较弱的 browDown 输出");

// ── 可解释置信度与硬门控 ────────────────────────────────────────────────────
{
  const pass = evaluateQualityGate({ tracking: 0.9, illumination: 0.9, returnConsistency: 0.9, validPeakFrames: 4 });
  const failGate = evaluateQualityGate({ tracking: 0.3, illumination: 0.9, returnConsistency: 0.9, validPeakFrames: 4 });
  ok(pass.valid, "质量硬门控允许合格循环");
  ok(!failGate.valid && failGate.reasons.includes("tracking"), "质量硬门控拒绝跟踪失败");
  ok(near(dynamicConfidenceScore({ temporalPersistence: 1, repetitionConsistency: 1, wrinkleVisibility: 1, deformationSupport: 1, expressionAmplitudeQuality: 1, neutralReturnConsistency: 1 }), 1), "六项动态验证全部满足时置信度为 1");
  ok(dynamicConfidenceScore({ temporalPersistence: 1, repetitionConsistency: 1, wrinkleVisibility: 1, deformationSupport: 1, expressionAmplitudeQuality: 1 }) < 0.9, "缺少回到中性的验证时动态证据不能达到满置信度");
  ok(decideRepeatability("squint", 0.52, 0).directionValidated, "眯眼采用适配眼周弱纹理的重复性阈值");
  ok(decideRepeatability("squint", 0.30, 0).retry, "眯眼首次方向不足会引导重采第 2 轮");
  const squintFallback = decideRepeatability("squint", 0.30, 1);
  ok(squintFallback.accept && !squintFallback.directionValidated && squintFallback.mode === "prior_preserved", "眯眼重试后仍不足则保守保留先验而非无限失败");
}

// ── 回落判断：容忍镜头小位移、亮度变化与少数 blendshape 毛刺 ───────────────
{
  const w = 24, h = 24, n = w * h;
  const ref = new Float32Array(n), shifted = new Float32Array(n), mask = new Uint8Array(n);
  mask.fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    ref[y * w + x] = 80 + 35 * Math.sin(x * 0.43) + 20 * Math.cos(y * 0.37);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.max(0, x - 2);
    shifted[y * w + x] = ref[y * w + sx] * 1.15 + 12;
  }
  const similarity = normalizedReturnConsistency(ref, shifted, mask, w, h, 2);
  ok(similarity > 0.95, `回落图像容忍 2px 位移与亮度变化（got ${similarity.toFixed(3)}）`);

  const neutralBase = Object.fromEntries(["raise_brows", "frown", "squint", "smile", "puff", "purse", "open_mouth"].map((a) => [a, 0]));
  const noisyHistory = Array.from({ length: 7 }, () => ({ mouthSmileLeft: 0.35 }));
  const robust = robustReturnNeutral(noisyHistory, "raise_brows", neutralBase, 7);
  ok(robust.stable, "少数非当前通道毛刺不阻塞自然回落");
  const notReturned = Array.from({ length: 7 }, () => ({ browInnerUp: 0.25 }));
  ok(!robustReturnNeutral(notReturned, "raise_brows", neutralBase, 7).stable, "当前动作未放松时仍拒绝回落");

  const refMesh = Array.from({ length: 468 }, (_, i) => [40 + (i % 26) * 8, 45 + Math.floor(i / 26) * 10]);
  const th = 9 * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
  const cameraMove = (p) => [1.18 * (cs * p[0] - sn * p[1]) + 52, 1.18 * (sn * p[0] + cs * p[1]) - 31];
  const movedMesh = refMesh.map(cameraMove);
  const alignedMoved = landmarksToCanonicalXY(movedMesh, 320, refMesh);
  const rigidResidual = actionMeshResidual(refMesh, alignedMoved, "raise_brows");
  ok(rigidResidual < 0.01, `相机平移/缩放/旋转不触发表情残差（got ${rigidResidual.toFixed(4)}px）`);
  const dynamicMoved = movedMesh.map((point, index) =>
    CANONICAL_REGISTRATION_ANCHORS.includes(index) ? point : [point[0] + 18, point[1] - 9]);
  const allPointFit = landmarksToCanonicalXY(dynamicMoved, 320, refMesh);
  const stableFit = landmarksToCanonicalXY(dynamicMoved, 320, refMesh, {
    anchorIndices: CANONICAL_REGISTRATION_ANCHORS,
  });
  const anchorResidual = (mesh) => CANONICAL_REGISTRATION_ANCHORS.reduce((sum, index) =>
    sum + Math.hypot(mesh[index][0] - refMesh[index][0], mesh[index][1] - refMesh[index][1]), 0) /
    CANONICAL_REGISTRATION_ANCHORS.length;
  ok(anchorResidual(stableFit) < anchorResidual(allPointFit) * 0.15,
    "稳定锚点拟合不会被眉眼口等大范围表情点拖偏");
  const expressed = refMesh.map((p, i) => {
    const brow = [46, 52, 53, 55, 63, 65, 66, 70, 105, 107, 276, 282, 283, 285, 293, 295, 296, 300, 334, 336].includes(i);
    return cameraMove([p[0], p[1] + (brow ? -5 : 0)]);
  });
  const alignedExpression = landmarksToCanonicalXY(expressed, 320, refMesh);
  const expressionResidual = actionMeshResidual(refMesh, alignedExpression, "raise_brows");
  ok(expressionResidual > 3, `真实抬眉残差仍被保留（got ${expressionResidual.toFixed(2)}px）`);
  const adaptiveThreshold = estimateReturnMeshThreshold([0.5, 0.6, 0.7, 0.65, 0.8, 0.55]);
  ok(adaptiveThreshold >= 1.4 && adaptiveThreshold < expressionResidual, `静息底噪阈值自适应且低于真实动作（got ${adaptiveThreshold.toFixed(2)}px）`);

}

// ── 形变只输出支持/否决标量，不携带方向 ──────────────────────────────────────
{
  const ref = [[4, 4], [20, 4], [4, 20]];
  const cur = [[4, 4], [18, 4], [4, 21]];
  const def = meshDeformationSupport(ref, cur, [[0, 1, 2]], 24);
  ok(def.support.some((v) => v > 0), "三角 Jacobian 产生形变支持标量");
  ok(!("q" in def) && !("direction" in def), "形变分支不输出方向");
  const state = createRegionEvidenceState();
  const next = chooseNextAction(state, [], [], {}).action;
  ok(next === "raise_brows", "自适应调度先从核心低置信区域开始");
}

// ── 不含图像的调试摘要 ────────────────────────────────────────────────────
{
  const field = new Float32Array([0, 0.25, 0.5, 1]);
  const weights = new Float32Array([0, 1, 1, 2]);
  const summary = summarizeWeightedField(field, weights);
  ok(summary.count === 3 && near(summary.mean, 0.6875, 1e-6), "证据场摘要采用区域加权均值");
  ok(near(summary.ratios["0.5"], 0.75, 1e-6), "证据场摘要报告超过微调阈值的权重比例");
  const displacement = summarizeCurveDisplacements([{
    name: "debug-line",
    priorPts: [[0, 0], [1, 0], [2, 0]],
    pts: [[0, 0], [1, 1], [2, 0]],
  }]);
  ok(displacement.moved_points === 1 && near(displacement.max_offset_px, 1), "曲线调试摘要定位实际移动点与最大位移");
}

// ── 静态皮纹：必须跨中性帧稳定，并抑制逐帧移动的伪影 ─────────────────────
{
  const w = 48, h = 48, n = w * h;
  const skin = new Uint8Array(n); skin.fill(1);
  const frames = Array.from({ length: 8 }, (_, frameIndex) => {
    const gray = new Float32Array(n);
    const transientX = 5 + frameIndex * 5;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const stableGroove = 34 * Math.exp(-0.5 * ((y - 24) / 1.1) ** 2);
      const movingArtifact = Math.abs(x - transientX) <= 1 ? 32 : 0;
      gray[y * w + x] = 142 + 0.18 * x - stableGroove - movingArtifact + frameIndex * 0.7;
    }
    return gray;
  });
  const neutral = temporalMedianGray(frames);
  const evidence = stableStaticTextureEvidence(neutral, frames, w, h, skin);
  let stable = 0, background = 0, count = 0;
  for (let x = 10; x < 38; x++) {
    stable += evidence.confidence[22 * w + x] + evidence.confidence[26 * w + x];
    background += evidence.confidence[12 * w + x] + evidence.confidence[36 * w + x];
    count += 2;
  }
  stable /= count; background /= count;
  ok(evidence.frameCount >= 8 && evidence.illuminationStability > 0.5,
    `静态证据记录多帧与光照稳定性（${evidence.illuminationStability.toFixed(3)}）`);
  ok(stable > background * 1.8 && stable > 0.04,
    `稳定细沟显著高于移动伪影/背景（stable=${stable.toFixed(3)}, background=${background.toFixed(3)}）`);
}

// ── 两轮多帧融合：低纹理光流不能吞掉重复且清晰的皮纹证据 ─────────────────
{
  const size = 64, n = size * size;
  const skin = new Uint8Array(n), forbidden = new Uint8Array(n);
  for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) skin[y * size + x] = 1;
  const horizontal = angleToQ(0);
  const q0 = new Float32Array(n * 2), qTex = new Float32Array(n * 2);
  const coh = new Float32Array(n), amp = new Float32Array(n), ridge = new Float32Array(n);
  const flow = { conf: new Float32Array(n) };
  const deformation = new Float32Array(n), regionWeight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    q0[i * 2] = horizontal[0]; q0[i * 2 + 1] = horizontal[1];
    qTex[i * 2] = horizontal[0]; qTex[i * 2 + 1] = horizontal[1];
  }
  for (let x = 10; x <= 54; x++) {
    const idx = 36 * size + x;
    coh[idx] = 0.72; amp[idx] = 1; ridge[idx] = 1;
    flow.conf[idx] = 0.05; deformation[idx] = 0.62; regionWeight[idx] = 1;
  }
  const state = createSessionState(size);
  const staticConfidence = new Float32Array(n), staticRidge = new Float32Array(n);
  for (let x = 10; x <= 54; x++) {
    const idx = 36 * size + x;
    staticConfidence[idx] = 0.72;
    staticRidge[idx] = 0.90;
  }
  initializeStaticEvidence(q0, { q: qTex, confidence: staticConfidence, ridge: staticRidge }, skin, state);
  const fused = fuseEvidence(q0, qTex, flow, coh, amp, skin, state, {
    regionWeight,
    deformationSupport: deformation,
    repeatability: 0.86,
    temporalPersistence: 0.82,
    expressionAmplitudeQuality: 0.90,
    effectiveSampleCount: 8,
    ridge,
    returnConsistency: 0.82,
  });
  const ridgeConfidence = fused.conf[36 * size + 32];
  ok(ridgeConfidence > 0.5, `两轮 8 帧的重复纹理形成可提交置信度（got ${ridgeConfidence.toFixed(3)}）`);
  const seed = [{ name: "multiframe-evidence", pts: Array.from({ length: 45 }, (_, i) => [10 + i, 24]) }];
  const curves = optimizePriorCurves(fused.q, fused.conf, state.ridgeField, q0, seed, skin, forbidden, size);
  const centralMove = Math.hypot(
    curves[0].pts[22][0] - curves[0].priorPts[22][0],
    curves[0].pts[22][1] - curves[0].priorPts[22][1],
  );
  ok(centralMove > 5, `重复皮纹证据能产生肉眼可见的曲线修正（got ${centralMove.toFixed(2)}px）`);

  const dynamicOnly = createSessionState(size);
  const rejectedDynamicOnly = fuseEvidence(q0, qTex, flow, coh, amp, skin, dynamicOnly, {
    regionWeight,
    deformationSupport: deformation,
    repeatability: 0.95,
    temporalPersistence: 0.95,
    expressionAmplitudeQuality: 1,
    effectiveSampleCount: 8,
    ridge,
    returnConsistency: 0.95,
  });
  ok(rejectedDynamicOnly.conf[36 * size + 32] < REFINE_CONF,
    "动态表情即使很强，也不能在没有稳定中性候选时单独提交新方向");
}

// ── blockMatchFlow：平坦图不应给出虚假大位移+高置信 ─────────────────────────
{
  const w = 48, h = 48;
  const flat = new Float32Array(w * h);
  flat.fill(128);
  const skin = new Uint8Array(w * h);
  skin.fill(1);
  const flow = blockMatchFlow(flat, flat, w, h, skin, 8, 2);
  let maxMag = 0, maxConf = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!skin[i]) continue;
    maxMag = Math.max(maxMag, Math.hypot(flow.u[i], flow.v[i]));
    maxConf = Math.max(maxConf, flow.conf[i]);
    n++;
  }
  ok(n > 0, "平坦图块匹配有采样");
  ok(maxMag < 0.5, `平坦图位移应≈0（got maxMag=${maxMag}）`);
  ok(maxConf < 0.35, `平坦图置信应低（got maxConf=${maxConf.toFixed(3)}）`);
}

// ── blockMatchFlow：平移图应检出位移且置信高于平坦 ─────────────────────────
{
  const w = 64, h = 64;
  const ref = new Float32Array(w * h);
  const cur = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 棋盘纹理
      ref[y * w + x] = ((x >> 2) ^ (y >> 2)) & 1 ? 200 : 40;
    }
  }
  const shift = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, x + shift);
      cur[y * w + x] = ref[y * w + sx];
    }
  }
  const skin = new Uint8Array(w * h);
  for (let y = 16; y < h - 16; y++) {
    for (let x = 16; x < w - 16; x++) skin[y * w + x] = 1;
  }
  const flow = blockMatchFlow(ref, cur, w, h, skin, 8, 3);
  let sumU = 0, sumC = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!skin[i]) continue;
    sumU += flow.u[i]; sumC += flow.conf[i]; n++;
  }
  const meanU = sumU / n, meanC = sumC / n;
  ok(Math.abs(meanU) > 0.8 && Math.abs(meanU) < 3.2, `平移图 |mean u|≈2（got ${meanU.toFixed(2)}）`);
  ok(meanC > 0.25, `平移图置信应明显高于平坦（got ${meanC.toFixed(3)}）`);
}

// ── estimatePoseQuality ─────────────────────────────────────────────────────
{
  const lm = Array.from({ length: 468 }, () => [0, 0, 0]);
  // 正脸：左眼 33、右眼 263、鼻尖 1
  lm[33] = [100, 120, 0];
  lm[263] = [220, 120, 0];
  lm[1] = [160, 150, 0];
  ok(estimatePoseQuality(lm).ok === true, "正脸姿态 ok");
  lm[263] = [220, 180, 0]; // 大 roll
  ok(estimatePoseQuality(lm).ok === false, "大 roll 应拒绝");
  lm[263] = [220, 120, 0];
  lm[1] = [210, 150, 0]; // 鼻尖偏一侧
  ok(estimatePoseQuality(lm).ok === false, "大 yaw 代理应拒绝");
}

// ── buildMasksFromMesh ──────────────────────────────────────────────────────
{
  const mesh = Array.from({ length: 468 }, (_, i) => {
    const t = i / 467;
    return [80 + 160 * (t % 1), 60 + 200 * t];
  });
  // 放置眼/唇/鼻关键点到合理位置
  for (const i of [33, 133, 160, 159]) mesh[i] = [110, 130];
  for (const i of [362, 263, 387, 386]) mesh[i] = [210, 130];
  for (const i of [61, 291, 0, 17]) mesh[i] = [160, 210];
  for (const i of [1, 2, 4, 5]) mesh[i] = [160, 160];
  for (const i of [10, 152, 234, 454]) mesh[i] = [160 + (i % 3) * 40, 100 + (i % 5) * 30];
  // oval 扩一圈
  const oval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  oval.forEach((idx, k) => {
    const a = (k / oval.length) * Math.PI * 2;
    mesh[idx] = [160 + Math.cos(a) * 120, 160 + Math.sin(a) * 140];
  });
  const m = buildMasksFromMesh(mesh, 320);
  let nSkin = 0, nForb = 0;
  for (let i = 0; i < m.skin.length; i++) {
    if (m.skin[i]) nSkin++;
    if (m.forbidden[i]) nForb++;
  }
  ok(nSkin > 1000, `网格掩膜有皮肤区（${nSkin}）`);
  ok(nForb > 100, `网格掩膜有禁区（${nForb}）`);
  // 左眼附近应禁
  const le = Math.round(130) * 320 + Math.round(110);
  ok(m.forbidden[le] === 1 || m.skin[le] === 0, "左眼附近禁区生效");
}

// ── 融合：合理观测 → 非零但受限偏转；垂直观测 → 强降权 ─────────────────────
function runFuse(qTexAngleDeg, expectNonZero) {
  const size = 32;
  const { skin } = buildMasks(size);
  const state = createSessionState(size);
  const n = size * size;
  state.moment = new Float32Array(n * 2);
  state.weight = new Float32Array(n);
  const q0 = new Float32Array(n * 2);
  const qTex = new Float32Array(n * 2);
  const texCoh = new Float32Array(n);
  const texAmp = new Float32Array(n);
  const flowConf = new Float32Array(n);
  const flowU = new Float32Array(n);
  const flowV = new Float32Array(n);
  const qH = angleToQ(0);
  const qT = angleToQ(qTexAngleDeg * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    if (!skin[i]) continue;
    q0[i * 2] = qH[0]; q0[i * 2 + 1] = qH[1];
    qTex[i * 2] = qT[0]; qTex[i * 2 + 1] = qT[1];
    texCoh[i] = 0.95;
    texAmp[i] = 12;
    flowConf[i] = 0.85;
    flowU[i] = 2; flowV[i] = 0;
  }
  const qStatic = new Float32Array(n * 2);
  const staticConfidence = new Float32Array(n), staticRidge = new Float32Array(n);
  const qCandidate = angleToQ(12 * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    if (!skin[i]) continue;
    qStatic[i * 2] = qCandidate[0]; qStatic[i * 2 + 1] = qCandidate[1];
    staticConfidence[i] = 0.62;
    staticRidge[i] = 0.75;
  }
  initializeStaticEvidence(q0, { q: qStatic, confidence: staticConfidence, ridge: staticRidge }, skin, state);
  const fused = fuseEvidence(q0, qTex, { u: flowU, v: flowV, conf: flowConf }, texCoh, texAmp, skin, state, {
    repeatability: 0.84,
    temporalPersistence: 0.82,
    expressionAmplitudeQuality: 0.9,
    effectiveSampleCount: 8,
    returnConsistency: 0.8,
  });
  let maxDef = 0;
  for (let i = 0; i < n; i++) {
    if (!skin[i]) continue;
    maxDef = Math.max(maxDef, axialDiffDeg(
      [fused.q[i * 2], fused.q[i * 2 + 1]],
      [q0[i * 2], q0[i * 2 + 1]],
    ));
  }
  return maxDef;
}

const def12 = runFuse(12, true);
ok(def12 > 1.0 && def12 <= 18, `静态候选被同向动态证据验证后产生受限偏转（got ${def12.toFixed(2)}°）`);
const def90 = runFuse(90, false);
ok(def90 <= 10, `冲突动态方向不能覆盖中性候选与解剖先验（got ${def90.toFixed(2)}°）`);

// ── 坐标漂移回归：warp/重心坐标在相机平移+缩放+旋转下重投影稳定 ─────────────
// 构造网格 + 三角剖分（模拟脸网格拓扑）
{
  const G = 12;
  const mesh = [];
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      mesh.push([40 + gx * 20, 40 + gy * 20]); // 参考“图像”关键点
    }
  }
  const tris = [];
  for (let gy = 0; gy < G - 1; gy++) {
    for (let gx = 0; gx < G - 1; gx++) {
      const a = gy * G + gx, b = a + 1, c = a + G, d = c + 1;
      tris.push([a, b, c]); tris.push([b, d, c]);
    }
  }

  // 参考帧曲线上的一点（网格内部）
  const truthRef = [155, 173];
  const bary = pointToBary(truthRef, mesh, tris);
  ok(bary != null, "重心坐标可求得");

  // 往返：refMesh 上还原 ≈ 原点
  const back = baryToPoint(bary, mesh, tris);
  const rt = Math.hypot(back[0] - truthRef[0], back[1] - truthRef[1]);
  ok(rt < 1e-3, `重心坐标往返误差≈0（got ${rt.toExponential(2)}）`);

  // 已知相机运动：平移 (dx,dy) + 缩放 s + 旋转 θ
  const dx = 63, dy = -41, s = 1.35, th = 12 * Math.PI / 180;
  const cs = Math.cos(th), sn = Math.sin(th);
  const T = (p) => [
    s * (cs * p[0] - sn * p[1]) + dx,
    s * (sn * p[0] + cs * p[1]) + dy,
  ];
  const liveMesh = mesh.map(T);        // 相机移动后的关键点
  const truthLive = T(truthRef);        // 该材料点应到达的位置

  // 叠加逻辑：同一 bary 映射到实时关键点
  const drawn = baryToPoint(bary, liveMesh, tris);
  const drift = Math.hypot(drawn[0] - truthLive[0], drawn[1] - truthLive[1]);
  ok(drift < 1.0, `相机平移+缩放+旋转后重投影漂移 <1px（got ${drift.toFixed(3)}）`);

  // 纯平移（旧 bug 场景）：漂移必须≈0，而非以前的整体偏移
  const liveT = mesh.map((p) => [p[0] + 80, p[1] + 55]);
  const drawnT = baryToPoint(bary, liveT, tris);
  const driftT = Math.hypot(drawnT[0] - (truthRef[0] + 80), drawnT[1] - (truthRef[1] + 55));
  ok(driftT < 1e-3, `纯平移重投影漂移≈0（got ${driftT.toExponential(2)}）`);
}

// ── 契约：初始 N 条 → 最终 N 条；零证据/遮挡严格保留 prior ────────────────
{
  const size = 48;
  const n = size * size;
  const skin = new Uint8Array(n);
  const forbidden = new Uint8Array(n);
  // 中间为皮肤，右侧一竖条为禁区（遮挡）
  for (let y = 8; y < size - 8; y++) {
    for (let x = 8; x < size - 8; x++) {
      skin[y * size + x] = 1;
      if (x >= size - 16) forbidden[y * size + x] = 1;
    }
  }
  const q0 = new Float32Array(n * 2);
  const qh = angleToQ(0);            // 先验：水平
  for (let i = 0; i < n; i++) { q0[i * 2] = qh[0]; q0[i * 2 + 1] = qh[1]; }

  // 多条横穿种子线（从皮肤穿到禁区），验证 132→132 逐条对应
  const seeds = [];
  for (let k = 0; k < 5; k++) {
    const pts = [];
    for (let x = 10; x < size - 10; x++) pts.push([x, 16 + k * 3]);
    seeds.push({ name: `L${k}`, pts });
  }

  // 数量/命名一致（先验场，零证据）
  const fieldC0 = new Float32Array(n);
  const c0 = optimizePriorCurves(q0.slice(), fieldC0, null, q0, seeds, skin, forbidden, size);
  ok(c0.length === seeds.length, `最终曲线数量等于初始（${c0.length}/${seeds.length}）`);
  ok(c0.every((c, i) => c.name === seeds[i].name), "曲线命名/顺序严格对应");
  ok(c0.every((c) => c.pts.length >= 2 && c.pts.every((p) => Number.isFinite(p[0]))), "每条曲线连续无断点");

  // 零证据 → final 与 prior 逐点完全一致
  let maxDrift0 = 0;
  for (const c of c0) {
    for (let i = 0; i < c.pts.length; i++) {
      maxDrift0 = Math.max(maxDrift0, Math.hypot(c.pts[i][0] - c.priorPts[i][0], c.pts[i][1] - c.priorPts[i][1]));
    }
  }
  ok(maxDrift0 < 1e-9, `零证据时 final==prior（max drift=${maxDrift0.toExponential(2)}）`);
  ok(!c0.some((c) => (c.kinds || []).includes("refined")), "零置信度不产生 refined");
  ok(c0.some((c) => (c.kinds || []).includes("occluded")), "穿入禁区的点标为 occluded");

  // 高置信 + 位于原曲线法向附近的皮纹脊 → 只沿法向软约束移动，禁区点仍保 prior
  const fieldC1 = new Float32Array(n);
  const fieldQ1 = new Float32Array(n * 2);
  const ridge = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    fieldQ1[i * 2] = qh[0]; fieldQ1[i * 2 + 1] = qh[1];
    if (skin[i] && !forbidden[i]) fieldC1[i] = 0.7;
  }
  for (let k = 0; k < 5; k++) {
    const y = 17 + k * 3;
    for (let x = 10; x < size - 10; x++) ridge[y * size + x] = 1;
  }
  const c1 = optimizePriorCurves(fieldQ1, fieldC1, ridge, q0, seeds, skin, forbidden, size);
  ok(c1.length === seeds.length, "法向优化后仍 N→N");

  let maxMove = 0, movedPts = 0, occKeepOk = true;
  for (const c of c1) {
    for (let i = 0; i < c.pts.length; i++) {
      const mv = Math.hypot(c.pts[i][0] - c.priorPts[i][0], c.pts[i][1] - c.priorPts[i][1]);
      maxMove = Math.max(maxMove, mv);
      if (mv > 0.05) movedPts++;
      // 遮挡点必须保持 prior
      if (c.kinds[i] === "occluded" && mv > 1e-9) occKeepOk = false;
    }
  }
  ok(movedPts > 0, "高置信皮纹脊使原曲线沿法向移动");
  ok(Number.isFinite(maxMove), `法向优化位移数值有效（got ${maxMove.toFixed(2)}）`);
  ok(occKeepOk, "遮挡点严格保留 prior 位置");
  const refined1 = c1.reduce((a, c) => a + (c.kinds || []).filter((k) => k === "refined").length, 0);
  ok(refined1 > 0, "皮肤高置信标记 refined（元数据）");
}

// ── v0.4 中性模板：先搜邻域再门控，并允许证据驱动方向/左右不对称 ─────────
{
  const size = 96, n = size * size;
  const skin = new Uint8Array(n), forbidden = new Uint8Array(n);
  for (let y = 4; y < size - 4; y++) for (let x = 4; x < size - 4; x++) skin[y * size + x] = 1;
  const horizontal = angleToQ(0), tilted = angleToQ(12 * Math.PI / 180);
  const q0 = new Float32Array(n * 2), fieldQ = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    q0[i * 2] = horizontal[0]; q0[i * 2 + 1] = horizontal[1];
    fieldQ[i * 2] = horizontal[0]; fieldQ[i * 2 + 1] = horizontal[1];
  }

  // 原曲线 y=48 没有置信度；个人纹理证据只在相邻 y=47。
  const neighbourC = new Float32Array(n), neighbourRidge = new Float32Array(n);
  for (let x = 16; x <= 80; x++) {
    neighbourC[47 * size + x] = 0.78;
    neighbourRidge[47 * size + x] = 1;
  }
  const singleSeed = [{ name: "nearby-evidence", pts: Array.from({ length: 65 }, (_, i) => [16 + i, 48]) }];
  const nearby = optimizePriorCurves(fieldQ, neighbourC, neighbourRidge, q0, singleSeed, skin, forbidden, size);
  const nearbyMax = Math.max(...nearby[0].pts.map((p, i) => Math.hypot(p[0] - nearby[0].priorPts[i][0], p[1] - nearby[0].priorPts[i][1])));
  ok(nearbyMax > 0.35, `原点低置信但邻域有验证皮纹时仍产生可见法向修正（got ${nearbyMax.toFixed(2)}px）`);
  ok(nearby[0].audit.some((item) => item.reason === "three_source_validated_neutral_evidence"), "逐点审计记录三源融合证据来源");

  // 同位置的重复方向证据可改变局部切线；平滑性由软正则而非角度硬帽保持。
  const directionC = new Float32Array(n), directionRidge = new Float32Array(n);
  for (let x = 16; x <= 80; x++) {
    const idx = 48 * size + x;
    directionC[idx] = 0.86;
    directionRidge[idx] = 0.65;
    fieldQ[idx * 2] = tilted[0]; fieldQ[idx * 2 + 1] = tilted[1];
  }
  const directed = optimizePriorCurves(fieldQ, directionC, directionRidge, q0, singleSeed, skin, forbidden, size);
  ok(directed[0].maxDirectionChangeDeg > 2, `稳定方向证据可有限改变曲线切线（got ${directed[0].maxDirectionChangeDeg.toFixed(2)}°）`);
  ok(Number.isFinite(directed[0].maxDirectionChangeDeg) && Number.isFinite(directed[0].maxCurvatureChangeDeg), "方向与曲率软约束结果数值稳定");

  // 左右区域互不联动：只有左侧有证据时，右侧严格回退先验。
  const asymmetricSeeds = [
    { name: "left", pts: Array.from({ length: 25 }, (_, i) => [12 + i, 62]) },
    { name: "right", pts: Array.from({ length: 25 }, (_, i) => [60 + i, 62]) },
  ];
  const asymmetricC = new Float32Array(n), asymmetricRidge = new Float32Array(n);
  for (let x = 12; x <= 36; x++) {
    asymmetricC[61 * size + x] = 0.8;
    asymmetricRidge[61 * size + x] = 1;
  }
  const asymmetric = optimizePriorCurves(q0, asymmetricC, asymmetricRidge, q0, asymmetricSeeds, skin, forbidden, size);
  ok(asymmetric[0].refinedFrac > 0, "有证据的左侧曲线允许个性化");
  ok(asymmetric[1].refinedFrac === 0 && asymmetric[1].pts.every((p, i) => near(p[0], asymmetric[1].priorPts[i][0], 1e-9) && near(p[1], asymmetric[1].priorPts[i][1], 1e-9)), "无证据的右侧严格保持标准先验");
}

// ── 尺度自适应软正则：充分证据可以越过旧 9px 帽，弱证据仍更接近先验 ──────
{
  const size = 160, n = size * size;
  const skin = new Uint8Array(n), forbidden = new Uint8Array(n);
  for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) skin[y * size + x] = 1;
  const horizontal = angleToQ(0);
  const q0 = new Float32Array(n * 2), fieldQ = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    q0[i * 2] = horizontal[0]; q0[i * 2 + 1] = horizontal[1];
    fieldQ[i * 2] = horizontal[0]; fieldQ[i * 2 + 1] = horizontal[1];
  }
  const seed = [{ name: "large-personal-offset", pts: Array.from({ length: 121 }, (_, i) => [20 + i, 70]) }];
  const strongC = new Float32Array(n), weakC = new Float32Array(n);
  const strongRidge = new Float32Array(n), weakRidge = new Float32Array(n);
  for (let x = 20; x <= 140; x++) {
    const idx = 86 * size + x;
    strongC[idx] = 0.98; strongRidge[idx] = 1;
    weakC[idx] = 0.30; weakRidge[idx] = 1;
  }
  const strong = optimizePriorCurves(fieldQ, strongC, strongRidge, q0, seed, skin, forbidden, size);
  const weak = optimizePriorCurves(fieldQ, weakC, weakRidge, q0, seed, skin, forbidden, size);
  const centralOffsets = (curve) => curve.pts.slice(20, -20).map((p, i) => {
    const prior = curve.priorPts[i + 20];
    return Math.hypot(p[0] - prior[0], p[1] - prior[1]);
  });
  const strongMean = centralOffsets(strong[0]).reduce((a, b) => a + b, 0) / centralOffsets(strong[0]).length;
  const weakMean = centralOffsets(weak[0]).reduce((a, b) => a + b, 0) / centralOffsets(weak[0]).length;
  ok(strongMean > 9, `充分且重复稳定的远端证据可越过旧 9px 帽（got ${strongMean.toFixed(2)}px）`);
  ok(weakMean < strongMean, `相同位置的弱证据受到更强软先验牵引（${weakMean.toFixed(2)}px < ${strongMean.toFixed(2)}px）`);
  ok(strong[0].pts.every((p) => skin[Math.round(p[1]) * size + Math.round(p[0])]), "超过旧位移帽后仍满足皮肤域硬约束");
  ok(strong[0].audit.some((item) => (item.regularization_scale_px || 0) > 0), "审计记录局部尺度自适应正则参数");
}

// ── 采集状态机回退契约：峰值保持后直接提交，同时保留两轮一致性验证 ──────────
{
const source = readFileSync(new URL("../web/compat/personalized/personalized.js", import.meta.url), "utf8");
  ok(!source.includes("enterReturnPhase("), "采集流程不再进入回到自然表情状态机");
  ok((source.match(/commitCycle\(action\);/g) || []).length >= 3, "自动与手动动作完成均直接提交本轮");
  ok(source.includes("const CYCLES_REQUIRED = 1"), "每个表情默认只采集一轮");
  ok(source.includes('mode: "single_capture_quality_gate"'), "单轮采集使用质量门控而非重复轮次验证");
}

// #110 review（RongNianXin）：动作专用门控的 minPeakFrames 曾写 3，而 aggregateCycleEvidence()
// 用 pickBestFrames(..., 4) 硬性选 4 帧且不足即抛错，门控值低于 4 永不生效。锁住这个一致性，
// 避免两处再次分叉。
{
  const runtimeSrc = readFileSync(new URL("../web/compat/personalized/personalized.js", import.meta.url), "utf8");
  const selected = runtimeSrc.match(/pickBestFrames\(\s*sess\.neutralGrayHi,\s*frames,\s*selectionMask,\s*(\d+)/);
  ok(Boolean(selected), "aggregateCycleEvidence 必须经 pickBestFrames 选帧");
  const aggregationFrames = Number(selected?.[1] ?? 0);
  ok(
    new RegExp(`if \\(best\\.length < ${aggregationFrames}\\) throw`).test(runtimeSrc),
    `聚合阶段必须拒绝少于自身选帧数（${aggregationFrames}）的轮次`,
  );
  const gateValues = [...runtimeSrc.matchAll(/minPeakFrames:\s*(\d+)/g)].map((m) => Number(m[1]));
  ok(gateValues.length > 0, "应能找到门控的 minPeakFrames 配置");
  ok(
    gateValues.every((v) => v === aggregationFrames),
    `每个 minPeakFrames 必须等于聚合选帧数 ${aggregationFrames}（实际 ${gateValues.join("/")}），否则是永不生效的死配置`,
  );
  ok(true, `门控 minPeakFrames 与聚合选帧数一致（${aggregationFrames}）`);
}

console.log(fail === 0 ? "\n✅ prstl_pipeline 测试通过" : `\n❌ ${fail} 项失败`);
process.exit(fail ? 1 : 0);
