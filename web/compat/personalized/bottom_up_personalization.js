/**
 * Browser-ready bottom-up RSTL personalization.
 *
 * Stable neutral skin grooves are detected with an absolute, multi-scale
 * Hessian line filter. Repeated expression frames may validate and amplify a
 * neutral candidate but never create a new final direction. The validated
 * field then attracts the original atlas curves along their local normals;
 * one-dimensional smoothing couples neighbouring points on each full curve.
 */

export const BOTTOM_UP_PERSONALIZATION_VERSION =
  "bottom-up-hessian-rstl-warp-1.0.0";
export const BOTTOM_UP_PARAMETER_VERSION =
  "hessian-roi-absolute-v1-neutral-template-dynamic-validation";

const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const axialQ = (angle) => [Math.cos(2 * angle), Math.sin(2 * angle)];

function normalize2(x, y) {
  const length = Math.hypot(x, y);
  return length > 1e-8 ? [x / length, y / length] : [0, 0];
}

function axialAgreement(a0, a1, b0, b1) {
  return clamp(0.5 + 0.5 * (a0 * b0 + a1 * b1));
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const position = clamp(fraction) * (values.length - 1);
  const lo = Math.floor(position), hi = Math.ceil(position), t = position - lo;
  return values[lo] * (1 - t) + values[hi] * t;
}

function madSigma(values) {
  if (!values.length) return 0;
  const median = percentile([...values], 0.5);
  return 1.4826 * percentile(values.map((value) => Math.abs(value - median)), 0.5);
}

function normalizedGray(gray, mask) {
  const values = [];
  for (let index = 0; index < gray.length; index++) {
    if (!mask || mask[index]) values.push(gray[index]);
  }
  const factor = percentile(values, 0.99) <= 1.5 ? 255 : 1;
  if (factor === 1) return { gray, factor };
  const output = new Float32Array(gray.length);
  for (let index = 0; index < gray.length; index++) output[index] = gray[index] * factor;
  return { gray: output, factor };
}

function maskedMean(gray, mask) {
  if (!gray?.length) return 0;
  let sum = 0, count = 0;
  for (let index = 0; index < gray.length; index++) {
    if (mask && !mask[index]) continue;
    sum += gray[index];
    count++;
  }
  return count ? sum / count : 0;
}

