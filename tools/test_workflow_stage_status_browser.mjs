import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { captureMarkerIdentity, assertMarkerIdentity } from "./marker_runtime_identity.mts";

const base = process.argv[2] || "http://127.0.0.1:5173";
const output = process.argv[3] ? resolve(process.argv[3]) : null;
const identityResponse = await fetch(new URL("/__runtime-identity.json", base), { signal: AbortSignal.timeout(20000) });
assert.equal(identityResponse.ok, true, `runtime identity HTTP ${identityResponse.status}`);
const identity = await identityResponse.json();
assertMarkerIdentity(identity, captureMarkerIdentity("small-lesion-boundary-candidate"));
if (output) mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const cases = [
  { name: "normal", text: "STATUS_READY", tone: "normal", busy: false, details: [] },
  { name: "warning-no-detail", text: "STATUS_BLOCKED", tone: "warning", busy: false, details: [] },
  { name: "warning-detail", text: "STATUS_BLOCKED", tone: "warning", busy: false, details: ["DETAIL_REASON"] },
  { name: "duplicate-detail", text: "STATUS_BLOCKED", tone: "warning", busy: false, details: ["STATUS_BLOCKED", "DETAIL_REASON"] },
  { name: "busy", text: "STATUS_BUSY", tone: "normal", busy: true, details: ["STATUS_BUSY", "DETAIL_PROGRESS"] },
  { name: "long", text: "STATUS_LONG_".repeat(45), tone: "warning", busy: false, details: Array.from({ length: 12 }, (_, i) => `DETAIL_${i}_${"WRAP_".repeat(30)}`) },
];

async function inject(page, state) {
  // Use the controller's real store/React seam; no product gates are bypassed.
  await page.evaluate(async ({ text, tone, busy, details }) => {
    const { useIncisionStore } = await import("/src/stores/incisionStore.ts");
    useIncisionStore.setState((current) => ({
      snapshot: { ...current.snapshot, stageStatus: text, stageStatusTone: tone, stageBusy: busy, developerDetails: details },
    }));
  }, state);
  await page.waitForFunction((text) => document.querySelector(".workflow-stage-status-copy")?.textContent === text, state.text);
}

async function inspect(page) {
  return page.evaluate(() => {
    const status = document.querySelector("#workflowStageStatus");
    const copy = status?.querySelector(".workflow-stage-status-copy");
    const rect = status.getBoundingClientRect();
    const copyRect = copy?.getBoundingClientRect();
    const mobile = matchMedia("(max-width: 560px) and (pointer: coarse) and (hover: none)").matches;
    const upload = mobile
      ? [...document.querySelectorAll(".workflow-mobile-operation-pane button")].find((button) => button.textContent.trim() === "上传照片")
      : document.querySelector("#uploadBtn");
    const box = upload?.getBoundingClientRect();
    const hit = box && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      mobile, hidden: status.hidden, ariaHidden: status.getAttribute("aria-hidden"),
      visible: rect.width > 0 && rect.height > 0 && getComputedStyle(status).visibility !== "hidden",
      copyVisible: Boolean(copyRect?.width && copyRect?.height && rect.width && rect.height),
      scrollWidth: status.scrollWidth, clientWidth: status.clientWidth,
      scrollHeight: status.scrollHeight, clientHeight: status.clientHeight,
      copyOverflowWrap: copy ? getComputedStyle(copy).overflowWrap : null,
      copy: copy?.textContent, details: [...status.querySelectorAll(".workflow-developer-detail")].map((item) => item.textContent),
      spinner: Boolean(status.querySelector(".workflow-stage-spinner")),
      busy: status.getAttribute("aria-busy"), horizontalOverflow: status.scrollWidth > status.clientWidth + 1,
      boundedHeight: rect.height <= Math.min(320, innerHeight * 0.4) + 2,
      childOverflow: [...status.children].some((child) => {
        const childBox = child.getBoundingClientRect();
        return childBox.width > 0 && (childBox.left < rect.left - 1 || childBox.right > rect.right + 1);
      }),
      uploadHit: Boolean(upload && (hit === upload || upload.contains(hit))),
      uploadBox: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
    };
  });
}

