/**
 * Browser-ready 2D wrinkle extraction.
 *
 * Contract:
 *   paired neutral/expression grayscale images in one canonical camera frame
 *   -> cleaned wrinkle skeleton + local axial direction field.
 *
 * The implementation deliberately uses only TypedArray arithmetic: affine
 * illumination normalization, multi-scale morphological black-hat response,
 * Hessian/Frangi line filtering, connected-component cleanup, Zhang-Suen
 * thinning and local PCA. It has no DOM, model or server dependency.
 */

export const WRINKLE_EXTRACTOR_VERSION = "paired-roi-mad-probability-fusion-0.7.0";
export const WRINKLE_EXTRACTOR_METHODS = [
  "blackhat-frangi", "oriented-gabor", "edge-pair", "ensemble", "frown-consensus",
  "frown-furrow", "paired-expression-lines",
];

const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const angleToQ = (angle) => [Math.cos(2 * angle), Math.sin(2 * angle)];

function normalizeQ(x, y) {
  const length = Math.hypot(x, y);
  return length > 1e-8 ? [x / length, y / length] : [0, 0];
}

function axialAgreement(ax, ay, bx, by) {
  return clamp(0.5 + 0.5 * (ax * bx + ay * by));
}

function maskedValues(field, mask, minimum = -Infinity) {
  const values = [];
  for (let index = 0; index < field.length; index++) {
    if ((mask?.[index] || 0) > 0.02 && field[index] > minimum) values.push(field[index]);
  }
  return values;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.round(clamp(fraction) * (values.length - 1))];
}

function maskedStats(field, mask) {
  let sum = 0, sum2 = 0, count = 0;
  for (let index = 0; index < field.length; index++) {
    if ((mask?.[index] || 0) <= 0.02) continue;
    const value = field[index];
    sum += value; sum2 += value * value; count++;
  }
  const mean = count ? sum / count : 0;
  return { mean, std: Math.sqrt(Math.max(0, count ? sum2 / count - mean * mean : 0)), count };
}

export function normalizePairedIllumination(neutral, expression, mask) {
  const reference = maskedStats(neutral, mask), current = maskedStats(expression, mask);
  const output = new Float32Array(expression.length);
  const gain = current.std > 1e-6 && reference.std > 1e-6
    ? clamp(reference.std / current.std, 0.65, 1.55) : 1;
  for (let index = 0; index < output.length; index++) {
    output[index] = reference.mean + gain * (expression[index] - current.mean);
  }
  return { gray: output, gain, offset: reference.mean - gain * current.mean };
}

function maskGeometry(mask, width, height) {
  const bounds = roiBounds(mask, width, height, 0);
  if (!bounds) return { bounds: null, extent: Math.min(width, height), area: 0 };
  let area = 0;
  for (let index = 0; index < mask.length; index++) if ((mask[index] || 0) > 0.02) area++;
  return {
    bounds,
    extent: Math.max(bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1),
    area,
  };
}

function analysisGeometry(mask, width, height, options = {}) {
  const geometry = maskGeometry(mask, width, height);
  const extent = options.analysisExtentPx ?? geometry.extent;
  return { ...geometry, extent, scale: clamp(extent / 256, 0.5, 2.0) };
}

function normalizedGrayInputs(neutral, expression, mask) {
  const values = [];
  for (let index = 0; index < neutral.length; index++) {
    if ((mask[index] || 0) <= 0.02) continue;
    values.push(neutral[index], expression[index]);
  }
  const p99 = percentile(values, 0.99);
  const factor = p99 <= 1.5 ? 255 : 1;
  if (factor === 1) return { neutral, expression, factor };
  const scaledNeutral = new Float32Array(neutral.length);
  const scaledExpression = new Float32Array(expression.length);
  for (let index = 0; index < neutral.length; index++) {
    scaledNeutral[index] = neutral[index] * factor;
    scaledExpression[index] = expression[index] * factor;
  }
  return { neutral: scaledNeutral, expression: scaledExpression, factor };
}

function medianAbsoluteDeviation(values) {
  if (!values.length) return 0;
  const median = percentile([...values], 0.5);
  const deviations = values.map((value) => Math.abs(value - median));
  return 1.4826 * percentile(deviations, 0.5);
}

function roiBounds(mask, width, height, padding) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if ((mask[y * width + x] || 0) <= 0.001) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < minX) return null;
  return {
    minX: Math.max(0, minX - padding), maxX: Math.min(width - 1, maxX + padding),
    minY: Math.max(0, minY - padding), maxY: Math.min(height - 1, maxY + padding),
  };
}

function extremeFilter(src, width, height, radius, horizontal, maximum, bounds) {
  const output = new Float32Array(src);
  const x0 = bounds.minX, x1 = bounds.maxX, y0 = bounds.minY, y1 = bounds.maxY;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let value = maximum ? -Infinity : Infinity;
    for (let offset = -radius; offset <= radius; offset++) {
      const xx = horizontal ? clamp(x + offset, 0, width - 1) : x;
      const yy = horizontal ? y : clamp(y + offset, 0, height - 1);
      value = maximum ? Math.max(value, src[yy * width + xx]) : Math.min(value, src[yy * width + xx]);
    }
    output[y * width + x] = value;
  }
  return output;
}

function blackHat(gray, width, height, mask, radius) {
  const bounds = roiBounds(mask, width, height, radius * 2 + 2);
  const output = new Float32Array(width * height);
  if (!bounds) return output;
  const dilatedX = extremeFilter(gray, width, height, radius, true, true, bounds);
  const dilated = extremeFilter(dilatedX, width, height, radius, false, true, bounds);
  const closedX = extremeFilter(dilated, width, height, radius, true, false, bounds);
  const closed = extremeFilter(closedX, width, height, radius, false, false, bounds);
  for (let y = bounds.minY; y <= bounds.maxY; y++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const index = y * width + x;
    if ((mask[index] || 0) > 0.001) output[index] = Math.max(0, closed[index] - gray[index]);
  }
  return output;
}

function boxBlur(src, width, height, radius, bounds) {
  const temporary = new Float32Array(src.length), output = new Float32Array(src.length);
  for (let y = bounds.minY; y <= bounds.maxY; y++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
    let sum = 0, count = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      const xx = clamp(x + dx, 0, width - 1); sum += src[y * width + xx]; count++;
    }
    temporary[y * width + x] = sum / count;
  }
  for (let y = bounds.minY; y <= bounds.maxY; y++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
    let sum = 0, count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const yy = clamp(y + dy, 0, height - 1); sum += temporary[yy * width + x]; count++;
    }
    output[y * width + x] = sum / count;
  }
  return output;
}

