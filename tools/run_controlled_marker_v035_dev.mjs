#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { detectorVersionForProfile } from "../web/src/services/controlledMarkerDetectionProfile.ts";

const EXPECTED_PROFILE = "color-difference-v0.35";
const EXPECTED_VERSION = detectorVersionForProfile(EXPECTED_PROFILE);
const DEFAULT_PROFILE = "legacy-v0.23";
const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const webRoot = resolve(repoRoot, "web");
const viteEntry = resolve(webRoot, "node_modules/vite/bin/vite.js");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

function runGit(...args) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`无法读取 Git 运行身份：${String(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function git(...args) {
  return runGit(...args).trim();
}

function parseStatus() {
  const lines = runGit("status", "--porcelain=v1", "--untracked-files=all")
    .split(/\r?\n/)
    .filter(Boolean);
  return {
    staged: lines.filter((line) => line[0] !== " " && line[0] !== "?").length,
    trackedModified: lines.filter((line) => !line.startsWith("??")).length,
    untracked: lines.filter((line) => line.startsWith("??")).length,
  };
}

function readOption(args, name, fallback) {
  const exact = args.lastIndexOf(name);
  if (exact >= 0 && args[exact + 1] && !args[exact + 1].startsWith("-")) {
    return args[exact + 1];
  }
  const prefixed = [...args].reverse().find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : fallback;
}

const rawArgs = process.argv.slice(2);
const checkOnly = rawArgs.includes("--check");
const viteArgs = rawArgs.filter((arg) => arg !== "--check");
const requestedHost = readOption(viteArgs, "--host", "127.0.0.1");
const requestedPort = readOption(viteArgs, "--port", checkOnly ? null : "5173");
if (requestedHost !== "127.0.0.1") {
  throw new Error(`dev:marker-v035 只允许绑定 127.0.0.1，拒绝 host=${requestedHost}`);
}
if (requestedPort !== null && (!/^\d+$/.test(requestedPort) || Number(requestedPort) < 1 || Number(requestedPort) > 65535)) {
  throw new Error(`dev:marker-v035 收到无效端口：${requestedPort}`);
}

if (!existsSync(viteEntry)) {
  throw new Error("当前 worktree 缺少 web/node_modules/vite；请先在 web 目录运行 npm ci。");
}
const actualViteEntry = realpathSync(viteEntry);
const expectedNodeModules = resolve(webRoot, "node_modules");
if (!actualViteEntry.startsWith(realpathSync(expectedNodeModules))) {
  throw new Error("Vite 入口不属于当前 worktree 的 web/node_modules，拒绝启动。");
}

const packageJson = JSON.parse(readFileSync(resolve(webRoot, "package.json"), "utf8"));
const identity = {
  command: "npm run dev:marker-v035",
  mode: "development",
  sourceRoot: repoRoot,
  git: {
    branch: git("branch", "--show-current"),
    head: git("rev-parse", "HEAD"),
    worktree: parseStatus(),
  },
  controlledMarker: {
    profile: EXPECTED_PROFILE,
    version: EXPECTED_VERSION,
    selector: "VITE_CONTROLLED_MARKER_DETECTOR_PROFILE (launcher-owned)",
    defaultProfileUnchanged: DEFAULT_PROFILE,
    modelDependency: "none; deterministic image processing",
    profileSourceSha256: sha256(resolve(webRoot, "src/services/controlledMarkerDetectionProfile.ts")),
    implementationSourceSha256: sha256(resolve(webRoot, "src/services/controlledMarkerDetectionColorV035.ts")),
  },
  dependencies: {
    node: process.version,
    vite: packageJson.devDependencies?.vite ?? "unknown",
    lockfileSha256: sha256(resolve(webRoot, "package-lock.json")),
  },
  service: {
    host: requestedHost,
    port: requestedPort === null ? null : Number(requestedPort),
    portStatus: requestedPort === null ? "deferred_to_main_launcher" : "resolved",
  },
  pageWideModelAssetsCheck: "predev:marker-v035 runs doctor_wrinkle_runtime.ts before the main launcher",
};

console.log(`[marker-v035-runtime] ${JSON.stringify(identity, null, 2)}`);
if (checkOnly) process.exit(0);

const child = spawn(
  process.execPath,
  [actualViteEntry, "--force", ...viteArgs, "--host", "127.0.0.1", "--strictPort"],
  {
    cwd: webRoot,
    env: {
      ...process.env,
      VITE_CONTROLLED_MARKER_DETECTOR_PROFILE: EXPECTED_PROFILE,
    },
    stdio: "inherit",
    windowsHide: true,
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`[marker-v035-runtime] Vite 启动失败：${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.log(`[marker-v035-runtime] Vite 已由 ${signal} 停止。`);
  }
  process.exitCode = code ?? (signal ? 0 : 1);
});
