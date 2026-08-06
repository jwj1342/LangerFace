import assert from "node:assert/strict";

import { LiveScanLifecycle, type LiveScanStream } from "../web/src/services/liveScanLifecycle.ts";

type FrameCallback = (timeMs: number) => void;

let nextFrameId = 0;
const queued = new Map<number, FrameCallback>();
const cancelled: number[] = [];
const released: string[] = [];
const stream = (name: string): LiveScanStream & { name: string } => ({
  name,
  getTracks: () => [],
});
const lifecycle = new LiveScanLifecycle({
  requestFrame(callback) {
    const id = ++nextFrameId;
    queued.set(id, callback);
    return id;
  },
  cancelFrame(id) {
    cancelled.push(id);
    queued.delete(id);
  },
  releaseStream(value) {
    released.push((value as { name: string }).name);
  },
});

const first = lifecycle.begin();
assert.equal(lifecycle.isActive(first), true);
assert.equal(lifecycle.adoptStream(first, stream("first")), true);
const callbacks: string[] = [];
assert.equal(lifecycle.schedule(first, () => callbacks.push("frame")), true);
assert.equal(lifecycle.schedule(first, () => callbacks.push("duplicate")), false,
  "scan lifecycle coalesces multiple frame requests");
const staleFrame = queued.get(1);
assert.ok(staleFrame);

lifecycle.stop();
assert.deepEqual(cancelled, [1]);
assert.deepEqual(released, ["first"]);
assert.equal(lifecycle.isActive(first), false);
staleFrame(16);
assert.deepEqual(callbacks, [], "a cancelled scan frame cannot run after stop");

assert.equal(lifecycle.adoptStream(first, stream("late")), false,
  "a stream arriving for a stale scan is rejected");
assert.deepEqual(released, ["first", "late"]);

const second = lifecycle.begin();
assert.notEqual(second, first);
assert.equal(lifecycle.adoptStream(second, stream("second")), true);
assert.equal(lifecycle.schedule(second, () => {
  callbacks.push("second");
  assert.equal(lifecycle.schedule(second, () => callbacks.push("next")), true);
}), true);
const secondFrame = queued.get(2);
assert.ok(secondFrame);
queued.delete(2);
secondFrame(32);
assert.deepEqual(callbacks, ["second"]);
const nextFrame = queued.get(3);
assert.ok(nextFrame);
queued.delete(3);
nextFrame(48);
assert.deepEqual(callbacks, ["second", "next"]);

lifecycle.stop();
assert.deepEqual(released, ["first", "late", "second"]);

console.log("ok: live scan lifecycle owns sessions, frames, and camera streams");