function frangiLineResponse(source, width, height, mask, radius) {
  const bounds = roiBounds(mask, width, height, radius + 3);
  const response = new Float32Array(source.length), q = new Float32Array(source.length * 2);
  if (!bounds) return { response, q };
  const smooth = boxBlur(source, width, height, Math.max(1, radius), bounds);
  const curvatureMagnitude = new Float32Array(source.length);
  for (let y = Math.max(1, bounds.minY); y <= Math.min(height - 2, bounds.maxY); y++) {
    for (let x = Math.max(1, bounds.minX); x <= Math.min(width - 2, bounds.maxX); x++) {
      const index = y * width + x;
      if ((mask[index] || 0) <= 0.01) continue;
      const dxx = smooth[index + 1] - 2 * smooth[index] + smooth[index - 1];
      const dyy = smooth[index + width] - 2 * smooth[index] + smooth[index - width];
      const dxy = 0.25 * (smooth[index + width + 1] - smooth[index + width - 1] -
        smooth[index - width + 1] + smooth[index - width - 1]);
      const mean = 0.5 * (dxx + dyy), delta = Math.hypot(0.5 * (dxx - dyy), dxy);
      const lambdaA = mean - delta, lambdaB = mean + delta;
      const large = Math.abs(lambdaA) >= Math.abs(lambdaB) ? lambdaA : lambdaB;
      const small = Math.abs(lambdaA) >= Math.abs(lambdaB) ? lambdaB : lambdaA;
      if (!(large < 0)) continue; // positive black-hat ridge has negative normal curvature
      const magnitude = Math.abs(large);
      curvatureMagnitude[index] = magnitude;
      let nx, ny;
      if (Math.abs(dxy) > 1e-8) [nx, ny] = normalizeQ(dxy, large - dxx);
      else [nx, ny] = Math.abs(dxx - large) < Math.abs(dyy - large) ? [1, 0] : [0, 1];
      const tangent = [-ny, nx], axial = angleToQ(Math.atan2(tangent[1], tangent[0]));
      q[index * 2] = axial[0]; q[index * 2 + 1] = axial[1];
      response[index] = magnitude / (1 + Math.abs(small) / Math.max(1e-6, magnitude));
    }
  }
  const curvatureScale = Math.max(1e-6, percentile(maskedValues(curvatureMagnitude, mask, 0), 0.90));
  for (let index = 0; index < response.length; index++) {
    if (!(response[index] > 0)) continue;
    const normalStrength = clamp(response[index] / curvatureScale);
    response[index] = normalStrength * normalStrength * (3 - 2 * normalStrength);
  }
  return { response, q };
}

function sampleBilinear(field, x, y, width, height) {
  const x0 = clamp(Math.floor(x), 0, width - 1), y0 = clamp(Math.floor(y), 0, height - 1);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = clamp(x - x0), ty = clamp(y - y0);
  const a = field[y0 * width + x0], b = field[y0 * width + x1];
  const c = field[y1 * width + x0], d = field[y1 * width + x1];
  return (1 - ty) * ((1 - tx) * a + tx * b) + ty * ((1 - tx) * c + tx * d);
}

/**
 * Validate the cross-section of a dark line candidate.
 *
 * A real dark skin furrow has brighter skin on both sides of its centreline.
 * Eyelids, lips, nostrils and moving feature boundaries usually have only one
 * brighter side.  Averaging three samples along the tangent makes the test less
 * sensitive to a single pore or compression block without blurring across the
 * candidate normal.
 */
function bilateralGrooveProfile(gray, x, y, q0, q1, halfWidth, width, height) {
  const angle = 0.5 * Math.atan2(q1, q0);
  const tx = Math.cos(angle), ty = Math.sin(angle);
  const nx = -ty, ny = tx;
  const normalDistance = Math.max(1.25, halfWidth);
  const tangentDistance = Math.max(0.75, 0.45 * normalDistance);
  const weights = [0.25, 0.5, 0.25];
  let center = 0, sideA = 0, sideB = 0;
  for (let sample = -1; sample <= 1; sample++) {
    const weight = weights[sample + 1], along = sample * tangentDistance;
    const px = x + tx * along, py = y + ty * along;
    center += weight * sampleBilinear(gray, px, py, width, height);
    sideA += weight * sampleBilinear(
      gray, px + nx * normalDistance, py + ny * normalDistance, width, height,
    );
    sideB += weight * sampleBilinear(
      gray, px - nx * normalDistance, py - ny * normalDistance, width, height,
    );
  }
  const riseA = sideA - center, riseB = sideB - center;
  const depth = Math.min(riseA, riseB);
  const strongestSide = Math.max(1e-6, Math.max(riseA, riseB));
  return {
    depth,
    balance: depth > 0 ? clamp(depth / strongestSide) : 0,
  };
}

function normalizeResponse(response, mask, quantile = 0.94) {
  const scale = Math.max(1e-6, percentile(maskedValues(response, mask, 0), quantile));
  const output = new Float32Array(response.length);
  for (let index = 0; index < response.length; index++) {
    const value = clamp(response[index] / scale);
    output[index] = value * value * (3 - 2 * value);
  }
  return output;
}

function differentialDarkening(neutral, expression, width, height, mask, options = {}) {
  const geometry = analysisGeometry(mask, width, height, options);
  const bounds = roiBounds(mask, width, height, Math.max(4, Math.round(geometry.extent * 0.02)));
  const raw = new Float32Array(neutral.length), residual = new Float32Array(neutral.length);
  const output = new Float32Array(neutral.length);
  if (!bounds) return { positive: output, residual };
  for (let index = 0; index < raw.length; index++) raw[index] = neutral[index] - expression[index];
  const background = boxBlur(
    raw, width, height, Math.max(2, Math.round(geometry.extent * 0.012)), bounds,
  );
  for (let y = bounds.minY; y <= bounds.maxY; y++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const index = y * width + x;
    residual[index] = (mask[index] || 0) * (raw[index] - background[index]);
    output[index] = Math.max(0, residual[index]);
  }
  return { positive: output, residual };
}

function gradientMagnitude(gray, width, height, mask) {
  const output = new Float32Array(gray.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const index = y * width + x;
    if ((mask[index] || 0) <= 0.01) continue;
    const gx = 0.5 * (gray[index + 1] - gray[index - 1]);
    const gy = 0.5 * (gray[index + width] - gray[index - width]);
    output[index] = Math.hypot(gx, gy);
  }
  return output;
}

function blackHatFrangiBranch(neutral, expression, width, height, mask, options = {}) {
  const n = width * height, scale = analysisGeometry(mask, width, height, options).scale;
  const radii = options.blackHatRadii || [2, 4, 7].map((radius) => Math.max(1, Math.round(radius * scale)));
  const response = new Float32Array(n), q = new Float32Array(n * 2);
  for (const radius of [...new Set(radii)]) {
    const neutralHat = blackHat(neutral, width, height, mask, radius);
    const expressionHat = blackHat(expression, width, height, mask, radius);
    const differential = new Float32Array(n);
    for (let index = 0; index < n; index++) {
      differential[index] = (mask[index] || 0) * Math.max(0, expressionHat[index] - neutralHat[index]);
    }
    const line = frangiLineResponse(differential, width, height, mask, Math.max(1, Math.round(radius / 2)));
    const differentialScale = Math.max(1e-6, percentile(maskedValues(differential, mask, 0), 0.92));
    for (let index = 0; index < n; index++) {
      const score = clamp(differential[index] / differentialScale) * line.response[index] * (mask[index] || 0);
      if (score <= response[index]) continue;
      response[index] = score;
      q[index * 2] = line.q[index * 2]; q[index * 2 + 1] = line.q[index * 2 + 1];
    }
  }
  return { response: normalizeResponse(response, mask), q };
}

