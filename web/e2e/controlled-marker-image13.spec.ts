import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";
import {
  assertMarkerIdentity,
  captureMarkerIdentity,
} from "../../tools/marker_runtime_identity.mts";

const SOURCE_HASH = "4484520ade7d94ddf43f57636f0b00733ad062f3a620a5a50b585e43a124cf35";
const SOURCE_SIZE = 1254;
const SEED = { x: 395, y: 715 };

test("image13 removes only the supported narrow spur in the product workflow", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const directory = process.env.CONTROLLED_MARKER_REAL_SAMPLE_DIR;
  expect(directory, "image13 source directory is required; do not silently skip this regression").toBeTruthy();
  const source = path.join(directory!, "13.png");
  expect(crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex")).toBe(SOURCE_HASH);

  const expectedIdentity = captureMarkerIdentity("color-difference-v0.35");
  const identityResponse = await page.request.get(`${baseURL}/__runtime-identity.json`);
  expect(identityResponse.ok()).toBeTruthy();
  const identityBefore = await identityResponse.json();
  assertMarkerIdentity(identityBefore, expectedIdentity);
  expect(identityBefore.diagnosticsEnabled).toBe(true);

  const diagnostics: any[] = [];
  const errors: string[] = [];
  page.on("console", (message) => {
    const prefix = "[LangerFace] controlled marker profile result ";
    if (message.text().startsWith(prefix)) diagnostics.push(JSON.parse(message.text().slice(prefix.length)));
    if (message.text().includes("accepted-candidate comparison failed")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.setViewportSize({ width: 1920, height: 920 });
  await page.goto(`${baseURL}/__runtime-identity`);
  await page.waitForFunction(() => "__markerRuntimeProof" in window);
  const browserProof = await page.evaluate(() => Reflect.get(window, "__markerRuntimeProof"));
  assertMarkerIdentity(browserProof.identity, expectedIdentity);
  expect(browserProof.browser).toMatchObject({ profile: "color-difference-v0.35", implementationVersion: "0.35" });

  await page.goto(`${baseURL}/app/workflow`);
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
  await page.locator("#fileInput").setInputFiles(source);
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
  await page.locator("#diameterMm").evaluate((input: HTMLInputElement) => {
    input.value = "8";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "8" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });

  await page.getByTitle("点击照片中的受控黑色标记并识别边界").click();
  const scan = page.locator('label[title="受控标记扫描直径"] input[type="range"]');
  await scan.focus();
  await scan.press("ArrowRight");
  await expect(page.locator('label[title="受控标记扫描直径"]')).toContainText("扫描 25 mm");

  const canvas = page.locator("#canvas");
  await canvas.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const position = await canvas.evaluate((element: HTMLCanvasElement, input) => {
    const rect = element.getBoundingClientRect();
    const scale = Math.min(element.width / input.sourceSize, element.height / input.sourceSize);
    return {
      x: ((element.width - input.sourceSize * scale) / 2 + input.seed.x * scale) / element.width * rect.width,
      y: ((element.height - input.sourceSize * scale) / 2 + input.seed.y * scale) / element.height * rect.height,
    };
  }, { sourceSize: SOURCE_SIZE, seed: SEED });
  await canvas.click({ position });

  await expect.poll(() => diagnostics.at(-1), { timeout: 60_000 }).toMatchObject({
    profile: "color-difference-v0.35",
    version: "0.35",
    result: {
      ok: true,
      diagnostics: { boundary_regularization: "supported_radial_bridge" },
    },
  });
  const actual = diagnostics.at(-1);
  expect(Math.hypot(actual.seed.x - SEED.x, actual.seed.y - SEED.y)).toBeLessThanOrEqual(1);
  expect(actual.options.scanDiameterMm).toBe(25);
  expect(actual.result.warnings).toContain("boundary_supported_narrow_spur_trimmed");
  expect(actual.result.diagnostics.boundary_regularization_area_ratio).toBeGreaterThanOrEqual(0.97);
  expect(actual.result.diagnostics.boundary_regularization_arc_fraction).toBeLessThanOrEqual(0.10);
  expect(actual.result.diagnostics.boundary_regularization_replacement_support_ratio).toBeGreaterThanOrEqual(0.80);
  expect(actual.result.boundary).toHaveLength(48);
  await expect(page.locator("[data-workflow-boundary]")).toHaveAttribute("d", /^M /);
  await expect(page.locator("[data-workflow-candidate]")).toHaveAttribute("d", /^M /);
  expect(errors).toEqual([]);

  const identityAfter = await (await page.request.get(`${baseURL}/__runtime-identity.json`)).json();
  assertMarkerIdentity(identityAfter, expectedIdentity);
  expect(identityAfter.sourceDigest).toBe(identityBefore.sourceDigest);
  await testInfo.attach("image13-runtime-and-diagnostics", {
    body: JSON.stringify({ identityBefore, browserProof, actual, identityAfter, sourceHash: SOURCE_HASH }, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({ path: testInfo.outputPath("image13-product-25mm.png"), fullPage: true });
});
