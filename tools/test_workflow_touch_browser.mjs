import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { captureMarkerIdentity, assertMarkerIdentity, markerRepoRoot } from "./marker_runtime_identity.mts";

const base = process.argv[2] || "http://127.0.0.1:5181";
const output = process.argv[3];
const expected = captureMarkerIdentity("small-lesion-boundary-candidate");
const fixture = readFileSync(resolve(markerRepoRoot, "web/compat/personalized/v6_demo/id_003/rstl_before_after.jpg")).toString("base64");
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const mode of ["native-touch", "coarse-hover-touch", "fine-touch"]) {
    const context = await browser.newContext({
      viewport: { width: 360, height: 596 }, deviceScaleFactor: 3,
      hasTouch: mode !== "fine-touch", isMobile: true,
    });
    const result = { mode, checks: {} };
    try {
      // Replay the observed capabilities, not a claim to emulate the phone OS.
      await context.addInitScript(mode => {
        Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 });
        const native = window.matchMedia.bind(window);
        if (mode === "coarse-hover-touch") {
          window.matchMedia = query => {
            const forced = {
              "(pointer: coarse)": true, "(pointer: fine)": false,
              "(hover: none)": false, "(hover: hover)": true,
              "(any-pointer: coarse)": true, "(any-pointer: fine)": true,
              "(any-hover: hover)": true,
              "(max-width: 560px) and (pointer: coarse) and (hover: none)": false,
            };
            const media = native(query);
            return query in forced ? new Proxy(media, { get(target, key) {
              if (key === "matches") return forced[query];
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            } }) : media;
          };
        }
      }, mode);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(new URL("/app/workflow?developer=1", base).href);
      assertMarkerIdentity(await (await page.request.get(new URL("/__runtime-identity.json", base).href)).json(), expected);
      await page.waitForFunction(() => document.querySelector("#modelBadge")?.textContent.includes("就绪"), { timeout: 45000 });
      await page.evaluate(async base64 => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: "image/jpeg" }));
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(bitmap.width / 2);
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.94));
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], "touch-regression.jpg", { type: "image/jpeg" }));
        const input = document.querySelector("#fileInput");
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, fixture);
      await page.waitForFunction(() => {
        const button = document.querySelector(".workflow-marker-toggle");
        return button && !button.disabled && button.getAttribute("aria-disabled") !== "true";
      }, { timeout: 45000 });
      const read = () => page.evaluate(async () => {
        const { renderState } = await import("/src/services/liveState.ts");
        const tools = document.querySelector(".workflow-canvas-tools");
        return {
          zoom: renderState.imageView.zoom,
          busy: document.querySelector(".workflow-workbench").dataset.workflowMarkerBusy,
          rows: getComputedStyle(tools).gridTemplateRows,
          display: getComputedStyle(tools).display,
          confirmDisplay: getComputedStyle(document.querySelector(".workflow-mobile-marker-confirm")).display,
          mobile: document.querySelector(".workflow-workbench").dataset.workflowMobile,
        };
      });
      await page.locator(".workflow-marker-toggle").click();
      result.before = await read();
      const box = await page.locator("#canvas").boundingBox();
      assert.ok(box && box.height > 0, "visible canvas");
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const cdp = await context.newCDPSession(page);
      const point = (dx, id) => ({ x: x + dx, y, id, radiusX: 1, radiusY: 1, force: 1 });
      try {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(-25, 1)] });
        result.firstDown = await read();
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(-25, 1), point(25, 2)] });
        for (const spread of [30, 36, 42, 50]) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(-spread, 1), point(spread, 2)] });
        }
        result.spread = await read();
        for (const spread of [42, 36, 30, 25]) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(-spread, 1), point(spread, 2)] });
        }
        result.contract = await read();
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } finally { await cdp.detach(); }
      Object.assign(result.checks, {
        twoRowToolbar: result.before.display === "grid" && result.before.rows.startsWith("40px 32px"),
        firstTouchDoesNotRecognize: result.firstDown.busy !== "true",
        pinchZoomsIn: result.spread.zoom > result.before.zoom + 0.05,
        pinchZoomsOut: result.contract.zoom < result.spread.zoom - 0.05,
        explicitConfirmationVisible: result.before.confirmDisplay !== "none",
      });
      result.scroll = await page.evaluate(() => {
        const pane = document.querySelector(".workflow-mobile-operation-pane");
        const stage = document.querySelector(".workflow-workbench > .stage");
        const top = stage.getBoundingClientRect().top;
        pane.scrollTop = pane.scrollHeight;
        const bottom = pane.scrollTop;
        const unchanged = stage.getBoundingClientRect().top === top;
        pane.scrollTop = 0;
        return { bottom, returnsToTop: pane.scrollTop === 0, stageUnchanged: unchanged,
          horizontalOverflow: pane.scrollWidth - pane.clientWidth };
      });
      result.checks.independentScroll = result.scroll.bottom > 0 && result.scroll.returnsToTop
        && result.scroll.stageUnchanged && result.scroll.horizontalOverflow <= 1;
      await page.locator("#reviewerName").fill("lifecycle-regression");
      result.bindingBaseline = await page.evaluate(async () => {
        const { els } = await import("/src/services/liveDom.ts");
        const { sourceState, renderState } = await import("/src/services/liveState.ts");
        const visibility = await import("/src/services/mobileWorkflowVisibility.ts");
        visibility.setMobileRstlLayerVisible(false);
        visibility.setMobileWrinkleLayerVisible(false);
        const input = document.querySelector("#reviewerName");
        input.focus({ preventScroll: true });
        input.setSelectionRange(2, 7);
        window.__workflowBindingBaseline = {
          els: { ...els }, photo: sourceState.imageFile, planning: sourceState.planning2d,
          revision: sourceState.planning2d.getFrameState().revision,
          refine: JSON.stringify(renderState.refine2d), input,
          visibility: JSON.stringify(visibility.workflowLayerVisibilitySnapshot()),
        };
        return {
          disconnected: Object.entries(els).filter(([, node]) => node
            && !(Array.isArray(node) ? node.every(item => item.isConnected) : node.isConnected)).map(([key]) => key),
          focus: document.activeElement?.id, inputRects: input.getClientRects().length,
          inputDisabled: input.disabled,
        };
      });
      const samples = [];
      for (const width of [561, 360, 900, 360]) {
        await page.setViewportSize({ width, height: 596 });
        await page.waitForFunction(mobile => document.querySelector(".workflow-workbench")?.dataset.workflowMobile === String(mobile), width <= 560);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const sample = await page.evaluate(async () => {
          const { els } = await import("/src/services/liveDom.ts");
          const { sourceState, renderState } = await import("/src/services/liveState.ts");
          const visibility = await import("/src/services/mobileWorkflowVisibility.ts");
          const before = window.__workflowBindingBaseline;
          const root = document.querySelector(".workflow-workbench");
          const retainedBinding = (key, node) => !node || (els[key] === node
            && (Array.isArray(node) ? node.every(item => item.isConnected) : node.isConnected));
          return {
            width: innerWidth,
            retainedBindings: Object.entries(before.els).every(([key, node]) => retainedBinding(key, node)),
            canvasIsVisibleCanvas: els.canvas === document.querySelector("#canvas"),
            retainedPhoto: sourceState.imageFile === before.photo && sourceState.planning2d === before.planning
              && sourceState.planning2d.getFrameState().revision === before.revision,
            retainedRefineState: JSON.stringify(renderState.refine2d) === before.refine,
            retainedVisibility: JSON.stringify(visibility.workflowLayerVisibilitySnapshot()) === before.visibility,
            retainedInput: before.input === document.querySelector("#reviewerName")
              && before.input.value === "lifecycle-regression" && before.input.selectionStart === 2 && before.input.selectionEnd === 7,
            retainedFocus: document.activeElement === before.input,
            orderedRails: innerWidth <= 560
              ? root.querySelector(".workflow-mobile-operation-pane").contains(document.querySelector(".workflow-incision-rail"))
              : root.firstElementChild.matches(".workflow-live-rail") && root.lastElementChild.matches(".workflow-incision-rail"),
            brokenBindings: Object.entries(before.els).filter(([key, node]) => !retainedBinding(key, node)).map(([key]) => key),
            activeElement: document.activeElement?.id,
          };
        });
        samples.push(sample);
      }
      result.lifecycle = samples;
      result.checks.lifecycle = samples.every(sample => Object.entries(sample).every(([key, value]) => ["width", "brokenBindings", "activeElement"].includes(key) || value === true));
      result.checks.noBrowserErrors = errors.length === 0;
      result.errors = errors;
      assert.ok(Object.values(result.checks).every(Boolean), JSON.stringify(result.checks));
      result.status = "PASS";
    } catch (error) {
      result.status = "FAIL";
      result.error = String(error.stack || error);
    } finally {
      results.push(result);
      console.log(JSON.stringify({ mode, status: result.status, checks: result.checks, error: result.error?.slice(0, 500) }));
      await context.close();
    }
  }
} finally {
  await browser.close();
  const report = {
    identity: expected, results,
    limits: ["Capability replay is not a phone OS emulator or actual-phone acceptance.",
      "Refinement retention compares existing state; this is not full RSTL effect equivalence.",
      "Toolbar asserts the two original explicit rows; the pre-existing implicit filename row is recorded, not redesigned.",
      "Algorithm recognition quality and camera capture are outside this UI regression."],
  };
  if (output) writeFileSync(output, JSON.stringify(report, null, 2));
}
process.exitCode = results.every(result => result.status === "PASS") ? 0 : 1;