/** Browser-only oriented zero-mean line bank (Gabor/DoG approximation). */
function orientedGaborBranch(source, width, height, mask, options = {}) {
  const n = width * height, raw = new Float32Array(n), q = new Float32Array(n * 2);
  const geometry = analysisGeometry(mask, width, height, options);
  const bounds = roiBounds(mask, width, height, Math.max(4, Math.round(geometry.extent * 0.02)));
  if (!bounds) return { response: raw, q };
  const scale = geometry.scale;
  const halfWidths = [1.5, 2.5, 4].map((value) => Math.max(1, value * scale));
  const orientations = 12;
  for (let y = bounds.minY; y <= bounds.maxY; y++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const index = y * width + x;
    if ((mask[index] || 0) <= 0.02) continue;
    let best = 0, bestAngle = 0;
    for (let orientation = 0; orientation < orientations; orientation++) {
      const angle = Math.PI * orientation / orientations;
      const tx = Math.cos(angle), ty = Math.sin(angle), nx = -ty, ny = tx;
      for (const halfWidth of halfWidths) {
        let center = 0, side = 0, centerWeight = 0;
        for (let step = -2; step <= 2; step++) {
          const along = step * Math.max(1, halfWidth * 0.9);
          const weight = Math.exp(-0.5 * (step / 1.35) ** 2);
          center += weight * sampleBilinear(source, x + tx * along, y + ty * along, width, height);
          side += 0.5 * weight * (
            sampleBilinear(source, x + tx * along + nx * halfWidth, y + ty * along + ny * halfWidth, width, height) +
            sampleBilinear(source, x + tx * along - nx * halfWidth, y + ty * along - ny * halfWidth, width, height)
          );
          centerWeight += weight;
        }
        const line = Math.max(0, (center - side) / Math.max(1e-6, centerWeight));
        const alongA = sampleBilinear(source, x + tx * halfWidth * 1.8, y + ty * halfWidth * 1.8, width, height);
        const alongB = sampleBilinear(source, x - tx * halfWidth * 1.8, y - ty * halfWidth * 1.8, width, height);
        const continuity = clamp(Math.min(alongA, alongB) / Math.max(1e-6, source[index]));
        const score = line * (0.45 + 0.55 * continuity);
        if (score > best) { best = score; bestAngle = angle; }
      }
    }
    raw[index] = best * (mask[index] || 0);
    const axial = angleToQ(bestAngle); q[index * 2] = axial[0]; q[index * 2 + 1] = axial[1];
  }
  return { response: normalizeResponse(raw, mask), q };
}

/** Opposing normal gradients identify the two edges of one dark wrinkle. */
function edgePairBranch(source, width, height, mask, options = {}) {
  const n = width * height, gx = new Float32Array(n), gy = new Float32Array(n);
  const raw = new Float32Array(n), q = new Float32Array(n * 2);
  const geometry = analysisGeometry(mask, width, height, options);
  const bounds = roiBounds(mask, width, height, Math.max(4, Math.round(geometry.extent * 0.02)));
  if (!bounds) return { response: raw, q };
  for (let y = Math.max(1, bounds.minY); y <= Math.min(height - 2, bounds.maxY); y++) {
    for (let x = Math.max(1, bounds.minX); x <= Math.min(width - 2, bounds.maxX); x++) {
      const index = y * width + x;
      gx[index] = 0.5 * (source[index + 1] - source[index - 1]);
      gy[index] = 0.5 * (source[index + width] - source[index - width]);
    }
  }
  const scale = geometry.scale;
  const halfWidths = [1.5, 2.5, 4].map((value) => Math.max(1, value * scale));
  const orientations = 12;
  for (let y = bounds.minY; y <= bounds.maxY; y++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const index = y * width + x;
    if ((mask[index] || 0) <= 0.02 || source[index] <= 0) continue;
    let best = 0, bestAngle = 0;
    for (let orientation = 0; orientation < orientations; orientation++) {
      const angle = Math.PI * orientation / orientations;
      const tx = Math.cos(angle), ty = Math.sin(angle), nx = -ty, ny = tx;
      for (const halfWidth of halfWidths) {
        const lx = x - nx * halfWidth, ly = y - ny * halfWidth;
        const rx = x + nx * halfWidth, ry = y + ny * halfWidth;
        const left = sampleBilinear(gx, lx, ly, width, height) * nx + sampleBilinear(gy, lx, ly, width, height) * ny;
        const right = sampleBilinear(gx, rx, ry, width, height) * nx + sampleBilinear(gy, rx, ry, width, height) * ny;
        const opposing = Math.sqrt(Math.max(0, left) * Math.max(0, -right));
        const along = Math.min(
          sampleBilinear(source, x + tx * halfWidth * 1.5, y + ty * halfWidth * 1.5, width, height),
          sampleBilinear(source, x - tx * halfWidth * 1.5, y - ty * halfWidth * 1.5, width, height)
        );
        const score = opposing * Math.sqrt(Math.max(0, source[index] * along));
        if (score > best) { best = score; bestAngle = angle; }
      }
    }
    raw[index] = best * (mask[index] || 0);
    const axial = angleToQ(bestAngle); q[index * 2] = axial[0]; q[index * 2 + 1] = axial[1];
  }
  return { response: normalizeResponse(raw, mask), q };
}

/**
 * Paired expression-line detector.
 *
 * A registration residual can be dark in the neutral/expression difference
 * without being a wrinkle (the inner eyebrow edge is the common example).
 * This branch therefore starts from a real dark, line-like groove in the
 * expression image and only then weights it by paired activation.  Callers
 * may supply an action-specific axial direction prior; otherwise the local
 * line direction is unconstrained inside the action ROI.
 */
