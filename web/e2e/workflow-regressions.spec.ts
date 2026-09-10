import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { uploadGeneratedPhoto, uploadGeneratedPhotoWithControlledMarkers } from "./support/incisionPhoto";

async function captureReviewState(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener("langerface:live-state", event => {
      Reflect.set(window, "__pr226Live", (event as CustomEvent).detail);
    });
    window.addEventListener("langerface:incision-state", event => {
      Reflect.set(window, "__pr226Incision", (event as CustomEvent).detail);
    });
  });
}

async function expectActiveOverlay(page: Page, loaded: boolean) {
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__pr226Live")?.incisionOverlay?.loaded)).toBe(loaded);
}

test.beforeEach(async ({ page }, info) => {
  if (!process.env.PR226_B_RUN) return;
  const run = JSON.parse(fs.readFileSync(path.join(process.env.PR226_B_RUN, "identity.json"), "utf8"));
  const v035 = info.title.includes("PR226 v035");
  const expected = v035 ? run.v035 : run.ci;
  const baseURL = v035 ? run.v035URL : run.ciURL;
  const identityPath = v035 ? "/__runtime-identity" : "/pr226-identity.html";
  await page.goto(baseURL + identityPath);
  await expect.poll(() => page.evaluate(() => Boolean(Reflect.get(window, "__markerRuntimeProof")))).toBe(true);
  const proof = await page.evaluate(() => Reflect.get(window, "__markerRuntimeProof"));
  expect(proof.identity).toMatchObject(expected);
  expect(proof.browser).toEqual({ profile: expected.profile, implementationVersion: expected.implementationVersion });
  await info.attach("runtime-identity", { body: Buffer.from(JSON.stringify(proof, null, 2)), contentType: "application/json" });
  await captureReviewState(page);
  await page.route(/wrinkle.*\.onnx|\/api\/wrinkle-v10/, route => route.abort("blockedbyclient"));
});

test.afterEach(async ({ page }, info) => {
  if (!process.env.PR226_B_RUN) return;
  const state = await page.evaluate(() => ({ live: Reflect.get(window, "__pr226Live"), incision: Reflect.get(window, "__pr226Incision"),
    paths: Array.from(document.querySelectorAll("[data-workflow-candidate], [data-workflow-boundary]"), element => element.getAttribute("d")) })).catch(() => ({ unavailable: true }));
  await info.attach("final-state-and-coordinates", { body: Buffer.from(JSON.stringify(state, null, 2)), contentType: "application/json" });
});

async function approveWorkflowCandidate(page: Page) {
  await page.locator("#reviewerName").fill("E2E research reviewer");
  await page.locator("#reviewNotes").fill("Engineering regression only; not clinical approval.");
  await page.locator("#reviewDecision").selectOption("approved_for_discussion");
  await page.locator("#saveReviewBtn").click();
  await expectActiveOverlay(page, true);
}

async function preparePr226PhotoCandidate(page: Page) {
  await uploadGeneratedPhoto(page, "single", "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__pr226Incision")?.workflowTools?.photoReady),
    { timeout: 45_000 }).toBe(true);
  const canvas = page.locator("#canvas");
  await expect(canvas).toHaveAttribute("width", "768");
  await expect(canvas).toHaveAttribute("height", "768");
  await expect(canvas).not.toHaveClass(/mirror/);
  // Photo decoding changes both aspect ratio and layout; measure only after readiness.
  await canvas.click({ trial: true });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("ready workflow photo has no layout box");
  const point = { x: box.width * 0.72, y: box.height * 0.50 };
  await test.info().attach("photo-click-input", { body: Buffer.from(JSON.stringify({
    source: "single-face.jpg", sourceSize: { width: 768, height: 768 }, box, point,
  }, null, 2)), contentType: "application/json" });
  await canvas.click({ position: point });
}

