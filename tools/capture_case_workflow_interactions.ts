// Interactive visual smoke check for the clinical case workflow.
// Run from web/: npm run visual:case:flow
//
// The script starts Vite, drives the UI with Playwright, and writes screenshots
// to local_outputs/case-workflow-interactions/. Screenshots are intentionally
// local-only and not committed.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "web");
const outDir = join(root, "local_outputs", "case-workflow-interactions");
const port = Number(process.env.CASE_WORKFLOW_FLOW_PORT || 5198);
const baseUrl = `http://127.0.0.1:${port}`;
const viteBin = join(webDir, "node_modules", "vite", "bin", "vite.js");
const playwrightBin = join(webDir, "node_modules", ".bin", "playwright");
const specPath = join(outDir, "case-workflow-flow.spec.ts");
const configPath = join(outDir, "playwright.config.ts");

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function startVite(): ChildProcessWithoutNullStreams {
  if (!existsSync(viteBin)) {
    throw new Error(`Vite binary not found at ${viteBin}. Run npm install in web/.`);
  }
  const child = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port)], {
    cwd: webDir,
    env: { ...process.env, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForServer(deadlineMs = 30000): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < deadlineMs) {
    try {
      const response = await fetch(`${baseUrl}/app/cases`, { redirect: "manual" });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/app/cases: ${lastError}`);
}

function writePlaywrightSpec(): void {
  mkdirSync(outDir, { recursive: true });
  const source = `
import { expect, test } from "@playwright/test";

const baseUrl = ${JSON.stringify(baseUrl)};
const outDir = ${JSON.stringify(outDir)};

async function shot(page, name) {
  await page.screenshot({ path: \`\${outDir}/\${name}.png\`, fullPage: false });
}

async function waitForFaceViewport(page) {
  await expect(page.locator(".case-face-asset-frame[data-loaded='true']")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(900);
  await expectRenderedFaceCanvas(page, ".case-face-asset-frame[data-loaded='true']");
}

async function waitForLobbyPreview(page) {
  await expect(page.locator(".case-lobby-stage .case-face-asset-frame[data-loaded='true']")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(900);
  await expectRenderedFaceCanvas(page, ".case-lobby-stage .case-face-asset-frame[data-loaded='true']");
}

async function expectRenderedFaceCanvas(page, frameSelector) {
  const metrics = await page.locator(frameSelector).first().locator("canvas").evaluate((canvas) => {
    const htmlCanvas = canvas;
    const gl = htmlCanvas.getContext("webgl2") || htmlCanvas.getContext("webgl");
    if (!gl) return { ok: false, reason: "missing-webgl-context" };
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (width < 32 || height < 32) return { ok: false, reason: "small-drawing-buffer", width, height };
    const sampleWidth = Math.min(width, 96);
    const sampleHeight = Math.min(height, 96);
    const x = Math.max(0, Math.floor((width - sampleWidth) / 2));
    const y = Math.max(0, Math.floor((height - sampleHeight) / 2));
    const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
    gl.readPixels(x, y, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonDark = 0;
    let skinOrLine = 0;
    let colorVariance = 0;
    let previous = -1;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const a = pixels[index + 3];
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      if (a > 0 && luma > 35) nonDark += 1;
      if ((r > 120 && g > 70 && b > 50) || (r > 150 && b > 130 && g < 140)) skinOrLine += 1;
      const packed = (r << 16) | (g << 8) | b;
      if (previous !== -1) colorVariance += Math.abs((packed & 255) - (previous & 255));
      previous = packed;
    }
    const total = sampleWidth * sampleHeight;
    return {
      ok: nonDark > total * 0.12 && skinOrLine > total * 0.04 && colorVariance > total * 2,
      reason: "sampled",
      width,
      height,
      sampleWidth,
      sampleHeight,
      nonDark,
      skinOrLine,
      total,
      colorVariance,
    };
  });
  expect(metrics.ok, JSON.stringify(metrics)).toBe(true);
}

async function expectNoBrowserScroll(page) {
  const metrics = await page.evaluate(() => {
    window.scrollTo(0, 80);
    return {
      scrollY: window.scrollY,
      htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      viewportHeight: window.innerHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
    };
  });
  expect(metrics.scrollY, JSON.stringify(metrics)).toBe(0);
  expect([metrics.htmlOverflowY, metrics.bodyOverflowY], JSON.stringify(metrics)).toContain("hidden");
}

test("clinical case workflow click path", async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(\`\${baseUrl}/app/cases\`);
  await expect(page.locator("#caseDashboard")).toBeVisible();
  await waitForLobbyPreview(page);
  await expectNoBrowserScroll(page);
  await shot(page, "01-dashboard-empty");

  await page.getByRole("link", { name: /新建面部评估|新建病例/ }).first().click();
  await expect(page.locator("#caseNewSetup")).toBeVisible();
  await expectNoBrowserScroll(page);
  await shot(page, "02-new-case-initial");

  await page.locator("#newCaseAge").fill("64");
  await page.locator("#newCaseLesionLayer").selectOption("cutaneous");
  await page.locator("#newCaseMarginStrategy").selectOption("expanded_margin");
  await page.locator("#newCaseSafetyMargin").fill("5");
  await page.locator("#caseNewSetup").getByRole("button", { name: /3D 扫描/ }).click();
  await expectNoBrowserScroll(page);
  await shot(page, "03-new-case-filled");

  await page.getByRole("button", { name: /创建病例草稿/ }).click();
  await expect(page.locator("#caseEvaluateStep")).toBeVisible();
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "04-evaluate-3d-loaded");

  await page.getByRole("button", { name: /切换实时叠加/ }).click();
  await expect(page).toHaveURL(/\\/app\\/case\\/[^/]+\\/evaluate$/);
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "05-evaluate-after-live-toggle");

  await page.locator("label").filter({ hasText: "RSTL 密度" }).locator("select").selectOption("high");
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "06-evaluate-layer-density");

  await page.getByRole("button", { name: /下一步：标记病灶|继续并标记复核/ }).click();
  await expect(page.locator("#casePlanStep")).toBeVisible();
  await expect(page.locator(".case-rationale-summary")).toBeVisible();
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "07-plan-initial");

  await page.locator("#lesionLayer").selectOption("cutaneous");
  await page.locator("label").filter({ hasText: "直径 mm" }).locator("input").fill("12");
  await page.locator("label").filter({ hasText: "深度 mm" }).locator("input").fill("2");
  await page.locator("#marginStrategy").selectOption("expanded_margin");
  await page.locator("#safetyMargin").fill("5");
  await page.getByRole("button", { name: /^保存候选$/ }).click();
  await expect(page.getByText(/候选 1/)).toBeVisible();
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "08-plan-after-save-candidate");

  await page.getByRole("button", { name: /张力模拟/ }).first().click();
  await expect(page.locator("#caseClosureSimulation")).toContainText(/闭合评分|当前结论/);
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "09-plan-after-closure");

  await page.getByRole("button", { name: /^方案确认$/ }).click();
  await expect(page.locator("#caseReviewStep")).toBeVisible();
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "10-review-initial");

  await page.locator("#caseReviewerName").fill("示例医生");
  await page.getByRole("button", { name: /^确认采用$/ }).click();
  await expect(page.getByText("已确认").first()).toBeVisible();
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "11-review-approved");

  await page.getByRole("link", { name: /2\\. 切口规划/ }).click();
  await expect(page.locator("#casePlanStep")).toBeVisible();
  await expect(page.locator(".case-rationale-summary")).toBeVisible();
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "12-return-to-plan-from-stepper");

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator(".case-rationale-summary")).toBeVisible();
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "13-compact-plan-1280x720");

  await page.getByRole("button", { name: /^方案确认$/ }).click();
  await expect(page.locator("#caseReviewStep")).toBeVisible();
  await waitForFaceViewport(page);
  await expectNoBrowserScroll(page);
  await shot(page, "14-compact-review-1280x720");

  await page.getByRole("link", { name: /^系统诊断$/ }).click();
  await expect(page.locator("#settingsDeveloper")).toBeVisible();
  await shot(page, "15-settings-developer-controlled-tools");

  const seriousErrors = consoleErrors.filter((message) => !/THREE\\.Clock/.test(message));
  expect(seriousErrors, seriousErrors.join("\\n")).toEqual([]);
});
`;
  writeFileSync(specPath, source);
  writeFileSync(configPath, `
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ${JSON.stringify(outDir)},
  timeout: 120000,
  use: {
    colorScheme: "dark",
    viewport: { width: 1440, height: 1000 },
  },
});
`);
}

async function main(): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writePlaywrightSpec();
  const server = startVite();
  try {
    await waitForServer();
    await runProcess(playwrightBin, [
      "test",
      "--config",
      configPath,
      "--browser",
      "chromium",
      "--workers",
      "1",
      "--reporter",
      "line",
      "--output",
      join(outDir, "test-results"),
    ], {
      cwd: webDir,
      env: {
        ...process.env,
        NODE_PATH: join(webDir, "node_modules"),
      },
    });
    console.log(`interactive case workflow screenshots written to ${outDir}`);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
