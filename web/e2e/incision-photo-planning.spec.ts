import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { dragFirstPhotoEndpoint, pickSafePhotoCheek, uploadGeneratedPhoto } from "./support/incisionPhoto";

async function explicitGenerationCount(page: Page) {
  const status = await page.locator("#stageStatus").textContent() || "";
  if (!status.trim()) return 0;
  if (status.includes("生成中")) return -1;
  const match = status.match(/已明确生成\s*(\d+)\s*次/);
  if (!match) throw new Error(`generation count is missing from stage status: ${status}`);
  return Number(match[1]);
}

async function candidateOverlayEvidence(page: Page) {
  return page.locator("#incisionCandidateCanvas").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return { nonTransparent: 0, solidCore: 0, matteBlue: 0, width: 0, height: 0 };
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonTransparent = 0;
    let solidCore = 0;
    let matteBlue = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha > 0) nonTransparent += 1;
      if (alpha >= 220) solidCore += 1;
      if (alpha > 80 && pixels[index] < 24 && pixels[index + 1] >= 36
        && pixels[index + 1] <= 84 && pixels[index + 2] >= 90 && pixels[index + 2] <= 145) {
        matteBlue += 1;
      }
    }
    return { nonTransparent, solidCore, matteBlue, width: canvas.width, height: canvas.height };
  });
}

test("patient photo is the mobile incision canvas and reuploads fail safely", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const auditWindow = window as Window & { __photoSnapshots?: unknown[] };
    auditWindow.__photoSnapshots = [];
    window.addEventListener("langerface:incision-state", (event) => {
      auditWindow.__photoSnapshots?.push((event as CustomEvent).detail);
    });
  });
  await page.goto("/app/incision");
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);

  await uploadGeneratedPhoto(page, "single");
  await pickSafePhotoCheek(page);
  const photoCanvas = page.locator("#incisionPhotoCanvas");
  const status = page.locator("#incisionPhotoStatus");
  await expect(status).toContainText(/照片规划.*RSTL.*候选已叠加/, { timeout: 45_000 });
  await expect(photoCanvas).toHaveAttribute("data-active", "true");
  await expect(page.locator("#incisionCanvas")).toHaveClass(/hidden/);
  await expect.poll(async () => (await candidateOverlayEvidence(page)).nonTransparent).toBeGreaterThan(4);
  const initialCandidateEvidence = await candidateOverlayEvidence(page);
  expect(initialCandidateEvidence.solidCore,
    "screen-space candidate overlay should contain opaque core pixels instead of only gray partial coverage")
    .toBeGreaterThan(0);

  const evidence = await photoCanvas.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return { pinkRstl: 0, width: 0, height: 0 };
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let pinkRstl = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index] > 180 && pixels[index + 1] < 140 && pixels[index + 2] > 140) pinkRstl += 1;
    }
    return { pinkRstl, width: canvas.width, height: canvas.height };
  });
  expect(evidence.width).toBeGreaterThan(0);
  expect(evidence.height).toBeGreaterThan(0);
  expect(evidence.pinkRstl, "photo canvas should contain visible shared pink RSTL pixels").toBeGreaterThan(20);

  const generationBefore = await explicitGenerationCount(page);
  await page.locator("#diameterMm").focus();
  await page.locator("#diameterMm").press("ArrowRight");
  await expect.poll(() => explicitGenerationCount(page)).toBe(generationBefore);
  await page.locator("#runWorkflowBtn").click();
  await expect.poll(() => explicitGenerationCount(page)).toBe(generationBefore + 1);

  const lengthBefore = Number(await page.locator("#lengthScale").inputValue());
  await page.locator("#reviewDecision").selectOption("approved_for_discussion");
  await dragFirstPhotoEndpoint(page);
  await expect.poll(async () => Number(await page.locator("#lengthScale").inputValue())).not.toBe(lengthBefore);
  await expect(page.locator("#editHistoryState")).toContainText("已提交");
  await expect(page.locator("#reviewDecision")).toHaveValue("pending_clinician_confirmation");

  const box = await photoCanvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(390);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  await page.locator("#incisionPhotoMirrorBtn").click();
  await expect(page.locator("#incisionPhotoMirrorBtn")).toHaveAttribute("aria-pressed", "true");
  await photoCanvas.hover({ position: { x: box!.width / 2, y: box!.height / 2 } });
  await page.mouse.wheel(0, -120);
  await expect.poll(() => photoCanvas.evaluate((canvas) => canvas.style.getPropertyValue("--incision-photo-zoom")))
    .not.toBe("1");
  const viewportHasNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(viewportHasNoHorizontalOverflow).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("incision-photo-mobile.png"), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("incision-photo-desktop.png"), fullPage: true });

  await page.locator("#diameterMm").fill("4");
  await page.locator("#tumorKind").selectOption("cutaneous");
  await expect(page.locator("#candidateType")).toHaveText("梭形");
  await expect.poll(() => explicitGenerationCount(page)).toBe(generationBefore + 1);
  await expect.poll(async () => (await candidateOverlayEvidence(page)).matteBlue).toBeGreaterThan(4);
  await page.screenshot({ path: testInfo.outputPath("incision-photo-fusiform.png"), fullPage: true });

  const serializedSnapshots = await page.evaluate(() => JSON.stringify(
    (window as Window & { __photoSnapshots?: unknown[] }).__photoSnapshots || [],
  ));
  expect(serializedSnapshots).not.toMatch(/data:image|blob:|faceLandmarks|landmarks/i);

  await uploadGeneratedPhoto(page, "blank");
  await expect(status).toContainText(/未检测到人脸|照片检测失败/, { timeout: 45_000 });
  await expect(page.locator("#candidateType")).toHaveText("—");

  await uploadGeneratedPhoto(page, "multiple");
  await expect(status).toContainText("检测到多张人脸", { timeout: 45_000 });
  await expect(page.locator("#candidateType")).toHaveText("—");
});
