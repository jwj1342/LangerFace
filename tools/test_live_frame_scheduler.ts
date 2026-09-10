import assert from "node:assert/strict";

import { LiveFrameScheduler } from "../web/src/services/liveFrameScheduler.ts";

type FrameCallback = (timeMs: number) => void;

let nextFrameId = 0;
const queued = new Map<number, FrameCallback>();
const cancelled: number[] = [];
const scheduler = new LiveFrameScheduler({
  requestFrame(callback) {
    const frameId = ++nextFrameId;
    queued.set(frameId, callback);
    return frameId;
  },
  cancelFrame(frameId) {
    cancelled.push(frameId);
    queued.delete(frameId);
  },
});

const flush = (frameId: number, timeMs = 0): void => {
  const callback = queued.get(frameId);
  assert.ok(callback, `frame ${frameId} should be queued`);
  queued.delete(frameId);
  callback(timeMs);
};

const calls: string[] = [];
assert.equal(scheduler.request(() => calls.push("first")), true);
assert.equal(scheduler.request(() => calls.push("duplicate")), false);
assert.equal(queued.size, 1, "same-tick redraw requests coalesce into one frame");
flush(1, 16);
assert.deepEqual(calls, ["first"]);
assert.equal(scheduler.hasPending(), false);

assert.equal(scheduler.request(() => {
  calls.push("outer");
  assert.equal(scheduler.request(() => calls.push("next")), true,
    "the active frame is cleared before its callback schedules the next frame");
}), true);
flush(2, 32);
assert.deepEqual(calls, ["first", "outer"]);
assert.equal(queued.size, 1);
flush(3, 48);
assert.deepEqual(calls, ["first", "outer", "next"]);

assert.equal(scheduler.request(() => calls.push("stale")), true);
const staleCallback = queued.get(4);
assert.ok(staleCallback);
scheduler.cancel();
assert.deepEqual(cancelled, [4]);
assert.equal(scheduler.hasPending(), false);
staleCallback(64);
assert.ok(!calls.includes("stale"), "a callback racing after cancellation cannot render a stale source");

assert.equal(scheduler.request(() => calls.push("restarted")), true,
  "a source can schedule frames again after cancellation");
flush(5, 80);
assert.equal(calls.at(-1), "restarted");

console.log("ok: live frame scheduling coalesces, recurs, cancels, and restarts safely");

let videoCallback: ((time: number) => void) | null = null;
let videoCancelled = 0;
const video = {
  paused: false, ended: false,
  requestVideoFrameCallback(cb: (time: number) => void) { videoCallback = cb; return 100; },
  cancelVideoFrameCallback(id: number) { videoCancelled = id; },
};
assert.equal(scheduler.request(() => calls.push("video"), video), true);
assert.equal(queued.size, 0, 'playing video waits for a new video frame');
const staleVideoCallback = videoCallback!;
scheduler.cancel();
assert.equal(videoCancelled, 100);
staleVideoCallback(80);
assert.ok(!calls.includes('video'), 'cancelled video callback cannot render an old source');
scheduler.request(() => calls.push('video-ready'), video);
videoCallback!(90);
assert.equal(calls.at(-1), 'video-ready');
assert.equal(scheduler.hasPending(), false, 'new video frames release the pending callback');
video.paused = true;
scheduler.request(() => calls.push('paused-redraw'), video);
assert.equal(queued.size, 1, 'paused video edits still get a redraw without a new video frame');
scheduler.cancel();
scheduler.request(() => calls.push('fallback'), {paused:false, ended:false});
assert.equal(queued.size, 1, 'unsupported browsers use animation frames');
scheduler.cancel();