test("PR226 revokes the active review on downgrade removal and clear", async ({ page }) => {
  test.setTimeout(120_000);
  await captureReviewState(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
  await preparePr226PhotoCandidate(page);
  await expect(page.locator("#candidateType")).toContainText("梭形", { timeout: 45_000 });
  await approveWorkflowCandidate(page);
  await approveWorkflowCandidate(page);
  await expect(page.locator("#savedCount")).toHaveText("2");
  await page.locator("#candidateList").getByRole("button", { name: "删除", exact: true }).first().click();
  await expect(page.locator("#savedCount")).toHaveText("1");
  await expectActiveOverlay(page, true);
  await page.locator('[data-candidate-review-toggle="approved_for_discussion"]').click();
  await expectActiveOverlay(page, false);
  // Pending photo geometry is separate from the active live overlay.
  await expect(page.locator("[data-workflow-candidate]")).toHaveAttribute("d", /^M /);
  await page.locator('[data-candidate-review-toggle="pending_clinician_confirmation"]').click();
  await expectActiveOverlay(page, true);
  await page.locator("#candidateList").getByRole("button", { name: "删除", exact: true }).click();
  await expectActiveOverlay(page, false);
  await approveWorkflowCandidate(page);
  await page.locator("#clearSavedBtn").click();
  await page.getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(page.locator("#savedCount")).toHaveText("0");
  await expectActiveOverlay(page, false);
});

for (const mobile of [false, true]) {
  test.describe(`PR226 draft ${mobile ? "mobile" : "desktop"}`, () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 }, hasTouch: mobile, isMobile: mobile });
    test("restores inputs but cannot reload or approve historical candidates", async ({ page }) => {
      test.setTimeout(150_000);
      await captureReviewState(page);
      await page.goto("/app/workflow");
      await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
      await preparePr226PhotoCandidate(page);
      await expect(page.locator("#candidateType")).toContainText("梭形", { timeout: 45_000 });
      await approveWorkflowCandidate(page);
      await expect.poll(() => page.evaluate(() => {
        const draft = JSON.parse(sessionStorage.getItem("langerface:workflow-draft:v1") || "null");
        return draft?.incision?.workspace?.saved?.length;
      })).toBe(1);
      await page.reload();
      await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
      await expect(page.locator("#workflowStageStatus")).toContainText("旧候选仅供审计", { timeout: 45_000 });
      await expectActiveOverlay(page, false);
      await expect(page.locator("#savedCount")).toHaveText("1");
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__pr226Incision")?.candidate ?? null)).toBeNull();
      await page.locator("#candidateList").getByRole("button", { name: "载入", exact: true }).click();
      await expect(page.locator("#workflowStageStatus")).toContainText("历史候选来源已失效");
      await page.locator("[data-candidate-review-toggle]").click();
      await expectActiveOverlay(page, false);
      await page.locator("#saveReviewBtn").click();
      await expect(page.locator("#savedCount")).toHaveText("1");
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__pr226Incision")?.candidate ?? null)).toBeNull();
      // Use an existing, enabled parameter input on both layouts to regenerate.
      const margin = page.locator("#marginMm");
      await margin.scrollIntoViewIfNeeded();
      await expect(margin).toBeEnabled();
      if (mobile) {
        const box = await margin.boundingBox();
        if (!box) throw new Error("mobile margin slider is unavailable");
        const point = { x: box.x + box.width * 0.15, y: box.y + box.height / 2 };
        expect(await margin.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, point)).toBe(true);
        await page.touchscreen.tap(point.x, point.y);
      } else {
        await margin.focus();
        await margin.press("ArrowRight");
        await margin.press("Tab");
      }
      await expect(page.locator("#candidateType")).toContainText("梭形", { timeout: 45_000 });
      await expect(page.locator("#reviewDecision")).toHaveValue("pending_clinician_confirmation");
      await expectActiveOverlay(page, false);
      await page.locator("#candidateList").getByRole("button", { name: "已载入", exact: true }).click();
      await expect(page.locator("#workflowStageStatus")).toContainText("历史候选来源已失效");
    });
  });
}

