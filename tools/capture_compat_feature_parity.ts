// Runtime smoke check for compatibility workbenches that must stay functional
// while the doctor-facing case workflow hides them from the main path.
// Run from web/: npm run visual:compat:parity

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "web");
const outDir = join(root, "local_outputs", "compat-feature-parity");
const port = Number(process.env.COMPAT_FEATURE_PARITY_PORT || 5199);
const baseUrl = `http://127.0.0.1:${port}`;
const viteBin = join(webDir, "node_modules", "vite", "bin", "vite.js");
const playwrightBin = join(webDir, "node_modules", ".bin", "playwright");
const specPath = join(outDir, "compat-feature-parity.spec.ts");
const configPath = join(outDir, "playwright.config.ts");
const fixtureImagePath = join(outDir, "upload-fixture.png");

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
      const response = await fetch(`${baseUrl}/app/live`, { redirect: "manual" });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/app/live: ${lastError}`);
}

function writeFixtureImage(): void {
  mkdirSync(outDir, { recursive: true });
  // 32x32 PNG with simple colored blocks. The live upload path only needs a
  // decodable image source; face detection quality is covered elsewhere.
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAW0lEQVR4nO2XMQoAIAwD/f+P7lQHBYc0iGvQhME9KElQAgAAAPxjzvWmY3a3A3bLQqQAWsAGsAFsABvABrABbAAbwAawAWwAG8AGsAFsABvABrABbAAbwAawAexbAB21A2dn5P+ZAAAAAElFTkSuQmCC";
  writeFileSync(fixtureImagePath, Buffer.from(pngBase64, "base64"));
}

function writePlaywrightSpec(): void {
  mkdirSync(outDir, { recursive: true });
  const source = `
import { expect, test } from "@playwright/test";

const baseUrl = ${JSON.stringify(baseUrl)};
const outDir = ${JSON.stringify(outDir)};
const fixtureImagePath = ${JSON.stringify(fixtureImagePath)};

function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function seriousErrors(errors) {
  return errors.filter((message) => ![
    /favicon/i,
    /THREE\\.Clock/i,
    /ResizeObserver loop completed/i,
    /TensorFlow Lite XNNPACK delegate/i,
  ].some((pattern) => pattern.test(message)));
}

