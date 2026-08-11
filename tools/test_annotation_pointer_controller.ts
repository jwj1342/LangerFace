import assert from "node:assert/strict";

import { bindAnnotationPointerInteractions } from "../web/src/services/annotationPointerController.ts";

type Listener = (event: Record<string, unknown>) => void;

class FakeSurface {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly captured = new Set<number>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  setPointerCapture(pointerId: number): void {
    this.captured.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.captured.delete(pointerId);
  }

  emit(type: string, event: Record<string, unknown>): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

const pointer = (values: Record<string, unknown> = {}) => ({
  pointerId: 7,
  button: 0,
  clientX: 10,
  clientY: 20,
  ...values,
});

const surface = new FakeSurface();
const abortController = new AbortController();
const orbits: Array<[number, number]> = [];
const zooms: number[] = [];
const clicks: Array<[number, number]> = [];

bindAnnotationPointerInteractions(surface as unknown as HTMLElement, {
  orbit: (dx, dy) => { orbits.push([dx, dy]); },
  zoom: (factor) => { zooms.push(factor); },
  addPoint: ({ clientX, clientY }) => { clicks.push([clientX, clientY]); },
}, { signal: abortController.signal });

assert.equal(surface.listenerCount(), 6);
surface.emit("pointerdown", pointer());
assert.deepEqual([...surface.captured], [7]);
surface.emit("pointermove", pointer({ clientX: 13 }));
assert.deepEqual(orbits, [], "movement inside click tolerance does not orbit");
surface.emit("pointerup", pointer({ clientX: 13 }));
assert.deepEqual(clicks, [[13, 20]], "a primary click adds exactly one surface point");
assert.deepEqual([...surface.captured], []);

surface.emit("pointerdown", pointer());
surface.emit("pointerdown", pointer({ pointerId: 9, clientX: 100 }));
surface.emit("pointermove", pointer({ pointerId: 9, clientX: 130 }));
assert.deepEqual(orbits, [], "a second pointer cannot replace the active gesture");
surface.emit("pointermove", pointer({ clientX: 30 }));
assert.deepEqual(orbits, [[20, 0]]);
surface.emit("pointerup", pointer({ clientX: 30 }));
assert.deepEqual(clicks, [[13, 20]], "an orbit gesture cannot also add a point");

surface.emit("pointerdown", pointer());
surface.captured.delete(7);
surface.emit("lostpointercapture", pointer());
surface.emit("pointerup", pointer());
assert.deepEqual(clicks, [[13, 20]], "lost capture clears the pending click gesture");

surface.emit("pointerdown", pointer());
surface.emit("pointercancel", pointer());
surface.emit("pointerup", pointer());
assert.deepEqual(clicks, [[13, 20]], "cancelled gestures cannot add a point");

surface.emit("pointerdown", pointer({ button: 2 }));
assert.deepEqual([...surface.captured], [], "secondary buttons cannot begin annotation gestures");

let prevented = false;
surface.emit("wheel", {
  deltaY: 120,
  preventDefault: () => { prevented = true; },
});
assert.equal(prevented, true);
assert.equal(zooms.length, 1);
assert.ok(zooms[0] > 1, "positive wheel delta applies a bounded zoom factor");

surface.emit("pointerdown", pointer({ pointerId: 11 }));
assert.equal(surface.captured.has(11), true);
abortController.abort();
assert.equal(surface.listenerCount(), 0, "route disposal removes every annotation pointer listener");
assert.equal(surface.captured.has(11), false, "route disposal releases the active pointer capture");
surface.emit("pointerup", pointer({ pointerId: 11 }));
assert.deepEqual(clicks, [[13, 20]], "disposed gestures cannot mutate a later route session");

const abortedSurface = new FakeSurface();
bindAnnotationPointerInteractions(abortedSurface as unknown as HTMLElement, {
  orbit: () => undefined,
  zoom: () => undefined,
  addPoint: () => undefined,
}, { signal: AbortSignal.abort() });
assert.equal(abortedSurface.listenerCount(), 0, "an already-aborted route retains no listeners");

console.log("ok: annotation pointer capture, click, orbit, wheel, and route cleanup lifecycle");