function boxBlur(source, width, height, radius) {
  if (radius <= 0) return new Float32Array(source);
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += source[y * width + clamp(x, 0, width - 1)];
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = sum / (2 * radius + 1);
      sum += source[y * width + clamp(x + radius + 1, 0, width - 1)] -
        source[y * width + clamp(x - radius, 0, width - 1)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += horizontal[clamp(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / (2 * radius + 1);
      sum += horizontal[clamp(y + radius + 1, 0, height - 1) * width + x] -
        horizontal[clamp(y - radius, 0, height - 1) * width + x];
    }
  }
  return output;
}

function sample(field, x, y, width, height) {
  const x0 = clamp(Math.floor(x), 0, width - 1), y0 = clamp(Math.floor(y), 0, height - 1);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = clamp(x - x0), ty = clamp(y - y0);
  const a = field[y0 * width + x0], b = field[y0 * width + x1];
  const c = field[y1 * width + x0], d = field[y1 * width + x1];
  return (1 - ty) * ((1 - tx) * a + tx * b) + ty * ((1 - tx) * c + tx * d);
}

function localDirectionSupport(response, q, index, width, height, radius) {
  const x = index % width, y = Math.floor(index / width);
  const angle = 0.5 * Math.atan2(q[index * 2 + 1] || 0, q[index * 2] || 0);
  const tx = Math.cos(angle), ty = Math.sin(angle);
  let support = 0, samples = 0;
  for (const sign of [-1, 1]) for (let distance = 2; distance <= radius; distance += 2) {
    const px = x + sign * tx * distance, py = y + sign * ty * distance;
    if (px < 1 || py < 1 || px >= width - 1 || py >= height - 1) continue;
    const value = sample(response, px, py, width, height);
    const nearest = Math.round(py) * width + Math.round(px);
    const agreement = axialAgreement(
      q[index * 2] || 0, q[index * 2 + 1] || 0,
      q[nearest * 2] || 0, q[nearest * 2 + 1] || 0,
    );
    support += value * agreement * agreement; samples++;
  }
  return samples ? support / samples : 0;
}

/** Extract dark, two-sided skin grooves and their tangent directions. */
export function extractHessianTextureField(grayInput, width, height, mask, options = {}) {
  const n = width * height;
  const q = new Float32Array(n * 2), response = new Float32Array(n);
  const curvature = new Float32Array(n), scaleMap = new Float32Array(n);
  if (!grayInput || grayInput.length !== n || !mask || mask.length !== n) {
    return { q, confidence: response, ridge: response.slice(), response, curvature, scaleMap,
      diagnostics: { valid: false, reason: "shape_mismatch" } };
  }
  const normalized = normalizedGray(grayInput, mask), gray = normalized.gray;
  const radii = options.radii || [1, 2, 3];
  const minimumCurvature = options.minimumCurvature ?? 0.22;
  const minimumGrooveDepth = options.minimumGrooveDepth ?? 0.65;
  const minimumSideBalance = options.minimumSideBalance ?? 0.24;
  const scaleDiagnostics = [];

  for (const radius of radii) {
    const smooth = boxBlur(gray, width, height, radius);
    const raw = new Float32Array(n), rawQ = new Float32Array(n * 2);
    const candidates = [], curvatureNoise = [];
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      if (!mask[index]) continue;
      const dxx = smooth[index + 1] - 2 * smooth[index] + smooth[index - 1];
      const dyy = smooth[index + width] - 2 * smooth[index] + smooth[index - width];
      const dxy = 0.25 * (smooth[index + width + 1] - smooth[index + width - 1] -
        smooth[index - width + 1] + smooth[index - width - 1]);
      const mean = 0.5 * (dxx + dyy), delta = Math.hypot(0.5 * (dxx - dyy), dxy);
      const lambdaA = mean - delta, lambdaB = mean + delta;
      const large = Math.abs(lambdaA) >= Math.abs(lambdaB) ? lambdaA : lambdaB;
      const small = Math.abs(lambdaA) >= Math.abs(lambdaB) ? lambdaB : lambdaA;
      if (!(large > 0)) continue; // dark valley in direct grayscale
      const anisotropy = clamp(1 - Math.abs(small) / Math.max(1e-6, Math.abs(large)));
      const lineCurvature = large * anisotropy;
      // Estimate the noise floor from the complete valid ROI. Estimating it
      // from accepted candidates makes a long uniform wrinkle become its own
      // "background" and removes the entire line.
      curvatureNoise.push(Math.max(0, lineCurvature));
      if (!(lineCurvature > 0)) continue;
      let nx, ny;
      if (Math.abs(dxy) > 1e-8) [nx, ny] = normalize2(dxy, large - dxx);
      else [nx, ny] = Math.abs(dxx - large) < Math.abs(dyy - large) ? [1, 0] : [0, 1];
      const center = gray[index], distance = Math.max(1.25, radius + 0.5);
      const sideA = sample(gray, x + nx * distance, y + ny * distance, width, height);
      const sideB = sample(gray, x - nx * distance, y - ny * distance, width, height);
      const riseA = sideA - center, riseB = sideB - center;
      const depth = Math.min(riseA, riseB);
      const balance = depth > 0 ? depth / Math.max(1e-6, Math.max(riseA, riseB)) : 0;
      if (depth < minimumGrooveDepth || balance < minimumSideBalance) continue;
      const tangent = [-ny, nx], axial = axialQ(Math.atan2(tangent[1], tangent[0]));
      raw[index] = lineCurvature * Math.sqrt(clamp(depth / 8)) * anisotropy;
      rawQ[index * 2] = axial[0]; rawQ[index * 2 + 1] = axial[1];
      candidates.push(raw[index]);
    }
    const median = percentile([...curvatureNoise], 0.5), sigma = madSigma(curvatureNoise);
    const threshold = Math.max(minimumCurvature, median + (options.madMultiplier ?? 2.8) * sigma);
    const strong = Math.max(threshold + 1e-6, percentile([...candidates], 0.95));
    scaleDiagnostics.push({
      radius, threshold, median, mad_sigma: sigma,
      candidates: candidates.length, noise_samples: curvatureNoise.length,
    });
    for (let index = 0; index < n; index++) {
      if (raw[index] < threshold) continue;
      const value = clamp((raw[index] - threshold) / Math.max(1e-6, strong - threshold));
      if (value <= response[index]) continue;
      response[index] = value;
      curvature[index] = raw[index];
      scaleMap[index] = radius;
      q[index * 2] = rawQ[index * 2]; q[index * 2 + 1] = rawQ[index * 2 + 1];
    }
  }

  const confidence = new Float32Array(n), ridge = new Float32Array(n);
  let accepted = 0;
  const continuityRadius = options.continuityRadius ?? 6;
  for (let index = 0; index < n; index++) {
    if (!(response[index] > 0)) continue;
    const continuity = localDirectionSupport(response, q, index, width, height, continuityRadius);
    if (continuity < (options.minimumContinuity ?? 0.13)) continue;
    confidence[index] = clamp(response[index] * (0.35 + 0.65 * continuity));
    ridge[index] = clamp(response[index] * Math.sqrt(continuity));
    accepted++;
  }
  return {
    q, confidence, ridge, response, curvature, scaleMap,
    diagnostics: {
      valid: accepted > 0,
      input_range_factor: normalized.factor,
      accepted_pixels: accepted,
      scales: scaleDiagnostics,
      detector: "absolute-multiscale-hessian-dark-groove",
    },
  };
}

