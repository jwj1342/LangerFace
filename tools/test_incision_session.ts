import assert from "node:assert/strict";

import { createIncisionSessionGuard } from "../web/src/services/incisionSession.ts";

const sessions = createIncisionSessionGuard();
const first = sessions.mount();
assert.equal(sessions.isActive(first), true);

sessions.dispose();
assert.equal(sessions.isActive(first), false, "dispose invalidates in-flight boot work");

const second = sessions.mount();
assert.notEqual(second, first, "remount receives a fresh ownership token");
assert.equal(sessions.isActive(first), false, "old work stays stale after remount");
assert.equal(sessions.isActive(second), true);

const third = sessions.mount();
assert.equal(sessions.isActive(second), false, "a newer mount supersedes the previous owner");
assert.equal(sessions.isActive(third), true);

console.log("test_incision_session: stale boot and cleanup ownership passed");
