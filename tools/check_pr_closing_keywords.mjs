#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const ISSUE_REFERENCE_PATTERN = "(?:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)?#[0-9]+";
const REFERENCE_PATTERN = new RegExp(
  `\\b(?:ref|refs|reference|references)\\b\\s*:?\\s*(${ISSUE_REFERENCE_PATTERN})`,
  "gi",
);
const CLOSING_PATTERN = new RegExp(
  `\\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\\b\\s*(?::|,|-)?\\s*(${ISSUE_REFERENCE_PATTERN})`,
  "gi",
);
const NEGATION_PATTERN = /(?:\b(?:not|does\s+not|do\s+not|doesn't|don't|never|without)\b|不|不会|不得)/i;

function normalizeIssueReference(reference, repository) {
  const match = /^(?:(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+))?#(?<number>[0-9]+)$/.exec(reference);
  if (!match) throw new Error(`Unsupported issue reference: ${reference}`);

  const number = String(Number(match.groups.number));
  if (match.groups.owner) {
    return `${match.groups.owner.toLowerCase()}/${match.groups.repo.toLowerCase()}#${number}`;
  }
  return repository ? `${repository.toLowerCase()}#${number}` : `#${number}`;
}

function sourceLabel(source) {
  return source.kind === "body" ? "PR 正文" : `提交信息 ${source.index + 1}`;
}

function isNegated(text, keywordStart) {
  const lineStart = Math.max(text.lastIndexOf("\n", keywordStart), text.lastIndexOf("\r", keywordStart)) + 1;
  const linePrefix = text.slice(lineStart, keywordStart);
  const sentenceStart = Math.max(
    linePrefix.lastIndexOf("."),
    linePrefix.lastIndexOf(";"),
    linePrefix.lastIndexOf("。"),
    linePrefix.lastIndexOf("；"),
    linePrefix.lastIndexOf("!"),
    linePrefix.lastIndexOf("！"),
    linePrefix.lastIndexOf("?"),
    linePrefix.lastIndexOf("？"),
  ) + 1;
  return NEGATION_PATTERN.test(linePrefix.slice(sentenceStart));
}

function collectReferences(sources, repository) {
  const references = new Map();
  for (const source of sources) {
    for (const match of source.text.matchAll(REFERENCE_PATTERN)) {
      const normalized = normalizeIssueReference(match[1], repository);
      const locations = references.get(normalized) || [];
      locations.push({ source, reference: match[1] });
      references.set(normalized, locations);
    }
  }
  return references;
}

function collectClosings(sources, repository) {
  const closings = [];
  for (const source of sources) {
    for (const match of source.text.matchAll(CLOSING_PATTERN)) {
      closings.push({
        keyword: match[1],
        reference: match[2],
        normalized: normalizeIssueReference(match[2], repository),
        negated: isNegated(source.text, match.index),
        source,
      });
    }
  }
  return closings;
}

export function inspectPullRequestText({ body = "", commitMessages = [], repository = "" } = {}) {
  if (typeof body !== "string") throw new Error("pull request body must be a string");
  if (!Array.isArray(commitMessages) || commitMessages.some((message) => typeof message !== "string")) {
    throw new Error("commit messages must be an array of strings");
  }

  const sources = [
    { kind: "body", index: 0, text: body },
    ...commitMessages.map((text, index) => ({ kind: "commit", index, text })),
  ];
  const references = collectReferences(sources, repository);
  const closings = collectClosings(sources, repository);
  const violations = [];

  for (const closing of closings) {
    const label = sourceLabel(closing.source);
    if (references.has(closing.normalized)) {
      violations.push(
        `${label} 同时含有 Refs 与 ${closing.keyword} ${closing.reference}；若不应关闭 Issue，请仅保留 Refs。`,
      );
    }
    if (closing.negated) {
      violations.push(
        `${label} 在否定语境中仍含有 ${closing.keyword} ${closing.reference}；GitHub 仍会识别 closing keyword，请改写为不含 closing keyword 的表述。`,
      );
    }
  }

  return { references, closings, violations };
}

export function readPullRequestEvent(event, fallbackRepository = process.env.GITHUB_REPOSITORY || "") {
  const pullRequest = event?.pull_request;
  if (!pullRequest) throw new Error("GitHub event is missing pull_request");
  if (!pullRequest.base?.sha || !pullRequest.head?.sha) {
    throw new Error("GitHub event is missing pull_request.base.sha or pull_request.head.sha");
  }

  const repository = event?.repository?.full_name || fallbackRepository;
  if (!repository) throw new Error("GitHub event is missing repository.full_name");

  return {
    body: pullRequest.body || "",
    baseSha: pullRequest.base.sha,
    headSha: pullRequest.head.sha,
    repository,
  };
}

export function listCommitMessages(baseSha, headSha, execute = execFileSync) {
  const output = execute(
    "git",
    ["log", "--format=%B%x00", `${baseSha}..${headSha}`],
    { encoding: "utf8" },
  );
  return output.split("\0").filter((message) => message.length > 0);
}

function eventPathFromArguments(argumentsList) {
  const eventIndex = argumentsList.indexOf("--event");
  if (eventIndex === -1) return process.env.GITHUB_EVENT_PATH || "";
  const eventPath = argumentsList[eventIndex + 1];
  if (!eventPath) throw new Error("--event requires a path");
  return eventPath;
}

export function run({ eventPath = eventPathFromArguments(process.argv.slice(2)) } = {}) {
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH or --event is required");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const { body, baseSha, headSha, repository } = readPullRequestEvent(event);
  const result = inspectPullRequestText({
    body,
    commitMessages: listCommitMessages(baseSha, headSha),
    repository,
  });

  if (result.violations.length > 0) {
    throw new Error(`Closing keyword guard failed:\n- ${result.violations.join("\n- ")}`);
  }
  console.log("Closing keyword guard passed: no ambiguous Refs/closing keyword combination found.");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