test("PR226 v035 reviewed original generates and activates a fresh incision", async ({ page }, info) => {
  test.skip(!process.env.PR226_B_RUN, "The original-photo chain runs only in the explicitly authorized B batch.");
  test.setTimeout(150_000);
  const run = JSON.parse(fs.readFileSync(path.join(process.env.PR226_B_RUN!, "identity.json"), "utf8"));
  const samples = JSON.parse(fs.readFileSync(new URL("../../tools/fixtures/controlled_marker_browser_samples.local.json", import.meta.url), "utf8"));
  const sample = run.originalSample ?? samples.find((value: any) => value.id === "15-dark-skin-holdout-chin");
  const original = path.join(run.sampleDirectory, sample.fileName);
  expect(createHash("sha256").update(fs.readFileSync(original)).digest("hex").toUpperCase()).toBe(sample.sourceHash);
  const diagnostics: any[] = [];
  page.on("console", message => {
    const prefix = "[LangerFace] controlled marker profile result ";
    if (message.text().startsWith(prefix)) diagnostics.push(JSON.parse(message.text().slice(prefix.length)));
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(run.v035URL + "/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
  await page.locator("#fileInput").setInputFiles(original);
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__pr226Incision")?.workflowTools?.photoReady),
    { timeout: 45_000 }).toBe(true);
  await expect(page.locator("#canvas")).not.toHaveClass(/mirror/);
  await page.getByTitle("点击照片中的受控黑色标记并识别边界").click();
  await page.locator("#canvas").click({ trial: true });
  const point = await page.locator("#canvas").evaluate((canvas: HTMLCanvasElement, input: any) => {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(canvas.width, canvas.height) / input.sourceSize;
    return { x: ((canvas.width - input.sourceSize * scale) / 2 + input.seed.x * scale) / canvas.width * rect.width,
      y: ((canvas.height - input.sourceSize * scale) / 2 + input.seed.y * scale) / canvas.height * rect.height };
  }, sample);
  await page.locator("#canvas").click({ position: point });
  await expect.poll(() => diagnostics.at(-1), { timeout: 60_000 }).toMatchObject({
    profile: "color-difference-v0.35", version: run.v035.implementationVersion, result: { ok: true },
  });
  await info.attach("original-detection", { body: Buffer.from(JSON.stringify({ sample, point, diagnostics }, null, 2)), contentType: "application/json" });
  expect(Math.hypot(diagnostics.at(-1).seed.x - sample.seed.x, diagnostics.at(-1).seed.y - sample.seed.y)).toBeLessThanOrEqual(1);
  await expect(page.locator("#workflowStageStatus")).toContainText("候选已生成并等待审阅", { timeout: 60_000 });
  expect(diagnostics.some(value => value.profile === "color-difference-v0.35" && value.version === run.v035.implementationVersion)).toBe(true);
  const metrics = await page.locator("[data-workflow-boundary]").evaluate((element: SVGGeometryElement, input: any) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(canvas.width, canvas.height) / input.sourceSize;
    const left = (canvas.width - input.sourceSize * scale) / 2;
    const top = (canvas.height - input.sourceSize * scale) / 2;
    const ctm = element.getScreenCTM();
    if (!ctm) throw new Error("boundary transform unavailable");
    const inverse = ctm.inverse();
    const toSource = (point: DOMPoint) => ({
      x: ((point.x - rect.left) / rect.width * canvas.width - left) / scale,
      y: ((point.y - rect.top) / rect.height * canvas.height - top) / scale,
    });
    const box = element.getBBox();
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
      .map(([x, y]) => toSource(new DOMPoint(x, y).matrixTransform(ctm)));
    const polygon: { x: number; y: number }[] | undefined = input.truthBoundary;
    const truth = input.truth;
    const cosine = Math.cos(truth?.rotationRad ?? 0), sine = Math.sin(truth?.rotationRad ?? 0);
    const extentX = truth ? Math.hypot(truth.radiusX * cosine, truth.radiusY * sine) : 0;
    const extentY = truth ? Math.hypot(truth.radiusX * sine, truth.radiusY * cosine) : 0;
    const truthBounds = polygon ? {
      left: Math.min(...polygon.map(p => p.x)), right: Math.max(...polygon.map(p => p.x)),
      top: Math.min(...polygon.map(p => p.y)), bottom: Math.max(...polygon.map(p => p.y)),
    } : { left: truth.centerX - extentX, right: truth.centerX + extentX,
      top: truth.centerY - extentY, bottom: truth.centerY + extentY };
    function polygonContains(poly: { x: number; y: number }[], x: number, y: number) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    }
    const bounds = {
      left: Math.max(0, Math.floor(Math.min(truthBounds.left, ...corners.map(p => p.x), ...(input.baselineBoundary ?? []).map((p: any) => p.x)) - 4)),
      right: Math.min(input.sourceSize - 1, Math.ceil(Math.max(truthBounds.right, ...corners.map(p => p.x), ...(input.baselineBoundary ?? []).map((p: any) => p.x)) + 4)),
      top: Math.max(0, Math.floor(Math.min(truthBounds.top, ...corners.map(p => p.y), ...(input.baselineBoundary ?? []).map((p: any) => p.y)) - 4)),
      bottom: Math.min(input.sourceSize - 1, Math.ceil(Math.max(truthBounds.bottom, ...corners.map(p => p.y), ...(input.baselineBoundary ?? []).map((p: any) => p.y)) + 4)),
    };
    let intersection = 0, union = 0, prediction = 0, expected = 0;
    let upperExpected = 0, upperHit = 0, baselinePrediction = 0, baselineHit = 0;
    for (let y = bounds.top; y <= bounds.bottom; y += 1) for (let x = bounds.left; x <= bounds.right; x += 1) {
      const point = new DOMPoint(rect.left + (left + (x + 0.5) * scale) / canvas.width * rect.width,
        rect.top + (top + (y + 0.5) * scale) / canvas.height * rect.height).matrixTransform(inverse);
      const predicted = element.isPointInFill(point);
      const dx = x + 0.5 - (truth?.centerX ?? 0), dy = y + 0.5 - (truth?.centerY ?? 0);
      const actual = polygon ? polygonContains(polygon, x + 0.5, y + 0.5)
        : ((dx * cosine + dy * sine) / truth.radiusX) ** 2 + ((-dx * sine + dy * cosine) / truth.radiusY) ** 2 <= 1;
      if (predicted) prediction += 1;
      if (actual) expected += 1;
      if (predicted && actual) intersection += 1;
      if (predicted || actual) union += 1;
      if (actual && input.upperLeftRegion && x + 0.5 < input.upperLeftRegion.xLessThan && y + 0.5 < input.upperLeftRegion.yLessThan) {
        upperExpected += 1;
        if (predicted) upperHit += 1;
      }
      if (input.baselineBoundary && polygonContains(input.baselineBoundary, x + 0.5, y + 0.5)) {
        baselinePrediction += 1;
        if (actual) baselineHit += 1;
      }
    }
    const center = toSource(new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(ctm));
    return { bounds, centerErrorPx: Math.hypot(center.x - (truthBounds.left + truthBounds.right) / 2,
      center.y - (truthBounds.top + truthBounds.bottom) / 2),
      upperLeftCoverage: upperHit / Math.max(1, upperExpected), baselinePrecision: baselineHit / Math.max(1, baselinePrediction),
      iou: intersection / Math.max(1, union), coverage: intersection / Math.max(1, expected), precision: intersection / Math.max(1, prediction) };
  }, sample);
  await info.attach("original-boundary-metrics", { body: Buffer.from(JSON.stringify(metrics, null, 2)), contentType: "application/json" });
  // Keep the existing reviewed-original thresholds; this is engineering truth.
  expect(metrics.centerErrorPx).toBeLessThanOrEqual(5);
  expect(metrics.iou).toBeGreaterThanOrEqual(0.8);
  expect(metrics.coverage).toBeGreaterThanOrEqual(0.84);
  expect(metrics.precision).toBeGreaterThanOrEqual(0.84);
  if (sample.truthBoundary) {
    expect(metrics.upperLeftCoverage).toBeGreaterThanOrEqual(0.90);
    expect(metrics.precision).toBeGreaterThanOrEqual(metrics.baselinePrecision);
  }
  const candidate = page.locator("[data-workflow-candidate]");
  const before = await candidate.getAttribute("d");
  expect(before).toMatch(/^M /);
  await approveWorkflowCandidate(page);
  await expect(candidate).toHaveAttribute("d", before!);
  await expect(page.locator("#reviewDecision")).toHaveValue("approved_for_discussion");
  await page.screenshot({ path: info.outputPath("original-approved-overlay.png"), fullPage: true });
  await info.attach("original-source-and-diagnostics", { body: Buffer.from(JSON.stringify({ sourceHash: sample.sourceHash,
    seed: sample.seed, click: point, diagnostics, metrics, candidate: before }, null, 2)), contentType: "application/json" });
});

