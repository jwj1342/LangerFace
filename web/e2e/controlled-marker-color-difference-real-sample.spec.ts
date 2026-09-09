import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const sampleDirectory = process.env.CONTROLLED_MARKER_REAL_SAMPLE_DIR;

interface ReviewedSample {
  id: string;
  fileName: string;
  sourceHash: string;
  sourceSize: number;
  seed: { x: number; y: number };
  truth: {
    centerX: number;
    centerY: number;
    radiusX: number;
    radiusY: number;
    rotationRad: number;
  };
}

interface DetectorDiagnostic {
  profile?: string;
  version?: string;
  seed?: { x: number; y: number };
  result?: unknown;
}

// These ellipses are visually reviewed engineering approximations of the full
// pen rings. They are independent of detector output and are not medical truth.
const reviewedSamples: ReviewedSample[] = JSON.parse(fs.readFileSync(
  new URL("../../tools/fixtures/controlled_marker_browser_samples.local.json", import.meta.url), "utf8",
));
expect(reviewedSamples, "local browser sample manifest must contain all 9 cases").toHaveLength(9);

async function setWorkflowDiameter(page: Page, value: number) {
  await page.locator("#diameterMm").evaluate((input: HTMLInputElement, nextValue: number) => {
    input.value = String(nextValue);
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: String(nextValue),
    }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, value);
}

