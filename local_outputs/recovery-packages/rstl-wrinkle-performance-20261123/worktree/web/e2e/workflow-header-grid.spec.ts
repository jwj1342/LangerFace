import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("phone workflow header uses a valid single-column grid", async ({ page }) => {
  await page.goto("/app/workflow");
  const header = page.locator(".workflow-workbench .stage-top");
  await expect(header).toBeVisible();
  const layout = await header.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      areas: style.gridTemplateAreas,
      columns: style.gridTemplateColumns,
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(layout.areas).toBe('"incision-status" "workflow-actions"');
  expect(layout.columns.split(" ")).toHaveLength(1);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
});
