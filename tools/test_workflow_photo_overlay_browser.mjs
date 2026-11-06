import assert from "node:assert/strict";
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { captureMarkerIdentity, assertMarkerIdentity } from "./marker_runtime_identity.mts";

// Synthetic frame dimensions drive the actual mounted controller's repaint.
// This tests photo paint, not detection, RSTL refinement or medical accuracy.
const base = process.argv[2] || "http://127.0.0.1:5199";
const expected = captureMarkerIdentity("small-lesion-boundary-candidate");
const response = await fetch(new URL("/__runtime-identity.json", base), { signal: AbortSignal.timeout(20000) });
assert.equal(response.status, 200);
assertMarkerIdentity(await response.json(), expected);
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const mobile of [false, true]) {
    for (const dpr of [1, 2]) {
      const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
        isMobile: mobile, hasTouch: mobile, deviceScaleFactor: dpr,
      });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(new URL("/app/workflow?developer=1", base).href);
        await page.waitForSelector("#workflowIncisionOverlay", { state: "attached" });
        await page.waitForFunction(() => document.querySelector("#fileInput")
          && !document.querySelector("#fileInput").disabled);
        await page.waitForFunction(async () => {
          const { sourceState } = await import("/src/services/liveState.ts");
          return Boolean(sourceState.planning2d);
        });
        const rows = await page.evaluate(async () => {
          const { sourceState, renderState } = await import("/src/services/liveState.ts");
          const { createPhotoPlanningTransform } = await import("/src/services/photoPlanningController.ts");
          const deadline = performance.now() + 10000;
          while (!sourceState.planning2d && performance.now() < deadline) {
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          const planning = sourceState.planning2d;
          if (!planning) throw new Error("Photo controller initialization timed out");
          const originalGetFrameState = planning.getFrameState;
          const originalCrop = renderState.focusCrop;
          const frame = originalGetFrameState();
          const landmarks = Array.from({ length: 468 }, (_, i) => [100 + (i % 26) * 40, 100 + Math.floor(i / 26) * 40, 0]);
          const rows = [];
          try {
            for (const fixedSize of [false, true]) for (const crop of [false, true]) {
              for (const mirror of [false, true]) {
                for (const zoom of [0.1, 0.5, 1, 2, 5]) {
                  const transform = createPhotoPlanningTransform(1300, 1000, {
                    viewportWidth: fixedSize ? 650 : innerWidth, viewportHeight: fixedSize ? 500 : innerHeight, zoom, mirror,
                  });
                  renderState.focusCrop = crop ? { sx: 200, sy: 100, sw: 650, sh: 500 } : null;
                  planning.getFrameState = () => ({ ...frame, revision: 10000 + rows.length,
                    kind: "image", width: 1300, height: 1000, landmarks, surfaceLandmarks: landmarks, transform });
                  window.dispatchEvent(new Event("langerface:image-view-changed"));
                  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                  const svg = document.querySelector("#workflowIncisionOverlay");
                  const width = key => parseFloat(getComputedStyle(svg.querySelector(`[data-workflow-${key}]`)).strokeWidth);
                  const paint = ["boundary", "boundary-halo", "candidate", "candidate-halo", "diagnostic-candidate", "rejected-marker", "center"]
                    .map(key => { const element=svg.querySelector(`[data-workflow-${key}]`), style=getComputedStyle(element);
                      return {key,stroke:style.stroke,width:style.strokeWidth,fill:style.fill,opacity:style.opacity,radius:element.getAttribute("r")}; });
                  rows.push({ fixedSize, crop, mirror, zoom, displayWidth: transform.displayWidth, paint,
                    boundary: width("boundary"), halo: width("boundary-halo"), candidate: width("candidate"),
                    diagnostic: width("diagnostic-candidate"), rejected: width("rejected-marker") });
                }
              }
            }
          } finally {
            planning.getFrameState = originalGetFrameState;
            renderState.focusCrop = originalCrop;
            window.dispatchEvent(new Event("langerface:image-view-changed"));
          }
          return rows;
        });
        for (const row of rows) {
          for (const [field, expectedWidth] of Object.entries({ boundary: 0.95, halo: 1.45,
            candidate: 0.95, diagnostic: 0.95, rejected: 0.95 })) {
            assert.ok(Math.abs(row[field] - expectedWidth) < 1e-4, `${field}: ${JSON.stringify(row)}`);
          }
        }
        assert.deepEqual(errors, []);
        results.push({ mobileSimulation: mobile, dpr, cases: rows.length, status: "PASS", rows });
      } finally { await context.close(); }
    }
  }
  const baseline = results[0].rows.filter(row => row.fixedSize).map(row => row.paint);
  for (const result of results.slice(1)) {
    assert.deepEqual(result.rows.filter(row => row.fixedSize).map(row => row.paint), baseline,
      "same projected photo size must produce identical complete SVG paint across layout and DPR");
  }
  console.log(JSON.stringify({ status: "PASS", identity: expected, results }, null, 2));
} finally { await browser.close(); }
