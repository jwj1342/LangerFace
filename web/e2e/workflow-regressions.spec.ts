import { expect, test, type Page } from "@playwright/test";

import { uploadGeneratedPhoto, uploadGeneratedPhotoWithControlledMarkers } from "./support/incisionPhoto";

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
    await expect(page.locator("#wrinkleSummary")).toContainText("请点击“检测皱纹”");
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

  // The merged canvas is mirrored by default; this is the displayed counterpart
  // of the established source-photo safe-cheek point used by incision E2E tests.
  await clickWorkflowCanvasRatio(page, 0.28, 0.50);
  await expect(page.locator("#candidateType")).toContainText("梭形", { timeout: 45_000 });
  const boundary = page.locator("[data-workflow-boundary]");
  const candidate = page.locator("[data-workflow-candidate]");
  await expect.poll(() => boundary.getAttribute("d")).toMatch(/^M /);
  await expect.poll(() => candidate.getAttribute("d")).toMatch(/^M /);
  const boundaryBeforeReview = await boundary.getAttribute("d");
  const candidateBeforeReview = await candidate.getAttribute("d");

  await page.locator("#saveReviewBtn").click();
  await expect.poll(() => boundary.getAttribute("d")).toBe(boundaryBeforeReview);
  await expect.poll(() => candidate.getAttribute("d")).toBe(candidateBeforeReview);

  await page.locator("#reviewerName").fill("E2E clinician");
  await page.locator("#reviewNotes").fill("review-state visual parity");
  await page.locator("#reviewDecision").selectOption("approved_for_discussion");
  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#workflowStageStatus")).toContainText("自动激活", { timeout: 45_000 });
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
  await expect(legend).toContainText("候选切口");
  await expect(legend).toContainText("端点控制");

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

  await clickWorkflowCanvasRatio(page, 0.68, 0.52);
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

  // The mirrored right edge maps to the visible left cheek silhouette in the
  // authorized single-face fixture. Only the continuous on-face portion may be
  // blue; a general face-edge exit must never borrow the sensitive red layer.
  await clickWorkflowCanvasRatio(page, 0.90, 0.55);
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
    "红色虚线表示候选进入敏感开口，已阻断且不会保存；请调整位置或范围。",
    { timeout: 45_000 },
  );
  await expect.poll(() => page.locator("[data-workflow-diagnostic-candidate]").getAttribute("d")).toMatch(/^M /);
  await expect(page.locator("#savedCount")).toHaveText("0");
  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#workflowStageStatus")).toHaveText(
    "红色虚线表示候选进入敏感开口；记录本次阻断审阅前请填写审阅备注。",
  );
  await expect(page.locator("#reviewNotes")).toHaveAttribute("aria-invalid", "true");
  await page.locator("#reviewNotes").fill("敏感开口阻断已人工复核");
  await page.locator("#saveReviewBtn").click();
  await expect(page.locator("#workflowStageStatus")).toHaveText(
    "已记录本次敏感开口阻断的审阅备注；红色虚线不是候选，未加入候选库。",
  );
  await expect(page.locator("#savedCount")).toHaveText("0");
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect.poll(() => page.locator("#workflowStageStatus").evaluate((status) => {
    const text = status.querySelector("span:last-child") as HTMLElement | null;
    const style = getComputedStyle(status);
    return Boolean(text)
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
  await clickWorkflowCanvasRatio(page, 0.68, 0.52);
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
    "识别范围进入眼裂、口裂或鼻孔等非皮肤开口",
    { timeout: 45_000 },
  );
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workflowIncisionReasons?: string[] }
  ).__workflowIncisionReasons || [])).toContain("controlled_marker_opening_scan_rejected");
  reportWorkflowStage("mouth-opening-gate-pass");

  await page.evaluate(() => {
    (window as Window & { __workflowIncisionReasons?: string[] }).__workflowIncisionReasons = [];
  });
  await clickWorkflowCanvasRatio(page, 0.34, 0.37);
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workflowIncisionReasons?: string[] }
  ).__workflowIncisionReasons || [])).toContain("controlled_marker_opening_scan_rejected");
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
  await expect(scan).toHaveAttribute("min", "40");
  const scanValues = await scan.evaluate((input: HTMLInputElement) => ({
    minimum: Number(input.min),
    current: Number(input.value),
  }));
  expect(scanValues.current).toBeGreaterThanOrEqual(scanValues.minimum);
});
