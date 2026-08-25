#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import playwright from "../web/node_modules/playwright/index.js";

const sourcePath = resolve(process.argv[2] || "");
const outputPath = resolve(process.argv[3] || "");
const baseUrl = process.env.WRINKLE_EXPERIMENT_URL || "http://127.0.0.1:4174";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: extract_face_landmarks.mjs <image> <output-json>");
}

const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex").toUpperCase();
const browser = await playwright.chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--disable-gpu"],
});

try {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/compat/personalized/wrinkle_rstl_experiment.html`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.locator("#imageInput").setInputFiles(sourcePath);
  const landmarks = await page.evaluate(async () => {
    const file = document.querySelector("#imageInput")?.files?.[0];
    return window.__wrinkleRstlExperiment.detectLandmarksFile(file);
  });
  await writeFile(outputPath, `${JSON.stringify({
    source: sourcePath,
    sourceSha256,
    landmarks,
    runtime: "mediapipe-tasks-vision-wasm-cpu",
  }, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, landmarkCount: landmarks.length }, null, 2));
} finally {
  await browser.close();
}
