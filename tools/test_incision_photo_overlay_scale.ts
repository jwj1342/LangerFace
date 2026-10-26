import assert from "node:assert/strict";
import { incisionOverlayScreenStyle } from "../web/src/services/incisionOverlayStyle.ts";

// The workflow SVG uses screen coordinates: style sizes must track the same
// photo scale as its paths, without a screen-pixel floor or zoom ceiling.
for (const compact of [false, true]) {
  for (const diameter of [1, 8, 40]) {
    const base = incisionOverlayScreenStyle("fusiform", {
      compact, viewScale: 1, photoWidthCss: 650, lesionExtentCss: diameter,
    });
    for (const zoom of [0.1, 0.5, 1, 2, 5, 10]) {
      const style = incisionOverlayScreenStyle("fusiform", {
        compact, viewScale: zoom, photoWidthCss: 650 * zoom, lesionExtentCss: diameter * zoom,
      });
      for (const key of ["candidate", "boundary"] as const) {
        assert.ok(Math.abs(style[key].lineWidth - base[key].lineWidth * zoom) < 1e-9,
          `${key} width must follow the photograph at zoom ${zoom}, compact=${compact}`);
        assert.ok(Math.abs(style[key].haloWidth - base[key].haloWidth * zoom) < 1e-9);
      }
      for (const key of ["center", "incisionCenter"] as const) {
        assert.ok(Math.abs(style[key].radiusCss - base[key].radiusCss * zoom) < 1e-9);
        assert.ok(style[key].radiusCss + style[key].strokeWidthCss / 2 < diameter * zoom / 4,
          "the center marker must leave most of a small lesion visible");
      }
      assert.ok(style.boundary.haloWidth <= diameter * zoom * 0.12 + 1e-9,
        "the boundary and its halo must not swallow a small lesion");
    }
  }
}
const phone = incisionOverlayScreenStyle("fusiform", { compact: true, photoWidthCss: 390, lesionExtentCss: 12 });
const desktop = incisionOverlayScreenStyle("fusiform", { photoWidthCss: 390, lesionExtentCss: 12 });
for (const key of ["candidate", "boundary"] as const) {
  assert.equal(phone[key].lineWidth, desktop[key].lineWidth);
  assert.equal(phone[key].haloWidth, desktop[key].haloWidth);
}
assert.equal(phone.incisionCenter.radiusCss, desktop.incisionCenter.radiusCss,
  "the same displayed photo must not change marker size with the pointer media query");
assert.equal(phone.candidate.haloColor, incisionOverlayScreenStyle("fusiform", { compact: true }).candidate.haloColor,
  "phone colors remain unchanged");
assert.equal(incisionOverlayScreenStyle().incisionCenter.radiusCss, 6,
  "live camera defaults remain unchanged");
console.log("PASS photo overlay: proportional strokes/halos/centers, tiny-lesion limits, pointer parity; live defaults retained");
