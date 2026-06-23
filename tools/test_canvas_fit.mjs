import assert from "node:assert/strict";
import { fitContainSize } from "../web/fit_math.js";

{
  const fit = fitContainSize(1067, 1600, 920, 739);
  assert.equal(fit.height, 739);
  assert.equal(fit.width, 493);
  assert.ok(fit.scale < 1);
}

{
  const fit = fitContainSize(2400, 900, 900, 700);
  assert.equal(fit.width, 900);
  assert.equal(fit.height, 338);
}

{
  const fit = fitContainSize(320, 240, 960, 720);
  assert.equal(fit.width, 960);
  assert.equal(fit.height, 720);
  assert.ok(fit.scale > 1);
}

{
  const fit = fitContainSize(320, 240, 960, 720, { allowUpscale: false });
  assert.equal(fit.width, 320);
  assert.equal(fit.height, 240);
  assert.equal(fit.scale, 1);
}

console.log("test_canvas_fit: image display fit assertions passed");