async function clickWorkflowCanvasRatio(page: Page, xRatio: number, yRatio: number) {
  const canvas = page.locator("#canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("workflow canvas has no layout box");
  await canvas.click({ position: { x: box.width * xRatio, y: box.height * yRatio } });
}

async function workflowBoundaryBox(page: Page) {
  return page.locator("[data-workflow-boundary]").evaluate((path: SVGGraphicsElement) => {
    const box = path.getBBox();
    return { width: box.width, height: box.height };
  });
}

async function setWorkflowDiameter(page: Page, value: number) {
  await page.locator("#diameterMm").evaluate((input: HTMLInputElement, nextValue: number) => {
    input.value = String(nextValue);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(nextValue) }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, value);
}

function reportWorkflowStage(stage: string) {
  console.log(`[workflow-regression-stage] ${stage}`);
}

test("repeated photo replacement never auto-starts main-thread wrinkle YOLO", async ({ page }) => {
  test.setTimeout(120_000);
  const yoloModelRequests: string[] = [];
  page.on("request", (request) => {
    if (/wrinkle-yolov8s-seg-640\.onnx.*part\d+/i.test(request.url())) {
      yoloModelRequests.push(request.url());
    }
  });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });

  for (let uploadIndex = 0; uploadIndex < 3; uploadIndex += 1) {
    await uploadGeneratedPhoto(page, "single", "#fileInput");
    await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
    await expect(page.locator("#wrinkleStatus")).toHaveText("等待手动检测", { timeout: 45_000 });
    await expect(page.locator("#wrinkleDetectBtn")).toBeEnabled();
    await expect(page.locator("#wrinkleSummary")).toContainText("点击“检测皱纹”后才会检查处理位置并启动 V10");
  }

  // This exceeds the removed delay + idle timeout, proving that an old photo
  // cannot revive a hidden YOLO job after the third replacement.
  await page.waitForTimeout(6_000);
  await expect(page.locator("#wrinkleStatus")).toHaveText("等待手动检测");
  await expect(page.locator("#workflowStageStatus")).toBeVisible();
  expect(yoloModelRequests).toEqual([]);
});

test("workflow keeps reviewed photo geometry stable and reprojects read-only focus views", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
  await uploadGeneratedPhoto(page, "single", "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });

  // New media sources preserve source-photo orientation, so display-space test
  // coordinates now use the established source-photo safe-cheek point directly.
  await clickWorkflowCanvasRatio(page, 0.72, 0.50);
  await expect(page.locator("#candidateType")).toContainText("梭形", { timeout: 45_000 });
  const boundary = page.locator("[data-workflow-boundary]");
  const candidate = page.locator("[data-workflow-candidate]");
  await expect.poll(() => boundary.getAttribute("d")).toMatch(/^M /);
  await expect.poll(() => candidate.getAttribute("d")).toMatch(/^M /);
  await expect(candidate).toHaveCSS("stroke", "rgb(103, 232, 249)");
  await expect(candidate).toHaveCSS("stroke-width", "1px");
  const boundaryBeforeReview = await boundary.getAttribute("d");
  const candidateBeforeReview = await candidate.getAttribute("d");

  await page.locator("#saveReviewBtn").click();
  await expect.poll(() => boundary.getAttribute("d")).toBe(boundaryBeforeReview);
  await expect.poll(() => candidate.getAttribute("d")).toBe(candidateBeforeReview);

  await page.locator("#reviewerName").fill("E2E clinician");
  await page.locator("#reviewNotes").fill("review-state visual parity");
  await page.locator("#reviewDecision").selectOption("approved_for_discussion");
  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#workflowStageStatus")).toContainText("候选已确认并显示在当前画布上", { timeout: 45_000 });
  await expect.poll(() => boundary.getAttribute("d")).toBe(boundaryBeforeReview);
  await expect.poll(() => candidate.getAttribute("d")).toBe(candidateBeforeReview);

  await page.evaluate(() => {
    const state = window as typeof window & {
      __capturedTumorDownload?: { filename: string; href: string };
      __originalTumorAnchorClick?: typeof HTMLAnchorElement.prototype.click;
    };
    state.__originalTumorAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function captureTumorDownload() {
      state.__capturedTumorDownload = { filename: this.download, href: this.href };
    };
  });
  await page.locator("#exportTumorBtn").click();
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & {
    __capturedTumorDownload?: unknown;
  }).__capturedTumorDownload))).toBe(true);
  const tumorDownload = await page.evaluate(async () => {
    const state = window as typeof window & {
      __capturedTumorDownload?: { filename: string; href: string };
      __originalTumorAnchorClick?: typeof HTMLAnchorElement.prototype.click;
    };
    const captured = state.__capturedTumorDownload!;
    const result = {
      filename: captured.filename,
      payload: JSON.parse(await fetch(captured.href).then((response) => response.text())),
    };
    if (state.__originalTumorAnchorClick) HTMLAnchorElement.prototype.click = state.__originalTumorAnchorClick;
    return result;
  });
  expect(tumorDownload.filename).toMatch(/^tumor_input_\d+\.json$/);
  expect(tumorDownload.payload).toMatchObject({
    schema_version: "tumor-input/v0.2",
    privacy_audit: { contains_face_image: false },
  });

  const legend = page.getByLabel("切口标注图例");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("病灶中心");
  await expect(legend).toContainText("肿物范围");

  await page.getByRole("button", { name: "进入左眼周局部微调" }).click();
  await expect.poll(() => candidate.getAttribute("d")).not.toBe(candidateBeforeReview);
  await clickWorkflowCanvasRatio(page, 0.50, 0.50);
  await expect(page.locator("#workflowStageStatus")).toContainText("局部放大图仅用于核对同一面部位置");
  await page.getByRole("button", { name: "返回全脸视图" }).click();
  await expect.poll(() => boundary.getAttribute("d")).toBe(boundaryBeforeReview);
  await expect.poll(() => candidate.getAttribute("d")).toBe(candidateBeforeReview);
});

