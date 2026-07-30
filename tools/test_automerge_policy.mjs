import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_AUTOMERGE_LABEL,
  nativeAutomergeArguments,
  selectEligiblePullRequests,
} from "./automerge_policy.mjs";

function pullRequest(overrides = {}) {
  return {
    number: 116,
    baseRefName: "master",
    headRefOid: "abc123",
    isDraft: false,
    autoMergeRequest: null,
    labels: [{ name: DEFAULT_AUTOMERGE_LABEL }],
    ...overrides,
  };
}

const eligible = selectEligiblePullRequests([
  pullRequest(),
  pullRequest({ number: 117, labels: [] }),
  pullRequest({ number: 118, baseRefName: "feature-parent" }),
  pullRequest({ number: 119, isDraft: true }),
  pullRequest({ number: 120, autoMergeRequest: { enabledAt: "now" } }),
  pullRequest({ number: 121, headRefOid: "" }),
]);
assert.deepEqual(
  eligible.map((item) => item.number),
  [116],
  "only labeled, non-draft PRs targeting the default branch are eligible",
);

assert.deepEqual(
  nativeAutomergeArguments(eligible[0], "jwj1342/LangerFace"),
  [
    "pr",
    "merge",
    "116",
    "--repo",
    "jwj1342/LangerFace",
    "--auto",
    "--squash",
    "--match-head-commit",
    "abc123",
  ],
  "native auto-merge pins the reviewed head commit and never uses an admin bypass",
);

const workflow = fs.readFileSync(".github/workflows/automerge-approved.yml", "utf8");
assert.match(workflow, /pull_request_target:/);
assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /pull-requests: write/);
assert.match(workflow, /contents: write/);
assert.doesNotMatch(workflow, /pull_request\.head/);
assert.doesNotMatch(workflow, /--admin/);

console.log("test_automerge_policy: default-branch, label, and trusted-checkout gates passed");
