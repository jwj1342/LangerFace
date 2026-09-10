import { expect, test, type Locator, type Page } from "@playwright/test";

import { uploadGeneratedPhoto } from "./support/incisionPhoto";

test.describe.configure({ mode: "serial" });
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});

async function drawTouchStroke(page: Page) {
  const canvas = page.locator("#canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("workflow canvas has no mobile layout box");

  const center = {
    x: box.x + box.width * 0.62,
    y: box.y + box.height * 0.48,
  };
  const radius = Math.min(box.width, box.height) * 0.055;
  const points = Array.from({ length: 18 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 17;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });

  const session = await page.context().newCDPSession(page);
  const touchPoint = (point: { x: number; y: number }) => ({
    ...point,
    id: 1,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  });
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touchPoint(points[0])],
    });
    for (const point of points.slice(1)) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [touchPoint(point)],
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

async function clickCanvasRatio(page: Page, xRatio: number, yRatio: number) {
  const canvas = page.locator("#canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("workflow canvas has no mobile layout box");
  await canvas.click({ position: { x: box.width * xRatio, y: box.height * yRatio } });
}

async function dragOperationPaneFrom(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("mobile operation control has no layout box");
  const start = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
  const session = await page.context().newCDPSession(page);
  const touchPoint = (y: number) => ({
    x: start.x,
    y,
    id: 1,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  });
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(start.y)] });
    for (const offset of [24, 48, 72, 96, 120]) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [touchPoint(start.y - offset)],
      });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function expectToolbarControlsUnobscured(page: Page) {
  const result = await page.locator(".workflow-canvas-tools").evaluate((toolbar) => {
    const toolbarRect = toolbar.getBoundingClientRect();
    const controls = Array.from(toolbar.querySelectorAll<HTMLElement>("button, label"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => ({
        name: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
        rect: element.getBoundingClientRect(),
      }));
    const outside = controls.filter(({ rect }) => (
      rect.left < toolbarRect.left - 1
      || rect.right > toolbarRect.right + 1
      || rect.top < toolbarRect.top - 1
      || rect.bottom > toolbarRect.bottom + 1
    )).map(({ name }) => name);
    const overlaps: string[] = [];
    for (let left = 0; left < controls.length; left += 1) {
      for (let right = left + 1; right < controls.length; right += 1) {
        const a = controls[left];
        const b = controls[right];
        const overlapWidth = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const overlapHeight = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (overlapWidth > 1 && overlapHeight > 1) overlaps.push(`${a.name} / ${b.name}`);
      }
    }
    const stageBody = toolbar.closest(".stage-top")?.nextElementSibling?.getBoundingClientRect();
    return {
      outside,
      overlaps,
      clearsStageBody: !stageBody || toolbarRect.bottom <= stageBody.top + 1,
    };
  });
  expect(result.outside).toEqual([]);
  expect(result.overlaps).toEqual([]);
  expect(result.clearsStageBody).toBe(true);
}

async function expectAllVisibleButtonsReachable(page: Page) {
  // Disabled controls intentionally ignore pointer input. Visual clipping and
  // overlap are checked separately by expectToolbarControlsUnobscured().
  const buttons = page.locator('button:visible:not(:disabled):not([aria-disabled="true"])');
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    await button.scrollIntoViewIfNeeded();
    const result = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        label: element.getAttribute("aria-label") || element.textContent?.trim() || "button",
        insideViewport: rect.left >= -1
          && rect.right <= document.documentElement.clientWidth + 1
          && rect.top >= -1
          && rect.bottom <= document.documentElement.clientHeight + 1,
        hitTarget: Boolean(hit && (hit === element || element.contains(hit))),
      };
    });
    expect(result.insideViewport, `${result.label} must fit the phone viewport`).toBe(true);
    expect(result.hitTarget, `${result.label} must not be covered by another element`).toBe(true);
  }
}

