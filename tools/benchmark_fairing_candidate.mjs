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
import { yoloGuidedV9RstlRefinementOptions } from
  "../web/src/services/personalized/v9RstlRefinementProfile.ts";

// Compare the complete forehead + glabellar refinement stage on two archived
// fixed-evidence requests. This is not photo end-to-end timing. The control
// revision can be HEAD (the preceding experiment) or the deployed base.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const evidenceRoot = path.resolve(repoRoot, "../wrinkle_refinement_performance_20260917");
const controlRevision = process.argv[2] || "HEAD";
const rounds = Number(process.argv[3] || 15);
assert.ok(Number.isInteger(rounds) && rounds >= 5);
const source = execFileSync("git", ["show",
  `${controlRevision}:web/src/services/personalized/v6RstlRefinementV9.ts`],
{ cwd: repoRoot, encoding: "utf8" });
const { refineV6: control } = await import(`data:text/javascript;base64,${Buffer.from(
  stripTypeScriptTypes(source),
).toString("base64")}`);

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

for (const name of ["white", "yellow"]) {
  const archive = JSON.parse(fs.readFileSync(path.join(evidenceRoot,
    `${name}-original.json`), "utf8"));
  const request = archive.capture.request.value;
  const inputs = [];
  for (const [channel, className, isSeed] of [
    ["forehead", "forehead", (region) => String(region).includes("forehead")],
    ["glabellar", "frown", (region) => region === "orbital_brow_upturn_v11"],
  ]) {
    const hash = `fixed-${name}-${channel}`;
    const lines = archive.debug.evidenceLines
      .filter((line) => line.className === className)
      .map((line) => ({ id: line.id, class: className, points: line.points }));
    const evidence = buildPrecomputedFineWrinkleEvidence({
      schemaVersion: "langerface.wrinkle-fine-lines.v1",
      source: { imageSha256: hash, width: request.size, height: request.size },
      lines,
    }, request.size, hash);
    inputs.push({ channel, input: {
      seeds: request.seeds.filter((seed) => isSeed(seed.region)),
      wrinkleMask: evidence.mask,
      confidenceMap: evidence.confidence,
      directionQ: evidence.directionQ,
      size: request.size,
      faceWidthPx: request.faceWidthPx,
      options: yoloGuidedV9RstlRefinementOptions(request.faceWidthPx),
    } });
  }
  for (const { channel, input } of inputs) {
    assert.deepStrictEqual(experiment(input), control(input),
      `${name}/${channel}: complete output must be identical`);
  }
  const controlTimes = [], experimentTimes = [];
  for (let round = 0; round < rounds + 2; round += 1) {
    const order = round % 2 === 0 ?
      [[control, controlTimes], [experiment, experimentTimes]] :
      [[experiment, experimentTimes], [control, controlTimes]];
    for (const [implementation, values] of order) {
      const start = performance.now();
      for (const { input } of inputs) implementation(input);
      if (round >= 2) values.push(performance.now() - start);
    }
  }
  const controlMedianMs = median(controlTimes);
  const experimentMedianMs = median(experimentTimes);
  console.log(JSON.stringify({ name, controlRevision, rounds,
    exactEquality: true, controlMedianMs, experimentMedianMs,
    deltaPercent: 100 * (experimentMedianMs / controlMedianMs - 1),
    controlTimes, experimentTimes }));
}