function pairedExpressionLineBranch(neutral, expression, darkening, width, height, mask, options = {}) {
  const n = width * height, raw = new Float32Array(n), q = new Float32Array(n * 2);
  const scale = analysisGeometry(mask, width, height, options).scale;
  const radii = options.furrowRadii || [2, 3, 5, 8].map((radius) => Math.max(1, Math.round(radius * scale)));
  const preferredQ = Number.isFinite(options.preferredAngleRad)
    ? angleToQ(options.preferredAngleRad) : null;
  const maxDirectionError = options.maxDirectionErrorDeg ?? 90;
  const neutralRetention = options.neutralRetention ?? 0.94;
  const minActivationRatio = options.minActivationRatio ?? 0.20;
  const minBilateralDepthRatio = options.minBilateralDepthRatio ?? 0.10;
  const minBilateralBalance = options.minBilateralBalance ?? 0.30;
  const darkScale = Math.max(1e-6, percentile(maskedValues(darkening, mask, 0), 0.91));
  const neutralGradient = gradientMagnitude(neutral, width, height, mask);
  const neutralGradientScale = Math.max(1e-6, percentile(maskedValues(neutralGradient, mask, 0), 0.90));
  const expressionGradient = gradientMagnitude(expression, width, height, mask);
  const expressionGradientScale = Math.max(1e-6, percentile(maskedValues(expressionGradient, mask, 0), 0.90));
  const expressionScales = [], activationScales = [];
  let profileCandidates = 0, profileRejected = 0;
  for (const radius of [...new Set(radii)]) {
    const neutralHat = blackHat(neutral, width, height, mask, radius);
    const expressionHat = blackHat(expression, width, height, mask, radius);
    const line = frangiLineResponse(expressionHat, width, height, mask, Math.max(1, Math.round(radius / 2)));
    const activation = new Float32Array(n);
    for (let index = 0; index < n; index++) {
      // A candidate must be newly amplified relative to neutral.  The previous
      // 0.62 coefficient leaked 38% of every stable dark boundary, which made
      // nostrils, eyelids and lips look more repeatable than fine wrinkles.
      activation[index] = Math.max(0, expressionHat[index] - neutralRetention * neutralHat[index]);
    }
    const expressionScale = Math.max(1e-6, percentile(maskedValues(expressionHat, mask, 0), 0.91));
    const activationScale = Math.max(1e-6, percentile(maskedValues(activation, mask, 0), 0.90));
    expressionScales.push(expressionScale); activationScales.push(activationScale);
    for (let index = 0; index < n; index++) {
      if ((mask[index] || 0) <= 0.035 || !(line.response[index] > 0)) continue;
      const q0 = line.q[index * 2] || 0, q1 = line.q[index * 2 + 1] || 0;
      const directionError = preferredQ
        ? axialDifferenceDeg(q0, q1, preferredQ[0], preferredQ[1]) : 0;
      if (directionError > maxDirectionError) continue;
      const groove = clamp(expressionHat[index] / expressionScale);
      const paired = clamp(activation[index] / activationScale);
      const changed = clamp(darkening[index] / darkScale);
      const activationRatio = activation[index] / Math.max(1e-6, expressionHat[index]);
      const activationEvidence = clamp(0.72 * paired + 0.28 * changed);
      if (groove < 0.12 || paired < 0.12 || changed < 0.04 ||
          activationRatio < minActivationRatio || activationEvidence < 0.10) continue;
      profileCandidates++;
      const x = index % width, y = Math.floor(index / width);
      const expressionProfile = bilateralGrooveProfile(
        expression, x, y, q0, q1, Math.max(1.25, radius * 0.9), width, height,
      );
      const neutralProfile = bilateralGrooveProfile(
        neutral, x, y, q0, q1, Math.max(1.25, radius * 0.9), width, height,
      );
      // The cross-section must be a two-sided dark groove in the expression
      // image and must deepen relative to the same location in neutral.
      const bilateralDepthRatio = expressionProfile.depth / expressionScale;
      const activatedProfileRatio = (
        expressionProfile.depth - neutralRetention * Math.max(0, neutralProfile.depth)
      ) / expressionScale;
      if (bilateralDepthRatio < minBilateralDepthRatio ||
          activatedProfileRatio < minBilateralDepthRatio * 0.55 ||
          expressionProfile.balance < minBilateralBalance) {
        profileRejected++;
        continue;
      }
      const profileEvidence = Math.sqrt(
        clamp(bilateralDepthRatio / 0.45) *
        clamp(activatedProfileRatio / 0.30) *
        clamp((expressionProfile.balance - minBilateralBalance) /
          Math.max(1e-6, 1 - minBilateralBalance)),
      );
      const directionGate = preferredQ
        ? Math.cos(0.5 * Math.PI * directionError / maxDirectionError) ** 2 : 1;
      // A wrinkle centre is a dark groove with opposing sides; a feature boundary
      // is a single strong neutral gradient. Penalize, but do not hard-delete,
      // high-gradient neutral pixels so faint static skin furrows remain possible.
      const neutralEdge = neutralGradient[index] / neutralGradientScale;
      const activeEdge = expressionGradient[index] / expressionGradientScale;
      const oneSidedEdge = Math.max(neutralEdge, activeEdge);
      if (oneSidedEdge > 1.35) continue;
      const edgePenalty = (1 - 0.88 * clamp((oneSidedEdge - 0.62) / 0.73)) ** 2;
      const score = Math.sqrt(groove * line.response[index]) *
        Math.sqrt(activationEvidence * clamp(activationRatio)) * directionGate *
        profileEvidence * edgePenalty * (mask[index] || 0);
      if (score <= raw[index]) continue;
      raw[index] = score; q[index * 2] = q0; q[index * 2 + 1] = q1;
    }
  }
  const rawValues = maskedValues(raw, mask, 0);
  return {
    response: normalizeResponse(raw, mask, 0.92), absoluteResponse: raw, q,
    diagnostics: {
      expression_contrast_p91: percentile(expressionScales, 0.5),
      paired_activation_p90: percentile(activationScales, 0.5),
      differential_darkening_p91: darkScale,
      neutral_gradient_p90: neutralGradientScale,
      expression_gradient_p90: expressionGradientScale,
      neutral_retention: neutralRetention,
      min_activation_ratio: minActivationRatio,
      min_bilateral_depth_ratio: minBilateralDepthRatio,
      min_bilateral_balance: minBilateralBalance,
      profile_candidates: profileCandidates,
      profile_rejected: profileRejected,
      raw_response_p92: percentile(rawValues, 0.92),
      raw_response_p99: percentile(rawValues, 0.99),
    },
  };
}

function ensembleBranches(branches, mask) {
  const [blackHat, gabor, edgePair] = branches;
  const n = mask.length, response = new Float32Array(n), q = new Float32Array(n * 2);
  for (let index = 0; index < n; index++) {
    if ((mask[index] || 0) <= 0.02) continue;
    const black = blackHat.response[index] || 0, edge = edgePair.response[index] || 0;
    const primary = Math.max(black, edge), secondary = Math.min(black, edge);
    // Gabor is intentionally not allowed to create a centerline by itself: on
    // real skin it responds strongly to pores and broad shading. It only
    // validates the direction found by black-hat/Hessian or an edge pair.
    if (primary <= 0) continue;
    let sx = (blackHat.q[index * 2] || 0) * black + (edgePair.q[index * 2] || 0) * edge;
    let sy = (blackHat.q[index * 2 + 1] || 0) * black + (edgePair.q[index * 2 + 1] || 0) * edge;
    const primaryWeight = black + edge;
    const primaryDirection = normalizeQ(sx, sy);
    const gaborValue = gabor.response[index] || 0;
    const gaborAgreement = clamp(0.5 + 0.5 * (
      primaryDirection[0] * (gabor.q[index * 2] || 0) +
      primaryDirection[1] * (gabor.q[index * 2 + 1] || 0)
    ));
    const gaborWeight = 0.28 * gaborValue * gaborAgreement;
    sx += (gabor.q[index * 2] || 0) * gaborWeight;
    sy += (gabor.q[index * 2 + 1] || 0) * gaborWeight;
    const direction = normalizeQ(sx, sy);
    const primaryConsistency = primaryWeight > 1e-8
      ? Math.hypot(
        (blackHat.q[index * 2] || 0) * black + (edgePair.q[index * 2] || 0) * edge,
        (blackHat.q[index * 2 + 1] || 0) * black + (edgePair.q[index * 2 + 1] || 0) * edge,
      ) / primaryWeight : 0;
    const corroboration = secondary / Math.max(1e-6, primary);
    response[index] = clamp(primary *
      (0.62 + 0.22 * corroboration + 0.16 * gaborAgreement) *
      (0.72 + 0.28 * primaryConsistency));
    q[index * 2] = direction[0]; q[index * 2 + 1] = direction[1];
  }
  return { response, q };
}

function axialDifferenceDeg(a0, a1, b0, b1) {
  return 0.5 * Math.acos(clamp(a0 * b0 + a1 * b1, -1, 1)) * 180 / Math.PI;
}

/**
 * Frown-specific glabellar extractor.
 *
 * Gabor proposes a vertical groove direction, but it is accepted only when a
 * black-hat/Hessian or opposing-edge response exists within a face-relative
 * neighbourhood. This rejects displaced eyebrow boundaries while retaining a
 * slightly shifted wrinkle center between repeated frowns.
 */
