#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const productionBranches = new Set(["master"]);
const branch = process.env.VERCEL_GIT_COMMIT_REF || "";
const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA || "HEAD^";
const vercelEnv = process.env.VERCEL_ENV || "";

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

if (!productionBranches.has(branch)) {
  skip(`branch "${branch || "unknown"}" is not the production deployment branch`);
}

if (vercelEnv === "production" && !productionBranches.has(branch)) {
  skip(`production deployment is only allowed from ${[...productionBranches].join(", ")}`);
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

proceed(`previous commit "${previousSha}" is unavailable on the production deployment branch`);
