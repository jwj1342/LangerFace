#!/usr/bin/env node

import fs from "node:fs";

const repository = process.env.GITHUB_REPOSITORY || "jwj1342/LangerFace";
const token = process.env.GITHUB_TOKEN || "";
const todo = fs.readFileSync(new URL("../docs/planning/TODO.md", import.meta.url), "utf8");
const linkedOpen = new Set(
  [...todo.matchAll(/^- \[ \].*?https:\/\/github\.com\/jwj1342\/LangerFace\/issues\/(\d+)/gm)]
    .map((match) => Number(match[1])),
);

async function openIssues() {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/issues?state=open&per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "LangerFace-TODO-sync",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub issue query failed: ${response.status} ${await response.text()}`);
    }
    const pageItems = await response.json();
    issues.push(...pageItems.filter((item) => !item.pull_request));
    if (pageItems.length < 100) return issues;
  }
}

const currentOpen = new Set((await openIssues()).map((issue) => Number(issue.number)));
const stale = [...linkedOpen].filter((number) => !currentOpen.has(number)).sort((a, b) => a - b);
const missing = [...currentOpen].filter((number) => !linkedOpen.has(number)).sort((a, b) => a - b);

if (stale.length || missing.length) {
  if (stale.length) console.error(`TODO 未勾选但 issue 已关闭/不存在: ${stale.map((n) => `#${n}`).join(", ")}`);
  if (missing.length) console.error(`TODO 缺少 open issue: ${missing.map((n) => `#${n}`).join(", ")}`);
  process.exit(1);
}

console.log(`ok: TODO 与 GitHub 的 ${currentOpen.size} 个 open issue 完全同步`);