function frownConsensusBranch(blackHat, gabor, edgePair, width, height, mask, options = {}) {
  const n = mask.length, raw = new Float32Array(n), q = new Float32Array(n * 2);
  const verticalQ = angleToQ(Math.PI / 2);
  const radius = Math.max(2, Math.round(analysisGeometry(mask, width, height, options).extent * 0.005));
  for (let y = radius; y < height - radius; y++) for (let x = radius; x < width - radius; x++) {
    const index = y * width + x, gaborValue = gabor.response[index] || 0;
    if ((mask[index] || 0) <= 0.04 || gaborValue <= 0.03) continue;
    const gq0 = gabor.q[index * 2] || 0, gq1 = gabor.q[index * 2 + 1] || 0;
    const verticalError = axialDifferenceDeg(gq0, gq1, verticalQ[0], verticalQ[1]);
    if (verticalError > 42) continue;
    let bestPrimary = 0, bestQ0 = 0, bestQ1 = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const next = (y + dy) * width + x + dx;
      const black = blackHat.response[next] || 0, edge = edgePair.response[next] || 0;
      const primary = Math.max(black, edge);
      if (primary <= bestPrimary) continue;
      const source = black >= edge ? blackHat : edgePair;
      bestPrimary = primary; bestQ0 = source.q[next * 2] || 0; bestQ1 = source.q[next * 2 + 1] || 0;
    }
    if (bestPrimary <= 0.04) continue;
    const agreement = clamp(0.5 + 0.5 * (gq0 * bestQ0 + gq1 * bestQ1));
    const verticalGate = Math.cos(0.5 * Math.PI * verticalError / 42) ** 2;
    raw[index] = gaborValue * Math.sqrt(bestPrimary) * (0.72 + 0.28 * agreement) * verticalGate;
    q[index * 2] = gq0; q[index * 2 + 1] = gq1;
  }
  return { response: normalizeResponse(raw, mask), q };
}

function cleanComponents(binary, response, width, height, mask, minLength) {
  const output = new Uint8Array(binary.length), visited = new Uint8Array(binary.length);
  const directions = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
  for (let start = 0; start < binary.length; start++) {
    if (!binary[start] || visited[start]) continue;
    const queue = [start], component = []; visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor], x = index % width, y = Math.floor(index / width);
      component.push(index);
      for (const offset of directions) {
        const next = index + offset, nx = next % width, ny = Math.floor(next / width);
        if (next < 0 || next >= binary.length || Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1 ||
            visited[next] || !binary[next]) continue;
        visited[next] = 1; queue.push(next);
      }
    }
    const strong = component.filter((index) => (mask[index] || 0) > 0.08 && response[index] > 0).length;
    if (component.length < minLength || strong < Math.max(3, Math.ceil(minLength * 0.45))) continue;
    for (const index of component) output[index] = 1;
  }
  return output;
}

function cleanFrownComponents(binary, response, directionQ, width, height, mask, minLength) {
  const output = new Uint8Array(binary.length), visited = new Uint8Array(binary.length);
  const offsets = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
  const verticalQ = angleToQ(Math.PI / 2);
  for (let start = 0; start < binary.length; start++) {
    if (!binary[start] || visited[start]) continue;
    const queue = [start], component = []; visited[start] = 1;
    let minX = width, maxX = -1, minY = height, maxY = -1;
    let sumQ0 = 0, sumQ1 = 0, directionWeight = 0, central = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor], x = index % width, y = Math.floor(index / width);
      component.push(index);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const weight = 0.15 + (response[index] || 0);
      sumQ0 += (directionQ[index * 2] || 0) * weight;
      sumQ1 += (directionQ[index * 2 + 1] || 0) * weight;
      directionWeight += weight;
      if ((mask[index] || 0) > 0.12) central++;
      for (const offset of offsets) {
        const next = index + offset, nx = next % width, ny = Math.floor(next / width);
        if (next < 0 || next >= binary.length || Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1 ||
            visited[next] || !binary[next]) continue;
        visited[next] = 1; queue.push(next);
      }
    }
    const direction = normalizeQ(sumQ0, sumQ1);
    const verticalAgreement = axialAgreement(direction[0], direction[1], verticalQ[0], verticalQ[1]);
    const spanX = maxX - minX + 1, spanY = maxY - minY + 1;
    const enoughCentralSupport = central >= Math.max(3, Math.ceil(component.length * 0.32));
    if (component.length < minLength || spanY < Math.max(3, 0.62 * spanX) ||
        verticalAgreement < 0.54 || !enoughCentralSupport || !(directionWeight > 0)) continue;
    for (const index of component) output[index] = 1;
  }
  return output;
}

function cleanElongatedComponents(binary, response, directionQ, width, height, mask, minLength) {
  const output = new Uint8Array(binary.length), visited = new Uint8Array(binary.length);
  const offsets = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
  for (let start = 0; start < binary.length; start++) {
    if (!binary[start] || visited[start]) continue;
    const queue = [start], component = []; visited[start] = 1;
    let sumX = 0, sumY = 0, minX = width, maxX = -1, minY = height, maxY = -1;
    let sumQ0 = 0, sumQ1 = 0, directionWeight = 0, central = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor], x = index % width, y = Math.floor(index / width);
      component.push(index); sumX += x; sumY += y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const weight = 0.12 + (response[index] || 0);
      sumQ0 += (directionQ[index * 2] || 0) * weight;
      sumQ1 += (directionQ[index * 2 + 1] || 0) * weight;
      directionWeight += weight;
      if ((mask[index] || 0) > 0.10) central++;
      for (const offset of offsets) {
        const next = index + offset, nx = next % width, ny = Math.floor(next / width);
        if (next < 0 || next >= binary.length || Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1 ||
            visited[next] || !binary[next]) continue;
        visited[next] = 1; queue.push(next);
      }
    }
    if (component.length < minLength || central < Math.max(3, Math.ceil(component.length * 0.28))) continue;
    const meanX = sumX / component.length, meanY = sumY / component.length;
    let cxx = 0, cyy = 0, cxy = 0;
    for (const index of component) {
      const dx = index % width - meanX, dy = Math.floor(index / width) - meanY;
      cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
    }
    const anisotropy = Math.hypot(cxx - cyy, 2 * cxy) / Math.max(1e-6, cxx + cyy);
    const directionConsistency = Math.hypot(sumQ0, sumQ1) / Math.max(1e-6, directionWeight);
    const span = Math.max(maxX - minX + 1, maxY - minY + 1);
    if (span < Math.max(5, 0.88 * minLength) || anisotropy < 0.56 || directionConsistency < 0.58) continue;
    for (const index of component) output[index] = 1;
  }
  return output;
}

function transitions(neighbours) {
  let count = 0;
  for (let index = 0; index < neighbours.length; index++) {
    if (!neighbours[index] && neighbours[(index + 1) % neighbours.length]) count++;
  }
  return count;
}

function skeletonize(binary, width, height, maxIterations = 80) {
  const image = new Uint8Array(binary);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = false;
    for (let phase = 0; phase < 2; phase++) {
      const remove = [];
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        if (!image[index]) continue;
        const p = [image[index - width], image[index - width + 1], image[index + 1],
          image[index + width + 1], image[index + width], image[index + width - 1],
          image[index - 1], image[index - width - 1]];
        const count = p.reduce((sum, value) => sum + value, 0);
        if (count < 2 || count > 6 || transitions(p) !== 1) continue;
        const first = phase === 0 ? p[0] * p[2] * p[4] : p[0] * p[2] * p[6];
        const second = phase === 0 ? p[2] * p[4] * p[6] : p[0] * p[4] * p[6];
        if (!first && !second) remove.push(index);
      }
      if (remove.length) changed = true;
      for (const index of remove) image[index] = 0;
    }
    if (!changed) break;
  }
  return image;
}

