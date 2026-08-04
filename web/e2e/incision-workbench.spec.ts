import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

interface IncisionSnapshotExpectation {
  reason: string;
  diameterMm?: number;
  angleOffsetDeg?: number;
  tipAngleDeg?: number;
}

async function waitForWorkbench(page: Page) {
  await page.goto("/app/incision");
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);
  await expect(page.locator("#candidateType")).not.toHaveText("—");
  await page.evaluate(() => {
    const auditWindow = window as Window & {
      __incisionE2eSnapshotListenerInstalled?: boolean;
      __incisionE2eSnapshots?: unknown[];
    };
    if (auditWindow.__incisionE2eSnapshotListenerInstalled) return;
    auditWindow.__incisionE2eSnapshotListenerInstalled = true;
    auditWindow.__incisionE2eSnapshots = [];
    window.addEventListener("langerface:incision-state", (event) => {
      auditWindow.__incisionE2eSnapshots?.push((event as CustomEvent).detail);
    });
  });
}

async function waitForIncisionSnapshot(
  page: Page,
  expected: IncisionSnapshotExpectation,
  action: () => Promise<void>,
) {
  await page.evaluate(() => {
    const auditWindow = window as Window & { __incisionE2eSnapshots?: unknown[] };
    auditWindow.__incisionE2eSnapshots = [];
  });
  await action();
  await expect.poll(() => page.evaluate((target) => {
    const auditWindow = window as Window & { __incisionE2eSnapshots?: Array<{
      reason?: string;
      tumor?: { diameterMm?: number };
      edit?: { angleOffsetDeg?: number; tipAngleDeg?: number };
    }> };
    return (auditWindow.__incisionE2eSnapshots || []).some((snapshot) =>
      snapshot.reason === target.reason &&
      (target.diameterMm == null || snapshot.tumor?.diameterMm === target.diameterMm) &&
      (target.angleOffsetDeg == null || snapshot.edit?.angleOffsetDeg === target.angleOffsetDeg) &&
      (target.tipAngleDeg == null || snapshot.edit?.tipAngleDeg === target.tipAngleDeg)
    );
  }, expected), {
    message: `controller snapshot ${JSON.stringify(expected)}`,
  }).toBe(true);
}

async function dragRangeAndRetainValue(
  page: Page,
  locator: Locator,
  targetFraction: number,
  snapshotField: "diameterMm" | "angleOffsetDeg",
) {
  const before = await locator.inputValue();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const minimum = Number(await locator.getAttribute("min"));
  const maximum = Number(await locator.getAttribute("max"));
  const currentFraction = (Number(before) - minimum) / (maximum - minimum);
  const y = bounds!.y + bounds!.height / 2;

  await page.evaluate(() => {
    const auditWindow = window as Window & { __incisionE2eSnapshots?: unknown[] };
    auditWindow.__incisionE2eSnapshots = [];
  });
  await page.mouse.move(bounds!.x + bounds!.width * currentFraction, y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * targetFraction, y, { steps: 8 });
  await page.mouse.up();

  const retained = await locator.inputValue();
  expect(retained).not.toBe(before);
  await expect(locator).toHaveValue(retained);
  await expect.poll(() => page.evaluate(({ field, value }) => {
    const auditWindow = window as Window & {
      __incisionE2eSnapshots?: Array<{
        reason?: string;
        tumor?: { diameterMm?: number };
        edit?: { angleOffsetDeg?: number };
      }>;
    };
    return (auditWindow.__incisionE2eSnapshots || []).some((snapshot) => {
      if (field === "diameterMm") {
        return snapshot.reason === "tumor_diameter_input" &&
          snapshot.tumor?.diameterMm === Number(value);
      }
      return snapshot.reason === "edit_state" &&
        snapshot.edit?.angleOffsetDeg === Number(value);
    });
  }, { field: snapshotField, value: retained })).toBe(true);

  return retained;
}

async function contrastRatio(locator: Locator, pseudo?: "::placeholder") {
  return locator.evaluate((element, pseudoElement) => {
    type Color = { red: number; green: number; blue: number; alpha: number };
    const parse = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) return null;
      return {
        red: channels[0],
        green: channels[1],
        blue: channels[2],
        alpha: channels[3] ?? 1,
      };
    };
    const composite = (foreground: Color, background: Color): Color => {
      const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
      if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
      return {
        red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
        green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
        blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
        alpha,
      };
    };
    const luminance = (color: Color) => {
      const linear = [color.red, color.green, color.blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    let background: Color = { red: 0, green: 0, blue: 0, alpha: 0 };
    for (let current: Element | null = element; current; current = current.parentElement) {
      const layer = parse(getComputedStyle(current).backgroundColor);
      if (layer) background = composite(background, layer);
      if (background.alpha >= 0.999) break;
    }
    if (background.alpha < 0.999) {
      background = composite(background, { red: 255, green: 255, blue: 255, alpha: 1 });
    }
    const rawForeground = parse(getComputedStyle(element, pseudoElement || null).color);
    if (!rawForeground) return 0;
    const foreground = composite(rawForeground, background);
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  }, pseudo);
}

