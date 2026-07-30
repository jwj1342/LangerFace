#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEFAULT_AUTOMERGE_LABEL = "automerge:stack";

function hasLabel(pullRequest, label) {
  return (pullRequest.labels || []).some((item) => item?.name === label);
}

export function selectEligiblePullRequests(
  pullRequests,
  {
    defaultBranch = "master",
    label = DEFAULT_AUTOMERGE_LABEL,
  } = {},
) {
  return pullRequests.filter((pullRequest) => (
    pullRequest?.baseRefName === defaultBranch
    && pullRequest?.isDraft === false
    && pullRequest?.autoMergeRequest == null
    && typeof pullRequest?.headRefOid === "string"
    && pullRequest.headRefOid.length > 0
    && hasLabel(pullRequest, label)
  ));
}

export function nativeAutomergeArguments(pullRequest, repository) {
  return [
    "pr",
    "merge",
    String(pullRequest.number),
    "--repo",
    repository,
    "--auto",
    "--squash",
    "--match-head-commit",
    pullRequest.headRefOid,
  ];
}

function requireRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value || "")) {
    throw new Error("AUTOMERGE_REPOSITORY must be an owner/repository name");
  }
  return value;
}

function listPullRequests(repository, defaultBranch, label) {
  const output = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repository,
      "--state",
      "open",
      "--base",
      defaultBranch,
      "--label",
      label,
      "--limit",
      "100",
      "--json",
      "number,url,isDraft,baseRefName,headRefOid,autoMergeRequest,labels",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return JSON.parse(output);
}

export function run({
  repository = process.env.AUTOMERGE_REPOSITORY || process.env.GITHUB_REPOSITORY,
  defaultBranch = process.env.AUTOMERGE_DEFAULT_BRANCH || "master",
  label = process.env.AUTOMERGE_LABEL || DEFAULT_AUTOMERGE_LABEL,
  dryRun = process.env.AUTOMERGE_DRY_RUN === "1",
} = {}) {
  const resolvedRepository = requireRepository(repository);
  if (!defaultBranch || !label) {
    throw new Error("default branch and auto-merge label must be non-empty");
  }

  const pullRequests = listPullRequests(resolvedRepository, defaultBranch, label);
  const eligible = selectEligiblePullRequests(pullRequests, { defaultBranch, label });

  if (eligible.length === 0) {
    console.log(
      `No ${label} pull requests currently target ${defaultBranch} without auto-merge.`,
    );
    return [];
  }

  for (const pullRequest of eligible) {
    const args = nativeAutomergeArguments(pullRequest, resolvedRepository);
    if (dryRun) {
      console.log(`[dry-run] enable native auto-merge for #${pullRequest.number}`);
      continue;
    }
    execFileSync("gh", args, { stdio: "inherit" });
  }
  return eligible.map((pullRequest) => pullRequest.number);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  run();
}
