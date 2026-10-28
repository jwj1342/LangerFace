#!/usr/bin/env node
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { captureMarkerIdentity, assertMarkerIdentity } from "./marker_runtime_identity.mts";

const expected = captureMarkerIdentity("small-lesion-boundary-candidate");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const results = [];
try {
  for (const base of process.argv.slice(2)) {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
        isMobile: mobile, hasTouch: mobile });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        const started = Date.now();
        await page.goto(new URL("/app/workflow?developer=1", base).href, { timeout: 30000 });
        const upload = mobile ? page.getByRole("button", { name: "上传照片", exact: true }) : page.locator("#uploadBtn");
        await upload.waitFor({ state: "visible", timeout: 30000 });
        await page.waitForFunction(() => !document.querySelector("#fileInput")?.disabled, {}, { timeout: 30000 });
        const data = await page.evaluate(() => {
          const c = document.createElement("canvas");
          c.width = c.height = 256;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#c4a88b";
          ctx.fillRect(0, 0, 256, 256);
          return c.toDataURL("image/png").split(",")[1];
        });
        const chooser = page.waitForEvent("filechooser", { timeout: 10000 });
        await upload.click();
        await (await chooser).setFiles({ name: "delivery-probe-synthetic.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") });
        await page.waitForFunction(() => document.querySelector("#modelBadge")?.textContent?.includes("就绪"), {}, { timeout: 45000 });
        const response = await page.request.get(new URL("/__runtime-identity.json", base).href);
        if (!response.ok()) throw new Error(`identity HTTP ${response.status()}`);
        assertMarkerIdentity(await response.json(), expected);
        if (errors.length) throw new Error(errors.join("; "));
        results.push({ base, viewport: mobile ? "mobile-simulation" : "desktop", status: "PASS", elapsedMs: Date.now() - started,
          checks: ["developer-page", "enabled-upload", "real-filechooser", "synthetic-image-load", "photo-model-ready", "exact-runtime-identity"],
          excludes: ["clinical-effect", "real-phone", "camera", "RSTL-equivalence"] });
      } finally { await context.close(); }
    }
  }
  console.log(JSON.stringify({ status: "PASS", results }, null, 2));
} finally { await browser.close(); }
