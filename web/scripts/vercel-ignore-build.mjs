#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const allowedBranches = new Set(["master", "React-架构重构"]);
const branch = process.env.VERCEL_GIT_COMMIT_REF || "";
const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA || "HEAD^";

function proceed(message) {
  console.log(`Vercel build enabled: ${message}`);
  process.exit(1);
}

function skip(message) {
  console.log(`Vercel build skipped: ${message}`);
  process.exit(0);
}

if (!allowedBranches.has(branch)) {
  skip(`branch "${branch || "unknown"}" is not in the deployment whitelist`);
}

try {
  execFileSync("git", ["rev-parse", "--verify", `${previousSha}^{commit}`], { stdio: "ignore" });
} catch {
  proceed(`previous commit "${previousSha}" is unavailable in the Vercel shallow clone`);
}

try {
  execFileSync("git", ["diff", "--quiet", previousSha, "HEAD", "--", "."], { stdio: "ignore" });
  skip(`no changes under the Vercel root since ${previousSha}`);
} catch (error) {
  if (error && typeof error === "object" && "status" in error && error.status === 1) {
    proceed(`web changes detected since ${previousSha}`);
  }
  proceed("git diff failed, so the safer choice is to build");
}
