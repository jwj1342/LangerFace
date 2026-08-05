import { expect, test } from "@playwright/test";

import { measureContrast } from "./contrast";

const CLINICAL_BLUE = "rgb(15, 98, 254)";
const DARK_PAGE = "rgb(9, 11, 15)";
const DARK_SIDEBAR = "rgb(13, 17, 23)";
const DARK_PANEL = "rgb(18, 24, 32)";

test("public workflow entrypoints share the blue clinical action theme", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-page")).toHaveClass(/dark-workbench-page/);
  await expect(page.locator(".react-shell-sidebar")).toHaveCSS("background-color", DARK_SIDEBAR);
  await expect(page.locator(".react-shell-sidebar .card").first()).toHaveCSS("background-color", DARK_PANEL);
  const dashboardEyebrow = page.getByText("STATELESS WORKBENCH");
  await expect(dashboardEyebrow).toHaveClass(/text-blue-300/);

  await page.goto("/personalized", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_PAGE);
  await expect(page.locator(".sidebar")).toHaveCSS("background-color", DARK_SIDEBAR);
  await expect(page.locator(".sidebar .card").first()).toHaveCSS("background-color", DARK_PANEL);
  const capturePrimary = page.locator("#startBtn");
  await expect(capturePrimary).toHaveCSS("background-color", CLINICAL_BLUE);
  expect((await measureContrast(capturePrimary)).ratio).toBeGreaterThanOrEqual(4.5);

  await page.goto("/current/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveClass(/clinical-compat-workbench/);
  const compatibilityPrimary = page.locator("#uploadBtn");
  await expect(compatibilityPrimary).toHaveCSS("background-color", CLINICAL_BLUE);
  expect((await measureContrast(compatibilityPrimary)).ratio).toBeGreaterThanOrEqual(4.5);

  await page.goto("/compat/personalized/v6_review.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveCSS("background-color", DARK_PAGE);
  const reviewPrimary = page.locator(".button-primary").first();
  await expect(reviewPrimary).toHaveCSS("background-color", CLINICAL_BLUE);
  expect((await measureContrast(reviewPrimary)).ratio).toBeGreaterThanOrEqual(4.5);
});
