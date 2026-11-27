import assert from "node:assert/strict";
import { incisionOverlayScreenStyle } from "../web/src/services/incisionOverlayStyle.ts";

// Only the two center markers become smaller on compact screens.
const scales = [0.5, 1, 1.5, 3, 5];
const styles = scales.map(viewScale => incisionOverlayScreenStyle("fusiform", { compact: true, viewScale }));
assert.ok(styles.every(style => style.boundary.lineWidth === 0.95 && style.candidate.lineWidth === 0.95),
  "boundary and candidate strokes stay constant across zoom");
for (let index = 0; index < styles.length; index++) {
  const options = { viewScale: scales[index], photoWidthCss: 650 * scales[index], lesionExtentCss: 12 * scales[index] };
  const photo = incisionOverlayScreenStyle("fusiform", { ...options, compact: true });
  assert.equal(styles[index].incisionCenter.color, "transparent");
  assert.ok(styles[index].incisionCenter.radiusCss <= 1.55);
  assert.ok(styles[index].center.radiusCss <= 1.1);
  assert.ok(photo.incisionCenter.radiusCss < options.lesionExtentCss / 4,
    "shrinking photos retain the small-lesion center visibility limit");
}
assert.equal(incisionOverlayScreenStyle("fusiform").incisionCenter.radiusCss, 6,
  "desktop marker appearance is preserved");
console.log("PASS compact hollow centers with fixed overlay strokes");