test("disabled workflow hints use a two-second mouse, touch, and keyboard release window", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
  await expect(page.locator("#privacyState")).toHaveText("设备本地");
  await expect(page.locator("#privacyAudit")).toHaveText(
    "原始照片仅在当前设备中处理，不随候选记录上传；记录仅保留 9 类必要参数。",
  );

  const boundaryMode = page.getByLabel("皮表边界");
  await boundaryMode.selectOption("freehand");
  await expect(boundaryMode).toHaveValue("freehand");

  const diameterMessage = "当前肿物范围由已绘制或已识别的边界决定，直径参数暂不参与候选生成。";
  const diameterHintTarget = page.getByRole("button", { name: diameterMessage });
  const diameterTooltip = page.getByRole("tooltip", { name: diameterMessage });
  await expect(page.getByLabel("直径 mm")).toBeDisabled();
  await diameterHintTarget.hover();
  await expect(diameterTooltip).toBeVisible();
  await diameterHintTarget.click({ force: true });
  await page.waitForTimeout(1_500);
  await expect(diameterTooltip).toBeVisible();
  await expect(diameterTooltip).toBeHidden({ timeout: 2_000 });
  await page.mouse.move(320, 920);
  await diameterHintTarget.hover();
  await expect(diameterTooltip).toBeVisible();
  await page.mouse.move(320, 920);
  await expect(diameterTooltip).toBeHidden();
  await diameterHintTarget.dispatchEvent("pointerdown", {
    bubbles: true, pointerId: 17, pointerType: "touch", isPrimary: true,
  });
  await diameterHintTarget.dispatchEvent("pointerup", {
    bubbles: true, pointerId: 17, pointerType: "touch", isPrimary: true,
  });
  await diameterHintTarget.dispatchEvent("click", { bubbles: true, detail: 1 });
  await page.waitForTimeout(1_500);
  await expect(diameterTooltip).toBeVisible();
  await expect(diameterTooltip).toBeHidden({ timeout: 2_000 });

  const markerMessage = "当前肿物边界由“自由轮廓鼠绘”的曲线决定，受控标记暂不参与候选生成；请切换为“椭圆近似”模式后使用。";
  const markerButton = page.getByRole("button", { name: "受控标记", exact: true });
  const markerTooltip = page.getByRole("tooltip", { name: markerMessage });
  await expect(markerButton).toHaveAttribute("aria-disabled", "true");
  await markerButton.hover();
  await markerButton.click({ force: true });
  await page.waitForTimeout(1_500);
  await expect(markerTooltip).toBeVisible();
  await expect(markerTooltip).toBeHidden({ timeout: 2_000 });
  await markerButton.dispatchEvent("pointerdown", {
    bubbles: true, pointerId: 18, pointerType: "touch", isPrimary: true,
  });
  await markerButton.dispatchEvent("pointerup", {
    bubbles: true, pointerId: 18, pointerType: "touch", isPrimary: true,
  });
  await markerButton.dispatchEvent("click", { bubbles: true, detail: 1 });
  await page.waitForTimeout(1_500);
  await expect(markerTooltip).toBeVisible();
  await expect(markerTooltip).toBeHidden({ timeout: 2_000 });

  await markerButton.evaluate((button: HTMLButtonElement) => button.blur());
  await markerButton.focus();
  await expect(markerTooltip).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1_500);
  await expect(markerTooltip).toBeVisible();
  await expect(markerTooltip).toBeHidden({ timeout: 2_000 });
  await markerButton.evaluate((button: HTMLButtonElement) => button.blur());
  await markerButton.focus();
  await expect(markerTooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(markerTooltip).toBeHidden();
  await expect(markerButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#workflowStageStatus")).toHaveText(markerMessage);
});

