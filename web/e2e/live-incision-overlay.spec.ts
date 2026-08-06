import { expect, test } from "@playwright/test";

import { dragFirstPhotoEndpoint, uploadGeneratedPhoto } from "./support/incisionPhoto";

function candidatePixelCount() {
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return 0;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (green > 145 && green > red + 45 && blue > 55 && red < 130) count += 1;
  }
  return count;
}

function keypointPixelCount() {
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return 0;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (red >= 185 && red <= 225 && green >= 205 && blue >= 235) count += 1;
  }
  return count;
}

test("approved incision reaches the live photo renderer with visible feedback", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app/incision");
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);
  await expect(page.locator("#candidateType")).not.toHaveText("—");

  await uploadGeneratedPhoto(page, "single");
  await expect(page.locator("#incisionPhotoStatus")).toContainText(/照片规划.*候选已叠加/, { timeout: 45_000 });
  const lengthBefore = Number(await page.locator("#lengthScale").inputValue());
  await dragFirstPhotoEndpoint(page);
  await expect.poll(async () => Number(await page.locator("#lengthScale").inputValue())).not.toBe(lengthBefore);
  await expect(page.locator("#editHistoryState")).toContainText("已提交");

  await page.locator("#reviewerName").fill("E2E clinician");
  await page.locator("#reviewNotes").fill("Browser handoff verification");
  await page.locator("#reviewDecision").selectOption("approved_for_discussion");
  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#savedCount")).toHaveText("1");

  const reviewDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportJsonBtn").click();
  const reviewDownload = await reviewDownloadPromise;
  expect(reviewDownload.suggestedFilename()).toMatch(/^incision_review_\d+\.json$/);

  await page.locator("#stageLiveOverlayBtn").click();
  await expect(page).toHaveURL(/\/live\?incisionOverlay=staged$/);
  await expect(page.locator("#liveIncisionOverlayCard")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#liveIncisionOverlayState")).toContainText(/已载入|等待画面/);

  await uploadGeneratedPhoto(page, "single", "#fileInput");
  await expect(page.locator("#incisionOverlayQaState")).not.toHaveText("等待画面", { timeout: 60_000 });
  const candidatePixelsWithOverlay = await expect.poll(() => page.evaluate(candidatePixelCount), {
    message: "the live canvas must contain the green/cyan incision candidate stroke",
  }).toBeGreaterThan(8).then(() => page.evaluate(candidatePixelCount));

  const keypointsBefore = await page.evaluate(keypointPixelCount);
  await page.locator("#meshPts").check();
  await expect.poll(() => page.evaluate(keypointPixelCount), {
    message: "the visible face-keypoint toggle must add high-contrast point pixels",
  }).toBeGreaterThan(keypointsBefore + 100);

  await page.locator("#clearIncisionOverlayBtn").click();
  await expect(page.locator("#liveIncisionOverlayCard")).toBeHidden();
  await expect.poll(() => page.evaluate(candidatePixelCount), {
    message: "clearing the overlay must remove candidate pixels without replacing the source image",
  }).toBeLessThan(candidatePixelsWithOverlay - 8);

  await page.getByRole("link", { name: "进入切口规划" }).click();
  await expect(page).toHaveURL(/\/incision$/);
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);
  await expect(page.locator("#candidateType")).not.toHaveText("—");
  await expect(page.locator("#savedCount")).toHaveText("1");
  await expect(page.locator("#reviewDecision")).toHaveValue("approved_for_discussion");
});
