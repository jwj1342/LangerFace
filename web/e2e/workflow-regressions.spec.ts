import { expect, test, type Page } from "@playwright/test";

import { uploadGeneratedPhoto } from "./support/incisionPhoto";

async function clickWorkflowCanvasRatio(page: Page, xRatio: number, yRatio: number) {
  const canvas = page.locator("#canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("workflow canvas has no layout box");
  await canvas.click({ position: { x: box.width * xRatio, y: box.height * yRatio } });
}

async function workflowBoundaryBox(page: Page) {
  return page.locator("[data-workflow-boundary]").evaluate((path: SVGGraphicsElement) => {
    const box = path.getBBox();
    return { width: box.width, height: box.height };
  });
}

test("merged workflow preserves incision geometry, warning priority, and RSTL refresh ownership", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });

  await uploadGeneratedPhoto(page, "single", "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
  await expect(page.locator("#workflowStageStatus")).not.toContainText("请先上传", { timeout: 45_000 });

  await clickWorkflowCanvasRatio(page, 0.68, 0.52);
  await expect(page.locator("#candidateType")).toContainText("梭形", { timeout: 45_000 });
  await expect.poll(() => page.locator("[data-workflow-boundary]").getAttribute("d"))
    .toMatch(/^M /);
  const cheekBoundary = await workflowBoundaryBox(page);

  await clickWorkflowCanvasRatio(page, 0.50, 0.30);
  await expect(page.locator("#candidateType")).toContainText("梭形", { timeout: 45_000 });
  const foreheadBoundary = await workflowBoundaryBox(page);
  expect(Math.abs(foreheadBoundary.width - cheekBoundary.width) / cheekBoundary.width).toBeLessThan(0.08);
  expect(Math.abs(foreheadBoundary.height - cheekBoundary.height) / cheekBoundary.height).toBeLessThan(0.08);
  expect(foreheadBoundary.height / foreheadBoundary.width).toBeGreaterThan(0.82);

  await expect.poll(async () => page.locator("#wrinkleStatus").textContent(), { timeout: 45_000 })
    .not.toMatch(/检测中|正在/);
  await page.evaluate(() => {
    const auditWindow = window as Window & { __workflowLiveEvents?: unknown[] };
    auditWindow.__workflowLiveEvents = [];
    window.addEventListener("langerface:live-state", (event) => {
      auditWindow.__workflowLiveEvents?.push((event as CustomEvent).detail);
    });
  });
  await page.locator("#diameterMm").evaluate((input: HTMLInputElement) => {
    for (const value of ["13", "14", "15", "16"]) {
      input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
  });
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workflowLiveEvents?: unknown[] }
  ).__workflowLiveEvents?.length || 0)).toBe(0);

  const markerButton = page.getByTitle("点击照片中的受控黑色标记并识别边界");
  await expect(markerButton).toContainText("受控标记");
  await markerButton.click();
  await expect(markerButton).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const auditWindow = window as Window & { __workflowIncisionReasons?: string[] };
    auditWindow.__workflowIncisionReasons = [];
    window.addEventListener("langerface:incision-state", (event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason) auditWindow.__workflowIncisionReasons?.push(reason);
    });
  });
  await clickWorkflowCanvasRatio(page, 0.50, 0.64);
  await expect(page.locator("#workflowStageStatus")).toContainText(
    "识别范围进入眼裂、口裂或鼻孔等非皮肤开口",
    { timeout: 45_000 },
  );
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workflowIncisionReasons?: string[] }
  ).__workflowIncisionReasons || [])).toContain("controlled_marker_opening_scan_rejected");

  await page.evaluate(() => {
    (window as Window & { __workflowIncisionReasons?: string[] }).__workflowIncisionReasons = [];
  });
  await clickWorkflowCanvasRatio(page, 0.34, 0.37);
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workflowIncisionReasons?: string[] }
  ).__workflowIncisionReasons || [])).toContain("controlled_marker_opening_scan_rejected");
});

test("subcutaneous overlay stays centered and cutaneous scan follows diameter", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
  await uploadGeneratedPhoto(page, "single", "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });

  await page.locator("#tumorKind").selectOption("subcutaneous");
  await page.locator("#diameterMm").evaluate((input: HTMLInputElement) => {
    input.value = "39";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "39" }));
    input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await clickWorkflowCanvasRatio(page, 0.50, 0.15);
  await expect(page.locator("#candidateType")).toContainText("线性", { timeout: 45_000 });
  await expect(page.locator("#workflowStageStatus")).toContainText("草案长度上限 35.0 mm", { timeout: 45_000 });
  await expect.poll(() => page.locator("[data-workflow-candidate]").getAttribute("d")).toMatch(/^M /);
  const centerDistance = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>("[data-workflow-candidate]");
    const center = document.querySelector<SVGCircleElement>("[data-workflow-center]");
    const values = (path?.getAttribute("d") || "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    const pairs = Array.from({ length: Math.floor(values.length / 2) }, (_, index) => [
      values[index * 2], values[index * 2 + 1],
    ]);
    const cx = Number(center?.getAttribute("cx"));
    const cy = Number(center?.getAttribute("cy"));
    return Math.min(...pairs.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  });
  expect(centerDistance).toBeLessThan(0.2);

  await page.locator("#tumorKind").selectOption("cutaneous");
  await page.locator("#diameterMm").evaluate((input: HTMLInputElement) => {
    input.value = "33";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "33" }));
    input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await page.getByTitle("点击照片中的受控黑色标记并识别边界").click();
  const scan = page.locator(".workflow-marker-scan input[type=range]");
  await expect(scan).toHaveAttribute("min", "40");
  const scanValues = await scan.evaluate((input: HTMLInputElement) => ({
    minimum: Number(input.min),
    current: Number(input.value),
  }));
  expect(scanValues.current).toBeGreaterThanOrEqual(scanValues.minimum);
});
