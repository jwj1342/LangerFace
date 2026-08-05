import assert from "node:assert/strict";
import fs from "node:fs";

const theme = fs.readFileSync("clinical-theme.css", "utf8");
const appStyles = fs.readFileSync("src/styles.css", "utf8");
const personalized = fs.readFileSync("personalized.html", "utf8");
const personalizedRuntime = fs.readFileSync("compat/personalized/personalized.js", "utf8");
const current = fs.readFileSync("current/index.html", "utf8");
const v6Page = fs.readFileSync("compat/personalized/v6_review.html", "utf8");
const v6Styles = fs.readFileSync("compat/personalized/v6_review.css", "utf8");
const dashboard = fs.readFileSync("src/routes/DashboardRoute.tsx", "utf8");

assert.match(theme, /--clinical-accent:\s*#0f62fe/);
assert.match(theme, /--clinical-success:\s*#42be65/);
assert.match(theme, /--clinical-dark-bg:\s*#090b0f/);
assert.match(appStyles, /@import "\.\.\/clinical-theme\.css"/,
  "the React app must consume the shared clinical tokens");

assert.match(personalized, /href="\/clinical-theme\.css"/);
assert.match(personalized, /--accent:var\(--clinical-accent\)/);
assert.match(personalized, /\.btn-primary\{background:var\(--accent\)/);
assert.match(personalized, /\.step\.current\{border-color:#78a9ff/);
assert.match(personalized, /\.step\.done\{background:var\(--success-soft\)/,
  "completed capture steps must retain semantic success green");
assert.doesNotMatch(personalized, /#0f9b6e|#0c8460|--green:/,
  "the personalized page must not retain its old green brand palette");
assert.doesNotMatch(personalizedRuntime, /#0c8460/,
  "runtime-generated personalized summaries must use the clinical palette");

assert.match(current, /href="\/src\/styles\.css"/);
assert.match(current, /<body class="clinical-compat-workbench">/,
  "the public compatibility page must use the shared clinical workbench theme");

assert.match(v6Page, /href="\/clinical-theme\.css"/);
assert.match(v6Styles, /--accent:\s*var\(--clinical-accent\)/);
assert.match(v6Styles, /--success:\s*var\(--clinical-success\)/);
assert.match(v6Styles, /\.button-primary \{ color: #f4f7fb; background: var\(--accent\)/);
assert.doesNotMatch(v6Styles, /--green:|#38e3a1/,
  "V6 review uses blue for actions and keeps green only as semantic/scientific data color");
assert.match(dashboard, /<ReactPage className="dark-workbench-page dashboard-workbench-page">/,
  "the dashboard shell must use the same dark theme as the tool workbenches");
assert.match(dashboard, /text-blue-300/);
assert.doesNotMatch(dashboard, /text-emerald-300/);

function luminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((part) => Number.parseInt(part, 16) / 255) || [];
  assert.equal(channels.length, 3, `invalid color ${hex}`);
  const linear = channels.map((value) => value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(left: string, right: string): number {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const [foreground, background, label] of [
  ["f4f7fb", "0f62fe", "primary button"],
  ["e5eaf0", "121820", "panel text"],
  ["a6c8ff", "121820", "accent link"],
  ["42be65", "121820", "success state"],
] as const) {
  assert.ok(contrast(foreground, background) >= 4.5, `${label} must meet WCAG AA text contrast`);
}

console.log("test_clinical_theme_consistency: shared blue theme and semantic colors passed");
