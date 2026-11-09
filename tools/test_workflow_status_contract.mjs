import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, build } from "../web/node_modules/vite/dist/node/index.js";
import { chromium } from "../web/node_modules/playwright/index.mjs";

const webRoot = fileURLToPath(new URL("../web/", import.meta.url));
const componentPath = resolve(webRoot, "src/components/WorkflowStageStatus.tsx");
const componentSource = await readFile(componentPath, "utf8");
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
};
const output = option("--output");
const mutant = option("--mutant");
assert(!mutant || mutant === "omit-primary", "unknown test-only mutant");
const moduleId = "virtual:workflow-status-contract";
const resolvedId = `\0${moduleId}`;
const moduleUrl = `/@id/__x00__${moduleId}`;
const unsupported = "仅支持上传照片或视频。";
const corrupt = "无法读取或检测该文件。请重新上传；若仍失败，请换用受支持的清晰照片或视频。";
let mutantApplied = false;

// This fixture mounts the real component, not the product/algorithm runtime.
const fixtureModule = `
import React from "react";
import { createRoot } from "react-dom/client";
import { WorkflowStageStatus } from "/src/components/WorkflowStageStatus.tsx";
import { useIncisionStore } from "/src/stores/incisionStore.ts";
const target = document.querySelector("#root");
let root;
function mount() {
  root = createRoot(target);
  root.render(React.createElement(React.StrictMode, null, React.createElement(WorkflowStageStatus)));
}
window.fixture = {
  status(value) {
    useIncisionStore.setState(current => ({ snapshot: { ...current.snapshot, ...value } }));
  },
  message(text, active = true) {
    const element = document.querySelector("#overlayMsg");
    element.textContent = text;
    element.classList.toggle("hidden", !active);
  },
  unmount() { root.unmount(); },
  mount,
};
mount();
`;
const html = (entry) => `<!doctype html><html><head><meta charset="utf-8">
<style>[hidden],.hidden{display:none!important}body{margin:20px}
.workflow-stage-status{display:block;max-width:600px}
.workflow-developer-detail{display:block}</style></head><body>
<div class="workflow-workbench"><div class="stage-top"><div id="root"></div></div></div>
<div id="overlayMsg" hidden class="overlay-msg hidden"></div>
<script type="module" src="${entry}"></script></body></html>`;

function fixturePlugin() {
  return {
    name: "workflow-status-contract-fixture",
    enforce: "pre",
    resolveId(id) { if (id === moduleId) return resolvedId; },
    load(id) { if (id === resolvedId) return fixtureModule; },
    transform(code, id) {
      if (!mutant || id.split("?")[0].replaceAll("\\", "/") !== componentPath.replaceAll("\\", "/")) return;
      const primary = '<span className="workflow-stage-status-copy">{statusText}</span>';
      assert(code.includes(primary), "mutant must target the real primary-status expression");
      mutantApplied = true;
      return code.replace(primary, `{developerDetails.length === 0 ? ${primary} : null}`);
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split("?")[0] !== "/status-fixture") return next();
        try {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(await server.transformIndexHtml(request.url, html(moduleUrl)));
        } catch (error) { next(error); }
      });
    },
  };
}

