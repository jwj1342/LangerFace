// Dependency-free tests for the TypeScript Slicer curve importer.
// Run: node tools/test_slicer_curve.mjs
import { __slicerCurveForTests } from "../web/src/services/slicerCurve.ts";

const { parseSlicerMarkups, smoothAndResample } = __slicerCurveForTests;

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  passed++;
}
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(threw, msg + " (expected throw)");
}
const finite = (pts) => pts.every((p) => p.every(Number.isFinite));

// --- parseSlicerMarkups ---
const m = parseSlicerMarkups(JSON.stringify({
  markups: [
    { type: "Curve", name: "lip", controlPoints: [{ position: [0, 0, 0] }, { position: [1, 0, 0] }, { position: [2, 0, 0] }] },
    { type: "Fiducial", controlPoints: [{ position: [0, 0, 0] }, { position: [1, 0, 0] }] },
    { type: "Curve", controlPoints: [{ position: [0, 0, 0] }] },
  ],
}));
ok(m.length === 1, "parseSlicerMarkups keeps only curves with >=2 control points");
ok(m[0].name === "lip" && m[0].controlPoints.length === 3, "parseSlicerMarkups reads name + control points");

// name coercion: a non-string name must not leak [object Object] into the clinical export
const mBad = parseSlicerMarkups(JSON.stringify({
  markups: [{ type: "Curve", name: { evil: 1 }, controlPoints: [{ position: [0, 0, 0] }, { position: [1, 0, 0] }] }],
}));
ok(typeof mBad[0].name === "string" && mBad[0].name.startsWith("slicer_curve_"), "non-string markup name coerced to safe default");

// --- smoothAndResample ---
const r = smoothAndResample([[0, 0, 0], [1, 0, 0], [2, 0.2, 0], [3, 0, 0]], { spacing: 0.5 });
ok(r.length > 2 && finite(r), "smoothAndResample produces a dense, finite resampled path");
const r2 = smoothAndResample([[0, 0, 0], [1, 0, 0]], { spacing: 0.25 });
ok(r2.length >= 2 && finite(r2), "smoothAndResample handles the 2-point path");
ok(smoothAndResample([[0, 0, 0]], { spacing: 1 }).length === 0, "fewer than 2 control points returns []");

// --- hardening: far-apart control points + tiny spacing must THROW (catchable), not freeze the tab ---
// >=3 points so makeDenseCatmullRom runs (the <=2 path early-returns and never densifies).
throws(() => smoothAndResample([[0, 0, 0], [1e7, 0, 0], [1e7, 1, 0]], { spacing: 0.05 }), "unbounded densification capped (MAX_OUTPUT_POINTS)");

console.log(`test_slicer_curve: ${passed} assertions passed`);
