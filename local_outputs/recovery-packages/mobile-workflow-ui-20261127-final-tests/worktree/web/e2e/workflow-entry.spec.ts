import { expect, test } from "@playwright/test";

test("site root opens the workflow and the launcher retains all three tools", async ({ page }) => {
  await page.goto("/?entry=demo#preview");
  await expect(page).toHaveURL(/\/app\/workflow\?entry=demo#preview$/);
  await page.getByRole("link", { name: "返回工具入口", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  const links = page.getByRole("region", { name: "研究工具" }).getByRole("link");
  expect(await links.evaluateAll(items => items.map(item => item.getAttribute("href"))))
    .toEqual(["/live", "/incision", "/app/workflow"]);
  await links.last().click();
  await expect(page).toHaveURL(/\/app\/workflow$/);
});
