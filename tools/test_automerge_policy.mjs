import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_AUTOMERGE_LABEL,
  nativeAutomergeArguments,
  processEligiblePullRequests,
  selectEligiblePullRequests,
  updateBranchArguments,
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

assert.deepEqual(
  updateBranchArguments(
    pullRequest({ number: 118, headRefOid: "def456", mergeStateStatus: "BEHIND" }),
    "jwj1342/LangerFace",
  ),
  [
    "api",
    "--method",
    "PUT",
    "repos/jwj1342/LangerFace/pulls/118/update-branch",
    "-f",
    "expected_head_sha=def456",
  ],
  "behind branches are updated with an exact head-SHA guard",
);

const executed = [];
const loggedErrors = [];
assert.throws(
  () => processEligiblePullRequests(
    [
      pullRequest({ number: 116 }),
      pullRequest({ number: 117 }),
    ],
    "jwj1342/LangerFace",
    {
      execute(command, args) {
        executed.push([command, args]);
        if (args.includes("116")) {
          throw new Error("synthetic first PR failure");
        }
      },
      logger: {
        log() {},
        error(message) {
          loggedErrors.push(message);
        },
      },
    },
  ),
  /Failed to process 1 auto-merge pull request/,
  "one failed PR is reported after the remaining eligible PRs are attempted",
);
assert.equal(executed.length, 2, "a failed PR does not prevent later PRs from being processed");
assert.match(loggedErrors[0], /#116/, "failure log identifies the affected PR");

const workflow = fs.readFileSync(".github/workflows/automerge-approved.yml", "utf8");
assert.match(workflow, /pull_request_target:/);
assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /pull-requests: write/);
assert.match(workflow, /contents: write/);
assert.doesNotMatch(workflow, /pull_request\.head/);
assert.doesNotMatch(workflow, /--admin/);
assert.doesNotMatch(workflow, /^\s+- closed\s*$/m);

console.log("test_automerge_policy: eligibility, branch update, failure isolation, and trusted checkout passed");
