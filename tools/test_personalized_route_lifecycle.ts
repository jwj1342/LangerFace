import assert from "node:assert/strict";

import {
  createPersonalizedRouteLifecycle,
  type PersonalizedRuntimeResource,
} from "../web/src/services/personalized/personalizedRouteLifecycle.ts";

function fakeResource() {
  let closeCount = 0;
  const resource: PersonalizedRuntimeResource = {
    close() {
      closeCount += 1;
    },
  };
  return { resource, closeCount: () => closeCount };
}

const lifecycle = createPersonalizedRouteLifecycle();
const events = new EventTarget();
let firstListenerCalls = 0;

const first = lifecycle.mount();
events.addEventListener("capture", () => { firstListenerCalls += 1; }, { signal: first.signal });
const firstLandmarker = fakeResource();
const firstYolo = fakeResource();
assert.equal(first.adopt("landmarker", firstLandmarker.resource), true);
assert.equal(first.adopt("wrinkleYolo", firstYolo.resource), true);
events.dispatchEvent(new Event("capture"));
assert.equal(firstListenerCalls, 1, "the mounted route owns one active listener set");

lifecycle.dispose();
assert.equal(first.isActive(), false, "leaving the route invalidates its generation");
assert.equal(first.signal.aborted, true, "leaving the route aborts all owned listeners");
assert.equal(firstLandmarker.closeCount(), 1, "leaving the route closes MediaPipe");
assert.equal(firstYolo.closeCount(), 1, "leaving the route closes ONNX");
events.dispatchEvent(new Event("capture"));
assert.equal(firstListenerCalls, 1, "a disposed listener cannot survive route exit");

const staleYolo = fakeResource();
assert.equal(first.adopt("wrinkleYolo", staleYolo.resource), false,
  "an async model finishing after route exit cannot attach to a stale generation");
assert.equal(staleYolo.closeCount(), 1, "a stale async model releases itself immediately");

let secondListenerCalls = 0;
const second = lifecycle.mount();
events.addEventListener("capture", () => { secondListenerCalls += 1; }, { signal: second.signal });
assert.notEqual(second.generation, first.generation, "re-entry receives a fresh generation");
assert.equal(second.isActive(), true, "the re-entered route is active");
events.dispatchEvent(new Event("capture"));
assert.equal(firstListenerCalls, 1, "re-entry does not revive the old listener set");
assert.equal(secondListenerCalls, 1, "re-entry binds exactly one fresh listener set");

const secondLandmarker = fakeResource();
assert.equal(second.adopt("landmarker", secondLandmarker.resource), true);
const third = lifecycle.mount();
assert.equal(secondLandmarker.closeCount(), 1, "mounting again disposes the previous route resources");
assert.equal(second.isActive(), false, "mounting again invalidates prior in-flight work");
assert.equal(third.isActive(), true, "the newest route generation remains active");
lifecycle.dispose();
lifecycle.dispose();

console.log("test_personalized_route_lifecycle: enter/leave/re-enter ownership passed");
