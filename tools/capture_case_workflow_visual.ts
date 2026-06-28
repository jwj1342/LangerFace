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
    status: "confirmed",
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
      boundary: {
        mode: "ellipse",
        source: "photo_trace",
        author: "示例医生",
        pointCount: 0,
        axisDiameterMm: 14,
        perpendicularDiameterMm: 10,
        status: "ready",
        summary: "皮表肿物已按椭圆边界记录边界，可用于梭形候选的宽度和包络提示。",
        updatedAt: now,
      },
    },
    acquisition: {
      source: "scan3d",
      sourceLabel: "3D 扫描",
      captureSet: {
        frontal: true,
        leftOblique: true,
        rightOblique: true,
        profile: false,
        depthOrVideo: true,
      },
      quality: {
        status: "ready",
        focus: "pass",
        exposure: "pass",
        poseCoverage: "pass",
        tracking: "pass",
        summary: "采集视角和质量检查满足当前病例规划要求，可继续进入病灶标记。",
        lastCheckedAt: now,
      },
    },
    layers: {
      rstl: true,
      rstlDensity: "high",
      rstlOpacity: 0.78,
      personalizedWrinkles: true,
      wrinkleOpacity: 0.7,
      blendedField: true,
      incisionDesign: true,
    },
    closureSimulation: {
      status: "needs_review",
      score: 67,
      label: "需医生复核",
      summary: "估算切除宽度 24.0 mm；建议结合皮肤松弛度、警惕区距离和必要时修复方案复核。",
      lastRunAt: now,
    },
    incisionCandidates: [
      {
        id: "visual-candidate-1",
        version: 1,
        label: "候选 1",
        kind: "fusiform",
        status: "selected",
        lengthMm: 60,
        widthMm: 24,
        tipAngleDeg: 36,
        ratio: 2.5,
        safetyMarginMm: 5,
        ruleSummary: "估算切除宽度 24.0 mm，长轴约 60.0 mm。",
        guardrailSummary: "基础规则未触发高风险提示，仍需医生确认。",
        createdAt: now,
        updatedAt: now,
        provenance: {
          source: "病例规划页确定性规则",
          author: "本地病例草稿",
          ageBand: "older_lax",
          lesionLayer: "cutaneous",
          marginStrategy: "expanded_margin",
          ruleTrace: [
            "年龄分档：老年 / 松弛",
            "病灶层次：皮表肿物 · 梭形切口模式",
            "病灶边界：椭圆边界 / 照片描记；状态：边界可用；长轴：14 mm，短轴：10 mm；记录者：示例医生",
            "安全切缘：5 mm",
            "图层状态：RSTL 高密度 78%，皮纹 70%",
            "梭形参数：36° / 2.5:1",
            "采集质量：采集可用",
          ],
        },
      },
    ],
    selectedCandidateId: "visual-candidate-1",
    reviewRecord: {
      reviewerName: "示例医生",
      decision: "approved",
      note: "候选方向与局部 RSTL 走行一致，需结合术前查体确认皮肤松弛度。",
      overrideReason: "扩大切缘病例已记录 5 mm 安全切缘；最终以病理切缘阴性为标准。",
      reviewedAt: now,
      exportedAt: null,
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
    "--timeout",
    "20000",
    "--load-storage",
    storageStatePath,
    "--wait-for-selector",
    selector,
    "--wait-for-timeout",
    "900",
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
    await screenshot("/app/cases", ".case-lobby-stage .case-face-asset-frame[data-loaded='true']", "01-dashboard.png");
    await screenshot("/app/case/new", "#caseNewSetup", "02-new-case.png");
    await screenshot("/app/case/visual-case/evaluate", ".case-face-asset-frame[data-loaded='true']", "03-evaluate.png");
    await screenshot("/app/case/visual-case/plan", ".case-face-asset-frame[data-loaded='true']", "04-plan.png");
    await screenshot("/app/case/visual-case/review", ".case-face-asset-frame[data-loaded='true']", "05-review.png");
    await screenshot("/app/settings/atlas", "#settingsAtlas", "06-settings-atlas.png");
    await screenshot("/app/settings/developer", "#settingsDeveloper", "07-settings-developer.png");
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
