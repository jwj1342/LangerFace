import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(new URL("../web/src/services/incisionPhotoRuntime.ts", import.meta.url), "utf8");
const liveState = readFileSync(new URL("../web/src/services/liveState.ts", import.meta.url), "utf8");
const liveFit = readFileSync(new URL("../web/src/services/liveCanvasFit.ts", import.meta.url), "utf8");
assert.match(liveState, /export const DESKTOP_IMAGE_MAX_ZOOM = 10;/, "desktop image zoom cap is 10x");
assert.match(liveState, /export const MOBILE_IMAGE_MAX_ZOOM = 12;/, "mobile image zoom cap is 12x");
assert.match(runtime, /export const DESKTOP_PHOTO_MAX_ZOOM = DESKTOP_IMAGE_MAX_ZOOM;/, "photo runtime shares desktop cap");
assert.match(runtime, /export const MOBILE_PHOTO_MAX_ZOOM = MOBILE_IMAGE_MAX_ZOOM;/, "photo runtime shares mobile cap");
assert.match(runtime, /const photoMaxZoom = \(\): number => photoMaxZoomForViewport\(imageViewportIsMobile\(\)\);/,
  "both platforms use the shared capped zoom path");
assert.match(liveState, /window\.innerWidth > 560[\s\S]*?navigator\.maxTouchPoints[\s\S]*?"ontouchstart" in window/,
  "touch-first narrow browsers receive the mobile cap even without pointer/hover media matches");
assert.match(liveFit, /view\.maxZoom = imageMaxZoomForViewport\(imageViewportIsMobile\(\)\);/,
  "main workflow recomputes the cap when the canvas is fitted");
console.log("test_incision_photo_zoom: desktop 10x and mobile 12x caps passed");
