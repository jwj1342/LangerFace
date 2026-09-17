#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  assertMarkerIdentity,
  captureMarkerIdentity,
  TARGET_MARKER_PROFILE,
} from "./marker_runtime_identity.mts";
import { detectorVersionForProfile } from "../web/src/services/controlledMarkerDetectionProfile.ts";

const EXPECTED_VERSION = "task1-candidate";
const BUILD_MARKER = "LANGERFACE_LESION_CANDIDATE_BUILD";
const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const webRoot = resolve(repoRoot, "web");
const viteEntry = resolve(webRoot, "node_modules/vite/bin/vite.js");
const manifestPath = resolve(webRoot, "dist/marker-runtime-identity.json");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const verifyOnly = args.includes("--verify-dist");
const unknownArgs = args.filter((arg) => arg !== "--check" && arg !== "--verify-dist");

if (unknownArgs.length || (checkOnly && verifyOnly)) {
  throw new Error(`build:lesion-candidate 收到不支持的参数：${args.join(" ")}`);
}
if (detectorVersionForProfile(TARGET_MARKER_PROFILE) !== EXPECTED_VERSION) {
  throw new Error(`受控标记实现版本不是 ${EXPECTED_VERSION}，拒绝生成生产包。`);
}
if (!existsSync(viteEntry)) {
  throw new Error("当前 worktree 缺少 web/node_modules/vite；请先在 web 目录运行 npm ci。");
}
const actualViteEntry = realpathSync(viteEntry);
if (!actualViteEntry.startsWith(realpathSync(resolve(webRoot, "node_modules")))) {
  throw new Error("Vite 入口不属于当前 worktree 的 web/node_modules，拒绝构建。");
}

function expectedIdentity() {
  return {
    ...captureMarkerIdentity(TARGET_MARKER_PROFILE, repoRoot),
    mode: "production",
    command: "npm run build:lesion-candidate",
  };
}

function verifyDistIdentity() {
  if (!existsSync(manifestPath)) {
    throw new Error("生产身份清单缺失：dist/marker-runtime-identity.json");
  }
  const actual = JSON.parse(readFileSync(manifestPath, "utf8"));
  const expected = expectedIdentity();
  assertMarkerIdentity(actual, expected);
  if (actual.mode !== expected.mode || actual.command !== expected.command) {
    throw new Error("生产身份清单的构建模式或命令不匹配。");
  }
  if (actual.profile !== TARGET_MARKER_PROFILE || actual.implementationVersion !== EXPECTED_VERSION) {
    throw new Error("生产身份清单不是小肿物边界候选算法，拒绝放行。");
  }
  console.log(`[lesion-candidate-build] 身份回读通过 ${manifestPath}`);
}

console.log(`[lesion-candidate-build] profile=${TARGET_MARKER_PROFILE} identity=${EXPECTED_VERSION}`);
if (checkOnly) process.exit(0);
if (verifyOnly) {
  verifyDistIdentity();
  process.exit(0);
}

const result = spawnSync(process.execPath, [actualViteEntry, "build"], {
  cwd: webRoot,
  env: {
    ...process.env,
    [BUILD_MARKER]: "1",
    VITE_CONTROLLED_MARKER_DETECTOR_PROFILE: TARGET_MARKER_PROFILE,
  },
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
verifyDistIdentity();
