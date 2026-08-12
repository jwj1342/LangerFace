import assert from "node:assert/strict";

import { LiveActionScheduler } from "../web/src/services/liveActionScheduler.ts";

const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 5));
let session = 1;
let mounted = true;
const published: string[] = [];
const scheduler = new LiveActionScheduler({
  currentSession: () => session,
  isActive: (candidate) => mounted && candidate === session,
  publish: (reason) => published.push(reason),
});

scheduler.schedule("first");
scheduler.schedule("coalesced");
await flushTimers();
assert.deepEqual(published, ["coalesced"], "same-tick state publications coalesce to the latest reason");

let resolveOldAction: (() => void) | null = null;
const oldAction = new Promise<void>((resolve) => { resolveOldAction = resolve; });
scheduler.run("async_action", () => oldAction);
await flushTimers();
assert.equal(published.at(-1), "async_action", "an active async action publishes its immediate state");
session += 1;
resolveOldAction?.();
await oldAction;
await flushTimers();
assert.ok(!published.includes("async_action_done"), "an old route session cannot publish completion into a new mount");

const currentFailure = Promise.reject(new Error("camera rejected"));
const returnedFailure = scheduler.run("camera", () => currentFailure);
await assert.rejects(returnedFailure, /camera rejected/);
await flushTimers();
assert.equal(published.at(-1), "camera_failed", "active async failures publish the failed state");

assert.throws(
  () => scheduler.run("sync_action", () => { throw new Error("sync failure"); }),
  /sync failure/,
);
await flushTimers();
assert.equal(published.at(-1), "sync_action_failed", "synchronous failures publish before rethrowing");

scheduler.schedule("cancelled");
scheduler.dispose();
await flushTimers();
assert.ok(!published.includes("cancelled"), "dispose cancels queued publications");

mounted = false;
scheduler.schedule("unmounted");
await flushTimers();
assert.ok(!published.includes("unmounted"), "unmounted workbenches cannot enqueue publications");

console.log("test_live_action_scheduler OK");
