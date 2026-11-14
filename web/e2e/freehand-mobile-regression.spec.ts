import { expect, test, type Locator, type Page } from "@playwright/test";

import { uploadGeneratedPhoto, uploadGeneratedPhotoWithControlledMarkers } from "./support/incisionPhoto";
import { captureMarkerIdentity } from "../../tools/marker_runtime_identity.mts";

async function assertSourceRuntime(page: Page) {
  const expected = captureMarkerIdentity(undefined);
  const proof = await page.evaluate(async () => {
    const response = await fetch("/__runtime-identity.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Source runtime identity returned ${response.status}`);
    const path = "/src/services/controlledMarkerDetectionProfile.ts";
    const module = await import(path);
    return { identity: await response.json(),
      profile: module.CONTROLLED_MARKER_DETECTOR_PROFILE,
      version: module.CONTROLLED_MARKER_DETECTOR_VERSION };
  });
  expect(proof.identity.mode).toBe("development");
  for (const key of ["profile", "implementationVersion", "releaseName", "sourceDigest",
    "algorithmDigest", "assetDigest", "head", "branch", "worktreeId"] as const) {
    expect(proof.identity[key], `source runtime ${key}`).toBe(expected[key]);
  }
  expect(proof.profile).toBe(expected.profile);
  expect(proof.version).toBe(expected.implementationVersion);
  await test.info().attach("source-runtime-identity", {
    body: JSON.stringify(proof), contentType: "application/json",
  });
}

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
  await dragUpFrom(page, start);
}

async function dragUpFrom(page: Page, start: { x: number; y: number }) {
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
      await page.waitForTimeout(20);
    }
    // Release after the finger stops; an instantaneous synthetic flick can
    // consume the next tap to cancel its fling instead of clicking Upload.
    await page.waitForTimeout(80);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function expectGestureScrolls(page: Page, target: "pane" | "root" | "document", timeout = 10_000, touch = true) {
  const offset = () => page.evaluate((kind) => (
    kind === "pane" ? document.querySelector(".workflow-mobile-operation-pane")?.scrollTop ?? 0
      : kind === "root" ? document.querySelector(".workflow-workbench")?.scrollTop ?? 0
        : document.scrollingElement?.scrollTop ?? 0
  ), target);
  const before = await offset();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("scroll test requires a fixed viewport");
  if (touch) await dragUpFrom(page, { x: 10, y: viewport.height - 24 });
  else {
    await page.mouse.move(10, viewport.height - 24);
    await page.mouse.wheel(0, 250);
  }
  await expect.poll(offset, { timeout, message: "a gesture must move the actual scroll target" })
    .toBeGreaterThan(before + 5);
}

async function expectZoomRailContained(page: Page) {
  const overflow = await page.locator(".workflow-workbench > .stage").evaluate((stage) => {
    const stageBox = stage.getBoundingClientRect();
    return Array.from(stage.querySelectorAll<HTMLElement>(".zoom-strip, .zoom-card, .zoom-card canvas"))
      .filter((element) => element.getBoundingClientRect().height > 0)
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.top < stageBox.top - 1 || box.bottom > stageBox.bottom + 1;
      })
      .map((element) => element.className);
  });
  expect(overflow, "zoom cards must occupy space inside the stage, not cover the operation rail").toEqual([]);
}

const scrollLayouts = [
  { name: "fine393", width: 393, height: 726, touch: false, mobile: false },
  { name: "fine560", width: 560, height: 844, touch: false, mobile: false },
  { name: "touch561", width: 561, height: 844, touch: true, mobile: false },
  { name: "touch393", width: 393, height: 726, touch: true, mobile: true },
  { name: "touch560", width: 560, height: 844, touch: true, mobile: true },
  { name: "short-phone", width: 390, height: 480, touch: true, mobile: true },
  { name: "landscape", width: 844, height: 390, touch: true, mobile: false },
  { name: "desktop1440", width: 1440, height: 960, touch: false, mobile: false },
];

