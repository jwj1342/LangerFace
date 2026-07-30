import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

async function waitForWorkbench(page: Page) {
  await page.goto("/app/incision");
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);
  await expect(page.locator("#candidateType")).not.toHaveText("—");
}

async function contrastRatio(locator: Locator) {
  return locator.evaluate((element) => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
      return match ? match.slice(1, 4).map(Number) : null;
    };
    const luminance = (value: string) => {
      const channels = parse(value);
      if (!channels) return null;
      const linear = channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const style = getComputedStyle(element);
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    if (foreground == null || background == null) return 0;
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}

test("active controls remain readable and clinician sliders retain edits", async ({ page }) => {
  await waitForWorkbench(page);

  for (const selector of ["#tumorKind", "#reviewerName", "#runWorkflowBtn", "#approveCandidateBtn", "#exportJsonBtn"]) {
    expect(await contrastRatio(page.locator(selector)), `${selector} contrast`).toBeGreaterThanOrEqual(4.5);
  }

  const diameter = page.locator("#diameterMm");
  const diameterBefore = Number(await diameter.inputValue());
  await diameter.focus();
  await diameter.press("ArrowRight");
  await expect(diameter).toHaveValue(String(diameterBefore + 1));
  await page.waitForTimeout(300);
  await expect(diameter).toHaveValue(String(diameterBefore + 1));

  const angle = page.locator("#angleOffsetDeg");
  await angle.focus();
  await angle.press("ArrowRight");
  await expect(angle).toHaveValue("1");
  await page.waitForTimeout(300);
  await expect(angle).toHaveValue("1");
  await expect(page.locator("#editStatus")).toHaveText("已调整");

  await page.locator("#tumorKind").selectOption("cutaneous");
  await expect(page.locator("#candidateType")).toHaveText("梭形");
  const tipAngle = page.locator("#tipAngleDeg");
  await expect(tipAngle).toBeVisible();
  await expect(tipAngle).toHaveValue("30");
  await tipAngle.focus();
  await tipAngle.press("ArrowRight");
  await expect(tipAngle).toHaveValue("31");
  await page.waitForTimeout(300);
  await expect(tipAngle).toHaveValue("31");
  await expect(page.locator("#candidateTipAngle")).toContainText("31.0°");
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
