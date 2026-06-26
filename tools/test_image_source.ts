import assert from "node:assert/strict";

import { fitImageToMaxSide, MAX_IMAGE_SOURCE_DIM } from "../web/src/services/imageSource.ts";

{
  const fit = fitImageToMaxSide(6000, 4000);
  assert.equal(fit.width, MAX_IMAGE_SOURCE_DIM);
  assert.equal(fit.height, 1067);
  assert.equal(fit.scaled, true);
}

{
  const fit = fitImageToMaxSide(3000, 6000);
  assert.equal(fit.width, 800);
  assert.equal(fit.height, MAX_IMAGE_SOURCE_DIM);
  assert.equal(fit.scaled, true);
}

{
  const fit = fitImageToMaxSide(1280, 720);
  assert.equal(fit.width, 1280);
  assert.equal(fit.height, 720);
  assert.equal(fit.scaled, false);
}

{
  const fit = fitImageToMaxSide(4000, 3000, 1200);
  assert.equal(fit.width, 1200);
  assert.equal(fit.height, 900);
  assert.equal(fit.scale, 0.3);
}

console.log("ok: image upload work size is capped");
