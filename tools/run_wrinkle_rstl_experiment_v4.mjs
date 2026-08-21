#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import playwright from "../web/node_modules/playwright/index.js";

const { chromium } = playwright;

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectRoot = resolve(repositoryRoot, "..");
const sourcePath = resolve(projectRoot, "langer线-cc/wrinkle.png");
const fineLinePath = process.env.WRINKLE_FINE_LINE_PATH ?
  resolve(process.env.WRINKLE_FINE_LINE_PATH) :
  resolve(projectRoot, "langer线-cc/wrinkle_extraction_experiment_v1/wrinkle_fine_lines.json");
const requestedVersion = process.env.WRINKLE_EXPERIMENT_VERSION;
const experimentVersion = ["v7", "v8"].includes(requestedVersion) ? requestedVersion : "v8";
const outputDirectory = process.env.WRINKLE_EXPERIMENT_OUTPUT ?
  resolve(process.env.WRINKLE_EXPERIMENT_OUTPUT) :
  resolve(projectRoot, `langer线-cc/wrinkle_rstl_experiment_${experimentVersion}`);
const baseUrl = process.env.WRINKLE_EXPERIMENT_URL || "http://127.0.0.1:5174";
const visualizationOnly = process.env.WRINKLE_VISUALIZATION_ONLY === "1";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (existsSync(outputDirectory)) {
  throw new Error(`Refusing to overwrite existing experiment directory: ${outputDirectory}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const browserMessages = [];
page.on("console", (message) => browserMessages.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => browserMessages.push(`pageerror: ${error.message}`));

try {
  await page.goto(
    `${baseUrl}/compat/personalized/wrinkle_rstl_experiment.html?version=${experimentVersion}`,
    { waitUntil: "networkidle", timeout: 60_000 },
  );
  await page.locator("#imageInput").setInputFiles(sourcePath);
  await page.locator("#fineLineInput").setInputFiles(fineLinePath);
  await page.locator("#runButton").click();
  await page.waitForFunction(
    () => {
      const status = document.querySelector("#status")?.textContent || "";
      return status.startsWith("实验完成") || status.startsWith("实验失败");
    },
    null,
    { timeout: 180_000 },
  );
  const status = await page.locator("#status").textContent();
  const remapOnlyFailure = status?.includes("个性化 atlas 重新映射未达到 1 像素精度门禁");
  if (!status?.startsWith("实验完成") && !(visualizationOnly && remapOnlyFailure)) {
    throw new Error(`${status}\n${browserMessages.join("\n")}`);
  }
  const data = status?.startsWith("实验完成")
    ? await page.evaluate(() => window.__wrinkleRstlExperiment.artifactData())
    : await page.evaluate(() => {
      const decodeCanvas = (id) => {
        const base64 = document.querySelector(id).toDataURL("image/png").split(",")[1];
        return Array.from(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)));
      };
      return {
        images: {
          "01_prior_rstl.png": decodeCanvas("#priorCanvas"),
          "04_refined_rstl.png": decodeCanvas("#refinedCanvas"),
        },
        json: {
          "wrinkle_rstl_visualization.json":
            window.__wrinkleRstlExperiment.getVisualizationSnapshot(),
        },
      };
    });
  await mkdir(outputDirectory, { recursive: false });
  for (const [name, bytes] of Object.entries(data.images)) {
    await writeFile(resolve(outputDirectory, name), Uint8Array.from(bytes));
  }
  for (const [name, payload] of Object.entries(data.json)) {
    await writeFile(resolve(outputDirectory, name), `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (visualizationOnly && remapOnlyFailure) {
    console.log(JSON.stringify({ status, visualizationOnly: true }, null, 2));
  } else {
    const refinement = JSON.parse(await readFile(
      resolve(outputDirectory, "wrinkle_rstl_refinement.json"),
      "utf8",
    ));
    console.log(JSON.stringify({
      status,
      summary: refinement.summary,
      adherence: {
        priorMean: refinement.diagnostics.trajectory_adherence_prior_mean_distance_px,
        finalMean: refinement.diagnostics.trajectory_adherence_final_mean_distance_px,
        finalP90: refinement.diagnostics.trajectory_adherence_final_p90_distance_px,
      },
    }, null, 2));
  }
} finally {
  await browser.close();
}
