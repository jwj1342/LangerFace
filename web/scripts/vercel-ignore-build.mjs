#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const allowedBranches = new Set(["master", "React-架构重构"]);
const productionBranches = new Set(["master"]);
const previewBranches = new Set(["React-架构重构"]);
const branch = process.env.VERCEL_GIT_COMMIT_REF || "";
const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA || "HEAD^";
const vercelEnv = process.env.VERCEL_ENV || "";
const previewMode = process.env.VERCEL_PREVIEW_DEPLOY_MODE || "manual";
const forceDeploy = process.env.VERCEL_FORCE_DEPLOY === "1";
const previewDeployPattern = /\[(?:deploy-preview|preview|vercel)\]/i;

function proceed(message) {
  console.log(`Vercel build enabled: ${message}`);
  process.exit(1);
}

function skip(message) {
  console.log(`Vercel build skipped: ${message}`);
  process.exit(0);
}

function commandSucceeds(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function hasChangesSince(ref) {
  try {
    execFileSync("git", ["diff", "--quiet", ref, "HEAD", "--", "."], { stdio: "ignore" });
    return false;
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 1) {
      return true;
    }
    proceed("git diff failed, so the safer choice is to build");
  }
}

function hasChangesInHeadCommit() {
  try {
    execFileSync("git", ["diff-tree", "--quiet", "--no-commit-id", "-r", "HEAD", "--", "."], {
      stdio: "ignore"
    });
    return false;
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 1) {
      return true;
    }
    proceed("git diff-tree failed, so the safer choice is to build");
  }
}

function getCommitMessage() {
  return (
    process.env.VERCEL_GIT_COMMIT_MESSAGE ||
    commandOutput("git", ["log", "-1", "--pretty=%B"])
  );
}

if (!allowedBranches.has(branch)) {
  skip(`branch "${branch || "unknown"}" is not in the deployment whitelist`);
}

if (vercelEnv === "production" && !productionBranches.has(branch)) {
  skip(`production deployment is only allowed from ${[...productionBranches].join(", ")}`);
}

if (previewBranches.has(branch) && vercelEnv !== "production" && previewMode === "off" && !forceDeploy) {
  skip(`preview branch "${branch}" is disabled by VERCEL_PREVIEW_DEPLOY_MODE=off`);
}

if (previewBranches.has(branch) && vercelEnv !== "production" && previewMode !== "auto" && !forceDeploy) {
  const commitMessage = getCommitMessage();
  if (!previewDeployPattern.test(commitMessage)) {
    skip(
      `preview branch "${branch}" requires [vercel], [preview], or [deploy-preview] in the commit message`
    );
  }
}

if (commandSucceeds("git", ["rev-parse", "--verify", `${previousSha}^{commit}`])) {
  if (hasChangesSince(previousSha)) {
    proceed(`web changes detected since ${previousSha}`);
  }
  skip(`no changes under the Vercel root since ${previousSha}`);
}

if (hasChangesInHeadCommit()) {
  proceed(`previous commit "${previousSha}" is unavailable; web changes detected in HEAD`);
}

if (productionBranches.has(branch) || vercelEnv === "production") {
  proceed(`previous commit "${previousSha}" is unavailable on the production path`);
}

skip(`previous commit "${previousSha}" is unavailable, and HEAD has no Vercel-root changes`);
