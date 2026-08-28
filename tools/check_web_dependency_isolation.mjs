#!/usr/bin/env node

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(fileURLToPath(new URL("../web/", import.meta.url)));
const expectedNodeModules = resolve(webRoot, "node_modules");

if (!existsSync(expectedNodeModules)) {
  console.error("[dependency-isolation] web/node_modules 不存在；请先在当前 worktree 的 web 目录运行 npm ci。");
  process.exit(1);
}

const actualNodeModules = realpathSync(expectedNodeModules);
const normalize = (value) => {
  const normalized = resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

if (normalize(actualNodeModules) !== normalize(expectedNodeModules)) {
  console.error([
    "[dependency-isolation] 拒绝启动：web/node_modules 指向当前 worktree 以外的位置。",
    `当前入口：${expectedNodeModules}`,
    `实际目标：${actualNodeModules}`,
    "请只移除当前 node_modules 链接，再在当前 worktree 的 web 目录运行 npm ci；不要删除实际目标目录。",
  ].join("\n"));
  process.exit(1);
}

console.log(`[dependency-isolation] PASS ${expectedNodeModules}`);
