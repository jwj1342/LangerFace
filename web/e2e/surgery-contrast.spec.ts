import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

import { measureContrast } from "./contrast";

const MINIMUM_TEXT_CONTRAST = 4.5;

async function expectReadable(locator: Locator, state: string) {
  await expect.poll(
    async () => (await measureContrast(locator)).ratio,
    { message: `${state} contrast for ${await locator.evaluate((element) => element.outerHTML)}` },
  ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
}

test("contrast helper composites ancestor backgrounds and reads placeholder color", async ({ page }) => {
  await page.setContent(`
    <style>
      body { background: rgb(32 32 32); }
      .panel { background: rgb(255 255 255 / 0.5); }
      #sample {
        background: rgb(0 0 0 / 0.25);
        color: rgb(0 0 0);
      }
      #sample::placeholder {
        color: rgb(255 255 255);
        opacity: 1;
      }
    </style>
    <div class="panel">
      <input id="sample" placeholder="contrast probe">
    </div>
  `);

  const sample = page.getByPlaceholder("contrast probe");
  const normal = await measureContrast(sample);
  const placeholder = await measureContrast(sample, "::placeholder");

  // 25% black over 50% white over rgb(32 32 32) resolves to rgb(107.625 ...).
  expect(normal.background.red).toBeCloseTo(107.625, 3);
  expect(normal.background.green).toBeCloseTo(107.625, 3);
  expect(normal.background.blue).toBeCloseTo(107.625, 3);
  expect(normal.foreground.red).toBeCloseTo(0, 3);
  expect(placeholder.foreground.red).toBeCloseTo(255, 3);
  expect(placeholder.ratio).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
  expect(placeholder.ratio).not.toBe(normal.ratio);
});

test("surgery buttons remain readable across loading, hover, pressed, and selected states", async ({ page }) => {
  let releaseFlameBasis = () => {};
  const flameBasisGate = new Promise<void>((resolve) => {
    releaseFlameBasis = resolve;
  });
  await page.route("**/assets/flame_basis.bin", async (route) => {
    await flameBasisGate;
    await route.continue();
  });

  await page.goto("/surgery");

  const execute = page.getByRole("button", { name: "执行闭合模拟" });
  const reset = page.getByRole("button", { name: /复位/ });
  const showLines = page.getByRole("checkbox", { name: "显示 RSTL 张力线" });
  const showLinesButton = showLines.locator("..");

  // WCAG 1.4.3 exempts inactive controls from 4.5:1. Verify the real loading
  // state and its visual affordance, then enforce contrast once controls activate.
  await expect(execute).toBeDisabled();
  await expect(reset).toBeDisabled();
  await expect(execute).toHaveCSS("opacity", "0.45");

  releaseFlameBasis();
  await expect(execute).toBeEnabled();
  await expect(reset).toBeEnabled();

  for (const control of [execute, reset, showLinesButton]) {
    await expectReadable(control, "normal");
    await control.hover();
    await expectReadable(control, "hover");
  }

  const box = await execute.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expectReadable(execute, "pointer-active");
  await page.mouse.up();

  await execute.click();
  await expect(execute).toHaveClass(/active/);
  await expectReadable(execute, "selected-active");
});
