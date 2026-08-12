import assert from "node:assert/strict";
import {
  annotationNdcPoint,
  annotationZoomFactor,
  beginAnnotationDrag,
  updateAnnotationDrag,
} from "../web/src/services/annotationInteraction.ts";
import { AnnotationLineService } from "../web/src/services/annotationLineService.ts";
import { AnnotationModel, type AnnotationPoint } from "../web/src/services/annotationModel.ts";

const close = (actual: number, expected: number) => Math.abs(actual - expected) < 1e-12;
const point = (x: number): AnnotationPoint => ({ xyz: [x, 0, 0], tri: 0, bary: [1, 0, 0] });

const start = beginAnnotationDrag(10, 20);
assert.deepEqual(start, { x: 10, y: 20, startX: 10, startY: 20, moved: false, axis: null });

const clickMove = updateAnnotationDrag(start, 13, 20);
assert.equal(clickMove.orbit, null, "sub-threshold movement remains a click");
assert.equal(clickMove.state.moved, false);

const freeBeforeLock = updateAnnotationDrag(start, 15, 23);
assert.deepEqual(freeBeforeLock.orbit, { dx: 5, dy: 3 });
assert.equal(freeBeforeLock.state.axis, null, "short drags orbit freely before axis lock");

const yaw = updateAnnotationDrag(freeBeforeLock.state, 25, 23);
assert.deepEqual(yaw.orbit, { dx: 10, dy: 0 });
assert.equal(yaw.state.axis, "yaw");

const pitch = updateAnnotationDrag(beginAnnotationDrag(0, 0), 2, 20);
assert.deepEqual(pitch.orbit, { dx: 0, dy: 20 });
assert.equal(pitch.state.axis, "pitch");

const free = updateAnnotationDrag(beginAnnotationDrag(0, 0), 12, 12);
assert.deepEqual(free.orbit, { dx: 12, dy: 12 });
assert.equal(free.state.axis, "free");

const center = annotationNdcPoint(60, 45, { left: 10, top: 20, width: 100, height: 50 });
assert.ok(close(center.x, 0) && close(center.y, 0));
assert.deepEqual(annotationNdcPoint(10, 20, { left: 10, top: 20, width: 100, height: 50 }), { x: -1, y: 1 });
assert.ok(close(annotationZoomFactor(1_000), annotationZoomFactor(180)), "positive wheel input is clamped");
assert.ok(close(annotationZoomFactor(-1_000), annotationZoomFactor(-180)), "negative wheel input is clamped");

const model = new AnnotationModel("rstl");
const lines = new AnnotationLineService(model);
assert.deepEqual(lines.draft("", " forehead "), { name: "rstl_01", region: "forehead" });

const started = lines.start(lines.draft(" first ", "cheek"));
assert.equal(started.status, "started");
assert.equal(model.current?.name, "first");
assert.equal(lines.start(lines.draft("second")).status, "blocked", "an active line cannot be replaced");
assert.deepEqual(lines.save(), { status: "too_short", controlCount: 0 });
assert.equal(lines.undo().status, "cancelled", "undo cancels an empty draft");

lines.start(lines.draft("first"));
model.addPoint(point(0));
model.addPoint(point(1));
const saved = lines.save();
assert.equal(saved.status, "saved");
assert.equal(model.lines.length, 1);

const restoredByUndo = lines.undo();
assert.equal(restoredByUndo.status, "restored", "undo restores the last saved line for editing");
assert.equal(model.lines.length, 0);
assert.equal(lines.undo().status, "point");
assert.equal((model.current?.controls || []).length, 1);
model.addPoint(point(2));
assert.equal(lines.save().status, "saved");

lines.start(lines.draft("empty"));
const restored = lines.restore(0);
assert.equal(restored.status, "restored", "an empty draft is cancelled before restoring a saved line");
assert.equal(model.current?.name, "first");
assert.equal(lines.restore(0).status, "blocked", "a non-empty draft protects against destructive replacement");
assert.equal(lines.save().status, "saved");
assert.equal(lines.delete(0), true);
assert.equal(lines.delete(99), false);
lines.clear();
assert.equal(model.current, null);
assert.equal(model.lines.length, 0);
assert.equal(lines.undo().status, "empty");

console.log("annotation interaction and line services: ok");
