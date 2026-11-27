import { expect, test } from "@playwright/test";
import { uploadGeneratedPhoto, uploadGeneratedPhotoWithControlledMarkers } from "./support/incisionPhoto";

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

  test("lower photo marker placement stays reachable and confirms recognition", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/app/workflow");
    await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
    await uploadGeneratedPhotoWithControlledMarkers(page,
      [{ xRatio: 0.72, yRatio: 0.75, radiusRatio: 0.02, filled: true }], "#fileInput");
    await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
    await page.getByRole("button", { name: "切口设计", exact: true }).tap();
    const toggle = page.locator(".workflow-marker-toggle");
    const canvas = page.locator("#canvas");
    const before = await canvas.boundingBox();
    await toggle.tap();
    await expect(page.locator(".workflow-mobile-sheet")).toBeHidden();
    const tools = page.locator(".workflow-mobile-marker-tools");
    await expect(tools.locator(".workflow-marker-toggle")).toHaveText("退出标记");
    const confirm = tools.getByRole("button", { name: "识别已放置圆圈内的肿物" });
    await expect(confirm).toBeDisabled();
    expect(await canvas.boundingBox()).toEqual(before);
    // This is the exact lower-photo touch that the former sheet intercepted.
    expect(await canvas.evaluate(el => {
      const box = el.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width * 0.5, box.top + box.height * 0.75) === el;
    })).toBe(true);
    const box = await canvas.boundingBox();
    await canvas.tap({ position: { x: box!.width * 0.5, y: box!.height * 0.75 } });
    await expect(confirm).toBeEnabled();
    // Also place on the actual cheek marker, at the same lower-photo height.
    await canvas.tap({ position: { x: box!.width * 0.72, y: box!.height * 0.75 } });
    await expect(page.locator("[data-workflow-marker-scan]")).toBeVisible();
    const toolBox = await tools.boundingBox();
    expect(toolBox!.y).toBeGreaterThanOrEqual(box!.y + box!.height);
    await page.screenshot({ path: test.info().outputPath("lower-photo-marker-ready.png") });
    await confirm.tap();
    await expect(page.locator("[data-workflow-boundary]")).toHaveAttribute("d", /^M /, { timeout: 45_000 });
    await expect(page.locator("[data-workflow-candidate]")).toHaveAttribute("d", /^M /, { timeout: 45_000 });
    await page.screenshot({ path: test.info().outputPath("lower-photo-marker-recognized.png") });
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".mobile-upload-action")).toBeVisible();
    await page.getByRole("button", { name: "切口设计", exact: true }).tap();
    await expect(page.locator('[data-mobile-panel-slot="incision"] .workflow-marker-toggle')).toBeVisible();
  });


  test("small phone pending marker controls fit and cancellation preserves retry", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.addInitScript(() => {
      Reflect.set(window, "holdMarkerRecognition", true);
      Reflect.set(window, "heldMarkerRequests", 0);
      const OriginalWorker = window.Worker;
      Object.defineProperty(window, "Worker", { value: class extends OriginalWorker {
        postMessage(message: unknown, transfer: Transferable[] = []) {
          const call = message as { type?: string; path?: string[] };
          // Hold only this real detector request; diagnostics and all other work run normally.
          if (call.type === "APPLY" && call.path?.[0] === "detectControlledMarker"
            && Reflect.get(window, "holdMarkerRecognition")) {
            Reflect.set(window, "heldMarkerRequests", Reflect.get(window, "heldMarkerRequests") + 1);
            return;
          }
          super.postMessage(message, transfer);
        }
      } });
    });
    await page.goto("/app/workflow");
    await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
    await uploadGeneratedPhotoWithControlledMarkers(page,
      [{ xRatio: 0.72, yRatio: 0.75, radiusRatio: 0.02, filled: true }], "#fileInput");
    await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
    await page.getByRole("button", { name: "切口设计", exact: true }).tap();
    await page.locator(".workflow-marker-toggle").tap();
    const canvas = page.locator("#canvas");
    const box = await canvas.boundingBox();
    await canvas.tap({ position: { x: box!.width * 0.72, y: box!.height * 0.75 } });
    const tools = page.locator(".workflow-mobile-marker-tools");
    const confirm = tools.getByRole("button", { name: "识别已放置圆圈内的肿物" });
    await expect(confirm).toBeEnabled();
    await confirm.tap();
    await expect(tools.locator(".workflow-canvas-tools")).toHaveAttribute("data-marker-busy", "true");
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "heldMarkerRequests"))).toBe(1);
    const slider = tools.locator(".workflow-marker-scan input");
    const cancel = tools.getByRole("button", { name: "取消当前肿物识别" });
    await expect(slider).toBeDisabled();
    await expect(confirm).toBeDisabled();
    for (const width of [320, 393, 560, 320]) {
      await page.setViewportSize({ width, height: 640 });
      const bounds = await tools.evaluate(el => {
        const rect = (selector: string) => {
          const box = el.querySelector(selector)!.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        };
        return { scan: rect(".workflow-marker-scan"), slider: rect(".workflow-marker-scan input"),
          confirm: rect(".workflow-mobile-marker-confirm"), cancel: rect(".workflow-marker-cancel") };
      });
      for (const rect of Object.values(bounds)) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width);
        expect(rect.bottom).toBeLessThanOrEqual(640);
      }
      expect(bounds.confirm.right).toBeLessThanOrEqual(bounds.scan.left);
      expect(bounds.slider.right).toBeLessThanOrEqual(bounds.scan.right);
    }
    await page.screenshot({ path: test.info().outputPath("phone-320-pending-marker.png") });
    await cancel.tap();
    await expect(tools.locator(".workflow-canvas-tools")).toHaveAttribute("data-marker-busy", "false");
    await expect(page.locator("[data-workflow-marker-scan]")).toBeVisible();
    await expect(confirm).toBeEnabled();
    await expect(slider).toBeEnabled();
    await page.evaluate(() => Reflect.set(window, "holdMarkerRecognition", false));
    await confirm.tap();
    await expect(page.locator("[data-workflow-boundary]")).toHaveAttribute("d", /^M /, { timeout: 45_000 });
    await expect(page.locator("[data-workflow-candidate]")).toHaveAttribute("d", /^M /, { timeout: 45_000 });
    await page.screenshot({ path: test.info().outputPath("phone-320-marker-retry.png") });
  });

});