test("merged workflow preserves incision geometry, warning priority, and RSTL refresh ownership", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });

  await uploadGeneratedPhoto(page, "single", "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
  await expect(page.locator("#workflowStageStatus")).not.toContainText("请先上传", { timeout: 45_000 });
  await expect(page.locator("#privacyState")).toHaveText("设备本地");
  await expect(page.locator("#privacyAudit")).toHaveText(
    "原始照片仅在当前设备中处理，不随候选记录上传；记录仅保留 9 类必要参数。",
  );
  reportWorkflowStage("photo-ready");

  await clickWorkflowCanvasRatio(page, 0.32, 0.52);
  await expect(page.locator("#candidateType")).toContainText("梭形", { timeout: 45_000 });
  await expect(page.locator("#candidateLength")).toContainText("24.0 mm");
  await expect.poll(() => page.locator("[data-workflow-boundary]").getAttribute("d"))
    .toMatch(/^M /);
  const cheekBoundary = await workflowBoundaryBox(page);

  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#workflowStageStatus")).toHaveText("保存候选记录前请填写审阅人。");
  await expect(page.locator("#reviewerName")).toHaveAttribute("aria-invalid", "true");
  await page.locator("#reviewerName").fill("E2E clinician");
  await expect(page.locator("#reviewerName")).not.toHaveAttribute("aria-invalid", "true");

  await setWorkflowDiameter(page, 2);
  await expect(page.locator("#candidateLength")).toContainText("6.0 mm");
  await setWorkflowDiameter(page, 3);
  await expect(page.locator("#candidateLength")).toContainText("9.0 mm");
  await setWorkflowDiameter(page, 8);
  await expect(page.locator("#candidateLength")).toContainText("24.0 mm");
  reportWorkflowStage("reviewer-cue-and-small-diameters-pass");

  await clickWorkflowCanvasRatio(page, 0.50, 0.30);
  await expect(page.locator("#candidateType")).toContainText("梭形", { timeout: 45_000 });
  await expect(page.locator("#candidateLength")).toContainText("24.0 mm");
  const foreheadBoundary = await workflowBoundaryBox(page);
  expect(Math.abs(foreheadBoundary.width - cheekBoundary.width) / cheekBoundary.width).toBeLessThan(0.08);
  expect(Math.abs(foreheadBoundary.height - cheekBoundary.height) / cheekBoundary.height).toBeLessThan(0.08);
  expect(foreheadBoundary.height / foreheadBoundary.width).toBeGreaterThan(0.82);
  reportWorkflowStage("forehead-geometry-pass");

  // The source-photo left edge remains on the left in anatomical orientation.
  // Only the continuous on-face portion may be blue; a general face-edge exit
  // must never borrow the sensitive red layer.
  await clickWorkflowCanvasRatio(page, 0.10, 0.55);
  await expect(page.locator("#workflowStageStatus")).toHaveText(
    "已识别肿物边界，当前为视野受限参考，不能确认完整长度及不可见区域，请结合另一视角复核",
    { timeout: 45_000 },
  );
  await expect.poll(() => page.locator("[data-workflow-candidate]").getAttribute("d")).toMatch(/^M /);
  await expect(page.locator("[data-workflow-diagnostic-candidate]")).toHaveAttribute("d", "");

  await page.locator("#reviewDecision").selectOption("approved_for_discussion");
  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#workflowStageStatus")).toHaveText(
    "当前为视野受限参考：可保存为待确认草案；补充另一视角并复核隐藏区域后，方可确认或进入实时叠加。",
  );
  await expect(page.locator("#reviewDecision")).toHaveAttribute("aria-invalid", "true");
  reportWorkflowStage("limited-visibility-review-cue-pass");

  await page.evaluate(() => {
    const auditWindow = window as Window & { __workflowSourceReasons?: string[] };
    auditWindow.__workflowSourceReasons = [];
    window.addEventListener("langerface:incision-state", (event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason) auditWindow.__workflowSourceReasons?.push(reason);
    });
  });
  await uploadGeneratedPhoto(page, "single", "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
  await expect(page.locator("#candidateType")).toHaveText("—");
  await expect(page.locator("[data-workflow-boundary]")).toHaveAttribute("d", "");
  await expect(page.locator("[data-workflow-candidate]")).toHaveAttribute("d", "");
  await expect(page.locator("[data-workflow-diagnostic-candidate]")).toHaveAttribute("d", "");
  await expect(page.locator("#reviewDecision")).not.toHaveAttribute("aria-invalid", "true");
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workflowSourceReasons?: string[] }
  ).__workflowSourceReasons || [])).toContain("workflow_source_changed");
  reportWorkflowStage("photo-replacement-clear-pass");

  await expect.poll(async () => page.locator("#wrinkleStatus").textContent(), { timeout: 45_000 })
    .not.toMatch(/检测中|正在/);
  await page.evaluate(() => {
    const auditWindow = window as Window & { __workflowLiveEvents?: unknown[] };
    auditWindow.__workflowLiveEvents = [];
    window.addEventListener("langerface:live-state", (event) => {
      auditWindow.__workflowLiveEvents?.push((event as CustomEvent).detail);
    });
  });
  await page.locator("#diameterMm").evaluate((input: HTMLInputElement) => {
    for (const value of ["13", "14", "15", "16"]) {
      input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
  });
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workflowLiveEvents?: unknown[] }
  ).__workflowLiveEvents?.length || 0)).toBe(0);
  reportWorkflowStage("incision-parameter-isolation-pass");

  await setWorkflowDiameter(page, 8);
  await clickWorkflowCanvasRatio(page, 0.50, 0.64);
  await expect(page.locator("#workflowStageStatus")).toHaveText(
    "红色虚线仅供查看被阻断的轮廓：候选切口经过眼裂、口裂或鼻孔；候选切口进入默认唇红保护区域。不可确认、保存或用于实时叠加；请调整位置或范围。",
    { timeout: 45_000 },
  );
  await expect.poll(() => page.locator("[data-workflow-diagnostic-candidate]").getAttribute("d")).toMatch(/^M /);
  await expect(page.locator("#savedCount")).toHaveText("0");
  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#workflowStageStatus")).toHaveText(
    "红色虚线表示候选已被规则阻断；记录本次阻断审阅前请填写审阅备注。",
  );
  await expect(page.locator("#reviewNotes")).toHaveAttribute("aria-invalid", "true");
  await page.locator("#reviewNotes").fill("敏感开口阻断已人工复核");
  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#workflowStageStatus")).toHaveText(
    "未保存审阅记录：已记录本次规则阻断的备注，但红色虚线仅作阻断参考，不能加入候选库。",
  );
  await expect(page.locator("#savedCount")).toHaveText("0");
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect.poll(() => page.locator("#workflowStageStatus").evaluate((status) => {
    const text = status.querySelector("span:last-child") as HTMLElement | null;
    const style = getComputedStyle(status);
    return text !== null
      && style.whiteSpace === "normal"
      && style.overflow === "visible"
      && text.scrollWidth <= text.clientWidth + 1;
  })).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1000 });
  reportWorkflowStage("diagnostic-note-and-full-status-pass");

  await uploadGeneratedPhotoWithControlledMarkers(page, [{
    xRatio: 0.32,
    yRatio: 0.52,
    interiorRetrace: true,
    strokeOpacity: 0.3,
  }], "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
  await setWorkflowDiameter(page, 8);

  await page.evaluate(() => {
    const auditWindow = window as Window & { __workflowMarkerReasons?: string[] };
    auditWindow.__workflowMarkerReasons = [];
    window.addEventListener("langerface:incision-state", (event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason) auditWindow.__workflowMarkerReasons?.push(reason);
    });
  });

  const boundaryMode = page.getByLabel("皮表边界");
  await boundaryMode.selectOption("freehand");
  await expect(boundaryMode).toHaveValue("freehand");
  const diameterMessage = "当前肿物范围由已绘制或已识别的边界决定，直径参数暂不参与候选生成。";
  const diameterSlider = page.getByLabel("直径 mm");
  const diameterHintTarget = page.getByRole("button", { name: diameterMessage });
  const diameterTooltip = page.getByRole("tooltip", { name: diameterMessage });
  await expect(diameterSlider).toBeDisabled();
  await expect(diameterHintTarget).toHaveAttribute("aria-disabled", "true");
  await expect(diameterHintTarget).not.toHaveAttribute("title", diameterMessage);
  await diameterHintTarget.hover();
  await expect(diameterTooltip).toBeVisible();
  await diameterHintTarget.click({ force: true });
  await expect(diameterTooltip).toBeVisible();
  await expect(page.locator("#workflowStageStatus")).toHaveText(diameterMessage);
  await expect(diameterTooltip).toBeHidden({ timeout: 3_500 });
  await page.mouse.move(320, 920);
  await diameterHintTarget.hover();
  await expect(diameterTooltip).toBeVisible();
  await page.mouse.move(320, 920);
  await expect(diameterTooltip).toBeHidden();
  if (process.env.WORKFLOW_DISABLED_EVIDENCE_PATH) {
    await page.screenshot({ path: process.env.WORKFLOW_DISABLED_EVIDENCE_PATH, fullPage: true });
  }

  const unavailableMarkerButton = page.getByRole("button", { name: "受控标记", exact: true });
  const freehandMarkerMessage = "当前肿物边界由“自由轮廓鼠绘”的曲线决定，受控标记暂不参与候选生成；请切换为“椭圆近似”模式后使用。";
  const markerTooltip = page.getByRole("tooltip", { name: freehandMarkerMessage });
  await expect(unavailableMarkerButton).toHaveAttribute("aria-disabled", "true");
  await expect(unavailableMarkerButton).not.toHaveAttribute("title", freehandMarkerMessage);
  await expect(unavailableMarkerButton).not.toHaveAttribute("disabled", "");
  await unavailableMarkerButton.hover();
  await expect(markerTooltip).toBeVisible();
  // Playwright intentionally treats aria-disabled as non-actionable, while a
  // real browser still dispatches click/tap without the native disabled flag.
  await unavailableMarkerButton.click({ force: true });
  await expect(markerTooltip).toBeVisible();
  await expect(diameterTooltip).toBeHidden();
  await expect(page.locator("#workflowStageStatus")).toHaveText(freehandMarkerMessage);
  await expect(unavailableMarkerButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workflowMarkerReasons?: string[] }
  ).__workflowMarkerReasons || [])).toContain("controlled_marker_freehand_blocked");
  await expect(markerTooltip).toBeHidden({ timeout: 3_500 });
  await boundaryMode.selectOption("ellipse");
  await expect(boundaryMode).toHaveValue("ellipse");
  await expect(markerTooltip).toBeHidden();
  reportWorkflowStage("freehand-controlled-marker-block-pass");

  const markerButton = page.getByTitle("点击照片中的受控黑色标记并识别边界");
  await expect(markerButton).toContainText("受控标记");
  await markerButton.click();
  await expect(markerButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-workflow-marker-scan-circle]")).toHaveCSS("stroke-dasharray", "none");
  await clickWorkflowCanvasRatio(page, 0.32, 0.52);
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workflowMarkerReasons?: string[] }
  ).__workflowMarkerReasons || []), { timeout: 45_000 }).toContain("controlled_marker_applied");
  await expect(page.locator("#workflowStageStatus")).not.toContainText("只识别到局部轮廓");
  await expect.poll(() => page.locator("[data-workflow-boundary]").getAttribute("d")).toMatch(/^M /);
  await expect(boundaryMode).toHaveValue("ellipse");
  if (process.env.WORKFLOW_DETECTION_EVIDENCE_PATH) {
    await page.screenshot({ path: process.env.WORKFLOW_DETECTION_EVIDENCE_PATH, fullPage: true });
  }
  reportWorkflowStage("low-contrast-divided-marker-and-ellipse-mode-pass");
  await expect(markerButton).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const auditWindow = window as Window & { __workflowIncisionReasons?: string[] };
    auditWindow.__workflowIncisionReasons = [];
    window.addEventListener("langerface:incision-state", (event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason) auditWindow.__workflowIncisionReasons?.push(reason);
    });
  });
  await clickWorkflowCanvasRatio(page, 0.50, 0.64);
  await expect(page.locator("#workflowStageStatus")).toContainText(
    /识别范围进入眼裂、口裂或鼻孔等非皮肤开口|当前区域有多个可能的肿物范围/,
    { timeout: 45_000 },
  );
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __workflowIncisionReasons?: string[] }).__workflowIncisionReasons || []
  ).some((reason) => reason === "controlled_marker_opening_scan_rejected" || reason === "controlled_marker_failed")))
    .toBe(true);
  await expect(page.locator("[data-workflow-boundary]")).toHaveAttribute("d", "");
  await expect(page.locator("[data-workflow-candidate]")).toHaveAttribute("d", "");
  reportWorkflowStage("mouth-opening-gate-pass");

  await page.evaluate(() => {
    (window as Window & { __workflowIncisionReasons?: string[] }).__workflowIncisionReasons = [];
  });
  await clickWorkflowCanvasRatio(page, 0.66, 0.37);
  await expect(page.locator("#workflowStageStatus")).toContainText(
    /识别范围进入眼裂、口裂或鼻孔等非皮肤开口|当前区域有多个可能的肿物范围/,
    { timeout: 45_000 },
  );
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __workflowIncisionReasons?: string[] }).__workflowIncisionReasons || []
  ).some((reason) => reason === "controlled_marker_opening_scan_rejected" || reason === "controlled_marker_failed")))
    .toBe(true);
  await expect(page.locator("[data-workflow-boundary]")).toHaveAttribute("d", "");
  await expect(page.locator("[data-workflow-candidate]")).toHaveAttribute("d", "");
  reportWorkflowStage("eye-opening-gate-pass");
});