function skeletonDirections(skeleton, response, width, height, radius) {
  const q = new Float32Array(skeleton.length * 2), confidence = new Float32Array(skeleton.length);
  const responseScale = Math.max(1e-6, percentile(maskedValues(response, skeleton, 0), 0.92));
  for (let y = radius; y < height - radius; y++) for (let x = radius; x < width - radius; x++) {
    const index = y * width + x;
    if (!skeleton[index]) continue;
    let sumW = 0, meanX = 0, meanY = 0, count = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const next = (y + dy) * width + x + dx;
      if (!skeleton[next] || dx * dx + dy * dy > radius * radius) continue;
      const weight = 0.2 + response[next];
      meanX += (x + dx) * weight; meanY += (y + dy) * weight; sumW += weight; count++;
    }
    if (count < 3 || !(sumW > 0)) continue;
    meanX /= sumW; meanY /= sumW;
    let cxx = 0, cyy = 0, cxy = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const next = (y + dy) * width + x + dx;
      if (!skeleton[next] || dx * dx + dy * dy > radius * radius) continue;
      const weight = 0.2 + response[next], px = x + dx - meanX, py = y + dy - meanY;
      cxx += weight * px * px; cyy += weight * py * py; cxy += weight * px * py;
    }
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const axial = angleToQ(angle), anisotropy = Math.hypot(cxx - cyy, 2 * cxy) / Math.max(1e-6, cxx + cyy);
    q[index * 2] = axial[0]; q[index * 2 + 1] = axial[1];
    confidence[index] = clamp((0.35 + 0.65 * anisotropy) * (0.35 + 0.65 * clamp(response[index] / responseScale)));
  }
  return { q, confidence };
}

export function extractDifferentialWrinkles(neutral, expression, width, height, roiMask, options = {}) {
  const n = width * height;
  const empty = () => ({
    q: new Float32Array(n * 2), confidence: new Float32Array(n), ridge: new Float32Array(n),
    skeleton: new Uint8Array(n), response: new Float32Array(n), responseQ: new Float32Array(n * 2),
    absoluteResponse: new Float32Array(n), componentPixels: 0, skeletonPixels: 0,
  });
  if (!neutral || !expression || neutral.length !== n || expression.length !== n || roiMask?.length !== n) return empty();
  const inputs = normalizedGrayInputs(neutral, expression, roiMask);
  const normalized = normalizePairedIllumination(inputs.neutral, inputs.expression, roiMask);
  const method = WRINKLE_EXTRACTOR_METHODS.includes(options.method)
    ? options.method : "paired-expression-lines";
  const geometry = analysisGeometry(roiMask, width, height, options);
  const differential = differentialDarkening(
    inputs.neutral, normalized.gray, width, height, roiMask, options,
  );
  const darkening = differential.positive;
  const residualValues = maskedValues(differential.residual, roiMask, -Infinity);
  const noiseSigma = medianAbsoluteDeviation(residualValues);
  const absoluteThreshold = Math.max(
    options.minAbsoluteDarkening ?? 1.0,
    (options.noiseMadMultiplier ?? 3.5) * noiseSigma,
  );
  let absoluteSupportPixels = 0, maxAbsoluteDarkening = 0;
  for (let index = 0; index < n; index++) {
    if ((roiMask[index] || 0) <= 0.02) continue;
    maxAbsoluteDarkening = Math.max(maxAbsoluteDarkening, darkening[index]);
    if (darkening[index] >= absoluteThreshold) absoluteSupportPixels++;
  }
  const minAbsoluteSupportPixels = options.minAbsoluteSupportPixels ??
    Math.max(4, Math.round(geometry.extent * 0.015));
  const absoluteGatePassed = absoluteSupportPixels >= minAbsoluteSupportPixels;
  const absoluteDiagnostics = {
    input_range_factor: inputs.factor,
    analysis_extent_px: geometry.extent,
    analysis_scale: geometry.scale,
    residual_noise_mad_sigma: noiseSigma,
    absolute_darkening_threshold: absoluteThreshold,
    absolute_support_pixels: absoluteSupportPixels,
    min_absolute_support_pixels: minAbsoluteSupportPixels,
    max_absolute_darkening: maxAbsoluteDarkening,
    absolute_gate_passed: absoluteGatePassed,
  };
  if (!absoluteGatePassed) return {
    ...empty(), method, absoluteGatePassed, diagnostics: absoluteDiagnostics,
    illumination: { gain: normalized.gain, offset: normalized.offset },
  };
  const blackHatBranch = blackHatFrangiBranch(
    inputs.neutral, normalized.gray, width, height, roiMask, options,
  );
  const gaborBranch = method === "blackhat-frangi"
    ? null : orientedGaborBranch(darkening, width, height, roiMask, options);
  const pairBranch = method === "blackhat-frangi" || method === "oriented-gabor"
    ? null : edgePairBranch(darkening, width, height, roiMask, options);
  const pairedLineBranch = method === "frown-furrow" || method === "paired-expression-lines"
    ? pairedExpressionLineBranch(inputs.neutral, normalized.gray, darkening, width, height, roiMask,
      method === "frown-furrow"
        ? { ...options, preferredAngleRad: Math.PI / 2, maxDirectionErrorDeg: 52 }
        : options)
    : null;
  const selected = method === "blackhat-frangi" ? blackHatBranch
    : method === "oriented-gabor" ? gaborBranch
    : method === "edge-pair" ? pairBranch
    : method === "frown-furrow" || method === "paired-expression-lines" ? pairedLineBranch
    : method === "frown-consensus"
      ? frownConsensusBranch(blackHatBranch, gaborBranch, pairBranch, width, height, roiMask, options)
    : ensembleBranches([blackHatBranch, gaborBranch, pairBranch], roiMask);
  const response = selected.response, directionQ = selected.q;
  const darkeningValues = maskedValues(darkening, roiMask, -Infinity);
  const absoluteContrastScale = Math.max(
    absoluteThreshold + 1e-6, percentile(darkeningValues, 0.99),
  );
  let locallyGatedPixels = 0;
  for (let index = 0; index < n; index++) {
    if (!(response[index] > 0)) continue;
    if (darkening[index] < absoluteThreshold) {
      response[index] = 0;
      directionQ[index * 2] = 0; directionQ[index * 2 + 1] = 0;
      continue;
    }
    const absoluteWeight = clamp(
      (darkening[index] - absoluteThreshold) /
      Math.max(1e-6, absoluteContrastScale - absoluteThreshold),
    );
    response[index] *= Math.sqrt(0.35 + 0.65 * absoluteWeight);
    if (response[index] > 0) locallyGatedPixels++;
  }
  absoluteDiagnostics.absolute_contrast_p99 = absoluteContrastScale;
  absoluteDiagnostics.locally_gated_response_pixels = locallyGatedPixels;
  const positives = maskedValues(response, roiMask, 0);
  if (positives.length < 4) return {
    ...empty(), response, responseQ: directionQ,
    absoluteResponse: selected.absoluteResponse || response,
    method, absoluteGatePassed, diagnostics: { ...absoluteDiagnostics, ...(selected.diagnostics || {}) },
    illumination: { gain: normalized.gain, offset: normalized.offset },
  };
  const isFurrow = method === "frown-furrow";
  const isGenericPairedLine = method === "paired-expression-lines";
  const isPairedLine = isFurrow || isGenericPairedLine;
  const low = percentile(positives, isFurrow ? 0.56 : isGenericPairedLine ? 0.74 : 0.64);
  const high = percentile(positives, isFurrow ? 0.88 : isGenericPairedLine ? 0.95 : 0.90);
  const blend = isFurrow ? 0.18 : isGenericPairedLine ? 0.34 : 0.24;
  const threshold = low + blend * Math.max(0, high - low);
  const binary = new Uint8Array(n);
  for (let index = 0; index < n; index++) {
    if ((roiMask[index] || 0) > 0.04 && response[index] >= threshold) binary[index] = 1;
  }
  const minLength = options.minComponentPixels ?? Math.max(5, Math.round(geometry.extent *
    (isGenericPairedLine ? 0.030 : isPairedLine ? 0.010 : 0.012)));
  const components = isFurrow
    ? cleanFrownComponents(binary, response, directionQ, width, height, roiMask, minLength)
    : isGenericPairedLine
      ? cleanElongatedComponents(binary, response, directionQ, width, height, roiMask, minLength)
      : cleanComponents(binary, response, width, height, roiMask, minLength);
  const rawSkeleton = skeletonize(components, width, height);
  // Area filtering before thinning is insufficient: a short, thick moving
  // boundary can have many pixels.  Require the final centreline itself to be
  // long, elongated and directionally coherent.
  const skeleton = isGenericPairedLine
    ? cleanElongatedComponents(
      rawSkeleton, response, directionQ, width, height, roiMask, minLength,
    )
    : rawSkeleton;
  const directions = skeletonDirections(
    skeleton, response, width, height, Math.max(3, Math.round(geometry.extent * 0.012)),
  );
  const confidence = directions.confidence, ridge = new Float32Array(n);
  let componentPixels = 0, skeletonPixels = 0;
  for (let index = 0; index < n; index++) {
    componentPixels += components[index]; skeletonPixels += skeleton[index];
    if (skeleton[index]) ridge[index] = clamp(response[index] / Math.max(1e-6, high));
  }
  return {
    q: directions.q, confidence, ridge, skeleton, response,
    responseQ: directionQ, absoluteResponse: selected.absoluteResponse || response,
    componentPixels, skeletonPixels, threshold,
    method, absoluteGatePassed,
    diagnostics: { ...absoluteDiagnostics, ...(selected.diagnostics || {}) },
    illumination: { gain: normalized.gain, offset: normalized.offset },
  };
}