for (const sample of reviewedSamples) {
  test(`color-difference profile aligns ${sample.id} with its reviewed marker`, async ({ page }, testInfo) => {
    if (!sampleDirectory) {
      throw new Error("set CONTROLLED_MARKER_REAL_SAMPLE_DIR to the local reviewed image directory");
    }
    const samplePath = path.join(sampleDirectory, sample.fileName);
    if (!fs.existsSync(samplePath)) {
      throw new Error(`local reviewed source is missing: ${samplePath}`);
    }

    test.setTimeout(150_000);
    const currentHash = crypto.createHash("sha256").update(fs.readFileSync(samplePath)).digest("hex").toUpperCase();
    expect(currentHash, `${sample.id} source fingerprint changed`).toBe(sample.sourceHash);

    const detectorDiagnostics: DetectorDiagnostic[] = [];
    page.on("console", (message) => {
      const prefix = "[LangerFace] controlled marker profile result ";
      const text = message.text();
      if (!text.startsWith(prefix)) return;
      detectorDiagnostics.push(JSON.parse(text.slice(prefix.length)) as DetectorDiagnostic);
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/app/workflow");
    await expect(page.locator("#workflowStageStatus")).toContainText("切口规划资产已就绪", { timeout: 45_000 });

    await page.locator("#fileInput").setInputFiles(samplePath);
    await expect(page.locator("#livePill")).toContainText("照片", { timeout: 45_000 });
    await expect(page.locator("#workflowStageStatus")).not.toContainText("请先上传", { timeout: 45_000 });
    await setWorkflowDiameter(page, 8);

    await page.evaluate(() => {
      const auditWindow = window as Window & { __colorDifferenceMarkerReasons?: string[] };
      auditWindow.__colorDifferenceMarkerReasons = [];
      window.addEventListener("langerface:incision-state", (event) => {
        const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
        if (reason) auditWindow.__colorDifferenceMarkerReasons?.push(reason);
      });
    });

    await page.getByTitle("点击照片中的受控黑色标记并识别边界").click();
    const canvas = page.locator("#canvas");
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const clickPosition = await canvas.evaluate((canvasElement: HTMLCanvasElement, input) => {
      const rect = canvasElement.getBoundingClientRect();
      const drawScale = Math.min(
        canvasElement.width / input.sourceSize,
        canvasElement.height / input.sourceSize,
      );
      const displayLeft = (canvasElement.width - input.sourceSize * drawScale) / 2;
      const displayTop = (canvasElement.height - input.sourceSize * drawScale) / 2;
      return {
        x: (displayLeft + input.seed.x * drawScale) / canvasElement.width * rect.width,
        y: (displayTop + input.seed.y * drawScale) / canvasElement.height * rect.height,
      };
    }, { sourceSize: sample.sourceSize, seed: sample.seed });
    await canvas.click({ position: clickPosition });
    await expect.poll(() => page.evaluate(() => (
      window as Window & { __colorDifferenceMarkerReasons?: string[] }
    ).__colorDifferenceMarkerReasons?.at(-1) || ""), { timeout: 45_000 })
      .toMatch(/^controlled_marker_(applied|failed)$/);
    const markerReasons = await page.evaluate(() => (
      window as Window & { __colorDifferenceMarkerReasons?: string[] }
    ).__colorDifferenceMarkerReasons || []);
    console.info(`[controlled-marker-diagnostic] ${sample.id} ${JSON.stringify({
      reasons: markerReasons,
      detector: detectorDiagnostics.at(-1),
    })}`);
    expect(markerReasons).toContain("controlled_marker_applied");
    await expect.poll(() => detectorDiagnostics.at(-1)).toMatchObject({
      profile: "color-difference-v0.35",
      version: "0.35",
    });
    const actualSeed = detectorDiagnostics.at(-1)?.seed;
    expect(actualSeed, `${sample.id} detector diagnostic must include the actual source seed`).toBeTruthy();
    expect(Math.hypot(
      Number(actualSeed?.x) - sample.seed.x,
      Number(actualSeed?.y) - sample.seed.y,
    ), `${sample.id} browser click drifted from the frozen source point`).toBeLessThanOrEqual(1);

    const boundary = page.locator("[data-workflow-boundary]");
    await expect.poll(() => boundary.getAttribute("d")).toMatch(/^M /);
    const metrics = await boundary.evaluate((pathElement: SVGGeometryElement, input) => {
      const canvasElement = document.querySelector<HTMLCanvasElement>("#canvas");
      if (!canvasElement) throw new Error("workflow canvas is missing");
      const canvasRect = canvasElement.getBoundingClientRect();
      const screenCtm = pathElement.getScreenCTM();
      if (!screenCtm) throw new Error("workflow boundary has no screen transform");
      const inverseScreenCtm = screenCtm.inverse();
      const drawScale = Math.min(
        canvasElement.width / input.sourceSize,
        canvasElement.height / input.sourceSize,
      );
      const displayLeft = (canvasElement.width - input.sourceSize * drawScale) / 2;
      const displayTop = (canvasElement.height - input.sourceSize * drawScale) / 2;
      const toScreen = (x: number, y: number) => ({
        x: canvasRect.left + (displayLeft + x * drawScale) / canvasElement.width * canvasRect.width,
        y: canvasRect.top + (displayTop + y * drawScale) / canvasElement.height * canvasRect.height,
      });
      const toSource = (x: number, y: number) => ({
        x: (((x - canvasRect.left) / canvasRect.width * canvasElement.width) - displayLeft) / drawScale,
        y: (((y - canvasRect.top) / canvasRect.height * canvasElement.height) - displayTop) / drawScale,
      });
      const toPathPoint = (x: number, y: number) => {
        const screen = toScreen(x, y);
        return new DOMPoint(screen.x, screen.y).matrixTransform(inverseScreenCtm);
      };
      const bbox = pathElement.getBBox();
      const bboxCorners = [
        new DOMPoint(bbox.x, bbox.y),
        new DOMPoint(bbox.x + bbox.width, bbox.y),
        new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height),
        new DOMPoint(bbox.x, bbox.y + bbox.height),
      ].map((point) => point.matrixTransform(screenCtm)).map((point) => toSource(point.x, point.y));
      const cosine = Math.cos(input.truth.rotationRad);
      const sine = Math.sin(input.truth.rotationRad);
      const truthExtentX = Math.hypot(input.truth.radiusX * cosine, input.truth.radiusY * sine);
      const truthExtentY = Math.hypot(input.truth.radiusX * sine, input.truth.radiusY * cosine);
      const margin = 4;
      const scanLeft = Math.max(0, Math.floor(Math.min(
        input.truth.centerX - truthExtentX,
        ...bboxCorners.map((point) => point.x),
      ) - margin));
      const scanRight = Math.min(input.sourceSize - 1, Math.ceil(Math.max(
        input.truth.centerX + truthExtentX,
        ...bboxCorners.map((point) => point.x),
      ) + margin));
      const scanTop = Math.max(0, Math.floor(Math.min(
        input.truth.centerY - truthExtentY,
        ...bboxCorners.map((point) => point.y),
      ) - margin));
      const scanBottom = Math.min(input.sourceSize - 1, Math.ceil(Math.max(
        input.truth.centerY + truthExtentY,
        ...bboxCorners.map((point) => point.y),
      ) + margin));

      let intersection = 0;
      let union = 0;
      let prediction = 0;
      let expected = 0;
      for (let sourceY = scanTop; sourceY <= scanBottom; sourceY += 1) {
        for (let sourceX = scanLeft; sourceX <= scanRight; sourceX += 1) {
          const pathPoint = toPathPoint(sourceX + 0.5, sourceY + 0.5);
          const predicted = pathElement.isPointInFill(pathPoint);
          const dx = sourceX + 0.5 - input.truth.centerX;
          const dy = sourceY + 0.5 - input.truth.centerY;
          const rotatedX = dx * cosine + dy * sine;
          const rotatedY = -dx * sine + dy * cosine;
          const actual = (rotatedX / input.truth.radiusX) ** 2
            + (rotatedY / input.truth.radiusY) ** 2 <= 1;
          if (predicted) prediction += 1;
          if (actual) expected += 1;
          if (predicted && actual) intersection += 1;
          if (predicted || actual) union += 1;
        }
      }
      const predictedCenter = new DOMPoint(
        bbox.x + bbox.width / 2,
        bbox.y + bbox.height / 2,
      ).matrixTransform(screenCtm);
      const expectedCenter = toScreen(input.truth.centerX, input.truth.centerY);
      const widthStart = new DOMPoint(bbox.x, bbox.y + bbox.height / 2).matrixTransform(screenCtm);
      const widthEnd = new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height / 2).matrixTransform(screenCtm);
      const heightStart = new DOMPoint(bbox.x + bbox.width / 2, bbox.y).matrixTransform(screenCtm);
      const heightEnd = new DOMPoint(bbox.x + bbox.width / 2, bbox.y + bbox.height).matrixTransform(screenCtm);
      const sourcePixelsPerDisplayPixel = canvasElement.width / (drawScale * canvasRect.width);
      return {
        centerErrorPx: Math.hypot(
          predictedCenter.x - expectedCenter.x,
          predictedCenter.y - expectedCenter.y,
        ) * sourcePixelsPerDisplayPixel,
        widthPx: Math.hypot(widthEnd.x - widthStart.x, widthEnd.y - widthStart.y)
          * sourcePixelsPerDisplayPixel,
        heightPx: Math.hypot(heightEnd.x - heightStart.x, heightEnd.y - heightStart.y)
          * sourcePixelsPerDisplayPixel,
        iou: intersection / Math.max(1, union),
        truthCoverage: intersection / Math.max(1, expected),
        predictionPrecision: intersection / Math.max(1, prediction),
        scanBounds: { left: scanLeft, right: scanRight, top: scanTop, bottom: scanBottom },
      };
    }, { sourceSize: sample.sourceSize, truth: sample.truth });

    await testInfo.attach(`${sample.id}-reviewed-boundary-metrics`, {
      body: Buffer.from(JSON.stringify({
        sample: sample.id,
        fileName: sample.fileName,
        sourceHash: currentHash,
        truth: sample.truth,
        metrics,
      }, null, 2), "utf8"),
      contentType: "application/json",
    });
    console.info(`[reviewed-boundary-metrics] ${sample.id} ${JSON.stringify(metrics)}`);
    expect(metrics.centerErrorPx).toBeLessThanOrEqual(5);
    expect(metrics.iou).toBeGreaterThanOrEqual(0.8);
    expect(metrics.truthCoverage).toBeGreaterThanOrEqual(0.84);
    expect(metrics.predictionPrecision).toBeGreaterThanOrEqual(0.84);
    await expect(page.locator("[data-workflow-candidate]")).toHaveAttribute("d", /^M /);
    await page.screenshot({
      path: testInfo.outputPath(`${sample.id}-product-result.png`),
      fullPage: true,
    });
  });
}
