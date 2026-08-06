import assert from "node:assert/strict";
import fs from "node:fs";

import {
  fromWrinkleWorkingPoint,
  toWrinkleWorkingPoint,
} from "../web/src/services/liveWrinkleMath.ts";

const transform = { scale: 0.5, offsetX: 12, offsetY: 38 };
const sourcePoint = [320, 180] as const;
const workingPoint = toWrinkleWorkingPoint(sourcePoint, transform);
assert.deepEqual(workingPoint, [172, 128]);
assert.deepEqual(fromWrinkleWorkingPoint(workingPoint, transform), sourcePoint);

const panel = fs.readFileSync(
  new URL("../web/src/components/LiveWrinklePanel.tsx", import.meta.url),
  "utf8",
);
assert.match(panel, /只显示 RSTL/);
assert.match(panel, /只显示皱纹/);
assert.match(panel, /RSTL 与皱纹同时显示/);
assert.match(panel, /皱纹引导自动微调/);
assert.match(panel, /医生手动微调（2D）/);

const runtime = fs.readFileSync(
  new URL("../web/src/services/liveRuntime.ts", import.meta.url),
  "utf8",
);
assert.match(runtime, /analyzeCurrentWrinkles/);
assert.match(runtime, /applyWrinkleGuidedRefinement/);
assert.doesNotMatch(runtime, /if \(!isRefineActive\(\)\) toggleRefine2d\(\)/);
assert.match(runtime, /beginFrozenRefineSession\(\)/,
  "every frozen frame must start a fresh geometry session");
assert.match(runtime, /function handleTemplateChange[\s\S]*resetRefineForNewSource\(\);[\s\S]*resetLiveWrinkleAnalysis\(\);/,
  "changing the atlas must invalidate refinement and wrinkle results from the previous geometry");

const refineRuntime = fs.readFileSync(
  new URL("../web/src/services/liveRefine2d.ts", import.meta.url),
  "utf8",
);
assert.match(refineRuntime, /s\.liveBaselineLines \|\| s\.latestAutoLines/,
  "live transport must use the standard frozen-frame baseline when wrinkle guidance replaces the reset baseline");
assert.match(refineRuntime, /s\.liveBaselineLines = null;[\s\S]*s\.selected = null;[\s\S]*s\.dirty = false;/,
  "a later freeze must discard stale baseline geometry and manual state");

const analysisRuntime = fs.readFileSync(
  new URL("../web/src/services/liveWrinkleAnalysis.ts", import.meta.url),
  "utf8",
);
assert.match(analysisRuntime, /await Promise\.allSettled\(\[\.\.\.activeAnalyses\]\);[\s\S]*await current\?\.close\(\)/,
  "route disposal must wait for active model work before releasing the ONNX session");

console.log("single-frame wrinkle display and refinement tests passed");