function localBest(field, index, width, height, radius) {
  const x = index % width, y = Math.floor(index / width);
  let best = -1, bestConfidence = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= width || yy >= height || dx * dx + dy * dy > radius * radius) continue;
    const next = yy * width + xx, confidence = field.confidence[next] || 0;
    if (confidence > bestConfidence) { bestConfidence = confidence; best = next; }
  }
  return best >= 0 ? { index: best, confidence: bestConfidence } : null;
}

function localBestDirectional(field, index, width, height, radius, referenceQ) {
  const x = index % width, y = Math.floor(index / width), sigma = Math.max(1, radius * 0.58);
  let best = -1, bestScore = 0, bestConfidence = 0, bestAgreement = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const xx = x + dx, yy = y + dy, distance2 = dx * dx + dy * dy;
    if (xx < 0 || yy < 0 || xx >= width || yy >= height || distance2 > radius * radius) continue;
    const next = yy * width + xx, confidence = field.confidence[next] || 0;
    if (!(confidence > 0)) continue;
    const agreement = axialAgreement(
      referenceQ[0], referenceQ[1], field.q[next * 2] || 0, field.q[next * 2 + 1] || 0,
    );
    const spatial = Math.exp(-0.5 * distance2 / (sigma * sigma));
    const score = confidence * (0.18 + 0.82 * agreement * agreement) * spatial;
    if (score > bestScore) {
      best = next; bestScore = score; bestConfidence = confidence; bestAgreement = agreement;
    }
  }
  return best >= 0
    ? { index: best, confidence: bestConfidence, agreement: bestAgreement, score: bestScore }
    : null;
}

function cycleConsensus(fields, width, height, radius) {
  const n = width * height, q = new Float32Array(n * 2), confidence = new Float32Array(n), ridge = new Float32Array(n);
  for (let index = 0; index < n; index++) {
    // Anchor consensus on an observed centerline.  The previous implementation
    // evaluated every nearby background pixel and expanded a thin skeleton into
    // a thick confidence tube, inflating counts and admitting motion residuals.
    if (!fields.some((field) => field.skeleton?.[index] && (field.confidence[index] || 0) > 0)) continue;
    let sx = 0, sy = 0, weight = 0, support = 0, ridgeSum = 0;
    for (const field of fields) {
      const match = localBest(field, index, width, height, radius);
      if (!match || match.confidence <= 0) continue;
      sx += field.q[match.index * 2] * match.confidence;
      sy += field.q[match.index * 2 + 1] * match.confidence;
      weight += match.confidence; ridgeSum += field.ridge[match.index] || 0; support++;
    }
    if (!support || !(weight > 0)) continue;
    const direction = normalizeQ(sx, sy), consistency = Math.hypot(sx, sy) / weight;
    q[index * 2] = direction[0]; q[index * 2 + 1] = direction[1];
    confidence[index] = clamp(weight / fields.length * consistency * (0.45 + 0.55 * support / fields.length));
    ridge[index] = clamp(ridgeSum / fields.length * consistency);
  }
  return { q, confidence, ridge };
}

function localBestProbability(field, index, width, height, radius, referenceQ, minimum) {
  const x = index % width, y = Math.floor(index / width), sigma = Math.max(1, radius * 0.62);
  let best = -1, bestScore = 0, bestResponse = 0, bestAgreement = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const xx = x + dx, yy = y + dy, distance2 = dx * dx + dy * dy;
    if (xx < 0 || yy < 0 || xx >= width || yy >= height || distance2 > radius * radius) continue;
    const next = yy * width + xx, response = field.response?.[next] || 0;
    if (response < minimum) continue;
    const q0 = field.responseQ?.[next * 2] || 0, q1 = field.responseQ?.[next * 2 + 1] || 0;
    if (Math.hypot(q0, q1) < 0.5) continue;
    const agreement = referenceQ
      ? axialAgreement(referenceQ[0], referenceQ[1], q0, q1) : 1;
    const spatial = Math.exp(-0.5 * distance2 / (sigma * sigma));
    const score = response * (0.15 + 0.85 * agreement * agreement) * spatial;
    if (score <= bestScore) continue;
    best = next; bestScore = score; bestResponse = response; bestAgreement = agreement;
  }
  return best >= 0 ? { index: best, response: bestResponse, agreement: bestAgreement } : null;
}

function probabilityCycleConsensus(fields, width, height, mask, radius, options = {}) {
  const n = width * height, response = new Float32Array(n), responseQ = new Float32Array(n * 2);
  if (!fields.length) return { response, responseQ };
  const minimum = options.minFrameProbability ?? 0.14;
  const requiredSupport = Math.max(1, Math.ceil(fields.length * (options.minFrameSupportFraction ?? 1)));
  let anchor = fields[0], anchorMass = -1;
  for (const field of fields) {
    let mass = 0;
    if (field.absoluteGatePassed !== false) {
      for (let index = 0; index < n; index++) mass += field.response?.[index] || 0;
    }
    if (mass > anchorMass) { anchor = field; anchorMass = mass; }
  }
  if (!(anchorMass > 0)) return { response, responseQ };
  for (let index = 0; index < n; index++) {
    if ((mask[index] || 0) <= 0.03 || (anchor.response?.[index] || 0) < minimum) continue;
    const referenceQ = [anchor.responseQ?.[index * 2] || 0, anchor.responseQ?.[index * 2 + 1] || 0];
    if (Math.hypot(referenceQ[0], referenceQ[1]) < 0.5) continue;
    let support = 0, logSum = 0, sumQ0 = 0, sumQ1 = 0, weight = 0;
    for (const field of fields) {
      if (field.absoluteGatePassed === false) continue;
      const match = localBestProbability(
        field, index, width, height, radius, referenceQ, minimum,
      );
      if (!match || match.agreement < (options.minFrameDirectionAgreement ?? 0.68)) continue;
      const q0 = field.responseQ[match.index * 2] || 0;
      const q1 = field.responseQ[match.index * 2 + 1] || 0;
      const matchWeight = match.response * match.agreement;
      logSum += Math.log(Math.max(1e-6, match.response));
      sumQ0 += q0 * matchWeight; sumQ1 += q1 * matchWeight;
      weight += matchWeight; support++;
    }
    if (support < requiredSupport || !(weight > 0)) continue;
    const direction = normalizeQ(sumQ0, sumQ1);
    const directionConsistency = Math.hypot(sumQ0, sumQ1) / weight;
    response[index] = clamp(Math.exp(logSum / support) * directionConsistency *
      (support / fields.length));
    responseQ[index * 2] = direction[0]; responseQ[index * 2 + 1] = direction[1];
  }
  return { response, responseQ };
}

