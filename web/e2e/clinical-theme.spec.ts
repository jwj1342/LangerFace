import { expect, test } from "@playwright/test";

import { measureContrast } from "./contrast";

const CLINICAL_BLUE = "rgb(15, 98, 254)";
const DARK_PAGE = "rgb(9, 11, 15)";
const DARK_SIDEBAR = "rgb(13, 17, 23)";
const DARK_PANEL = "rgb(18, 24, 32)";

test("public workflow entrypoints share the blue clinical action theme", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-page")).toHaveClass(/dark-workbench-page/);
  const dashboardEyebrow = page.getByText("STATELESS WORKBENCH");
  await expect(dashboardEyebrow).toHaveClass(/text-blue-300/);
  const dashboardPrimary = page.getByRole("link", { name: "打开工具" }).first();
  await expect(dashboardPrimary).toHaveCSS("background-color", CLINICAL_BLUE);
  expect((await measureContrast(dashboardPrimary)).ratio).toBeGreaterThanOrEqual(4.5);

  await page.goto("/personalized", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".personalized-page")).toHaveCSS("background-color", DARK_PAGE);
  await expect(page.locator(".personalized-sidebar")).toHaveCSS("background-color", DARK_SIDEBAR);
  await expect(page.locator(".personalized-sidebar .personalized-card").first()).toHaveCSS("background-color", DARK_PANEL);
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
