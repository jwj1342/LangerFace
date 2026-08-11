import assert from "node:assert/strict";

import { bindLiveCanvasInteractions } from "../web/src/services/liveCanvasInteraction.ts";

type Listener = (event: Record<string, unknown>) => void;

class FakeSurface {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly captured = new Set<number>();
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };

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

  emit(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

const event = (values: Record<string, unknown> = {}) => {
  let prevented = false;
  return {
    pointerId: 7,
    button: 0,
    clientX: 10,
    clientY: 20,
    deltaY: 0,
    preventDefault: () => { prevented = true; },
    wasPrevented: () => prevented,
    ...values,
  };
};

const surface = new FakeSurface();
const abortController = new AbortController();
let sourceKind = "image";
let refineActive = false;
let refineBegins = 0;
let refineMoves = 0;
let refineEnds = 0;
let refineUpdates = 0;
let staticRefreshes = 0;
const pans: Array<[number, number]> = [];
const imageZooms: Array<[number, number, number]> = [];
const focusZooms: number[] = [];

bindLiveCanvasInteractions(surface as unknown as HTMLElement, {
  isRefineActive: () => refineActive,
  beginRefinePointer: () => { refineBegins += 1; return true; },
  moveRefinePointer: () => { refineMoves += 1; return true; },
  endRefinePointer: () => { refineEnds += 1; return true; },
  sourceKind: () => sourceKind,
  panImageViewBy: (x, y) => { pans.push([x, y]); },
  zoomImageViewAt: (x, y, deltaY) => { imageZooms.push([x, y, deltaY]); return true; },
  adjustFocusZoom: (deltaY) => { focusZooms.push(deltaY); return true; },
  updateRefineUi: () => { refineUpdates += 1; },
  refreshStaticImage: () => { staticRefreshes += 1; },
}, { signal: abortController.signal });

assert.equal(surface.listenerCount(), 6);
surface.emit("pointerdown", event());
assert.equal(surface.classes.has("dragging"), true);
assert.deepEqual([...surface.captured], [7]);
const move = event({ clientX: 18, clientY: 25 });
surface.emit("pointermove", move);
assert.deepEqual(pans, [[8, 5]]);
assert.equal(move.wasPrevented(), true);

surface.captured.delete(7);
const captureLost = event();
surface.emit("lostpointercapture", captureLost);
assert.equal(surface.classes.has("dragging"), false);
surface.emit("pointermove", event({ clientX: 30, clientY: 40 }));
assert.deepEqual(pans, [[8, 5]], "lost capture ends image panning");

const imageWheel = event({ clientX: 30, clientY: 40, deltaY: -120 });
surface.emit("wheel", imageWheel);
assert.deepEqual(imageZooms, [[30, 40, -120]]);
assert.equal(imageWheel.wasPrevented(), true);

refineActive = true;
const refineDown = event();
const refineMove = event({ clientX: 15 });
const refineEnd = event();
surface.emit("pointerdown", refineDown);
surface.emit("pointermove", refineMove);
surface.emit("pointercancel", refineEnd);
assert.deepEqual([refineBegins, refineMoves, refineEnds], [1, 1, 1]);
assert.equal(refineDown.wasPrevented() && refineMove.wasPrevented() && refineEnd.wasPrevented(), true);
const refineWheel = event({ deltaY: 80 });
surface.emit("wheel", refineWheel);
assert.equal(refineUpdates, 1);

refineActive = false;
sourceKind = "video";
const focusWheel = event({ deltaY: 60 });
surface.emit("wheel", focusWheel);
assert.deepEqual(focusZooms, [60]);
assert.equal(staticRefreshes, 1);
assert.equal(focusWheel.wasPrevented(), true);

sourceKind = "image";
surface.emit("pointerdown", event({ pointerId: 11 }));
assert.equal(surface.classes.has("dragging"), true);
assert.equal(surface.captured.has(11), true);
abortController.abort();
assert.equal(surface.listenerCount(), 0, "route disposal removes all canvas listeners");
assert.equal(surface.classes.has("dragging"), false, "route disposal clears transient drag styling");
assert.equal(surface.captured.has(11), false, "route disposal releases active pointer capture");
surface.emit("pointermove", event({ pointerId: 11, clientX: 50 }));
assert.deepEqual(pans, [[8, 5]], "disposed interactions cannot mutate a later route session");

const abortedSurface = new FakeSurface();
bindLiveCanvasInteractions(abortedSurface as unknown as HTMLElement, {
  isRefineActive: () => false,
  beginRefinePointer: () => false,
  moveRefinePointer: () => false,
  endRefinePointer: () => false,
  sourceKind: () => "image",
  panImageViewBy: () => undefined,
  zoomImageViewAt: () => false,
  adjustFocusZoom: () => false,
  updateRefineUi: () => undefined,
  refreshStaticImage: () => undefined,
}, { signal: AbortSignal.abort() });
assert.equal(abortedSurface.listenerCount(), 0, "an already-disposed route cannot retain new listeners");

console.log("ok: live canvas pointer, capture-loss, wheel, and route cleanup ownership");
