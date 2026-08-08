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

const analysis = fs.readFileSync(
  new URL("../web/src/services/liveWrinkleAnalysis.ts", import.meta.url),
  "utf8",
);
assert.match(analysis, /delegate: "CPU"/);
assert.match(analysis, /runningMode: "IMAGE"/);
assert.match(analysis, /outputFaceBlendshapes: false/);
assert.match(analysis, /detectV9ReferenceLandmarks/);

console.log("single-frame wrinkle display and refinement tests passed");
