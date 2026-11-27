import { expect, test } from "@playwright/test";
import { uploadGeneratedPhoto } from "./support/incisionPhoto";

test.describe("phone workflow layout", () => {
  test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });

  test("original controls remain bound while phone panels switch and resize", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/app/workflow");
    await expect(page.locator(".workflow-workbench")).toHaveAttribute("data-workflow-mobile", "true");
    await expect(page.locator(".mobile-upload-action")).toBeEnabled();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"), page.locator(".mobile-upload-action").click(),
    ]);
    expect(await chooser.element().getAttribute("id")).toBe("fileInput");
    await page.evaluate(() => {
      const target = window as Window & { layoutNodes?: Element[] };
      target.layoutNodes = ["canvas", "wrinkleDetectBtn", "wrinkleAutoRefineBtn", "refine2dBtn", "reviewerName", "saveReviewBtn"]
        .map(id => document.getElementById(id)!);
    });
    const stageBox = await page.locator(".stage").boundingBox();
    for (const name of ["皮肤纹理", "切口设计", "更多"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.locator(".workflow-mobile-sheet")).toBeVisible();
      expect(await page.locator(".workflow-mobile-sheet").evaluate(el => getComputedStyle(el).backgroundColor))
        .toBe("rgba(15, 20, 27, 0.5)");
      expect(await page.locator(".stage").boundingBox()).toEqual(stageBox);
      await page.getByRole("button", { name: "收起操作面板" }).click();
    }
    await page.getByRole("button", { name: "皮肤纹理", exact: true }).click();
    const texture = page.locator('[data-mobile-panel-slot="texture"]');
    await expect(texture.getByRole("checkbox")).toHaveCount(0);
    const rstl = texture.getByRole("button", { name: "RSTL", exact: true });
    const wrinkles = texture.getByRole("button", { name: "皱纹", exact: true });
    await rstl.click();
    await wrinkles.click();
    for (const id of ["wrinkleDetectBtn", "wrinkleAutoRefineBtn", "wrinkleRestoreBtn"]) {
      await expect(texture.locator(`#${id}`)).toBeVisible();
    }
    for (const id of ["refine2dBtn", "refineUndoBtn", "refineResetBtn"]) {
      await expect(texture.locator(`#${id}`)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "图层", exact: true })).toHaveCount(0);
    await expect(rstl).toHaveAttribute("aria-pressed", "false");
    await expect(wrinkles).toHaveAttribute("aria-pressed", "false");
    await rstl.click();
    await wrinkles.click();
    await page.getByRole("button", { name: "切口设计", exact: true }).click();
    const incision = page.locator('[data-mobile-panel-slot="incision"]');
    await expect(incision.locator(".workflow-marker-toggle")).toBeVisible();
    await expect(incision.locator("#reviewerName")).toBeVisible();
    await incision.locator("#reviewerName").fill("测试审阅人");
    await expect(incision.locator("summary").filter({ hasText: "医生审阅" })).toHaveCount(0);
    await incision.locator("summary").filter({ hasText: "切口规划" }).click();
    await expect(incision.locator("#tumorKind")).toBeVisible();
    await incision.locator("summary").filter({ hasText: "候选微调" }).click();
    await expect(incision.locator("#mobileFusiformScale")).toBeVisible();
    await expect(incision.locator("#tumorKind")).toBeHidden();
    await incision.locator("#saveReviewBtn").scrollIntoViewIfNeeded();
    await expect(incision.locator("#saveReviewBtn")).toBeVisible();
    await expect(incision.locator("#reviewState")).toBeHidden();
    await expect(incision.locator("#reviewerName")).toHaveValue("测试审阅人");
    await expect(incision.getByRole("button", { name: "切口线", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "更多", exact: true }).click();
    for (const name of ["暂停", "导出视频", "导出图片"]) {
      await expect(page.locator('[data-mobile-panel-slot="more"]').getByRole("button", { name, exact: true })).toBeVisible();
    }
    for (const width of [320, 393, 560, 1440, 393]) {
      await page.setViewportSize({ width, height: width === 1440 ? 960 : 852 });
      expect(await page.evaluate(() => {
        const target = window as Window & { layoutNodes?: Element[] };
        return target.layoutNodes!.every(node => node === document.getElementById(node.id));
      })).toBe(true);
      if (width <= 560) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const upload = await page.locator(".mobile-upload-action").boundingBox();
        expect(upload!.x + upload!.width / 2).toBeCloseTo(width / 2, 0);
      } else {
        await expect(page.locator(".mobile-workflow-dock")).toHaveCount(0);
        await expect(page.locator(".workflow-live-rail #wrinkleDetectBtn")).toBeVisible();
        await expect(page.locator(".stage-top .workflow-marker-toggle")).toBeVisible();
        await expect(page.locator("#reviewState")).toBeVisible();
      }
    }
    await page.getByRole("button", { name: "收起操作面板" }).click();
    await uploadGeneratedPhoto(page, "single", "#fileInput");
    await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
    await page.getByRole("button", { name: "皮肤纹理", exact: true }).click();
    await expect(page.locator("#wrinkleDetectBtn")).toBeEnabled();
    await expect(page.locator("#refine2dBtn")).toBeEnabled();
    await page.locator("#refine2dBtn").click();
    await expect(page.locator("#refine2dBtn")).toHaveAttribute("aria-pressed", "true");
    const scroller = page.locator(".workflow-mobile-sheet-scroll");
    expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.locator("#refinePointCount").scrollIntoViewIfNeeded();
    await expect(page.locator("#refinePointCount")).toBeInViewport();
    expect((await page.locator(".workflow-mobile-sheet").boundingBox())!.height).toBeLessThan(250);
    await page.screenshot({ path: test.info().outputPath("phone-photo-manual-active.png") });
    await page.getByRole("button", { name: "收起操作面板" }).click();
    await page.getByRole("button", { name: "皮肤纹理", exact: true }).click();
    await expect(page.locator("#refine2dBtn")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#refine2dBtn").click();
    await expect(page.locator("#refine2dBtn")).toHaveAttribute("aria-pressed", "false");
    await page.screenshot({ path: test.info().outputPath("phone-photo-texture.png") });
    await page.getByRole("button", { name: "收起操作面板" }).click();
    await page.screenshot({ path: test.info().outputPath("phone-photo-main.png") });
    // Route disposal must remove moved hosts without leaving stale controller nodes.
    await page.evaluate(() => {
      history.pushState(null, "", "/app/live");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.locator("#wrinkleDetectBtn")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});
