import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const FACE_PAIR_JPEG = readFileSync(new URL(
  "../compat/personalized/v6_demo/id_003/rstl_before_after.jpg",
  import.meta.url,
)).toString("base64");

async function uploadGeneratedPhoto(page: Page, mode: "single" | "multiple" | "blank") {
  await page.evaluate(async ({ base64, uploadMode }) => {
    const input = document.querySelector<HTMLInputElement>("#incisionPhotoInput");
    if (!input) throw new Error("incision photo input is missing");

    let file: File;
    if (uploadMode === "blank") {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 640;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2d context is missing");
      context.fillStyle = "#d8dee7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("blank PNG encoding failed")),
        "image/png",
      ));
      file = new File([blob], "blank.png", { type: "image/png" });
    } else {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const sourceBlob = new Blob([bytes], { type: "image/jpeg" });
      if (uploadMode === "multiple") {
        file = new File([sourceBlob], "two-faces.jpg", { type: "image/jpeg" });
      } else {
        const bitmap = await createImageBitmap(sourceBlob);
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(bitmap.width / 2);
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2d context is missing");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error("face JPEG encoding failed")),
          "image/jpeg",
          0.94,
        ));
        file = new File([blob], "single-face.jpg", { type: "image/jpeg" });
      }
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { base64: FACE_PAIR_JPEG, uploadMode: mode });
}

async function findPhotoEndpointHandles(page: Page) {
  return page.locator(".incision-photo-endpoint-handle:not([hidden])").evaluateAll((handles) => handles.map((handle) => {
    const rect = handle.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }));
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
  const photoCanvas = page.locator("#incisionPhotoCanvas");
  const status = page.locator("#incisionPhotoStatus");
  await expect(status).toContainText(/照片规划.*RSTL.*候选已叠加/, { timeout: 45_000 });
  await expect(photoCanvas).toHaveAttribute("data-active", "true");
  await expect(page.locator("#incisionCanvas")).toHaveClass(/hidden/);

  const evidence = await photoCanvas.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return { cyan: 0, width: 0, height: 0 };
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let cyan = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index] < 150 && pixels[index + 1] > 170 && pixels[index + 2] > 170) cyan += 1;
    }
    return { cyan, width: canvas.width, height: canvas.height };
  });
  expect(evidence.width).toBeGreaterThan(0);
  expect(evidence.height).toBeGreaterThan(0);
  expect(evidence.cyan, "photo canvas should contain visible cyan RSTL pixels").toBeGreaterThan(20);

  await expect(page.locator("#stageStatus")).toContainText("第 1 次生成");
  await page.locator("#diameterMm").focus();
  await page.locator("#diameterMm").press("ArrowRight");
  await expect(page.locator("#stageStatus")).toContainText("第 1 次生成");
  await page.locator("#runWorkflowBtn").click();
  await expect(page.locator("#stageStatus")).toContainText("第 2 次生成");

  const endpointHandles = await findPhotoEndpointHandles(page);
  expect(endpointHandles).toHaveLength(2);
  const lengthBefore = Number(await page.locator("#lengthScale").inputValue());
  await page.locator("#reviewDecision").selectOption("approved_for_discussion");
  const [firstHandle, secondHandle] = endpointHandles;
  await page.mouse.move(firstHandle.x, firstHandle.y);
  await page.mouse.down();
  await page.mouse.move(
    firstHandle.x + (secondHandle.x - firstHandle.x) * 0.22,
    firstHandle.y + (secondHandle.y - firstHandle.y) * 0.22,
    { steps: 8 },
  );
  await page.mouse.up();
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

  await page.locator("#tumorKind").selectOption("cutaneous");
  await expect(page.locator("#candidateType")).toHaveText("梭形");
  await expect(page.locator("#stageStatus")).toContainText("第 2 次生成");

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