function localBestField(field, index, width, height, radius, referenceQ) {
  const x = index % width, y = Math.floor(index / width);
  let best = null, bestScore = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (dx * dx + dy * dy > radius * radius) continue;
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
    const next = yy * width + xx, confidence = field.confidence[next] || 0;
    if (!(confidence > 0)) continue;
    const agreement = axialAgreement(
      referenceQ[0], referenceQ[1], field.q[next * 2] || 0, field.q[next * 2 + 1] || 0,
    );
    const spatial = Math.exp(-0.5 * (dx * dx + dy * dy) / Math.max(1, radius * radius * 0.35));
    const score = confidence * agreement * agreement * spatial;
    if (score > bestScore) best = { index: next, confidence, agreement, score }, bestScore = score;
  }
  return best;
}

/** Build the stable neutral patient texture template from repeated frames. */
export function buildStaticHessianTextureTemplate(
  neutralMedian, neutralFrames, width, height, skin, options = {},
) {
  const reference = extractHessianTextureField(neutralMedian, width, height, skin, options);
  const maxFrames = options.maxValidationFrames ?? 6;
  const stride = Math.max(1, Math.floor((neutralFrames?.length || 1) / maxFrames));
  const selected = (neutralFrames || []).filter((_, index) => index % stride === 0).slice(-maxFrames);
  const fields = selected.map((frame) => extractHessianTextureField(frame, width, height, skin, options));
  const referenceMean = maskedMean(normalizedGray(neutralMedian, skin).gray, skin);
  const illuminationStability = selected.length
    ? selected.reduce((sum, frame) => {
      const mean = maskedMean(normalizedGray(frame, skin).gray, skin);
      return sum + Math.exp(-Math.abs(mean - referenceMean) / 24);
    }, 0) / selected.length
    : 0;
  const n = width * height, confidence = new Float32Array(n), ridge = new Float32Array(n);
  const temporalStability = new Float32Array(n), q = reference.q.slice();
  let accepted = 0;
  for (let index = 0; index < n; index++) {
    const base = reference.confidence[index] || 0;
    if (base < (options.minimumReferenceConfidence ?? 0.08)) continue;
    const referenceQ = [q[index * 2] || 0, q[index * 2 + 1] || 0];
    let support = 0, agreementSum = 0, confidenceSum = 0;
    for (const field of fields) {
      const match = localBestField(field, index, width, height, options.matchRadius ?? 2, referenceQ);
      if (!match || match.agreement < (options.minimumDirectionAgreement ?? 0.72)) continue;
      support++; agreementSum += match.agreement; confidenceSum += match.confidence;
    }
    const supportRatio = fields.length ? support / fields.length : 0;
    if (supportRatio < (options.minimumTemporalSupport ?? 0.60)) continue;
    const stability = support ? (agreementSum / support) * Math.min(1, confidenceSum / support) : 0;
    temporalStability[index] = supportRatio * stability;
    confidence[index] = clamp(base * (0.35 + 0.65 * temporalStability[index]));
    ridge[index] = clamp(reference.ridge[index] * (0.40 + 0.60 * supportRatio));
    accepted++;
  }
  return {
    q, confidence, ridge, temporalStability,
    frameCount: fields.length,
    illuminationStability,
    diagnostics: {
      detector: "stable-neutral-multiframe-hessian",
      reference: reference.diagnostics,
      validation_frames: fields.length,
      illumination_stability: illuminationStability,
      accepted_pixels: accepted,
    },
  };
}

