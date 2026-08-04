import { expect, test } from "@playwright/test";

import { measureContrast } from "./contrast";

const CLINICAL_BLUE = "rgb(15, 98, 254)";
const DARK_PAGE = "rgb(9, 11, 15)";

test("public workflow entrypoints share the blue clinical action theme", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const dashboardEyebrow = page.getByText("STATELESS WORKBENCH");
  await expect(dashboardEyebrow).toHaveClass(/text-blue-300/);

  await page.goto("/personalized", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".personalized-page")).toHaveCSS("background-color", DARK_PAGE);
  const capturePrimary = page.locator("#startBtn");
  await expect(capturePrimary).toHaveCSS("background-color", CLINICAL_BLUE);
  expect((await measureContrast(capturePrimary)).ratio).toBeGreaterThanOrEqual(4.5);

  await page.goto("/current/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/live$/);
  const livePrimary = page.locator("#uploadBtn");
  await expect(livePrimary).toHaveCSS("background-color", CLINICAL_BLUE);
  expect((await measureContrast(livePrimary)).ratio).toBeGreaterThanOrEqual(4.5);

  await page.goto("/v6-review", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".v6-review-page")).toHaveCSS("background-color", DARK_PAGE);
  const reviewPrimary = page.locator(".button-primary").first();
  await expect(reviewPrimary).toHaveCSS("background-color", CLINICAL_BLUE);
  expect((await measureContrast(reviewPrimary)).ratio).toBeGreaterThanOrEqual(4.5);
});
