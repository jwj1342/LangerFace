import { expect, test } from "@playwright/test";

import { uploadGeneratedPhoto } from "./support/incisionPhoto";

const assetReadyTimeout = process.env.CI ? 60_000 : 30_000;

async function wheelToCap(page: import("@playwright/test").Page, selector: string, count = 80) {
  const surface = page.locator(selector);
  await expect(surface).toBeVisible();
  const box = await surface.boundingBox();
  if (!box) throw new Error(`${selector} has no layout box`);
  await surface.hover({ position: { x: box.width / 2, y: box.height / 2 } });
  for (let index = 0; index < count; index += 1) {
    await page.mouse.wheel(0, -160);
  }
  return surface;
}

test("incision photo zoom reaches the desktop and touch-mobile caps", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const viewport of [
    { width: 390, height: 844, expected: "12", hasTouch: true },
    { width: 1280, height: 800, expected: "10", hasTouch: false },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.hasTouch,
      isMobile: viewport.hasTouch,
    });
    const page = await context.newPage();
    await page.goto("/app/incision");
    await expect(page.locator("#assetLoading")).toHaveClass(/hidden/, {
      timeout: assetReadyTimeout,
    });
    await uploadGeneratedPhoto(page, "single");
    const photoCanvas = page.locator("#incisionPhotoCanvas");
    await expect(photoCanvas).toHaveAttribute("data-active", "true", { timeout: 45_000 });
    await wheelToCap(page, "#incisionPhotoCanvas");
    await expect.poll(() => photoCanvas.evaluate((canvas) => (
      Number(canvas.style.getPropertyValue("--incision-photo-zoom"))
    ))).toBeCloseTo(Number(viewport.expected), 2);
    const zoom = await photoCanvas.evaluate((canvas) => Number(
      canvas.style.getPropertyValue("--incision-photo-zoom"),
    ));
    expect(zoom).toBeGreaterThan(5);
    await context.close();
  }
});

test("main photo view zoom reaches the desktop and touch-mobile caps", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const viewport of [
    { width: 390, height: 844, expected: "12", hasTouch: true },
    { width: 1280, height: 800, expected: "10", hasTouch: false },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.hasTouch,
      isMobile: viewport.hasTouch,
    });
    const page = await context.newPage();
    await page.goto("/app/workflow");
    await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", {
      timeout: 45_000,
    });
    await uploadGeneratedPhoto(page, "single", "#fileInput");
    const canvas = page.locator("#canvas");
    await expect(canvas).toHaveClass(/image-source/, { timeout: 45_000 });
    if (viewport.hasTouch) {
      const markerToggle = page.locator(".workflow-marker-toggle");
      await markerToggle.click();
      const scan = page.locator(".workflow-marker-scan");
      await expect(scan).toBeVisible();
      await expect(scan.locator("input")).toHaveAttribute("min", "5");
      const layout = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        };
        return {
          confirm: rect(".workflow-mobile-marker-confirm"),
          scan: rect(".workflow-marker-scan"),
        };
      });
      expect(layout.confirm).not.toBeNull();
      expect(layout.scan).not.toBeNull();
      expect(layout.confirm!.right).toBeLessThanOrEqual(layout.scan!.left + 1);
      expect(layout.confirm!.bottom).toBeLessThanOrEqual(layout.scan!.bottom + 1);
    }
    await wheelToCap(page, "#canvas");
    await expect.poll(() => canvas.evaluate((element) => (
      Number(element.style.getPropertyValue("--img-zoom"))
    ))).toBeCloseTo(Number(viewport.expected), 2);
    const zoom = await canvas.evaluate((element) => Number(
      element.style.getPropertyValue("--img-zoom"),
    ));
    expect(zoom).toBeGreaterThan(5);
    await context.close();
  }
});
