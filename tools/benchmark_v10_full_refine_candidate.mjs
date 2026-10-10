import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { buildPrecomputedFineWrinkleEvidence } from
  "../web/src/services/personalized/precomputedFineWrinkleEvidence.ts";
import { refineV6 as experiment } from
  "../web/src/services/personalized/v6RstlRefinementV9.ts";
import { latestV9RstlRefinementOptions } from
  "../web/src/services/personalized/v9RstlRefinementProfile.ts";

// Fixed V10 evidence and archived real RSTL seeds. Measures the complete
// refineV6 stage, not model inference, upload, or photo end-to-end latency.
const root = fileURLToPath(new URL("../", import.meta.url));
const name = process.argv[2] || "white";
const rounds = Number(process.argv[3] || 5);
const controlRevision = process.argv[4] || "HEAD";
assert.ok(["white", "yellow"].includes(name));
assert.ok(Number.isInteger(rounds) && rounds >= 3);
const fixture = JSON.parse(fs.readFileSync(path.join(root,
  `../wrinkle_refinement_performance_20260917/${name}-original.json`), "utf8"));
const payload = JSON.parse(fs.readFileSync(path.join(root,
  "../langer线-cc/wrinkle_three_real_inputs_v10_20260830/original/result/response.json"), "utf8"));
const request = fixture.capture.request.value;
const evidence = buildPrecomputedFineWrinkleEvidence({
  ...payload,
  lines: payload.lines.filter((line) => line.anatomicalClass !== "nasal_dorsum"),
}, request.size, payload.source.imageSha256);
const input = {
  seeds: request.seeds,
  wrinkleMask: evidence.mask,
  confidenceMap: evidence.confidence,
  directionQ: evidence.directionQ,
  size: request.size,
  faceWidthPx: request.faceWidthPx,
  options: latestV9RstlRefinementOptions(request.faceWidthPx),
};
const source = execFileSync("git", ["show",
  `${controlRevision}:web/src/services/personalized/v6RstlRefinementV9.ts`],
{ cwd: root, encoding: "utf8" });
const { refineV6: control } = await import(`data:text/javascript;base64,${Buffer.from(
  stripTypeScriptTypes(source),
).toString("base64")}`);

const controlProfile = {}, experimentProfile = {};
const expected = control({ ...input, performance: controlProfile });
const actual = experiment({ ...input, performance: experimentProfile });
assert.deepStrictEqual(actual, expected, "complete refineV6 output must be identical");
assert.deepStrictEqual(experimentProfile.counters, controlProfile.counters,
  "operation counts must be unchanged");

const times = { control: [], experiment: [] };
for (let round = 0; round < rounds + 1; round += 1) {
  const order = round % 2 === 0 ?
    [["control", control], ["experiment", experiment]] :
    [["experiment", experiment], ["control", control]];
  for (const [label, implementation] of order) {
    const start = performance.now();
    implementation(input);
    if (round > 0) times[label].push(performance.now() - start);
  }
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const controlMedianMs = median(times.control);
const experimentMedianMs = median(times.experiment);
console.log(JSON.stringify({ name, controlRevision, rounds, exactEquality: true,
  controlMedianMs, experimentMedianMs,
  deltaPercent: 100 * (experimentMedianMs / controlMedianMs - 1), times,
  intersectionCounters: Object.fromEntries(Object.entries(experimentProfile.counters || {})
    .filter(([key]) => key.includes("curvePair") || key.includes("intersection"))) }));
