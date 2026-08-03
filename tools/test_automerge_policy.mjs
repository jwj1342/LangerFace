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
  pullRequest({
    number: 122,
    mergeStateStatus: "BEHIND",
    autoMergeRequest: { enabledAt: "now" },
  }),
  pullRequest({
    number: 123,
    mergeStateStatus: "CLEAN",
    autoMergeRequest: { enabledAt: "now" },
  }),
  pullRequest({
    number: 124,
    mergeStateStatus: "UNKNOWN",
    autoMergeRequest: { enabledAt: "now" },
  }),
]);
assert.deepEqual(
  eligible.map((item) => item.number),
  [116, 122],
  "an auto-merge request is only reconsidered when its branch is behind",
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

const retryCommands = [];
const alreadyRegisteredBehind = pullRequest({
  number: 122,
  headRefOid: "retry-sha",
  mergeStateStatus: "BEHIND",
  autoMergeRequest: { enabledAt: "now" },
});
processEligiblePullRequests(
  [alreadyRegisteredBehind],
  "jwj1342/LangerFace",
  {
    execute(command, args) {
      retryCommands.push([command, args]);
    },
  },
);
assert.deepEqual(
  retryCommands,
  [[
    "gh",
    [
      "api",
      "--method",
      "PUT",
      "repos/jwj1342/LangerFace/pulls/122/update-branch",
      "-f",
      "expected_head_sha=retry-sha",
    ],
  ]],
  "a behind PR with auto-merge already enabled only receives a guarded branch update",
);
assert.doesNotMatch(
  retryCommands.flat(2).join(" "),
  /pr merge|--auto/,
  "retrying a behind PR never registers auto-merge a second time",
);

const executed = [];
const loggedErrors = [];
assert.throws(
  () => processEligiblePullRequests(
    [
      pullRequest({
        number: 116,
        mergeStateStatus: "BEHIND",
        autoMergeRequest: { enabledAt: "now" },
      }),
      pullRequest({ number: 117 }),
    ],
    "jwj1342/LangerFace",
    {
      execute(command, args) {
        executed.push([command, args]);
        if (args.join(" ").includes("/pulls/116/")) {
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
assert.equal(
  executed[0][1][0],
  "api",
  "failure isolation also covers the already-registered branch-update path",
);
assert.equal(
  executed[1][1][0],
  "pr",
  "a failed branch update does not block later auto-merge registration",
);
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