/** Expressions validate neutral candidates; they cannot introduce new q. */
export function validateHessianTemplateWithAction(
  staticTemplate, expressionFrames, width, height, actionMask, options = {},
) {
  const n = width * height, validation = new Float32Array(n), amplification = new Float32Array(n);
  const fields = (expressionFrames || []).slice(0, options.maxFrames ?? 4)
    .map((frame) => extractHessianTextureField(frame, width, height, actionMask, options));
  for (let index = 0; index < n; index++) {
    const staticConfidence = staticTemplate?.confidence?.[index] || 0;
    if (staticConfidence < (options.minimumStaticConfidence ?? 0.06) || !(actionMask[index] > 0)) continue;
    const referenceQ = [staticTemplate.q[index * 2] || 0, staticTemplate.q[index * 2 + 1] || 0];
    let support = 0, sum = 0, amp = 0;
    for (const field of fields) {
      const match = localBestField(field, index, width, height, options.matchRadius ?? 3, referenceQ);
      if (!match || match.agreement < (options.minimumDirectionAgreement ?? 0.70)) continue;
      support++;
      sum += match.confidence * match.agreement;
      amp += Math.max(0, (field.ridge[match.index] || 0) - (staticTemplate.ridge[index] || 0));
    }
    const supportRatio = fields.length ? support / fields.length : 0;
    if (supportRatio < (options.minimumFrameSupport ?? 0.50)) continue;
    validation[index] = clamp(supportRatio * (support ? sum / support : 0));
    amplification[index] = clamp(support ? amp / support : 0);
  }
  return {
    q: staticTemplate.q,
    confidence: validation,
    ridge: amplification,
    validation,
    amplification,
    frameCount: fields.length,
    diagnostics: { detector: "expression-validates-neutral-hessian", frames: fields.length },
  };
}

function pointTangent(points, index) {
  const a = points[Math.max(0, index - 1)], b = points[Math.min(points.length - 1, index + 1)];
  return normalize2((b?.[0] || 0) - (a?.[0] || 0), (b?.[1] || 0) - (a?.[1] || 0));
}

function scalarAt(field, x, y, width, height) {
  return sample(field, x, y, width, height);
}

function qAt(field, x, y, width, height) {
  const ix = clamp(Math.round(x), 0, width - 1), iy = clamp(Math.round(y), 0, height - 1);
  const index = iy * width + ix;
  return [field[index * 2] || 0, field[index * 2 + 1] || 0];
}

function smoothDisplacements(raw, support, passes = 10) {
  let current = new Float32Array(raw);
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(current);
    for (let index = 1; index < current.length - 1; index++) {
      const direct = support[index];
      next[index] = (direct * raw[index] + 1.6 * current[index] +
        1.2 * (current[index - 1] + current[index + 1])) /
        Math.max(1e-6, direct + 4.0);
    }
    if (current.length > 1) {
      next[0] = 0.70 * current[0] + 0.30 * current[1];
      next[current.length - 1] = 0.70 * current[current.length - 1] + 0.30 * current[current.length - 2];
    }
    current = next;
  }
  return current;
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a), o4 = orientation(c, d, b);
  return o1 * o2 < -1e-6 && o3 * o4 < -1e-6;
}

function curveIntersects(curve, accepted) {
  for (const other of accepted) {
    for (let i = 1; i < curve.length; i++) for (let j = 1; j < other.length; j++) {
      if (segmentsIntersect(curve[i - 1], curve[i], other[j - 1], other[j])) return true;
    }
  }
  return false;
}

