import assert from "node:assert/strict";

import {
  bindHead3DControls,
  Head3DResourceLifecycle,
  type DisposableHead3DResource,
} from "../web/src/services/head3dController.ts";

type Listener = (event: Record<string, unknown>) => void;

class FakeSurface {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly captured: number[] = [];

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  setPointerCapture(pointerId: number): void {
    this.captured.push(pointerId);
  }

  emit(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

const surface = new FakeSurface();
const rotations: Array<[number, number]> = [];
const zooms: number[] = [];
let resets = 0;
let prevented = false;
const cleanupControls = bindHead3DControls(surface as unknown as HTMLCanvasElement, {
  rotate: (deltaX, deltaY) => rotations.push([deltaX, deltaY]),
  zoom: (factor) => zooms.push(factor),
  reset: () => { resets += 1; },
});

assert.equal(surface.listenerCount(), 7);
surface.emit("pointerdown", { clientX: 10, clientY: 20, pointerId: 4 });
surface.emit("pointermove", { clientX: 18, clientY: 31 });
assert.deepEqual(surface.captured, [4]);
assert.deepEqual(rotations, [[8, 11]]);
surface.emit("lostpointercapture");
surface.emit("pointermove", { clientX: 30, clientY: 40 });
assert.deepEqual(rotations, [[8, 11]], "lost capture stops an in-progress rotation");
surface.emit("wheel", { deltaY: 400, preventDefault: () => { prevented = true; } });
assert.equal(prevented, true);
assert.ok(Math.abs(zooms[0] - Math.exp(0.16)) < 1e-12, "wheel zoom clamps extreme deltas");
surface.emit("dblclick");
assert.equal(resets, 1);

cleanupControls();
assert.equal(surface.listenerCount(), 0, "control disposal removes every canvas listener");
surface.emit("dblclick");
assert.equal(resets, 1, "disposed controls cannot mutate a later route session");

interface FakeHead extends DisposableHead3DResource {
  name: string;
}

let releaseFirst!: () => void;
const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
const lifecycleEvents: string[] = [];
const lifecycle = new Head3DResourceLifecycle<FakeHead>();
const firstGeneration = lifecycle.capture();
let firstFactoryCalls = 0;
const first = lifecycle.ensure(firstGeneration, async () => {
  firstFactoryCalls += 1;
  await firstGate;
  return {
    resource: { name: "stale", dispose: () => lifecycleEvents.push("stale-dispose") },
    cleanup: () => lifecycleEvents.push("stale-cleanup"),
  };
});
const duplicate = lifecycle.ensure(firstGeneration, async () => {
  throw new Error("coalesced initialization must not invoke a second factory");
});
assert.equal(first, duplicate, "concurrent renderer initialization shares one promise");
assert.equal(firstFactoryCalls, 1);

lifecycle.dispose();
const secondGeneration = lifecycle.capture();
const current = await lifecycle.ensure(secondGeneration, async () => ({
  resource: { name: "current", dispose: () => lifecycleEvents.push("current-dispose") },
  cleanup: () => lifecycleEvents.push("current-cleanup"),
}));
assert.equal(current?.name, "current");
assert.equal(lifecycle.current()?.name, "current");

releaseFirst();
assert.equal(await first, null, "an initialization finishing after route disposal is rejected");
assert.deepEqual(lifecycleEvents, ["stale-cleanup", "stale-dispose"]);
assert.equal(lifecycle.current()?.name, "current", "stale completion cannot replace the new route renderer");

let staleFactoryCalled = false;
assert.equal(await lifecycle.ensure(firstGeneration, async () => {
  staleFactoryCalled = true;
  return null;
}), null);
assert.equal(staleFactoryCalled, false, "a stale session cannot start renderer initialization");

lifecycle.dispose();
assert.deepEqual(lifecycleEvents, [
  "stale-cleanup",
  "stale-dispose",
  "current-cleanup",
  "current-dispose",
]);
assert.equal(lifecycle.current(), null);

console.log("ok: head 3D controls and renderer resources follow the active route session");
