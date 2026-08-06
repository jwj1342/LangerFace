import assert from "node:assert/strict";

import {
  inspectPullRequestText,
  listCommitMessages,
  readPullRequestEvent,
} from "./check_pr_closing_keywords.mjs";

function violations(input) {
  return inspectPullRequestText({ repository: "jwj1342/LangerFace", ...input }).violations;
}

assert.deepEqual(
  violations({ body: "Refs #95" }),
  [],
  "a pure Refs link remains allowed",
);
assert.deepEqual(
  violations({ body: "Closes #95" }),
  [],
  "an explicit closing declaration remains allowed",
);

const accident = violations({
  body: "Refs #95\n\nThis intentionally does not close #95.",
});
assert.equal(accident.length, 2, "the reported incident fails for both independent safeguards");
assert.match(accident.join("\n"), /否定语境/);
assert.match(accident.join("\n"), /同时含有 Refs/);

for (const keyword of [
  "close", "closes", "closed",
  "fix", "fixes", "fixed",
  "resolve", "resolves", "resolved",
]) {
  assert.notDeepEqual(
    violations({ body: `Refs #95\n${keyword.toUpperCase()} #95` }),
    [],
    `${keyword} is recognized case-insensitively`,
  );
}

assert.notDeepEqual(
  violations({ body: "This will not fix #95." }),
  [],
  "English negation does not neutralize a GitHub closing keyword",
);
assert.notDeepEqual(
  violations({ body: "这不会 resolve #95。" }),
  [],
  "Chinese negation does not neutralize a GitHub closing keyword",
);
assert.notDeepEqual(
  violations({ body: "不得 closed #95。" }),
  [],
  "Chinese prohibition does not neutralize a GitHub closing keyword",
);

assert.notDeepEqual(
  violations({
    body: "Refs #95",
    commitMessages: ["docs: clarify scope\n\nFixes #95"],
  }),
  [],
  "a closing keyword in any Base..Head commit message is checked",
);
const mergeCommitResult = inspectPullRequestText({
  repository: "jwj1342/LangerFace",
  commitMessages: ["Merge branch 'topic'\n\nResolves #95"],
});
assert.equal(mergeCommitResult.closings.length, 1, "merge commit messages are included in the inspection");
assert.equal(mergeCommitResult.closings[0].keyword, "Resolves");
assert.deepEqual(
  mergeCommitResult.violations,
  [],
  "a merge commit may still make an explicit, unambiguous closing declaration",
);

assert.notDeepEqual(
  violations({ body: "References octo/example#42\nCLOSED octo/example#42" }),
  [],
  "cross-repository references are normalized and protected",
);
assert.deepEqual(
  violations({ body: "Refs #42\nCloses octo/example#42" }),
  [],
  "identical numbers in different repositories do not collide",
);

assert.deepEqual(
  readPullRequestEvent({
    repository: { full_name: "jwj1342/LangerFace" },
    pull_request: { base: { sha: "base" }, head: { sha: "head" }, body: null },
  }),
  { body: "", baseSha: "base", headSha: "head", repository: "jwj1342/LangerFace" },
  "an empty PR body is safe",
);
assert.throws(
  () => readPullRequestEvent({ pull_request: { base: { sha: "base" }, head: { sha: "head" } } }, ""),
  /repository\.full_name/,
  "missing repository data fails loudly",
);
assert.throws(
  () => readPullRequestEvent({ repository: { full_name: "jwj1342/LangerFace" }, pull_request: {} }),
  /base\.sha or pull_request\.head\.sha/,
  "missing Base/Head event fields fail loudly",
);

const gitCalls = [];
assert.deepEqual(
  listCommitMessages("base", "head", (command, args) => {
    gitCalls.push([command, args]);
    return "first commit\0merge commit\n\nCloses #95\0";
  }),
  ["first commit", "merge commit\n\nCloses #95"],
  "NUL-delimited git output preserves complete commit messages",
);
assert.deepEqual(
  gitCalls,
  [["git", ["log", "--format=%B%x00", "base..head"]]],
  "the guard reads the complete Base..Head range locally",
);

console.log("test_pr_closing_keywords: parser, event validation, and commit-range coverage passed");
