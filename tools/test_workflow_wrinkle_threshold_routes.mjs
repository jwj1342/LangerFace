import assert from "node:assert/strict";

import { wrinkleWorkerOptionsForLocation } from "../web/src/services/personalized/liveWrinklePipelineWorkerClient.ts";
import { requestedWrinkleConfidence } from "../web/src/services/personalized/yoloWrinkleOnnx.ts";

const cases = [
  ["/app/workflow/640", "0.1"],
  ["/app/workflow/640-threshold01", "0.01"],
  ["/app/workflow/640-threshold001", "0.001"],
];

for (const [path, expected] of cases) {
  const options = wrinkleWorkerOptionsForLocation(path, "?wrinkleModel=1024&wrinkleConfidence=0.0001");
  assert.equal(options.get("wrinkleModel"), "640", `${path} must select the 640 model`);
  assert.equal(options.get("wrinkleConfidence"), expected, `${path} must keep its fixed threshold`);
  globalThis.location = {
    pathname: path,
    search: "",
    hash: `#${options.toString()}`,
  };
  assert.equal(requestedWrinkleConfidence(), Number(expected), `${path} worker threshold`);
}

console.log("workflow 640 threshold routes passed");
