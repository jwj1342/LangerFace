import { expect, test } from "@playwright/test";

test("cutaneous candidate shows RSTL deviation before and after clinician direction edit", async ({ page }) => {
  await page.goto("/app/incision");
  await expect(page.locator("#assetLoading")).toHaveClass(/hidden/);

  await page.locator("#tumorKind").selectOption("cutaneous");
  await expect(page.locator("#candidateType")).toHaveText("梭形");
  await expect(page.locator("#candidateRstlDeviation")).toHaveText("0.0°");
  await expect(page.locator("#guardrailVal")).toHaveText("复核");

  const angleOffset = page.locator("#angleOffsetDeg");
  await angleOffset.focus();
  await angleOffset.press("ArrowRight");

  await expect(page.locator("#candidateRstlDeviation")).toHaveText("1.0°");
  await expect(page.locator("#guardrailVal")).toHaveText("复核");
});
