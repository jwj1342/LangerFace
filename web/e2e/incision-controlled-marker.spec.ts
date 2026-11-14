import { expect, test } from "@playwright/test";

import {
  clickPhotoRatio,
  findPhotoEndpointHandles,
  uploadGeneratedPhoto,
  uploadGeneratedPhotoWithControlledMarkers,
  type ControlledMarkerFixture,
} from "./support/incisionPhoto";

const MARKER_A: ControlledMarkerFixture = { xRatio: 0.30, yRatio: 0.48, radiusRatio: 0.035, interiorRetrace: true };
const MARKER_B: ControlledMarkerFixture = { xRatio: 0.70, yRatio: 0.58, radiusRatio: 0.035, interiorRetrace: true };

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
  await canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    Reflect.set(window, "__unpickedPhotoPixels", pixels);
  });

  await page.locator("#tumorKind").selectOption("cutaneous");
  await expect(page.locator("#stageStatus")).toContainText("尚未选择病灶位置");
  await expect.poll(() => findPhotoEndpointHandles(page)).toHaveLength(0);
  const difference = await canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const before = Reflect.get(window, "__unpickedPhotoPixels") as ImageData;
    const after = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let maxChannelDelta = 0;
    if (before.width !== after.width || before.height !== after.height) return Infinity;
    for (let index = 0; index < before.data.length; index += 1) {
      maxChannelDelta = Math.max(maxChannelDelta, Math.abs(before.data[index] - after.data[index]));
    }
    return maxChannelDelta;
  });
  // Redrawing an unchanged photo can round an 8-bit channel by one. Compare
  // decoded pixels instead of PNG bytes; an added centre/outline exceeds this.
  expect(difference, "tumor-kind changes must not draw a fallback center, boundary, or candidate on an unpicked photo")
    .toBeLessThanOrEqual(1);
});

test("switching to a subcutaneous tumor exits controlled marking without inventing a boundary", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/app/incision");
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);

  await page.locator("#tumorKind").selectOption("cutaneous");
  await uploadGeneratedPhoto(page, "single");
  const canvas = page.locator("#incisionPhotoCanvas");
  const markerToggle = page.locator("#controlledMarkerDetectBtn");
  await expect(canvas).toHaveAttribute("data-active", "true", { timeout: 45_000 });
  await markerToggle.click();
  await expect(markerToggle).toHaveAttribute("aria-pressed", "true");

  await page.locator("#tumorKind").selectOption("subcutaneous");
  await expect(markerToggle).toHaveAttribute("aria-pressed", "false");
  await expect(markerToggle).toBeDisabled();
  await expect(canvas).toHaveAttribute("data-controlled-marker", "false");
  await expect(canvas).toHaveAttribute("data-controlled-marker-repair", "false");

  await expect(page.locator("#candidateType")).toHaveText("—");
  await expect.poll(() => findPhotoEndpointHandles(page)).toHaveLength(0);
});

test("a second controlled-marker click replaces the previous result before reporting success", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/app/incision");
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);

  await page.locator("#tumorKind").selectOption("cutaneous");
  await uploadGeneratedPhotoWithControlledMarkers(page, [MARKER_A, MARKER_B]);

  const canvas = page.locator("#incisionPhotoCanvas");
  const status = page.locator("#incisionPhotoStatus");
  const markerToggle = page.locator("#controlledMarkerDetectBtn");
  await expect(canvas).toHaveAttribute("data-active", "true", { timeout: 45_000 });
  await markerToggle.click();
  await expect(markerToggle).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveCSS("cursor", "crosshair");

  await clickPhotoRatio(page, MARKER_A);
  // The projection status is shared with the photo renderer and can be
  // replaced by its generic copy during the same render. The endpoint handles
  // are the actual visible candidate and therefore the stable success signal.
  await expect.poll(() => findPhotoEndpointHandles(page), { timeout: 75_000 })
    .toHaveLength(2);
  await expect(page.locator("#candidateType")).not.toHaveText("—");
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
  await expect(status).toContainText("正在识别肿物边界");
  // A second scan must finish before checking the replacement candidate;
  // handles from the first result may remain in the DOM while the new scan is
  // still running.
  await expect(canvas).toHaveAttribute("aria-busy", "false", { timeout: 180_000 });
  await expect.poll(() => findPhotoEndpointHandles(page), { timeout: 30_000 })
    .toHaveLength(2);
  await expect(page.locator("#candidateType")).not.toHaveText("—");
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
  // Pointer motion starts a fresh scan, so waiting for its full detector run
  // would add another minute without testing the pan invariant. Check that
  // the scan was accepted and assert the view state immediately.
  await expect(canvas).toHaveAttribute("aria-busy", "true", { timeout: 10_000 });
  const panAfterPointerMotion = await canvas.evaluate((element) => ({
    x: element.style.getPropertyValue("--incision-photo-pan-x"),
    y: element.style.getPropertyValue("--incision-photo-pan-y"),
  }));
  expect(panAfterPointerMotion, "pointer motion in controlled-marker mode must remain a pick, not a photo pan")
    .toEqual(panBefore);
});