test("desktop workflow keeps the saved three-column UI and status behavior", async ({ browser, baseURL }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();
  try {
    await page.goto("/app/workflow");
    await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
    await expect(page.locator("#livePill")).toBeVisible();
    await expect(page.locator("#fps")).toBeVisible();
    await expect(page.locator(".mobile-workflow-dock")).toBeHidden();
    await expect(page.locator(".workflow-live-rail .live-quality-panel")).toHaveCount(1);
    await expect(page.locator(".workflow-mobile-quality-slot > .mobile-canvas-quality")).toHaveCount(0);
    await page.waitForTimeout(4_200);
    await expect(page.locator("#workflowStageStatus")).toBeVisible();
    await expect(page.locator("#workflowStageStatus")).not.toHaveClass(/is-collapsed/);
    const desktopLayout = await page.locator(".workflow-workbench").evaluate((root) => {
      const liveRail = root.querySelector<HTMLElement>(".workflow-live-rail");
      const stageElement = root.querySelector<HTMLElement>(":scope > .stage");
      const incisionRail = root.querySelector<HTMLElement>(".workflow-incision-rail");
      if (!liveRail || !stageElement || !incisionRail) return null;
      const liveBox = liveRail.getBoundingClientRect();
      const stageBox = stageElement.getBoundingClientRect();
      const incisionBox = incisionRail.getBoundingClientRect();
      return {
        sourceOrder: Array.from(root.children).map((child) => {
          if (child.classList.contains("workflow-live-rail")) return "live";
          if (child.classList.contains("stage")) return "stage";
          if (child.classList.contains("workflow-incision-rail")) return "incision";
          return "other";
        }),
        liveLeft: liveBox.left,
        liveWidth: liveBox.width,
        stageLeft: stageBox.left,
        stageWidth: stageBox.width,
        incisionLeft: incisionBox.left,
        incisionWidth: incisionBox.width,
      };
    });
    expect(desktopLayout).toEqual({
      sourceOrder: ["live", "stage", "incision"],
      liveLeft: 0,
      liveWidth: 320,
      stageLeft: 320,
      stageWidth: 800,
      incisionLeft: 1120,
      incisionWidth: 320,
    });
  } finally {
    await context.close();
  }
});

test("a visibility-limited saved draft explains why confirmation is unavailable", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });

  await uploadGeneratedPhoto(page, "single", "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
  await clickCanvasRatio(page, 0.10, 0.55);
  await expect(page.locator("#workflowStageStatus")).toContainText("视野受限参考", { timeout: 45_000 });

  await page.locator("#reviewerName").fill("E2E clinician");
  await page.locator("#reviewDecision").selectOption("pending_clinician_confirmation");
  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#savedCount")).toHaveText("1");

  const transitionButton = page.locator('[data-candidate-review-toggle="pending_clinician_confirmation"]');
  const transitionReason = page.locator(".candidate-review-condition.warning");
  await expect(transitionReason).toContainText("只覆盖照片可见区域");
  await expect(transitionReason).toContainText("暂不能确认");
  await expect(transitionButton).toBeDisabled();
  await expect(transitionButton).toHaveText("暂不能确认");
});

