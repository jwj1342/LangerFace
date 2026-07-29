// Forehead visibility helpers shared by still-image and live-camera rendering.

function meanPatch(image, width, height, x, y, radius = 3) {
  const cx = Math.round(x), cy = Math.round(y);
  let r = 0, g = 0, b = 0, n = 0;
  for (let yy = cy - radius; yy <= cy + radius; yy++) {
    if (yy < 0 || yy >= height) continue;
    for (let xx = cx - radius; xx <= cx + radius; xx++) {
      if (xx < 0 || xx >= width) continue;
      const offset = (yy * width + xx) * 4;
      r += image.data[offset];
      g += image.data[offset + 1];
      b += image.data[offset + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : null;
}

function srgbToLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(rgb) {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (value) => value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function skinColorMatchesReferences(rgb, referenceRgbs) {
  if (!rgb || !referenceRgbs?.length) return true;
  const sample = rgbToLab(rgb);
  const references = referenceRgbs.map(rgbToLab);
  const distance = Math.min(...references.map((reference) => labDistance(sample, reference)));
  const referenceChroma = references
    .map((reference) => Math.hypot(reference[1], reference[2]))
    .sort((a, b) => a - b)[Math.floor(references.length / 2)];
  const sampleChroma = Math.hypot(sample[1], sample[2]);
  const referenceLightness = references
    .map((reference) => reference[0])
    .sort((a, b) => a - b)[Math.floor(references.length / 2)];
  const tooDark = sample[0] < referenceLightness * 0.52 && distance > 10;
  const achromaticHair = sampleChroma < Math.max(5, referenceChroma * 0.70) && distance > 10;
  return !tooDark && !achromaticHair && distance <= 26;
}

export function buildHeadVisibility(landmarks) {
  if (!landmarks?.length || !landmarks[10]) return () => true;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const point of landmarks) {
    if (!point) continue;
    x0 = Math.min(x0, point[0]); y0 = Math.min(y0, point[1]);
    x1 = Math.max(x1, point[0]); y1 = Math.max(y1, point[1]);
  }
  const faceWidth = x1 - x0, faceHeight = y1 - y0;
  const cx = 0.5 * (x0 + x1), cy = landmarks[10][1] + 0.10 * faceHeight;
  const rx = Math.max(1, 0.54 * faceWidth), ry = Math.max(1, 0.46 * faceHeight);
  return (point) => {
    if (!point) return false;
    const dx = (point[0] - cx) / rx, dy = (point[1] - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };
}

export function buildForeheadSkinVisibility(image, width, height, landmarks) {
  if (!image || !landmarks?.length || width <= 0 || height <= 0) return () => true;
  const trustedReferences = [1, 4, 5, 195, 197, 205, 425]
    .map((index) => landmarks[index])
    .filter(Boolean)
    .map((point) => meanPatch(image, width, height, point[0], point[1], 3))
    .filter(Boolean);
  if (!trustedReferences.length) return () => true;

  const foreheadOffset = Math.max(4, 0.0165 * width);
  const foreheadReferences = [10, 338, 109]
    .map((index) => landmarks[index])
    .filter(Boolean)
    .map((point) => meanPatch(image, width, height, point[0], point[1] + foreheadOffset, 3))
    .filter(Boolean)
    .filter((color) => skinColorMatchesReferences(color, trustedReferences));
  const references = trustedReferences.concat(foreheadReferences);
  const browY = [9, 8, 107, 336].map((index) => landmarks[index]?.[1]).filter(Number.isFinite);
  const browLine = browY.length ? browY.reduce((a, b) => a + b, 0) / browY.length : height * 0.38;
  const foreheadFloor = browLine + Math.max(8, height * 0.018);

  return (point) => {
    if (!point) return false;
    if (point[1] > foreheadFloor) return true;
    return skinColorMatchesReferences(meanPatch(image, width, height, point[0], point[1], 3), references);
  };
}

export function stabilizeForeheadMask(mask) {
  const stable = Array.from(mask, Boolean);
  const maxGap = Math.max(2, Math.round(stable.length * 0.015));
  const minRun = Math.max(3, Math.round(stable.length * 0.025));
  const minVisibleSpan = Math.max(minRun, Math.round(stable.length * 0.22));

  for (let start = 0; start < stable.length;) {
    if (stable[start]) { start++; continue; }
    let end = start;
    while (end < stable.length && !stable[end]) end++;
    if (start > 0 && end < stable.length && end - start <= maxGap) {
      for (let i = start; i < end; i++) stable[i] = true;
    }
    start = end;
  }

  for (let start = 0; start < stable.length;) {
    if (!stable[start]) { start++; continue; }
    let end = start;
    while (end < stable.length && stable[end]) end++;
    if (end - start < minRun) {
      for (let i = start; i < end; i++) stable[i] = false;
    }
    start = end;
  }
  let longestRun = null;
  for (let start = 0; start < stable.length;) {
    if (!stable[start]) { start++; continue; }
    let end = start;
    while (end < stable.length && stable[end]) end++;
    if (!longestRun || end - start > longestRun.end - longestRun.start) {
      longestRun = { start, end };
    }
    start = end;
  }
  if (!longestRun || longestRun.end - longestRun.start < minVisibleSpan) {
    stable.fill(false);
  } else {
    for (let i = 0; i < stable.length; i++) {
      stable[i] = i >= longestRun.start && i < longestRun.end;
    }
  }
  return stable;
}