/**
 * Fuse aligned probability maps first and skeletonize once at the end.
 *
 * This avoids matching unstable one-pixel skeletons between frames.  Every
 * input frame must first pass its absolute MAD evidence gate; spatial and
 * axial agreement are then evaluated on the still-continuous line response.
 */
export function fuseRepeatedWrinkleProbabilities(
  firstCycle, secondCycle, width, height, roiMask, options = {},
) {
  const n = width * height, geometry = analysisGeometry(roiMask, width, height, options);
  const radius = options.matchRadius ?? Math.max(2, Math.round(geometry.extent * 0.012));
  const first = probabilityCycleConsensus(firstCycle, width, height, roiMask, radius, options);
  const second = probabilityCycleConsensus(secondCycle, width, height, roiMask, radius, options);
  const fusedResponse = new Float32Array(n), fusedQ = new Float32Array(n * 2);
  const repeatAgreement = new Float32Array(n);
  const minimum = options.minCycleProbability ?? 0.12;
  let sumRepeatability = 0, sumWeight = 0;
  for (let index = 0; index < n; index++) {
    const firstResponse = first.response[index] || 0;
    if (firstResponse < minimum) continue;
    const referenceQ = [first.responseQ[index * 2] || 0, first.responseQ[index * 2 + 1] || 0];
    const match = localBestProbability(
      second, index, width, height, radius, referenceQ, minimum,
    );
    if (!match) continue;
    const agreement = match.agreement, shared = Math.sqrt(firstResponse * match.response);
    sumRepeatability += agreement * shared; sumWeight += shared;
    if (agreement < (options.minDirectionAgreement ?? 0.72)) continue;
    const direction = normalizeQ(
      referenceQ[0] * firstResponse + second.responseQ[match.index * 2] * match.response,
      referenceQ[1] * firstResponse + second.responseQ[match.index * 2 + 1] * match.response,
    );
    fusedResponse[index] = clamp(shared * agreement * (roiMask[index] || 0));
    fusedQ[index * 2] = direction[0]; fusedQ[index * 2 + 1] = direction[1];
    repeatAgreement[index] = agreement;
  }
  const threshold = options.minFusedProbability ?? 0.18;
  const binary = new Uint8Array(n);
  let candidatePixelsBeforeCleanup = 0;
  for (let index = 0; index < n; index++) {
    if (fusedResponse[index] < threshold) continue;
    binary[index] = 1; candidatePixelsBeforeCleanup++;
  }
  const minLength = options.minRepeatedComponentPixels ??
    Math.max(4, Math.round(geometry.extent * 0.030));
  const components = cleanElongatedComponents(
    binary, fusedResponse, fusedQ, width, height, roiMask, minLength,
  );
  const rawSkeleton = skeletonize(components, width, height);
  const skeleton = cleanElongatedComponents(
    rawSkeleton, fusedResponse, fusedQ, width, height, roiMask, minLength,
  );
  const directions = skeletonDirections(
    skeleton, fusedResponse, width, height, Math.max(3, Math.round(geometry.extent * 0.012)),
  );
  const confidence = directions.confidence, ridge = new Float32Array(n);
  const dynamicValidation = new Float32Array(n);
  let repeatedPixels = 0;
  for (let index = 0; index < n; index++) {
    if (!skeleton[index]) continue;
    repeatedPixels++;
    confidence[index] *= fusedResponse[index];
    ridge[index] = fusedResponse[index];
    dynamicValidation[index] = repeatAgreement[index];
  }
  return {
    q: directions.q, confidence, ridge, dynamicValidation, skeleton,
    response: fusedResponse, responseQ: fusedQ,
    repeatedPixels, repeatedPixelsBeforeCleanup: candidatePixelsBeforeCleanup,
    minRepeatedComponentPixels: minLength,
    globalRepeatability: sumWeight ? sumRepeatability / sumWeight : 0,
    firstCycleCount: firstCycle.length, secondCycleCount: secondCycle.length,
    fusionMode: "probability-first-single-skeleton",
    threshold,
  };
}

export function fuseRepeatedWrinkleExtractions(firstCycle, secondCycle, width, height, roiMask, options = {}) {
  const geometry = analysisGeometry(roiMask, width, height, options);
  const n = width * height, radius = options.matchRadius ??
    Math.max(2, Math.round(geometry.extent * 0.006));
  const first = cycleConsensus(firstCycle, width, height, radius);
  const second = cycleConsensus(secondCycle, width, height, radius);
  const q = new Float32Array(n * 2), confidence = new Float32Array(n), ridge = new Float32Array(n);
  const dynamicValidation = new Float32Array(n), skeleton = new Uint8Array(n);
  let repeatedPixelsBeforeCleanup = 0, sumRepeatability = 0, sumWeight = 0;
  for (let index = 0; index < n; index++) {
    if (!(first.confidence[index] > 0)) continue;
    const match = localBestDirectional(second, index, width, height, radius,
      [first.q[index * 2], first.q[index * 2 + 1]]);
    if (!match || !(match.confidence > 0)) continue;
    const agreement = match.agreement;
    const shared = Math.min(first.confidence[index], match.confidence);
    sumRepeatability += agreement * shared; sumWeight += shared;
    if (agreement < (options.minDirectionAgreement ?? 0.72)) continue;
    const direction = normalizeQ(
      first.q[index * 2] * first.confidence[index] + second.q[match.index * 2] * match.confidence,
      first.q[index * 2 + 1] * first.confidence[index] + second.q[match.index * 2 + 1] * match.confidence,
    );
    const value = clamp(Math.sqrt(shared) * agreement * (roiMask[index] || 0));
    if (value < (options.minConfidence ?? 0.045)) continue;
    q[index * 2] = direction[0]; q[index * 2 + 1] = direction[1];
    confidence[index] = value;
    ridge[index] = clamp(Math.sqrt((first.ridge[index] || 0) * (second.ridge[match.index] || 0)) * agreement);
    dynamicValidation[index] = agreement;
    skeleton[index] = 1; repeatedPixelsBeforeCleanup++;
  }
  const minRepeatedLength = options.minRepeatedComponentPixels ??
    Math.max(4, Math.round(geometry.extent * 0.024));
  const cleanedSkeleton = cleanElongatedComponents(
    skeleton, confidence, q, width, height, roiMask, minRepeatedLength,
  );
  let repeatedPixels = 0;
  for (let index = 0; index < n; index++) {
    if (cleanedSkeleton[index]) {
      repeatedPixels++;
      continue;
    }
    q[index * 2] = 0; q[index * 2 + 1] = 0;
    confidence[index] = 0; ridge[index] = 0; dynamicValidation[index] = 0;
  }
  return {
    q, confidence, ridge, dynamicValidation, skeleton: cleanedSkeleton, repeatedPixels,
    repeatedPixelsBeforeCleanup, minRepeatedComponentPixels: minRepeatedLength,
    globalRepeatability: sumWeight ? sumRepeatability / sumWeight : 0,
    firstCycleCount: firstCycle.length, secondCycleCount: secondCycle.length,
  };
}
