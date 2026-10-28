import assert from "node:assert/strict";
import { incisionOverlayScreenStyle } from "../web/src/services/incisionOverlayStyle.ts";

// The workflow SVG uses screen coordinates: the yellow boundary stays fixed
// in screen pixels while centers and the cyan incision follow photo scaling.
for (const compact of [false, true]) {
  for (const diameter of [1, 8, 40]) {
    const base = incisionOverlayScreenStyle("fusiform", {
      compact, viewScale: 1, photoWidthCss: 650, lesionExtentCss: diameter,
    });
    for (const zoom of [0.1, 0.5, 1, 2, 5, 10]) {
      const style = incisionOverlayScreenStyle("fusiform", {
        compact, viewScale: zoom, photoWidthCss: 650 * zoom, lesionExtentCss: diameter * zoom,
      });
      assert.ok(Math.abs(style.candidate.lineWidth - base.candidate.lineWidth * zoom) < 1e-9,
        `candidate width must follow the photograph at zoom ${zoom}, compact=${compact}`);
      assert.ok(Math.abs(style.candidate.haloWidth - base.candidate.haloWidth * zoom) < 1e-9);
      assert.equal(style.boundary.lineWidth, base.boundary.lineWidth,
        `boundary width stays fixed at zoom ${zoom}, compact=${compact}`);
      assert.equal(style.boundary.haloWidth, base.boundary.haloWidth);
      for (const key of ["center", "incisionCenter"] as const) {
        assert.ok(Math.abs(style[key].radiusCss - base[key].radiusCss * zoom) < 1e-9);
        assert.ok(style[key].radiusCss + style[key].strokeWidthCss / 2 < diameter * zoom / 4,
          "the center marker must leave most of a small lesion visible");
      }
      assert.ok(style.boundary.haloWidth <= 2,
        "the boundary and its halo stay thin in screen space");
    }
  }
}
const phone = incisionOverlayScreenStyle("fusiform", { compact: true, photoWidthCss: 390, lesionExtentCss: 12 });
const desktop = incisionOverlayScreenStyle("fusiform", { photoWidthCss: 390, lesionExtentCss: 12 });
assert.equal(phone.boundary.lineWidth, 0.95);
assert.equal(desktop.boundary.lineWidth, 1.33);
assert.equal(phone.boundary.haloWidth, 1.45);
assert.equal(desktop.boundary.haloWidth, 1.83);
assert.equal(phone.candidate.lineWidth, desktop.candidate.lineWidth);
assert.equal(phone.candidate.haloWidth, desktop.candidate.haloWidth);
assert.equal(phone.incisionCenter.radiusCss, desktop.incisionCenter.radiusCss,
  "the same displayed photo must not change marker size with the pointer media query");
assert.equal(phone.candidate.haloColor, incisionOverlayScreenStyle("fusiform", { compact: true }).candidate.haloColor,
  "phone colors remain unchanged");
assert.equal(incisionOverlayScreenStyle().incisionCenter.radiusCss, 6,
  "live camera defaults remain unchanged");
console.log("PASS photo overlay: proportional strokes/halos/centers, tiny-lesion limits, pointer parity; live defaults retained");