test("mobile freehand exits an empty session and draws after leaving controlled marker", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });

  const operationPane = page.locator(".workflow-mobile-operation-pane");
  const stage = page.locator(".workflow-workbench > .stage");
  await expect(operationPane).toBeVisible();
  await expect(page.locator(".workflow-mobile-scroll-zone")).toHaveCount(0);
  await expect(page.locator("#livePill")).toBeHidden();
  await expect(page.locator("#fps")).toBeHidden();
  await expect(page.locator(".workflow-mobile-quality-slot > .mobile-canvas-quality")).toHaveCount(1);
  await expect(page.locator(".main-wrap > .mobile-canvas-quality")).toHaveCount(0);

  for (const viewport of [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.locator(".workflow-workbench").evaluate((root) => {
      const stageElement = root.querySelector<HTMLElement>(":scope > .stage");
      const pane = root.querySelector<HTMLElement>(":scope > .workflow-mobile-operation-pane");
      if (!stageElement || !pane) return null;
      const stageBox = stageElement.getBoundingClientRect();
      const paneBox = pane.getBoundingClientRect();
      const paneStyle = getComputedStyle(pane);
      return {
        rootHeight: root.getBoundingClientRect().height,
        stageHeight: stageBox.height,
        stageTop: stageBox.top,
        paneTop: paneBox.top,
        paneOverflowY: paneStyle.overflowY,
        paneScrollbarWidth: paneStyle.scrollbarWidth,
        paneScrollable: pane.scrollHeight > pane.clientHeight,
      };
    });
    expect(layout).not.toBeNull();
    expect(layout!.rootHeight).toBeCloseTo(viewport.height, 0);
    const expectedStageHeight = Math.max(320, Math.min(viewport.height - 170, viewport.width + 100));
    expect(layout!.stageHeight).toBeCloseTo(expectedStageHeight, 0);
    expect(layout!.paneTop).toBeCloseTo(layout!.stageTop + layout!.stageHeight, 0);
    expect(layout!.paneOverflowY).toBe("auto");
    expect(layout!.paneScrollbarWidth).toBe("none");
    expect(layout!.paneScrollable).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const uploadButton = page.getByRole("button", { name: "上传照片", exact: true });
  let fileChooserOpened = false;
  page.once("filechooser", () => { fileChooserOpened = true; });
  const stageTopBeforeDrag = await stage.evaluate((element) => element.getBoundingClientRect().top);
  await dragOperationPaneFrom(page, uploadButton);
  await expect.poll(() => operationPane.evaluate((pane) => pane.scrollTop)).toBeGreaterThan(0);
  expect(fileChooserOpened).toBe(false);
  expect(await stage.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(stageTopBeforeDrag, 1);
  await operationPane.evaluate((pane) => { pane.scrollTop = 0; });

  await uploadGeneratedPhoto(page, "single", "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });

  const browserHeightCanvasSizes: Array<{ width: number; height: number }> = [];
  for (const height of [711, 775]) {
    await page.setViewportSize({ width: 430, height });
    await expect.poll(async () => Math.round((await page.locator("#canvas").boundingBox())?.width || 0))
      .toBeGreaterThanOrEqual(400);
    const box = await page.locator("#canvas").boundingBox();
    if (!box) throw new Error("workflow canvas has no fitted phone-photo box");
    browserHeightCanvasSizes.push({ width: box.width, height: box.height });
  }
  expect(Math.abs(browserHeightCanvasSizes[0].width - browserHeightCanvasSizes[1].width)).toBeLessThanOrEqual(1);
  expect(Math.abs(browserHeightCanvasSizes[0].height - browserHeightCanvasSizes[1].height)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });

  const markerButton = page.locator(".workflow-marker-toggle");
  await markerButton.click();
  await expect(markerButton).toHaveAttribute("aria-pressed", "true");
  const ellipseRatio = page.locator("#ellipseRatio");
  await expect(ellipseRatio).toBeDisabled();

  const markerStageHeight = await stage.evaluate((element) => element.getBoundingClientRect().height);
  expect(markerStageHeight).toBeCloseTo(Math.max(320, Math.min(844 - 130, 390 + 150)), 0);

  await page.setViewportSize({ width: 430, height: 711 });
  await expect.poll(async () => Math.round((await page.locator("#canvas").boundingBox())?.width || 0))
    .toBeGreaterThanOrEqual(400);
  await expectToolbarControlsUnobscured(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const canvasBox = await page.locator("#canvas").boundingBox();
  if (!canvasBox) throw new Error("workflow canvas has no mobile layout box");
  await page.locator("#canvas").tap({ position: { x: canvasBox.width * 0.5, y: canvasBox.height * 0.45 } });
  await expect(page.locator(".workflow-mobile-marker-confirm")).toBeEnabled();
  for (const width of [360, 390, 430, 560]) {
    await page.setViewportSize({ width, height: 844 });
    await expectToolbarControlsUnobscured(page);
    if (width === 360 || width === 560) await expectAllVisibleButtonsReachable(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await markerButton.click();
  await expect(markerButton).toHaveAttribute("aria-pressed", "false");
  await expect(ellipseRatio).toBeEnabled();
  await markerButton.click();
  await expect(markerButton).toHaveAttribute("aria-pressed", "true");
  await expect(ellipseRatio).toBeDisabled();

  const boundaryMode = page.getByLabel("皮表边界");
  const boundaryButton = page.locator("#startBoundaryBtn");
  await boundaryMode.selectOption("freehand");
  await expect(boundaryMode).toHaveValue("freehand");
  await expect(markerButton).toHaveAttribute("aria-pressed", "false");
  await expect(boundaryButton).toHaveText("结束描绘");

  await boundaryButton.click();
  await expect(boundaryButton).toHaveText("开始描绘");
  await expect(page.locator("#workflowStageStatus")).toHaveText("已退出自由轮廓描绘；本次没有保存边界。");

  await boundaryButton.click();
  await expect(boundaryButton).toHaveText("结束描绘");
  await drawTouchStroke(page);

  await expect.poll(() => page.locator("[data-workflow-boundary]").getAttribute("d"))
    .toMatch(/^M /);
  await expect(page.locator("#boundaryStatus")).toHaveText("轮廓轨迹已记录；请点击“结束描绘”后再识别并生成候选。");
  await expect(page.locator("#workflowStageStatus")).toContainText("本段轮廓已记录");
  await expect(boundaryButton).toHaveText("结束描绘");
});