try {
  for (const mobile of [false, true]) {
    for (const developer of [false, true]) {
      const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
        isMobile: mobile, hasTouch: mobile,
      });
      const result = { mobile, developer, states: [], errors: [] };
      try {
        const page = await context.newPage();
        page.on("pageerror", (error) => result.errors.push(error.message));
        await page.goto(new URL(`/app/workflow${developer ? "?developer=1" : ""}`, base).href);
        await page.locator("#fileInput").waitFor({ state: "attached" });
        await page.waitForFunction(() => !document.querySelector("#fileInput")?.disabled);
        await page.evaluate(async () => {
          window.__statusRegressionLiveStore = (await import("/src/stores/liveStore.ts")).useLiveStore;
        });
        const payload = await page.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 256;
          canvas.getContext("2d").fillRect(0, 0, 256, 256);
          return canvas.toDataURL("image/png").split(",")[1];
        });
        await page.locator("#fileInput").setInputFiles({
          name: "status-regression-synthetic.png", mimeType: "image/png", buffer: Buffer.from(payload, "base64"),
        });
        await page.waitForFunction(() => {
          const source = window.__statusRegressionLiveStore.getState().snapshot?.source;
          return source?.kind === "image" && source.fileName === "status-regression-synthetic.png";
        });
        await page.waitForFunction(() => document.querySelector("#modelBadge")?.textContent?.includes("就绪"));
        if (developer) await assert.doesNotReject(() => page.locator("#developerSourceFileName").waitFor({ state: "visible" }));
        else assert.equal(await page.locator("#developerSourceFileName").count(), 0, "ordinary filename stays private");
        result.uploadChecks = [];
        const expectedFeedback = developer && !mobile;
        for (let repetition = 0; repetition < (expectedFeedback ? 3 : 1); repetition += 1) {
          await page.locator("#fileInput").setInputFiles({
            name: "unsupported.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic unsupported input"),
          });
          await page.waitForFunction(() => document.querySelector("#overlayMsg")?.textContent?.includes("仅支持"));
          if (expectedFeedback) {
            await page.waitForFunction(() => document.querySelector("#workflowStageStatus")?.textContent?.includes("仅支持"));
          } else assert.equal((await inspect(page)).visible, false);
          assert.equal(await page.evaluate(() => window.__statusRegressionLiveStore.getState().snapshot?.source.fileName), "status-regression-synthetic.png");
          await page.waitForFunction(() => document.querySelector("#overlayMsg")?.classList.contains("hidden"));
          await page.waitForFunction(() => !document.querySelector("#workflowStageStatus")?.textContent?.includes("仅支持"));
          result.uploadChecks.push({ name: "unsupported-preserves-source-and-expires", repetition, status: "PASS" });
        }
        for (let repetition = 0; repetition < (expectedFeedback ? 3 : 1); repetition += 1) {
          await page.locator("#fileInput").setInputFiles({
            name: "corrupt.png", mimeType: "image/png", buffer: Buffer.from("synthetic invalid PNG"),
          });
          await page.waitForFunction(() => document.querySelector("#overlayMsg")?.textContent?.includes("无法读取"));
          if (expectedFeedback) {
            await page.waitForFunction(() => document.querySelector("#workflowStageStatus")?.textContent?.includes("无法读取"));
          } else assert.equal((await inspect(page)).visible, false);
          result.uploadChecks.push({ name: "corrupt-input-reason", repetition, status: "PASS" });
        }
        await page.locator("#fileInput").setInputFiles({
          name: "status-recovery-synthetic.png", mimeType: "image/png", buffer: Buffer.from(payload, "base64"),
        });
        await page.waitForFunction(() => {
          const source = window.__statusRegressionLiveStore.getState().snapshot?.source;
          return source?.kind === "image" && source.fileName === "status-recovery-synthetic.png";
        });
        await page.waitForFunction(() => !document.querySelector("#workflowStageStatus")?.textContent?.includes("无法读取"));
        result.uploadChecks.push({ name: "valid-upload-clears-old-error", status: "PASS" });
        let originalBox;
        for (const state of cases) {
          await inject(page, state);
          const actual = await inspect(page);
          result.states.push({ name: state.name, ...actual });
          const expectedVisible = developer && !mobile;
          assert.equal(actual.visible, expectedVisible, `${state.name}: explanatory visibility`);
          assert.equal(actual.hidden, !expectedVisible, `${state.name}: hidden attribute`);
          assert.equal(actual.ariaHidden, String(!expectedVisible), `${state.name}: accessibility visibility`);
          if (expectedVisible) {
            assert.equal(actual.copyVisible, true, `${state.name}: main reason is visible`);
            assert.equal(actual.copy, state.text);
            assert.deepEqual(actual.details, state.details.filter((detail) => detail !== state.text));
            assert.equal(actual.spinner, state.busy);
            assert.equal(actual.busy, String(state.busy));
            assert.equal(actual.horizontalOverflow || actual.childOverflow, false, `${state.name}: internal text fits`);
            assert.equal(actual.boundedHeight, true, `${state.name}: long feedback is bounded`);
            if (state.name === "long") {
              const reachable = await page.locator("#workflowStageStatus").evaluate((element) => {
                element.scrollTop = element.scrollHeight;
                const panel = element.getBoundingClientRect();
                const last = element.lastElementChild.getBoundingClientRect();
                const reached = element.scrollTop > 0 && last.bottom <= panel.bottom + 1 && last.bottom > panel.top;
                element.scrollTop = 0;
                return reached;
              });
              assert.equal(reachable, true, "long feedback can scroll to the final detail");
            }
          }
          assert.equal(actual.uploadHit, true, `${state.name}: upload control is not covered`);
          originalBox ||= actual.uploadBox;
          assert.deepEqual(actual.uploadBox, originalBox, `${state.name}: feedback does not shift upload`);
        }
        if (mobile && developer) {
          for (const width of [560, 561, 844, 390]) {
            await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
            await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
            const actual = await inspect(page);
            result.states.push({ name: `touch-width-${width}`, ...actual });
            assert.equal(actual.visible, false, "touch-only developer subtitles stay hidden across rotation and layout breakpoints");
          }
        }
        if (!mobile && developer) {
          await page.setViewportSize({ width: 1280, height: 480 });
          await inject(page, cases[0]);
          const beforeLong = await inspect(page);
          await inject(page, cases.at(-1));
          const actual = await inspect(page);
          result.states.push({ name: "short-desktop", ...actual });
          assert.equal(actual.horizontalOverflow || actual.childOverflow, false);
          assert.equal(actual.boundedHeight, true);
          assert.deepEqual(actual.uploadBox, beforeLong.uploadBox, "short desktop feedback does not shift upload");
          // The short fallback puts Upload below the fold in both states.
          await page.locator("#uploadBtn").scrollIntoViewIfNeeded();
          const afterScroll = await inspect(page);
          result.states.push({ name: "short-desktop-upload-scrolled", ...afterScroll });
          assert.equal(afterScroll.uploadHit, true, "short desktop upload remains reachable by scrolling");
          for (const width of [560, 561]) {
            await page.setViewportSize({ width, height: 844 });
            await inject(page, cases[0]);
            await page.locator("#workflowStageStatus").scrollIntoViewIfNeeded();
            const narrow = await inspect(page);
            result.states.push({ name: `mouse-width-${width}`, ...narrow });
            assert.equal(narrow.visible && narrow.copyVisible, true, "a narrow desktop retains developer feedback");
          }
        }
        if (output) await page.screenshot({ path: resolve(output, `status-${mobile ? "mobile" : "desktop"}-${developer ? "developer" : "ordinary"}.png`) });
        assert.deepEqual(result.errors, [], "no browser errors");
        result.status = "PASS";
      } catch (error) {
        result.status = "FAIL";
        result.error = error.stack;
      } finally {
        results.push(result);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
const report = { at: new Date().toISOString(), base, identity, results, passed: results.every((result) => result.status === "PASS") };
if (output) writeFileSync(resolve(output, "status-regression.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, modes: results.map(({ mobile, developer, states, uploadChecks, status, error }) => ({ mobile, developer, states: states.length, uploadChecks: uploadChecks?.length, status, error })) }, null, 2));
process.exitCode = report.passed ? 0 : 1;
