#!/usr/bin/env node

/**
 * Checkout/deployment guard for the latest wrinkle pipeline.
 * This checks source contracts rather than GitHub branch names: a colleague
 * may deploy from a tarball, a detached commit, or a pull request.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const files = {
  live: resolve(root, "web/src/services/liveWrinkleAnalysis.ts"),
  runtime: resolve(root, "web/src/services/personalized/personalizedRuntime.ts"),
  experiment: resolve(root, "web/compat/personalized/wrinkleRstlExperiment.ts"),
  profile: resolve(root, "web/src/services/personalized/v9RstlRefinementProfile.ts"),
  atlas: resolve(root, "web/assets/atlas_rstl.json"),
};

const source = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([name, file]) => [name, await readFile(file, "utf8")]),
));
const checks = [
  ["RSTL atlas v8.1.96", /\"atlasVersion\":\s*\"8\.1\.96\"/.test(source.atlas)],
  ["live V9 implementation", /v6RstlRefinementV9\.ts/.test(source.live)],
  ["personalized V9 implementation", /v6RstlRefinementV9\.ts/.test(source.runtime)],
  ["live v10 evidence", /wrinkle_fine_lines_v10_wrinkle\.json/.test(source.live)],
  ["shared V9 profile", /v9-regional-smooth-7\.2/.test(source.profile)],
  ["experiment defaults to V9", /requestedRefinement !== \"legacy\"/.test(source.experiment)],
  ["experiment uses latest v10 evidence", /wrinkle_fine_lines_v10_wrinkle\.json/.test(source.experiment)],
];
const failed = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failed.length) {
  console.error("最新皱纹流水线校验失败：");
  for (const label of failed) console.error(`- ${label}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    status: "latest_wrinkle_pipeline_verified",
    rstl: "v8.1.96",
    detection: "v10",
    refinement: "v9-regional-smooth-7.2",
    checks: checks.length,
  }, null, 2));
}
