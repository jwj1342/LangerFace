import assert from "node:assert/strict";
import { incisionOverlayScreenStyle } from "../web/src/services/incisionOverlayStyle.ts";

// A shrinking photograph must not leave a large fixed marker covering a tiny lesion.
const scales = [0.5, 1, 1.5, 3, 5];
const styles = scales.map(viewScale => incisionOverlayScreenStyle("fusiform", { compact: true, viewScale }));
assert.ok(styles.every(style => style.boundary.lineWidth === 1.4 && style.candidate.lineWidth === 0.8),
  "phone strokes double the accepted baseline and stay constant across photo zoom");
assert.ok(styles.every(style => style.incisionCenter.radiusCss <= 3), "phone center diameter never exceeds 6 CSS pixels");
for (let index = 1; index < styles.length; index++) {
  assert.ok(styles[index].center.radiusCss > styles[index - 1].center.radiusCss,
    "lesion marker shrinks with the photograph instead of covering more of it");
  assert.ok(styles[index].incisionCenter.radiusCss > styles[index - 1].incisionCenter.radiusCss,
    "incision marker shrinks with the photograph");
}
assert.equal(incisionOverlayScreenStyle("fusiform").incisionCenter.radiusCss, 6,
  "desktop marker appearance is preserved");
console.log("PASS phone overlay: five zoom levels, thin strokes, proportional small centers; desktop preserved");
