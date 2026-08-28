import fs from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const assetDirectory = process.env.MOBILE_UI_TEST_ASSET_DIR || "";
const evidenceDirectory = process.env.MOBILE_UI_EVIDENCE_DIR || "";
const assets = assetDirectory && fs.existsSync(assetDirectory)
  ? fs.readdirSync(assetDirectory)
    .filter((name) => /^\d{2}\.png$/i.test(name))
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((name) => path.join(assetDirectory, name))
  : [];

test.skip(!assetDirectory || !evidenceDirectory || assets.length === 0,
  "set MOBILE_UI_TEST_ASSET_DIR and MOBILE_UI_EVIDENCE_DIR to run the local review suite");

test.describe.configure({ mode: "serial" });
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});

async function expectInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const result = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(result.left).toBeGreaterThanOrEqual(0);
  expect(result.right).toBeLessThanOrEqual(result.viewportWidth + 1);
}

async function uploadPhoto(page: Page, assetPath: string) {
  await page.locator("#fileInput").setInputFiles(assetPath);
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
  await expect(page.locator("#workflowStageStatus")).not.toContainText(/失败|错误|无法/, { timeout: 45_000 });
  await expect(page.locator("#canvas")).toBeVisible();
}

test("phone review fixes stay visible, independent, and desktop-isolated", async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(evidenceDirectory, { recursive: true });

  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
  expect(await page.evaluate(() => window.matchMedia(
    "(max-width: 560px) and (pointer: coarse) and (hover: none)",
  ).matches)).toBe(true);

  const qualityPanel = page.locator(".mobile-canvas-quality");
  await expect(page.locator("#qualityVal")).toHaveCount(1);
  await expect(qualityPanel).toHaveCount(1);
  await expect(qualityPanel).toContainText("跟踪质量参考");
  await expect(qualityPanel).toContainText("受分辨率与光线影响");
  await expect(page.locator(".main-wrap > .mobile-canvas-quality")).toHaveCount(1);
  await expect(page.locator("#qualityBar")).toHaveCount(1);

  const layerGrid = page.locator(".mobile-layer-grid");
  const rstl = layerGrid.getByRole("button", { name: "RSTL", exact: true });
  const wrinkles = layerGrid.getByRole("button", { name: "皱纹", exact: true });
  const incision = layerGrid.getByRole("button", { name: "切口线", exact: true });
  for (const toggle of [rstl, wrinkles, incision]) {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  }
  await expect(layerGrid).toContainText("可全部隐藏，结果仍会保留");
  for (const toggle of [rstl, wrinkles, incision]) await toggle.click();

  for (const [index, assetPath] of assets.entries()) {
    await uploadPhoto(page, assetPath);
    await expect(page.locator("#qualityVal")).toContainText(/\d+%/);
    await page.screenshot({
      path: path.join(evidenceDirectory, `自动化-素材-${String(index + 1).padStart(2, "0")}.png`),
      fullPage: false,
    });
  }

  const markerToggle = page.getByRole("button", { name: "受控标记", exact: true });
  await expect(markerToggle).toBeEnabled();
  await markerToggle.click();
  const canvas = page.locator("#canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("workflow canvas has no mobile layout box");
  await canvas.tap({ position: { x: canvasBox.width * 0.5, y: canvasBox.height * 0.45 } });

  const confirm = page.getByRole("button", { name: "识别已放置圆圈内的肿物" });
  const scanControl = page.locator(".workflow-marker-scan");
  for (const width of [360, 390, 412, 560]) {
    await page.setViewportSize({ width, height: 844 });
    await expectInsideViewport(page, markerToggle);
    await expectInsideViewport(page, confirm);
    await expectInsideViewport(page, scanControl);
    await expect(page.locator("[data-workflow-marker-scan-label]")).toBeHidden();
    await page.screenshot({
      path: path.join(evidenceDirectory, `自动化-工具栏-${width}px.png`),
      fullPage: false,
    });
  }

  await markerToggle.click();
  await page.setViewportSize({ width: 390, height: 844 });
  const refreshedCanvasBox = await canvas.boundingBox();
  if (!refreshedCanvasBox) throw new Error("workflow canvas disappeared after marker exit");
  await canvas.tap({ position: { x: refreshedCanvasBox.width * 0.5, y: refreshedCanvasBox.height * 0.42 } });
  await expect.poll(async () => {
    const valid = await page.locator("[data-workflow-candidate]").getAttribute("d");
    const diagnostic = await page.locator("[data-workflow-diagnostic-candidate]").getAttribute("d");
    return Boolean(valid || diagnostic);
  }, { timeout: 45_000 }).toBe(true);

  const mobileStrokeMetrics = await page.evaluate(() => {
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
    const center = document.querySelector<SVGCircleElement>("[data-workflow-center]");
    return {
      boundary: style("[data-workflow-boundary]").strokeWidth,
      candidate: style("[data-workflow-candidate]").strokeWidth,
      diagnostic: style("[data-workflow-diagnostic-candidate]").strokeWidth,
      centerRadius: center?.getAttribute("r"),
      centerStroke: center ? getComputedStyle(center).strokeWidth : "",
    };
  });
  expect(mobileStrokeMetrics).toEqual({
    boundary: "0.85px",
    candidate: "0.8px",
    diagnostic: "0.9px",
    centerRadius: "4",
    centerStroke: "0.8px",
  });

  expect(await page.locator(".workflow-incision-rail").evaluate((rail) => {
    const mainParameters = rail.querySelector("#tumorKind")?.closest(".card");
    const adjustment = rail.querySelector(".mobile-candidate-adjust");
    const candidateResult = rail.querySelector("#candidateType")?.closest(".card");
    if (!mainParameters || !adjustment || !candidateResult) return false;
    return Boolean(mainParameters.compareDocumentPosition(adjustment) & Node.DOCUMENT_POSITION_FOLLOWING)
      && Boolean(adjustment.compareDocumentPosition(candidateResult) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);

  await page.setViewportSize({ width: 1440, height: 960 });
  expect(await page.evaluate(() => window.matchMedia(
    "(max-width: 560px) and (pointer: coarse) and (hover: none)",
  ).matches)).toBe(false);
  await expect(page.locator(".mobile-workflow-dock")).toBeHidden();
  await expect(page.locator(".mobile-candidate-adjust")).toBeHidden();
  await expect(page.locator(".mobile-canvas-quality")).toHaveCount(0);
  await expect(page.locator(".workflow-live-rail #qualityVal")).toHaveCount(1);
  await expect(page.locator(".workflow-live-rail .live-quality-panel")).toContainText("追踪质量");
  await expect(page.locator("#qualityVal")).toContainText(/\d+%/);
});