for (const layout of scrollLayouts) {
  test(`workflow scroll and upload remain usable: ${layout.name}`, async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      baseURL,
      viewport: { width: layout.width, height: layout.height },
      hasTouch: layout.touch,
      isMobile: layout.touch,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    try {
      await page.goto("/app/workflow?developer=1");
      await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
      const scrollTarget = layout.mobile ? "pane" : layout.width <= 560 ? "root" : "document";
      await expect(page.locator('[data-workflow-mobile="true"] > .workflow-mobile-operation-pane')).toHaveCount(layout.mobile ? 1 : 0);
      await expect(page.locator(".mobile-workflow-dock")).toHaveCount(layout.mobile ? 1 : 0);
      await expect(page.locator('[data-workflow-mobile="true"] .workflow-mobile-recovery-slot')).toHaveCount(layout.mobile ? 1 : 0);
      await expect(page.locator(".workflow-mobile-recovery-slot")).toHaveCount(1);
      await expect(page.locator(".workflow-mobile-recovery-slot")).toBeEmpty();
      if (layout.width <= 1280) {
        const stageTop = await page.locator(".stage").evaluate((element) => element.getBoundingClientRect().top);
        await expectGestureScrolls(page, scrollTarget, 10_000, layout.touch);
        if (layout.width <= 560) {
          expect(await page.locator(".stage").evaluate((element) => element.getBoundingClientRect().top))
            .toBeCloseTo(stageTop, 1);
        }
      }
      await expectZoomRailContained(page);
      const upload = layout.mobile
        ? page.getByRole("button", { name: "上传照片", exact: true })
        : page.locator("#uploadBtn");
      if (scrollTarget === "root") {
        await upload.evaluate(element => element.scrollIntoView({ block: "end", behavior: "instant" }));
      }
      await upload.scrollIntoViewIfNeeded();
      // Finish the preceding scroll before testing a separate tap; a tap during
      // a fling can stop the fling instead of activating the control.
      await expect.poll(async () => page.evaluate(() => new Promise<boolean>((resolve) => {
        let prior = `${scrollY}:${document.querySelector(".workflow-mobile-operation-pane")?.scrollTop}`;
        let stableFrames = 0;
        let frames = 0;
        const tick = () => {
          const current = `${scrollY}:${document.querySelector(".workflow-mobile-operation-pane")?.scrollTop}`;
          stableFrames = current === prior ? stableFrames + 1 : 0;
          prior = current;
          if (stableFrames >= 12) resolve(true);
          else if (++frames >= 120) resolve(false);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }))).toBe(true);
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 10_000 }),
        layout.touch ? upload.tap() : upload.click(),
      ]);
      await chooser.setFiles([]);
      await uploadGeneratedPhoto(page, "single", "#fileInput");
      await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
      await expect(page.locator(".workflow-marker-toggle")).toBeEnabled({ timeout: 45_000 });
      await expectZoomRailContained(page);
      await expectAllVisibleButtonsReachable(page);
    } finally {
      await context.close();
    }
  });
}

test("workflow gesture assertion detects a locked existing mobile pane", async ({ page }) => {
  await page.goto("/app/workflow?developer=1");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
  await expect(page.locator(".workflow-mobile-operation-pane")).toBeVisible();
  const lock = await page.addStyleTag({
    content: ".workflow-mobile-operation-pane { touch-action: none !important; }",
  });
  let detected = false;
  try {
    await expectGestureScrolls(page, "pane", 1_500);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("a gesture must move")) throw error;
    detected = true;
  }
  expect(detected, "the same scroll assertion must reject a locked pane even when its DOM exists").toBe(true);
  await lock.evaluate((element) => element.remove());
  await expectGestureScrolls(page, "pane");
});

test("workflow wheel assertion detects a locked narrow fallback root", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, viewport: { width: 393, height: 726 }, hasTouch: false, isMobile: false,
  });
  try {
    const page = await context.newPage();
    await page.goto("/app/workflow?developer=1");
    await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪");
    const lock = await page.addStyleTag({
      content: ".workflow-workbench.app { overflow-y: hidden !important; }",
    });
    let detected = false;
    try {
      await expectGestureScrolls(page, "root", 1_500, false);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("a gesture must move")) throw error;
      detected = true;
    }
    expect(detected, "the wheel assertion must reject a locked fallback root").toBe(true);
    await lock.evaluate(element => element.remove());
    await expectGestureScrolls(page, "root", 10_000, false);
  } finally {
    await context.close();
  }
});

