// Optional visual smoke check for the clinical case workflow.
// Run from web/: npm run visual:case
//
// Screenshots are written to local_outputs/ and intentionally stay out of git.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "web");
const outDir = join(root, "local_outputs", "case-workflow-visual");
const port = Number(process.env.CASE_WORKFLOW_VISUAL_PORT || 5197);
const baseUrl = `http://127.0.0.1:${port}`;
const viteBin = join(webDir, "node_modules", "vite", "bin", "vite.js");
const storageStatePath = join(outDir, "case-workflow.storage.json");

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

function writeStorageState(): void {
  mkdirSync(outDir, { recursive: true });
  const now = new Date("2026-06-28T12:00:00.000Z").toISOString();
  const caseRecord = {
    id: "visual-case",
    title: "视觉检查病例",
    status: "needs_review",
    currentStep: "evaluate",
    createdAt: now,
    updatedAt: now,
    patientContext: {
      ageYears: 62,
      ageBand: "older_lax",
      ageBandLabel: "老年 / 松弛",
      parameterHint: "建议适当增加梭形切口夹角，长轴:短轴约 2.5:1。",
    },
    lesion: {
      layer: "cutaneous",
      layerLabel: "皮表肿物 · 梭形切口模式",
      diameterMm: 12,
      depthMm: 2,
      marginStrategy: "expanded_margin",
      safetyMarginMm: 5,
    },
    acquisition: {
      source: "scan3d",
      sourceLabel: "3D 扫描",
    },
    layers: {
      rstl: true,
      personalizedWrinkles: true,
      blendedField: true,
      incisionDesign: true,
    },
    closureSimulation: {
      status: "stable",
      score: 72,
      label: "可直接拉拢",
      summary: "估算切除宽度 22.0 mm；当前参数支持在规划页内继续查看闭合方向和张力提示，最终仍需医生结合查体确认。",
      lastRunAt: now,
    },
    saveState: "saved",
    lastError: "",
  };
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: baseUrl,
        localStorage: [
          {
            name: "langerface.cases",
            value: JSON.stringify([caseRecord]),
          },
        ],
      },
    ],
  };
  writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2));
}

async function screenshot(pathname: string, selector: string, filename: string): Promise<void> {
  await runProcess("npx", [
    "-y",
    "playwright@latest",
    "screenshot",
    "--browser",
    "chromium",
    "--viewport-size",
    "1440,1000",
    "--color-scheme",
    "dark",
    "--full-page",
    "--timeout",
    "20000",
    "--load-storage",
    storageStatePath,
    "--wait-for-selector",
    selector,
    `${baseUrl}${pathname}`,
    join(outDir, filename),
  ], { cwd: webDir });
}

async function main(): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeStorageState();
  const server = startVite();
  try {
    await waitForServer();
    await screenshot("/app/cases", "#caseDashboard", "01-dashboard.png");
    await screenshot("/app/case/visual-case/evaluate", "#caseStepper", "02-evaluate.png");
    await screenshot("/app/case/visual-case/plan", "#caseClosureSimulation", "03-plan.png");
    await screenshot("/app/case/visual-case/review", "#caseStepper", "04-review.png");
    console.log(`case workflow screenshots written to ${outDir}`);
    console.log("If Chinese text is missing in Linux screenshots, install a CJK font such as Noto Sans CJK SC on the screenshot host.");
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