/** Locally warp the original atlas curves toward validated patient grooves. */
export function warpPriorCurvesWithHessian({
  seeds, textureQ, textureConfidence, textureRidge, dynamicValidation,
  skin, forbidden, size, options = {},
}) {
  const curves = [], acceptedGeometry = [];
  // This is an adaptive search neighbourhood, not a fixed displacement clamp.
  // The distance prior and evidence score decide the applied displacement.
  const searchRadius = options.searchRadius ?? Math.max(10, Math.round(size * 0.075));
  const minimumEvidence = options.minimumEvidence ?? 0.16;
  const minimumDirectionAgreement = options.minimumDirectionAgreement ?? 0.58;
  let acceptedTargets = 0, movedPoints = 0, topologyRollbacks = 0;
  for (const seed of seeds || []) {
    const prior = (seed.pts || []).map((point) => [point[0], point[1]]);
    const raw = new Float32Array(prior.length), support = new Float32Array(prior.length);
    const audit = Array.from({ length: prior.length }, () => ({
      source: "prior", static_hessian: 0, dynamic_validation: 0,
      direction_agreement: 0, normal_displacement_px: 0,
    }));
    for (let pointIndex = 0; pointIndex < prior.length; pointIndex++) {
      const point = prior[pointIndex], tangent = pointTangent(prior, pointIndex);
      const normal = [-tangent[1], tangent[0]];
      const priorQ = axialQ(Math.atan2(tangent[1], tangent[0]));
      let best = null, bestScore = 0;
      for (let normalOffset = -searchRadius; normalOffset <= searchRadius; normalOffset++) {
        for (let tangentOffset = -2; tangentOffset <= 2; tangentOffset++) {
          const x = point[0] + normal[0] * normalOffset + tangent[0] * tangentOffset;
          const y = point[1] + normal[1] * normalOffset + tangent[1] * tangentOffset;
          const ix = Math.round(x), iy = Math.round(y);
          if (ix < 0 || iy < 0 || ix >= size || iy >= size) continue;
          const pixel = iy * size + ix;
          if (!skin[pixel] || forbidden?.[pixel]) continue;
          const staticConfidence = scalarAt(textureConfidence, x, y, size, size);
          const ridge = scalarAt(textureRidge, x, y, size, size);
          const dynamic = dynamicValidation?.length
            ? scalarAt(dynamicValidation, x, y, size, size) : 0;
          const evidence = staticConfidence * (0.45 + 0.55 * dynamic) * (0.55 + 0.45 * ridge);
          if (evidence < minimumEvidence) continue;
          const observedQ = qAt(textureQ, x, y, size, size);
          const agreement = axialAgreement(priorQ[0], priorQ[1], observedQ[0], observedQ[1]);
          if (agreement < minimumDirectionAgreement) continue;
          const distancePrior = Math.exp(-0.5 * (normalOffset / Math.max(1, searchRadius * 0.55)) ** 2);
          const score = evidence * agreement * agreement * distancePrior;
          if (score > bestScore) {
            bestScore = score;
            best = { normalOffset, evidence, dynamic, ridge, agreement };
          }
        }
      }
      if (!best) continue;
      raw[pointIndex] = best.normalOffset;
      support[pointIndex] = bestScore;
      audit[pointIndex] = {
        source: "bottom_up_hessian",
        static_hessian: best.evidence,
        dynamic_validation: best.dynamic,
        ridge: best.ridge,
        direction_agreement: best.agreement,
        normal_displacement_px: best.normalOffset,
      };
      acceptedTargets++;
    }
    const displacement = smoothDisplacements(raw, support, options.smoothingPasses ?? 12);
    let points = prior.map((point, pointIndex) => {
      const tangent = pointTangent(prior, pointIndex), normal = [-tangent[1], tangent[0]];
      const applied = displacement[pointIndex] * clamp(0.30 + 1.7 * support[pointIndex], 0, 1);
      const candidate = [point[0] + normal[0] * applied, point[1] + normal[1] * applied];
      const ix = clamp(Math.round(candidate[0]), 0, size - 1);
      const iy = clamp(Math.round(candidate[1]), 0, size - 1);
      const pixel = iy * size + ix;
      if (!skin[pixel] || forbidden?.[pixel]) return point;
      return candidate;
    });
    if (curveIntersects(points, acceptedGeometry)) {
      points = prior.map((point) => [...point]);
      topologyRollbacks++;
    }
    const kinds = points.map((point, index) => {
      const distance = Math.hypot(point[0] - prior[index][0], point[1] - prior[index][1]);
      if (distance <= 0.12) return "prior";
      movedPoints++;
      return support[index] >= minimumEvidence ? "refined" : "propagated";
    });
    const moved = kinds.filter((kind) => kind !== "prior").length;
    const refined = kinds.filter((kind) => kind === "refined").length;
    curves.push({
      name: seed.name,
      pts: points,
      priorPts: prior,
      kinds,
      audit,
      movedFrac: prior.length ? moved / prior.length : 0,
      refinedFrac: prior.length ? refined / prior.length : 0,
    });
    acceptedGeometry.push(points);
  }
  return {
    curves,
    diagnostics: {
      algorithm_version: BOTTOM_UP_PERSONALIZATION_VERSION,
      parameter_version: BOTTOM_UP_PARAMETER_VERSION,
      detector: "multiscale_hessian",
      optimizer: "normal_attraction_curve_warp",
      accepted_targets: acceptedTargets,
      moved_points: movedPoints,
      moved_lines: curves.filter((curve) => curve.movedFrac > 0).length,
      topology_rollbacks: topologyRollbacks,
      fallback: movedPoints === 0,
      fallback_reason: acceptedTargets === 0
        ? "no_validated_hessian_texture_targets"
        : movedPoints === 0 ? "validated_targets_failed_geometry_or_continuity_commit" : null,
    },
  };
}