test("active controls remain readable and clinician sliders retain edits", async ({ page }) => {
  // This scenario performs multiple contrast scans plus serial keyboard and
  // physical-drag round trips. Keep assertion timeouts strict while allowing
  // the full interaction matrix to finish on a contended CI browser runner.
  test.setTimeout(120_000);
  await waitForWorkbench(page);

  for (const selector of ["#tumorKind", "#reviewerName", "#runWorkflowBtn", "#approveCandidateBtn", "#exportJsonBtn"]) {
    expect(await contrastRatio(page.locator(selector)), `${selector} contrast`).toBeGreaterThanOrEqual(4.5);
  }
  expect(
    await contrastRatio(page.locator("#reviewerName"), "::placeholder"),
    "#reviewerName placeholder contrast",
  ).toBeGreaterThanOrEqual(4.5);

  const diameter = page.locator("#diameterMm");
  const diameterBefore = Number(await diameter.inputValue());
  await diameter.focus();
  await waitForIncisionSnapshot(
    page,
    { reason: "tumor_diameter_input", diameterMm: diameterBefore + 1 },
    () => diameter.press("ArrowRight"),
  );
  await expect(diameter).toHaveValue(String(diameterBefore + 1));
  await dragRangeAndRetainValue(page, diameter, 0.75, "diameterMm");

  const angle = page.locator("#angleOffsetDeg");
  await angle.focus();
  await waitForIncisionSnapshot(
    page,
    { reason: "edit_state", angleOffsetDeg: 1 },
    () => angle.press("ArrowRight"),
  );
  await expect(angle).toHaveValue("1");
  await expect(page.locator("#editStatus")).toHaveText("已调整");
  await dragRangeAndRetainValue(page, angle, 0.75, "angleOffsetDeg");

  await page.locator("#tumorKind").selectOption("cutaneous");
  await expect(page.locator("#candidateType")).toHaveText("梭形");
  const tipAngle = page.locator("#tipAngleDeg");
  await expect(tipAngle).toBeVisible();
  await expect(tipAngle).toHaveValue("30");
  await tipAngle.focus();
  await waitForIncisionSnapshot(
    page,
    { reason: "edit_state", tipAngleDeg: 31 },
    () => tipAngle.press("ArrowRight"),
  );
  await expect(tipAngle).toHaveValue("31");
  await expect(page.locator("#candidateTipAngle")).toContainText("31.0°");
});

test("route remount removes and rebinds one canvas listener set", async ({ page }) => {
  await page.addInitScript(() => {
    const tracked = new Set(["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"]);
    const auditWindow = window as Window & {
      __incisionListenerBalance?: Record<string, number>;
    };
    auditWindow.__incisionListenerBalance = {};
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this instanceof HTMLElement && this.id === "incisionCanvas" && tracked.has(type)) {
        auditWindow.__incisionListenerBalance![type] =
          (auditWindow.__incisionListenerBalance![type] || 0) + 1;
      }
      return Reflect.apply(originalAdd, this, [type, listener, options]);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (this instanceof HTMLElement && this.id === "incisionCanvas" && tracked.has(type)) {
        auditWindow.__incisionListenerBalance![type] =
          (auditWindow.__incisionListenerBalance![type] || 0) - 1;
      }
      return Reflect.apply(originalRemove, this, [type, listener, options]);
    };
  });
  await waitForWorkbench(page);

  const listenerBalance = () => page.evaluate(() => {
    const auditWindow = window as Window & {
      __incisionListenerBalance?: Record<string, number>;
    };
    return auditWindow.__incisionListenerBalance || {};
  });
  await expect.poll(listenerBalance).toEqual({
    pointerdown: 1,
    pointermove: 1,
    pointerup: 1,
    pointercancel: 1,
    wheel: 1,
  });

  await page.getByRole("link", { name: "返回工具入口" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(listenerBalance).toEqual({
    pointerdown: 0,
    pointermove: 0,
    pointerup: 0,
    pointercancel: 0,
    wheel: 0,
  });

  await page.locator('a[href="/incision"]').filter({ hasText: "打开工具" }).click();
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);
  await expect(page.locator("#candidateType")).not.toHaveText("—");
  await expect.poll(listenerBalance).toEqual({
    pointerdown: 1,
    pointermove: 1,
    pointerup: 1,
    pointercancel: 1,
    wheel: 1,
  });
});

test("live workbench controls use the same readable clinical theme", async ({ page }) => {
  await page.goto("/live");
  await expect(page.locator("#templateSel")).toBeVisible();

  for (const selector of ["#templateSel", "#routeSel", "#uploadBtn", "#camBtn"]) {
    expect(await contrastRatio(page.locator(selector)), `${selector} contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

test("mobile layout shows the 3D stage before the long review form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForWorkbench(page);

  const stage = await page.locator(".incision-workbench > .stage").boundingBox();
  const sidebar = await page.locator(".incision-workbench > .sidebar").boundingBox();
  expect(stage).not.toBeNull();
  expect(sidebar).not.toBeNull();
  expect(stage!.y).toBeLessThan(sidebar!.y);
  expect(stage!.y).toBeLessThan(844);

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

test("clinical summary hides internal codes and exposes the rule validation boundary", async ({ page }) => {
  await waitForWorkbench(page);

  const state = page.locator(".incision-state-panel");
  await expect(state).toContainText("皮下肿物");
  await expect(state).toContainText("线性切口");
  await expect(state).toContainText("待医生确认");
  await expect(state).toContainText("研究规则草案");
  await expect(state).toContainText("尚未完成临床验证");
  await expect(state).not.toContainText("pending_clinician_confirmation");
  await expect(state).not.toContainText("subcutaneous");

  const technicalDetails = page.locator("details.incision-technical-details");
  await expect(technicalDetails).not.toHaveAttribute("open", "");
  await expect(page.locator("#guardrailDetails")).not.toContainText("sensitive_region_");
  await expect(page.locator("#guardrailDetails")).not.toContainText("Confirm functional");
  await expect(page.locator("#guardrailDetails")).not.toContainText("Review the full candidate");
  await expect(page.locator("#regionVal")).not.toContainText("bbox_heuristic_region_classifier");
  await expect(page.locator("#anatomyPreview")).not.toContainText("cheek");
  await expect(page.locator("#anatomyPreview")).not.toContainText("bbox_heuristic_region_classifier");
});
