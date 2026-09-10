import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { test, expect } from "@playwright/test";
import { captureMarkerIdentity, assertMarkerIdentity } from "../../tools/marker_runtime_identity.mts";

const reference = JSON.parse(fs.readFileSync(new URL("../../tools/fixtures/controlled_marker_light_skin_10_incomplete.json", import.meta.url), "utf8"));

for (const mobile of [false, true]) {
  test(`completeness repair covers image10 ${mobile ? "mobile viewport" : "desktop"}`, async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const directory = process.env.CONTROLLED_MARKER_REAL_SAMPLE_DIR;
    expect(directory, "image10 source directory is required; do not silently skip this regression").toBeTruthy();
    const source = path.join(directory!, "10.png");
    expect(crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex")).toBe(reference.sourceHash);
    const expected = captureMarkerIdentity("color-difference-v0.35");
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 },
      deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const diagnostics: any[] = [], errors: string[] = [];
    page.on("console", (message) => {
      const prefix = "[LangerFace] controlled marker profile result ";
      if (message.text().startsWith(prefix)) diagnostics.push(JSON.parse(message.text().slice(prefix.length)));
      if (message.text().includes("accepted-candidate comparison failed")) errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    try {
      await page.goto(`${baseURL}/__runtime-identity`);
      await page.waitForFunction(() => "__markerRuntimeProof" in window);
      const proof = await page.evaluate(() => Reflect.get(window, "__markerRuntimeProof"));
      assertMarkerIdentity(proof.identity, expected);
      expect(proof.browser.profile).toBe("color-difference-v0.35");
      await page.goto(`${baseURL}/app/workflow`);
      await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
      await page.locator("#fileInput").setInputFiles(source);
      await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
      await expect(page.locator("#workflowStageStatus")).not.toContainText("请先上传", { timeout: 45_000 });
      await page.locator("#diameterMm").evaluate((element: HTMLInputElement) => {
        element.value = "8";
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "8" }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      await page.getByTitle("点击照片中的受控黑色标记并识别边界").click();
      const canvas = page.locator("#canvas");
      await canvas.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const position = await canvas.evaluate((element: HTMLCanvasElement) => {
        const r = element.getBoundingClientRect(), scale = Math.min(element.width / 1254, element.height / 1254);
        return { x: ((element.width - 1254 * scale) / 2 + 782 * scale) / element.width * r.width,
          y: ((element.height - 1254 * scale) / 2 + 625 * scale) / element.height * r.height };
      });
      if (mobile) {
        await canvas.tap({ position });
        await page.getByTitle("先轻触照片放置扫描圆圈，确认位置后再识别").click();
      } else await canvas.click({ position });
      await expect.poll(() => diagnostics.at(-1), { timeout: 45_000 }).toMatchObject({ profile: "color-difference-v0.35", version: "0.35", result: { ok: true } });
      const actual = diagnostics.at(-1);
      expect(actual.result.warnings).toContain("color_difference_completeness_recovered");
      expect(Math.hypot(actual.seed.x - 782, actual.seed.y - 625)).toBeLessThan(1);
      const overlay = page.locator("[data-workflow-boundary]");
      await expect(overlay).toHaveAttribute("d", /^M /);
      const metrics = await overlay.evaluate((element: SVGGeometryElement, input) => {
        const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
        const rect = canvas.getBoundingClientRect(), scale = Math.min(canvas.width / 1254, canvas.height / 1254);
        const transform = element.getScreenCTM()!.inverse();
        function truthContains(x: number, y: number) {
          const poly = input.boundary;
          let yes = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], b = poly[j];
            if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) yes = !yes;
          }
          return yes;
        }
        let inter = 0, union = 0, predicted = 0, truth = 0, upper = 0, hit = 0;
        for (let y = 569.5; y < 681; y += 1) for (let x = 726.5; x < 838; x += 1) {
          const p = new DOMPoint(rect.left + ((canvas.width - 1254 * scale) / 2 + x * scale) / canvas.width * rect.width,
            rect.top + ((canvas.height - 1254 * scale) / 2 + y * scale) / canvas.height * rect.height).matrixTransform(transform);
          const a = truthContains(x, y), b = element.isPointInFill(p);
          inter += Number(a && b); union += Number(a || b); predicted += Number(b); truth += Number(a);
          if (a && x < input.upperLeftRegion.xLessThan && y < input.upperLeftRegion.yLessThan) { upper += 1; hit += Number(b); }
        }
        return { iou: inter / union, coverage: inter / truth, precision: inter / predicted, upperLeftCoverage: hit / upper };
      }, reference);
      expect(metrics.iou).toBeGreaterThanOrEqual(0.80);
      expect(metrics.coverage).toBeGreaterThanOrEqual(0.84);
      expect(metrics.precision).toBeGreaterThanOrEqual(0.84);
      expect(metrics.upperLeftCoverage).toBeGreaterThanOrEqual(0.90);
      await expect(page.locator("[data-workflow-candidate]")).toHaveAttribute("d", /^M /);
      expect(errors).toEqual([]);
      const identityAfter = await (await page.request.get(`${baseURL}/__runtime-identity.json`)).json();
      assertMarkerIdentity(identityAfter, expected);
      await testInfo.attach("image10-runtime-and-metrics", { body: JSON.stringify({ proof, actual, metrics, errors, referenceKind: reference.kind, humanConfirmed: false }, null, 2), contentType: "application/json" });
      await page.screenshot({ path: testInfo.outputPath("image10-product.png"), fullPage: true });
    } finally { await context.close(); }
  });
}
