import assert from "node:assert/strict";

import {
  createIncisionSessionGuard,
  loadIncisionSessionAssets,
} from "../web/src/services/incisionSession.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

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

type TestAsset = { id: string };

const staleHead = deferred<TestAsset>();
const staleAtlas = deferred<TestAsset>();
let previewAtlas: TestAsset | null = null;
let previewTakeCount = 0;
const loadAssets = (
  session: number,
  head: Promise<TestAsset>,
  standardAtlas: Promise<TestAsset>,
) => loadIncisionSessionAssets(session, (token) => sessions.isActive(token), {
  loadHead: () => head,
  loadStandardAtlas: () => standardAtlas,
  takePreviewAtlas: () => {
    previewTakeCount += 1;
    const staged = previewAtlas;
    previewAtlas = null;
    return staged;
  },
});

const staleLoad = loadAssets(third, staleHead.promise, staleAtlas.promise);
const current = sessions.mount();
const currentHead = deferred<TestAsset>();
const currentAtlas = deferred<TestAsset>();
const currentLoad = loadAssets(current, currentHead.promise, currentAtlas.promise);
previewAtlas = { id: "session-b-preview" };

staleHead.resolve({ id: "session-a-head" });
staleAtlas.resolve({ id: "session-a-standard" });
assert.equal(await staleLoad, null, "stale asset loading exits before destructive preview access");
assert.equal(previewTakeCount, 0, "stale loading never takes the preview atlas");
assert.deepEqual(previewAtlas, { id: "session-b-preview" }, "the current session preview remains staged");

currentHead.resolve({ id: "session-b-head" });
currentAtlas.resolve({ id: "session-b-standard" });
const currentAssets = await currentLoad;
assert.deepEqual(currentAssets?.personalizedAtlas, { id: "session-b-preview" });
assert.equal(previewTakeCount, 1, "the active session takes the preview exactly once");
assert.equal(previewAtlas, null, "taking the preview clears the destructive store");

console.log("test_incision_session: stale boot and preview ownership passed");
