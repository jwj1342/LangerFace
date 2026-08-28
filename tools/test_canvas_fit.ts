import assert from "node:assert/strict";
import { fitContainSize, nextImageGestureViewState } from "../web/src/services/fitMath.ts";

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

{
  const next = nextImageGestureViewState({
    zoom: 1,
    minZoom: 1,
    maxZoom: 5,
    offsetX: 0,
    offsetY: 0,
  }, { x: -20, y: -20 }, { x: -10, y: -20 }, 2);
  assert.ok(next);
  assert.equal(next.zoom, 2);
  assert.equal(next.offsetX, 30,
    "the source point under the old pinch centre must move to the new centre while scaling");
  assert.equal(next.offsetY, 20);
}

console.log("test_canvas_fit: image display fit assertions passed");
