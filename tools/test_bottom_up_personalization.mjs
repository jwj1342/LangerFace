import assert from "node:assert/strict";
import {
  buildStaticHessianTextureTemplate,
  extractHessianTextureField,
  validateHessianTemplateWithAction,
  warpPriorCurvesWithHessian,
} from "../web/src/services/personalized/bottomUpPersonalization.ts";

const WIDTH = 96;
const HEIGHT = 96;
const N = WIDTH * HEIGHT;
const fullMask = new Uint8Array(N).fill(1);
const emptyMask = new Uint8Array(N);

function grooveFrame({ centerX = 54, depth = 24, normalized = false, phase = 0 } = {}) {
  const frame = new Float32Array(N);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const center = centerX + 0.8 * Math.sin(y * 0.075 + phase);
      const groove = depth * Math.exp(-0.5 * ((x - center) / 1.35) ** 2);
      const illumination = 154 + 0.025 * x + 0.018 * y;
      frame[y * WIDTH + x] = (illumination - groove) / (normalized ? 255 : 1);
    }
  }
  return frame;
}

function countPositive(field, threshold = 0) {
  let count = 0;
  for (const value of field) if (value > threshold) count++;
  return count;
}

function meanCurveX(curve) {
  return curve.pts.reduce((sum, point) => sum + point[0], 0) / curve.pts.length;
}

function maxTurn(curve) {
  let maximum = 0;
  for (let index = 1; index < curve.pts.length - 1; index++) {
    const a = curve.pts[index - 1], b = curve.pts[index], c = curve.pts[index + 1];
    const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
    const denominator = Math.max(1e-9, Math.hypot(...u) * Math.hypot(...v));
    maximum = Math.max(maximum, Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / denominator))));
  }
  return maximum;
}

// No absolute line evidence must mean a strict fallback, not a percentile-made line.
const flat = new Float32Array(N).fill(150);
const flatField = extractHessianTextureField(flat, WIDTH, HEIGHT, fullMask);
assert.equal(flatField.diagnostics.accepted_pixels, 0);
assert.equal(countPositive(flatField.confidence), 0);

// The detector must be invariant to the conventional [0, 1] and [0, 255] ranges.
const frame255 = grooveFrame();
const frame01 = grooveFrame({ normalized: true });
const field255 = extractHessianTextureField(frame255, WIDTH, HEIGHT, fullMask);
const field01 = extractHessianTextureField(frame01, WIDTH, HEIGHT, fullMask);
assert.ok(field255.diagnostics.accepted_pixels > 30, "synthetic groove should be detected");
assert.equal(field255.diagnostics.accepted_pixels, field01.diagnostics.accepted_pixels);

// A neutral template is committed only after repeated neutral-frame support.
const neutralFrames = Array.from({ length: 6 }, (_, index) => grooveFrame({ phase: index * 0.04 }));
const staticTemplate = buildStaticHessianTextureTemplate(
  grooveFrame(), neutralFrames, WIDTH, HEIGHT, fullMask,
);
assert.ok(staticTemplate.diagnostics.accepted_pixels > 20, "stable neutral groove should survive temporal gating");
assert.ok(staticTemplate.illuminationStability > 0.9);

// Expressions may validate/amplify an existing patient line but cannot invent one.
const expressionFrames = Array.from({ length: 4 }, (_, index) =>
  grooveFrame({ depth: 34, phase: index * 0.03 }));
const validation = validateHessianTemplateWithAction(
  staticTemplate, expressionFrames, WIDTH, HEIGHT, fullMask,
);
assert.ok(countPositive(validation.validation) > 15, "expression should validate the neutral candidate");
const noStaticValidation = validateHessianTemplateWithAction(
  { q: new Float32Array(N * 2), confidence: new Float32Array(N), ridge: new Float32Array(N) },
  expressionFrames, WIDTH, HEIGHT, fullMask,
);
assert.equal(countPositive(noStaticValidation.validation), 0);

// Normal attraction moves the whole line continuously toward the observed groove.
const seedPoints = Array.from({ length: 31 }, (_, index) => [48, 18 + index * 2]);
const warped = warpPriorCurvesWithHessian({
  seeds: [{ name: "synthetic_vertical", pts: seedPoints }],
  textureQ: staticTemplate.q,
  textureConfidence: staticTemplate.confidence,
  textureRidge: staticTemplate.ridge,
  dynamicValidation: validation.validation,
  skin: fullMask,
  forbidden: emptyMask,
  size: WIDTH,
  options: { searchRadius: 12, minimumEvidence: 0.08 },
});
assert.equal(warped.curves.length, 1);
assert.ok(meanCurveX(warped.curves[0]) > 49.0, "curve should move toward patient groove");
assert.ok(maxTurn(warped.curves[0]) < 0.16, "full-curve coupling must prevent polyline kinks");
assert.ok(warped.diagnostics.moved_points > 15);

// With no patient evidence the original geometry is returned byte-for-byte.
const fallback = warpPriorCurvesWithHessian({
  seeds: [{ name: "fallback", pts: seedPoints }],
  textureQ: new Float32Array(N * 2),
  textureConfidence: new Float32Array(N),
  textureRidge: new Float32Array(N),
  dynamicValidation: new Float32Array(N),
  skin: fullMask,
  forbidden: emptyMask,
  size: WIDTH,
});
assert.deepEqual(fallback.curves[0].pts, seedPoints);
assert.equal(fallback.diagnostics.fallback, true);

console.log("bottom-up personalization tests passed", {
  detected_pixels: field255.diagnostics.accepted_pixels,
  stable_pixels: staticTemplate.diagnostics.accepted_pixels,
  validated_pixels: countPositive(validation.validation),
  mean_curve_x: +meanCurveX(warped.curves[0]).toFixed(3),
});
