import { expect, test } from "@playwright/test";

import {
  clickPhotoRatio,
  findPhotoEndpointHandles,
  uploadGeneratedPhoto,
  uploadGeneratedPhotoWithControlledMarkers,
  type ControlledMarkerFixture,
} from "./support/incisionPhoto";

const MARKER_A: ControlledMarkerFixture = { xRatio: 0.30, yRatio: 0.48, radiusRatio: 0.035 };
const MARKER_B: ControlledMarkerFixture = { xRatio: 0.70, yRatio: 0.48, radiusRatio: 0.035 };

function handleMidpoint(handles: { x: number; y: number }[]) {
  expect(handles).toHaveLength(2);
  return {
    x: (handles[0].x + handles[1].x) / 2,
    y: (handles[0].y + handles[1].y) / 2,
  };
}

test("changing tumor kind before a photo pick does not create a default lesion", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/app/incision");
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);

  await uploadGeneratedPhoto(page, "single");
  const canvas = page.locator("#incisionPhotoCanvas");
  await expect(canvas).toHaveAttribute("data-active", "true", { timeout: 45_000 });
  await expect(page.locator("#stageStatus")).toContainText("尚未选择病灶位置");
  const before = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());

  await page.locator("#tumorKind").selectOption("cutaneous");
  await expect(page.locator("#stageStatus")).toContainText("尚未选择病灶位置");
  await expect.poll(() => findPhotoEndpointHandles(page)).toHaveLength(0);
  const after = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  expect(after, "tumor-kind changes must not draw a fallback center, boundary, or candidate on an unpicked photo")
    .toBe(before);
});

test("a second controlled-marker click replaces the previous result before reporting success", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/app/incision");
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);

  await page.locator("#tumorKind").selectOption("cutaneous");
  await page.locator("#diameterMm").fill("6");
  await page.locator("#marginMm").fill("1");
  await uploadGeneratedPhotoWithControlledMarkers(page, [MARKER_A, MARKER_B]);

  const canvas = page.locator("#incisionPhotoCanvas");
  const status = page.locator("#incisionPhotoStatus");
  const markerToggle = page.locator("#controlledMarkerDetectBtn");
  await expect(canvas).toHaveAttribute("data-active", "true", { timeout: 45_000 });
  await markerToggle.click();
  await expect(markerToggle).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveCSS("cursor", "crosshair");

  await clickPhotoRatio(page, MARKER_A);
  await expect(status).toContainText("已识别模拟肿物并生成候选切口", { timeout: 45_000 });
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await expect(canvas).toHaveCSS("cursor", "crosshair");
  const firstPickState = await page.locator("#pickState").textContent();
  const firstHandles = await findPhotoEndpointHandles(page);
  const firstMidpoint = handleMidpoint(firstHandles);

  const panBefore = await canvas.evaluate((element) => ({
    x: element.style.getPropertyValue("--incision-photo-pan-x"),
    y: element.style.getPropertyValue("--incision-photo-pan-y"),
  }));
  await clickPhotoRatio(page, MARKER_B);
  await expect(status).toContainText("正在识别模拟肿物");
  await expect(status).toContainText("已识别模拟肿物并生成候选切口", { timeout: 45_000 });
  await expect(canvas).toHaveAttribute("aria-busy", "false");

  const secondPickState = await page.locator("#pickState").textContent();
  const secondHandles = await findPhotoEndpointHandles(page);
  const secondMidpoint = handleMidpoint(secondHandles);
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(secondPickState, "the current lesion selection must belong to the second click").not.toBe(firstPickState);
  expect(
    Math.hypot(secondMidpoint.x - firstMidpoint.x, secondMidpoint.y - firstMidpoint.y),
    "the visible candidate must move with the second controlled marker instead of reusing the first result",
  ).toBeGreaterThan(canvasBox!.width * 0.18);
  await expect(markerToggle).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveCSS("cursor", "crosshair");
  const panAfterSecondClick = await canvas.evaluate((element) => ({
    x: element.style.getPropertyValue("--incision-photo-pan-x"),
    y: element.style.getPropertyValue("--incision-photo-pan-y"),
  }));
  expect(panAfterSecondClick, "controlled-marker clicks must not pan the patient photo").toEqual(panBefore);

  const markerBX = canvasBox!.x + canvasBox!.width * MARKER_B.xRatio;
  const markerBY = canvasBox!.y + canvasBox!.height * MARKER_B.yRatio;
  await page.mouse.move(markerBX, markerBY);
  await page.mouse.down();
  await page.mouse.move(markerBX + 10, markerBY + 6, { steps: 4 });
  await page.mouse.up();
  await expect(status).toContainText("已识别模拟肿物并生成候选切口", { timeout: 45_000 });
  const panAfterPointerMotion = await canvas.evaluate((element) => ({
    x: element.style.getPropertyValue("--incision-photo-pan-x"),
    y: element.style.getPropertyValue("--incision-photo-pan-y"),
  }));
  expect(panAfterPointerMotion, "pointer motion in controlled-marker mode must remain a pick, not a photo pan")
    .toEqual(panBefore);
});