test("narrow mouse layout preserves the original canvas and real refine quality",
  { tag: "@source-contract" }, async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, viewport: { width: 393, height: 726 }, hasTouch: false, isMobile: false,
  });
  try {
    const page = await context.newPage();
    await page.goto("/app/workflow?developer=1");
    await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪");
    await assertSourceRuntime(page);
    const result = await page.evaluate(async () => {
      const fitPath = "/src/services/liveCanvasFit.ts";
      const statePath = "/src/services/liveState.ts";
      const refinePath = "/src/services/liveRefine2d.ts";
      const domPath = "/src/services/liveDom.ts";
      const { fitCanvasDisplayToStage } = await import(fitPath);
      const { renderState } = await import(statePath);
      const { undoRefine } = await import(refinePath);
      const { els } = await import(domPath);
      els.canvas.width = els.canvas.height = 640;
      els.canvas.classList.add("image-source");
      renderState.imageView.zoom = 1;
      renderState.imageView.offsetX = renderState.imageView.offsetY = 0;
      fitCanvasDisplayToStage();
      const line = (name: string, y: number) => ({ name, pts: [[100, y, 0], [400, y, 0]] });
      const state = renderState.refine2d;
      state.active = true;
      state.latestAutoLines = [line("a", 100), line("b", 140)];
      state.undoStack = [{ label: "synthetic-layout-regression",
        lines: [line("a", 100), line("b", 110.204)] }];
      undoRefine();
      const box = els.canvas.getBoundingClientRect();
      const originalQuality = structuredClone(state.quality);
      const root = document.querySelector<HTMLElement>(".workflow-workbench")!;
      root.scrollTop = 200;
      els.upload.focus();
      state.undoStack = [{ label: "after-scroll-and-focus",
        lines: [line("a", 100), line("b", 110.204)] }];
      undoRefine();
      return { width: box.width, height: box.height, left: box.left,
        stageHeight: document.querySelector(".stage")!.getBoundingClientRect().height,
        quality: state.quality, hidden: els.refine2dQuality.classList.contains("hidden"),
        originalBox: box.toJSON(), afterScrollAndFocusBox: els.canvas.getBoundingClientRect().toJSON(),
        originalQuality };
    });
    expect(result.width).toBe(393);
    expect(result.height).toBe(393);
    expect(result.left).toBe(0);
    expect(result.stageHeight).toBe(527);
    expect(result.quality.ok).toBe(true);
    expect(result.hidden).toBe(true);
    expect(result.afterScrollAndFocusBox).toEqual(result.originalBox);
    expect(result.quality).toEqual(result.originalQuality);
    await assertSourceRuntime(page);
  } finally {
    await context.close();
  }
});

test("width transitions retain desktop controls and layer state on fine pointers",
  { tag: "@source-contract" }, async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, viewport: { width: 900, height: 900 }, hasTouch: false, isMobile: false,
  });
  try {
    const page = await context.newPage();
    await page.goto("/app/workflow?developer=1");
    await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪");
    await assertSourceRuntime(page);
    await page.evaluate(async () => {
      const path = "/src/services/mobileWorkflowVisibility.ts";
      const visibility = await import(path);
      visibility.setMobileRstlLayerVisible(false);
      visibility.setMobileWrinkleLayerVisible(false);
    });
    for (const width of [560, 561, 900, 393]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".workflow-mobile-operation-pane")).toBeHidden();
      await expect(page.locator(".mobile-workflow-dock")).toHaveCount(0);
      await expect(page.locator(".workflow-mobile-recovery-slot")).toBeHidden();
      const layers = await page.evaluate(async () => {
        const path = "/src/services/mobileWorkflowVisibility.ts";
        const { workflowLayerVisibilitySnapshot } = await import(path);
        const { rstl, wrinkles } = workflowLayerVisibilitySnapshot();
        return { rstl, wrinkles };
      });
      expect(layers).toEqual({ rstl: false, wrinkles: false });
      const bindings = await page.evaluate(async () => {
        const path = "/src/services/liveDom.ts";
        const { els } = await import(path);
        return [els.canvas, els.upload, els.file].every(node => node.isConnected)
          && els.canvas === document.querySelector("#canvas")
          && els.upload === document.querySelector("#uploadBtn")
          && els.file === document.querySelector("#fileInput");
      });
      expect(bindings, "runtime must keep the current canvas and upload nodes after width changes").toBe(true);
    }
    const upload = page.locator("#uploadBtn");
    await upload.evaluate(element => element.scrollIntoView({ block: "end", behavior: "instant" }));
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), upload.click()]);
    await chooser.setFiles([]);
    await uploadGeneratedPhoto(page, "single", "#fileInput");
    await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
    await page.getByLabel("肿物边界").selectOption("freehand");
    await expect(page.locator("#startBoundaryBtn")).toHaveText("结束描绘");
    const box = await page.locator("#canvas").boundingBox();
    if (!box) throw new Error("resized workflow canvas is missing");
    const cx = box.x + box.width * 0.62;
    const cy = box.y + box.height * 0.48;
    const radius = Math.min(box.width, box.height) * 0.055;
    await page.mouse.move(cx + radius, cy);
    await page.mouse.down();
    for (let index = 1; index <= 18; index++) {
      const angle = index * Math.PI * 2 / 18;
      await page.mouse.move(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    }
    await page.mouse.up();
    await expect.poll(() => page.locator("[data-workflow-boundary]").getAttribute("d")).toMatch(/^M /);
    await assertSourceRuntime(page);
  } finally {
    await context.close();
  }
});

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
    await button.evaluate(element => {
      const root = element.closest(".workflow-workbench");
      if (root && root.getAttribute("data-workflow-mobile") !== "true"
        && root.querySelector(":scope > .stage")
        && getComputedStyle(root.querySelector(":scope > .stage")!).position === "sticky"
        && !element.closest(".stage")) {
        element.scrollIntoView({ block: "end", behavior: "instant" });
      }
    });
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

