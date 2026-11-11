#!/usr/bin/env node
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { captureMarkerIdentity, assertMarkerIdentity } from "./marker_runtime_identity.mts";
import { auditMarkerDiagnosticExport } from "../web/src/services/controlledMarkerRunDiagnostics.ts";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const expected = captureMarkerIdentity("small-lesion-boundary-candidate");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const results = [];
async function verifyDiagnosticDownload(page, label) {
  const ready = page.getByRole("button", { name: "导出诊断日志", exact: true });
  await ready.waitFor({ state: "visible", timeout: 15000 });
  const pending = page.waitForEvent("download", { timeout: 15000 });
  await ready.click();
  const download = await pending;
  if (await download.failure()) throw new Error("diagnostic download failed");
  const bytes = readFileSync(await download.path());
  const payload = JSON.parse(bytes.toString("utf8"));
  assert.equal(payload.schema, "marker-diagnostic-session/2");
  assert.equal(auditMarkerDiagnosticExport(payload).passed, true);
  const expectedBranch = createHash("sha256").update(expected.branch).digest("hex");
  const identities = [...payload.page_instances.map(page => page.service_identity), ...payload.runs.map(run => run.service_identity)].filter(Boolean);
  assert.ok(identities.length > 0, "download must contain actual service identity");
  for (const identity of identities) {
    assert.equal(identity.branch, undefined);
    assert.equal(identity.branch_sha256, expectedBranch);
    for (const key of ["head", "sourceDigest", "worktreeId", "implementationVersion", "profile"]) assert.equal(identity[key], expected[key], key);
  }
  if (process.env.DIAGNOSTIC_PROBE_OUTPUT) {
    mkdirSync(process.env.DIAGNOSTIC_PROBE_OUTPUT, { recursive: true });
    writeFileSync(resolve(process.env.DIAGNOSTIC_PROBE_OUTPUT, `${label}.json`), bytes);
  }
  return { bytes: bytes.length, runs: payload.runs.length, pages: payload.page_instances.length,
    restored: payload.page_instances.some(page => page.restored_session), sha256: createHash("sha256").update(bytes).digest("hex") };
}
try {
  for (const base of process.argv.slice(2)) {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
         isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
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
         const label = `${new URL(base).port || "https"}-${mobile ? "mobile" : "desktop"}`;
         const firstDownload = await verifyDiagnosticDownload(page, `${label}-before-refresh`);
         await page.reload({ timeout: 30000 });
         await page.waitForFunction(() => !document.querySelector("#fileInput")?.disabled, {}, { timeout: 30000 });
         const restoredDownload = await verifyDiagnosticDownload(page, `${label}-after-refresh`);
         assert.equal(restoredDownload.restored, true, "refresh must restore the existing local session");
         assert.ok(restoredDownload.pages > firstDownload.pages, "page-only history must survive refresh");
        if (errors.length) throw new Error(errors.join("; "));
        results.push({ base, viewport: mobile ? "mobile-simulation" : "desktop", status: "PASS", elapsedMs: Date.now() - started,
           checks: ["developer-page", "enabled-upload", "real-filechooser", "synthetic-image-load", "photo-model-ready", "exact-runtime-identity",
             "real-diagnostic-download", "download-json-privacy-and-identity", "restored-session-download"],
           downloads: [firstDownload, restoredDownload],
          excludes: ["clinical-effect", "real-phone", "camera", "RSTL-equivalence"] });
      } finally { await context.close(); }
    }
  }
  console.log(JSON.stringify({ status: "PASS", results }, null, 2));
} finally { await browser.close(); }
