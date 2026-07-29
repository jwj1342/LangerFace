import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/styles.css", "utf8");

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`No matching brace found at ${openIndex}.`);
}

function ruleBody(selector: string): { body: string; index: number } {
  const index = css.indexOf(selector);
  assert.notEqual(index, -1, `Missing contrast rule for ${selector}.`);
  const openIndex = css.indexOf("{", index);
  const closeIndex = findMatchingBrace(css, openIndex);
  return { body: css.slice(openIndex + 1, closeIndex), index };
}

function cssVariable(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `Missing CSS variable ${name}.`);
  return match[1].trim();
}

type Rgba = { red: number; green: number; blue: number; alpha: number };

function parseColor(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      red: Number.parseInt(hex[1].slice(0, 2), 16),
      green: Number.parseInt(hex[1].slice(2, 4), 16),
      blue: Number.parseInt(hex[1].slice(4, 6), 16),
      alpha: 1,
    };
  }

  const rgb = value.match(
    /^rgb\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*\)$/i,
  );
  assert.ok(rgb, `Unsupported CSS color: ${value}`);
  return {
    red: Number(rgb[1]),
    green: Number(rgb[2]),
    blue: Number(rgb[3]),
    alpha: rgb[4] == null ? 1 : Number(rgb[4]),
  };
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  return {
    red: foreground.red * foreground.alpha + background.red * (1 - foreground.alpha),
    green: foreground.green * foreground.alpha + background.green * (1 - foreground.alpha),
    blue: foreground.blue * foreground.alpha + background.blue * (1 - foreground.alpha),
    alpha: 1,
  };
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgba): number {
  return (
    0.2126 * linearChannel(color.red)
    + 0.7152 * linearChannel(color.green)
    + 0.0722 * linearChannel(color.blue)
  );
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const foregroundLuminance = luminance(composite(foreground, background));
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

const layerStart = css.indexOf("@layer components");
assert.notEqual(layerStart, -1, "Component layer must remain explicit.");
const layerOpen = css.indexOf("{", layerStart);
const layerEnd = findMatchingBrace(css, layerOpen);

const controlSelector = `.live-workbench .select,
.incision-workbench .select,
.incision-workbench .text-input`;
const controlRule = ruleBody(controlSelector);
assert.ok(
  controlRule.index > layerEnd,
  "Issue #115 override must be unlayered so it can beat the imported legacy white control rule.",
);
assert.match(controlRule.body, /background-color:\s*#0f141b;/);
assert.match(controlRule.body, /color:\s*var\(--clinical-text-primary\);/);
assert.doesNotMatch(controlRule.body, /opacity|pointer-events|cursor|disabled/);

const placeholderRule = ruleBody(".incision-workbench .text-input::placeholder");
assert.ok(placeholderRule.index > layerEnd, "Placeholder override must be unlayered.");
assert.match(placeholderRule.body, /color:\s*var\(--clinical-dark-muted\);/);
assert.match(placeholderRule.body, /opacity:\s*1;/);

const background = parseColor("#0f141b");
const primaryRatio = contrastRatio(
  parseColor(cssVariable("--clinical-text-primary")),
  background,
);
const placeholderRatio = contrastRatio(
  parseColor(cssVariable("--clinical-dark-muted")),
  background,
);

assert.ok(
  primaryRatio >= 4.5,
  `Control text contrast ${primaryRatio.toFixed(2)}:1 must meet WCAG AA 4.5:1.`,
);
assert.ok(
  placeholderRatio >= 4.5,
  `Placeholder contrast ${placeholderRatio.toFixed(2)}:1 must meet WCAG AA 4.5:1.`,
);

console.log(
  `test_control_contrast: control ${primaryRatio.toFixed(2)}:1, placeholder ${placeholderRatio.toFixed(2)}:1`,
);