test("desktop workflow keeps the three-column shell while status text remains hidden", async ({ browser, baseURL }) => {
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
    await expect(page.locator("#livePill")).toBeHidden();
    await expect(page.locator("#fps")).toBeHidden();
    await expect(page.locator(".mobile-workflow-dock")).toBeHidden();
    await expect(page.locator('[data-quality-runtime="true"]')).toBeHidden();
    await expect(page.locator(".workflow-mobile-quality-slot > .mobile-canvas-quality")).toHaveCount(0);
    await page.waitForTimeout(4_200);
    await expect(page.locator("#workflowStageStatus")).toBeHidden();
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
          if (child.classList.contains("workflow-mobile-operation-pane")) return "mobile-pane";
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
      sourceOrder: ["live", "stage", "mobile-pane", "incision"],
      liveLeft: 0,
      liveWidth: 320,
      stageLeft: 320,
      stageWidth: 800,
      incisionLeft: 1120,
      incisionWidth: 320,
    });
    const pane = page.locator(".workflow-workbench > .workflow-mobile-operation-pane");
    await expect(pane).toHaveCount(1);
    expect(await pane.evaluate((element) => ({
      display: getComputedStyle(element).display,
      boxes: element.getClientRects().length,
      rails: element.querySelectorAll(".workflow-live-rail, .workflow-incision-rail").length,
      recoverySlots: element.querySelectorAll(":scope > .workflow-mobile-recovery-slot").length,
      visibleDescendants: Array.from(element.querySelectorAll<HTMLElement>("*"))
        .filter((child) => {
          const box = child.getBoundingClientRect();
          return getComputedStyle(child).visibility !== "hidden" && box.width > 0 && box.height > 0;
        }).length,
    }))).toEqual({ display: "contents", boxes: 0, rails: 0, recoverySlots: 1, visibleDescendants: 0 });
    const upload = page.locator("#uploadBtn");
    await upload.scrollIntoViewIfNeeded();
    await upload.click({ trial: true });
  } finally {
    await context.close();
  }
});

test("a visibility-limited candidate prompts for a reviewer before confirmation", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });

  const marker = { xRatio: 0.10, yRatio: 0.55, radiusRatio: 0.035 };
  await uploadGeneratedPhotoWithControlledMarkers(page, [marker], "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
  const markerButton = page.getByTitle("点击照片中的受控黑色标记并识别边界");
  await markerButton.click();
  await expect(markerButton).toHaveAttribute("aria-pressed", "true");
  await clickCanvasRatio(page, marker.xRatio, marker.yRatio);
  await expect(page.locator("#workflowStageStatus")).toContainText("视野受限参考", { timeout: 45_000 });

  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#reviewSaveFeedback")).toContainText("请填写审阅人后确认");
  await expect(page.locator("#reviewerName")).toHaveAttribute("aria-invalid", "true");
  await page.locator("#reviewerName").fill("E2E clinician");
  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#saveReviewBtn")).toHaveText("已确认");
  await expect(page.locator("#savedCount, #candidateList, [data-candidate-review-toggle]")).toHaveCount(0);
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
  await expect(page.locator('[data-quality-runtime="true"]')).toBeHidden();
  await expect(page.locator(".workflow-mobile-quality-slot")).toHaveCount(0);

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
    const expectedStageHeight = Math.max(320, Math.min(viewport.height - 136, viewport.width + 134));
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
  const markerButton = page.locator(".workflow-marker-toggle");
  await expect(markerButton).toBeEnabled({ timeout: 45_000 });

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

  await markerButton.click();
  await expect(markerButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#ellipseRatio")).toHaveCount(0);

  const markerStageHeight = await stage.evaluate((element) => element.getBoundingClientRect().height);
  expect(markerStageHeight).toBeCloseTo(Math.max(320, Math.min(844 - 136, 390 + 134)), 0);

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
  await markerButton.click();
  await expect(markerButton).toHaveAttribute("aria-pressed", "true");

  const boundaryMode = page.getByLabel("肿物边界");
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
  await expect(page.locator("#boundaryStatus")).toHaveCount(0);
  await expect(page.locator("#workflowStageStatus")).toContainText("本段轮廓已记录");
  await expect(boundaryButton).toHaveText("结束描绘");
});