const browser = await chromium.launch({
  headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const results = [];

async function runModes(base, production) {
  for (const touch of [false, true]) {
    for (const query of ["", "?developer=1", "?markerDiagnostics=1"]) {
      const context = await browser.newContext({
        viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 960 },
        isMobile: touch, hasTouch: touch,
      });
      const result = { production, touch, query, checks: 0 };
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${base}/status-fixture${query}`);
        await page.waitForFunction(() => window.fixture && document.querySelector("#workflowStageStatus"));
        const visible = !production && !touch && Boolean(query);
        await page.evaluate(() => window.fixture.status({
          stageStatus: "PRIMARY_REASON", stageStatusTone: "normal",
          stageBusy: false, developerDetails: ["PRIMARY_REASON", "INDEPENDENT_DETAIL"],
        }));
        if (visible) {
          await page.locator(".workflow-stage-status-copy").waitFor({ state: "visible", timeout: 3000 });
          assert.equal(await page.locator(".workflow-stage-status-copy").textContent(), "PRIMARY_REASON");
          assert.deepEqual(await page.locator(".workflow-developer-detail").allTextContents(), ["INDEPENDENT_DETAIL"]);
        } else {
          assert.equal(await page.locator("#workflowStageStatus").isVisible(), false);
          assert.equal(await page.locator("#workflowStageStatus").getAttribute("aria-hidden"), "true");
        }
        result.checks += 1;
        for (let repetition = 0; repetition < 3; repetition += 1) {
          for (const message of [unsupported, corrupt]) {
            await page.evaluate((text) => window.fixture.message(text), message);
            if (visible) {
              await page.waitForFunction((text) => document.querySelector("#workflowStageStatus").textContent.includes(text), message, { timeout: 3000 });
              assert.equal(await page.locator(".workflow-stage-status-copy").textContent(), "PRIMARY_REASON");
              assert.equal(await page.locator("#workflowStageStatus").getAttribute("data-tone"), "warning");
              assert.equal((await page.locator(".workflow-developer-detail").allTextContents()).filter((text) => text === message).length, 1);
            } else {
              assert.equal(await page.locator("#workflowStageStatus").isVisible(), false);
            }
            await page.evaluate((text) => window.fixture.message(text, false), message);
            await page.waitForFunction((text) => !document.querySelector("#workflowStageStatus").textContent.includes(text), message);
            result.checks += 2;
          }
        }
        await page.evaluate(() => window.fixture.message("UNRELATED_SHARED_MESSAGE"));
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        assert.equal((await page.locator("#workflowStageStatus").textContent()).includes("UNRELATED_SHARED_MESSAGE"), false);
        result.checks += 1;
        for (let repetition = 0; repetition < 3; repetition += 1) {
          await page.evaluate((text) => window.fixture.message(text), corrupt);
          if (visible) await page.waitForFunction((text) => document.querySelector("#workflowStageStatus").textContent.includes(text), corrupt);
          await page.evaluate(() => window.fixture.unmount());
          assert.equal(await page.locator("#workflowStageStatus").count(), 0);
          await page.evaluate(() => { window.fixture.message("", false); window.fixture.mount(); });
          await page.locator("#workflowStageStatus").waitFor({ state: "attached" });
          await page.waitForFunction((text) => !document.querySelector("#workflowStageStatus").textContent.includes(text), corrupt);
          assert.equal(await page.locator("#workflowStageStatus").isVisible(), visible);
          result.checks += 1;
        }
        if (visible) {
          await page.evaluate((text) => {
            window.fixture.status({ stageStatus: text, developerDetails: [text] });
            window.fixture.message(text);
          }, corrupt);
          await page.waitForFunction((text) => document.querySelector(".workflow-stage-status-copy")?.textContent === text, corrupt);
          assert.equal(await page.locator(".workflow-developer-detail").count(), 0, "main reason is not duplicated");
          await page.evaluate(() => {
            window.fixture.message("", false);
            window.fixture.status({ stageStatus: "RECOVERED", developerDetails: [] });
          });
          await page.waitForFunction(() => document.querySelector("#workflowStageStatus").textContent === "RECOVERED");
          result.checks += 2;
        }
        assert.deepEqual(errors, [], "no component errors during StrictMode remounts");
        result.status = "PASS";
      } catch (error) {
        result.status = "FAIL";
        result.error = error.stack;
      } finally {
        results.push(result);
        await context.close();
      }
    }
  }
}

let development;
let productionServer;
const previousNodeEnv = process.env.NODE_ENV;
try {
  process.env.NODE_ENV = "development";
  const reservation = createHttpServer();
  await new Promise((done, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", done); });
  const fixturePort = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  development = await createServer({
    root: webRoot, configFile: false, envFile: false, appType: "custom",
    plugins: [fixturePlugin()], logLevel: "error",
    cacheDir: resolve(webRoot, "node_modules/.vite-workflow-status-contract"),
    server: { host: "127.0.0.1", port: fixturePort, strictPort: true },
  });
  await development.listen();
  await runModes(`http://127.0.0.1:${development.httpServer.address().port}`, false);
  await development.close();
  development = null;
  process.env.NODE_ENV = "production";
  const built = await build({
    root: webRoot, configFile: false, envFile: false, mode: "production", logLevel: "error",
    plugins: [fixturePlugin()],
    build: { write: false, minify: false, rolldownOptions: { input: moduleId } },
  });
  const bundle = Array.isArray(built) ? built[0] : built;
  const files = new Map(bundle.output.map((item) => [`/${item.fileName}`, item.type === "chunk" ? item.code : item.source]));
  const entry = bundle.output.find((item) => item.type === "chunk" && item.isEntry);
  assert(entry, "production fixture must have a real compiled entry");
  productionServer = createHttpServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/status-fixture") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html(`/${entry.fileName}`));
    } else if (files.has(pathname)) {
      response.setHeader("Content-Type", pathname.endsWith(".css") ? "text/css" : "text/javascript");
      response.end(files.get(pathname));
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise((done, reject) => { productionServer.once("error", reject); productionServer.listen(0, "127.0.0.1", done); });
  await runModes(`http://127.0.0.1:${productionServer.address().port}`, true);
  if (mutant) assert(mutantApplied, "test-only defect injection was not applied");
} catch (error) {
  results.push({ status: "HARNESS_FAIL", error: error.stack });
} finally {
  await development?.close();
  if (productionServer) await new Promise((done) => productionServer.close(done));
  await browser.close();
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
}
const report = {
  at: new Date().toISOString(), kind: "isolated-real-component-contract",
  componentSha256: createHash("sha256").update(componentSource).digest("hex"),
  mutant, mutantApplied, passed: results.every((result) => result.status === "PASS"), results,
  excludes: ["product runtime identity", "real upload/model pipeline", "full product layout", "algorithm effects"],
};
if (output) await writeFile(resolve(output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
