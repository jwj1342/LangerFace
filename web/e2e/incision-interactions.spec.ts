import { expect, test } from "@playwright/test";
import type { Locator, Page, TestInfo } from "@playwright/test";

type EditSnapshotField =
  | "angleOffsetDeg"
  | "lengthScalePct"
  | "widthScalePct"
  | "shiftAlongMm"
  | "shiftPerpMm";

interface IncisionSnapshot {
  reason?: string;
  stageStatus?: string;
  edit?: Partial<Record<EditSnapshotField, number>> & {
    historyLabel?: string;
  };
}

interface SliderContract {
  controlId: string;
  snapshotField: EditSnapshotField;
}

const SLIDER_CONTRACTS: SliderContract[] = [
  { controlId: "angleOffsetDeg", snapshotField: "angleOffsetDeg" },
  { controlId: "lengthScale", snapshotField: "lengthScalePct" },
  { controlId: "widthScale", snapshotField: "widthScalePct" },
  { controlId: "shiftAlongMm", snapshotField: "shiftAlongMm" },
  { controlId: "shiftPerpMm", snapshotField: "shiftPerpMm" },
];

async function installSnapshotCapture(page: Page) {
  await page.addInitScript(() => {
    const auditWindow = window as Window & {
      __incisionE2eSnapshots?: unknown[];
    };
    auditWindow.__incisionE2eSnapshots = [];
    window.addEventListener("langerface:incision-state", (event) => {
      auditWindow.__incisionE2eSnapshots?.push((event as CustomEvent).detail);
    });
  });
}

async function waitForWorkbench(page: Page) {
  await installSnapshotCapture(page);
  await page.goto("/app/incision");
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);
  await expect(page.locator("#candidateType")).not.toHaveText("—");
  await expect(page.locator("#stageStatus")).toContainText("第 1 次生成");
}

async function clearCapturedSnapshots(page: Page) {
  await page.evaluate(() => {
    const auditWindow = window as Window & {
      __incisionE2eSnapshots?: unknown[];
    };
    auditWindow.__incisionE2eSnapshots = [];
  });
}

async function dragRangeRight(page: Page, slider: Locator) {
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  expect(box, "range input must have a visible track").not.toBeNull();

  const range = await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    return {
      min: Number(input.min),
      max: Number(input.max),
      value: Number(input.value),
    };
  });
  const span = range.max - range.min;
  expect(span, "range input must expose a non-empty numeric interval").toBeGreaterThan(0);

  const ratio = (range.value - range.min) / span;
  const startX = box!.x + Math.max(2, Math.min(box!.width - 2, box!.width * ratio));
  const endX = Math.min(box!.x + box!.width - 2, startX + Math.max(16, box!.width * 0.18));
  const y = box!.y + box!.height / 2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 8 });
  await page.mouse.up();
}

async function waitForCommittedEcho(
  page: Page,
  snapshotField: EditSnapshotField,
  expectedValue: number,
) {
  await expect.poll(() => page.evaluate(
    ({ field, value }) => {
      const auditWindow = window as Window & {
        __incisionE2eSnapshots?: IncisionSnapshot[];
      };
      return (auditWindow.__incisionE2eSnapshots || []).some((snapshot) =>
        snapshot.reason === "edit_state" &&
        snapshot.edit?.[field] === value &&
        snapshot.edit.historyLabel?.includes("已提交"),
      );
    },
    { field: snapshotField, value: expectedValue },
  ), {
    message: `${snapshotField} controller echo must include the committed value`,
  }).toBe(true);
}

async function expectValueStableAfterReactEcho(page: Page, slider: Locator, expectedValue: number) {
  // Playwright runs this file in parallel with the surgery checks. Chromium may
  // throttle requestAnimationFrame in a background page, so wait on the driver
  // side before checking that a delayed React snapshot did not restore the old value.
  await page.waitForTimeout(150);
  await expect.poll(async () => Number(await slider.inputValue()), {
    message: "controlled slider value must not bounce back after the controller snapshot",
  }).toBe(expectedValue);
}

async function saveEvidenceScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: testInfo.outputPath(name),
    fullPage: true,
  });
}

test("clinician edit sliders retain real mouse drags after the controller echo", async ({ page }, testInfo) => {
  // This scenario intentionally performs five serial physical drags plus five
  // controller round trips. Keep each assertion timeout strict while allowing
  // the complete matrix to finish on a contended CI browser runner.
  test.setTimeout(120_000);
  await waitForWorkbench(page);

  await page.locator("#tumorKind").selectOption("cutaneous");
  await expect(page.locator("#candidateType")).toHaveText("梭形");
  await expect(page.locator("#widthScale")).toBeVisible();

  for (const { controlId, snapshotField } of SLIDER_CONTRACTS) {
    await test.step(`drag ${controlId} to the right`, async () => {
      const slider = page.locator(`#${controlId}`);
      const before = Number(await slider.inputValue());
      await clearCapturedSnapshots(page);

      await dragRangeRight(page, slider);

      const after = Number(await slider.inputValue());
      expect(after, `${controlId} must move in the expected direction`).toBeGreaterThan(before);
      await waitForCommittedEcho(page, snapshotField, after);
      await expectValueStableAfterReactEcho(page, slider, after);
    });
  }

  await saveEvidenceScreenshot(page, testInfo, "browser-slider-drag.png");
});

test("same parameters can generate a second candidate with visible feedback", async ({ page }, testInfo) => {
  await waitForWorkbench(page);

  const parameterIds = ["tumorKind", "diameterMm", "tumorAuthor", "depthMm"];
  const parametersBefore = await page.locator(parameterIds.map((id) => `#${id}`).join(",")).evaluateAll(
    (elements) => elements.map((element) => (element as HTMLInputElement | HTMLSelectElement).value),
  );

  await page.locator("#runAgentBtn").click();
  await expect(page.locator("#stageStatus")).toContainText("第 2 次生成");

  const parametersAfter = await page.locator(parameterIds.map((id) => `#${id}`).join(",")).evaluateAll(
    (elements) => elements.map((element) => (element as HTMLInputElement | HTMLSelectElement).value),
  );
  expect(parametersAfter).toEqual(parametersBefore);

  await saveEvidenceScreenshot(page, testInfo, "browser-second-generation.png");
});