test("subcutaneous overlay stays centered and cutaneous scan follows diameter", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/app/workflow");
  await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });
  await uploadGeneratedPhoto(page, "single", "#fileInput");
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });

  await page.locator("#tumorKind").selectOption("subcutaneous");
  await page.locator("#diameterMm").evaluate((input: HTMLInputElement) => {
    input.value = "39";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "39" }));
    input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await clickWorkflowCanvasRatio(page, 0.50, 0.15);
  await expect(page.locator("#candidateType")).toContainText("线性", { timeout: 45_000 });
  await expect(page.locator("#workflowStageStatus")).toContainText("草案长度上限 35.0 mm", { timeout: 45_000 });
  await expect.poll(() => page.locator("[data-workflow-candidate]").getAttribute("d")).toMatch(/^M /);
  const centerDistance = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>("[data-workflow-candidate]");
    const center = document.querySelector<SVGCircleElement>("[data-workflow-center]");
    const values = (path?.getAttribute("d") || "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    const pairs = Array.from({ length: Math.floor(values.length / 2) }, (_, index) => [
      values[index * 2], values[index * 2 + 1],
    ]);
    const cx = Number(center?.getAttribute("cx"));
    const cy = Number(center?.getAttribute("cy"));
    return Math.min(...pairs.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  });
  expect(centerDistance).toBeLessThan(0.2);

  await page.locator("#tumorKind").selectOption("cutaneous");
  await page.locator("#diameterMm").evaluate((input: HTMLInputElement) => {
    input.value = "33";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "33" }));
    input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await page.getByTitle("点击照片中的受控黑色标记并识别边界").click();
  const scan = page.locator(".workflow-marker-scan input[type=range]");
  await expect(scan).toHaveAttribute("min", "10");
  await expect(scan).toHaveAttribute("max", "60");
  await expect(scan).toHaveAttribute("step", "5");
  // The fixed slider endpoint is not the tumor-dependent detection minimum.
  await expect.poll(async () => Number(await scan.inputValue())).toBeGreaterThanOrEqual(40);
  await scan.focus();
  await scan.press("Home");
  await expect(scan).toHaveValue("10");
  await page.evaluate(() => {
    const auditWindow = window as Window & { __scanCoverageReasons?: string[] };
    auditWindow.__scanCoverageReasons = [];
    window.addEventListener("langerface:incision-state", (event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason) auditWindow.__scanCoverageReasons?.push(reason);
    });
  });
  await clickWorkflowCanvasRatio(page, 0.32, 0.52);
  await expect(page.locator("#workflowStageStatus")).toHaveText(
    "当前 10 mm 扫描面小于肿物直径所需覆盖范围，请扩大到至少 40 mm 后重试。",
  );
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __scanCoverageReasons?: string[] }
  ).__scanCoverageReasons || [])).toContain("controlled_marker_scan_too_small");
});