async function shot(page, name) {
  await page.screenshot({ path: \`\${outDir}/\${name}.png\`, fullPage: false });
}

async function expectCanvasHasPixels(page, selector, label) {
  await expect(page.locator(selector)).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const metrics = await page.locator(selector).evaluate((canvas, labelText) => {
    const htmlCanvas = canvas;
    const webgl = htmlCanvas.getContext("webgl2") || htmlCanvas.getContext("webgl");
    const sample = (pixels, width, height) => {
      let nonDark = 0;
      let colored = 0;
      let nonTransparent = 0;
      const seen = new Set();
      for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const a = pixels[index + 3];
        const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
        if (a > 0) nonTransparent += 1;
        if (a > 0 && luma > 24) nonDark += 1;
        if (a > 0 && Math.max(r, g, b) - Math.min(r, g, b) > 8) colored += 1;
        if (a > 0 && seen.size < 128) seen.add(\`\${r},\${g},\${b}\`);
      }
      const total = width * height;
      return {
        ok: nonTransparent > total * 0.04 && nonDark > total * 0.02 && colored > total * 0.005 && seen.size > 3,
        total,
        nonTransparent,
        nonDark,
        colored,
        uniqueColors: seen.size,
      };
    };
    if (webgl) {
      const width = webgl.drawingBufferWidth;
      const height = webgl.drawingBufferHeight;
      const sampleWidth = Math.min(width, 160);
      const sampleHeight = Math.min(height, 160);
      const x = Math.max(0, Math.floor((width - sampleWidth) / 2));
      const y = Math.max(0, Math.floor((height - sampleHeight) / 2));
      const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
      webgl.readPixels(x, y, sampleWidth, sampleHeight, webgl.RGBA, webgl.UNSIGNED_BYTE, pixels);
      return { label: labelText, context: "webgl", width, height, ...sample(pixels, sampleWidth, sampleHeight) };
    }
    const ctx = htmlCanvas.getContext("2d");
    if (!ctx) return { label: labelText, ok: false, reason: "missing-rendering-context" };
    const width = htmlCanvas.width;
    const height = htmlCanvas.height;
    const sampleWidth = Math.min(width, 220);
    const sampleHeight = Math.min(height, 220);
    const x = Math.max(0, Math.floor((width - sampleWidth) / 2));
    const y = Math.max(0, Math.floor((height - sampleHeight) / 2));
    const pixels = ctx.getImageData(x, y, sampleWidth, sampleHeight).data;
    return { label: labelText, context: "2d", width, height, ...sample(pixels, sampleWidth, sampleHeight) };
  }, label);
  expect(metrics.ok, JSON.stringify(metrics)).toBe(true);
}

test("compat routes preserve live, incision, annotate, standard-head, and texture controls", async ({ page, context }) => {
  const errors = collectErrors(page);
  await context.grantPermissions(["camera"], { origin: baseUrl });

  await page.goto(\`\${baseUrl}/app/three-preview\`);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
  await expectCanvasHasPixels(page, "canvas", "R3F standard face preview");
  await shot(page, "01-three-preview.png");

  await page.goto(\`\${baseUrl}/app/annotate\`);
  await expect(page.locator("#stage")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#btnLoadCanonical")).toBeVisible();
  await expect(page.locator("#btnLoadFlame")).toBeAttached();
  await expect(page.locator("#btnLoadFittedFlame")).toBeAttached();
  await expect(page.locator("#btnCloudFit")).toBeVisible();
  await expect(page.locator("#meshFile")).toBeAttached();
  await expect(page.locator("#slicerFile")).toBeAttached();
  await page.locator("#btnLoadCanonical").click();
  await expect(page.locator("#hint")).toContainText(/点击|顶点|标准脸|图谱/, { timeout: 30000 });
  await expectCanvasHasPixels(page, "#stage", "3D annotation standard face canvas");
  await shot(page, "02-annotate.png");

  await page.goto(\`\${baseUrl}/app/incision\`);
  await expect(page.locator("#agentCanvas")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#tumorKind")).toBeVisible();
  await expect(page.locator("#diameterMm")).toBeVisible();
  await expect(page.locator("#runAgentBtn")).toBeVisible();
  await expect(page.locator("#exportTumorBtn")).toBeVisible();
  await expect(page.locator("#importTumorBtn")).toBeVisible();
  await expect(page.locator("#saveCandidateBtn")).toBeVisible();
  await expect(page.locator("#exportJsonBtn")).toBeVisible();
  await expect(page.locator("#exportReportBtn")).toBeVisible();
  await expect(page.locator("#exportPngBtn")).toBeVisible();
  await expect(page.locator("#stageLiveOverlayBtn")).toBeVisible();
  await expectCanvasHasPixels(page, "#agentCanvas", "incision planning face canvas");
  await page.locator("#runAgentBtn").click();
  await expect(page.locator("#candidateType")).not.toHaveText("—", { timeout: 30000 });
  await expect(page.locator("#candidateLength")).not.toHaveText("—", { timeout: 30000 });
  await page.locator("#saveCandidateBtn").click();
  await expect(page.locator("#savedCount")).not.toHaveText("0", { timeout: 10000 });
  await shot(page, "03-incision.png");

  await page.goto(\`\${baseUrl}/app/live\`);
  await expect(page.locator("#video")).toBeAttached();
  await expect(page.locator("#canvas")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#uploadBtn")).toBeVisible();
  await expect(page.locator("#fileInput")).toBeAttached();
  await expect(page.locator("#camBtn")).toBeVisible();
  await expect(page.locator("#routeSel")).toBeVisible();
  await page.locator("#fileInput").setInputFiles(fixtureImagePath);
  await expect(page.locator("#livePill")).toContainText("照片", { timeout: 30000 });
  await page.locator("#routeSel").selectOption("3d");
  await expect(page.locator("#reconScanBtn")).toBeVisible();
  await expect(page.locator("#project3dBtn")).toBeVisible();
  await expect(page.locator("#scanPanel")).toBeAttached();
  await expect(page.locator("#flameStdToggle")).toBeAttached();
  await expect(page.locator("#twinTextureToggle")).toBeAttached();
  await expect(page.locator("#flameHeadToggleWrap")).toContainText("显示标准头");
  await expect(page.locator("#twinTextureWrap")).toContainText("贴真实人脸纹理");
  await page.locator("#routeSel").selectOption("2d");
  await page.locator("#camBtn").click();
  await expect(page.locator("#livePill")).toContainText("实时摄像头", { timeout: 30000 });
  const overlayMessage = await page.locator("#overlayMsg").innerText().catch(() => "");
  expect(overlayMessage).not.toMatch(/权限被拒|HTTPS|没有找到可用摄像头/);
  await shot(page, "04-live.png");

  expect(seriousErrors(errors), seriousErrors(errors).join("\\n")).toEqual([]);
});
`;
  writeFileSync(specPath, source);
  const config = `
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ${JSON.stringify(outDir)},
  timeout: 120000,
  expect: { timeout: 30000 },
  projects: [
    {
      name: "chromium",
      use: {
        headless: true,
        viewport: { width: 1440, height: 920 },
        permissions: ["camera"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--no-sandbox",
          ],
        },
      },
    },
  ],
});
`;
  writeFileSync(configPath, config);
}

async function main(): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFixtureImage();
  writePlaywrightSpec();

  const server = startVite();
  try {
    await waitForServer();
    await runProcess(playwrightBin, [
      "test",
      specPath,
      "--config",
      configPath,
      "--project",
      "chromium",
      "--reporter",
      "list",
    ], {
      cwd: webDir,
      env: {
        ...process.env,
        NODE_PATH: [
          join(webDir, "node_modules"),
          process.env.NODE_PATH || "",
        ].filter(Boolean).join(":"),
        PLAYWRIGHT_HTML_REPORT: join(outDir, "playwright-report"),
        PLAYWRIGHT_TEST_RESULTS_DIR: join(outDir, "test-results"),
      },
    });
    console.log(`compat feature parity screenshots written to ${outDir}`);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
