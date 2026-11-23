import assert from "node:assert/strict";
import { incisionOverlayScreenStyle } from "../web/src/services/incisionOverlayStyle.ts";

// Layout does not choose annotation tokens. Photos with dimensions retain
// proportional centers; camera/no-photo fallbacks use the same default on both devices.
const scales = [0.5, 1, 1.5, 3, 5];
const styles = scales.map(viewScale => incisionOverlayScreenStyle("fusiform", { compact: true, viewScale }));
assert.ok(styles.every(style => style.boundary.lineWidth === 0.95 && style.candidate.lineWidth === 0.95),
  "boundary and candidate strokes stay constant across zoom");
for (let index = 0; index < styles.length; index++) {
  assert.deepEqual(styles[index], incisionOverlayScreenStyle("fusiform", { compact: false, viewScale: scales[index] }),
    "camera and fallback paint are independent of phone/desktop layout");
  const options = { viewScale: scales[index], photoWidthCss: 650 * scales[index], lesionExtentCss: 12 * scales[index] };
  const photo = incisionOverlayScreenStyle("fusiform", { ...options, compact: true });
  assert.deepEqual(photo, incisionOverlayScreenStyle("fusiform", { ...options, compact: false }));
  assert.ok(photo.incisionCenter.radiusCss < options.lesionExtentCss / 4,
    "shrinking photos retain the small-lesion center visibility limit");
}
assert.equal(incisionOverlayScreenStyle("fusiform").incisionCenter.radiusCss, 6,
  "desktop marker appearance is preserved");
console.log("PASS shared device paint: five zoom levels, fixed strokes, photo center limits, shared live defaults");
